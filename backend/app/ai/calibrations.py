"""Stage D calibration helpers: verify-only triple check + phoneme-timed mouth.

Implements issue #426 (Spec 12 build Stage D) against the resolution on
#414: a verify-only triple check (voice reuse against the accepted Stage C
voice record plus pregen duration/level measurement; face-rig readiness of
user-owned mouth Shapes plus MorphBinding presence; intro/outro camera
framing) that creates no Shapes, rewrites no audio, and rebinds no morphs.
Mouth timing comes from backend forced-alignment word timings mapped through
the rig-local phoneme-to-Shape map, with a per-part waveform-peaks envelope
fallback driving a single Open coefficient, clearly marked when alignment is
unavailable. The agent writes only morphCoefficient tracks (AiSetMorph-
Coefficient / AiSetControlValue / AiPlaceMouthClip — never Shape
creation/rename, binding rewrites, or baked shape ids), preserving
name-based portability with soft-warn-and-skip on missing shapes. Mouth and
camera stay scoped to pregenerated intro/outro cat nodes (blackboard middle
excluded); camera framing is pan/zoom keys only, rotation never written,
holding the exactly-one-camera invariant.
"""

from __future__ import annotations

import io
import struct
import wave
from typing import Any

INTRO_OUTRO_TAGS: tuple[str, ...] = ("intro", "outro")

# Camera framing is pan/zoom keys only: pan = positionX/positionY, zoom =
# scaleX/scaleY. Rotation is never written (locked); anything outside this set
# fails the camera check.
PAN_ZOOM_KEYS: tuple[str, ...] = ("positionX", "positionY", "scaleX", "scaleY")

# Fallback single coefficient shape name (rig-local Open mouth). The rig owns
# the actual Shape; the agent only drives the coefficient and skips with a
# soft warning when the target rig has no such shape.
OPEN_SHAPE = "Open"

# Minimal phoneme inventory for the word -> shape mapping. The rig-local
# phoneme-to-Shape map (user-authored shape names per rig) decides the real
# names — no global viseme set is pinned here. These labels are the mapping
# keys only.
_PHONEME_FOR_CHAR: dict[str, str] = {}


def _build_phoneme_table() -> dict[str, str]:
    table: dict[str, str] = {}
    for ch in ("a", "e", "i", "y"):
        table[ch] = "AH"
    for ch in ("o", "u", "w"):
        table[ch] = "OW"
    for ch in ("b", "m", "p"):
        table[ch] = "B"
    for ch in ("f", "v"):
        table[ch] = "F"
    for ch in ("l", "r"):
        table[ch] = "L"
    for ch in ("s", "z", "c"):
        table[ch] = "S"
    for ch in ("k", "g", "q", "x"):
        table[ch] = "K"
    for ch in ("d", "t", "n"):
        table[ch] = "T"
    for ch in ("j", "h"):
        table[ch] = "H"
    return table


_PHONEME_FOR_CHAR = _build_phoneme_table()

_MOUTH_COMMAND_TYPES: tuple[str, ...] = (
    "AiSetMorphCoefficient",
    "AiSetControlValue",
    "AiPlaceMouthClip",
)


def split_words(spoken_line: str) -> list[str]:
    """Split a verbatim spoken line into words (whitespace split, order kept)."""
    return [w for w in spoken_line.split() if w]


def intro_outro_steps_from_scenario(
    steps: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Intro/outro steps only, verbatim — middle (blackboard) excluded.

    No re-derivation: spokenLine is copied exactly. Raises when no
    intro/outro steps carry spoken lines.
    """
    out: list[dict[str, Any]] = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        if str(step.get("partTag", "")) not in INTRO_OUTRO_TAGS:
            continue
        step_id = str(step.get("id", ""))
        spoken = step.get("spokenLine", "")
        if not step_id or not isinstance(spoken, str) or not spoken.strip():
            continue
        order = step.get("order", len(out))
        out.append(
            {
                "stepId": step_id,
                "order": order if isinstance(order, int) else len(out),
                "partTag": str(step.get("partTag")),
                "spokenLine": spoken,
                "audioDuration": None,
                "level": None,
                "words": [],
                "fallback": False,
                "envelope": [],
                "missingShapes": [],
            }
        )
    if not out:
        raise ValueError("no intro/outro steps with spoken lines — nothing to calibrate")
    return out


def phoneme_for_char(ch: str) -> str:
    """Single-character -> phoneme label (mapping key, not a viseme inventory)."""
    lowered = ch.lower()
    if len(lowered) != 1 or not lowered.isalpha():
        return "AH"
    return _PHONEME_FOR_CHAR.get(lowered, "AH")


def word_to_phonemes(word: str) -> list[str]:
    """Word -> phoneme labels, one per alpha char, consecutive deduped."""
    phonemes: list[str] = []
    for ch in word:
        if not ch.isalpha():
            continue
        label = phoneme_for_char(ch)
        if not phonemes or phonemes[-1] != label:
            phonemes.append(label)
    return phonemes or ["AH"]


def shape_for_word(word: str, phoneme_map: dict[str, str] | None) -> tuple[str | None, str]:
    """Map one word to its rig-local mouth Shape via the first phoneme.

    Returns (shape_name_or_None, phoneme_label). Unknown phonemes yield None
    so the caller can soft-warn-and-skip instead of inventing a shape.
    """
    phonemes = word_to_phonemes(word)
    phoneme = phonemes[0] if phonemes else "AH"
    if not phoneme_map:
        return None, phoneme
    shape = phoneme_map.get(phoneme)
    return (shape if isinstance(shape, str) and shape.strip() else None), phoneme


def validate_aligner_words(
    spoken_line: str,
    audio_duration: float,
    words: list[dict[str, Any]],
) -> list[str]:
    """Validate backend forced-alignment word timings for one part.

    Verbatim: word count and text must match the spoken line exactly, in
    order. Times must sit inside [0, audioDuration], ordered, non-overlapping.
    Returns error strings (empty == valid). Char-proportional synthesis is
    deliberately NOT offered here — without aligner words the part must take
    the envelope fallback path.
    """
    errors: list[str] = []
    if not isinstance(audio_duration, (int, float)) or float(audio_duration) <= 0:
        errors.append("audioDuration must be > 0 before word timings can apply")
        return errors
    expected = split_words(spoken_line)
    if not isinstance(words, list) or not words:
        errors.append("aligner produced no word timings — use the envelope fallback")
        return errors
    if len(words) != len(expected):
        errors.append(
            f"aligner word count {len(words)} != spoken word count {len(expected)} — "
            "use the envelope fallback"
        )
    duration = float(audio_duration)
    previous_end = 0.0
    for index, raw in enumerate(words):
        if not isinstance(raw, dict):
            errors.append(f"word #{index}: must be an object with word/start/end")
            continue
        word = raw.get("word")
        start = raw.get("start")
        end = raw.get("end")
        want = expected[index] if index < len(expected) else None
        if not isinstance(word, str) or not word:
            errors.append(f"word #{index}: missing word text")
        elif want is not None and word != want:
            errors.append(
                f"word #{index}: {word!r} != spoken {want!r} — "
                "timings must stay verbatim, use the envelope fallback"
            )
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            errors.append(f"word #{index} ({word}): start/end must be numbers")
            continue
        start_f = float(start)
        end_f = float(end)
        if not (0 <= start_f < end_f <= duration):
            errors.append(f"word #{index} ({word}): [{start_f}, {end_f}] outside [0, {duration}]")
        if start_f < previous_end - 1e-9:
            errors.append(f"word #{index} ({word}): overlaps the previous word")
        previous_end = max(previous_end, end_f)
    return errors


def map_words_to_shapes(
    words: list[dict[str, Any]],
    phoneme_map: dict[str, str] | None,
) -> list[dict[str, Any]]:
    """Attach phoneme + rig-local shape to validated aligner words.

    A word carrying an aligner-supplied phoneme uses it when the rig-local map
    knows it; otherwise the first-phoneme heuristic supplies the mapping key.
    Unknown phonemes yield shape None so the caller soft-warns-and-skips.
    """
    mapped: list[dict[str, Any]] = []
    for raw in words:
        if not isinstance(raw, dict):
            continue
        word = str(raw.get("word", ""))
        supplied = raw.get("phoneme")
        if (
            isinstance(supplied, str)
            and supplied.strip()
            and phoneme_map
            and supplied.strip() in phoneme_map
        ):
            phoneme = supplied.strip()
            shape = phoneme_map.get(phoneme)
            shape_name = shape if isinstance(shape, str) and shape.strip() else None
        else:
            shape_name, phoneme = shape_for_word(word, phoneme_map)
        mapped.append(
            {
                "word": word,
                "start": float(raw.get("start", 0.0)),
                "end": float(raw.get("end", 0.0)),
                "phoneme": phoneme,
                "shape": shape_name,
                "missing": shape_name is None,
            }
        )
    return mapped


def envelope_coefficients(
    peaks: list[int],
    audio_duration: float,
    max_keys: int = 32,
) -> list[dict[str, float]]:
    """Waveform-peaks envelope -> single Open coefficient curve.

    Peaks use the AudioAsset waveformPeaks convention (0-255 ints).
    Normalized to [0, 1] (peak/255), downsampled by max-per-bucket to at most
    max_keys keys. This is the per-part fallback when forced alignment is
    unavailable — never char-proportional.
    """
    if not isinstance(audio_duration, (int, float)) or float(audio_duration) <= 0:
        raise ValueError("audioDuration must be > 0 for the envelope fallback")
    if not isinstance(peaks, list) or not peaks:
        raise ValueError("peaks must be a non-empty list for the envelope fallback")
    for peak in peaks:
        if not isinstance(peak, int) or not 0 <= peak <= 255:
            raise ValueError("peaks must be 0-255 ints (waveformPeaks convention)")
    duration = float(audio_duration)
    count = min(int(max_keys), len(peaks))
    if count <= 0:
        raise ValueError("max_keys must be > 0")
    per_bucket = len(peaks) / count
    keys: list[dict[str, float]] = []
    for i in range(count):
        start = int(i * per_bucket)
        end = int((i + 1) * per_bucket) if i < count - 1 else len(peaks)
        chunk = peaks[start:end] or [0]
        peak = max(chunk)
        keys.append(
            {
                "t": round((i + 0.5) / count * duration, 4),
                "open": round(peak / 255.0, 4),
            }
        )
    return keys


def measure_wav(wav_bytes: bytes) -> tuple[float | None, float | None]:
    """Measure (duration, level) from WAV bytes; (None, None) when unreadable.

    Level is RMS normalized to [0, 1] for 16-bit PCM (8-bit shifted). Never
    rewrites audio — measure only.
    """
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as w:
            framerate = w.getframerate()
            nframes = w.getnframes()
            sampwidth = w.getsampwidth()
            if not framerate or nframes <= 0:
                return None, None
            duration = float(nframes) / float(framerate)
            raw = w.readframes(nframes)
            if not raw:
                return duration, 0.0
            if sampwidth == 2:
                fmt = f"<{len(raw) // 2}h"
                samples = struct.unpack(fmt, raw)
                if not samples:
                    return duration, 0.0
                mean_square = sum(float(s) * float(s) for s in samples) / len(samples)
                level = (mean_square**0.5) / 32768.0
            elif sampwidth == 1:
                samples_u = struct.unpack(f"<{len(raw)}B", raw)
                shifted = [float(s) - 128.0 for s in samples_u]
                if not shifted:
                    return duration, 0.0
                mean_square = sum(s * s for s in shifted) / len(shifted)
                level = (mean_square**0.5) / 128.0
            else:
                return duration, None
            return duration, max(0.0, min(1.0, float(level)))
    except Exception:  # noqa: BLE001
        return None, None


def verify_voice_reuse(
    narration_default_voice: str | None,
    expected_voice: str | None,
    pregen: list[dict[str, Any]],
) -> dict[str, Any]:
    """Voice check: single-voice consistency + pregen duration/level measure.

    Never rewrites audio. expected_voice None means "reuse the accepted Stage C
    default". Mismatch or unmeasurable pregen audio fails the check.
    """
    expected = (expected_voice or "").strip() or None
    default = (narration_default_voice or "").strip() or None
    if expected is not None and expected != default:
        return {
            "ok": False,
            "expectedVoicePromptId": expected,
            "narrationVoicePromptId": default,
            "message": (
                f"voice mismatch: calibration expects {expected} but the accepted "
                f"narration uses {default} — fix the voice before accepting"
            ),
        }
    if not pregen:
        return {
            "ok": False,
            "expectedVoicePromptId": expected or default,
            "narrationVoicePromptId": default,
            "message": "no pregenerated intro/outro audio measured — measure it first",
        }
    for entry in pregen:
        duration = entry.get("audioDuration")
        if not isinstance(duration, (int, float)) or float(duration) <= 0:
            return {
                "ok": False,
                "expectedVoicePromptId": expected or default,
                "narrationVoicePromptId": default,
                "message": (
                    f"pregen part {entry.get('stepId', '?')}: no measurable duration — "
                    "measure pregen audio before accepting"
                ),
            }
    return {
        "ok": True,
        "expectedVoicePromptId": expected or default,
        "narrationVoicePromptId": default,
        "measured": len(pregen),
        "message": "voice reused from the accepted narration; pregen audio measured",
    }


def verify_face_rig(
    mouth_shapes: list[str] | None,
    morph_binding: dict[str, Any] | None,
) -> dict[str, Any]:
    """Face-rig readiness: user-owned mouth Shapes + MorphBinding presence.

    Verify-only: never creates Shapes, never rewrites bindings. Missing shapes
    are reported for soft-warn-and-skip and block the gate until fixed.
    """
    shapes = [s for s in (mouth_shapes or []) if isinstance(s, str) and s.strip()]
    if not shapes:
        return {
            "ok": False,
            "mouthShapes": [],
            "missing": [],
            "message": "no user-owned mouth Shapes supplied — author the cat rig first",
        }
    if not isinstance(morph_binding, dict):
        return {
            "ok": False,
            "mouthShapes": list(shapes),
            "missing": [],
            "message": "no MorphBinding on the cat node — select From/To mouth Shapes first",
        }
    from_shape = morph_binding.get("fromShape")
    to_shape = morph_binding.get("toShape")
    # Accept either name-based (portable) or id-based pairs; names win.
    from_name = from_shape.strip() if isinstance(from_shape, str) and from_shape.strip() else None
    to_name = to_shape.strip() if isinstance(to_shape, str) and to_shape.strip() else None
    if from_name is None or to_name is None:
        return {
            "ok": False,
            "mouthShapes": list(shapes),
            "missing": [],
            "message": "MorphBinding is incomplete — select both From and To mouth Shapes",
        }
    missing = [name for name in (from_name, to_name) if name not in shapes]
    if missing:
        return {
            "ok": False,
            "mouthShapes": list(shapes),
            "missing": missing,
            "message": (
                f"binding references missing mouth Shapes {missing} — soft-warn-and-skip: "
                "author them on the reusable cat object first"
            ),
        }
    return {
        "ok": True,
        "mouthShapes": list(shapes),
        "missing": [],
        "message": "face rig ready: user Shapes + MorphBinding present, agent writes coefficients only",
    }


def verify_camera_framing(
    camera_count: int,
    camera_keys: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Intro/outro camera framing: exactly-one-camera, pan/zoom only.

    Verify-only: rotation keys, non-pan/zoom properties, or middle-scope keys
    fail the check. The agent never writes rotation; middle slides are owned
    by Stage E.
    """
    keys = list(camera_keys or [])
    if camera_count != 1:
        return {
            "ok": False,
            "cameraCount": camera_count,
            "message": (
                f"exactly one camera required, found {camera_count} — "
                "fix the scene before accepting"
            ),
        }
    for key in keys:
        if not isinstance(key, dict):
            continue
        prop = str(key.get("property", ""))
        if prop.strip().lower() == "rotation":
            return {
                "ok": False,
                "cameraCount": camera_count,
                "message": "camera rotation writes are forbidden — pan/zoom keys only",
            }
        if prop.strip() and prop.strip() not in PAN_ZOOM_KEYS:
            return {
                "ok": False,
                "cameraCount": camera_count,
                "message": (
                    f"camera key property {prop!r} is not pan/zoom "
                    "(positionX/positionY/scaleX/scaleY only)"
                ),
            }
        tag = str(key.get("partTag", ""))
        if tag and tag not in INTRO_OUTRO_TAGS:
            return {
                "ok": False,
                "cameraCount": camera_count,
                "message": (
                    f"camera keys are scoped to intro/outro only (got partTag {tag!r}) — "
                    "the blackboard middle is owned by Stage E"
                ),
            }
    return {
        "ok": True,
        "cameraCount": camera_count,
        "keyCount": len(keys),
        "message": "camera framing holds: exactly one camera, pan/zoom keys on intro/outro",
    }


def validate_camera_keys(keys: list[dict[str, Any]]) -> list[str]:
    """Reject rotation writes, non-pan/zoom properties, and middle-scope keys."""
    errors: list[str] = []
    for index, key in enumerate(keys):
        if not isinstance(key, dict):
            errors.append(f"camera key #{index}: must be an object")
            continue
        prop = str(key.get("property", ""))
        if prop.strip().lower() == "rotation":
            errors.append(f"camera key #{index}: rotation is never written — pan/zoom keys only")
        elif prop.strip() and prop.strip() not in PAN_ZOOM_KEYS:
            errors.append(
                f"camera key #{index}: property {prop!r} is not pan/zoom "
                "(positionX/positionY/scaleX/scaleY only)"
            )
        tag = str(key.get("partTag", ""))
        if tag and tag not in INTRO_OUTRO_TAGS:
            errors.append(f"camera key #{index}: partTag must be intro/outro (middle excluded)")
    return errors


def reject_forbidden_writes(commands: list[dict[str, Any]]) -> list[str]:
    """Accept-gate helper: only morphCoefficient-track commands may execute.

    Rejects Shape creation/rename, binding rewrites, baked shape ids, audio
    rewrites, camera rotation, and any middle-scope placement.
    """
    errors: list[str] = []
    for index, command in enumerate(commands):
        if not isinstance(command, dict):
            errors.append(f"command #{index}: must be an object")
            continue
        ctype = str(command.get("type", ""))
        if ctype not in _MOUTH_COMMAND_TYPES:
            errors.append(
                f"command #{index} ({ctype or '?'}): Stage D writes morphCoefficient "
                "tracks only (AiSetMorphCoefficient / AiSetControlValue / "
                "AiPlaceMouthClip) — Shape creation, binding rewrites, and audio "
                "rewrites are forbidden"
            )
            continue
        if "shapeId" in command or "fromShapeId" in command or "toShapeId" in command:
            errors.append(
                f"command #{index} ({ctype}): baked shape ids are forbidden — "
                "clips stay name-based and portable"
            )
        tag = command.get("partTag")
        if tag is not None and tag not in INTRO_OUTRO_TAGS:
            errors.append(
                f"command #{index} ({ctype}): partTag must be intro/outro (middle excluded)"
            )
        if str(command.get("property", "")).strip().lower() == "rotation":
            errors.append(f"command #{index} ({ctype}): camera rotation is never written")
        if ctype == "AiPlaceMouthClip":
            semantic = command.get("semanticName")
            if semantic is not None and semantic != "mouth":
                errors.append(
                    f"command #{index} ({ctype}): mouth clips belong on semanticName 'mouth' nodes"
                )
    return errors


def build_mouth_commands(
    timings: list[dict[str, Any]],
    node_ids: dict[str, str],
    phoneme_map: dict[str, str] | None = None,
    available_shapes: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Phoneme-timed mouth commands, morphCoefficient tracks only.

    Aligned parts emit one AiSetMorphCoefficient per word (coefficient 1.0 at
    the word start, carrying the rig-local shape name as context — the track
    itself stays a scalar coefficient against the user-owned binding).
    Fallback parts emit one AiSetMorphCoefficient per envelope key driving the
    single Open coefficient. Missing shapes soft-warn-and-skip: the word is
    skipped and the shape recorded in warnings (and on the timing entry) so
    the accept gate stays blocked until the rig is fixed.

    Middle parts raise — mouth and camera stay scoped to intro/outro.
    """
    shapes = (
        [s for s in (available_shapes or []) if isinstance(s, str) and s.strip()]
        if available_shapes is not None
        else None
    )
    commands: list[dict[str, Any]] = []
    warnings: list[str] = []
    for timing in timings:
        part_tag = str(timing.get("partTag", ""))
        step_id = str(timing.get("stepId", "?"))
        if part_tag not in INTRO_OUTRO_TAGS:
            raise ValueError(
                f"part {step_id}: mouth stays on intro/outro cat nodes (blackboard middle excluded)"
            )
        node_id = node_ids.get(step_id, "")
        if not node_id.strip():
            raise ValueError(f"part {step_id}: no cat node mapped for this intro/outro part")
        if timing.get("fallback"):
            envelope = timing.get("envelope", [])
            if not isinstance(envelope, list) or not envelope:
                raise ValueError(f"part {step_id}: fallback marked but no envelope keys recorded")
            if shapes is not None and OPEN_SHAPE not in shapes:
                warnings.append(
                    f"part {step_id}: Open mouth Shape missing on target — "
                    "soft-warn-and-skip this part"
                )
                continue
            for key in envelope:
                if not isinstance(key, dict):
                    continue
                commands.append(
                    {
                        "type": "AiSetMorphCoefficient",
                        "nodeId": node_id.strip(),
                        "coefficient": float(key.get("open", 0.0)),
                        "partTag": part_tag,
                        "time": float(key.get("t", 0.0)),
                        "shape": OPEN_SHAPE,
                        "fallback": True,
                    }
                )
            continue
        words = timing.get("words", [])
        if not isinstance(words, list) or not words:
            raise ValueError(
                f"part {step_id}: no word timings and no fallback — "
                "align it or record the envelope fallback first"
            )
        mapped = map_words_to_shapes([dict(w) for w in words if isinstance(w, dict)], phoneme_map)
        for entry in mapped:
            shape = entry.get("shape")
            if not isinstance(shape, str) or not shape.strip():
                warnings.append(
                    f"part {step_id}: no rig-local shape for phoneme "
                    f"{entry.get('phoneme')} (word {entry.get('word')!r}) — "
                    "soft-warn-and-skip"
                )
                continue
            if shapes is not None and shape not in shapes:
                warnings.append(
                    f"part {step_id}: mouth Shape {shape!r} missing on target — soft-warn-and-skip"
                )
                continue
            commands.append(
                {
                    "type": "AiSetMorphCoefficient",
                    "nodeId": node_id.strip(),
                    "coefficient": 1.0,
                    "partTag": part_tag,
                    "time": float(entry.get("start", 0.0)),
                    "word": str(entry.get("word", "")),
                    "shape": shape,
                    "phoneme": str(entry.get("phoneme", "")),
                }
            )
    return commands, warnings


def build_control_mouth_commands(
    timings: list[dict[str, Any]],
    node_ids: dict[str, str],
    control_key: str = "Open",
    phoneme_map: dict[str, str] | None = None,
    available_shapes: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Same timing source as build_mouth_commands, via Control values."""
    if not control_key.strip():
        raise ValueError("controlKey must be a non-empty string")
    coefficients, warnings = build_mouth_commands(timings, node_ids, phoneme_map, available_shapes)
    commands: list[dict[str, Any]] = []
    for command in coefficients:
        step_commands_tag = command.get("partTag")
        commands.append(
            {
                "type": "AiSetControlValue",
                "nodeId": str(command.get("nodeId", "")),
                "controlKey": control_key.strip(),
                "value": float(command.get("coefficient", 0.0)),
                "partTag": step_commands_tag,
                "time": float(command.get("time", 0.0)),
                **(
                    {"word": command["word"], "shape": command["shape"]}
                    if "word" in command
                    else {"shape": command.get("shape", OPEN_SHAPE)}
                ),
            }
        )
    return commands, warnings


def build_clip_mouth_commands(
    timings: list[dict[str, Any]],
    node_ids: dict[str, str],
    clip_name: str = "mouth-open",
    phoneme_map: dict[str, str] | None = None,
    available_shapes: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Same timing source as build_mouth_commands, via mouth clip placements.

    Clip names stay name-based (never baked shape ids) so placements survive
    the reusable-object import with soft-warn-and-skip on missing shapes.
    Placements target semanticName 'mouth' nodes; the live dry-run resolves
    the semantic name against the target scene.
    """
    if not clip_name.strip():
        raise ValueError("clipName must be a non-empty string")
    coefficients, warnings = build_mouth_commands(timings, node_ids, phoneme_map, available_shapes)
    # One placement per part at its first key (clips carry their own internal
    # timing); word-level detail rides the coefficient/control paths.
    by_node: dict[str, dict[str, Any]] = {}
    for command in coefficients:
        node_id = str(command.get("nodeId", ""))
        if node_id not in by_node:
            by_node[node_id] = command
    commands: list[dict[str, Any]] = []
    for node_id, first in by_node.items():
        commands.append(
            {
                "type": "AiPlaceMouthClip",
                "nodeId": node_id,
                "clipName": clip_name.strip(),
                "semanticName": "mouth",
                "startTime": float(first.get("time", 0.0)),
                "partTag": first.get("partTag"),
            }
        )
    return commands, warnings


def calibration_accept_blockers(calibration: dict[str, Any]) -> list[str]:
    """Accept-gate blockers: triple check green + every part timed or fallback.

    Fallback parts are NOT blockers — they stay clearly marked and flow to the
    merge. Missing shapes, unmeasurable audio, middle scope, rotation writes,
    and untimed parts all block.
    """
    blockers: list[str] = []
    checks = calibration.get("checks", {})
    if not isinstance(checks, dict):
        return ["calibration has no verify-only checks recorded"]
    voice = checks.get("voice", {})
    face_rig = checks.get("faceRig", {})
    camera = checks.get("camera", {})
    if not isinstance(voice, dict) or not voice.get("ok"):
        message = voice.get("message", "voice check") if isinstance(voice, dict) else "voice"
        blockers.append(f"voice: {message} — fix the voice before accepting")
    if not isinstance(face_rig, dict) or not face_rig.get("ok"):
        message = (
            face_rig.get("message", "face-rig check") if isinstance(face_rig, dict) else "face-rig"
        )
        blockers.append(f"face-rig: {message} — author the mouth Shapes first")
    if not isinstance(camera, dict) or not camera.get("ok"):
        message = camera.get("message", "camera check") if isinstance(camera, dict) else "camera"
        blockers.append(f"camera: {message} — fix framing before accepting")
    timings = calibration.get("timings", [])
    if not isinstance(timings, list) or not timings:
        blockers.append("no intro/outro timings recorded — calibrate the pregen parts first")
        return blockers
    for timing in timings:
        if not isinstance(timing, dict):
            blockers.append("a timing entry is corrupt — recalibrate")
            continue
        step_id = str(timing.get("stepId", "?"))
        part_tag = str(timing.get("partTag", ""))
        if part_tag not in INTRO_OUTRO_TAGS:
            blockers.append(
                f"part {step_id}: mouth and camera stay on intro/outro (blackboard middle excluded)"
            )
        duration = timing.get("audioDuration")
        if not isinstance(duration, (int, float)) or float(duration) <= 0:
            blockers.append(
                f"part {step_id}: pregen audio not measured — measure it before accepting"
            )
        missing = timing.get("missingShapes", [])
        if isinstance(missing, list) and missing:
            blockers.append(
                f"part {step_id}: missing mouth Shapes {missing} — "
                "soft-warn-and-skip: author them on the cat rig first"
            )
        words = timing.get("words", [])
        has_words = isinstance(words, list) and len(words) > 0
        fallback = bool(timing.get("fallback"))
        envelope = timing.get("envelope", [])
        has_envelope = isinstance(envelope, list) and len(envelope) > 0
        if not has_words and not (fallback and has_envelope):
            blockers.append(
                f"part {step_id}: no word timings and no marked fallback — "
                "align it or record the envelope fallback first"
            )
    return blockers
