"""Scenario request route cluster seam (issue #460 prefactor).

Small owner for the scenario HTTP surface. Markdown versioned edits
(issue #462) live here plus the `scenario_versions` persistence owner,
without edits inside the current god owner (`app/api/ai.py`).
"""

from __future__ import annotations

import json as _json
import logging
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request

from app.ai.library import AiLibrary
from app.ai.zen import (
    ZenFetchError,
    inference_endpoint,
    inference_request,
    model_api_family,
    opencode_headers,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _iso(value: datetime) -> str:
    text = value.isoformat()
    return text if text.endswith("Z") else f"{text}Z"


def _inference_response_text(data: dict[str, Any]) -> str:
    # Verbatim copy of app.api.ai._inference_response_text (seam owner is
    # independent of the god owner; byte-identical by construction).
    if "output" in data:
        return "".join(
            part.get("text", "")
            for item in data.get("output", [])
            if item.get("type") == "message"
            for part in item.get("content", [])
        )
    if isinstance(data.get("content"), list):
        return "".join(part.get("text", "") for part in data["content"])
    if data.get("candidates"):
        return "".join(
            part.get("text", "")
            for part in data["candidates"][0].get("content", {}).get("parts", [])
        )
    choices = data.get("choices", [])
    if choices:
        content = choices[0].get("message", {}).get("content", "")
        return content if isinstance(content, str) else ""
    return ""


def _structured_inference_payload(
    *,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
    name: str,
    schema: dict[str, object],
) -> tuple[str, dict[str, object]]:
    # Verbatim copy of app.api.ai._structured_inference_payload.
    path, payload = inference_request(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=False,
    )
    family = model_api_family(model)
    if family == "anthropic":
        payload["output_config"] = {"format": {"type": "json_schema", "schema": schema}}
    elif family == "responses":
        payload["text"] = {"format": {"type": "json_schema", "name": name, "schema": schema}}
    else:
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": name, "schema": schema},
        }
    return path, payload


def generate_scenario_structured(
    *,
    endpoint: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
    session_id: str,
) -> dict[str, object]:
    """Call Zen chat/completions with an Action Scenario JSON schema. Mock seam for tests."""
    from app.ai.scenarios import SCENARIO_JSON_SCHEMA

    path, payload = _structured_inference_payload(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        name="action_scenario",
        schema=SCENARIO_JSON_SCHEMA,
    )
    try:
        response = httpx.post(
            f"{inference_endpoint(endpoint)}{path}",
            headers=opencode_headers(api_key, session_id),
            json=payload,
            timeout=60.0,
        )
    except httpx.HTTPError as exc:
        raise ZenFetchError(0, str(exc)) from exc
    if response.status_code != 200:
        raise ZenFetchError(response.status_code, response.text)
    try:
        data = response.json()
        content = _inference_response_text(data)
        if not isinstance(content, str) or not content.strip():
            raise TypeError("empty scenario content")
        parsed: object = _json.loads(content)
        if not isinstance(parsed, dict):
            raise TypeError("scenario content is not an object")
        return parsed
    except ZenFetchError:
        raise
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        raise ZenFetchError(0, f"malformed scenario content: {exc}") from exc


def scenario_to_out(library: AiLibrary, scenario_id: str) -> dict[str, object]:
    row = library.get_scenario(scenario_id)
    try:
        loaded_steps: object = _json.loads(row.steps_json or "[]")
        steps = loaded_steps if isinstance(loaded_steps, list) else []
    except (ValueError, TypeError):
        steps = []
    revisions = []
    for rev in library.list_scenario_revisions(scenario_id):
        revisions.append(
            {
                "id": rev.id,
                "sourceRequest": rev.source_request,
                "created": _iso(rev.created_at),
            }
        )
    try:
        loaded_edits: object = _json.loads(row.user_edits_json or "{}")
        user_edits = loaded_edits if isinstance(loaded_edits, dict) else {}
    except (ValueError, TypeError):
        user_edits = {}
    return {
        "id": row.id,
        "projectId": row.project_id,
        "conversationId": row.conversation_id,
        "title": row.title,
        "description": row.description,
        "status": row.status,
        "steps": steps,
        "revisions": revisions,
        "userEdits": user_edits if isinstance(user_edits, dict) else {},
        "created": _iso(row.created_at),
        "modified": _iso(row.updated_at),
    }


def list_scenario_summaries(library: AiLibrary, project_id: str) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for row in library.list_scenarios(project_id):
        try:
            loaded: object = _json.loads(row.steps_json or "[]")
            count = len(loaded) if isinstance(loaded, list) else 0
        except (ValueError, TypeError):
            count = 0
        out.append(
            {
                "id": row.id,
                "projectId": row.project_id,
                "conversationId": row.conversation_id,
                "title": row.title,
                "status": row.status,
                "stepCount": count,
                "modified": _iso(row.updated_at),
            }
        )
    return out


# -- markdown versioned edits (issue #462) ---------------------------------
# Conversation versioned iteration: every scenario-assistant reply declares
# itself edit vs question-only; edit replies auto-apply as a new version.
# Proposal gates are bypassed (revertible text), but every apply records an
# audit entry. Concurrency is last-writer-wins.


def _library(request: Request) -> AiLibrary:
    library = getattr(request.app.state, "ai_library", None)
    if library is None:
        raise HTTPException(status_code=500, detail="AI library is not configured")
    return library  # type: ignore[no-any-return]


def _markdown_version_to_out(row: object) -> dict[str, object]:
    from app.ai import scenario_versions as versions

    return versions.version_to_out(row)


def _require_conversation_in_project(
    library: AiLibrary, conversation_id: str, project_id: str
) -> None:
    try:
        conv = library.get_conversation(conversation_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    if conv.project_id != project_id:
        raise HTTPException(status_code=422, detail="conversation does not belong to this project")


@router.post("/ai/scenarios/markdown/apply", status_code=200)
def apply_scenario_markdown(request: Request, body: dict[str, Any]) -> dict[str, object]:
    """Classify an assistant reply and auto-apply it as a new version when edit.

    Body: `{projectId, conversationId, messageId?, userText, assistantText}`.
    - `ask:` prefix forces question-only (no version).
    - `edit:` prefix forces edit (new version).
    - Otherwise the assistant self-label wins; unlabelled `## Step` replies
      read as edit, all else as question-only.
    - Mixed replies apply the edit part and keep the question as chat text.
    Returns `{intent, version?, questionText?, audit?}` where `version` owns
    its summary, touched steps, timestamp, and content.
    """
    from app.ai import scenario_versions as versions
    from app.ai.schemas import AiScenarioMarkdownApply

    try:
        parsed = AiScenarioMarkdownApply.model_validate(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    library = _library(request)
    _require_conversation_in_project(library, parsed.conversationId, parsed.projectId)
    resolution = versions.parse_assistant_reply(parsed.userText or "", parsed.assistantText)
    intent = str(resolution.get("intent", "question-only"))
    if intent != "edit":
        # Pure question: link the message as question-only, create no version.
        if parsed.messageId:
            try:
                versions.link_message_question(
                    library._database,
                    message_id=parsed.messageId,
                    question_text=str(resolution.get("question_text") or ""),
                )
            except KeyError:
                pass
        return {
            "intent": "question-only",
            "version": None,
            "questionText": resolution.get("question_text"),
            "audit": None,
        }
    edit_content = str(resolution.get("edit_content") or "").strip()
    if not edit_content:
        raise HTTPException(status_code=422, detail="edit reply carries no markdown content")
    summary = str(resolution.get("summary") or "Scenario edit")
    touched = resolution.get("touched_steps")
    touched_steps = [int(n) for n in touched] if isinstance(touched, list) else []
    try:
        row = library.create_markdown_version(
            project_id=parsed.projectId,
            conversation_id=parsed.conversationId,
            content=edit_content,
            summary=summary,
            touched_steps=touched_steps,
            message_id=parsed.messageId,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    audits = library.list_markdown_audits(parsed.projectId)
    audit = next(
        (
            versions.audit_to_out(a)
            for a in audits
            if str(getattr(a, "version_id", "")) == str(getattr(row, "id", ""))
        ),
        None,
    )
    return {
        "intent": "edit",
        "version": _markdown_version_to_out(row),
        "questionText": resolution.get("question_text"),
        "audit": audit,
    }


@router.post("/ai/scenarios/markdown/versions", status_code=201)
def create_scenario_markdown_version(request: Request, body: dict[str, Any]) -> dict[str, object]:
    from app.ai.schemas import AiScenarioMarkdownVersionCreate

    try:
        parsed = AiScenarioMarkdownVersionCreate.model_validate(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    library = _library(request)
    _require_conversation_in_project(library, parsed.conversationId, parsed.projectId)
    try:
        row = library.create_markdown_version(
            project_id=parsed.projectId,
            conversation_id=parsed.conversationId,
            content=parsed.content,
            summary=parsed.summary,
            touched_steps=list(parsed.touchedSteps or []),
            message_id=parsed.messageId,
            base_version_id=parsed.baseVersionId,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _markdown_version_to_out(row)


@router.get("/ai/scenarios/markdown/versions")
def list_scenario_markdown_versions(
    request: Request, projectId: str = "", conversationId: str | None = None
) -> list[dict[str, object]]:
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    if conversationId:
        _require_conversation_in_project(library, conversationId, projectId)
    rows = library.list_markdown_versions(projectId, conversationId)
    return [_markdown_version_to_out(row) for row in rows]


@router.delete("/ai/scenarios/markdown/versions", status_code=204)
def delete_scenario_markdown_versions(request: Request, projectId: str = "") -> None:
    """Clean slate: drop every version, audit, and active/accepted pointer
    for the project. The client also clears its portable doc copy."""
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    library.delete_markdown_versions_for_project(projectId.strip())


@router.get("/ai/scenarios/markdown/versions/{version_id}")
def get_scenario_markdown_version(
    request: Request, version_id: str, projectId: str = ""
) -> dict[str, object]:
    from app.ai import scenario_versions as versions

    library = _library(request)
    try:
        row = library.get_markdown_version(version_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="version not found") from exc
    out = _markdown_version_to_out(row)
    if projectId.strip() and str(out.get("projectId", "")) != projectId.strip():
        raise HTTPException(status_code=422, detail="version does not belong to this project")
    # Diff payload against the previous ordered version (line-or-block diff).
    ordered = library.list_markdown_versions(str(out.get("projectId", "")))
    ids = [str(getattr(r, "id", "")) for r in ordered]
    previous_content = ""
    if version_id in ids and ids.index(version_id) > 0:
        previous_content = str(getattr(ordered[ids.index(version_id) - 1], "content", "") or "")
    out["diffFromPrevious"] = versions.diff_markdown_lines(
        previous_content, str(out.get("content", ""))
    )
    return out


@router.post("/ai/scenarios/markdown/versions/{version_id}/restore", status_code=201)
def restore_scenario_markdown_version(
    request: Request, version_id: str, body: dict[str, Any]
) -> dict[str, object]:
    from app.ai.schemas import AiScenarioMarkdownRestore

    try:
        parsed = AiScenarioMarkdownRestore.model_validate(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    library = _library(request)
    _require_conversation_in_project(library, parsed.conversationId, parsed.projectId)
    try:
        row = library.restore_markdown_version(
            version_id=version_id,
            project_id=parsed.projectId,
            conversation_id=parsed.conversationId,
            message_id=parsed.messageId,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="version not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out = _markdown_version_to_out(row)
    # Restore never rewrites history and never touches the engine Undo Stack:
    # it appends a copy-forward version and moves only the per-project active
    # pointer (last-writer-wins).
    return out


@router.get("/ai/scenarios/markdown/active")
def get_active_scenario_markdown(request: Request, projectId: str = "") -> dict[str, object]:
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    active_id = library.get_active_markdown_version_id(projectId)
    accepted_id = library.get_accepted_markdown_version_id(projectId)
    accepted_version: dict[str, object] | None = None
    if accepted_id:
        try:
            accepted_version = _markdown_version_to_out(library.get_markdown_version(accepted_id))
        except KeyError:
            accepted_id = None
    if not active_id:
        return {
            "projectId": projectId,
            "activeVersionId": None,
            "version": None,
            "acceptedVersionId": accepted_id,
            "acceptedVersion": accepted_version,
        }
    try:
        row = library.get_markdown_version(active_id)
    except KeyError:
        return {
            "projectId": projectId,
            "activeVersionId": None,
            "version": None,
            "acceptedVersionId": accepted_id,
            "acceptedVersion": accepted_version,
        }
    return {
        "projectId": projectId,
        "activeVersionId": active_id,
        "version": _markdown_version_to_out(row),
        # Accepted snapshot rides alongside the active draft so downstream
        # readers can tell stable from latest without a second round-trip.
        "acceptedVersionId": accepted_id,
        "acceptedVersion": accepted_version,
    }


@router.post("/ai/scenarios/markdown/accept", status_code=200)
def accept_scenario_markdown(request: Request, body: dict[str, Any]) -> dict[str, object]:
    """Mark a version as the accepted downstream snapshot (issue #466).

    Body: `{projectId, versionId, conversationId?, messageId?}`.
    The accepted snapshot is stable: later draft writes never move it.
    Downstream reconciliation reads it via `GET .../markdown/canonical`;
    without an accepted version that gate refuses with 409 instead of
    silently ignoring newer drafts or consuming unreviewed edits.
    """
    from app.ai.schemas import AiScenarioMarkdownAccept

    try:
        parsed = AiScenarioMarkdownAccept.model_validate(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    library = _library(request)
    try:
        row = library.accept_markdown_version(
            project_id=parsed.projectId,
            version_id=parsed.versionId,
            conversation_id=parsed.conversationId,
            message_id=parsed.messageId,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="version not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "projectId": parsed.projectId,
        "acceptedVersionId": str(getattr(row, "id", "")),
        "version": _markdown_version_to_out(row),
    }


@router.get("/ai/scenarios/markdown/accepted")
def get_accepted_scenario_markdown(request: Request, projectId: str = "") -> dict[str, object]:
    """Accepted downstream snapshot, or nulls when nothing is accepted yet."""
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    accepted_id = library.get_accepted_markdown_version_id(projectId)
    if not accepted_id:
        return {"projectId": projectId, "acceptedVersionId": None, "version": None}
    try:
        row = library.get_markdown_version(accepted_id)
    except KeyError:
        return {"projectId": projectId, "acceptedVersionId": None, "version": None}
    return {
        "projectId": projectId,
        "acceptedVersionId": accepted_id,
        "version": _markdown_version_to_out(row),
    }


@router.get("/ai/scenarios/markdown/canonical")
def get_scenario_markdown_canonical(request: Request, projectId: str = "") -> dict[str, object]:
    """Stable downstream snapshot for later assistants (issue #466).

    Reads only the accepted version. Refuses with 409 when nothing is
    accepted so callers block instead of freezing on stale active content
    or chasing every draft keystroke.
    """
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    try:
        row = library.require_accepted_markdown_version(projectId)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    out = _markdown_version_to_out(row)
    return {
        "projectId": projectId,
        "acceptedVersionId": out.get("id"),
        "version": out,
        "content": out.get("content", ""),
        "summary": out.get("summary", ""),
        "touchedSteps": out.get("touchedSteps", []),
        "timestamp": out.get("timestamp", ""),
    }


@router.get("/ai/scenarios/markdown/audits")
def list_scenario_markdown_audits(request: Request, projectId: str = "") -> list[dict[str, object]]:
    from app.ai import scenario_versions as versions

    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    return [versions.audit_to_out(row) for row in library.list_markdown_audits(projectId)]
