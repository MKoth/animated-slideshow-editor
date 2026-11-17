"""Persist Cartesia word-alignment failures for diagnosis after HTTP 422s."""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
LOG_FILENAME = "tts_alignment_failures.jsonl"
HISTORY_FILENAME = "tts_cartesia_history.jsonl"
HISTORY_MAX_BYTES = 8 * 1024 * 1024
HISTORY_BACKUPS = 3


def _without_audio(value: Any) -> Any:
    """Remove audio/binary payload fields while preserving response JSON."""
    if isinstance(value, dict):
        return {
            key: _without_audio(item)
            for key, item in value.items()
            if key.lower() not in {"audio", "audio_data", "pcm", "pcm_data", "base64"}
        }
    if isinstance(value, list):
        return [_without_audio(item) for item in value]
    return value


def _rotate_history(path: Path) -> None:
    oldest = path.with_name(f"{path.name}.{HISTORY_BACKUPS}")
    oldest.unlink(missing_ok=True)
    for index in range(HISTORY_BACKUPS - 1, 0, -1):
        source = path.with_name(f"{path.name}.{index}")
        if source.exists():
            os.replace(source, path.with_name(f"{path.name}.{index + 1}"))
    if path.exists():
        os.replace(path, path.with_name(f"{path.name}.1"))


def log_cartesia_response(
    data_dir: Path,
    *,
    request_text: str,
    model: str,
    http_status: int | None,
    content_type: str = "",
    response_body: bytes = b"",
    request_error: str | None = None,
) -> Path | None:
    """Persist request text and non-audio Cartesia response JSON for recent history."""
    events: list[Any] = []
    parse_errors: list[dict[str, Any]] = []
    response_json: Any = None
    response_text: str | None = None

    try:
        decoded = response_body.decode("utf-8") if response_body else ""
        for line_number, line in enumerate(decoded.splitlines(), start=1):
            stripped = line.strip()
            if not stripped.startswith("data:"):
                continue
            payload = stripped[len("data:") :].strip()
            try:
                event = json.loads(payload)
            except (json.JSONDecodeError, TypeError):
                parse_errors.append({"line": line_number, "error": "invalid JSON event"})
                continue
            if isinstance(event, dict) and event.get("type") == "chunk":
                # Cartesia's `data` field is base64 audio. Keep chunk metadata only.
                events.append(
                    {
                        **{
                            key: _without_audio(value)
                            for key, value in event.items()
                            if key != "data"
                        },
                        "audioPayloadOmitted": True,
                    }
                )
            else:
                events.append(_without_audio(event))

        if not events and decoded:
            try:
                response_json = _without_audio(json.loads(decoded))
            except json.JSONDecodeError:
                response_text = decoded[:4000]

        record = {
            "timestamp": datetime.now(UTC).isoformat(),
            "type": "cartesia_sse_response",
            "model": model,
            "requestText": request_text,
            "httpStatus": http_status,
            "contentType": content_type,
            "responseEvents": events,
            "responseJson": response_json,
            "responseTextExcerpt": response_text,
            "responseParseErrors": parse_errors,
            "requestError": request_error,
            "audioSaved": False,
        }
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        encoded = line.encode("utf-8")
        data_dir.mkdir(parents=True, exist_ok=True)
        target = data_dir / HISTORY_FILENAME
        if target.exists() and target.stat().st_size + len(encoded) > HISTORY_MAX_BYTES:
            _rotate_history(target)
        with target.open("a", encoding="utf-8") as handle:
            handle.write(line)
        return target
    except Exception as exc:  # noqa: BLE001 - history logging must not break TTS
        logger.warning("Cartesia response history write failed: %s", exc)
        return None


def log_alignment_failure(data_dir: Path, *, error: str, diagnostic: dict[str, Any]) -> Path | None:
    """Append one alignment failure; never let diagnostics break the TTS request."""
    target = data_dir / LOG_FILENAME
    event = {
        "timestamp": datetime.now(UTC).isoformat(),
        "error": error,
        "diagnostic": diagnostic,
    }
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")
        return target
    except Exception as exc:  # noqa: BLE001 - diagnostics must never break requests
        logger.warning("TTS alignment diagnostic write failed to %s: %s", target, exc)
        return None
