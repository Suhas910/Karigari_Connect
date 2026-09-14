// src/features/coordinator-review/ReviewQueueScreen.tsx
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../../store/authStore';
import type { CoordinatorStackParamList } from '../../types/navigation';
import type { Listing } from '../../types/contracts';
import { service } from '../../services';
import { colors, spacing } from '../../theme';
import { ErrorRetryCard, ProcessingIndicator } from '../../components';
import MediaImage from '../../components/MediaImage';

const TABS = [
  { key: 'awaiting_approval', label: 'To review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Sent back' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const toWords = (id?: string | null) => (id ?? '').replace(/_/g, ' ');

export default function ReviewQueueScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CoordinatorStackParamList>>();
  const [tab, setTab] = useState<TabKey>('awaiting_approval');
  const { data: listings, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['coordinatorListings'],
    queryFn: () => service.listListings(),
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  useLayoutEffect(() => {
    const switchRole = async () => {
      try {
        await SecureStore.deleteItemAsync('userToken');
      } catch {}
      useAuthStore.getState().logout();
    };
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={switchRole}
          style={styles.switchRoleBtn}
          accessibilityRole="button"
          accessibilityLabel="Switch Role"
        >
          <Text style={styles.switchRoleText}>Switch Role</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  if (isLoading) {
    return <ProcessingIndicator hint="Loading the review queue..." />;
  }
  if (isError) {
    return (
      <ErrorRetryCard
        errorText="Could not load listings. Check connection and try again."
        onRetry={() => refetch()}
      />
    );
  }

  const all = listings ?? [];
  const shown = all.filter((listing) => listing.state === tab);

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = tab === t.key;
          const count = all.filter((listing) => listing.state === t.key).length;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {t.label} ({count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {tab === 'awaiting_approval' ? 'Nothing is waiting for review.' : 'No listings here.'}
          </Text>
        }
        renderItem={({ item }) => (
          <QueueCard listing={item} onPress={() => navigation.navigate('ListingReview', { listingId: item.id })} />
        )}
      />
    </View>
  );
}

function QueueCard({ listing, onPress }: { listing: Listing; onPress: () => void }) {
  const cat = listing.catalogue?.catalogue;
  const photo = listing.media?.find((m) => m.kind === 'image' && m.variant === 'original')?.url;
  const pending = (listing.claims ?? []).filter((c) => c.asserted_by_artisan && !c.coordinator_verified).length;
  const isDemo = cat?.source?.catalogue_provider === 'fixture';
  const meta = [toWords(cat?.category), (cat?.materials ?? []).map(toWords).join(', ')].filter(Boolean).join(' · ');

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Review ${cat?.title?.en || 'untitled listing'}`}
    >
      <MediaImage url={photo} style={styles.thumb} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {cat?.title?.en || 'Untitled listing'}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {meta || 'No product details yet'}
        </Text>
        <View style={styles.badges}>
          {pending > 0 && (
            <Text style={[styles.badge, styles.badgeWarn]}>
              {pending} claim{pending > 1 ? 's' : ''} to review
            </Text>
          )}
          {listing.price?.status === 'available' ? (
            <Text style={styles.badge}>
              Floor ₹{Math.round(listing.price.floor_amount_paise / 100).toLocaleString('en-IN')}
            </Text>
          ) : (
            <Text style={[styles.badge, styles.badgeWarn]}>No price</Text>
          )}
          {isDemo && <Text style={[styles.badge, styles.badgeWarn]}>Demo details</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.indigoLight, borderColor: colors.secondary },
  tabText: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  tabTextActive: { color: colors.secondary, fontWeight: '700' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.badgeNeutral },
  cardBody: { flex: 1, marginLeft: spacing.sm, justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2, textTransform: 'capitalize' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.badgeNeutral,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  badgeWarn: { color: colors.error },
  switchRoleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: spacing.sm,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.indigoBorder,
    backgroundColor: colors.indigoLight,
  },
  switchRoleText: { fontSize: 12, fontWeight: '700', color: colors.secondary },
});
