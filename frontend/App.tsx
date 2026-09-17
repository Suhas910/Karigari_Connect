// App.tsx
import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { MD3LightTheme as DefaultTheme, PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import RootNavigator from './src/app/RootNavigator';
import { initDatabase } from './src/services/database';
import { colors } from './src/theme';
import i18n, { restoreAppLanguage } from './src/i18n';
import { I18nextProvider } from 'react-i18next';

import { useAuthStore } from './src/store/authStore';

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    secondary: colors.secondary,
    primaryContainer: colors.indigoLight,
    secondaryContainer: colors.indigoLight,
    onSecondaryContainer: colors.secondary,
    onPrimaryContainer: colors.primary,
    surfaceVariant: colors.indigoLight,
    background: colors.background,
    error: colors.error,
    surface: colors.surface,
  },
};

const queryClient = new QueryClient();

export default function App() {
  // Initialize SQLite local draft + outbox tables and restore auth on boot
  useEffect(() => {
    initDatabase();
    restoreAppLanguage();
    useAuthStore.getState().initAuth();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
      <PaperProvider
        theme={theme}
        settings={{ icon: (props) => <MaterialCommunityIcons {...props} /> }}
      >
        <StatusBar barStyle="dark-content" backgroundColor={colors.surface} />
        <RootNavigator />
      </PaperProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}