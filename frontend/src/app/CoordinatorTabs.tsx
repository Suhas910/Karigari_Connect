// src/app/CoordinatorTabs.tsx
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';

import ListingQueueScreen from '../features/coordinator-review/ListingQueueScreen';
import ProfileQueueScreen from '../features/coordinator-review/ProfileQueueScreen';
import HistoryScreen from '../features/coordinator-review/HistoryScreen';
import CoordinatorAccountScreen from '../features/coordinator-review/CoordinatorAccountScreen';
import GlassTabBar from '../components/GlassTabBar';

import { service, USE_LIVE_BACKEND } from '../services';
import { useAppTheme } from '../theme';
import type { CoordinatorTabParamList } from '../types/navigation';

const Tab = createBottomTabNavigator<CoordinatorTabParamList>();

export default function CoordinatorTabs() {
  const { colors } = useAppTheme();

  // Query pending listings count for Tab 1 badge
  const { data: dbListings } = useQuery({
    queryKey: ['coordinatorListings'],
    queryFn: () => service.listListings(),
    enabled: USE_LIVE_BACKEND,
    retry: 1,
    staleTime: 10000,
  });

  const pendingListingsCount = (dbListings || []).filter(
    (l) => l.state === 'awaiting_approval'
  ).length;

  // Query pending profiles count for Tab 2 badge
  const { data: pendingProfiles } = useQuery({
    queryKey: ['pendingArtisanProfiles'],
    queryFn: () => service.getPendingArtisanProfiles(),
    retry: 1,
    staleTime: 10000,
  });

  const pendingProfilesCount = (pendingProfiles || []).length;

  return (
    <Tab.Navigator
      initialRouteName="Queue"
      tabBar={(props) => <GlassTabBar {...props} variant="coordinator" />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitle: 'Karigari Connect',
        headerTitleStyle: {
          fontWeight: '800',
          fontSize: 20,
          color: colors.text,
          lineHeight: 28,
        },
        headerShadowVisible: false,
      }}
    >
      <Tab.Screen
        name="Queue"
        component={ListingQueueScreen}
        options={{
          headerTitle: 'Karigari Connect',
          tabBarLabel: 'Queue',
          tabBarBadge: pendingListingsCount > 0 ? pendingListingsCount : undefined,
        }}
      />
      <Tab.Screen
        name="Profiles"
        component={ProfileQueueScreen}
        options={{
          headerTitle: 'Karigari Connect',
          tabBarLabel: 'Profiles',
          tabBarBadge: pendingProfilesCount > 0 ? pendingProfilesCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.warningAmber,
            color: colors.onPrimary,
            fontSize: 10,
            fontWeight: '700',
          },
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{
          headerTitle: 'Karigari Connect',
          tabBarLabel: 'History',
        }}
      />
      <Tab.Screen
        name="Account"
        component={CoordinatorAccountScreen}
        options={{
          headerTitle: 'Karigari Connect',
          tabBarLabel: 'Account',
        }}
      />
    </Tab.Navigator>
  );
}
