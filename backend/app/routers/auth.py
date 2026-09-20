# backend/app/routers/auth.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from .. import models, schemas, auth

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=schemas.TokenResponse)
def register(user_data: schemas.UserRegister, db: Session = Depends(get_db)):
    clean_username = user_data.username.strip()
    clean_phone = user_data.phone_number.strip() if user_data.phone_number else None

    # Check if username exists
    if db.query(models.User).filter(models.User.username == clean_username).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )
    # Check if phone number exists (if provided)
    if clean_phone and db.query(models.User).filter(models.User.phone_number == clean_phone).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number already registered",
        )
    # Check if email exists (if provided)
    if user_data.email and db.query(models.User).filter(models.User.email == user_data.email.strip()).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email address already registered",
        )

    # Security: Self-registration strictly provisions 'artisan' accounts.
    # Coordinators and Admins must be provisioned via /admin/users.
    role = "artisan"
    new_user = models.User(
        username=clean_username,
        phone_number=clean_phone,
        email=user_data.email.strip() if user_data.email else None,
        hashed_password=auth.hash_password(user_data.password),
        role=role,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    token = auth.create_token(
        {"sub": new_user.username, "id": new_user.user_id, "role": new_user.role}
    )
    return schemas.TokenResponse(
        access_token=token,
        token_type="bearer",
        role=new_user.role,
        user_id=new_user.user_id,
        username=new_user.username,
        phone_number=new_user.phone_number,
    )


@router.post("/signup", response_model=schemas.TokenResponse)
def signup(user_data: schemas.UserRegister, db: Session = Depends(get_db)):
    """Convenience alias for /register endpoint. Always provisions role 'artisan'."""
    return register(user_data, db)


@router.post("/admin/users", response_model=schemas.TokenResponse)
def create_privileged_user(
    user_data: schemas.AdminUserCreate,
    db: Session = Depends(get_db),
    _authorized: bool = Depends(auth.get_admin_user_or_secret)
):
    """
    Privileged provisioning of coordinator and admin accounts.
    Requires Bearer token of an admin user OR valid X-Admin-Secret header.
    """
    clean_username = user_data.username.strip()
    clean_phone = user_data.phone_number.strip() if user_data.phone_number else None

    # Check if username exists
    if db.query(models.User).filter(models.User.username == clean_username).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )
    # Check if phone number exists (if provided)
    if clean_phone and db.query(models.User).filter(models.User.phone_number == clean_phone).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number already registered",
        )
    # Check if email exists (if provided)
    if user_data.email and db.query(models.User).filter(models.User.email == user_data.email.strip()).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email address already registered",
        )

    role = (
        user_data.role
        if user_data.role in ["artisan", "coordinator", "admin"]
        else "coordinator"
    )
    new_user = models.User(
        username=clean_username,
        phone_number=clean_phone,
        email=user_data.email.strip() if user_data.email else None,
        hashed_password=auth.hash_password(user_data.password),
        role=role,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    token = auth.create_token(
        {"sub": new_user.username, "id": new_user.user_id, "role": new_user.role}
    )
    return schemas.TokenResponse(
        access_token=token,
        token_type="bearer",
        role=new_user.role,
        user_id=new_user.user_id,
        username=new_user.username,
        phone_number=new_user.phone_number,
    )


@router.post("/login", response_model=schemas.TokenResponse)
def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    clean_identifier = credentials.username.strip()
    user = (
        db.query(models.User)
        .filter(
            (models.User.username == clean_identifier)
            | (models.User.phone_number == clean_identifier)
        )
        .first()
    )
    if not user or not auth.verify_password(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username/phone number or password",
        )

    token = auth.create_token(
        {"sub": user.username, "id": user.user_id, "role": user.role}
    )
    return schemas.TokenResponse(
        access_token=token,
        token_type="bearer",
        role=user.role,
        user_id=user.user_id,
        username=user.username,
        phone_number=user.phone_number,
    )


@router.post("/refresh")
def refresh_token(current_user: models.User = Depends(auth.get_user_for_refresh)):
    token = auth.create_token(
        {
            "sub": current_user.username,
            "id": current_user.user_id,
            "role": current_user.role,
        }
    )
    return {
        "access_token": token,
        "token": token,  # Aliased for frontend compatibility
        "token_type": "bearer",
        "role": current_user.role,
    }


@router.get("/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return schemas.UserResponse(
        user_id=current_user.user_id,
        username=current_user.username,
        email=current_user.email,
        phone_number=current_user.phone_number,
        role=current_user.role,
    )
