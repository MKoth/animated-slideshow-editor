"""Segmentation quality: shared cuts, quiet search, fades (synthetic PCM, no API)."""

from __future__ import annotations

import io
import math
import struct
import wave

from app.tts.timestamps import BlockSegmentPcmRange, WordTimestamp

SR = 44100


def _tone_pcm(freq: float, duration: float, sr: int = SR, amp: int = 12000) -> bytes:
    n = round(duration * sr)
    return struct.pack(
        f"<{n}h",
        *(round(amp * math.sin(2 * math.pi * freq * i / sr)) for i in range(n)),
    )


def _const_pcm(value: int, duration: float, sr: int = SR) -> bytes:
    n = round(duration * sr)
    v = max(-32768, min(32767, value))
    return struct.pack(f"<{n}h", *([v] * n))


def _silence(duration: float, sr: int = SR) -> bytes:
    n = round(duration * sr)
    return bytes(n * 2)


def _samples(pcm: bytes) -> list[int]:
    n = len(pcm) // 2
    return list(struct.unpack(f"<{n}h", pcm)) if n else []


def _wav_info(wav: bytes) -> tuple[int, int, int]:
    with wave.open(io.BytesIO(wav), "rb") as wf:
        return wf.getframerate(), wf.getnchannels(), wf.getsampwidth()


def _range(id: str, start: float, end: float, word_index: int = 0) -> BlockSegmentPcmRange:
    return BlockSegmentPcmRange(id=id, start=start, end=end, word_index=word_index, word_count=1)


def _words(n: int = 1) -> list[WordTimestamp]:
    return [WordTimestamp("w", 0.0, 0.1) for _ in range(n)]


def test_outer_edges_exact_and_clamped() -> None:
    from app.tts.timestamps import slice_segments

    pcm = _tone_pcm(440.0, 1.0)
    first = slice_segments(pcm, SR, [_range("a", 0.0, 0.2)], _words())
    assert first[0].start == 0.0
    # No padding in output: duration is the word span (fades don't change length).
    assert abs(first[0].duration - 0.2) < 1e-6
    last = slice_segments(pcm, SR, [_range("b", 0.8, 1.0)], _words())
    assert last[0].end == 1.0
    assert abs(last[0].duration - 0.2) < 1e-6


def test_neighbors_share_one_exact_cut_sample() -> None:
    from app.tts.timestamps import BlockSegmentPcmRange, WordTimestamp, slice_segments

    pcm = _tone_pcm(440.0, 2.0)
    ranges = [
        BlockSegmentPcmRange(id="a", start=0.0, end=0.9, word_index=0, word_count=1),
        BlockSegmentPcmRange(id="b", start=1.0, end=1.9, word_index=1, word_count=1),
    ]
    words = [WordTimestamp("x", 0.0, 0.9), WordTimestamp("y", 1.0, 1.9)]
    out = slice_segments(pcm, SR, ranges, words)
    # Field-level: previous end equals next start exactly.
    assert out[0].end == out[1].start
    assert out[0].start == 0.0 and out[1].end == 1.9
    # Sample-level: no duplicated samples between neighbors.
    n0 = len(out[0].pcm) // 2
    n1 = len(out[1].pcm) // 2
    assert n0 + n1 == round(1.9 * SR)
    # The cut stays near the word boundary (bounded detection window).
    assert 0.87 <= out[0].end <= 1.03


def test_slices_partition_recording_without_gaps_or_duplicates() -> None:
    from app.tts.timestamps import BlockSegmentPcmRange, WordTimestamp, slice_segments

    sr = 8000
    pcm = _tone_pcm(440.0, 1.0, sr, 9000) + _silence(0.2, sr)
    ranges = [
        BlockSegmentPcmRange(id="a", start=0.0, end=0.5, word_index=0, word_count=1),
        BlockSegmentPcmRange(id="b", start=0.6, end=1.0, word_index=1, word_count=1),
    ]
    words = [WordTimestamp("x", 0.0, 0.5), WordTimestamp("y", 0.6, 1.0)]
    out = slice_segments(pcm, sr, ranges, words, search_sec=0, fade_in_sec=0, fade_out_sec=0)
    # With detection/fades off, cuts are exact and byte-identical to the source.
    c0, c1, c2 = 0, round(0.5 * sr), round(1.0 * sr)
    assert out[0].pcm == pcm[c0 * 2 : c1 * 2]
    assert out[1].pcm == pcm[c1 * 2 : c2 * 2]
    # Concatenation reproduces the source span with no gaps or repeats.
    assert out[0].pcm + out[1].pcm == pcm[c0 * 2 : c2 * 2]


def test_shared_cut_lands_in_silence_gap() -> None:
    from app.tts.timestamps import slice_segments

    sr = 8000
    # tone | silence | tone; word boundary sits at the silence edges.
    pcm = _tone_pcm(440.0, 0.3, sr, 12000) + _silence(0.2, sr) + _tone_pcm(440.0, 0.3, sr, 12000)
    out = slice_segments(
        pcm, sr, [_range("a", 0.0, 0.3), _range("b", 0.3, 0.8, word_index=0)], _words(1)
    )
    cut = out[0].end
    assert out[1].start == cut
    # The shared cut must sit inside the silence gap (no speech cut).
    assert 0.28 <= cut <= 0.52
    cut_sample = _samples(pcm[round(cut * sr) * 2 : round(cut * sr) * 2 + 2])[0]
    assert abs(cut_sample) < 2000


def test_shared_cut_falls_back_to_timestamp_on_uniform_signal() -> None:
    from app.tts.timestamps import find_shared_cut, slice_segments

    sr = 8000
    pcm = _const_pcm(8000, 0.5, sr)
    total = len(pcm) // 2
    # Uniform loud signal: no quieter point exists, keep the original timestamp.
    assert find_shared_cut(pcm, sr, 0.2, 0.3, total) == round(0.2 * sr)
    out = slice_segments(pcm, sr, [_range("a", 0.1, 0.2), _range("b", 0.3, 0.4)], _words(1))
    assert out[0].end == out[1].start
    assert abs(out[0].end - 0.2) < 1e-9


def test_no_repeated_words_across_boundary() -> None:
    # Structural guarantee: every source sample belongs to at most one
    # segment, so no word can be repeated by overlap.
    from app.tts.timestamps import BlockSegmentPcmRange, WordTimestamp, slice_segments

    sr = 8000
    pcm = _tone_pcm(440.0, 0.6, sr, 10000)
    ranges = [
        BlockSegmentPcmRange(id="a", start=0.0, end=0.2, word_index=0, word_count=1),
        BlockSegmentPcmRange(id="b", start=0.25, end=0.45, word_index=1, word_count=1),
    ]
    words = [WordTimestamp("x", 0.0, 0.2), WordTimestamp("y", 0.25, 0.45)]
    out = slice_segments(pcm, sr, ranges, words)
    n0 = len(out[0].pcm) // 2
    n1 = len(out[1].pcm) // 2
    s0 = round(out[0].start * sr)
    # Contiguous half-open sample ranges: [s0, s0+n0) then [s0+n0, s0+n0+n1).
    assert round(out[1].start * sr) == s0 + n0
    assert n0 > 0 and n1 > 0


def test_quiet_cut_moves_into_silence() -> None:
    from app.tts.timestamps import find_quiet_cut

    sr = 8000
    pcm = _tone_pcm(440.0, 0.3, sr, 12000) + _silence(0.2, sr) + _tone_pcm(440.0, 0.3, sr, 12000)
    total = len(pcm) // 2
    probe = int(0.3 * sr)  # exact tone|silence edge (loud side)
    moved = find_quiet_cut(pcm, sr, probe, total, search_sec=0.05)
    assert abs(moved - probe) <= int(0.05 * sr) + 1
    # The chosen cut must be quieter than the probe (moved off the tone).
    from app.tts.timestamps import _decode_s16le, _rms

    def rms_at(c: int) -> float:
        return _rms(_decode_s16le(pcm, c - 20, 40))

    assert rms_at(moved) <= rms_at(probe)
    moved_sample = _decode_s16le(pcm, moved, 1)[0]
    assert abs(moved_sample) < 12000  # left the full-scale tone


def test_quiet_cut_fallback_on_uniform_signal() -> None:
    from app.tts.timestamps import find_quiet_cut

    sr = 8000
    pcm = _const_pcm(8000, 0.5, sr)
    probe = int(0.25 * sr)
    assert find_quiet_cut(pcm, sr, probe, len(pcm) // 2, search_sec=0.03) == probe


def test_fades_attenuate_edges_not_middle() -> None:
    from app.tts.timestamps import apply_edge_fades

    sr = 8000
    pcm = _const_pcm(10000, 0.2, sr)
    out = apply_edge_fades(pcm, sr, fade_in_sec=0.008, fade_out_sec=0.015)
    s_in, s_out = _samples(pcm), _samples(out)
    assert len(s_in) == len(s_out)
    # Edges near zero, middle untouched.
    assert abs(s_out[0]) < abs(s_in[0]) * 0.05
    assert abs(s_out[-1]) < abs(s_in[-1]) * 0.05
    mid = len(s_out) // 2
    assert s_out[mid] == s_in[mid]
    # Monotonic ramp on the fade-in.
    edge = [abs(v) for v in s_out[: int(0.008 * sr)]]
    assert edge == sorted(edge)


def test_short_segment_safe() -> None:
    from app.tts.timestamps import pcm_to_wav, slice_segments

    sr = 8000
    pcm = _tone_pcm(440.0, 0.05, sr)
    out = slice_segments(pcm, sr, [_range("s", 0.01, 0.02)], _words())
    assert len(out) == 1
    wav = pcm_to_wav(out[0].pcm, sr, 1)
    assert _wav_info(wav) == (sr, 1, 2)
    assert len(_samples(out[0].pcm)) > 0


def test_format_preserved_no_clipping_original_untouched() -> None:
    from app.tts.timestamps import pcm_to_wav, slice_segments

    pcm = _const_pcm(30000, 1.0)  # near full-scale
    before = bytes(pcm)
    out = slice_segments(pcm, SR, [_range("a", 0.2, 0.5)], _words())
    assert pcm == before  # input never modified
    assert max(abs(v) for v in _samples(out[0].pcm)) <= 32767
    assert _wav_info(pcm_to_wav(out[0].pcm)) == (SR, 1, 2)


def test_movement_bounded_by_search() -> None:
    from app.tts.timestamps import find_quiet_cut

    sr = 8000
    pcm = _tone_pcm(330.0, 1.0, sr, 9000) + _silence(0.1, sr)
    total = len(pcm) // 2
    for probe_ms in (100, 400, 700):
        probe = int(probe_ms / 1000 * sr)
        moved = find_quiet_cut(pcm, sr, probe, total, search_sec=0.03)
        assert abs(moved - probe) <= int(0.03 * sr) + 1


def test_shared_cut_movement_bounded() -> None:
    from app.tts.timestamps import ZERO_CROSSING_SEC, find_shared_cut

    sr = 8000
    pcm = _tone_pcm(330.0, 1.0, sr, 9000)
    total = len(pcm) // 2
    cut = find_shared_cut(pcm, sr, 0.4, 0.5, total)
    # Within the gap window plus the tiny zero-crossing snap.
    slack = 0.03 + ZERO_CROSSING_SEC + 1 / sr
    assert 0.4 - slack <= cut / sr <= 0.5 + slack


def test_click_reduction_at_cut() -> None:
    # Exact cut lands on a loud sample; the faded slice ends near silence.
    from app.tts.timestamps import slice_segments

    sr = 8000
    pcm = _const_pcm(20000, 0.5, sr)
    words = _words()
    exact = slice_segments(
        pcm,
        sr,
        [_range("a", 0.1, 0.3)],
        words,
        search_sec=0,
        fade_in_sec=0,
        fade_out_sec=0,
    )[0]
    soft = slice_segments(pcm, sr, [_range("a", 0.1, 0.3)], words)[0]
    assert abs(_samples(exact.pcm)[-1]) == 20000
    assert abs(_samples(soft.pcm)[-1]) < 20000 * 0.05
    assert abs(_samples(soft.pcm)[0]) < 20000 * 0.05
