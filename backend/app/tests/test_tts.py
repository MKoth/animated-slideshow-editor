import asyncio
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient


def test_tts_generate_returns_wav_and_uses_prompt(client: TestClient) -> None:
    # Create a prompt
    r = client.post("/api/voice-prompts", json={"title": "Warm", "instruction": "warmly"})
    pid = r.json()["id"]
    # Generate with prompt
    resp = client.post(
        "/api/tts/generate",
        json={"text": "Hello world", "promptId": pid, "language": "en", "voice": "nova"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("audio/wav")
    assert len(resp.content) > 44  # wav header + data
    # Check wav header
    assert resp.content[:4] == b"RIFF"
    # Generate without prompt and with overrides
    resp2 = client.post(
        "/api/tts/generate", json={"text": "Hello without prompt", "language": "es"}
    )
    assert resp2.status_code == 200
    assert resp2.content[:4] == b"RIFF"


def test_tts_generate_validation(client: TestClient) -> None:
    # Empty text
    r = client.post("/api/tts/generate", json={"text": "   "})
    assert r.status_code == 422
    # Missing text field
    r2 = client.post("/api/tts/generate", json={})
    assert r2.status_code == 422
    # Bad prompt id
    r3 = client.post("/api/tts/generate", json={"text": "hi", "promptId": "does-not-exist"})
    assert r3.status_code == 404


def test_tts_model_download_rejects_unknown_model(client: TestClient) -> None:
    r = client.post("/api/tts/models/download", json={"modelId": "unknown/model"})
    assert r.status_code == 422
    r2 = client.post("/api/tts/models/download", json={"modelId": ""})
    assert r2.status_code == 422


def test_tts_settings_saved_choice_survives_restart(
    client: TestClient, settings: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    r = client.put(
        "/api/tts/settings",
        json={"provider": "sine", "modelId": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["provider"] == "sine"
    assert r.json()["modelId"] == "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16"

    got = client.get("/api/tts/settings")
    assert got.status_code == 200
    assert got.json()["provider"] == "sine"
    assert got.json()["modelId"] == "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16"

    # Simulate a backend restart: fresh load_settings() from the same data
    # dir must pick up the UI-saved choice, not the env/default values.
    from app.config import load_settings

    monkeypatch.setenv("DATA_DIR", str(settings.data_dir))
    monkeypatch.delenv("TTS_PROVIDER", raising=False)
    monkeypatch.delenv("TTS_MODEL_ID", raising=False)
    reloaded = load_settings()
    assert reloaded.tts_provider == "sine"
    assert reloaded.tts_model_id == "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16"


def test_tts_settings_file_tolerates_missing_and_corrupt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import _load_tts_settings_file, load_settings, save_tts_settings

    assert _load_tts_settings_file(tmp_path) == {}

    (tmp_path / "tts_settings.json").write_text("not json{", encoding="utf-8")
    assert _load_tts_settings_file(tmp_path) == {}

    (tmp_path / "tts_settings.json").write_text("[1, 2]", encoding="utf-8")
    assert _load_tts_settings_file(tmp_path) == {}

    saved = save_tts_settings(tmp_path, provider="SINE", model_id="  test/model-x  ")
    assert saved == {"tts_provider": "sine", "tts_model_id": "test/model-x"}
    assert _load_tts_settings_file(tmp_path) == saved

    # Saved UI choice wins over env vars; env vars win over built-ins.
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TTS_PROVIDER", "mlx")
    monkeypatch.setenv("TTS_MODEL_ID", "env/model")
    assert load_settings().tts_provider == "sine"
    (tmp_path / "tts_settings.json").unlink()
    reloaded = load_settings()
    assert reloaded.tts_provider == "mlx"
    assert reloaded.tts_model_id == "env/model"


def test_tts_settings_reports_mlx_and_reference(client: TestClient) -> None:
    r = client.get("/api/tts/settings")
    assert r.status_code == 200
    body = r.json()
    assert "mlxAvailable" in body
    assert "reference" in body
    r2 = client.get("/api/tts/models")
    assert r2.status_code == 200
    assert "mlxAvailable" in r2.json()


def test_tts_generate_serialized_queue(
    client: TestClient,
) -> None:  # The backend uses asyncio.Lock to serialize concurrent TTS generation.
    # Verify that two rapid requests both succeed (queued, not rejected).
    # TestClient is not thread-safe, so we do sequential rapid calls and check both succeed.
    # The lock's existence is verified by checking the module has a lock.
    from app.api.tts import _tts_lock

    assert isinstance(_tts_lock, asyncio.Lock)

    r1 = client.post("/api/tts/generate", json={"text": "First"})
    r2 = client.post("/api/tts/generate", json={"text": "Second concurrent text"})
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.content[:4] == b"RIFF"
    assert r2.content[:4] == b"RIFF"


def test_select_voice_reference_prefers_body_over_prompt() -> None:
    from app.api.tts import _select_voice_reference

    prompt_params = {"referenceAssetId": "prompt-ref", "ref_text": "prompt transcript"}
    # Explicit body id wins over the prompt's stored reference.
    assert _select_voice_reference("body-ref", None, prompt_params) == (
        "body-ref",
        "prompt transcript",
        False,
    )
    # Explicit empty string forces the standard reference: prompt-stored
    # reference id AND transcript are both ignored.
    assert _select_voice_reference("", None, prompt_params) == (None, None, True)
    assert _select_voice_reference("   ", "  ", prompt_params) == (None, None, True)
    # Omitted body id keeps legacy behavior: prompt-stored values apply.
    assert _select_voice_reference(None, None, prompt_params) == (
        "prompt-ref",
        "prompt transcript",
        False,
    )
    # No prompt either: standard default via engine fallback.
    assert _select_voice_reference(None, None, None) == (None, None, False)
    assert _select_voice_reference("", None, None) == (None, None, True)
    # Explicit body transcript wins; prompt transcript is the fallback.
    assert _select_voice_reference(None, "body transcript", prompt_params) == (
        "prompt-ref",
        "body transcript",
        False,
    )


def test_spanish_default_reference_files(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.tts.engine import (
        _default_ref_audio_path,
        _default_ref_text,
        _is_spanish_language,
        get_reference_status,
    )

    # Env overrides must not leak into the file-resolution assertions.
    for var in (
        "TTS_REF_AUDIO",
        "TTS_REF_AUDIO_ES",
        "TTS_REF_TEXT",
        "TTS_REF_TEXT_ES",
        "TTS_REF_TEXT_FILE",
        "TTS_REF_TEXT_FILE_ES",
    ):
        monkeypatch.delenv(var, raising=False)

    assert _is_spanish_language("es") is True
    assert _is_spanish_language("ES-419") is True
    assert _is_spanish_language("Spanish") is True
    assert _is_spanish_language("en") is False
    assert _is_spanish_language(None) is False
    assert _is_spanish_language("") is False

    audio_es = _default_ref_audio_path("es")
    assert audio_es is not None and audio_es.endswith("my_voice_es.wav")
    text_es = _default_ref_text("es")
    assert text_es is not None and "Hola" in text_es

    # English / unset behavior is unchanged (previous files).
    audio_en = _default_ref_audio_path("en")
    assert audio_en is not None and audio_en.endswith("my_voice.wav")
    assert not audio_en.endswith("my_voice_es.wav")
    assert _default_ref_audio_path(None) == audio_en
    text_en = _default_ref_text("en")
    assert text_en is not None and "Hello, my name is Michael" in text_en

    status_es = get_reference_status(language="es")
    assert status_es["audioConfigured"] is True
    assert status_es["textConfigured"] is True
    status_en = get_reference_status()
    assert status_en["audioConfigured"] is True
    assert status_en["textConfigured"] is True


def test_spanish_reference_env_overrides(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from app.tts.engine import _default_ref_audio_path, _default_ref_text

    custom_wav = tmp_path / "custom_es.wav"
    custom_wav.write_bytes(b"RIFF")
    monkeypatch.setenv("TTS_REF_AUDIO_ES", str(custom_wav))
    monkeypatch.setenv("TTS_REF_TEXT_ES", "hola custom transcript")
    assert _default_ref_audio_path("es") == str(custom_wav)
    assert _default_ref_text("es") == "hola custom transcript"
    # English resolution ignores the _ES overrides.
    assert _default_ref_audio_path("en") != str(custom_wav)
    assert _default_ref_text("en") != "hola custom transcript"


def _fake_wav_bytes() -> bytes:
    # Minimal bytes that pass the RIFF/length validation (mocked remote audio).
    return b"RIFF" + bytes(100)


def test_cartesia_registry_entries() -> None:
    from app.tts.registry import (
        CARTESIA_LANGUAGES,
        CARTESIA_MODEL_ID,
        DEFAULT_CARTESIA_VOICE_ID,
        get_model_mode,
        is_model_downloaded,
        normalize_provider,
    )

    assert normalize_provider("cartesia") == "cartesia"
    assert normalize_provider("  Cartesia  ") == "cartesia"
    assert get_model_mode(CARTESIA_MODEL_ID) == "cartesia"
    assert len(CARTESIA_LANGUAGES) == 44
    assert "en" in CARTESIA_LANGUAGES and "ur" in CARTESIA_LANGUAGES
    assert DEFAULT_CARTESIA_VOICE_ID == "f6184e65-98f2-4e3d-84e5-a2eb198b8688"
    # Remote model never needs a local download.
    assert is_model_downloaded(CARTESIA_MODEL_ID) is True


def test_cartesia_models_response_lists_provider_and_flag(client: TestClient) -> None:
    r = client.get("/api/tts/models")
    assert r.status_code == 200
    body = r.json()
    assert "cartesia" in body["providers"]
    assert "sonic-3.6" in body["models"]
    assert "cartesiaConfigured" in body
    assert isinstance(body["cartesiaConfigured"], bool)


def test_cartesia_settings_update_roundtrip(client: TestClient) -> None:
    r = client.put(
        "/api/tts/settings",
        json={"provider": "cartesia", "modelId": "sonic-3.6"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["provider"] == "cartesia"
    got = client.get("/api/tts/settings")
    assert got.json()["provider"] == "cartesia"
    assert got.json()["modelId"] == "sonic-3.6"


def test_cartesia_voices_requires_key(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CARTESIA_API_KEY", raising=False)
    from app.tts.cartesia import clear_voices_cache

    clear_voices_cache()
    r = client.get("/api/tts/voices")
    assert r.status_code == 503


def test_cartesia_voices_lists_saved_voices(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import httpx

    from app.tts.cartesia import clear_voices_cache

    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")
    clear_voices_cache()

    class _Resp:
        status_code = 200

        def json(self) -> object:
            return {
                "data": [
                    {
                        "id": "f6184e65-98f2-4e3d-84e5-a2eb198b8688",
                        "name": "Mike",
                        "language": "en",
                        "description": "mine",
                    }
                ]
            }

    monkeypatch.setattr(httpx, "get", lambda *a, **k: _Resp())
    r = client.get("/api/tts/voices")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["defaultVoiceId"] == "f6184e65-98f2-4e3d-84e5-a2eb198b8688"
    assert body["voices"][0]["name"] == "Mike"
    clear_voices_cache()


def test_cartesia_generate_returns_remote_wav(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import httpx

    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")

    seen: dict[str, object] = {}

    class _Resp:
        status_code = 200
        content = _fake_wav_bytes()
        text = ""

    def _fake_post(*a: object, **k: object) -> _Resp:
        seen["json"] = k.get("json")
        return _Resp()

    monkeypatch.setattr(httpx, "post", _fake_post)
    r = client.post(
        "/api/tts/generate",
        json={
            "text": "Hello from Mike",
            "provider": "cartesia",
            "modelId": "sonic-3.6",
            "voice": "f6184e65-98f2-4e3d-84e5-a2eb198b8688",
            "language": "en",
        },
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("audio/wav")
    assert r.content[:4] == b"RIFF"
    payload = seen["json"]
    assert isinstance(payload, dict)
    assert payload["voice"] == {"id": "f6184e65-98f2-4e3d-84e5-a2eb198b8688"}
    assert payload["language"] == "en"
    assert payload["model_id"] == "sonic-3.6"


def test_cartesia_generate_without_key_is_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("CARTESIA_API_KEY", raising=False)
    r = client.post(
        "/api/tts/generate",
        json={"text": "hi", "provider": "cartesia", "modelId": "sonic-3.6"},
    )
    assert r.status_code == 503


def test_cartesia_generate_bad_language_is_422(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")
    r = client.post(
        "/api/tts/generate",
        json={"text": "hi", "provider": "cartesia", "language": "xx"},
    )
    # Unknown iso is rejected by request validation (422), never reaching Cartesia.
    assert r.status_code == 422


def test_cartesia_generate_locale_passthrough(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import httpx

    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")

    seen: dict[str, object] = {}

    class _Resp:
        status_code = 200
        content = _fake_wav_bytes()
        text = ""

    def _fake_post(*a: object, **k: object) -> _Resp:
        seen["json"] = k.get("json")
        return _Resp()

    monkeypatch.setattr(httpx, "post", _fake_post)
    r = client.post(
        "/api/tts/generate",
        json={
            "text": "The Spanish verb is correr.",
            "provider": "cartesia",
            "modelId": "sonic-3.6",
            "voice": "f6184e65-98f2-4e3d-84e5-a2eb198b8688",
            "locale": "en-GB",
        },
    )
    assert r.status_code == 200, r.text
    payload = seen["json"]
    assert isinstance(payload, dict)
    # Locale is sent verbatim; language must be absent (Cartesia 400s on both).
    assert payload["locale"] == "en-GB"
    assert "language" not in payload


def test_cartesia_generate_language_and_locale_is_422(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")
    r = client.post(
        "/api/tts/generate",
        json={"text": "hi", "provider": "cartesia", "language": "en", "locale": "en-GB"},
    )
    assert r.status_code == 422


def test_cartesia_generate_bad_locale_is_422(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")
    r = client.post(
        "/api/tts/generate",
        json={"text": "hi", "provider": "cartesia", "locale": "xx-YY"},
    )
    assert r.status_code == 422


def test_cartesia_generate_cartesia_only_language_reaches_cartesia(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import httpx

    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")

    seen: dict[str, object] = {}

    class _Resp:
        status_code = 200
        content = _fake_wav_bytes()
        text = ""

    def _fake_post(*a: object, **k: object) -> _Resp:
        seen["json"] = k.get("json")
        return _Resp()

    monkeypatch.setattr(httpx, "post", _fake_post)
    # `tl` is Cartesia-only (outside the Qwen 10) — it must pass the API
    # boundary and be forwarded, not 422.
    r = client.post(
        "/api/tts/generate",
        json={"text": "Kumusta", "provider": "cartesia", "language": "tl"},
    )
    assert r.status_code == 200, r.text
    payload = seen["json"]
    assert isinstance(payload, dict)
    assert payload["language"] == "tl"
    assert "locale" not in payload


def _cartesia_style_wav_bytes(seconds: float = 1.0) -> bytes:
    import struct

    sample_rate, channels = 44100, 1
    data_size = int(sample_rate * channels * 2 * seconds)
    header = (
        b"RIFF"
        + struct.pack("<I", 0xFFFFFFFF)
        + b"WAVE"
        + b"fmt "
        + struct.pack("<I", 16)
        + struct.pack("<H", 1)
        + struct.pack("<H", channels)
        + struct.pack("<I", sample_rate)
        + struct.pack("<I", sample_rate * channels * 2)
        + struct.pack("<H", channels * 2)
        + struct.pack("<H", 16)
        + b"LIST"
        + struct.pack("<I", 26)
        + bytes(26)
        + b"data"
        + struct.pack("<I", 0xFFFFFFFF)
    )
    return header + bytes(data_size)


def test_cartesia_normalizes_streaming_wav_header(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import struct

    import httpx

    from app.tts.cartesia import _normalize_wav_header

    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")
    raw = _cartesia_style_wav_bytes(1.0)

    class _Resp:
        status_code = 200
        content = raw
        text = ""

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    r = client.post(
        "/api/tts/generate",
        json={"text": "hello truncation check", "provider": "cartesia", "language": "en"},
    )
    assert r.status_code == 200, r.text
    body = r.content
    assert body[:4] == b"RIFF"
    # RIFF size and data chunk size now reflect reality, not 0xFFFFFFFF.
    assert struct.unpack("<I", body[4:8])[0] == len(body) - 8
    data_at = body.index(b"data")
    declared = struct.unpack("<I", body[data_at + 4 : data_at + 8])[0]
    assert declared == len(body) - data_at - 8
    # Unit-level: passthrough for non-WAV / already-correct input.
    assert _normalize_wav_header(b"nope") == b"nope"
    assert _normalize_wav_header(raw) == body
