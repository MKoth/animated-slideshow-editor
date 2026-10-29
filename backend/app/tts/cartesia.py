"""Remote TTS via Cartesia (sonic-3.6).

Uses the Cartesia REST API directly with httpx (no extra dependency):
- TTS: POST https://api.cartesia.ai/tts/bytes
- Voices: GET https://api.cartesia.ai/voices

Auth: ``Authorization: Bearer $CARTESIA_API_KEY`` + ``Cartesia-Version`` header.
"""

# ruff: noqa: BLE001
from __future__ import annotations

import os
import time
from typing import Any

CARTESIA_API_BASE = "https://api.cartesia.ai"
CARTESIA_VERSION = "2026-08-14"

_VOICES_CACHE_TTL_S = 60.0
_voices_cache: dict[str, Any] = {"at": 0.0, "voices": None}


class CartesiaNotConfiguredError(RuntimeError):
    """CARTESIA_API_KEY is missing — surface as 503 with a setup hint."""


class CartesiaRequestError(ValueError):
    """Bad Cartesia request (unknown voice, unsupported language, ...) — 422."""


class CartesiaError(RuntimeError):
    """Cartesia API failure (auth, network, server) — 503/500."""


def get_cartesia_api_key() -> str | None:
    raw = os.getenv("CARTESIA_API_KEY")
    if raw is not None and raw.strip() and raw.strip() != "key_here":
        return raw.strip()
    return None


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Cartesia-Version": CARTESIA_VERSION}


def _require_key(api_key: str | None) -> str:
    key = api_key if api_key is not None else get_cartesia_api_key()
    if not key:
        raise CartesiaNotConfiguredError(
            "Cartesia is not configured: set CARTESIA_API_KEY in backend/.env "
            "(see backend/.env.example) and restart the backend"
        )
    return key


def list_cartesia_voices(
    *,
    api_key: str | None = None,
    limit: int = 100,
    is_owner: bool = True,
    query: str | None = None,
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    """List saved Cartesia voices (owner's first). Cached for 60s."""
    key = _require_key(api_key)
    now = time.monotonic()
    if (
        use_cache
        and _voices_cache["voices"] is not None
        and (now - float(_voices_cache["at"])) < _VOICES_CACHE_TTL_S
        and not query
    ):
        cached = _voices_cache["voices"]
        assert isinstance(cached, list)
        return cached
    import httpx

    params: dict[str, Any] = {"limit": max(1, min(limit, 100))}
    if is_owner:
        params["is_owner"] = "true"
    if query:
        params["q"] = query
    try:
        resp = httpx.get(
            f"{CARTESIA_API_BASE}/voices",
            headers=_headers(key),
            params=params,
            timeout=20.0,
        )
    except Exception as e:
        raise CartesiaError(f"Cartesia voices request failed: {e}") from e
    if resp.status_code in (401, 403):
        raise CartesiaError("Cartesia rejected the API key (401/403) — check CARTESIA_API_KEY")
    if resp.status_code >= 400:
        raise CartesiaError(f"Cartesia voices request failed: HTTP {resp.status_code}")
    try:
        payload = resp.json()
    except Exception as e:
        raise CartesiaError(f"Cartesia voices returned invalid JSON: {e}") from e
    data = payload.get("data", []) if isinstance(payload, dict) else []
    voices = data if isinstance(data, list) else []
    if use_cache and not query:
        _voices_cache["voices"] = voices
        _voices_cache["at"] = now
    return voices


def clear_voices_cache() -> None:
    _voices_cache["voices"] = None
    _voices_cache["at"] = 0.0


def _normalize_language(language: str | None) -> str | None:
    """Map our iso/locale input to a Cartesia language code, or None (omit)."""
    if language is None:
        return None
    raw = language.strip()
    if not raw or raw.lower() == "auto":
        return None
    primary = raw.lower().split("-")[0].split("_")[0]
    try:
        from app.tts.registry import CARTESIA_LANGUAGES
    except Exception:
        CARTESIA_LANGUAGES = ["en"]
    if primary in CARTESIA_LANGUAGES:
        return primary
    raise CartesiaRequestError(
        f"unsupported Cartesia language '{language}'; must be one of "
        f"{', '.join(sorted(CARTESIA_LANGUAGES))}"
    )


def _normalize_wav_header(data: bytes) -> bytes:
    """Rewrite streaming-style WAV sizes to real values (fail-open).

    Cartesia /tts/bytes returns fmt + LIST + data(0xFFFFFFFF = unknown length).
    Parsers that trust the declared data size (ours included, historically)
    compute garbage durations and truncate clips. Fill in the real sizes:
    RIFF size = len - 8, data size = bytes after the data chunk header.
    Returns the input unchanged if it does not look like a WAV.
    """
    import struct

    try:
        if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            return data
        out = bytearray(data)
        out[4:8] = struct.pack("<I", len(data) - 8)
        offset = 12
        while offset + 8 <= len(data):
            chunk_id = bytes(data[offset : offset + 4])
            chunk_size = struct.unpack("<I", data[offset + 4 : offset + 8])[0]
            if chunk_id == b"data":
                real_size = len(data) - offset - 8
                if real_size < 0:
                    return data
                if chunk_size != real_size:
                    out[offset + 4 : offset + 8] = struct.pack("<I", real_size)
                return bytes(out)
            if chunk_size > len(data):
                return data
            offset += 8 + chunk_size + (chunk_size % 2)
        return data
    except Exception:
        return data


def synthesize_cartesia(
    text: str,
    *,
    voice_id: str | None = None,
    language: str | None = None,
    model_id: str = "sonic-3.6",
    api_key: str | None = None,
) -> bytes:
    """Synthesize speech via Cartesia POST /tts/bytes. Returns WAV bytes."""
    from app.tts.registry import DEFAULT_CARTESIA_VOICE_ID

    key = _require_key(api_key)
    content = text.strip() if isinstance(text, str) else ""
    if not content:
        raise CartesiaRequestError("text must be a non-empty string")
    voice = (
        voice_id.strip()
        if isinstance(voice_id, str) and voice_id.strip()
        else DEFAULT_CARTESIA_VOICE_ID
    )
    locale = _normalize_language(language)
    body: dict[str, Any] = {
        "model_id": model_id,
        "transcript": content,
        "voice": {"id": voice},
        "output_format": {"container": "wav", "encoding": "pcm_s16le", "sample_rate": 44100},
    }
    if locale is not None:
        body["language"] = locale
    import httpx

    try:
        resp = httpx.post(
            f"{CARTESIA_API_BASE}/tts/bytes",
            headers={**_headers(key), "Content-Type": "application/json"},
            json=body,
            timeout=90.0,
        )
    except CartesiaRequestError:
        raise
    except Exception as e:
        raise CartesiaError(f"Cartesia TTS request failed: {e}") from e
    if resp.status_code in (401, 403):
        raise CartesiaError("Cartesia rejected the API key (401/403) — check CARTESIA_API_KEY")
    if resp.status_code == 400:
        detail = resp.text[:300]
        raise CartesiaRequestError(f"Cartesia rejected the request (400): {detail}")
    if resp.status_code == 422:
        detail = resp.text[:300]
        raise CartesiaRequestError(f"Cartesia validation error (422): {detail}")
    if resp.status_code >= 400:
        raise CartesiaError(f"Cartesia TTS failed: HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.content
    if not data or len(data) < 44 or data[:4] != b"RIFF":
        raise CartesiaError("Cartesia returned invalid WAV bytes")
    return _normalize_wav_header(bytes(data))
