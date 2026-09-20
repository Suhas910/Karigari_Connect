import json
import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..database import get_db
from .. import models, schemas, auth
from ..ai.service import ai_service
from ..ai import studio

logger = logging.getLogger(__name__)

router = APIRouter(tags=["AI Pipeline"])

ENHANCEMENT_IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_ENHANCEMENT_PHOTO_BYTES = 10 * 1024 * 1024  # 10 MB per photo

# --- BIREFNET IMAGE ENHANCEMENT ---
@router.post("/listings/{listing_id}/jobs/image-enhancement")
def request_image_enhancement(
    listing_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    engine: str = Form("processing"),
    background: str = Form("studio"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Upload the listing's photos; they are levelled, relit and placed on a catalogue background in the
    background. Poll GET /jobs/{job_id}.

    engine: "processing" (BiRefNet + image processing, default) or "ai" (Gemini image edit, verified
    against the original and falling back to processing). background: "studio" (soft sweep with a
    contact shadow, default) or "white" (pure white, for marketplaces that require it).
    """
    if engine not in studio.ENGINES:
        raise HTTPException(status_code=400, detail=f"engine must be one of: {', '.join(studio.ENGINES)}")
    if background not in studio.BACKGROUNDS:
        raise HTTPException(status_code=400, detail=f"background must be one of: {', '.join(studio.BACKGROUNDS)}")

    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if current_user.role == "artisan" and listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this listing")

    photos = []
    for upload in files:
        extension = ENHANCEMENT_IMAGE_TYPES.get(upload.content_type)
        if not extension:
            raise HTTPException(status_code=400, detail="Only JPEG, PNG and WEBP photos can be enhanced.")
        content = upload.file.read()
        if len(content) > MAX_ENHANCEMENT_PHOTO_BYTES:
            raise HTTPException(status_code=400, detail="Each photo must be 10 MB or smaller.")
        photos.append((extension, content))

    base_url = str(request.base_url)
    job, original_media_ids = ai_service.create_birefnet_image_job(
        listing=listing,
        photos=photos,
        base_url=base_url,
        db=db
    )
    background_tasks.add_task(
        ai_service.run_birefnet_image_job, job.job_id, original_media_ids, base_url, engine, background
    )
    return {"job_id": job.job_id}

# --- IMAGE STUDIO ENDPOINTS ---
@router.post("/listings/{listing_id}/jobs/image-studio")
@router.post("/listings/{listing_id}/ai/image-studio", deprecated=True)
def request_image_studio(
    listing_id: str,
    payload: schemas.ImageStudioRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if current_user.role == "artisan" and listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this listing")

    job = ai_service.create_image_job(
        listing_id=listing_id,
        media_id=payload.media_id,
        photos=payload.photos,
        db=db
    )
    return {"job_id": job.job_id}

MAX_AUDIO_BYTES = 15 * 1024 * 1024  # 15 MB limit (~1 min recording)

# --- TRANSCRIPTION ENDPOINTS ---
@router.post("/listings/{listing_id}/jobs/transcription")
@router.post("/listings/{listing_id}/ai/transcription", deprecated=True)
async def request_transcription(
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

    content_type = request.headers.get("content-type", "")
    audio_bytes = None
    audio_filename = None
    audio_media_id = None
    declared_language = listing.preferred_language or "en"

    if "multipart/form-data" in content_type:
        try:
            form = await request.form()
            file_obj = form.get("file") or form.get("audio") or form.get("audio_file")
            if file_obj and hasattr(file_obj, "read"):
                audio_bytes = await file_obj.read()
                if len(audio_bytes) > MAX_AUDIO_BYTES:
                    raise HTTPException(
                        status_code=400,
                        detail="Audio file exceeds maximum size of 15 MB (maximum 1 minute recording)."
                    )
                audio_filename = getattr(file_obj, "filename", "audio.m4a")
            raw_media_id = form.get("audio_media_id")
            if raw_media_id:
                audio_media_id = str(raw_media_id)
            raw_lang = form.get("declared_language")
            if raw_lang:
                declared_language = str(raw_lang)
        except HTTPException:
            raise
        except Exception as form_err:
            logger.warning("Error reading multipart audio data: %s", form_err)
    else:
        try:
            body = await request.json()
            if isinstance(body, dict):
                audio_media_id = body.get("audio_media_id")
                declared_language = body.get("declared_language") or listing.preferred_language or "en"
        except Exception:
            pass

    job = await run_in_threadpool(
        ai_service.create_transcription_job,
        listing_id=listing_id,
        audio_media_id=audio_media_id,
        declared_language=declared_language,
        audio_bytes=audio_bytes,
        audio_filename=audio_filename,
        db=db,
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

    if current_user.role == "artisan" and job.listing and job.listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this job")

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

    if current_user.role == "artisan" and job.listing and job.listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this job")

    if not job.result_data:
        raise HTTPException(status_code=400, detail="Job result not yet available")

    return json.loads(job.result_data)

# --- CATALOGUE GENERATION ENDPOINTS ---
@router.post("/listings/{listing_id}/jobs/catalogue", response_model=schemas.CatalogueResult)
@router.post("/listings/{listing_id}/ai/catalogue", response_model=schemas.CatalogueResult, deprecated=True)
def request_catalogue_generation(
    listing_id: str,
    payload: Optional[Dict[str, Any]] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if current_user.role == "artisan" and listing.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this listing")

    return ai_service.generate_catalogue(
        listing_id=listing_id,
        payload=payload,
        db=db
    )

