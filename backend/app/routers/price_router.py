"""
price_router.py

FastAPI route wiring pricing_service.py.
Mount in main app: app.include_router(price_router, prefix="/api/v1")
"""

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Path, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

try:
    from ..database import get_db
    from .. import models, auth
    from ..services.pricing_service import calculate_price, PriceResult, round_half_up
except ImportError:
    from app.database import get_db
    from app import models, auth
    from app.services.pricing_service import calculate_price, PriceResult, round_half_up

router = APIRouter(tags=["pricing"])


# ---------- request/response models ----------

class FallbackSuggestionOut(BaseModel):
    used_tier: str
    hourly_wage_inr: float
    note: str


class PriceRequest(BaseModel):
    material_cost_inr: Optional[float] = Field(default=None, ge=0)
    material_cost_paise: Optional[int] = Field(default=None, ge=0)
    labour_hours: Optional[float] = Field(default=None, gt=0)
    state_code: Optional[str] = Field(default=None, min_length=2, max_length=2)
    skill_level: Optional[str] = Field(default=None, description="unskilled | semi_skilled | skilled | highly_skilled")
    skill_level_source: Optional[str] = Field(default=None, description="self_declared | technique_floor | artisan_card_elevation | coordinator_verified")
    techniques: list[str] = Field(default_factory=list)
    comparables: list[float] = Field(default_factory=list)
    zone: str = Field(default="zone_1")


class WageSourceOut(BaseModel):
    state_code: str
    zone: str
    notification_ref: str
    effective_from: str
    effective_to: Optional[str] = None
    source_url: str


class PriceInputsOut(BaseModel):
    material_cost_inr: float
    labour_hours: float
    hourly_wage_inr: Optional[float] = None
    skill_level: str
    skill_level_self_declared: Optional[str] = None
    skill_level_source: Optional[str] = None
    state_code: str
    zone: Optional[str] = None
    techniques: list[str] = Field(default_factory=list)
    # Paise equivalents for frontend contracts.ts compatibility
    material_cost_paise: int = 0
    hourly_wage_paise: int = 0


class PriceResponse(BaseModel):
    request_id: str
    calculation_version: str
    status: str
    currency: str
    wage_source: Optional[WageSourceOut] = None
    inputs: PriceInputsOut
    floor_amount_inr: Optional[float] = None
    recommended_low_inr: Optional[float] = None
    recommended_high_inr: Optional[float] = None
    explanation: str
    error_code: Optional[str] = None
    fallback_suggestion: Optional[FallbackSuggestionOut] = None
    # Paise equivalents for frontend contracts.ts compatibility
    floor_amount_paise: Optional[int] = None
    recommended_low_paise: Optional[int] = None
    recommended_high_paise: Optional[int] = None


class ErrorDetail(BaseModel):
    code: str
    message: str
    recoverable: bool
    action: str


class ErrorResponse(BaseModel):
    request_id: str
    error: ErrorDetail


# ---------- error code -> HTTP behaviour ----------

ERROR_CODE_META = {
    "WAGE_RATE_UNAVAILABLE": {
        "status_code": 422,
        "recoverable": True,
        "action": "Select a recognized state code (e.g. KA, UP, WB) or contact coordinator.",
    },
    "INVALID_INPUT": {
        "status_code": 422,
        "recoverable": True,
        "action": "correct_input",
    },
}


def _result_to_response(result: PriceResult, request_id: str) -> PriceResponse:
    material_cost_inr = result.inputs.get("material_cost_inr", 0.0)
    hourly_wage_inr = result.inputs.get("hourly_wage_inr", 0.0)
    material_cost_paise = round_half_up(material_cost_inr * 100)
    hourly_wage_paise = round_half_up(hourly_wage_inr * 100) if hourly_wage_inr else 0

    floor_amount_paise = round_half_up(result.floor_amount_inr * 100) if result.floor_amount_inr is not None else None
    recommended_low_paise = round_half_up(result.recommended_low_inr * 100) if result.recommended_low_inr is not None else None
    recommended_high_paise = round_half_up(result.recommended_high_inr * 100) if result.recommended_high_inr is not None else None

    inputs_dict = {
        **result.inputs,
        "material_cost_paise": material_cost_paise,
        "hourly_wage_paise": hourly_wage_paise,
    }

    fallback_out = (
        FallbackSuggestionOut(**result.fallback_suggestion)
        if result.fallback_suggestion
        else None
    )

    return PriceResponse(
        request_id=request_id,
        calculation_version=result.calculation_version,
        status=result.status,
        currency=result.currency,
        wage_source=WageSourceOut(**result.wage_source) if result.wage_source else None,
        inputs=PriceInputsOut(**inputs_dict),
        floor_amount_inr=result.floor_amount_inr,
        recommended_low_inr=result.recommended_low_inr,
        recommended_high_inr=result.recommended_high_inr,
        explanation=result.explanation,
        error_code=result.error_code,
        fallback_suggestion=fallback_out,
        floor_amount_paise=floor_amount_paise,
        recommended_low_paise=recommended_low_paise,
        recommended_high_paise=recommended_high_paise,
    )


# ---------- route ----------

@router.post(
    "/listings/{listing_id}/price",
    response_model=PriceResponse,
    responses={422: {"model": ErrorResponse}},
)
def compute_price(
    listing_id: str = Path(..., description="opaque listing UUID"),
    body: Optional[PriceRequest] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    request_id = f"req_{uuid.uuid4().hex[:12]}"
    body = body or PriceRequest()

    # Verify listing exists and user has authorization
    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if current_user.role == "artisan" and listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to calculate price for this listing")

    cat_data = {}
    if listing.catalogue and listing.catalogue.catalogue_data:
        try:
            import json
            cat_data = json.loads(listing.catalogue.catalogue_data)
        except Exception:
            pass

    # Resolve material cost in INR — never fabricate
    mat_cost = body.material_cost_inr
    if mat_cost is None and body.material_cost_paise is not None:
        mat_cost = body.material_cost_paise / 100.0
    if mat_cost is None:
        if "material_cost_paise" in cat_data and cat_data["material_cost_paise"] is not None and cat_data["material_cost_paise"] > 0:
            mat_cost = cat_data["material_cost_paise"] / 100.0
        elif "material_cost_inr" in cat_data and cat_data["material_cost_inr"] is not None and float(cat_data["material_cost_inr"]) > 0:
            mat_cost = float(cat_data["material_cost_inr"])

    # Resolve labour hours — never fabricate
    labour_hours = body.labour_hours
    if labour_hours is None:
        labour_hours = cat_data.get("labour", {}).get("hours")

    # Resolve state code — never fabricate
    state_code = body.state_code or cat_data.get("labour", {}).get("state_code")

    missing = []
    if mat_cost is None:
        missing.append("material_cost")
    if labour_hours is None:
        missing.append("labour_hours")
    if not state_code:
        missing.append("state_code")
    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PRICE_INPUT_REQUIRED",
                "message": f"Cannot calculate a price floor without: {', '.join(missing)}. This must never be guessed.",
                "recoverable": True,
                "action": "provide_missing_field",
            },
        )
    state_code = state_code.upper()
    skill_level = body.skill_level or cat_data.get("labour", {}).get("skill_level", "skilled")
    techniques = body.techniques or cat_data.get("techniques", [])

    # Phase 2/3: Persistent Artisan Profile Check
    # If the artisan has a verified profile at or above the requested tier, use 'coordinator_verified'
    skill_rank_map = {"unskilled": 0, "semi_skilled": 1, "skilled": 2, "highly_skilled": 3}
    artisan_user = None
    if listing:
        if getattr(listing, "artisan", None):
            artisan_user = listing.artisan
        elif getattr(listing, "artisan_id", None):
            artisan_user = db.query(models.User).filter(models.User.user_id == listing.artisan_id).first()

    skill_level_source = body.skill_level_source
    if artisan_user and artisan_user.profile_status == "verified" and artisan_user.verified_skill_level:
        verified_rank = skill_rank_map.get(artisan_user.verified_skill_level, -1)
        requested_rank = skill_rank_map.get(skill_level, 0)
        if verified_rank >= requested_rank:
            skill_level_source = "coordinator_verified"

    result = calculate_price(
        material_cost_inr=mat_cost,
        labour_hours=labour_hours,
        state_code=state_code,
        skill_level=skill_level,
        techniques=techniques,
        comparables=body.comparables,
        zone=body.zone,
        skill_level_source=skill_level_source,
    )

    if result.error_code == "INVALID_INPUT":
        meta = ERROR_CODE_META.get(result.error_code, {"status_code": 422, "recoverable": True, "action": "correct_input"})
        raise HTTPException(
            status_code=meta["status_code"],
            detail=ErrorResponse(
                request_id=request_id,
                error=ErrorDetail(
                    code=result.error_code,
                    message=result.explanation,
                    recoverable=meta["recoverable"],
                    action=meta["action"],
                ),
            ).model_dump(),
        )

    # Persist price calculation and manage claims if the listing exists in database
    if listing:
        # Phase 4: Gated Master Craftsman Claim Persistence & Idempotency Guard
        skill_source = result.inputs.get("skill_level_source")
        effective_skill = result.inputs.get("skill_level")

        existing_master_claim = db.query(models.ClaimModel).filter(
            models.ClaimModel.listing_id == listing_id,
            models.ClaimModel.claim == "skill_level_master_self_declared",
        ).first()

        if skill_source == "self_declared" and effective_skill == "highly_skilled":
            if not existing_master_claim:
                new_claim = models.ClaimModel(
                    listing_id=listing_id,
                    claim="skill_level_master_self_declared",
                    asserted_by_artisan=True,
                    coordinator_verified=False,
                    evidence_note="Self-declared Master Craftsman tier. Requires coordinator verification of practice/awards.",
                )
                db.add(new_claim)
            else:
                # Idempotency Guard: if coordinator already verified this claim, DO NOT reset to False!
                if existing_master_claim.coordinator_verified:
                    result.inputs["skill_level_source"] = "coordinator_verified"
        else:
            # If artisan downgraded from highly_skilled or has artisan_card_elevation,
            # clean up unverified master claim so it doesn't block submission
            if existing_master_claim and not existing_master_claim.coordinator_verified:
                db.delete(existing_master_claim)

        price_record = db.query(models.PriceCalculationModel).filter(models.PriceCalculationModel.listing_id == listing_id).first()
        if not price_record:
            price_record = models.PriceCalculationModel(listing_id=listing_id)
            db.add(price_record)

        price_record.calculation_version = result.calculation_version
        price_record.status = result.status
        price_record.currency = result.currency
        if result.wage_source:
            price_record.state_code = result.wage_source.get("state_code")
            price_record.notification_ref = result.wage_source.get("notification_ref")
            price_record.effective_from = result.wage_source.get("effective_from")
            price_record.source_url = result.wage_source.get("source_url")

        price_record.material_cost_paise = round_half_up(mat_cost * 100)
        price_record.labour_hours = labour_hours
        hourly_wage_inr = result.inputs.get("hourly_wage_inr", 0.0)
        price_record.hourly_wage_paise = round_half_up(hourly_wage_inr * 100) if hourly_wage_inr else 0
        price_record.skill_level = result.inputs.get("skill_level", skill_level)
        price_record.floor_amount_paise = round_half_up(result.floor_amount_inr * 100) if result.floor_amount_inr is not None else 0
        price_record.recommended_low_paise = round_half_up(result.recommended_low_inr * 100) if result.recommended_low_inr is not None else 0
        price_record.recommended_high_paise = round_half_up(result.recommended_high_inr * 100) if result.recommended_high_inr is not None else 0
        price_record.explanation = result.explanation
        db.commit()

    return _result_to_response(result, request_id)