"""Conversation versioned edits seam (issue #462).

Small owner for scenario-markdown versioning: pure intent/summary parsing,
line diff, plus persistence for version records, per-project active pointer,
per-message version links, and the proposal-bypass audit trail.

Conversation update rules (from #459 decision):
- Model self-labels every scenario-assistant reply as edit vs question-only.
- Any reply with markdown change intent auto-applies as a new version;
  pure questions leave the doc untouched.
- Explicit user prefixes override the label: leading `ask:` forces
  question-only, leading `edit:` forces edit.
- Mixed replies apply the edit part and keep the question as chat text.
- Each doc-touching reply carries a one-line summary plus touched step
  numbers, stored on the version record and linked from the message.
- Versions are append-only and unbounded; restore copies forward, never
  rewrites history.
- Markdown edits never touch the engine Undo Stack (no Command, no
  dispatcher.record).
- Proposal gates are bypassed entirely for markdown iteration; the apply
  path records an audit entry carrying version id, summary, touched steps,
  and timestamp.

Concurrency rule: last-writer-wins. No version check is performed: a create
or restore unconditionally becomes the new active version for the project.
Rationale: doc writes are revertible text, and every write is itself a new
append-only version, so a lost update is recoverable via History restore.

Storage split (per #459 invariant amendment):
- The doc plus its history travel with the project in the portable `.lesson`
  file (frontend `ScenarioSectionJSON`).
- Per-message version links live server-side with the project-scoped
  Conversation and never in the portable file. This module owns those
  server-side rows; cascade on Conversation and project delete.
- The active pointer is per-project.
"""

from __future__ import annotations

import json as _json
import re
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, select

from app.database import Database

# -- pure parsing ----------------------------------------------------------


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


_ASK_PREFIX_RE = re.compile(r"^\s*ask\s*:", re.IGNORECASE)
_EDIT_PREFIX_RE = re.compile(r"^\s*edit\s*:", re.IGNORECASE)
_INTENT_EDIT_RE = re.compile(r"intent\s*:\s*edit\b", re.IGNORECASE)
_INTENT_QUESTION_RE = re.compile(r"intent\s*:\s*question(?:-only)?\b", re.IGNORECASE)
_TAG_EDIT_RE = re.compile(r"\[\s*edit\s*\]", re.IGNORECASE)
_TAG_QUESTION_RE = re.compile(r"\[\s*question(?:-only)?\s*\]", re.IGNORECASE)
_SUMMARY_RE = re.compile(r"^\s*summary\s*:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
_TOUCHED_RE = re.compile(
    r"^\s*(?:touched(?:-steps)?|steps)\s*:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE
)
_QUESTION_HEADER_RE = re.compile(r"^\s*question\s*:\s*(.*)$", re.IGNORECASE)
_STEP_HEADING_RE = re.compile(r"^##\s+Step\s+(\d+)\b", re.IGNORECASE | re.MULTILINE)
_METADATA_LINE_RE = re.compile(
    r"^\s*(?:intent\s*:|summary\s*:|touched(?:-steps)?\s*:|steps\s*:)\s*.*$",
    re.IGNORECASE,
)


def parse_user_prefix(text: str) -> str | None:
    """Leading `ask:` forces question-only, `edit:` forces edit."""
    if _ASK_PREFIX_RE.match(text or ""):
        return "ask"
    if _EDIT_PREFIX_RE.match(text or ""):
        return "edit"
    return None


def parse_intent_label(assistant_text: str) -> str | None:
    """Self-label declared by the model: edit vs question-only.

    Accepts `intent: edit`, `intent: question` / `intent: question-only`,
    `[edit]`, `[question]`, including inside `<!-- -->` comments. Scans the
    full reply (labels may trail the markdown) but prefers the first hit.
    """
    text = assistant_text or ""
    # Find first occurrence of either label in document order.
    edit_at = -1
    question_at = -1
    for pattern in (_INTENT_EDIT_RE, _TAG_EDIT_RE):
        match = pattern.search(text)
        if match and (edit_at == -1 or match.start() < edit_at):
            edit_at = match.start()
    for pattern in (_INTENT_QUESTION_RE, _TAG_QUESTION_RE):
        match = pattern.search(text)
        if match and (question_at == -1 or match.start() < question_at):
            question_at = match.start()
    if edit_at != -1 and question_at != -1:
        return "edit" if edit_at < question_at else "question-only"
    if edit_at != -1:
        return "edit"
    if question_at != -1:
        return "question-only"
    return None


def classify_scenario_intent(user_text: str, assistant_text: str) -> str:
    """Edit vs question-only with explicit prefix override.

    - `ask:` prefix forces question-only even when the reply is labelled edit.
    - `edit:` prefix forces edit even when the reply is labelled question.
    - Otherwise the assistant self-label wins.
    - Unlabelled replies infer from content: a `## Step` heading means edit.
    """
    prefix = parse_user_prefix(user_text or "")
    if prefix == "ask":
        return "question-only"
    if prefix == "edit":
        return "edit"
    label = parse_intent_label(assistant_text or "")
    if label in ("edit", "question-only"):
        return label
    if _STEP_HEADING_RE.search(assistant_text or ""):
        return "edit"
    return "question-only"


def parse_summary(assistant_text: str) -> str | None:
    """One-line summary from a `Summary: ...` line, if present."""
    match = _SUMMARY_RE.search(assistant_text or "")
    if not match:
        return None
    summary = match.group(1).strip()
    return summary or None


def parse_touched_steps(assistant_text: str) -> list[int]:
    """Touched step numbers from a `Touched-steps: 1, 2` style line."""
    match = _TOUCHED_RE.search(assistant_text or "")
    if not match:
        return []
    raw = match.group(1)
    out: list[int] = []
    for token in re.split(r"[\s,;]+", raw.strip()):
        if not token:
            continue
        # Support ranges like 1-3.
        range_match = re.match(r"^(\d+)-(\d+)$", token)
        if range_match:
            start, end = int(range_match.group(1)), int(range_match.group(2))
            step = 1 if end >= start else -1
            for num in range(start, end + step, step):
                if num > 0 and num not in out:
                    out.append(num)
            continue
        if re.match(r"^\d+$", token):
            num = int(token)
            if num > 0 and num not in out:
                out.append(num)
    return out


def touched_steps_from_markdown(markdown: str) -> list[int]:
    """Fallback touched steps derived from `## Step N` headings in order."""
    seen: list[int] = []
    for match in _STEP_HEADING_RE.finditer(markdown or ""):
        num = int(match.group(1))
        if num not in seen:
            seen.append(num)
    return seen


def extract_question_text(assistant_text: str) -> str | None:
    """Question part of a mixed reply (text after a `Question:` header)."""
    lines = (assistant_text or "").split("\n")
    for index, line in enumerate(lines):
        match = _QUESTION_HEADER_RE.match(line.strip())
        if match:
            head = match.group(1).strip()
            tail = "\n".join(lines[index + 1 :]).strip()
            combined = f"{head}\n{tail}".strip() if head else tail
            return combined or None
    return None


def extract_edit_content(assistant_text: str) -> str:
    """Markdown edit part: strip metadata lines and the question section."""
    lines = (assistant_text or "").split("\n")
    kept: list[str] = []
    for line in lines:
        if _QUESTION_HEADER_RE.match(line.strip()):
            break
        if _METADATA_LINE_RE.match(line):
            continue
        # Strip bare intent tags that ride their own line.
        stripped = line.strip()
        if stripped.lower() in ("[edit]", "[question]", "[question-only]"):
            continue
        kept.append(line)
    # Remove leading/trailing blank lines left by stripped metadata.
    text = "\n".join(kept).strip()
    # Drop an HTML-comment intent line anywhere (`<!-- intent: edit -->`).
    text = re.sub(r"<!--\s*intent\s*:\s*(?:edit|question(?:-only)?)\s*-->", "", text)
    text = re.sub(r"\[\s*(?:edit|question(?:-only)?)\s*\]", "", text)
    return text.strip()


def parse_assistant_reply(user_text: str, assistant_text: str) -> dict[str, object]:
    """Classify and split an assistant reply per the conversation rules.

    Returns `{intent, summary, touched_steps, edit_content, question_text}`.
    - question-only: no version; `edit_content` is "" and `question_text` is
      the full reply minus its intent label.
    - edit: `edit_content` is the new full markdown (replace semantics),
      `question_text` is the trailing question when mixed, else None.
    - `summary` falls back to the first edit line (max 120 chars) when the
      model omits the `Summary:` line; `touched_steps` falls back to the
      `## Step N` headings found in the edit content.
    """
    intent = classify_scenario_intent(user_text or "", assistant_text or "")
    question_text = extract_question_text(assistant_text or "")
    if intent == "question-only":
        # Pure question: everything stays as chat text.
        content = extract_edit_content(assistant_text or "")
        chat_text = question_text or content or (assistant_text or "").strip()
        return {
            "intent": intent,
            "summary": None,
            "touched_steps": [],
            "edit_content": "",
            "question_text": chat_text or None,
        }
    edit_content = extract_edit_content(assistant_text or "")
    summary = parse_summary(assistant_text or "")
    if not summary:
        first_line = next((ln.strip() for ln in edit_content.split("\n") if ln.strip()), "")
        summary = first_line[:120] if first_line else "Scenario edit"
    touched = parse_touched_steps(assistant_text or "")
    if not touched:
        touched = touched_steps_from_markdown(edit_content)
    return {
        "intent": intent,
        "summary": summary,
        "touched_steps": touched,
        "edit_content": edit_content,
        "question_text": question_text,
    }


def build_restore_summary(source_summary: str, source_id: str) -> str:
    """One-line summary for a restore-as-new-version copy."""
    short = (source_id or "")[:8]
    base = (source_summary or "").strip() or "version"
    return f"Restore {short}: {base}"[:200]


def diff_markdown_lines(old: str, new: str) -> list[dict[str, object]]:
    """Line-or-block diff between two markdown docs (pure, no I/O).

    Minimal prefix/suffix trim: shared head and tail lines are `same`, the
    middle block is `del` (old-only) then `add` (new-only). Empty docs diff
    to a single add/del block. Line numbers are 1-based into each side.
    """
    old_lines = (old or "").split("\n")
    new_lines = (new or "").split("\n")
    if old == new:
        return [
            {"type": "same", "line": text, "oldLineNo": i + 1, "newLineNo": i + 1}
            for i, text in enumerate(old_lines)
        ]
    head = 0
    while head < len(old_lines) and head < len(new_lines) and old_lines[head] == new_lines[head]:
        head += 1
    tail = 0
    while (
        tail < (len(old_lines) - head)
        and tail < (len(new_lines) - head)
        and old_lines[len(old_lines) - 1 - tail] == new_lines[len(new_lines) - 1 - tail]
    ):
        tail += 1
    out: list[dict[str, object]] = []
    for i in range(head):
        out.append({"type": "same", "line": old_lines[i], "oldLineNo": i + 1, "newLineNo": i + 1})
    for i in range(head, len(old_lines) - tail):
        out.append({"type": "del", "line": old_lines[i], "oldLineNo": i + 1, "newLineNo": None})
    for i in range(head, len(new_lines) - tail):
        out.append({"type": "add", "line": new_lines[i], "oldLineNo": None, "newLineNo": i + 1})
    for offset in range(tail):
        old_no = len(old_lines) - tail + offset + 1
        new_no = len(new_lines) - tail + offset + 1
        out.append(
            {
                "type": "same",
                "line": old_lines[len(old_lines) - tail + offset],
                "oldLineNo": old_no,
                "newLineNo": new_no,
            }
        )
    return out


# -- persistence -----------------------------------------------------------

CONCURRENCY_RULE = "last-writer-wins"


def _version_to_dict(row: object) -> dict[str, object]:
    get = getattr
    touched: list[int] = []
    try:
        raw = get(row, "touched_steps_json", "[]")
        loaded: object = _json.loads(raw or "[]")
        if isinstance(loaded, list):
            touched = [int(n) for n in loaded if isinstance(n, (int, float)) and int(n) > 0]
    except (ValueError, TypeError):
        touched = []
    created = get(row, "created_at", None)
    timestamp = ""
    try:
        timestamp = created.isoformat() + "Z" if created is not None else ""
    except AttributeError:
        timestamp = ""
    return {
        "id": str(get(row, "id", "")),
        "projectId": str(get(row, "project_id", "")),
        "conversationId": str(get(row, "conversation_id", "")),
        "messageId": get(row, "message_id", None),
        "summary": str(get(row, "summary", "")),
        "touchedSteps": touched,
        "timestamp": timestamp,
        "content": str(get(row, "content", "")),
        "baseVersionId": get(row, "base_version_id", None),
    }


def list_markdown_versions(
    database: Database, project_id: str, conversation_id: str | None = None
) -> list[object]:
    from app.ai.model import AiScenarioMarkdownVersionRow

    statement = (
        select(AiScenarioMarkdownVersionRow)
        .where(AiScenarioMarkdownVersionRow.project_id == project_id)
        .order_by(AiScenarioMarkdownVersionRow.created_at.asc(), AiScenarioMarkdownVersionRow.id)
    )
    if conversation_id:
        statement = statement.where(AiScenarioMarkdownVersionRow.conversation_id == conversation_id)
    with database.session() as session:
        return list(session.scalars(statement))


def get_markdown_version(database: Database, version_id: str) -> object:
    from app.ai.model import AiScenarioMarkdownVersionRow

    with database.session() as session:
        row = session.get(AiScenarioMarkdownVersionRow, version_id)
    if row is None:
        raise KeyError(version_id)
    return row


def get_active_markdown_version_id(database: Database, project_id: str) -> str | None:
    from app.ai.model import AiScenarioMarkdownPointerRow

    with database.session() as session:
        row = session.get(AiScenarioMarkdownPointerRow, project_id)
        return str(row.active_version_id) if row and row.active_version_id else None


def get_accepted_markdown_version_id(database: Database, project_id: str) -> str | None:
    """Per-project accepted snapshot id (issue #466).

    The accepted snapshot is the stable downstream read: set only by
    explicit accept, never moving on draft writes. Newer drafts never
    move it, so downstream never silently ignores drafts nor consumes
    unreviewed edits.
    """
    from app.ai.model import AiScenarioMarkdownPointerRow

    with database.session() as session:
        row = session.get(AiScenarioMarkdownPointerRow, project_id)
        accepted = getattr(row, "accepted_version_id", None) if row else None
        return str(accepted) if accepted else None


def get_accepted_markdown_version(database: Database, project_id: str) -> object | None:
    """Accepted version row, or None when no version is accepted yet."""
    accepted_id = get_accepted_markdown_version_id(database, project_id)
    if not accepted_id:
        return None
    try:
        return get_markdown_version(database, accepted_id)
    except KeyError:
        return None


def require_accepted_markdown_version(database: Database, project_id: str) -> object:
    """Downstream gate: later assistants read only the accepted snapshot.

    Raises ValueError when nothing is accepted, so callers refuse to run
    on a stale active draft or on unreviewed keystrokes instead of
    silently ignoring newer drafts.
    """
    row = get_accepted_markdown_version(database, project_id)
    if row is None:
        raise ValueError(
            f"project {project_id} has no accepted scenario version — "
            "accept a version before downstream reconciliation"
        )
    return row


def accept_markdown_version(
    database: Database,
    *,
    project_id: str,
    version_id: str,
    conversation_id: str | None = None,
    message_id: str | None = None,
) -> object:
    """Mark a version as the accepted downstream snapshot.

    The version must belong to the project; the active draft pointer is
    untouched (accepting does not rewrite the doc). Records a
    `markdown-version-accept` audit entry with the same last-writer-wins
    concurrency as applies.
    """
    from app.ai.model import (
        AiScenarioMarkdownAuditRow,
        AiScenarioMarkdownPointerRow,
    )

    source = get_markdown_version(database, version_id)
    get = getattr
    if str(get(source, "project_id", "")) != project_id:
        raise ValueError("version does not belong to this project")
    summary = str(get(source, "summary", "") or "Scenario edit")
    touched: list[int] = []
    try:
        loaded: object = _json.loads(get(source, "touched_steps_json", "[]") or "[]")
        if isinstance(loaded, list):
            touched = [int(n) for n in loaded if isinstance(n, (int, float)) and int(n) > 0]
    except (ValueError, TypeError):
        touched = []
    now = _now()
    with database.session() as session:
        pointer = session.get(AiScenarioMarkdownPointerRow, project_id)
        if pointer is None:
            pointer = AiScenarioMarkdownPointerRow(
                project_id=project_id,
                active_version_id=str(get(source, "id", "")),
                accepted_version_id=str(get(source, "id", "")),
                updated_at=now,
            )
            session.add(pointer)
        else:
            pointer.accepted_version_id = str(get(source, "id", ""))
            pointer.updated_at = now
        session.add(
            AiScenarioMarkdownAuditRow(
                id=str(uuid4()),
                project_id=project_id,
                conversation_id=conversation_id or str(get(source, "conversation_id", "")),
                message_id=message_id,
                version_id=str(get(source, "id", "")),
                summary=summary[:200],
                touched_steps_json=_json.dumps(touched),
                created_at=now,
                operation="markdown-version-accept",
                concurrency=CONCURRENCY_RULE,
            )
        )
        session.commit()
    return get_markdown_version(database, version_id)


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
    """Append a new version; link the message; move the per-project pointer.

    Last-writer-wins: no version check, the new row unconditionally becomes
    active. Records the proposal-bypass audit entry in the same transaction.
    """
    from app.ai.model import (
        AiConversationRow,
        AiMessageRow,
        AiScenarioMarkdownAuditRow,
        AiScenarioMarkdownPointerRow,
        AiScenarioMarkdownVersionRow,
    )

    if not content.strip():
        raise ValueError("version content must be a non-empty string")
    clean_summary = summary.strip() or "Scenario edit"
    clean_touched = [int(n) for n in (touched_steps or []) if int(n) > 0]
    now = _now()
    version_id = str(uuid4())
    with database.session() as session:
        conv_check = session.get(AiConversationRow, conversation_id)
        if conv_check is None:
            raise KeyError(conversation_id)
        row = AiScenarioMarkdownVersionRow(
            id=version_id,
            project_id=project_id,
            conversation_id=conversation_id,
            message_id=message_id,
            summary=clean_summary[:200],
            touched_steps_json=_json.dumps(clean_touched),
            content=content,
            base_version_id=base_version_id,
            created_at=now,
        )
        session.add(row)
        session.add(
            AiScenarioMarkdownAuditRow(
                id=str(uuid4()),
                project_id=project_id,
                conversation_id=conversation_id,
                message_id=message_id,
                version_id=version_id,
                summary=clean_summary[:200],
                touched_steps_json=_json.dumps(clean_touched),
                created_at=now,
                operation="markdown-version-apply",
                concurrency=CONCURRENCY_RULE,
            )
        )
        pointer = session.get(AiScenarioMarkdownPointerRow, project_id)
        if pointer is None:
            pointer = AiScenarioMarkdownPointerRow(
                project_id=project_id, active_version_id=version_id, updated_at=now
            )
            session.add(pointer)
        else:
            pointer.active_version_id = version_id
            pointer.updated_at = now
        if message_id:
            message = session.get(AiMessageRow, message_id)
            if message is not None:
                message.scenario_intent = "edit"
                message.scenario_version_id = version_id
                message.scenario_summary = clean_summary[:200]
                message.scenario_touched_steps_json = _json.dumps(clean_touched)
        session.commit()
    return get_markdown_version(database, version_id)


def link_message_question(
    database: Database, *, message_id: str, question_text: str | None = None
) -> None:
    """Mark an assistant message as question-only without creating a version."""
    from app.ai.model import AiMessageRow

    with database.session() as session:
        message = session.get(AiMessageRow, message_id)
        if message is None:
            raise KeyError(message_id)
        message.scenario_intent = "question-only"
        message.scenario_version_id = None
        message.scenario_summary = None
        message.scenario_touched_steps_json = _json.dumps([])
        session.commit()


def restore_markdown_version(
    database: Database,
    *,
    version_id: str,
    project_id: str,
    conversation_id: str,
    message_id: str | None = None,
) -> object:
    """Restore-as-new-version: copy prior content forward, never rewrite."""
    source = get_markdown_version(database, version_id)
    get = getattr
    if str(get(source, "project_id", "")) != project_id:
        raise ValueError("version does not belong to this project")
    summary = build_restore_summary(str(get(source, "summary", "")), str(get(source, "id", "")))
    touched: list[int] = []
    try:
        loaded: object = _json.loads(get(source, "touched_steps_json", "[]") or "[]")
        if isinstance(loaded, list):
            touched = [int(n) for n in loaded if isinstance(n, (int, float))]
    except (ValueError, TypeError):
        touched = []
    return create_markdown_version(
        database,
        project_id=project_id,
        conversation_id=conversation_id,
        content=str(get(source, "content", "")),
        summary=summary,
        touched_steps=touched,
        message_id=message_id,
        base_version_id=str(get(source, "id", "")),
    )


def list_markdown_audits(database: Database, project_id: str) -> list[object]:
    from app.ai.model import AiScenarioMarkdownAuditRow

    statement = (
        select(AiScenarioMarkdownAuditRow)
        .where(AiScenarioMarkdownAuditRow.project_id == project_id)
        .order_by(AiScenarioMarkdownAuditRow.created_at.asc(), AiScenarioMarkdownAuditRow.id)
    )
    with database.session() as session:
        return list(session.scalars(statement))


def delete_versions_for_conversation(database: Database, conversation_id: str) -> None:
    from app.ai.model import (
        AiScenarioMarkdownAuditRow,
        AiScenarioMarkdownPointerRow,
        AiScenarioMarkdownVersionRow,
    )

    with database.session() as session:
        # Collect doomed version ids before deleting so a per-project active
        # pointer dangling at a deleted version can be repointed (or cleared).
        doomed_ids = list(
            session.scalars(
                select(AiScenarioMarkdownVersionRow.id).where(
                    AiScenarioMarkdownVersionRow.conversation_id == conversation_id
                )
            )
        )
        doomed_projects = list(
            session.scalars(
                select(AiScenarioMarkdownVersionRow.project_id)
                .where(AiScenarioMarkdownVersionRow.conversation_id == conversation_id)
                .distinct()
            )
        )
        session.execute(
            delete(AiScenarioMarkdownVersionRow).where(
                AiScenarioMarkdownVersionRow.conversation_id == conversation_id
            )
        )
        session.execute(
            delete(AiScenarioMarkdownAuditRow).where(
                AiScenarioMarkdownAuditRow.conversation_id == conversation_id
            )
        )
        session.commit()
        # Repoint any dangling active/accepted pointers to the newest
        # remaining version, or clear them when the project has no versions
        # left. Draft writes never move the accepted snapshot, but deletes
        # must not leave it dangling at a removed version.
        for project_id in doomed_projects:
            pointer = session.get(AiScenarioMarkdownPointerRow, project_id)
            if pointer is None:
                continue
            needs_repoint = (
                pointer.active_version_id in doomed_ids
                or getattr(pointer, "accepted_version_id", None) in doomed_ids
            )
            if not needs_repoint:
                continue
            remaining = session.scalars(
                select(AiScenarioMarkdownVersionRow)
                .where(AiScenarioMarkdownVersionRow.project_id == project_id)
                .order_by(
                    AiScenarioMarkdownVersionRow.created_at.desc(),
                    AiScenarioMarkdownVersionRow.id,
                )
            ).first()
            if pointer.active_version_id in doomed_ids:
                pointer.active_version_id = remaining.id if remaining is not None else None
            if getattr(pointer, "accepted_version_id", None) in doomed_ids:
                # A deleted accepted snapshot can no longer gate downstream:
                # clear it so the gate blocks instead of reading a ghost.
                pointer.accepted_version_id = None
            pointer.updated_at = _now()
            session.commit()


def delete_versions_for_project(database: Database, project_id: str) -> None:
    from app.ai.model import (
        AiScenarioMarkdownAuditRow,
        AiScenarioMarkdownPointerRow,
        AiScenarioMarkdownVersionRow,
    )

    with database.session() as session:
        session.execute(
            delete(AiScenarioMarkdownVersionRow).where(
                AiScenarioMarkdownVersionRow.project_id == project_id
            )
        )
        session.execute(
            delete(AiScenarioMarkdownAuditRow).where(
                AiScenarioMarkdownAuditRow.project_id == project_id
            )
        )
        session.execute(
            delete(AiScenarioMarkdownPointerRow).where(
                AiScenarioMarkdownPointerRow.project_id == project_id
            )
        )
        session.commit()


def version_to_out(row: object) -> dict[str, object]:
    return _version_to_dict(row)


def audit_to_out(row: object) -> dict[str, object]:
    get = getattr
    touched: list[int] = []
    try:
        loaded: object = _json.loads(get(row, "touched_steps_json", "[]") or "[]")
        if isinstance(loaded, list):
            touched = [int(n) for n in loaded if isinstance(n, (int, float)) and int(n) > 0]
    except (ValueError, TypeError):
        touched = []
    created = get(row, "created_at", None)
    try:
        timestamp = created.isoformat() + "Z" if created is not None else ""
    except AttributeError:
        timestamp = ""
    return {
        "id": str(get(row, "id", "")),
        "projectId": str(get(row, "project_id", "")),
        "conversationId": str(get(row, "conversation_id", "")),
        "messageId": get(row, "message_id", None),
        "versionId": str(get(row, "version_id", "")),
        "summary": str(get(row, "summary", "")),
        "touchedSteps": touched,
        "timestamp": timestamp,
        "operation": str(get(row, "operation", "markdown-version-apply")),
        "concurrency": str(get(row, "concurrency", CONCURRENCY_RULE)),
    }
