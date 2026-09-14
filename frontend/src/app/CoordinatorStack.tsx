// src/app/CoordinatorStack.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReviewQueueScreen from '../features/coordinator-review/ReviewQueueScreen';
import CoordinatorReviewScreen from '../features/coordinator-review/CoordinatorReviewScreen';
import PublishExportScreen from '../features/publish-export/PublishExportScreen';
import type { CoordinatorStackParamList } from '../types/navigation';

import { colors } from '../theme';

const Stack = createNativeStackNavigator<CoordinatorStackParamList>();

export default function CoordinatorStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
          color: colors.text,
        },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="ReviewQueue"
        component={ReviewQueueScreen}
        options={{ title: 'Review Queue' }}
      />
      <Stack.Screen
        name="ListingReview"
        component={CoordinatorReviewScreen}
        options={{ title: 'Review Listing' }}
      />
      <Stack.Screen
        name="PublishExport"
        component={PublishExportScreen}
        options={{ title: 'Export Listing' }}
      />
    </Stack.Navigator>
  );
}
