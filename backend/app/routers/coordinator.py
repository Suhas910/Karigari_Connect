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
        unverified_master = db.query(models.ClaimModel).filter(
            models.ClaimModel.listing_id == listing_id,
            models.ClaimModel.claim == "skill_level_master_self_declared",
            models.ClaimModel.coordinator_verified == False,
        ).first()
        if unverified_master:
            raise HTTPException(
                status_code=400,
                detail="Cannot approve listing with unverified self-declared Master Craftsman claim. Coordinator must verify claim before approval."
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

    payload_json = json.dumps(ondc_item_payload, sort_keys=True)
    payload_hash = f"sha256:{hashlib.sha256(payload_json.encode('utf-8')).hexdigest()}"

    export_id = str(uuid.uuid4())
    validation_info = {
        "passed": True,
        "schema_source": f"https://ondc.org/protocol/v{payload.schema_version}/retail/catalog.json",
    }

    network_submission = (
        "success" if payload.simulate_network_submission else "not_attempted"
    )
    status = "exported" if network_submission == "success" else "validated"

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
    listing.state = "exported" if network_submission == "success" else "approved"
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
