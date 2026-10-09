"""Canonical AI Edit Proposal allowlist + server-side schema validation (issue #422).

The single execution seam every proposing stage (C, D, E, merge) rides on.
Server validation runs first; the client dry-run validate() against the live
engine runs second, in order. Stages land the real commands in their own
tickets — here the stage commands ride as typed placeholders.
"""

from __future__ import annotations

from typing import Any

# Canonical allowlist. Real engine commands first (Stage C prompter/audio +
# Stage E board scripts), then typed placeholders for the stage commands whose
# real implementations land in their own tickets (#425/#426/#427/#428).
ALLOWLIST: tuple[str, ...] = (
    # Stage C: prompter/audio (real engine commands)
    "CreateSlide",
    "CreatePrompterPart",
    "UpdatePrompterPart",
    "UpdatePrompterPartWithShift",
    "ReplacePrompterWords",
    "SetPrompterPartAudio",
    # Stage C: TTS commit by asset id (placeholder — never inline base64)
    "AiCommitTts",
    # Stage D: mouth coefficients (placeholders — real tracks land in #426)
    "AiSetMorphCoefficient",
    "AiSetControlValue",
    "AiPlaceMouthClip",
    # Stage E: board content (real script command + placeholders landing in #427)
    "SetSlideAnimationScript",
    "AiCreateBoardText",
    "AiCreateBoardTable",
    # Merge: cross-project import (placeholder — ImportSlidesCommand lands in #428)
    "AiImportSlides",
)

_MAX_COMMANDS = 100
_MAX_INLINE_STRING = 1000


def _is_non_empty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _check_required(
    command: dict[str, Any], index: int, fields: tuple[str, ...]
) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for field in fields:
        if command.get(field) is None or (
            isinstance(command.get(field), str) and not str(command.get(field)).strip()
        ):
            errors.append(
                {
                    "index": index,
                    "type": str(command.get("type", "?")),
                    "message": (
                        f"command #{index} ({command.get('type', '?')}): "
                        f"missing required field '{field}'. "
                        "Fix the proposal and re-validate before anything executes."
                    ),
                }
            )
    return errors


def validate_proposal_commands(commands: Any) -> tuple[bool, list[dict[str, Any]]]:
    """Validate raw proposal commands against the canonical allowlist.

    Returns (ok, errors). Errors carry fixable messages naming the command
    index, the offending type/field, and the allowed values.
    """
    if not isinstance(commands, list) or not commands:
        return False, [
            {
                "index": -1,
                "type": "?",
                "message": (
                    "proposal must carry a non-empty commands list. "
                    "Fix the proposal and re-validate before anything executes."
                ),
            }
        ]
    if len(commands) > _MAX_COMMANDS:
        return False, [
            {
                "index": -1,
                "type": "?",
                "message": (
                    f"proposal carries {len(commands)} commands (max {_MAX_COMMANDS}). "
                    "Split it into smaller proposals."
                ),
            }
        ]
    errors: list[dict[str, Any]] = []
    for index, raw in enumerate(commands):
        if not isinstance(raw, dict):
            errors.append(
                {
                    "index": index,
                    "type": "?",
                    "message": (
                        f"command #{index}: must be a JSON object with a 'type' field. "
                        "Fix the proposal and re-validate before anything executes."
                    ),
                }
            )
            continue
        ctype = raw.get("type")
        if not _is_non_empty_string(ctype):
            errors.append(
                {
                    "index": index,
                    "type": "?",
                    "message": (
                        f"command #{index}: missing required field 'type'. "
                        f"Allowed: {', '.join(ALLOWLIST)}."
                    ),
                }
            )
            continue
        assert isinstance(ctype, str)
        if ctype not in ALLOWLIST:
            errors.append(
                {
                    "index": index,
                    "type": ctype,
                    "message": (
                        f"command #{index}: unknown command type '{ctype}'. "
                        f"Allowed: {', '.join(ALLOWLIST)}. "
                        "Remove or replace it before anything executes."
                    ),
                }
            )
            continue
        errors.extend(_validate_fields(ctype, raw, index))
        errors.extend(_check_inline_base64(ctype, raw, index))
    return (len(errors) == 0), errors


def _validate_fields(ctype: str, command: dict[str, Any], index: int) -> list[dict[str, Any]]:
    """Per-type required-field + scalar type checks with fixable messages."""
    errors: list[dict[str, Any]] = []

    def req(*fields: str) -> None:
        errors.extend(_check_required(command, index, tuple(fields)))

    def num(field: str, *, non_negative: bool = False) -> None:
        value = command.get(field)
        if value is None:
            return
        if not _is_finite_number(value):
            errors.append(_field_error(index, ctype, field, "must be a number"))
        elif non_negative and float(value) < 0:
            errors.append(_field_error(index, ctype, field, "must be >= 0"))

    def ints(field: str) -> None:
        value = command.get(field)
        if value is None:
            return
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            errors.append(_field_error(index, ctype, field, "must be a non-negative integer"))

    if ctype == "CreateSlide":
        name = command.get("name")
        if name is not None and not isinstance(name, str):
            errors.append(_field_error(index, ctype, "name", "must be a string"))
    elif ctype == "CreatePrompterPart":
        req("slideId", "text", "duration")
        num("duration", non_negative=True)
        ints("insertIndex") if command.get("insertIndex") is not None else None
        if command.get("text") is not None and not isinstance(command.get("text"), str):
            errors.append(_field_error(index, ctype, "text", "must be a string"))
    elif ctype == "UpdatePrompterPart":
        req("slideId", "partId")
        if (
            command.get("text") is None
            and command.get("duration") is None
            and command.get("shiftDownstream") is None
        ):
            errors.append(
                _field_error(
                    index,
                    ctype,
                    "text|duration",
                    "at least one of text, duration, shiftDownstream is required",
                )
            )
        num("duration", non_negative=True)
    elif ctype == "UpdatePrompterPartWithShift":
        req("slideId", "partId", "duration", "shiftDownstream")
        num("duration", non_negative=True)
        if command.get("shiftDownstream") is not None and not isinstance(
            command.get("shiftDownstream"), bool
        ):
            errors.append(_field_error(index, ctype, "shiftDownstream", "must be a boolean"))
    elif ctype == "ReplacePrompterWords":
        req("slideId", "partId", "startWordIndex", "endWordIndex", "ttsAssetId")
        ints("startWordIndex") if command.get("startWordIndex") is not None else None
        ints("endWordIndex") if command.get("endWordIndex") is not None else None
    elif ctype == "SetPrompterPartAudio":
        req("slideId", "partId")
        has_clip = command.get("clipId") is not None or command.get("audioClipId") is not None
        has_asset = command.get("assetId") is not None or command.get("audioAssetId") is not None
        if not has_clip and not has_asset:
            errors.append(
                _field_error(
                    index,
                    ctype,
                    "audioClipId|audioAssetId",
                    "at least one of audioClipId, audioAssetId is required",
                )
            )
    elif ctype == "AiCommitTts":
        req("slideId", "partId", "assetId", "timelineStart", "sourceEnd")
        num("timelineStart", non_negative=True)
        num("sourceEnd")
        if isinstance(command.get("sourceEnd"), (int, float)) and float(command["sourceEnd"]) <= 0:
            errors.append(_field_error(index, ctype, "sourceEnd", "must be > 0"))
    elif ctype == "AiSetMorphCoefficient":
        req("nodeId", "coefficient")
        num("coefficient")
        coefficient = command.get("coefficient")
        if (
            isinstance(coefficient, (int, float))
            and not isinstance(coefficient, bool)
            and not 0 <= float(coefficient) <= 1
        ):
            errors.append(_field_error(index, ctype, "coefficient", "must be between 0 and 1"))
        tag = command.get("partTag")
        if tag is not None and tag not in ("intro", "outro"):
            errors.append(_field_error(index, ctype, "partTag", "must be 'intro' or 'outro'"))
    elif ctype == "AiSetControlValue":
        req("nodeId", "controlKey", "value")
        num("value")
    elif ctype == "AiPlaceMouthClip":
        req("nodeId", "clipName", "startTime")
        num("startTime", non_negative=True)
        num("duration", non_negative=True) if command.get("duration") is not None else None
    elif ctype == "SetSlideAnimationScript":
        req("slideId", "source")
        if command.get("source") is not None and not isinstance(command.get("source"), str):
            errors.append(_field_error(index, ctype, "source", "must be a string"))
    elif ctype == "AiCreateBoardText":
        req("slideId", "text")
        num("x") if command.get("x") is not None else None
        num("y") if command.get("y") is not None else None
    elif ctype == "AiCreateBoardTable":
        req("slideId", "rows", "columns")
        ints("rows") if command.get("rows") is not None else None
        ints("columns") if command.get("columns") is not None else None
        rows = command.get("rows")
        columns = command.get("columns")
        if isinstance(rows, int) and (rows < 1 or rows > 50):
            errors.append(_field_error(index, ctype, "rows", "must be between 1 and 50"))
        if isinstance(columns, int) and (columns < 1 or columns > 20):
            errors.append(_field_error(index, ctype, "columns", "must be between 1 and 20"))
    elif ctype == "AiImportSlides":
        if command.get("slideIds") is None:
            errors.append(_field_error(index, ctype, "slideIds", "is required"))
        elif not isinstance(command.get("slideIds"), list) or not command["slideIds"]:
            errors.append(_field_error(index, ctype, "slideIds", "must be a non-empty list"))
        elif not all(_is_non_empty_string(s) for s in command["slideIds"]):
            errors.append(
                _field_error(index, ctype, "slideIds", "must be a list of non-empty strings")
            )
        ints("targetIndex") if command.get("targetIndex") is not None else None
    return errors


def _field_error(index: int, ctype: str, field: str, why: str) -> dict[str, Any]:
    return {
        "index": index,
        "type": ctype,
        "message": (
            f"command #{index} ({ctype}): field '{field}' {why}. "
            "Fix the proposal and re-validate before anything executes."
        ),
    }


def _check_inline_base64(ctype: str, command: dict[str, Any], index: int) -> list[dict[str, Any]]:
    """Proposals stay small and reviewable: asset ids, never inline base64."""
    errors: list[dict[str, Any]] = []
    suspects: list[tuple[str, str]] = []
    tts_data = command.get("ttsData")
    if isinstance(tts_data, dict):
        data = tts_data.get("data")
        if isinstance(data, str) and len(data) > 0:
            suspects.append(("ttsData.data", data))
    asset = command.get("asset")
    if isinstance(asset, dict):
        data = asset.get("data")
        if isinstance(data, str) and len(data) > 0:
            suspects.append(("asset.data", data))
    for field in ("data", "base64", "wavData", "audioData"):
        value = command.get(field)
        if isinstance(value, str) and len(value) >= _MAX_INLINE_STRING:
            suspects.append((field, value))
    for field, _ in suspects:
        errors.append(
            {
                "index": index,
                "type": ctype,
                "message": (
                    f"command #{index} ({ctype}): field '{field}' carries inline audio "
                    "data. Generate audio first, embed it, then reference the asset id "
                    "(e.g. AiCommitTts assetId). Fix the proposal and re-validate "
                    "before anything executes."
                ),
            }
        )
    return errors
