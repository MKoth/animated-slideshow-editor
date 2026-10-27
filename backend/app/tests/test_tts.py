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
