// src/theme/ThemeContext.tsx
// ─────────────────────────────────────────────────────────────────
// Central theme provider. Reads mode from themeStore, resolves the
// active palette, and wraps the tree with PaperProvider so both
// custom components and Paper widgets always see the right theme.
// ─────────────────────────────────────────────────────────────────
import React, { createContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import {
  MD3LightTheme,
  MD3DarkTheme,
  PaperProvider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  DefaultTheme as NavigationDefaultTheme,
  DarkTheme as NavigationDarkTheme,
} from '@react-navigation/native';

import { useThemeStore, type ThemeMode } from '../store/themeStore';
import { lightColors, darkColors, type ColorPalette } from './colors';

// ── Context value shape ──────────────────────────────────────────
export interface ThemeContextValue {
  /** The active color palette (light or dark). */
  colors: ColorPalette;
  /** True when the resolved appearance is dark. */
  isDark: boolean;
  /** The user-selected mode (may be 'system'). */
  themeMode: ThemeMode;
  /** Cycle through light → dark → system. */
  toggleTheme: () => Promise<void>;
  /** Set a specific mode. */
  setTheme: (mode: ThemeMode) => Promise<void>;
  /** Pre-built React Navigation theme matching the current palette. */
  navTheme: typeof NavigationDefaultTheme;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

// ── Provider component ───────────────────────────────────────────
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = useThemeStore((s) => s.themeMode);
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null

  // Resolve the effective appearance
  const resolvedMode =
    themeMode === 'system' ? (systemScheme ?? 'light') : themeMode;
  const isDark = resolvedMode === 'dark';
  const activeColors = isDark ? darkColors : lightColors;

  // ── React Native Paper theme ──────────────────────────────────
  const paperTheme = useMemo(() => {
    const base = isDark ? MD3DarkTheme : MD3LightTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: activeColors.primary,
        onPrimary: activeColors.onPrimary,
        secondary: activeColors.secondary,
        onSecondary: '#FFFFFF',
        primaryContainer: activeColors.indigoLight,
        secondaryContainer: activeColors.indigoLight,
        onSecondaryContainer: activeColors.secondary,
        onPrimaryContainer: activeColors.primary,
        surfaceVariant: activeColors.indigoLight,
        background: activeColors.background,
        error: activeColors.error,
        surface: activeColors.surface,
        onSurface: activeColors.text,
        onSurfaceVariant: activeColors.placeholder,
        outline: activeColors.inputBorder,
        outlineVariant: activeColors.border,
      },
    };
  }, [isDark, activeColors]);

  // ── React Navigation theme ────────────────────────────────────
  const navTheme = useMemo(() => {
    const base = isDark ? NavigationDarkTheme : NavigationDefaultTheme;
    return {
      ...base,
      dark: isDark,
      colors: {
        ...base.colors,
        primary: activeColors.primary,
        background: activeColors.background,
        card: activeColors.surface,
        text: activeColors.text,
        border: activeColors.border,
        notification: activeColors.warningAmber,
      },
    };
  }, [isDark, activeColors]);

  // ── Context value ─────────────────────────────────────────────
  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      colors: activeColors,
      isDark,
      themeMode,
      toggleTheme: useThemeStore.getState().toggleTheme,
      setTheme: useThemeStore.getState().setTheme,
      navTheme,
    }),
    [activeColors, isDark, themeMode, navTheme],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <PaperProvider
        theme={paperTheme}
        settings={{
          icon: (props: any) => <MaterialCommunityIcons {...props} />,
        }}
      >
        {children}
      </PaperProvider>
    </ThemeContext.Provider>
  );
}
