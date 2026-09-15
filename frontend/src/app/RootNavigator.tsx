// src/app/RootNavigator

import React from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer, DefaultTheme as NavigationDefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { ProcessingIndicator } from '../components';
import { colors } from '../theme';

// Screens & Stacks
import SignInScreen from '../features/onboarding/SignInScreen';
import ArtisanStack from './ArtisanStack';
import CoordinatorStack from './CoordinatorStack';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...NavigationDefaultTheme,
  colors: {
    ...NavigationDefaultTheme.colors,
    background: colors.background, // #FFFFFF
  },
};

export default function RootNavigator() {
  const { isAuthenticated, role, isHydrated } = useAuthStore();

  if (!isHydrated) {
    return <ProcessingIndicator hint="Resuming session..." />;
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          // Unauthenticated Flow
          <Stack.Screen name="Auth" component={SignInScreen} />
        ) : role === 'artisan' ? (
          // Artisan Flow
          <Stack.Screen name="ArtisanStack" component={ArtisanStack} />
        ) : role === 'coordinator' ? (
          // Coordinator Flow
          <Stack.Screen name="CoordinatorStack" component={CoordinatorStack} />
        ) : (
          <Stack.Screen name="RoleError" component={RoleErrorScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function RoleErrorScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <Text>Account role not recognized. Please sign in again or contact support.</Text>
    </View>
  );
}