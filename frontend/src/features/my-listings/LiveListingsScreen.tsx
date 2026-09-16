// src/features/my-listings/LiveListingsScreen.tsx
import React, { useCallback, useState, useLayoutEffect } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, Platform } from 'react-native';
import { Text, FAB, IconButton, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { service } from '../../services';
import { getDb } from '../../services/database';
import { processOutbox } from '../../services/outbox';
import { colors, spacing } from '../../theme';
import type { Listing } from '../../types/contracts';
import { useDraftStore, PILOT_STATES } from '../../store/draftStore';
import { ProcessingIndicator } from '../../components';
import { ListingCard } from './ListingCard';

const LIVE_STATES = new Set(['approved', 'export_queued', 'exported']);

export default function LiveListingsScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const navigation = useNavigation<any>();

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
  }, [navigation, selectedState, selectedZone, currentZoneObj, t]);

  const {
    data: listings,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['listings'],
    queryFn: () => service.listListings(),
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
      console.error('[LiveListings] Outbox sync error on pull-to-refresh', err);
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
    navigation.navigate('Price', { draftId: listing.id });
  };

  if (isLoading) {
    return <ProcessingIndicator hint={t('listings.loading')} />;
  }

  const liveListings = (listings || []).filter((l) => LIVE_STATES.has(l.state));
  const approvedCount = (listings || []).filter((l) => l.state === 'approved').length;
  const exportedCount = (listings || []).filter((l) => l.state === 'exported').length;

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

      {/* Live Market Summary Card */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{liveListings.length}</Text>
          <Text style={styles.statLabel}>{t('listings.marketReady')}</Text>
        </View>
        <View style={[styles.statCard, styles.statCardMiddle]}>
          <Text style={[styles.statNumber, { color: colors.secondary }]}>{exportedCount}</Text>
          <Text style={styles.statLabel}>{t('listings.liveOnOndc')}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: colors.primary }]}>{approvedCount}</Text>
          <Text style={styles.statLabel}>{t('listings.coordinatorApproved')}</Text>
        </View>
      </View>

      <FlatList
        data={liveListings}
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
              <IconButton icon="package-variant-closed" size={36} iconColor={colors.secondary} style={{ margin: 0 }} />
            </View>
            <Text style={styles.emptyTitle}>{t('listings.liveEmptyTitle')}</Text>
            <Text style={styles.emptySubtitle}>
              {t('listings.liveEmptyText')}
            </Text>
            <Button
              mode="contained"
              onPress={handleStartNewListing}
              buttonColor={colors.primary}
              textColor="#FFFFFF"
              style={styles.emptyActionBtn}
              icon="plus"
            >
              {t('listings.addNewCraft')}
            </Button>
          </View>
        }
        renderItem={({ item }) => (
          <ListingCard item={item} onPress={handleCardPress} />
        )}
      />

      <FAB
        icon="plus"
        label={t('listings.newCraft')}
        style={styles.fab}
        color="#FFFFFF"
        onPress={handleStartNewListing}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.sm,
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
    backgroundColor: '#FFFFFF',
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
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: Platform.OS === 'ios' ? 96 : 88,
    backgroundColor: colors.primary,
    borderRadius: 28,
  },
});
