# backend/app/models.py
from datetime import datetime, timezone
import uuid
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Text,
    DateTime,
    Boolean,
    ForeignKey,
)
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="artisan", nullable=False)  # 'artisan' | 'coordinator' | 'admin'
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    products = relationship("Product", back_populates="owner")
    listings = relationship("ListingModel", back_populates="artisan")

class Product(Base):
    __tablename__ = "products"

    product_id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    price = Column(Float, nullable=False)
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)

    owner = relationship("User", back_populates="products")
    images = relationship("Image", back_populates="product", cascade="all, delete-orphan")

class Image(Base):
    __tablename__ = "images"

    image_id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.product_id"), nullable=False)
    storage_path = Column(String, nullable=False)
    url = Column(String, nullable=False)

    product = relationship("Product", back_populates="images")

class ListingModel(Base):
    __tablename__ = "listings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    artisan_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    state = Column(String, default="draft", nullable=False)
    # Valid states: 'draft', 'processing', 'awaiting_confirmation', 'awaiting_approval',
    # 'approved', 'export_queued', 'exported', 'rejected', 'failed'
    preferred_language = Column(String, default="en", nullable=False)
    # The coordinator's reason the last time the listing was sent back, for the artisan.
    rejection_reason = Column(Text, nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    artisan = relationship("User", back_populates="listings")
    media = relationship("MediaAssetModel", back_populates="listing", cascade="all, delete-orphan")
    catalogue = relationship("CatalogueModel", back_populates="listing", uselist=False, cascade="all, delete-orphan")
    price = relationship("PriceCalculationModel", back_populates="listing", uselist=False, cascade="all, delete-orphan")
    claims = relationship("ClaimModel", back_populates="listing", cascade="all, delete-orphan")
    jobs = relationship("JobModel", back_populates="listing", cascade="all, delete-orphan")
    exports = relationship("ExportRecordModel", back_populates="listing", cascade="all, delete-orphan")
    public_photos = relationship("PublicPhotoModel", back_populates="listing", cascade="all, delete-orphan")

class MediaAssetModel(Base):
    __tablename__ = "media_assets"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    listing_id = Column(String, ForeignKey("listings.id"), nullable=False)
    kind = Column(String, nullable=False)  # 'image' | 'audio'
    variant = Column(String, default="original", nullable=False)  # 'original' | 'enhanced'
    status = Column(String, default="pending", nullable=False)  # 'pending' | 'processing' | 'complete' | 'failed'
    url = Column(String, nullable=True)
    storage_path = Column(String, nullable=True)
    checksum = Column(String, nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    listing = relationship("ListingModel", back_populates="media")

class PublicPhotoModel(Base):
    """A buyer-facing copy of one photo, which exists only while its listing is approved.
    See app/public_media.py."""
    __tablename__ = "public_photos"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    listing_id = Column(String, ForeignKey("listings.id"), nullable=False)
    source_media_id = Column(String, ForeignKey("media_assets.id"), nullable=False)
    storage_backend = Column(String, nullable=False)  # 'local' | 'supabase'
    storage_path = Column(String, nullable=False)
    url = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    listing = relationship("ListingModel", back_populates="public_photos")

class CatalogueModel(Base):
    __tablename__ = "catalogues"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    listing_id = Column(String, ForeignKey("listings.id"), unique=True, nullable=False)
    schema_version = Column(String, default="1.0", nullable=False)
    catalogue_data = Column(Text, nullable=False)  # JSON string
    field_confidence = Column(Text, nullable=False)  # JSON string
    needs_confirmation = Column(Text, nullable=False)  # JSON array string
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    listing = relationship("ListingModel", back_populates="catalogue")

class PriceCalculationModel(Base):
    __tablename__ = "price_calculations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    listing_id = Column(String, ForeignKey("listings.id"), unique=True, nullable=False)
    calculation_version = Column(String, default="1.0", nullable=False)
    status = Column(String, default="available", nullable=False)  # 'available' | 'unavailable'
    currency = Column(String, default="INR", nullable=False)
    state_code = Column(String, nullable=True)
    notification_ref = Column(String, nullable=True)
    effective_from = Column(String, nullable=True)
    source_url = Column(String, nullable=True)
    material_cost_paise = Column(Integer, default=0, nullable=False)
    labour_hours = Column(Float, default=0.0, nullable=False)
    hourly_wage_paise = Column(Integer, default=0, nullable=False)
    skill_level = Column(String, default="skilled", nullable=False)
    floor_amount_paise = Column(Integer, default=0, nullable=False)
    recommended_low_paise = Column(Integer, default=0, nullable=False)
    recommended_high_paise = Column(Integer, default=0, nullable=False)
    explanation = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    listing = relationship("ListingModel", back_populates="price")

class ClaimModel(Base):
    __tablename__ = "claims"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    listing_id = Column(String, ForeignKey("listings.id"), nullable=False)
    claim = Column(String, nullable=False)
    asserted_by_artisan = Column(Boolean, default=True, nullable=False)
    coordinator_verified = Column(Boolean, default=False, nullable=False)
    evidence_note = Column(Text, nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    # A rejected claim is kept, with the coordinator's reason, so it cannot be re-asserted
    # unseen. Readers that feed buyers or approval use `export.live_claims`.
    rejection_reason = Column(Text, nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)

    listing = relationship("ListingModel", back_populates="claims")

class JobModel(Base):
    __tablename__ = "jobs"

    job_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    listing_id = Column(String, ForeignKey("listings.id"), nullable=False)
    type = Column(String, nullable=False)  # 'image_studio' | 'transcription' | 'catalogue_generation'
    status = Column(String, default="queued", nullable=False)  # 'queued' | 'processing' | 'complete' | 'failed'
    attempt = Column(Integer, default=1, nullable=False)
    result_data = Column(Text, nullable=True)  # JSON string
    error_data = Column(Text, nullable=True)  # JSON string
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    listing = relationship("ListingModel", back_populates="jobs")

class ExportRecordModel(Base):
    __tablename__ = "export_records"

    export_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    listing_id = Column(String, ForeignKey("listings.id"), nullable=False)
    target = Column(String, nullable=False)  # 'ondc' | 'gem' | 'tribes_india'
    status = Column(String, default="validated", nullable=False)  # 'validated' | 'submitted' | 'exported' | 'failed'
    payload_hash = Column(String, nullable=False)
    contract_validation = Column(Text, nullable=False)  # JSON string
    network_submission = Column(String, default="not_attempted", nullable=False)  # 'not_attempted' | 'pending' | 'success' | 'failed'
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    listing = relationship("ListingModel", back_populates="exports")
