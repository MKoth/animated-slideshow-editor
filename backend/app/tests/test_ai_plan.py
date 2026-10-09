"""Lesson Plan proposal and accept gate (Spec 12 R19-R26, issue #421)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai.zen import ZenClient

SAMPLE_PLAN = {
    "title": "Intro to Ser and Estar",
    "description": "A beginner lesson on ser vs estar",
    "language": "en",
    "estimatedDurationSec": 300.0,
    "learningObjective": "Distinguish ser from estar",
    "teachingStrategy": "Present, practice, produce",
    "slides": [
        {
            "title": "Ser for identity",
            "goal": "Learn ser for identity",
            "estimatedDurationSec": 150.0,
            "explanation": "Ser describes identity",
            "suggestedNarration": "Ser is for who you are.",
            "requiredAssets": [
                {"name": "Cat", "classification": "existing", "definitionId": "def-cat"},
                {"name": "Blackboard", "classification": "missing"},
            ],
            "recommendedMaterials": ["Chalk"],
            "recommendedShaders": [],
            "recommendedClips": ["Fade"],
        },
        {
            "title": "Estar for state",
            "goal": "Learn estar for state",
            "estimatedDurationSec": 150.0,
            "explanation": "Estar describes state",
            "suggestedNarration": "Estar is for how you are.",
            "requiredAssets": [
                {"name": "Board", "classification": "optional"},
            ],
            "recommendedMaterials": [],
            "recommendedShaders": [],
            "recommendedClips": [],
        },
    ],
}


def _enable_key(client: TestClient, key: str = "sk-test-key-1234") -> None:
    app_state: Any = client.app
    settings = app_state.state.settings
    settings.ai_secret_key = "test-secret-for-ai-plans"
    r = client.put("/api/ai/settings", json={"apiKey": key})
    assert r.status_code == 200, r.text


def _fake_models(monkeypatch: pytest.MonkeyPatch, models: list[str]) -> None:
    def _list(self: ZenClient, http_client: Any = None) -> list[str]:
        _ = (self, http_client)
        return list(models)

    monkeypatch.setattr(ZenClient, "list_models", _list)


def _fake_plan(monkeypatch: pytest.MonkeyPatch, payload: dict[str, Any]) -> None:
    import app.api.ai as ai_api

    def _gen(**kwargs: Any) -> dict[str, Any]:
        _ = kwargs
        loaded: Any = json.loads(json.dumps(payload))
        assert isinstance(loaded, dict)
        return dict(loaded)

    monkeypatch.setattr(ai_api, "_generate_plan_structured", _gen)


def _make_project(client: TestClient, pid: str = "p-plan") -> str:
    blob = json.dumps(
        {
            "version": 2,
            "project": {
                "id": pid,
                "name": "Lesson",
                "description": "",
                "author": "",
                "createdAt": "2026-01-01T00:00:00",
                "modifiedAt": "2026-01-01T00:00:00",
                "settings": {},
            },
            "slides": [],
        }
    )
    r = client.post("/api/projects", content=blob, headers={"content-type": "application/json"})
    assert r.status_code == 200, r.text
    fetched = client.get(f"/api/projects/{pid}")
    assert fetched.status_code == 200
    return fetched.text


def test_plan_proposed_from_conversation_without_touching_project(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_plan(monkeypatch, SAMPLE_PLAN)

    before_blob = _make_project(client, "p-plan-1")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-plan-1"}).json()

    r = client.post(
        "/api/ai/plan",
        json={
            "projectId": "p-plan-1",
            "conversationId": conv["id"],
            "request": "Teach ser vs estar",
            "context": {"projectName": "Lesson", "assets": ["Cat"]},
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["title"] == "Intro to Ser and Estar"
    assert len(data["slides"]) == 2
    assert data["status"] == "draft"
    assert data["slides"][0]["requiredAssets"][0]["classification"] == "existing"

    # Project blob untouched (slides, audio, scripts).
    after_blob = client.get("/api/projects/p-plan-1").text
    assert after_blob == before_blob

    # Narration message appended to the conversation.
    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert any(m["role"] == "assistant" and "Ser" in m["content"] for m in msgs)


def test_plan_view_edit_revise_accept_cycle(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_plan(monkeypatch, SAMPLE_PLAN)

    _make_project(client, "p-plan-2")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-plan-2"}).json()
    created = client.post(
        "/api/ai/plan",
        json={
            "projectId": "p-plan-2",
            "conversationId": conv["id"],
            "request": "Teach ser vs estar",
            "context": {},
        },
    ).json()
    plan_id = created["id"]

    # View: list + detail.
    listing = client.get("/api/ai/plans", params={"projectId": "p-plan-2"}).json()
    assert len(listing) == 1
    detail = client.get(f"/api/ai/plans/{plan_id}").json()
    assert detail["learningObjective"] == "Distinguish ser from estar"
    assert "revisions" in detail and len(detail["revisions"]) == 1

    # Edit: lesson title + teaching strategy + slide duration/order preserved as user edits.
    slide_ids = [s["id"] for s in detail["slides"]]
    assert len(slide_ids) == 2
    swapped = list(reversed(detail["slides"]))
    patch_body = {
        "title": "My edited title",
        "teachingStrategy": "My strategy",
        "slides": [
            {"id": swapped[0]["id"], "estimatedDurationSec": 200.0},
            {"id": swapped[1]["id"], "estimatedDurationSec": 100.0},
        ],
    }
    edited = client.patch(f"/api/ai/plans/{plan_id}", json=patch_body)
    assert edited.status_code == 200, edited.text
    assert edited.json()["title"] == "My edited title"

    # Revise: regeneration preserves the author's edits.
    revised_payload = json.loads(json.dumps(SAMPLE_PLAN))
    revised_payload["title"] = "Regenerated title that must not win"
    _fake_plan(monkeypatch, revised_payload)
    regen = client.post(
        "/api/ai/plan",
        json={
            "projectId": "p-plan-2",
            "conversationId": conv["id"],
            "request": "Add more examples",
            "context": {},
            "planId": plan_id,
        },
    )
    assert regen.status_code == 200, regen.text
    regen_data = regen.json()
    assert regen_data["title"] == "My edited title"
    assert regen_data["teachingStrategy"] == "My strategy"
    detail2 = client.get(f"/api/ai/plans/{plan_id}").json()
    assert len(detail2["revisions"]) == 2
    assert detail2["revisions"][1]["sourceRequest"] == "Add more examples"

    # Accept stores the plan; project still untouched.
    before_blob = client.get("/api/projects/p-plan-2").text
    acc = client.post(f"/api/ai/plans/{plan_id}/accept")
    assert acc.status_code == 200
    assert acc.json()["status"] == "accepted"
    assert client.get("/api/projects/p-plan-2").text == before_blob

    # Reject path on a second plan.
    second = client.post(
        "/api/ai/plan",
        json={
            "projectId": "p-plan-2",
            "conversationId": conv["id"],
            "request": "Another lesson",
            "context": {},
        },
    ).json()
    rej = client.post(f"/api/ai/plans/{second['id']}/reject")
    assert rej.status_code == 200
    assert rej.json()["status"] == "rejected"


def test_plan_missing_key_and_unlisted_model_surface_in_conversation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_project(client, "p-plan-3")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-plan-3"}).json()

    # No key saved -> actionable error, history preserved.
    r = client.post(
        "/api/ai/plan",
        json={
            "projectId": "p-plan-3",
            "conversationId": conv["id"],
            "request": "Teach something",
            "context": {},
        },
    )
    assert r.status_code in (409, 502)
    assert r.json()["detail"]["code"] == "missing_key"
    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert msgs[-1]["role"] == "assistant"
    assert msgs[-1]["errorCode"] is not None

    # With key but unlisted model -> reselect block.
    _enable_key(client)
    _fake_models(monkeypatch, ["some/other-model"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    r2 = client.post(
        "/api/ai/plan",
        json={
            "projectId": "p-plan-3",
            "conversationId": conv["id"],
            "request": "Teach something",
            "context": {},
        },
    )
    assert r2.status_code in (409, 502)
    assert r2.json()["detail"]["code"] == "model_unlisted"


def test_plan_shape_validation_and_project_isolation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})

    # Malformed provider content -> provider_error without losing history.
    import app.api.ai as ai_api

    def _bad(**kwargs: Any) -> dict[str, Any]:
        _ = kwargs
        return {"not": "a plan"}

    monkeypatch.setattr(ai_api, "_generate_plan_structured", _bad)
    _make_project(client, "p-plan-4")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-plan-4"}).json()
    r = client.post(
        "/api/ai/plan",
        json={
            "projectId": "p-plan-4",
            "conversationId": conv["id"],
            "request": "Teach",
            "context": {},
        },
    )
    assert r.status_code in (409, 502)
    assert r.json()["detail"]["code"] == "provider_error"

    # Project isolation + cascade delete with project.
    _fake_plan(monkeypatch, SAMPLE_PLAN)
    _make_project(client, "p-plan-5")
    conv5 = client.post("/api/ai/conversations", json={"projectId": "p-plan-5"}).json()
    created = client.post(
        "/api/ai/plan",
        json={
            "projectId": "p-plan-5",
            "conversationId": conv5["id"],
            "request": "Teach ser vs estar",
            "context": {},
        },
    ).json()
    assert client.get("/api/ai/plans", params={"projectId": "p-plan-5"}).json() != []
    assert client.get("/api/ai/plans", params={"projectId": "p-plan-4"}).json() == []
    assert client.delete("/api/projects/p-plan-5").status_code == 204
    assert client.get("/api/ai/plans", params={"projectId": "p-plan-5"}).json() == []
    assert client.get(f"/api/ai/plans/{created['id']}").status_code == 404
