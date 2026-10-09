"""Action Scenario record and accept gate (Spec 12 Stage A, issue #423)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai.zen import ZenClient

SAMPLE_SCENARIO = {
    "title": "Ser vs Estar cat lesson",
    "description": "Intro greeting, blackboard teaching, goodbye",
    "steps": [
        {
            "partTag": "intro",
            "spokenLine": "Hello friends, I am Mao the cat!",
            "onScreenAction": "Cat waves at the camera, classroom behind",
            "assetHints": ["cat", "classroom"],
            "estimatedDurationSec": 8.0,
        },
        {
            "partTag": "middle",
            "spokenLine": "Ser is for who you are.",
            "onScreenAction": "Chalk text appears on the blackboard line by line",
            "assetHints": ["blackboard", "chalk text"],
            "estimatedDurationSec": 20.0,
        },
        {
            "partTag": "outro",
            "spokenLine": "Goodbye friends, see you next time!",
            "onScreenAction": "Cat waves goodbye, camera holds on face",
            "assetHints": ["cat"],
            "estimatedDurationSec": 6.0,
        },
    ],
}


def _enable_key(client: TestClient, key: str = "sk-test-key-1234") -> None:
    app_state: Any = client.app
    settings = app_state.state.settings
    settings.ai_secret_key = "test-secret-for-ai-scenarios"
    r = client.put("/api/ai/settings", json={"apiKey": key})
    assert r.status_code == 200, r.text


def _fake_models(monkeypatch: pytest.MonkeyPatch, models: list[str]) -> None:
    def _list(self: ZenClient, http_client: Any = None) -> list[str]:
        _ = (self, http_client)
        return list(models)

    monkeypatch.setattr(ZenClient, "list_models", _list)


def _fake_scenario(monkeypatch: pytest.MonkeyPatch, payload: dict[str, Any]) -> None:
    import app.api.ai as ai_api

    def _gen(**kwargs: Any) -> dict[str, Any]:
        _ = kwargs
        loaded: Any = json.loads(json.dumps(payload))
        assert isinstance(loaded, dict)
        return dict(loaded)

    monkeypatch.setattr(ai_api, "_generate_scenario_structured", _gen)


def _make_project(client: TestClient, pid: str = "p-scenario") -> str:
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


def test_scenario_drafted_with_part_tags_and_bare_hints(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_scenario(monkeypatch, SAMPLE_SCENARIO)

    before_blob = _make_project(client, "p-scen-1")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-scen-1"}).json()

    r = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-1",
            "conversationId": conv["id"],
            "request": "Draft a cat lesson: greeting, blackboard teaching, goodbye",
            "context": {"projectName": "Lesson"},
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["title"] == "Ser vs Estar cat lesson"
    assert data["status"] == "draft"
    assert len(data["steps"]) == 3
    tags = [s["partTag"] for s in data["steps"]]
    assert tags == ["intro", "middle", "outro"]
    # Spoken lines, actions, bare hints, rough durations captured per step.
    middle = data["steps"][1]
    assert middle["spokenLine"] == "Ser is for who you are."
    assert "Chalk" in middle["onScreenAction"] or "chalk" in middle["onScreenAction"].lower()
    assert middle["assetHints"] == ["blackboard", "chalk text"]
    assert middle["estimatedDurationSec"] == 20.0
    for step in data["steps"]:
        assert set(step.keys()) >= {
            "id",
            "order",
            "partTag",
            "spokenLine",
            "onScreenAction",
            "assetHints",
            "estimatedDurationSec",
        }
        # Bare names only: no definition/clip/material/shader refs.
        for forbidden in ("definitionId", "clipName", "material", "shader", "script"):
            assert forbidden not in step

    # Project blob untouched.
    assert client.get("/api/projects/p-scen-1").text == before_blob

    # Narration message appended.
    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert any(m["role"] == "assistant" and "scenario" in m["content"].lower() for m in msgs)


def test_scenario_view_edit_revise_accept_cycle(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_scenario(monkeypatch, SAMPLE_SCENARIO)

    _make_project(client, "p-scen-2")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-scen-2"}).json()
    created = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-2",
            "conversationId": conv["id"],
            "request": "Draft the cat lesson",
            "context": {},
        },
    ).json()
    scenario_id = created["id"]

    # View: list + detail.
    listing = client.get("/api/ai/scenarios", params={"projectId": "p-scen-2"}).json()
    assert len(listing) == 1
    assert listing[0]["stepCount"] == 3
    detail = client.get(f"/api/ai/scenarios/{scenario_id}").json()
    assert detail["description"] == "Intro greeting, blackboard teaching, goodbye"
    assert len(detail["revisions"]) == 1

    # Edit: title + step spoken line + reorder preserved as user edits.
    step_ids = [s["id"] for s in detail["steps"]]
    assert len(step_ids) == 3
    reordered = [step_ids[2], step_ids[0], step_ids[1]]
    patch_steps = []
    for sid in reordered:
        item: dict[str, Any] = {"id": sid}
        if sid == step_ids[1]:
            item["spokenLine"] = "My edited middle line"
        patch_steps.append(item)
    edited = client.patch(
        f"/api/ai/scenarios/{scenario_id}",
        json={"title": "My edited scenario", "steps": patch_steps},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["title"] == "My edited scenario"
    edited_steps = {s["id"]: s for s in edited.json()["steps"]}
    assert edited_steps[step_ids[1]]["spokenLine"] == "My edited middle line"
    assert [s["id"] for s in edited.json()["steps"]] == reordered

    # Revise: regeneration preserves the author's edits.
    regen_payload = json.loads(json.dumps(SAMPLE_SCENARIO))
    regen_payload["title"] = "Regenerated title that must not win"
    regen_payload["steps"][1]["spokenLine"] = "Regenerated line that must not win"
    _fake_scenario(monkeypatch, regen_payload)
    regen = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-2",
            "conversationId": conv["id"],
            "request": "Add more examples",
            "context": {},
            "scenarioId": scenario_id,
        },
    )
    assert regen.status_code == 200, regen.text
    regen_data = regen.json()
    assert regen_data["title"] == "My edited scenario"
    middle_lines = [s["spokenLine"] for s in regen_data["steps"]]
    assert "My edited middle line" in middle_lines
    detail2 = client.get(f"/api/ai/scenarios/{scenario_id}").json()
    assert len(detail2["revisions"]) == 2
    assert detail2["revisions"][1]["sourceRequest"] == "Add more examples"

    # Accept stores the scenario; project still untouched.
    before_blob = client.get("/api/projects/p-scen-2").text
    acc = client.post(f"/api/ai/scenarios/{scenario_id}/accept")
    assert acc.status_code == 200
    assert acc.json()["status"] == "accepted"
    assert client.get("/api/projects/p-scen-2").text == before_blob

    # Reject path on a second scenario.
    second = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-2",
            "conversationId": conv["id"],
            "request": "Another lesson",
            "context": {},
        },
    ).json()
    rej = client.post(f"/api/ai/scenarios/{second['id']}/reject")
    assert rej.status_code == 200
    assert rej.json()["status"] == "rejected"


def test_scenario_accept_gate_blocks_stage_b_on_draft(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_scenario(monkeypatch, SAMPLE_SCENARIO)

    _make_project(client, "p-scen-3")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-scen-3"}).json()
    created = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-3",
            "conversationId": conv["id"],
            "request": "Draft it",
            "context": {},
        },
    ).json()
    scenario_id = created["id"]

    # Draft canonical read is refused: Stage B must not run on a draft.
    draft_canonical = client.get(f"/api/ai/scenarios/{scenario_id}/canonical")
    assert draft_canonical.status_code == 409, draft_canonical.text

    # After accept, the canonical JSON matches exactly what the author approved.
    client.post(f"/api/ai/scenarios/{scenario_id}/accept")
    ok = client.get(f"/api/ai/scenarios/{scenario_id}/canonical")
    assert ok.status_code == 200, ok.text
    canonical = ok.json()
    assert canonical["status"] == "accepted"
    assert len(canonical["steps"]) == 3
    assert canonical["steps"][0]["partTag"] == "intro"
    detail = client.get(f"/api/ai/scenarios/{scenario_id}").json()
    assert canonical["steps"] == detail["steps"]


def test_scenario_shape_validation_rejects_refs_and_bad_tags(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})

    import app.api.ai as ai_api

    def _bad_refs(**kwargs: Any) -> dict[str, Any]:
        _ = kwargs
        payload = json.loads(json.dumps(SAMPLE_SCENARIO))
        assert isinstance(payload, dict)
        steps = payload["steps"]
        assert isinstance(steps, list)
        first = steps[0]
        assert isinstance(first, dict)
        first["definitionId"] = "def-cat"
        return payload

    monkeypatch.setattr(ai_api, "_generate_scenario_structured", _bad_refs)
    _make_project(client, "p-scen-4")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-scen-4"}).json()
    r = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-4",
            "conversationId": conv["id"],
            "request": "Draft",
            "context": {},
        },
    )
    assert r.status_code in (409, 502)
    assert r.json()["detail"]["code"] == "provider_error"

    def _bad_tag(**kwargs: Any) -> dict[str, Any]:
        _ = kwargs
        payload = json.loads(json.dumps(SAMPLE_SCENARIO))
        assert isinstance(payload, dict)
        steps = payload["steps"]
        assert isinstance(steps, list)
        first = steps[0]
        assert isinstance(first, dict)
        first["partTag"] = "prologue"
        return payload

    monkeypatch.setattr(ai_api, "_generate_scenario_structured", _bad_tag)
    r2 = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-4",
            "conversationId": conv["id"],
            "request": "Draft",
            "context": {},
        },
    )
    assert r2.status_code in (409, 502)

    # Project isolation + cascade delete with project.
    _fake_scenario(monkeypatch, SAMPLE_SCENARIO)
    _make_project(client, "p-scen-5")
    conv5 = client.post("/api/ai/conversations", json={"projectId": "p-scen-5"}).json()
    created = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-5",
            "conversationId": conv5["id"],
            "request": "Draft",
            "context": {},
        },
    ).json()
    assert client.get("/api/ai/scenarios", params={"projectId": "p-scen-5"}).json() != []
    assert client.get("/api/ai/scenarios", params={"projectId": "p-scen-4"}).json() == []
    assert client.delete("/api/projects/p-scen-5").status_code == 204
    assert client.get("/api/ai/scenarios", params={"projectId": "p-scen-5"}).json() == []
    assert client.get(f"/api/ai/scenarios/{created['id']}").status_code == 404


def test_scenario_edits_and_regeneration_reset_acceptance(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Any mutation after accept re-drafts: the gate must be re-passed."""
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_scenario(monkeypatch, SAMPLE_SCENARIO)

    _make_project(client, "p-scen-7")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-scen-7"}).json()
    created = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-7",
            "conversationId": conv["id"],
            "request": "Draft it",
            "context": {},
        },
    ).json()
    scenario_id = created["id"]
    client.post(f"/api/ai/scenarios/{scenario_id}/accept")
    assert client.get(f"/api/ai/scenarios/{scenario_id}").json()["status"] == "accepted"

    # An author edit after accept returns the scenario to draft.
    detail = client.get(f"/api/ai/scenarios/{scenario_id}").json()
    sid = detail["steps"][0]["id"]
    patched = client.patch(
        f"/api/ai/scenarios/{scenario_id}",
        json={"steps": [{"id": sid, "spokenLine": "Edited after accept"}]},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["status"] == "draft"
    assert client.get(f"/api/ai/scenarios/{scenario_id}/canonical").status_code == 409

    # Re-accept, then regenerate: also back to draft with edits preserved.
    client.post(f"/api/ai/scenarios/{scenario_id}/accept")
    regen = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-7",
            "conversationId": conv["id"],
            "request": "Add more examples",
            "context": {},
            "scenarioId": scenario_id,
        },
    )
    assert regen.status_code == 200, regen.text
    assert regen.json()["status"] == "draft"
    assert any(s["spokenLine"] == "Edited after accept" for s in regen.json()["steps"])


def test_scenario_rejects_cross_project_conversation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_scenario(monkeypatch, SAMPLE_SCENARIO)

    _make_project(client, "p-scen-8")
    _make_project(client, "p-scen-9")
    conv8 = client.post("/api/ai/conversations", json={"projectId": "p-scen-8"}).json()
    r = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-9",
            "conversationId": conv8["id"],
            "request": "Draft it",
            "context": {},
        },
    )
    assert r.status_code == 422, r.text


def test_scenario_missing_key_and_unlisted_model_surface_in_conversation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_project(client, "p-scen-6")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-scen-6"}).json()

    r = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-6",
            "conversationId": conv["id"],
            "request": "Draft something",
            "context": {},
        },
    )
    assert r.status_code in (409, 502)
    assert r.json()["detail"]["code"] == "missing_key"
    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert msgs[-1]["role"] == "assistant"
    assert msgs[-1]["errorCode"] is not None

    _enable_key(client)
    _fake_models(monkeypatch, ["some/other-model"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    r2 = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-scen-6",
            "conversationId": conv["id"],
            "request": "Draft something",
            "context": {},
        },
    )
    assert r2.status_code in (409, 502)
    assert r2.json()["detail"]["code"] == "model_unlisted"
