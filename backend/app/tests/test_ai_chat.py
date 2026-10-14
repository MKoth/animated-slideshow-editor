"""Chat transport integration: success, regenerate, error taxonomy, model gate."""

from __future__ import annotations

import json
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
        assert kwargs.get("session_id")
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


def test_chat_persists_real_provider_usage(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})

    def _stream_with_usage(self: ZenClient, **kwargs: Any) -> Iterator[str]:
        usage = kwargs.get("usage")
        assert isinstance(usage, dict)
        usage.update({"prompt_tokens": 11, "completion_tokens": 22, "total_tokens": 33})
        yield "Hi"

    monkeypatch.setattr(ZenClient, "chat_stream", _stream_with_usage)

    conv = client.post("/api/ai/conversations", json={"projectId": "p-1"}).json()
    r = client.post(
        "/api/ai/chat",
        json={"conversationId": conv["id"], "message": "Hi", "mode": "send", "context": {}},
    )
    assert r.status_code == 200
    assert '"usage"' in r.text

    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert msgs[1]["promptTokens"] == 11
    assert msgs[1]["completionTokens"] == 22
    assert msgs[1]["totalTokens"] == 33
    # User messages carry no usage.
    assert msgs[0].get("promptTokens") is None


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


def test_chat_truncated_stream_says_raise_max_tokens(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, settings: Any
) -> None:
    """An incomplete responses stream must not masquerade as a provider error."""
    _enable_key(client)
    _fake_models(monkeypatch, ["muse-spark-1.3-contributor"])
    client.put("/api/ai/settings", json={"model": "muse-spark-1.3-contributor"})

    def _stream_incomplete(self: ZenClient, **kwargs: Any) -> Iterator[str]:
        _ = self
        diagnostics = kwargs.get("diagnostics")
        assert isinstance(diagnostics, dict)
        diagnostics.update(
            {
                "streamBytes": 1974,
                "streamChunks": 4,
                "streamEventTypes": [
                    "response.created",
                    "response.in_progress",
                    "response.incomplete",
                ],
                "streamSample": 'data: {"type":"response.incomplete"}\n\n',
            }
        )
        yield from ()

    monkeypatch.setattr(ZenClient, "chat_stream", _stream_incomplete)

    conv = client.post("/api/ai/conversations", json={"projectId": "p-1"}).json()
    r = client.post(
        "/api/ai/chat",
        json={"conversationId": conv["id"], "message": "Hi", "mode": "send", "context": {}},
    )
    assert r.status_code == 200
    assert "response_truncated" in r.text
    assert "Max tokens" in r.text
    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assert msgs[-1]["errorCode"] == "response_truncated"

    log_file = settings.data_dir / "ai_provider_failures.jsonl"
    event = json.loads(log_file.read_text(encoding="utf-8").splitlines()[-1])
    assert event["code"] == "response_truncated"
    assert event["extra"]["truncated"] is True


def test_chat_injects_linked_histories_from_other_modes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cross-agent visibility: an audio chat sees the scenario conversation transcript."""
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    seen: dict[str, Any] = {}

    def _stream(self: ZenClient, **kwargs: Any) -> Iterator[str]:
        seen["messages"] = kwargs.get("messages")
        yield "ok"

    monkeypatch.setattr(ZenClient, "chat_stream", _stream)

    scenario = client.post(
        "/api/ai/conversations", json={"projectId": "p-1", "mode": "scenario"}
    ).json()
    assert scenario["mode"] == "scenario"
    audio = client.post(
        "/api/ai/conversations", json={"projectId": "p-1", "mode": "audio"}
    ).json()
    client.post(
        "/api/ai/chat",
        json={"conversationId": scenario["id"], "message": "teach cats", "mode": "send", "context": {}},
    )
    r = client.post(
        "/api/ai/chat",
        json={
            "conversationId": audio["id"],
            "message": "speak now",
            "mode": "send",
            "context": {},
            "assistantMode": "audio",
        },
    )
    assert r.status_code == 200
    joined = "\n".join(str(m.get("content", "")) for m in seen["messages"])
    assert "teach cats" in joined
    assert "scenario conversation" in joined
    assert "read-only linked context" in joined
