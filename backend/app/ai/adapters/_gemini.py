"""Gemini plumbing shared by the adapters: key check, client, error mapping."""

from __future__ import annotations

import logging
import os
from typing import Any

from ..contracts import AIError, ErrorCode

logger = logging.getLogger(__name__)


def _key(api_key: str | None) -> str | None:
    return api_key or os.getenv("GEMINI_API_KEY")


def sdk_available(api_key: str | None = None) -> bool:
    """A key and the SDK are present. No network call."""
    if not _key(api_key):
        return False
    try:
        from google import genai  # noqa: F401
    except ImportError:
        return False
    return True


def make_client(api_key: str | None, capability: str) -> Any:
    key = _key(api_key)
    if not key:
        # The SDK would raise a bare ValueError; the app needs a contract error.
        raise AIError(
            ErrorCode.PROVIDER_UNAVAILABLE,
            f"Gemini {capability} is not configured (GEMINI_API_KEY is not set).",
            recoverable=False,
        )
    from google import genai

    return genai.Client(api_key=key)


def api_error(exc: Any, service: str, saved: str = "") -> AIError:
    code = getattr(exc, "code", None)
    logger.warning("Gemini %s call failed: HTTP %s %s", service, code, getattr(exc, "message", exc))
    if code == 429 or (isinstance(code, int) and code >= 500):
        return AIError(
            ErrorCode.PROVIDER_UNAVAILABLE,
            f"The {service} service is busy. {saved}".strip(),
            recoverable=True,
            action="retry_later",
        )
    return AIError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        f"The {service} service rejected the request (HTTP {code}).",
        recoverable=False,
    )
