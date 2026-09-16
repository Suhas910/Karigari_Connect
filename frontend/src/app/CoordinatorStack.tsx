// src/app/CoordinatorStack.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CoordinatorTabs from './CoordinatorTabs';
import PublishExportScreen from '../features/publish-export/PublishExportScreen';

import { colors } from '../theme';

const Stack = createNativeStackNavigator();

export default function CoordinatorStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        statusBarStyle: 'dark',
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
        name="PublishExport" 
        component={PublishExportScreen} 
        options={{ title: 'Export Listing' }} 
      />
    </Stack.Navigator>
  );
}