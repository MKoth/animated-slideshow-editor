# ruff: noqa: BLE001, S110
from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.ai.library import (
    AiConversationNotFoundError,
    AiLibrary,
    AiSecretMissingError,
    StaleProposalError,
)
from app.ai.plans import (
    PLAN_JSON_SCHEMA,
    apply_user_edits_preservation,
    build_plan_user_text,
    parse_and_validate_plan,
)
from app.ai.prompting import ChatMessage, compose_messages, context_to_text, estimate_tokens
from app.ai.schemas import (
    AiCalibrationAlign,
    AiCalibrationCreate,
    AiCalibrationFallback,
    AiChatRequest,
    AiConversationCreate,
    AiConversationRename,
    AiNarrationCreate,
    AiNarrationPartFail,
    AiNarrationPartReady,
    AiNarrationVoicePatch,
    AiPlanCreate,
    AiPlanUpdate,
    AiProposalApprove,
    AiProposalCreate,
    AiProposalDryRun,
    AiProposalExecute,
    AiReconciliationCreate,
    AiReconciliationDecision,
    AiReconciliationUpdate,
    AiScenarioCreate,
    AiScenarioUpdate,
    AiSettingsUpdate,
)
from app.ai.zen import ZenClient, ZenFetchError, friendly_error_for_status

logger = logging.getLogger(__name__)

router = APIRouter()


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _iso(value: datetime) -> str:
    text = value.isoformat()
    return text if text.endswith("Z") else f"{text}Z"


def _library(request: Request) -> AiLibrary:
    library = getattr(request.app.state, "ai_library", None)
    if library is None:
        raise HTTPException(status_code=500, detail="AI library is not configured")
    return library  # type: ignore[no-any-return]


# -- settings ----------------------------------------------------------


@router.get("/ai/settings")
def get_ai_settings(request: Request) -> dict[str, object]:
    return _library(request).get_settings_view()


@router.put("/ai/settings")
def put_ai_settings(request: Request, body: AiSettingsUpdate) -> dict[str, object]:
    library = _library(request)
    try:
        return library.update_settings(
            endpoint=body.endpoint,
            model=body.model,
            temperature=body.temperature,
            max_tokens=body.maxTokens,
            streaming=body.streaming,
            system_prompt=body.systemPrompt,
            api_key=body.apiKey,
        )
    except AiSecretMissingError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class AiModelsOut(BaseModel):
    models: list[str]
    selected: str
    fallback: bool


@router.get("/ai/models", response_model=AiModelsOut)
def get_ai_models(request: Request) -> AiModelsOut:
    library = _library(request)
    row, key = library.get_settings_raw()
    settings = request.app.state.settings
    fallback_models = list(getattr(settings, "ai_fallback_models", [row.model]))
    if key:
        try:
            live = ZenClient(row.endpoint, key).list_models()
            if live:
                return AiModelsOut(models=live, selected=row.model, fallback=False)
        except Exception:
            pass
    models = fallback_models or [row.model]
    return AiModelsOut(models=models, selected=row.model, fallback=True)


# -- conversations -----------------------------------------------------


@router.get("/ai/conversations")
def list_ai_conversations(request: Request, projectId: str = "") -> list[dict[str, object]]:
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    return [
        {
            "id": row.id,
            "projectId": row.project_id,
            "title": row.title,
            "modified": _iso(row.updated_at),
        }
        for row in library.list_conversations(projectId)
    ]


@router.post("/ai/conversations", status_code=201)
def create_ai_conversation(request: Request, body: AiConversationCreate) -> dict[str, object]:
    library = _library(request)
    row = library.create_conversation(body.projectId, body.title)
    return {
        "id": row.id,
        "projectId": row.project_id,
        "title": row.title,
        "created": _iso(row.created_at),
        "modified": _iso(row.updated_at),
    }


@router.patch("/ai/conversations/{conversation_id}")
def rename_ai_conversation(
    request: Request, conversation_id: str, body: AiConversationRename
) -> dict[str, object]:
    library = _library(request)
    try:
        row = library.rename_conversation(conversation_id, body.title)
    except AiConversationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "id": row.id,
        "projectId": row.project_id,
        "title": row.title,
        "modified": _iso(row.updated_at),
    }


@router.delete("/ai/conversations/{conversation_id}", status_code=204)
def delete_ai_conversation(request: Request, conversation_id: str) -> None:
    library = _library(request)
    try:
        library.delete_conversation(conversation_id)
    except AiConversationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc


@router.get("/ai/conversations/{conversation_id}/messages")
def list_ai_messages(
    request: Request, conversation_id: str, limit: int | None = None, offset: int = 0
) -> list[dict[str, object]]:
    library = _library(request)
    try:
        rows = library.list_messages(conversation_id)
    except AiConversationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    sliced = rows[offset:]
    if limit is not None:
        sliced = sliced[: max(0, limit)]
    return [
        {
            "id": row.id,
            "role": row.role,
            "content": row.content,
            "stopped": bool(row.stopped),
            "errorCode": row.error_code,
            "created": _iso(row.created_at),
        }
        for row in sliced
    ]


# -- chat --------------------------------------------------------------


def _sse(event: str, payload: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


def _error_assistant_text(code: str, fallback: str) -> str:
    mapping = {
        "missing_key": "No API key saved — open AI Settings and save your opencode.ai key, then retry.",
        "invalid_or_exhausted": "Key invalid or credits exhausted — check your key or top up, then retry.",
        "limit_exceeded": "Credit limit exceeded — top up and retry.",
        "rate_limited": "Rate-limited — wait a moment and retry.",
        "model_unlisted": "Model no longer listed — reselect a model in AI Settings, then retry.",
        "provider_error": "Provider error — retry.",
    }
    return mapping.get(code, fallback)


def _resolve_live_models(
    endpoint: str, key: str | None, fallback: list[str]
) -> tuple[list[str], bool]:
    if not key:
        return fallback, True
    try:
        live = ZenClient(endpoint, key).list_models()
        if live:
            return live, False
    except Exception:
        pass
    return fallback, True


@router.post("/ai/chat")
def post_ai_chat(request: Request, body: AiChatRequest) -> StreamingResponse:
    library = _library(request)
    try:
        conversation = library.get_conversation(body.conversationId)
    except AiConversationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    _ = conversation

    settings = request.app.state.settings
    fallback_models: list[str] = list(getattr(settings, "ai_fallback_models", []))
    row, key = library.get_settings_raw()

    # Resolve the prompt input without persisting yet.
    if body.mode == "send":
        current = (body.message or "").strip()
        if not current:
            raise HTTPException(status_code=422, detail="message must be a non-empty string")
    else:
        # regenerate: reuse the last user message; body.message ignored
        history_rows = library.list_messages(body.conversationId)
        current = ""
        for message in reversed(history_rows):
            if message.role == "user":
                current = message.content
                break
        if not current.strip():
            raise HTTPException(status_code=422, detail="no user message to regenerate")

    context_text = context_to_text(body.context)
    stored = library.list_messages(body.conversationId)
    history = [ChatMessage(role=m.role, content=m.content) for m in stored]

    def generate() -> Iterator[str]:
        # Persist the user message first so history is never lost.
        if body.mode == "send":
            library.append_message(body.conversationId, "user", current)

        if not key:
            text = _error_assistant_text("missing_key", "")
            assistant = library.append_message(
                body.conversationId, "assistant", text, error_code="missing_key"
            )
            yield _sse("start", {"conversationId": body.conversationId, "messageId": assistant.id})
            yield _sse(
                "error",
                {"code": "missing_key", "message": text, "messageId": assistant.id},
            )
            return

        live_models, _ = _resolve_live_models(row.endpoint, key, fallback_models or [row.model])
        if row.model not in live_models:
            text = _error_assistant_text("model_unlisted", "")
            assistant = library.append_message(
                body.conversationId, "assistant", text, error_code="model_unlisted"
            )
            yield _sse("start", {"conversationId": body.conversationId, "messageId": assistant.id})
            yield _sse(
                "error",
                {"code": "model_unlisted", "message": text, "messageId": assistant.id},
            )
            return

        budget = library.context_budget
        composed = compose_messages(row.system_prompt, context_text, history, current, budget)
        zen_messages = [{"role": m.role, "content": m.content} for m in composed]
        # Log prompt size for the budget test seam (no token math client-side).
        logger.debug(
            "ai chat prompt: %d messages, ~%d tokens (budget %d)",
            len(zen_messages),
            sum(estimate_tokens(m["content"]) for m in zen_messages),
            budget,
        )

        if body.mode == "regenerate":
            existing = library.replace_last_assistant(body.conversationId)
            if existing is not None:
                assistant_id = existing.id
                library.update_message_content(assistant_id, "")
            else:
                assistant_id = library.append_message(body.conversationId, "assistant", "").id
        else:
            assistant_id = library.append_message(body.conversationId, "assistant", "").id

        yield _sse("start", {"conversationId": body.conversationId, "messageId": assistant_id})

        zen = ZenClient(row.endpoint, key)
        collected: list[str] = []
        try:
            if row.streaming:
                for token in zen.chat_stream(
                    model=row.model,
                    messages=zen_messages,
                    temperature=row.temperature,
                    max_tokens=row.max_tokens,
                ):
                    collected.append(token)
                    yield _sse("token", {"delta": token, "messageId": assistant_id})
            else:
                content = _chat_once_non_streaming(
                    endpoint=row.endpoint,
                    api_key=key,
                    model=row.model,
                    messages=zen_messages,
                    temperature=row.temperature,
                    max_tokens=row.max_tokens,
                )
                collected.append(content)
                yield _sse("token", {"delta": content, "messageId": assistant_id})
        except ZenFetchError as exc:
            code, friendly = friendly_error_for_status(exc.status, exc.body)
            if exc.status == 401:
                logger.warning("ai zen 401 for model %s: %s", row.model, exc.body[:200])
            text = _error_assistant_text(code, friendly)
            # Preserve any partial stream content, then append the actionable error.
            partial = "".join(collected)
            combined = f"{partial}\n\n{text}" if partial else text
            library.update_message_content(assistant_id, combined, error_code=code)
            yield _sse("error", {"code": code, "message": text, "messageId": assistant_id})
            return
        except GeneratorExit:
            # Client pressed Stop: persist the partial response as-is with a stopped marker.
            partial = "".join(collected)
            library.update_message_content(assistant_id, partial, stopped=True)
            raise
        except (httpx.HTTPError, TimeoutError) as exc:
            text = _error_assistant_text("provider_error", "Provider error — retry.")
            partial = "".join(collected)
            combined = f"{partial}\n\n{text}" if partial else text
            library.update_message_content(assistant_id, combined, error_code="provider_error")
            logger.warning("ai zen network error: %s", exc)
            yield _sse(
                "error",
                {"code": "provider_error", "message": text, "messageId": assistant_id},
            )
            return
        except Exception as exc:
            text = _error_assistant_text("provider_error", "Provider error — retry.")
            partial = "".join(collected)
            combined = f"{partial}\n\n{text}" if partial else text
            library.update_message_content(assistant_id, combined, error_code="provider_error")
            logger.warning("ai zen unexpected error: %s", exc)
            yield _sse(
                "error",
                {"code": "provider_error", "message": text, "messageId": assistant_id},
            )
            return

        full = "".join(collected)
        if not full.strip():
            # Malformed/empty provider content maps to a retryable provider error.
            text = _error_assistant_text("provider_error", "Provider error — retry.")
            library.update_message_content(assistant_id, text, error_code="provider_error")
            yield _sse(
                "error",
                {"code": "provider_error", "message": text, "messageId": assistant_id},
            )
            return
        library.update_message_content(assistant_id, full)
        yield _sse("done", {"messageId": assistant_id, "content": full})

    return StreamingResponse(generate(), media_type="text/event-stream")


def _chat_once_non_streaming(
    *,
    endpoint: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> str:
    from app.ai.zen import chat_completions_payload

    payload = chat_completions_payload(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=False,
    )
    try:
        response = httpx.post(
            f"{endpoint.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise ZenFetchError(0, str(exc)) from exc
    if response.status_code != 200:
        raise ZenFetchError(response.status_code, response.text)
    try:
        data = response.json()
        choices = data.get("choices", [])
        content = choices[0].get("message", {}).get("content", "")
        if not isinstance(content, str):
            return ""
        return content
    except Exception:
        return ""


# -- lesson plans --------------------------------------------------------


def _generate_plan_structured(
    *,
    endpoint: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> dict[str, object]:
    """Call Zen chat/completions with a Lesson Plan JSON schema. Mock seam for tests."""
    payload: dict[str, object] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "lesson_plan", "schema": PLAN_JSON_SCHEMA},
        },
    }
    try:
        response = httpx.post(
            f"{endpoint.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60.0,
        )
    except httpx.HTTPError as exc:
        raise ZenFetchError(0, str(exc)) from exc
    if response.status_code != 200:
        raise ZenFetchError(response.status_code, response.text)
    try:
        data = response.json()
        choices = data.get("choices", [])
        if not choices or not isinstance(choices[0], dict):
            raise TypeError("empty plan choices")
        message = choices[0].get("message", {})
        content = message.get("content", "") if isinstance(message, dict) else ""
        if not isinstance(content, str) or not content.strip():
            raise TypeError("empty plan content")
        parsed: object = json.loads(content)
        if not isinstance(parsed, dict):
            raise TypeError("plan content is not an object")
        return parsed
    except ZenFetchError:
        raise
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        raise ZenFetchError(0, f"malformed plan content: {exc}") from exc


def _plan_to_out(request: Request, plan_id: str) -> dict[str, object]:
    import json as _json

    library = _library(request)
    try:
        row = library.get_plan(plan_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="plan not found") from exc
    try:
        loaded_slides: object = _json.loads(row.slides_json or "[]")
        slides = loaded_slides if isinstance(loaded_slides, list) else []
    except (ValueError, TypeError):
        slides = []
    revisions = []
    for rev in library.list_plan_revisions(plan_id):
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
        "language": row.language,
        "estimatedDurationSec": row.estimated_duration_sec,
        "learningObjective": row.learning_objective,
        "teachingStrategy": row.teaching_strategy,
        "status": row.status,
        "slides": slides,
        "revisions": revisions,
        "userEdits": user_edits if isinstance(user_edits, dict) else {},
        "created": _iso(row.created_at),
        "modified": _iso(row.updated_at),
    }


@router.post("/ai/plan", status_code=200)
def post_ai_plan(request: Request, body: AiPlanCreate) -> dict[str, object]:
    library = _library(request)
    try:
        conversation = library.get_conversation(body.conversationId)
    except AiConversationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    _ = conversation
    current_text = (body.request or "").strip()
    if not current_text:
        raise HTTPException(status_code=422, detail="request must be a non-empty string")

    prior_plan_dict: dict[str, object] | None = None
    user_edits: dict[str, object] = {}
    if body.planId:
        try:
            existing = library.get_plan(body.planId)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="plan not found") from exc
        prior_plan_dict = _plan_to_out(request, existing.id)
        user_edits = library.get_user_edits(existing.id)

    # Persist the user request first so history is never lost.
    library.append_message(body.conversationId, "user", current_text)

    settings = request.app.state.settings
    fallback_models: list[str] = list(getattr(settings, "ai_fallback_models", []))
    row, key = library.get_settings_raw()

    if not key:
        text = _error_assistant_text("missing_key", "")
        library.append_message(body.conversationId, "assistant", text, error_code="missing_key")
        raise HTTPException(status_code=409, detail={"code": "missing_key", "message": text})

    live_models, _ = _resolve_live_models(row.endpoint, key, fallback_models or [row.model])
    if row.model not in live_models:
        text = _error_assistant_text("model_unlisted", "")
        library.append_message(body.conversationId, "assistant", text, error_code="model_unlisted")
        raise HTTPException(status_code=409, detail={"code": "model_unlisted", "message": text})

    context_text = context_to_text(body.context)
    stored = library.list_messages(body.conversationId)
    history = [ChatMessage(role=m.role, content=m.content) for m in stored]
    budget = library.context_budget
    user_text = build_plan_user_text(
        current_text, prior_plan=prior_plan_dict, user_edits=user_edits
    )
    composed = compose_messages(row.system_prompt, context_text, history, user_text, budget)
    zen_messages = [{"role": m.role, "content": m.content} for m in composed]

    try:
        raw = _generate_plan_structured(
            endpoint=row.endpoint,
            api_key=key,
            model=row.model,
            messages=zen_messages,
            temperature=row.temperature,
            max_tokens=row.max_tokens,
        )
    except ZenFetchError as exc:
        code, friendly = friendly_error_for_status(exc.status, exc.body)
        text = _error_assistant_text(code, friendly)
        library.append_message(body.conversationId, "assistant", text, error_code=code)
        raise HTTPException(
            status_code=409 if code != "provider_error" else 502,
            detail={"code": code, "message": text},
        ) from exc
    except Exception as exc:
        logger.warning("ai plan unexpected error: %s", exc)
        text = _error_assistant_text("provider_error", "Provider error — retry.")
        library.append_message(body.conversationId, "assistant", text, error_code="provider_error")
        raise HTTPException(
            status_code=502, detail={"code": "provider_error", "message": text}
        ) from exc

    try:
        merged_raw: dict[str, object] = dict(raw)
        if user_edits and body.planId:
            merged_raw = apply_user_edits_preservation(merged_raw, user_edits, current_text)
        validated = parse_and_validate_plan(merged_raw)
        content = validated.model_dump(by_alias=False)
        # Align alias casing with the API (definitionId stays camelCase via dump).
    except ValueError as exc:
        text = _error_assistant_text("provider_error", "Provider error — retry.")
        library.append_message(body.conversationId, "assistant", text, error_code="provider_error")
        raise HTTPException(
            status_code=502, detail={"code": "provider_error", "message": text}
        ) from exc

    if body.planId:
        plan_row = library.revise_plan(body.planId, content=content, source_request=current_text)
    else:
        plan_row = library.create_plan(
            project_id=body.projectId,
            conversation_id=body.conversationId,
            content=content,
            source_request=current_text,
        )
    narration = (
        f'Proposed lesson plan "{plan_row.title}" with '
        f"{len(content.get('slides', [])) if isinstance(content.get('slides'), list) else 0} slides. "
        "Review it in the AI panel, edit, revise, then accept — the project is untouched."
    )
    library.append_message(body.conversationId, "assistant", narration)
    return _plan_to_out(request, plan_row.id)


@router.get("/ai/plans")
def list_ai_plans(request: Request, projectId: str = "") -> list[dict[str, object]]:
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    out: list[dict[str, object]] = []
    for row in library.list_plans(projectId):
        import json as _json

        try:
            loaded: object = _json.loads(row.slides_json or "[]")
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
                "slideCount": count,
                "modified": _iso(row.updated_at),
            }
        )
    return out


@router.get("/ai/plans/{plan_id}")
def get_ai_plan(request: Request, plan_id: str) -> dict[str, object]:
    return _plan_to_out(request, plan_id)


@router.patch("/ai/plans/{plan_id}")
def patch_ai_plan(request: Request, plan_id: str, body: AiPlanUpdate) -> dict[str, object]:
    library = _library(request)
    try:
        library.get_plan(plan_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="plan not found") from exc
    slides_patch: list[dict[str, object]] | None = None
    if body.slides is not None:
        slides_patch = []
        for slide in body.slides:
            item: dict[str, object] = {"id": slide.id}
            if slide.title is not None:
                if not slide.title.strip():
                    raise HTTPException(status_code=422, detail="slide title must be non-empty")
                item["title"] = slide.title
            if slide.goal is not None:
                item["goal"] = slide.goal
            if slide.explanation is not None:
                item["explanation"] = slide.explanation
            if slide.suggestedNarration is not None:
                item["suggestedNarration"] = slide.suggestedNarration
            if slide.estimatedDurationSec is not None:
                item["estimatedDurationSec"] = slide.estimatedDurationSec
            slides_patch.append(item)
    if body.title is not None and not body.title.strip():
        raise HTTPException(status_code=422, detail="title must be a non-empty string")
    try:
        library.update_plan_edits(
            plan_id,
            title=body.title,
            description=body.description,
            language=body.language,
            estimated_duration_sec=body.estimatedDurationSec,
            learning_objective=body.learningObjective,
            teaching_strategy=body.teachingStrategy,
            slides=slides_patch,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="plan not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _plan_to_out(request, plan_id)


@router.post("/ai/plans/{plan_id}/accept")
def accept_ai_plan(request: Request, plan_id: str) -> dict[str, object]:
    library = _library(request)
    try:
        library.set_plan_status(plan_id, "accepted")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="plan not found") from exc
    return _plan_to_out(request, plan_id)


@router.post("/ai/plans/{plan_id}/reject")
def reject_ai_plan(request: Request, plan_id: str) -> dict[str, object]:
    library = _library(request)
    try:
        library.set_plan_status(plan_id, "rejected")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="plan not found") from exc
    return _plan_to_out(request, plan_id)


# -- action scenarios (Stage A) --------------------------------------------


def _generate_scenario_structured(
    *,
    endpoint: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> dict[str, object]:
    """Call Zen chat/completions with an Action Scenario JSON schema. Mock seam for tests."""
    from app.ai.scenarios import SCENARIO_JSON_SCHEMA

    payload: dict[str, object] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "action_scenario", "schema": SCENARIO_JSON_SCHEMA},
        },
    }
    try:
        response = httpx.post(
            f"{endpoint.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60.0,
        )
    except httpx.HTTPError as exc:
        raise ZenFetchError(0, str(exc)) from exc
    if response.status_code != 200:
        raise ZenFetchError(response.status_code, response.text)
    try:
        data = response.json()
        choices = data.get("choices", [])
        if not choices or not isinstance(choices[0], dict):
            raise TypeError("empty scenario choices")
        message = choices[0].get("message", {})
        content = message.get("content", "") if isinstance(message, dict) else ""
        if not isinstance(content, str) or not content.strip():
            raise TypeError("empty scenario content")
        parsed: object = json.loads(content)
        if not isinstance(parsed, dict):
            raise TypeError("scenario content is not an object")
        return parsed
    except ZenFetchError:
        raise
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        raise ZenFetchError(0, f"malformed scenario content: {exc}") from exc


def _scenario_to_out(request: Request, scenario_id: str) -> dict[str, object]:
    import json as _json

    library = _library(request)
    try:
        row = library.get_scenario(scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="scenario not found") from exc
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


@router.post("/ai/scenarios", status_code=200)
def post_ai_scenario(request: Request, body: AiScenarioCreate) -> dict[str, object]:
    from app.ai.scenarios import (
        apply_scenario_edits_preservation,
        build_scenario_user_text,
        parse_and_validate_scenario,
    )

    library = _library(request)
    try:
        conversation = library.get_conversation(body.conversationId)
    except AiConversationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    if conversation.project_id != body.projectId:
        raise HTTPException(status_code=422, detail="conversation does not belong to this project")
    current_text = (body.request or "").strip()
    if not current_text:
        raise HTTPException(status_code=422, detail="request must be a non-empty string")

    prior_scenario_dict: dict[str, object] | None = None
    user_edits: dict[str, object] = {}
    if body.scenarioId:
        try:
            existing = library.get_scenario(body.scenarioId)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="scenario not found") from exc
        if existing.project_id != body.projectId:
            raise HTTPException(status_code=422, detail="scenario does not belong to this project")
        prior_scenario_dict = _scenario_to_out(request, existing.id)
        user_edits = library.get_scenario_user_edits(existing.id)

    library.append_message(body.conversationId, "user", current_text)

    settings = request.app.state.settings
    fallback_models: list[str] = list(getattr(settings, "ai_fallback_models", []))
    row, key = library.get_settings_raw()

    if not key:
        text = _error_assistant_text("missing_key", "")
        library.append_message(body.conversationId, "assistant", text, error_code="missing_key")
        raise HTTPException(status_code=409, detail={"code": "missing_key", "message": text})

    live_models, _ = _resolve_live_models(row.endpoint, key, fallback_models or [row.model])
    if row.model not in live_models:
        text = _error_assistant_text("model_unlisted", "")
        library.append_message(body.conversationId, "assistant", text, error_code="model_unlisted")
        raise HTTPException(status_code=409, detail={"code": "model_unlisted", "message": text})

    context_text = context_to_text(body.context)
    stored = library.list_messages(body.conversationId)
    history = [ChatMessage(role=m.role, content=m.content) for m in stored]
    budget = library.context_budget
    user_text = build_scenario_user_text(
        current_text, prior_scenario=prior_scenario_dict, user_edits=user_edits
    )
    composed = compose_messages(row.system_prompt, context_text, history, user_text, budget)
    zen_messages = [{"role": m.role, "content": m.content} for m in composed]

    try:
        raw = _generate_scenario_structured(
            endpoint=row.endpoint,
            api_key=key,
            model=row.model,
            messages=zen_messages,
            temperature=row.temperature,
            max_tokens=row.max_tokens,
        )
    except ZenFetchError as exc:
        code, friendly = friendly_error_for_status(exc.status, exc.body)
        text = _error_assistant_text(code, friendly)
        library.append_message(body.conversationId, "assistant", text, error_code=code)
        raise HTTPException(
            status_code=409 if code != "provider_error" else 502,
            detail={"code": code, "message": text},
        ) from exc
    except Exception as exc:
        logger.warning("ai scenario unexpected error: %s", exc)
        text = _error_assistant_text("provider_error", "Provider error — retry.")
        library.append_message(body.conversationId, "assistant", text, error_code="provider_error")
        raise HTTPException(
            status_code=502, detail={"code": "provider_error", "message": text}
        ) from exc

    try:
        merged_raw: dict[str, object] = dict(raw)
        if user_edits and body.scenarioId:
            merged_raw = apply_scenario_edits_preservation(merged_raw, user_edits, current_text)
        validated = parse_and_validate_scenario(merged_raw)
        content = validated.model_dump(by_alias=False)
    except ValueError as exc:
        text = _error_assistant_text("provider_error", "Provider error — retry.")
        library.append_message(body.conversationId, "assistant", text, error_code="provider_error")
        raise HTTPException(
            status_code=502, detail={"code": "provider_error", "message": text}
        ) from exc

    if body.scenarioId:
        scenario_row = library.revise_scenario(
            body.scenarioId, content=content, source_request=current_text
        )
    else:
        scenario_row = library.create_scenario(
            project_id=body.projectId,
            conversation_id=body.conversationId,
            content=content,
            source_request=current_text,
        )
    narration = (
        f'Proposed action scenario "{scenario_row.title}" with '
        f"{len(content.get('steps', [])) if isinstance(content.get('steps'), list) else 0} steps. "
        "Review it in the AI panel, edit, revise, then accept — the project is untouched. "
        "Stage B runs only on the accepted version."
    )
    library.append_message(body.conversationId, "assistant", narration)
    return _scenario_to_out(request, scenario_row.id)


@router.get("/ai/scenarios")
def list_ai_scenarios(request: Request, projectId: str = "") -> list[dict[str, object]]:
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    out: list[dict[str, object]] = []
    for row in library.list_scenarios(projectId):
        import json as _json

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


@router.get("/ai/scenarios/{scenario_id}")
def get_ai_scenario(request: Request, scenario_id: str) -> dict[str, object]:
    return _scenario_to_out(request, scenario_id)


@router.get("/ai/scenarios/{scenario_id}/canonical")
def get_ai_scenario_canonical(request: Request, scenario_id: str) -> dict[str, object]:
    """Stage B handoff: canonical JSON of the accepted version only.

    Draft versions are refused with 409 so downstream reconciliation never
    builds on a version the author has not approved.
    """
    library = _library(request)
    try:
        return library.scenario_canonical_json(scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="scenario not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch("/ai/scenarios/{scenario_id}")
def patch_ai_scenario(
    request: Request, scenario_id: str, body: AiScenarioUpdate
) -> dict[str, object]:
    library = _library(request)
    try:
        library.get_scenario(scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="scenario not found") from exc
    steps_patch: list[dict[str, object]] | None = None
    if body.steps is not None:
        steps_patch = []
        for step in body.steps:
            item: dict[str, object] = {"id": step.id}
            if step.partTag is not None:
                item["partTag"] = step.partTag
            if step.spokenLine is not None:
                if not step.spokenLine.strip():
                    raise HTTPException(status_code=422, detail="spokenLine must be non-empty")
                item["spokenLine"] = step.spokenLine
            if step.onScreenAction is not None:
                if not step.onScreenAction.strip():
                    raise HTTPException(status_code=422, detail="onScreenAction must be non-empty")
                item["onScreenAction"] = step.onScreenAction
            if step.assetHints is not None:
                item["assetHints"] = list(step.assetHints)
            if step.estimatedDurationSec is not None:
                item["estimatedDurationSec"] = step.estimatedDurationSec
            steps_patch.append(item)
    if body.title is not None and not body.title.strip():
        raise HTTPException(status_code=422, detail="title must be a non-empty string")
    try:
        library.update_scenario_edits(
            scenario_id,
            title=body.title,
            description=body.description,
            steps=steps_patch,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="scenario not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _scenario_to_out(request, scenario_id)


@router.post("/ai/scenarios/{scenario_id}/accept")
def accept_ai_scenario(request: Request, scenario_id: str) -> dict[str, object]:
    library = _library(request)
    try:
        library.set_scenario_status(scenario_id, "accepted")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="scenario not found") from exc
    return _scenario_to_out(request, scenario_id)


@router.post("/ai/scenarios/{scenario_id}/reject")
def reject_ai_scenario(request: Request, scenario_id: str) -> dict[str, object]:
    library = _library(request)
    try:
        library.set_scenario_status(scenario_id, "rejected")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="scenario not found") from exc
    return _scenario_to_out(request, scenario_id)


# -- reconciliations (Stage B) ---------------------------------------------


def _context_list(context: object, *keys: str) -> list[str]:
    if not isinstance(context, dict):
        return []
    out: list[str] = []
    for key in keys:
        value = context.get(key)
        if isinstance(value, list):
            for entry in value:
                if isinstance(entry, str) and entry.strip():
                    out.append(entry.strip())
                elif isinstance(entry, dict) and isinstance(entry.get("name"), str):
                    name = str(entry["name"]).strip()
                    if name:
                        out.append(name)
    return out


def _reconciliation_to_out(request: Request, reconciliation_id: str) -> dict[str, object]:
    import json as _json

    library = _library(request)
    try:
        row = library.get_reconciliation(reconciliation_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="reconciliation not found") from exc
    try:
        verdicts: object = _json.loads(row.verdicts_json or "[]")
    except (ValueError, TypeError):
        verdicts = []
    try:
        briefs: object = _json.loads(row.briefs_json or "[]")
    except (ValueError, TypeError):
        briefs = []
    try:
        decisions: object = _json.loads(row.decisions_json or "{}")
    except (ValueError, TypeError):
        decisions = {}
    revisions = [
        {
            "id": rev.id,
            "sourceRequest": rev.source_request,
            "created": _iso(rev.created_at),
        }
        for rev in library.list_reconciliation_revisions(reconciliation_id)
    ]
    middle = (
        [v for v in verdicts if isinstance(v, dict) and not v.get("skipped")]
        if isinstance(verdicts, list)
        else []
    )
    missing = 0
    if isinstance(verdicts, list):
        for step in verdicts:
            if not isinstance(step, dict) or step.get("skipped"):
                continue
            for verdict in step.get("assetVerdicts", []) or []:
                if isinstance(verdict, dict) and verdict.get("verdict") == "missing":
                    missing += 1
    return {
        "id": row.id,
        "projectId": row.project_id,
        "scenarioId": row.scenario_id,
        "conversationId": row.conversation_id,
        "title": row.title,
        "status": row.status,
        "verdicts": verdicts if isinstance(verdicts, list) else [],
        "briefs": briefs if isinstance(briefs, list) else [],
        "decisions": decisions if isinstance(decisions, dict) else {},
        "revisions": revisions,
        "middleStepCount": len(middle),
        "missingCount": missing,
        "created": _iso(row.created_at),
        "modified": _iso(row.updated_at),
    }


@router.post("/ai/reconciliations", status_code=201)
def post_ai_reconciliation(request: Request, body: AiReconciliationCreate) -> dict[str, object]:
    from app.ai.reconciliations import (
        ANIMATABLE_PARAMS,
        SCRIPT_VERBS,
        reconcile_middle_steps,
    )

    library = _library(request)
    try:
        conversation = library.get_conversation(body.conversationId)
    except AiConversationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    if conversation.project_id != body.projectId:
        raise HTTPException(status_code=422, detail="conversation does not belong to this project")
    try:
        canonical = library.scenario_canonical_json(body.scenarioId)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="scenario not found") from exc
    except ValueError as exc:
        # Draft/rejected scenario: Stage B refuses to run.
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if str(canonical.get("projectId", "")) != body.projectId:
        raise HTTPException(status_code=422, detail="scenario does not belong to this project")

    steps = canonical.get("steps", [])
    step_list = [dict(s) for s in steps if isinstance(s, dict)] if isinstance(steps, list) else []

    # Live library state (server-side source of truth).
    asset_library = request.app.state.asset_library
    clip_library = request.app.state.clip_library
    collection_library = request.app.state.clip_collection_library
    definitions: list[dict[str, object]] = []
    for definition in asset_library.list():
        definitions.append(
            {
                "id": definition.id,
                "name": definition.name,
                "tags": list(definition.tags or []),
                "category": definition.category,
                "ai_description": definition.ai_description,
            }
        )
    clip_names = [clip.name for clip in clip_library.list_all()]
    collections: list[dict[str, object]] = []
    for collection in collection_library.list_all():
        collections.append({"name": collection.name, "bindings": dict(collection.bindings or {})})
    audio_defs = [d for d in definitions if str(d.get("category", "")) == "audio"]

    context = body.context
    context_clips = _context_list(context, "clips", "clipNames", "libraryClips")
    context_collections = _context_list(context, "clipCollections", "collections")
    embedded_audio = _context_list(context, "embeddedAudio", "audio", "audioAssets")
    animatable = _context_list(context, "animatableParams")
    script_verbs = _context_list(context, "scriptVerbs")
    style_profile: dict[str, str] | None = None
    if isinstance(context, dict) and isinstance(context.get("styleProfile"), dict):
        raw_style = context["styleProfile"]
        assert isinstance(raw_style, dict)
        name = str(raw_style.get("name", "")).strip()
        if name:
            style_profile = {
                "name": name,
                "description": str(raw_style.get("description", "")),
                "promptSuffix": str(raw_style.get("promptSuffix", "")),
            }

    motion_surface: dict[str, object] = {
        "clips": [*clip_names, *context_clips],
        "clipCollections": [
            *collections,
            *[{"name": name, "bindings": {}} for name in context_collections],
        ],
        "animatableParams": animatable or list(ANIMATABLE_PARAMS),
        "scriptVerbs": script_verbs or list(SCRIPT_VERBS),
    }

    verdicts, briefs = reconcile_middle_steps(
        steps=step_list,
        definitions=definitions,
        motion_surface=motion_surface,
        audio_definitions=audio_defs,
        embedded_audio_names=embedded_audio,
        style_profile=style_profile,
    )

    try:
        row = library.create_reconciliation(
            project_id=body.projectId,
            scenario_id=body.scenarioId,
            conversation_id=body.conversationId,
            title=str(canonical.get("title", "")),
            verdicts=[dict(v) for v in verdicts],
            briefs=[dict(b) for b in briefs],
            source_request=f"reconcile scenario {body.scenarioId}",
            source_steps=step_list,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="scenario not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    middle_count = len([v for v in verdicts if not v.get("skipped")])
    library.append_message(
        body.conversationId,
        "assistant",
        f"Reconciled {middle_count} middle steps against the live library "
        f"({len(briefs)} missing assets have image-gen briefs). "
        "Review verdicts, accept/reject/replace assets, edit briefs, then accept — "
        "Stage C waits on the accepted version. Intro/outro references were left alone.",
    )
    return _reconciliation_to_out(request, row.id)


@router.get("/ai/reconciliations")
def list_ai_reconciliations(
    request: Request, projectId: str = "", scenarioId: str | None = None
) -> list[dict[str, object]]:
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    out: list[dict[str, object]] = []
    for row in library.list_reconciliations(projectId, scenarioId or None):
        import json as _json

        try:
            loaded_verdicts: object = _json.loads(row.verdicts_json or "[]")
            middle = (
                len([v for v in loaded_verdicts if isinstance(v, dict) and not v.get("skipped")])
                if isinstance(loaded_verdicts, list)
                else 0
            )
        except (ValueError, TypeError):
            middle = 0
        out.append(
            {
                "id": row.id,
                "projectId": row.project_id,
                "scenarioId": row.scenario_id,
                "conversationId": row.conversation_id,
                "title": row.title,
                "status": row.status,
                "middleStepCount": middle,
                "modified": _iso(row.updated_at),
            }
        )
    return out


@router.get("/ai/reconciliations/{reconciliation_id}")
def get_ai_reconciliation(request: Request, reconciliation_id: str) -> dict[str, object]:
    return _reconciliation_to_out(request, reconciliation_id)


@router.get("/ai/reconciliations/{reconciliation_id}/canonical")
def get_ai_reconciliation_canonical(request: Request, reconciliation_id: str) -> dict[str, object]:
    """Stage C handoff: accepted mappings + feasibility + briefs only."""
    library = _library(request)
    try:
        return library.reconciliation_canonical_json(reconciliation_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="reconciliation not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/ai/reconciliations/{reconciliation_id}/decisions")
def post_ai_reconciliation_decision(
    request: Request, reconciliation_id: str, body: AiReconciliationDecision
) -> dict[str, object]:
    library = _library(request)
    try:
        library.get_reconciliation(reconciliation_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="reconciliation not found") from exc
    if body.decision == "accept":
        if not (body.definitionId or "").strip():
            raise HTTPException(
                status_code=422,
                detail="accept requires a definitionId (any ranked or alternative candidate)",
            )
        definition_id = (body.definitionId or "").strip()
        if not definition_id.startswith("embedded:"):
            asset_library = request.app.state.asset_library
            try:
                asset_library.get(definition_id)
            except Exception as exc:
                raise HTTPException(status_code=422, detail="definitionId does not exist") from exc
    try:
        library.record_reconciliation_decision(
            reconciliation_id,
            step_id=body.stepId,
            hint=body.hint,
            decision=body.decision,
            definition_id=body.definitionId,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="reconciliation not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _reconciliation_to_out(request, reconciliation_id)


@router.delete("/ai/reconciliations/{reconciliation_id}/decisions", status_code=200)
def delete_ai_reconciliation_decision(
    request: Request, reconciliation_id: str, stepId: str = "", hint: str = ""
) -> dict[str, object]:
    if not stepId.strip() or not hint.strip():
        raise HTTPException(status_code=422, detail="stepId and hint are required")
    library = _library(request)
    try:
        library.clear_reconciliation_decision(reconciliation_id, step_id=stepId, hint=hint)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="reconciliation not found") from exc
    return _reconciliation_to_out(request, reconciliation_id)


@router.patch("/ai/reconciliations/{reconciliation_id}")
def patch_ai_reconciliation(
    request: Request, reconciliation_id: str, body: AiReconciliationUpdate
) -> dict[str, object]:
    library = _library(request)
    try:
        library.get_reconciliation(reconciliation_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="reconciliation not found") from exc
    if body.title is not None and not body.title.strip():
        raise HTTPException(status_code=422, detail="title must be a non-empty string")
    if body.briefs is not None:
        patches: list[dict[str, object]] = []
        for brief in body.briefs:
            item: dict[str, object] = {"id": brief.id}
            if brief.prompt is not None:
                item["prompt"] = brief.prompt
            if brief.name is not None:
                item["name"] = brief.name
            if brief.note is not None:
                item["note"] = brief.note
            if brief.variants is not None:
                variants: dict[str, object] = {}
                if brief.variants.detailed is not None:
                    variants["detailed"] = brief.variants.detailed
                if brief.variants.concise is not None:
                    variants["concise"] = brief.variants.concise
                if brief.variants.stylized is not None:
                    variants["stylized"] = brief.variants.stylized
                item["variants"] = variants
            if brief.styleProfile is not None:
                item["styleProfile"] = dict(brief.styleProfile)
            patches.append(item)
        try:
            library.update_reconciliation_briefs(reconciliation_id, briefs=patches)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="reconciliation not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _reconciliation_to_out(request, reconciliation_id)


@router.post("/ai/reconciliations/{reconciliation_id}/accept")
def accept_ai_reconciliation(request: Request, reconciliation_id: str) -> dict[str, object]:
    library = _library(request)
    try:
        library.set_reconciliation_status(reconciliation_id, "accepted")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="reconciliation not found") from exc
    return _reconciliation_to_out(request, reconciliation_id)


@router.post("/ai/reconciliations/{reconciliation_id}/reject")
def reject_ai_reconciliation(request: Request, reconciliation_id: str) -> dict[str, object]:
    library = _library(request)
    try:
        library.set_reconciliation_status(reconciliation_id, "rejected")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="reconciliation not found") from exc
    return _reconciliation_to_out(request, reconciliation_id)


# -- narrations (Stage C) ------------------------------------------------------


def _narration_to_out(request: Request, narration_id: str) -> dict[str, object]:
    import json as _json

    from app.ai.narrations import slide_duration_for_parts

    library = _library(request)
    try:
        row = library.get_narration(narration_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    try:
        parts: object = _json.loads(row.parts_json or "[]")
    except (ValueError, TypeError):
        parts = []
    part_list = [dict(p) for p in parts] if isinstance(parts, list) else []
    revisions = [
        {
            "id": rev.id,
            "sourceRequest": rev.source_request,
            "created": _iso(rev.created_at),
        }
        for rev in library.list_narration_revisions(narration_id)
    ]
    return {
        "id": row.id,
        "projectId": row.project_id,
        "reconciliationId": row.reconciliation_id,
        "scenarioId": row.scenario_id,
        "conversationId": row.conversation_id,
        "title": row.title,
        "status": row.status,
        "defaultVoicePromptId": row.default_voice_prompt_id,
        "secondsPerCharacter": row.seconds_per_character,
        "parts": part_list,
        "slideDuration": slide_duration_for_parts(part_list),
        "revisions": revisions,
        "created": _iso(row.created_at),
        "modified": _iso(row.updated_at),
    }


def _require_voice_prompt(request: Request, prompt_id: str) -> None:
    prompt_library = getattr(request.app.state, "voice_prompt_library", None)
    if prompt_library is None:
        raise HTTPException(status_code=500, detail="voice prompt library is not configured")
    try:
        prompt_library.get(prompt_id)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"voice prompt {prompt_id} not found") from exc


@router.post("/ai/narrations", status_code=201)
def post_ai_narration(request: Request, body: AiNarrationCreate) -> dict[str, object]:
    from app.ai.narrations import DEFAULT_SECONDS_PER_CHARACTER, verbatim_parts_from_steps

    library = _library(request)
    try:
        conversation = library.get_conversation(body.conversationId)
    except AiConversationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    if conversation.project_id != body.projectId:
        raise HTTPException(status_code=422, detail="conversation does not belong to this project")
    if body.defaultVoicePromptId and body.defaultVoicePromptId.strip():
        _require_voice_prompt(request, body.defaultVoicePromptId.strip())
    try:
        reconciliation = library.get_reconciliation(body.reconciliationId)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="reconciliation not found") from exc
    if reconciliation.status != "accepted":
        raise HTTPException(
            status_code=409,
            detail=(
                f"reconciliation {body.reconciliationId} is {reconciliation.status} — "
                "accept it before Prompter work (Stage C reads only the accepted version)"
            ),
        )
    if reconciliation.project_id != body.projectId:
        raise HTTPException(
            status_code=422, detail="reconciliation does not belong to this project"
        )
    try:
        canonical = library.scenario_canonical_json(reconciliation.scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="scenario not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    steps = canonical.get("steps", [])
    step_list = [dict(s) for s in steps if isinstance(s, dict)] if isinstance(steps, list) else []
    spc = body.secondsPerCharacter or DEFAULT_SECONDS_PER_CHARACTER
    try:
        parts = verbatim_parts_from_steps(step_list, spc)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        row = library.create_narration(
            project_id=body.projectId,
            reconciliation_id=body.reconciliationId,
            conversation_id=body.conversationId,
            title=reconciliation.title,
            parts=[dict(p) for p in parts],
            seconds_per_character=spc,
            default_voice_prompt_id=(
                body.defaultVoicePromptId.strip() if body.defaultVoicePromptId else None
            ),
            source_request=f"fill prompter from reconciliation {body.reconciliationId}",
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="reconciliation not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    library.append_message(
        body.conversationId,
        "assistant",
        f"Filled {len(parts)} PrompterParts verbatim from the accepted scenario "
        f"(pre-TTS estimate {spc} s/char). Run the queued voice batch, embed each WAV, "
        "then propose through the canonical pipeline — the project is untouched. "
        "Rerecord stays manual in the existing TTS/record modals.",
    )
    return _narration_to_out(request, row.id)


@router.get("/ai/narrations")
def list_ai_narrations(
    request: Request, projectId: str = "", reconciliationId: str | None = None
) -> list[dict[str, object]]:
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    out: list[dict[str, object]] = []
    for row in library.list_narrations(projectId, reconciliationId or None):
        import json as _json

        try:
            loaded: object = _json.loads(row.parts_json or "[]")
            count = len(loaded) if isinstance(loaded, list) else 0
        except (ValueError, TypeError):
            count = 0
        out.append(
            {
                "id": row.id,
                "projectId": row.project_id,
                "reconciliationId": row.reconciliation_id,
                "conversationId": row.conversation_id,
                "title": row.title,
                "status": row.status,
                "partCount": count,
                "modified": _iso(row.updated_at),
            }
        )
    return out


@router.get("/ai/narrations/{narration_id}")
def get_ai_narration(request: Request, narration_id: str) -> dict[str, object]:
    return _narration_to_out(request, narration_id)


@router.get("/ai/narrations/{narration_id}/canonical")
def get_ai_narration_canonical(request: Request, narration_id: str) -> dict[str, object]:
    """Stage D/E handoff: accepted timings + audio bindings only."""
    library = _library(request)
    try:
        return library.narration_canonical_json(narration_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch("/ai/narrations/{narration_id}")
def patch_ai_narration(
    request: Request, narration_id: str, body: AiNarrationVoicePatch
) -> dict[str, object]:
    library = _library(request)
    try:
        library.get_narration(narration_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    fields_set = body.model_fields_set
    default_id: str | None = None
    update_default = "defaultVoicePromptId" in fields_set
    if update_default and body.defaultVoicePromptId and body.defaultVoicePromptId.strip():
        default_id = body.defaultVoicePromptId.strip()
        _require_voice_prompt(request, default_id)
    if body.partVoices:
        for override in body.partVoices.values():
            if override and override.strip():
                _require_voice_prompt(request, override.strip())
    try:
        library.set_narration_voices(
            narration_id,
            default_voice_prompt_id=default_id,
            update_default=update_default,
            part_voices=dict(body.partVoices) if body.partVoices else None,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _narration_to_out(request, narration_id)


def _resolve_narration_tts_call(
    request: Request, narration: dict[str, object], part: dict[str, object]
) -> tuple[str | None, str | None, str | None, dict[str, Any] | None, str, str]:
    """Voice merge for one part: per-part override wins over the reusable default.

    Same prompt-merge semantics as POST /api/tts/generate (prompt fields fill
    what the record leaves unset); returns
    (language, voice, instruction, params, provider, model_id).
    """
    from app.tts.registry import DEFAULT_MODEL_ID, DEFAULT_PROVIDER

    settings = getattr(request.app.state, "settings", None)
    global_provider = (
        getattr(settings, "tts_provider", DEFAULT_PROVIDER) if settings else DEFAULT_PROVIDER
    )
    global_model = (
        getattr(settings, "tts_model_id", DEFAULT_MODEL_ID) if settings else DEFAULT_MODEL_ID
    )
    prompt_library = getattr(request.app.state, "voice_prompt_library", None)
    prompt_id = part.get("voicePromptId") or narration.get("defaultVoicePromptId")
    language: str | None = None
    voice: str | None = None
    instruction: str | None = None
    params: dict[str, Any] | None = None
    provider: str | None = None
    model_id: str | None = None
    if prompt_id and prompt_library is not None:
        try:
            prompt = prompt_library.get(str(prompt_id))
        except Exception as exc:
            raise LookupError(f"voice prompt {prompt_id} not found") from exc
        language = prompt.language
        voice = prompt.voice
        instruction = prompt.instruction
        params = dict(prompt.params) if isinstance(prompt.params, dict) else None
        provider = getattr(prompt, "provider", None)
        model_id = getattr(prompt, "model_id", None)
        if not provider and isinstance(prompt.params, dict):
            maybe = prompt.params.get("provider")
            if isinstance(maybe, str) and maybe.strip():
                provider = maybe.strip().lower()
        if not model_id and isinstance(prompt.params, dict):
            maybe_model = prompt.params.get("modelId") or prompt.params.get("model_id")
            if isinstance(maybe_model, str) and maybe_model.strip():
                model_id = maybe_model.strip()
    return (
        language,
        voice,
        instruction,
        params,
        (
            provider.strip().lower()
            if isinstance(provider, str) and provider.strip()
            else global_provider
        ),
        (model_id.strip() if isinstance(model_id, str) and model_id.strip() else global_model),
    )


@router.post("/ai/narrations/{narration_id}/generate")
async def post_ai_narration_generate(request: Request, narration_id: str) -> dict[str, object]:
    """Queued server-side TTS batch: one serialized generate per pending part.

    Runs through the existing TTS inference lock (never parallel-bursts) with
    one reusable Voice Prompt by default (overridable per part). Returns the
    WAV payloads for the client to embed first — proposals later reference
    asset ids only. Progress is reported through the Conversation (the
    existing chat transport); no new TTS/Prompter endpoints are added.
    """
    import asyncio
    import base64 as _base64

    from app.ai.narrations import wav_duration
    from app.api.tts import _tts_lock

    library = _library(request)
    try:
        row = library.get_narration(narration_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    import json as _json

    try:
        loaded: object = _json.loads(row.parts_json or "[]")
        parts = [dict(p) for p in loaded] if isinstance(loaded, list) else []
    except (ValueError, TypeError):
        parts = []
    narration_view = _narration_to_out(request, narration_id)
    todo = [p for p in parts if p.get("status") != "ready"]
    if not todo:
        return {"narration": narration_view, "results": []}

    try:
        from app.tts.engine import get_tts_engine
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"TTS engine is not available: {exc}") from exc

    results: list[dict[str, object]] = []
    adopted: dict[str, float] = {}

    def _ok_result(step_id: str, wav_bytes: bytes, duration: float) -> dict[str, object]:
        adopted[step_id] = duration
        return {
            "stepId": step_id,
            "ok": True,
            "audioDuration": duration,
            "mimeType": "audio/wav",
            "wavData": _base64.b64encode(wav_bytes).decode("ascii"),
        }

    # Batch progress travels over the existing chat transport: a start note
    # when the queued run begins, per-part outcome in the finish note.
    library.append_message(
        row.conversation_id,
        "assistant",
        f"Voice batch started for {len(todo)} part(s) through the queued voice — "
        "one reusable prompt by default, per-part overrides where set.",
    )
    async with _tts_lock:
        await asyncio.sleep(0.01)
        for part in todo:
            step_id = str(part.get("stepId", ""))
            spoken = str(part.get("spokenLine", ""))
            if not spoken:
                library.report_narration_part_failed(
                    narration_id, step_id=step_id, error="empty spoken line"
                )
                results.append({"stepId": step_id, "ok": False, "error": "empty spoken line"})
                continue
            try:
                language, voice, instruction, params, provider, model_id = (
                    _resolve_narration_tts_call(request, narration_view, part)
                )
                engine = get_tts_engine(provider=provider, model_id=model_id)
                try:
                    request.app.state.tts_engine = engine
                except Exception:
                    pass
                wav_bytes: bytes = await asyncio.to_thread(
                    engine.generate, spoken, language, voice, instruction, params
                )
                duration = wav_duration(wav_bytes)
                if duration is None or duration <= 0:
                    raise RuntimeError("generated WAV has no measurable duration")
                results.append(_ok_result(step_id, wav_bytes, duration))
            except LookupError as exc:
                library.report_narration_part_failed(narration_id, step_id=step_id, error=str(exc))
                results.append({"stepId": step_id, "ok": False, "error": str(exc)})
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
                library.report_narration_part_failed(narration_id, step_id=step_id, error=detail)
                results.append({"stepId": step_id, "ok": False, "error": detail})
            except Exception as exc:
                from app.tts.engine import (
                    MlxNotAvailableError,
                    TtsInferenceError,
                    TtsModelLoadError,
                )

                if isinstance(exc, MlxNotAvailableError):
                    try:
                        from app.tts.engine import SineTtsEngine

                        fallback = SineTtsEngine()
                        wav_bytes = fallback.generate(spoken, None, None, None, None)
                        duration = wav_duration(wav_bytes)
                        if duration is None or duration <= 0:
                            raise RuntimeError("fallback WAV has no measurable duration")
                        results.append(_ok_result(step_id, wav_bytes, duration))
                        continue
                    except Exception as fallback_exc:
                        message = str(fallback_exc)
                elif isinstance(exc, (TtsModelLoadError, TtsInferenceError)):
                    message = str(exc)
                else:
                    message = f"TTS generation failed: {exc}"
                library.report_narration_part_failed(narration_id, step_id=step_id, error=message)
                results.append({"stepId": step_id, "ok": False, "error": message})
    if adopted:
        library.record_narration_durations(narration_id, adopted)
    failed = [res for res in results if not res.get("ok")]
    if failed:
        summary = (
            f"Voice batch finished with {len(failed)} failed part(s): "
            + "; ".join(f"{r.get('stepId')}: {r.get('error')}" for r in failed)
            + " — failed parts are marked stale; retry each part, then accept."
        )
    else:
        summary = (
            f"Voice batch finished: {len(results)} part(s) generated through the queued "
            "voice. Embed each WAV first, report the asset ids, then propose through "
            "the canonical pipeline — audio timing is adopted, never stretched."
        )
    library.append_message(row.conversation_id, "assistant", summary)
    return {"narration": _narration_to_out(request, narration_id), "results": results}


@router.post("/ai/narrations/{narration_id}/parts/{step_id}/ready")
def post_ai_narration_part_ready(
    request: Request, narration_id: str, step_id: str, body: AiNarrationPartReady
) -> dict[str, object]:
    library = _library(request)
    try:
        library.get_narration(narration_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    try:
        library.report_narration_part_ready(
            narration_id,
            step_id=step_id,
            asset_id=body.assetId,
            audio_duration=body.audioDuration,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _narration_to_out(request, narration_id)


@router.post("/ai/narrations/{narration_id}/parts/{step_id}/fail")
def post_ai_narration_part_fail(
    request: Request, narration_id: str, step_id: str, body: AiNarrationPartFail
) -> dict[str, object]:
    library = _library(request)
    try:
        library.report_narration_part_failed(narration_id, step_id=step_id, error=body.error)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _narration_to_out(request, narration_id)


@router.post("/ai/narrations/{narration_id}/parts/{step_id}/retry")
def post_ai_narration_part_retry(
    request: Request, narration_id: str, step_id: str
) -> dict[str, object]:
    library = _library(request)
    try:
        library.retry_narration_part(narration_id, step_id=step_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _narration_to_out(request, narration_id)


@router.post("/ai/narrations/{narration_id}/accept")
def accept_ai_narration(request: Request, narration_id: str) -> dict[str, object]:
    library = _library(request)
    try:
        library.set_narration_status(narration_id, "accepted")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    out = _narration_to_out(request, narration_id)
    library.append_message(
        str(out["conversationId"]),
        "assistant",
        "Narration accepted — PrompterPart timings and voice bindings are now the "
        "timing source for calibration and board scripts. Rerecord stays manual "
        "in the existing TTS/record modals.",
    )
    return out


@router.post("/ai/narrations/{narration_id}/reject")
def reject_ai_narration(request: Request, narration_id: str) -> dict[str, object]:
    library = _library(request)
    try:
        library.set_narration_status(narration_id, "rejected")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _narration_to_out(request, narration_id)


# -- calibrations (Stage D) --------------------------------------------------


def _calibration_to_out(request: Request, calibration_id: str) -> dict[str, object]:
    import json as _json

    from app.ai.calibrations import calibration_accept_blockers

    library = _library(request)
    try:
        row = library.get_calibration(calibration_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="calibration not found") from exc
    try:
        checks: object = _json.loads(row.checks_json or "{}")
    except (ValueError, TypeError):
        checks = {}
    try:
        timings: object = _json.loads(row.timings_json or "[]")
    except (ValueError, TypeError):
        timings = []
    try:
        phoneme_map: object = _json.loads(row.phoneme_map_json or "{}")
    except (ValueError, TypeError):
        phoneme_map = {}
    revisions = [
        {
            "id": rev.id,
            "sourceRequest": rev.source_request,
            "created": _iso(rev.created_at),
        }
        for rev in library.list_calibration_revisions(calibration_id)
    ]
    timing_list = [dict(t) for t in timings] if isinstance(timings, list) else []
    checks_dict = dict(checks) if isinstance(checks, dict) else {}
    blockers = calibration_accept_blockers({"checks": checks_dict, "timings": timing_list})
    fallback_count = len([t for t in timing_list if isinstance(t, dict) and t.get("fallback")])
    return {
        "id": row.id,
        "projectId": row.project_id,
        "narrationId": row.narration_id,
        "scenarioId": row.scenario_id,
        "conversationId": row.conversation_id,
        "title": row.title,
        "status": row.status,
        "introRef": row.intro_ref,
        "outroRef": row.outro_ref,
        "phonemeMap": phoneme_map if isinstance(phoneme_map, dict) else {},
        "checks": checks_dict,
        "timings": timing_list,
        "blockers": blockers,
        "fallbackCount": fallback_count,
        "revisions": revisions,
        "created": _iso(row.created_at),
        "modified": _iso(row.updated_at),
    }


@router.post("/ai/calibrations", status_code=201)
def post_ai_calibration(request: Request, body: AiCalibrationCreate) -> dict[str, object]:
    from app.ai.calibrations import (
        intro_outro_steps_from_scenario,
        measure_wav,
        verify_camera_framing,
        verify_face_rig,
        verify_voice_reuse,
    )

    library = _library(request)
    try:
        conversation = library.get_conversation(body.conversationId)
    except AiConversationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    if conversation.project_id != body.projectId:
        raise HTTPException(status_code=422, detail="conversation does not belong to this project")
    try:
        narration = library.get_narration(body.narrationId)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    if narration.status != "accepted":
        raise HTTPException(
            status_code=409,
            detail=(
                f"narration {body.narrationId} is {narration.status} — "
                "accept it before calibration/board work (Stages D/E read only "
                "the accepted version)"
            ),
        )
    if narration.project_id != body.projectId:
        raise HTTPException(status_code=422, detail="narration does not belong to this project")
    try:
        canonical = library.scenario_canonical_json(narration.scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="scenario not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    steps = canonical.get("steps", [])
    step_list = [dict(s) for s in steps if isinstance(s, dict)] if isinstance(steps, list) else []
    try:
        base_timings = intro_outro_steps_from_scenario(step_list)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Pregen measurement input: [{stepId, wavData?/audioDuration?, level?}].
    # Verify-only: measure durations/levels where WAV bytes are supplied,
    # otherwise adopt the supplied durations. Without either, record a flat
    # clearly-unmeasured estimate (measured False) so the record stays
    # creatable without shipping real pregen projects — never char-proportional
    # mouth timing (mouth uses aligner words or the envelope fallback only).
    # Never rewrites audio.
    import base64 as _base64

    pregen_in = list(body.pregen or [])
    pregen_measured: list[dict[str, object]] = []
    for timing in base_timings:
        step_id = str(timing["stepId"])
        supplied = next(
            (p for p in pregen_in if isinstance(p, dict) and str(p.get("stepId")) == step_id),
            None,
        )
        duration: float | None = None
        level: float | None = None
        measured = False
        if supplied is not None:
            raw_duration = supplied.get("audioDuration")
            if isinstance(raw_duration, (int, float)) and float(raw_duration) > 0:
                duration = float(raw_duration)
                measured = True
            raw_level = supplied.get("level")
            if isinstance(raw_level, (int, float)):
                level = float(raw_level)
            wav_data = supplied.get("wavData")
            if isinstance(wav_data, str) and wav_data.strip():
                try:
                    wav_bytes = _base64.b64decode(wav_data)
                except Exception:
                    wav_bytes = b""
                measured_duration, measured_level = measure_wav(wav_bytes)
                if measured_duration is not None:
                    duration = measured_duration
                    measured = True
                if measured_level is not None:
                    level = measured_level
        if duration is None:
            duration = 2.0
        timing["audioDuration"] = duration
        timing["level"] = level if level is not None else 0.5
        timing["measured"] = measured
        pregen_measured.append(
            {
                "stepId": step_id,
                "audioDuration": timing["audioDuration"],
                "level": timing["level"],
            }
        )

    phoneme_map = dict(body.phonemeMap or {})
    voice_check = verify_voice_reuse(
        narration.default_voice_prompt_id, body.voicePromptId, pregen_measured
    )
    face_check = verify_face_rig(body.mouthShapes, body.morphBinding)
    camera_keys_in = [dict(k) for k in (body.cameraKeys or [])]
    camera_check = verify_camera_framing(
        body.cameraCount if body.cameraCount is not None else 1,
        camera_keys_in,
    )
    # Persist the reviewed keys so the merge handoff carries them.
    camera_check["keys"] = camera_keys_in
    checks: dict[str, object] = {
        "voice": voice_check,
        "faceRig": face_check,
        "camera": camera_check,
    }
    try:
        row = library.create_calibration(
            project_id=body.projectId,
            narration_id=body.narrationId,
            conversation_id=body.conversationId,
            title=narration.title,
            intro_ref=body.introRef or "",
            outro_ref=body.outroRef or "",
            phoneme_map=phoneme_map,
            checks=checks,
            timings=[dict(t) for t in base_timings],
            source_request=f"calibrate narration {body.narrationId}",
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="narration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    library.append_message(
        body.conversationId,
        "assistant",
        f"Calibrated {len(base_timings)} intro/outro parts verify-only "
        "(voice reuse + face-rig readiness + camera framing). Mouth timing waits "
        "on forced-alignment words with a marked envelope fallback — the rig, "
        "audio, and bindings are untouched. Accept feeds the merge.",
    )
    return _calibration_to_out(request, row.id)


@router.get("/ai/calibrations")
def list_ai_calibrations(
    request: Request, projectId: str = "", narrationId: str | None = None
) -> list[dict[str, object]]:
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    out: list[dict[str, object]] = []
    for row in library.list_calibrations(projectId, narrationId or None):
        import json as _json

        try:
            loaded: object = _json.loads(row.timings_json or "[]")
            count = len(loaded) if isinstance(loaded, list) else 0
        except (ValueError, TypeError):
            count = 0
        out.append(
            {
                "id": row.id,
                "projectId": row.project_id,
                "narrationId": row.narration_id,
                "conversationId": row.conversation_id,
                "title": row.title,
                "status": row.status,
                "partCount": count,
                "modified": _iso(row.updated_at),
            }
        )
    return out


@router.get("/ai/calibrations/{calibration_id}")
def get_ai_calibration(request: Request, calibration_id: str) -> dict[str, object]:
    return _calibration_to_out(request, calibration_id)


@router.get("/ai/calibrations/{calibration_id}/canonical")
def get_ai_calibration_canonical(request: Request, calibration_id: str) -> dict[str, object]:
    """Merge handoff: rig-readiness refs + word-timing map + camera keys, accepted only."""
    library = _library(request)
    try:
        return library.calibration_canonical_json(calibration_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="calibration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/ai/calibrations/{calibration_id}/parts/{step_id}/align")
def post_ai_calibration_align(
    request: Request, calibration_id: str, step_id: str, body: AiCalibrationAlign
) -> dict[str, object]:
    library = _library(request)
    try:
        library.get_calibration(calibration_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="calibration not found") from exc
    try:
        library.record_calibration_words(
            calibration_id,
            step_id=step_id,
            words=[
                {
                    "word": w.word,
                    "start": w.start,
                    "end": w.end,
                    **({"phoneme": w.phoneme} if w.phoneme else {}),
                }
                for w in body.words
            ],
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="calibration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _calibration_to_out(request, calibration_id)


@router.post("/ai/calibrations/{calibration_id}/parts/{step_id}/fallback")
def post_ai_calibration_fallback(
    request: Request, calibration_id: str, step_id: str, body: AiCalibrationFallback
) -> dict[str, object]:
    library = _library(request)
    try:
        library.get_calibration(calibration_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="calibration not found") from exc
    try:
        library.record_calibration_fallback(
            calibration_id,
            step_id=step_id,
            peaks=list(body.peaks),
            audio_duration=body.audioDuration,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="calibration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out = _calibration_to_out(request, calibration_id)
    library.append_message(
        str(out["conversationId"]),
        "assistant",
        f"Part {step_id}: forced alignment unavailable — envelope fallback recorded, "
        "driving the single Open coefficient (clearly marked, still accept-ready).",
    )
    return out


@router.post("/ai/calibrations/{calibration_id}/accept")
def accept_ai_calibration(request: Request, calibration_id: str) -> dict[str, object]:
    library = _library(request)
    try:
        library.set_calibration_status(calibration_id, "accepted")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="calibration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    out = _calibration_to_out(request, calibration_id)
    library.append_message(
        str(out["conversationId"]),
        "assistant",
        "Calibration accepted — verify-only triple check green, mouth timing mapped "
        "through the rig-local phoneme map (fallback marked where used). "
        "Hands the timing map to the merge.",
    )
    return out


@router.post("/ai/calibrations/{calibration_id}/reject")
def reject_ai_calibration(request: Request, calibration_id: str) -> dict[str, object]:
    library = _library(request)
    try:
        library.set_calibration_status(calibration_id, "rejected")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="calibration not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _calibration_to_out(request, calibration_id)


# -- edit proposals ------------------------------------------------------


def _proposal_to_out(request: Request, proposal_id: str) -> dict[str, object]:
    import json as _json

    library = _library(request)
    try:
        row = library.get_proposal(proposal_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="proposal not found") from exc
    try:
        commands: object = _json.loads(row.commands_json or "[]")
    except (ValueError, TypeError):
        commands = []
    try:
        validation: object = _json.loads(row.validation_json or "{}")
    except (ValueError, TypeError):
        validation = {"ok": False, "errors": []}
    try:
        dry_run: object = _json.loads(row.dry_run_json or "{}")
    except (ValueError, TypeError):
        dry_run = {}
    try:
        selected: object = _json.loads(row.selected_indexes_json or "[]")
    except (ValueError, TypeError):
        selected = []
    executions = [
        {
            "id": e.id,
            "executedIndexes": _json.loads(e.executed_indexes_json or "[]"),
            "historyEntryId": e.history_entry_id,
            "success": bool(e.success),
            "error": e.error,
            "created": _iso(e.created_at),
        }
        for e in library.list_proposal_executions(proposal_id)
    ]
    return {
        "id": row.id,
        "projectId": row.project_id,
        "conversationId": row.conversation_id,
        "title": row.title,
        "status": row.status,
        "commands": commands if isinstance(commands, list) else [],
        "validation": validation if isinstance(validation, dict) else {},
        "baseFingerprint": row.base_fingerprint,
        "validatedFingerprint": row.validated_fingerprint,
        "dryRun": dry_run if isinstance(dry_run, dict) else {},
        "selectedIndexes": selected if isinstance(selected, list) else [],
        "executions": executions,
        "created": _iso(row.created_at),
        "modified": _iso(row.updated_at),
    }


@router.post("/ai/proposals", status_code=201)
def post_ai_proposal(request: Request, body: AiProposalCreate) -> dict[str, object]:
    library = _library(request)
    if not body.projectFingerprint.strip():
        raise HTTPException(status_code=422, detail="projectFingerprint is required")
    commands = [dict(c) for c in body.commands]
    try:
        row = library.create_proposal(
            project_id=body.projectId,
            conversation_id=body.conversationId,
            title=body.title or "",
            commands=commands,
            project_fingerprint=body.projectFingerprint,
        )
    except AiConversationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="conversation not found") from exc
    return _proposal_to_out(request, row.id)


@router.get("/ai/proposals")
def list_ai_proposals(request: Request, projectId: str = "") -> list[dict[str, object]]:
    if not projectId.strip():
        raise HTTPException(status_code=422, detail="projectId is required")
    library = _library(request)
    return [_proposal_to_out(request, row.id) for row in library.list_proposals(projectId)]


@router.get("/ai/proposals/{proposal_id}")
def get_ai_proposal(request: Request, proposal_id: str) -> dict[str, object]:
    return _proposal_to_out(request, proposal_id)


@router.post("/ai/proposals/{proposal_id}/dry-run")
def post_ai_proposal_dry_run(
    request: Request, proposal_id: str, body: AiProposalDryRun
) -> dict[str, object]:
    library = _library(request)
    try:
        row = library.report_dry_run(
            proposal_id,
            project_fingerprint=body.projectFingerprint,
            ok=body.ok,
            errors=[dict(e) for e in body.errors],
            validated_indexes=(
                list(body.validatedIndexes) if body.validatedIndexes is not None else None
            ),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="proposal not found") from exc
    return _proposal_to_out(request, row.id)


@router.post("/ai/proposals/{proposal_id}/approve")
def post_ai_proposal_approve(
    request: Request, proposal_id: str, body: AiProposalApprove
) -> dict[str, object]:
    library = _library(request)
    try:
        row, subset = library.approve_proposal(
            proposal_id,
            current_fingerprint=body.currentFingerprint,
            selected_indexes=body.selectedIndexes,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="proposal not found") from exc
    except StaleProposalError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out = _proposal_to_out(request, row.id)
    out["executableCommands"] = subset
    return out


@router.post("/ai/proposals/{proposal_id}/execute")
def post_ai_proposal_execute(
    request: Request, proposal_id: str, body: AiProposalExecute
) -> dict[str, object]:
    library = _library(request)
    try:
        row = library.record_execution(
            proposal_id,
            history_entry_id=body.historyEntryId,
            executed_indexes=list(body.executedIndexes),
            success=body.success,
            error=body.error or "",
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="proposal not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _proposal_to_out(request, row.id)
