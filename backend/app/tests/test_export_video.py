import io
import zipfile
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api import export as export_module
from app.api.export import _clear_jobs_for_test, _sanitize_basename

_REAL_ENCODE_JOB_MP4 = export_module._encode_job_mp4


@pytest.fixture(autouse=True)
def _no_live_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    # Spec: no live FFmpeg in unit tests — force the placeholder MP4 path.
    monkeypatch.setattr(export_module, "_encode_job_mp4", lambda _record: None)


# 1x1 PNG (valid image bytes for frame-upload validation).
PNG_1X1_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def _wav_b64(duration: float = 1.0) -> str:
    import base64
    import math
    import wave as wav_mod

    sample_rate = 48000
    channels = 2
    nframes = int(duration * sample_rate)
    buf = io.BytesIO()
    with wav_mod.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        # Audible tone (pure digital silence breaks single-pass loudnorm: -inf -> NaN).
        frames = bytearray()
        for i in range(nframes):
            sample = int(8000 * math.sin(2 * math.pi * 440 * i / sample_rate))
            frames += sample.to_bytes(2, "little", signed=True) * channels
        w.writeframes(bytes(frames))
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _make_descriptor(
    fps: float = 30,
    durations: list[float] | None = None,
    project_name: str | None = "My Lesson!",
    subtitles: dict[str, str] | None = None,
) -> dict[str, Any]:
    if durations is None:
        durations = [2.0, 1.5]
    slides: list[dict[str, Any]] = []
    for idx, dur in enumerate(durations):
        slide_id = f"slide-{idx}"
        frame_count = round(dur * fps)
        timestamps = [i / fps for i in range(frame_count)]
        clips = [
            {
                "id": f"clip-{idx}-voice",
                "assetId": f"asset-{idx}",
                "trackId": "voice",
                "timelineStart": 0,
                "sourceStart": 0,
                "sourceEnd": 1.0,
                "volume": 0.8,
                "muted": False,
                "playbackRate": 1.0,
                "isStretched": False,
                "trimEnd": dur,
                "filterFragment": (
                    f"aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.8,"
                    f"atrim=end={dur},asetpts=PTS-STARTPTS"
                ),
            }
        ]
        per_clip = [c["filterFragment"] for c in clips]
        parts = [f"[{c['id']}] {c['filterFragment']} [{c['id']}_out]" for c in clips]
        parts += [
            "aformat=sample_fmts=fltp:channel_layouts=stereo",
            "volume handling via per-clip fragments",
            f"atrim=end={dur}",
            "amix=inputs=3:duration=longest:dropout_transition=0",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
        ]
        slides.append(
            {
                "slideId": slide_id,
                "slideName": f"Slide {idx}",
                "duration": dur,
                "fps": fps,
                "frameCount": frame_count,
                "frameTimestamps": timestamps,
                "video": {
                    "inputKind": "frames",
                    "frameCount": frame_count,
                    "fps": fps,
                    "timestamps": timestamps,
                    "pixelFormat": "yuv420p",
                    "movflags": "+faststart",
                    "codec": "libx264",
                    "ffmpegArgs": [
                        "-c:v",
                        "libx264",
                        "-pix_fmt",
                        "yuv420p",
                        "-movflags",
                        "+faststart",
                    ],
                },
                "audio": {
                    "lanes": ["voice", "sfx", "music"],
                    "clips": clips,
                    "laneInputs": 3,
                    "filterComplex": "; ".join(parts),
                    "amix": "amix=inputs=3:duration=longest:dropout_transition=0",
                    "loudnorm": "loudnorm=I=-16:TP=-1.5:LRA=11",
                    "atrim": f"atrim=end={dur}",
                    "inputs": ["video", "audio:voice", "audio:sfx", "audio:music"],
                    "perClipFilters": per_clip,
                },
                "segment": {
                    "outputFile": f"segment-{slide_id}.mp4",
                    "videoArgs": [
                        "-c:v",
                        "libx264",
                        "-pix_fmt",
                        "yuv420p",
                        "-movflags",
                        "+faststart",
                    ],
                    "audioArgs": ["-c:a", "aac", "-filter:a", "loudnorm=I=-16:TP=-1.5:LRA=11"],
                    "duration": dur,
                },
            }
        )
    total_duration = sum(durations)
    total_frames = sum(s["frameCount"] for s in slides)
    desc: dict[str, Any] = {
        "version": 1,
        "settings": {"fps": fps},
        "slides": slides,
        "global": {
            "concatMethod": "concat demuxer",
            "concatDemuxer": {
                "method": "concat demuxer",
                "inputFiles": [s["segment"]["outputFile"] for s in slides],
                "ffmpegArgs": ["-f", "concat", "-safe", "0", "-i", "concat.txt"],
            },
            "video": {
                "pixelFormat": "yuv420p",
                "movflags": "+faststart",
                "codec": "libx264",
                "ffmpegArgs": ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
            },
            "audio": {
                "loudnorm": "loudnorm=I=-16:TP=-1.5:LRA=11",
                "finalFilter": "loudnorm=I=-16:TP=-1.5:LRA=11",
            },
            "totalDuration": total_duration,
            "totalFrames": total_frames,
        },
        "derivedAssetCache": [],
        "determinismKey": "test-key-subset",
        "ffmpegGlobalArgs": [
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-filter:a",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
            "concat demuxer",
        ],
    }
    if project_name is not None:
        desc["projectName"] = project_name
    if subtitles is not None:
        desc["subtitles"] = subtitles
    return desc


def test_sanitize_basename() -> None:
    assert _sanitize_basename("My Lesson!") == "My-Lesson"
    assert _sanitize_basename("  ") == "export"
    assert _sanitize_basename(None) == "export"
    assert _sanitize_basename("a/b:c") == "a-b-c"


def test_subset_single_slide_validates(client: TestClient) -> None:
    _clear_jobs_for_test()
    desc = _make_descriptor(durations=[2.0])
    r = client.post("/api/export/jobs", json=desc)
    assert r.status_code == 201, r.text
    assert r.json()["totalDuration"] == 2.0


def test_status_progression_and_artifact_zip(client: TestClient) -> None:
    _clear_jobs_for_test()
    srt = "1\n00:00:00,000 --> 00:00:01,500\nHello\n"
    vtt = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nHello\n"
    desc = _make_descriptor(
        durations=[1.0], project_name="My Lesson!", subtitles={"srt": srt, "vtt": vtt}
    )
    r = client.post("/api/export/jobs", json=desc)
    assert r.status_code == 201
    job_id = r.json()["jobId"]
    assert r.json()["status"] == "queued"
    assert r.json()["basename"] == "My-Lesson"

    # Artifact not ready before encoding
    assert client.get(f"/api/export/jobs/{job_id}/artifact").status_code == 404

    # First frame moves queued -> rendering
    f1 = client.post(
        f"/api/export/jobs/{job_id}/frames",
        json={"slideId": "slide-0", "frameIndex": 0, "timestamp": 0, "data": PNG_1X1_B64},
    )
    assert f1.status_code == 200, f1.text
    assert f1.json()["status"] == "rendering"
    assert f1.json()["receivedFrames"] == 1

    status = client.get(f"/api/export/jobs/{job_id}").json()
    assert status["status"] == "rendering"
    assert status["receivedFrames"] == 1

    # Complete triggers encoding -> done with artifact
    done = client.post(f"/api/export/jobs/{job_id}/complete")
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "done"
    assert done.json()["artifactReady"] is True

    status2 = client.get(f"/api/export/jobs/{job_id}").json()
    assert status2["status"] == "done"
    assert status2["artifactReady"] is True

    art = client.get(f"/api/export/jobs/{job_id}/artifact")
    assert art.status_code == 200
    assert "My-Lesson.zip" in art.headers.get("content-disposition", "")
    buf = io.BytesIO(art.content)
    with zipfile.ZipFile(buf) as zf:
        names = sorted(zf.namelist())
        assert names == ["My-Lesson.mp4", "My-Lesson.srt", "My-Lesson.vtt"]
        assert zf.read("My-Lesson.srt").decode("utf-8") == srt
        assert zf.read("My-Lesson.vtt").decode("utf-8") == vtt
        assert len(zf.read("My-Lesson.mp4")) > 0


def test_concurrency_blocked_and_cancel_frees_slot(client: TestClient) -> None:
    _clear_jobs_for_test()
    r1 = client.post("/api/export/jobs", json=_make_descriptor(durations=[1.0]))
    assert r1.status_code == 201
    r2 = client.post("/api/export/jobs", json=_make_descriptor(durations=[1.0]))
    assert r2.status_code == 409
    # Cancel frees the single-concurrency slot
    cancel = client.post(f"/api/export/jobs/{r1.json()['jobId']}/cancel")
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "cancelled"
    r3 = client.post("/api/export/jobs", json=_make_descriptor(durations=[1.0]))
    assert r3.status_code == 201


def test_frame_validation_rejects_unknown_slide(client: TestClient) -> None:
    _clear_jobs_for_test()
    r = client.post("/api/export/jobs", json=_make_descriptor(durations=[1.0]))
    job_id = r.json()["jobId"]
    bad = client.post(
        f"/api/export/jobs/{job_id}/frames",
        json={"slideId": "nope", "frameIndex": 0, "timestamp": 0, "data": PNG_1X1_B64},
    )
    assert bad.status_code == 422


def test_frame_validation_rejects_invalid_image(client: TestClient) -> None:
    _clear_jobs_for_test()
    r = client.post("/api/export/jobs", json=_make_descriptor(durations=[1.0]))
    job_id = r.json()["jobId"]
    bad = client.post(
        f"/api/export/jobs/{job_id}/frames",
        json={"slideId": "slide-0", "frameIndex": 0, "timestamp": 0, "data": "abcd"},
    )
    assert bad.status_code == 422


def test_audio_upload_stored_for_encode(client: TestClient) -> None:
    _clear_jobs_for_test()
    desc = _make_descriptor(durations=[1.0])
    r = client.post("/api/export/jobs", json=desc)
    assert r.status_code == 201
    job_id = r.json()["jobId"]
    up = client.post(
        f"/api/export/jobs/{job_id}/audio",
        json={"assetId": "asset-0", "data": _wav_b64(1.0), "mimeType": "audio/wav"},
    )
    assert up.status_code == 200, up.text
    assert up.json()["stored"] is True


def test_real_encode_uses_frames_and_audio(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """End-to-end with real FFmpeg (skipped when ffmpeg is missing)."""
    import shutil

    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not available")
    monkeypatch.setattr(export_module, "_encode_job_mp4", _REAL_ENCODE_JOB_MP4)
    _clear_jobs_for_test()
    # Use small durations so the encode stays fast: 0.5s @ 30fps = 15 frames.
    desc = _make_descriptor(durations=[0.5])
    try:
        r = client.post("/api/export/jobs", json=desc)
        assert r.status_code == 201, r.text
        job_id = r.json()["jobId"]
        expected = r.json()["expectedFrameCount"]
        assert expected == 15
        up = client.post(
            f"/api/export/jobs/{job_id}/audio",
            json={"assetId": "asset-0", "data": _wav_b64(1.0), "mimeType": "audio/wav"},
        )
        assert up.status_code == 200, up.text
        for i in range(expected):
            f = client.post(
                f"/api/export/jobs/{job_id}/frames",
                json={
                    "slideId": "slide-0",
                    "frameIndex": i,
                    "timestamp": i / 30,
                    "data": PNG_1X1_B64,
                },
            )
            assert f.status_code == 200, f.text
        done = client.post(f"/api/export/jobs/{job_id}/complete")
        assert done.status_code == 200, done.text
        assert done.json()["status"] == "done", done.json()
        art = client.get(f"/api/export/jobs/{job_id}/artifact")
        assert art.status_code == 200
        buf = io.BytesIO(art.content)
        with zipfile.ZipFile(buf) as zf:
            mp4 = zf.read("My-Lesson.mp4")
            # Real encode: valid MP4 container, not the text placeholder.
            assert not mp4.startswith(b"ISOM-PLACEHOLDER")
            assert len(mp4) > 1000
    finally:
        _clear_jobs_for_test()
