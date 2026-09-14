"""
Buyer-facing photo copies made at approval, and the artisan seeing why a listing came back.

Runs on the local stores in throwaway directories (conftest.py). The Supabase public store
is checked with a fake client for its refusal of a private bucket.
"""

import io
from types import SimpleNamespace
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.public_media import SupabasePublicStore
from app.storage import StorageUnavailable
from tests.test_review_and_export import GOOD_CATALOGUE, _confirmed, _post, _user

client = TestClient(app)

GPS_IFD = 0x8825
MAKE_TAG = 0x010F


def _large_jpeg_with_gps(size=(2400, 1200)):
    exif = Image.Exif()
    exif[MAKE_TAG] = "TestPhoneMaker"
    exif.get_ifd(GPS_IFD)[1] = "N"
    buf = io.BytesIO()
    Image.effect_noise(size, 40).convert("RGB").save(buf, "JPEG", quality=80, exif=exif)
    return buf.getvalue()


def _upload_photo(artisan, listing_id):
    return client.post(
        f"/api/v1/listings/{listing_id}/media/upload",
        data={"kind": "image"},
        files={"file": ("photo.jpg", _large_jpeg_with_gps(), "image/jpeg")},
        headers=artisan,
    )


def _approved_with_uploaded_photo():
    artisan, coordinator = _user("artisan"), _user("coordinator")
    listing_id = _post("/listings", artisan, {"preferred_language": "kn"}).json()["id"]
    assert _upload_photo(artisan, listing_id).status_code == 200
    assert _post(f"/listings/{listing_id}/media", artisan, {"kind": "audio", "url": "https://example.invalid/note.m4a"}).status_code == 200
    audio_id = [m for m in client.get(f"/api/v1/listings/{listing_id}", headers=artisan).json()["media"] if m["kind"] == "audio"][0]["id"]
    assert _post(f"/listings/{listing_id}/jobs/transcription", artisan, {"audio_media_id": audio_id, "declared_language": "kn"}).status_code == 200
    generated = _post(f"/listings/{listing_id}/jobs/catalogue", artisan).json()
    assert _post(f"/listings/{listing_id}/price", artisan, {
        "material_cost_paise": 45000, "labour_hours": 6, "skill_level": "skilled", "state_code": "KA",
    }).status_code == 200
    claims = [{"claim": "natural_dye", "asserted_by_artisan": True, "coordinator_verified": False, "evidence_note": None}]
    body = {
        "catalogue": {**generated["catalogue"], **GOOD_CATALOGUE, "provenance": {"claims": claims, "gi_tag": None}},
        "confirmed_fields": generated["needs_confirmation"] + ["provenance.natural_dye"],
        "corrections": [],
    }
    assert _post(f"/listings/{listing_id}/confirm", artisan, body).status_code == 200
    assert _post(f"/listings/{listing_id}/claims/natural_dye/review", coordinator, {"decision": "verified", "evidence_note": "Checked the dye batch."}).status_code == 200
    res = _post(f"/listings/{listing_id}/approval", coordinator, {"decision": "approve"})
    assert res.status_code == 200, res.text
    assert res.json()["public_photos"] == 1
    return artisan, coordinator, listing_id, body


def test_approval_makes_a_clean_public_copy_that_export_uses():
    artisan, coordinator, listing_id, _ = _approved_with_uploaded_photo()
    urls = client.get(f"/api/v1/listings/{listing_id}", headers=artisan).json()["public_photo_urls"]
    assert len(urls) == 1 and "/api/v1/public/photos/" in urls[0]

    photo = client.get(urlparse(urls[0]).path)  # no sign-in
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(photo.content)) as image:
        assert max(image.size) <= 1600
        assert len(image.getexif()) == 0

    body = _post(f"/listings/{listing_id}/exports", coordinator, {"target": "ondc"}).json()
    item = body["payload"]["message"]["catalog"]["bpp/providers"][0]["items"][0]
    assert item["descriptor"]["images"] == urls
    assert body["contract_validation"]["passed"] is True
    assert not any("No images" in w for w in body["warnings"])
    assert any("development server" in w for w in body["warnings"])


def test_the_private_original_still_needs_sign_in():
    artisan, _, listing_id, _ = _approved_with_uploaded_photo()
    original = [m for m in client.get(f"/api/v1/listings/{listing_id}", headers=artisan).json()["media"] if m["kind"] == "image"][0]
    assert client.get(original["url"]).status_code == 401


def test_changing_an_approved_listing_takes_its_public_photos_down():
    artisan, _, listing_id, body = _approved_with_uploaded_photo()
    url = client.get(f"/api/v1/listings/{listing_id}", headers=artisan).json()["public_photo_urls"][0]

    assert _post(f"/listings/{listing_id}/confirm", artisan, {**body, "confirmed_fields": []}).status_code == 200
    listing = client.get(f"/api/v1/listings/{listing_id}", headers=artisan).json()
    assert listing["state"] == "awaiting_approval" and listing["public_photo_urls"] == []
    assert client.get(urlparse(url).path).status_code == 404


def test_unknown_public_photo_names_are_not_served():
    assert client.get("/api/v1/public/photos/../media_store/x.jpg").status_code == 404
    assert client.get("/api/v1/public/photos/" + "0" * 32 + ".jpg").status_code == 404


def test_a_sent_back_listing_shows_the_reason_and_can_be_fixed():
    artisan, coordinator = _user("artisan"), _user("coordinator")
    listing_id = _confirmed(artisan)
    reason = "The photo shows a different piece."
    assert _post(f"/listings/{listing_id}/approval", coordinator, {"decision": "reject", "reason": reason}).status_code == 200

    listing = client.get(f"/api/v1/listings/{listing_id}", headers=artisan).json()
    assert listing["state"] == "rejected" and listing["rejection_reason"] == reason
    assert _upload_photo(artisan, listing_id).status_code == 200  # a new photo is allowed

    assert _post(f"/listings/{listing_id}/submit-for-approval", artisan).status_code == 200
    listing = client.get(f"/api/v1/listings/{listing_id}", headers=artisan).json()
    assert listing["state"] == "awaiting_approval" and listing["rejection_reason"] is None


def test_a_private_bucket_is_refused_for_public_copies():
    fake = SimpleNamespace(storage=SimpleNamespace(get_bucket=lambda name: SimpleNamespace(public=False)))
    with pytest.raises(StorageUnavailable, match="private"):
        SupabasePublicStore(fake, "listing-public")
