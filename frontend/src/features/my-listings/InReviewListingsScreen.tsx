// src/features/my-listings/InReviewListingsScreen.tsx
import React, { useCallback, useState, useLayoutEffect, useMemo } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Platform } from 'react-native';
import { Text, FAB, IconButton, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { service } from '../../services';
import { getDb } from '../../services/database';
import { processOutbox } from '../../services/outbox';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import type { Listing } from '../../types/contracts';
import { useDraftStore, PILOT_STATES } from '../../store/draftStore';
import { ProcessingIndicator } from '../../components';
import { ListingCard } from './ListingCard';

const IN_REVIEW_STATES = new Set([
  'draft',
  'processing',
  'awaiting_confirmation',
  'awaiting_approval',
  'rejected',
  'failed',
]);

export default function InReviewListingsScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const navigation = useNavigation<any>();
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const selectedState = useDraftStore((s) => s.selectedState);
  const selectedZone = useDraftStore((s) => s.selectedZone);

  const currentStateObj = PILOT_STATES.find((s) => s.code === selectedState) || PILOT_STATES[0];
  const currentZoneObj = currentStateObj.zones.find((z) => z.code === selectedZone) || currentStateObj.zones[0];

  const handleStartNewListing = () => {
    navigation.navigate('Capture');
  };

  // Header configuration: Informational location pill only (no onPress, no Switch Role)
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: 'Karigari Connect',
      headerRight: () => (
        <View style={styles.headerRightRow}>
          <View
            style={styles.locationPill}
            accessibilityRole="text"
            accessibilityLabel={t('listings.locationA11y', { location: `${selectedState} ${currentZoneObj?.name || ''}` })}
          >
            <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.primary} />
            <Text style={styles.locationPillText}>
              {selectedState} · {currentZoneObj?.name || t('listings.zone1')}
            </Text>
          </View>
        </View>
      ),
    });
  }, [navigation, selectedState, selectedZone, currentZoneObj, t, colors, styles]);

  const {
    data: listings,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['listings'],
    queryFn: () => service.listListings(),
  });

  const { data: profile } = useQuery({
    queryKey: ['artisan-profile'],
    queryFn: () => service.getArtisanProfile(),
  });

  const checkPendingOutbox = async () => {
    try {
      const db = await getDb();
      const row = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM outbox WHERE status = 'pending'`
      );
      setPendingSyncCount(row?.count ?? 0);
    } catch {
      setPendingSyncCount(0);
    }
  };

  const handleRefresh = async () => {
    try {
      await processOutbox();
    } catch (err) {
      console.error('[InReviewListings] Outbox sync error on pull-to-refresh', err);
    }
    await refetch();
    await checkPendingOutbox();
    queryClient.invalidateQueries({ queryKey: ['listings'] });
  };

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          await processOutbox();
        } catch {}
        if (!cancelled) {
          await checkPendingOutbox();
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const handleCardPress = (listing: Listing) => {
    switch (listing.state) {
      case 'draft':
        useDraftStore.getState().setActiveDraft(listing.id);
        navigation.navigate('Capture');
        break;
      case 'awaiting_confirmation':
        navigation.navigate('ConfirmDetails', {
          draftId: listing.id,
          transcriptId: listing.catalogue?.catalogue?.source?.transcript_id ?? 'transcript_uuid',
        });
        break;
      case 'awaiting_approval':
      case 'rejected':
      case 'failed':
        navigation.navigate('SubmitApproval', { draftId: listing.id });
        break;
      case 'approved':
      case 'export_queued':
      case 'exported':
        navigation.navigate('ApprovedCraftDetail', { draftId: listing.id });
        break;
      default:
        navigation.navigate('Price', { draftId: listing.id });
        break;
    }
  };

  if (isLoading) {
    return <ProcessingIndicator hint={t('listings.loadingInReview')} />;
  }

  const inReviewListings = (listings || []).filter((l) => IN_REVIEW_STATES.has(l.state));
  const awaitingApprovalCount = inReviewListings.filter((l) => l.state === 'awaiting_approval').length;
  const actionNeededCount = inReviewListings.filter(
    (l) => l.state === 'awaiting_confirmation' || l.state === 'rejected' || l.state === 'failed'
  ).length;
  const draftsCount = inReviewListings.filter((l) => l.state === 'draft' || l.state === 'processing').length;

  return (
    <View style={styles.container}>
      {pendingSyncCount > 0 && (
        <View style={styles.syncNotice}>
          <IconButton icon="cloud-sync-outline" size={16} iconColor={colors.secondary} style={{ margin: 0, marginRight: 6 }} />
          <Text style={styles.syncNoticeText}>
            {t('listings.offlineSync', { count: pendingSyncCount })}
          </Text>
        </View>
      )}

      {/* Summary Metrics */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{draftsCount}</Text>
          <Text style={styles.statLabel}>{t('listings.drafts')}</Text>
        </View>
        <View style={[styles.statCard, styles.statCardMiddle]}>
          <Text style={[styles.statNumber, { color: colors.secondary }]}>{awaitingApprovalCount}</Text>
          <Text style={styles.statLabel}>{t('listings.withCoordinator')}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: actionNeededCount > 0 ? colors.error : colors.text }]}>
            {actionNeededCount}
          </Text>
          <Text style={styles.statLabel}>{t('listings.actionNeeded')}</Text>
        </View>
      </View>

      {/* Persistent Artisan Profile Verification Access Banner */}
      <TouchableOpacity
        style={styles.profileBanner}
        onPress={() => navigation.navigate('Profile')}
        activeOpacity={0.7}
      >
        <View style={styles.profileBannerIcon}>
          <MaterialCommunityIcons
            name={
              profile?.profile_status === 'verified'
                ? 'shield-check'
                : profile?.profile_status === 'pending_verification'
                ? 'clock-outline'
                : 'card-account-details-outline'
            }
            size={22}
            color={profile?.profile_status === 'verified' ? colors.secondary : colors.primary}
          />
        </View>
        <View style={styles.profileBannerTextContainer}>
          <Text style={styles.profileBannerTitle}>
            {profile?.profile_status === 'verified'
              ? t('listings.verifiedProfile', { level: t(`skillLevels.${profile?.verified_skill_level}`, { defaultValue: profile?.verified_skill_level?.replace(/_/g, ' ') }) })
              : profile?.profile_status === 'pending_verification'
              ? t('listings.profileInReview')
              : t('listings.completeProfile')}
          </Text>
          <Text style={styles.profileBannerSub}>
            {profile?.profile_status === 'verified'
              ? t('listings.verifiedProfileSub')
              : t('listings.unverifiedProfileSub')}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.placeholder} />
      </TouchableOpacity>

      <FlatList
        data={inReviewListings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <IconButton icon="clock-outline" size={36} iconColor={colors.secondary} style={{ margin: 0 }} />
            </View>
            <Text style={styles.emptyTitle}>{t('listings.reviewEmptyTitle')}</Text>
            <Text style={styles.emptySubtitle}>
              {t('listings.reviewEmptyText')}
            </Text>
            <Button
              mode="contained"
              onPress={handleStartNewListing}
              buttonColor={colors.primary}
              textColor={colors.onPrimary}
              style={styles.emptyActionBtn}
              icon="plus"
            >
              {t('listings.startDraft')}
            </Button>
          </View>
        }
        renderItem={({ item }) => (
          <ListingCard item={item} onPress={handleCardPress} />
        )}
      />

      <View style={styles.fabWrapper}>
        <FAB
          mode="flat"
          icon="plus"
          label={t('listings.newCraft')}
          color={colors.onPrimary}
          style={{ backgroundColor: colors.primary, borderRadius: 28 }}
          onPress={handleStartNewListing}
        />
      </View>
    </View>
  );
}

function createStyles(colors: ColorPalette, isDark: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerRightRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginRight: 16,
    },
    locationPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    locationPillText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
      marginLeft: 4,
    },
    syncNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.badgeNeutral,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    syncNoticeText: {
      fontSize: 12,
      color: colors.secondary,
      fontWeight: '500',
    },
    statsContainer: {
      flexDirection: 'row',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    statCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 8,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    statCardMiddle: {
      marginHorizontal: spacing.sm,
    },
    statNumber: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 2,
    },
    statLabel: {
      fontSize: 11,
      color: colors.textMuted,
      fontWeight: '600',
      textAlign: 'center',
    },
    profileBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.indigoLight,
      marginHorizontal: spacing.md,
      marginTop: spacing.xs,
      marginBottom: spacing.xs,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.indigoBorder,
    },
    profileBannerIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: isDark ? colors.indigoBorder : '#DBEAFE',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    profileBannerTextContainer: {
      flex: 1,
    },
    profileBannerTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.secondary,
    },
    profileBannerSub: {
      fontSize: 11,
      color: isDark ? colors.textMuted : colors.secondary,
      marginTop: 1,
      lineHeight: 15,
    },
    listContent: {
      padding: spacing.md,
      paddingBottom: 90,
    },
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 60,
      paddingHorizontal: spacing.xl,
    },
    emptyIconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.badgeNeutral,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      marginBottom: spacing.sm,
      textAlign: 'center',
    },
    emptySubtitle: {
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 19,
      marginBottom: spacing.lg,
    },
    emptyActionBtn: {
      borderRadius: 10,
    },
    fabWrapper: {
      position: 'absolute',
      margin: 16,
      right: 0,
      bottom: Platform.OS === 'ios' ? 96 : 88,
      borderRadius: 28,
      backgroundColor: colors.primary,
      elevation: 4,
    },
  });
}
