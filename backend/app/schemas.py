# backend/app/schemas.py
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict

# --- Legacy Product schemas for backwards compatibility ---
class ProductCreate(BaseModel):
    name: str
    description: Optional[str] = None
    price: float

# --- Error Schemas ---
class ApiErrorDetail(BaseModel):
    code: str
    message: str
    recoverable: bool = True
    action: str = ""

class ApiErrorResponse(BaseModel):
    request_id: str
    error: ApiErrorDetail

# --- Auth Schemas ---
class UserRegister(BaseModel):
    username: str
    password: str
    phone_number: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = "artisan"  # 'artisan' | 'coordinator' | 'admin'

class UserLogin(BaseModel):
    username: str  # Accepts either username or phone_number
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str = "artisan"
    user_id: int
    username: str
    phone_number: Optional[str] = None

class UserResponse(BaseModel):
    user_id: int
    username: str
    email: Optional[str] = None
    phone_number: Optional[str] = None
    role: str

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

# --- Media Schemas ---
class MediaAssetSchema(BaseModel):
    id: str
    kind: str  # 'image' | 'audio'
    variant: str = "original"  # 'original' | 'enhanced'
    status: str = "pending"  # 'pending' | 'processing' | 'complete' | 'failed'
    url: Optional[str] = None

class MediaUploadRequest(BaseModel):
    kind: str  # 'image' | 'audio'
    upload_token: Optional[str] = None
    client_checksum: Optional[str] = None
    url: Optional[str] = None

class MediaUploadResponse(BaseModel):
    status: str
    media_id: str
    url: Optional[str] = None

# --- AI Studio & Job Schemas ---
class ImageQualityMetrics(BaseModel):
    overall: str  # 'acceptable' | 'needs_review' | 'rejected'
    blur: str  # 'low' | 'medium' | 'high'
    lighting: str  # 'acceptable' | 'needs_correction' | 'poor'
    framing: str  # 'acceptable' | 'off_center' | 'cropped'
    guidance: List[str] = []

class ImageJobResult(BaseModel):
    job_id: str
    status: str  # 'complete' | 'failed'
    quality: ImageQualityMetrics
    original_url: str
    enhanced_media_id: str
    enhanced_url: str
    enhanced_urls: Optional[List[str]] = None
    transformations: List[str] = []
    human_review_required: bool = False

class JobStatus(BaseModel):
    job_id: str
    type: str  # 'image_studio' | 'transcription' | 'catalogue_generation'
    status: str  # 'queued' | 'processing' | 'complete' | 'failed'
    attempt: int = 1
    created_at: str
    updated_at: str

class ImageStudioRequest(BaseModel):
    media_id: str
    photos: Optional[List[str]] = None

class TranscriptionRequest(BaseModel):
    audio_media_id: str
    declared_language: str = "en"  # 'en' | 'hi' | 'kn'

# --- Catalogue & Claim Schemas ---
class ClaimSchema(BaseModel):
    model_config = ConfigDict(extra="allow")

    claim: str
    asserted_by_artisan: bool = True
    coordinator_verified: bool = False
    evidence_note: Optional[str] = None

class MultilingualText(BaseModel):
    model_config = ConfigDict(extra="allow")

    en: Optional[str] = ""
    local: Optional[str] = None
    local_language: Optional[str] = "hi"

class MultilingualDesc(BaseModel):
    model_config = ConfigDict(extra="allow")

    en: Optional[str] = ""
    local: Optional[str] = None

class LabourInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    hours: Optional[float] = 0.0
    skill_level: Optional[str] = "skilled"
    state_code: Optional[str] = "KA"

class ProvenanceInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    claims: List[ClaimSchema] = Field(default_factory=list)
    gi_tag: Optional[str] = None

class SourceInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    transcript_id: Optional[str] = None
    asr_confidence: Optional[float] = None
    asr_provider: Optional[str] = None
    catalogue_provider: Optional[str] = None

class MarketplaceInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    quantity_available: Optional[int] = None
    unit: Optional[str] = "piece"
    min_order_qty: Optional[int] = 1
    max_order_qty: Optional[int] = None
    cod_available: Optional[bool] = False
    returnable: Optional[bool] = False
    cancellable: Optional[bool] = False

class DimensionSet(BaseModel):
    model_config = ConfigDict(extra="allow")

    length_cm: Optional[float] = None
    width_cm: Optional[float] = None
    height_cm: Optional[float] = None
    weight_g: Optional[float] = None

class ProductDimensions(BaseModel):
    model_config = ConfigDict(extra="allow")

    product: Optional[DimensionSet] = None
    packaging: Optional[DimensionSet] = None

class CatalogueDraft(BaseModel):
    model_config = ConfigDict(extra="allow")

    listing_id: Optional[str] = None
    category: Optional[str] = None
    materials: List[str] = Field(default_factory=list)
    techniques: List[str] = Field(default_factory=list)
    title: Optional[MultilingualText] = None
    description: Optional[MultilingualDesc] = None
    labour: Optional[LabourInfo] = None
    material_cost_paise: Optional[int] = 0
    provenance: Optional[ProvenanceInfo] = None
    source: Optional[SourceInfo] = None
    marketplace: Optional[MarketplaceInfo] = None
    dimensions: Optional[ProductDimensions] = None

class CatalogueResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    schema_version: Optional[str] = "1.0"
    catalogue: Union[CatalogueDraft, Dict[str, Any]] = Field(default_factory=dict)
    field_confidence: Dict[str, Any] = Field(default_factory=dict)
    needs_confirmation: List[str] = Field(default_factory=list)

# --- Pricing Schemas ---
class WageSourceInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    state_code: Optional[str] = None
    notification_ref: Optional[str] = None
    effective_from: Optional[str] = None
    source_url: Optional[str] = None

class PriceInputs(BaseModel):
    model_config = ConfigDict(extra="allow")

    material_cost_paise: Optional[int] = 0
    labour_hours: Optional[float] = 0.0
    hourly_wage_paise: Optional[int] = 0
    skill_level: Optional[str] = "skilled"
    skill_level_self_declared: Optional[str] = None
    skill_level_source: Optional[str] = None
    zone: Optional[str] = None

class PriceResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    calculation_version: Optional[str] = "1.0"
    status: Optional[str] = "available"  # 'available' | 'unavailable'
    currency: Optional[str] = "INR"
    wage_source: Optional[WageSourceInfo] = None
    inputs: Optional[PriceInputs] = None
    floor_amount_paise: Optional[int] = 0
    recommended_low_paise: Optional[int] = 0
    recommended_high_paise: Optional[int] = 0
    explanation: Optional[str] = ""

class PriceRequest(BaseModel):
    material_cost_paise: Optional[int] = None
    labour_hours: Optional[float] = None
    skill_level: Optional[str] = "skilled"
    state_code: Optional[str] = "KA"

# --- Listing Schemas ---
class CreateListingRequest(BaseModel):
    preferred_language: str = "en"

class CreateListingResponse(BaseModel):
    id: str
    artisan_id: str
    state: str
    preferred_language: str
    upload_instructions: Optional[Dict[str, Any]] = None

class ListingResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    artisan_id: str
    state: str
    preferred_language: Optional[str] = "en"
    media: List[MediaAssetSchema] = Field(default_factory=list)
    catalogue: Optional[CatalogueResult] = None
    price: Optional[PriceResult] = None
    claims: List[ClaimSchema] = Field(default_factory=list)
    created_at: Optional[str] = ""
    updated_at: Optional[str] = ""

class ConfirmListingRequest(BaseModel):
    catalogue: Dict[str, Any]
    confirmed_fields: List[str] = []
    corrections: List[Dict[str, Any]] = []

class ClaimReviewRequest(BaseModel):
    decision: str  # 'verified' | 'rejected'
    evidence_note: Optional[str] = None
    reason: Optional[str] = None

class ListingDecisionRequest(BaseModel):
    decision: str  # 'approve' | 'reject'
    reason: Optional[str] = None

# --- Export Schemas ---
class ExportRequest(BaseModel):
    target: str = "ondc"
    schema_version: str = "1.0"
    simulate_network_submission: Optional[bool] = False

class ContractValidation(BaseModel):
    passed: bool
    schema_source: str

class ExportResult(BaseModel):
    export_id: str
    target: str
    status: str  # 'validated' | 'submitted' | 'exported' | 'failed'
    payload_hash: str
    contract_validation: ContractValidation
    network_submission: str  # 'not_attempted' | 'pending' | 'success' | 'failed'

# --- Support Schemas ---
class SupportMessageCreate(BaseModel):
    listing_id: Optional[str] = None
    message: str

class SupportMessageResponse(BaseModel):
    id: str
    artisan_id: int
    listing_id: Optional[str] = None
    message: str
    status: str
    created_at: str
    artisan_name: Optional[str] = None
    listing_title: Optional[str] = None