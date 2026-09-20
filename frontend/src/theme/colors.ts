// src/theme/colors.ts
// ─────────────────────────────────────────────────────────────────
// Karigari Connect — Dual-palette color system (light + dark)
// ─────────────────────────────────────────────────────────────────

/**
 * Every color token the app uses. Both `lightColors` and `darkColors`
 * satisfy this shape, so components can rely on any key being present
 * regardless of which palette is active.
 */
export type ColorPalette = typeof lightColors;

// ── Light Palette ────────────────────────────────────────────────
export const lightColors = {
  // Brand
  primary: '#B84A2A',          // Terracotta – primary actions & focal points
  secondary: '#243354',        // Indigo – coordinator roles & secondary accents
  accent: '#B84A2A',           // Minimal accent (matches primary)

  // Surfaces
  background: '#FFFFFF',       // Pure white canvas
  surface: '#FFFFFF',          // Elevated cards and sheets
  surfaceElevated: '#F9FAFB',  // Higher-elevation cards (modals, dropdowns)

  // Borders
  border: '#E2DDD5',           // Stone – 1px crisp borders
  inputBorder: '#D1D5DB',      // Clear distinct border for form inputs

  // Text
  text: '#1C1917',             // Deep Charcoal – high-contrast body text
  textMuted: '#686460',        // Slate Gray – secondary labels & metadata
  placeholder: '#9CA3AF',      // Medium Neutral Gray – readable placeholder

  // Badges / Tags
  badgeNeutral: '#EFECE6',     // Tonal light gray for neutral tags/drafts
  badgeNeutralText: '#2B2825',

  // Brand tints
  primaryLight: '#FAF5F2',     // Warm terracotta tint (icon squares, selected cards)
  primaryTint: '#FDF7F4',      // Softer terracotta tint
  indigoLight: '#EEF2F9',      // Soft indigo tint for badges, tags, highlights
  indigoBorder: '#C6D2E8',     // Light indigo border for subtle accents

  // Semantic – Error
  error: '#8F2D18',            // Deep Brick – restrained error notices
  errorLight: '#FEE2E2',       // Soft error background
  errorBorder: '#FCA5A5',      // Error border

  // Semantic – Success (green)
  success: '#243354',          // Solid Indigo for confirmed states (legacy usage)
  successGreen: '#059669',     // Green – success icon/text
  successLight: '#ECFDF5',     // Green – success background
  successBorder: '#A7F3D0',    // Green – success border

  // Semantic – Warning (amber)
  warningAmber: '#F59E0B',     // Amber – warning icon/text/badge
  warningLight: '#FEF3C7',     // Amber – warning background
  warningBorder: '#FDE68A',    // Amber – warning border
  warningText: '#92400E',      // Amber – warning text on light bg

  // Utility
  shadow: '#000000',           // Shadow color (opacity varies)
  overlay: 'rgba(0,0,0,0.5)',  // Modal backdrop overlay
  onPrimary: '#FFFFFF',        // Text/icons on primary-colored buttons
};

// ── Dark Palette ─────────────────────────────────────────────────
export const darkColors: ColorPalette = {
  // Brand – slightly brightened for dark-surface contrast
  primary: '#D4734F',          // Warmer terracotta for dark backgrounds
  secondary: '#8AAED8',        // Lightened indigo – readable on dark
  accent: '#D4734F',

  // Surfaces – M3-style dark elevation hierarchy
  background: '#121212',       // M3 standard dark background
  surface: '#1E1E1E',          // Elevated dark card/sheet surface
  surfaceElevated: '#2A2A2A',  // Higher-elevation (modals, dropdowns)

  // Borders
  border: '#3A3632',           // Dark stone border – same warmth, lower luminance
  inputBorder: '#4B4B4B',      // Visible input borders on dark surface

  // Text
  text: '#E8E5E1',             // High-contrast light text on dark
  textMuted: '#9E9A96',        // Balanced muted text for dark
  placeholder: '#6B7280',      // Softer placeholder on dark inputs

  // Badges / Tags
  badgeNeutral: '#2A2825',     // Dark neutral badge background
  badgeNeutralText: '#E0DDD8',

  // Brand tints
  primaryLight: '#2A1F1A',     // Dark terracotta tint
  primaryTint: '#2F221C',      // Softer dark terracotta tint
  indigoLight: '#1E2A3D',      // Dark indigo tint
  indigoBorder: '#2E3F5C',     // Dark indigo border

  // Semantic – Error
  error: '#E8674F',            // Brighter error for dark background
  errorLight: '#2D1010',       // Dark error background
  errorBorder: '#5C1A1A',      // Dark error border

  // Semantic – Success
  success: '#8AAED8',          // Matches secondary lightened
  successGreen: '#34D399',     // Bright green on dark
  successLight: '#0D2818',     // Dark green background
  successBorder: '#134E2C',    // Dark green border

  // Semantic – Warning
  warningAmber: '#FCD34D',     // Bright amber on dark
  warningLight: '#2D1F05',     // Dark amber background
  warningBorder: '#5C3D0A',    // Dark amber border
  warningText: '#FCD34D',      // Amber text on dark bg

  // Utility
  shadow: '#000000',
  overlay: 'rgba(0,0,0,0.7)',  // Denser overlay for dark mode
  onPrimary: '#FFFFFF',
};

// ── Backward compatibility ───────────────────────────────────────
// Existing `import { colors }` statements continue to work unchanged
// until each file is migrated to `useAppTheme()`.
export const colors = lightColors;