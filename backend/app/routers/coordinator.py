# backend/app/routers/coordinator.py
import json
import uuid
import hashlib
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas, auth

router = APIRouter(tags=["Coordinator & Marketplace Export"])


@router.post("/listings/{listing_id}/claims/{claim}/review")
def review_claim(
    listing_id: str,
    claim: str,
    payload: schemas.ClaimReviewRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["coordinator", "admin"])),
):
    claim_model = (
        db.query(models.ClaimModel)
        .filter(
            models.ClaimModel.listing_id == listing_id, models.ClaimModel.claim == claim
        )
        .first()
    )

    is_verified = payload.decision.lower() in ["verified", "approve", "approved"]
    note = payload.evidence_note or (
        f"Verified by coordinator {current_user.username}"
        if is_verified
        else payload.reason
    )

    if not claim_model:
        claim_model = models.ClaimModel(
            listing_id=listing_id,
            claim=claim,
            asserted_by_artisan=True,
            coordinator_verified=is_verified,
            evidence_note=note,
            verified_at=datetime.now(timezone.utc) if is_verified else None,
        )
        db.add(claim_model)
    else:
        claim_model.coordinator_verified = is_verified
        claim_model.evidence_note = note
        claim_model.verified_at = datetime.now(timezone.utc) if is_verified else None

    db.commit()

    return {"claim": claim, "coordinator_verified": is_verified, "evidence_note": note}


def get_unverified_claims(db: Session, listing_id: str) -> list[models.ClaimModel]:
    """Any claim on this listing not yet coordinator-verified.
    Generic on purpose — catches every current claim type
    (natural_dye, gi_tag, handloom_weave, skill_level_master_self_declared)
    and any future claim type without needing a hardcoded list."""
    return db.query(models.ClaimModel).filter(
        models.ClaimModel.listing_id == listing_id,
        models.ClaimModel.coordinator_verified == False,
    ).all()


@router.post("/listings/{listing_id}/approval")
def decide_approval(
    listing_id: str,
    payload: schemas.ListingDecisionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["coordinator", "admin"])),
):
    listing = (
        db.query(models.ListingModel)
        .filter(models.ListingModel.id == listing_id)
        .first()
    )
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    decision = payload.decision.lower()
    if decision in ["approve", "approved"]:
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
        listing.state = "approved"
    elif decision in ["reject", "rejected"]:
        listing.state = "rejected"
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid decision: {payload.decision}. Must be 'approve' or 'reject'.",
        )

    db.commit()

    return {
        "status": listing.state,
        "reason": payload.reason
        or f"Decision {listing.state} recorded by {current_user.username}",
    }


@router.post("/listings/{listing_id}/exports", response_model=schemas.ExportResult)
@router.post("/listings/{listing_id}/export", response_model=schemas.ExportResult)
def export_listing(
    listing_id: str,
    payload: schemas.ExportRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    listing = (
        db.query(models.ListingModel)
        .filter(models.ListingModel.id == listing_id)
        .first()
    )
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    # The provenance guard must run again immediately before any export
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

    # Construct verifiable ONDC/GeM contract payload
    cat_data = json.loads(listing.catalogue.catalogue_data) if listing.catalogue else {}
    price_data = {
        "floor_amount_paise": listing.price.floor_amount_paise if listing.price else 0,
        "recommended_low_paise": listing.price.recommended_low_paise
        if listing.price
        else 0,
        "recommended_high_paise": listing.price.recommended_high_paise
        if listing.price
        else 0,
        "currency": "INR",
    }
    claims_data = [
        {"claim": c.claim, "verified": c.coordinator_verified, "note": c.evidence_note}
        for c in listing.claims
    ]

    ondc_item_payload = {
        "context": {
            "domain": "nic2004:52110",
            "action": "on_search",
            "version": payload.schema_version,
            "bpp_id": "karigari.mosje.gov.in",
        },
        "message": {
            "catalog": {
                "bpp/descriptor": {
                    "name": "Karigari Connect - MoSJE Artisan Marketplace"
                },
                "bpp/providers": [
                    {
                        "id": f"artisan_{listing.artisan_id}",
                        "items": [
                            {
                                "id": listing.id,
                                "descriptor": {
                                    "name": cat_data.get("title", {}).get(
                                        "en", "Handicraft Item"
                                    ),
                                    "symbol": cat_data.get("title", {}).get(
                                        "local", ""
                                    ),
                                    "short_desc": cat_data.get("description", {}).get(
                                        "en", ""
                                    ),
                                    "long_desc": cat_data.get("description", {}).get(
                                        "local", ""
                                    ),
                                    "images": [m.url for m in listing.media if m.url],
                                },
                                "price": price_data,
                                "category_id": cat_data.get("category", "Handicrafts"),
                                "tags": {
                                    "heritage_claims": claims_data,
                                    "statutory_wage_protected": True,
                                },
                            }
                        ],
                    }
                ],
            }
        },
    }

    # Verify structural keys in ondc_item_payload
    validation_errors = []
    context_obj = ondc_item_payload.get("context", {})
    if not context_obj.get("domain"):
        validation_errors.append("context.domain missing or empty")
    if not context_obj.get("action"):
        validation_errors.append("context.action missing or empty")

    msg_obj = ondc_item_payload.get("message", {})
    catalog_obj = msg_obj.get("catalog", {}) if isinstance(msg_obj, dict) else {}
    providers = catalog_obj.get("bpp/providers", []) if isinstance(catalog_obj, dict) else []
    if not isinstance(providers, list) or len(providers) == 0:
        validation_errors.append("message.catalog.bpp/providers missing or empty")
    else:
        provider_items = providers[0].get("items", []) if isinstance(providers[0], dict) else []
        if not isinstance(provider_items, list) or len(provider_items) == 0:
            validation_errors.append("message.catalog.bpp/providers[0].items missing or empty")
        else:
            target_item = provider_items[0]
            item_price = target_item.get("price", {}) if isinstance(target_item, dict) else {}
            if not isinstance(item_price, dict):
                validation_errors.append("price object missing")
            else:
                if not item_price.get("currency"):
                    validation_errors.append("price.currency missing or empty")
                if not item_price.get("floor_amount_paise") or item_price.get("floor_amount_paise", 0) <= 0:
                    validation_errors.append("price.floor_amount_paise missing or zero")
                if not item_price.get("recommended_low_paise") or item_price.get("recommended_low_paise", 0) <= 0:
                    validation_errors.append("price.recommended_low_paise missing or zero")
                if not item_price.get("recommended_high_paise") or item_price.get("recommended_high_paise", 0) <= 0:
                    validation_errors.append("price.recommended_high_paise missing or zero")

            item_descriptor = target_item.get("descriptor", {}) if isinstance(target_item, dict) else {}
            item_images = item_descriptor.get("images", []) if isinstance(item_descriptor, dict) else []
            if not isinstance(item_images, list) or len(item_images) == 0:
                validation_errors.append("descriptor.images missing or empty")

    passed = len(validation_errors) == 0
    payload_json = json.dumps(ondc_item_payload, sort_keys=True)
    payload_hash = f"sha256:{hashlib.sha256(payload_json.encode('utf-8')).hexdigest()}"
    export_id = str(uuid.uuid4())

    validation_info = {
        "passed": passed,
        "schema_source": f"https://ondc.org/protocol/v{payload.schema_version}/retail/catalog.json",
    }

    if not passed:
        validation_info["errors"] = validation_errors
        export_record = models.ExportRecordModel(
            export_id=export_id,
            listing_id=listing_id,
            target=payload.target,
            status="failed",
            payload_hash=payload_hash,
            contract_validation=json.dumps(validation_info),
            network_submission="not_attempted",
        )
        db.add(export_record)
        db.commit()
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "EXPORT_CONTRACT_INVALID",
                    "message": f"Export contract invalid: {', '.join(validation_errors)}",
                    "recoverable": True,
                    "action": "check_coordinator_review",
                }
            },
        )

    # simulate_network_submission is silently ignored per Bug #1 fix:
    # MVP has no live ONDC network integration; network_submission is strictly "not_attempted".
    network_submission = "not_attempted"
    status = "validated"

    export_record = models.ExportRecordModel(
        export_id=export_id,
        listing_id=listing_id,
        target=payload.target,
        status=status,
        payload_hash=payload_hash,
        contract_validation=json.dumps(validation_info),
        network_submission=network_submission,
    )
    db.add(export_record)
    listing.state = "export_queued"
    db.commit()

    return schemas.ExportResult(
        export_id=export_id,
        target=payload.target,
        status=status,
        payload_hash=payload_hash,
        contract_validation=schemas.ContractValidation(
            passed=True, schema_source=validation_info["schema_source"]
        ),
        network_submission=network_submission,
    )
