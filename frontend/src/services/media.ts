// src/services/media.ts
import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { API_ORIGIN } from './api';

export type MediaSource = { uri: string; headers?: Record<string, string> };

/**
 * Image source for a media URL. Uploaded media is served only to a signed-in user, so a
 * backend path gets the absolute URL and the login token; a local or absolute URI is used as is.
 */
export function useMediaSource(url?: string | null): MediaSource | null {
  const [source, setSource] = useState<MediaSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setSource(null);
    } else if (!url.startsWith('/')) {
      setSource({ uri: url });
    } else {
      SecureStore.getItemAsync('userToken').then((token) => {
        if (!cancelled) {
          setSource({
            uri: `${API_ORIGIN}${url}`,
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [url]);

  return source;
}
