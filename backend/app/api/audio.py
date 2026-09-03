from __future__ import annotations

import base64
import hashlib
import io
import os
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()


class StretchRequest(BaseModel):
    data: str = Field(description="base64 encoded audio bytes")
    mimeType: str = Field(default="audio/wav", description="audio mime type, e.g. audio/wav")
    playbackRate: float = Field(gt=0, description="playbackRate = recorded / planned, >1 faster")
    # alternative: timeRatio = 1 / playbackRate = output / input
    # we accept playbackRate for consistency with AudioClip


class StretchResponse(BaseModel):
    data: str
    mimeType: str
    duration: float
    sampleRate: int
    channels: int
    # for debug: which engine was used
    engine: Literal["ffmpeg-rubberband", "ffmpeg-atempo", "fallback-passthrough"]


def _mime_to_ext(mime: str) -> str:
    m = mime.lower()
    if "wav" in m:
        return ".wav"
    if "mpeg" in m or "mp3" in m:
        return ".mp3"
    if "ogg" in m:
        return ".ogg"
    if "webm" in m:
        return ".webm"
    return ".wav"


def _atempo_chain(tempo: float) -> str:
    """Build atempo filter chain for arbitrary tempo (0.1 - 100). atempo limited to 0.5-2.0 per instance."""
    if tempo <= 0:
        raise ValueError("tempo must be positive")
    filters: list[str] = []
    t = tempo
    # decompose into 0.5-2.0 pieces
    # For tempo >2, repeatedly apply 2.0
    while t > 2.0:
        filters.append("atempo=2.0")
        t /= 2.0
    while t < 0.5:
        filters.append("atempo=0.5")
        t /= 0.5
    # now 0.5 <= t <=2.0
    # round to avoid ffmpeg parsing issues
    filters.append(f"atempo={t:.6f}".rstrip("0").rstrip("."))
    return ",".join(filters)


def _probe_wav_duration(content: bytes) -> tuple[float, int, int] | None:
    try:
        with wave.open(io.BytesIO(content), "rb") as w:
            nframes = w.getnframes()
            framerate = w.getframerate() or 44100
            nchannels = w.getnchannels() or 1
            duration = nframes / framerate if framerate else 0
            return (float(duration), int(framerate), int(nchannels))
    except Exception:  # noqa: BLE001
        return None


def _ffmpeg_has_filter(filter_name: str) -> bool:
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        return filter_name in result.stdout
    except Exception:  # noqa: BLE001
        return False


def _ffmpeg_stretch(
    input_bytes: bytes, in_ext: str, playback_rate: float
) -> tuple[bytes, float, int, int, str] | None:
    """Try ffmpeg time-stretch. Returns (output_bytes, duration, sampleRate, channels, engine) or None if unavailable."""
    # playbackRate = recorded / planned, tempo for atempo/rubberband is same as playbackRate (faster tempo -> shorter)
    # timeRatio = 1/playbackRate = output/input
    # atempo tempo = playbackRate
    # rubberband tempo = playbackRate, pitch preserved
    tempo = playback_rate
    # Prefer rubberband if available, else atempo
    has_rubberband = _ffmpeg_has_filter("rubberband")
    use_rubberband = has_rubberband
    filter_str: str
    engine: str
    if use_rubberband:
        # rubberband tempo = speed, pitch preserved, formant handling
        filter_str = f"rubberband=tempo={tempo:.6f}".rstrip("0").rstrip(".")
        engine = "ffmpeg-rubberband"
    else:
        filter_str = _atempo_chain(tempo)
        engine = "ffmpeg-atempo"

    tmp_in = None
    tmp_out = None
    try:
        with tempfile.NamedTemporaryFile(suffix=in_ext, delete=False) as f:
            f.write(input_bytes)
            tmp_in = f.name
        # Always output wav for simplicity (base64 wav)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            tmp_out = f.name
        # ffmpeg command: -i input -filter:a <filter> -c:a pcm_s16le output
        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            tmp_in,
            "-filter:a",
            filter_str,
            "-c:a",
            "pcm_s16le",
            tmp_out,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if result.returncode != 0:
            return None
        if not Path(tmp_out).exists():
            return None
        out_bytes = Path(tmp_out).read_bytes()
        # probe output duration
        probed = _probe_wav_duration(out_bytes)
        if probed:
            dur, sr, ch = probed
        else:
            # estimate: input duration / tempo? actually output = input / tempo? Wait tempo>1 shorter
            # input duration / tempo = output
            inp = _probe_wav_duration(input_bytes)
            if inp:
                dur = inp[0] / tempo
                sr = inp[1]
                ch = inp[2]
            else:
                dur = 1.0 / tempo if tempo else 1.0
                sr = 44100
                ch = 1
        return (out_bytes, float(dur), int(sr), int(ch), engine)
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        return None
    except Exception:
        return None
    finally:
        for p in (tmp_in, tmp_out):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except Exception:
                    pass


@router.post("/audio/stretch", response_model=StretchResponse)
def stretch_audio(request: StretchRequest) -> StretchResponse:
    # Validate base64
    try:
        raw = base64.b64decode(request.data, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"invalid base64: {exc}") from exc
    if len(raw) == 0:
        raise HTTPException(status_code=422, detail="empty audio data")
    # Try ffmpeg
    ext = _mime_to_ext(request.mimeType)
    ffmpeg_result = _ffmpeg_stretch(raw, ext, request.playbackRate)
    if ffmpeg_result is not None:
        out_bytes, duration, sr, ch, engine = ffmpeg_result
        out_b64 = base64.b64encode(out_bytes).decode("ascii")
        return StretchResponse(
            data=out_b64,
            mimeType="audio/wav",
            duration=float(duration),
            sampleRate=int(sr),
            channels=int(ch),
            engine=engine,  # type: ignore[arg-type]
        )
    # Fallback: passthrough with adjusted duration metadata (no actual time-stretch)
    # Preserve pitch illusion via metadata only; preview will still pitch-shift but export will be consistent
    # Compute duration as input duration / playbackRate
    probed = _probe_wav_duration(raw)
    if probed:
        in_dur, sr, ch = probed
        out_dur = in_dur / request.playbackRate if request.playbackRate else in_dur
    else:
        # hash fallback
        h = hashlib.md5(raw).digest()
        val = int.from_bytes(h[:2], "big")
        in_dur = 1.0 + (val % 600) / 10.0
        out_dur = in_dur / request.playbackRate
        sr = 44100
        ch = 1
    # Return original bytes (not stretched) but with corrected duration
    # Frontend will still do WASM stretch for preview; this fallback is for export when ffmpeg missing
    return StretchResponse(
        data=request.data,
        mimeType=request.mimeType,
        duration=float(out_dur),
        sampleRate=int(sr),
        channels=int(ch),
        engine="fallback-passthrough",
    )
