//  src/services/api.ts
import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { useAuthStore } from '../store/authStore';

// LOCAL DEV BACKEND URL CONFIGURATION:
// To test with a local backend instance (uvicorn app.main:app --reload on port 8000),
// substitute extra.apiBaseUrl in app.json with:
// - Android Emulator: http://10.0.2.2:8000/api/v1
// - iOS Simulator:    http://localhost:8000/api/v1
// - Physical Device:  http://<your-machine-LAN-IP>:8000/api/v1
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  Constants.expoConfig?.extra?.apiBaseUrl ??
  'http://LOCAL_DEV_BACKEND_URL/api/v1'; 

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Backend media URLs are paths ("/api/v1/media/{id}/content"); this is what they are relative to.
export const API_ORIGIN = String(API_BASE_URL).replace(/\/api\/v1\/?\s*$/, '');

// The contract error body ({ code, message, recoverable, action }) of a failed request, if any.
export const apiErrorOf = (err: unknown): ApiError['error'] | undefined =>
  (err as any)?.response?.data?.error;

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
    // expo-crypto: React Native has no global `crypto`, so the global call threw on every POST.
    config.headers['Idempotency-Key'] = Crypto.randomUUID();
  }
  
  return config;
});

// --- RESPONSE INTERCEPTOR ---
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // Log request_id on error states for debugging per strict contracts
    const requestId = error.response?.data?.request_id || 'unknown';
    console.error(`[API Error] RequestID: ${requestId}`, error.response?.data?.error);

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
  ApiError,
  ListingService,
  Listing,
  JobStatus,
  ImageJobResult,
  CatalogueResult,
  LocalFile,
  MediaUploadResult,
  PriceRequest,
  PriceResult,
  ExportResult,
  TranscriptJobResult,
  UserRole,
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

  uploadMedia: async (listingId: string, kind: 'image' | 'audio', file: LocalFile): Promise<MediaUploadResult> => {
    const form = new FormData();
    form.append('kind', kind);
    // React Native reads the file from `uri`. The backend checks the bytes, not the name or type.
    form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);
    const res = await api.post(`/listings/${listingId}/media/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      transformRequest: (data) => data,
    });
    return res.data;
  },

  requestImageAnalysis: async (listingId: string, payload: { media_id: string; photos?: string[] }) => {
    // Aligned to contract: POST /listings/{id}/jobs/image-studio
    const res = await api.post(`/listings/${listingId}/jobs/image-studio`, payload);
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

  getJobResult: async (jobId: string): Promise<TranscriptJobResult> => {
    const res = await api.get(`/jobs/${jobId}/result`);
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

  requestPrice: async (listingId: string, payload: PriceRequest): Promise<PriceResult> => {
    const res = await api.post(`/listings/${listingId}/price`, payload);
    return res.data;
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

  login: async (role: UserRole): Promise<{ access_token: string; role: UserRole; user_id: string }> => {
    // HACKATHON DEMO AUTH: Seeded demo credentials for rapid testing/presentation.
    // NOTE: This demo-account approach is for hackathon demo purposes only, not a real registration flow,
    // and should not be presented as the production auth pattern.
    const DEMO_PASSWORD = 'DemoPassword123!';
    const username = role === 'coordinator' ? 'coord_demo' : 'artisan_demo';
    const email = `${username}@karigari.local`;

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
          email,
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
};