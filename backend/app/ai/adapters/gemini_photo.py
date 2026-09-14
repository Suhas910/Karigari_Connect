"""
Photo check with Gemini: problems a measurement cannot see.

`vision/quality.py` measures sharpness, exposure and framing. It cannot tell whether the
thing in the middle is a product, whether there are two of them, or whether a person is
in the picture. This asks Gemini exactly those questions about the actual photo bytes,
and nothing else.

Replaces `gemini_client.audit_image_quality`, which sent a URL string, never the image,
and asked the model to grade blur and lighting it could not see.

Rules:

- Gemini picks from a fixed list of issues (schema-constrained). The words shown to the
  artisan are written here, per issue, not by the model.
- The check can only make a grade stricter, never lift one. Sharpness and exposure stay
  with the measurement.
- It can never refuse a photo on its own: the strictest grade it can give is
  `needs_correction`, which adds guidance and sends the photo to human review. Only a
  measurement makes a photo `unacceptable`. Checked live 2026-09-14: on three drawn
  scenes where the pot is plainly visible and measured framing was acceptable, Gemini
  answered `no_product_visible` every time. Drawn scenes are not photographs, but three
  wrong refusals out of three is enough not to let the model block an artisan.
- It is a second opinion. The service reports an outage and keeps the measured grade.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..contracts import AdapterInfo, AIError, ErrorCode, PhotoCheckResult, QualityLevel
from ._gemini import api_error, make_client, sdk_available

logger = logging.getLogger(__name__)

# issue -> (grade it implies, what the artisan is told)
ISSUES: dict[str, tuple[QualityLevel, str]] = {
    "no_product_visible": (
        "needs_correction",
        "The product cannot be seen clearly. Put it in the middle of the picture and take it again.",
    ),
    "multiple_products": (
        "needs_correction",
        "More than one product is in the photo. Photograph one piece at a time.",
    ),
    "person_visible": (
        "needs_correction",
        "A person is in the photo. Take it again with only the product in the picture.",
    ),
    "text_or_watermark": (
        "needs_correction",
        "There is writing or a logo on the photo. Take it again without it.",
    ),
}

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {"issues": {"type": "array", "items": {"type": "string", "enum": list(ISSUES)}}},
    "required": ["issues"],
}

PROMPT = (
    "This photo is for an online listing of one handmade craft product. Report only these "
    "problems, and only when clearly present:\n"
    "- no_product_visible: no product can be clearly seen\n"
    "- multiple_products: more than one separate product is shown\n"
    "- person_visible: a person or a face is in the picture\n"
    "- text_or_watermark: writing, a logo or a watermark is laid over the photo\n"
    "Return an empty list when none apply. Do not judge sharpness, lighting or framing."
)

_ORDER: list[QualityLevel] = ["acceptable", "needs_correction", "unacceptable"]


class GeminiPhotoCheck:
    name = "gemini"

    def __init__(self, *, client: Any = None, model: str | None = None, api_key: str | None = None):
        from .. import config

        self._client = client
        self.model = model or config.gemini_model()
        self.api_key = api_key

    def is_available(self) -> bool:
        return self._client is not None or sdk_available(self.api_key)

    def _get_client(self) -> Any:
        if self._client is None:
            self._client = make_client(self.api_key, "photo check")
        return self._client

    def check(self, image: bytes, mime_type: str) -> PhotoCheckResult:
        from google.genai import errors, types

        client = self._get_client()
        try:
            response = client.models.generate_content(
                model=self.model,
                contents=[types.Part.from_bytes(data=image, mime_type=mime_type), PROMPT],
                config=types.GenerateContentConfig(
                    temperature=0,
                    response_mime_type="application/json",
                    response_json_schema=RESPONSE_SCHEMA,
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                ),
            )
        except errors.APIError as exc:
            raise api_error(exc, "photo check") from exc
        except Exception as exc:  # noqa: BLE001 - network and SDK failures become contract errors
            logger.warning("Gemini photo check failed: %s", exc)
            raise AIError(
                ErrorCode.PROVIDER_UNAVAILABLE,
                "The photo check could not be reached.",
                recoverable=True,
                action="retry_later",
            ) from exc

        try:
            payload = json.loads(getattr(response, "text", None) or "")
        except ValueError:
            payload = None
        issues = payload.get("issues") if isinstance(payload, dict) else None
        if not isinstance(issues, list) or any(issue not in ISSUES for issue in issues):
            raise AIError(
                ErrorCode.PROVIDER_UNAVAILABLE,
                "The photo check returned an unreadable response.",
                recoverable=True,
                action="retry_later",
            )

        unique = list(dict.fromkeys(issues))
        level: QualityLevel = max(
            [ISSUES[issue][0] for issue in unique] or ["acceptable"], key=_ORDER.index
        )
        return PhotoCheckResult(
            issues=unique,
            level=level,
            guidance=[ISSUES[issue][1] for issue in unique],
            adapter=AdapterInfo(
                provider=self.name,
                model=self.model,
                version=getattr(response, "model_version", None),
                on_device=False,
            ),
        )


__all__ = ["GeminiPhotoCheck", "ISSUES", "PROMPT", "RESPONSE_SCHEMA"]
