"""Canonical AI Edit Proposal allowlist + server-side schema validation (issue #422).

The single execution seam every proposing stage (C, D, E, merge) rides on.
Server validation runs first; the client dry-run validate() against the live
engine runs second, in order. Stages land the real commands in their own
tickets — AiCommitTts landed in #425, boards execute as
SetSlideAnimationScript in #427, the assembly merge lands as AiImportSlides
in #428 (AiCreateBoardText/Table and mouth coefficients stay placeholders).
"""

from __future__ import annotations

from typing import Any

# Canonical allowlist. Real engine commands first (Stage C prompter/audio +
# Stage E board scripts via SetSlideAnimationScript + Stage F assembly merge
# via AiImportSlides), then typed placeholders for the stage commands whose
# real implementations land in their own tickets (AiCreateBoardText/Table and
# mouth coefficients stay non-executing placeholders).
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
    "AiAnimationAssetBatch",
    "AiRunAnimationScript",
    "AiDeleteAnimationScript",
    "AiCreateBoardText",
    "AiCreateBoardTable",
    # Merge: cross-project import (ImportSlidesCommand, issue #428)
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
        for baked in ("shapeId", "fromShapeId", "toShapeId"):
            if command.get(baked) is not None:
                errors.append(
                    _field_error(
                        index, ctype, baked, "baked shape ids are forbidden — clips stay name-based"
                    )
                )
        if str(command.get("property", "")).strip().lower() == "rotation":
            errors.append(
                _field_error(index, ctype, "property", "camera rotation is never written")
            )
    elif ctype == "AiSetControlValue":
        req("nodeId", "controlKey", "value")
        num("value")
        tag = command.get("partTag")
        if tag is not None and tag not in ("intro", "outro"):
            errors.append(_field_error(index, ctype, "partTag", "must be 'intro' or 'outro'"))
        for baked in ("shapeId", "fromShapeId", "toShapeId"):
            if command.get(baked) is not None:
                errors.append(
                    _field_error(
                        index, ctype, baked, "baked shape ids are forbidden — clips stay name-based"
                    )
                )
        if str(command.get("property", "")).strip().lower() == "rotation":
            errors.append(
                _field_error(index, ctype, "property", "camera rotation is never written")
            )
    elif ctype == "AiPlaceMouthClip":
        req("nodeId", "clipName", "startTime")
        num("startTime", non_negative=True)
        num("duration", non_negative=True) if command.get("duration") is not None else None
        tag = command.get("partTag")
        if tag is not None and tag not in ("intro", "outro"):
            errors.append(_field_error(index, ctype, "partTag", "must be 'intro' or 'outro'"))
        semantic = command.get("semanticName")
        if semantic is not None and semantic != "mouth":
            errors.append(
                _field_error(index, ctype, "semanticName", "mouth clips belong on 'mouth' nodes")
            )
        for baked in ("shapeId", "fromShapeId", "toShapeId"):
            if command.get(baked) is not None:
                errors.append(
                    _field_error(
                        index, ctype, baked, "baked shape ids are forbidden — clips stay name-based"
                    )
                )
    elif ctype == "SetSlideAnimationScript":
        req("slideId", "source")
        if command.get("source") is not None and not isinstance(command.get("source"), str):
            errors.append(_field_error(index, ctype, "source", "must be a string"))
    elif ctype == "AiAnimationAssetBatch":
        operations = command.get("operations")
        if not isinstance(operations, list) or not operations:
            errors.append(_field_error(index, ctype, "operations", "must be a non-empty list"))
        elif len(operations) > 40:
            errors.append(
                _field_error(index, ctype, "operations", "must contain at most 40 operations")
            )
        elif len(operations) > 1 and any(
            isinstance(operation, dict) and str(operation.get("kind", "")).startswith("upsert")
            for operation in operations
        ):
            errors.append(
                _field_error(
                    index,
                    ctype,
                    "operations",
                    "must contain one create/update operation per approval step",
                )
            )
        else:
            supported = {
                "upsertShape": ("action", "nodeId", "shape"),
                "deleteShape": ("nodeId", "shapeId"),
                "upsertClip": ("action", "nodeId", "clip"),
                "deleteClip": ("clipId",),
                "deleteClipInstance": ("nodeId", "instanceId"),
                "upsertCollection": ("action", "collection"),
                "deleteCollection": ("collectionId",),
            }
            for operation_index, operation in enumerate(operations):
                if not isinstance(operation, dict):
                    errors.append(
                        _field_error(
                            index, ctype, f"operations[{operation_index}]", "must be an object"
                        )
                    )
                    continue
                kind = operation.get("kind")
                fields = supported.get(kind) if isinstance(kind, str) else None
                if fields is None:
                    errors.append(
                        _field_error(
                            index, ctype, f"operations[{operation_index}].kind", "is unsupported"
                        )
                    )
                    continue
                if kind in ("upsertShape", "upsertClip", "upsertCollection") and operation.get(
                    "action"
                ) not in ("create", "update"):
                    errors.append(
                        _field_error(
                            index,
                            ctype,
                            f"operations[{operation_index}].action",
                            "must be create or update",
                        )
                    )
                if (
                    kind == "upsertShape"
                    and operation.get("action") == "create"
                    and not _is_non_empty_string(operation.get("sourceShapeId"))
                ):
                    errors.append(
                        _field_error(
                            index,
                            ctype,
                            f"operations[{operation_index}].sourceShapeId",
                            "is required for a Shape draft",
                        )
                    )
                if (
                    kind in ("upsertShape", "upsertClip", "upsertCollection")
                    and operation.get("action") == "update"
                    and not _is_non_empty_string(operation.get("targetId"))
                ):
                    errors.append(
                        _field_error(
                            index,
                            ctype,
                            f"operations[{operation_index}].targetId",
                            "is required for an update",
                        )
                    )
                for field in fields:
                    if operation.get(field) is None:
                        errors.append(
                            _field_error(
                                index,
                                ctype,
                                f"operations[{operation_index}].{field}",
                                "is required",
                            )
                        )
                if kind == "upsertShape":
                    shape = operation.get("shape")
                    if not isinstance(shape, dict):
                        errors.append(
                            _field_error(
                                index,
                                ctype,
                                f"operations[{operation_index}].shape",
                                "must be an object",
                            )
                        )
                    else:
                        if not _is_non_empty_string(shape.get("id")) or not _is_non_empty_string(
                            shape.get("name")
                        ):
                            errors.append(
                                _field_error(
                                    index,
                                    ctype,
                                    f"operations[{operation_index}].shape",
                                    "must include a non-empty id and name",
                                )
                            )
                        vertices = shape.get("vertices")
                        if not isinstance(vertices, list) or not vertices or len(vertices) > 2000:
                            errors.append(
                                _field_error(
                                    index,
                                    ctype,
                                    f"operations[{operation_index}].shape.vertices",
                                    "must contain 1 to 2000 vertices",
                                )
                            )
                        elif any(
                            not isinstance(vertex, dict)
                            or not _is_finite_number(vertex.get("x"))
                            or not _is_finite_number(vertex.get("y"))
                            for vertex in vertices
                        ):
                            errors.append(
                                _field_error(
                                    index,
                                    ctype,
                                    f"operations[{operation_index}].shape.vertices",
                                    "must contain finite x/y positions",
                                )
                            )
                elif kind == "upsertClip":
                    clip = operation.get("clip")
                    if (
                        not isinstance(clip, dict)
                        or not _is_non_empty_string(clip.get("id"))
                        or not _is_non_empty_string(clip.get("name"))
                        or not _is_finite_number(clip.get("duration"))
                        or not isinstance(clip.get("channels"), list)
                        or not isinstance(clip.get("params", []), list)
                    ):
                        errors.append(
                            _field_error(
                                index,
                                ctype,
                                f"operations[{operation_index}].clip",
                                "must be a complete ClipJSON with id, name, duration, channels, and params",
                            )
                        )
                elif kind == "upsertCollection":
                    collection = operation.get("collection")
                    if (
                        not isinstance(collection, dict)
                        or not _is_non_empty_string(collection.get("id"))
                        or not _is_non_empty_string(collection.get("name"))
                        or not _is_non_empty_string(collection.get("sourceNodeId"))
                        or not isinstance(collection.get("bindings"), dict)
                        or not collection.get("bindings")
                    ):
                        errors.append(
                            _field_error(
                                index,
                                ctype,
                                f"operations[{operation_index}].collection",
                                "must include id, name, sourceNodeId, and non-empty semantic bindings",
                            )
                        )
    elif ctype == "AiRunAnimationScript":
        req("slideId", "source")
        if command.get("source") is not None and not isinstance(command.get("source"), str):
            errors.append(_field_error(index, ctype, "source", "must be a string"))
    elif ctype == "AiDeleteAnimationScript":
        req("slideId")
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
        slide_ids = command.get("slideIds")
        slides = command.get("slides")
        has_ids = isinstance(slide_ids, list) and len(slide_ids) > 0
        has_slides = isinstance(slides, list) and len(slides) > 0
        if not has_ids and not has_slides:
            errors.append(
                _field_error(
                    index,
                    ctype,
                    "slides",
                    "provide 'slides' (source SlideJSON list) with 'slideIds' — "
                    "open the named intro/outro project first",
                )
            )
        elif has_ids and not all(_is_non_empty_string(s) for s in slide_ids or []):
            errors.append(
                _field_error(index, ctype, "slideIds", "must be a list of non-empty strings")
            )
        if slides is not None:
            if not isinstance(slides, list) or not slides:
                errors.append(
                    _field_error(index, ctype, "slides", "must be a non-empty list when present")
                )
            else:
                for order, raw in enumerate(slides):
                    if not isinstance(raw, dict):
                        errors.append(
                            _field_error(
                                index, ctype, f"slides[{order}]", "must be a SlideJSON object"
                            )
                        )
                        continue
                    if not _is_non_empty_string(raw.get("id")):
                        errors.append(
                            _field_error(index, ctype, f"slides[{order}].id", "is required")
                        )
                    if not _is_non_empty_string(raw.get("name")):
                        errors.append(
                            _field_error(index, ctype, f"slides[{order}].name", "is required")
                        )
        for field in ("clips", "clipCollections"):
            entries = command.get(field)
            if entries is None:
                continue
            if not isinstance(entries, list):
                errors.append(_field_error(index, ctype, field, "must be a list when present"))
                continue
            for order, raw in enumerate(entries):
                if not isinstance(raw, dict):
                    errors.append(
                        _field_error(index, ctype, f"{field}[{order}]", "must be an object")
                    )
                    continue
                if not _is_non_empty_string(raw.get("id")):
                    errors.append(_field_error(index, ctype, f"{field}[{order}].id", "is required"))
                if not _is_non_empty_string(raw.get("name")):
                    errors.append(
                        _field_error(index, ctype, f"{field}[{order}].name", "is required")
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
