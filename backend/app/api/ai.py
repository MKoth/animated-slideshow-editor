# ruff: noqa: BLE001, S110
from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.ai.library import AiConversationNotFoundError, AiLibrary, AiSecretMissingError
from app.ai.plans import (
    PLAN_JSON_SCHEMA,
    apply_user_edits_preservation,
    build_plan_user_text,
    parse_and_validate_plan,
)
from app.ai.prompting import ChatMessage, compose_messages, context_to_text, estimate_tokens
from app.ai.schemas import (
    AiChatRequest,
    AiConversationCreate,
    AiConversationRename,
    AiPlanCreate,
    AiPlanUpdate,
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
