"""
Transcription jobs with CRAFTLINK_ASR=gemini.

The adapter is replaced with a recording fake, so these tests check the plumbing: the
bytes uploaded through /media/upload are the bytes the adapter receives, a placeholder
media id is refused, and a provider failure becomes a failed job carrying a contract
error. The adapter itself is tested in app/ai/tests/test_gemini_asr.py.
"""

import io
import uuid
import wave

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.ai.adapters import registry
from app.ai.contracts import AdapterInfo, AIError, ErrorCode, TranscriptResult
from app.main import app

client = TestClient(app)


class _RecordingAdapter:
    name = "gemini"

    def __init__(self):
        self.received = []
        self.error = None

    def is_available(self):
        return True

    def transcribe(self, audio, *, declared_language=None, transcript_id=None):
        self.received.append({"audio": audio, "declared_language": declared_language, "transcript_id": transcript_id})
        if self.error:
            raise self.error
        return TranscriptResult(
            transcript_id=transcript_id,
            detected_language="en",
            original_text="This is a handwoven silk saree.",
            overall_confidence=None,
            adapter=AdapterInfo(provider="gemini", model="gemini-3.5-flash", version="test", on_device=False),
        )


@pytest.fixture
def adapter(monkeypatch):
    monkeypatch.setenv("CRAFTLINK_ASR", "gemini")
    fake = _RecordingAdapter()
    monkeypatch.setitem(registry._ASR, "gemini", lambda: fake)
    return fake


def _artisan():
    uid = uuid.uuid4().hex[:8]
    res = client.post("/api/v1/auth/register", json={
        "username": f"artisan_{uid}",
        "email": f"artisan_{uid}@karigari.local",
        "password": "TranscribeTest123!",
        "role": "artisan",
    })
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    listing = client.post("/api/v1/listings", json={"preferred_language": "kn"}, headers=headers)
    assert listing.status_code == 200, listing.text
    return headers, listing.json()["id"]


def _wav():
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(bytes(range(256)) * 20)
    return buf.getvalue()


def _upload(listing_id, headers, kind, data, filename, content_type):
    res = client.post(
        f"/api/v1/listings/{listing_id}/media/upload",
        data={"kind": kind},
        files={"file": (filename, data, content_type)},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    return res.json()["media_id"]


def _transcribe(listing_id, headers, media_id):
    return client.post(
        f"/api/v1/listings/{listing_id}/jobs/transcription",
        json={"audio_media_id": media_id, "declared_language": "kn"},
        headers=headers,
    )


def test_the_uploaded_recording_reaches_the_adapter(adapter):
    headers, listing_id = _artisan()
    audio = _wav()
    media_id = _upload(listing_id, headers, "audio", audio, "note.wav", "audio/wav")

    res = _transcribe(listing_id, headers, media_id)
    assert res.status_code == 200, res.text
    job_id = res.json()["job_id"]

    assert adapter.received == [{"audio": audio, "declared_language": "kn", "transcript_id": job_id}]

    assert client.get(f"/api/v1/jobs/{job_id}", headers=headers).json()["status"] == "complete"
    result = client.get(f"/api/v1/jobs/{job_id}/result", headers=headers).json()
    assert result["transcript_id"] == job_id
    assert result["original_text"] == "This is a handwoven silk saree."
    assert result["overall_confidence"] is None
    assert result["needs_replay"] is True
    assert result["adapter"]["provider"] == "gemini"


def test_a_placeholder_media_id_is_refused(adapter):
    headers, listing_id = _artisan()
    res = _transcribe(listing_id, headers, "mock_audio_123")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "LISTING_STATE_INVALID"
    assert adapter.received == []


def test_a_photo_is_not_transcribed(adapter):
    headers, listing_id = _artisan()
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), (120, 80, 40)).save(buf, "PNG")
    media_id = _upload(listing_id, headers, "image", buf.getvalue(), "photo.png", "image/png")

    assert _transcribe(listing_id, headers, media_id).status_code == 404
    assert adapter.received == []


def test_a_provider_failure_is_a_failed_job_with_a_contract_error(adapter):
    adapter.error = AIError(ErrorCode.ASR_LOW_CONFIDENCE, "No speech was heard.", action="record_again")
    headers, listing_id = _artisan()
    media_id = _upload(listing_id, headers, "audio", _wav(), "note.wav", "audio/wav")

    job_id = _transcribe(listing_id, headers, media_id).json()["job_id"]

    assert client.get(f"/api/v1/jobs/{job_id}", headers=headers).json()["status"] == "failed"
    result = client.get(f"/api/v1/jobs/{job_id}/result", headers=headers).json()
    assert result["status"] == "failed"
    assert result["error"]["code"] == "ASR_LOW_CONFIDENCE"
    assert result["error"]["action"] == "record_again"


def test_catalogue_uses_the_transcript_without_inventing_a_confidence(adapter):
    headers, listing_id = _artisan()
    media_id = _upload(listing_id, headers, "audio", _wav(), "note.wav", "audio/wav")
    job_id = _transcribe(listing_id, headers, media_id).json()["job_id"]

    res = client.post(f"/api/v1/listings/{listing_id}/jobs/catalogue", json={}, headers=headers)
    assert res.status_code == 200, res.text
    source = res.json()["catalogue"]["source"]
    assert source["transcript_id"] == job_id
    assert source["asr_confidence"] is None


def test_an_unknown_mode_fails_loudly(adapter, monkeypatch):
    monkeypatch.setenv("CRAFTLINK_ASR", "whisperx")
    headers, listing_id = _artisan()
    media_id = _upload(listing_id, headers, "audio", _wav(), "note.wav", "audio/wav")

    res = _transcribe(listing_id, headers, media_id)
    assert res.status_code == 500
    assert "CRAFTLINK_ASR" in res.json()["error"]["message"]
