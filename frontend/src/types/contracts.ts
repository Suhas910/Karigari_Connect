// --- 1. ROLES & STATES ---
export type UserRole = 'artisan' | 'coordinator' | 'admin';

export type ListingState = 
  | 'draft' 
  | 'processing' 
  | 'awaiting_confirmation' 
  | 'awaiting_approval' 
  | 'approved' 
  | 'export_queued' 
  | 'exported' 
  | 'rejected' 
  | 'failed';

// --- 2. ERROR HANDLING ---
export type ErrorCode = 
  | 'MEDIA_QUALITY_INSUFFICIENT'
  | 'ASR_LOW_CONFIDENCE'
  | 'CATALOGUE_SCHEMA_INVALID'
  | 'PROVENANCE_VERIFICATION_REQUIRED'
  | 'WAGE_RATE_UNAVAILABLE'
  | 'LISTING_STATE_INVALID'
  | 'EXPORT_CONTRACT_INVALID'
  | 'PROVIDER_UNAVAILABLE';

export interface ApiError {
  request_id: string;
  error: {
    code: ErrorCode;
    message: string;
    recoverable: boolean;
    action: string;
  };
}

// --- 3. NETWORK HELPERS ---
// Every api.ts mutation function should wrap its body in this wrapper.
export interface IdempotentRequest<T> {
  idempotency_key: string;
  payload: T;
}

// --- 4. CORE ENTITIES ---
export interface MediaAsset {
  id: string;
  kind: 'image' | 'audio';
  variant: 'original' | 'enhanced';
  status: 'pending' | 'processing' | 'complete' | 'failed';
  url?: string; 
}

export interface Claim {
  claim: string;
  asserted_by_artisan: boolean;
  coordinator_verified: boolean;
  evidence_note: string | null;
}

export interface FallbackSuggestion {
  used_tier: string;
  hourly_wage_inr: number;
  note: string;
}

// Standardized to integer paise
export interface PriceResult {
  calculation_version: string;
  status: 'available' | 'unavailable';
  currency: 'INR';
  wage_source?: {
    state_code: string;
    zone?: string;
    notification_ref: string;
    effective_from: string;
    source_url: string;
  };
  inputs: {
    material_cost_paise: number;
    labour_hours: number;
    hourly_wage_paise: number;
    skill_level: string;
    skill_level_self_declared?: string;
    skill_level_source?: 'self_declared' | 'technique_floor' | 'artisan_card_elevation' | 'coordinator_verified';
    zone?: string;
    state_code?: string;
  };
  floor_amount_paise: number;
  recommended_low_paise: number;
  recommended_high_paise: number;
  explanation: string;
  error_code?: string;
  fallback_suggestion?: FallbackSuggestion;
}

export interface MarketplaceInfo {
  quantity_available: number;
  unit: 'piece' | 'pair' | 'set' | 'meter' | 'kg' | 'dozen';
  min_order_qty: number;
  max_order_qty: number | null;
  cod_available: boolean;
  returnable: boolean;
  cancellable: boolean;
}

export interface DimensionSet {
  length_cm: number;
  width_cm: number;
  height_cm: number;
  weight_g: number;
}

export interface ProductDimensions {
  product: DimensionSet;
  packaging: DimensionSet | null; // null = "ships without a box"
}

// Strictly typed catalogue draft matching backend JSON contracts
export interface CatalogueDraft {
  listing_id: string;
  category: string;
  materials: string[];
  techniques: string[];
  title: { en: string; local: string; local_language: string };
  description: { en: string; local: string };
  labour: { hours: number; skill_level: string; state_code: string };
  material_cost_paise: number;
  provenance: { claims: Claim[]; gi_tag: string | null };
  source: { transcript_id: string; asr_confidence: number };
  marketplace?: MarketplaceInfo;
  dimensions?: ProductDimensions;
}

export interface CatalogueResult {
  schema_version: string;
  catalogue: CatalogueDraft;
  field_confidence: Record<string, number>;
  needs_confirmation: string[];
}

export interface Listing {
  id: string;
  artisan_id: string;
  state: ListingState;
  preferred_language: string;
  media: MediaAsset[];
  catalogue: CatalogueResult | null; 
  price: PriceResult | null;
  claims: Claim[];
  created_at: string;
  updated_at: string;
}

// --- 5. JOB STATUS & AI STUDIO ---
export interface ImageQualityMetrics {
  overall: 'acceptable' | 'needs_review' | 'rejected';
  blur: 'low' | 'medium' | 'high';
  lighting: 'acceptable' | 'needs_correction' | 'poor';
  framing: 'acceptable' | 'off_center' | 'cropped';
  guidance: string[];
}

export interface ImageJobResult {
  job_id: string;
  status: 'complete' | 'failed';
  quality: ImageQualityMetrics;
  original_url: string;
  enhanced_media_id: string;
  enhanced_url: string;
  enhanced_urls?: string[];
  transformations: string[];
  human_review_required: boolean;
}

export interface JobStatus {
  job_id: string;
  type: 'image_studio' | 'transcription' | 'catalogue_generation';
  status: 'queued' | 'processing' | 'complete' | 'failed';
  attempt: number;
  created_at: string;
  updated_at: string;
}

// --- 6. EXPORT RESULT ---
export interface ExportResult {
  export_id: string;
  target: string;
  status: 'validated' | 'submitted' | 'exported' | 'failed';
  payload_hash: string;
  contract_validation: {
    passed: boolean;
    schema_source: string;
  };
  network_submission: 'not_attempted' | 'pending' | 'success' | 'failed';
}

// --- 7. ARTISAN PROFILE & VERIFICATION ---
export type ProfileStatus = 'incomplete' | 'pending_verification' | 'verified' | 'rejected';
export type IdProofType = 'pehchan_card' | 'pm_vishwakarma' | 'none';

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

export interface ArtisanProfileSubmitRequest {
  declared_skill_level: string;
  declared_zone: string;
  id_proof_type: IdProofType;
  id_proof_number?: string | null;
}

export interface ArtisanProfileReviewRequest {
  decision: 'verified' | 'rejected';
  verified_skill_level?: string | null;
  reason?: string | null;
}

// --- 8. SUPPORT MESSAGES ---
export interface SupportMessage {
  id: string;
  artisan_id: number;
  listing_id: string | null;
  message: string;
  status: 'open' | 'resolved' | 'closed';
  created_at: string;
  artisan_name?: string | null;
  listing_title?: string | null;
}

export interface SupportMessageSubmitRequest {
  listing_id?: string | null;
  message: string;
}

// --- 9. SERVICE INTERFACE ---
export interface ListingService {
  createListing(payload: { preferred_language: string }): Promise<{
    id: string;
    artisan_id: string;
    state: ListingState;
    preferred_language: string;
    upload_instructions?: any;
  }>;
  listListings(): Promise<Listing[]>;
  getListing(listingId: string): Promise<Listing>;
  completeMediaUpload(listingId: string, payload: { kind: string; upload_token: string; client_checksum: string }): Promise<{ status: string; media_id: string }>;
  requestImageAnalysis(listingId: string, payload: { media_id: string; photos?: string[] }): Promise<{ job_id: string }>;
  requestImageEnhancement(listingId: string, photoUris: string[]): Promise<{ job_id: string }>;
  requestTranscription(listingId: string, payload: { audio_media_id: string; declared_language: string }): Promise<{ job_id: string }>;
  getJobStatus(jobId: string): Promise<JobStatus>;
  getImageJobResult(jobId: string): Promise<ImageJobResult>;
  requestCatalogueGeneration(listingId: string, payload: any): Promise<CatalogueResult>;
  confirmListing(listingId: string, payload: { catalogue: any; confirmed_fields: string[]; corrections: { field: string; old_value: any; new_value: any; source: string }[] }): Promise<{ status: string; listing_id: string }>;
  requestPrice(listingId: string, payload: any): Promise<PriceResult>;
  requestPrice_unavailable?(): Promise<PriceResult>;
  reviewClaim(listingId: string, claim: string, payload: { decision: string; evidence_note: string; reason: string | null }): Promise<{ claim: string; coordinator_verified: boolean; evidence_note: string }>;
  submitForApproval(listingId: string): Promise<{ status: string }>;
  decideApproval(listingId: string, payload: { decision: string; reason: string }): Promise<{ status: string; reason: string }>;
  requestExport(listingId: string, payload: { target: string; schema_version: string; simulate_network_submission?: boolean }): Promise<ExportResult>;
  getArtisanProfile(userId?: number): Promise<ArtisanProfile>;
  submitArtisanProfile(payload: ArtisanProfileSubmitRequest): Promise<ArtisanProfile>;
  submitPersonalDetails(payload: PersonalDetailsUpdate): Promise<ArtisanProfile>;
  submitBusinessDetails(payload: BusinessDetailsUpdate): Promise<ArtisanProfile>;
  submitBankDetails(payload: BankDetailsUpdate): Promise<ArtisanProfile>;
  getPendingArtisanProfiles(): Promise<ArtisanProfile[]>;
  reviewArtisanProfile(userId: number, payload: ArtisanProfileReviewRequest): Promise<ArtisanProfile>;
  submitSupportMessage(payload: SupportMessageSubmitRequest): Promise<SupportMessage>;
  getSupportMessages(): Promise<SupportMessage[]>;
  submitVoiceFeedback?(audioUri?: string, note?: string): Promise<{ success: boolean; message: string }>;
  login(role: UserRole): Promise<{ access_token: string; role: UserRole; user_id: string }>;
  loginWithCredentials(identifier: string, password: string): Promise<{ access_token: string; role: UserRole; user_id: string }>;
  loginWithPassword?(identifier: string, password: string): Promise<{ access_token: string; role: UserRole; user_id: string }>;
  register(payload: { username: string; phone_number: string; password: string; role: UserRole }): Promise<{ access_token: string; role: UserRole; user_id: string }>;
}