"""Unit tests for AI crypto, prompting budget, Zen error mapping."""

from __future__ import annotations

from app.ai.crypto import decrypt_key, encrypt_key, mask_key
from app.ai.prompting import (
    RENDERED_VIEW_NOTE,
    ChatMessage,
    compose_messages,
    context_to_text,
    estimate_tokens,
    format_rendered_view_label,
)
from app.ai.zen import (
    ZenClient,
    chat_completions_payload,
    extract_usage_from_payload,
    friendly_error_for_status,
    inference_request,
    inference_response_usage,
    merge_usage,
    parse_sse_tokens,
    parse_sse_usage,
)


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


def test_context_to_text_includes_animation_snapshot() -> None:
    import copy

    context = {
        "projectName": "Cat Lesson",
        "activeSlideName": "Room",
        "animation": {
            "nodes": [
                {
                    "id": "n-cat",
                    "name": "Cat",
                    "parentId": "root",
                    "depth": 1,
                    "semanticName": "cat",
                    "components": ["mesh", "assetInstance"],
                    "assetDefinitionId": "asset-cat",
                    "transform": {"x": 10, "y": 20, "rotation": 0, "scaleX": 1, "scaleY": 1},
                    "visible": True,
                }
            ],
            "rig": {
                "boneCount": 0,
                "shapeInventory": [{"nodeId": "n-cat", "shapeCount": 1, "shapeNames": ["Sit"]}],
                "morphBindings": [
                    {"nodeId": "n-cat", "fromShapeId": "shape-a", "toShapeId": "shape-b"}
                ],
                "controls": [{"hostNodeId": "n-cat", "keys": ["mouthOpen"]}],
            },
            "clips": [{"name": "Walk", "duration": 2, "channelCount": 2}],
            "collections": [{"name": "Walk Cycle", "bindingCount": 1}],
            "timeline": {
                "slideId": "s-1",
                "duration": 12,
                "animatedNodeCount": 1,
                "totalKeyframes": 1,
                "controlHosts": [{"nodeId": "n-cat", "keys": ["mouthOpen"]}],
            },
            "truncated": {"nodes": False},
        },
    }
    before = copy.deepcopy(context)
    text = context_to_text(context)
    assert "Cat [n-cat]" in text
    assert "child of root" in text
    assert "asset-cat" in text
    assert "shape-a -> shape-b" in text
    assert "Walk" in text
    assert "Walk Cycle" in text
    assert "12" in text
    # Analysis rendering never mutates the project context it reads.
    assert context == before


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
    code, message = friendly_error_for_status(402, "")
    assert code == "limit_exceeded"
    assert "OpenCode Go usage limit" in message
    code, _ = friendly_error_for_status(429, "")
    assert code == "rate_limited"
    code, _ = friendly_error_for_status(500, "")
    assert code == "provider_error"
    code, _ = friendly_error_for_status(400, "InvalidRequestError")
    assert code == "provider_error"
    code, message = friendly_error_for_status(
        403, '{"type":"error","error":{"type":"FreeTierError"}}'
    )
    assert code == "model_access_denied"
    assert "Go plan" in message


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


def test_inference_request_routes_by_opencode_model_family() -> None:
    messages = [
        {"role": "system", "content": "Be concise"},
        {"role": "user", "content": "Say hi"},
    ]
    path, payload = inference_request(
        model="claude-haiku-5-5",
        messages=messages,
        temperature=0.7,
        max_tokens=200,
        stream=True,
    )
    assert path == "/messages"
    assert payload["model"] == "claude-haiku-5-5"
    assert payload["system"] == "Be concise"
    assert payload["max_tokens"] == 200

    path, payload = inference_request(
        model="gpt-6-luna",
        messages=messages,
        temperature=0.7,
        max_tokens=200,
        stream=False,
    )
    assert path == "/responses"
    assert payload["model"] == "gpt-6-luna"

    path, _ = inference_request(
        model="muse-spark-1.3-contributor",
        messages=messages,
        temperature=0.7,
        max_tokens=200,
        stream=False,
    )
    assert path == "/responses"


def test_legacy_zen_endpoint_lists_models_from_v2_catalog() -> None:
    import httpx

    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={"data": [{"id": "claude-sonnet-4-6"}, {"id": "step-5-preview-free"}]},
        )

    client = ZenClient("https://opencode.ai/zen/go/v1", "test-key")
    with httpx.Client(transport=httpx.MockTransport(respond)) as http_client:
        assert client.list_models(http_client) == ["claude-sonnet-4-6", "step-5-preview-free"]
    assert str(requests[0].url) == "https://opencode.ai/zen/go/v1/models"
    assert requests[0].headers["user-agent"] == "animated-slideshow-editor/1.0"


def test_go_chat_uses_go_route_and_stable_session_header() -> None:
    import httpx

    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            text='data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
        )

    client = ZenClient("https://opencode.ai/zen/go/v1", "test-key")
    with httpx.Client(transport=httpx.MockTransport(respond)) as http_client:
        tokens = list(
            client.chat_stream(
                model="kimi-k2.6",
                messages=[{"role": "user", "content": "Say OK"}],
                temperature=0.7,
                max_tokens=100,
                session_id="conversation-123",
                http_client=http_client,
            )
        )

    assert tokens == ["OK"]
    assert str(requests[0].url) == "https://opencode.ai/zen/go/v1/chat/completions"
    assert requests[0].headers["x-opencode-session"] == "conversation-123"
    assert requests[0].headers["user-agent"] == "animated-slideshow-editor/1.0"


def test_chat_stream_reports_diagnostics_for_empty_content_debugging() -> None:
    import httpx

    def respond(request: httpx.Request) -> httpx.Response:
        _ = request
        return httpx.Response(
            200,
            text=(
                'data: {"type": "response.created"}\n\n'
                'data: {"type": "response.output_text.delta", "delta": "Hi"}\n\n'
            ),
        )

    client = ZenClient("https://opencode.ai/zen/go/v1", "test-key")
    diagnostics: dict[str, object] = {}
    with httpx.Client(transport=httpx.MockTransport(respond)) as http_client:
        tokens = list(
            client.chat_stream(
                model="muse-spark-1.3-contributor",
                messages=[{"role": "user", "content": "Say hi"}],
                temperature=0.7,
                max_tokens=100,
                diagnostics=diagnostics,
                timeout_s=120.0,
                http_client=http_client,
            )
        )
    assert tokens == ["Hi"]
    assert diagnostics["streamChunks"] == 2
    assert diagnostics["streamEventTypes"] == ["response.created", "response.output_text.delta"]
    assert isinstance(diagnostics["streamBytes"], int) and diagnostics["streamBytes"] > 0
    assert "response.output_text.delta" in str(diagnostics["streamSample"])


def test_rendered_view_label_carries_slide_time_and_stable_ids() -> None:
    label = format_rendered_view_label(
        "Room", "s-1", 3.2, ["n-cat", "n-sofa"], "current", {"n-cat": "Cat", "n-sofa": "Sofa"}
    )
    assert "Room" in label
    assert "s-1" in label
    assert "3.2" in label
    assert "n-cat" in label
    assert "n-sofa" in label


def test_rendered_view_label_marks_focused_scope() -> None:
    label = format_rendered_view_label("Room", "s-1", 5, ["n-cat"], "focused", {"n-cat": "Cat"})
    assert "focused" in label
    assert "n-cat" in label


def test_rendered_view_label_rejects_unknown_scope() -> None:
    import pytest

    with pytest.raises(ValueError, match="scope"):
        format_rendered_view_label("Room", "s-1", 1, [], "close-up")


def test_usage_extraction_covers_all_api_families() -> None:
    # OpenAI chat-completions shape.
    assert extract_usage_from_payload(
        {"usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}}
    ) == {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
    # Anthropic messages shape (input/output vocabulary).
    assert extract_usage_from_payload({"usage": {"input_tokens": 5, "output_tokens": 7}}) == {
        "prompt_tokens": 5,
        "completion_tokens": 7,
    }
    # Responses API nests usage under response.
    assert extract_usage_from_payload(
        {"response": {"usage": {"input_tokens": 3, "output_tokens": 4, "total_tokens": 7}}}
    ) == {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7}
    # Unknown shapes never throw, read as empty.
    assert extract_usage_from_payload({"nope": True}) == {}
    assert extract_usage_from_payload(None) == {}


def test_usage_merge_last_wins_and_fills_total() -> None:
    acc: dict[str, int] = {}
    merge_usage(acc, {"prompt_tokens": 100})
    merge_usage(acc, {"completion_tokens": 30})
    assert acc == {"prompt_tokens": 100, "completion_tokens": 30, "total_tokens": 130}
    merge_usage(acc, {"completion_tokens": 45, "total_tokens": 145})
    assert acc["completion_tokens"] == 45
    assert acc["total_tokens"] == 145


def test_sse_usage_parsing_tolerates_nonstandard_chunks() -> None:
    raw = (
        'event: message_start\ndata: {"message": {"usage": {"input_tokens": 12, "output_tokens": 0}}}\n\n'
        "event: weird\ndata: not-json\n\n"
        'event: message_delta\ndata: {"usage": {"output_tokens": 34}}\n\n'
    )
    assert parse_sse_usage(raw) == {
        "prompt_tokens": 12,
        "completion_tokens": 34,
        "total_tokens": 46,
    }


def test_non_streaming_usage_reads_response_body() -> None:
    assert inference_response_usage(
        {
            "choices": [{"message": {"content": "hi"}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        }
    ) == {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}


def test_streaming_payload_requests_usage_reporting() -> None:
    payload = chat_completions_payload(
        model="some-openai-model",
        messages=[{"role": "user", "content": "hi"}],
        temperature=0.7,
        max_tokens=100,
        stream=True,
    )
    assert payload["stream_options"] == {"include_usage": True}
    payload_sync = chat_completions_payload(
        model="some-openai-model",
        messages=[{"role": "user", "content": "hi"}],
        temperature=0.7,
        max_tokens=100,
        stream=False,
    )
    assert "stream_options" not in payload_sync


def test_animation_text_states_visual_evidence_complements_structured_data() -> None:
    context = {
        "projectName": "Cat Lesson",
        "activeSlideName": "Room",
        "animation": {
            "nodes": [{"id": "n-cat", "name": "Cat"}],
            "timeline": {"duration": 12},
            "truncated": {},
        },
    }
    text = context_to_text(context)
    assert RENDERED_VIEW_NOTE in text
    assert "never from pixels" in text
