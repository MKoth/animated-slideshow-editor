"""Scenario request route cluster seam (issue #460 prefactor).

Small owner for the scenario HTTP surface. Later scenario markdown tickets
(notably #461-#464) land here plus new scenario modules, without edits
inside the current god owner (`app/api/ai.py`).

No behaviour change in this ticket: canonical logic moved verbatim,
`ai.py` keeps thin delegation via `_generate_scenario_structured` /
`_scenario_to_out` wrappers and includes `router` for future endpoints
(markdown versions, etc.). `router` is intentionally empty in this ticket;
its inclusion is the seam future tickets build on.
"""

from __future__ import annotations

import json as _json
import logging
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter

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
