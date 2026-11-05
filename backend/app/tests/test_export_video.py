import io
import shutil
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
            "amix=inputs=3:duration=longest:dropout_transition=0:normalize=0",
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
                    "amix": "amix=inputs=3:duration=longest:dropout_transition=0:normalize=0",
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


@pytest.mark.parametrize("clip_count", [1, 2])
def test_slide_audio_is_padded_to_slide_duration(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch, clip_count: int
) -> None:
    ffmpeg_commands: list[list[str]] = []
    monkeypatch.setattr(
        export_module,
        "_run_ffmpeg",
        lambda args, timeout=120: ffmpeg_commands.append(args),
    )
    clips = [
        {
            "assetId": f"voice-{index}",
            "muted": False,
            "sourceStart": 0.0,
            "sourceEnd": 2.0,
            "timelineStart": 0.0,
            "volume": 1.0,
        }
        for index in range(clip_count)
    ]
    slide = {
        "slideId": "slide-short-audio",
        "duration": 10.0,
        "audio": {"clips": clips},
    }

    export_module._build_slide_audio(
        slide,
        {f"voice-{index}": str(tmp_path / "voice.wav") for index in range(clip_count)},
        tmp_path,
        use_rubberband=False,
    )

    command = ffmpeg_commands[0]
    filter_graph = command[command.index("-filter_complex") + 1]
    assert "apad=whole_dur=10.0" in filter_graph
    if clip_count > 1:
        # Multi-clip mixes must not rescale inputs (normalize=0): preview sums
        # gains without division, and per-slide division caused boundary jumps.
        assert "normalize=0" in filter_graph


def test_multi_clip_mix_does_not_divide_levels(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    ffmpeg_commands: list[list[str]] = []
    monkeypatch.setattr(
        export_module,
        "_run_ffmpeg",
        lambda args, timeout=120: ffmpeg_commands.append(args),
    )
    slide = {
        "slideId": "slide-two-clips",
        "duration": 4.0,
        "audio": {
            "clips": [
                {
                    "assetId": "a",
                    "muted": False,
                    "sourceStart": 0.0,
                    "sourceEnd": 2.0,
                    "timelineStart": 0.0,
                    "volume": 1.0,
                },
                {
                    "assetId": "b",
                    "muted": False,
                    "sourceStart": 0.0,
                    "sourceEnd": 2.0,
                    "timelineStart": 1.0,
                    "volume": 0.5,
                },
            ]
        },
    }
    export_module._build_slide_audio(
        slide,
        {"a": str(tmp_path / "a.wav"), "b": str(tmp_path / "b.wav")},
        tmp_path,
        use_rubberband=False,
    )
    filter_graph = ffmpeg_commands[0][ffmpeg_commands[0].index("-filter_complex") + 1]
    # Two clips plus the silence anchor that pins the amix timeline at zero.
    assert "amix=inputs=3" in filter_graph
    assert "normalize=0" in filter_graph
    assert "anullsrc" in filter_graph


def _write_tone(path: Any, freq: float, duration: float, sample_rate: int = 48000) -> None:
    import math
    import wave as wav_mod

    nframes = int(duration * sample_rate)
    with wav_mod.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        frames = bytearray()
        for i in range(nframes):
            sample = int(10000 * math.sin(2 * math.pi * freq * i / sample_rate))
            frames += sample.to_bytes(2, "little", signed=True)
        w.writeframes(bytes(frames))


def _tone_magnitude(path: Any, freq: float, center: float, width: float = 0.4) -> float:
    """Goertzel magnitude of `freq` in a window around `center` (pure stdlib)."""
    import math
    import wave as wav_mod

    with wav_mod.open(str(path), "rb") as w:
        sample_rate = w.getframerate()
        nchannels = w.getnchannels()
        sampwidth = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if sampwidth != 2:
        raise AssertionError(f"expected s16 test output, got sampwidth={sampwidth}")
    count = len(raw) // 2
    samples: list[float] = [
        int.from_bytes(raw[i * 2 : i * 2 + 2], "little", signed=True) for i in range(count)
    ]
    if nchannels > 1:
        samples = [
            sum(samples[i * nchannels : (i + 1) * nchannels]) / nchannels
            for i in range(count // nchannels)
        ]
    start = max(0, int((center - width / 2) * sample_rate))
    end = min(len(samples), int((center + width / 2) * sample_rate))
    window = samples[start:end]
    n = len(window)
    k = 0.5 + (n * freq / sample_rate)
    omega = 2 * math.pi * k / n
    cos_omega = math.cos(omega)
    coeff = 2 * cos_omega
    s0 = s1 = s2 = 0.0
    for x in window:
        s0 = x + coeff * s1 - s2
        s2, s1 = s1, s0
    return math.hypot(s1 - s2 * cos_omega, s2 * math.sin(omega))


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not available")
def test_fast_voice_playback_rate_does_not_prolong_exported_audio(tmp_path: Any) -> None:
    """A 0.96s voice clip at 2.651x must finish in ~0.362s, like preview."""
    rate = 2.651186997908066
    _write_tone(tmp_path / "and.wav", 440.0, 0.96)
    slide = {
        "slideId": "step-four-and",
        "duration": 1.5,
        "audio": {
            "clips": [
                {
                    "assetId": "and",
                    "muted": False,
                    "sourceStart": 0.0,
                    "sourceEnd": 0.96,
                    "timelineStart": 0.0,
                    "volume": 1.0,
                    "playbackRate": rate,
                }
            ]
        },
    }
    out = export_module._build_slide_audio(
        slide, {"and": str(tmp_path / "and.wav")}, tmp_path, use_rubberband=False
    )
    assert _tone_magnitude(out, 440.0, 0.2) > 1e-3
    assert _tone_magnitude(out, 440.0, 0.8) < 1e-3


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not available")
def test_delayed_tempo_clip_keeps_its_timeline_offset(tmp_path: Any) -> None:
    """Regression: delayed tempo-processed clips must not stack at t=0.

    The per-clip chain used to end with adelay + atrim + asetpts. For chains
    containing atempo, the trailing trim/reset rebased the delayed clip to
    zero — e.g. the closing narration (playbackRate != 1) played on top of
    the opening voices for the first seconds of the exported slide while the
    editor preview (WebAudio-scheduled) played each voice in its own slot.
    """
    _write_tone(tmp_path / "a.wav", 440.0, 2.0)
    _write_tone(tmp_path / "b.wav", 880.0, 2.0)
    slide = {
        "slideId": "slide-offset",
        "duration": 4.0,
        "audio": {
            "clips": [
                {
                    "assetId": "a",
                    "muted": False,
                    "sourceStart": 0.0,
                    "sourceEnd": 2.0,
                    "timelineStart": 0.0,
                    "volume": 1.0,
                    "playbackRate": 1.0,
                },
                {
                    "assetId": "b",
                    "muted": False,
                    "sourceStart": 0.0,
                    "sourceEnd": 2.0,
                    "timelineStart": 2.0,
                    "volume": 1.0,
                    "playbackRate": 1.1,
                },
            ]
        },
    }
    out = export_module._build_slide_audio(
        slide,
        {"a": str(tmp_path / "a.wav"), "b": str(tmp_path / "b.wav")},
        tmp_path,
        use_rubberband=False,
    )
    early_440 = _tone_magnitude(out, 440.0, 1.0)
    early_880 = _tone_magnitude(out, 880.0, 1.0)
    late_440 = _tone_magnitude(out, 440.0, 3.0)
    late_880 = _tone_magnitude(out, 880.0, 3.0)
    assert early_440 > 10 * early_880
    assert late_880 > 10 * late_440


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not available")
def test_delayed_tempo_clip_first_does_not_sink_the_mix(tmp_path: Any) -> None:
    """Regression: amix anchors on its inputs, so a leading delayed and
    tempo-processed clip used to shift/drop every other clip in the mix.
    A silence anchor keeps the mix clock at zero regardless of input order.
    """
    _write_tone(tmp_path / "a.wav", 880.0, 2.0)
    _write_tone(tmp_path / "b.wav", 440.0, 2.0)
    slide = {
        "slideId": "slide-tempo-first",
        "duration": 4.0,
        "audio": {
            "clips": [
                {
                    "assetId": "a",
                    "muted": False,
                    "sourceStart": 0.0,
                    "sourceEnd": 2.0,
                    "timelineStart": 2.0,
                    "volume": 1.0,
                    "playbackRate": 1.1,
                },
                {
                    "assetId": "b",
                    "muted": False,
                    "sourceStart": 0.0,
                    "sourceEnd": 2.0,
                    "timelineStart": 0.0,
                    "volume": 1.0,
                    "playbackRate": 1.0,
                },
            ]
        },
    }
    out = export_module._build_slide_audio(
        slide,
        {"a": str(tmp_path / "a.wav"), "b": str(tmp_path / "b.wav")},
        tmp_path,
        use_rubberband=False,
    )
    early_440 = _tone_magnitude(out, 440.0, 1.0)
    early_880 = _tone_magnitude(out, 880.0, 1.0)
    late_440 = _tone_magnitude(out, 440.0, 3.0)
    late_880 = _tone_magnitude(out, 880.0, 3.0)
    assert early_440 > 10 * early_880
    assert late_880 > 10 * late_440


def test_fade_out_starts_at_clip_end() -> None:
    clip = {
        "assetId": "a",
        "muted": False,
        "sourceStart": 0.0,
        "sourceEnd": 2.0,
        "timelineStart": 0.0,
        "volume": 1.0,
        "playbackRate": 1.0,
        "fadeOut": 0.5,
    }
    chain, _ = export_module._clip_audio_filter(clip, 4.0, False)
    # Regression: st=0 muted everything past the fade duration in export
    # while the editor preview faded only at the end.
    assert "afade=t=out:st=1.5:d=0.5" in chain
    assert "afade=t=out:st=0:" not in chain


def test_ignores_sub_microsecond_fades_ffmpeg_cannot_represent() -> None:
    clip = {
        "assetId": "a",
        "muted": False,
        "sourceStart": 0.0,
        "sourceEnd": 1.0,
        "timelineStart": 0.0,
        "volume": 1.0,
        "playbackRate": 1.0,
        "fadeOut": 8.881784197001252e-16,
    }
    chain, _ = export_module._clip_audio_filter(clip, 2.0, False)
    assert "afade=" not in chain


def test_dual_pass_loudnorm_is_linear(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        export_module,
        "_measure_loudnorm",
        lambda _source: {
            "input_i": "-21.75",
            "input_tp": "-18.06",
            "input_lra": "0.00",
            "input_thresh": "-31.75",
            "target_offset": "0.05",
        },
    )
    args = export_module._dual_pass_loudnorm_args(__import__("pathlib").Path("x"))
    assert args[0] == "-filter:a"
    assert "linear=true" in args[1]
    assert "measured_I=-21.75" in args[1]


def test_dual_pass_loudnorm_falls_back_to_single_pass(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(export_module, "_measure_loudnorm", lambda _source: None)
    args = export_module._dual_pass_loudnorm_args(__import__("pathlib").Path("x"))
    assert args == ["-filter:a", export_module.EXPECTED_LOUDNORM]


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


def test_export_root_setting_is_saved_and_project_path_is_created(
    client: TestClient, tmp_path: Any
) -> None:
    target = tmp_path / "my exports"
    updated = client.put("/api/export/settings", json={"exportRoot": str(target)})
    assert updated.status_code == 200
    assert updated.json()["exportRoot"] == str(target)
    assert target.is_dir()
    loaded = client.get("/api/export/settings")
    assert loaded.status_code == 200
    assert loaded.json()["exportRoot"] == str(target)

    project = client.get("/api/export/projects/project-123")
    assert project.status_code == 200
    assert project.json()["directory"] == str(target / "project-123")
    assert project.json()["joinedOutdated"] is True


def test_export_root_setting_rejects_relative_path(client: TestClient) -> None:
    response = client.put("/api/export/settings", json={"exportRoot": "relative/path"})
    assert response.status_code == 422


def test_frame_encoding_timeout_scales_with_segment_duration(
    tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, Any] = {}

    def fake_run(args: list[str], timeout: int = 120) -> None:
        captured["args"] = args
        captured["timeout"] = timeout

    monkeypatch.setattr(export_module, "_run_ffmpeg", fake_run)
    export_module._encode_video_from_frames(
        tmp_path, 8117, 30, tmp_path / "video.mp4", width=1080, height=1920
    )
    assert any("scale=1080:1920:" in str(arg) for arg in captured["args"])
    assert any("pad=1080:1920:" in str(arg) for arg in captured["args"])
    assert captured["timeout"] > 120


def test_single_slide_export_is_persisted_and_marks_join_outdated(
    client: TestClient, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    _clear_jobs_for_test()
    root = tmp_path / "exports"
    assert client.put("/api/export/settings", json={"exportRoot": str(root)}).status_code == 200
    desc = _make_descriptor(durations=[1.0], project_name="Lesson")
    desc.update({"projectId": "project-id", "exportSlide": True})
    created = client.post("/api/export/jobs", json=desc)
    assert created.status_code == 201, created.text
    job_id = created.json()["jobId"]
    for index in range(30):
        uploaded = client.post(
            f"/api/export/jobs/{job_id}/frames",
            json={
                "slideId": "slide-0",
                "frameIndex": index,
                "timestamp": index / 30,
                "data": PNG_1X1_B64,
            },
        )
        assert uploaded.status_code == 200
    complete = client.post(f"/api/export/jobs/{job_id}/complete")
    assert complete.json()["status"] == "done"
    output = root / "project-id" / "slide-slide-0.mp4"
    assert output.is_file()
    assert not list((root / "project-id").glob(".work-*"))
    project = client.get("/api/export/projects/project-id").json()
    assert project["slides"]["slide-0"]["file"] == output.name
    assert project["joinedOutdated"] is True

    def fake_ffmpeg(args: list[str], timeout: int = 120) -> None:
        del timeout
        from pathlib import Path

        Path(args[-1]).write_bytes(b"joined")

    monkeypatch.setattr(export_module, "_run_ffmpeg", fake_ffmpeg)
    joined = client.post("/api/export/projects/project-id/join", json={"slideIds": ["slide-0"]})
    assert joined.status_code == 200, joined.text
    assert (root / "project-id" / "joined.mp4").read_bytes() == b"joined"
    assert client.get("/api/export/projects/project-id").json()["joinedOutdated"] is False

    subtitles = client.post(
        "/api/export/projects/project-id/subtitles", json={"srt": "1\ncaption\n"}
    )
    assert subtitles.status_code == 200
    assert (root / "project-id" / "subtitles.srt").read_text(encoding="utf-8") == "1\ncaption\n"


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
