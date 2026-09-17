# Code changes — ProfileScreen expansion

Real patches against `Suhas910/Karigari_Connect`, branch `frontend-avi` (rebase onto latest `main` first — see previous note). Grounded in actual current file contents, not the abstract plan. One important design change from the original master prompt is called out in Part A5 below (endpoint split) — read that before running anything.

---

## The one catch that matters most

`backend/app/database.py`'s `init_db()` calls `Base.metadata.create_all(bind=engine)` for the **primary** Postgres/Neon engine. `create_all` only creates tables that don't exist yet — it never adds columns to a table that's already there. The SQLite fallback has its own `ensure_sqlite_schema()` patcher that does ad-hoc `ALTER TABLE ADD COLUMN`, but **nothing equivalent runs against the primary engine**. Every new column in this change would silently not exist on your live Neon DB, and the first profile save would 500. Fixed in Part A2 below by generalizing that patcher to run against both engines.

---

## PART A — Backend

### A1. `backend/app/models.py` — add columns to `User`

Insert these lines into the existing `User` class, right after the existing `verified_at` column (keep everything else in the file untouched):

```python
    # --- PROFILE-EXPANSION: personal ---
    first_name = Column(String(100), nullable=True)
    middle_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    name_as_per_aadhaar = Column(String(150), nullable=True)
    gender = Column(String(20), nullable=True)  # 'male' | 'female' | 'other' | 'prefer_not_to_say'
    profile_image_url = Column(String(500), nullable=True)
    # NOTE: `email` already exists on this model (see top of class) — reuse it,
    # do not add a second email column.

    # --- PROFILE-EXPANSION: business ---
    business_name = Column(String(200), nullable=True)
    brand_name = Column(String(200), nullable=True)
    establishment_type = Column(String(30), nullable=True)
    pan_number = Column(String(10), nullable=True)
    aadhaar_number = Column(String(12), nullable=True)  # TODO: encrypt at rest — no existing crypto pattern found in this repo, flagging rather than inventing one
    gst_registered = Column(Boolean, nullable=True, default=False)
    gst_number = Column(String(15), nullable=True)
    enrollment_number = Column(String(50), nullable=True)
    business_address_line = Column(String(300), nullable=True)
    pincode = Column(String(6), nullable=True)
    district = Column(String(100), nullable=True)
    city = Column(String(100), nullable=True)
    business_state_code = Column(String(5), nullable=True)  # deliberately separate from declared_zone — see A2 note below
    ondc_std_code = Column(String(10), nullable=True)
    location_type = Column(String(20), nullable=True)  # warehouse|shop|office|home
    pickup_days = Column(JSON, nullable=True)

    # --- PROFILE-EXPANSION: bank ---
    account_holder_name = Column(String(150), nullable=True)
    account_number = Column(String(30), nullable=True)  # TODO: encrypt at rest, same as aadhaar_number above
    ifsc_code = Column(String(11), nullable=True)
    bank_name = Column(String(150), nullable=True)
```

And add `JSON` to the sqlalchemy import at the top of the file:

```python
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Text,
    DateTime,
    Boolean,
    ForeignKey,
    JSON,
)
```

`business_state_code` is intentionally separate from `declared_zone` — `declared_zone` is the wage-calculation zone (self-declared, drives price floor, format `"KA/zone_2"`), `business_state_code` is the registered-business-address state (KYC/ONDC data). They can legitimately differ. Do not merge them.

### A2. `backend/app/database.py` — generalize the schema patcher (THE fix above)

Full file, replacing the current one:

```python
# backend/app/database.py
import os
import time
import logging
from pathlib import Path
from dotenv import load_dotenv

# Ensure .env in backend directory is loaded regardless of current working directory
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)
load_dotenv()

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker, declarative_base

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")
SQLITE_PATH = Path(__file__).resolve().parent.parent.parent / "karigari.db"
SQLITE_URL = f"sqlite:///{SQLITE_PATH}"

Base = declarative_base()

sqlite_engine = create_engine(
    SQLITE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)
SQLiteSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sqlite_engine)


def ensure_user_schema_columns(eng):
    """
    Ensure the `users` table has every column models.py currently expects,
    adding any that are missing via ALTER TABLE.

    Base.metadata.create_all() only creates TABLES that don't exist yet — it
    never adds columns to a table that's already there. Without this running
    against the PRIMARY engine too (not just the SQLite fallback, which is
    all the old ensure_sqlite_schema() covered), the live Postgres/Neon DB
    silently drifts from models.py on every schema change, and the first
    write to a new column 500s in production while working fine locally
    against a fresh SQLite file.

    Column type strings below are plain ANSI-ish tokens (VARCHAR(n), BOOLEAN,
    JSON) that both SQLite (which doesn't enforce declared types on ALTER
    TABLE ADD COLUMN) and Postgres accept, so one list works for both engines.
    """
    try:
        inspector = inspect(eng)
        if "users" in inspector.get_table_names():
            columns = {c["name"] for c in inspector.get_columns("users")}
            needed_columns = [
                # --- pre-existing (kept for any engine that never ran this before) ---
                ("profile_status", "VARCHAR(32) DEFAULT 'incomplete'"),
                ("declared_skill_level", "VARCHAR(32)"),
                ("declared_zone", "VARCHAR(64)"),
                ("id_proof_type", "VARCHAR(32) DEFAULT 'none'"),
                ("id_proof_number", "VARCHAR(64)"),
                ("verified_skill_level", "VARCHAR(32)"),
                ("verified_by", "INTEGER"),
                ("verified_at", "DATETIME"),
                ("phone_number", "VARCHAR(20)"),
                # --- PROFILE-EXPANSION: personal ---
                ("first_name", "VARCHAR(100)"),
                ("middle_name", "VARCHAR(100)"),
                ("last_name", "VARCHAR(100)"),
                ("name_as_per_aadhaar", "VARCHAR(150)"),
                ("gender", "VARCHAR(20)"),
                ("profile_image_url", "VARCHAR(500)"),
                # --- PROFILE-EXPANSION: business ---
                ("business_name", "VARCHAR(200)"),
                ("brand_name", "VARCHAR(200)"),
                ("establishment_type", "VARCHAR(30)"),
                ("pan_number", "VARCHAR(10)"),
                ("aadhaar_number", "VARCHAR(12)"),
                ("gst_registered", "BOOLEAN DEFAULT FALSE"),
                ("gst_number", "VARCHAR(15)"),
                ("enrollment_number", "VARCHAR(50)"),
                ("business_address_line", "VARCHAR(300)"),
                ("pincode", "VARCHAR(6)"),
                ("district", "VARCHAR(100)"),
                ("city", "VARCHAR(100)"),
                ("business_state_code", "VARCHAR(5)"),
                ("ondc_std_code", "VARCHAR(10)"),
                ("location_type", "VARCHAR(20)"),
                ("pickup_days", "JSON"),
                # --- PROFILE-EXPANSION: bank ---
                ("account_holder_name", "VARCHAR(150)"),
                ("account_number", "VARCHAR(30)"),
                ("ifsc_code", "VARCHAR(11)"),
                ("bank_name", "VARCHAR(150)"),
            ]
            with eng.connect() as conn:
                for col_name, col_type in needed_columns:
                    if col_name not in columns:
                        try:
                            conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type};"))
                            conn.commit()
                        except Exception as exc:
                            logger.warning("Failed to add column %s to users table (%s): %s", col_name, eng.dialect.name, exc)
    except Exception as e:
        logger.warning("Error checking users table schema (%s): %s", eng.dialect.name, e)


def create_resilient_engine():
    target_url = DATABASE_URL
    if target_url:
        if target_url.startswith("postgresql://"):
            target_url = target_url.replace("postgresql://", "postgresql+psycopg2://", 1)
        # Attempt connection with 10-second timeout and 2 retries for serverless wake-up
        for attempt in range(1, 3):
            try:
                connect_args = {"connect_timeout": 10} if "postgresql" in target_url else {}
                eng = create_engine(
                    target_url,
                    connect_args=connect_args,
                    pool_pre_ping=True,
                    pool_recycle=300,
                )
                with eng.connect() as conn:
                    conn.execute(text("SELECT 1"))
                logger.info("Connected to primary database: %s", target_url.split("@")[-1])
                return eng
            except Exception as exc:
                logger.warning(
                    "Attempt %d: Failed to connect to primary DATABASE_URL (%s).",
                    attempt,
                    exc,
                )
                if attempt < 2:
                    time.sleep(1)

    logger.warning("Falling back to local SQLite: %s", SQLITE_URL)
    ensure_user_schema_columns(sqlite_engine)
    return sqlite_engine


engine = create_resilient_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def seed_demo_users(target_engine):
    """Seed demo accounts if missing on the target engine."""
    from .models import User
    from .auth import hash_password

    Session = sessionmaker(bind=target_engine)
    db = Session()
    try:
        artisan = db.query(User).filter(User.username == "artisan_demo").first()
        if not artisan:
            db.add(
                User(
                    username="artisan_demo",
                    phone_number="9876543210",
                    hashed_password=hash_password("DemoPassword123!"),
                    role="artisan",
                    profile_status="incomplete",
                )
            )
        coord = db.query(User).filter(User.username == "coord_demo").first()
        if not coord:
            db.add(
                User(
                    username="coord_demo",
                    phone_number="9876543211",
                    hashed_password=hash_password("DemoPassword123!"),
                    role="coordinator",
                    profile_status="verified",
                )
            )
        db.commit()
    except Exception as err:
        db.rollback()
        logger.warning("Could not auto-seed demo users on %s: %s", target_engine.url, err)
    finally:
        db.close()


def init_db():
    """Initialize schemas and demo accounts on both primary and fallback engines."""
    from . import models  # Ensure all models are registered with Base.metadata

    # Initialize primary engine
    try:
        Base.metadata.create_all(bind=engine)
        ensure_user_schema_columns(engine)  # PROFILE-EXPANSION FIX: patch columns on an already-existing primary table too
        seed_demo_users(engine)
    except Exception as exc:
        logger.warning("Failed initializing primary database: %s", exc)

    # Always ensure fallback SQLite engine is fully initialized and seeded
    try:
        ensure_user_schema_columns(sqlite_engine)
        Base.metadata.create_all(bind=sqlite_engine)
        seed_demo_users(sqlite_engine)
    except Exception as exc:
        logger.warning("Failed initializing fallback SQLite database: %s", exc)


def get_db():
    """Dependency that yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

(Renamed `ensure_sqlite_schema` → `ensure_user_schema_columns` since it's no longer SQLite-only — search the repo for any other caller of the old name before deleting it; grep found none outside `database.py` itself at the time of writing.)

### A3. `backend/app/schemas.py` — extend Artisan Profile section

Replace the existing block:
```python
# --- Artisan Profile Schemas ---
class ArtisanProfileSubmitRequest(BaseModel):
    declared_skill_level: str  # "unskilled" | "semi_skilled" | "skilled" | "highly_skilled"
    declared_zone: str  # e.g. "KA/zone_2"
    id_proof_type: str = "none"  # "pehchan_card" | "pm_vishwakarma" | "none"
    id_proof_number: Optional[str] = None

class ArtisanProfileReviewRequest(BaseModel):
    decision: str  # "verified" | "rejected"
    verified_skill_level: Optional[str] = None
    reason: Optional[str] = None

class ArtisanProfileResponse(BaseModel):
    user_id: int
    username: str
    phone_number: Optional[str] = None
    role: str
    profile_status: str  # "incomplete" | "pending_verification" | "verified" | "rejected"
    declared_skill_level: Optional[str] = None
    declared_zone: Optional[str] = None
    id_proof_type: Optional[str] = "none"
    id_proof_number: Optional[str] = None
    verified_skill_level: Optional[str] = None
    verified_by: Optional[int] = None
    verified_at: Optional[datetime] = None
```

with:
```python
# --- Artisan Profile Schemas ---
import re

PAN_REGEX = re.compile(r'^[A-Z]{5}[0-9]{4}[A-Z]$')
IFSC_REGEX = re.compile(r'^[A-Z]{4}0[A-Z0-9]{6}$')
GST_REGEX = re.compile(r'^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{1}[A-Z\d]{1}$')
PINCODE_REGEX = re.compile(r'^\d{6}$')
AADHAAR_REGEX = re.compile(r'^\d{12}$')
EMAIL_REGEX = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

class ArtisanProfileSubmitRequest(BaseModel):
    declared_skill_level: str  # "unskilled" | "semi_skilled" | "skilled" | "highly_skilled"
    declared_zone: str  # e.g. "KA/zone_2"
    id_proof_type: str = "none"  # "pehchan_card" | "pm_vishwakarma" | "none"
    id_proof_number: Optional[str] = None

class ArtisanProfileReviewRequest(BaseModel):
    decision: str  # "verified" | "rejected"
    verified_skill_level: Optional[str] = None
    reason: Optional[str] = None

class PersonalDetailsUpdate(BaseModel):
    """Partial update — only fields present in the request body are applied."""
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None
    name_as_per_aadhaar: Optional[str] = None
    email: Optional[str] = None
    gender: Optional[str] = None  # "male" | "female" | "other" | "prefer_not_to_say"
    profile_image_url: Optional[str] = None

    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        if v is not None and not EMAIL_REGEX.match(v):
            raise ValueError('Invalid email format')
        return v

    @field_validator('gender')
    @classmethod
    def validate_gender(cls, v):
        valid = {'male', 'female', 'other', 'prefer_not_to_say'}
        if v is not None and v not in valid:
            raise ValueError(f'gender must be one of {sorted(valid)}')
        return v

class BusinessDetailsUpdate(BaseModel):
    """Partial update — only fields present in the request body are applied."""
    business_name: Optional[str] = None
    brand_name: Optional[str] = None
    establishment_type: Optional[str] = None  # individual|proprietorship|partnership|llp|pvt_ltd|public_ltd|huf|trust|society
    pan_number: Optional[str] = None
    aadhaar_number: Optional[str] = None
    gst_registered: Optional[bool] = None
    gst_number: Optional[str] = None
    enrollment_number: Optional[str] = None
    business_address_line: Optional[str] = None
    pincode: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    business_state_code: Optional[str] = None
    ondc_std_code: Optional[str] = None
    location_type: Optional[str] = None  # warehouse|shop|office|home
    pickup_days: Optional[List[str]] = None

    @field_validator('pan_number')
    @classmethod
    def validate_pan(cls, v):
        if v is not None and not PAN_REGEX.match(v.upper()):
            raise ValueError('Invalid PAN format (expected AAAAA9999A)')
        return v.upper() if v else v

    @field_validator('aadhaar_number')
    @classmethod
    def validate_aadhaar(cls, v):
        if v is not None and not AADHAAR_REGEX.match(v):
            raise ValueError('Aadhaar number must be exactly 12 digits')
        return v

    @field_validator('pincode')
    @classmethod
    def validate_pincode(cls, v):
        if v is not None and not PINCODE_REGEX.match(v):
            raise ValueError('Pincode must be exactly 6 digits')
        return v

    @field_validator('establishment_type')
    @classmethod
    def validate_establishment_type(cls, v):
        valid = {'individual', 'proprietorship', 'partnership', 'llp', 'pvt_ltd', 'public_ltd', 'huf', 'trust', 'society'}
        if v is not None and v not in valid:
            raise ValueError(f'establishment_type must be one of {sorted(valid)}')
        return v

    @field_validator('location_type')
    @classmethod
    def validate_location_type(cls, v):
        valid = {'warehouse', 'shop', 'office', 'home'}
        if v is not None and v not in valid:
            raise ValueError(f'location_type must be one of {sorted(valid)}')
        return v

    @model_validator(mode='after')
    def validate_gst_conditional(self):
        # Only enforced when this same payload is actively setting GST status —
        # a partial update that doesn't touch gst_registered at all won't trip this.
        if self.gst_registered is True:
            if not self.gst_number:
                raise ValueError('gst_number is required when gst_registered is true')
            if not GST_REGEX.match(self.gst_number.upper()):
                raise ValueError('Invalid GST number format')
        elif self.gst_registered is False:
            if not self.enrollment_number:
                raise ValueError('enrollment_number is required when gst_registered is false')
        return self

class BankDetailsUpdate(BaseModel):
    """Partial update — only fields present in the request body are applied."""
    account_holder_name: Optional[str] = None
    account_number: Optional[str] = None
    ifsc_code: Optional[str] = None
    bank_name: Optional[str] = None

    @field_validator('ifsc_code')
    @classmethod
    def validate_ifsc(cls, v):
        if v is not None and not IFSC_REGEX.match(v.upper()):
            raise ValueError('Invalid IFSC format (expected AAAA0AAAAAA)')
        return v.upper() if v else v

class ArtisanProfileResponse(BaseModel):
    user_id: int
    username: str
    phone_number: Optional[str] = None
    role: str
    profile_status: str  # "incomplete" | "pending_verification" | "verified" | "rejected"
    declared_skill_level: Optional[str] = None
    declared_zone: Optional[str] = None
    id_proof_type: Optional[str] = "none"
    id_proof_number: Optional[str] = None
    verified_skill_level: Optional[str] = None
    verified_by: Optional[int] = None
    verified_at: Optional[datetime] = None
    # PROFILE-EXPANSION: personal
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None
    name_as_per_aadhaar: Optional[str] = None
    email: Optional[str] = None
    gender: Optional[str] = None
    profile_image_url: Optional[str] = None
    # PROFILE-EXPANSION: business
    business_name: Optional[str] = None
    brand_name: Optional[str] = None
    establishment_type: Optional[str] = None
    pan_number: Optional[str] = None
    aadhaar_number: Optional[str] = None  # masked by the router before this leaves the backend
    gst_registered: Optional[bool] = None
    gst_number: Optional[str] = None
    enrollment_number: Optional[str] = None
    business_address_line: Optional[str] = None
    pincode: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    business_state_code: Optional[str] = None
    ondc_std_code: Optional[str] = None
    location_type: Optional[str] = None
    pickup_days: Optional[List[str]] = None
    # PROFILE-EXPANSION: bank
    account_holder_name: Optional[str] = None
    account_number: Optional[str] = None  # masked by the router before this leaves the backend
    ifsc_code: Optional[str] = None
    bank_name: Optional[str] = None
```

And update the pydantic import line at the top of the file:
```python
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
```

### A4. `backend/app/routers/profile.py` — masking helper + 3 new endpoints

**Design decision, different from the original master prompt:** don't bolt these fields onto the existing `POST /profile/artisan` handler. That endpoint always sets `profile_status = "pending_verification"` — it's specifically the skill/ID verification submission. Editing a bank account number should never silently flip an artisan's verification status back to pending. Three separate endpoints, none of which touch `profile_status`.

Full patched file:

```python
# backend/app/routers/profile.py
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas, auth

router = APIRouter(prefix="/profile", tags=["Profile"])


def _mask_tail(value: Optional[str], visible: int = 4) -> Optional[str]:
    """Mask all but the last `visible` characters, e.g. Aadhaar/account numbers."""
    if not value:
        return value
    if len(value) <= visible:
        return "*" * len(value)
    return "*" * (len(value) - visible) + value[-visible:]


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
        # PROFILE-EXPANSION: personal
        first_name=user.first_name,
        middle_name=user.middle_name,
        last_name=user.last_name,
        name_as_per_aadhaar=user.name_as_per_aadhaar,
        email=user.email,
        gender=user.gender,
        profile_image_url=user.profile_image_url,
        # PROFILE-EXPANSION: business
        business_name=user.business_name,
        brand_name=user.brand_name,
        establishment_type=user.establishment_type,
        pan_number=user.pan_number,
        aadhaar_number=_mask_tail(user.aadhaar_number),
        gst_registered=user.gst_registered,
        gst_number=user.gst_number,
        enrollment_number=user.enrollment_number,
        business_address_line=user.business_address_line,
        pincode=user.pincode,
        district=user.district,
        city=user.city,
        business_state_code=user.business_state_code,
        ondc_std_code=user.ondc_std_code,
        location_type=user.location_type,
        pickup_days=user.pickup_days,
        # PROFILE-EXPANSION: bank
        account_holder_name=user.account_holder_name,
        account_number=_mask_tail(user.account_number),
        ifsc_code=user.ifsc_code,
        bank_name=user.bank_name,
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


@router.post("/artisan/personal", response_model=schemas.ArtisanProfileResponse)
def submit_personal_details(
    payload: schemas.PersonalDetailsUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Partial update of personal details (name, email, gender, profile image).
    Does NOT touch profile_status — that transition belongs exclusively to
    submit_artisan_profile()'s skill/ID verification flow above.
    """
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return format_profile_response(current_user)


@router.post("/artisan/business", response_model=schemas.ArtisanProfileResponse)
def submit_business_details(
    payload: schemas.BusinessDetailsUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Partial update of business/KYC details. Does NOT touch profile_status."""
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return format_profile_response(current_user)


@router.post("/artisan/bank", response_model=schemas.ArtisanProfileResponse)
def submit_bank_details(
    payload: schemas.BankDetailsUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Partial update of bank details. Does NOT touch profile_status."""
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
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
```

---

## PART B — Frontend

### B1. New file: `frontend/src/constants/states.ts`

```ts
// src/constants/states.ts
// Full list of Indian states + union territories. KA/UP/WB carry real zone
// data (matches backend/app/data/wage_rates.json); every other entry uses a
// single 'statewide' placeholder zone until real wage-notification data is
// sourced for it — DO NOT invent zone/wage numbers here, see wage_rates.json
// for why.

export interface StateZone {
  code: string;
  name: string;
  note: string;
}

export interface SupportedState {
  code: string;
  name: string;
  note: string;
  zones: StateZone[];
}

// NOTE on ambiguous codes — confirm the final pick with the team before this
// is treated as locked, it must exactly match whatever key convention
// wage_rates.json eventually uses (case-sensitive):
//   Chhattisgarh: using 'CG' (common usage) vs ISO 'CT'
//   Telangana:    using 'TG' vs common 'TS'
//   Uttarakhand:  using 'UK' vs ISO 'UT'
//   Odisha:       using 'OD' (current official) vs older 'OR'
export const SUPPORTED_STATES: SupportedState[] = [
  {
    code: 'KA',
    name: 'Karnataka',
    note: 'Zones 1–4',
    zones: [
      { code: 'zone_1', name: 'Zone 1', note: 'Bengaluru (BBMP) & Agglomeration Areas' },
      { code: 'zone_2', name: 'Zone 2', note: 'Other Municipal Corporations (Mysore, Mangalore, Hubballi, etc.)' },
      { code: 'zone_3', name: 'Zone 3', note: 'District Headquarters' },
      { code: 'zone_4', name: 'Zone 4', note: 'Rural & all other parts of Karnataka' },
    ],
  },
  {
    code: 'UP',
    name: 'Uttar Pradesh',
    note: 'Statewide Unified Schedule',
    zones: [
      { code: 'statewide', name: 'Statewide', note: 'Unified schedule (Varanasi, Lucknow, etc.)' },
    ],
  },
  {
    code: 'WB',
    name: 'West Bengal',
    note: 'Zones A & B',
    zones: [
      { code: 'zone_a', name: 'Zone A', note: 'Kolkata, Municipalities & Notified Areas' },
      { code: 'zone_b', name: 'Zone B', note: 'Rural & rest of West Bengal (Shantiniketan, etc.)' },
    ],
  },
  { code: 'AP', name: 'Andhra Pradesh', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'AR', name: 'Arunachal Pradesh', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'AS', name: 'Assam', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'BR', name: 'Bihar', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'CG', name: 'Chhattisgarh', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'GA', name: 'Goa', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'GJ', name: 'Gujarat', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'HR', name: 'Haryana', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'HP', name: 'Himachal Pradesh', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'JH', name: 'Jharkhand', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'KL', name: 'Kerala', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'MP', name: 'Madhya Pradesh', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'MH', name: 'Maharashtra', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'MN', name: 'Manipur', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'ML', name: 'Meghalaya', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'MZ', name: 'Mizoram', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'NL', name: 'Nagaland', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'OD', name: 'Odisha', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'PB', name: 'Punjab', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'RJ', name: 'Rajasthan', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'SK', name: 'Sikkim', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'TN', name: 'Tamil Nadu', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'TG', name: 'Telangana', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'TR', name: 'Tripura', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'UK', name: 'Uttarakhand', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  // --- Union Territories ---
  { code: 'AN', name: 'Andaman and Nicobar Islands', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'CH', name: 'Chandigarh', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'DN', name: 'Dadra and Nagar Haveli and Daman and Diu', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'DL', name: 'Delhi (NCT)', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'JK', name: 'Jammu and Kashmir', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'LA', name: 'Ladakh', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'LD', name: 'Lakshadweep', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
  { code: 'PY', name: 'Puducherry', note: 'Zone data pending', zones: [{ code: 'statewide', name: 'Statewide', note: 'Wage data not yet sourced' }] },
];
```

### B2. `frontend/src/store/draftStore.ts` — re-export instead of inline array

Full patched file:

```ts
// src/store/draftStore.ts
import { create } from 'zustand';
import { SUPPORTED_STATES, type SupportedState, type StateZone } from '../constants/states';

export type SkillLevel = 'unskilled' | 'semi_skilled' | 'skilled' | 'highly_skilled';

export interface SkillDeclaration {
  skillLevelSelfDeclared: SkillLevel;
  hasArtisanCard: boolean;
  source: 'self_declared' | 'technique_floor' | 'artisan_card_elevation' | 'coordinator_verified';
  zone?: string;
  stateCode?: string;
}

export type { StateZone, SupportedState };

// Kept as PILOT_STATES for backward compatibility — 8 existing files import
// this name (ArtisanProfileScreen, SkillTierEditModal, LiveListingsScreen,
// InReviewListingsScreen, MyListingsScreen, ArtisanExperienceScreen). Full
// list now lives in constants/states.ts.
export const PILOT_STATES: SupportedState[] = SUPPORTED_STATES;

interface DraftState {
  activeDraftId: string | null;
  skillDeclaration: SkillDeclaration | null;
  selectedState: string;
  selectedZone: string;
  setActiveDraft: (id: string) => void;
  clearDraft: () => void;
  setSkillDeclaration: (declaration: SkillDeclaration) => void;
  setSelectedState: (stateCode: string, zoneCode?: string) => void;
  setSelectedZone: (zoneCode: string) => void;
}

// Persists the local draftId from the first capture so later actions safely attach to it.
export const useDraftStore = create<DraftState>((set) => ({
  activeDraftId: null,
  skillDeclaration: null,
  selectedState: 'KA',
  selectedZone: 'zone_1',
  setActiveDraft: (id) => set({ activeDraftId: id }),
  clearDraft: () => set({ activeDraftId: null, skillDeclaration: null }),
  setSkillDeclaration: (declaration) => set({ skillDeclaration: declaration }),
  setSelectedState: (stateCode, zoneCode) => {
    const upper = stateCode.toUpperCase();
    const st = PILOT_STATES.find((s) => s.code === upper);
    const defaultZone = zoneCode || st?.zones[0]?.code || 'zone_1';
    set({ selectedState: upper, selectedZone: defaultZone });
  },
  setSelectedZone: (zoneCode) => set({ selectedZone: zoneCode }),
}));
```

### B3. `frontend/src/types/contracts.ts` — extend `ArtisanProfile`, add request types, extend `ListingService`

Replace the existing `ArtisanProfile` interface with:
```ts
export interface ArtisanProfile {
  user_id: number;
  username: string;
  phone_number: string | null;
  role: string;
  profile_status: ProfileStatus;
  declared_skill_level: string | null;
  declared_zone: string | null;
  id_proof_type: IdProofType;
  id_proof_number: string | null;
  verified_skill_level: string | null;
  verified_by: number | null;
  verified_at: string | null;
  // PROFILE-EXPANSION: personal
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  name_as_per_aadhaar?: string | null;
  email?: string | null;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null;
  profile_image_url?: string | null;
  // PROFILE-EXPANSION: business
  business_name?: string | null;
  brand_name?: string | null;
  establishment_type?: 'individual' | 'proprietorship' | 'partnership' | 'llp' | 'pvt_ltd' | 'public_ltd' | 'huf' | 'trust' | 'society' | null;
  pan_number?: string | null;
  aadhaar_number?: string | null; // masked by backend, e.g. "XXXXXXXX1234"
  gst_registered?: boolean | null;
  gst_number?: string | null;
  enrollment_number?: string | null;
  business_address_line?: string | null;
  pincode?: string | null;
  district?: string | null;
  city?: string | null;
  business_state_code?: string | null;
  ondc_std_code?: string | null;
  location_type?: 'warehouse' | 'shop' | 'office' | 'home' | null;
  pickup_days?: string[] | null;
  // PROFILE-EXPANSION: bank
  account_holder_name?: string | null;
  account_number?: string | null; // masked by backend
  ifsc_code?: string | null;
  bank_name?: string | null;
}

export interface PersonalDetailsUpdate {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  name_as_per_aadhaar?: string;
  email?: string;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  profile_image_url?: string;
}

export interface BusinessDetailsUpdate {
  business_name?: string;
  brand_name?: string;
  establishment_type?: 'individual' | 'proprietorship' | 'partnership' | 'llp' | 'pvt_ltd' | 'public_ltd' | 'huf' | 'trust' | 'society';
  pan_number?: string;
  aadhaar_number?: string;
  gst_registered?: boolean;
  gst_number?: string;
  enrollment_number?: string;
  business_address_line?: string;
  pincode?: string;
  district?: string;
  city?: string;
  business_state_code?: string;
  ondc_std_code?: string;
  location_type?: 'warehouse' | 'shop' | 'office' | 'home';
  pickup_days?: string[];
}

export interface BankDetailsUpdate {
  account_holder_name?: string;
  account_number?: string;
  ifsc_code?: string;
  bank_name?: string;
}
```

In `ListingService`, insert right after the existing `submitArtisanProfile` line:
```ts
  submitPersonalDetails(payload: PersonalDetailsUpdate): Promise<ArtisanProfile>;
  submitBusinessDetails(payload: BusinessDetailsUpdate): Promise<ArtisanProfile>;
  submitBankDetails(payload: BankDetailsUpdate): Promise<ArtisanProfile>;
```

### B4. `frontend/src/services/api.ts` — 3 new methods

Add `PersonalDetailsUpdate`, `BusinessDetailsUpdate`, `BankDetailsUpdate` to the existing import block from `'../types/contracts'`, then insert right after the existing `submitArtisanProfile` method:
```ts
  submitPersonalDetails: async (payload: PersonalDetailsUpdate): Promise<ArtisanProfile> => {
    const res = await api.post('/profile/artisan/personal', payload);
    return res.data;
  },

  submitBusinessDetails: async (payload: BusinessDetailsUpdate): Promise<ArtisanProfile> => {
    const res = await api.post('/profile/artisan/business', payload);
    return res.data;
  },

  submitBankDetails: async (payload: BankDetailsUpdate): Promise<ArtisanProfile> => {
    const res = await api.post('/profile/artisan/bank', payload);
    return res.data;
  },
```

### B5. `frontend/src/services/mockApi.ts` — mock data + 3 mock methods

Replace the existing `mockCurrentProfile` declaration with:
```ts
let mockCurrentProfile: ArtisanProfile = {
  user_id: 1,
  username: 'artisan_demo',
  phone_number: '9876543210',
  role: 'artisan',
  profile_status: 'incomplete',
  declared_skill_level: null,
  declared_zone: null,
  id_proof_type: 'none',
  id_proof_number: null,
  verified_skill_level: null,
  verified_by: null,
  verified_at: null,
  // PROFILE-EXPANSION
  first_name: null,
  middle_name: null,
  last_name: null,
  name_as_per_aadhaar: null,
  email: null,
  gender: null,
  profile_image_url: null,
  business_name: null,
  brand_name: null,
  establishment_type: null,
  pan_number: null,
  aadhaar_number: null,
  gst_registered: false,
  gst_number: null,
  enrollment_number: null,
  business_address_line: null,
  pincode: null,
  district: null,
  city: null,
  business_state_code: null,
  ondc_std_code: null,
  location_type: null,
  pickup_days: null,
  account_holder_name: null,
  account_number: null,
  ifsc_code: null,
  bank_name: null,
};
```

Insert right after the existing `submitArtisanProfile` block (before `getPendingArtisanProfiles`):
```ts
  submitPersonalDetails: async (payload: PersonalDetailsUpdate): Promise<ArtisanProfile> => {
    mockCurrentProfile = { ...mockCurrentProfile, ...payload };
    return { ...mockCurrentProfile };
  },

  submitBusinessDetails: async (payload: BusinessDetailsUpdate): Promise<ArtisanProfile> => {
    mockCurrentProfile = { ...mockCurrentProfile, ...payload };
    return { ...mockCurrentProfile };
  },

  submitBankDetails: async (payload: BankDetailsUpdate): Promise<ArtisanProfile> => {
    mockCurrentProfile = { ...mockCurrentProfile, ...payload };
    return { ...mockCurrentProfile };
  },
```
(Add the same 3 types to the existing import block from `'../types/contracts'` at the top of the file.)

### B6. New file: `frontend/src/services/pincodeLookup.ts`

```ts
// src/services/pincodeLookup.ts
// Public pincode -> district/city/state lookup. No auth, no secret exposure.
// Never blocks the form — on any failure, the artisan just types manually.

export interface PincodeResult {
  district: string;
  city: string;
  state: string;
}

export async function lookupPincode(pincode: string): Promise<PincodeResult | null> {
  if (!/^\d{6}$/.test(pincode)) return null;

  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
    const data = await res.json();
    const record = data?.[0];
    if (record?.Status !== 'Success' || !record.PostOffice?.length) return null;

    const office = record.PostOffice[0];
    return {
      district: office.District ?? '',
      city: office.Block ?? office.District ?? '',
      state: office.State ?? '',
    };
  } catch {
    return null;
  }
}
```

### B7. Exemplar card + modal — `BusinessDetailsCard.tsx` / `BusinessDetailsEditModal.tsx`

Matches `LocationCard.tsx` / `SkillTierEditModal.tsx` structure exactly. Given as the pattern to replicate for `PersonalDetailsCard`/`Modal` and `BankDetailsCard`/`Modal` — say the word and I'll generate those two the same way; skipping them here to keep this delivery to the load-bearing pieces.

`frontend/src/features/profile/BusinessDetailsCard.tsx` (new file):
```tsx
// src/features/profile/BusinessDetailsCard.tsx
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '../../theme';

interface BusinessDetailsCardProps {
  businessName: string | null;
  cityState: string | null;
  isConfigured: boolean;
  onPress: () => void;
}

export const BusinessDetailsCard: React.FC<BusinessDetailsCardProps> = ({
  businessName,
  cityState,
  isConfigured,
  onPress,
}) => {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Business details: ${businessName || 'not set'}. Tap to edit.`}
    >
      <View style={styles.iconSquare}>
        <MaterialCommunityIcons name="briefcase-outline" size={22} color={colors.primary} />
      </View>
      <View style={styles.textStack}>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {businessName || 'Business details'}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
          {cityState || (isConfigured ? 'Configured' : 'Tap to add PAN, GST, address')}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  iconSquare: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FAF5F2',
    borderWidth: 1,
    borderColor: '#F3E5E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textStack: {
    flex: 1,
    marginHorizontal: spacing.sm + 4,
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.1,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
    marginTop: 2,
  },
});
```

`frontend/src/features/profile/BusinessDetailsEditModal.tsx` (new file — trimmed to the essential structure; doesn't replicate every cosmetic flourish of the 1000+ line `SkillTierEditModal.tsx`, but follows the same skeleton: transparent status-bar-safe Modal, ScrollView, inline validation message, sticky submit button):

```tsx
// src/features/profile/BusinessDetailsEditModal.tsx
import React, { useState } from 'react';
import { View, StyleSheet, Modal, ScrollView, Platform, StatusBar } from 'react-native';
import { Text, Button, TextInput, SegmentedButtons, Switch } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '../../theme';
import { PILOT_STATES } from '../../store/draftStore';
import { lookupPincode } from '../../services/pincodeLookup';
import type { ArtisanProfile, BusinessDetailsUpdate } from '../../types/contracts';

interface Props {
  visible: boolean;
  profile: ArtisanProfile | null;
  submitting: boolean;
  onSubmit: (payload: BusinessDetailsUpdate) => Promise<void>;
  onDismiss: () => void;
}

const ESTABLISHMENT_TYPES = [
  { value: 'individual', label: 'Individual' },
  { value: 'proprietorship', label: 'Proprietorship' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'llp', label: 'LLP' },
  { value: 'pvt_ltd', label: 'Pvt Ltd' },
];

export const BusinessDetailsEditModal: React.FC<Props> = ({ visible, profile, submitting, onSubmit, onDismiss }) => {
  const insets = useSafeAreaInsets();
  const [businessName, setBusinessName] = useState(profile?.business_name ?? '');
  const [brandName, setBrandName] = useState(profile?.brand_name ?? '');
  const [establishmentType, setEstablishmentType] = useState(profile?.establishment_type ?? 'individual');
  const [panNumber, setPanNumber] = useState(profile?.pan_number ?? '');
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [gstRegistered, setGstRegistered] = useState(profile?.gst_registered ?? false);
  const [gstNumber, setGstNumber] = useState(profile?.gst_number ?? '');
  const [enrollmentNumber, setEnrollmentNumber] = useState(profile?.enrollment_number ?? '');
  const [addressLine, setAddressLine] = useState(profile?.business_address_line ?? '');
  const [pincode, setPincode] = useState(profile?.pincode ?? '');
  const [district, setDistrict] = useState(profile?.district ?? '');
  const [city, setCity] = useState(profile?.city ?? '');
  const [stateCode, setStateCode] = useState(profile?.business_state_code ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pincodeChecking, setPincodeChecking] = useState(false);

  const handlePincodeChange = async (value: string) => {
    setPincode(value);
    if (value.length === 6) {
      setPincodeChecking(true);
      const result = await lookupPincode(value);
      setPincodeChecking(false);
      if (result) {
        setDistrict(result.district);
        setCity(result.city);
        const match = PILOT_STATES.find((s) => s.name.toLowerCase() === result.state.toLowerCase());
        if (match) setStateCode(match.code);
      }
      // No match found -> leave fields as-is, artisan fills manually. Never block.
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (!businessName.trim()) return setError('Business name is required.');
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber.toUpperCase())) return setError('Enter a valid PAN (e.g. ABCDE1234F).');
    if (gstRegistered && !gstNumber.trim()) return setError('Enter your GST number.');
    if (!gstRegistered && !enrollmentNumber.trim()) return setError('Enter your enrollment number.');
    if (pincode && !/^\d{6}$/.test(pincode)) return setError('Pincode must be 6 digits.');

    try {
      await onSubmit({
        business_name: businessName.trim(),
        brand_name: brandName.trim() || undefined,
        establishment_type: establishmentType as BusinessDetailsUpdate['establishment_type'],
        pan_number: panNumber.toUpperCase(),
        ...(aadhaarNumber ? { aadhaar_number: aadhaarNumber } : {}),
        gst_registered: gstRegistered,
        gst_number: gstRegistered ? gstNumber.toUpperCase() : undefined,
        enrollment_number: !gstRegistered ? enrollmentNumber : undefined,
        business_address_line: addressLine.trim(),
        pincode,
        district,
        city,
        business_state_code: stateCode,
      });
    } catch (err: any) {
      setError(err?.response?.data?.detail?.[0]?.msg || err?.message || 'Could not save business details.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingTop: Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24) }]}>
          <View style={styles.dragHandle} />
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Text style={styles.heading}>Business details</Text>

            <TextInput label="Business name" value={businessName} onChangeText={setBusinessName} mode="outlined" style={styles.input} />
            <TextInput label="Brand / store name (optional)" value={brandName} onChangeText={setBrandName} mode="outlined" style={styles.input} />

            <Text style={styles.sectionLabel}>Establishment type</Text>
            <SegmentedButtons value={establishmentType} onValueChange={setEstablishmentType} buttons={ESTABLISHMENT_TYPES} style={styles.input} />

            <TextInput label="PAN number" value={panNumber} onChangeText={(v) => setPanNumber(v.toUpperCase())} mode="outlined" autoCapitalize="characters" maxLength={10} style={styles.input} />
            <TextInput
              label={profile?.aadhaar_number ? `Aadhaar (on file: ${profile.aadhaar_number})` : 'Aadhaar number'}
              value={aadhaarNumber}
              onChangeText={setAadhaarNumber}
              mode="outlined"
              keyboardType="number-pad"
              maxLength={12}
              placeholder="Leave blank to keep existing"
              style={styles.input}
            />

            <View style={styles.switchRow}>
              <Text style={styles.sectionLabel}>Registered for GST?</Text>
              <Switch value={gstRegistered} onValueChange={setGstRegistered} color={colors.primary} />
            </View>
            {gstRegistered ? (
              <TextInput label="GST number" value={gstNumber} onChangeText={(v) => setGstNumber(v.toUpperCase())} mode="outlined" autoCapitalize="characters" style={styles.input} />
            ) : (
              <TextInput label="Enrollment number" value={enrollmentNumber} onChangeText={setEnrollmentNumber} mode="outlined" style={styles.input} />
            )}

            <TextInput label="Business address" value={addressLine} onChangeText={setAddressLine} mode="outlined" multiline style={styles.input} />
            <TextInput
              label="Pincode"
              value={pincode}
              onChangeText={handlePincodeChange}
              mode="outlined"
              keyboardType="number-pad"
              maxLength={6}
              right={pincodeChecking ? <TextInput.Icon icon="loading" /> : undefined}
              style={styles.input}
            />
            <TextInput label="District" value={district} onChangeText={setDistrict} mode="outlined" style={styles.input} />
            <TextInput label="City" value={city} onChangeText={setCity} mode="outlined" style={styles.input} />
            <TextInput label="State" value={PILOT_STATES.find((s) => s.code === stateCode)?.name ?? stateCode} mode="outlined" editable={false} style={styles.input} />

            {error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <Button mode="outlined" onPress={onDismiss} style={styles.footerButton} disabled={submitting}>
              Cancel
            </Button>
            <Button mode="contained" onPress={handleSubmit} style={styles.footerButton} loading={submitting} disabled={submitting} buttonColor={colors.primary}>
              Save
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.xs },
  footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  footerButton: { flex: 1 },
});
```

Wire into `ArtisanProfileScreen.tsx`: add state for `businessModalVisible`/`bankModalVisible`, render `<BusinessDetailsCard onPress={() => setBusinessModalVisible(true)} .../>` below the existing `<LocationCard .../>`, and mount `<BusinessDetailsEditModal visible={businessModalVisible} profile={profile} submitting={submitting} onSubmit={async (p) => { const updated = await service.submitBusinessDetails(p); setProfile(updated); setBusinessModalVisible(false); }} onDismiss={() => setBusinessModalVisible(false)} />` — same pattern as the existing `SkillTierEditModal` wiring already in that file.

---

## Not included here — same pattern, ask if you want them generated

- `PersonalDetailsCard.tsx` / `PersonalDetailsEditModal.tsx` — identical skeleton to B7, fewer/simpler fields, no pincode lookup.
- `BankDetailsCard.tsx` / `BankDetailsEditModal.tsx` — identical skeleton, 4 fields, IFSC regex instead of PAN/GST.
- i18n keys for `en.json`/`hi.json`/`kn.json` — this codebase keeps all static UI text in `src/i18n/locales/*.json` (react-i18next), and the exemplar above uses hardcoded English strings for brevity. Before merging, move those strings into `en.json` under a `businessDetailsModal.*` namespace matching the existing `skillTierModal.*` convention, and get `hi.json`/`kn.json` translations reviewed by someone who reads those scripts — I won't guess at Hindi/Kannada legal-form terminology (PAN, GST, establishment type) for a live artisan-facing app without that check.
- Alembic/migration file — this repo has no migration tool (confirmed, no `alembic/` directory), it self-heals schema via the `ensure_user_schema_columns()` function above, run at every startup. Nothing further needed.
