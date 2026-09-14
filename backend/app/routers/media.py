# backend/app/routers/media.py
"""
Read back uploaded media, to people allowed to see it.

This is the only way stored bytes leave the service. There is no public URL: a voice
note or a workshop photo is personal data, and a public link cannot be revoked once it
is forwarded. The AI jobs read the same bytes in-process through `app.storage`, so they
do not go through HTTP at all.

Access mirrors `GET /listings/{id}`: the owning artisan, or any coordinator or admin.

The one exception is `GET /public/photos/{name}`: buyer-facing copies of approved photos,
re-encoded without metadata and kept apart from these files (`app/public_media.py`).
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, auth
from ..storage import MediaNotFound, StorageUnavailable, get_media_store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Media"])


@router.get("/media/{media_id}/content")
def get_media_content(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    media = db.query(models.MediaAssetModel).filter(models.MediaAssetModel.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    if current_user.role == "artisan" and media.listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this media")

    if not media.storage_path:
        # Rows created by the legacy JSON endpoint point at an external URL, not a file.
        raise HTTPException(
            status_code=404,
            detail={
                "code": "LISTING_STATE_INVALID",
                "message": "This media record has no uploaded file.",
                "recoverable": True,
                "action": "Upload the file with POST /listings/{listing_id}/media/upload.",
            },
        )

    metadata = json.loads(media.metadata_json or "{}")
    try:
        data = get_media_store(metadata.get("storage_backend")).get(media.storage_path)
    except MediaNotFound:
        logger.error("Media %s points at missing object %s", media.id, media.storage_path)
        raise HTTPException(status_code=404, detail="Media file is missing from storage")
    except StorageUnavailable as exc:
        logger.error("Media store unavailable reading %s: %s", media.id, exc)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "PROVIDER_UNAVAILABLE",
                "message": "Media storage is temporarily unavailable.",
                "recoverable": True,
                "action": "Retry shortly.",
            },
        )

    return Response(
        content=data,
        media_type=metadata.get("content_type", "application/octet-stream"),
        headers={
            # Personal data: no shared or intermediate caches.
            "Cache-Control": "private, no-store",
            # Serve exactly the type validated at upload; never let a client re-sniff.
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/public/photos/{name}")
def get_public_photo(name: str):
    """A buyer-facing photo copy, for local storage. Supabase serves its public bucket itself.

    No sign-in: the file exists only while its listing is approved, under a random name.
    """
    from .. import public_media

    if not public_media.PUBLIC_NAME.match(name):
        raise HTTPException(status_code=404, detail="Photo not found")
    try:
        data = public_media.get_public_store("local").get(name)
    except MediaNotFound:
        raise HTTPException(status_code=404, detail="Photo not found")
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={
            # Short, because unpublishing must take effect for buyers soon after.
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )
