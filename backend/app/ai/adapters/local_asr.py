"""
Local speech recognition -- the credential-free fallback.

Bhashini is the primary provider and the strategic one: public language rails are half
of "public rails, not a marketplace". But Bhashini needs a registration that is not in
our control, and a hackathon schedule cannot depend on a portal approval landing on
time. This adapter is the answer to that risk. It runs from downloaded open weights,
needs no account and no key, and satisfies the same `ASRAdapter` Protocol, so the day
the Bhashini credential arrives the switch is one registry entry.

It is also the honest fallback for the pilot itself. A cluster with intermittent
connectivity cannot depend on a remote API being reachable at the moment an artisan
finishes speaking.

## Why the import is lazy

`faster_whisper` pulls in CTranslate2 and a model download. Importing it at module
import time would make `app.ai` slow to import, would make a missing optional
dependency break unrelated tests, and would fetch weights on a machine that never
intends to transcribe. So the import happens inside `_load()`, and `is_available()`
answers the question without side effects. That is exactly what the registry's
fallback walk needs.

## About the confidence numbers

Whisper does not emit calibrated probabilities. It emits `avg_logprob`, the mean
log-probability per token, and `exp(avg_logprob)` is the conventional way to turn that
into a 0..1 score. It is a **heuristic ranking signal, not a probability** that the
transcription is correct, and nothing in the pitch should describe it as accuracy.

What it is good for is exactly what this product needs it for: ordering spans from
most to least certain, so the least certain ones get read back to the artisan for
confirmation. That use survives the metric being uncalibrated. Quoting it as a
percentage to a judge would not.

## Model choice

`DEFAULT_MODEL` is a Whisper checkpoint because it is multilingual, permissively
licensed and runs on CPU. For the Indian languages this product targets, AI4Bharat's
IndicConformer and IndicWhisper models are the better-matched option and should be
evaluated head to head on the consented evaluation set before the pilot. Neither
choice can be made from a model card; it needs the evaluation set. Until that
comparison exists, no accuracy claim about either belongs in the deck.
"""

from __future__ import annotations

import math
import os
import uuid
from pathlib import Path
from typing import Any

from ..contracts import AdapterInfo, AIError, ErrorCode, LowConfidenceSpan, TranscriptResult
from .base import AudioSource

DEFAULT_MODEL = "small"
DEFAULT_COMPUTE_TYPE = "int8"

# Set to 1 to let the adapter download a missing model the first time it is used. Off by
# default: see `_load`.
ALLOW_DOWNLOAD_ENV = "CRAFTLINK_WHISPER_ALLOW_DOWNLOAD"

# Spans below this are read back to the artisan for confirmation. Provisional, like the
# image thresholds: set it from the evaluation set, not from intuition. Erring low
# means more confirmation prompts; erring high means an unconfirmed word becomes a
# published claim. Given which of those is recoverable, err low.
LOW_CONFIDENCE_BELOW = 0.60


def _confidence_from_logprob(avg_logprob: float | None) -> float:
    """exp(mean token log-probability), clamped. See the module docstring."""
    if avg_logprob is None:
        return 0.0
    return float(min(1.0, max(0.0, math.exp(avg_logprob))))


class LocalWhisperASRAdapter:
    """`ASRAdapter` backed by faster-whisper, running locally."""

    name = "local_whisper"

    def __init__(
        self,
        model_size: str | None = None,
        *,
        device: str = "cpu",
        compute_type: str = DEFAULT_COMPUTE_TYPE,
        low_confidence_below: float = LOW_CONFIDENCE_BELOW,
        download_root: str | None = None,
    ):
        # The registry builds this with no arguments, so the size comes from the environment
        # when not given: a machine may only have a smaller model downloaded.
        self.model_size = model_size or os.getenv("CRAFTLINK_WHISPER_MODEL", "").strip() or DEFAULT_MODEL
        self.device = device
        self.compute_type = compute_type
        self.low_confidence_below = low_confidence_below
        self.download_root = download_root
        self._model: Any = None

    # ---------- availability

    @staticmethod
    def dependency_installed() -> bool:
        """True when faster-whisper can be imported. No model download is triggered."""
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return False
        return True

    def is_available(self) -> bool:
        return self.dependency_installed()

    # ---------- model

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise AIError(
                ErrorCode.PROVIDER_UNAVAILABLE,
                "Local speech recognition is not installed on this machine "
                "(pip install faster-whisper).",
                recoverable=False,
            ) from exc

        # Never download inside a request unless asked to. The first download of "small" is
        # hundreds of megabytes; on 2026-09-14 one stalled at 0 bytes and held every
        # transcription request open with no timeout. Download ahead of time instead:
        #     python -m app.ai.adapters.local_asr
        try:
            self._model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
                download_root=self.download_root,
                local_files_only=os.getenv(ALLOW_DOWNLOAD_ENV) != "1",
            )
        except Exception as exc:  # noqa: BLE001 - a missing or broken model is one contract error
            raise AIError(
                ErrorCode.PROVIDER_UNAVAILABLE,
                f"Speech recognition is not ready on this server: the whisper-{self.model_size} "
                "model is not downloaded (python -m app.ai.adapters.local_asr).",
                recoverable=True,
                action="retry_later",
            ) from exc
        return self._model

    # ---------- transcription

    def transcribe(
        self,
        audio: AudioSource,
        *,
        declared_language: str | None = None,
        transcript_id: str | None = None,
    ) -> TranscriptResult:
        model = self._load()

        source: Any
        if isinstance(audio, bytes):
            import io

            source = io.BytesIO(audio)
        else:
            path = Path(audio)
            if not path.exists():
                raise AIError(
                    ErrorCode.PROVIDER_UNAVAILABLE,
                    f"Audio file not found: {path}",
                    recoverable=False,
                )
            source = str(path)

        try:
            segments, info = model.transcribe(
                source,
                # Passed as a hint. When it is None the model detects the language,
                # and a detected language that differs from the declared one is
                # reported rather than overridden -- code-mixed speech is normal here.
                language=declared_language,
                task="transcribe",
                vad_filter=True,
                word_timestamps=False,
            )
            segments = list(segments)  # the provider returns a generator
        except AIError:
            raise
        except Exception as exc:  # noqa: BLE001 - provider failures become contract errors
            raise AIError(
                ErrorCode.PROVIDER_UNAVAILABLE,
                "Speech recognition failed on this recording.",
                recoverable=True,
                action="record_again",
            ) from exc

        return self._to_result(
            segments,
            info,
            transcript_id=transcript_id or f"T-{uuid.uuid4()}",
        )

    def _to_result(self, segments: list[Any], info: Any, *, transcript_id: str) -> TranscriptResult:
        """Normalise provider output to the contract type. No provider fields escape."""
        texts: list[str] = []
        spans: list[LowConfidenceSpan] = []
        confidences: list[float] = []

        for segment in segments:
            text = (getattr(segment, "text", "") or "").strip()
            confidence = _confidence_from_logprob(getattr(segment, "avg_logprob", None))
            confidences.append(confidence)
            if text:
                texts.append(text)
            if text and confidence < self.low_confidence_below:
                spans.append(
                    LowConfidenceSpan(
                        text=text,
                        start_ms=int(round(float(getattr(segment, "start", 0.0)) * 1000)),
                        end_ms=int(round(float(getattr(segment, "end", 0.0)) * 1000)),
                        # Deliberately generic. The recogniser knows the audio was
                        # unclear; it does not know which listing field the word was
                        # going to fill. The catalogue generator adds that later, and
                        # inventing a specific reason here would be a guess dressed as
                        # a diagnosis.
                        reason="unclear_speech",
                        confidence=round(confidence, 4),
                    )
                )

        # Mean over segments, not over tokens: the API does not expose token counts, and
        # a length-weighted mean computed from numbers we do not have would be a
        # fabrication. Documented rather than silently approximated.
        overall = round(sum(confidences) / len(confidences), 4) if confidences else 0.0

        return TranscriptResult(
            transcript_id=transcript_id,
            detected_language=str(getattr(info, "language", "") or "und"),
            original_text=" ".join(texts).strip(),
            # Translation is a separate capability behind `TranslationAdapter`. Leaving
            # these None is the truthful answer from a transcription-only adapter.
            english_translation=None,
            hindi_translation=None,
            overall_confidence=min(1.0, max(0.0, overall)),
            low_confidence_spans=spans,
            adapter=AdapterInfo(
                provider=self.name,
                model=f"whisper-{self.model_size}",
                version=None,
                on_device=True,
            ),
        )


__all__ = ["LocalWhisperASRAdapter", "LOW_CONFIDENCE_BELOW"]


if __name__ == "__main__":
    # Download a model ahead of time: python -m app.ai.adapters.local_asr [small|tiny|...]
    import sys

    from faster_whisper import download_model

    print(download_model(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MODEL))
