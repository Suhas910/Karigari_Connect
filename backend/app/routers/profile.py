# backend/app/routers/profile.py
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas, auth

router = APIRouter(prefix="/profile", tags=["Profile"])


def format_profile_response(user: models.User) -> schemas.ArtisanProfileResponse:
    return schemas.ArtisanProfileResponse(
        user_id=user.user_id,
        username=user.username,
        phone_number=user.phone_number,
        role=user.role,
        profile_status=user.profile_status or "incomplete",
        declared_skill_level=user.declared_skill_level,
        declared_zone=user.declared_zone,
        id_proof_type=user.id_proof_type or "none",
        id_proof_number=user.id_proof_number,
        verified_skill_level=user.verified_skill_level,
        verified_by=user.verified_by,
        verified_at=user.verified_at,
    )


@router.post("/artisan", response_model=schemas.ArtisanProfileResponse)
def submit_artisan_profile(
    payload: schemas.ArtisanProfileSubmitRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Artisan submits or updates their persistent profile for verification.
    Sets profile_status to 'pending_verification'.
    """
    valid_skills = {"unskilled", "semi_skilled", "skilled", "highly_skilled"}
    if payload.declared_skill_level not in valid_skills:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid skill level: {payload.declared_skill_level}. Must be one of {list(valid_skills)}",
        )

    current_user.declared_skill_level = payload.declared_skill_level
    current_user.declared_zone = payload.declared_zone
    current_user.id_proof_type = payload.id_proof_type
    current_user.id_proof_number = payload.id_proof_number
    current_user.profile_status = "pending_verification"

    db.commit()
    db.refresh(current_user)
    return format_profile_response(current_user)


@router.get("/artisan/pending", response_model=List[schemas.ArtisanProfileResponse])
@router.get("/artisans/pending", response_model=List[schemas.ArtisanProfileResponse])
def get_pending_artisan_profiles(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Coordinator reads all artisan profiles pending verification.
    """
    if current_user.role not in ["coordinator", "admin"]:
        raise HTTPException(status_code=403, detail="Coordinator access required")

    pending_users = (
        db.query(models.User)
        .filter(models.User.profile_status == "pending_verification")
        .order_by(models.User.user_id.desc())
        .all()
    )
    return [format_profile_response(u) for u in pending_users]


@router.get("/artisan/me", response_model=schemas.ArtisanProfileResponse)
@router.get("/artisan", response_model=schemas.ArtisanProfileResponse)
def get_my_artisan_profile(
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Current user reads their own profile.
    """
    return format_profile_response(current_user)


@router.get("/artisan/{user_id}", response_model=schemas.ArtisanProfileResponse)
def get_artisan_profile(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Read an artisan's profile (self or coordinator).
    """
    if current_user.role == "artisan" and current_user.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this profile")

    user = db.query(models.User).filter(models.User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Artisan user not found")

    return format_profile_response(user)


@router.post("/artisan/{user_id}/review", response_model=schemas.ArtisanProfileResponse)
def review_artisan_profile(
    user_id: int,
    payload: schemas.ArtisanProfileReviewRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Coordinator reviews an artisan profile:
    decision == 'verified' -> verified_skill_level = declared_skill_level, profile_status = 'verified'
    decision == 'rejected' -> profile_status = 'rejected'
    """
    if current_user.role not in ["coordinator", "admin"]:
        raise HTTPException(status_code=403, detail="Coordinator access required to review profile")

    target_user = db.query(models.User).filter(models.User.user_id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Artisan user not found")

    if payload.decision == "verified":
        verified_tier = payload.verified_skill_level or target_user.declared_skill_level
        if not verified_tier:
            raise HTTPException(
                status_code=422,
                detail="Cannot verify profile: no statutory skill level was declared by the artisan or provided by the coordinator."
            )
        target_user.verified_skill_level = verified_tier
        target_user.profile_status = "verified"
        target_user.verified_by = current_user.user_id
        target_user.verified_at = datetime.now(timezone.utc)
    elif payload.decision == "rejected":
        target_user.profile_status = "rejected"
        target_user.verified_skill_level = None
        target_user.verified_by = current_user.user_id
        target_user.verified_at = datetime.now(timezone.utc)
    else:
        raise HTTPException(status_code=422, detail=f"Invalid decision: {payload.decision}. Must be 'verified' or 'rejected'")

    db.commit()
    db.refresh(target_user)
    return format_profile_response(target_user)
