"""Chat transport integration: success, regenerate, error taxonomy, model gate."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai.zen import ZenClient, ZenFetchError


def _enable_key(client: TestClient, key: str = "sk-test-key-1234") -> None:
    app_state: Any = client.app
    settings = app_state.state.settings
    settings.ai_secret_key = "test-secret-for-ai-foundation"
    r = client.put("/api/ai/settings", json={"apiKey": key})
    assert r.status_code == 200, r.text
    assert r.json()["hasKey"] is True
    assert r.json()["keyMasked"].endswith(key[-4:])
    assert key not in r.json()["keyMasked"]


def _fake_models(monkeypatch: pytest.MonkeyPatch, models: list[str]) -> None:
    def _list(self: ZenClient, http_client: Any = None) -> list[str]:
        _ = (self, http_client)
        return list(models)

    monkeypatch.setattr(ZenClient, "list_models", _list)


def _fake_stream(monkeypatch: pytest.MonkeyPatch, tokens: list[str]) -> None:
    def _stream(self: ZenClient, **kwargs: Any) -> Iterator[str]:
        _ = (self, kwargs)
        yield from tokens

    monkeypatch.setattr(ZenClient, "chat_stream", _stream)


def test_empty_key_save_keeps_existing(client: TestClient) -> None:
    _enable_key(client, "sk-test-key-9999")
    r = client.put("/api/ai/settings", json={"temperature": 0.5, "apiKey": ""})
    assert r.status_code == 200
    assert r.json()["hasKey"] is True
    assert r.json()["keyMasked"].endswith("9999")
    # Key never leaks in reads
    assert "sk-test" not in r.text


def test_chat_streams_tokens_and_persists_history(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_stream(monkeypatch, ["Hello", " world"])

    conv = client.post("/api/ai/conversations", json={"projectId": "p-1"}).json()
    r = client.post(
        "/api/ai/chat",
        json={"conversationId": conv["id"], "message": "Hi", "mode": "send", "context": {}},
    )
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    assert "event: start" in r.text
    assert "event: token" in r.text
    assert "event: done" in r.text
    assert "Hello" in r.text

    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["content"] == "Hello world"


def test_chat_regenerate_replaces_last_assistant_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_stream(monkeypatch, ["first"])

    conv = client.post("/api/ai/conversations", json={"projectId": "p-1"}).json()
    client.post(
        "/api/ai/chat",
        json={"conversationId": conv["id"], "message": "Q1", "mode": "send", "context": {}},
    )
    before = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert len(before) == 2
    first_id = before[1]["id"]

    _fake_stream(monkeypatch, ["second"])
    r = client.post(
        "/api/ai/chat",
        json={"conversationId": conv["id"], "mode": "regenerate", "context": {}},
    )
    assert r.status_code == 200
    after = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    # No new messages: user kept, assistant replaced in place
    assert len(after) == 2
    assert after[0]["role"] == "user"
    assert after[1]["id"] == first_id
    assert after[1]["content"] == "second"


def test_chat_unlisted_model_blocks_with_reselect(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["some/other-model"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})

    conv = client.post("/api/ai/conversations", json={"projectId": "p-1"}).json()
    r = client.post(
        "/api/ai/chat",
        json={"conversationId": conv["id"], "message": "Hi", "mode": "send", "context": {}},
    )
    assert r.status_code == 200
    assert "model_unlisted" in r.text or "reselect" in r.text.lower()
    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert msgs[-1]["errorCode"] == "model_unlisted"


def test_chat_provider_errors_map_and_preserve_history(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})

    def _fail_401(self: ZenClient, **kwargs: Any) -> Iterator[str]:
        _ = (self, kwargs)
        raise ZenFetchError(401, "CreditsError: insufficient balance")
        yield from ()

    monkeypatch.setattr(ZenClient, "chat_stream", _fail_401)

    conv = client.post("/api/ai/conversations", json={"projectId": "p-1"}).json()
    r = client.post(
        "/api/ai/chat",
        json={"conversationId": conv["id"], "message": "Hi", "mode": "send", "context": {}},
    )
    assert r.status_code == 200
    assert "invalid_or_exhausted" in r.text
    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert len(msgs) == 2  # history preserved
    assert msgs[-1]["errorCode"] == "invalid_or_exhausted"

    # 402 is distinct from 401
    def _fail_402(self: ZenClient, **kwargs: Any) -> Iterator[str]:
        _ = (self, kwargs)
        raise ZenFetchError(402, "CreditLimitExceeded")
        yield from ()

    monkeypatch.setattr(ZenClient, "chat_stream", _fail_402)
    r2 = client.post(
        "/api/ai/chat",
        json={"conversationId": conv["id"], "message": "again", "mode": "send", "context": {}},
    )
    assert "limit_exceeded" in r2.text
