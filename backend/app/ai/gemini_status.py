"""
Whether Gemini is actually answering, for GET /api/v1/ai/config.

A key being set proves nothing. The legacy client had a key and a model that returns 404,
and served fixtures with nothing saying so. Listing models does not settle it either:
`gemini-2.5-flash` still appears in the model list while refusing every request. So this
sends the configured model one tiny generate request, at most once every five minutes,
and reports what came back. That costs one request against the per-minute quota each
time the cache expires.
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

TTL_SECONDS = 300

_lock = threading.Lock()
_cache: dict[str, dict[str, Any]] = {}


def _probe(model: str, api_key: str) -> tuple[bool, str | None]:
    from google import genai
    from google.genai import errors, types

    # Held in a variable for the whole call. Chained as genai.Client(...).models..., the
    # client was released mid-request and every probe failed with RuntimeError.
    client = genai.Client(api_key=api_key)
    try:
        client.models.generate_content(
            model=model,
            contents="Reply with OK.",
            config=types.GenerateContentConfig(
                temperature=0,
                max_output_tokens=8,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
    except errors.APIError as exc:
        return False, f"HTTP {exc.code}: {exc.message}"[:200]
    except Exception as exc:  # noqa: BLE001 - reported, not raised: this is a status page
        return False, f"{type(exc).__name__}: {exc}".replace(api_key, "***")[:200]
    return True, None


def gemini_status(
    *,
    probe: Callable[[str, str], tuple[bool, str | None]] = _probe,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """{key_configured, model, reachable, checked_at, detail}. `reachable` is None when unknown."""
    from . import config

    model = config.gemini_model()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {
            "key_configured": False,
            "model": model,
            "reachable": None,
            "checked_at": None,
            "detail": "GEMINI_API_KEY is not set.",
        }

    # Keyed by a hash so the key itself is never held in the cache or returned.
    cache_key = hashlib.sha256(f"{model}\n{api_key}".encode()).hexdigest()
    with _lock:
        cached = _cache.get(cache_key)
        if cached and clock() - cached["at"] < TTL_SECONDS:
            return dict(cached["value"])
        reachable, detail = probe(model, api_key)
        value = {
            "key_configured": True,
            "model": model,
            "reachable": reachable,
            "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "detail": detail,
        }
        _cache[cache_key] = {"at": clock(), "value": value}
        return dict(value)


__all__ = ["TTL_SECONDS", "gemini_status"]
