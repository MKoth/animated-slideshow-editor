"""Spec 12 assembly merge gate (issue #428): project ops + ImportSlides proposal."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.ai.assembly import (
    assembly_accept_blockers,
    require_accepted_for_merge,
    resolve_name_collisions,
    union_ids_by_id,
    unique_assembled_name,
)
from app.ai.proposals import validate_proposal_commands


def _make_project(client: TestClient, pid: str = "p-asm") -> str:
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
    return pid


def _make_conversation(client: TestClient, project_id: str) -> str:
    conv = client.post("/api/ai/conversations", json={"projectId": project_id}).json()
    return str(conv["id"])


def test_merge_gate_requires_accepted_c_d_e() -> None:
    assert (
        assembly_accept_blockers(
            {"narration": "accepted", "calibration": "accepted", "board": "accepted"}
        )
        == []
    )
    require_accepted_for_merge(
        {"narration": "accepted", "calibration": "accepted", "board": "accepted"}
    )
    for statuses, needle in [
        ({"narration": "draft", "calibration": "accepted", "board": "accepted"}, "narration"),
        ({"narration": "accepted", "calibration": "draft", "board": "accepted"}, "calibration"),
        ({"narration": "accepted", "calibration": "accepted", "board": "draft"}, "board"),
    ]:
        blockers = assembly_accept_blockers(statuses)
        assert len(blockers) == 1
        assert needle in blockers[0].lower()
        try:
            require_accepted_for_merge(statuses)
        except ValueError as exc:
            assert "merge runs only on fully accepted" in str(exc).lower()
        else:
            raise AssertionError("expected ValueError")


def test_unique_assembled_name_suffix() -> None:
    assert unique_assembled_name("Lesson", []) == "Lesson (assembled)"
    assert unique_assembled_name("Lesson", ["Lesson (assembled)"]) == "Lesson (assembled 2)"
    assert (
        unique_assembled_name("Lesson", ["Lesson (assembled)", "Lesson (assembled 2)"])
        == "Lesson (assembled 3)"
    )


def test_first_keeps_suffix_and_union_on_id() -> None:
    assert resolve_name_collisions(["Intro"], ["Intro", "Intro", "Middle"]) == [
        "Intro (2)",
        "Intro (3)",
        "Middle",
    ]
    merged, added = union_ids_by_id(
        [{"id": "a1", "name": "Target"}],
        [{"id": "a1", "name": "Incoming"}, {"id": "a3", "name": "New"}],
    )
    assert [entry["id"] for entry in merged] == ["a1", "a3"]
    assert merged[0]["name"] == "Target"
    assert added == ["a3"]


def test_import_slides_schema_accepts_slides_payload(client: TestClient) -> None:
    pid = _make_project(client, "p-asm-1")
    conv_id = _make_conversation(client, pid)
    slide = {
        "id": "slide-intro-1",
        "name": "Intro 1",
        "duration": 5.0,
        "scene": {"id": "scene-1", "nodes": []},
    }
    r = client.post(
        "/api/ai/proposals",
        json={
            "projectId": pid,
            "conversationId": conv_id,
            "title": "Assembly",
            "commands": [
                {
                    "type": "AiImportSlides",
                    "slideIds": ["slide-intro-1"],
                    "slides": [slide],
                    "targetIndex": 0,
                }
            ],
            "projectFingerprint": "fp-1",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["validation"]["ok"] is True


def test_import_slides_schema_blocks_empty_without_fixable_message() -> None:
    ok, errors = validate_proposal_commands([{"type": "AiImportSlides", "slideIds": []}])
    assert ok is False
    assert errors
    assert "slides" in errors[0]["message"].lower() or "slideids" in errors[0]["message"].lower()
    ok2, errors2 = validate_proposal_commands([{"type": "AiImportSlides"}])
    assert ok2 is False
    assert "open the named" in errors2[0]["message"].lower()


def test_import_slides_schema_accepts_top_level_clips() -> None:
    slide = {"id": "s1", "name": "Intro 1"}
    ok, errors = validate_proposal_commands(
        [
            {
                "type": "AiImportSlides",
                "slideIds": ["s1"],
                "slides": [slide],
                "clips": [{"id": "clip-1", "name": "Clip 1"}],
                "clipCollections": [{"id": "col-1", "name": "Col 1"}],
            }
        ]
    )
    assert ok is True, errors
    bad, bad_errors = validate_proposal_commands(
        [
            {
                "type": "AiImportSlides",
                "slideIds": ["s1"],
                "slides": [slide],
                "clips": [{"name": "missing id"}],
            }
        ]
    )
    assert bad is False
    assert "clips[0]" in bad_errors[0]["message"]
