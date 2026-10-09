"""AI Edit Proposal validate-dry-run-execute pipeline (Spec 12, issue #422)."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient


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
    assert client.get("/api/projects/p-prop-1").text == before


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
