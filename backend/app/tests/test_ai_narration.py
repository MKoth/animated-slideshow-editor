"""Stage C Prompter fill + queued local TTS batch (Spec 12, issue #425).

Accepted scenario spoken lines land verbatim in narration parts (never
re-derived), pre-TTS durations estimated by character count times
secondsPerCharacter with slide duration as the sum of parts, then per-part
voice generated server-side through the existing serialized TTS queue under
one reusable Voice Prompt by default (overridable per part) with WAVs
embedded first and proposals referencing asset ids (never inline base64).
Post-TTS timing always adopts the TTS audio duration and shifts downstream
gap-free, never auto-stretching audio to fit text. Per-part failure marks
that part stale and blocks the accept gate with per-part retry; progress is
reported through the Conversation (the existing chat transport) with no new
TTS/Prompter endpoints; rerecord stays manual via the existing modals.
"""

from __future__ import annotations

import io
import json
import wave
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai.narrations import (
    DEFAULT_SECONDS_PER_CHARACTER,
    adopt_tts_durations,
    build_commit_commands,
    build_fill_commands,
    estimate_part_duration,
    narration_accept_blockers,
    slide_duration_for_parts,
    verbatim_parts_from_steps,
    wav_duration,
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
            "spokenLine": "Goodbye friends, see you next time!",
            "onScreenAction": "Cat waves goodbye, camera holds on face",
            "assetHints": ["cat"],
            "estimatedDurationSec": 6.0,
        },
    ],
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
    app_state.state.settings.ai_secret_key = "test-secret-for-narration"
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


def _make_accepted_reconciliation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, pid: str
) -> tuple[str, str, str]:
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
    ok = client.post(f"/api/ai/reconciliations/{rec_id}/accept")
    assert ok.status_code == 200, ok.text
    return conv["id"], scenario_id, rec_id


# -- pure timing seam ----------------------------------------------------------


def test_estimate_is_char_count_times_seconds_per_character() -> None:
    assert DEFAULT_SECONDS_PER_CHARACTER == 0.2
    assert (
        estimate_part_duration("Ser is for who you are.", 0.2)
        == len("Ser is for who you are.") * 0.2
    )
    assert estimate_part_duration("", 0.2) == 0.0
    assert estimate_part_duration("Hi", 0.5) == 1.0


def test_verbatim_fill_middle_only_never_rederived() -> None:
    steps = [
        {"id": "s1", "order": 0, "partTag": "intro", "spokenLine": "Hello, friends!"},
        {
            "id": "s2",
            "order": 1,
            "partTag": "middle",
            "spokenLine": "Ser is, for who you are; listen.",
        },
        {"id": "s3", "order": 2, "partTag": "middle", "spokenLine": "  Estar: where, when?  "},
        {"id": "s4", "order": 3, "partTag": "outro", "spokenLine": "Goodbye!"},
    ]
    parts = verbatim_parts_from_steps(steps, 0.2)
    # Intro/outro pregenerated references are left alone — middle only.
    assert [p["stepId"] for p in parts] == ["s2", "s3"]
    # Verbatim: punctuation, casing, and inner spacing preserved exactly.
    assert parts[0]["spokenLine"] == "Ser is, for who you are; listen."
    assert parts[1]["spokenLine"] == "  Estar: where, when?  "
    assert parts[0]["estimatedDuration"] == len("Ser is, for who you are; listen.") * 0.2
    assert all(p["status"] == "pending" for p in parts)
    # Gap-free pre-TTS layout from estimates.
    assert parts[0]["timelineStart"] == 0.0
    assert parts[1]["timelineStart"] == pytest.approx(parts[0]["timelineEnd"])
    assert slide_duration_for_parts(parts) == pytest.approx(
        sum(p["estimatedDuration"] for p in parts)
    )


def test_verbatim_fill_rejects_empty_middle() -> None:
    with pytest.raises(ValueError, match="no middle steps"):
        verbatim_parts_from_steps(
            [{"id": "s1", "order": 0, "partTag": "intro", "spokenLine": "Hi"}], 0.2
        )


def test_adopt_tts_duration_shifts_downstream_gap_free_never_stretches() -> None:
    parts = verbatim_parts_from_steps(
        [
            {"id": "s1", "order": 0, "partTag": "middle", "spokenLine": "AAA"},
            {"id": "s2", "order": 1, "partTag": "middle", "spokenLine": "BBBBBB"},
        ],
        0.2,
    )
    adopted = adopt_tts_durations(parts, {"s1": 2.5, "s2": 0.4})
    # Post-TTS timing always adopts the audio duration — even when shorter.
    assert adopted[0]["audioDuration"] == 2.5
    assert adopted[1]["audioDuration"] == 0.4
    assert adopted[0]["timelineStart"] == 0.0
    assert adopted[0]["timelineEnd"] == pytest.approx(2.5)
    assert adopted[1]["timelineStart"] == pytest.approx(2.5)
    assert adopted[1]["timelineEnd"] == pytest.approx(2.9)
    assert slide_duration_for_parts(adopted) == pytest.approx(2.9)
    # Never auto-stretched: no playbackRate anywhere in the adopted layout.
    assert all("playbackRate" not in p for p in adopted)


def test_wav_duration_probes_header() -> None:
    assert wav_duration(_sine_wav_bytes(1.25)) == pytest.approx(1.25)
    assert wav_duration(b"not-a-wav") is None


def test_fill_commands_carry_verbatim_text_and_estimates() -> None:
    parts = verbatim_parts_from_steps(
        [{"id": "s1", "order": 0, "partTag": "middle", "spokenLine": "Ser is."}], 0.2
    )
    commands = build_fill_commands(parts, "slide-1")
    assert commands == [
        {
            "type": "CreatePrompterPart",
            "slideId": "slide-1",
            "text": "Ser is.",
            "duration": len("Ser is.") * 0.2,
        }
    ]
    ok, errors = validate_proposal_commands(commands)
    assert ok, errors


def test_commit_commands_reference_asset_ids_never_inline_base64() -> None:
    parts = verbatim_parts_from_steps(
        [
            {"id": "s1", "order": 0, "partTag": "middle", "spokenLine": "Ser is."},
            {"id": "s2", "order": 1, "partTag": "middle", "spokenLine": "Estar now."},
        ],
        0.2,
    )
    adopted = adopt_tts_durations(parts, {"s1": 1.5, "s2": 2.0})
    for part, asset in zip(adopted, ["asset-1", "asset-2"], strict=True):
        part["assetId"] = asset
        part["status"] = "ready"
    commands = build_commit_commands(adopted, "slide-1", {"s1": "part-1", "s2": "part-2"})
    assert commands == [
        {
            "type": "AiCommitTts",
            "slideId": "slide-1",
            "partId": "part-1",
            "assetId": "asset-1",
            "timelineStart": 0.0,
            "sourceEnd": 1.5,
        },
        {
            "type": "AiCommitTts",
            "slideId": "slide-1",
            "partId": "part-2",
            "assetId": "asset-2",
            "timelineStart": 1.5,
            "sourceEnd": 2.0,
        },
    ]
    ok, errors = validate_proposal_commands(commands)
    assert ok, errors
    # No inline audio bytes anywhere in the commit surface.
    blob = json.dumps(commands)
    assert "base64" not in blob.lower() and "wavData" not in blob


def test_commit_commands_refuse_unembedded_parts() -> None:
    parts = verbatim_parts_from_steps(
        [{"id": "s1", "order": 0, "partTag": "middle", "spokenLine": "Ser is."}], 0.2
    )
    with pytest.raises(ValueError, match="embed"):
        build_commit_commands(parts, "slide-1", {"s1": "part-1"})


def test_commit_commands_refuse_non_ready_parts() -> None:
    parts = verbatim_parts_from_steps(
        [{"id": "s1", "order": 0, "partTag": "middle", "spokenLine": "Ser is."}], 0.2
    )
    staged = [dict(p, assetId="asset-1", audioDuration=1.5) for p in parts]
    with pytest.raises(ValueError, match="retry it|regenerate"):
        build_commit_commands(staged, "slide-1", {"s1": "part-1"})


def test_accept_blockers_require_every_part_ready() -> None:
    parts = verbatim_parts_from_steps(
        [
            {"id": "s1", "order": 0, "partTag": "middle", "spokenLine": "AAA"},
            {"id": "s2", "order": 1, "partTag": "middle", "spokenLine": "BBB"},
        ],
        0.2,
    )
    blockers = narration_accept_blockers(parts)
    assert len(blockers) == 2
    failed = [dict(p, status="failed", error="boom", stale=True) for p in parts]
    assert any("retry" in b.lower() for b in narration_accept_blockers(failed))
    ready = [dict(p, status="ready", assetId=f"a-{p['stepId']}") for p in parts]
    assert narration_accept_blockers(ready) == []
    # Ready without an embedded asset id is still blocked (embed first).
    assert narration_accept_blockers([dict(p, status="ready") for p in parts]) != []


# -- API: accept gate ------------------------------------------------------------


def test_narration_refuses_draft_reconciliation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_scenario(monkeypatch, SAMPLE_SCENARIO)
    _make_project(client, "p-nar-draft")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-nar-draft"}).json()
    created = client.post(
        "/api/ai/scenarios",
        json={
            "projectId": "p-nar-draft",
            "conversationId": conv["id"],
            "request": "Draft",
            "context": {},
        },
    ).json()
    client.post(f"/api/ai/scenarios/{created['id']}/accept")
    rec = client.post(
        "/api/ai/reconciliations",
        json={
            "projectId": "p-nar-draft",
            "scenarioId": created["id"],
            "conversationId": conv["id"],
            "context": {},
        },
    ).json()
    # Draft reconciliation: Stage C refuses to run.
    r = client.post(
        "/api/ai/narrations",
        json={
            "projectId": "p-nar-draft",
            "reconciliationId": rec["id"],
            "conversationId": conv["id"],
        },
    )
    assert r.status_code == 409, r.text


def test_narration_create_fills_verbatim_with_estimates(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, rec_id = _make_accepted_reconciliation(client, monkeypatch, "p-nar-1")
    r = client.post(
        "/api/ai/narrations",
        json={"projectId": "p-nar-1", "reconciliationId": rec_id, "conversationId": conv_id},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["status"] == "draft"
    assert data["reconciliationId"] == rec_id
    assert [p["stepId"] for p in data["parts"]]
    texts = [p["spokenLine"] for p in data["parts"]]
    assert "Ser is for who you are." in texts
    assert "Listen to this chime while you read." in texts
    assert "Hello friends" not in " ".join(texts)
    for part in data["parts"]:
        assert part["estimatedDuration"] == pytest.approx(len(part["spokenLine"]) * 0.2)
        assert part["status"] == "pending"
    assert data["slideDuration"] == pytest.approx(
        sum(p["estimatedDuration"] for p in data["parts"])
    )
    # Progress reported through the Conversation (existing chat transport).
    msgs = client.get(f"/api/ai/conversations/{conv_id}/messages").json()
    assert any("prompter" in m["content"].lower() for m in msgs if m["role"] == "assistant")


def test_narration_generate_runs_queued_tts_and_adopts_timing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, rec_id = _make_accepted_reconciliation(client, monkeypatch, "p-nar-2")
    nar = client.post(
        "/api/ai/narrations",
        json={"projectId": "p-nar-2", "reconciliationId": rec_id, "conversationId": conv_id},
    ).json()
    nar_id = nar["id"]
    r = client.post(f"/api/ai/narrations/{nar_id}/generate")
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["results"]) == 2
    import base64 as _base64

    wavs = {res["stepId"]: res for res in data["results"]}
    for result in data["results"]:
        assert result["ok"] is True
        assert result["audioDuration"] is not None and result["audioDuration"] > 0
        assert result["wavData"]
        probed = wav_duration(_base64.b64decode(result["wavData"]))
        assert probed is not None
        assert result["audioDuration"] == pytest.approx(probed)
    parts = {p["stepId"]: p for p in data["narration"]["parts"]}
    for step_id, result in wavs.items():
        # Post-TTS timing adopts the measured WAV duration.
        assert parts[step_id]["audioDuration"] == pytest.approx(result["audioDuration"])
    assert parts[nar["parts"][0]["stepId"]]["timelineStart"] == 0.0
    assert parts[nar["parts"][1]["stepId"]]["timelineStart"] == pytest.approx(
        parts[nar["parts"][0]["stepId"]]["timelineEnd"]
    )


def test_narration_stale_blocks_gate_with_per_part_retry(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, rec_id = _make_accepted_reconciliation(client, monkeypatch, "p-nar-3")
    nar = client.post(
        "/api/ai/narrations",
        json={"projectId": "p-nar-3", "reconciliationId": rec_id, "conversationId": conv_id},
    ).json()
    nar_id = nar["id"]
    step_id = nar["parts"][0]["stepId"]

    fail = client.post(
        f"/api/ai/narrations/{nar_id}/parts/{step_id}/fail", json={"error": "tts blew up"}
    )
    assert fail.status_code == 200, fail.text
    failed = next(p for p in fail.json()["parts"] if p["stepId"] == step_id)
    assert failed["status"] == "failed"
    assert failed["stale"] is True

    blocked = client.post(f"/api/ai/narrations/{nar_id}/accept")
    assert blocked.status_code == 409, blocked.text
    assert "retry" in blocked.json()["detail"].lower()

    retry = client.post(f"/api/ai/narrations/{nar_id}/parts/{step_id}/retry")
    assert retry.status_code == 200, retry.text
    retried = next(p for p in retry.json()["parts"] if p["stepId"] == step_id)
    assert retried["status"] == "pending"
    assert retried["stale"] is False


def test_narration_accept_requires_embedded_asset_ids(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, rec_id = _make_accepted_reconciliation(client, monkeypatch, "p-nar-4")
    nar = client.post(
        "/api/ai/narrations",
        json={"projectId": "p-nar-4", "reconciliationId": rec_id, "conversationId": conv_id},
    ).json()
    nar_id = nar["id"]
    # Ready without embedding first is still blocked.
    for part in nar["parts"]:
        ready = client.post(
            f"/api/ai/narrations/{nar_id}/parts/{part['stepId']}/ready",
            json={"assetId": "", "audioDuration": 1.0},
        )
        assert ready.status_code == 422, ready.text
    for i, part in enumerate(nar["parts"]):
        ready = client.post(
            f"/api/ai/narrations/{nar_id}/parts/{part['stepId']}/ready",
            json={"assetId": f"asset-{i}", "audioDuration": 1.0 + i},
        )
        assert ready.status_code == 200, ready.text
    accepted = client.post(f"/api/ai/narrations/{nar_id}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"
    canonical = client.get(f"/api/ai/narrations/{nar_id}/canonical")
    assert canonical.status_code == 200, canonical.text
    assert canonical.json()["status"] == "accepted"


def test_narration_canonical_refuses_draft(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, rec_id = _make_accepted_reconciliation(client, monkeypatch, "p-nar-5")
    nar = client.post(
        "/api/ai/narrations",
        json={"projectId": "p-nar-5", "reconciliationId": rec_id, "conversationId": conv_id},
    ).json()
    r = client.get(f"/api/ai/narrations/{nar['id']}/canonical")
    assert r.status_code == 409, r.text


def test_narration_voice_default_and_per_part_override(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, rec_id = _make_accepted_reconciliation(client, monkeypatch, "p-nar-6")
    prompt = client.post(
        "/api/voice-prompts",
        json={"title": "Cat voice", "instruction": "Warm narrator", "language": "en"},
    )
    assert prompt.status_code == 201, prompt.text
    prompt_id = prompt.json()["id"]
    nar = client.post(
        "/api/ai/narrations",
        json={
            "projectId": "p-nar-6",
            "reconciliationId": rec_id,
            "conversationId": conv_id,
            "defaultVoicePromptId": prompt_id,
        },
    )
    assert nar.status_code == 201, nar.text
    assert nar.json()["defaultVoicePromptId"] == prompt_id
    nar_id = nar.json()["id"]
    step_id = nar.json()["parts"][0]["stepId"]
    other = client.post(
        "/api/voice-prompts",
        json={"title": "Other", "instruction": "Cold narrator", "language": "en"},
    ).json()
    patched = client.patch(
        f"/api/ai/narrations/{nar_id}", json={"partVoices": {step_id: other["id"]}}
    )
    assert patched.status_code == 200, patched.text
    overridden = next(p for p in patched.json()["parts"] if p["stepId"] == step_id)
    assert overridden["voicePromptId"] == other["id"]
    # Unknown voice prompts are rejected, not silently kept.
    bad = client.patch(f"/api/ai/narrations/{nar_id}", json={"defaultVoicePromptId": "nope"})
    assert bad.status_code == 422, bad.text


def test_voice_change_invalidates_ready_parts(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, rec_id = _make_accepted_reconciliation(client, monkeypatch, "p-nar-8")
    first = client.post(
        "/api/voice-prompts",
        json={"title": "First", "instruction": "Warm narrator", "language": "en"},
    ).json()
    second = client.post(
        "/api/voice-prompts",
        json={"title": "Second", "instruction": "Cold narrator", "language": "en"},
    ).json()
    nar = client.post(
        "/api/ai/narrations",
        json={
            "projectId": "p-nar-8",
            "reconciliationId": rec_id,
            "conversationId": conv_id,
            "defaultVoicePromptId": first["id"],
        },
    ).json()
    nar_id = nar["id"]
    for i, part in enumerate(nar["parts"]):
        client.post(
            f"/api/ai/narrations/{nar_id}/parts/{part['stepId']}/ready",
            json={"assetId": f"asset-{i}", "audioDuration": 1.0},
        )
    assert client.post(f"/api/ai/narrations/{nar_id}/accept").status_code == 200
    # Swapping the reusable default voice reopens the gate: takes recorded
    # under the old voice must regenerate before accepting again.
    changed = client.patch(
        f"/api/ai/narrations/{nar_id}", json={"defaultVoicePromptId": second["id"]}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["status"] == "draft"
    assert all(p["status"] == "pending" for p in changed.json()["parts"])
    blocked = client.post(f"/api/ai/narrations/{nar_id}/accept")
    assert blocked.status_code == 409, blocked.text


def test_narration_commit_proposal_carries_asset_ids(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    conv_id, _, rec_id = _make_accepted_reconciliation(client, monkeypatch, "p-nar-7")
    nar = client.post(
        "/api/ai/narrations",
        json={"projectId": "p-nar-7", "reconciliationId": rec_id, "conversationId": conv_id},
    ).json()
    nar_id = nar["id"]
    for i, part in enumerate(nar["parts"]):
        client.post(
            f"/api/ai/narrations/{nar_id}/parts/{part['stepId']}/ready",
            json={"assetId": f"asset-{i}", "audioDuration": 1.25},
        )
    client.post(f"/api/ai/narrations/{nar_id}/accept")
    canonical = client.get(f"/api/ai/narrations/{nar_id}/canonical").json()
    parts = canonical["parts"]
    commands = build_commit_commands(
        parts, "slide-1", {p["stepId"]: f"part-{i}" for i, p in enumerate(parts)}
    )
    ok, errors = validate_proposal_commands(commands)
    assert ok, errors
    proposal = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-nar-7",
            "conversationId": conv_id,
            "title": "Stage C commit",
            "commands": commands,
            "projectFingerprint": "fp-1",
        },
    )
    assert proposal.status_code == 201, proposal.text
    assert proposal.json()["validation"]["ok"] is True
