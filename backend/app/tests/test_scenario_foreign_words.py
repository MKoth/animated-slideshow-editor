"""Foreign-word detection for narrator HTML highlighting (LLM-backed)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api import scenario_routes


def _enable_key(client: TestClient, key: str = "sk-test-key-1234") -> None:
    app_state: Any = client.app
    settings = app_state.state.settings
    settings.ai_secret_key = "test-secret-for-foreign-words"
    r = client.put("/api/ai/settings", json={"apiKey": key})
    assert r.status_code == 200, r.text


def _fake_detector(monkeypatch: pytest.MonkeyPatch, words: list[str]) -> None:
    def _detect(**kwargs: Any) -> list[str]:
        _ = kwargs
        return list(words)

    monkeypatch.setattr(scenario_routes, "detect_scenario_foreign_words", _detect)


def _make_conversation(client: TestClient, project_id: str = "p-fw-1") -> str:
    conv = client.post("/api/ai/conversations", json={"projectId": project_id}).json()
    return str(conv["id"])


def test_prompt_builder_asks_for_verbatim_json_list() -> None:
    messages = scenario_routes.build_foreign_words_messages("Ser is for who you are.")
    assert len(messages) == 2
    assert "JSON" in messages[0]["content"]
    assert "embedded" in messages[0]["content"]
    assert "Ser is for who you are." in messages[1]["content"]
    assert "Example" in messages[1]["content"]
    # Long inputs are capped so one call stays cheap.
    long_text = "x" * 20000
    assert len(scenario_routes.build_foreign_words_messages(long_text)[1]["content"]) < 12000


def test_parse_accepts_object_array_and_noisy_output() -> None:
    assert scenario_routes.parse_foreign_words_content('{"words": ["soy", "la casa"]}') == [
        "soy",
        "la casa",
    ]
    assert scenario_routes.parse_foreign_words_content('["uno", "dos"]') == ["uno", "dos"]
    assert scenario_routes.parse_foreign_words_content(
        'Here you go:\n{"words": ["árbol"]}\nDone.'
    ) == ["árbol"]
    assert scenario_routes.parse_foreign_words_content("no json here") == ["no json here"]
    assert scenario_routes.parse_foreign_words_content("") == []
    assert scenario_routes.parse_foreign_words_content(None) == []
    # Entries are whitespace-collapsed and deduped.
    assert scenario_routes.parse_foreign_words_content('{"words": ["  a  b  ", "x", 42, "x"]}') == [
        "a b",
        "x",
    ]
    # A string payload is salvaged as a bare list instead of dropped.
    assert scenario_routes.parse_foreign_words_content('{"words": "soy"}') == ["soy"]
    assert scenario_routes.parse_foreign_words_content('{"words": "soy, hola"}') == [
        "soy",
        "hola",
    ]
    # Markdown bold markers and quotes are stripped, not kept literally.
    assert scenario_routes.parse_foreign_words_content('{"words": ["**soy**", "\\"hola\\""]}') == [
        "soy",
        "hola",
    ]
    # Fenced JSON, alias keys, and object entries are salvaged.
    assert scenario_routes.parse_foreign_words_content(
        '```json\n{"words": ["soy", "estar"]}\n```'
    ) == ["soy", "estar"]
    assert scenario_routes.parse_foreign_words_content('{"foreign_words": ["soy"]}') == ["soy"]
    assert scenario_routes.parse_foreign_words_content('{"words": [{"word": "soy"}]}') == ["soy"]
    # Trailing glosses are stripped to the vocabulary head.
    assert scenario_routes.parse_foreign_words_content('{"words": ["soy (I am)"]}') == ["soy"]
    assert scenario_routes.parse_foreign_words_content('{"words": ["soy — I am"]}') == ["soy"]


def test_parse_reads_bare_word_lists() -> None:
    assert scenario_routes.parse_foreign_words_content("ser\nestar\nárbol") == [
        "ser",
        "estar",
        "árbol",
    ]
    assert scenario_routes.parse_foreign_words_content("ser, estar, árbol de roble") == [
        "ser",
        "estar",
        "árbol de roble",
    ]
    assert scenario_routes.parse_foreign_words_content(
        "Here are the words:\n- ser\n- estar\n1. árbol\n* `duradero`"
    ) == ["ser", "estar", "árbol", "duradero"]
    # Full sentences and junk never become entries.
    out = scenario_routes.parse_foreign_words_content("42\n---\n!!!\nsoy")
    assert out == ["soy"]


def test_foreign_words_round_trip(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_key(client)
    conv_id = _make_conversation(client)
    _fake_detector(monkeypatch, ["árbol", "de roble"])
    r = client.post(
        "/api/ai/scenarios/markdown/foreign-words",
        json={
            "projectId": "p-fw-1",
            "conversationId": conv_id,
            "text": "In Spanish you call it árbol de roble.",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"words": ["árbol", "de roble"]}


def test_foreign_words_rejects_bad_input(client: TestClient) -> None:
    _enable_key(client)
    conv_id = _make_conversation(client)
    # Empty text fails validation.
    r = client.post(
        "/api/ai/scenarios/markdown/foreign-words",
        json={"projectId": "p-fw-1", "conversationId": conv_id, "text": ""},
    )
    assert r.status_code == 422
    # Conversation from another project is rejected.
    other = _make_conversation(client, "p-fw-other")
    r = client.post(
        "/api/ai/scenarios/markdown/foreign-words",
        json={"projectId": "p-fw-1", "conversationId": other, "text": "Hola mundo."},
    )
    assert r.status_code == 422


def test_foreign_words_needs_key(client: TestClient) -> None:
    conv_id = _make_conversation(client)
    r = client.post(
        "/api/ai/scenarios/markdown/foreign-words",
        json={"projectId": "p-fw-1", "conversationId": conv_id, "text": "Hola mundo."},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "missing_key"


def test_foreign_words_provider_failure_reads_502(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.ai.zen import ZenFetchError

    _enable_key(client)
    conv_id = _make_conversation(client)

    def _boom(**kwargs: Any) -> list[str]:
        _ = kwargs
        raise ZenFetchError(500, "provider exploded")

    monkeypatch.setattr(scenario_routes, "detect_scenario_foreign_words", _boom)
    r = client.post(
        "/api/ai/scenarios/markdown/foreign-words",
        json={"projectId": "p-fw-1", "conversationId": conv_id, "text": "Hola mundo."},
    )
    assert r.status_code == 502


def test_structured_rejection_retries_plain_completion(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.ai.zen import ZenFetchError

    calls: list[dict[str, Any]] = []

    def _post(**kwargs: Any) -> str:
        calls.append(dict(kwargs))
        if kwargs["structured"]:
            raise ZenFetchError(400, "response_format not supported")
        return 'Some prose {"words": ["hola", "mundo"]} trailing prose'

    monkeypatch.setattr(scenario_routes, "_post_foreign_words_once", _post)
    words = scenario_routes.detect_scenario_foreign_words(
        endpoint="https://example.test",
        api_key="k",
        model="m",
        text="Hola mundo.",
        session_id="s",
        temperature=0.7,
        max_tokens=800,
    )
    assert words == ["hola", "mundo"]
    assert [call["structured"] for call in calls] == [True, False]
    assert calls[0]["temperature"] == 0.7
    assert calls[0]["max_tokens"] == 800


def test_non_400_errors_do_not_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.ai.zen import ZenFetchError

    calls: list[dict[str, Any]] = []

    def _post(**kwargs: Any) -> str:
        calls.append(dict(kwargs))
        raise ZenFetchError(500, "provider exploded")

    monkeypatch.setattr(scenario_routes, "_post_foreign_words_once", _post)
    try:
        scenario_routes.detect_scenario_foreign_words(
            endpoint="https://example.test",
            api_key="k",
            model="m",
            text="Hola mundo.",
            session_id="s",
            temperature=0.7,
            max_tokens=800,
        )
    except ZenFetchError as exc:
        assert exc.status == 500
    else:
        raise AssertionError("expected ZenFetchError")
    assert len(calls) == 1


def _fake_httpx_post(monkeypatch: pytest.MonkeyPatch, response: Any) -> None:
    import httpx

    def _post(*args: Any, **kwargs: Any) -> Any:
        _ = (args, kwargs)
        return response

    monkeypatch.setattr(httpx, "post", _post)


def test_empty_provider_content_yields_no_words_instead_of_502(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    _fake_httpx_post(monkeypatch, httpx.Response(200, json={"content": [{"text": ""}]}))
    words = scenario_routes.detect_scenario_foreign_words(
        endpoint="https://example.test",
        api_key="k",
        model="m",
        text="Hola mundo.",
        session_id="s",
        temperature=0.7,
        max_tokens=800,
    )
    assert words == []


def test_non_json_200_body_is_salvaged_for_bracket_spans(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    _fake_httpx_post(
        monkeypatch, httpx.Response(200, content=b'Here you go:\n["hola", "mundo"]\nDone.')
    )
    words = scenario_routes.detect_scenario_foreign_words(
        endpoint="https://example.test",
        api_key="k",
        model="m",
        text="Hola mundo.",
        session_id="s",
        temperature=0.7,
        max_tokens=800,
    )
    assert words == ["hola", "mundo"]


def test_provider_error_message_carries_status_and_snippet(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.ai.zen import ZenFetchError

    _enable_key(client)
    conv_id = _make_conversation(client)

    def _boom(**kwargs: Any) -> list[str]:
        _ = kwargs
        raise ZenFetchError(500, '{"error": {"message": "model overloaded"}}')

    monkeypatch.setattr(scenario_routes, "detect_scenario_foreign_words", _boom)
    r = client.post(
        "/api/ai/scenarios/markdown/foreign-words",
        json={"projectId": "p-fw-1", "conversationId": conv_id, "text": "Hola mundo."},
    )
    assert r.status_code == 502
    detail = r.json()["detail"]
    assert "500" in detail["message"]
    assert "model overloaded" in detail["message"]


def test_response_text_reads_responses_envelopes() -> None:
    # Responses-family top-level output_text convenience field.
    assert (
        scenario_routes._inference_response_text({"output_text": '{"words": ["soy"]}'})
        == '{"words": ["soy"]}'
    )
    # Responses output items carrying output_text parts.
    assert (
        scenario_routes._inference_response_text(
            {
                "output": [
                    {"type": "reasoning", "content": []},
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"words": ["soy"]}'}],
                    },
                ]
            }
        )
        == '{"words": ["soy"]}'
    )
    # Direct output_text items.
    assert (
        scenario_routes._inference_response_text(
            {"output": [{"type": "output_text", "text": "hola"}]}
        )
        == "hola"
    )


def test_empty_structured_parse_retries_plain_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    def _post(**kwargs: Any) -> str:
        calls.append(dict(kwargs))
        if kwargs["structured"]:
            return '{"words": []}'
        return '{"words": ["soy", "estar"]}'

    monkeypatch.setattr(scenario_routes, "_post_foreign_words_once", _post)
    words = scenario_routes.detect_scenario_foreign_words(
        endpoint="https://example.test",
        api_key="k",
        model="m",
        text="Soy de Texas, estoy cansado.",
        session_id="s",
        temperature=0.7,
        max_tokens=800,
    )
    assert words == ["soy", "estar"]
    assert [call["structured"] for call in calls] == [True, False]


def test_empty_structured_response_retries_plain_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    def _post(**kwargs: Any) -> str:
        calls.append(dict(kwargs))
        return "" if kwargs["structured"] else '{"words": ["hola"]}'

    monkeypatch.setattr(scenario_routes, "_post_foreign_words_once", _post)
    words = scenario_routes.detect_scenario_foreign_words(
        endpoint="https://example.test",
        api_key="k",
        model="m",
        text="Hola mundo.",
        session_id="s",
        temperature=0.7,
        max_tokens=800,
    )

    assert words == ["hola"]
    assert [call["structured"] for call in calls] == [True, False]


def test_incomplete_reasoning_response_gets_one_larger_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []
    incomplete = '{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}'

    def _post(**kwargs: Any) -> str:
        calls.append(dict(kwargs))
        if kwargs["max_tokens"] < 16000:
            return incomplete
        return '{"words": ["hola"]}'

    monkeypatch.setattr(scenario_routes, "_post_foreign_words_once", _post)
    words = scenario_routes.detect_scenario_foreign_words(
        endpoint="https://example.test",
        api_key="k",
        model="muse-spark-1.3-contributor",
        text="Hola mundo.",
        session_id="s",
        temperature=0.7,
        max_tokens=4000,
    )

    assert words == ["hola"]
    assert [(call["structured"], call["max_tokens"]) for call in calls] == [
        (True, 4000),
        (False, 4000),
        (False, 16000),
    ]


def test_genuinely_empty_plain_parse_does_not_loop_forever(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    def _post(**kwargs: Any) -> str:
        calls.append(dict(kwargs))
        return '{"words": []}'

    monkeypatch.setattr(scenario_routes, "_post_foreign_words_once", _post)
    words = scenario_routes.detect_scenario_foreign_words(
        endpoint="https://example.test",
        api_key="k",
        model="m",
        text="Hello world.",
        session_id="s",
        temperature=0.7,
        max_tokens=800,
    )
    assert words == []
    # One structured attempt plus one plain retry, then accept empty.
    assert [call["structured"] for call in calls] == [True, False]


def test_unfamiliar_envelope_falls_back_to_raw_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    # The extractor knows no "weird" key, but the raw JSON body still carries
    # the array — the [...] span scan must salvage it instead of [].
    _fake_httpx_post(monkeypatch, httpx.Response(200, json={"weird": ["soy", "hola"]}))
    words = scenario_routes.detect_scenario_foreign_words(
        endpoint="https://example.test",
        api_key="k",
        model="m",
        text="Soy aquí, hola.",
        session_id="s",
        temperature=0.7,
        max_tokens=800,
    )
    assert words == ["soy", "hola"]


def test_protocol_residue_never_becomes_highlights() -> None:
    # Shredded API-body fragments must read as no words, not garbage entries.
    assert (
        scenario_routes.parse_foreign_words_content(
            '"object":"response", "created_at":1792582592, "status":"incomplete"'
        )
        == []
    )
    assert (
        scenario_routes.parse_foreign_words_content(
            '{\n"object": "response",\n"status": "incomplete"\n}'
        )
        == []
    )


def test_incomplete_response_reads_as_empty_without_garbage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    # Reasoning model starved by the output cap: status incomplete, reasoning
    # items only, no message text. Must be [] — never shredded body keys.
    _fake_httpx_post(
        monkeypatch,
        httpx.Response(
            200,
            json={
                "object": "response",
                "status": "incomplete",
                "model": "muse-spark-1.3-contributor",
                "max_output_tokens": 800,
                "output": [{"type": "reasoning", "id": "rs_1"}],
                "output_text": "",
                "usage": {"output_tokens": 800, "total_tokens": 1524},
            },
        ),
    )
    words = scenario_routes.detect_scenario_foreign_words(
        endpoint="https://example.test",
        api_key="k",
        model="muse-spark-1.3-contributor",
        text="Soy de Texas, estoy cansado.",
        session_id="s",
        temperature=0.7,
        max_tokens=800,
    )
    assert words == []


def test_endpoint_guarantees_reasoning_budget(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, Any] = {}

    def _detect(**kwargs: Any) -> list[str]:
        captured.update(kwargs)
        return ["soy"]

    _enable_key(client)
    conv_id = _make_conversation(client)
    monkeypatch.setattr(scenario_routes, "detect_scenario_foreign_words", _detect)
    r = client.post(
        "/api/ai/scenarios/markdown/foreign-words",
        json={
            "projectId": "p-fw-1",
            "conversationId": conv_id,
            "text": "Soy de Texas.",
        },
    )
    assert r.status_code == 200, r.text
    # Default row max_tokens is 8000 → ceiling 4000 headroom for thinking.
    assert captured["max_tokens"] == 4000
