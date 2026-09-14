"""
Gemini speech recognition.

Sends the artisan's actual recording to Gemini and returns what was said. This replaces
`gemini_client.transcribe_and_translate`, which never sent audio: it passed a URL string
in the prompt and asked the model to write a "realistic" transcript with a confidence
between 0.85 and 0.99. That produced fluent text unrelated to the recording.

## Confidence is null, on purpose

Gemini does not report a confidence for a transcript. Checked 2026-09-14 against this
project's key: every callable flash model answers `response_logprobs=True` with "Logprobs
is not enabled for this model". Asking the model to rate itself would produce a number
with nothing behind it. So `overall_confidence` is None, and `TranscriptResult.needs_replay`
treats an unknown confidence as a reason to read the transcript back to the artisan.

Words the model cannot make out are written as `[unclear]` in the text, where the
artisan will see them.

## Silence is checked before the call

Gemini writes a greeting for a silent recording. Checked 2026-09-14 on two seconds of
digital silence: "ಹಲೋ" with the Kannada hint, "Hello." with none, and a stricter prompt
only changed the word. Background hiss was correctly reported as no speech. So a WAV
whose loudest sample is effectively zero is refused here, without calling Gemini.

M4A and AAC, which is what the phone records, cannot be decoded without a dependency
this service does not ship. For those the only guard is `needs_replay`: the artisan
hears the recording and reads the transcript back.

## Rate

A free-tier key allows 5 requests per minute per model. A 429 becomes a recoverable
`PROVIDER_UNAVAILABLE` with `retry_later`; the recording stays stored.

## Model

`CRAFTLINK_GEMINI_MODEL`, default `gemini-3.5-flash`. A pinned name rather than a
`-latest` alias, so a transcript can be traced to the model that produced it. The
version Gemini reports is stored on every result as well. `gemini-2.5-flash`, which the
old client names, returns 404 for this key.

## Size

Gemini accepts at most 20 MB per request, and inline bytes are base64 encoded, which adds
a third. Recordings above `INLINE_LIMIT_BYTES` go through the Files API and are deleted
from it once the call returns.
"""

from __future__ import annotations

import io
import json
import logging
import re
import struct
import sys
import uuid
import wave
from array import array
from pathlib import Path
from typing import Any

from ...media_inspect import MediaRejected, inspect_audio
from ..contracts import AdapterInfo, AIError, ErrorCode, TranscriptResult
from ._gemini import api_error, make_client, sdk_available
from .base import AudioSource

logger = logging.getLogger(__name__)

INLINE_LIMIT_BYTES = 14 * 1024 * 1024

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "speech_present": {"type": "boolean"},
        "detected_language": {
            "type": "string",
            "description": "ISO 639-1 code of the main language spoken, or 'und' if unsure.",
        },
        "original_text": {"type": "string"},
    },
    "required": ["speech_present", "detected_language", "original_text"],
}


# A loudest sample below this (about -60 dBFS for 16-bit audio) is a dead microphone or
# digital silence, not quiet speech. An engineering knob, not a calibrated threshold.
SILENT_PEAK_BELOW = 32


def _is_silent_pcm16_wav(data: bytes) -> bool:
    """True for a 16-bit PCM WAV whose loudest sample is effectively zero.

    Anything that cannot be read as 16-bit PCM is treated as not silent and left to
    the provider.
    """
    try:
        with wave.open(io.BytesIO(data)) as w:
            if w.getsampwidth() != 2:
                return False
            frames = w.readframes(w.getnframes())
    except (wave.Error, EOFError, ValueError, struct.error):
        return False
    samples = array("h")
    samples.frombytes(frames[: len(frames) - len(frames) % 2])
    if sys.byteorder == "big":
        samples.byteswap()
    return not samples or max(-min(samples), max(samples)) < SILENT_PEAK_BELOW


def _prompt(declared_language: str | None) -> str:
    hint = (
        f"The speaker chose the language code '{declared_language}' in the app. "
        "Use it only as a hint; report the language actually spoken.\n"
        if declared_language
        else ""
    )
    return (
        "Transcribe the speech in this recording exactly as spoken, in the script of the "
        "language spoken. Keep mixed-language words as spoken. Do not translate, "
        "summarise, correct or add anything. Write [unclear] in place of any word you "
        "cannot make out. If there is no speech, set speech_present to false and "
        "original_text to an empty string.\n" + hint
    )


class GeminiASRAdapter:
    """`ASRAdapter` backed by the Gemini API."""

    name = "gemini"

    def __init__(self, *, client: Any = None, model: str | None = None, api_key: str | None = None):
        from .. import config

        self._client = client
        self.model = model or config.gemini_model()
        self.api_key = api_key

    def is_available(self) -> bool:
        """A key and the SDK are present. No network call."""
        return self._client is not None or sdk_available(self.api_key)

    def _get_client(self) -> Any:
        if self._client is None:
            self._client = make_client(self.api_key, "speech recognition")
        return self._client

    def transcribe(
        self,
        audio: AudioSource,
        *,
        declared_language: str | None = None,
        transcript_id: str | None = None,
    ) -> TranscriptResult:
        if isinstance(audio, bytes):
            data = audio
        else:
            path = Path(audio)
            if not path.exists():
                raise AIError(ErrorCode.PROVIDER_UNAVAILABLE, f"Audio file not found: {path}", recoverable=False)
            data = path.read_bytes()

        try:
            mime_type = inspect_audio(data).content_type
        except MediaRejected as exc:
            raise AIError(
                ErrorCode.MEDIA_QUALITY_INSUFFICIENT, str(exc), recoverable=True, action="record_again"
            ) from exc

        if mime_type == "audio/wav" and _is_silent_pcm16_wav(data):
            raise AIError(
                ErrorCode.ASR_LOW_CONFIDENCE,
                "No speech was heard in this recording.",
                recoverable=True,
                action="record_again",
            )

        from google.genai import errors, types

        client = self._get_client()
        uploaded = None
        try:
            if len(data) > INLINE_LIMIT_BYTES:
                uploaded = client.files.upload(
                    file=io.BytesIO(data), config=types.UploadFileConfig(mime_type=mime_type)
                )
                audio_part = types.Part.from_uri(file_uri=uploaded.uri, mime_type=mime_type)
            else:
                audio_part = types.Part.from_bytes(data=data, mime_type=mime_type)

            response = client.models.generate_content(
                model=self.model,
                contents=[audio_part, _prompt(declared_language)],
                config=types.GenerateContentConfig(
                    temperature=0,
                    response_mime_type="application/json",
                    response_json_schema=RESPONSE_SCHEMA,
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                ),
            )
        except errors.APIError as exc:
            raise api_error(exc, "speech", "The recording is saved.") from exc
        except Exception as exc:  # noqa: BLE001 - network and SDK failures become contract errors
            logger.warning("Gemini transcription failed: %s", exc)
            raise AIError(
                ErrorCode.PROVIDER_UNAVAILABLE,
                "The speech service could not be reached. The recording is saved.",
                recoverable=True,
                action="retry_later",
            ) from exc
        finally:
            if uploaded is not None:
                try:
                    client.files.delete(name=uploaded.name)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Could not delete Gemini upload %s: %s", uploaded.name, exc)

        return self._to_result(response, transcript_id=transcript_id or f"T-{uuid.uuid4()}")

    def _to_result(self, response: Any, *, transcript_id: str) -> TranscriptResult:
        try:
            payload = json.loads(getattr(response, "text", None) or "")
        except ValueError:
            payload = None
        if (
            not isinstance(payload, dict)
            or not isinstance(payload.get("speech_present"), bool)
            or not isinstance(payload.get("original_text"), str)
        ):
            # Also the path for a response blocked by a safety filter, which has no text.
            raise AIError(
                ErrorCode.PROVIDER_UNAVAILABLE,
                "The speech service returned an unreadable response.",
                recoverable=True,
                action="retry_later",
            )

        text = payload["original_text"].strip()
        if not payload["speech_present"] or not text:
            raise AIError(
                ErrorCode.ASR_LOW_CONFIDENCE,
                "No speech was heard in this recording.",
                recoverable=True,
                action="record_again",
            )

        language = str(payload.get("detected_language", "")).strip().lower()
        if not re.fullmatch(r"[a-z]{2,3}", language):
            language = "und"

        return TranscriptResult(
            transcript_id=transcript_id,
            detected_language=language,
            original_text=text,
            # Transcription only. Translation is `TranslationAdapter`'s job.
            english_translation=None,
            hindi_translation=None,
            overall_confidence=None,
            low_confidence_spans=[],
            adapter=AdapterInfo(
                provider=self.name,
                model=self.model,
                version=getattr(response, "model_version", None),
                on_device=False,
            ),
        )


__all__ = ["GeminiASRAdapter", "INLINE_LIMIT_BYTES", "RESPONSE_SCHEMA"]
