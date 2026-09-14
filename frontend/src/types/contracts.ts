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

// Standardized to integer paise
export interface PriceResult {
  calculation_version: string;
  status: 'available' | 'unavailable';
  currency: 'INR';
  wage_source?: {
    state_code: string;
    notification_ref: string;
    effective_from: string;
    source_url: string;
  };
  inputs: {
    material_cost_paise: number;
    labour_hours: number;
    hourly_wage_paise: number;
    skill_level: string;
  };
  floor_amount_paise: number;
  recommended_low_paise: number;
  recommended_high_paise: number;
  explanation: string;
}

// Strictly typed catalogue draft matching backend JSON contracts.
// Null means the artisan has not stated it yet. The backend never estimates these.
export interface CatalogueDraft {
  listing_id: string;
  category: string;
  materials: string[];
  techniques: string[];
  finish?: string | null;
  title: { en: string; local: string | null; local_language: string };
  description: { en: string; local: string | null };
  labour: { hours: number | null; skill_level: string | null; state_code: string | null };
  material_cost_paise: number | null;
  provenance: { claims: Claim[]; gi_tag: string | null };
  // *_provider: who produced it. 'fixture' means fixed demo content.
  source: {
    transcript_id: string;
    asr_confidence: number | null;
    asr_provider?: string | null;
    catalogue_provider?: string | null;
  };
}

export interface AdapterInfo {
  provider: string;
  model: string | null;
  version?: string | null;
  on_device?: boolean;
}

export interface CatalogueResult {
  schema_version: string;
  catalogue: CatalogueDraft;
  field_confidence: Record<string, number>;
  needs_confirmation: string[];
  adapter?: AdapterInfo | null;
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
// Studio grades per dimension are 'acceptable' | 'needs_correction' | 'unacceptable'.
// The legacy image job used other words, so these stay strings.
export interface ImageQualityMetrics {
  overall: string;
  blur: string;
  lighting: string;
  framing: string;
  guidance: string[];
}

// A failed job (e.g. MEDIA_QUALITY_INSUFFICIENT) has `error` and usually `quality`, but no enhanced photo.
export interface ImageJobResult {
  job_id: string;
  status: 'complete' | 'failed';
  quality?: ImageQualityMetrics;
  original_media_id?: string;
  original_url?: string;
  enhanced_media_id?: string;
  enhanced_url?: string;
  enhanced_urls?: string[];
  transformations?: string[];
  human_review_required?: boolean;
  photo_check?: { status: 'skipped' | 'complete' | 'unavailable'; issues?: string[] };
  adapter?: AdapterInfo;
  notice?: string;
  error?: ApiError['error'];
}

export interface JobStatus {
  job_id: string;
  type: 'image_studio' | 'transcription' | 'catalogue_generation';
  status: 'queued' | 'processing' | 'complete' | 'failed';
  attempt: number;
  created_at: string;
  updated_at: string;
}

// A file on the phone, as React Native's FormData expects it.
export interface LocalFile {
  uri: string;
  name: string;
  type: string;
}

export interface MediaUploadResult {
  status: string;
  media_id: string;
  url: string | null;
  kind?: 'image' | 'audio';
  content_type?: string;
  size_bytes?: number;
  checksum?: string;
  deduplicated: boolean;
}

// GET /jobs/{id}/result for a transcription job. A failed job carries `error` instead.
export interface TranscriptJobResult {
  job_id?: string;
  status?: 'complete' | 'failed';
  transcript_id?: string;
  detected_language?: string;
  original_text?: string;
  english_translation?: string | null;
  overall_confidence?: number | null;
  needs_replay?: boolean;
  adapter?: { provider: string; model: string | null; version: string | null; on_device: boolean };
  // Legacy backend path (CRAFTLINK_ASR=legacy).
  transcript?: string;
  translated_text?: string;
  notice?: string;
  error?: ApiError['error'];
}

export interface PriceRequest {
  material_cost_paise: number;
  labour_hours: number;
  skill_level: string;
  state_code: string;
  comparables_paise?: number[];
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

// --- 7. SERVICE INTERFACE ---
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
  uploadMedia(listingId: string, kind: 'image' | 'audio', file: LocalFile): Promise<MediaUploadResult>;
  getJobResult(jobId: string): Promise<TranscriptJobResult>;
  requestImageAnalysis(listingId: string, payload: { media_id: string; photos?: string[] }): Promise<{ job_id: string }>;
  requestTranscription(listingId: string, payload: { audio_media_id: string; declared_language: string }): Promise<{ job_id: string }>;
  getJobStatus(jobId: string): Promise<JobStatus>;
  getImageJobResult(jobId: string): Promise<ImageJobResult>;
  requestCatalogueGeneration(listingId: string, payload: any): Promise<CatalogueResult>;
  confirmListing(listingId: string, payload: { catalogue: any; confirmed_fields: string[]; corrections: { field: string; old_value: any; new_value: any; source: string }[] }): Promise<{ status: string; listing_id: string }>;
  requestPrice(listingId: string, payload: PriceRequest): Promise<PriceResult>;
  requestPrice_unavailable?(): Promise<PriceResult>;
  reviewClaim(listingId: string, claim: string, payload: { decision: string; evidence_note: string; reason: string | null }): Promise<{ claim: string; coordinator_verified: boolean; evidence_note: string }>;
  submitForApproval(listingId: string): Promise<{ status: string }>;
  decideApproval(listingId: string, payload: { decision: string; reason: string }): Promise<{ status: string; reason: string }>;
  requestExport(listingId: string, payload: { target: string; schema_version: string; simulate_network_submission?: boolean }): Promise<ExportResult>;
  login(role: UserRole): Promise<{ access_token: string; role: UserRole; user_id: string }>;
}