"""Append-only failure log for AI provider requests.

Every AI endpoint that calls the inference provider can fail in ways that are
invisible after the fact: the HTTP response carries only ``{"code", "message"}``
and the terminal scrolls past. This module persists one redacted JSON object per
line to ``<data_dir>/ai_provider_failures.jsonl`` so a 502/409 can be diagnosed
later with ``tail`` / ``grep``.

Redaction rules (keep them):
- Never log API keys, auth headers, full prompts, or full context snapshots.
- Provider bodies are truncated to 2000 chars; message excerpts to 500 chars.
- The endpoint URL host is safe to log; query strings are stripped.

Logging is best-effort: a logging failure must never break the request path.
"""

from __future__ import annotations

import json
import logging
import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

LOG_FILENAME = "ai_provider_failures.jsonl"
MAX_BODY_CHARS = 2000
MAX_EXCERPT_CHARS = 500


def _truncate(value: object, limit: int) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    if len(text) > limit:
        return text[:limit] + f"…[truncated {len(text) - limit} chars]"
    return text


def _safe_endpoint(endpoint: str) -> str:
    """Host + path only — strip any query string that could carry secrets."""
    base = endpoint.split("?")[0][:200]
    parsed = urlparse(base)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    return base


def log_ai_failure(
    data_dir: Path,
    *,
    operation: str,
    code: str,
    http_status: int,
    model: str = "",
    endpoint: str = "",
    provider_status: int | None = None,
    provider_body: str = "",
    message_excerpt: str = "",
    project_id: str = "",
    conversation_id: str = "",
    message_id: str = "",
    extra: dict[str, Any] | None = None,
) -> str:
    """Append one failure event, return its log id for response correlation.

    Always returns a log id, even when the file write fails (the terminal
    warning still carries it).
    """
    log_id = f"{operation.split('/')[-1]}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(3)}"
    event: dict[str, Any] = {
        "ts": datetime.now(UTC).isoformat(),
        "logId": log_id,
        "operation": operation,
        "code": code,
        "httpStatus": http_status,
        "model": model,
        "endpoint": _safe_endpoint(endpoint),
        "projectId": project_id,
        "conversationId": conversation_id,
        "messageId": message_id,
    }
    if provider_status is not None:
        event["providerStatus"] = provider_status
    if provider_body:
        event["providerBodySnippet"] = _truncate(provider_body, MAX_BODY_CHARS)
    if message_excerpt:
        event["messageExcerpt"] = _truncate(message_excerpt, MAX_EXCERPT_CHARS)
    if extra:
        event["extra"] = extra
    logger.warning(
        "ai failure %s op=%s code=%s http=%d model=%s provider_status=%s body=%.200s",
        log_id,
        operation,
        code,
        http_status,
        model,
        provider_status,
        provider_body.replace("\n", " ") if provider_body else "",
    )
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        with open(data_dir / LOG_FILENAME, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, default=str) + "\n")
    except Exception as exc:  # noqa: BLE001 - logging must never break requests
        logger.warning("ai failure log write failed (%s): %s", log_id, exc)
    return log_id
