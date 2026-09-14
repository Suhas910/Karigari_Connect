"""
Image jobs with CRAFTLINK_IMAGE=studio: the uploaded photo is graded and enhanced.

Runs the real quality measures and segmentation model on a drawn scene uploaded through
/media/upload. The Gemini photo check is replaced by a fake where it is exercised.
"""

import io
import uuid
import wave

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.ai import service as ai_service_module
from app.ai.adapters.gemini_photo import ISSUES
from app.ai.contracts import AdapterInfo, AIError, ErrorCode, PhotoCheckResult
from app.ai.fixtures.segmentation_scenes import scenes
from app.ai.tests.conftest import image_fixture
from app.main import app

client = TestClient(app)

KNOWN_TRANSFORMS = {"exposure_normalization", "white_balance", "background_neutralization", "crop", "resize"}


@pytest.fixture
def studio(monkeypatch):
    monkeypatch.setenv("CRAFTLINK_IMAGE", "studio")
    monkeypatch.setenv("CRAFTLINK_PHOTO_CHECK", "off")


def _artisan():
    uid = uuid.uuid4().hex[:8]
    res = client.post("/api/v1/auth/register", json={
        "username": f"artisan_{uid}",
        "email": f"artisan_{uid}@karigari.local",
        "password": "ImageJobTest123!",
        "role": "artisan",
    })
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    listing = client.post("/api/v1/listings", json={"preferred_language": "en"}, headers=headers)
    assert listing.status_code == 200, listing.text
    return headers, listing.json()["id"]


def _jpeg(image):
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    return encoded.tobytes()


def _upload(listing_id, headers, kind, data, filename, content_type):
    res = client.post(
        f"/api/v1/listings/{listing_id}/media/upload",
        data={"kind": kind},
        files={"file": (filename, data, content_type)},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    return res.json()["media_id"]


def _run(listing_id, headers, media_id):
    res = client.post(f"/api/v1/listings/{listing_id}/jobs/image-studio", json={"media_id": media_id}, headers=headers)
    return res


def _result(job_id, headers):
    return client.get(f"/api/v1/jobs/{job_id}/result", headers=headers).json()


def _scene_photo():
    return _jpeg(scenes()["vessel_on_striped_cloth"][0])


def test_uploaded_photo_is_graded_and_an_enhanced_copy_is_stored(studio):
    headers, listing_id = _artisan()
    media_id = _upload(listing_id, headers, "image", _scene_photo(), "pot.jpg", "image/jpeg")

    res = _run(listing_id, headers, media_id)
    assert res.status_code == 200, res.text
    result = _result(res.json()["job_id"], headers)

    assert result["status"] == "complete", result
    assert result["original_media_id"] == media_id
    assert result["quality"]["overall"] in ("acceptable", "needs_correction")
    assert result["quality"]["blur"] in ("acceptable", "needs_correction", "unacceptable")
    assert set(result["transformations"]) <= KNOWN_TRANSFORMS
    assert result["adapter"]["provider"] == "studio"
    assert result["photo_check"] == {"status": "skipped"}

    enhanced = client.get(result["enhanced_url"], headers=headers)
    assert enhanced.status_code == 200
    assert enhanced.headers["content-type"] == "image/jpeg"
    assert cv2.imdecode(np.frombuffer(enhanced.content, np.uint8), cv2.IMREAD_COLOR) is not None

    media = client.get(f"/api/v1/listings/{listing_id}", headers=headers).json()["media"]
    assert {m["variant"] for m in media} == {"original", "enhanced"}


def test_an_unusable_photo_fails_with_retake_guidance_and_no_enhanced_copy(studio):
    # The synthetic "blurred" fixture, which grades unacceptable as PNG and as JPEG. A
    # blurred copy of the striped scene grades needs_correction instead: its stripes keep
    # enough contrast to read as soft rather than unusable.
    headers, listing_id = _artisan()
    blurred = cv2.imread(str(image_fixture("blurred")))
    media_id = _upload(listing_id, headers, "image", _jpeg(blurred), "cloth.jpg", "image/jpeg")

    job_id = _run(listing_id, headers, media_id).json()["job_id"]
    assert client.get(f"/api/v1/jobs/{job_id}", headers=headers).json()["status"] == "failed"

    result = _result(job_id, headers)
    assert result["error"]["code"] == "MEDIA_QUALITY_INSUFFICIENT"
    assert result["error"]["action"] == "retake_photo"
    assert result["quality"]["overall"] == "unacceptable"
    assert result["quality"]["guidance"]
    assert "enhanced_media_id" not in result

    media = client.get(f"/api/v1/listings/{listing_id}", headers=headers).json()["media"]
    assert [m["variant"] for m in media] == ["original"]


def test_a_placeholder_media_id_is_refused(studio):
    headers, listing_id = _artisan()
    res = _run(listing_id, headers, "media_photo_batch")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "LISTING_STATE_INVALID"


def test_a_voice_note_is_not_a_photo(studio):
    headers, listing_id = _artisan()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(bytes(range(256)) * 20)
    media_id = _upload(listing_id, headers, "audio", buf.getvalue(), "note.wav", "audio/wav")
    assert _run(listing_id, headers, media_id).status_code == 404


class _FakeCheck:
    def __init__(self, issues=None, error=None):
        self.issues = issues or []
        self.error = error
        self.received = []

    def check(self, image, mime_type):
        self.received.append((image, mime_type))
        if self.error:
            raise self.error
        order = ["acceptable", "needs_correction", "unacceptable"]
        return PhotoCheckResult(
            issues=self.issues,
            level=max([ISSUES[i][0] for i in self.issues] or ["acceptable"], key=order.index),
            guidance=[ISSUES[i][1] for i in self.issues],
            adapter=AdapterInfo(provider="gemini", model="fake", on_device=False),
        )


def test_the_photo_check_can_only_make_the_grade_stricter(studio, monkeypatch):
    monkeypatch.setenv("CRAFTLINK_PHOTO_CHECK", "gemini")
    fake = _FakeCheck(issues=["person_visible"])
    monkeypatch.setattr(ai_service_module, "GeminiPhotoCheck", lambda: fake)
    headers, listing_id = _artisan()
    photo = _scene_photo()
    media_id = _upload(listing_id, headers, "image", photo, "pot.jpg", "image/jpeg")

    result = _result(_run(listing_id, headers, media_id).json()["job_id"], headers)

    assert fake.received and fake.received[0][1] == "image/jpeg"
    assert result["photo_check"]["status"] == "complete"
    assert result["photo_check"]["issues"] == ["person_visible"]
    assert result["quality"]["overall"] in ("needs_correction", "unacceptable")
    assert ISSUES["person_visible"][1] in result["quality"]["guidance"]
    if result["status"] == "complete":
        assert result["human_review_required"] is True


def test_a_photo_check_outage_does_not_fail_the_job(studio, monkeypatch):
    monkeypatch.setenv("CRAFTLINK_PHOTO_CHECK", "gemini")
    fake = _FakeCheck(error=AIError(ErrorCode.PROVIDER_UNAVAILABLE, "busy", action="retry_later"))
    monkeypatch.setattr(ai_service_module, "GeminiPhotoCheck", lambda: fake)
    headers, listing_id = _artisan()
    media_id = _upload(listing_id, headers, "image", _scene_photo(), "pot.jpg", "image/jpeg")

    result = _result(_run(listing_id, headers, media_id).json()["job_id"], headers)
    assert result["status"] == "complete", result
    assert result["photo_check"]["status"] == "unavailable"
