// src/features/coordinator-review/CoordinatorAccountScreen.tsx
import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { Text, Card, ActivityIndicator, Switch, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuthStore } from '../../store/authStore';
import { service } from '../../services';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import type { CoordinatorStackParamList } from '../../types/navigation';
import { SettingsRow } from '../profile/SettingsRow';

export default function CoordinatorAccountScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<CoordinatorStackParamList>>();
  const { userId, logout } = useAuthStore();
  const { colors, isDark } = useAppTheme();

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const handleSwitchRole = async () => {
    try {
      await SecureStore.deleteItemAsync('userToken');
      await SecureStore.deleteItemAsync('userRole');
      await SecureStore.deleteItemAsync('userId');
    } catch {}
    logout();
  };

  // 1. Fetch dynamic coordinator profile
  const {
    data: profile,
    isLoading: isLoadingProfile,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ['coordinatorProfile'],
    queryFn: () => service.getArtisanProfile(),
    staleTime: 10000,
  });

  // 2. Fetch support messages summary
  const {
    data: supportMessages,
    isLoading: isLoadingMessages,
    isRefetching: isRefetchingMessages,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ['supportMessages'],
    queryFn: () => service.getSupportMessages(),
    retry: 1,
    staleTime: 10000,
  });

  const handleRefresh = async () => {
    await Promise.all([refetchProfile(), refetchMessages()]);
  };

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Craft Supervisor';
  const username = profile?.username || userId || 'coord_demo';
  const jurisdiction = profile?.declared_zone || 'Karnataka & Uttar Pradesh Handloom Clusters';
  const openInquiriesCount = supportMessages?.filter((m) => m.status === 'open').length || 0;
  const latestMessage = supportMessages && supportMessages.length > 0 ? supportMessages[0] : null;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefetchingMessages}
          onRefresh={handleRefresh}
          colors={[colors.secondary]}
        />
      }
    >
      <View style={styles.header}>
        <Text style={styles.kicker}>CLUSTER COORDINATOR</Text>
        <Text style={styles.title}>Account & Overview</Text>
        <Text style={styles.subtitle}>
          Active supervisor session, assigned craft clusters, and artisan inquiries.
        </Text>
      </View>

      {/* Coordinator Identity Card */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => navigation.navigate('CoordinatorProfile')}
      >
        <Card style={styles.identityCard}>
          <Card.Content style={styles.identityCardContent}>
            <View style={styles.avatarCircle}>
              <MaterialCommunityIcons name="shield-account" size={32} color={colors.secondary} />
            </View>
            <View style={styles.identityInfo}>
              <View style={styles.identityRow}>
                <Text style={styles.identityName}>{fullName}</Text>
                <View style={styles.coordinatorBadge}>
                  <Text style={styles.coordinatorBadgeText}>Coordinator</Text>
                </View>
              </View>
              <Text style={styles.identitySub}>
                @{username} · MoSJE Field Supervisor
              </Text>
              <Text style={styles.jurisdictionText} numberOfLines={2}>
                Jurisdiction: {jurisdiction}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} style={styles.identityChevron} />
          </Card.Content>
        </Card>
      </TouchableOpacity>

      {/* Artisan Support Inquiries Card Box */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Artisan Inquiries</Text>
        {openInquiriesCount > 0 && (
          <View style={styles.openCountBadge}>
            <Text style={styles.openCountText}>{openInquiriesCount} Open</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => navigation.navigate('ArtisanInquiriesList')}
      >
        <Card style={styles.inquiriesBoxCard}>
          <Card.Content>
            <View style={styles.inquiriesHeaderRow}>
              <View style={styles.inquiriesIconTitle}>
                <View style={styles.inquiriesIconWrap}>
                  <MaterialCommunityIcons name="message-question-outline" size={20} color={colors.secondary} />
                </View>
                <View>
                  <Text style={styles.inquiriesTitle}>Artisan Support Queue</Text>
                  <Text style={styles.inquiriesSub}>
                    {supportMessages?.length ?? 0} total tickets ({openInquiriesCount} open)
                  </Text>
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.secondary} />
            </View>

            <Divider style={styles.inquiryDivider} />

            {isLoadingMessages ? (
              <ActivityIndicator size="small" color={colors.secondary} style={{ paddingVertical: 12 }} />
            ) : latestMessage ? (
              <View style={styles.latestInquiryPreview}>
                <View style={styles.previewTop}>
                  <Text style={styles.previewArtisan}>
                    Latest: {latestMessage.artisan_name || `Artisan #${latestMessage.artisan_id}`}
                  </Text>
                  <Text style={styles.previewTime}>
                    {latestMessage.created_at ? new Date(latestMessage.created_at).toLocaleDateString() : 'Recent'}
                  </Text>
                </View>
                {latestMessage.listing_title && (
                  <Text style={styles.previewCraft} numberOfLines={1}>
                    Craft: {latestMessage.listing_title}
                  </Text>
                )}
                <Text style={styles.previewMessage} numberOfLines={2}>
                  "{latestMessage.message}"
                </Text>
              </View>
            ) : (
              <View style={styles.emptyPreviewBox}>
                <MaterialCommunityIcons name="check-circle-outline" size={18} color={colors.successGreen} />
                <Text style={styles.emptyPreviewText}>All artisan inquiries resolved</Text>
              </View>
            )}
          </Card.Content>
        </Card>
      </TouchableOpacity>

      {/* Settings & Session Management */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Preferences</Text>
      </View>

      <View style={styles.settingsCard}>
        <SettingsRow
          icon={isDark ? 'weather-night' : 'weather-sunny'}
          iconBgColor={isDark ? colors.indigoLight : colors.primaryLight}
          iconColor={isDark ? colors.secondary : colors.primary}
          title={t('profile.appTheme')}
          subtitle={isDark ? t('profile.darkMode') : t('profile.lightMode')}
          showDivider={false}
          onPress={() => {
            const { setTheme, themeMode } = require('../../store/themeStore').useThemeStore.getState();
            setTheme(themeMode === 'dark' ? 'light' : 'dark');
          }}
          rightElement={
            <Switch
              value={isDark}
              onValueChange={(val) => {
                const { setTheme } = require('../../store/themeStore').useThemeStore.getState();
                setTheme(val ? 'dark' : 'light');
              }}
              color={colors.primary}
            />
          }
        />
      </View>

      {/* Logout Pill */}
      <TouchableOpacity
        style={styles.logoutPillButton}
        onPress={handleSwitchRole}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Sign out of coordinator session"
      >
        <View style={styles.logoutLeft}>
          <MaterialCommunityIcons name="logout-variant" size={18} color={colors.secondary} />
          <Text style={styles.logoutText}>Sign Out / Switch Role</Text>
        </View>
      </TouchableOpacity>
    </ScrollView>
  );
}

function createStyles(colors: ColorPalette, isDark: boolean) {
  return StyleSheet.create({
    container: {
      padding: spacing.md,
      paddingBottom: 100,
      backgroundColor: colors.background,
      flexGrow: 1,
    },
    header: {
      marginBottom: spacing.md,
    },
    kicker: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.2,
      color: colors.secondary,
      marginBottom: 4,
    },
    title: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 18,
    },
    identityCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    identityCardContent: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.sm,
    },
    avatarCircle: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.indigoLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.sm,
    },
    identityInfo: {
      flex: 1,
    },
    identityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    identityName: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    coordinatorBadge: {
      backgroundColor: colors.indigoLight,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    coordinatorBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.secondary,
    },
    identitySub: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    jurisdictionText: {
      fontSize: 12,
      color: colors.secondary,
      marginTop: 2,
      fontWeight: '500',
    },
    identityChevron: {
      marginLeft: spacing.xs,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    openCountBadge: {
      backgroundColor: colors.warningLight,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
    },
    openCountText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.warningText,
    },
    inquiriesBoxCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    inquiriesHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    inquiriesIconTitle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    inquiriesIconWrap: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.indigoLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    inquiriesTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    inquiriesSub: {
      fontSize: 12,
      color: colors.textMuted,
    },
    inquiryDivider: {
      marginVertical: spacing.sm,
      backgroundColor: colors.border,
    },
    latestInquiryPreview: {
      backgroundColor: colors.badgeNeutral,
      padding: spacing.sm,
      borderRadius: 8,
    },
    previewTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 2,
    },
    previewArtisan: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
    },
    previewTime: {
      fontSize: 11,
      color: colors.textMuted,
    },
    previewCraft: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.primary,
      marginBottom: 2,
    },
    previewMessage: {
      fontSize: 12,
      color: colors.textMuted,
      lineHeight: 16,
      fontStyle: 'italic',
    },
    emptyPreviewBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.xs,
    },
    emptyPreviewText: {
      fontSize: 13,
      color: colors.successGreen,
      fontWeight: '500',
    },
    settingsCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: spacing.md,
    },
    logoutPillButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.badgeNeutral,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      height: spacing.tapTarget,
      marginTop: spacing.xs,
    },
    logoutLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    logoutText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.secondary,
    },
    logoutHandle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      maxWidth: 120,
    },
  });
}
