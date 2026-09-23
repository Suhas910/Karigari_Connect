# backend/app/routers/listings.py
import json
import uuid
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Request, Header
from sqlalchemy.orm import Session, selectinload, joinedload
from ..supabase_client import upload_media_bytes

from ..database import get_db
from .. import models, schemas, auth
from ..ssrf_protection import validate_safe_url
from .coordinator import get_unverified_claims

router = APIRouter(prefix="/listings", tags=["Listings"])

MAX_IMAGE_BYTES = 10485760   # 10 MB
MAX_AUDIO_BYTES = 20971520   # 20 MB
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_AUDIO_TYPES = {"audio/wav", "audio/m4a", "audio/mp4", "audio/aac", "audio/ogg", "audio/x-m4a", "audio/mpeg"}

def normalize_media_url(url: Optional[str], base_url: Optional[str]) -> Optional[str]:
    if not url:
        return url
    if base_url and "/media/" in url:
        clean_base = str(base_url).rstrip("/")
        parts = url.split("/media/", 1)
        return f"{clean_base}/media/{parts[1]}"
    return url

def format_listing_response(listing: models.ListingModel, base_url: Optional[str] = None) -> Dict[str, Any]:
    media_list = [
        {
            "id": m.id,
            "kind": m.kind,
            "variant": m.variant,
            "status": m.status,
            "url": normalize_media_url(m.url, base_url)
        }
        for m in (listing.media or [])
    ]

    catalogue_data = None
    if listing.catalogue:
        raw_cat = {}
        if listing.catalogue.catalogue_data:
            try:
                raw_cat = json.loads(listing.catalogue.catalogue_data) if isinstance(listing.catalogue.catalogue_data, str) else listing.catalogue.catalogue_data
            except Exception:
                raw_cat = {}
        
        raw_conf = {}
        if listing.catalogue.field_confidence:
            try:
                raw_conf = json.loads(listing.catalogue.field_confidence) if isinstance(listing.catalogue.field_confidence, str) else listing.catalogue.field_confidence
            except Exception:
                raw_conf = {}

        raw_needs = []
        if listing.catalogue.needs_confirmation:
            try:
                raw_needs = json.loads(listing.catalogue.needs_confirmation) if isinstance(listing.catalogue.needs_confirmation, str) else listing.catalogue.needs_confirmation
            except Exception:
                raw_needs = []

        catalogue_data = {
            "schema_version": listing.catalogue.schema_version or "1.0",
            "catalogue": raw_cat or {},
            "field_confidence": raw_conf or {},
            "needs_confirmation": raw_needs or []
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
        skill_src = "self_declared"
        if listing.price.explanation and "technique-floor" in listing.price.explanation.lower():
            skill_src = "technique_floor"
        elif listing.artisan and listing.artisan.verified_skill_level:
            skill_src = "coordinator_verified"

        price_data = {
            "calculation_version": listing.price.calculation_version or "1.0",
            "status": listing.price.status or "available",
            "currency": listing.price.currency or "INR",
            "wage_source": wage_source,
            "inputs": {
                "material_cost_paise": listing.price.material_cost_paise or 0,
                "labour_hours": listing.price.labour_hours or 0.0,
                "hourly_wage_paise": listing.price.hourly_wage_paise or 0,
                "skill_level": listing.price.skill_level or "skilled",
                "skill_level_self_declared": (listing.artisan.declared_skill_level if listing.artisan and listing.artisan.declared_skill_level else listing.price.skill_level) or "skilled",
                "skill_level_source": skill_src,
                "zone": listing.artisan.declared_zone if listing.artisan else None,
                "state_code": listing.price.state_code or "KA",
            },
            "floor_amount_paise": listing.price.floor_amount_paise or 0,
            "recommended_low_paise": listing.price.recommended_low_paise or 0,
            "recommended_high_paise": listing.price.recommended_high_paise or 0,
            "explanation": listing.price.explanation or ""
        }

    claims_list = [
        {
            "id": c.id,
            "claim": c.claim,
            "asserted_by_artisan": c.asserted_by_artisan,
            "coordinator_verified": c.coordinator_verified,
            "evidence_note": c.evidence_note,
            "verified_at": c.verified_at.isoformat() if c.verified_at else None
        }
        for c in (listing.claims or [])
    ]

    return {
        "id": listing.id,
        "artisan_id": str(listing.artisan_id),
        "state": listing.state,
        "preferred_language": listing.preferred_language or "en",
        "media": media_list,
        "catalogue": catalogue_data,
        "price": price_data,
        "claims": claims_list,
        "rejection_categories": getattr(listing, "rejection_categories", []) or [],
        "rejection_flags": getattr(listing, "rejection_categories", []) or [],
        "rejection_reason": getattr(listing, "rejection_reason", None),
        "created_at": listing.created_at.isoformat() if listing.created_at else "",
        "updated_at": listing.updated_at.isoformat() if listing.updated_at else ""
    }

@router.post("", response_model=schemas.CreateListingResponse)
def create_listing(
    payload: schemas.CreateListingRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    idem_key = idempotency_key or getattr(payload, "idempotency_key", None)
    if idem_key:
        existing = db.query(models.ListingModel).filter(
            models.ListingModel.artisan_id == current_user.user_id,
            models.ListingModel.idempotency_key == idem_key
        ).first()
        if existing:
            return schemas.CreateListingResponse(
                id=existing.id,
                artisan_id=str(existing.artisan_id),
                state=existing.state,
                preferred_language=existing.preferred_language,
                upload_instructions={
                    "bucket": "media",
                    "max_image_bytes": 10485760,
                    "max_audio_bytes": 20971520,
                    "allowed_image_types": ["image/jpeg", "image/png", "image/webp"],
                    "allowed_audio_types": ["audio/wav", "audio/m4a", "audio/mp4", "audio/aac"]
                }
            )

    listing = models.ListingModel(
        artisan_id=current_user.user_id,
        state="draft",
        preferred_language=payload.preferred_language or "en",
        idempotency_key=idem_key
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
            "bucket": "media",
            "max_image_bytes": 10485760,
            "max_audio_bytes": 20971520,
            "allowed_image_types": ["image/jpeg", "image/png", "image/webp"],
            "allowed_audio_types": ["audio/wav", "audio/m4a", "audio/mp4", "audio/aac"]
        }
    )

@router.get("", response_model=List[schemas.ListingResponse])
def list_listings(
    request: Request,
    state: Optional[str] = None,
    limit: Optional[int] = None,
    offset: Optional[int] = 0,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    query = db.query(models.ListingModel).options(
        selectinload(models.ListingModel.media),
        selectinload(models.ListingModel.catalogue),
        selectinload(models.ListingModel.price),
        selectinload(models.ListingModel.claims),
        joinedload(models.ListingModel.artisan)
    )

    if current_user.role in ["coordinator", "admin"]:
        if state:
            query = query.filter(models.ListingModel.state == state)
    else:
        query = query.filter(models.ListingModel.artisan_id == current_user.user_id)
        if state:
            query = query.filter(models.ListingModel.state == state)

    query = query.order_by(models.ListingModel.created_at.desc())
    effective_limit = min(limit, 200) if limit is not None else 100
    query = query.offset(offset or 0).limit(effective_limit)

    listings = query.all()
    base_url = str(request.base_url) if request else None
    return [format_listing_response(l, base_url) for l in listings]

@router.get("/{listing_id}", response_model=schemas.ListingResponse)
def get_listing(
    listing_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    listing = (
        db.query(models.ListingModel)
        .options(
            selectinload(models.ListingModel.media),
            selectinload(models.ListingModel.catalogue),
            selectinload(models.ListingModel.price),
            selectinload(models.ListingModel.claims),
            joinedload(models.ListingModel.artisan)
        )
        .filter(models.ListingModel.id == listing_id)
        .first()
    )
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    
    # Verify access rights
    if current_user.role == "artisan" and listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this listing")

    base_url = str(request.base_url) if request else None
    return format_listing_response(listing, base_url)

@router.post("/{listing_id}/media", response_model=schemas.MediaUploadResponse)
async def complete_media_upload(
    listing_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if current_user.role == "artisan" and listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this listing")

    media_id = str(uuid.uuid4())
    content_type = request.headers.get("content-type", "")
    header_idem_key = request.headers.get("Idempotency-Key") or request.headers.get("idempotency-key")

    if "multipart/form-data" in content_type:
        form = await request.form()
        file_obj = form.get("file")
        kind = str(form.get("kind", "image"))
        checksum = form.get("client_checksum")
        body_idem = form.get("idempotency_key")
        idem_key = header_idem_key or (str(body_idem) if body_idem else None)

        if checksum or idem_key:
            query = db.query(models.MediaAssetModel).filter(models.MediaAssetModel.listing_id == listing_id)
            if checksum and idem_key:
                existing_media = query.filter(
                    (models.MediaAssetModel.checksum == str(checksum)) | (models.MediaAssetModel.idempotency_key == str(idem_key))
                ).first()
            elif checksum:
                existing_media = query.filter(models.MediaAssetModel.checksum == str(checksum)).first()
            else:
                existing_media = query.filter(models.MediaAssetModel.idempotency_key == str(idem_key)).first()

            if existing_media:
                return schemas.MediaUploadResponse(
                    status=existing_media.status,
                    media_id=existing_media.id,
                    url=existing_media.url
                )

        if file_obj and hasattr(file_obj, "read"):
            contents = await file_obj.read()
            if not contents:
                raise HTTPException(status_code=400, detail="Uploaded file is empty.")

            file_ct = getattr(file_obj, "content_type", "application/octet-stream")
            if kind == "image":
                if file_ct not in ALLOWED_IMAGE_TYPES:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid image type '{file_ct}'. Allowed types: {sorted(ALLOWED_IMAGE_TYPES)}"
                    )
                if len(contents) > MAX_IMAGE_BYTES:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Image size exceeds 10 MB limit ({len(contents)} bytes)"
                    )
            elif kind == "audio":
                if file_ct not in ALLOWED_AUDIO_TYPES:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid audio type '{file_ct}'. Allowed types: {sorted(ALLOWED_AUDIO_TYPES)}"
                    )
                if len(contents) > MAX_AUDIO_BYTES:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Audio size exceeds 20 MB limit ({len(contents)} bytes)"
                    )
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported media kind '{kind}'. Allowed kinds: 'image', 'audio'"
                )

            filename = f"{listing_id}/{media_id}_{getattr(file_obj, 'filename', 'upload.bin')}"
            url = upload_media_bytes("media", filename, contents, content_type=file_ct)
        else:
            raw_url = form.get("url")
            if raw_url:
                is_safe, reason = validate_safe_url(str(raw_url))
                if not is_safe:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid or untrusted media URL: {reason}"
                    )
                url = str(raw_url)
            else:
                # Fixed media kind check for multipart fallback
                url = (
                    "https://images.unsplash.com/photo-1590736969955-71cc94801759?w=800"
                    if kind == "image"
                    else "https://actions.google.com/sounds/v1/ambiences/outdoor_market.ogg"
                )
    else:
        body = await request.json()
        kind = body.get("kind", "image")
        checksum = body.get("client_checksum")
        body_idem = body.get("idempotency_key")
        idem_key = header_idem_key or (str(body_idem) if body_idem else None)

        if checksum or idem_key:
            query = db.query(models.MediaAssetModel).filter(models.MediaAssetModel.listing_id == listing_id)
            if checksum and idem_key:
                existing_media = query.filter(
                    (models.MediaAssetModel.checksum == str(checksum)) | (models.MediaAssetModel.idempotency_key == str(idem_key))
                ).first()
            elif checksum:
                existing_media = query.filter(models.MediaAssetModel.checksum == str(checksum)).first()
            else:
                existing_media = query.filter(models.MediaAssetModel.idempotency_key == str(idem_key)).first()

            if existing_media:
                return schemas.MediaUploadResponse(
                    status=existing_media.status,
                    media_id=existing_media.id,
                    url=existing_media.url
                )

        raw_url = body.get("url")
        if raw_url:
            is_safe, reason = validate_safe_url(str(raw_url))
            if not is_safe:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid or untrusted media URL: {reason}"
                )
            url = str(raw_url)
        else:
            url = (
                "https://images.unsplash.com/photo-1590736969955-71cc94801759?w=800"
                if kind == "image"
                else "https://actions.google.com/sounds/v1/ambiences/outdoor_market.ogg"
            )

    media = models.MediaAssetModel(
        id=media_id,
        listing_id=listing_id,
        kind=kind,
        variant="original",
        status="complete",
        url=url,
        checksum=checksum,
        idempotency_key=idem_key
    )
    db.add(media)
    db.commit()
    db.refresh(media)

    return schemas.MediaUploadResponse(
        status="complete",
        media_id=media.id,
        url=media.url
    )

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

    if listing.state in ["approved", "export_queued", "exported"]:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "LISTING_STATE_INVALID",
                    "message": f"Listing in state '{listing.state}' cannot be confirmed.",
                    "recoverable": False,
                    "action": "view_listing",
                }
            },
        )

    from ..schema_validation import validate_catalogue

    cat_model = db.query(models.CatalogueModel).filter(models.CatalogueModel.listing_id == listing_id).first()
    if not cat_model:
        merged_catalogue = payload.catalogue
    else:
        merged_catalogue = json.loads(cat_model.catalogue_data)
        merged_catalogue.update(payload.catalogue)

    is_valid, error_msg = validate_catalogue(merged_catalogue)
    if not is_valid:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "CATALOGUE_SCHEMA_INVALID",
                "message": f"Confirmed catalogue failed schema validation: {error_msg}",
                "recoverable": True,
                "action": "check_catalogue_fields",
            },
        )

    if not cat_model:
        cat_model = models.CatalogueModel(
            listing_id=listing_id,
            schema_version="1.0",
            catalogue_data=json.dumps(merged_catalogue),
            field_confidence=json.dumps({}),
            needs_confirmation=json.dumps([])
        )
        db.add(cat_model)
    else:
        cat_model.catalogue_data = json.dumps(merged_catalogue)
        # Clear out confirmed fields from needs_confirmation
        current_needs = json.loads(cat_model.needs_confirmation) if cat_model.needs_confirmation else []
        updated_needs = [f for f in current_needs if f not in payload.confirmed_fields]
        cat_model.needs_confirmation = json.dumps(updated_needs)

    listing.state = "awaiting_confirmation"
    db.commit()

    return {
        "status": "confirmed",
        "listing_id": listing_id,
        "state": listing.state
    }

@router.post("/{listing_id}/submit-for-approval")
@router.post("/{listing_id}/submit-approval", deprecated=True)
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

    if listing.state in ["approved", "export_queued", "exported"]:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "LISTING_STATE_INVALID",
                    "message": f"Listing in state '{listing.state}' cannot be submitted for approval.",
                    "recoverable": False,
                    "action": "view_listing",
                }
            },
        )

    # Phase 4 Gating: Any unverified claim blocks submission
    unverified = get_unverified_claims(db, listing_id)
    if unverified:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "PROVENANCE_VERIFICATION_REQUIRED",
                    "message": f"Cannot proceed: {len(unverified)} claim(s) "
                                f"[{', '.join(c.claim for c in unverified)}] "
                                "require coordinator verification.",
                    "recoverable": True,
                    "action": "contact_coordinator",
                }
            },
        )

    listing.state = "awaiting_approval"
    db.commit()
    return {
        "status": "submitted",
        "listing_id": listing_id,
        "state": "awaiting_approval"
    }


@router.delete("/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_listing(
    listing_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if current_user.role == "artisan" and listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this listing")

    # Unlink any support messages tied to this listing
    db.query(models.SupportMessageModel).filter(
        models.SupportMessageModel.listing_id == listing_id
    ).update({"listing_id": None})

    db.delete(listing)
    db.commit()
    return None
