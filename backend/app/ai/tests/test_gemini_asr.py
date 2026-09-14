"""
Gemini speech adapter.

Runs against a fake client: these tests check what is sent (the real bytes, a fixed
response shape, no confidence range in the prompt) and how responses and failures map
to the contract. The live test is opt-in and needs a real recording.
"""

from __future__ import annotations

import io
import json
import math
import os
import re
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest
from google.genai import errors

from app.ai.adapters import DEFAULT_ASR_PREFERENCE, GeminiASRAdapter, available_asr
from app.ai.adapters import gemini_asr
from app.ai.adapters.base import ASRAdapter
from app.ai.contracts import AIError, ErrorCode


def _wav(ms=100, amplitude=3000):
    """A tone, so the silence check lets it through unless `amplitude` is near zero."""
    frames = b"".join(
        int(amplitude * math.sin(i / 8)).to_bytes(2, "little", signed=True) for i in range(16 * ms)
    )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(frames)
    return buf.getvalue()


def _response(text="This is a handwoven silk saree.", language="en", speech=True, version="gemini-3.5-flash-001"):
    body = json.dumps({"speech_present": speech, "detected_language": language, "original_text": text})
    return SimpleNamespace(text=body, model_version=version)


class _Models:
    def __init__(self, outcome):
        self.outcome = outcome
        self.calls = []

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class _Files:
    def __init__(self):
        self.uploaded = []
        self.deleted = []

    def upload(self, *, file, config):
        self.uploaded.append((file.read(), config.mime_type))
        return SimpleNamespace(name="files/probe", uri="https://generativelanguage.googleapis.com/v1beta/files/probe")

    def delete(self, *, name):
        self.deleted.append(name)


class _Client:
    def __init__(self, outcome):
        self.models = _Models(outcome)
        self.files = _Files()


def _adapter(outcome):
    client = _Client(outcome)
    return GeminiASRAdapter(client=client, model="gemini-3.5-flash"), client


# --- registration --------------------------------------------------------------------

def test_satisfies_the_protocol_and_is_registered():
    assert isinstance(GeminiASRAdapter(client=object()), ASRAdapter)
    assert "gemini" in available_asr()


def test_gemini_follows_bhashini_in_the_default_order():
    assert DEFAULT_ASR_PREFERENCE == ("bhashini", "gemini", "local_whisper")


def test_unavailable_without_a_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert GeminiASRAdapter().is_available() is False


def test_transcribing_without_a_key_is_a_contract_error(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(AIError) as excinfo:
        GeminiASRAdapter().transcribe(_wav())
    assert excinfo.value.code is ErrorCode.PROVIDER_UNAVAILABLE
    assert excinfo.value.recoverable is False


# --- what is sent --------------------------------------------------------------------

def test_sends_the_recording_bytes_with_the_detected_type():
    audio = _wav()
    adapter, client = _adapter(_response())

    adapter.transcribe(audio, declared_language="kn")

    part = client.models.calls[0]["contents"][0]
    assert part.inline_data.data == audio
    assert part.inline_data.mime_type == "audio/wav"


def test_prompt_passes_the_language_as_a_hint_and_suggests_no_confidence():
    adapter, client = _adapter(_response())
    adapter.transcribe(_wav(), declared_language="kn")

    prompt = client.models.calls[0]["contents"][1]
    assert "'kn'" in prompt and "hint" in prompt
    assert not re.search(r"\d\.\d", prompt), "no numbers for the model to copy into a result"


def test_response_is_constrained_to_the_schema():
    adapter, client = _adapter(_response())
    adapter.transcribe(_wav())

    config = client.models.calls[0]["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_json_schema == gemini_asr.RESPONSE_SCHEMA
    assert config.temperature == 0
    assert client.models.calls[0]["model"] == "gemini-3.5-flash"


def test_large_recordings_go_through_the_files_api_and_are_deleted(monkeypatch):
    monkeypatch.setattr(gemini_asr, "INLINE_LIMIT_BYTES", 100)
    audio = _wav()
    adapter, client = _adapter(_response())

    adapter.transcribe(audio)

    assert client.files.uploaded == [(audio, "audio/wav")]
    assert client.models.calls[0]["contents"][0].file_data.file_uri.endswith("files/probe")
    assert client.files.deleted == ["files/probe"]


def test_uploaded_file_is_deleted_even_when_the_call_fails(monkeypatch):
    monkeypatch.setattr(gemini_asr, "INLINE_LIMIT_BYTES", 100)
    adapter, client = _adapter(errors.ServerError(503, {"error": {"code": 503, "message": "busy", "status": "UNAVAILABLE"}}))

    with pytest.raises(AIError):
        adapter.transcribe(_wav())
    assert client.files.deleted == ["files/probe"]


def test_bytes_that_are_not_audio_are_refused_before_any_call():
    adapter, client = _adapter(_response())
    with pytest.raises(AIError) as excinfo:
        adapter.transcribe(b"GIF89a this is not a recording")
    assert excinfo.value.code is ErrorCode.MEDIA_QUALITY_INSUFFICIENT
    assert excinfo.value.action == "record_again"
    assert client.models.calls == []


@pytest.mark.parametrize("amplitude", [0, 20])
def test_a_silent_wav_is_refused_without_calling_gemini(amplitude):
    """Gemini answered two seconds of digital silence with a greeting. See the module docstring."""
    adapter, client = _adapter(_response())
    with pytest.raises(AIError) as excinfo:
        adapter.transcribe(_wav(amplitude=amplitude))
    assert excinfo.value.code is ErrorCode.ASR_LOW_CONFIDENCE
    assert excinfo.value.action == "record_again"
    assert client.models.calls == []


def test_quiet_audio_above_the_silence_floor_is_still_sent():
    adapter, client = _adapter(_response())
    adapter.transcribe(_wav(amplitude=100))
    assert len(client.models.calls) == 1


def test_compressed_audio_is_sent_because_it_cannot_be_decoded_here():
    m4a = b"\x00\x00\x00\x20ftypM4A \x00\x00\x02\x00" + b"\x00" * 64
    adapter, client = _adapter(_response())
    adapter.transcribe(m4a)
    assert client.models.calls[0]["contents"][0].inline_data.mime_type == "audio/mp4"


# --- what comes back -----------------------------------------------------------------

def test_result_is_stamped_and_carries_no_confidence():
    adapter, _ = _adapter(_response(text="This is a handwoven silk saree.", language="en"))

    result = adapter.transcribe(_wav(), transcript_id="job-1")

    assert result.transcript_id == "job-1"
    assert result.original_text == "This is a handwoven silk saree."
    assert result.detected_language == "en"
    assert result.overall_confidence is None
    assert result.low_confidence_spans == []
    assert result.english_translation is None
    assert result.adapter.provider == "gemini"
    assert result.adapter.model == "gemini-3.5-flash"
    assert result.adapter.version == "gemini-3.5-flash-001"
    assert result.adapter.on_device is False


def test_unknown_confidence_means_the_artisan_hears_it_back():
    adapter, _ = _adapter(_response())
    assert adapter.transcribe(_wav()).needs_replay is True


def test_unrecognised_language_code_becomes_und():
    adapter, _ = _adapter(_response(language="Kannada"))
    assert adapter.transcribe(_wav()).detected_language == "und"


@pytest.mark.parametrize("speech, text", [(False, ""), (True, "   ")])
def test_no_speech_asks_for_a_new_recording(speech, text):
    adapter, _ = _adapter(_response(speech=speech, text=text))
    with pytest.raises(AIError) as excinfo:
        adapter.transcribe(_wav())
    assert excinfo.value.code is ErrorCode.ASR_LOW_CONFIDENCE
    assert excinfo.value.action == "record_again"


@pytest.mark.parametrize("text", ["not json", None, json.dumps({"original_text": "x"})])
def test_unreadable_response_is_a_provider_error(text):
    adapter, _ = _adapter(SimpleNamespace(text=text, model_version=None))
    with pytest.raises(AIError) as excinfo:
        adapter.transcribe(_wav())
    assert excinfo.value.code is ErrorCode.PROVIDER_UNAVAILABLE


@pytest.mark.parametrize(
    "error, recoverable",
    [
        (errors.ClientError(404, {"error": {"code": 404, "message": "model gone", "status": "NOT_FOUND"}}), False),
        (errors.ClientError(400, {"error": {"code": 400, "message": "bad", "status": "INVALID_ARGUMENT"}}), False),
        (errors.ClientError(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}}), True),
        (errors.ServerError(503, {"error": {"code": 503, "message": "busy", "status": "UNAVAILABLE"}}), True),
    ],
)
def test_api_errors_map_to_provider_unavailable(error, recoverable):
    adapter, _ = _adapter(error)
    with pytest.raises(AIError) as excinfo:
        adapter.transcribe(_wav())
    assert excinfo.value.code is ErrorCode.PROVIDER_UNAVAILABLE
    assert excinfo.value.recoverable is recoverable


def test_network_failure_is_a_recoverable_provider_error():
    adapter, _ = _adapter(ConnectionError("offline"))
    with pytest.raises(AIError) as excinfo:
        adapter.transcribe(_wav())
    assert excinfo.value.code is ErrorCode.PROVIDER_UNAVAILABLE
    assert excinfo.value.action == "retry_later"


# --- live, opt-in --------------------------------------------------------------------

@pytest.mark.skipif(
    os.getenv("CRAFTLINK_LIVE_GEMINI") != "1" or not os.getenv("CRAFTLINK_LIVE_GEMINI_AUDIO"),
    reason="set CRAFTLINK_LIVE_GEMINI=1 and CRAFTLINK_LIVE_GEMINI_AUDIO=<recording> to call Gemini",
)
def test_live_transcription_of_a_real_recording():
    from dotenv import load_dotenv

    # Opt-in, so reading the developer's key from backend/.env is expected here.
    load_dotenv(Path(__file__).resolve().parents[3] / ".env")
    result = GeminiASRAdapter().transcribe(Path(os.environ["CRAFTLINK_LIVE_GEMINI_AUDIO"]))
    assert result.original_text
    assert result.adapter.provider == "gemini"
    assert result.adapter.version
    assert result.overall_confidence is None
