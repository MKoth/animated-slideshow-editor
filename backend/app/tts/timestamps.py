"""Cartesia SSE word-timestamp segmentation.

One continuous Cartesia generation (POST /tts/sse, add_timestamps=True)
produces raw PCM + word-level timestamps. Those timestamps are mapped back
to caller-supplied block boundaries (exact char offsets into the combined
text) and the continuous audio is sliced into per-block WAVs.

Only Cartesia is supported. Other providers must be rejected at the API
layer before reaching here.

Wire format (per Cartesia docs, 2026-08-14):
  POST https://api.cartesia.ai/tts/sse
  body: {model_id, transcript, voice:{id}, output_format:{container:raw,
    encoding:pcm_s16le, sample_rate:44100}, [language|locale],
    [generation_config], add_timestamps:true}
  response: text/event-stream, frames `data: <json>\\n\\n` with type:
    chunk      -> {data: base64 PCM, step_time, status_code}
    timestamps -> {word_timestamps:{words[], start[], end[]}}
    done       -> {done:true}
    error      -> {title, message, ...}

Audio assembly: SSE only supports container raw, so chunks are raw PCM
s16le mono. They are concatenated and wrapped in a WAV header for the
existing frontend (which parses WAV headers).

Segmentation is non-overlapping by construction: neighboring blocks share
one exact cut sample (previous ends where next begins), so consecutive
playback never repeats audio. A small window around each inter-block
Cartesia timestamp is inspected for a quiet, near-zero-crossing cut;
padding is detection-only and never duplicated into both neighbors.
"""

from __future__ import annotations

import base64
import io
import math
import re
import struct
import unicodedata
import wave
from dataclasses import dataclass


class TimestampMappingError(ValueError):
    """Word timestamps could not be confidently mapped to blocks."""


class TimestampStreamError(RuntimeError):
    """SSE stream missing audio, timestamps, or interrupted."""


@dataclass(frozen=True)
class BlockBoundary:
    id: str
    text: str
    start: int
    end: int


@dataclass(frozen=True)
class WordTimestamp:
    word: str
    start: float
    end: float


@dataclass(frozen=True)
class BlockSegment:
    id: str
    start: float
    end: float
    duration: float
    pcm: bytes  # raw s16le mono slice
    words: list[str]


SAMPLE_RATE = 44100
CHANNELS = 1
SAMPLE_WIDTH = 2  # pcm_s16le

# --- Segmentation quality tuning (all seconds) ---
# Detection window around each inter-block Cartesia timestamp. The cut is a
# single shared sample: the previous segment ends where the next begins, so
# no sample is ever duplicated (no echo on consecutive playback).
BOUNDARY_SEARCH_SEC = 0.03
# RMS analysis window for boundary scoring.
BOUNDARY_ANALYSIS_WINDOW_SEC = 0.005
# Zero-crossing refinement radius around the chosen quiet point.
ZERO_CROSSING_SEC = 0.002
# Cosine fade edges applied to every extracted segment.
FADE_IN_SEC = 0.008
FADE_OUT_SEC = 0.015

_WORD_RE = re.compile(r"[^\W_]+(?:['’\-][^\W_]+)*", re.UNICODE)


def normalize_word(word: str) -> str:
    """Lowercase + NFKC + strip surrounding non-alnum for matching."""
    w = unicodedata.normalize("NFKC", word or "").lower().strip()
    start = 0
    end = len(w)
    while start < end and not w[start].isalnum():
        start += 1
    while end > start and not w[end - 1].isalnum():
        end -= 1
    return w[start:end]


def tokenize_words(text: str) -> list[str]:
    """Extract normalized word tokens, dropping pure punctuation."""
    out: list[str] = []
    for m in _WORD_RE.finditer(text or ""):
        norm = normalize_word(m.group(0))
        if norm:
            out.append(norm)
    return out


def validate_boundaries(text: str, segments: list[BlockBoundary]) -> None:
    """Exact-offset validation: slice must equal segment text."""
    if not segments:
        raise TimestampMappingError("segments must be a non-empty list")
    combined_len = len(text)
    cursor = -1
    for seg in segments:
        if not seg.id or not isinstance(seg.id, str):
            raise TimestampMappingError("each segment needs a non-empty string id")
        if not isinstance(seg.text, str):
            raise TimestampMappingError(f"segment {seg.id}: text must be a string")
        if not isinstance(seg.start, int) or not isinstance(seg.end, int):
            raise TimestampMappingError(f"segment {seg.id}: start/end must be integers")
        if seg.start < 0 or seg.end > combined_len or seg.start > seg.end:
            raise TimestampMappingError(
                f"segment {seg.id}: offsets [{seg.start},{seg.end}) out of bounds "
                f"for text length {combined_len}"
            )
        if seg.start == seg.end and seg.text != "":
            raise TimestampMappingError(f"segment {seg.id}: empty range but non-empty text")
        if text[seg.start : seg.end] != seg.text:
            raise TimestampMappingError(
                f"segment {seg.id}: text does not match combined text slice "
                f"[{seg.start},{seg.end}) — offsets must be exact"
            )
        if seg.start < cursor:
            raise TimestampMappingError(
                f"segment {seg.id}: segments must be sorted and non-overlapping"
            )
        cursor = seg.end


def parse_sse_body(body: str | bytes) -> tuple[bytes, list[WordTimestamp], int]:
    """Parse a buffered SSE body into (pcm_bytes, word_timestamps, sample_rate).

    Raises TimestampStreamError on error events, missing audio/timestamps,
    or incomplete streams (no done event).
    """
    if isinstance(body, bytes):
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError as e:
            raise TimestampStreamError(f"SSE body is not valid UTF-8: {e}") from e
    else:
        text = body

    import json as _json

    pcm_parts: list[bytes] = []
    words: list[str] = []
    starts: list[float] = []
    ends: list[float] = []
    sample_rate = SAMPLE_RATE
    seen_done = False

    # SSE frames are `data: <json>` separated by blank lines. Be liberal:
    # accept \\n\\n or \\r\\n\\r\\n separators, ignore comments/empty lines.
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(":"):
            continue
        if not line.startswith("data:"):
            continue
        payload_raw = line[len("data:") :].strip()
        if not payload_raw:
            continue
        try:
            event = _json.loads(payload_raw)
        except Exception as e:
            raise TimestampStreamError(f"invalid SSE JSON: {e}") from e
        if not isinstance(event, dict):
            continue
        etype = event.get("type")
        if etype == "chunk":
            b64 = event.get("data", "")
            if not isinstance(b64, str) or not b64:
                raise TimestampStreamError("SSE chunk event missing audio data")
            try:
                pcm_parts.append(base64.b64decode(b64))
            except Exception as e:
                raise TimestampStreamError(f"invalid base64 audio chunk: {e}") from e
        elif etype == "timestamps":
            wt = event.get("word_timestamps") or {}
            w = wt.get("words", [])
            starts_raw = wt.get("start", [])
            ends_raw = wt.get("end", [])
            if (
                not isinstance(w, list)
                or not isinstance(starts_raw, list)
                or not isinstance(ends_raw, list)
            ):
                raise TimestampStreamError("malformed word_timestamps event")
            if not (len(w) == len(starts_raw) == len(ends_raw)):
                raise TimestampStreamError("word_timestamps arrays have mismatched lengths")
            for wi, si, ei in zip(w, starts_raw, ends_raw):
                if not isinstance(wi, str):
                    raise TimestampStreamError("word_timestamps word must be a string")
                try:
                    sf = float(si)
                    ef = float(ei)
                except Exception as exc:
                    raise TimestampStreamError(
                        f"word_timestamps times must be numbers: {exc}"
                    ) from exc
                words.append(wi)
                starts.append(sf)
                ends.append(ef)
        elif etype == "done":
            seen_done = True
        elif etype == "error":
            title = event.get("title", "Cartesia error")
            message = event.get("message", "")
            raise TimestampStreamError(f"Cartesia SSE error: {title}: {message}")
        else:
            # phoneme_timestamps and unknown types are ignored.
            continue

    if not seen_done:
        raise TimestampStreamError("incomplete SSE stream: missing done event")
    if not pcm_parts:
        raise TimestampStreamError("SSE stream contained no audio chunks")
    if not words:
        raise TimestampStreamError("SSE stream contained no word timestamps")

    return (
        b"".join(pcm_parts),
        [WordTimestamp(w, s, e) for w, s, e in zip(words, starts, ends)],
        sample_rate,
    )


def map_words_to_blocks(
    segments: list[BlockBoundary],
    word_events: list[WordTimestamp],
) -> list[BlockSegmentPcmRange]:
    """Align Cartesia words to blocks via normalized token matching.

    Each block's text is tokenized; the concatenation must match the
    normalized Cartesia word sequence exactly in order. Returns per-block
    sample ranges derived from word timestamps.
    """
    expected: list[str] = []
    counts: list[int] = []
    for seg in segments:
        toks = tokenize_words(seg.text)
        if not toks:
            raise TimestampMappingError(
                f"segment {seg.id}: no mappable words (empty or punctuation-only)"
            )
        counts.append(len(toks))
        expected.extend(toks)

    actual_norm = [normalize_word(w.word) for w in word_events]
    # Drop empty normalized Cartesia tokens (should not happen, but fail loudly).
    if any(not t for t in actual_norm):
        raise TimestampMappingError("Cartesia returned an empty word token")

    if len(expected) != len(actual_norm):
        raise TimestampMappingError(
            f"word count mismatch: text has {len(expected)} words but Cartesia "
            f"returned {len(actual_norm)} — cannot confidently map blocks"
        )
    for i, (exp, act) in enumerate(zip(expected, actual_norm)):
        if exp != act:
            cartesia_raw = word_events[i].word
            raise TimestampMappingError(
                f"word {i} mismatch: text has {exp!r} but Cartesia returned "
                f"{cartesia_raw!r} — cannot confidently map blocks"
            )

    out: list[BlockSegmentPcmRange] = []
    cursor = 0
    for seg, count in zip(segments, counts):
        first = word_events[cursor]
        last = word_events[cursor + count - 1]
        if last.end < first.start:
            raise TimestampMappingError(f"segment {seg.id}: invalid timestamp range")
        out.append(
            BlockSegmentPcmRange(
                id=seg.id, start=first.start, end=last.end, word_index=cursor, word_count=count
            )
        )
        cursor += count
    return out


@dataclass(frozen=True)
class BlockSegmentPcmRange:
    id: str
    start: float
    end: float
    word_index: int
    word_count: int


def pcm_to_wav(pcm: bytes, sample_rate: int = SAMPLE_RATE, channels: int = CHANNELS) -> bytes:
    """Wrap raw s16le mono PCM in a WAV header."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def wav_duration(wav_bytes: bytes) -> float:
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        frames = wf.getnframes()
        rate = wf.getframerate() or SAMPLE_RATE
        return frames / float(rate)


def _decode_s16le(pcm: bytes, start_sample: int, count: int) -> list[int]:
    """Decode a run of s16le samples; clamped to the buffer."""
    total = len(pcm) // SAMPLE_WIDTH
    lo = max(0, start_sample)
    hi = min(total, start_sample + count)
    if hi <= lo:
        return []
    fmt = f"<{hi - lo}h"
    return list(struct.unpack_from(fmt, pcm, lo * SAMPLE_WIDTH))


def _rms(samples: list[int]) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum(s * s for s in samples) / len(samples))


def _best_quiet_center(
    pcm: bytes,
    total_samples: int,
    lo: int,
    hi: int,
    window: int,
    probe: int,
) -> int:
    """Quietest windowed-RMS center in [lo, hi]; probe on ties/no-improvement."""
    lo = max(0, lo)
    hi = min(total_samples, hi)
    probe = max(0, min(total_samples, probe))
    if hi <= lo or window <= 0:
        return probe
    half = window // 2
    dlo = max(0, lo - half - 1)
    dhi = min(total_samples, hi + half + 1)
    span = _decode_s16le(pcm, dlo, dhi - dlo)
    if not span:
        return probe
    prefix: list[int] = [0]
    for s in span:
        prefix.append(prefix[-1] + s * s)

    def window_rms(center: int) -> float:
        a = center - half - dlo
        b = a + window
        a = max(0, a)
        b = min(len(span), b)
        if b <= a:
            return 0.0
        return math.sqrt((prefix[b] - prefix[a]) / (b - a))

    best = probe
    best_rms = window_rms(probe)
    for cand in range(lo, hi + 1):
        r = window_rms(cand)
        if r < best_rms:
            best_rms = r
            best = cand
    return best


def find_quiet_cut(
    pcm: bytes,
    sample_rate: int,
    probe_sample: int,
    total_samples: int,
    search_sec: float = BOUNDARY_SEARCH_SEC,
    window_sec: float = BOUNDARY_ANALYSIS_WINDOW_SEC,
) -> int:
    """Move a cut point to the quietest nearby sample (bounded).

    Scores candidate cuts by RMS over a short window; keeps the probe
    unless a strictly quieter point exists within +/-search_sec. Movement is
    always bounded so no meaningful speech is reassigned between segments.
    """
    if search_sec <= 0 or window_sec <= 0 or total_samples <= 0:
        return max(0, min(total_samples, probe_sample))
    radius = round(search_sec * sample_rate)
    window = max(1, round(window_sec * sample_rate))
    probe = max(0, min(total_samples, probe_sample))
    return _best_quiet_center(pcm, total_samples, probe - radius, probe + radius, window, probe)


def _nearest_quiet_sample(
    pcm: bytes,
    total_samples: int,
    center: int,
    radius: int,
) -> int:
    """Closest-to-zero sample within +/-radius of center (zero-crossing snap)."""
    if radius <= 0 or total_samples <= 0:
        return max(0, min(total_samples, center))
    lo = max(0, center - radius)
    hi = min(total_samples, center + radius)
    span = _decode_s16le(pcm, lo, hi - lo + 1)
    if not span:
        return max(0, min(total_samples, center))
    best_i = 0
    best_v = abs(span[0])
    for i in range(1, len(span)):
        v = abs(span[i])
        if v < best_v or (v == best_v and abs(lo + i - center) < abs(lo + best_i - center)):
            best_i = i
            best_v = v
    return lo + best_i


def find_shared_cut(
    pcm: bytes,
    sample_rate: int,
    prev_end_sec: float,
    next_start_sec: float,
    total_samples: int,
    search_sec: float = BOUNDARY_SEARCH_SEC,
    window_sec: float = BOUNDARY_ANALYSIS_WINDOW_SEC,
) -> int:
    """One shared cut sample for the boundary between two blocks.

    The window covers the inter-word gap plus +/-search_sec of
    detection-only padding (never emitted into both neighbors). The previous
    segment ends and the next begins at the returned sample, so no sample is
    ever duplicated. Falls back to the original timestamp when nothing
    quieter is found.
    """
    if total_samples <= 0:
        return 0
    if search_sec <= 0 or window_sec <= 0:
        probe_t = (
            prev_end_sec if prev_end_sec <= next_start_sec else (prev_end_sec + next_start_sec) / 2
        )
        return max(0, min(total_samples, round(probe_t * sample_rate)))
    radius = round(search_sec * sample_rate)
    window = max(1, round(window_sec * sample_rate))
    if prev_end_sec <= next_start_sec:
        probe = round(prev_end_sec * sample_rate)
        lo = round((prev_end_sec - search_sec) * sample_rate)
        hi = round((next_start_sec + search_sec) * sample_rate)
    else:  # overlapping timestamps: center the window on the midpoint
        mid = (prev_end_sec + next_start_sec) / 2
        probe = round(mid * sample_rate)
        lo = probe - radius
        hi = probe + radius
    best = _best_quiet_center(pcm, total_samples, lo, hi, window, probe)
    zr = round(ZERO_CROSSING_SEC * sample_rate)
    best = _nearest_quiet_sample(pcm, total_samples, best, zr)
    return max(0, min(total_samples, max(lo, min(hi, best))))


def apply_edge_fades(
    pcm: bytes,
    sample_rate: int,
    fade_in_sec: float = FADE_IN_SEC,
    fade_out_sec: float = FADE_OUT_SEC,
) -> bytes:
    """Apply short cosine fade-in/out to an s16le mono slice.

    Gains are <= 1 so no clipping is introduced; overall volume outside the
    edges is untouched. Short slices get proportionally shorter fades.
    """
    n = len(pcm) // SAMPLE_WIDTH
    if n == 0 or (fade_in_sec <= 0 and fade_out_sec <= 0):
        return pcm
    fade_in = round(fade_in_sec * sample_rate) if fade_in_sec > 0 else 0
    fade_out = round(fade_out_sec * sample_rate) if fade_out_sec > 0 else 0
    # Shrink fades for very short segments instead of failing.
    while fade_in + fade_out > n and (fade_in > 0 or fade_out > 0):
        if fade_out >= fade_in and fade_out > 0:
            fade_out -= 1
        elif fade_in > 0:
            fade_in -= 1
        else:
            break
    if fade_in <= 0 and fade_out <= 0:
        return pcm
    samples = list(struct.unpack(f"<{n}h", pcm))

    def cosine_gains(length: int, *, fade_in: bool) -> list[float]:
        if length <= 0:
            return []
        if length == 1:
            return [0.0]
        return [
            0.5 * (1.0 - math.cos(math.pi * i / (length - 1)))
            if fade_in
            else 0.5 * (1.0 + math.cos(math.pi * i / (length - 1)))
            for i in range(length)
        ]

    if fade_in > 0:
        gains = cosine_gains(fade_in, fade_in=True)
        for i in range(fade_in):
            samples[i] = max(-32768, min(32767, round(samples[i] * gains[i])))
    if fade_out > 0:
        gains = cosine_gains(fade_out, fade_in=False)
        base = n - fade_out
        for i in range(fade_out):
            samples[base + i] = max(-32768, min(32767, round(samples[base + i] * gains[i])))
    return struct.pack(f"<{n}h", *samples)


def slice_segments(
    pcm: bytes,
    sample_rate: int,
    ranges: list[BlockSegmentPcmRange],
    word_events: list[WordTimestamp],
    *,
    search_sec: float = BOUNDARY_SEARCH_SEC,
    fade_in_sec: float = FADE_IN_SEC,
    fade_out_sec: float = FADE_OUT_SEC,
) -> list[BlockSegment]:
    """Slice continuous PCM into per-block segments without overlap.

    Each inter-block boundary becomes one shared cut sample: the previous
    segment ends and the next begins at the same position, so consecutive
    playback never repeats audio and no gaps are introduced. The cut is
    found by inspecting the inter-word gap plus +/-search_sec of
    detection-only padding for a quiet, near-zero-crossing point; the
    original timestamp is kept when nothing quieter is found. Outer edges
    are the exact first/last word timestamps. ``start``/``end`` report the
    actual cut positions (shared between neighbors); ``duration``/``pcm``
    reflect the processed slice after short cosine edge fades. The input
    ``pcm`` is never modified.
    """
    if sample_rate <= 0:
        raise TimestampMappingError("sample_rate must be positive")
    if not ranges:
        raise TimestampMappingError("ranges must be a non-empty list")
    total_samples = len(pcm) // SAMPLE_WIDTH
    if total_samples <= 0:
        raise TimestampMappingError("empty PCM buffer")

    def to_sample(t: float) -> int:
        return max(0, min(total_samples, round(t * sample_rate)))

    # Shared cuts: outer edges exact, interior edges one quiet shared sample.
    cuts: list[int] = [to_sample(ranges[0].start)]
    for k in range(1, len(ranges)):
        cut = find_shared_cut(
            pcm,
            sample_rate,
            ranges[k - 1].end,
            ranges[k].start,
            total_samples,
            search_sec,
            BOUNDARY_ANALYSIS_WINDOW_SEC,
        )
        cut = max(cut, cuts[-1] + 1)
        cut = min(cut, total_samples)
        cuts.append(cut)
    last = to_sample(ranges[-1].end)
    if last <= cuts[-1]:
        raise TimestampMappingError("segment spans collapse to an empty slice")
    cuts.append(last)

    out: list[BlockSegment] = []
    for i, r in enumerate(ranges):
        start_sample = cuts[i]
        end_sample = cuts[i + 1]
        if end_sample <= start_sample:
            raise TimestampMappingError(f"segment {r.id}: empty audio slice")
        sl = pcm[start_sample * SAMPLE_WIDTH : end_sample * SAMPLE_WIDTH]
        sl = apply_edge_fades(sl, sample_rate, fade_in_sec, fade_out_sec)
        seg_words = [w.word for w in word_events[r.word_index : r.word_index + r.word_count]]
        out.append(
            BlockSegment(
                id=r.id,
                start=start_sample / float(sample_rate),
                end=end_sample / float(sample_rate),
                duration=(end_sample - start_sample) / float(sample_rate),
                pcm=sl,
                words=seg_words,
            )
        )
    # Block order is time order; shared cuts make neighbors exactly contiguous.
    from itertools import pairwise as _pairwise

    for a, b in _pairwise(out):
        if b.start < a.start - 1e-6:
            raise TimestampMappingError("segments out of time order")
        if abs(b.start - a.end) > 1e-9:
            raise TimestampMappingError("neighboring segments must share a boundary")
    return out


def full_wav_duration(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> float:
    return (len(pcm) // SAMPLE_WIDTH) / float(sample_rate) if sample_rate else 0.0


def encode_wav_header_size_check(wav_bytes: bytes) -> tuple[int, int, float]:
    """Return (sample_rate, channels, duration) from a WAV header."""
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        return wf.getframerate(), wf.getnchannels(), wf.getnframes() / float(wf.getframerate())


def pack_riff_size(data: bytes) -> bytes:
    """Fill real RIFF/data sizes (for tests comparing streaming headers)."""
    if len(data) < 12 or data[:4] != b"RIFF":
        return data
    out = bytearray(data)
    out[4:8] = struct.pack("<I", len(data) - 8)
    return bytes(out)
