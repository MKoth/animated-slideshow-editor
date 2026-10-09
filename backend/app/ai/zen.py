"""opencode.ai Zen gateway client: OpenAI-compatible chat/completions + models catalog.

Family routing is pinned: always POST {endpoint}/chat/completions. No
/responses or /messages branching — a different family needs a spec amendment.
"""

# ruff: noqa: BLE001, S112
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ZenError:
    status: int
    code: str
    message: str


def friendly_error_for_status(status: int, body_text: str = "") -> tuple[str, str]:
    """Map provider failures to (code, user-facing message) per Spec 12 R17."""
    lowered = (body_text or "").lower()
    if status == 401:
        return (
            "invalid_or_exhausted",
            "Key invalid or credits exhausted — check your key or top up, then retry.",
        )
    if status == 402:
        return (
            "limit_exceeded",
            "Credit limit exceeded — top up and retry.",
        )
    if status == 429:
        return ("rate_limited", "Rate-limited — wait a moment and retry.")
    if status == 400 and ("invalid" in lowered or "request" in lowered):
        return ("provider_error", "Provider error — retry.")
    if 500 <= status <= 599:
        return ("provider_error", "Provider error — retry.")
    _ = lowered
    return ("provider_error", "Provider error — retry.")


def chat_completions_payload(
    *,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
    stream: bool,
    structured: bool = False,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
    }
    if structured:
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "response",
                "schema": {"type": "object"},
            },
        }
    return payload


def parse_sse_tokens(raw: str) -> list[str]:
    """Tolerant SSE parser: non-standard chunks never break the stream."""
    tokens: list[str] = []
    for chunk in raw.split("\n\n"):
        chunk = chunk.strip()
        if not chunk:
            continue
        for line in chunk.splitlines():
            line = line.strip()
            if not line.startswith("data:"):
                continue
            data = line[len("data:") :].strip()
            if data == "[DONE]":
                continue
            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                continue
            # OpenAI chat chunk shape
            try:
                choices = payload.get("choices", [])
                if choices:
                    delta = choices[0].get("delta", {}) or {}
                    content = delta.get("content")
                    if isinstance(content, str) and content:
                        tokens.append(content)
                        continue
                    text = choices[0].get("text")
                    if isinstance(text, str) and text:
                        tokens.append(text)
            except Exception:
                continue
    return tokens


class ZenClient:
    """Thin wrapper over httpx so tests can inject a MockTransport."""

    def __init__(self, endpoint: str, api_key: str, timeout_s: float = 15.0) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout_s

    def list_models(self, http_client: httpx.Client | None = None) -> list[str]:
        client = http_client or httpx.Client(timeout=self._timeout)
        close = http_client is None
        try:
            response = client.get(
                f"{self._endpoint}/models",
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
            if response.status_code != 200:
                raise ZenFetchError(response.status_code, response.text)
            data = response.json()
            raw = data.get("data", data.get("models", []))
            models: list[str] = []
            if isinstance(raw, list):
                for entry in raw:
                    if isinstance(entry, str):
                        models.append(entry)
                    elif isinstance(entry, dict) and isinstance(entry.get("id"), str):
                        models.append(entry["id"])
            return models
        finally:
            if close:
                client.close()

    def chat_stream(
        self,
        *,
        model: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        http_client: httpx.Client | None = None,
    ) -> Iterator[str]:
        """Yield content deltas from a streaming chat/completions call."""
        payload = chat_completions_payload(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
        client = http_client or httpx.Client(timeout=self._timeout)
        close = http_client is None
        try:
            with client.stream(
                "POST",
                f"{self._endpoint}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                if response.status_code != 200:
                    body = response.read().decode("utf-8", errors="replace")
                    raise ZenFetchError(response.status_code, body)
                buffer = ""
                for text in response.iter_text():
                    buffer += text
                    while "\n\n" in buffer:
                        chunk, buffer = buffer.split("\n\n", 1)
                        yield from parse_sse_tokens(chunk + "\n\n")
        finally:
            if close:
                client.close()

    async def chat_stream_async(
        self,
        *,
        model: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        http_client: httpx.AsyncClient | None = None,
    ) -> AsyncIterator[str]:
        payload = chat_completions_payload(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
        client = http_client or httpx.AsyncClient(timeout=self._timeout)
        close = http_client is None
        try:
            async with client.stream(
                "POST",
                f"{self._endpoint}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                if response.status_code != 200:
                    body = (await response.aread()).decode("utf-8", errors="replace")
                    raise ZenFetchError(response.status_code, body)
                buffer = ""
                async for text in response.aiter_text():
                    buffer += text
                    while "\n\n" in buffer:
                        chunk, buffer = buffer.split("\n\n", 1)
                        for token in parse_sse_tokens(chunk + "\n\n"):
                            yield token
        finally:
            if close:
                await client.aclose()


class ZenFetchError(Exception):
    def __init__(self, status: int, body: str = "") -> None:
        super().__init__(f"zen request failed with status {status}")
        self.status = status
        self.body = body
