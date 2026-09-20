// src/constants/languages.ts
export interface ScheduledLanguage {
  code: string;
  name: string;        // English name
  native: string;      // In native script
  script: string;      // Script family
  popular?: boolean;   // Quick selection chip
}

/**
 * All 22 Scheduled Languages recognized under the Eighth Schedule of the Constitution of India,
 * supported by Bhashini (National Language Translation Mission).
 * Plus English (widely used by pan-Indian artisan clusters & export markets).
 */
export const SCHEDULED_LANGUAGES: ScheduledLanguage[] = [
  // Frequently used / popular craft cluster languages
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', script: 'Devanagari', popular: true },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', script: 'Kannada', popular: true },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', script: 'Tamil', popular: true },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', script: 'Telugu', popular: true },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', script: 'Bengali', popular: true },
  { code: 'mr', name: 'Marathi', native: 'मराठी', script: 'Devanagari', popular: true },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', script: 'Gujarati', popular: true },
  { code: 'en', name: 'English', native: 'English', script: 'Latin', popular: true },

  // Remaining Scheduled Languages
  { code: 'as', name: 'Assamese', native: 'অসমীয়া', script: 'Bengali-Assamese' },
  { code: 'brx', name: 'Bodo', native: 'बर’', script: 'Devanagari' },
  { code: 'doi', name: 'Dogri', native: 'डोगरी', script: 'Devanagari' },
  { code: 'ks', name: 'Kashmiri', native: 'کٲشُر / कॉशुर', script: 'Perso-Arabic / Devanagari' },
  { code: 'kok', name: 'Konkani', native: 'कोंकणी', script: 'Devanagari' },
  { code: 'mai', name: 'Maithili', native: 'मैथिली', script: 'Devanagari' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', script: 'Malayalam' },
  { code: 'mni', name: 'Manipuri (Meitei)', native: 'মৈতৈলোন্ / ꯃꯤꯇꯩꯂꯣꯟ', script: 'Bengali / Meitei Mayek' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', script: 'Devanagari' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', script: 'Odia' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', script: 'Gurmukhi' },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्', script: 'Devanagari' },
  { code: 'sat', name: 'Santali', native: 'ᱥᱟᱱᱛᱟᱲᱤ', script: 'Ol Chiki' },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي / सिन्धी', script: 'Arabic / Devanagari' },
  { code: 'ur', name: 'Urdu', native: 'اردو', script: 'Perso-Arabic' },
];

export const POPULAR_LANGUAGES = SCHEDULED_LANGUAGES.filter((l) => l.popular);
