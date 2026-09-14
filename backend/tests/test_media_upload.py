"""
Multipart media upload (POST /listings/{id}/media/upload) and authenticated read-back
(GET /media/{id}/content).

Runs against the local media store in a throwaway directory (see conftest.py). The
Supabase backend is exercised with a fake client: these tests check the refusal of a
public bucket and the shape of the upload call, not a live Supabase project.

The MP4 and ADTS audio samples below are container headers, not playable recordings.
The upload step only identifies the container; decoding is the speech step's job.
"""

import hashlib
import io
import uuid
import wave

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import media_inspect
from app.main import app
from app.storage import LocalMediaStore, MediaNotFound, StorageUnavailable, SupabaseMediaStore

client = TestClient(app)

GPS_IFD = 0x8825
MAKE_TAG = 0x010F
ORIENTATION_TAG = 0x0112


# --- helpers -------------------------------------------------------------------------

def _register(role="artisan"):
    uid = uuid.uuid4().hex[:8]
    res = client.post("/api/v1/auth/register", json={
        "username": f"{role}_{uid}",
        "email": f"{role}_{uid}@karigari.local",
        "password": "UploadTest123!",
        "role": role,
    })
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _listing(headers):
    res = client.post("/api/v1/listings", json={"preferred_language": "kn"}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _png(size=(32, 24)):
    buf = io.BytesIO()
    Image.new("RGB", size, (180, 120, 60)).save(buf, "PNG")
    return buf.getvalue()


def _noise_jpeg(size=(200, 200)):
    buf = io.BytesIO()
    Image.effect_noise(size, 64).convert("RGB").save(buf, "JPEG", quality=90)
    return buf.getvalue()


def _jpeg_with_exif(size=(40, 20), orientation=1):
    exif = Image.Exif()
    exif[MAKE_TAG] = "TestPhoneMaker"
    exif[ORIENTATION_TAG] = orientation
    gps = exif.get_ifd(GPS_IFD)
    gps[1] = "N"
    gps[2] = (12.0, 58.0, 0.0)
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 150, 100)).save(buf, "JPEG", quality=90, exif=exif)
    return buf.getvalue()


def _wav(ms=200):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * (16 * ms))
    return buf.getvalue()


MP4_HEADER = b"\x00\x00\x00\x20ftypM4A \x00\x00\x02\x00" + b"\x00" * 64
ADTS_HEADER = bytes([0xFF, 0xF1, 0x50, 0x80, 0x02, 0x1F, 0xFC]) + b"\x00" * 64


def _upload(listing_id, headers, kind, data, filename, content_type, **form):
    return client.post(
        f"/api/v1/listings/{listing_id}/media/upload",
        data={"kind": kind, **form},
        files={"file": (filename, data, content_type)},
        headers=headers,
    )


def _media_rows(listing_id, headers):
    return client.get(f"/api/v1/listings/{listing_id}", headers=headers).json()["media"]


def _served(body, headers):
    res = client.get(body["url"], headers=headers)
    assert res.status_code == 200, res.text
    return res


# --- storing and serving -------------------------------------------------------------

def test_photo_is_stored_byte_for_byte_and_served_back_to_its_owner():
    artisan = _register()
    listing_id = _listing(artisan)
    png = _png()

    res = _upload(listing_id, artisan, "image", png, "photo.png", "image/png")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["kind"] == "image"
    assert body["content_type"] == "image/png"
    assert body["size_bytes"] == len(png)
    assert body["checksum"] == "sha256:" + hashlib.sha256(png).hexdigest()
    assert body["deduplicated"] is False
    assert body["url"] == f"/api/v1/media/{body['media_id']}/content"

    served = _served(body, artisan)
    assert served.content == png
    assert served.headers["content-type"] == "image/png"
    assert served.headers["cache-control"] == "private, no-store"

    rows = _media_rows(listing_id, artisan)
    assert [(r["id"], r["kind"], r["url"]) for r in rows] == [(body["media_id"], "image", body["url"])]


def test_location_metadata_is_removed_from_photos():
    artisan = _register()
    listing_id = _listing(artisan)
    data = _jpeg_with_exif()
    # Guard against a vacuous pass: the fixture must really carry GPS and device data.
    original_exif = Image.open(io.BytesIO(data)).getexif()
    assert MAKE_TAG in original_exif and original_exif.get_ifd(GPS_IFD)

    body = _upload(listing_id, artisan, "image", data, "photo.jpg", "image/jpeg").json()

    served = Image.open(io.BytesIO(_served(body, artisan).content))
    assert served.format == "JPEG"
    assert len(served.getexif()) == 0
    assert served.size == (40, 20)


def test_rotated_photo_stays_upright_after_metadata_removal():
    artisan = _register()
    listing_id = _listing(artisan)
    # Orientation 6: stored landscape, displayed portrait. Dropping the tag without
    # applying it would show the artisan's photo sideways.
    data = _jpeg_with_exif(size=(40, 20), orientation=6)

    body = _upload(listing_id, artisan, "image", data, "photo.jpg", "image/jpeg").json()

    assert Image.open(io.BytesIO(_served(body, artisan).content)).size == (20, 40)


@pytest.mark.parametrize("data, filename, sent_type, expected_type", [
    (_wav(), "voice.wav", "audio/wav", "audio/wav"),
    (MP4_HEADER, "voice.m4a", "audio/m4a", "audio/mp4"),
    (ADTS_HEADER, "voice.aac", "audio/aac", "audio/aac"),
])
def test_voice_recordings_are_identified_by_container(data, filename, sent_type, expected_type):
    artisan = _register()
    listing_id = _listing(artisan)

    res = _upload(listing_id, artisan, "audio", data, filename, sent_type)

    assert res.status_code == 200, res.text
    assert res.json()["content_type"] == expected_type
    assert _served(res.json(), artisan).content == data


# --- refusals ------------------------------------------------------------------------

@pytest.mark.parametrize("kind, data, filename, sent_type", [
    ("image", b"this is plain text, not a photo", "photo.jpg", "image/jpeg"),
    ("image", _wav(), "photo.png", "image/png"),
    ("audio", _png(), "voice.m4a", "audio/m4a"),
    ("audio", b"", "voice.m4a", "audio/m4a"),
])
def test_bytes_that_are_not_the_declared_kind_are_refused_and_not_stored(kind, data, filename, sent_type):
    artisan = _register()
    listing_id = _listing(artisan)

    res = _upload(listing_id, artisan, kind, data, filename, sent_type)

    assert res.status_code == 415, res.text
    assert res.json()["error"]["code"] == "MEDIA_QUALITY_INSUFFICIENT"
    assert _media_rows(listing_id, artisan) == []


def test_truncated_photo_is_refused():
    artisan = _register()
    listing_id = _listing(artisan)
    data = _noise_jpeg()
    truncated = data[: len(data) * 6 // 10]

    res = _upload(listing_id, artisan, "image", truncated, "photo.jpg", "image/jpeg")

    assert res.status_code == 415, res.text
    assert _media_rows(listing_id, artisan) == []


def test_oversized_upload_is_refused(monkeypatch):
    artisan = _register()
    listing_id = _listing(artisan)
    data = _noise_jpeg()
    monkeypatch.setattr(media_inspect, "MAX_IMAGE_BYTES", len(data) - 1)

    res = _upload(listing_id, artisan, "image", data, "photo.jpg", "image/jpeg")

    assert res.status_code == 413, res.text
    assert res.json()["error"]["code"] == "MEDIA_QUALITY_INSUFFICIENT"
    assert _media_rows(listing_id, artisan) == []


def test_unknown_kind_is_refused():
    artisan = _register()
    listing_id = _listing(artisan)

    res = _upload(listing_id, artisan, "video", _png(), "clip.png", "image/png")

    assert res.status_code == 422, res.text


def test_checksum_mismatch_is_refused_and_a_matching_one_accepted():
    artisan = _register()
    listing_id = _listing(artisan)
    png = _png()

    bad = _upload(listing_id, artisan, "image", png, "photo.png", "image/png",
                  client_checksum="sha256:" + "0" * 64)
    assert bad.status_code == 400, bad.text
    assert bad.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert _media_rows(listing_id, artisan) == []

    # Prefix and case are normalised.
    good = _upload(listing_id, artisan, "image", png, "photo.png", "image/png",
                   client_checksum="SHA256:" + hashlib.sha256(png).hexdigest().upper())
    assert good.status_code == 200, good.text


def test_retrying_the_same_file_returns_the_same_media_record():
    artisan = _register()
    listing_id = _listing(artisan)
    png = _png()

    first = _upload(listing_id, artisan, "image", png, "photo.png", "image/png").json()
    retry = _upload(listing_id, artisan, "image", png, "photo-retry.png", "image/png").json()
    other = _upload(listing_id, artisan, "image", _png((33, 24)), "photo2.png", "image/png").json()

    assert retry["media_id"] == first["media_id"]
    assert retry["deduplicated"] is True
    assert other["media_id"] != first["media_id"]
    assert len(_media_rows(listing_id, artisan)) == 2


def test_upload_is_refused_once_the_listing_is_submitted():
    artisan = _register()
    listing_id = _listing(artisan)
    # Submission needs a photo and confirmed details (see ai/linkage/export.submission_problems).
    assert _upload(listing_id, artisan, "image", _png(), "photo.png", "image/png").status_code == 200
    confirm = client.post(
        f"/api/v1/listings/{listing_id}/confirm",
        json={"catalogue": {}, "confirmed_fields": [], "corrections": []},
        headers=artisan,
    )
    assert confirm.status_code == 200, confirm.text
    submit = client.post(f"/api/v1/listings/{listing_id}/submit-for-approval", headers=artisan)
    assert submit.status_code == 200, submit.text

    res = _upload(listing_id, artisan, "image", _png((40, 30)), "photo2.png", "image/png")

    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "LISTING_STATE_INVALID"


def test_unknown_storage_backend_fails_closed(monkeypatch):
    artisan = _register()
    listing_id = _listing(artisan)
    monkeypatch.setenv("CRAFTLINK_MEDIA_STORAGE", "s3")

    res = _upload(listing_id, artisan, "image", _png(), "photo.png", "image/png")

    assert res.status_code == 503, res.text
    assert res.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert _media_rows(listing_id, artisan) == []


# --- who may upload and read ---------------------------------------------------------

def test_only_the_owning_artisan_can_upload():
    owner = _register()
    listing_id = _listing(owner)

    for intruder in (_register("artisan"), _register("coordinator")):
        res = _upload(listing_id, intruder, "image", _png(), "photo.png", "image/png")
        assert res.status_code == 403, res.text
    assert _media_rows(listing_id, owner) == []


def test_media_is_readable_by_owner_and_coordinators_only():
    owner = _register()
    listing_id = _listing(owner)
    body = _upload(listing_id, owner, "audio", _wav(), "voice.wav", "audio/wav").json()

    assert client.get(body["url"], headers=_register("artisan")).status_code == 403
    assert client.get(body["url"]).status_code == 401
    assert client.get(body["url"], headers=_register("coordinator")).status_code == 200


def test_legacy_url_only_media_has_no_content_to_serve():
    artisan = _register()
    listing_id = _listing(artisan)
    legacy = client.post(f"/api/v1/listings/{listing_id}/media",
                         json={"kind": "image", "url": "https://example.org/x.jpg"}, headers=artisan).json()

    res = client.get(f"/api/v1/media/{legacy['media_id']}/content", headers=artisan)

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "LISTING_STATE_INVALID"


# --- storage backends ----------------------------------------------------------------

@pytest.mark.parametrize("key", ["../outside.jpg", "/etc/passwd", "a/../../b.jpg", "a\\b.jpg", "", "a//b.jpg"])
def test_local_store_refuses_keys_that_escape_its_root(tmp_path, key):
    store = LocalMediaStore(tmp_path / "root")

    with pytest.raises(ValueError):
        store.put(key, b"x", "image/png")
    assert not (tmp_path / "outside.jpg").exists()


class _FakeBucketInfo:
    def __init__(self, public):
        self.public = public


class _FakeFileApi:
    def __init__(self):
        self.uploads = []

    def upload(self, path, data, options):
        self.uploads.append((path, data, options))

    def download(self, path):
        raise self.download_error


class _FakeStorage:
    def __init__(self, public):
        self._public = public
        self.files = _FakeFileApi()

    def get_bucket(self, name):
        return _FakeBucketInfo(self._public)

    def from_(self, name):
        return self.files


class _FakeClient:
    def __init__(self, public):
        self.storage = _FakeStorage(public)


def test_supabase_store_refuses_a_public_bucket():
    with pytest.raises(StorageUnavailable, match="public"):
        SupabaseMediaStore(_FakeClient(public=True), "product_images")


def test_supabase_store_uploads_to_a_private_bucket_without_overwriting():
    fake = _FakeClient(public=False)
    store = SupabaseMediaStore(fake, "media")

    store.put("listings/l1/image/m1.png", b"png-bytes", "image/png")

    assert fake.storage.files.uploads == [
        ("listings/l1/image/m1.png", b"png-bytes", {"content-type": "image/png", "upsert": "false"})
    ]


class _FakeApiError(Exception):
    # Shape of storage3's StorageApiError, checked against the live project 2026-09-14.
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


def test_supabase_store_reports_a_missing_object_as_not_found():
    fake = _FakeClient(public=False)
    fake.storage.files.download_error = _FakeApiError(404, "not_found")
    with pytest.raises(MediaNotFound):
        SupabaseMediaStore(fake, "media").get("listings/l1/image/gone.png")


def test_supabase_store_reports_other_failures_as_unavailable():
    fake = _FakeClient(public=False)
    fake.storage.files.download_error = _FakeApiError(500, "internal")
    with pytest.raises(StorageUnavailable):
        SupabaseMediaStore(fake, "media").get("listings/l1/image/m1.png")
