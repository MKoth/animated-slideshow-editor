"""Context Snapshot accepted-version rendering (issue #466)."""

from __future__ import annotations

from app.ai.prompting import context_to_text


def test_accepted_version_renders_downstream_snapshot_line() -> None:
    text = context_to_text(
        {
            "scenarioMarkdown": "## Step 1 -- Hi",
            "scenarioActiveVersion": {"id": "v-active", "summary": "Draft", "touchedSteps": [1]},
            "scenarioAcceptedVersion": {
                "id": "v-accepted",
                "summary": "Stable",
                "touchedSteps": [1, 2],
            },
        }
    )
    assert "scenario markdown:" in text
    assert "active scenario version:" in text
    assert "accepted scenario version (downstream snapshot):" in text
    assert "v-accepted" in text
    assert "Stable" in text


def test_no_accepted_version_renders_no_downstream_line() -> None:
    text = context_to_text({"scenarioMarkdown": "## Step 1 -- Hi"})
    assert "accepted scenario version" not in text
