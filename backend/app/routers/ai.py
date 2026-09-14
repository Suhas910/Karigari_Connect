# backend/app/routers/ai.py
import json
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas, auth
from ..ai.service import ai_service
from ..ai import config as ai_config

router = APIRouter(tags=["AI Pipeline"])

# --- IMAGE STUDIO ENDPOINTS ---
@router.post("/listings/{listing_id}/jobs/image-studio")
@router.post("/listings/{listing_id}/ai/image-studio")
def request_image_studio(
    listing_id: str,
    payload: schemas.ImageStudioRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    job = ai_service.create_image_job(
        listing_id=listing_id,
        media_id=payload.media_id,
        photos=payload.photos,
        db=db
    )
    return {"job_id": job.job_id}

# --- TRANSCRIPTION ENDPOINTS ---
@router.post("/listings/{listing_id}/jobs/transcription")
@router.post("/listings/{listing_id}/ai/transcription")
def request_transcription(
    listing_id: str,
    payload: schemas.TranscriptionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    job = ai_service.create_transcription_job(
        listing_id=listing_id,
        audio_media_id=payload.audio_media_id,
        declared_language=payload.declared_language,
        db=db
    )
    return {"job_id": job.job_id}

# --- ASYNC JOB STATUS & RESULT ENDPOINTS ---
@router.get("/jobs/{job_id}", response_model=schemas.JobStatus)
def get_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    job = db.query(models.JobModel).filter(models.JobModel.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return schemas.JobStatus(
        job_id=job.job_id,
        type=job.type,
        status=job.status,
        attempt=job.attempt,
        created_at=job.created_at.isoformat() if job.created_at else "",
        updated_at=job.updated_at.isoformat() if job.updated_at else ""
    )

@router.get("/jobs/{job_id}/result")
def get_job_result(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    job = db.query(models.JobModel).filter(models.JobModel.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status == "failed" and job.error_data:
        # Whatever the job produced before failing (an image job's quality report and its
        # retake guidance) comes back with the error.
        return {
            **json.loads(job.result_data or "{}"),
            "job_id": job.job_id,
            "status": "failed",
            "error": json.loads(job.error_data),
        }

    if not job.result_data:
        raise HTTPException(status_code=400, detail="Job result not yet available")

    return json.loads(job.result_data)

# --- CATALOGUE GENERATION ENDPOINTS ---
@router.post("/listings/{listing_id}/jobs/catalogue", response_model=schemas.CatalogueResult)
@router.post("/listings/{listing_id}/ai/catalogue", response_model=schemas.CatalogueResult)
def request_catalogue_generation(
    listing_id: str,
    payload: Optional[Dict[str, Any]] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    return ai_service.generate_catalogue(
        listing_id=listing_id,
        payload=payload,
        db=db
    )

# --- DYNAMIC FAIR PRICE ENGINE ENDPOINT ---
@router.post("/listings/{listing_id}/price", response_model=schemas.PriceResult)
def request_price_calculation(
    listing_id: str,
    payload: Optional[schemas.PriceRequest] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    mat_cost = payload.material_cost_paise if payload else None
    hours = payload.labour_hours if payload else None
    skill = payload.skill_level if payload else None
    state = payload.state_code if payload else None
    comparables = payload.comparables_paise if payload else None

    return ai_service.calculate_fair_price(
        listing_id=listing_id,
        material_cost_paise=mat_cost,
        labour_hours=hours,
        skill_level=skill,
        state_code=state,
        comparables_paise=comparables,
        db=db
    )


# --- AI LAYER CONFIGURATION ---
@router.get("/ai/config")
def ai_configuration():
    """Report which AI implementation is actually serving requests.

    Unauthenticated on purpose. Two implementations share `app/ai/` and one of them
    returns fixed demo content, so "which one is running right now" must be answerable
    from outside the process -- during a demo, by whoever is asking whether it is live.
    A capability whose honesty depends on someone remembering to say so out loud is not
    an honest capability.
    """
    return ai_config.summary()
