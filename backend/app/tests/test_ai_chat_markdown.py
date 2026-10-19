"""Chat auto-apply for scenario versioned edits (issue #462, chat seam)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from fastapi.testclient import TestClient

from app.ai.zen import ZenClient


def _enable_key(client: TestClient) -> None:
    settings = client.app.state.settings  # type: ignore[attr-defined]
    settings.ai_secret_key = "test-secret-chat-md"
    r = client.put("/api/ai/settings", json={"apiKey": "sk-test-1234"})
    assert r.status_code == 200, r.text


def _fake_models(monkeypatch: Any, models: list[str]) -> None:
    def _list(self: ZenClient, http_client: Any = None) -> list[str]:
        _ = (self, http_client)
        return list(models)

    monkeypatch.setattr(ZenClient, "list_models", _list)


def _fake_stream(monkeypatch: Any, tokens: list[str]) -> None:
    def _stream(self: ZenClient, **kwargs: Any) -> Iterator[str]:
        _ = (self, kwargs)
        assert kwargs.get("session_id")
        yield from tokens

    monkeypatch.setattr(ZenClient, "chat_stream", _stream)


def _make_project(client: TestClient, pid: str) -> None:
    import json

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


def test_chat_edit_auto_applies_version(client: TestClient, monkeypatch: Any) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _make_project(client, "p-chat-md-1")
    conv = client.post(
        "/api/ai/conversations", json={"projectId": "p-chat-md-1", "mode": "scenario"}
    ).json()
    _fake_stream(
        monkeypatch,
        ["intent: edit\nSummary: Add intro\nTouched-steps: 1\n\n## Step 1 -- Hi\n\nHello."],
    )
    r = client.post(
        "/api/ai/chat",
        json={
            "conversationId": conv["id"],
            "message": "make an intro",
            "mode": "send",
            "context": {},
            "assistantMode": "scenario",
        },
    )
    assert r.status_code == 200, r.text
    assert "scenarioVersion" in r.text
    versions = client.get(
        "/api/ai/scenarios/markdown/versions", params={"projectId": "p-chat-md-1"}
    ).json()
    assert len(versions) == 1
    assert versions[0]["summary"] == "Add intro"
    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert msgs[-1]["scenarioIntent"] == "edit"
    assert msgs[-1]["scenarioVersionId"] == versions[0]["id"]


def test_chat_question_creates_no_version(client: TestClient, monkeypatch: Any) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _make_project(client, "p-chat-md-2")
    conv = client.post(
        "/api/ai/conversations", json={"projectId": "p-chat-md-2", "mode": "scenario"}
    ).json()
    _fake_stream(monkeypatch, ["intent: question-only\nWhat should step 1 be?"])
    r = client.post(
        "/api/ai/chat",
        json={
            "conversationId": conv["id"],
            "message": "ask: ideas?",
            "mode": "send",
            "context": {},
            "assistantMode": "scenario",
        },
    )
    assert r.status_code == 200, r.text
    versions = client.get(
        "/api/ai/scenarios/markdown/versions", params={"projectId": "p-chat-md-2"}
    ).json()
    assert versions == []
    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert msgs[-1]["scenarioIntent"] == "question-only"


def test_chat_prefix_override(client: TestClient, monkeypatch: Any) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _make_project(client, "p-chat-md-3")
    conv = client.post(
        "/api/ai/conversations", json={"projectId": "p-chat-md-3", "mode": "scenario"}
    ).json()
    # ask: prefix forces question-only even though the reply is labelled edit.
    _fake_stream(monkeypatch, ["intent: edit\nSummary: S\nTouched-steps: 1\n\n## Step 1 -- Hi"])
    client.post(
        "/api/ai/chat",
        json={
            "conversationId": conv["id"],
            "message": "ask: just thinking",
            "mode": "send",
            "context": {},
            "assistantMode": "scenario",
        },
    )
    versions = client.get(
        "/api/ai/scenarios/markdown/versions", params={"projectId": "p-chat-md-3"}
    ).json()
    assert versions == []
