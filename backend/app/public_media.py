"""
Buyer-facing copies of approved listing photos.

Artisan media is private (`storage.py`): a voice note or a workshop photo is personal data.
A buyer app needs a link anyone can open and that keeps working, so approval makes a
separate copy of each product photo:

- from the cleaned photo when the studio made one, otherwise the original;
- re-encoded from pixels, so no EXIF (GPS, phone model) can survive, at most 1600 px;
- under a random name, in a store that holds nothing but these copies.

A copy exists only while its listing is approved. `unpublish` removes it when an approved
listing is changed, and the next approval makes a fresh one. The private originals are
never touched. The artisan is told at submission that approved photos become public.

    local     files under <media dir>_public, served by GET /api/v1/public/photos/{name}
    supabase  the PUBLIC bucket CRAFTLINK_PUBLIC_MEDIA_BUCKET (default listing-public),
              created 2026-09-14 with a 5 MB limit and image/jpeg only. A private bucket
              is refused: its links would not open for a buyer.
"""

from __future__ import annotations

import functools
import io
import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from . import models
from .storage import (
    LocalMediaStore,
    StorageUnavailable,
    _check_key,
    get_media_store,
    media_dir,
    storage_mode,
)

logger = logging.getLogger(__name__)

MAX_EDGE_PX = 1600
JPEG_QUALITY = 85
PUBLIC_ROUTE = "/api/v1/public/photos"
PUBLIC_NAME = re.compile(r"^[0-9a-f]{32}\.jpg$")


def public_bucket_name() -> str:
    return (os.getenv("CRAFTLINK_PUBLIC_MEDIA_BUCKET") or "listing-public").strip()


def public_media_dir() -> Path:
    raw = os.getenv("CRAFTLINK_PUBLIC_MEDIA_DIR", "").strip()
    if raw:
        return Path(raw)
    private = media_dir()
    return private.parent / f"{private.name}_public"


def public_base_url() -> str:
    """Where the local route is reachable. Only a development default; buyers need https."""
    return (os.getenv("CRAFTLINK_PUBLIC_BASE_URL") or "http://localhost:8000").rstrip("/")


class LocalPublicStore(LocalMediaStore):
    name = "local"

    def url(self, key: str) -> str:
        return f"{public_base_url()}{PUBLIC_ROUTE}/{key}"


class SupabasePublicStore:
    name = "supabase"

    def __init__(self, client, bucket: str) -> None:
        try:
            info = client.storage.get_bucket(bucket)
        except Exception as exc:  # the SDK raises its own types; any of them means "cannot use"
            raise StorageUnavailable(f"Public photo bucket {bucket!r} is not reachable: {exc}") from exc
        if not getattr(info, "public", False):
            raise StorageUnavailable(
                f"Bucket {bucket!r} is private, so buyer links to it would not open. "
                "Public photo copies need a public bucket."
            )
        self._bucket = client.storage.from_(bucket)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        _check_key(key)
        try:
            self._bucket.upload(key, data, {"content-type": content_type, "upsert": "false"})
        except Exception as exc:
            raise StorageUnavailable(f"Public photo upload failed for {key!r}: {exc}") from exc

    def delete(self, key: str) -> None:
        _check_key(key)
        try:
            self._bucket.remove([key])
        except Exception as exc:
            raise StorageUnavailable(f"Public photo delete failed for {key!r}: {exc}") from exc

    def url(self, key: str) -> str:
        return self._bucket.get_public_url(key).rstrip("?")


@functools.lru_cache(maxsize=4)
def _supabase_public_store(bucket: str) -> SupabasePublicStore:
    from .supabase_client import DummySupabase, supabase

    if isinstance(supabase, DummySupabase):
        raise StorageUnavailable(
            "CRAFTLINK_MEDIA_STORAGE=supabase but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured."
        )
    return SupabasePublicStore(supabase, bucket)


def get_public_store(mode: str | None = None):
    mode = (mode or storage_mode()).strip().lower()
    if mode == "local":
        return LocalPublicStore(public_media_dir())
    if mode == "supabase":
        return _supabase_public_store(public_bucket_name())
    raise StorageUnavailable(f"Unknown CRAFTLINK_MEDIA_STORAGE={mode!r}; expected 'local' or 'supabase'.")


def buyer_copy(data: bytes) -> bytes:
    """A JPEG rebuilt from the pixels alone, upright and at most MAX_EDGE_PX on its long edge."""
    with Image.open(io.BytesIO(data)) as source:
        upright = ImageOps.exif_transpose(source).convert("RGB")
    upright.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX))
    # A new image from raw pixels carries no `info`, so nothing from the source file is saved.
    clean = Image.frombytes("RGB", upright.size, upright.tobytes())
    out = io.BytesIO()
    clean.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return out.getvalue()


def _created(media: Any) -> float:
    return media.created_at.timestamp() if media.created_at else 0.0


def buyer_photo_sources(listing: Any) -> list[Any]:
    """One photo per original the artisan uploaded: its newest cleaned copy, else the original.

    Rows from the deprecated URL endpoint have no stored file and are skipped.
    """
    originals = sorted(
        (m for m in listing.media if m.kind == "image" and m.variant == "original" and m.storage_path),
        key=_created,
    )
    cleaned: dict[str, Any] = {}
    for media in sorted(listing.media, key=_created):
        if media.kind == "image" and media.variant == "enhanced" and media.storage_path:
            source_id = json.loads(media.metadata_json or "{}").get("source_media_id")
            if source_id:
                cleaned[source_id] = media
    return [cleaned.get(original.id, original) for original in originals]


def unpublish(listing: Any) -> None:
    """Remove the listing's public copies. Raises StorageUnavailable, leaving the rows, when
    a copy cannot be deleted, so no public file is ever left without a record."""
    for photo in list(listing.public_photos):
        get_public_store(photo.storage_backend).delete(photo.storage_path)
        listing.public_photos.remove(photo)  # delete-orphan removes the row on commit


def publish(listing: Any) -> int:
    """Replace the listing's public copies with fresh ones. The caller commits.

    Raises StorageUnavailable, MediaNotFound or OSError (an unreadable image), after deleting
    any copy it had already written.
    """
    unpublish(listing)
    store = get_public_store()
    written: list[str] = []
    try:
        for media in buyer_photo_sources(listing):
            metadata = json.loads(media.metadata_json or "{}")
            data = get_media_store(metadata.get("storage_backend")).get(media.storage_path)
            key = f"{uuid.uuid4().hex}.jpg"
            store.put(key, buyer_copy(data), "image/jpeg")
            written.append(key)
            listing.public_photos.append(models.PublicPhotoModel(
                listing_id=listing.id,
                source_media_id=media.id,
                storage_backend=store.name,
                storage_path=key,
                url=store.url(key),
            ))
    except Exception:
        for key in written:
            try:
                store.delete(key)
            except StorageUnavailable as exc:
                logger.error("Orphaned public photo %s: %s", key, exc)
        raise
    return len(written)
