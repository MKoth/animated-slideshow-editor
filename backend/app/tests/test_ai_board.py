"""Stage E hard-locked blackboard Animation Scripts (Spec 12, issue #427).

One fresh script per middle slide from zero with marks at every PrompterPart
boundary; hard lock to accepted narration times (overrun/drift blocks, no
auto-shift); create-then-reveal text/tables with built-ins only; invalid
targets and unresolved bindings blocked at compile time; static board camera
with no cat in the middle; own record + accept gate feeding the merge.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.ai.boards import (
    board_accept_blockers,
    board_move_requested,
    build_board_commands,
    build_template_source,
    marks_for_parts,
    marks_map_for_parts,
    middle_parts_from_narration,
    reject_forbidden_writes,
    slide_duration_for_parts,
    validate_board_content,
    validate_hard_lock,
    validate_marks_present,
    validate_script_header,
    validate_targets_and_bindings,
    verify_board_scene,
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
            "spokenLine": "Estar is for where you are.",
            "onScreenAction": "Table of examples appears on the board",
            "assetHints": ["blackboard", "chalk table"],
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


def _parts() -> list[dict[str, Any]]:
    return [
        {
            "stepId": "m1",
            "order": 0,
            "partTag": "middle",
            "spokenLine": "Ser is for who you are.",
            "estimatedDuration": 4.6,
            "audioDuration": 2.0,
            "timelineStart": 0.0,
            "timelineEnd": 2.0,
        },
        {
            "stepId": "m2",
            "order": 1,
            "partTag": "middle",
            "spokenLine": "Estar is for where you are.",
            "estimatedDuration": 5.4,
            "audioDuration": 3.0,
            "timelineStart": 2.0,
            "timelineEnd": 5.0,
        },
    ]


def _good_source() -> str:
    return (
        'script "Board middle" from 0\n'
        'mark("part-0")\n'
        'create text "Ser is" as line0\n'
        "reveal(line0)\n"
        'mark("part-1")\n'
        'create text "Estar is" as line1\n'
        "reveal(line1)\n"
    )


def _enable_key(client: TestClient) -> None:
    app_state: Any = client.app
    app_state.state.settings.ai_secret_key = "test-secret-for-board"
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


# -- pure seam ---------------------------------------------------------------


def test_template_from_zero_with_marks_at_every_boundary() -> None:
    parts = _parts()
    assert slide_duration_for_parts(parts) == pytest.approx(5.0)
    marks = marks_for_parts(parts)
    assert [m["mark"] for m in marks] == ["part-0", "part-1"]
    assert [m["time"] for m in marks] == [0.0, 2.0]
    mapping = marks_map_for_parts(parts)
    assert mapping["part-0"]["stepId"] == "m1"
    source = build_template_source(parts)
    assert validate_script_header(source) == []
    assert validate_marks_present(source, parts) == []
    assert validate_board_content(source) == []
    with pytest.raises(ValueError, match="nothing to script"):
        middle_parts_from_narration([])
    # Intro/outro-tagged parts are pregen references, never scripted.
    mixed = [
        {
            "stepId": "i1",
            "order": 0,
            "partTag": "intro",
            "spokenLine": "Hi!",
            "timelineStart": 0.0,
            "timelineEnd": 1.0,
        },
        *parts,
    ]
    assert [p["stepId"] for p in middle_parts_from_narration(mixed)] == ["m1", "m2"]
    # Unmeasurable middle windows raise instead of silently dropping.
    with pytest.raises(ValueError, match="no measurable narration window"):
        middle_parts_from_narration(
            [{"stepId": "m9", "order": 0, "partTag": "middle", "spokenLine": "Hi"}]
        )


def test_header_must_start_at_zero_and_marks_must_cover_parts() -> None:
    parts = _parts()
    assert validate_script_header('script "B" from 2.0\nmark("part-0")\n')
    assert validate_marks_present(_good_source().replace('mark("part-1")', ""), parts)
    assert validate_script_header("")


def test_content_portability_builtin_only_create_then_reveal() -> None:
    assert validate_board_content(_good_source()) == []
    table_source = (
        'script "B" from 0\nmark("part-0")\ncreate table "Grid" as grid\n'
        'reveal(subtree(grid))\nmark("part-1")\ncreate text "x" as a\nreveal(a)\n'
    )
    assert validate_board_content(table_source) == []
    assert validate_board_content('script "B" from 0\nmark("part-0")\nreveal(x)\n')
    assert validate_board_content(_good_source() + "function fill(t: node) {}\n")
    assert validate_board_content(_good_source() + "title.play(clip1)\n")
    assert validate_board_content(_good_source() + "title.tween({ visible: 1 })\n")


def test_board_move_requested_and_scene_contract() -> None:
    assert verify_board_scene([], []).get("ok") is True
    assert verify_board_scene(["cat-1"], []).get("ok") is False
    assert verify_board_scene([], [{"property": "rotation"}]).get("ok") is False
    assert verify_board_scene([], [{"property": "positionX"}]).get("ok") is False
    assert verify_board_scene([], [{"property": "positionX"}], board_move=True).get("ok") is True
    assert board_move_requested(["Chalk text appears on the blackboard"]) is False
    assert board_move_requested(["Slow pan across the board, left to right"]) is True
    # Bare substrings never license a move ("company" is not a pan).
    assert board_move_requested(["Welcome to the company"]) is False
    # Comments about visibility never trip the visible-track ban.
    commented = _good_source() + "\n// this board stays visible throughout\n"
    assert validate_board_content(commented) == []


def test_hard_lock_overrun_and_drift_block_no_autoshift() -> None:
    parts = _parts()
    marks = marks_map_for_parts(parts)
    good_footprints = [{"from": 0, "to": 5.0, "effects": [{"start": 0.5, "duration": 1.0}]}]
    assert validate_hard_lock(parts, good_footprints, marks) == []
    overrun = [{"from": 0, "to": 5.0, "effects": [{"start": 1.5, "duration": 1.0}]}]
    assert validate_hard_lock(parts, overrun, marks)
    drifted = dict(marks)
    drifted["part-1"] = {"stepId": "m2", "time": 2.5}
    assert validate_hard_lock(parts, good_footprints, drifted)
    assert validate_hard_lock(parts, [{"from": 1.0, "to": 5.0}], marks)
    assert validate_hard_lock(parts, [], marks)


def test_targets_and_bindings_block_at_compile_time() -> None:
    assert (
        validate_targets_and_bindings(
            [{"severity": "error", "message": "reveal target has no visible content"}]
        )
        != []
    )
    assert (
        validate_targets_and_bindings([{"severity": "error", "message": 'Unknown binding "Title"'}])
        != []
    )
    assert validate_targets_and_bindings([{"severity": "warning", "message": "slow"}]) == []
    assert validate_targets_and_bindings([], [{"from": 0, "entryVersions": {"fill": 3}}]) != []


def test_board_commands_execute_as_set_script_only() -> None:
    commands = build_board_commands([{"slideId": "s1", "source": _good_source()}])
    assert commands[0]["type"] == "SetSlideAnimationScript"
    assert validate_proposal_commands(commands)[0] is True
    assert reject_forbidden_writes(commands) == []
    assert reject_forbidden_writes([{"type": "AiCreateBoardText", "slideId": "s", "text": "hi"}])
    with pytest.raises(ValueError, match="no slideId"):
        build_board_commands([{"slideId": "", "source": _good_source()}])
    with pytest.raises(ValueError, match="empty"):
        build_board_commands([{"slideId": "s1", "source": "  "}])


def test_accept_blockers_require_everything_green() -> None:
    parts = _parts()
    marks = marks_map_for_parts(parts)
    board = {
        "parts": parts,
        "scripts": [{"slideId": "s1", "source": _good_source()}],
        "footprints": [{"from": 0, "to": 5.0, "effects": [{"start": 0.5, "duration": 1.0}]}],
        "marksMap": marks,
        "diagnostics": [],
        "checks": {"parts": parts, "scene": {"catNodes": [], "cameraKeys": []}},
    }
    assert board_accept_blockers(board) == []
    overrun = dict(board)
    overrun["footprints"] = [{"from": 0, "to": 5.0, "effects": [{"start": 1.5, "duration": 1.0}]}]
    assert board_accept_blockers(overrun)
    cats = dict(board)
    cats["checks"] = {"parts": parts, "scene": {"catNodes": ["cat"], "cameraKeys": []}}
    assert board_accept_blockers(cats)


# -- record + gate seam ------------------------------------------------------


def test_board_requires_accepted_narration(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_key(client)
    _fake_models(monkeypatch, ["anthropic/claude-sonnet-4-5"])
    client.put("/api/ai/settings", json={"model": "anthropic/claude-sonnet-4-5"})
    _fake_scenario(monkeypatch, SAMPLE_SCENARIO)
    pid = "board-gate-proj"
    _make_project(client, pid)
    conv = client.post("/api/ai/conversations", json={"projectId": pid}).json()
    created = client.post(
        "/api/ai/scenarios",
        json={"projectId": pid, "conversationId": conv["id"], "request": "hi", "context": {}},
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
    rec_id = rec.json()["id"]
    assert client.post(f"/api/ai/reconciliations/{rec_id}/accept").status_code == 200
    nar = client.post(
        "/api/ai/narrations",
        json={"projectId": pid, "reconciliationId": rec_id, "conversationId": conv["id"]},
    )
    nar_id = nar.json()["id"]
    # Draft narration: Stage E refuses to run.
    r = client.post(
        "/api/ai/board-scripts",
        json={"projectId": pid, "narrationId": nar_id, "conversationId": conv["id"]},
    )
    assert r.status_code == 409, r.text


def test_board_record_template_compile_accept_flow(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    pid = "board-flow-proj"
    conv_id, _, _, nar_id = _make_accepted_narration(client, monkeypatch, pid)
    created = client.post(
        "/api/ai/board-scripts",
        json={"projectId": pid, "narrationId": nar_id, "conversationId": conv_id},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "draft"
    assert len(body["scripts"]) == 1
    assert "from 0" in body["scripts"][0]["source"]
    assert 'mark("part-' in body["scripts"][0]["source"]
    assert len(body["blockers"]) > 0  # no footprints yet
    board_id = body["id"]

    # Canonical refused while draft: merge reads only the accepted version.
    assert client.get(f"/api/ai/board-scripts/{board_id}/canonical").status_code == 409

    narration = client.get(f"/api/ai/narrations/{nar_id}").json()
    parts = narration["parts"]
    duration = narration["slideDuration"]
    marks = {
        f"part-{i}": {"stepId": p["stepId"], "time": p["timelineStart"]}
        for i, p in enumerate(parts)
    }
    footprints = [{"from": 0, "to": duration, "effects": [], "entryVersions": {}}]
    compiled = client.post(
        f"/api/ai/board-scripts/{board_id}/compile",
        json={"footprints": footprints, "marksMap": marks, "diagnostics": []},
    )
    assert compiled.status_code == 200, compiled.text
    # Template sources lack slideIds — map the live slide before accepting.
    scripts = compiled.json()["scripts"]
    scripts[0]["slideId"] = "middle-slide-1"
    patched = client.patch(f"/api/ai/board-scripts/{board_id}", json={"scripts": scripts})
    assert patched.status_code == 200, patched.text
    recompiled = client.post(
        f"/api/ai/board-scripts/{board_id}/compile",
        json={"footprints": footprints, "marksMap": marks, "diagnostics": []},
    )
    assert recompiled.status_code == 200, recompiled.text
    accepted = client.post(f"/api/ai/board-scripts/{board_id}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"
    canonical = client.get(f"/api/ai/board-scripts/{board_id}/canonical")
    assert canonical.status_code == 200, canonical.text
    assert "scripts" in canonical.json()
    assert "marksMap" in canonical.json()


def test_board_accept_blocked_on_overrun_and_cat(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    pid = "board-block-proj"
    conv_id, _, _, nar_id = _make_accepted_narration(client, monkeypatch, pid)
    created = client.post(
        "/api/ai/board-scripts",
        json={"projectId": pid, "narrationId": nar_id, "conversationId": conv_id},
    )
    board_id = created.json()["id"]
    narration = client.get(f"/api/ai/narrations/{nar_id}").json()
    parts = narration["parts"]
    duration = narration["slideDuration"]
    marks = {
        f"part-{i}": {"stepId": p["stepId"], "time": p["timelineStart"]}
        for i, p in enumerate(parts)
    }
    # Overrun past the first owning window blocks the gate.
    overrun = [
        {
            "from": 0,
            "to": duration,
            "effects": [{"start": parts[0]["timelineStart"], "duration": duration}],
            "entryVersions": {},
        }
    ]
    scripts = created.json()["scripts"]
    scripts[0]["slideId"] = "middle-slide-1"
    client.patch(f"/api/ai/board-scripts/{board_id}", json={"scripts": scripts})
    client.post(
        f"/api/ai/board-scripts/{board_id}/compile",
        json={"footprints": overrun, "marksMap": marks, "diagnostics": []},
    )
    assert client.post(f"/api/ai/board-scripts/{board_id}/accept").status_code == 409
    # Cat in the middle blocks even with a clean footprint.
    clean = [{"from": 0, "to": duration, "effects": [], "entryVersions": {}}]
    client.post(
        f"/api/ai/board-scripts/{board_id}/compile",
        json={"footprints": clean, "marksMap": marks, "diagnostics": []},
    )
    client.patch(f"/api/ai/board-scripts/{board_id}", json={"catNodes": ["cat-1"]})
    client.post(
        f"/api/ai/board-scripts/{board_id}/compile",
        json={"footprints": clean, "marksMap": marks, "diagnostics": []},
    )
    assert client.post(f"/api/ai/board-scripts/{board_id}/accept").status_code == 409
