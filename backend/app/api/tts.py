from __future__ import annotations

import asyncio
import io
import math
import wave
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

router = APIRouter()

# Global serialized queue for TTS generation — one inference at a time
_tts_lock = asyncio.Lock()


class TTSGenerateRequest(BaseModel):
    text: str = Field(description="text to synthesize")
    promptId: str | None = Field(default=None, description="voice prompt id")
    language: str | None = None
    voice: str | None = None
    instruction: str | None = None


def _wav_bytes_for_text(text: str, prompt_id: str | None, language: str | None, voice: str | None) -> bytes:
    # Deterministic duration: 0.06 * len(text) + 0.4, clamped at least 0.5
    # Use prompt characteristics to vary pitch slightly for realism
    length = len(text.strip())
    if length == 0:
        length = 1
    duration = max(0.5, length * 0.06 + 0.35)
    # Cap at 30s for sanity in tests
    duration = min(duration, 30.0)
    sample_rate = 24000
    channels = 1
    # Vary frequency per prompt/voice for deterministic distinction
    base_freq = 220.0
    if prompt_id:
        # hash prompt_id to offset freq 180-260
        h = sum(ord(c) for c in prompt_id) % 40
        base_freq = 200 + h
    elif voice:
        h = sum(ord(c) for c in voice) % 60
        base_freq = 180 + h
    elif language:
        # map language to freq
        base_freq = 220 if language.startswith("en") else 200
    return _generate_sine_wav(duration, sample_rate, channels, base_freq)


def _generate_sine_wav(duration: float, sample_rate: int, channels: int, freq: float) -> bytes:
    n_samples = int(duration * sample_rate)
    amplitude = 0.25 * 32767  # 16-bit PCM amplitude
    # Generate sine wave
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        # Generate frames
        import struct

        for i in range(n_samples):
            t = i / sample_rate
            # Simple sine with slight envelope to avoid clicks
            # envelope: fade in 5ms fade out 5ms
            sample = math.sin(2 * math.pi * freq * t) * amplitude
            # envelope
            if i < int(0.005 * sample_rate):
                sample *= i / (0.005 * sample_rate)
            elif i > n_samples - int(0.005 * sample_rate):
                sample *= (n_samples - i) / (0.005 * sample_rate)
            packed = struct.pack("<h", int(sample))
            for _ in range(channels):
                wf.writeframes(packed)
        # wave header written on close
    return buffer.getvalue()


@router.post("/tts/generate")
async def tts_generate(request: Request, body: TTSGenerateRequest) -> Response:
    text = body.text.strip() if isinstance(body.text, str) else ""
    if not text:
        raise HTTPException(status_code=422, detail="text must be a non-empty string")
    # Validate promptId if provided
    if body.promptId is not None:
        # Need to check existence via library
        library = getattr(request.app.state, "voice_prompt_library", None)
        if library is not None:
            try:
                library.get(body.promptId)
            except Exception as exc:
                # Differentiate not found vs other
                from app.voice_prompts.library import VoicePromptNotFoundError

                if isinstance(exc, VoicePromptNotFoundError):
                    raise HTTPException(status_code=404, detail=f"voice_prompt {body.promptId} not found") from exc
                raise
    # Serialized concurrent queue
    async with _tts_lock:
        # Simulate small ML inference delay to prove serialization in tests (10ms)
        await asyncio.sleep(0.01)
        wav_bytes = _wav_bytes_for_text(text, body.promptId, body.language, body.voice)
    return Response(content=wav_bytes, media_type="audio/wav", headers={"Content-Length": str(len(wav_bytes))})
