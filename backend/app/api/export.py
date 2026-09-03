from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# In-memory job store for current process (tests use separate app instance per fixture)
_jobs: dict[str, dict[str, Any]] = {}

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


class ExportJobRequest(BaseModel):
    version: int = Field(description="descriptor version, must be 1")
    settings: ExportSettingsModel
    slides: list[ExportPerSlideDescriptor]
    global_: ExportGlobalDescriptor = Field(alias="global")
    derivedAssetCache: list[dict[str, Any]]
    determinismKey: str
    ffmpegGlobalArgs: list[str]

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


# ---------------------------------------------------------------------------
# Validation helpers — ensure descriptor matches Spec 15.11 contract
# ---------------------------------------------------------------------------

FIXED_LANES = {"voice", "sfx", "music"}
EXPECTED_AMIX = "amix=inputs=3:duration=longest:dropout_transition=0"
EXPECTED_LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11"
EXPECTED_PIX_FMT = "yuv420p"
EXPECTED_MOVFLAGS = "+faststart"
EXPECTED_CONCAT = "concat demuxer"


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
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} frameTimestamps length mismatch")
        # timestamps must be deterministic: i/fps
        for i, ts in enumerate(slide.frameTimestamps):
            expected_ts = i / job.settings.fps
            if abs(ts - expected_ts) > 1e-6:
                raise HTTPException(
                    status_code=422,
                    detail=f"slide {slide.slideId} timestamp[{i}] {ts} != {expected_ts}",
                )
        if slide.video.pixelFormat != EXPECTED_PIX_FMT:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} video pixelFormat must be {EXPECTED_PIX_FMT}")
        if slide.video.movflags != EXPECTED_MOVFLAGS:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} video movflags must be {EXPECTED_MOVFLAGS}")
        if set(slide.audio.lanes) != FIXED_LANES:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} audio lanes must be {sorted(FIXED_LANES)}")
        if slide.audio.laneInputs != 3:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} laneInputs must be 3")
        if slide.audio.amix != EXPECTED_AMIX:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} amix must be {EXPECTED_AMIX}")
        if slide.audio.loudnorm != EXPECTED_LOUDNORM:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} loudnorm must be {EXPECTED_LOUDNORM}")
        if f"atrim=end={slide.duration}" not in slide.audio.atrim:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} atrim must contain end={slide.duration}")
        if f"atrim=end={slide.duration}" not in slide.audio.filterComplex:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} filterComplex must contain atrim=end={slide.duration}")
        if EXPECTED_AMIX not in slide.audio.filterComplex:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} filterComplex must contain amix")
        if EXPECTED_LOUDNORM not in slide.audio.filterComplex:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} filterComplex must contain loudnorm")
        if "aformat" not in slide.audio.filterComplex:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} filterComplex must contain aformat")
        if "volume=" not in slide.audio.filterComplex:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} filterComplex must contain volume")
        # Inputs must be video+3 audio lanes
        if len(slide.audio.inputs) != 4:
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} inputs must be video+3 audio (4)")
        if slide.audio.inputs[0] != "video":
            raise HTTPException(status_code=422, detail=f"slide {slide.slideId} first input must be video")
        # per-clip checks
        for clip in slide.audio.clips:
            if clip.trackId not in FIXED_LANES:
                raise HTTPException(status_code=422, detail=f"clip {clip.id} trackId must be one of {FIXED_LANES}")
            if clip.trimEnd != slide.duration:
                raise HTTPException(
                    status_code=422, detail=f"clip {clip.id} trimEnd {clip.trimEnd} must equal slide.duration {slide.duration}"
                )
            if clip.filterFragment is None:
                continue
            if "aformat" not in clip.filterFragment:
                raise HTTPException(status_code=422, detail=f"clip {clip.id} filterFragment must contain aformat")
            if "volume=" not in clip.filterFragment:
                raise HTTPException(status_code=422, detail=f"clip {clip.id} filterFragment must contain volume")
            if f"atrim=end={slide.duration}" not in clip.filterFragment:
                raise HTTPException(
                    status_code=422, detail=f"clip {clip.id} filterFragment must contain atrim=end={slide.duration}"
                )
            # Determine if clip has any non-default audio effect (rate/pitch/noise)
            has_pitch = clip.pitchSemitones is not None and abs(clip.pitchSemitones) > 1e-9
            has_nr = clip.noiseReduction is not None and clip.noiseReduction > 1e-9
            has_rate = clip.playbackRate != 1
            has_effect = has_rate or has_pitch or has_nr
            if has_effect:
                if has_rate:
                    if clip.rubberbandTempo is None:
                        raise HTTPException(status_code=422, detail=f"clip {clip.id} with playbackRate !=1 must have rubberbandTempo")
                    expected_tempo = 1 / clip.playbackRate
                    if abs(clip.rubberbandTempo - expected_tempo) > 1e-4:
                        raise HTTPException(
                            status_code=422,
                            detail=f"clip {clip.id} tempo {clip.rubberbandTempo} != 1/playbackRate {expected_tempo}",
                        )
                if has_pitch:
                    if clip.rubberbandPitch is None:
                        raise HTTPException(status_code=422, detail=f"clip {clip.id} with pitch !=0 must have rubberbandPitch")
                    # pitchScale = 2^(semitones/12)
                    import math
                    expected_pitch = math.pow(2, clip.pitchSemitones / 12.0)
                    if abs(clip.rubberbandPitch - expected_pitch) > 1e-4:
                        raise HTTPException(status_code=422, detail=f"clip {clip.id} pitch {clip.rubberbandPitch} != expected {expected_pitch}")
                if "rubberband=tempo=" not in clip.filterFragment and has_rate:
                    raise HTTPException(status_code=422, detail=f"clip {clip.id} filterFragment must contain rubberband")
                if has_pitch and "rubberband" not in clip.filterFragment:
                    raise HTTPException(status_code=422, detail=f"clip {clip.id} with pitch must contain rubberband")
                if has_nr and "afftdn" not in clip.filterFragment:
                    raise HTTPException(status_code=422, detail=f"clip {clip.id} with noiseReduction must contain afftdn")
                if clip.derivedAssetKey is None:
                    raise HTTPException(status_code=422, detail=f"clip {clip.id} with effect must have derivedAssetKey")
                # cache key must be assetId:rate — normalized check is fuzzy on backend
                # allow startswith assetId: for tolerant comparison
                if not clip.derivedAssetKey.startswith(f"{clip.assetId}:"):
                    raise HTTPException(status_code=422, detail=f"clip {clip.id} derivedAssetKey must be assetId:rate")
            else:
                if clip.rubberbandTempo is not None and abs(clip.rubberbandTempo - 1) > 1e-9:
                    raise HTTPException(status_code=422, detail=f"clip {clip.id} with rate 1 must not have tempo !=1")
                if has_pitch:
                    raise HTTPException(status_code=422, detail=f"clip {clip.id} pitch should be 0 when no effect")
                # For clips without effects, rubberband/afftdn should not appear (but allow if not present)
                # To keep backward compat, we only error if filterFragment contains rubberband/afftdn without effect flag
                # Actually has_effect already false, so any rubberband/afftdn present would be unexpected
                if clip.filterFragment and "rubberband=" in clip.filterFragment and not has_effect:
                    raise HTTPException(status_code=422, detail=f"clip {clip.id} with rate 1 and no pitch must not contain rubberband")
                if clip.filterFragment and "afftdn" in clip.filterFragment and not has_nr:
                    raise HTTPException(status_code=422, detail=f"clip {clip.id} with no noiseReduction must not contain afftdn")

    # Global checks
    if job.global_.concatMethod != EXPECTED_CONCAT:
        raise HTTPException(status_code=422, detail=f"global concatMethod must be {EXPECTED_CONCAT}")
    if job.global_.video.get("pixelFormat") != EXPECTED_PIX_FMT:
        raise HTTPException(status_code=422, detail=f"global video pixelFormat must be {EXPECTED_PIX_FMT}")
    if job.global_.video.get("movflags") != EXPECTED_MOVFLAGS:
        raise HTTPException(status_code=422, detail=f"global video movflags must be {EXPECTED_MOVFLAGS}")
    if job.global_.audio.get("loudnorm") != EXPECTED_LOUDNORM:
        raise HTTPException(status_code=422, detail=f"global audio loudnorm must be {EXPECTED_LOUDNORM}")
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


@router.post("/export/jobs", response_model=ExportJobResponse, status_code=201)
def create_export_job(job: ExportJobRequest) -> ExportJobResponse:
    _validate_descriptor(job)
    job_id = str(uuid.uuid4())
    total_frames = sum(s.frameCount for s in job.slides)
    total_duration = sum(s.duration for s in job.slides)
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
    )


@router.get("/export/jobs/{job_id}", response_model=ExportJobStatusResponse)
def get_export_job(job_id: str) -> ExportJobStatusResponse:
    record = _jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"export job {job_id} not found")
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
    )


@router.get("/export/jobs", response_model=list[ExportJobStatusResponse])
def list_export_jobs() -> list[ExportJobStatusResponse]:
    return [
        ExportJobStatusResponse(
            jobId=r["jobId"],
            status=r["status"],
            version=r["version"],
            settings=r["settings"],
            expectedFrameCount=r["expectedFrameCount"],
            totalDuration=r["totalDuration"],
            totalFrames=r["totalFrames"],
            determinismKey=r["determinismKey"],
            concatMethod=r["concatMethod"],
            videoPixelFormat=r["videoPixelFormat"],
            videoMovflags=r["videoMovflags"],
            audioLoudnorm=r["audioLoudnorm"],
        )
        for r in _jobs.values()
    ]


def _clear_jobs_for_test() -> None:
    _jobs.clear()
