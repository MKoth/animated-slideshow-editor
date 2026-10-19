"""Conversation versioned edits with History and restore (issue #462)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.ai import scenario_versions as versions


def _make_project(client: TestClient, pid: str = "p-md") -> str:
    import json

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


def test_intent_prefixes_override_label() -> None:
    assert versions.classify_scenario_intent("ask: whatever", "intent: edit\n## Step 1") == (
        "question-only"
    )
    assert versions.classify_scenario_intent("edit: do it", "intent: question") == "edit"
    assert versions.classify_scenario_intent("hello", "intent: edit\n## Step 1") == "edit"
    assert (
        versions.classify_scenario_intent("hello", "intent: question-only\njust asking")
        == "question-only"
    )
    assert versions.classify_scenario_intent("hello", "## Step 1 -- Hi") == "edit"
    assert versions.classify_scenario_intent("hello", "what do you think?") == "question-only"


def test_mixed_reply_applies_edit_and_keeps_question() -> None:
    parsed = versions.parse_assistant_reply(
        "go",
        "intent: edit\nSummary: Add intro\nTouched-steps: 1\n\n## Step 1 -- Hi\n\nHello\n\nQuestion: Should step 2 mention cats?",
    )
    assert parsed["intent"] == "edit"
    assert parsed["summary"] == "Add intro"
    assert parsed["touched_steps"] == [1]
    assert "## Step 1" in str(parsed["edit_content"])
    assert "Should step 2" in str(parsed["question_text"] or "")


def test_diff_lines_marks_add_del_same() -> None:
    diff = versions.diff_markdown_lines("a\nb\nc", "a\nB\nc")
    kinds = [d["type"] for d in diff]
    assert kinds == ["same", "del", "add", "same"]
    assert versions.diff_markdown_lines("x", "x") == [
        {"type": "same", "line": "x", "oldLineNo": 1, "newLineNo": 1}
    ]


def test_apply_edit_creates_version_and_audit_with_link(client: TestClient) -> None:
    _make_project(client, "p-md-1")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-md-1"}).json()
    msgs = client.post(
        "/api/ai/conversations",
        json={"projectId": "p-md-1"},
    )
    _ = msgs
    # Persist a user + assistant message pair to link.
    client.post(
        "/api/ai/chat",
        json={"conversationId": conv["id"], "message": "hi", "mode": "send", "context": {}},
    )
    # Chat without a key persists an error assistant message; fetch its id.
    history = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    assistant_id = next(m["id"] for m in history if m["role"] == "assistant")

    r = client.post(
        "/api/ai/scenarios/markdown/apply",
        json={
            "projectId": "p-md-1",
            "conversationId": conv["id"],
            "messageId": assistant_id,
            "userText": "make an intro",
            "assistantText": "intent: edit\nSummary: Add intro\nTouched-steps: 1\n\n## Step 1 -- Hi\n\nHello.",
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["intent"] == "edit"
    version = data["version"]
    assert version["summary"] == "Add intro"
    assert version["touchedSteps"] == [1]
    assert "## Step 1" in version["content"]
    assert version["timestamp"]
    assert data["audit"]["versionId"] == version["id"]
    assert data["audit"]["concurrency"] == "last-writer-wins"

    # Per-message link lives server-side.
    after = client.get(f"/api/ai/conversations/{conv['id']}/messages").json()
    linked = next(m for m in after if m["id"] == assistant_id)
    assert linked["scenarioIntent"] == "edit"
    assert linked["scenarioVersionId"] == version["id"]
    assert linked["scenarioSummary"] == "Add intro"
    assert linked["scenarioTouchedSteps"] == [1]

    # History ordered + active pointer per project.
    listing = client.get(
        "/api/ai/scenarios/markdown/versions", params={"projectId": "p-md-1"}
    ).json()
    assert len(listing) == 1
    active = client.get("/api/ai/scenarios/markdown/active", params={"projectId": "p-md-1"}).json()
    assert active["activeVersionId"] == version["id"]


def test_apply_question_creates_no_version(client: TestClient) -> None:
    _make_project(client, "p-md-2")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-md-2"}).json()
    r = client.post(
        "/api/ai/scenarios/markdown/apply",
        json={
            "projectId": "p-md-2",
            "conversationId": conv["id"],
            "userText": "ask: what should step 1 be?",
            "assistantText": "intent: edit\nSummary: oops\nTouched-steps: 1\n\n## Step 1 -- Hi",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["intent"] == "question-only"
    assert r.json()["version"] is None
    listing = client.get(
        "/api/ai/scenarios/markdown/versions", params={"projectId": "p-md-2"}
    ).json()
    assert listing == []


def test_restore_copies_forward_and_never_rewrites(client: TestClient) -> None:
    _make_project(client, "p-md-3")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-md-3"}).json()
    v1 = client.post(
        "/api/ai/scenarios/markdown/versions",
        json={
            "projectId": "p-md-3",
            "conversationId": conv["id"],
            "content": "## Step 1 -- One\n\nA.",
            "summary": "First",
            "touchedSteps": [1],
        },
    ).json()
    v2 = client.post(
        "/api/ai/scenarios/markdown/versions",
        json={
            "projectId": "p-md-3",
            "conversationId": conv["id"],
            "content": "## Step 1 -- One\n\nB.",
            "summary": "Second",
            "touchedSteps": [1],
        },
    ).json()
    assert v1["id"] != v2["id"]
    restored = client.post(
        f"/api/ai/scenarios/markdown/versions/{v1['id']}/restore",
        json={"projectId": "p-md-3", "conversationId": conv["id"]},
    )
    assert restored.status_code == 201, restored.text
    rdata = restored.json()
    assert rdata["content"] == v1["content"]
    assert rdata["id"] not in (v1["id"], v2["id"])
    assert "Restore" in rdata["summary"]
    # History is append-only and unbounded: three ordered versions.
    listing = client.get(
        "/api/ai/scenarios/markdown/versions", params={"projectId": "p-md-3"}
    ).json()
    assert [v["id"] for v in listing] == [v1["id"], v2["id"], rdata["id"]]
    # Diff payload on detail.
    detail = client.get(f"/api/ai/scenarios/markdown/versions/{rdata['id']}").json()
    assert any(d["type"] in ("add", "del", "same") for d in detail["diffFromPrevious"])
    # Active pointer moved last-writer-wins.
    active = client.get("/api/ai/scenarios/markdown/active", params={"projectId": "p-md-3"}).json()
    assert active["activeVersionId"] == rdata["id"]
    # Audits recorded for every apply.
    audits = client.get("/api/ai/scenarios/markdown/audits", params={"projectId": "p-md-3"}).json()
    assert len(audits) == 3
    assert all(a["concurrency"] == "last-writer-wins" for a in audits)


def test_versions_survive_message_trim_and_cascade(client: TestClient) -> None:
    _make_project(client, "p-md-4")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-md-4"}).json()
    created = client.post(
        "/api/ai/scenarios/markdown/versions",
        json={
            "projectId": "p-md-4",
            "conversationId": conv["id"],
            "content": "## Step 1 -- One",
            "summary": "S",
            "touchedSteps": [1],
        },
    ).json()
    # Trimming messages (limit/offset) never trims versions.
    trimmed = client.get(f"/api/ai/conversations/{conv['id']}/messages", params={"limit": 0}).json()
    assert trimmed == []
    listing = client.get(
        "/api/ai/scenarios/markdown/versions", params={"projectId": "p-md-4"}
    ).json()
    assert [v["id"] for v in listing] == [created["id"]]
    # Conversation delete cascades versions + audits.
    assert client.delete(f"/api/ai/conversations/{conv['id']}").status_code == 204
    assert (
        client.get("/api/ai/scenarios/markdown/versions", params={"projectId": "p-md-4"}).json()
        == []
    )
    assert (
        client.get("/api/ai/scenarios/markdown/audits", params={"projectId": "p-md-4"}).json() == []
    )


def test_project_delete_cascades_versions(client: TestClient) -> None:
    _make_project(client, "p-md-5")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-md-5"}).json()
    client.post(
        "/api/ai/scenarios/markdown/versions",
        json={
            "projectId": "p-md-5",
            "conversationId": conv["id"],
            "content": "## Step 1 -- One",
            "summary": "S",
            "touchedSteps": [1],
        },
    )
    assert client.delete("/api/projects/p-md-5").status_code == 204
    assert (
        client.get("/api/ai/scenarios/markdown/versions", params={"projectId": "p-md-5"}).json()
        == []
    )
