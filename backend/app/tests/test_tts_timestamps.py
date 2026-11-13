"""Timestamp-based Cartesia segmentation (POST /tts/generate with includeTimestamps).

Mocks the Cartesia SSE stream — no real API access.
"""

from __future__ import annotations

import base64
import io
import json
import wave
from typing import Any

import pytest
from fastapi.testclient import TestClient


def _pcm_bytes(duration_sec: float, sample_rate: int = 44100) -> bytes:
    n = int(duration_sec * sample_rate)
    # simple ramp pattern so slices are distinguishable
    out = bytearray()
    for i in range(n):
        out += (i % 32767).to_bytes(2, "little", signed=True)
    return bytes(out)


def _sse_body(
    chunks: list[bytes], words: list[str], starts: list[float], ends: list[float]
) -> bytes:
    lines: list[str] = []
    for c in chunks:
        lines.append(
            "data: "
            + json.dumps(
                {
                    "type": "chunk",
                    "done": False,
                    "status_code": 206,
                    "step_time": 1,
                    "data": base64.b64encode(c).decode("ascii"),
                }
            )
        )
    if words:
        lines.append(
            "data: "
            + json.dumps(
                {
                    "type": "timestamps",
                    "done": False,
                    "status_code": 206,
                    "word_timestamps": {"words": words, "start": starts, "end": ends},
                }
            )
        )
    lines.append("data: " + json.dumps({"type": "done", "done": True, "status_code": 206}))
    return ("\n\n".join(lines) + "\n\n").encode("utf-8")


def _wav_info(wav_bytes: bytes) -> tuple[int, int, float]:
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        return wf.getframerate(), wf.getnchannels(), wf.getnframes() / float(wf.getframerate())


TEXT = "Hello world. How are you?"
SEGMENTS: list[dict[str, Any]] = [
    {"id": "b1", "text": "Hello world.", "start": 0, "end": 12},
    {"id": "b2", "text": "How are you?", "start": 13, "end": 25},
]
WORDS = ["Hello", "world", "How", "are", "you"]
STARTS = [0.0, 0.5, 1.0, 1.3, 1.6]
ENDS = [0.4, 0.9, 1.2, 1.5, 1.9]


def _mock_sse(monkeypatch: pytest.MonkeyPatch, pcm: bytes) -> dict[str, object]:
    import httpx

    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")
    seen: dict[str, object] = {}
    # Re-split sequentially for realism: first half, second half
    half = len(pcm) // 2
    seq = [pcm[:half], pcm[half:]]
    body = _sse_body(seq, WORDS, STARTS, ENDS)

    class _Resp:
        status_code = 200
        content = body
        text = body.decode("utf-8")

    def _fake_post(*a: object, **k: object) -> _Resp:
        seen["url"] = a[0] if a else None
        seen["json"] = k.get("json")
        return _Resp()

    monkeypatch.setattr(httpx, "post", _fake_post)
    return seen


def test_parse_sse_assembles_chunks_and_metadata() -> None:
    from app.tts.timestamps import parse_sse_body

    pcm = _pcm_bytes(0.2)
    body = _sse_body([pcm[:1000], pcm[1000:]], WORDS, STARTS, ENDS)
    out_pcm, events, sr = parse_sse_body(body)
    assert out_pcm == pcm
    assert sr == 44100
    assert [e.word for e in events] == WORDS
    assert [e.start for e in events] == STARTS
    assert [e.end for e in events] == ENDS


def test_map_words_to_blocks() -> None:
    from app.tts.timestamps import BlockBoundary, WordTimestamp, map_words_to_blocks

    bounds = [BlockBoundary(**s) for s in SEGMENTS]
    events = [WordTimestamp(w, s, e) for w, s, e in zip(WORDS, STARTS, ENDS)]
    ranges = map_words_to_blocks(bounds, events)
    assert ranges[0].id == "b1" and ranges[0].start == 0.0 and ranges[0].end == 0.9
    assert ranges[1].id == "b2" and ranges[1].start == 1.0 and ranges[1].end == 1.9


def test_slice_segments_correct_portions() -> None:
    from app.tts.timestamps import (
        BlockBoundary,
        WordTimestamp,
        map_words_to_blocks,
        pcm_to_wav,
        slice_segments,
        validate_boundaries,
    )

    pcm = _pcm_bytes(2.0)
    validate_boundaries(TEXT, [BlockBoundary(**s) for s in SEGMENTS])
    events = [WordTimestamp(w, s, e) for w, s, e in zip(WORDS, STARTS, ENDS)]
    ranges = map_words_to_blocks([BlockBoundary(**s) for s in SEGMENTS], events)
    # Default: shared cut, no overlap. Cut positions preserved in fields.
    sliced = slice_segments(pcm, 44100, ranges, events)
    assert len(sliced) == 2
    assert sliced[0].start == 0.0
    # Neighbors share one exact cut sample: no duplication, no gap.
    assert sliced[0].end == sliced[1].start
    assert sliced[1].end == 1.9
    # The shared cut stays near the word boundary (bounded detection window).
    assert 0.87 <= sliced[0].end <= 1.03
    # WAV validity + metadata
    for seg in sliced:
        wav = pcm_to_wav(seg.pcm)
        sr, ch, _ = _wav_info(wav)
        assert sr == 44100 and ch == 1
    # Continuous coverage: durations sum to the full word span.
    assert abs((sliced[0].duration + sliced[1].duration) - 1.9) < 1e-6
    # Detection/fades disabled: cuts fall back to exact word timestamps.
    exact = slice_segments(pcm, 44100, ranges, events, search_sec=0, fade_in_sec=0, fade_out_sec=0)
    assert exact[0].pcm == pcm[0 : round(0.9 * 44100) * 2]
    assert exact[1].pcm == pcm[round(0.9 * 44100) * 2 : round(1.9 * 44100) * 2]
    assert exact[0].end == exact[1].start == 0.9


def test_generate_with_timestamps_end_to_end(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    pcm = _pcm_bytes(2.0)
    seen = _mock_sse(monkeypatch, pcm)
    r = client.post(
        "/api/tts/generate",
        json={
            "text": TEXT,
            "provider": "cartesia",
            "modelId": "sonic-3.6",
            "language": "en",
            "includeTimestamps": True,
            "segments": SEGMENTS,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mimeType"] == "audio/wav"
    assert body["sampleRate"] == 44100 and body["channels"] == 1
    assert abs(body["duration"] - 2.0) < 0.01
    # Request used SSE with timestamps + raw output
    payload = seen["json"]
    assert isinstance(payload, dict)
    url = seen["url"]
    assert isinstance(url, str)
    assert url.endswith("/tts/sse")
    assert payload["add_timestamps"] is True
    assert payload["output_format"] == {
        "container": "raw",
        "encoding": "pcm_s16le",
        "sample_rate": 44100,
    }
    assert payload["transcript"] == TEXT
    # Segments ordered, within duration, valid WAVs
    segs = body["segments"]
    assert [s["id"] for s in segs] == ["b1", "b2"]
    assert segs[0]["start"] == 0.0
    # Shared boundary: previous ends exactly where next begins.
    assert segs[0]["end"] == segs[1]["start"]
    assert segs[1]["end"] == 1.9
    for s in segs:
        wav = base64.b64decode(s["audio"])
        sr, ch, dur = _wav_info(wav)
        assert sr == 44100 and ch == 1
        assert abs(dur - s["duration"]) < 0.01
        assert s["start"] >= 0 and s["end"] <= body["duration"]
    assert segs[0]["end"] == segs[1]["start"]
    # Full audio present and valid
    full = base64.b64decode(body["fullAudio"])
    assert full[:4] == b"RIFF"
    _, _, full_dur = _wav_info(full)
    assert abs(full_dur - 2.0) < 0.01


def test_spaces_and_punctuation_between_blocks() -> None:
    # Extra spaces / punctuation separators must not break mapping;
    # offsets are exact, words align across the gap.
    from app.tts.timestamps import BlockBoundary, WordTimestamp, map_words_to_blocks

    text = "Today we will study Spanish.  Let's start!"
    s1 = "Today we will study Spanish."
    s2 = "Let's start!"
    bounds = [
        BlockBoundary(id="a", text=s1, start=0, end=len(s1)),
        BlockBoundary(id="b", text=s2, start=len(s1) + 2, end=len(text)),
    ]
    assert text[len(s1) + 2 :] == s2
    events = [
        WordTimestamp(w, float(i), float(i) + 0.4)
        for i, w in enumerate(["Today", "we", "will", "study", "Spanish", "Let's", "start"])
    ]
    ranges = map_words_to_blocks(bounds, events)
    assert ranges[0].start == 0.0
    assert ranges[1].end == 6.4


def test_missing_timestamps_is_500(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")
    pcm = _pcm_bytes(0.5)
    body = _sse_body([pcm], [], [], [])  # no timestamps event

    class _Resp:
        status_code = 200
        content = body
        text = body.decode("utf-8")

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    r = client.post(
        "/api/tts/generate",
        json={
            "text": TEXT,
            "provider": "cartesia",
            "includeTimestamps": True,
            "segments": SEGMENTS,
        },
    )
    assert r.status_code == 500
    assert "word timestamps" in r.json()["detail"].lower()


def test_incomplete_stream_is_500(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")
    pcm = _pcm_bytes(0.2)
    # No done event
    raw = (
        "data: "
        + json.dumps(
            {
                "type": "chunk",
                "done": False,
                "status_code": 206,
                "step_time": 1,
                "data": base64.b64encode(pcm).decode("ascii"),
            }
        )
        + "\n\n"
    ).encode()

    class _Resp:
        status_code = 200
        content = raw
        text = raw.decode("utf-8")

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    r = client.post(
        "/api/tts/generate",
        json={
            "text": TEXT,
            "provider": "cartesia",
            "includeTimestamps": True,
            "segments": SEGMENTS,
        },
    )
    assert r.status_code == 500


def test_invalid_offsets_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")
    bad = [
        {"id": "b1", "text": "Hello world.", "start": 1, "end": 12},  # slice mismatch
        {"id": "b2", "text": "How are you?", "start": 13, "end": 25},
    ]
    r = client.post(
        "/api/tts/generate",
        json={"text": TEXT, "provider": "cartesia", "includeTimestamps": True, "segments": bad},
    )
    assert r.status_code == 422


def test_word_mismatch_is_422(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    pcm = _pcm_bytes(1.0)
    import httpx

    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")
    # Cartesia returns different words than the text
    body = _sse_body([pcm], ["Totally", "different"], [0.0, 0.5], [0.4, 0.9])

    class _Resp:
        status_code = 200
        content = body
        text = body.decode("utf-8")

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    r = client.post(
        "/api/tts/generate",
        json={
            "text": TEXT,
            "provider": "cartesia",
            "includeTimestamps": True,
            "segments": SEGMENTS,
        },
    )
    assert r.status_code == 422


def test_non_cartesia_provider_rejected(client: TestClient) -> None:
    r = client.post(
        "/api/tts/generate",
        json={"text": TEXT, "provider": "sine", "includeTimestamps": True, "segments": SEGMENTS},
    )
    assert r.status_code == 422
    assert "only for Cartesia" in r.json()["detail"]


def test_empty_block_mapping_error() -> None:
    from app.tts.timestamps import (
        BlockBoundary,
        TimestampMappingError,
        WordTimestamp,
        map_words_to_blocks,
    )

    with pytest.raises(TimestampMappingError):
        map_words_to_blocks(
            [BlockBoundary(id="e", text="...", start=0, end=3)],
            [WordTimestamp("hello", 0.0, 0.4)],
        )


def test_existing_wav_path_unchanged(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    monkeypatch.setenv("CARTESIA_API_KEY", "test-key-123")

    class _Resp:
        status_code = 200
        content = b"RIFF" + bytes(100)
        text = ""

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    r = client.post("/api/tts/generate", json={"text": "plain", "provider": "cartesia"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/wav")
