"""AI Edit Proposal validate-dry-run-execute pipeline (Spec 12, issue #422)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai.zen import ZenClient


def _make_project(client: TestClient, pid: str = "p-prop") -> str:
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
    return client.get(f"/api/projects/{pid}").text


def _make_conversation(client: TestClient, project_id: str) -> str:
    conv = client.post("/api/ai/conversations", json={"projectId": project_id}).json()
    return str(conv["id"])


def _enable_key(client: TestClient, key: str = "sk-test-key-1234") -> None:
    app_state: Any = client.app
    settings = app_state.state.settings
    settings.ai_secret_key = "test-secret-for-ai-proposals"
    r = client.put("/api/ai/settings", json={"apiKey": key})
    assert r.status_code == 200, r.text


def _fake_models(monkeypatch: pytest.MonkeyPatch, models: list[str]) -> None:
    def _list(self: ZenClient, http_client: Any = None) -> list[str]:
        _ = (self, http_client)
        return list(models)

    monkeypatch.setattr(ZenClient, "list_models", _list)


def _fake_draft(monkeypatch: pytest.MonkeyPatch, payload: dict[str, Any]) -> None:
    import app.api.ai as ai_api

    def _gen(**kwargs: Any) -> dict[str, Any]:
        _ = kwargs
        loaded: Any = json.loads(json.dumps(payload))
        assert isinstance(loaded, dict)
        return dict(loaded)

    monkeypatch.setattr(ai_api, "_generate_proposal_structured", _gen)


def _assistant_message_id(client: TestClient, conv_id: str) -> str:
    # Missing-key chat still persists user + assistant messages.
    chat = client.post(
        "/api/ai/chat",
        json={"conversationId": conv_id, "message": "Hello", "mode": "send", "context": {}},
    )
    assert chat.status_code == 200, chat.text
    msgs = client.get(f"/api/ai/conversations/{conv_id}/messages").json()
    return str(next(m["id"] for m in msgs if m["role"] == "assistant"))


VALID_COMMANDS = [
    {"type": "CreateSlide", "name": "Middle 1"},
    {"type": "CreatePrompterPart", "slideId": "slide-1", "text": "Hello", "duration": 2.0},
    {
        "type": "AiCommitTts",
        "slideId": "slide-1",
        "partId": "part-1",
        "assetId": "asset-1",
        "timelineStart": 0.0,
        "sourceEnd": 2.0,
    },
    {"type": "AiSetMorphCoefficient", "nodeId": "cat-1", "coefficient": 0.5},
    {"type": "SetSlideAnimationScript", "slideId": "slide-1", "source": "reveal title"},
    {"type": "AiCreateBoardText", "slideId": "slide-1", "text": "Ser es"},
    {"type": "AiImportSlides", "slideIds": ["s1", "s2"]},
]


def test_create_valid_proposal_without_touching_project(client: TestClient) -> None:
    before = _make_project(client, "p-prop-1")
    conv_id = _make_conversation(client, "p-prop-1")
    r = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-prop-1",
            "conversationId": conv_id,
            "title": "Middle fill",
            "commands": VALID_COMMANDS[:2],
            "projectFingerprint": "fp-1",
        },
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["validation"]["ok"] is True
    assert data["status"] == "validated"
    assert len(data["commands"]) == 2
    assert data["messageId"] is None
    assert client.get("/api/projects/p-prop-1").text == before


def test_animation_asset_proposal_is_schema_valid_and_denial_feedback_persists(
    client: TestClient,
) -> None:
    _make_project(client, "p-asset-proposal")
    conv_id = _make_conversation(client, "p-asset-proposal")
    proposal = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-asset-proposal",
            "conversationId": conv_id,
            "title": "Create a paw pose",
            "commands": [
                {
                    "type": "AiAnimationAssetBatch",
                    "operations": [
                        {
                            "kind": "upsertShape",
                            "action": "create",
                            "sourceShapeId": "rest-paw",
                            "nodeId": "paw-node",
                            "shape": {
                                "id": "new-paw-pose",
                                "name": "Resting paw",
                                "vertices": [{"x": 0, "y": 0}],
                            },
                        }
                    ],
                }
            ],
            "projectFingerprint": "fp-asset",
        },
    )
    assert proposal.status_code == 201, proposal.text
    assert proposal.json()["validation"]["ok"] is True
    assert proposal.json()["rejectionFeedback"] is None

    rejected = client.post(
        f"/api/ai/proposals/{proposal.json()['id']}/reject",
        json={"feedback": "Keep the toes closer together."},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["rejectionFeedback"] == "Keep the toes closer together."


def test_proposal_attaches_to_conversation_message(client: TestClient) -> None:
    _make_project(client, "p-prop-msg")
    conv_id = _make_conversation(client, "p-prop-msg")
    assistant_id = _assistant_message_id(client, conv_id)

    r = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-prop-msg",
            "conversationId": conv_id,
            "messageId": assistant_id,
            "title": "Attached",
            "commands": VALID_COMMANDS[:1],
            "projectFingerprint": "fp-1",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["messageId"] == assistant_id

    listing = client.get("/api/ai/proposals", params={"projectId": "p-prop-msg"}).json()
    assert listing[0]["messageId"] == assistant_id

    # Unknown message rejected.
    bad = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-prop-msg",
            "conversationId": conv_id,
            "messageId": "no-such-message",
            "title": "Bad",
            "commands": VALID_COMMANDS[:1],
            "projectFingerprint": "fp-1",
        },
    )
    assert bad.status_code == 422, bad.text

    # Message from another conversation rejected.
    other_conv = _make_conversation(client, "p-prop-msg")
    cross = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-prop-msg",
            "conversationId": other_conv,
            "messageId": assistant_id,
            "title": "Cross",
            "commands": VALID_COMMANDS[:1],
            "projectFingerprint": "fp-1",
        },
    )
    assert cross.status_code == 422, cross.text


def test_draft_proposal_converts_message_into_attached_commands(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_project(client, "p-prop-draft")
    conv_id = _make_conversation(client, "p-prop-draft")
    assistant_id = _assistant_message_id(client, conv_id)
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_draft(
        monkeypatch,
        {"title": "Drafted slide", "commands": [{"type": "CreateSlide", "name": "Middle 1"}]},
    )

    r = client.post(
        "/api/ai/proposals/draft",
        json={
            "projectId": "p-prop-draft",
            "conversationId": conv_id,
            "messageId": assistant_id,
            "context": {"projectName": "Lesson"},
        },
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["messageId"] == assistant_id
    assert data["title"] == "Drafted slide"
    assert data["commands"] == [{"type": "CreateSlide", "name": "Middle 1"}]
    assert data["validation"]["ok"] is True
    # The project is untouched by drafting.
    assert "Middle 1" not in client.get("/api/projects/p-prop-draft").text


def test_draft_proposal_rejects_unknown_message(client: TestClient) -> None:
    _make_project(client, "p-prop-draft-404")
    conv_id = _make_conversation(client, "p-prop-draft-404")
    r = client.post(
        "/api/ai/proposals/draft",
        json={
            "projectId": "p-prop-draft-404",
            "conversationId": conv_id,
            "messageId": "no-such-message",
            "context": {},
        },
    )
    assert r.status_code == 404, r.text


def test_draft_proposal_rejects_unusable_model_output(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_project(client, "p-prop-draft-502")
    conv_id = _make_conversation(client, "p-prop-draft-502")
    assistant_id = _assistant_message_id(client, conv_id)
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_draft(monkeypatch, {"title": "No commands here"})

    r = client.post(
        "/api/ai/proposals/draft",
        json={
            "projectId": "p-prop-draft-502",
            "conversationId": conv_id,
            "messageId": assistant_id,
            "context": {},
        },
    )
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "no_actionable_edit"


def test_draft_failure_writes_redacted_log_with_log_id(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, settings: Any
) -> None:
    """Every draft 502 must leave a correlatable, secret-free log line."""
    from app.ai.zen import ZenFetchError

    _make_project(client, "p-prop-draft-log")
    conv_id = _make_conversation(client, "p-prop-draft-log")
    assistant_id = _assistant_message_id(client, conv_id)
    _enable_key(client, "sk-test-key-1234")
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})

    import app.api.ai as ai_api

    def _boom(**kwargs: Any) -> dict[str, Any]:
        _ = kwargs
        raise ZenFetchError(503, "upstream exploded")

    monkeypatch.setattr(ai_api, "_generate_proposal_structured", _boom)

    r = client.post(
        "/api/ai/proposals/draft",
        json={
            "projectId": "p-prop-draft-log",
            "conversationId": conv_id,
            "messageId": assistant_id,
            "context": {},
        },
    )
    assert r.status_code == 502, r.text
    detail = r.json()["detail"]
    log_id = detail.get("logId")
    assert isinstance(log_id, str) and log_id.startswith("draft-"), detail

    log_file = settings.data_dir / "ai_provider_failures.jsonl"
    assert log_file.exists()
    lines = log_file.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    event = json.loads(lines[0])
    assert event["logId"] == log_id
    assert event["operation"] == "proposals/draft"
    assert event["httpStatus"] == 502
    assert event["providerStatus"] == 503
    assert "upstream exploded" in event["providerBodySnippet"]
    assert "sk-test-key-1234" not in log_file.read_text(encoding="utf-8")


def test_draft_unusable_commands_failure_carries_log_id(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, settings: Any
) -> None:
    _make_project(client, "p-prop-draft-log2")
    conv_id = _make_conversation(client, "p-prop-draft-log2")
    assistant_id = _assistant_message_id(client, conv_id)
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_draft(monkeypatch, {"title": "No commands here"})

    r = client.post(
        "/api/ai/proposals/draft",
        json={
            "projectId": "p-prop-draft-log2",
            "conversationId": conv_id,
            "messageId": assistant_id,
            "context": {},
        },
    )
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "no_actionable_edit"
    assert "no actionable edit" in detail["message"]
    assert isinstance(detail.get("logId"), str)

    log_file = settings.data_dir / "ai_provider_failures.jsonl"
    event = json.loads(log_file.read_text(encoding="utf-8").splitlines()[-1])
    assert event["logId"] == detail["logId"]
    assert event["extra"]["reason"] == "model did not return usable commands"


def test_invalid_type_blocked_with_fixable_message(client: TestClient) -> None:
    before = _make_project(client, "p-prop-2")
    conv_id = _make_conversation(client, "p-prop-2")
    r = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-prop-2",
            "conversationId": conv_id,
            "commands": [{"type": "DeleteEverything"}],
            "projectFingerprint": "fp-1",
        },
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["validation"]["ok"] is False
    assert data["status"] == "draft"
    errors = data["validation"]["errors"]
    assert len(errors) == 1
    assert "DeleteEverything" in errors[0]["message"]
    assert "Allowed" in errors[0]["message"] or "allowed" in errors[0]["message"]
    assert client.get("/api/projects/p-prop-2").text == before


def test_missing_field_and_inline_base64_blocked(client: TestClient) -> None:
    _make_project(client, "p-prop-3")
    conv_id = _make_conversation(client, "p-prop-3")
    # Missing required slideId on CreatePrompterPart.
    r = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-prop-3",
            "conversationId": conv_id,
            "commands": [{"type": "CreatePrompterPart", "text": "Hi", "duration": 1.0}],
            "projectFingerprint": "fp-1",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["validation"]["ok"] is False
    assert "slideId" in r.json()["validation"]["errors"][0]["message"]

    # Inline base64 must be referenced by asset id instead.
    big = "A" * 2000
    r2 = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-prop-3",
            "conversationId": conv_id,
            "commands": [
                {
                    "type": "ReplacePrompterWords",
                    "slideId": "s",
                    "partId": "p",
                    "startWordIndex": 0,
                    "endWordIndex": 0,
                    "ttsData": {"data": big, "mimeType": "audio/wav"},
                }
            ],
            "projectFingerprint": "fp-1",
        },
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["validation"]["ok"] is False
    assert "asset" in r2.json()["validation"]["errors"][0]["message"].lower()


def test_allowlist_carries_stage_placeholders(client: TestClient) -> None:
    _make_project(client, "p-prop-4")
    conv_id = _make_conversation(client, "p-prop-4")
    r = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-prop-4",
            "conversationId": conv_id,
            "commands": VALID_COMMANDS,
            "projectFingerprint": "fp-1",
        },
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["validation"]["ok"] is True, data["validation"]
    types = {c["type"] for c in data["commands"]}
    assert "AiCommitTts" in types  # Stage C prompter/audio
    assert "AiSetMorphCoefficient" in types  # Stage D mouth coefficients
    assert "AiCreateBoardText" in types  # Stage E board content
    assert "AiImportSlides" in types  # merge


def _create_validated(client: TestClient, pid: str) -> str:
    _make_project(client, pid)
    conv_id = _make_conversation(client, pid)
    r = client.post(
        "/api/ai/proposals",
        json={
            "projectId": pid,
            "conversationId": conv_id,
            "commands": VALID_COMMANDS[:3],
            "projectFingerprint": "fp-base",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["validation"]["ok"] is True
    return str(r.json()["id"])


def test_dry_run_then_approve_partial_subset(client: TestClient) -> None:
    pid = "p-prop-5"
    prop_id = _create_validated(client, pid)
    # Approve without dry-run is blocked.
    blocked = client.post(
        f"/api/ai/proposals/{prop_id}/approve",
        json={"currentFingerprint": "fp-base", "selectedIndexes": [0]},
    )
    assert blocked.status_code == 409, blocked.text
    assert (
        "dry-run" in blocked.json()["detail"].lower()
        or "dry_run" in blocked.json()["detail"].lower()
    )

    # Report the client dry-run against the live engine.
    dry = client.post(
        f"/api/ai/proposals/{prop_id}/dry-run",
        json={
            "projectFingerprint": "fp-live",
            "ok": True,
            "errors": [],
            "validatedIndexes": [0, 1, 2],
        },
    )
    assert dry.status_code == 200, dry.text
    assert dry.json()["status"] == "dry_run_ok"
    assert dry.json()["validatedFingerprint"] == "fp-live"

    # Partial acceptance executes the chosen subset only.
    approved = client.post(
        f"/api/ai/proposals/{prop_id}/approve",
        json={"currentFingerprint": "fp-live", "selectedIndexes": [0, 2]},
    )
    assert approved.status_code == 200, approved.text
    data = approved.json()
    assert data["status"] == "approved"
    assert data["selectedIndexes"] == [0, 2]
    assert len(data["executableCommands"]) == 2
    assert data["executableCommands"][0]["type"] == "CreateSlide"


def test_stale_proposal_blocked_at_approval(client: TestClient) -> None:
    pid = "p-prop-6"
    prop_id = _create_validated(client, pid)
    client.post(
        f"/api/ai/proposals/{prop_id}/dry-run",
        json={
            "projectFingerprint": "fp-v1",
            "ok": True,
            "errors": [],
            "validatedIndexes": [0, 1, 2],
        },
    )
    # Project moved since validation -> blocked with a fixable re-validate message.
    stale = client.post(
        f"/api/ai/proposals/{prop_id}/approve",
        json={"currentFingerprint": "fp-v2", "selectedIndexes": [0]},
    )
    assert stale.status_code == 409, stale.text
    assert "stale" in stale.json()["detail"].lower()
    # Re-validate at the new fingerprint unblocks.
    client.post(
        f"/api/ai/proposals/{prop_id}/dry-run",
        json={"projectFingerprint": "fp-v2", "ok": True, "errors": [], "validatedIndexes": [0]},
    )
    ok = client.post(
        f"/api/ai/proposals/{prop_id}/approve",
        json={"currentFingerprint": "fp-v2", "selectedIndexes": [0]},
    )
    assert ok.status_code == 200, ok.text


def test_approve_outside_dry_run_subset_blocked(client: TestClient) -> None:
    pid = "p-prop-6b"
    prop_id = _create_validated(client, pid)
    client.post(
        f"/api/ai/proposals/{prop_id}/dry-run",
        json={"projectFingerprint": "fp-1", "ok": True, "errors": [], "validatedIndexes": [0]},
    )
    # Approving an index the dry-run never covered is blocked with a fixable message.
    blocked = client.post(
        f"/api/ai/proposals/{prop_id}/approve",
        json={"currentFingerprint": "fp-1", "selectedIndexes": [0, 1]},
    )
    assert blocked.status_code == 422, blocked.text
    assert "dry-run" in blocked.json()["detail"].lower()
    # Re-running the dry-run over the full subset unblocks approval.
    client.post(
        f"/api/ai/proposals/{prop_id}/dry-run",
        json={"projectFingerprint": "fp-1", "ok": True, "errors": [], "validatedIndexes": [0, 1]},
    )
    allowed = client.post(
        f"/api/ai/proposals/{prop_id}/approve",
        json={"currentFingerprint": "fp-1", "selectedIndexes": [0, 1]},
    )
    assert allowed.status_code == 200, allowed.text


def test_execution_record_links_history_and_partial_subset(client: TestClient) -> None:
    pid = "p-prop-7"
    prop_id = _create_validated(client, pid)
    client.post(
        f"/api/ai/proposals/{prop_id}/dry-run",
        json={
            "projectFingerprint": "fp-1",
            "ok": True,
            "errors": [],
            "validatedIndexes": [0, 1, 2],
        },
    )
    client.post(
        f"/api/ai/proposals/{prop_id}/approve",
        json={"currentFingerprint": "fp-1", "selectedIndexes": [1, 2]},
    )
    # Execute without approval state would fail; approved executes as one record.
    rec = client.post(
        f"/api/ai/proposals/{prop_id}/execute",
        json={
            "historyEntryId": "hist-123",
            "executedIndexes": [1, 2],
            "success": True,
        },
    )
    assert rec.status_code == 200, rec.text
    data = rec.json()
    assert data["status"] == "executed"
    assert len(data["executions"]) == 1
    assert data["executions"][0]["historyEntryId"] == "hist-123"
    assert data["executions"][0]["executedIndexes"] == [1, 2]

    # Failed execution keeps its own record and flips status without extra history.
    prop2 = _create_validated(client, "p-prop-7b")
    client.post(
        f"/api/ai/proposals/{prop2}/dry-run",
        json={
            "projectFingerprint": "fp-1",
            "ok": True,
            "errors": [],
            "validatedIndexes": [0, 1, 2],
        },
    )
    client.post(
        f"/api/ai/proposals/{prop2}/approve",
        json={"currentFingerprint": "fp-1", "selectedIndexes": [0]},
    )
    fail = client.post(
        f"/api/ai/proposals/{prop2}/execute",
        json={
            "historyEntryId": "",
            "executedIndexes": [0],
            "success": False,
            "error": "CreateSlide: No project exists in memory",
        },
    )
    assert fail.status_code == 200, fail.text
    assert fail.json()["status"] == "execution_failed"


def test_proposal_isolation_and_cascade(client: TestClient) -> None:
    _make_project(client, "p-prop-8")
    conv_id = _make_conversation(client, "p-prop-8")
    r = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-prop-8",
            "conversationId": conv_id,
            "commands": VALID_COMMANDS[:1],
            "projectFingerprint": "fp-1",
        },
    )
    assert r.status_code == 201
    assert client.get("/api/ai/proposals", params={"projectId": "p-prop-8"}).json() != []
    assert client.get("/api/ai/proposals", params={"projectId": "p-prop-other"}).json() == []
    assert client.delete("/api/projects/p-prop-8").status_code == 204
    assert client.get("/api/ai/proposals", params={"projectId": "p-prop-8"}).json() == []
    assert client.get(f"/api/ai/proposals/{r.json()['id']}").status_code == 404


def _clip_batch(client: TestClient, pid: str, clip: dict[str, Any]) -> dict[str, Any]:
    _make_project(client, pid)
    conv_id = _make_conversation(client, pid)
    r = client.post(
        "/api/ai/proposals",
        json={
            "projectId": pid,
            "conversationId": conv_id,
            "title": "Clip check",
            "commands": [
                {
                    "type": "AiAnimationAssetBatch",
                    "operations": [
                        {"kind": "upsertClip", "action": "create", "nodeId": "n1", "clip": clip}
                    ],
                }
            ],
            "projectFingerprint": "fp-1",
        },
    )
    assert r.status_code == 201, r.text
    return dict(r.json())


def _good_clip() -> dict[str, Any]:
    return {
        "id": "c-good",
        "name": "Good",
        "duration": 1,
        "channels": [{"property": "positionY"}],
        "params": [],
        "channelAnimations": {
            "positionY": {
                "keyframes": [
                    {"id": "k1", "time": 0, "value": 10, "interpolation": "linear"},
                    {"id": "k2", "time": 1, "value": 30, "interpolation": "linear"},
                ]
            }
        },
    }


def test_clip_gate_rejects_invented_dialect_and_empty_clips(client: TestClient) -> None:
    # Wrong dialect: keyframes nested inside channels[] (what the LLM drafter emits).
    bad = _good_clip()
    bad["channels"] = [
        {
            "keyframes": [{"time": 0, "value": 0}],
            "nodeId": "n1",
            "property": "positionY",
        }
    ]
    del bad["channelAnimations"]
    data = _clip_batch(client, "p-clip-dialect", bad)
    assert data["validation"]["ok"] is False
    assert any("must not nest 'keyframes'" in e["message"] for e in data["validation"]["errors"])

    # Empty channels, no keyframes anywhere.
    data = _clip_batch(
        client,
        "p-clip-empty",
        {"id": "c-e", "name": "E", "duration": 1, "channels": [], "params": []},
    )
    assert data["validation"]["ok"] is False

    # Channel definitions but zero keyframes.
    data = _clip_batch(
        client,
        "p-clip-nokeys",
        {
            "id": "c-n",
            "name": "N",
            "duration": 1,
            "channels": [{"property": "positionY"}],
            "params": [],
        },
    )
    assert data["validation"]["ok"] is False
    assert any("at least one keyframe" in e["message"] for e in data["validation"]["errors"])

    # Canonical clip with real keyframes passes.
    assert _clip_batch(client, "p-clip-good", _good_clip())["validation"]["ok"] is True

    # Morph-only clips legitimately carry empty channels.
    morph = {
        "id": "c-m",
        "name": "M",
        "duration": 1,
        "channels": [],
        "params": [],
        "morphAnimation": {
            "keyframes": [
                {
                    "id": "k1",
                    "time": 0,
                    "value": {"fromShapeName": "a", "toShapeName": "b", "coefficient": 0},
                },
                {
                    "id": "k2",
                    "time": 1,
                    "value": {"fromShapeName": "a", "toShapeName": "b", "coefficient": 1},
                },
            ]
        },
    }
    assert _clip_batch(client, "p-clip-morph", morph)["validation"]["ok"] is True


def test_rejected_server_invalid_cannot_approve(client: TestClient) -> None:
    _make_project(client, "p-prop-9")
    conv_id = _make_conversation(client, "p-prop-9")
    r = client.post(
        "/api/ai/proposals",
        json={
            "projectId": "p-prop-9",
            "conversationId": conv_id,
            "commands": [{"type": "Nope"}],
            "projectFingerprint": "fp-1",
        },
    )
    prop_id = str(r.json()["id"])
    client.post(
        f"/api/ai/proposals/{prop_id}/dry-run",
        json={
            "projectFingerprint": "fp-1",
            "ok": True,
            "errors": [],
            "validatedIndexes": [0, 1, 2],
        },
    )
    blocked = client.post(
        f"/api/ai/proposals/{prop_id}/approve",
        json={"currentFingerprint": "fp-1", "selectedIndexes": [0]},
    )
    assert blocked.status_code == 422, blocked.text
