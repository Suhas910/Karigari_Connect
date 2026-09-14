# backend/app/routers/coordinator.py
"""
Coordinator review, approval and export.

The rules, and what each replaced:

- A claim review can only decide on a claim that exists. It used to create a missing
  claim with `asserted_by_artisan: true`, putting words in the artisan's mouth.
- Verifying needs the artisan's own assertion and an evidence note. Rejecting needs a
  reason, which is stored; the claim is kept as rejected so it cannot reach a buyer or be
  re-asserted unseen. It used to be deleted, losing the reason.
- Approval checks the listing (`ai/linkage/export.approval_problems`). It used to set
  `approved` on any listing in any state.
- Export is for coordinators, on approved listings, and is validated against the
  committed ONDC schema (`ai/linkage/export.build_export`). Nothing is sent to a network:
  `network_submission` is `not_attempted`, or `simulated` when a demo asks, and the
  listing stays `approved`.
"""
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import auth, models, public_media, schemas
from ..ai.linkage.export import ExportRefused, approval_problems, build_export
from ..database import get_db
from ..storage import MediaNotFound, StorageUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Coordinator & Marketplace Export"])

ONDC_TARGETS = ("ondc", "ondc_retail")


def _error(status_code: int, code: str, message: str, action: str | None = None) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, "recoverable": True, "action": action},
    )


def _listing(db: Session, listing_id: str) -> models.ListingModel:
    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    return listing


@router.post("/listings/{listing_id}/claims/{claim}/review")
def review_claim(
    listing_id: str,
    claim: str,
    payload: schemas.ClaimReviewRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["coordinator", "admin"])),
):
    listing = _listing(db, listing_id)
    if listing.state != "awaiting_approval":
        raise _error(409, "LISTING_STATE_INVALID", f"The listing is {listing.state}, not awaiting approval.")

    claim_model = db.query(models.ClaimModel).filter(
        models.ClaimModel.listing_id == listing_id, models.ClaimModel.claim == claim
    ).first()
    if not claim_model:
        raise _error(404, "LISTING_STATE_INVALID", f"This listing has no claim {claim!r} to review.")
    if claim_model.rejected_at is not None:
        raise _error(409, "LISTING_STATE_INVALID", f"The claim {claim!r} was already rejected: {claim_model.rejection_reason}")

    decision = payload.decision.lower()
    if decision in ("verified", "verify", "approve", "approved"):
        if not claim_model.asserted_by_artisan:
            raise _error(
                409,
                "PROVENANCE_VERIFICATION_REQUIRED",
                "The artisan has not said this claim is true, so there is nothing to verify.",
                "Ask the artisan to confirm the claim first.",
            )
        note = (payload.evidence_note or "").strip()
        if not note:
            raise _error(422, "PROVENANCE_VERIFICATION_REQUIRED", "Verifying a claim needs an evidence note.")
        claim_model.coordinator_verified = True
        claim_model.evidence_note = note
        claim_model.verified_at = datetime.now(timezone.utc)
        db.commit()
        return {"claim": claim, "coordinator_verified": True, "evidence_note": note, "removed": False}

    if decision in ("rejected", "reject"):
        reason = (payload.reason or payload.evidence_note or "").strip()
        if not reason:
            raise _error(422, "PROVENANCE_VERIFICATION_REQUIRED", "Rejecting a claim needs a reason.")
        claim_model.coordinator_verified = False
        claim_model.rejection_reason = reason
        claim_model.rejected_at = datetime.now(timezone.utc)
        db.commit()
        return {"claim": claim, "coordinator_verified": False, "evidence_note": reason, "removed": True}

    raise _error(422, "PROVENANCE_VERIFICATION_REQUIRED", f"Unknown decision {payload.decision!r}; use verified or rejected.")


@router.post("/listings/{listing_id}/approval")
def decide_approval(
    listing_id: str,
    payload: schemas.ListingDecisionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["coordinator", "admin"])),
):
    listing = _listing(db, listing_id)
    decision = payload.decision.lower()
    if decision not in ("approve", "approved", "reject", "rejected"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid decision: {payload.decision}. Must be 'approve' or 'reject'.",
        )
    if listing.state != "awaiting_approval":
        raise _error(409, "LISTING_STATE_INVALID", f"The listing is {listing.state}, not awaiting approval.")

    reason = (payload.reason or "").strip()
    if decision in ("reject", "rejected"):
        if not reason:
            raise _error(422, "LISTING_STATE_INVALID", "Rejecting a listing needs a reason the artisan can act on.")
        listing.state = "rejected"
        listing.rejection_reason = reason
        listing.rejected_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": listing.state, "reason": reason}

    problems = approval_problems(listing)
    if problems:
        raise _error(
            409,
            "LISTING_STATE_INVALID",
            "Not ready to approve: " + " ".join(problems),
            "Review the pending claims, or send the listing back to the artisan.",
        )
    # Approval is what makes the photos public, so it does not happen without them.
    try:
        public_photos = public_media.publish(listing)
    except (StorageUnavailable, MediaNotFound, OSError) as exc:
        db.rollback()
        logger.error("Public photo copies for listing %s failed: %s", listing_id, exc)
        raise _error(
            503,
            "PROVIDER_UNAVAILABLE",
            "Could not make the public copies of the photos, so the listing is not approved yet.",
            "Retry shortly.",
        )
    listing.state = "approved"
    listing.rejection_reason = None
    listing.rejected_at = None
    db.commit()
    return {
        "status": listing.state,
        "reason": reason or f"Approved by {current_user.username}",
        "public_photos": public_photos,
    }


@router.post("/listings/{listing_id}/exports", response_model=schemas.ExportResult)
@router.post("/listings/{listing_id}/export", response_model=schemas.ExportResult)
def export_listing(
    listing_id: str,
    payload: schemas.ExportRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["coordinator", "admin"])),
):
    listing = _listing(db, listing_id)
    if payload.target not in ONDC_TARGETS:
        raise _error(422, "EXPORT_CONTRACT_INVALID", f"Export target {payload.target!r} is not built; only ONDC on_search is.")

    try:
        built = build_export(listing)
    except ExportRefused as exc:
        raise _error(409, exc.code.value, "Export refused: " + " ".join(exc.problems))

    payload_json = json.dumps(built.payload, sort_keys=True, separators=(",", ":"))
    payload_hash = f"sha256:{hashlib.sha256(payload_json.encode('utf-8')).hexdigest()}"
    passed = not built.violations
    network_submission = "simulated" if passed and payload.simulate_network_submission else "not_attempted"

    db.add(models.ExportRecordModel(
        export_id=str(uuid.uuid4()),
        listing_id=listing_id,
        target=payload.target,
        status="validated" if passed else "failed",
        payload_hash=payload_hash,
        contract_validation=json.dumps({
            "passed": passed,
            "schema_source": built.schema_source,
            "violations": built.violations[:25],
        }),
        network_submission=network_submission,
    ))
    db.commit()
    record = listing.exports[-1]

    if not passed:
        raise _error(
            422,
            "EXPORT_CONTRACT_INVALID",
            f"The payload broke the ONDC schema in {len(built.violations)} place(s): "
            + "; ".join(built.violations[:5]),
        )

    return schemas.ExportResult(
        export_id=record.export_id,
        target=payload.target,
        status="validated",
        payload_hash=payload_hash,
        contract_validation=schemas.ContractValidation(passed=True, schema_source=built.schema_source),
        network_submission=network_submission,
        warnings=built.warnings,
        payload=built.payload,
    )
