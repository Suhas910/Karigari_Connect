// src/utils/media.ts
import type { MediaAsset } from '../types/contracts';
import { getBackendOrigin } from '../services/api';

const PLACEHOLDER_HOSTS = ['unsplash.com', 'placehold.co'];

export function isPlaceholder(url?: string): boolean {
  return !!url && PLACEHOLDER_HOSTS.some((h) => url.includes(h));
}

/**
 * Normalizes local backend media URLs so that mobile devices and emulators
 * can always reach the current server instance, regardless of which LAN IP
 * or hostname was active when the media record was originally created.
 */
export function normalizeMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  // Local file / content URIs on device
  if (url.startsWith('file://') || url.startsWith('content://') || url.startsWith('ph://')) {
    return url;
  }
  // If it's a backend /media/ route (relative or hardcoded with an old IP/localhost)
  if (url.includes('/media/')) {
    try {
      const origin = getBackendOrigin();
      const mediaPath = url.split('/media/')[1];
      return `${origin}/media/${mediaPath}`;
    } catch {
      return url;
    }
  }
  return url;
}

/**
 * Pick the best product photo from a listing's media array.
 *
 * Priority:
 *   1. Enhanced variant (studio-processed) that is NOT a placeholder
 *   2. Original variant (artisan capture) that is NOT a placeholder
 *   3. Any image that is NOT a placeholder
 *   4. Fallback photo from draft (local capture)
 *   5. Whatever is available (even a placeholder, so the thumbnail isn't empty)
 */
export function getBestProductPhoto(
  media?: MediaAsset[],
  fallbackPhotos?: string[]
): string | undefined {
  const images = (media ?? []).filter((m) => m.kind === 'image');

  const validMediaPhoto =
    images.find((m) => m.variant === 'enhanced' && !isPlaceholder(m.url))?.url ??
    images.find((m) => m.variant === 'original' && !isPlaceholder(m.url))?.url ??
    images.find((m) => !isPlaceholder(m.url))?.url;

  if (validMediaPhoto) {
    return normalizeMediaUrl(validMediaPhoto);
  }

  // If backend media only has placeholders or is empty, use the actual captured local photo from draft
  const validDraftPhoto = fallbackPhotos?.find((uri) => !isPlaceholder(uri));
  if (validDraftPhoto) {
    return normalizeMediaUrl(validDraftPhoto);
  }

  const fallback = images[0]?.url || fallbackPhotos?.[0];
  return fallback ? normalizeMediaUrl(fallback) : undefined;
}

