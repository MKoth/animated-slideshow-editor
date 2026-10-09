"""Stage B reconciliation + image-gen briefs (Spec 12, issue #424).

Middle steps only at the Discovery Run floor, 4-state motion verdicts,
sfx/music-only sound, editable briefs feeding the workflow wizard + prompt,
own versioned record + accept gate blocking Stage C.
"""

from __future__ import annotations

import io
import json
import wave
from io import BytesIO
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.ai.reconciliations import (
    DISCOVERY_MATCH_FLOOR,
    MOTION_STATES,
    reconcile_middle_steps,
    score_hint_against_definition,
)
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
            "spokenLine": "Goodbye friends, see you next time!",
            "onScreenAction": "Cat waves goodbye, camera holds on face",
            "assetHints": ["cat"],
            "estimatedDurationSec": 6.0,
        },
    ],
}


def png_bytes(color: tuple[int, int, int] = (10, 20, 30)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (64, 64), color).save(buffer, format="PNG")
    return buffer.getvalue()


def wav_bytes() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(b"\x00\x00" * 441)
    return buffer.getvalue()


def _enable_key(client: TestClient) -> None:
    app_state: Any = client.app
    app_state.state.settings.ai_secret_key = "test-secret-for-reconciliation"
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


def _make_accepted_scenario(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, pid: str
) -> tuple[str, str, dict[str, Any]]:
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
    acc = client.post(f"/api/ai/scenarios/{scenario_id}/accept")
    assert acc.status_code == 200, acc.text
    return conv["id"], scenario_id, created


def _upload(client: TestClient, filename: str, content: bytes, mime: str) -> dict[str, Any]:
    r = client.post("/api/assets", files=[("files", (filename, content, mime))])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["errors"] == [], body["errors"]
    assert len(body["created"]) == 1
    created_item: Any = body["created"][0]
    assert isinstance(created_item, dict)
    return dict(created_item)


# -- pure scoring seam ------------------------------------------------------


def test_discovery_floor_exact_name_scores_one() -> None:
    assert DISCOVERY_MATCH_FLOOR == 0.35
    score, explanation = score_hint_against_definition(
        "Blackboard", {"name": "blackboard", "tags": [], "category": "Object"}
    )
    assert score == 1.0
    assert "exact" in explanation


def test_discovery_scoring_partial_and_floor() -> None:
    score, explanation = score_hint_against_definition(
        "chalk text",
        {"name": "chalkboard", "tags": ["chalk"], "category": "Object", "ai_description": ""},
    )
    assert score >= DISCOVERY_MATCH_FLOOR
    assert "chalk" in explanation.lower()
    low, _ = score_hint_against_definition(
        "medieval castle gate",
        {"name": "cat", "tags": ["pet"], "category": "Animal", "ai_description": "a cat"},
    )
    assert low < DISCOVERY_MATCH_FLOOR


def test_reconcile_middle_steps_skips_intro_outro() -> None:
    steps = [
        {
            "id": "s1",
            "order": 0,
            "partTag": "intro",
            "spokenLine": "Hi",
            "onScreenAction": "Cat waves",
            "assetHints": ["cat"],
        },
        {
            "id": "s2",
            "order": 1,
            "partTag": "middle",
            "spokenLine": "Ser.",
            "onScreenAction": "Chalk text appears",
            "assetHints": ["blackboard"],
        },
        {
            "id": "s3",
            "order": 2,
            "partTag": "outro",
            "spokenLine": "Bye",
            "onScreenAction": "Cat waves",
            "assetHints": ["cat"],
        },
    ]
    verdicts, _ = reconcile_middle_steps(
        steps=steps,
        definitions=[{"id": "d1", "name": "blackboard", "tags": [], "category": "Object"}],
    )
    assert verdicts[0]["skipped"] is True
    assert verdicts[0]["assetVerdicts"] == []
    assert verdicts[0]["motion"] is None
    assert verdicts[1]["skipped"] is False
    assert verdicts[2]["skipped"] is True


def test_motion_verdict_four_states_cite_evidence() -> None:
    steps = [
        {
            "id": "m1",
            "order": 0,
            "partTag": "middle",
            "spokenLine": "Ser.",
            "onScreenAction": "Chalk text appears on the blackboard",
            "assetHints": ["blackboard"],
        },
    ]
    defs = [{"id": "d1", "name": "blackboard", "tags": [], "category": "Object"}]
    verdicts, _ = reconcile_middle_steps(steps=steps, definitions=defs)
    motion = verdicts[0]["motion"]
    assert motion["state"] in MOTION_STATES
    assert motion["state"] == "feasible"
    assert motion["evidence"].get("kind") in ("clip", "collection", "script-verb", "params")
    assert len(motion["explanation"]) > 10

    # Missing asset -> needs-new-asset.
    steps_missing = [
        {
            "id": "m2",
            "order": 0,
            "partTag": "middle",
            "spokenLine": "X",
            "onScreenAction": "Dragon flies across",
            "assetHints": ["dragon"],
        },
    ]
    verdicts2, _ = reconcile_middle_steps(steps=steps_missing, definitions=defs)
    assert verdicts2[0]["motion"]["state"] == "needs-new-asset"


def test_sound_hints_cover_sfx_music_only() -> None:
    steps = [
        {
            "id": "m1",
            "order": 0,
            "partTag": "middle",
            "spokenLine": "Ser is for who you are.",
            "onScreenAction": "Text appears with a soft chime sound",
            "assetHints": ["blackboard", "chime sound"],
        },
    ]
    audio = [{"id": "a1", "name": "chime", "tags": [], "category": "audio"}]
    verdicts, briefs = reconcile_middle_steps(
        steps=steps,
        definitions=[{"id": "d1", "name": "blackboard", "tags": [], "category": "Object"}],
        audio_definitions=audio,
    )
    # Sound hints reconcile against audio only — never as image verdicts or briefs.
    assert [v["hint"] for v in verdicts[0]["assetVerdicts"]] == ["blackboard"]
    assert briefs == []
    sounds = verdicts[0]["soundVerdicts"]
    assert len(sounds) == 1
    assert sounds[0]["hint"] == "chime sound"
    assert sounds[0]["verdict"] == "matched"
    # Narration (spokenLine) never produces a sound verdict.
    assert all(s["hint"] != "Ser is for who you are." for s in sounds)


def test_sound_matches_embedded_audio_names() -> None:
    steps = [
        {
            "id": "m1",
            "order": 0,
            "partTag": "middle",
            "spokenLine": "Listen.",
            "onScreenAction": "Room tone plays under the text",
            "assetHints": ["room tone"],
        },
    ]
    verdicts, _ = reconcile_middle_steps(
        steps=steps,
        definitions=[],
        audio_definitions=[],
        embedded_audio_names=["room tone take"],
    )
    sounds = verdicts[0]["soundVerdicts"]
    assert len(sounds) == 1
    assert sounds[0]["verdict"] == "matched"
    assert sounds[0]["candidates"][0]["definitionId"] == "embedded:room tone take"


# -- API: accept gate --------------------------------------------------------


def test_reconciliation_refuses_draft_scenario(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_scenario(monkeypatch, SAMPLE_SCENARIO)
    _make_project(client, "p-rec-draft")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-rec-draft"}).json()
    created = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-rec-draft",
            "conversationId": conv["id"],
            "request": "Draft",
            "context": {},
        },
    ).json()
    r = client.post(
        "/api/ai/reconciliations",
        json={
            "projectId": "p-rec-draft",
            "scenarioId": created["id"],
            "conversationId": conv["id"],
            "context": {},
        },
    )
    assert r.status_code == 409, r.text


def test_middle_only_reconciled_with_floor_and_briefs(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, scenario_id, _ = _make_accepted_scenario(client, monkeypatch, "p-rec-1")
    blackboard = _upload(client, "blackboard.png", png_bytes(), "image/png")
    assert blackboard["name"] == "blackboard"

    r = client.post(
        "/api/ai/reconciliations",
        json={
            "projectId": "p-rec-1",
            "scenarioId": scenario_id,
            "conversationId": conv_id,
            "context": {},
        },
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["status"] == "draft"
    assert data["middleStepCount"] == 2
    # Intro/outro left alone.
    skipped = [v for v in data["verdicts"] if v.get("skipped")]
    assert len(skipped) == 2
    assert all(v["assetVerdicts"] == [] and v["motion"] is None for v in skipped)
    # Middle blackboard beat matched at floor via exact name.
    middle = [v for v in data["verdicts"] if not v.get("skipped")]
    first = middle[0]
    hints = {v["hint"]: v for v in first["assetVerdicts"]}
    assert hints["blackboard"]["verdict"] == "matched"
    top = hints["blackboard"]["candidates"][0]
    assert top["definitionId"] == blackboard["id"]
    assert top["score"] == 1.0
    # 'chalk text' has no library match, so motion waits on the new asset.
    assert first["motion"]["state"] == "needs-new-asset"
    assert "chalk text" in first["motion"]["explanation"]
    # The missing visual hint yields an auto-drafted editable brief.
    missing = [v for v in first["assetVerdicts"] if v["verdict"] == "missing"]
    assert [v["hint"] for v in missing] == ["chalk text"]
    assert data["missingCount"] == 1
    assert len(data["briefs"]) == 1
    brief = data["briefs"][0]
    assert brief["hint"] == "chalk text"
    assert "Ser is for who you are." in brief["prompt"]
    assert "Chalk text appears" in brief["prompt"]
    # Second middle step: visual blackboard matched, chime reconciled as sound only.
    second = middle[1]
    assert [v["hint"] for v in second["assetVerdicts"]] == ["blackboard"]
    assert second["assetVerdicts"][0]["verdict"] == "matched"
    assert second["motion"]["state"] == "feasible"
    assert second["motion"]["evidence"].get("kind") in ("clip", "collection", "script-verb")
    assert brief["editable"] is True
    assert brief["wizardEntry"]["assetName"] == brief["hint"]
    assert brief["styleProfile"]["name"]
    assert brief["productionConstraints"]
    assert set(brief["variants"].keys()) == {"detailed", "concise", "stylized"}
    # Sound: chime hint reconciled, narration untouched.
    assert any(s["hint"] == "chime sound" for s in second["soundVerdicts"])
    assert all("Ser is for" not in s["hint"] for s in second["soundVerdicts"])
    # Narration message appended, project untouched.
    msgs = client.get(f"/api/ai/conversations/{conv_id}/messages").json()
    assert any("econciled" in m["content"] for m in msgs if m["role"] == "assistant")


def test_sound_matches_global_and_embedded_audio(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, scenario_id, _ = _make_accepted_scenario(client, monkeypatch, "p-rec-sound")
    _upload(client, "blackboard.png", png_bytes(), "image/png")
    chime = _upload(client, "chime.wav", wav_bytes(), "audio/wav")
    assert chime["name"] == "chime"

    r = client.post(
        "/api/ai/reconciliations",
        json={
            "projectId": "p-rec-sound",
            "scenarioId": scenario_id,
            "conversationId": conv_id,
            "context": {"embeddedAudio": ["room tone take"]},
        },
    )
    assert r.status_code == 201, r.text
    data = r.json()
    middle = [v for v in data["verdicts"] if not v.get("skipped")]
    second = middle[1]
    sounds = {s["hint"]: s for s in second["soundVerdicts"]}
    assert sounds["chime sound"]["verdict"] == "matched"
    assert sounds["chime sound"]["candidates"][0]["definitionId"] == chime["id"]

    # Embedded audio ids are acceptable decision targets without a library row.
    rec_id = data["id"]
    emb = client.post(
        f"/api/ai/reconciliations/{rec_id}/decisions",
        json={
            "stepId": second["stepId"],
            "hint": "chime sound",
            "decision": "accept",
            "definitionId": "embedded:room tone take",
        },
    )
    assert emb.status_code == 200, emb.text


def test_decisions_accept_reject_replace_and_brief_edit(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, scenario_id, _ = _make_accepted_scenario(client, monkeypatch, "p-rec-2")
    blackboard = _upload(client, "blackboard.png", png_bytes(), "image/png")
    board_alt = _upload(client, "board.png", png_bytes((200, 10, 10)), "image/png")

    rec = client.post(
        "/api/ai/reconciliations",
        json={
            "projectId": "p-rec-2",
            "scenarioId": scenario_id,
            "conversationId": conv_id,
            "context": {},
        },
    ).json()
    rec_id = rec["id"]
    middle = next(v for v in rec["verdicts"] if not v.get("skipped"))
    step_id = middle["stepId"]

    # Accept maps hint -> definition (top candidate by default).
    acc = client.post(
        f"/api/ai/reconciliations/{rec_id}/decisions",
        json={
            "stepId": step_id,
            "hint": "blackboard",
            "decision": "accept",
            "definitionId": blackboard["id"],
        },
    )
    assert acc.status_code == 200, acc.text
    assert acc.json()["decisions"][f"{step_id}:blackboard"]["decision"] == "accepted"
    assert acc.json()["status"] == "draft"

    # Replace swaps the mapping.
    rep = client.post(
        f"/api/ai/reconciliations/{rec_id}/decisions",
        json={
            "stepId": step_id,
            "hint": "blackboard",
            "decision": "accept",
            "definitionId": board_alt["id"],
        },
    )
    assert rep.status_code == 200, rep.text
    assert rep.json()["decisions"][f"{step_id}:blackboard"]["definitionId"] == board_alt["id"]

    # Reject records the rejection.
    rej = client.post(
        f"/api/ai/reconciliations/{rec_id}/decisions",
        json={"stepId": step_id, "hint": "chalk text", "decision": "reject"},
    )
    assert rej.status_code == 200, rej.text
    assert rej.json()["decisions"][f"{step_id}:chalk text"]["decision"] == "rejected"
    # Unknown definition rejected.
    bad = client.post(
        f"/api/ai/reconciliations/{rec_id}/decisions",
        json={
            "stepId": step_id,
            "hint": "blackboard",
            "decision": "accept",
            "definitionId": "no-such-def",
        },
    )
    assert bad.status_code == 422

    # Briefs are editable before handoff.
    brief_id = rec["briefs"][0]["id"]
    patched = client.patch(
        f"/api/ai/reconciliations/{rec_id}",
        json={"briefs": [{"id": brief_id, "prompt": "My edited copyable prompt"}]},
    )
    assert patched.status_code == 200, patched.text
    edited = next(b for b in patched.json()["briefs"] if b["id"] == brief_id)
    assert edited["prompt"] == "My edited copyable prompt"


def test_versioned_record_accept_gate_blocks_stage_c(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, scenario_id, _ = _make_accepted_scenario(client, monkeypatch, "p-rec-3")
    _upload(client, "blackboard.png", png_bytes(), "image/png")
    rec = client.post(
        "/api/ai/reconciliations",
        json={
            "projectId": "p-rec-3",
            "scenarioId": scenario_id,
            "conversationId": conv_id,
            "context": {},
        },
    ).json()
    rec_id = rec["id"]
    assert len(rec["revisions"]) == 1

    # Stage C handoff refused while draft.
    assert client.get(f"/api/ai/reconciliations/{rec_id}/canonical").status_code == 409

    accepted = client.post(f"/api/ai/reconciliations/{rec_id}/accept")
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"
    canonical = client.get(f"/api/ai/reconciliations/{rec_id}/canonical")
    assert canonical.status_code == 200, canonical.text
    payload = canonical.json()
    assert payload["status"] == "accepted"
    assert (
        payload["verdicts"] and payload["briefs"] is not None and payload["decisions"] is not None
    )

    # A later decision re-opens the gate.
    middle = next(v for v in accepted.json()["verdicts"] if not v.get("skipped"))
    step_id = middle["stepId"]
    defs = client.get("/api/assets").json()
    some_def = next(d for d in defs if d["category"] != "audio")
    client.post(
        f"/api/ai/reconciliations/{rec_id}/decisions",
        json={
            "stepId": step_id,
            "hint": "blackboard",
            "decision": "accept",
            "definitionId": some_def["id"],
        },
    )
    assert client.get(f"/api/ai/reconciliations/{rec_id}").json()["status"] == "draft"
    assert client.get(f"/api/ai/reconciliations/{rec_id}/canonical").status_code == 409

    # History + project isolation + cascade delete.
    listing = client.get("/api/ai/reconciliations", params={"projectId": "p-rec-3"}).json()
    assert len(listing) == 1
    assert listing[0]["middleStepCount"] == 2
    assert client.get("/api/ai/reconciliations", params={"projectId": "p-other"}).json() == []
    assert client.delete("/api/projects/p-rec-3").status_code == 204
    assert client.get("/api/ai/reconciliations", params={"projectId": "p-rec-3"}).json() == []
    assert client.get(f"/api/ai/reconciliations/{rec_id}").status_code == 404
