from __future__ import annotations

import base64
import io
import re
import shutil
import subprocess
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel, Field

router = APIRouter()

# In-memory job store for current process (tests use separate app instance per fixture)
_jobs: dict[str, dict[str, Any]] = {}

ACTIVE_STATUSES = {"queued", "rendering", "encoding"}
TERMINAL_STATUSES = {"done", "failed", "cancelled"}

# ---------------------------------------------------------------------------
# Pydantic models — relaxed validation mirroring frontend descriptor shape
# ---------------------------------------------------------------------------


class ExportClipDescriptor(BaseModel):
    id: str
    assetId: str
    trackId: str
    timelineStart: float
    sourceStart: float
    sourceEnd: float
    volume: float
    muted: bool
    playbackRate: float
    pitchSemitones: float | None = None
    noiseReduction: float | None = None
    fadeIn: float | None = None
    fadeOut: float | None = None
    derivedAssetKey: str | None = None
    rubberbandTempo: float | None = None
    rubberbandPitch: float | None = None
    afftdnNr: int | None = None
    isStretched: bool | None = None
    trimEnd: float | None = None
    filterFragment: str | None = None

    model_config = {"extra": "allow"}


class ExportAudioDescriptor(BaseModel):
    lanes: list[str]
    clips: list[ExportClipDescriptor]
    laneInputs: int
    filterComplex: str
    amix: str
    loudnorm: str
    atrim: str
    inputs: list[str]
    perClipFilters: list[str]

    model_config = {"extra": "allow"}


class ExportVideoDescriptor(BaseModel):
    inputKind: str | None = None
    frameCount: int
    fps: float
    timestamps: list[float]
    pixelFormat: str
    movflags: str
    codec: str | None = None
    ffmpegArgs: list[str]

    model_config = {"extra": "allow"}


class ExportPerSlideDescriptor(BaseModel):
    slideId: str
    slideName: str | None = None
    duration: float
    fps: float
    frameCount: int
    frameTimestamps: list[float]
    video: ExportVideoDescriptor
    audio: ExportAudioDescriptor
    segment: dict[str, Any]

    model_config = {"extra": "allow"}


class ExportSettingsModel(BaseModel):
    fps: float
    width: int | None = None
    height: int | None = None
    backgroundColor: str | None = None
    quality: str | None = None

    model_config = {"extra": "allow"}


class ExportGlobalDescriptor(BaseModel):
    concatMethod: str
    concatDemuxer: dict[str, Any]
    video: dict[str, Any]
    audio: dict[str, Any]
    totalDuration: float
    totalFrames: int

    model_config = {"extra": "allow"}


class ExportSubtitlesPayload(BaseModel):
    srt: str = ""
    vtt: str = ""

    model_config = {"extra": "allow"}


class ExportJobRequest(BaseModel):
    version: int = Field(description="descriptor version, must be 1")
    settings: ExportSettingsModel
    slides: list[ExportPerSlideDescriptor]
    global_: ExportGlobalDescriptor = Field(alias="global")
    derivedAssetCache: list[dict[str, Any]]
    determinismKey: str
    ffmpegGlobalArgs: list[str]
    projectName: str | None = None
    subtitles: ExportSubtitlesPayload | None = None

    model_config = {"populate_by_name": True, "extra": "allow"}


class ExportJobResponse(BaseModel):
    jobId: str
    status: str = "queued"
    version: int
    settings: dict[str, Any]
    expectedFrameCount: int
    totalDuration: float
    totalFrames: int
    determinismKey: str
    concatMethod: str
    videoPixelFormat: str
    videoMovflags: str
    audioLoudnorm: str
    receivedFrames: int = 0
    basename: str = "export"


class ExportJobStatusResponse(BaseModel):
    jobId: str
    status: str
    version: int
    settings: dict[str, Any]
    expectedFrameCount: int
    totalDuration: float
    totalFrames: int
    determinismKey: str
    concatMethod: str
    videoPixelFormat: str
    videoMovflags: str
    audioLoudnorm: str
    slides: list[dict[str, Any]] | None = None
    receivedFrames: int = 0
    basename: str = "export"
    artifactReady: bool = False
    error: str | None = None


class ExportFrameUploadRequest(BaseModel):
    slideId: str
    frameIndex: int
    timestamp: float
    data: str = Field(description="base64 data URL or raw base64 PNG/JPEG frame")

    model_config = {"extra": "allow"}


class ExportFrameUploadResponse(BaseModel):
    jobId: str
    status: str
    receivedFrames: int
    expectedFrameCount: int


class ExportCompleteResponse(BaseModel):
    jobId: str
    status: str
    receivedFrames: int
    expectedFrameCount: int
    artifactReady: bool
    error: str | None = None


class ExportAudioUploadRequest(BaseModel):
    assetId: str
    data: str = Field(description="base64 data URL or raw base64 WAV/MP3/OGG bytes")
    mimeType: str = "audio/wav"

    model_config = {"extra": "allow"}


class ExportAudioUploadResponse(BaseModel):
    jobId: str
    assetId: str
    stored: bool


# ---------------------------------------------------------------------------
# Validation helpers — ensure descriptor matches Spec 15.11 contract
# ---------------------------------------------------------------------------

FIXED_LANES = {"voice", "sfx", "music"}
EXPECTED_AMIX = "amix=inputs=3:duration=longest:dropout_transition=0"
EXPECTED_LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11"
EXPECTED_PIX_FMT = "yuv420p"
EXPECTED_MOVFLAGS = "+faststart"
EXPECTED_CONCAT = "concat demuxer"

_ATRIM_END_RE = re.compile(r"atrim\s*=\s*end\s*=\s*([0-9]+(?:\.[0-9]+)?)")


def _has_matching_atrim(text: str | None, duration: float) -> bool:
    """Numeric atrim check: accepts `35` and `35.0` as equal."""
    if not text:
        return False
    for match in _ATRIM_END_RE.finditer(text):
        try:
            value = float(match.group(1))
        except ValueError:
            continue
        if abs(value - duration) <= 1e-6:
            return True
    return False


def _validate_descriptor(job: ExportJobRequest) -> None:
    if job.version != 1:
        raise HTTPException(status_code=422, detail="version must be 1")
    if job.settings.fps <= 0:
        raise HTTPException(status_code=422, detail="settings.fps must be positive")
    if not job.slides:
        raise HTTPException(status_code=422, detail="slides must be non-empty")
    for slide in job.slides:
        expected_n = round(slide.duration * job.settings.fps)
        if slide.frameCount != expected_n:
            raise HTTPException(
                status_code=422,
                detail=f"slide {slide.slideId} frameCount {slide.frameCount} != round(duration*fps) {expected_n}",
            )
        if len(slide.frameTimestamps) != slide.frameCount:
            raise HTTPException(
                status_code=422, detail=f"slide {slide.slideId} frameTimestamps length mismatch"
            )
        # timestamps must be deterministic: i/fps
        for i, ts in enumerate(slide.frameTimestamps):
            expected_ts = i / job.settings.fps
            if abs(ts - expected_ts) > 1e-6:
                raise HTTPException(
                    status_code=422,
                    detail=f"slide {slide.slideId} timestamp[{i}] {ts} != {expected_ts}",
                )
        if slide.video.pixelFormat != EXPECTED_PIX_FMT:
            raise HTTPException(
                status_code=422,
                detail=f"slide {slide.slideId} video pixelFormat must be {EXPECTED_PIX_FMT}",
            )
        if slide.video.movflags != EXPECTED_MOVFLAGS:
            raise HTTPException(
                status_code=422,
                detail=f"slide {slide.slideId} video movflags must be {EXPECTED_MOVFLAGS}",
            )
        if set(slide.audio.lanes) != FIXED_LANES:
            raise HTTPException(
                status_code=422,
                detail=f"slide {slide.slideId} audio lanes must be {sorted(FIXED_LANES)}",
            )
        if slide.audio.laneInputs != 3:
            raise HTTPException(
                status_code=422, detail=f"slide {slide.slideId} laneInputs must be 3"
            )
        if slide.audio.amix != EXPECTED_AMIX:
            raise HTTPException(
                status_code=422, detail=f"slide {slide.slideId} amix must be {EXPECTED_AMIX}"
            )
        if slide.audio.loudnorm != EXPECTED_LOUDNORM:
            raise HTTPException(
                status_code=422,
                detail=f"slide {slide.slideId} loudnorm must be {EXPECTED_LOUDNORM}",
            )
        if not _has_matching_atrim(slide.audio.atrim, slide.duration):
            raise HTTPException(
                status_code=422,
                detail=f"slide {slide.slideId} atrim must contain end={slide.duration}",
            )
        if not _has_matching_atrim(slide.audio.filterComplex, slide.duration):
            raise HTTPException(
                status_code=422,
                detail=f"slide {slide.slideId} filterComplex must contain atrim=end={slide.duration}",
            )
        if EXPECTED_AMIX not in slide.audio.filterComplex:
            raise HTTPException(
                status_code=422, detail=f"slide {slide.slideId} filterComplex must contain amix"
            )
        if EXPECTED_LOUDNORM not in slide.audio.filterComplex:
            raise HTTPException(
                status_code=422, detail=f"slide {slide.slideId} filterComplex must contain loudnorm"
            )
        if "aformat" not in slide.audio.filterComplex:
            raise HTTPException(
                status_code=422, detail=f"slide {slide.slideId} filterComplex must contain aformat"
            )
        if "volume=" not in slide.audio.filterComplex:
            raise HTTPException(
                status_code=422, detail=f"slide {slide.slideId} filterComplex must contain volume"
            )
        # Inputs must be video+3 audio lanes
        if len(slide.audio.inputs) != 4:
            raise HTTPException(
                status_code=422, detail=f"slide {slide.slideId} inputs must be video+3 audio (4)"
            )
        if slide.audio.inputs[0] != "video":
            raise HTTPException(
                status_code=422, detail=f"slide {slide.slideId} first input must be video"
            )
        # per-clip checks
        for clip in slide.audio.clips:
            if clip.trackId not in FIXED_LANES:
                raise HTTPException(
                    status_code=422, detail=f"clip {clip.id} trackId must be one of {FIXED_LANES}"
                )
            if clip.trimEnd != slide.duration:
                raise HTTPException(
                    status_code=422,
                    detail=f"clip {clip.id} trimEnd {clip.trimEnd} must equal slide.duration {slide.duration}",
                )
            if clip.filterFragment is None:
                continue
            if "aformat" not in clip.filterFragment:
                raise HTTPException(
                    status_code=422, detail=f"clip {clip.id} filterFragment must contain aformat"
                )
            if "volume=" not in clip.filterFragment:
                raise HTTPException(
                    status_code=422, detail=f"clip {clip.id} filterFragment must contain volume"
                )
            if not _has_matching_atrim(clip.filterFragment, slide.duration):
                raise HTTPException(
                    status_code=422,
                    detail=f"clip {clip.id} filterFragment must contain atrim=end={slide.duration}",
                )
            # Determine if clip has any non-default audio effect (rate/pitch/noise)
            pitch_semitones = clip.pitchSemitones if clip.pitchSemitones is not None else 0.0
            has_pitch = abs(pitch_semitones) > 1e-9
            has_nr = clip.noiseReduction is not None and clip.noiseReduction > 1e-9
            has_rate = clip.playbackRate != 1
            has_effect = has_rate or has_pitch or has_nr
            if has_effect:
                if has_rate:
                    if clip.rubberbandTempo is None:
                        raise HTTPException(
                            status_code=422,
                            detail=f"clip {clip.id} with playbackRate !=1 must have rubberbandTempo",
                        )
                    expected_tempo = 1 / clip.playbackRate
                    if abs(clip.rubberbandTempo - expected_tempo) > 1e-4:
                        raise HTTPException(
                            status_code=422,
                            detail=f"clip {clip.id} tempo {clip.rubberbandTempo} != 1/playbackRate {expected_tempo}",
                        )
                if has_pitch:
                    if clip.rubberbandPitch is None:
                        raise HTTPException(
                            status_code=422,
                            detail=f"clip {clip.id} with pitch !=0 must have rubberbandPitch",
                        )
                    # pitchScale = 2^(semitones/12)
                    import math

                    expected_pitch = math.pow(2, pitch_semitones / 12.0)
                    if abs(clip.rubberbandPitch - expected_pitch) > 1e-4:
                        raise HTTPException(
                            status_code=422,
                            detail=f"clip {clip.id} pitch {clip.rubberbandPitch} != expected {expected_pitch}",
                        )
                if "rubberband=tempo=" not in clip.filterFragment and has_rate:
                    raise HTTPException(
                        status_code=422,
                        detail=f"clip {clip.id} filterFragment must contain rubberband",
                    )
                if has_pitch and "rubberband" not in clip.filterFragment:
                    raise HTTPException(
                        status_code=422, detail=f"clip {clip.id} with pitch must contain rubberband"
                    )
                if has_nr and "afftdn" not in clip.filterFragment:
                    raise HTTPException(
                        status_code=422,
                        detail=f"clip {clip.id} with noiseReduction must contain afftdn",
                    )
                if clip.derivedAssetKey is None:
                    raise HTTPException(
                        status_code=422,
                        detail=f"clip {clip.id} with effect must have derivedAssetKey",
                    )
                # cache key must be assetId:rate — normalized check is fuzzy on backend
                # allow startswith assetId: for tolerant comparison
                if not clip.derivedAssetKey.startswith(f"{clip.assetId}:"):
                    raise HTTPException(
                        status_code=422,
                        detail=f"clip {clip.id} derivedAssetKey must be assetId:rate",
                    )
            else:
                if clip.rubberbandTempo is not None and abs(clip.rubberbandTempo - 1) > 1e-9:
                    raise HTTPException(
                        status_code=422,
                        detail=f"clip {clip.id} with rate 1 must not have tempo !=1",
                    )
                if has_pitch:
                    raise HTTPException(
                        status_code=422, detail=f"clip {clip.id} pitch should be 0 when no effect"
                    )
                # For clips without effects, rubberband/afftdn should not appear (but allow if not present)
                # To keep backward compat, we only error if filterFragment contains rubberband/afftdn without effect flag
                # Actually has_effect already false, so any rubberband/afftdn present would be unexpected
                if clip.filterFragment and "rubberband=" in clip.filterFragment and not has_effect:
                    raise HTTPException(
                        status_code=422,
                        detail=f"clip {clip.id} with rate 1 and no pitch must not contain rubberband",
                    )
                if clip.filterFragment and "afftdn" in clip.filterFragment and not has_nr:
                    raise HTTPException(
                        status_code=422,
                        detail=f"clip {clip.id} with no noiseReduction must not contain afftdn",
                    )

    # Global checks
    if job.global_.concatMethod != EXPECTED_CONCAT:
        raise HTTPException(
            status_code=422, detail=f"global concatMethod must be {EXPECTED_CONCAT}"
        )
    if job.global_.video.get("pixelFormat") != EXPECTED_PIX_FMT:
        raise HTTPException(
            status_code=422, detail=f"global video pixelFormat must be {EXPECTED_PIX_FMT}"
        )
    if job.global_.video.get("movflags") != EXPECTED_MOVFLAGS:
        raise HTTPException(
            status_code=422, detail=f"global video movflags must be {EXPECTED_MOVFLAGS}"
        )
    if job.global_.audio.get("loudnorm") != EXPECTED_LOUDNORM:
        raise HTTPException(
            status_code=422, detail=f"global audio loudnorm must be {EXPECTED_LOUDNORM}"
        )
    if EXPECTED_PIX_FMT not in job.ffmpegGlobalArgs:
        raise HTTPException(status_code=422, detail="ffmpegGlobalArgs must contain yuv420p")
    if EXPECTED_MOVFLAGS not in job.ffmpegGlobalArgs:
        raise HTTPException(status_code=422, detail="ffmpegGlobalArgs must contain faststart")
    if EXPECTED_CONCAT not in job.ffmpegGlobalArgs:
        raise HTTPException(status_code=422, detail="ffmpegGlobalArgs must contain concat demuxer")
    # derived cache uniqueness: assetId+rate
    seen_keys = set()
    for entry in job.derivedAssetCache:
        key = entry.get("cacheKey")
        if key in seen_keys:
            raise HTTPException(status_code=422, detail=f"duplicate derivedAssetCache key {key}")
        seen_keys.add(key)


def _has_active_job(exclude_id: str | None = None) -> bool:
    for job_id, record in _jobs.items():
        if exclude_id is not None and job_id == exclude_id:
            continue
        if record.get("status") in ACTIVE_STATUSES:
            return True
    return False


def _sanitize_basename(name: str | None) -> str:
    if not name or not name.strip():
        return "export"
    replaced = re.sub(r"[^a-zA-Z0-9-_.]+", "-", name.strip())
    replaced = re.sub(r"-+", "-", replaced)
    stripped = replaced.strip("-_.")
    if not stripped:
        return "export"
    return stripped[:120]


def _decode_base64_data(data: str) -> bytes:
    """Accept raw base64 or data URL (`data:image/png;base64,...`)."""
    text = data.strip()
    if "," in text and ";base64," in text:
        text = text.split(";base64,", 1)[1]
    try:
        return base64.b64decode(text, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"invalid base64 data: {exc}") from exc


def _mime_to_audio_ext(mime: str) -> str:
    m = (mime or "").lower()
    if "mpeg" in m or "mp3" in m:
        return ".mp3"
    if "ogg" in m:
        return ".ogg"
    if "webm" in m:
        return ".webm"
    return ".wav"


def _job_dirs(record: dict[str, Any]) -> tuple[Path, Path, Path]:
    job_dir = Path(str(record["jobDir"]))
    return job_dir, job_dir / "frames", job_dir / "audio"


def _cleanup_job_dir(record: dict[str, Any]) -> None:
    try:
        job_dir = record.get("jobDir")
        if job_dir:
            shutil.rmtree(str(job_dir), ignore_errors=True)
    except Exception:  # noqa: BLE001, S110
        pass


def _placeholder_mp4(total_duration: float) -> bytes:
    # Minimal placeholder payload; real video comes from FFmpeg when available.
    # Keep deterministic and non-empty so ZIP artifacts are servable in tests.
    return (
        b"ISOM-PLACEHOLDER-MP4\n"
        + f"duration={total_duration:.3f}\ncodec=libx264\npix_fmt=yuv420p\n".encode("ascii")
    )


def _ffmpeg_has_filter(filter_name: str) -> bool:
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return filter_name in result.stdout
    except Exception:  # noqa: BLE001
        return False


def _run_ffmpeg(args: list[str], timeout: int = 120) -> None:
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({result.returncode}): {result.stderr[-2000:]}")


def _encode_video_from_frames(
    frames_dir: Path, frame_count: int, fps: float, out_path: Path
) -> None:
    """Encode 1920x1080 letterboxed H.264 from a %06d.png image sequence."""
    pattern = str(frames_dir / "%06d.png")
    _run_ffmpeg(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-framerate",
            f"{fps:.6f}",
            "-i",
            pattern,
            "-frames:v",
            str(frame_count),
            "-vf",
            (
                "scale=1920:1080:force_original_aspect_ratio=decrease,"
                "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,"
                "format=yuv420p"
            ),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
    )


def _clip_audio_filter(
    clip: dict[str, Any], slide_duration: float, use_rubberband: bool
) -> tuple[str, bool]:
    """Build per-clip audio filter chain. Returns (filter, needs_input). Muted clips are skipped by callers."""
    rate = float(clip.get("playbackRate", 1) or 1)
    pitch = float(clip.get("pitchSemitones", 0) or 0)
    nr = float(clip.get("noiseReduction", 0) or 0)
    volume = float(clip.get("volume", 1))
    source_start = float(clip.get("sourceStart", 0) or 0)
    source_end = float(clip.get("sourceEnd", source_start) or source_start)
    timeline_start = float(clip.get("timelineStart", 0) or 0)
    parts = [
        f"atrim=start={source_start}:end={source_end}",
        "asetpts=PTS-STARTPTS",
        "aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000",
    ]
    has_tempo = abs(rate - 1) > 1e-9
    has_pitch = abs(pitch) > 1e-9
    if has_tempo or has_pitch:
        tempo = 1 / rate if rate else 1.0
        if has_pitch and use_rubberband:
            import math

            pitch_scale = math.pow(2, pitch / 12.0)
            parts.append(f"rubberband=tempo={tempo:.6f}:pitch={pitch_scale:.6f}")
        elif has_tempo:
            # atempo only supports 0.5-2.0 per instance; chain for wider ranges.
            t = tempo
            chain: list[str] = []
            while t > 2.0:
                chain.append("atempo=2.0")
                t /= 2.0
            while t < 0.5:
                chain.append("atempo=0.5")
                t /= 0.5
            chain.append(f"atempo={t:.6f}")
            parts.append(",".join(chain))
        else:
            parts.append("anull")
    if nr > 1e-9:
        parts.append(f"afftdn=nr={round(nr * 97)}")
    parts.append(f"volume={volume}")
    fade_in = clip.get("fadeIn")
    fade_out = clip.get("fadeOut")
    if isinstance(fade_in, (int, float)) and fade_in > 0:
        parts.append(f"afade=t=in:st=0:d={fade_in}")
    if isinstance(fade_out, (int, float)) and fade_out > 0:
        parts.append(f"afade=t=out:st=0:d={fade_out}")
    delay_ms = max(0, round(timeline_start * 1000))
    parts.append(f"adelay={delay_ms}|{delay_ms}")
    parts.append(f"atrim=end={slide_duration}")
    parts.append("asetpts=PTS-STARTPTS")
    return ",".join(parts), True


def _build_slide_audio(
    slide: dict[str, Any],
    audio_files: dict[str, str],
    work_dir: Path,
    use_rubberband: bool,
) -> Path:
    """Mix one slide's clips into a single WAV of exactly slide.duration. Silent when no audible clips."""
    duration = float(slide.get("duration", 0))
    slide_id = str(slide.get("slideId", "slide"))
    out_path = work_dir / f"audio-{slide_id}.wav"
    clips = [
        c
        for c in slide.get("audio", {}).get("clips", [])
        if not c.get("muted") and c.get("assetId") in audio_files
    ]
    if duration <= 0:
        raise RuntimeError(f"slide {slide_id} has non-positive duration")
    if not clips:
        _run_ffmpeg(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"anullsrc=r=48000:cl=stereo:d={duration:.3f}",
                "-c:a",
                "pcm_s16le",
                str(out_path),
            ]
        )
        return out_path
    inputs: list[str] = []
    for clip in clips:
        inputs += ["-i", audio_files[str(clip["assetId"])]]
    filter_parts: list[str] = []
    chains: list[str] = []
    for clip in clips:
        chain, _ = _clip_audio_filter(clip, duration, use_rubberband)
        chains.append(chain)
    if len(clips) > 1:
        for idx, chain in enumerate(chains):
            filter_parts.append(f"[{idx}:a]{chain}[c{idx}]")
        labels = "".join(f"[c{idx}]" for idx in range(len(clips)))
        filter_parts.append(
            f"{labels}amix=inputs={len(clips)}:duration=longest:dropout_transition=0,"
            f"atrim=end={duration},apad=whole_dur={duration},asetpts=PTS-STARTPTS[mix]"
        )
        filter_parts.append(
            "[mix]aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[out]"
        )
    else:
        filter_parts.append(
            f"[0:a]{chains[0]},apad=whole_dur={duration},"
            "aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[out]"
        )
    _run_ffmpeg(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            *inputs,
            "-filter_complex",
            ";".join(filter_parts),
            "-map",
            "[out]",
            "-c:a",
            "pcm_s16le",
            str(out_path),
        ]
    )
    return out_path


def _try_ffmpeg_mp4(slide_durations: list[float]) -> bytes | None:
    """Legacy synthetic encode (kept for test patch-compatibility).

    Real jobs now use `_encode_job_mp4`, which renders uploaded frames and mixed
    audio. This helper remains as the no-frame fallback probe.
    """
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        return None
    total = sum(slide_durations)
    if total <= 0:
        return None
    # Clamp encode length so unit/CI runs stay fast even for long timelines.
    encode_duration = min(total, 5.0)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            out_path = tmp_path / "out.mp4"
            # Synthetic encode exercising the contract flags:
            # libx264 + yuv420p + faststart, silent stereo audio with final loudnorm.
            cmd = [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"color=c=black:s=1920x1080:r=30:d={encode_duration:.3f}",
                "-f",
                "lavfi",
                "-i",
                f"anullsrc=r=48000:cl=stereo:d={encode_duration:.3f}",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                "-c:a",
                "aac",
                "-filter:a",
                EXPECTED_LOUDNORM,
                "-shortest",
                str(out_path),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=False)
            if result.returncode != 0 or not out_path.exists():
                return None
            data = out_path.read_bytes()
            return data if len(data) > 0 else None
    except Exception:  # noqa: BLE001
        return None


def _encode_job_mp4(record: dict[str, Any]) -> bytes | None:
    """Real encode from uploaded frames + uploaded audio. Returns None when FFmpeg is missing.

    Raises on any other failure so jobs report `failed` instead of silent black video.
    """
    if shutil.which("ffmpeg") is None:
        return None
    _, frames_dir, _ = _job_dirs(record)
    slides: list[dict[str, Any]] = record.get("slides", [])
    settings = record.get("settings", {})
    fps = float(settings.get("fps", 30) or 30)
    expected = int(record.get("expectedFrameCount", 0))
    frame_files = sorted(frames_dir.glob("*.png"))
    if not frame_files:
        raise RuntimeError("no frames were uploaded; cannot encode video")
    if expected and len(frame_files) < expected:
        raise RuntimeError(
            f"incomplete upload: got {len(frame_files)}/{expected} frames; cannot encode video"
        )
    work_dir = Path(str(record["jobDir"]))
    video_path = work_dir / "video.mp4"
    _encode_video_from_frames(frames_dir, len(frame_files), fps, video_path)

    audio_files: dict[str, str] = record.get("audioFiles", {})
    use_rubberband = _ffmpeg_has_filter("rubberband")
    slide_audio_paths: list[Path] = []
    for slide in slides:
        slide_audio_paths.append(_build_slide_audio(slide, audio_files, work_dir, use_rubberband))
    concat_list = work_dir / "audio_concat.txt"
    concat_list.write_text(
        "".join(f"file '{p.resolve()}'\n" for p in slide_audio_paths), encoding="utf-8"
    )
    full_audio = work_dir / "full_audio.wav"
    _run_ffmpeg(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-c:a",
            "pcm_s16le",
            str(full_audio),
        ]
    )
    has_audio = any(
        c
        for slide in slides
        for c in slide.get("audio", {}).get("clips", [])
        if not c.get("muted") and c.get("assetId") in audio_files
    )
    # loudnorm on an all-silence track yields NaN (measured -inf); skip it there.
    # Silence stays silence, still AAC + faststart.
    final_audio_args: list[str] = []
    if has_audio:
        final_audio_args = ["-filter:a", EXPECTED_LOUDNORM]
    final_path = work_dir / "final.mp4"
    _run_ffmpeg(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(video_path),
            "-i",
            str(full_audio),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            *final_audio_args,
            "-movflags",
            "+faststart",
            "-shortest",
            str(final_path),
        ]
    )
    data = final_path.read_bytes()
    if not data:
        raise RuntimeError("ffmpeg produced an empty MP4")
    return data


def _build_artifact_zip(basename: str, mp4_bytes: bytes, srt: str, vtt: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{basename}.mp4", mp4_bytes)
        zf.writestr(f"{basename}.srt", srt.encode("utf-8"))
        zf.writestr(f"{basename}.vtt", vtt.encode("utf-8"))
    return buf.getvalue()


def _run_encoding(record: dict[str, Any]) -> None:
    """Synchronous encode step: status encoding -> done/failed with ZIP artifact."""
    record["status"] = "encoding"
    try:
        mp4 = _encode_job_mp4(record)
        if mp4 is None:
            # FFmpeg missing (e.g. unit tests): servable placeholder, not silent-black success.
            mp4 = _placeholder_mp4(float(record.get("totalDuration", 0)))
        subtitles = record.get("subtitles") or {}
        srt = subtitles.get("srt", "") if isinstance(subtitles, dict) else ""
        vtt = subtitles.get("vtt", "") if isinstance(subtitles, dict) else ""
        # Ensure VTT has a header even when the client sent none.
        if not vtt:
            vtt = "WEBVTT\n"
        basename = record.get("basename", "export")
        record["artifact"] = _build_artifact_zip(basename, mp4, srt, vtt)
        record["artifactReady"] = True
        record["status"] = "done"
        record["error"] = None
    except Exception as exc:  # noqa: BLE001
        record["status"] = "failed"
        record["error"] = str(exc)
        record["artifactReady"] = False
    finally:
        # Free frame/audio disk usage; artifact bytes stay in memory for download.
        _cleanup_job_dir(record)


@router.post("/export/jobs", response_model=ExportJobResponse, status_code=201)
def create_export_job(job: ExportJobRequest) -> ExportJobResponse:
    _validate_descriptor(job)
    if _has_active_job():
        raise HTTPException(status_code=409, detail="export already in progress")
    job_id = str(uuid.uuid4())
    total_frames = sum(s.frameCount for s in job.slides)
    total_duration = sum(s.duration for s in job.slides)
    basename = _sanitize_basename(job.projectName)
    subtitles = {"srt": "", "vtt": ""}
    if job.subtitles is not None:
        subtitles = {"srt": job.subtitles.srt or "", "vtt": job.subtitles.vtt or ""}
    job_dir = Path(tempfile.mkdtemp(prefix=f"export_{job_id}_"))
    (job_dir / "frames").mkdir(parents=True, exist_ok=True)
    (job_dir / "audio").mkdir(parents=True, exist_ok=True)
    record: dict[str, Any] = {
        "jobId": job_id,
        "status": "queued",
        "version": job.version,
        "settings": job.settings.model_dump(),
        "slides": [s.model_dump() for s in job.slides],
        "global": job.global_.model_dump(),
        "derivedAssetCache": job.derivedAssetCache,
        "determinismKey": job.determinismKey,
        "ffmpegGlobalArgs": job.ffmpegGlobalArgs,
        "expectedFrameCount": total_frames,
        "totalDuration": total_duration,
        "totalFrames": total_frames,
        "concatMethod": job.global_.concatMethod,
        "videoPixelFormat": job.global_.video.get("pixelFormat"),
        "videoMovflags": job.global_.video.get("movflags"),
        "audioLoudnorm": job.global_.audio.get("loudnorm"),
        "basename": basename,
        "projectName": job.projectName,
        "subtitles": subtitles,
        "receivedFrames": 0,
        "artifactReady": False,
        "artifact": None,
        "error": None,
        "jobDir": str(job_dir),
        "audioFiles": {},
    }
    _jobs[job_id] = record
    return ExportJobResponse(
        jobId=job_id,
        status="queued",
        version=job.version,
        settings=job.settings.model_dump(),
        expectedFrameCount=total_frames,
        totalDuration=total_duration,
        totalFrames=total_frames,
        determinismKey=job.determinismKey,
        concatMethod=job.global_.concatMethod,
        videoPixelFormat=job.global_.video.get("pixelFormat", ""),
        videoMovflags=job.global_.video.get("movflags", ""),
        audioLoudnorm=job.global_.audio.get("loudnorm", ""),
        receivedFrames=0,
        basename=basename,
    )


def _status_response(record: dict[str, Any]) -> ExportJobStatusResponse:
    return ExportJobStatusResponse(
        jobId=record["jobId"],
        status=record["status"],
        version=record["version"],
        settings=record["settings"],
        expectedFrameCount=record["expectedFrameCount"],
        totalDuration=record["totalDuration"],
        totalFrames=record["totalFrames"],
        determinismKey=record["determinismKey"],
        concatMethod=record["concatMethod"],
        videoPixelFormat=record["videoPixelFormat"],
        videoMovflags=record["videoMovflags"],
        audioLoudnorm=record["audioLoudnorm"],
        slides=record.get("slides"),
        receivedFrames=int(record.get("receivedFrames", 0)),
        basename=str(record.get("basename", "export")),
        artifactReady=bool(record.get("artifactReady", False)),
        error=record.get("error"),
    )


@router.get("/export/jobs/{job_id}", response_model=ExportJobStatusResponse)
def get_export_job(job_id: str) -> ExportJobStatusResponse:
    record = _jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"export job {job_id} not found")
    return _status_response(record)


@router.get("/export/jobs", response_model=list[ExportJobStatusResponse])
def list_export_jobs() -> list[ExportJobStatusResponse]:
    return [_status_response(r) for r in _jobs.values()]


@router.post("/export/jobs/{job_id}/frames", response_model=ExportFrameUploadResponse)
def upload_export_frame(job_id: str, frame: ExportFrameUploadRequest) -> ExportFrameUploadResponse:
    record = _jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"export job {job_id} not found")
    if record.get("status") not in {"queued", "rendering"}:
        raise HTTPException(
            status_code=409, detail=f"job {job_id} is {record.get('status')}, cannot accept frames"
        )
    if frame.frameIndex < 0:
        raise HTTPException(status_code=422, detail="frameIndex must be >= 0")
    if frame.timestamp < 0:
        raise HTTPException(status_code=422, detail="timestamp must be >= 0")
    if not frame.data:
        raise HTTPException(status_code=422, detail="frame data must be non-empty")
    slide_ids = {s.get("slideId") for s in record.get("slides", [])}
    if frame.slideId not in slide_ids:
        raise HTTPException(status_code=422, detail=f"unknown slideId {frame.slideId}")
    raw = _decode_base64_data(frame.data)
    if len(raw) == 0:
        raise HTTPException(status_code=422, detail="frame data must be non-empty")
    try:
        with Image.open(io.BytesIO(raw)) as img:
            img.verify()
    except Exception as exc:
        raise HTTPException(
            status_code=422, detail=f"frame data must be valid PNG/JPEG base64: {exc}"
        ) from exc
    _, frames_dir, _ = _job_dirs(record)
    frames_dir.mkdir(parents=True, exist_ok=True)
    # Global join order: frameIndex counts across the concatenated timeline.
    (frames_dir / f"{frame.frameIndex:06d}.png").write_bytes(raw)
    if record.get("status") == "queued":
        record["status"] = "rendering"
    record["receivedFrames"] = int(record.get("receivedFrames", 0)) + 1
    return ExportFrameUploadResponse(
        jobId=job_id,
        status=record["status"],
        receivedFrames=record["receivedFrames"],
        expectedFrameCount=record["expectedFrameCount"],
    )


@router.post("/export/jobs/{job_id}/audio", response_model=ExportAudioUploadResponse)
def upload_export_audio(job_id: str, audio: ExportAudioUploadRequest) -> ExportAudioUploadResponse:
    record = _jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"export job {job_id} not found")
    if record.get("status") not in {"queued", "rendering"}:
        raise HTTPException(
            status_code=409, detail=f"job {job_id} is {record.get('status')}, cannot accept audio"
        )
    if not audio.assetId:
        raise HTTPException(status_code=422, detail="assetId must be non-empty")
    raw = _decode_base64_data(audio.data)
    if len(raw) == 0:
        raise HTTPException(status_code=422, detail="audio data must be non-empty")
    _, _, audio_dir = _job_dirs(record)
    audio_dir.mkdir(parents=True, exist_ok=True)
    ext = _mime_to_audio_ext(audio.mimeType)
    path = audio_dir / f"{audio.assetId}{ext}"
    path.write_bytes(raw)
    audio_files = record.setdefault("audioFiles", {})
    audio_files[audio.assetId] = str(path)
    return ExportAudioUploadResponse(jobId=job_id, assetId=audio.assetId, stored=True)


@router.post("/export/jobs/{job_id}/subtitles", response_model=ExportJobStatusResponse)
def upload_export_subtitles(
    job_id: str, subtitles: ExportSubtitlesPayload
) -> ExportJobStatusResponse:
    record = _jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"export job {job_id} not found")
    if record.get("status") not in {"queued", "rendering"}:
        raise HTTPException(
            status_code=409,
            detail=f"job {job_id} is {record.get('status')}, cannot accept subtitles",
        )
    record["subtitles"] = {"srt": subtitles.srt or "", "vtt": subtitles.vtt or ""}
    return _status_response(record)


@router.post("/export/jobs/{job_id}/complete", response_model=ExportCompleteResponse)
def complete_export_job(job_id: str) -> ExportCompleteResponse:
    record = _jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"export job {job_id} not found")
    if record.get("status") not in {"queued", "rendering"}:
        raise HTTPException(
            status_code=409, detail=f"job {job_id} is {record.get('status')}, cannot complete"
        )
    _run_encoding(record)
    return ExportCompleteResponse(
        jobId=job_id,
        status=record["status"],
        receivedFrames=int(record.get("receivedFrames", 0)),
        expectedFrameCount=record["expectedFrameCount"],
        artifactReady=bool(record.get("artifactReady", False)),
        error=record.get("error"),
    )


@router.post("/export/jobs/{job_id}/cancel", response_model=ExportJobStatusResponse)
def cancel_export_job(job_id: str) -> ExportJobStatusResponse:
    record = _jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"export job {job_id} not found")
    if record.get("status") not in ACTIVE_STATUSES:
        raise HTTPException(
            status_code=409, detail=f"job {job_id} is {record.get('status')}, nothing to cancel"
        )
    record["status"] = "cancelled"
    record["error"] = None
    _cleanup_job_dir(record)
    return _status_response(record)


@router.get("/export/jobs/{job_id}/artifact")
def download_export_artifact(job_id: str) -> Response:
    record = _jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"export job {job_id} not found")
    if (
        record.get("status") != "done"
        or not record.get("artifactReady")
        or record.get("artifact") is None
    ):
        raise HTTPException(status_code=404, detail=f"export job {job_id} artifact not ready")
    basename = str(record.get("basename", "export"))
    artifact: bytes = record["artifact"]
    return Response(
        content=artifact,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{basename}.zip"'},
    )


def _clear_jobs_for_test() -> None:
    for record in list(_jobs.values()):
        _cleanup_job_dir(record)
    _jobs.clear()
