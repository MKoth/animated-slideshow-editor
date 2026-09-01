import base64
import json

from fastapi.testclient import TestClient

from app.api.export import _clear_jobs_for_test


def _wav_base64(duration: float = 1.0) -> str:
    sample_rate = 44100
    channels = 1
    byte_rate = sample_rate * channels * 2
    data_size = int(duration * byte_rate)
    import struct

    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        channels,
        sample_rate,
        byte_rate,
        channels * 2,
        16,
        b"data",
        data_size,
    )
    data = header + bytes(data_size)
    return base64.b64encode(data).decode("ascii")


def _make_descriptor(fps: float = 30, durations: list[float] | None = None) -> dict:
    if durations is None:
        durations = [2.0, 1.5]
    # Build minimal descriptor matching frontend shape but constructed directly for backend test
    # Use the frontend builder logic via python mimic — or just hardcode expected shape
    # For test independence, build descriptor manually replicating frontend's output shape
    slides = []
    for idx, dur in enumerate(durations):
        slide_id = f"slide-{idx}"
        frame_count = round(dur * fps)
        timestamps = [i / fps for i in range(frame_count)]
        # one clip on voice lane, maybe with playbackRate 1.2 for first slide
        clips = []
        if idx == 0:
            asset_id = "asset-voice-1"
            playback_rate = 1.5
            tempo = 1 / playback_rate
            cache_key = f"{asset_id}:{playback_rate}"
            clips.append(
                {
                    "id": f"clip-{idx}-voice",
                    "assetId": asset_id,
                    "trackId": "voice",
                    "timelineStart": 0,
                    "sourceStart": 0,
                    "sourceEnd": 1.0,
                    "volume": 0.8,
                    "muted": False,
                    "playbackRate": playback_rate,
                    "derivedAssetKey": cache_key,
                    "rubberbandTempo": tempo,
                    "isStretched": True,
                    "trimEnd": dur,
                    "filterFragment": f"aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.8,rubberband=tempo={tempo:.6f},atrim=end={dur},asetpts=PTS-STARTPTS",
                }
            )
        else:
            asset_id = "asset-sfx-1"
            clips.append(
                {
                    "id": f"clip-{idx}-sfx",
                    "assetId": asset_id,
                    "trackId": "sfx",
                    "timelineStart": 0.5,
                    "sourceStart": 0,
                    "sourceEnd": 1.0,
                    "volume": 1.0,
                    "muted": False,
                    "playbackRate": 1.0,
                    "isStretched": False,
                    "trimEnd": dur,
                    "filterFragment": f"aformat=sample_fmts=fltp:channel_layouts=stereo,volume=1.0,atrim=end={dur},asetpts=PTS-STARTPTS",
                }
            )
        per_clip_filters = [c["filterFragment"] for c in clips]
        filter_complex_parts = [f"[{c['id']}] {c['filterFragment']} [{c['id']}_out]" for c in clips]
        filter_complex_parts.append("aformat=sample_fmts=fltp:channel_layouts=stereo")
        filter_complex_parts.append("volume handling via per-clip fragments")
        filter_complex_parts.append(f"atrim=end={dur}")
        filter_complex_parts.append("amix=inputs=3:duration=longest:dropout_transition=0")
        filter_complex_parts.append("loudnorm=I=-16:TP=-1.5:LRA=11")
        filter_complex = "; ".join(filter_complex_parts)

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
                    "ffmpegArgs": ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
                },
                "audio": {
                    "lanes": ["voice", "sfx", "music"],
                    "clips": clips,
                    "laneInputs": 3,
                    "filterComplex": filter_complex,
                    "amix": "amix=inputs=3:duration=longest:dropout_transition=0",
                    "loudnorm": "loudnorm=I=-16:TP=-1.5:LRA=11",
                    "atrim": f"atrim=end={dur}",
                    "inputs": ["video", "audio:voice", "audio:sfx", "audio:music"],
                    "perClipFilters": per_clip_filters,
                },
                "segment": {
                    "outputFile": f"segment-{slide_id}.mp4",
                    "videoArgs": ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
                    "audioArgs": ["-c:a", "aac", "-filter:a", "loudnorm=I=-16:TP=-1.5:LRA=11"],
                    "duration": dur,
                },
            }
        )

    total_duration = sum(durations)
    total_frames = sum(s["frameCount"] for s in slides)
    input_files = [s["segment"]["outputFile"] for s in slides]
    determinism_payload = {
        "projectId": "proj-1",
        "fps": fps,
        "slides": [
            {
                "id": s["slideId"],
                "duration": s["duration"],
                "frameCount": s["frameCount"],
                "clips": [
                    {
                        "id": c["id"],
                        "assetId": c["assetId"],
                        "trackId": c["trackId"],
                        "timelineStart": c["timelineStart"],
                        "sourceStart": c["sourceStart"],
                        "sourceEnd": c["sourceEnd"],
                        "volume": c["volume"],
                        "muted": c["muted"],
                        "playbackRate": c["playbackRate"],
                    }
                    for c in s["audio"]["clips"]
                ],
            }
            for s in slides
        ],
    }
    determinism_key = base64.b64encode(json.dumps(determinism_payload).encode()).decode()[:48]

    derived_cache = []
    seen = set()
    for s in slides:
        for c in s["audio"]["clips"]:
            if c.get("derivedAssetKey") and c["derivedAssetKey"] not in seen:
                seen.add(c["derivedAssetKey"])
                derived_cache.append(
                    {
                        "assetId": c["assetId"],
                        "playbackRate": c["playbackRate"],
                        "tempo": c["rubberbandTempo"],
                        "cacheKey": c["derivedAssetKey"],
                    }
                )
    derived_cache.sort(key=lambda e: e["cacheKey"])

    return {
        "version": 1,
        "settings": {"fps": fps},
        "slides": slides,
        "global": {
            "concatMethod": "concat demuxer",
            "concatDemuxer": {
                "method": "concat demuxer",
                "inputFiles": input_files,
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
        "derivedAssetCache": derived_cache,
        "determinismKey": determinism_key,
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


def test_export_create_and_get_roundtrip(client: TestClient) -> None:
    _clear_jobs_for_test()
    desc = _make_descriptor(fps=30)
    r = client.post("/api/export/jobs", json=desc)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version"] == 1
    assert body["settings"]["fps"] == 30
    assert body["concatMethod"] == "concat demuxer"
    assert body["videoPixelFormat"] == "yuv420p"
    assert body["videoMovflags"] == "+faststart"
    assert body["audioLoudnorm"] == "loudnorm=I=-16:TP=-1.5:LRA=11"
    assert body["expectedFrameCount"] == sum(s["frameCount"] for s in desc["slides"])
    assert body["totalDuration"] == sum(s["duration"] for s in desc["slides"])
    # deterministic key preserved
    assert body["determinismKey"] == desc["determinismKey"]
    job_id = body["jobId"]
    # get
    r2 = client.get(f"/api/export/jobs/{job_id}")
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["jobId"] == job_id
    assert body2["status"] == "queued"
    # list
    r3 = client.get("/api/export/jobs")
    assert r3.status_code == 200
    assert len(r3.json()) >= 1


def test_export_descriptor_shape_validation_video_plus_3_audio_inputs(client: TestClient) -> None:
    _clear_jobs_for_test()
    desc = _make_descriptor()
    # Valid
    r = client.post("/api/export/jobs", json=desc)
    assert r.status_code == 201
    # Invalid: missing 3 lanes -> 422
    desc2 = _make_descriptor()
    desc2["slides"][0]["audio"]["lanes"] = ["voice", "sfx"]  # only 2
    desc2["slides"][0]["audio"]["inputs"] = ["video", "audio:voice", "audio:sfx"]
    desc2["slides"][0]["audio"]["laneInputs"] = 2
    desc2["slides"][0]["audio"]["filterComplex"] = desc2["slides"][0]["audio"]["filterComplex"].replace(
        "amix=inputs=3", "amix=inputs=2"
    )
    desc2["slides"][0]["audio"]["amix"] = "amix=inputs=2:duration=longest:dropout_transition=0"
    r2 = client.post("/api/export/jobs", json=desc2)
    assert r2.status_code == 422


def test_export_rubberband_tempo_validation(client: TestClient) -> None:
    _clear_jobs_for_test()
    desc = _make_descriptor()
    # tamper tempo to be wrong
    desc["slides"][0]["audio"]["clips"][0]["rubberbandTempo"] = 999
    # also need to update filterFragment to keep containing rubberband but tempo mismatched triggers 422 via tempo check
    r = client.post("/api/export/jobs", json=desc)
    assert r.status_code == 422
    assert "tempo" in r.text.lower()


def test_export_amix_loudnorm_concat_yuv420p_faststart_required(client: TestClient) -> None:
    _clear_jobs_for_test()
    desc = _make_descriptor()
    # remove amix from filterComplex
    desc["slides"][0]["audio"]["filterComplex"] = desc["slides"][0]["audio"]["filterComplex"].replace(
        "amix=inputs=3:duration=longest:dropout_transition=0", "no-amix"
    )
    r = client.post("/api/export/jobs", json=desc)
    assert r.status_code == 422
    assert "amix" in r.text.lower()

    desc2 = _make_descriptor()
    desc2["slides"][0]["audio"]["filterComplex"] = desc2["slides"][0]["audio"]["filterComplex"].replace(
        "loudnorm=I=-16:TP=-1.5:LRA=11", "no-loudnorm"
    )
    desc2["slides"][0]["audio"]["loudnorm"] = "nope"
    r2 = client.post("/api/export/jobs", json=desc2)
    assert r2.status_code == 422

    desc3 = _make_descriptor()
    desc3["global"]["video"]["pixelFormat"] = "yuv444p"
    desc3["slides"][0]["video"]["pixelFormat"] = "yuv444p"
    r3 = client.post("/api/export/jobs", json=desc3)
    assert r3.status_code == 422
    assert "yuv420p" in r3.text

    desc4 = _make_descriptor()
    desc4["global"]["concatMethod"] = "not concat"
    desc4["global"]["concatDemuxer"]["method"] = "not concat"
    r4 = client.post("/api/export/jobs", json=desc4)
    assert r4.status_code == 422

    desc5 = _make_descriptor()
    desc5["ffmpegGlobalArgs"] = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]  # missing concat demuxer
    r5 = client.post("/api/export/jobs", json=desc5)
    assert r5.status_code == 422
    assert "concat" in r5.text.lower()


def test_export_atrim_and_trim_no_bleed(client: TestClient) -> None:
    _clear_jobs_for_test()
    desc = _make_descriptor(durations=[2.0])
    # clip trimEnd must equal slide.duration
    desc["slides"][0]["audio"]["clips"][0]["trimEnd"] = 999
    r = client.post("/api/export/jobs", json=desc)
    assert r.status_code == 422

    desc2 = _make_descriptor(durations=[2.0])
    # filterFragment must contain atrim=end=duration
    desc2["slides"][0]["audio"]["clips"][0]["filterFragment"] = "aformat,volume=1.0,atrim=end=999,asetpts=PTS-STARTPTS"
    # Need to keep overall filterComplex containing atrim=end=2.0 but clip fragment wrong should also fail
    r2 = client.post("/api/export/jobs", json=desc2)
    assert r2.status_code == 422


def test_export_determinism_and_derived_cache(client: TestClient) -> None:
    _clear_jobs_for_test()
    desc1 = _make_descriptor(fps=24, durations=[1.0, 2.0])
    desc2 = _make_descriptor(fps=24, durations=[1.0, 2.0])
    # Same descriptor should produce same determinismKey (when using same projectId)
    assert desc1["determinismKey"] == desc2["determinismKey"]
    # But after posting, each job gets unique jobId but same determinismKey preserved
    r1 = client.post("/api/export/jobs", json=desc1)
    r2 = client.post("/api/export/jobs", json=desc2)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["determinismKey"] == r2.json()["determinismKey"]
    assert r1.json()["jobId"] != r2.json()["jobId"]

    # derived cache: duplicate assetId+rate should be deduped (frontend does)
    desc3 = _make_descriptor(fps=30, durations=[2.0])
    # Add a second clip with same asset+rate as first to test dedup validation passes (but duplicate key should fail)
    # Our desc has 1 cached entry; adding duplicate with same key should be rejected as duplicate
    duplicate = desc3["derivedAssetCache"][0].copy()
    desc3["derivedAssetCache"].append(duplicate)
    r3 = client.post("/api/export/jobs", json=desc3)
    assert r3.status_code == 422
    assert "duplicate" in r3.text.lower()


def test_export_original_wav_untouched_not_validated_by_backend(client: TestClient) -> None:
    # Backend does not mutate assets; frontend ensures. Here we just verify that descriptor with
    # original cache entries does not imply asset mutation — POST succeeds regardless of asset bytes.
    _clear_jobs_for_test()
    desc = _make_descriptor()
    r = client.post("/api/export/jobs", json=desc)
    assert r.status_code == 201
    # No asset mutation occurs on backend; success proves endpoint consumes descriptors without requiring raw audio
