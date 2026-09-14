"""
The legacy paths say what they are.

With CRAFTLINK_IMAGE, CRAFTLINK_ASR and CRAFTLINK_CATALOGUE at `legacy`, results come from
fixed demo content. Every such result carries `adapter.provider: "fixture"`, claims no
work that did not happen, and refuses media that does not exist instead of substituting
a stock file.
"""

import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _artisan(language="kn"):
    uid = uuid.uuid4().hex[:8]
    res = client.post("/api/v1/auth/register", json={
        "username": f"artisan_{uid}",
        "email": f"artisan_{uid}@karigari.local",
        "password": "LabelTest123!",
        "role": "artisan",
    })
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    listing = client.post("/api/v1/listings", json={"preferred_language": language}, headers=headers)
    assert listing.status_code == 200, listing.text
    return headers, listing.json()["id"]


def _legacy_media(listing_id, headers, kind, url):
    res = client.post(f"/api/v1/listings/{listing_id}/media", json={"kind": kind, "url": url}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()["media_id"]


def test_legacy_image_job_is_labelled_and_claims_no_enhancement():
    headers, listing_id = _artisan()
    media_id = _legacy_media(listing_id, headers, "image", "https://example.invalid/photo.jpg")

    job = client.post(f"/api/v1/listings/{listing_id}/jobs/image-studio", json={"media_id": media_id}, headers=headers)
    assert job.status_code == 200, job.text
    result = client.get(f"/api/v1/jobs/{job.json()['job_id']}/result", headers=headers).json()

    assert result["adapter"]["provider"] == "fixture"
    assert result["notice"]
    assert result["transformations"] == []
    assert result["enhanced_url"] is None and result["enhanced_urls"] == []
    assert result["human_review_required"] is True
    media = client.get(f"/api/v1/listings/{listing_id}", headers=headers).json()["media"]
    assert [m["variant"] for m in media] == ["original"]


def test_legacy_jobs_refuse_media_that_does_not_exist():
    headers, listing_id = _artisan()
    image = client.post(f"/api/v1/listings/{listing_id}/jobs/image-studio", json={"media_id": "nonexistent-media-id"}, headers=headers)
    audio = client.post(
        f"/api/v1/listings/{listing_id}/jobs/transcription",
        json={"audio_media_id": "no-such-audio", "declared_language": "kn"},
        headers=headers,
    )
    assert image.status_code == 404 and image.json()["error"]["code"] == "LISTING_STATE_INVALID"
    assert audio.status_code == 404 and audio.json()["error"]["code"] == "LISTING_STATE_INVALID"


def test_legacy_transcript_and_catalogue_are_labelled():
    headers, listing_id = _artisan()
    audio_id = _legacy_media(listing_id, headers, "audio", "https://example.invalid/note.m4a")

    job = client.post(
        f"/api/v1/listings/{listing_id}/jobs/transcription",
        json={"audio_media_id": audio_id, "declared_language": "kn"},
        headers=headers,
    )
    transcript = client.get(f"/api/v1/jobs/{job.json()['job_id']}/result", headers=headers).json()
    assert transcript["adapter"]["provider"] == "fixture"
    assert transcript["notice"]

    res = client.post(f"/api/v1/listings/{listing_id}/jobs/catalogue", json={}, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["adapter"]["provider"] == "fixture"
    assert body["catalogue"]["source"]["catalogue_provider"] == "fixture"
    assert body["catalogue"]["source"]["asr_provider"] == "fixture"

    stored = client.get(f"/api/v1/listings/{listing_id}", headers=headers).json()["catalogue"]["catalogue"]
    assert stored["source"]["catalogue_provider"] == "fixture"


def test_deprecated_media_endpoint_no_longer_invents_a_file():
    headers, listing_id = _artisan()
    res = client.post(f"/api/v1/listings/{listing_id}/media", json={"kind": "image"}, headers=headers)
    assert res.status_code == 422
    assert client.get(f"/api/v1/listings/{listing_id}", headers=headers).json()["media"] == []


def test_legacy_client_makes_no_model_calls(monkeypatch):
    import google.genai

    def refuse(*args, **kwargs):
        raise AssertionError("the legacy client must not create a Gemini client")

    monkeypatch.setattr(google.genai, "Client", refuse)
    from app.ai.gemini_client import GeminiClient

    legacy = GeminiClient()
    legacy.audit_image_quality("https://example.invalid/photo.jpg")
    legacy.transcribe_and_translate("https://example.invalid/note.m4a", declared_language="hi")
    legacy.extract_catalogue_metadata("anything", declared_language="en")


def test_ai_config_says_what_is_serving(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    body = client.get("/api/v1/ai/config").json()

    assert body["serving"] == {
        "transcription": "fixture",
        "catalogue": "fixture",
        "image": "fixture",
        "photo_check": "off",
    }
    assert body["gemini"]["key_configured"] is False
    assert body["gemini"]["reachable"] is None


def test_ai_config_names_the_live_modes(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("CRAFTLINK_ASR", "gemini")
    monkeypatch.setenv("CRAFTLINK_CATALOGUE", "gemini")
    monkeypatch.setenv("CRAFTLINK_IMAGE", "studio")
    assert client.get("/api/v1/ai/config").json()["serving"] == {
        "transcription": "gemini",
        "catalogue": "gemini",
        "image": "studio",
        "photo_check": "off",
    }
