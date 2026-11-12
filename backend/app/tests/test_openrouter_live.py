"""Opt-in live smoke test for the configured OpenRouter account.

Set OPEN_ROUTER_KEY (or OPENROUTER_API_KEY) to run this against the real API.
The test intentionally never prints or asserts on the credential.
"""

from __future__ import annotations

import httpx
import pytest

from app.ai.zen import ZenClient, ZenFetchError
from app.config import load_settings


def test_openrouter_live_catalog_and_free_chat() -> None:
    settings = load_settings()
    key = settings.openrouter_api_key
    if not key:
        pytest.skip("OpenRouter key is not configured")

    client = ZenClient(
        settings.openrouter_base_url,
        key,
        provider="openrouter",
        timeout_s=60,
    )
    models = client.list_models()
    free_models = [model for model in models if model.endswith(":free")]
    assert models, "OpenRouter returned an empty model catalog"
    assert free_models, "OpenRouter catalog did not include any :free models"

    # Some free-preview providers can be temporarily unavailable or disabled
    # for an account. Try a small number from the *live* catalog, not a
    # hard-coded model ID, and require at least one successful response.
    failures: list[str] = []
    for model in free_models[:8]:
        try:
            text = "".join(
                client.chat_stream(
                    model=model,
                    messages=[{"role": "user", "content": "Reply with exactly: hi"}],
                    temperature=0,
                    max_tokens=16,
                )
            ).strip()
        except (ZenFetchError, httpx.HTTPError, TimeoutError) as exc:
            # Free-model availability is variable; only provider/network
            # failures should make us move to the next live candidate.
            failures.append(f"{model}: {type(exc).__name__}")
            continue
        if text:
            return
        failures.append(f"{model}: empty response")

    pytest.fail("No tested free OpenRouter model returned text: " + "; ".join(failures))
