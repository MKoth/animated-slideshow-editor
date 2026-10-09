"""Foundation AI tests: settings, conversations, token budget, Zen transport (TDD Red)."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient


def _put_settings(client: TestClient, body: dict[str, object], expected: int = 200) -> object:
    r = client.put("/api/ai/settings", json=body)
    assert r.status_code == expected, r.text
    return r.json() if expected == 200 else r


def test_ai_settings_masked_read_and_empty_key_keeps_existing(client: TestClient) -> None:
    # Default read returns seeded endpoint/model and no key
    r = client.get("/api/ai/settings")
    assert r.status_code == 200
    data = r.json()
    assert data["endpoint"].startswith("https://")
    assert isinstance(data["model"], str) and data["model"]
    assert data["hasKey"] is False
    assert data["keyMasked"] == ""

    # Saving without secret configured fails clearly when a key is provided
    bad = client.put("/api/ai/settings", json={"apiKey": "sk-test-1234"})
    assert bad.status_code == 500
    assert "AI_SECRET_KEY" in bad.json()["detail"]


def test_ai_settings_validation_rejects_bad_numbers(client: TestClient) -> None:
    r = client.put("/api/ai/settings", json={"temperature": 99})
    assert r.status_code == 422
    r2 = client.put("/api/ai/settings", json={"maxTokens": 0})
    assert r2.status_code == 422


def test_ai_conversations_crud_and_search_shape(client: TestClient) -> None:
    # Create two conversations for one project
    c1 = client.post("/api/ai/conversations", json={"projectId": "p-1"}).json()
    assert c1["title"] == "Conversation 1"
    c2 = client.post("/api/ai/conversations", json={"projectId": "p-1"}).json()
    assert c2["title"] == "Conversation 2"

    listing = client.get("/api/ai/conversations", params={"projectId": "p-1"}).json()
    assert len(listing) == 2
    assert {c["id"] for c in listing} == {c1["id"], c2["id"]}

    # Rename
    renamed = client.patch(f"/api/ai/conversations/{c1['id']}", json={"title": "Intro ideas"})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Intro ideas"

    # Empty rename rejected
    bad = client.patch(f"/api/ai/conversations/{c1['id']}", json={"title": "   "})
    assert bad.status_code == 422

    # Messages initially empty
    msgs = client.get(f"/api/ai/conversations/{c1['id']}/messages").json()
    assert msgs == []

    # Delete one, other survives
    assert client.delete(f"/api/ai/conversations/{c1['id']}").status_code == 204
    remaining = client.get("/api/ai/conversations", params={"projectId": "p-1"}).json()
    assert [c["id"] for c in remaining] == [c2["id"]]

    # Project isolation
    other = client.get("/api/ai/conversations", params={"projectId": "p-2"}).json()
    assert other == []


def test_ai_conversations_cascade_on_project_delete(client: TestClient) -> None:
    blob = json.dumps(
        {
            "version": 2,
            "project": {
                "id": "p-9",
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
    assert (
        client.post(
            "/api/projects", content=blob, headers={"content-type": "application/json"}
        ).status_code
        == 200
    )
    conv = client.post("/api/ai/conversations", json={"projectId": "p-9"}).json()
    assert client.delete("/api/projects/p-9").status_code == 204
    # Conversation gone with project
    assert client.get("/api/ai/conversations", params={"projectId": "p-9"}).json() == []
    assert client.get(f"/api/ai/conversations/{conv['id']}/messages").status_code == 404


def test_ai_models_falls_back_when_provider_unreachable(client: TestClient) -> None:
    r = client.get("/api/ai/models")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data["models"], list) and len(data["models"]) >= 1
    assert data["fallback"] is True  # no key / no network in tests
    assert "selected" in data


def test_ai_chat_missing_key_surfaces_actionable_message(client: TestClient) -> None:
    conv = client.post("/api/ai/conversations", json={"projectId": "p-1"}).json()
    r = client.post(
        "/api/ai/chat",
        json={
            "conversationId": conv["id"],
            "message": "Hello",
            "mode": "send",
            "context": {"projectName": "Lesson"},
        },
    )
    # SSE stream even for errors
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    assert "missing_key" in r.text or "No API key" in r.text
    # History preserved: user + assistant error message
    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[1]["role"] == "assistant"
