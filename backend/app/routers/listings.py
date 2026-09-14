# backend/app/routers/listings.py
import json
import logging
import uuid
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas, auth, media_inspect
from ..storage import StorageUnavailable, get_media_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/listings", tags=["Listings"])

# States in which the artisan is still assembling the listing. Once it is submitted, the
# media a coordinator reviewed must not change underneath them.
UPLOADABLE_STATES = {"draft", "processing", "awaiting_confirmation"}
_READ_CHUNK_BYTES = 1024 * 1024

def format_listing_response(listing: models.ListingModel) -> Dict[str, Any]:
    media_list = [
        {
            "id": m.id,
            "kind": m.kind,
            "variant": m.variant,
            "status": m.status,
            "url": m.url
        }
        for m in listing.media
    ]

    catalogue_data = None
    if listing.catalogue:
        catalogue_data = {
            "schema_version": listing.catalogue.schema_version,
            "catalogue": json.loads(listing.catalogue.catalogue_data),
            "field_confidence": json.loads(listing.catalogue.field_confidence),
            "needs_confirmation": json.loads(listing.catalogue.needs_confirmation)
        }

    price_data = None
    if listing.price:
        wage_source = None
        if listing.price.state_code:
            wage_source = {
                "state_code": listing.price.state_code,
                "notification_ref": listing.price.notification_ref or "",
                "effective_from": listing.price.effective_from or "",
                "source_url": listing.price.source_url or ""
            }
        price_data = {
            "calculation_version": listing.price.calculation_version,
            "status": listing.price.status,
            "currency": listing.price.currency,
            "wage_source": wage_source,
            "inputs": {
                "material_cost_paise": listing.price.material_cost_paise,
                "labour_hours": listing.price.labour_hours,
                "hourly_wage_paise": listing.price.hourly_wage_paise,
                "skill_level": listing.price.skill_level
            },
            "floor_amount_paise": listing.price.floor_amount_paise,
            "recommended_low_paise": listing.price.recommended_low_paise,
            "recommended_high_paise": listing.price.recommended_high_paise,
            "explanation": listing.price.explanation or ""
        }

    claims_list = [
        {
            "claim": c.claim,
            "asserted_by_artisan": c.asserted_by_artisan,
            "coordinator_verified": c.coordinator_verified,
            "evidence_note": c.evidence_note
        }
        for c in listing.claims
    ]

    return {
        "id": listing.id,
        "artisan_id": str(listing.artisan_id),
        "state": listing.state,
        "preferred_language": listing.preferred_language,
        "media": media_list,
        "catalogue": catalogue_data,
        "price": price_data,
        "claims": claims_list,
        "created_at": listing.created_at.isoformat() if listing.created_at else "",
        "updated_at": listing.updated_at.isoformat() if listing.updated_at else ""
    }

@router.post("", response_model=schemas.CreateListingResponse)
def create_listing(
    payload: schemas.CreateListingRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    listing = models.ListingModel(
        artisan_id=current_user.user_id,
        state="draft",
        preferred_language=payload.preferred_language or "en"
    )
    db.add(listing)
    db.commit()
    db.refresh(listing)

    return schemas.CreateListingResponse(
        id=listing.id,
        artisan_id=str(listing.artisan_id),
        state=listing.state,
        preferred_language=listing.preferred_language,
        upload_instructions={
            "upload_path": f"/api/v1/listings/{listing.id}/media/upload",
            "max_image_bytes": media_inspect.MAX_IMAGE_BYTES,
            "max_audio_bytes": media_inspect.MAX_AUDIO_BYTES,
            "allowed_image_types": media_inspect.ALLOWED_IMAGE_TYPES,
            "allowed_audio_types": media_inspect.ALLOWED_AUDIO_TYPES,
        }
    )

@router.get("", response_model=List[schemas.ListingResponse])
def list_listings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    if current_user.role in ["coordinator", "admin"]:
        listings = db.query(models.ListingModel).order_by(models.ListingModel.created_at.desc()).all()
    else:
        listings = db.query(models.ListingModel).filter(
            models.ListingModel.artisan_id == current_user.user_id
        ).order_by(models.ListingModel.created_at.desc()).all()

    return [format_listing_response(l) for l in listings]

@router.get("/{listing_id}", response_model=schemas.ListingResponse)
def get_listing(
    listing_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    
    # Verify access rights
    if current_user.role == "artisan" and listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this listing")

    return format_listing_response(listing)

# Deprecated: records a URL, never receives a file, and substitutes a stock photo or
# sample sound when no URL is given. Kept because the existing flow test and app build
# call it. New clients use POST /{listing_id}/media/upload below.
@router.post("/{listing_id}/media", response_model=schemas.MediaUploadResponse, deprecated=True)
def complete_media_upload(
    listing_id: str,
    payload: schemas.MediaUploadRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if current_user.role == "artisan" and listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this listing")

    media_id = str(uuid.uuid4())
    default_url = (
        "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800"
        if payload.kind == "image"
        else "https://actions.google.com/sounds/v1/ambiences/outdoor_market.ogg"
    )
    url = payload.url or default_url

    media = models.MediaAssetModel(
        id=media_id,
        listing_id=listing_id,
        kind=payload.kind,
        variant="original",
        status="complete",
        url=url,
        checksum=payload.client_checksum
    )
    db.add(media)
    db.commit()
    db.refresh(media)

    return schemas.MediaUploadResponse(
        status="complete",
        media_id=media.id,
        url=media.url
    )


def _upload_error(status_code: int, code: str, message: str, action: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, "recoverable": True, "action": action},
    )


def _read_limited(upload: UploadFile, limit: int, retake: str) -> bytes:
    buffer = bytearray()
    while chunk := upload.file.read(_READ_CHUNK_BYTES):
        buffer.extend(chunk)
        if len(buffer) > limit:
            raise _upload_error(
                413,
                "MEDIA_QUALITY_INSUFFICIENT",
                f"The file is larger than the {limit // (1024 * 1024)} MB limit.",
                retake,
            )
    return bytes(buffer)


def _upload_response(media: models.MediaAssetModel, deduplicated: bool) -> schemas.MediaUploadResponse:
    metadata = json.loads(media.metadata_json or "{}")
    return schemas.MediaUploadResponse(
        status=media.status,
        media_id=media.id,
        url=media.url,
        kind=media.kind,
        content_type=metadata.get("content_type"),
        size_bytes=metadata.get("size_bytes"),
        checksum=media.checksum,
        deduplicated=deduplicated,
    )


@router.post("/{listing_id}/media/upload", response_model=schemas.MediaUploadResponse)
def upload_media(
    listing_id: str,
    kind: str = Form(...),
    file: UploadFile = File(...),
    client_checksum: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Receive a photo or voice note as multipart/form-data and store the actual bytes.

    Every check that can refuse runs before anything is written, and the database row is
    committed only after the file is stored, so a row never points at a missing file.
    """
    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    # Uploading is the artisan's act. Coordinators review media; they do not supply it.
    if listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Only the artisan who owns this listing can upload media to it")

    if kind not in ("image", "audio"):
        raise _upload_error(
            422, "CATALOGUE_SCHEMA_INVALID", "kind must be 'image' or 'audio'.",
            "Send kind=image for photos or kind=audio for voice notes.",
        )

    if listing.state not in UPLOADABLE_STATES:
        raise _upload_error(
            409, "LISTING_STATE_INVALID",
            f"Media cannot be added to a listing in state '{listing.state}'.",
            "Refresh the listing; it has already been submitted.",
        )

    is_image = kind == "image"
    retake = "Take the photo again." if is_image else "Record the voice note again."
    limit = media_inspect.MAX_IMAGE_BYTES if is_image else media_inspect.MAX_AUDIO_BYTES
    data = _read_limited(file, limit, retake)

    received_sha = media_inspect.sha256_hex(data)
    expected_sha = media_inspect.normalise_checksum(client_checksum)
    if expected_sha is not None and expected_sha != received_sha:
        raise _upload_error(
            400, "PROVIDER_UNAVAILABLE", "The file arrived different from what was sent.",
            "Retry the upload.",
        )

    try:
        inspected = media_inspect.inspect_image(data) if is_image else media_inspect.inspect_audio(data)
    except media_inspect.MediaRejected as exc:
        raise _upload_error(415, "MEDIA_QUALITY_INSUFFICIENT", str(exc), retake)

    # A retry of the same file returns the record already made. Keyed on content, because
    # the app's Idempotency-Key header is a fresh UUID per attempt and cannot spot a retry.
    checksum = f"sha256:{received_sha}"
    existing = db.query(models.MediaAssetModel).filter(
        models.MediaAssetModel.listing_id == listing_id,
        models.MediaAssetModel.kind == kind,
        models.MediaAssetModel.variant == "original",
        models.MediaAssetModel.checksum == checksum,
        models.MediaAssetModel.storage_path.isnot(None),
    ).first()
    if existing:
        return _upload_response(existing, deduplicated=True)

    media_id = str(uuid.uuid4())
    storage_key = f"listings/{listing_id}/{kind}/{media_id}{inspected.extension}"
    try:
        store = get_media_store()
        store.put(storage_key, inspected.data, inspected.content_type)
    except StorageUnavailable as exc:
        logger.error("Media upload for listing %s could not be stored: %s", listing_id, exc)
        raise _upload_error(
            503, "PROVIDER_UNAVAILABLE", "Media storage is temporarily unavailable.",
            "Your file is still on the phone. Retry shortly.",
        )

    media = models.MediaAssetModel(
        id=media_id,
        listing_id=listing_id,
        kind=kind,
        variant="original",
        status="complete",
        url=f"/api/v1/media/{media_id}/content",
        storage_path=storage_key,
        checksum=checksum,
        metadata_json=json.dumps({
            "content_type": inspected.content_type,
            "size_bytes": len(inspected.data),
            "received_bytes": len(data),
            "stored_sha256": media_inspect.sha256_hex(inspected.data),
            "storage_backend": store.name,
            **inspected.metadata,
        }),
    )
    db.add(media)
    try:
        db.commit()
    except Exception:
        db.rollback()
        # Never leave a file that no row will ever point at.
        try:
            store.delete(storage_key)
        except Exception as cleanup_exc:
            logger.error("Orphaned media object %s: %s", storage_key, cleanup_exc)
        raise
    db.refresh(media)
    return _upload_response(media, deduplicated=False)

@router.post("/{listing_id}/confirm")
def confirm_listing(
    listing_id: str,
    payload: schemas.ConfirmListingRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if current_user.role == "artisan" and listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to confirm this listing")

    cat_model = db.query(models.CatalogueModel).filter(models.CatalogueModel.listing_id == listing_id).first()
    if not cat_model:
        # Create new if not existing
        cat_model = models.CatalogueModel(
            listing_id=listing_id,
            schema_version="1.0",
            catalogue_data=json.dumps(payload.catalogue),
            field_confidence=json.dumps({}),
            needs_confirmation=json.dumps([])
        )
        db.add(cat_model)
    else:
        # Merge catalogue updates
        current_data = json.loads(cat_model.catalogue_data)
        current_data.update(payload.catalogue)
        cat_model.catalogue_data = json.dumps(current_data)
        # Clear out confirmed fields from needs_confirmation
        current_needs = json.loads(cat_model.needs_confirmation)
        updated_needs = [f for f in current_needs if f not in payload.confirmed_fields]
        cat_model.needs_confirmation = json.dumps(updated_needs)

    # The artisan's answer on each claim they were asked about. "Yes" is the assertion the
    # provenance gate waits for (a generator can never make it); "no" removes a claim that no
    # coordinator has verified. Only the artisan can assert.
    if current_user.role == "artisan":
        stated = {
            c.get("claim"): c
            for c in ((payload.catalogue.get("provenance") or {}).get("claims") or [])
            if isinstance(c, dict)
        }
        for field in payload.confirmed_fields:
            if not field.startswith("provenance."):
                continue
            name = field.split(".", 1)[1]
            row = db.query(models.ClaimModel).filter(
                models.ClaimModel.listing_id == listing_id,
                models.ClaimModel.claim == name,
            ).first()
            if name not in stated:
                if row and not row.coordinator_verified:
                    db.delete(row)
            elif stated[name].get("asserted_by_artisan") is True:
                if row:
                    row.asserted_by_artisan = True
                else:
                    db.add(models.ClaimModel(
                        listing_id=listing_id,
                        claim=name,
                        asserted_by_artisan=True,
                        coordinator_verified=False,
                    ))

    listing.state = "awaiting_approval"
    db.commit()

    return {
        "status": "confirmed",
        "listing_id": listing_id,
        "state": listing.state
    }

@router.post("/{listing_id}/submit-for-approval")
@router.post("/{listing_id}/submit-approval")
def submit_for_approval(
    listing_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if current_user.role == "artisan" and listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to submit this listing")

    listing.state = "awaiting_approval"
    db.commit()
    return {
        "status": "submitted",
        "listing_id": listing_id,
        "state": "awaiting_approval"
    }
