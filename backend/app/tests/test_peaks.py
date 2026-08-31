import io
import math
import struct
import wave

from fastapi.testclient import TestClient


def wav_bytes(duration: float = 2.0, freq: float = 440.0, sample_rate: int = 44100) -> bytes:
    nframes = int(sample_rate * duration)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        for i in range(nframes):
            v = int(32767 * 0.5 * math.sin(2 * math.pi * freq * i / sample_rate))
            w.writeframes(struct.pack("<h", v))
    return buf.getvalue()


def upload_file(filename: str, content: bytes, content_type: str):
    return ("files", (filename, content, content_type))


def test_upload_audio_stores_metadata_duration_sampleRate_channels(client: TestClient) -> None:
    content = wav_bytes(duration=2.0, sample_rate=44100)
    resp = client.post("/api/assets", files=[upload_file("tone.wav", content, "audio/wav")])
    assert resp.status_code == 200
    created = resp.json()["created"][0]
    meta = created["metadata"]
    assert meta is not None
    assert abs(meta["duration"] - 2.0) < 0.05
    assert meta["sampleRate"] == 44100
    assert meta["channels"] == 1
    assert created["mimeType"] == "audio/wav"
    assert created["category"] == "audio"


def test_peaks_returns_800_2000_buckets_at_20pxs(client: TestClient) -> None:
    content = wav_bytes(duration=2.0)
    resp = client.post("/api/assets", files=[upload_file("a.wav", content, "audio/wav")])
    aid = resp.json()["created"][0]["id"]
    r = client.get(f"/api/assets/{aid}/peaks")
    assert r.status_code == 200
    peaks = r.json()["peaks"]
    # 2s *20 =40 -> clamped to 800 minimum
    assert len(peaks) == 800
    assert all(0 <= p <= 255 for p in peaks)
    assert abs(r.json()["duration"] - 2.0) < 0.05


def test_peaks_long_clamped_to_2000(client: TestClient) -> None:
    # Upload short file but manually set long duration metadata via DB to test clamping?
    # Instead test bucketCount helper directly and via synthetic fallback with long duration
    from app.assets.peaks import bucket_count_for_duration

    assert bucket_count_for_duration(10) == 800
    assert bucket_count_for_duration(40) == 800
    assert bucket_count_for_duration(50) == 1000
    assert bucket_count_for_duration(200) == 2000
    assert bucket_count_for_duration(1000) == 2000


def test_peaks_caching_idempotent(client: TestClient) -> None:
    content = wav_bytes(duration=1.0)
    resp = client.post("/api/assets", files=[upload_file("b.wav", content, "audio/wav")])
    aid = resp.json()["created"][0]["id"]
    r1 = client.get(f"/api/assets/{aid}/peaks")
    r2 = client.get(f"/api/assets/{aid}/peaks")
    assert r1.json()["peaks"] == r2.json()["peaks"]
    # Second call still 800 and same values
    assert len(r2.json()["peaks"]) == 800
    # Verify metadata now persisted with waveformPeaks
    detail = client.get(f"/api/assets/{aid}").json()
    assert detail["metadata"] is not None
    assert "waveformPeaks" in detail["metadata"]
    assert detail["metadata"]["waveformPeaks"] == r1.json()["peaks"]


def test_peaks_non_audio_returns_404(client: TestClient) -> None:
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (10, 10)).save(buf, format="PNG")
    png = buf.getvalue()
    resp = client.post("/api/assets", files=[upload_file("img.png", png, "image/png")])
    pid = resp.json()["created"][0]["id"]
    r = client.get(f"/api/assets/{pid}/peaks")
    assert r.status_code == 404


def test_peaks_not_found_404(client: TestClient) -> None:
    r = client.get("/api/assets/does-not-exist/peaks")
    assert r.status_code == 404
