// src/store/themeStore.ts
// ─────────────────────────────────────────────────────────────────
// Zustand store for theme preference (light / dark / system).
// Persisted to expo-secure-store so the choice survives app restart.
// ─────────────────────────────────────────────────────────────────
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'app.themeMode';

interface ThemeState {
  /** User-chosen mode. 'system' defers to the OS preference. */
  themeMode: ThemeMode;
  /** True once the persisted value has been read from SecureStore. */
  isHydrated: boolean;
  /** Set a specific mode and persist it. */
  setTheme: (mode: ThemeMode) => Promise<void>;
  /**
   * Cycle through modes: light → dark → system → light …
   * Convenient for single-tap toggle buttons.
   */
  toggleTheme: () => Promise<void>;
  /** Read the persisted mode on app boot. */
  initTheme: () => Promise<void>;
}

const CYCLE: ThemeMode[] = ['light', 'dark', 'system'];

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeMode: 'light',
  isHydrated: false,

  setTheme: async (mode) => {
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, mode);
    } catch (err) {
      console.error('[themeStore] Failed to persist theme mode', err);
    }
    set({ themeMode: mode });
  },

  toggleTheme: async () => {
    const current = get().themeMode;
    const idx = CYCLE.indexOf(current);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    await get().setTheme(next);
  },

  initTheme: async () => {
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (stored && (stored === 'light' || stored === 'dark' || stored === 'system')) {
        set({ themeMode: stored as ThemeMode, isHydrated: true });
        return;
      }
    } catch (err) {
      console.error('[themeStore] Failed to restore theme mode', err);
    }
    set({ themeMode: 'light', isHydrated: true });
  },
}));
