"""Client for the OpenCode inference API and its model-family endpoints."""

# ruff: noqa: BLE001, S112
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)
DEFAULT_GO_ENDPOINT = "https://opencode.ai/zen/go/v1"


def opencode_headers(api_key: str, session_id: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "animated-slideshow-editor/1.0",
    }
    if session_id:
        headers["x-opencode-session"] = session_id
    return headers


def inference_endpoint(endpoint: str) -> str:
    """Translate older OpenCode URLs to the OpenCode Go API endpoint."""
    normalized = endpoint.rstrip("/")
    if normalized in {
        "https://opencode.ai/zen/v1",
        "https://opencode.ai/zen",
        "https://opencode.ai",
        "https://opencode.ai/inference",
    }:
        return DEFAULT_GO_ENDPOINT
    return normalized


def canonical_model_id(model: str) -> str:
    """Remove legacy provider prefixes from model IDs stored by older builds."""
    for prefix in ("anthropic/", "openai/", "google/", "opencode/"):
        if model.startswith(prefix):
            return model[len(prefix) :]
    return model


def model_api_family(model: str) -> str:
    model_id = canonical_model_id(model).lower()
    if model_id.startswith(("claude-", "qwen", "minimax-")):
        return "anthropic"
    if model_id.startswith(("gpt-", "grok-", "muse-spark-")):
        return "responses"
    return "openai"


def inference_request(
    *,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
    stream: bool,
) -> tuple[str, dict[str, object]]:
    """Build the URL path and request body for a model's documented API family."""
    model_id = canonical_model_id(model)
    family = model_api_family(model_id)
    if family == "anthropic":
        system = "\n".join(m["content"] for m in messages if m["role"] == "system")
        payload: dict[str, object] = {
            "model": model_id,
            "messages": [m for m in messages if m["role"] != "system"],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": stream,
        }
        if system:
            payload["system"] = system
        return "/messages", payload
    if family == "responses":
        payload = {
            "model": model_id,
            "input": [{"role": m["role"], "content": m["content"]} for m in messages],
            "temperature": temperature,
            "max_output_tokens": max_tokens,
            "stream": stream,
        }
        return "/responses", payload
    payload = chat_completions_payload(
        model=model_id,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=stream,
    )
    return "/chat/completions", payload


@dataclass(frozen=True)
class ZenError:
    status: int
    code: str
    message: str


def friendly_error_for_status(status: int, body_text: str = "") -> tuple[str, str]:
    """Map provider failures to (code, user-facing message) per Spec 12 R17."""
    lowered = (body_text or "").lower()
    if status == 403 and "freetiererror" in lowered:
        return (
            "model_access_denied",
            "OpenCode rejected this model for your Go plan. Check that the model is included in your plan, then retry.",
        )
    if status == 401:
        return (
            "invalid_or_exhausted",
            "Key invalid or credits exhausted — check your key or top up, then retry.",
        )
    if status == 402:
        return (
            "limit_exceeded",
            "OpenCode Go usage limit reached — check your 5-hour, weekly, and monthly usage in Console; wait for a reset or enable balance fallback.",
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
    if stream:
        # Ask streaming chat-completions providers to report usage; without
        # this OpenAI-compatible streams omit the final usage chunk.
        payload["stream_options"] = {"include_usage": True}
    if structured:
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "response",
                "schema": {"type": "object"},
            },
        }
    return payload


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) and value >= 0 else None


def extract_usage_from_payload(payload: object) -> dict[str, int]:
    """Real provider token usage from one decoded SSE/JSON payload.

    Handles the three API families without importing their SDKs:
    - OpenAI chat: payload['usage'] = {prompt_tokens, completion_tokens, total_tokens}
    - Anthropic messages: payload['message']['usage'] or payload['usage'] =
      {input_tokens, output_tokens}; the final message_delta carries the totals
    - Responses API: payload['response']['usage'] =
      {input_tokens, output_tokens, total_tokens}
    Unknown shapes read as no usage — never throws.
    """
    if not isinstance(payload, dict):
        return {}
    candidates: list[object] = [
        payload.get("usage"),
        payload.get("response_usage"),
    ]
    message = payload.get("message")
    if isinstance(message, dict):
        candidates.append(message.get("usage"))
    response = payload.get("response")
    if isinstance(response, dict):
        candidates.append(response.get("usage"))
    merged: dict[str, int] = {}
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        prompt = _int_or_none(candidate.get("prompt_tokens"))
        if prompt is None:
            prompt = _int_or_none(candidate.get("input_tokens"))
        completion = _int_or_none(candidate.get("completion_tokens"))
        if completion is None:
            completion = _int_or_none(candidate.get("output_tokens"))
        total = _int_or_none(candidate.get("total_tokens"))
        if prompt is not None:
            merged["prompt_tokens"] = prompt
        if completion is not None:
            merged["completion_tokens"] = completion
        if total is not None:
            merged["total_tokens"] = total
    return merged


def merge_usage(acc: dict[str, int], update: dict[str, int]) -> dict[str, int]:
    """Fold one streaming usage update into the accumulator (last wins).

    Streaming sends incremental snapshots; the final chunk holds the totals,
    so later values overwrite earlier ones. When the provider omits
    total_tokens the parts are summed so the running total never goes stale.
    """
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        value = update.get(key)
        if isinstance(value, int) and value >= 0:
            acc[key] = value
    prompt = acc.get("prompt_tokens")
    completion = acc.get("completion_tokens")
    if update.get("total_tokens") is None and prompt is not None and completion is not None:
        acc["total_tokens"] = prompt + completion
    return acc


def parse_sse_usage(raw: str) -> dict[str, int]:
    """Collect real token usage from a raw SSE buffer; tolerant like parse_sse_tokens."""
    acc: dict[str, int] = {}
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
            merge_usage(acc, extract_usage_from_payload(payload))
    return acc


def inference_response_usage(data: object) -> dict[str, int]:
    """Real token usage from a non-streaming inference response body."""
    return extract_usage_from_payload(data)


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
                delta = payload.get("delta", {}) or {}
                if payload.get("type") == "content_block_delta":
                    text = delta.get("text")
                    if isinstance(text, str) and text:
                        tokens.append(text)
                        continue
                if payload.get("type") == "response.output_text.delta":
                    text = payload.get("delta")
                    if isinstance(text, str) and text:
                        tokens.append(text)
                        continue
                candidates = payload.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts and isinstance(parts[0].get("text"), str):
                        tokens.append(parts[0]["text"])
                        continue
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
        self._endpoint = inference_endpoint(endpoint)
        self._api_key = api_key
        self._timeout = timeout_s

    def _headers(self, session_id: str | None = None) -> dict[str, str]:
        return opencode_headers(self._api_key, session_id)

    def list_models(self, http_client: httpx.Client | None = None) -> list[str]:
        client = http_client or httpx.Client(timeout=self._timeout)
        close = http_client is None
        try:
            response = client.get(
                f"{self._endpoint}/models",
                headers=self._headers(),
            )
            if response.status_code != 200:
                raise ZenFetchError(response.status_code, response.text)
            data = response.json()
            raw = data.get("data", data.get("models", []))
            models: list[str] = []
            if isinstance(raw, list):
                for entry in raw:
                    if isinstance(entry, str):
                        models.append(canonical_model_id(entry))
                    elif isinstance(entry, dict) and isinstance(entry.get("id"), str):
                        models.append(canonical_model_id(entry["id"]))
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
        session_id: str | None = None,
        http_client: httpx.Client | None = None,
        usage: dict[str, int] | None = None,
    ) -> Iterator[str]:
        """Yield content deltas from a streaming chat/completions call.

        When `usage` is provided it is mutated in place with the real provider
        token counts parsed from the stream (last snapshot wins); absent or
        unreported usage leaves it empty.
        """
        path, payload = inference_request(
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
                f"{self._endpoint}{path}",
                headers=self._headers(session_id),
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
                        raw = chunk + "\n\n"
                        if usage is not None:
                            merge_usage(usage, parse_sse_usage(raw))
                        yield from parse_sse_tokens(raw)
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
        session_id: str | None = None,
        http_client: httpx.AsyncClient | None = None,
        usage: dict[str, int] | None = None,
    ) -> AsyncIterator[str]:
        path, payload = inference_request(
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
                f"{self._endpoint}{path}",
                headers=self._headers(session_id),
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
                        raw = chunk + "\n\n"
                        if usage is not None:
                            merge_usage(usage, parse_sse_usage(raw))
                        for token in parse_sse_tokens(raw):
                            yield token
        finally:
            if close:
                await client.aclose()


class ZenFetchError(Exception):
    def __init__(self, status: int, body: str = "") -> None:
        super().__init__(f"zen request failed with status {status}")
        self.status = status
        self.body = body
