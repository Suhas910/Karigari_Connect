"""
The AI boundary, as Python types.

`AI_INTERFACE_CONTRACTS.md` is the authority; this file is that document expressed in
code so the backend can import it instead of re-typing it. When the document and this
file disagree, the document is right and this file is a bug.

Two rules from `TEAM_BUILD_GUIDE.md` shape everything here:

  * "Return per-field confidence, not one misleading global confidence number."
    Hence `field_confidence` and `low_confidence_spans` rather than a single float
    that invites a progress bar and means nothing.
  * "Store provider, model/version, confidence, original input references, and user
    edits." Hence `AdapterInfo` riding along on every result. A number without a
    provenance stamp cannot be audited later, and audit is the entire product thesis.

## Unresolved, and deliberately not decided here

`AI_INTERFACE_CONTRACTS.md` says money moves "in integer paise where possible, or
decimal INR only when the API explicitly states it. Choose one before implementation."
That choice is the backend's to make and it has not been made. These models use whole
INR, matching every worked example in the document. If the team picks paise, this file
changes in the same commit as the document -- not before, and not separately.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class _Strict(BaseModel):
    """Reject unknown fields everywhere.

    An adapter that quietly returns an extra key is an adapter drifting from the
    contract. Better to fail on the bench than to discover it during the demo.
    """

    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------- errors


class ErrorCode(str, Enum):
    """The standard codes from `AI_INTERFACE_CONTRACTS.md`.

    The frontend switches on these, so the strings are load-bearing. They are the AI
    layer's vocabulary for failing honestly: every one of them names a specific
    recoverable situation rather than collapsing into a generic failure.
    """

    MEDIA_QUALITY_INSUFFICIENT = "MEDIA_QUALITY_INSUFFICIENT"
    ASR_LOW_CONFIDENCE = "ASR_LOW_CONFIDENCE"
    CATALOGUE_SCHEMA_INVALID = "CATALOGUE_SCHEMA_INVALID"
    PROVENANCE_VERIFICATION_REQUIRED = "PROVENANCE_VERIFICATION_REQUIRED"
    WAGE_RATE_UNAVAILABLE = "WAGE_RATE_UNAVAILABLE"
    LISTING_STATE_INVALID = "LISTING_STATE_INVALID"
    EXPORT_CONTRACT_INVALID = "EXPORT_CONTRACT_INVALID"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"


class AIError(Exception):
    """A failure the AI layer can describe precisely enough for the app to act on."""

    def __init__(self, code: ErrorCode, message: str, *, recoverable: bool = True, action: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.recoverable = recoverable
        self.action = action

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code.value,
            "message": self.message,
            "recoverable": self.recoverable,
            "action": self.action,
        }


# ---------------------------------------------------------------- provenance


class AdapterInfo(_Strict):
    """Which provider produced a result, and with what.

    Attached to every AI result. Without it, a corrected field six weeks later cannot
    be traced to the model that got it wrong.
    """

    provider: str = Field(description="Adapter name, e.g. 'bhashini', 'local_whisper', 'fixture'.")
    model: str | None = Field(default=None, description="Model or pipeline identifier.")
    version: str | None = Field(default=None, description="Provider-reported version, if any.")
    on_device: bool = Field(default=False, description="True when no request left the device or server.")


# ---------------------------------------------------------------- image


QualityLevel = Literal["acceptable", "needs_correction", "unacceptable"]


class QualityReport(_Strict):
    """Per-dimension photo assessment. Shape from `AI_INTERFACE_CONTRACTS.md`."""

    overall: QualityLevel
    blur: QualityLevel
    lighting: QualityLevel
    framing: QualityLevel
    guidance: list[str] = Field(
        default_factory=list,
        description="Plain-language retake instructions, one per problem, addressed to the artisan.",
    )
    metrics: dict[str, float] = Field(
        default_factory=dict,
        description="Raw measurements behind the grades. For debugging and threshold calibration, not for display.",
    )

    @property
    def is_usable(self) -> bool:
        """Enhancement is only meaningful above this bar.

        `needs_correction` still enhances -- that is what correction means. Only
        `unacceptable` stops the pipeline, because no deterministic transform recovers
        a photo with no recoverable detail in it.
        """
        return self.overall != "unacceptable"


class ImageJobResult(_Strict):
    quality: QualityReport
    enhanced_media_id: str | None = None
    transformations: list[str] = Field(
        default_factory=list,
        description="Every transform applied, in order. The artisan is shown the original alongside.",
    )
    human_review_required: bool = False
    adapter: AdapterInfo


# ---------------------------------------------------------------- speech


class LowConfidenceSpan(_Strict):
    text: str
    start_ms: int
    end_ms: int
    reason: str = Field(description="Why this span is uncertain, in words a coordinator can act on.")
    confidence: float = Field(ge=0.0, le=1.0)


class TranscriptResult(_Strict):
    transcript_id: str
    detected_language: str = Field(description="ISO 639 code the recogniser actually detected.")
    original_text: str
    english_translation: str | None = None
    hindi_translation: str | None = None
    overall_confidence: float | None = Field(
        ge=0.0,
        le=1.0,
        description="None when the provider reports no confidence. Never estimated.",
    )
    low_confidence_spans: list[LowConfidenceSpan] = Field(default_factory=list)
    adapter: AdapterInfo

    @property
    def needs_replay(self) -> bool:
        """Whether the app should ask the artisan to confirm by listening back.

        Any low-confidence span is enough. A high average over a recording that
        mumbled the one word naming the material is exactly the failure this product
        cannot afford, because that word becomes a published claim. An unknown
        confidence is treated the same way: nothing says the transcript is right.
        """
        return self.overall_confidence is None or bool(self.low_confidence_spans)


# ---------------------------------------------------------------- catalogue


class CatalogueResult(_Strict):
    schema_version: str
    catalogue: dict[str, Any] = Field(description="Must validate against taxonomy/listing.schema.json.")
    field_confidence: dict[str, float] = Field(default_factory=dict)
    needs_confirmation: list[str] = Field(
        default_factory=list,
        description=(
            "Dotted field paths the artisan must confirm before submission. A low "
            "confidence field is not automatically wrong; it is unconfirmed."
        ),
    )
    adapter: AdapterInfo


# ---------------------------------------------------------------- price


class WageSource(_Strict):
    state_code: str
    notification_ref: str | None = None
    effective_from: str | None = None
    source_url: str | None = None


class PriceResult(_Strict):
    """The API-facing form of `pricing.engine.PriceBand`.

    `status` is not decoration. `unavailable` is a first-class outcome that the app
    must render as an honest empty state, because a guessed floor launders
    underpayment through an official-looking number.
    """

    calculation_version: str
    status: Literal["available", "unavailable"]
    currency: str = "INR"
    wage_source: WageSource | None = None
    inputs: dict[str, Any] = Field(default_factory=dict)
    floor_amount_inr: int | None = None
    recommended_low_inr: int | None = None
    recommended_high_inr: int | None = None
    explanation: str | None = None
    error: dict[str, Any] | None = None


__all__ = [
    "AIError",
    "AdapterInfo",
    "CatalogueResult",
    "ErrorCode",
    "ImageJobResult",
    "LowConfidenceSpan",
    "PriceResult",
    "QualityLevel",
    "QualityReport",
    "TranscriptResult",
    "WageSource",
]
