// src/app/CoordinatorStack.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CoordinatorTabs from './CoordinatorTabs';
import PublishExportScreen from '../features/publish-export/PublishExportScreen';
import CraftReviewDetailScreen from '../features/coordinator-review/CraftReviewDetailScreen';
import SupportThreadScreen from '../features/support-chat/SupportThreadScreen';
import CoordinatorProfileScreen from '../features/coordinator-review/CoordinatorProfileScreen';
import ArtisanInquiriesListScreen from '../features/coordinator-review/ArtisanInquiriesListScreen';

import { useAppTheme } from '../theme';

const Stack = createNativeStackNavigator();

export default function CoordinatorStack() {
  const { colors, isDark } = useAppTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        statusBarStyle: isDark ? 'light' : 'dark',
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: {
          fontWeight: '800',
          fontSize: 20,
          color: colors.text,
        },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen 
        name="CoordinatorDashboard" 
        component={CoordinatorTabs} 
        options={{ headerShown: false }} 
      />
      <Stack.Screen 
        name="CoordinatorTabs" 
        component={CoordinatorTabs} 
        options={{ headerShown: false }} 
      />
      <Stack.Screen 
        name="CraftReviewDetail" 
        component={CraftReviewDetailScreen} 
        options={{ title: 'Craft Audit' }} 
      />
      <Stack.Screen 
        name="PublishExport" 
        component={PublishExportScreen} 
        options={{ title: 'Export Listing' }} 
      />
      <Stack.Screen 
        name="SupportThread" 
        component={SupportThreadScreen} 
        options={{ title: 'Support Conversation' }} 
      />
      <Stack.Screen 
        name="CoordinatorProfile" 
        component={CoordinatorProfileScreen} 
        options={{ headerShown: false }} 
      />
      <Stack.Screen 
        name="ArtisanInquiriesList" 
        component={ArtisanInquiriesListScreen} 
        options={{ headerShown: false }} 
      />
    </Stack.Navigator>
  );
}