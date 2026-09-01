import asyncio

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


def test_tts_generate_serialized_queue(client: TestClient) -> None:
    # The backend uses asyncio.Lock to serialize concurrent TTS generation.
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
