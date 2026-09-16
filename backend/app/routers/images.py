import uuid
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_user
from ..supabase_client import supabase
from .. import models, schemas

router = APIRouter()

BUCKET_NAME = "product_images"
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_SIZE = 5 * 1024 * 1024  # 5 MB


@router.post("/users/{user_id}/products/{product_id}/post-image")
def post_image(
    user_id: int,
    product_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    # Check if the current user is the owner of the product
    product = (
        db.query(models.Product)
        .filter_by(product_id=product_id, user_id=user_id)
        .first()
    )
    if not product:
        raise HTTPException(
            status_code=404, detail="Product not found or you are not the owner."
        )

    # Validate file type
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only JPEG, PNG, and WEBP are allowed.",
        )

    # Validate file size
    contents = file.file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds 5 MB limit.")

    # Generate a unique filename
    unique_filename = f"{uuid.uuid4()}.{file.filename.split('.')[-1]}"

    # Upload to Supabase Storage
    supabase.storage.from_(BUCKET_NAME).upload(unique_filename, contents)

    # Get public URL
    public_url = supabase.storage.from_(BUCKET_NAME).get_public_url(unique_filename)

    # Save image metadata to database
    new_image = models.Image(
        product_id=product_id,
        storage_path=unique_filename,
        url=public_url,
    )
    db.add(new_image)
    db.commit()
    db.refresh(new_image)

    return {"image_id": new_image.image_id, "url": new_image.url}


@router.get("/users/{user_id}/products/{product_id}/images")
def get_images(
    user_id: int,
    product_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # Any authenticated user can view images for an existing product.
    product = db.query(models.Product).filter_by(product_id=product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found.")

    images = db.query(models.Image).filter_by(product_id=product_id).all()
    return [{"image_id": img.image_id, "url": img.url} for img in images]
