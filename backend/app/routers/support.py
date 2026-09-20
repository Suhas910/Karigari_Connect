# backend/app/routers/support.py
import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session, joinedload

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
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    if not payload.message or not payload.message.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message content cannot be empty."
        )

    idem_key = idempotency_key or getattr(payload, "idempotency_key", None)
    if idem_key:
        existing = db.query(models.SupportMessageModel).filter(
            models.SupportMessageModel.artisan_id == current_user.user_id,
            models.SupportMessageModel.idempotency_key == idem_key
        ).first()
        if existing:
            return format_support_message(existing)

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
        idempotency_key=idem_key,
        status="open"
    )
    db.add(support_msg)
    db.commit()
    db.refresh(support_msg)

    return format_support_message(support_msg)

@router.get("/messages", response_model=List[schemas.SupportMessageResponse])
def list_support_messages(
    limit: Optional[int] = 100,
    offset: Optional[int] = 0,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    query = (
        db.query(models.SupportMessageModel)
        .options(
            joinedload(models.SupportMessageModel.artisan),
            joinedload(models.SupportMessageModel.listing).joinedload(models.ListingModel.catalogue)
        )
    )
    if current_user.role in ["coordinator", "admin"]:
        query = query.order_by(models.SupportMessageModel.created_at.desc())
    else:
        query = query.filter(
            models.SupportMessageModel.artisan_id == current_user.user_id
        ).order_by(models.SupportMessageModel.created_at.desc())

    effective_limit = min(limit, 200) if limit is not None else 100
    messages = query.offset(offset or 0).limit(effective_limit).all()

    return [format_support_message(m) for m in messages]

@router.get("/messages/{message_id}", response_model=schemas.SupportMessageResponse)
def get_support_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    msg = (
        db.query(models.SupportMessageModel)
        .options(
            joinedload(models.SupportMessageModel.artisan),
            joinedload(models.SupportMessageModel.listing).joinedload(models.ListingModel.catalogue)
        )
        .filter(models.SupportMessageModel.id == message_id)
        .first()
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Support message not found")
    if current_user.role not in ["coordinator", "admin"] and msg.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this support thread")
    return format_support_message(msg)

@router.get("/messages/{message_id}/replies", response_model=List[schemas.SupportMessageReplyResponse])
def get_support_message_replies(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    msg = db.query(models.SupportMessageModel).filter(models.SupportMessageModel.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Support message not found")
    if current_user.role not in ["coordinator", "admin"] and msg.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this support thread")

    replies = (
        db.query(models.SupportMessageReplyModel)
        .filter(models.SupportMessageReplyModel.message_id == message_id)
        .order_by(models.SupportMessageReplyModel.created_at.asc())
        .all()
    )
    return [
        schemas.SupportMessageReplyResponse(
            id=r.id,
            message_id=r.message_id,
            sender_role=r.sender_role,
            sender_name=r.sender_name,
            body=r.body,
            created_at=r.created_at.isoformat() if r.created_at else ""
        )
        for r in replies
    ]

@router.post("/messages/{message_id}/replies", response_model=schemas.SupportMessageReplyResponse)
def create_support_message_reply(
    message_id: str,
    payload: schemas.SupportMessageReplyCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    if not payload.body or not payload.body.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Reply body cannot be empty."
        )

    msg = db.query(models.SupportMessageModel).filter(models.SupportMessageModel.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Support message not found")
    if current_user.role not in ["coordinator", "admin"] and msg.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to reply to this support thread")

    sender_name = (
        f"{current_user.first_name or ''} {current_user.last_name or ''}".strip()
        or current_user.username
    )

    reply = models.SupportMessageReplyModel(
        message_id=message_id,
        sender_id=current_user.user_id,
        sender_role=current_user.role,
        sender_name=sender_name,
        body=payload.body.strip()
    )
    db.add(reply)
    db.commit()
    db.refresh(reply)

    return schemas.SupportMessageReplyResponse(
        id=reply.id,
        message_id=reply.message_id,
        sender_role=reply.sender_role,
        sender_name=reply.sender_name,
        body=reply.body,
        created_at=reply.created_at.isoformat() if reply.created_at else ""
    )


@router.patch("/messages/{message_id}/close", response_model=schemas.SupportMessageResponse)
@router.post("/messages/{message_id}/close", response_model=schemas.SupportMessageResponse)
def close_support_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Close an open support conversation. Callable by both the artisan and coordinator."""
    msg = (
        db.query(models.SupportMessageModel)
        .options(
            joinedload(models.SupportMessageModel.artisan),
            joinedload(models.SupportMessageModel.listing).joinedload(models.ListingModel.catalogue)
        )
        .filter(models.SupportMessageModel.id == message_id)
        .first()
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Support message not found")

    if current_user.role not in ["coordinator", "admin"] and msg.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to close this support thread")

    msg.status = "resolved"
    db.commit()
    db.refresh(msg)
    return format_support_message(msg)


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_support_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Artisan-only: Remove the history of a closed/resolved support conversation."""
    msg = db.query(models.SupportMessageModel).filter(models.SupportMessageModel.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Support message not found")

    if current_user.role != "artisan":
        raise HTTPException(status_code=403, detail="Only artisans can delete their closed chat history")

    if msg.artisan_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this support thread")

    if msg.status not in ["resolved", "closed"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete an active inquiry. Please close the conversation first."
        )

    db.delete(msg)
    db.commit()
    return None

