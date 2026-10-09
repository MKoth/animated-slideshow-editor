"""Server-side prompt composition + token-budget trimming.

Budget uses a documented character approximation (4 chars ≈ 1 token) when the
provider tokenizer is unavailable — which is always in this spec (no tokenizer
dep). Trimming drops the oldest history first, never splits a message, and
never drops the context block.
"""

# ruff: noqa: BLE001
from __future__ import annotations

from dataclasses import dataclass

CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, (len(text) + CHARS_PER_TOKEN - 1) // CHARS_PER_TOKEN)


@dataclass(frozen=True)
class ChatMessage:
    role: str
    content: str


def compose_messages(
    system_prompt: str,
    context_text: str,
    history: list[ChatMessage],
    current_message: str,
    budget_tokens: int,
) -> list[ChatMessage]:
    """Oldest-history-first trim to fit budget. System + context + current never dropped."""
    system_tokens = estimate_tokens(system_prompt)
    context_tokens = estimate_tokens(context_text)
    current_tokens = estimate_tokens(current_message)
    fixed = system_tokens + context_tokens + current_tokens

    # Keep newest history that fits; drop oldest first.
    kept: list[ChatMessage] = list(history)
    while kept:
        history_tokens = sum(estimate_tokens(m.content) + 4 for m in kept)
        if fixed + history_tokens <= budget_tokens:
            break
        kept.pop(0)
    # If even empty history exceeds budget, still return system/context/current
    # (history fully trimmed) — context is never dropped per spec.
    messages: list[ChatMessage] = []
    if system_prompt:
        messages.append(ChatMessage(role="system", content=system_prompt))
    if context_text:
        messages.append(ChatMessage(role="system", content=f"Project context:\n{context_text}"))
    messages.extend(kept)
    messages.append(ChatMessage(role="user", content=current_message))
    return messages


def context_to_text(context: object) -> str:
    if context is None:
        return ""
    if isinstance(context, str):
        return context
    if isinstance(context, dict):
        parts: list[str] = []
        value = context.get("projectName")
        if isinstance(value, str) and value.strip():
            parts.append(f"project: {value.strip()}")
        value = context.get("activeSlideName")
        if isinstance(value, str) and value.strip():
            parts.append(f"active slide: {value.strip()}")
        slides = context.get("slides")
        if isinstance(slides, list) and slides:
            names = [str(s.get("name", s)) if isinstance(s, dict) else str(s) for s in slides]
            parts.append("slides: " + ", ".join(names[:50]))
        nodes = context.get("sceneNodes")
        if isinstance(nodes, list) and nodes:
            parts.append("scene nodes: " + ", ".join(str(n) for n in nodes[:100]))
        for key in ("materials", "shaders", "clips", "assets"):
            items = context.get(key)
            if isinstance(items, list) and items:
                parts.append(f"{key}: " + ", ".join(str(i) for i in items[:100]))
        selection = context.get("selection")
        if isinstance(selection, list) and selection:
            parts.append("selection: " + ", ".join(str(s) for s in selection[:50]))
        # Fallback: include any other scalar context for grounding
        if not parts:
            import json

            try:
                return json.dumps(context)[:4000]
            except Exception:
                return str(context)[:4000]
        return "\n".join(parts)
    return str(context)[:4000]
