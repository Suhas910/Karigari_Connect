// src/services/mockApi.ts
import { Listing, JobStatus, CatalogueResult, PriceResult, ExportResult, ImageJobResult, ListingService, ListingState, UserRole, Claim } from '../types/contracts';

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

export const mockApi: ListingService = {
  createListing: async (payload: { preferred_language: string }) => ({
    id: 'listing_uuid_123',
    artisan_id: 'user_uuid_artisan',
    state: 'draft' as ListingState,
    preferred_language: payload.preferred_language,
    upload_instructions: { token: 'opaque_upload_token' },
  }),

listListings: async (): Promise<Listing[]> => [
  {
    id: 'listing_001',
    artisan_id: 'user_uuid_artisan',
    state: 'draft',
    preferred_language: 'kn',
    media: [],
    catalogue: null,
    price: null,
    claims: [],
    created_at: now(),
    updated_at: now(),
  },
  {
    id: 'listing_002',
    artisan_id: 'user_uuid_artisan',
    state: 'awaiting_confirmation',
    preferred_language: 'kn',
    media: [{ id: 'media_1', kind: 'image', variant: 'enhanced', status: 'complete' }],
    catalogue: {
      schema_version: '1.0.0',
      catalogue: {
        listing_id: 'listing_002',
        category: 'handloom_saree',
        materials: ['cotton'],
        techniques: ['handloom_weave'],
        title: { en: 'Cotton handloom saree', local: 'ಹತ್ತಿ ಕೈಮಗ್ಗ ಸೀರೆ', local_language: 'kn' },
        description: { en: 'Beautiful woven saree.', local: 'ಸುಂದರವಾದ ಸೀರೆ.' },
        labour: { hours: 12, skill_level: 'skilled', state_code: 'KA' },
        material_cost_paise: 80000,
        provenance: { claims: [], gi_tag: null },
        source: { transcript_id: 't1', asr_confidence: 0.86 },
      },
      field_confidence: { category: 0.91, materials: 0.82, techniques: 0.61, 'labour.hours': 0.74 },
      needs_confirmation: ['techniques', 'labour.hours'],
    },
    price: null,
    claims: [],
    created_at: now(),
    updated_at: now(),
  },
  {
    id: 'listing_003',
    artisan_id: 'user_uuid_artisan',
    state: 'awaiting_approval',
    preferred_language: 'hi',
    media: [{ id: 'media_2', kind: 'image', variant: 'enhanced', status: 'complete' }],
    catalogue: {
      schema_version: '1.0.0',
      catalogue: {
        listing_id: 'listing_003',
        category: 'terracotta_pottery',
        materials: ['clay'],
        techniques: ['hand_thrown'],
        title: { en: 'Terracotta water pot', local: 'मिट्टी का घड़ा', local_language: 'hi' },
        description: { en: 'Hand-thrown clay pot.', local: 'हाथ से बना मिट्टी का घड़ा।' },
        labour: { hours: 6, skill_level: 'skilled', state_code: 'RJ' },
        material_cost_paise: 30000,
        provenance: { claims: [], gi_tag: null },
        source: { transcript_id: 't2', asr_confidence: 0.91 },
      },
      field_confidence: { category: 0.95, materials: 0.9, techniques: 0.88, 'labour.hours': 0.8 },
      needs_confirmation: [],
    },
    price: {
      calculation_version: '1.0.0',
      status: 'available',
      currency: 'INR',
      wage_source: { state_code: 'RJ', notification_ref: 'ref_456', effective_from: '2026-01-01', source_url: 'https://official.example' },
      inputs: { material_cost_paise: 30000, labour_hours: 6, hourly_wage_paise: 4500, skill_level: 'skilled' },
      floor_amount_paise: 57000,
      recommended_low_paise: 60000,
      recommended_high_paise: 80000,
      explanation: 'Floor includes material and skilled labour rate.',
    },
    claims: [],
    created_at: now(),
    updated_at: now(),
  },
  {
    id: 'listing_004',
    artisan_id: 'user_uuid_artisan',
    state: 'approved',
    preferred_language: 'kn',
    media: [{ id: 'media_3', kind: 'image', variant: 'enhanced', status: 'complete' }],
    catalogue: {
      schema_version: '1.0.0',
      catalogue: {
        listing_id: 'listing_004',
        category: 'bamboo_basket',
        materials: ['bamboo'],
        techniques: ['weaving'],
        title: { en: 'Bamboo storage basket', local: 'ಬಿದಿರಿನ ಬುಟ್ಟಿ', local_language: 'kn' },
        description: { en: 'Handwoven bamboo basket.', local: 'ಕೈಯಿಂದ ನೇಯ್ದ ಬುಟ್ಟಿ.' },
        labour: { hours: 4, skill_level: 'skilled', state_code: 'KA' },
        material_cost_paise: 15000,
        provenance: { claims: [], gi_tag: null },
        source: { transcript_id: 't3', asr_confidence: 0.93 },
      },
      field_confidence: { category: 0.96, materials: 0.94, techniques: 0.9, 'labour.hours': 0.85 },
      needs_confirmation: [],
    },
    price: null,
    claims: [],
    created_at: now(),
    updated_at: now(),
  },
  {
    id: 'listing_005',
    artisan_id: 'user_uuid_artisan',
    state: 'rejected',
    preferred_language: 'kn',
    media: [],
    catalogue: null,
    price: null,
    claims: [
      { claim: 'handloom_weave', asserted_by_artisan: true, coordinator_verified: false, evidence_note: 'Needs proof of handloom technique.' },
    ],
    created_at: now(),
    updated_at: now(),
  },
  {
    id: 'listing_006',
    artisan_id: 'user_uuid_artisan',
    state: 'exported',
    preferred_language: 'kn',
    media: [{ id: 'media_4', kind: 'image', variant: 'enhanced', status: 'complete' }],
    catalogue: {
      schema_version: '1.0.0',
      catalogue: {
        listing_id: 'listing_006',
        category: 'wooden_toy',
        materials: ['wood'],
        techniques: ['hand_carving'],
        title: { en: 'Hand-carved wooden toy', local: 'ಕೈ ಕೆತ್ತನೆ ಆಟಿಕೆ', local_language: 'kn' },
        description: { en: 'Traditional carved toy.', local: 'ಸಾಂಪ್ರದಾಯಿಕ ಆಟಿಕೆ.' },
        labour: { hours: 8, skill_level: 'skilled', state_code: 'KA' },
        material_cost_paise: 40000,
        provenance: { claims: [], gi_tag: null },
        source: { transcript_id: 't4', asr_confidence: 0.89 },
      },
      field_confidence: { category: 0.92, materials: 0.88, techniques: 0.85, 'labour.hours': 0.8 },
      needs_confirmation: [],
    },
    price: null,
    claims: [],
    created_at: now(),
    updated_at: now(),
  },
],

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
    const override = mockListingRegistry.get(listingId);
    return {
      id: listingId,
      artisan_id: 'user_uuid_artisan',
      state: override?.state ?? (listingId === 'listing_004' ? 'approved' : 'awaiting_confirmation'),
      preferred_language: 'kn',
      media: [{ id: 'media_1', kind: 'image', variant: 'enhanced', status: 'complete' }],
      catalogue: null,
      price: null,
      claims: override?.claims ?? [],
      created_at: now(),
      updated_at: now(),
    };
  },

  // Offline mode has no server checks to report.
  getReadiness: async (listingId) => ({
    listing_id: listingId,
    state: 'awaiting_confirmation',
    submit: [],
    approve: [],
  }),

  uploadMedia: async (listingId, kind, file) => ({
    status: 'complete',
    media_id: `mock_media_${kind}_${Date.now()}`,
    url: file.uri,
    kind,
    content_type: file.type,
    deduplicated: false,
  }),

  // Offline mode sends nothing to a server, and the transcript says so.
  getJobResult: async (jobId) => ({
    job_id: jobId,
    status: 'complete',
    transcript_id: jobId,
    detected_language: 'en',
    original_text: 'Offline demo: the recording was not sent to a server. Enter the details on the next screen.',
    english_translation: null,
    overall_confidence: null,
    needs_replay: true,
    adapter: { provider: 'fixture', model: 'mockApi', version: null, on_device: true },
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
      adapter: { provider: 'fixture', model: 'mockApi', on_device: true },
      notice: 'Offline demo: the photo was not analysed.',
    };
  },

  requestCatalogueGeneration: async (listingId: string, payload: any): Promise<CatalogueResult> => ({
    schema_version: '1.0.0',
    catalogue: {
      listing_id: listingId,
      category: '',
      materials: [],
      techniques: [],
      title: { en: '', local: null, local_language: 'kn' },
      description: { en: '', local: null },
      labour: { hours: null, skill_level: null, state_code: null },
      material_cost_paise: null,
      provenance: { claims: [], gi_tag: null },
      source: {
        transcript_id: payload?.transcript_id ?? 'offline',
        asr_confidence: null,
        asr_provider: 'fixture',
        catalogue_provider: 'fixture',
      },
    },
    adapter: { provider: 'fixture', model: 'mockApi', on_device: true },
    field_confidence: {},
    needs_confirmation: [
      'category', 'materials', 'techniques', 'title.en', 'description.en',
      'labour.hours', 'labour.skill_level', 'labour.state_code', 'material_cost_paise',
    ],
  }),

  // Uses the artisan's confirmed inputs. The hourly rate is a placeholder and is labelled as one.
  requestPrice: async (listingId, payload): Promise<PriceResult> => {
    const hourlyWagePaise = 5000;
    const floor = payload.material_cost_paise + Math.round(payload.labour_hours * hourlyWagePaise);
    return {
      calculation_version: 'mock',
      status: 'available',
      currency: 'INR',
      wage_source: {
        state_code: payload.state_code,
        notification_ref: 'MOCK-FIXTURE-NOT-A-REAL-NOTIFICATION',
        effective_from: '2026-01-01',
        source_url: 'unsourced://mock-fixture',
      },
      inputs: {
        material_cost_paise: payload.material_cost_paise,
        labour_hours: payload.labour_hours,
        hourly_wage_paise: hourlyWagePaise,
        skill_level: payload.skill_level,
      },
      floor_amount_paise: floor,
      recommended_low_paise: Math.round(floor * 1.1),
      recommended_high_paise: Math.round(floor * 1.4),
      explanation: 'Offline demo figures. The hourly rate is not from a wage notification.',
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
    contract_validation: { passed: false, schema_source: 'Offline demo: not validated' },
    // Build guide: Never use 'syncing to ONDC' theatre for local gateway. Default: 'not_attempted'
    network_submission: payload.simulate_network_submission ? 'simulated' : 'not_attempted',
    warnings: ['Offline demo: no payload was built or validated.'],
  }),

  login: async (role: UserRole): Promise<{ access_token: string; role: UserRole; user_id: string }> => ({
    access_token: `demo_token_${role}_123`,
    role,
    user_id: `user_uuid_${role}`,
  }),
};