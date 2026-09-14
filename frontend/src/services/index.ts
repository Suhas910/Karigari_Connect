// src/services/index.ts
import { mockApi } from './mockApi';
import { liveApi } from './api';
import type { ListingService } from '../types/contracts';

// mockApi unless EXPO_PUBLIC_API_BASE_URL is set (see .env.example), so switching to a
// real backend needs no code change.
const USE_LIVE_BACKEND = !!process.env.EXPO_PUBLIC_API_BASE_URL;

export const service: ListingService = USE_LIVE_BACKEND ? liveApi : mockApi;
export { mockApi, liveApi };