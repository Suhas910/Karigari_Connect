// src/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as SecureStore from 'expo-secure-store';
import en from './locales/en.json';
import hi from './locales/hi.json';
import kn from './locales/kn.json';
import bn from './locales/bn.json';
import ta from './locales/ta.json';
import te from './locales/te.json';
import mr from './locales/mr.json';
import gu from './locales/gu.json';
import or from './locales/or.json';

const LANGUAGE_STORAGE_KEY = 'app.language';
const SUPPORTED_LANGUAGES = ['en', 'hi', 'kn', 'bn', 'ta', 'te', 'mr', 'gu', 'or'] as const;

i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    kn: { translation: kn },
    bn: { translation: bn },
    ta: { translation: ta },
    te: { translation: te },
    mr: { translation: mr },
    gu: { translation: gu },
    or: { translation: or },
  },
  lng: 'en', 
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

let inMemoryLanguage: string | null = null;

// Explicit app-language choice from the picker; persisted across restarts.
export async function setAppLanguage(code: string) {
  await i18n.changeLanguage(code);
  inMemoryLanguage = code;
  try {
    const isAvailable = await SecureStore.isAvailableAsync();
    if (isAvailable) {
      await SecureStore.setItemAsync(LANGUAGE_STORAGE_KEY, code);
    }
  } catch (err) {
    console.warn('Failed to persist app language to SecureStore', err);
  }
}

// Restore the saved app language on boot; falls back to English.
export async function restoreAppLanguage() {
  try {
    let saved: string | null = inMemoryLanguage;
    const isAvailable = await SecureStore.isAvailableAsync();
    if (isAvailable) {
      const stored = await SecureStore.getItemAsync(LANGUAGE_STORAGE_KEY);
      if (stored) saved = stored;
    }
    
    if (saved && SUPPORTED_LANGUAGES.includes(saved as any)) {
      inMemoryLanguage = saved; // Keep in-memory cache synchronized
      if (saved !== i18n.language) {
        await i18n.changeLanguage(saved);
      }
    }
  } catch (err) {
    console.warn('Failed to restore app language from SecureStore', err);
  }
}

export default i18n;