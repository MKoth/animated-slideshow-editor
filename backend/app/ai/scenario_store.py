"""Scenario persistence seam (issue #460 prefactor).

Small owner for the scenario persistence cluster. Later scenario markdown
tickets (notably #461-#462) land here plus new scenario modules, without
edits inside the current god owner (`app/ai/library.py`).
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from app.ai import scenario_versions as _versions
from app.ai.model import (
    AiConversationRow,
    AiScenarioRevisionRow,
    AiScenarioRow,
)
from app.database import Database


class AiConversationNotFoundError(KeyError):
    pass


# Markdown versioned edits (issue #462): thin delegation to the
# `scenario_versions` owner so this seam stays the single persistence entry
# point used by `AiLibrary`.


def list_markdown_versions(
    database: Database, project_id: str, conversation_id: str | None = None
) -> list[object]:
    return _versions.list_markdown_versions(database, project_id, conversation_id)


def get_markdown_version(database: Database, version_id: str) -> object:
    return _versions.get_markdown_version(database, version_id)


def get_active_markdown_version_id(database: Database, project_id: str) -> str | None:
    return _versions.get_active_markdown_version_id(database, project_id)


def get_accepted_markdown_version_id(database: Database, project_id: str) -> str | None:
    return _versions.get_accepted_markdown_version_id(database, project_id)


def get_accepted_markdown_version(database: Database, project_id: str) -> object | None:
    return _versions.get_accepted_markdown_version(database, project_id)


def require_accepted_markdown_version(database: Database, project_id: str) -> object:
    return _versions.require_accepted_markdown_version(database, project_id)


def accept_markdown_version(
    database: Database,
    *,
    project_id: str,
    version_id: str,
    conversation_id: str | None = None,
    message_id: str | None = None,
) -> object:
    return _versions.accept_markdown_version(
        database,
        project_id=project_id,
        version_id=version_id,
        conversation_id=conversation_id,
        message_id=message_id,
    )


def create_markdown_version(
    database: Database,
    *,
    project_id: str,
    conversation_id: str,
    content: str,
    summary: str,
    touched_steps: list[int],
    message_id: str | None = None,
    base_version_id: str | None = None,
) -> object:
    return _versions.create_markdown_version(
        database,
        project_id=project_id,
        conversation_id=conversation_id,
        content=content,
        summary=summary,
        touched_steps=touched_steps,
        message_id=message_id,
        base_version_id=base_version_id,
    )


def restore_markdown_version(
    database: Database,
    *,
    version_id: str,
    project_id: str,
    conversation_id: str,
    message_id: str | None = None,
) -> object:
    return _versions.restore_markdown_version(
        database,
        version_id=version_id,
        project_id=project_id,
        conversation_id=conversation_id,
        message_id=message_id,
    )


def list_markdown_audits(database: Database, project_id: str) -> list[object]:
    return _versions.list_markdown_audits(database, project_id)


def delete_markdown_for_conversation(database: Database, conversation_id: str) -> None:
    _versions.delete_versions_for_conversation(database, conversation_id)


def delete_markdown_for_project(database: Database, project_id: str) -> None:
    _versions.delete_versions_for_project(database, project_id)


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _safe_float(value: object) -> float:
    try:
        if value is None:
            return 0.0
        if isinstance(value, (int, float)):
            number = float(value)
        elif isinstance(value, str) and value.strip():
            number = float(value.strip())
        else:
            return 0.0
    except (TypeError, ValueError):
        return 0.0
    return number if number >= 0 else 0.0


def load_scenario_steps(raw: str) -> list[dict[str, object]]:
    import json as _json

    try:
        data: object = _json.loads(raw or "[]")
    except (ValueError, TypeError):
        return []
    return data if isinstance(data, list) else []


def normalize_scenario_steps(raw: object) -> list[dict[str, object]]:
    steps: list[dict[str, object]] = []
    if not isinstance(raw, list):
        return steps
    for order, entry in enumerate(raw):
        if not isinstance(entry, dict):
            continue
        part_tag = str(entry.get("partTag", ""))
        if part_tag not in ("intro", "middle", "outro"):
            continue
        spoken = str(entry.get("spokenLine", ""))
        if not spoken.strip():
            continue
        action = str(entry.get("onScreenAction", ""))
        if not action.strip():
            continue
        hints = entry.get("assetHints", [])
        clean_hints: list[str] = []
        if isinstance(hints, list):
            for hint in hints:
                if isinstance(hint, str) and hint.strip():
                    clean_hints.append(hint.strip())
        step_id = entry.get("id")
        steps.append(
            {
                "id": step_id if isinstance(step_id, str) and step_id else str(uuid4()),
                "order": order,
                "partTag": part_tag,
                "spokenLine": spoken,
                "onScreenAction": action,
                "assetHints": clean_hints,
                "estimatedDurationSec": _safe_float(entry.get("estimatedDurationSec")),
            }
        )
    return steps


def scenario_snapshot(
    content: dict[str, object], steps: list[dict[str, object]]
) -> dict[str, object]:
    return {
        "title": content.get("title", ""),
        "description": content.get("description", ""),
        "steps": steps,
    }


def list_scenarios(database: Database, project_id: str) -> list[AiScenarioRow]:
    statement = (
        select(AiScenarioRow)
        .where(AiScenarioRow.project_id == project_id)
        .order_by(AiScenarioRow.updated_at.desc(), AiScenarioRow.id)
    )
    with database.session() as session:
        return list(session.scalars(statement))


def get_scenario(database: Database, scenario_id: str) -> AiScenarioRow:
    with database.session() as session:
        row = session.get(AiScenarioRow, scenario_id)
    if row is None:
        raise KeyError(scenario_id)
    return row


def list_scenario_revisions(database: Database, scenario_id: str) -> list[AiScenarioRevisionRow]:
    get_scenario(database, scenario_id)
    statement = (
        select(AiScenarioRevisionRow)
        .where(AiScenarioRevisionRow.scenario_id == scenario_id)
        .order_by(AiScenarioRevisionRow.created_at.asc(), AiScenarioRevisionRow.id)
    )
    with database.session() as session:
        return list(session.scalars(statement))


def create_scenario(
    database: Database,
    *,
    project_id: str,
    conversation_id: str,
    content: dict[str, object],
    source_request: str,
) -> AiScenarioRow:
    import json as _json

    steps = normalize_scenario_steps(content.get("steps"))
    now = _now()
    scenario_id = str(uuid4())
    with database.session() as session:
        conv = session.get(AiConversationRow, conversation_id)
        if conv is None:
            raise AiConversationNotFoundError(conversation_id)
        row = AiScenarioRow(
            id=scenario_id,
            project_id=project_id,
            conversation_id=conversation_id,
            title=str(content.get("title", ""))[:255],
            description=str(content.get("description", "")),
            status="draft",
            steps_json=_json.dumps(steps),
            user_edits_json="{}",
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        session.add(
            AiScenarioRevisionRow(
                id=str(uuid4()),
                scenario_id=scenario_id,
                source_request=source_request,
                snapshot_json=_json.dumps(scenario_snapshot(content, steps)),
                created_at=now,
            )
        )
        session.commit()
    return get_scenario(database, scenario_id)


def revise_scenario(
    database: Database,
    scenario_id: str,
    *,
    content: dict[str, object],
    source_request: str,
) -> AiScenarioRow:
    import json as _json

    steps = normalize_scenario_steps(content.get("steps"))
    snapshot = scenario_snapshot(content, steps)
    with database.session() as session:
        row = session.get(AiScenarioRow, scenario_id)
        if row is None:
            raise KeyError(scenario_id)
        row.title = str(content.get("title", row.title))[:255]
        row.description = str(content.get("description", row.description))
        row.steps_json = _json.dumps(steps)
        # Regeneration invalidates any prior acceptance: the author must
        # re-accept the new version before Stage B may read it.
        row.status = "draft"
        row.updated_at = _now()
        session.add(
            AiScenarioRevisionRow(
                id=str(uuid4()),
                scenario_id=scenario_id,
                source_request=source_request,
                snapshot_json=_json.dumps(snapshot),
                created_at=_now(),
            )
        )
        session.commit()
    return get_scenario(database, scenario_id)


def update_scenario_edits(
    database: Database,
    scenario_id: str,
    *,
    title: str | None = None,
    description: str | None = None,
    steps: list[dict[str, object]] | None = None,
) -> AiScenarioRow:
    import json as _json

    with database.session() as session:
        row = session.get(AiScenarioRow, scenario_id)
        if row is None:
            raise KeyError(scenario_id)
        try:
            loaded_edits: object = _json.loads(row.user_edits_json or "{}")
            user_edits = loaded_edits if isinstance(loaded_edits, dict) else {}
        except (ValueError, TypeError):
            user_edits = {}
        if not isinstance(user_edits, dict):
            user_edits = {}
        current_steps: list[dict[str, object]] = load_scenario_steps(row.steps_json)

        if title is not None:
            row.title = title[:255]
            user_edits["title"] = title
        if description is not None:
            row.description = description
            user_edits["description"] = description
        if steps is not None:
            by_id = {s.get("id"): s for s in current_steps if isinstance(s.get("id"), str)}
            merged: list[dict[str, object]] = []
            step_fields = user_edits.get("stepFields")
            if not isinstance(step_fields, dict):
                step_fields = {}
                user_edits["stepFields"] = step_fields
            for order, patch in enumerate(steps):
                sid = str(patch.get("id", ""))
                existing = by_id.get(sid)
                if existing is None:
                    raise ValueError(f"unknown step id: {sid}")
                updated = dict(existing)
                updated["order"] = order
                override = (
                    dict(step_fields.get(sid, {})) if isinstance(step_fields.get(sid), dict) else {}
                )
                if "_oldSpokenLine" not in override and isinstance(existing.get("spokenLine"), str):
                    override["_oldSpokenLine"] = existing.get("spokenLine")
                if patch.get("partTag") is not None:
                    tag = patch["partTag"]
                    if tag not in ("intro", "middle", "outro"):
                        raise ValueError("partTag must be intro, middle, or outro")
                    updated["partTag"] = tag
                    override["partTag"] = tag
                for field in ("spokenLine", "onScreenAction"):
                    if patch.get(field) is not None:
                        updated[field] = patch[field]
                        override[field] = patch[field]
                if patch.get("assetHints") is not None:
                    hints = patch["assetHints"]
                    if not isinstance(hints, list) or any(not isinstance(h, str) for h in hints):
                        raise ValueError("assetHints must be a list of names")
                    updated["assetHints"] = [str(h) for h in hints]
                    override["assetHints"] = [str(h) for h in hints]
                if patch.get("estimatedDurationSec") is not None:
                    updated["estimatedDurationSec"] = patch["estimatedDurationSec"]
                    override["estimatedDurationSec"] = patch["estimatedDurationSec"]
                merged.append(updated)
                step_fields[sid] = override
            row.steps_json = _json.dumps(merged)
            user_edits["stepOrder"] = [str(p.get("id", "")) for p in steps]
        row.user_edits_json = _json.dumps(user_edits)
        # Author edits invalidate any prior acceptance: the edited version
        # must be re-accepted before Stage B may read it.
        row.status = "draft"
        row.updated_at = _now()
        session.commit()
    return get_scenario(database, scenario_id)


def set_scenario_status(database: Database, scenario_id: str, status: str) -> AiScenarioRow:
    if status not in ("draft", "accepted", "rejected"):
        raise ValueError("status must be draft, accepted, or rejected")
    with database.session() as session:
        row = session.get(AiScenarioRow, scenario_id)
        if row is None:
            raise KeyError(scenario_id)
        row.status = status
        row.updated_at = _now()
        session.commit()
    return get_scenario(database, scenario_id)


def get_scenario_user_edits(database: Database, scenario_id: str) -> dict[str, object]:
    import json as _json

    row = get_scenario(database, scenario_id)
    try:
        data: object = _json.loads(row.user_edits_json or "{}")
    except (ValueError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def require_accepted_scenario(database: Database, scenario_id: str) -> AiScenarioRow:
    """Stage B gate: downstream reconciliation reads only accepted versions."""
    row = get_scenario(database, scenario_id)
    if row.status != "accepted":
        raise ValueError(
            f"scenario {scenario_id} is {row.status} — "
            "accept it before reconciliation (Stage B reads only the accepted version)"
        )
    return row


def scenario_canonical_json(database: Database, scenario_id: str) -> dict[str, object]:
    """Canonical JSON of the accepted scenario version for Stage B handoff."""
    import json as _json

    row = require_accepted_scenario(database, scenario_id)
    try:
        steps: object = _json.loads(row.steps_json or "[]")
    except (ValueError, TypeError):
        steps = []
    return {
        "id": row.id,
        "projectId": row.project_id,
        "conversationId": row.conversation_id,
        "title": row.title,
        "description": row.description,
        "status": row.status,
        "steps": steps if isinstance(steps, list) else [],
    }
