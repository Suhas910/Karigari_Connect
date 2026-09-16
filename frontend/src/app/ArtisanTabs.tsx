// src/app/ArtisanTabs.tsx
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import LiveListingsScreen from '../features/my-listings/LiveListingsScreen';
import InReviewListingsScreen from '../features/my-listings/InReviewListingsScreen';
import HelpScreen from '../features/help/HelpScreen';
import ArtisanProfileScreen from '../features/profile/ArtisanProfileScreen';
import GlassTabBar from '../components/GlassTabBar';
import { colors } from '../theme';
import type { ArtisanTabParamList } from '../types/navigation';

const Tab = createBottomTabNavigator<ArtisanTabParamList>();

export default function ArtisanTabs() {
  const { t } = useTranslation();
  return (
    <Tab.Navigator
      initialRouteName="MyListings"
      tabBar={(props) => <GlassTabBar {...props} variant="artisan" />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitle: 'Karigari Connect',
        headerTitleStyle: {
          fontWeight: '800',
          fontSize: 20,
          color: colors.text,
        },
        headerShadowVisible: false,
      }}
    >
      <Tab.Screen
        name="MyListings"
        component={LiveListingsScreen}
        options={{
          headerTitle: 'Karigari Connect',
          tabBarLabel: t('tabs.myListings'),
        }}
      />
      <Tab.Screen
        name="InReview"
        component={InReviewListingsScreen}
        options={{
          headerTitle: 'Karigari Connect',
          tabBarLabel: t('tabs.inReview'),
        }}
      />
      <Tab.Screen
        name="Help"
        component={HelpScreen}
        options={{
          headerTitle: 'Karigari Connect',
          tabBarLabel: t('tabs.help'),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ArtisanProfileScreen}
        options={{
          headerTitle: 'Karigari Connect',
          tabBarLabel: t('tabs.profile'),
        }}
      />
    </Tab.Navigator>
  );
}

