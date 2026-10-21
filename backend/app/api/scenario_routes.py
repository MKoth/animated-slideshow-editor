"""Scenario request route cluster seam (issue #460 prefactor).

Small owner for the scenario HTTP surface. Markdown versioned edits
(issue #462) live here plus the `scenario_versions` persistence owner,
without edits inside the current god owner (`app/api/ai.py`).
"""

from __future__ import annotations

import json as _json
import logging
import re
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request

from app.ai.library import AiLibrary
from app.ai.zen import (
    ZenFetchError,
    friendly_error_for_status,
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
    # Responses-family non-streaming bodies carry a top-level `output_text`
    # convenience string; structured and chat families nest text under
    # `output` / `content` / `candidates` / `choices`. Cover all of them so
    # a new envelope never silently reads as "no highlights".
    output_text = data.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text
    if isinstance(data.get("output"), list):
        parts: list[str] = []
        for item in data.get("output", []):
            if not isinstance(item, dict):
                continue
            if item.get("type") == "output_text" and isinstance(item.get("text"), str):
                parts.append(item["text"])
                continue
            content = item.get("content")
            if isinstance(content, list):
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    text = part.get("text")
                    if isinstance(text, str):
                        parts.append(text)
                    elif isinstance(text, dict) and isinstance(text.get("value"), str):
                        parts.append(text["value"])
            elif isinstance(content, str):
                parts.append(content)
        if parts:
            return "".join(parts)
    if isinstance(data.get("content"), list):
        return "".join(part.get("text", "") for part in data["content"] if isinstance(part, dict))
    if data.get("candidates"):
        try:
            return "".join(
                part.get("text", "")
                for part in data["candidates"][0].get("content", {}).get("parts", [])
                if isinstance(part, dict)
            )
        except (AttributeError, IndexError, TypeError):
            pass
    choices = data.get("choices", [])
    if choices:
        try:
            content = choices[0].get("message", {}).get("content", "")
        except AttributeError:
            content = ""
        if isinstance(content, str):
            return content
        # Some gateways return message content as parts.
        if isinstance(content, list):
            return "".join(part.get("text", "") for part in content if isinstance(part, dict))
        return ""
    if isinstance(data.get("message"), dict):
        message = data["message"]
        if isinstance(message, dict):
            message_content = message.get("content", "")
            if isinstance(message_content, str):
                return message_content
    text = data.get("text")
    if isinstance(text, str):
        return text
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


FOREIGN_WORDS_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {"words": {"type": "array", "items": {"type": "string"}}},
    "required": ["words"],
    "additionalProperties": False,
}

FOREIGN_WORDS_SYSTEM = (
    "You extract foreign-language words for a language lesson. "
    "The lesson's base language is English; the taught language varies. "
    "The user text is English narration with foreign words and short phrases "
    "embedded inside it — extract those embedded substrings. "
    'Return ONLY a JSON object shaped like {"words": [...]} where each entry '
    "is a single foreign word or short foreign phrase (at most 4 words) "
    "copied verbatim from the user text. Copy spelling, diacritics, and "
    "casing exactly; never invent words, never translate, never explain, "
    "never add prose outside the JSON object. "
    'When the text holds no foreign words, return exactly {"words": []}.'
)

FOREIGN_WORDS_USER_TEMPLATE = (
    "The text below is English narration with embedded foreign-language "
    "words or short phrases. List every word or short phrase (at most 4 "
    "words) that is NOT English — diacritics, non-Latin scripts, and taught "
    "vocabulary all count, even inside an otherwise English sentence. "
    'Return ONLY {{"words": [...]}} with each entry copied verbatim from '
    "the text. No bullets, no numbering, no explanations, no prose.\n"
    'Example: Text: "In Spanish arbol means tree; it is duradero y solido." '
    '-> {{"words": ["arbol", "duradero y solido"]}}\n\n'
    "Text:\n{text}"
)

MAX_FOREIGN_WORDS = 200
MAX_FOREIGN_WORD_CHARS = 120


def build_foreign_words_messages(text: str) -> list[dict[str, str]]:
    """Prompt messages for the foreign-word detector (pure; tested directly)."""
    return [
        {"role": "system", "content": FOREIGN_WORDS_SYSTEM},
        {
            "role": "user",
            "content": FOREIGN_WORDS_USER_TEMPLATE.format(text=text.strip()[:8000]),
        },
    ]


def _clean_foreign_entry(raw: str) -> str | None:
    """Normalize one candidate word/phrase; None when it cannot be a highlight entry."""
    text = " ".join(raw.split())
    # Strip list bullets/numbering once, then peel quotes/bold/punctuation
    # until stable ("**soy**", -> soy).
    text = re.sub(r"^\s*(?:[-*•>]\s+|\d+[.)]\s*)", "", text)
    # Fenced code residue never carries vocabulary.
    text = text.strip("`").strip()
    previous = None
    while previous != text:
        previous = text
        text = text.strip("*").strip("\"'“”‘’[]`").strip(" \t\r\n.,;:!?")
    # Trailing explanations are not vocabulary ("soy (I am)" -> soy,
    # "soy — I am" -> soy). Only split on spaced separators so hyphenated
    # words (arc-en-ciel) survive.
    for sep in (" — ", " – ", " —", " | ", " / ", " = ", " - ", " : "):
        if sep in text:
            text = text.split(sep, 1)[0].strip()
    # Trailing parenthetical gloss ("soy (I am)" -> soy).
    text = re.sub(r"\s*\([^()]{0,60}\)\s*$", "", text).strip()
    # Re-peel quotes/punctuation the split may have exposed.
    previous = None
    while previous != text:
        previous = text
        text = text.strip("*").strip("\"'“”‘’[]`").strip(" \t\r\n.,;:!?")
    if not text or len(text) > MAX_FOREIGN_WORD_CHARS:
        return None
    # At least one Unicode letter (stdlib re: [^\W\d_] == letters only).
    if not re.search(r"[^\W\d_]", text):
        return None
    if len(text.split()) > 8:
        return None
    return text


def parse_foreign_words_content(content: object) -> list[str]:
    """Defensively extract the word list from model output (pure; tested directly).

    Accepts a JSON object with a `words` array, or a bare JSON array, and
    falls back to scanning for the first `[...]` span. As a last resort the
    output is read as a bare word list (one entry per line, commas also
    split) so a model that ignores the JSON instruction and answers with
    plain `ser, estar, ...` lines still yields highlights. Anything
    unusable yields an empty list — highlighting is best-effort, never fatal.
    """
    raw = content if isinstance(content, str) else ""
    # Strip fenced code blocks so ```json {"words": [...]} ``` parses.
    fence = re.search(r"```(?:json)?\s*(.*?)```", raw, re.DOTALL | re.IGNORECASE)
    fence_text = fence.group(1).strip() if fence else ""
    out: list[str] = []
    seen: set[str] = set()

    def _take(entry: object) -> None:
        if len(out) >= MAX_FOREIGN_WORDS:
            return
        # Object entries ({"word": "soy"}) salvage their text field.
        if isinstance(entry, dict):
            for key in ("word", "text", "term", "phrase", "value"):
                value = entry.get(key)
                if isinstance(value, str) and value.strip():
                    _take(value)
                    return
            return
        if not isinstance(entry, str):
            return
        cleaned = _clean_foreign_entry(entry)
        if cleaned is None:
            return
        key = cleaned.casefold()
        if key in seen:
            return
        seen.add(key)
        out.append(cleaned)

    def _words_from_dict(data: dict[str, object]) -> object:
        for key in ("words", "foreign_words", "foreignWords", "phrases", "terms"):
            if key in data:
                return data[key]
        return None

    candidates: list[str] = [raw]
    if fence_text:
        candidates.append(fence_text)
    start = raw.find("[")
    end = raw.rfind("]")
    if 0 <= start < end:
        candidates.append(raw[start : end + 1])
    for candidate in candidates:
        try:
            parsed: object = _json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if isinstance(parsed, dict):
            parsed = _words_from_dict(parsed)
        if isinstance(parsed, str):
            # {"words": "soy, hola"} — treat the string as a bare list.
            for chunk in re.split(r"[\n,;]+", parsed):
                _take(chunk)
            if out:
                return out
            continue
        if isinstance(parsed, list):
            for entry in parsed:
                _take(entry)
            if out:
                return out
    # Bare word list fallback: bullets/numbers, one entry per line, commas split.
    # Chunks with braces are JSON residue, colon-terminated lines are
    # headers ("Here are the words:") — neither is vocabulary. Parts holding
    # `":` are protocol residue from a full API body (`"status":"incomplete"`)
    # and must never become highlights.
    for line in raw.splitlines():
        chunk = line.strip().strip("`")
        if not chunk or chunk.startswith("```"):
            continue
        if chunk.rstrip().endswith(":"):
            continue
        parts = re.split(r"[,;]+", chunk) if re.search(r"[,;]", chunk) else [chunk]
        for part in parts:
            if "{" in part or "}" in part or '":' in part:
                continue
            _take(part)
    return out


def _post_foreign_words_once(
    *,
    endpoint: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
    session_id: str,
    structured: bool,
) -> str:
    """One non-streaming inference call; returns the raw content text. Mock seam for tests."""
    if structured:
        path, payload = _structured_inference_payload(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            name="foreign_words",
            schema=FOREIGN_WORDS_SCHEMA,
        )
    else:
        path, payload = inference_request(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=False,
        )
    try:
        response = httpx.post(
            f"{inference_endpoint(endpoint)}{path}",
            headers=opencode_headers(api_key, session_id),
            json=payload,
            # Reasoning models can think for minutes before the first byte;
            # chat streaming allows 300s, so don't fail fast here either.
            timeout=180.0,
        )
    except httpx.HTTPError as exc:
        raise ZenFetchError(0, str(exc)) from exc
    if response.status_code != 200:
        raise ZenFetchError(response.status_code, response.text)
    # A 200 that carries no usable content means "no highlights", not a
    # failure — parse what we can (the parser salvages [...] spans from raw
    # text) instead of turning it into a 502.
    try:
        data = response.json()
        content = _inference_response_text(data)
    except (ValueError, TypeError, AttributeError):
        data = None
        content = response.text
    if isinstance(data, dict) and data.get("status") == "incomplete":
        # Reasoning models burn output tokens thinking; when the cap hits
        # before any message is emitted there is nothing to parse — retrying
        # at the same cap would fail the same way, so say so loudly.
        details = data.get("incomplete_details")
        reason = details.get("reason") if isinstance(details, dict) else None
        usage = data.get("usage")
        usage_txt = usage if isinstance(usage, dict) else data.get("output_tokens")
        logger.warning(
            "ai foreign-words response incomplete (model=%s, reason=%s, usage=%s); "
            "output cap starved the reasoning — raise the cap",
            model,
            reason,
            usage_txt,
        )
        return ""
    if not isinstance(content, str) or not content.strip():
        # Extractor missed the envelope but the raw body may still carry the
        # words array (e.g. an unfamiliar Responses shape) — let the parser
        # scan it for [...] spans instead of throwing the body away.
        try:
            body_text = response.text
        except (ValueError, UnicodeError, RuntimeError, AttributeError):
            body_text = ""
        if isinstance(body_text, str) and body_text.strip():
            return body_text
        logger.info("ai foreign-words returned empty content; continuing without highlights")
        return ""
    return content


def detect_scenario_foreign_words(
    *,
    endpoint: str,
    api_key: str,
    model: str,
    text: str,
    session_id: str,
    temperature: float,
    max_tokens: int,
) -> list[str]:
    """Call Zen non-streaming for the foreign-word JSON list. Mock seam for tests.

    Tries the JSON-schema structured call first; when the provider rejects
    the format itself (HTTP 400 — some models/gateways don't accept
    `response_format`), retries once as a plain completion since the prompt
    already demands ONLY JSON and parsing is defensive. A structured 200
    that parses to no words is also retried once as plain: some models
    silently ignore an unfamiliar schema envelope and answer conservatively
    (e.g. `{"words": []}`) while the same prompt unconstrained returns the
    embedded vocabulary.
    """
    messages = build_foreign_words_messages(text)
    common: dict[str, Any] = {
        "endpoint": endpoint,
        "api_key": api_key,
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "session_id": session_id,
    }
    raw_content = ""
    try:
        raw_content = _post_foreign_words_once(**common, structured=True)
        words = parse_foreign_words_content(raw_content)
    except ZenFetchError as exc:
        if exc.status != 400:
            raise
        logger.warning(
            "ai foreign-words structured call rejected (status 400); retrying plain completion"
        )
        raw_content = _post_foreign_words_once(**common, structured=False)
        words = parse_foreign_words_content(raw_content)
    if not words and raw_content.strip():
        # Structured envelope may have constrained the answer into an empty
        # list; one plain retry gives the same prompt a second chance before
        # accepting "no highlights". Plain 200s that also parse empty are
        # accepted as-is (genuinely English text costs one extra small call).
        logger.info("ai foreign-words structured parse empty; retrying plain completion once")
        raw_content = _post_foreign_words_once(**common, structured=False)
        words = parse_foreign_words_content(raw_content)
    if not words:
        # Suspicious case (the text clearly holds foreign words): keep the raw
        # model output in the log so the next retry comes with evidence.
        logger.warning(
            "ai foreign-words parsed 0 words from %d chars of input (model=%s); "
            "input head: %s; raw model reply: %s",
            len(text),
            model,
            text[:200],
            raw_content[:1000],
        )
    else:
        logger.info("ai foreign-words detected %d words", len(words))
    return words


@router.post("/ai/scenarios/markdown/foreign-words", status_code=200)
def post_scenario_foreign_words(request: Request, body: dict[str, Any]) -> dict[str, object]:
    """Detect foreign words/phrases in narrator text for HTML highlighting.

    Body: `{projectId, conversationId?, text}` where `text` is the narrator
    sentences glued together. Returns `{words: [...]}` copied verbatim from
    the input — the frontend only ever highlights substrings actually present
    in the sentences, so invented entries are harmless. A background utility:
    writes nothing to the conversation and creates no versions. Missing key
    reads 409, provider failures read 502 with the provider status and body
    snippet in the message; the frontend surfaces that message and renders
    without highlights instead of failing Generate.
    """
    from app.ai.schemas import AiScenarioForeignWords

    try:
        parsed = AiScenarioForeignWords.model_validate(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    library = _library(request)
    if parsed.conversationId:
        _require_conversation_in_project(library, parsed.conversationId, parsed.projectId)
    row, key = library.get_settings_raw()
    if not key:
        raise HTTPException(
            status_code=409, detail={"code": "missing_key", "message": "AI key is not set."}
        )
    try:
        words = detect_scenario_foreign_words(
            endpoint=row.endpoint,
            api_key=key,
            model=row.model,
            text=parsed.text,
            session_id=parsed.conversationId or parsed.projectId,
            # Same temperature the working chat calls use (row setting) —
            # a hardcoded 0 is rejected by some models. Reasoning models burn
            # output tokens thinking before emitting the list, so guarantee a
            # thinking budget: floor 2000, ceiling 4000 (the list itself is
            # tiny). An 800 cap truncates reasoning models into `incomplete`
            # responses with no words at all.
            temperature=row.temperature,
            max_tokens=max(2000, min(row.max_tokens, 4000)),
        )
    except ZenFetchError as exc:
        code, friendly = friendly_error_for_status(exc.status, exc.body)
        logger.warning("ai foreign-words failed for model %s: %s", row.model, exc.body[:500])
        # Surface the provider's own status/body snippet: chat works in this
        # setup, so a failure here is provider-specific and the raw reason
        # is what unblocks debugging.
        message = friendly
        if exc.status >= 400:
            snippet = " ".join(str(exc.body or "").split())[:200]
            message = f"{friendly} (provider status {exc.status})"
            if snippet:
                message = f"{message}: {snippet}"
        raise HTTPException(
            status_code=409 if code != "provider_error" else 502,
            detail={"code": code, "message": message},
        ) from exc
    return {"words": words}
