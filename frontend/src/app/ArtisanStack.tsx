// src/app/ArtisanStack.tsx

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import ArtisanTabs from './ArtisanTabs';

import CaptureScreen from '../features/capture/CaptureScreen';
import ImageReviewScreen from '../features/image-review/ImageReviewScreen';
import SpeakScreen from '../features/speak/SpeakScreen';
import ConfirmDetailsScreen from '../features/confirm-details/ConfirmDetailsScreen';
import PriceScreen from '../features/price/PriceScreen';
import SubmitApprovalScreen from '../features/submit-approval/SubmitApprovalScreen';
import ArtisanProfileScreen from '../features/profile/ArtisanProfileScreen';
import ListingStatusScreen from '../features/listing-status/ListingStatusScreen';

import { colors } from '../theme';

const Stack = createNativeStackNavigator();

export const APP_HEADER_TITLE = 'Karigari Connect';

export default function ArtisanStack() {
  return (
    <Stack.Navigator
      initialRouteName="HomeTabs"
      screenOptions={{
        statusBarStyle: 'dark',
        headerTitle: APP_HEADER_TITLE,
        headerTintColor: colors.text,
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTitleStyle: {
          fontWeight: '800',
          fontSize: 20,
          color: colors.text,
        },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="HomeTabs"
        component={ArtisanTabs}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="MyListings"
        component={ArtisanTabs}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="Capture"
        component={CaptureScreen}
        options={{
          title: APP_HEADER_TITLE,
          headerShown: false,
        }}
      />

      <Stack.Screen
        name="ImageReview"
        component={ImageReviewScreen}
        options={{
          title: APP_HEADER_TITLE,
        }}
      />

      <Stack.Screen
        name="Speak"
        component={SpeakScreen}
        options={{
          title: APP_HEADER_TITLE,
        }}
      />

      <Stack.Screen
        name="ConfirmDetails"
        component={ConfirmDetailsScreen}
        options={{
          title: APP_HEADER_TITLE,
        }}
      />

      <Stack.Screen
        name="Price"
        component={PriceScreen}
        options={{
          title: APP_HEADER_TITLE,
        }}
      />

      <Stack.Screen
        name="SubmitApproval"
        component={SubmitApprovalScreen}
        options={{
          title: APP_HEADER_TITLE,
        }}
      />

      <Stack.Screen
        name="ListingStatus"
        component={ListingStatusScreen}
        options={{
          title: 'Listing Status',
        }}
      />

      <Stack.Screen
        name="ArtisanProfile"
        component={ArtisanProfileScreen}
        options={{
          title: 'Artisan Profile',
        }}
      />
    </Stack.Navigator>
  );
}