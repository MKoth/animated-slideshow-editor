"""Stage C narration helpers: verbatim Prompter fill + estimate/adopt timing.

Implements issue #425 (Spec 12 build Stage C) against the resolution on
#413: accepted scenario spoken lines land verbatim in narration parts (never
re-derived), pre-TTS part durations estimated by character count times
secondsPerCharacter with slide duration as the sum of its parts, then
post-TTS timing always adopts the TTS audio duration and shifts downstream
gap-free — never auto-stretching audio to fit text (no playbackRate anywhere
in this surface; the existing Waveform Editor mismatch choices stay the
manual adjustment path).

Only middle-tagged steps are filled; pregenerated intro/outro references are
left alone, mirroring Stage B. WAVs are embedded first and proposals carry
asset ids only — commit commands never include inline base64.
"""

from __future__ import annotations

import io
import wave
from typing import Any

# Same default as frontend DEFAULT_PROMPTER_SECONDS_PER_CHARACTER
# (frontend/src/engine/prompter.ts). The project settings value wins when the
# caller passes it explicitly at creation time.
DEFAULT_SECONDS_PER_CHARACTER = 0.2

_PART_STATUSES: tuple[str, ...] = ("pending", "ready", "failed")


def estimate_part_duration(text: str, seconds_per_character: float) -> float:
    """Pre-TTS estimate: character count times secondsPerCharacter."""
    if seconds_per_character <= 0:
        raise ValueError("secondsPerCharacter must be > 0")
    return len(text) * seconds_per_character


def verbatim_parts_from_steps(
    steps: list[dict[str, Any]],
    seconds_per_character: float = DEFAULT_SECONDS_PER_CHARACTER,
) -> list[dict[str, Any]]:
    """One narration part per middle step, spokenLine copied verbatim.

    No re-derivation: no splitChars re-parsing, no trimming, no case or
    punctuation normalization. Intro/outro steps are skipped so pregenerated
    references stay untouched.
    """
    if seconds_per_character <= 0:
        raise ValueError("secondsPerCharacter must be > 0")
    parts: list[dict[str, Any]] = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        if str(step.get("partTag", "")) != "middle":
            continue
        step_id = str(step.get("id", ""))
        spoken = step.get("spokenLine", "")
        if not step_id or not isinstance(spoken, str) or not spoken:
            continue
        order = step.get("order", len(parts))
        parts.append(
            {
                "stepId": step_id,
                "order": order if isinstance(order, int) else len(parts),
                "partTag": "middle",
                "spokenLine": spoken,
                "estimatedDuration": estimate_part_duration(spoken, seconds_per_character),
                "audioDuration": None,
                "assetId": None,
                "status": "pending",
                "stale": False,
                "voicePromptId": None,
                "error": None,
                "timelineStart": 0.0,
                "timelineEnd": 0.0,
            }
        )
    if not parts:
        raise ValueError("no middle steps with spoken lines — nothing verbatim to fill")
    return layout_parts(parts)


def _effective_duration(part: dict[str, Any]) -> float:
    audio = part.get("audioDuration")
    if isinstance(audio, (int, float)) and float(audio) > 0:
        return float(audio)
    estimated = part.get("estimatedDuration", 0.0)
    return float(estimated) if isinstance(estimated, (int, float)) else 0.0


def layout_parts(parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Gap-free prefix-sum layout from effective durations (adopted or estimated)."""
    cursor = 0.0
    for part in parts:
        duration = _effective_duration(part)
        part["timelineStart"] = cursor
        part["timelineEnd"] = cursor + duration
        cursor += part["timelineEnd"] - part["timelineStart"]
    return parts


def slide_duration_for_parts(parts: list[dict[str, Any]]) -> float:
    """Slide duration is the sum of its parts."""
    return sum(_effective_duration(part) for part in parts)


def adopt_tts_durations(
    parts: list[dict[str, Any]], audio_durations: dict[str, float]
) -> list[dict[str, Any]]:
    """Post-TTS timing: always adopt the TTS audio duration, shift gap-free.

    Never auto-stretches: the layout carries no playbackRate — audio keeps
    rate 1 and the text bounds move to fit the audio, not the reverse.
    """
    adopted: list[dict[str, Any]] = []
    for part in parts:
        updated = dict(part)
        step_id = str(part.get("stepId", ""))
        if step_id in audio_durations:
            duration = audio_durations[step_id]
            if not isinstance(duration, (int, float)) or float(duration) <= 0:
                raise ValueError(f"audio duration for step {step_id} must be > 0")
            updated["audioDuration"] = float(duration)
        adopted.append(updated)
    return layout_parts(adopted)


def wav_duration(wav_bytes: bytes) -> float | None:
    """Measure a WAV payload duration from its header; None when unreadable."""
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as w:
            framerate = w.getframerate()
            if not framerate:
                return None
            return float(w.getnframes()) / float(framerate)
    except Exception:  # noqa: BLE001
        return None


def build_fill_commands(parts: list[dict[str, Any]], slide_id: str) -> list[dict[str, Any]]:
    """Pre-TTS fill proposal: one CreatePrompterPart per part, verbatim + estimate."""
    if not slide_id.strip():
        raise ValueError("slideId must be a non-empty string")
    commands: list[dict[str, Any]] = []
    for part in parts:
        spoken = part.get("spokenLine", "")
        if not isinstance(spoken, str) or not spoken:
            raise ValueError(f"part {part.get('stepId', '?')} has no verbatim spoken line")
        commands.append(
            {
                "type": "CreatePrompterPart",
                "slideId": slide_id,
                "text": spoken,
                "duration": _effective_duration(part),
            }
        )
    return commands


def build_commit_commands(
    parts: list[dict[str, Any]], slide_id: str, part_ids: dict[str, str]
) -> list[dict[str, Any]]:
    """Post-TTS commit proposal: one AiCommitTts per ready part, asset ids only.

    Embed-first is enforced: parts without an assetId raise instead of
    emitting inline audio bytes (proposals stay small and reviewable).
    Stale-blocking at build: only ready parts are committable — failed or
    regenerated parts must pass the accept gate first.
    """
    if not slide_id.strip():
        raise ValueError("slideId must be a non-empty string")
    layout = layout_parts([dict(p) for p in parts])
    commands: list[dict[str, Any]] = []
    for part in layout:
        step_id = str(part.get("stepId", ""))
        if part.get("status") != "ready":
            raise ValueError(
                f"part {step_id} is {part.get('status', 'pending')} — "
                "retry it and embed its WAV before committing"
            )
        part_id = part_ids.get(step_id, "")
        if not part_id.strip():
            raise ValueError(f"no PrompterPart id mapped for step {step_id}")
        asset_id = part.get("assetId")
        if not isinstance(asset_id, str) or not asset_id.strip():
            raise ValueError(
                f"part {step_id} has no assetId — embed the WAV first, "
                "then reference the asset id (never inline base64)"
            )
        audio = part.get("audioDuration")
        if not isinstance(audio, (int, float)) or float(audio) <= 0:
            raise ValueError(f"part {step_id} has no adopted TTS audio duration")
        commands.append(
            {
                "type": "AiCommitTts",
                "slideId": slide_id,
                "partId": part_id,
                "assetId": asset_id.strip(),
                "timelineStart": float(part["timelineStart"]),
                "sourceEnd": float(audio),
            }
        )
    return commands


def narration_accept_blockers(parts: list[dict[str, Any]]) -> list[str]:
    """Accept-gate blockers: every part must be ready with an embedded asset id."""
    blockers: list[str] = []
    for part in parts:
        step_id = str(part.get("stepId", "?"))
        status = part.get("status", "pending")
        if status == "failed":
            error = part.get("error") or "TTS failed"
            blockers.append(f"part {step_id}: {error} — retry this part before accepting")
        elif status != "ready":
            blockers.append(
                f"part {step_id}: TTS audio not generated yet — run the batch, then accept"
            )
        elif not isinstance(part.get("assetId"), str) or not str(part.get("assetId")).strip():
            blockers.append(
                f"part {step_id}: WAV not embedded yet — embed first so the "
                "proposal references the asset id"
            )
    return blockers


def normalize_part_status(status: object) -> str:
    """Validate a narration part status transition target."""
    if status not in _PART_STATUSES:
        raise ValueError(f"status must be one of {', '.join(_PART_STATUSES)}")
    assert isinstance(status, str)
    return status
