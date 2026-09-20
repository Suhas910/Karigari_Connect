// App.tsx
import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RootNavigator from './src/app/RootNavigator';
import { initDatabase } from './src/services/database';
import { ThemeProvider, useAppTheme } from './src/theme';
import i18n, { restoreAppLanguage } from './src/i18n';
import { I18nextProvider } from 'react-i18next';

import { useAuthStore } from './src/store/authStore';
import { useThemeStore } from './src/store/themeStore';

const queryClient = new QueryClient();

/**
 * Inner component that has access to the theme context.
 * Renders StatusBar with the correct barStyle for the active theme.
 */
function AppContent() {
  const { colors, isDark } = useAppTheme();

  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />
      <RootNavigator />
    </>
  );
}

export default function App() {
  // Initialize SQLite, language, auth, and theme on boot
  useEffect(() => {
    initDatabase();
    restoreAppLanguage();
    useAuthStore.getState().initAuth();
    useThemeStore.getState().initTheme();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}