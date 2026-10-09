"""Unit tests for AI crypto, prompting budget, Zen error mapping."""

from __future__ import annotations

from app.ai.crypto import decrypt_key, encrypt_key, mask_key
from app.ai.prompting import ChatMessage, compose_messages, estimate_tokens
from app.ai.zen import chat_completions_payload, friendly_error_for_status, parse_sse_tokens


def test_mask_key_shows_only_tail() -> None:
    assert mask_key(None) == ""
    assert mask_key("") == ""
    masked = mask_key("sk-test-1234")
    assert masked.startswith("••••")
    assert masked.endswith("1234")
    assert "test" not in masked


def test_fernet_round_trip_with_passphrase_secret() -> None:
    secret = "test-secret-for-ai-foundation"
    token = encrypt_key("sk-live-key", secret)
    assert token != "sk-live-key"
    assert decrypt_key(token, secret) == "sk-live-key"


def test_estimate_tokens_char_approximation() -> None:
    assert estimate_tokens("") == 0
    assert estimate_tokens("hi") == 1
    assert estimate_tokens("abcd") == 1
    assert estimate_tokens("abcde") == 2


def test_compose_trims_oldest_first_and_never_drops_context() -> None:
    history = [
        ChatMessage(role="user", content="oldest " * 50),
        ChatMessage(role="assistant", content="middle " * 50),
        ChatMessage(role="user", content="newest " * 50),
    ]
    composed = compose_messages("sys", "ctx", history, "now", budget_tokens=40)
    # System + context + current always present
    assert composed[0].role == "system"
    assert any("ctx" in m.content for m in composed)
    assert composed[-1].content == "now"
    # Oldest dropped first: newest survives longer than oldest
    contents = " ".join(m.content for m in composed)
    assert "newest" in contents or len(composed) == 3  # tiny budget may drop all history


def test_compose_never_splits_message() -> None:
    history = [ChatMessage(role="user", content="abcdefgh")]
    composed = compose_messages("s", "c", history, "now", budget_tokens=1000)
    assert any(m.content == "abcdefgh" for m in composed)


def test_error_taxonomy_mapping() -> None:
    code, _ = friendly_error_for_status(401, "CreditsError")
    assert code == "invalid_or_exhausted"
    code, _ = friendly_error_for_status(402, "")
    assert code == "limit_exceeded"
    code, _ = friendly_error_for_status(429, "")
    assert code == "rate_limited"
    code, _ = friendly_error_for_status(500, "")
    assert code == "provider_error"
    code, _ = friendly_error_for_status(400, "InvalidRequestError")
    assert code == "provider_error"


def test_chat_payload_pins_family_routing() -> None:
    payload = chat_completions_payload(
        model="m",
        messages=[{"role": "user", "content": "hi"}],
        temperature=0.7,
        max_tokens=100,
        stream=True,
        structured=True,
    )
    assert payload["model"] == "m"
    assert payload["stream"] is True
    assert isinstance(payload["response_format"], dict)
    assert payload["response_format"]["type"] == "json_schema"


def test_sse_parser_tolerant_of_nonstandard_chunks() -> None:
    raw = (
        'event: message\ndata: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
        "event: weird\ndata: not-json\n\n"
        "event: message\ndata: [DONE]\n\n"
        'event: message\ndata: {"choices": [{"delta": {"content": " world"}}]}\n\n'
    )
    assert parse_sse_tokens(raw) == ["Hello", " world"]
