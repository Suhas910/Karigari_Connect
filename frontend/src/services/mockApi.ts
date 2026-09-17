// src/services/mockApi.ts
import {
  Listing,
  JobStatus,
  CatalogueResult,
  PriceResult,
  ExportResult,
  ImageJobResult,
  ListingService,
  ListingState,
  UserRole,
  Claim,
  ArtisanProfile,
  ArtisanProfileSubmitRequest,
  ArtisanProfileReviewRequest,
  PersonalDetailsUpdate,
  BusinessDetailsUpdate,
  BankDetailsUpdate,
  SupportMessage,
  SupportMessageSubmitRequest,
} from '../types/contracts';
import { getWageFloorPreview } from '../constants/wageRates';

const now = () => new Date().toISOString();

interface MockJobRecord {
  type: JobStatus['type'];
  createdAt: number;
  listingId: string;
  photos?: string[];
}

interface MockListingOverride {
  state?: ListingState;
  claims?: Claim[];
}

const activeJobRegistry = new Map<string, MockJobRecord>();
const mockListingRegistry = new Map<string, MockListingOverride>();
const mockSupportMessages: SupportMessage[] = [];
let mockListings: Listing[] = [];

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

let mockPendingProfiles: ArtisanProfile[] = [];

export const mockApi: ListingService = {
  createListing: async (payload: { preferred_language: string }) => {
    const newListing: Listing = {
      id: `listing_${Date.now()}`,
      artisan_id: 'user_uuid_artisan',
      state: 'draft' as ListingState,
      preferred_language: payload.preferred_language,
      media: [],
      catalogue: null,
      price: null,
      claims: [],
      created_at: now(),
      updated_at: now(),
    };
    mockListings.unshift(newListing);
    return {
      id: newListing.id,
      artisan_id: newListing.artisan_id,
      state: 'draft' as ListingState,
      preferred_language: payload.preferred_language,
      upload_instructions: { token: 'opaque_upload_token' },
    };
  },

  listListings: async (): Promise<Listing[]> => mockListings,

  confirmListing: async (
  listingId: string,
  payload: {
    catalogue: any;
    confirmed_fields: string[];
    corrections: { field: string; old_value: any; new_value: any; source: string }[];
  }
) => ({
  status: 'awaiting_approval',
  listing_id: listingId,
}),

  getListing: async (listingId: string): Promise<Listing> => {
    const existing = mockListings.find((l) => l.id === listingId);
    const override = mockListingRegistry.get(listingId);
    if (existing) {
      return {
        ...existing,
        state: override?.state ?? existing.state,
        claims: override?.claims ?? existing.claims,
      };
    }
    return {
      id: listingId,
      artisan_id: 'user_uuid_artisan',
      state: override?.state ?? 'draft',
      preferred_language: 'en',
      media: [],
      catalogue: null,
      price: null,
      claims: override?.claims ?? [],
      created_at: now(),
      updated_at: now(),
    };
  },

  completeMediaUpload: async (listingId: string, payload: { kind: string; upload_token: string; client_checksum: string }) => ({
    status: 'success',
    media_id: `media_${payload.kind}_123`,
  }),

  requestImageAnalysis: async (listingId: string, payload: { media_id: string; photos?: string[] }) => {
    const jobId = `job_image_${Date.now()}`;
    activeJobRegistry.set(jobId, {
      type: 'image_studio',
      createdAt: Date.now(),
      listingId,
      photos: payload.photos,
    });
    return { job_id: jobId };
  },

  requestImageEnhancement: async (listingId: string, photoUris: string[]) => {
    const jobId = `job_image_${Date.now()}`;
    activeJobRegistry.set(jobId, {
      type: 'image_studio',
      createdAt: Date.now(),
      listingId,
      photos: photoUris,
    });
    return { job_id: jobId };
  },

  requestTranscription: async (listingId: string, payload: { audio_media_id: string; declared_language: string }) => {
    const jobId = `job_audio_${Date.now()}`;
    activeJobRegistry.set(jobId, {
      type: 'transcription',
      createdAt: Date.now(),
      listingId,
    });
    return { job_id: jobId };
  },

  getJobStatus: async (jobId: string): Promise<JobStatus> => {
    const job = activeJobRegistry.get(jobId);
    const elapsed = job ? Date.now() - job.createdAt : 5000;
    let status: JobStatus['status'] = 'complete';

    // Realistic asynchronous timing:
    // 0 - 1500ms: queued (uploading camera frames / media server ingest)
    // 1500 - 3600ms: processing (AI Image Studio neural background neutralization & daylight calibration)
    // > 3600ms: complete (ready to fetch results)
    if (elapsed < 1500) {
      status = 'queued';
    } else if (elapsed < 3600) {
      status = 'processing';
    } else {
      status = 'complete';
    }

    return {
      job_id: jobId,
      type: job?.type ?? (jobId.includes('image') ? 'image_studio' : jobId.includes('audio') ? 'transcription' : 'catalogue_generation'),
      status,
      attempt: 1,
      created_at: job ? new Date(job.createdAt).toISOString() : now(),
      updated_at: now(),
    };
  },

  getImageJobResult: async (jobId: string): Promise<ImageJobResult> => {
    const job = activeJobRegistry.get(jobId);

    return {
      job_id: jobId,
      status: 'complete',
      quality: {
        overall: 'acceptable',
        blur: 'low',
        lighting: 'acceptable',
        framing: 'acceptable',
        guidance: [],
      },
      original_url: job?.photos?.[0] || '',
      enhanced_media_id: `media_enhanced_${jobId}`,
      enhanced_url: '',
      enhanced_urls: [],
      transformations: [],
      human_review_required: false,
    };
  },

  requestCatalogueGeneration: async (listingId: string, payload: any): Promise<CatalogueResult> => ({
    schema_version: '1.0.0',
    catalogue: {
      listing_id: listingId,
      category: '',
      materials: [],
      techniques: [],
      title: { en: '', local: '', local_language: 'kn' },
      description: { en: '', local: '' },
      labour: { hours: 0, skill_level: 'skilled', state_code: 'KA' },
      material_cost_paise: 0,
      provenance: { claims: [], gi_tag: null },
      source: { transcript_id: 'transcript_uuid', asr_confidence: 0.86 },
    },
    field_confidence: { category: 0.5, materials: 0.5, techniques: 0.5, 'labour.hours': 0.5, material_cost_paise: 0.5 },
    needs_confirmation: ['techniques', 'labour.hours', 'material_cost_paise'],
  }),

  requestPrice: async (listingId: string, payload: any): Promise<PriceResult> => {
    const stateCode = payload?.state_code || 'KA';
    const zone = payload?.zone || 'zone_1';
    const skill = payload?.skill_level || 'skilled';
    const wageFloor = getWageFloorPreview(stateCode, zone, skill);
    const matCostPaise = Math.round((payload?.material_cost_inr || 800) * 100);
    const labourHours = payload?.labour_hours || 12;

    if (!wageFloor) {
      return {
        calculation_version: '1.0.0',
        status: 'unavailable',
        currency: 'INR',
        inputs: {
          material_cost_paise: matCostPaise,
          labour_hours: labourHours,
          hourly_wage_paise: 0,
          skill_level: skill,
          skill_level_self_declared: payload?.skill_level_self_declared || skill,
          skill_level_source: payload?.skill_level_source || 'self_declared',
          state_code: stateCode,
          zone: zone,
        },
        floor_amount_paise: 0,
        recommended_low_paise: 0,
        recommended_high_paise: 0,
        explanation: `Statutory minimum wage rate is pending official gazette notification for ${stateCode} / ${skill}.`,
      };
    }

    const hourlyWagePaise = Math.round(wageFloor.hourly * 100);
    const floorAmountPaise = Math.round(matCostPaise + labourHours * hourlyWagePaise);
    const recLowPaise = Math.round(floorAmountPaise * 1.10);
    const recHighPaise = Math.round(floorAmountPaise * 1.60);

    return {
      calculation_version: '1.0.0',
      status: 'available',
      currency: 'INR',
      wage_source: {
        state_code: stateCode,
        zone: zone,
        notification_ref: wageFloor.notificationRef || 'Official Minimum Wages Notification',
        effective_from: '2025-04-01',
        source_url: 'https://labour.gov.in',
      },
      inputs: {
        material_cost_paise: matCostPaise,
        labour_hours: labourHours,
        hourly_wage_paise: hourlyWagePaise,
        skill_level: skill,
        skill_level_self_declared: payload?.skill_level_self_declared || skill,
        skill_level_source: payload?.skill_level_source || 'self_declared',
        state_code: stateCode,
        zone: zone,
      },
      floor_amount_paise: floorAmountPaise,
      recommended_low_paise: recLowPaise,
      recommended_high_paise: recHighPaise,
      explanation: `Material cost: ₹${(matCostPaise / 100).toFixed(2)}. Labour: ${labourHours} hrs @ ₹${wageFloor.hourly.toFixed(2)}/hr (${skill.replace('_', ' ')} tier, ${stateCode}). Statutory floor: ₹${(floorAmountPaise / 100).toFixed(2)}.`,
    };
  },

  // Unhappy-path fixture — wire a screen toggle to test this state deliberately
  requestPrice_unavailable: async (): Promise<PriceResult> => ({
    calculation_version: '1.0.0',
    status: 'unavailable',
    currency: 'INR',
    inputs: { material_cost_paise: 80000, labour_hours: 12, hourly_wage_paise: 0, skill_level: 'skilled' },
    floor_amount_paise: 0,
    recommended_low_paise: 0,
    recommended_high_paise: 0,
    explanation: 'No verified wage notification is available for this state yet.',
  }),

  reviewClaim: async (listingId: string, claim: string, payload: { decision: string; evidence_note: string; reason: string | null }) => {
    const isVerified = payload.decision === 'verified';
    const existing = mockListingRegistry.get(listingId) || {};
    const existingClaims = existing.claims || [
      { claim: 'handloom_weave', asserted_by_artisan: true, coordinator_verified: false, evidence_note: null },
      { claim: 'natural_dye', asserted_by_artisan: true, coordinator_verified: false, evidence_note: null },
    ];
    const updatedClaims = existingClaims.map((c) =>
      c.claim === claim ? { ...c, coordinator_verified: isVerified, evidence_note: payload.evidence_note } : c
    );
    mockListingRegistry.set(listingId, { ...existing, claims: updatedClaims });
    return {
      claim,
      coordinator_verified: isVerified,
      evidence_note: payload.evidence_note,
    };
  },

  submitForApproval: async (listingId: string) => ({ status: 'awaiting_approval' }),

  decideApproval: async (listingId: string, payload: { decision: string; reason: string }) => {
    const nextState = (payload.decision === 'approved' ? 'approved' : 'rejected') as ListingState;
    const existing = mockListingRegistry.get(listingId) || {};
    mockListingRegistry.set(listingId, { ...existing, state: nextState });
    return {
      status: nextState,
      reason: payload.reason,
    };
  },

  requestExport: async (listingId: string, payload: { target: string; schema_version: string; simulate_network_submission?: boolean }): Promise<ExportResult> => ({
    export_id: `export_${listingId}`,
    target: payload.target,
    status: 'validated',
    payload_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    contract_validation: { passed: true, schema_source: 'ONDC Protocol Spec v1.2.0' },
    // Build guide: Never use 'syncing to ONDC' theatre for local gateway. Default: 'not_attempted'
    network_submission: payload.simulate_network_submission ? 'success' : 'not_attempted',
  }),

  getArtisanProfile: async (_userId?: number): Promise<ArtisanProfile> => ({
    ...mockCurrentProfile,
  }),

  submitArtisanProfile: async (payload: ArtisanProfileSubmitRequest): Promise<ArtisanProfile> => {
    mockCurrentProfile = {
      ...mockCurrentProfile,
      profile_status: 'pending_verification',
      declared_skill_level: payload.declared_skill_level,
      declared_zone: payload.declared_zone,
      id_proof_type: payload.id_proof_type,
      id_proof_number: payload.id_proof_number ?? null,
      verified_skill_level: null,
      verified_by: null,
      verified_at: null,
    };
    const existingIndex = mockPendingProfiles.findIndex((p) => p.user_id === mockCurrentProfile.user_id);
    if (existingIndex >= 0) {
      mockPendingProfiles[existingIndex] = { ...mockCurrentProfile };
    } else {
      mockPendingProfiles.push({ ...mockCurrentProfile });
    }
    return { ...mockCurrentProfile };
  },

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

  getPendingArtisanProfiles: async (): Promise<ArtisanProfile[]> => [
    ...mockPendingProfiles,
  ],

  reviewArtisanProfile: async (userId: number, payload: ArtisanProfileReviewRequest): Promise<ArtisanProfile> => {
    const isVerified = payload.decision === 'verified';
    const verifiedTier = isVerified ? (payload.verified_skill_level || mockCurrentProfile.declared_skill_level || null) : null;

    if (mockCurrentProfile.user_id === userId) {
      mockCurrentProfile = {
        ...mockCurrentProfile,
        profile_status: isVerified ? 'verified' : 'rejected',
        verified_skill_level: verifiedTier,
        verified_by: 2,
        verified_at: now(),
      };
    }

    mockPendingProfiles = mockPendingProfiles.filter((p) => p.user_id !== userId);

    return {
      user_id: userId,
      username: 'artisan_demo',
      phone_number: '9876543210',
      role: 'artisan',
      profile_status: isVerified ? 'verified' : 'rejected',
      declared_skill_level: mockCurrentProfile.declared_skill_level || 'highly_skilled',
      declared_zone: mockCurrentProfile.declared_zone || 'KA/zone_1',
      id_proof_type: mockCurrentProfile.id_proof_type || 'pehchan_card',
      id_proof_number: mockCurrentProfile.id_proof_number || 'PEHCHAN-8822-KA',
      verified_skill_level: verifiedTier,
      verified_by: 2,
      verified_at: now(),
    };
  },

  submitSupportMessage: async (payload: SupportMessageSubmitRequest): Promise<SupportMessage> => {
    const newMsg: SupportMessage = {
      id: `supp_msg_${Date.now()}`,
      artisan_id: 1,
      listing_id: payload.listing_id || null,
      message: payload.message,
      status: 'open',
      created_at: now(),
      artisan_name: 'artisan_demo',
      listing_title: payload.listing_id ? 'Demo Craft Listing' : null,
    };
    mockSupportMessages.unshift(newMsg);
    return newMsg;
  },

  getSupportMessages: async (): Promise<SupportMessage[]> => {
    return [...mockSupportMessages];
  },

  // TODO: Send Voice Feedback stub for artisan profile/coordinator idea notes
  // Backed by mockApi only until dedicated voice feedback / cluster audio messaging endpoint is implemented in backend.
  submitVoiceFeedback: async (_audioUri?: string, _note?: string): Promise<{ success: boolean; message: string }> => {
    return {
      success: true,
      message: 'Voice feedback received! Your cluster coordinator will review your voice memo.',
    };
  },

  login: async (role: UserRole): Promise<{ access_token: string; role: UserRole; user_id: string }> => ({
    access_token: `demo_token_${role}_123`,
    role,
    user_id: `user_uuid_${role}`,
  }),

  loginWithCredentials: async (identifier: string, _password: string): Promise<{ access_token: string; role: UserRole; user_id: string }> => {
    const role: UserRole = identifier.toLowerCase().includes('coord') ? 'coordinator' : 'artisan';
    return {
      access_token: `mock_token_${role}_${Date.now()}`,
      role,
      user_id: `user_mock_${role}_1`,
    };
  },

  loginWithPassword: async (identifier: string, _password: string): Promise<{ access_token: string; role: UserRole; user_id: string }> => {
    const role: UserRole = identifier.toLowerCase().includes('coord') ? 'coordinator' : 'artisan';
    return {
      access_token: `mock_token_${role}_${Date.now()}`,
      role,
      user_id: `user_mock_${role}_1`,
    };
  },

  register: async (payload: { username: string; phone_number: string; password: string; role: UserRole }): Promise<{ access_token: string; role: UserRole; user_id: string }> => ({
    access_token: `mock_token_${payload.role}_${Date.now()}`,
    role: payload.role,
    user_id: `user_mock_${payload.role}_${Date.now()}`,
  }),
};