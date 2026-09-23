// src/services/index.ts
import { mockApi } from './mockApi';
import { liveApi } from './api';
import type { ListingService } from '../types/contracts';

// Seamlessly switch between mockApi and liveApi.
// Set to true to connect directly to live FastAPI + Neon DB backend.
export const USE_LIVE_BACKEND = false;

export const service: ListingService = USE_LIVE_BACKEND ? liveApi : mockApi;
export { mockApi, liveApi };    