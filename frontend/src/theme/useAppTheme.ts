// src/theme/useAppTheme.ts
// ─────────────────────────────────────────────────────────────────
// Convenience hook that wraps ThemeContext.
// Components migrate from:
//   import { colors } from '../theme';
// to:
//   import { useAppTheme } from '../theme';
//   const { colors, isDark } = useAppTheme();
// ─────────────────────────────────────────────────────────────────
import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from './ThemeContext';

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error(
      'useAppTheme() must be used within a <ThemeProvider>. ' +
        'Wrap your app root with the ThemeProvider from src/theme.',
    );
  }
  return ctx;
}
