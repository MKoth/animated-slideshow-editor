"""Stage D verify-only calibration + phoneme-timed mouth (Spec 12, issue #426).

Verify-only triple check (voice reuse + face-rig readiness + intro/outro
camera framing) creating nothing; mouth timing from backend forced-alignment
word timings mapped through the rig-local phoneme-to-Shape map with a
per-part waveform-peaks envelope fallback driving a single Open coefficient,
clearly marked. Agent writes morphCoefficient tracks only; user Shapes
untouched. Mouth and camera scoped to intro/outro (middle excluded); camera
pan/zoom keys only, rotation never written. Own versioned record + accept
gate feeding the merge.
"""

from __future__ import annotations

import io
import json
import wave
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai.calibrations import (
    build_clip_mouth_commands,
    build_control_mouth_commands,
    build_mouth_commands,
    calibration_accept_blockers,
    envelope_coefficients,
    intro_outro_steps_from_scenario,
    map_words_to_shapes,
    measure_wav,
    reject_forbidden_writes,
    split_words,
    validate_aligner_words,
    validate_camera_keys,
    verify_camera_framing,
    verify_face_rig,
    verify_voice_reuse,
)
from app.ai.proposals import validate_proposal_commands
from app.ai.zen import ZenClient

SAMPLE_SCENARIO = {
    "title": "Ser vs Estar cat lesson",
    "description": "Intro greeting, blackboard teaching, goodbye",
    "steps": [
        {
            "partTag": "intro",
            "spokenLine": "Hello friends, I am Mao the cat!",
            "onScreenAction": "Cat waves at the camera, classroom behind",
            "assetHints": ["cat", "classroom"],
            "estimatedDurationSec": 8.0,
        },
        {
            "partTag": "middle",
            "spokenLine": "Ser is for who you are.",
            "onScreenAction": "Chalk text appears on the blackboard line by line",
            "assetHints": ["blackboard", "chalk text"],
            "estimatedDurationSec": 20.0,
        },
        {
            "partTag": "middle",
            "spokenLine": "Listen to this chime while you read.",
            "onScreenAction": "Text appears with a soft chime sound",
            "assetHints": ["blackboard", "chime sound"],
            "estimatedDurationSec": 10.0,
        },
        {
            "partTag": "outro",
            "spokenLine": "Goodbye friends, see you soon!",
            "onScreenAction": "Cat waves goodbye, camera holds on face",
            "assetHints": ["cat"],
            "estimatedDurationSec": 6.0,
        },
    ],
}

PHONEME_MAP = {
    "AH": "Open",
    "OW": "Oval",
    "B": "Closed",
    "F": "Bite",
    "L": "Tongue",
    "S": "Hiss",
    "K": "Back",
    "T": "Tip",
    "H": "Breath",
}


def _sine_wav_bytes(duration: float = 1.25, sample_rate: int = 24000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * int(duration * sample_rate))
    return buffer.getvalue()


def _enable_key(client: TestClient) -> None:
    app_state: Any = client.app
    app_state.state.settings.ai_secret_key = "test-secret-for-calibration"
    r = client.put("/api/ai/settings", json={"apiKey": "sk-test-key-1234"})
    assert r.status_code == 200, r.text


def _fake_models(monkeypatch: pytest.MonkeyPatch, models: list[str]) -> None:
    def _list(self: ZenClient, http_client: Any = None) -> list[str]:
        _ = (self, http_client)
        return list(models)

    monkeypatch.setattr(ZenClient, "list_models", _list)


def _fake_scenario(monkeypatch: pytest.MonkeyPatch, payload: dict[str, Any]) -> None:
    import app.api.ai as ai_api

    def _gen(**kwargs: Any) -> dict[str, Any]:
        _ = kwargs
        parsed: Any = json.loads(json.dumps(payload))
        assert isinstance(parsed, dict)
        return dict(parsed)

    monkeypatch.setattr(ai_api, "_generate_scenario_structured", _gen)


def _make_project(client: TestClient, pid: str) -> None:
    blob = json.dumps(
        {
            "version": 2,
            "project": {
                "id": pid,
                "name": "Lesson",
                "description": "",
                "author": "",
                "createdAt": "2026-01-01T00:00:00",
                "modifiedAt": "2026-01-01T00:00:00",
                "settings": {},
            },
            "slides": [],
        }
    )
    r = client.post("/api/projects", content=blob, headers={"content-type": "application/json"})
    assert r.status_code == 200, r.text


def _make_accepted_narration(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, pid: str
) -> tuple[str, str, str, str]:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_scenario(monkeypatch, SAMPLE_SCENARIO)
    _make_project(client, pid)
    conv = client.post("/api/ai/conversations", json={"projectId": pid}).json()
    created = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": pid,
            "conversationId": conv["id"],
            "request": "Draft the cat lesson",
            "context": {},
        },
    ).json()
    scenario_id = created["id"]
    assert client.post(f"/api/ai/scenarios/{scenario_id}/accept").status_code == 200
    rec = client.post(
        "/api/ai/reconciliations",
        json={
            "projectId": pid,
            "scenarioId": scenario_id,
            "conversationId": conv["id"],
            "context": {},
        },
    )
    assert rec.status_code == 201, rec.text
    rec_id = rec.json()["id"]
    assert client.post(f"/api/ai/reconciliations/{rec_id}/accept").status_code == 200
    nar = client.post(
        "/api/ai/narrations",
        json={"projectId": pid, "reconciliationId": rec_id, "conversationId": conv["id"]},
    )
    assert nar.status_code == 201, nar.text
    nar_id = nar.json()["id"]
    for i, part in enumerate(nar.json()["parts"]):
        ready = client.post(
            f"/api/ai/narrations/{nar_id}/parts/{part['stepId']}/ready",
            json={"assetId": f"asset-{i}", "audioDuration": 1.0 + i},
        )
        assert ready.status_code == 200, ready.text
    assert client.post(f"/api/ai/narrations/{nar_id}/accept").status_code == 200
    return conv["id"], scenario_id, rec_id, nar_id


def _calibration_payload(pid: str, conv_id: str, nar_id: str) -> dict[str, Any]:
    return {
        "projectId": pid,
        "narrationId": nar_id,
        "conversationId": conv_id,
        "introRef": "pregen-intro",
        "outroRef": "pregen-outro",
        "phonemeMap": dict(PHONEME_MAP),
        "mouthShapes": [
            "Open",
            "Oval",
            "Closed",
            "Bite",
            "Tongue",
            "Hiss",
            "Back",
            "Tip",
            "Breath",
        ],
        "morphBinding": {"fromShape": "Closed", "toShape": "Open"},
        "cameraCount": 1,
        "cameraKeys": [
            {"property": "positionX", "partTag": "intro"},
            {"property": "scaleX", "partTag": "outro"},
        ],
    }


# -- pure scope seam -----------------------------------------------------------


def test_intro_outro_filter_middle_excluded_verbatim() -> None:
    steps = [
        {"id": "s1", "order": 0, "partTag": "intro", "spokenLine": "Hello, friends!"},
        {"id": "s2", "order": 1, "partTag": "middle", "spokenLine": "Ser is."},
        {"id": "s3", "order": 2, "partTag": "outro", "spokenLine": "Goodbye!"},
    ]
    parts = intro_outro_steps_from_scenario(steps)
    assert [p["stepId"] for p in parts] == ["s1", "s3"]
    assert [p["partTag"] for p in parts] == ["intro", "outro"]
    assert parts[0]["spokenLine"] == "Hello, friends!"
    assert split_words("Hello friends, I am Mao!") == ["Hello", "friends,", "I", "am", "Mao!"]


def test_intro_outro_rejects_empty() -> None:
    with pytest.raises(ValueError, match="nothing to calibrate"):
        intro_outro_steps_from_scenario(
            [{"id": "s1", "order": 0, "partTag": "middle", "spokenLine": "Ser is."}]
        )


def test_aligner_words_must_be_verbatim_ordered_inside_duration() -> None:
    spoken = "Hello friends"
    ok_words = [
        {"word": "Hello", "start": 0.0, "end": 0.5},
        {"word": "friends", "start": 0.5, "end": 1.0},
    ]
    assert validate_aligner_words(spoken, 1.0, ok_words) == []
    mapped = map_words_to_shapes(ok_words, PHONEME_MAP)
    assert [m["word"] for m in mapped] == ["Hello", "friends"]
    assert all(m["shape"] for m in mapped)
    # Count mismatch forces the fallback path (never char-proportional).
    assert validate_aligner_words(spoken, 1.0, [ok_words[0]]) != []
    # Reordered / overlapping / outside duration all fail.
    assert (
        validate_aligner_words(
            spoken,
            1.0,
            [
                {"word": "friends", "start": 0.0, "end": 0.5},
                {"word": "Hello", "start": 0.5, "end": 1.0},
            ],
        )
        != []
    )
    assert (
        validate_aligner_words(
            spoken,
            1.0,
            [
                {"word": "Hello", "start": 0.0, "end": 0.7},
                {"word": "friends", "start": 0.5, "end": 1.0},
            ],
        )
        != []
    )
    assert validate_aligner_words(spoken, 0.0, ok_words) != []


def test_envelope_fallback_normalizes_peaks_never_char_proportional() -> None:
    keys = envelope_coefficients([0, 128, 255, 64], 2.0, max_keys=4)
    assert len(keys) == 4
    assert keys[2]["open"] == pytest.approx(1.0)
    assert keys[0]["open"] == pytest.approx(0.0)
    assert all(0.0 <= k["open"] <= 1.0 for k in keys)
    assert [k["t"] for k in keys] == sorted(k["t"] for k in keys)
    # Downsamples long peak arrays to the key budget.
    assert len(envelope_coefficients([100] * 800, 4.0)) <= 32
    with pytest.raises(ValueError, match="peaks must be"):
        envelope_coefficients([], 1.0)
    with pytest.raises(ValueError, match="audioDuration must be"):
        envelope_coefficients([10], 0.0)


def test_measure_wav_probes_header_only() -> None:
    duration, level = measure_wav(_sine_wav_bytes(1.25))
    assert duration == pytest.approx(1.25)
    assert level is not None and 0.0 <= level <= 1.0
    assert measure_wav(b"not-a-wav") == (None, None)


def test_verify_triple_check_creates_nothing() -> None:
    voice = verify_voice_reuse(None, None, [{"stepId": "s1", "audioDuration": 2.0, "level": 0.4}])
    assert voice["ok"] is True
    assert (
        verify_voice_reuse(None, "other-voice", [{"stepId": "s1", "audioDuration": 1.0}])["ok"]
        is False
    )
    assert verify_voice_reuse(None, None, [{"stepId": "s1", "audioDuration": 0.0}])["ok"] is False
    face = verify_face_rig(["Open", "Closed"], {"fromShape": "Closed", "toShape": "Open"})
    assert face["ok"] is True
    assert verify_face_rig([], {"fromShape": "A", "toShape": "B"})["ok"] is False
    assert verify_face_rig(["Open"], None)["ok"] is False
    assert verify_face_rig(["Open"], {"fromShape": "Closed", "toShape": "Open"})["ok"] is False
    camera = verify_camera_framing(1, [{"property": "positionX", "partTag": "intro"}])
    assert camera["ok"] is True
    assert verify_camera_framing(2, [])["ok"] is False
    assert verify_camera_framing(1, [{"property": "rotation", "partTag": "intro"}])["ok"] is False
    assert verify_camera_framing(1, [{"property": "opacity", "partTag": "intro"}])["ok"] is False
    assert verify_camera_framing(1, [{"property": "positionX", "partTag": "middle"}])["ok"] is False
    assert validate_camera_keys([{"property": "rotation"}]) != []
    assert validate_camera_keys([{"property": "opacity"}]) != []
    assert validate_camera_keys([{"property": "positionX", "partTag": "middle"}]) != []
    assert validate_camera_keys([{"property": "positionX", "partTag": "intro"}]) == []


def test_mouth_builders_write_coefficients_only_intro_outro() -> None:
    timings = [
        {
            "stepId": "s1",
            "partTag": "intro",
            "spokenLine": "Hello friends",
            "audioDuration": 1.0,
            "words": [
                {"word": "Hello", "start": 0.0, "end": 0.5},
                {"word": "friends", "start": 0.5, "end": 1.0},
            ],
            "fallback": False,
            "envelope": [],
            "missingShapes": [],
        },
        {
            "stepId": "s4",
            "partTag": "outro",
            "spokenLine": "Goodbye friends",
            "audioDuration": 2.0,
            "words": [],
            "fallback": True,
            "envelope": envelope_coefficients([0, 255], 2.0, max_keys=2),
            "missingShapes": [],
        },
    ]
    node_ids = {"s1": "cat-intro", "s4": "cat-outro"}
    commands, warnings = build_mouth_commands(
        timings,
        node_ids,
        PHONEME_MAP,
        ["Open", "Oval", "Closed", "Bite", "Tongue", "Hiss", "Back", "Tip", "Breath"],
    )
    assert warnings == []
    assert commands
    assert {c["type"] for c in commands} == {"AiSetMorphCoefficient"}
    assert all(c["partTag"] in ("intro", "outro") for c in commands)
    assert all(0.0 <= float(c["coefficient"]) <= 1.0 for c in commands)
    ok, errors = validate_proposal_commands(commands)
    assert ok, errors
    # No Shape creation/rename, binding rewrites, or baked shape ids anywhere.
    blob = json.dumps(commands)
    assert "shapeId" not in blob and "Shape" not in blob.replace("AiSetMorphCoefficient", "")
    assert "rotation" not in blob.lower()

    controls, _ = build_control_mouth_commands(
        timings,
        node_ids,
        "Open",
        PHONEME_MAP,
        ["Open", "Oval", "Closed", "Bite", "Tongue", "Hiss", "Back", "Tip", "Breath"],
    )
    assert {c["type"] for c in controls} == {"AiSetControlValue"}
    assert validate_proposal_commands(controls)[0] is True

    clips, _ = build_clip_mouth_commands(
        timings,
        node_ids,
        "mouth-open",
        PHONEME_MAP,
        ["Open", "Oval", "Closed", "Bite", "Tongue", "Hiss", "Back", "Tip", "Breath"],
    )
    assert {c["type"] for c in clips} == {"AiPlaceMouthClip"}
    assert validate_proposal_commands(clips)[0] is True


def test_mouth_builder_middle_excluded_and_missing_shapes_warn_skip() -> None:
    with pytest.raises(ValueError, match="middle excluded"):
        build_mouth_commands(
            [
                {
                    "stepId": "s2",
                    "partTag": "middle",
                    "spokenLine": "Ser is.",
                    "audioDuration": 1.0,
                    "words": [{"word": "Ser", "start": 0.0, "end": 0.5}],
                    "fallback": False,
                    "envelope": [],
                    "missingShapes": [],
                }
            ],
            {"s2": "board-node"},
            PHONEME_MAP,
            ["Open"],
        )
    timings = [
        {
            "stepId": "s1",
            "partTag": "intro",
            "spokenLine": "Hello friends",
            "audioDuration": 1.0,
            "words": [
                {"word": "Hello", "start": 0.0, "end": 0.5},
                {"word": "friends", "start": 0.5, "end": 1.0},
            ],
            "fallback": False,
            "envelope": [],
            "missingShapes": [],
        }
    ]
    commands, warnings = build_mouth_commands(timings, {"s1": "cat-1"}, PHONEME_MAP, ["Open"])
    # 'friends' maps past the single available shape in at least one path —
    # soft-warn-and-skip keeps the proposal portable instead of failing.
    assert warnings
    assert all(c["type"] == "AiSetMorphCoefficient" for c in commands)


def test_reject_forbidden_writes_blocks_shapes_bindings_audio_rotation() -> None:
    assert reject_forbidden_writes([{"type": "CreateSlide", "name": "x"}]) != []
    assert (
        reject_forbidden_writes(
            [{"type": "AiSetMorphCoefficient", "nodeId": "c", "coefficient": 0.5}]
        )
        == []
    )
    assert (
        reject_forbidden_writes(
            [{"type": "AiSetMorphCoefficient", "nodeId": "c", "coefficient": 0.5, "shapeId": "s"}]
        )
        != []
    )
    assert (
        reject_forbidden_writes(
            [
                {
                    "type": "AiSetMorphCoefficient",
                    "nodeId": "c",
                    "coefficient": 0.5,
                    "partTag": "middle",
                }
            ]
        )
        != []
    )
    assert (
        reject_forbidden_writes(
            [
                {
                    "type": "AiSetControlValue",
                    "nodeId": "c",
                    "controlKey": "K",
                    "value": 1.0,
                    "property": "rotation",
                }
            ]
        )
        != []
    )
    assert (
        reject_forbidden_writes(
            [
                {
                    "type": "AiPlaceMouthClip",
                    "nodeId": "c",
                    "clipName": "m",
                    "startTime": 0.0,
                    "semanticName": "jaw",
                }
            ]
        )
        != []
    )
    # Server schema gate mirrors the same Stage D rules.
    ok, _ = validate_proposal_commands(
        [
            {
                "type": "AiSetControlValue",
                "nodeId": "c",
                "controlKey": "K",
                "value": 1.0,
                "partTag": "middle",
            }
        ]
    )
    assert ok is False
    ok, _ = validate_proposal_commands(
        [
            {
                "type": "AiPlaceMouthClip",
                "nodeId": "c",
                "clipName": "m",
                "startTime": 0.0,
                "semanticName": "jaw",
            }
        ]
    )
    assert ok is False


def test_accept_blockers_require_checks_and_timings_fallback_marked_ok() -> None:
    good_checks = {
        "voice": {"ok": True},
        "faceRig": {"ok": True},
        "camera": {"ok": True},
    }
    aligned = {
        "stepId": "s1",
        "partTag": "intro",
        "spokenLine": "Hello friends",
        "audioDuration": 1.0,
        "words": [{"word": "Hello", "start": 0.0, "end": 1.0}],
        "fallback": False,
        "envelope": [],
        "missingShapes": [],
    }
    fallback = {
        "stepId": "s4",
        "partTag": "outro",
        "spokenLine": "Goodbye friends",
        "audioDuration": 2.0,
        "words": [],
        "fallback": True,
        "envelope": [{"t": 1.0, "open": 0.5}],
        "missingShapes": [],
    }
    # Fallback stays marked but does NOT block the gate.
    assert (
        calibration_accept_blockers({"checks": good_checks, "timings": [aligned, fallback]}) == []
    )
    assert fallback["fallback"] is True
    bad_checks = {
        "voice": {"ok": False, "message": "mismatch"},
        "faceRig": {"ok": True},
        "camera": {"ok": True},
    }
    assert calibration_accept_blockers({"checks": bad_checks, "timings": [aligned]}) != []
    missing = dict(aligned, missingShapes=["Open"])
    assert calibration_accept_blockers({"checks": good_checks, "timings": [missing]}) != []
    untimed = dict(aligned, words=[], fallback=False, envelope=[])
    assert calibration_accept_blockers({"checks": good_checks, "timings": [untimed]}) != []
    middle = dict(aligned, partTag="middle")
    assert calibration_accept_blockers({"checks": good_checks, "timings": [middle]}) != []


# -- API: accept gate ------------------------------------------------------------


def test_calibration_refuses_draft_narration(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_scenario(monkeypatch, SAMPLE_SCENARIO)
    _make_project(client, "p-cal-draft")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-cal-draft"}).json()
    created = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-cal-draft",
            "conversationId": conv["id"],
            "request": "Draft",
            "context": {},
        },
    ).json()
    client.post(f"/api/ai/scenarios/{created['id']}/accept")
    rec = client.post(
        "/api/ai/reconciliations",
        json={
            "projectId": "p-cal-draft",
            "scenarioId": created["id"],
            "conversationId": conv["id"],
            "context": {},
        },
    ).json()
    client.post(f"/api/ai/reconciliations/{rec['id']}/accept")
    nar = client.post(
        "/api/ai/narrations",
        json={
            "projectId": "p-cal-draft",
            "reconciliationId": rec["id"],
            "conversationId": conv["id"],
        },
    ).json()
    # Draft narration: Stage D refuses to run (broken narration never flows in).
    r = client.post(
        "/api/ai/calibrations",
        json={"projectId": "p-cal-draft", "narrationId": nar["id"], "conversationId": conv["id"]},
    )
    assert r.status_code == 409, r.text


def test_calibration_create_calibrates_intro_outro_verbatim(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, _, nar_id = _make_accepted_narration(client, monkeypatch, "p-cal-1")
    r = client.post("/api/ai/calibrations", json=_calibration_payload("p-cal-1", conv_id, nar_id))
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["status"] == "draft"
    assert data["narrationId"] == nar_id
    assert data["introRef"] == "pregen-intro" and data["outroRef"] == "pregen-outro"
    assert [t["partTag"] for t in data["timings"]] == ["intro", "outro"]
    texts = " ".join(t["spokenLine"] for t in data["timings"])
    assert "Hello friends" in texts and "Goodbye friends" in texts
    assert "Ser is for who you are." not in texts
    assert data["checks"]["voice"]["ok"] is True
    assert data["checks"]["faceRig"]["ok"] is True
    assert data["checks"]["camera"]["ok"] is True
    msgs = client.get(f"/api/ai/conversations/{conv_id}/messages").json()
    assert any("verif" in m["content"].lower() for m in msgs if m["role"] == "assistant")


def test_calibration_align_and_fallback_then_accept(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, _, nar_id = _make_accepted_narration(client, monkeypatch, "p-cal-2")
    cal = client.post(
        "/api/ai/calibrations", json=_calibration_payload("p-cal-2", conv_id, nar_id)
    ).json()
    cal_id = cal["id"]
    intro = next(t for t in cal["timings"] if t["partTag"] == "intro")
    outro = next(t for t in cal["timings"] if t["partTag"] == "outro")
    # Accept blocked until every part is timed.
    assert client.post(f"/api/ai/calibrations/{cal_id}/accept").status_code == 409
    # Verbatim word timings must match the spoken line exactly.
    bad = client.post(
        f"/api/ai/calibrations/{cal_id}/parts/{intro['stepId']}/align",
        json={"words": [{"word": "WRONG", "start": 0.0, "end": 0.5}]},
    )
    assert bad.status_code == 422, bad.text
    words = split_words(intro["spokenLine"])
    duration = float(intro["audioDuration"])
    per = duration / len(words)
    aligned = client.post(
        f"/api/ai/calibrations/{cal_id}/parts/{intro['stepId']}/align",
        json={
            "words": [
                {"word": w, "start": round(i * per, 4), "end": round((i + 1) * per, 4)}
                for i, w in enumerate(words)
            ]
        },
    )
    assert aligned.status_code == 200, aligned.text
    # Fallback path is per-part, recorded and clearly marked.
    fallback = client.post(
        f"/api/ai/calibrations/{cal_id}/parts/{outro['stepId']}/fallback",
        json={"peaks": [0, 128, 255, 64] * 200},
    )
    assert fallback.status_code == 200, fallback.text
    reread = client.get(f"/api/ai/calibrations/{cal_id}").json()
    outro_after = next(t for t in reread["timings"] if t["partTag"] == "outro")
    assert outro_after["fallback"] is True
    assert len(outro_after["envelope"]) > 0
    assert reread["fallbackCount"] == 1
    accepted = client.post(f"/api/ai/calibrations/{cal_id}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"
    canonical = client.get(f"/api/ai/calibrations/{cal_id}/canonical")
    assert canonical.status_code == 200, canonical.text
    assert canonical.json()["status"] == "accepted"
    assert len(canonical.json()["timings"]) == 2


def test_calibration_canonical_refuses_draft_and_face_rig_blocks(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, _, nar_id = _make_accepted_narration(client, monkeypatch, "p-cal-3")
    cal = client.post(
        "/api/ai/calibrations", json=_calibration_payload("p-cal-3", conv_id, nar_id)
    ).json()
    assert client.get(f"/api/ai/calibrations/{cal['id']}/canonical").status_code == 409
    # Face-rig failure (no binding) blocks the gate even after timing both parts.
    payload = _calibration_payload("p-cal-3", conv_id, nar_id)
    payload["morphBinding"] = None
    broken = client.post("/api/ai/calibrations", json=payload).json()
    for timing in broken["timings"]:
        words = split_words(timing["spokenLine"])
        duration = float(timing["audioDuration"])
        per = duration / len(words)
        client.post(
            f"/api/ai/calibrations/{broken['id']}/parts/{timing['stepId']}/align",
            json={
                "words": [
                    {"word": w, "start": round(i * per, 4), "end": round((i + 1) * per, 4)}
                    for i, w in enumerate(words)
                ]
            },
        )
    blocked = client.post(f"/api/ai/calibrations/{broken['id']}/accept")
    assert blocked.status_code == 409, blocked.text
    assert "face" in blocked.json()["detail"].lower() or "mouth" in blocked.json()["detail"].lower()


def test_calibration_mouth_proposal_carries_coefficients_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, _, nar_id = _make_accepted_narration(client, monkeypatch, "p-cal-4")
    cal = client.post(
        "/api/ai/calibrations", json=_calibration_payload("p-cal-4", conv_id, nar_id)
    ).json()
    for timing in cal["timings"]:
        words = split_words(timing["spokenLine"])
        duration = float(timing["audioDuration"])
        per = duration / len(words)
        client.post(
            f"/api/ai/calibrations/{cal['id']}/parts/{timing['stepId']}/align",
            json={
                "words": [
                    {"word": w, "start": round(i * per, 4), "end": round((i + 1) * per, 4)}
                    for i, w in enumerate(words)
                ]
            },
        )
    client.post(f"/api/ai/calibrations/{cal['id']}/accept")
    canonical = client.get(f"/api/ai/calibrations/{cal['id']}/canonical").json()
    node_ids = {t["stepId"]: f"cat-{t['partTag']}" for t in canonical["timings"]}
    commands, warnings = build_mouth_commands(
        canonical["timings"],
        node_ids,
        PHONEME_MAP,
        ["Open", "Oval", "Closed", "Bite", "Tongue", "Hiss", "Back", "Tip", "Breath"],
    )
    assert warnings == []
    assert commands and all(c["type"] == "AiSetMorphCoefficient" for c in commands)
    ok, errors = validate_proposal_commands(commands)
    assert ok, errors
    assert reject_forbidden_writes(commands) == []
    proposal = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-cal-4",
            "conversationId": conv_id,
            "title": "Stage D mouth",
            "commands": commands[:5],
            "projectFingerprint": "fp-1",
        },
    )
    assert proposal.status_code == 201, proposal.text
    assert proposal.json()["validation"]["ok"] is True


def test_aligner_supplied_phoneme_preferred_when_rig_knows_it() -> None:
    mapped = map_words_to_shapes(
        [{"word": "Hello", "start": 0.0, "end": 0.5, "phoneme": "OW"}],
        PHONEME_MAP,
    )
    assert mapped[0]["phoneme"] == "OW"
    assert mapped[0]["shape"] == "Oval"
    # Unknown supplied phonemes fall back to the heuristic key.
    fallback = map_words_to_shapes(
        [{"word": "Hello", "start": 0.0, "end": 0.5, "phoneme": "ZZZ"}],
        PHONEME_MAP,
    )
    assert fallback[0]["shape"] is not None


def test_recorded_words_enrich_phoneme_shape_and_missing_blocks_gate(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, _, nar_id = _make_accepted_narration(client, monkeypatch, "p-cal-5")
    payload = _calibration_payload("p-cal-5", conv_id, nar_id)
    # Rig knows only the Open shape: every other phoneme must soft-warn and block.
    payload["mouthShapes"] = ["Open"]
    payload["morphBinding"] = {"fromShape": "Open", "toShape": "Open"}
    payload["phonemeMap"] = {"AH": "Open"}
    cal = client.post("/api/ai/calibrations", json=payload).json()
    intro = next(t for t in cal["timings"] if t["partTag"] == "intro")
    words = split_words(intro["spokenLine"])
    duration = float(intro["audioDuration"])
    per = duration / len(words)
    reread = client.post(
        f"/api/ai/calibrations/{cal['id']}/parts/{intro['stepId']}/align",
        json={
            "words": [
                {"word": w, "start": round(i * per, 4), "end": round((i + 1) * per, 4)}
                for i, w in enumerate(words)
            ]
        },
    ).json()
    stored = next(t for t in reread["timings"] if t["stepId"] == intro["stepId"])
    assert stored["words"] and all("phoneme" in w and "shape" in w for w in stored["words"])
    assert stored["missingShapes"] != []
    blocked = client.post(f"/api/ai/calibrations/{cal['id']}/accept")
    assert blocked.status_code == 409, blocked.text
    assert "mouth" in blocked.json()["detail"].lower()


def test_calibration_handoff_carries_camera_keys_and_measured_flag(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, _, nar_id = _make_accepted_narration(client, monkeypatch, "p-cal-6")
    cal = client.post(
        "/api/ai/calibrations", json=_calibration_payload("p-cal-6", conv_id, nar_id)
    ).json()
    # Creation without pregen WAVs is a clearly-unmeasured estimate, never
    # char-proportional mouth timing (mouth still needs aligner/envelope).
    assert all(t["measured"] is False for t in cal["timings"])
    for timing in cal["timings"]:
        words = split_words(timing["spokenLine"])
        duration = float(timing["audioDuration"])
        per = duration / len(words)
        client.post(
            f"/api/ai/calibrations/{cal['id']}/parts/{timing['stepId']}/align",
            json={
                "words": [
                    {"word": w, "start": round(i * per, 4), "end": round((i + 1) * per, 4)}
                    for i, w in enumerate(words)
                ]
            },
        )
    assert client.post(f"/api/ai/calibrations/{cal['id']}/accept").status_code == 200
    canonical = client.get(f"/api/ai/calibrations/{cal['id']}/canonical").json()
    assert canonical["checks"]["camera"]["keys"] == [
        {"property": "positionX", "partTag": "intro"},
        {"property": "scaleX", "partTag": "outro"},
    ]
    assert set(canonical["phonemeMap"]) >= {"AH", "OW"}
