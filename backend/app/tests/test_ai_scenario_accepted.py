"""Accepted-version rule for downstream reconciliation (issue #466)."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient


def _make_project(client: TestClient, pid: str) -> str:
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


def _make_version(
    client: TestClient, pid: str, conv: str, content: str, summary: str
) -> dict[str, Any]:
    r = client.post(
        "/api/ai/scenarios/markdown/versions",
        json={
            "projectId": pid,
            "conversationId": conv,
            "content": content,
            "summary": summary,
            "touchedSteps": [1],
        },
    )
    assert r.status_code == 201, r.text
    data: dict[str, Any] = r.json()
    return data


def test_accepted_rule_stable_snapshot_not_latest_draft(client: TestClient) -> None:
    _make_project(client, "p-acc-1")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-acc-1"}).json()
    v1 = _make_version(client, "p-acc-1", conv["id"], "## Step 1 -- One\n\nA.", "First")
    v2 = _make_version(client, "p-acc-1", conv["id"], "## Step 1 -- One\n\nB.", "Second")

    # No accepted snapshot yet: canonical blocks instead of reading stale active.
    assert (
        client.get(
            "/api/ai/scenarios/markdown/canonical", params={"projectId": "p-acc-1"}
        ).status_code
        == 409
    )
    assert (
        client.get("/api/ai/scenarios/markdown/accepted", params={"projectId": "p-acc-1"}).json()[
            "acceptedVersionId"
        ]
        is None
    )

    # Accept v1: downstream reads v1 even after v2 (a newer draft) lands.
    acc = client.post(
        "/api/ai/scenarios/markdown/accept",
        json={"projectId": "p-acc-1", "versionId": v1["id"]},
    )
    assert acc.status_code == 200, acc.text
    assert acc.json()["acceptedVersionId"] == v1["id"]

    canonical = client.get(
        "/api/ai/scenarios/markdown/canonical", params={"projectId": "p-acc-1"}
    ).json()
    assert canonical["acceptedVersionId"] == v1["id"]
    assert "A." in canonical["content"]

    # Newer drafts never move the accepted snapshot (no silent ignore, no chase).
    v3 = _make_version(client, "p-acc-1", conv["id"], "## Step 1 -- One\n\nC.", "Third")
    assert v3["id"] not in (v1["id"], v2["id"])
    active = client.get("/api/ai/scenarios/markdown/active", params={"projectId": "p-acc-1"}).json()
    assert active["activeVersionId"] == v3["id"]
    assert active["acceptedVersionId"] == v1["id"]
    assert active["acceptedVersion"]["id"] == v1["id"]
    canonical2 = client.get(
        "/api/ai/scenarios/markdown/canonical", params={"projectId": "p-acc-1"}
    ).json()
    assert canonical2["acceptedVersionId"] == v1["id"]
    assert "A." in canonical2["content"]

    # Explicit re-accept moves the snapshot.
    acc2 = client.post(
        "/api/ai/scenarios/markdown/accept",
        json={"projectId": "p-acc-1", "versionId": v3["id"]},
    )
    assert acc2.status_code == 200
    canonical3 = client.get(
        "/api/ai/scenarios/markdown/canonical", params={"projectId": "p-acc-1"}
    ).json()
    assert canonical3["acceptedVersionId"] == v3["id"]
    assert "C." in canonical3["content"]


def test_accept_rejects_cross_project_version(client: TestClient) -> None:
    _make_project(client, "p-acc-2a")
    _make_project(client, "p-acc-2b")
    conv_a = client.post("/api/ai/conversations", json={"projectId": "p-acc-2a"}).json()
    client.post("/api/ai/conversations", json={"projectId": "p-acc-2b"})
    v = _make_version(client, "p-acc-2a", conv_a["id"], "## Step 1 -- One", "S")
    r = client.post(
        "/api/ai/scenarios/markdown/accept",
        json={"projectId": "p-acc-2b", "versionId": v["id"]},
    )
    assert r.status_code == 422, r.text


def test_accept_unknown_version_404(client: TestClient) -> None:
    _make_project(client, "p-acc-3")
    r = client.post(
        "/api/ai/scenarios/markdown/accept",
        json={"projectId": "p-acc-3", "versionId": "no-such-version"},
    )
    assert r.status_code == 404, r.text


def test_accept_audit_and_cascade(client: TestClient) -> None:
    _make_project(client, "p-acc-4")
    conv = client.post("/api/ai/conversations", json={"projectId": "p-acc-4"}).json()
    v1 = _make_version(client, "p-acc-4", conv["id"], "## Step 1 -- One\n\nA.", "First")
    client.post(
        "/api/ai/scenarios/markdown/accept",
        json={"projectId": "p-acc-4", "versionId": v1["id"]},
    )
    audits = client.get("/api/ai/scenarios/markdown/audits", params={"projectId": "p-acc-4"}).json()
    assert any(
        a["operation"] == "markdown-version-accept" and a["versionId"] == v1["id"] for a in audits
    )
    assert all(a["concurrency"] == "last-writer-wins" for a in audits)

    # Deleting the conversation clears the accepted gate (no ghost snapshot).
    assert client.delete(f"/api/ai/conversations/{conv['id']}").status_code == 204
    assert (
        client.get("/api/ai/scenarios/markdown/accepted", params={"projectId": "p-acc-4"}).json()[
            "acceptedVersionId"
        ]
        is None
    )
    assert (
        client.get(
            "/api/ai/scenarios/markdown/canonical", params={"projectId": "p-acc-4"}
        ).status_code
        == 409
    )
