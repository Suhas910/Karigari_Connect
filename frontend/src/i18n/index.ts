// src/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './locales/en.json';
import hi from './locales/hi.json';
import kn from './locales/kn.json';

const LANGUAGE_STORAGE_KEY = 'app.language';
const SUPPORTED_LANGUAGES = ['en', 'hi', 'kn'];

i18n.use(initReactI18next).init({
  // @ts-expect-error
  compatibilityJSON: 'v3',
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    kn: { translation: kn },
  },
  lng: 'en', 
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Explicit app-language choice from the picker; persisted across restarts.
export async function setAppLanguage(code: string) {
  await i18n.changeLanguage(code);
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch (err) {
    console.error('Failed to persist app language', err);
  }
}

// Restore the saved app language on boot; falls back to English.
export async function restoreAppLanguage() {
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.includes(saved) && saved !== i18n.language) {
      await i18n.changeLanguage(saved);
    }
  } catch (err) {
    console.error('Failed to restore app language', err);
  }
}

export default i18n;
