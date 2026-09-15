# backend/app/routers/support.py
import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas, auth

router = APIRouter(prefix="/support", tags=["Support"])

def format_support_message(msg: models.SupportMessageModel) -> schemas.SupportMessageResponse:
    artisan_name = msg.artisan.username if msg.artisan else None
    listing_title = None
    if msg.listing and msg.listing.catalogue:
        try:
            cat_data = json.loads(msg.listing.catalogue.catalogue_data)
            listing_title = cat_data.get("title", {}).get("en")
        except Exception:
            listing_title = None

    return schemas.SupportMessageResponse(
        id=msg.id,
        artisan_id=msg.artisan_id,
        listing_id=msg.listing_id,
        message=msg.message,
        status=msg.status,
        created_at=msg.created_at.isoformat() if msg.created_at else "",
        artisan_name=artisan_name,
        listing_title=listing_title
    )

@router.post("/messages", response_model=schemas.SupportMessageResponse)
def create_support_message(
    payload: schemas.SupportMessageCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    if not payload.message or not payload.message.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message content cannot be empty."
        )

    listing_id = payload.listing_id.strip() if payload.listing_id and payload.listing_id.strip() else None
    if listing_id:
        listing = db.query(models.ListingModel).filter(models.ListingModel.id == listing_id).first()
        if not listing:
            # If invalid listing ID passed, we still allow support message but set listing_id to None
            listing_id = None

    support_msg = models.SupportMessageModel(
        artisan_id=current_user.user_id,
        listing_id=listing_id,
        message=payload.message.strip(),
        status="open"
    )
    db.add(support_msg)
    db.commit()
    db.refresh(support_msg)

    return format_support_message(support_msg)

@router.get("/messages", response_model=List[schemas.SupportMessageResponse])
def list_support_messages(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    if current_user.role in ["coordinator", "admin"]:
        messages = db.query(models.SupportMessageModel).order_by(models.SupportMessageModel.created_at.desc()).all()
    else:
        messages = db.query(models.SupportMessageModel).filter(
            models.SupportMessageModel.artisan_id == current_user.user_id
        ).order_by(models.SupportMessageModel.created_at.desc()).all()

    return [format_support_message(m) for m in messages]
