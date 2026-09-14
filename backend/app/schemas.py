# backend/app/schemas.py
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

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
    email: str
    password: str
    role: Optional[str] = "artisan"  # 'artisan' | 'coordinator' | 'admin'

class UserLogin(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str = "artisan"
    user_id: int
    username: str

class UserResponse(BaseModel):
    user_id: int
    username: str
    email: str
    role: str

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
    # Set by the multipart upload endpoint; absent on the legacy JSON endpoint.
    kind: Optional[str] = None
    content_type: Optional[str] = None
    size_bytes: Optional[int] = None
    checksum: Optional[str] = None  # "sha256:<hex>" of the bytes the client sent
    deduplicated: bool = False  # true when this exact file was already on the listing

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
    claim: str
    asserted_by_artisan: bool = True
    coordinator_verified: bool = False
    evidence_note: Optional[str] = None

class MultilingualText(BaseModel):
    en: str
    local: Optional[str] = None
    local_language: str = "hi"

class MultilingualDesc(BaseModel):
    en: str
    local: Optional[str] = None

# None until the artisan states it. A generated catalogue does not estimate these.
class LabourInfo(BaseModel):
    hours: Optional[float] = None
    skill_level: Optional[str] = None
    state_code: Optional[str] = None

class ProvenanceInfo(BaseModel):
    claims: List[ClaimSchema] = []
    gi_tag: Optional[str] = None

class SourceInfo(BaseModel):
    transcript_id: str
    asr_confidence: Optional[float] = None  # None when the speech provider reports none
    # Who produced the transcript and the catalogue. "fixture" means fixed demo content.
    asr_provider: Optional[str] = None
    catalogue_provider: Optional[str] = None

class CatalogueDraft(BaseModel):
    listing_id: str
    category: str
    materials: List[str] = []
    techniques: List[str] = []
    finish: Optional[str] = None
    title: MultilingualText
    description: MultilingualDesc
    labour: LabourInfo
    material_cost_paise: Optional[int] = None
    provenance: ProvenanceInfo
    source: SourceInfo

class CatalogueResult(BaseModel):
    schema_version: str = "1.0"
    catalogue: CatalogueDraft
    field_confidence: Dict[str, float] = {}
    needs_confirmation: List[str] = []
    adapter: Optional[Dict[str, Any]] = None  # provider/model that generated it; "fixture" = demo

# --- Pricing Schemas ---
class WageSourceInfo(BaseModel):
    state_code: str
    notification_ref: str
    effective_from: str
    source_url: str

class PriceInputs(BaseModel):
    material_cost_paise: int
    labour_hours: float
    hourly_wage_paise: int
    skill_level: str

class PriceResult(BaseModel):
    # "2.0.0-deterministic" identifies the tested engine in app/ai/pricing/engine.py;
    # "1.0" is the legacy path. The version travels with every stored calculation so a
    # price can always be traced to the formula that produced it.
    calculation_version: str = "1.0"
    status: str = "available"  # 'available' | 'unavailable'
    currency: str = "INR"
    wage_source: Optional[WageSourceInfo] = None
    inputs: PriceInputs
    floor_amount_paise: int
    recommended_low_paise: int
    recommended_high_paise: int
    explanation: str

class PriceRequest(BaseModel):
    material_cost_paise: Optional[int] = None
    labour_hours: Optional[float] = None
    # No defaults: anything omitted is read from the confirmed catalogue, or the request is refused.
    skill_level: Optional[str] = None
    state_code: Optional[str] = None
    # Observed market prices for comparable pieces. They may lift the recommended band
    # and can never lower the floor -- that asymmetry is the anti-exploitation
    # guarantee, so this is an input the engine deliberately treats as one-directional.
    # Only honoured by the deterministic engine (CRAFTLINK_PRICE_ENGINE=deterministic).
    comparables_paise: Optional[List[int]] = None

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
    id: str
    artisan_id: str
    state: str
    preferred_language: str
    media: List[MediaAssetSchema] = []
    catalogue: Optional[CatalogueResult] = None
    price: Optional[PriceResult] = None
    claims: List[ClaimSchema] = []
    created_at: str
    updated_at: str

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