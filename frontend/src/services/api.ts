//  src/services/api.ts
import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { useAuthStore } from '../store/authStore';

// LOCAL DEV BACKEND URL CONFIGURATION:
// Strict prioritized runtime resolution:
// 1. Production / Staging HTTPS endpoint
// 2. Android Emulator runtime detection (!Device.isDevice && Platform.OS === 'android') -> 10.0.2.2
// 3. Physical Device runtime detection (Device.isDevice) -> Metro hostUri LAN IP
// 4. Configured non-placeholder override
// 5. iOS Simulator / Web fallback -> localhost
const resolveBaseUrl = (): string => {
  const configured = Constants.expoConfig?.extra?.apiBaseUrl;
  // 1. Explicit production / remote HTTPS endpoint takes top priority
  if (configured && configured.startsWith('https://')) {
    return configured;
  }

  // 2. Android Emulator runtime detection:
  // When running inside an Android Virtual Device (AVD), loopback to the host machine is ALWAYS 10.0.2.2.
  if (Platform.OS === 'android' && !Device.isDevice) {
    return 'http://10.0.2.2:8000/api/v1';
  }

  // 3. Physical device (Android or iOS): Metro bundler hostUri LAN IP takes precedence over localhost
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const lanIp = hostUri.split(':')[0];
    if (lanIp && lanIp !== 'localhost' && lanIp !== '127.0.0.1') {
      return `http://${lanIp}:8000/api/v1`;
    }
  }

  // 4. Configured non-placeholder URL (e.g. custom staging or specific local IP override)
  if (configured && !configured.includes('LOCAL_DEV_BACKEND_URL')) {
    return configured;
  }

  // 5. iOS Simulator or Web development fallback
  return 'http://localhost:8000/api/v1';
};

const API_BASE_URL = resolveBaseUrl();

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// --- REQUEST INTERCEPTOR ---
api.interceptors.request.use(async (config) => {
  // 1. Attach Auth Token
  const token = await SecureStore.getItemAsync('userToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // 2. Attach Idempotency Key for Mutations
  // Generates a UUID for every non-GET request to ensure safe outbox retries.
  if (config.method && config.method.toLowerCase() !== 'get') {
    config.headers['Idempotency-Key'] = Crypto.randomUUID();
  }

  return config;
});

// --- RESPONSE INTERCEPTOR ---
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Log request_id and clear error detail on error states
    const requestId = error.response?.data?.request_id || 'unknown';
    const errorDetail =
      error.response?.data?.error ||
      error.response?.data?.detail ||
      error.message ||
      'Network/Server Error';
    const method = originalRequest?.method?.toUpperCase() || '';
    const url = originalRequest?.url || '';
    const formattedDetail = typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail;
    console.error(`[API Error] ${method} ${url} (RequestID: ${requestId}) - ${formattedDetail}`, error);

    // Handle 401 Unauthorized with a silent refresh
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        // NOTE: Frontend half of silent refresh. Backend /auth/refresh must also accept expired-but-validly-signed tokens (e.g. verify_exp: False with leeway) in backend_branch.
        const staleToken = await SecureStore.getItemAsync('userToken');
        const response = await axios.post(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { headers: staleToken ? { Authorization: `Bearer ${staleToken}` } : {} }
        );
        const newToken = response.data.token;

        // Save the new token and update the failed request
        await SecureStore.setItemAsync('userToken', newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;

        // Retry the original request with the new token
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed (e.g., session expired completely), force logout
        await SecureStore.deleteItemAsync('userToken');
        useAuthStore.getState().logout();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// --- LIVE API IMPLEMENTATION OF LISTING SERVICE ---
import type {
  ListingService,
  Listing,
  JobStatus,
  ImageJobResult,
  CatalogueResult,
  PriceResult,
  ExportResult,
  UserRole,
  ArtisanProfile,
  ArtisanProfileSubmitRequest,
  ArtisanProfileReviewRequest,
  PersonalDetailsUpdate,
  BusinessDetailsUpdate,
  BankDetailsUpdate,
  SupportMessage,
  SupportMessageSubmitRequest,
} from '../types/contracts';

export const liveApi: ListingService = {
  createListing: async (payload: { preferred_language: string }) => {
    const res = await api.post('/listings', payload);
    return res.data;
  },

  listListings: async (): Promise<Listing[]> => {
    const res = await api.get('/listings');
    return res.data;
  },

  getListing: async (listingId: string): Promise<Listing> => {
    const res = await api.get(`/listings/${listingId}`);
    return res.data;
  },

  completeMediaUpload: async (listingId: string, payload: { kind: string; upload_token: string; client_checksum: string }) => {
    const res = await api.post(`/listings/${listingId}/media`, payload);
    return res.data;
  },

  requestImageAnalysis: async (listingId: string, payload: { media_id: string; photos?: string[] }) => {
    // Aligned to contract: POST /listings/{id}/jobs/image-studio
    const res = await api.post(`/listings/${listingId}/jobs/image-studio`, payload);
    return res.data;
  },

  requestImageEnhancement: async (listingId: string, photoUris: string[]) => {
    // Uploads the captured photos; the backend enhances them with BiRefNet in the background.
    const form = new FormData();
    photoUris.forEach((uri, idx) => {
      const extension = (uri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
      const type = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
      form.append('files', { uri, name: `photo_${idx + 1}.${extension}`, type } as any);
    });
    const res = await api.post(`/listings/${listingId}/jobs/image-enhancement`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      transformRequest: (data) => data,
      timeout: 120000,
    });
    return res.data;
  },

  requestTranscription: async (listingId: string, payload: { audio_media_id: string; declared_language: string }) => {
    // Aligned to contract: POST /listings/{id}/jobs/transcription
    const res = await api.post(`/listings/${listingId}/jobs/transcription`, payload);
    return res.data;
  },

  getJobStatus: async (jobId: string): Promise<JobStatus> => {
    const res = await api.get(`/jobs/${jobId}`);
    return res.data;
  },

  getImageJobResult: async (jobId: string): Promise<ImageJobResult> => {
    // Confirmed with backend team (backend_branch): GET /jobs/{id}/result is a real,
    // separate endpoint from GET /jobs/{id} status polling. Shape matches ImageJobResult.
    const res = await api.get(`/jobs/${jobId}/result`);
    return res.data?.result ?? res.data;
  },

  requestCatalogueGeneration: async (listingId: string, payload: any): Promise<CatalogueResult> => {
    // Aligned to contract: POST /listings/{id}/jobs/catalogue
    const res = await api.post(`/listings/${listingId}/jobs/catalogue`, payload);
    return res.data;
  },

  confirmListing: async (
    listingId: string,
    payload: {
      catalogue: any;
      confirmed_fields: string[];
      corrections: { field: string; old_value: any; new_value: any; source: string }[];
    }
  ) => {
    const res = await api.post(`/listings/${listingId}/confirm`, payload);
    return res.data;
  },

  requestPrice: async (listingId: string, payload: any): Promise<PriceResult> => {
    try {
      const res = await api.post(`/listings/${listingId}/price`, payload);
      return res.data;
    } catch (err: any) {
      if (err?.response?.data?.error?.code === 'WAGE_RATE_UNAVAILABLE') {
        return {
          calculation_version: '1.0.0',
          status: 'unavailable',
          currency: 'INR',
          inputs: {
            material_cost_paise:
              payload?.material_cost_paise ||
              (payload?.material_cost_inr ? Math.round(payload.material_cost_inr * 100) : 0),
            labour_hours: payload?.labour_hours || 0,
            hourly_wage_paise: 0,
            skill_level: payload?.skill_level || 'skilled',
          },
          floor_amount_paise: 0,
          recommended_low_paise: 0,
          recommended_high_paise: 0,
          explanation: err.response.data.error.message || 'Wage rate is under verification.',
          error_code: 'WAGE_RATE_UNAVAILABLE',
          fallback_suggestion: err.response.data.error.fallback_suggestion,
        };
      }
      throw err;
    }
  },

  reviewClaim: async (listingId: string, claim: string, payload: { decision: string; evidence_note: string; reason: string | null }) => {
    const res = await api.post(`/listings/${listingId}/claims/${encodeURIComponent(claim)}/review`, payload);
    return res.data;
  },

  submitForApproval: async (listingId: string) => {
    // Aligned to contract: POST /listings/{id}/submit-for-approval
    const res = await api.post(`/listings/${listingId}/submit-for-approval`);
    return res.data;
  },

  decideApproval: async (listingId: string, payload: { decision: string; reason: string }) => {
    const res = await api.post(`/listings/${listingId}/approval`, payload);
    return res.data;
  },

  requestExport: async (listingId: string, payload: { target: string; schema_version: string }): Promise<ExportResult> => {
    // Aligned to contract: POST /listings/{id}/exports
    const res = await api.post(`/listings/${listingId}/exports`, payload);
    return res.data;
  },

  getArtisanProfile: async (userId?: number): Promise<ArtisanProfile> => {
    const endpoint = userId ? `/profile/artisan/${userId}` : '/profile/artisan/me';
    const res = await api.get(endpoint);
    return res.data;
  },

  submitArtisanProfile: async (payload: ArtisanProfileSubmitRequest): Promise<ArtisanProfile> => {
    const res = await api.post('/profile/artisan', payload);
    return res.data;
  },

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

  getPendingArtisanProfiles: async (): Promise<ArtisanProfile[]> => {
    const res = await api.get('/profile/artisan/pending');
    return res.data;
  },

  reviewArtisanProfile: async (userId: number, payload: ArtisanProfileReviewRequest): Promise<ArtisanProfile> => {
    const res = await api.post(`/profile/artisan/${userId}/review`, payload);
    return res.data;
  },

  submitSupportMessage: async (payload: SupportMessageSubmitRequest): Promise<SupportMessage> => {
    const res = await api.post('/support/messages', payload);
    return res.data;
  },

  getSupportMessages: async (): Promise<SupportMessage[]> => {
    const res = await api.get('/support/messages');
    return res.data;
  },

  login: async (role: UserRole): Promise<{ access_token: string; role: UserRole; user_id: string }> => {
    // HACKATHON DEMO AUTH: Seeded demo credentials for rapid testing/presentation.
    // NOTE: This demo-account approach is for hackathon demo purposes only, not a real registration flow,
    // and should not be presented as the production auth pattern.
    const DEMO_PASSWORD = 'DemoPassword123!';
    const username = role === 'coordinator' ? 'coord_demo' : 'artisan_demo';
    const phone_number = role === 'coordinator' ? '9876543211' : '9876543210';

    try {
      const res = await api.post('/auth/login', { username, password: DEMO_PASSWORD });
      const token = res.data.access_token || res.data.token;
      return {
        access_token: token,
        role,
        user_id: String(res.data.user_id),
      };
    } catch (err: any) {
      // Fallback: If demo account is not registered yet (401/404), register once then retry login
      if (err.response?.status === 401 || err.response?.status === 404) {
        await api.post('/auth/register', {
          username,
          phone_number,
          password: DEMO_PASSWORD,
          role,
        });
        const retryRes = await api.post('/auth/login', { username, password: DEMO_PASSWORD });
        const token = retryRes.data.access_token || retryRes.data.token;
        return {
          access_token: token,
          role,
          user_id: String(retryRes.data.user_id),
        };
      }
      throw err;
    }
  },

  loginWithCredentials: async (identifier: string, password: string): Promise<{ access_token: string; role: UserRole; user_id: string }> => {
    const res = await api.post('/auth/login', { username: identifier.trim(), password });
    const token = res.data.access_token || res.data.token;
    return {
      access_token: token,
      role: res.data.role as UserRole,
      user_id: String(res.data.user_id),
    };
  },

  loginWithPassword: async (identifier: string, password: string): Promise<{ access_token: string; role: UserRole; user_id: string }> => {
    const res = await api.post('/auth/login', { username: identifier.trim(), password });
    const token = res.data.access_token || res.data.token;
    return {
      access_token: token,
      role: res.data.role as UserRole,
      user_id: String(res.data.user_id),
    };
  },

  register: async (payload: { username: string; phone_number: string; password: string; role: UserRole }): Promise<{ access_token: string; role: UserRole; user_id: string }> => {
    const res = await api.post('/auth/register', {
      username: payload.username.trim(),
      phone_number: payload.phone_number.trim(),
      password: payload.password,
      role: payload.role,
    });
    const token = res.data.access_token || res.data.token;
    return {
      access_token: token,
      role: res.data.role as UserRole,
      user_id: String(res.data.user_id),
    };
  },
};