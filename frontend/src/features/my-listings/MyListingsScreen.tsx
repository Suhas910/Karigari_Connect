import React, { useCallback, useState, useLayoutEffect } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Image, ScrollView } from 'react-native';
import { Text, FAB, IconButton, Button } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { service } from '../../services';
import { getDb } from '../../services/database';
import { processOutbox } from '../../services/outbox';
import { colors, spacing } from '../../theme';
import type { Listing, ListingState } from '../../types/contracts';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArtisanStackParamList } from '../../types/navigation';
import { useDraftStore } from '../../store/draftStore';
import { ProcessingIndicator } from '../../components';
import MediaImage from '../../components/MediaImage';

// --- State visual metadata mapping ---
const STATE_META: Record<ListingState, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: colors.text, bg: colors.badgeNeutral },
  processing: { label: 'Processing', color: colors.text, bg: colors.badgeNeutral },
  awaiting_confirmation: { label: 'Needs Confirm', color: '#FFFFFF', bg: colors.primary },
  awaiting_approval: { label: 'In Review', color: colors.secondary, bg: colors.indigoLight },
  approved: { label: 'Approved', color: '#FFFFFF', bg: colors.secondary },
  export_queued: { label: 'Export Queued', color: colors.text, bg: colors.badgeNeutral },
  exported: { label: 'Live on Market', color: '#FFFFFF', bg: colors.secondary },
  rejected: { label: 'Needs Revision', color: '#FFFFFF', bg: colors.error },
  failed: { label: 'Failed', color: '#FFFFFF', bg: colors.error },
};

export default function MyListingsScreen() {
  const queryClient = useQueryClient();
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [activeTab, setActiveTab] = useState<'all' | 'in_progress' | 'approved' | 'action_needed'>('all');
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();

  const handleSwitchRole = async () => {
    await useAuthStore.getState().logout();
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={handleSwitchRole}
          style={styles.switchRoleBtn}
          accessibilityRole="button"
          accessibilityLabel="Switch Role"
        >
          <Text style={styles.switchRoleText}>Switch Role</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

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
      console.error('[MyListings] Outbox sync error on pull-to-refresh', err);
    }
    await refetch();
    await checkPendingOutbox();
    queryClient.invalidateQueries({ queryKey: ['listings'] });
  };

  // Check local outbox for unsynced mutations and attempt flush every time screen gains focus.
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
      case 'rejected':
        // Back to the saved details, with the coordinator's reason shown on the card.
        navigation.navigate('ConfirmDetails', { draftId: listing.id });
        break;
      case 'draft':
      case 'failed':
        useDraftStore.getState().setActiveDraft(listing.id);
        navigation.navigate('Capture');
        break;
      case 'awaiting_confirmation':
        navigation.navigate('ConfirmDetails', {
          draftId: listing.id,
          transcriptId: listing.catalogue?.catalogue.source?.transcript_id,
        });
        break;
      case 'awaiting_approval':
      case 'approved':
      case 'export_queued':
      case 'exported':
        navigation.navigate('Price', { draftId: listing.id });
        break;
    }
  };

  if (isLoading) {
    return <ProcessingIndicator hint="Loading your crafts..." />;
  }

  const allCount = listings?.length ?? 0;
  const approvedCount = listings?.filter((l) => l.state === 'approved' || l.state === 'exported').length ?? 0;
  const actionNeededCount = listings?.filter((l) => l.state === 'awaiting_confirmation' || l.state === 'rejected' || l.state === 'failed').length ?? 0;
  const inProgressCount = allCount - approvedCount - actionNeededCount;

  const filteredListings = (listings || []).filter((item) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'approved') return item.state === 'approved' || item.state === 'exported';
    if (activeTab === 'action_needed') return item.state === 'awaiting_confirmation' || item.state === 'rejected' || item.state === 'failed';
    if (activeTab === 'in_progress') return item.state === 'draft' || item.state === 'processing' || item.state === 'awaiting_approval' || item.state === 'export_queued';
    return true;
  });

  return (
    <View style={styles.container}>
      {pendingSyncCount > 0 && (
        <View style={styles.syncNotice}>
          <IconButton icon="cloud-sync-outline" size={16} iconColor={colors.secondary} style={{ margin: 0, marginRight: 6 }} />
          <Text style={styles.syncNoticeText}>
            {pendingSyncCount} update{pendingSyncCount > 1 ? 's' : ''} saved offline · Syncs automatically
          </Text>
        </View>
      )}

      {/* Overview Metric Cards */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{allCount}</Text>
          <Text style={styles.statLabel}>Total Crafts</Text>
        </View>
        <View style={[styles.statCard, styles.statCardMiddle]}>
          <Text style={[styles.statNumber, { color: colors.secondary }]}>{inProgressCount}</Text>
          <Text style={styles.statLabel}>In Progress</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: colors.primary }]}>{approvedCount}</Text>
          <Text style={styles.statLabel}>Market Ready</Text>
        </View>
      </View>

      {/* Horizontal Filter Tabs */}
      <View style={styles.filterTabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterTabsContent}>
          <TouchableOpacity
            style={[styles.filterChip, activeTab === 'all' && styles.filterChipActive]}
            onPress={() => setActiveTab('all')}
            accessibilityRole="tab"
          >
            <Text style={[styles.filterChipText, activeTab === 'all' && styles.filterChipTextActive]}>
              All ({allCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, activeTab === 'in_progress' && styles.filterChipActive]}
            onPress={() => setActiveTab('in_progress')}
            accessibilityRole="tab"
          >
            <Text style={[styles.filterChipText, activeTab === 'in_progress' && styles.filterChipTextActive]}>
              In Progress ({inProgressCount})
            </Text>
          </TouchableOpacity>

          {actionNeededCount > 0 && (
            <TouchableOpacity
              style={[styles.filterChip, activeTab === 'action_needed' && styles.filterChipActive]}
              onPress={() => setActiveTab('action_needed')}
              accessibilityRole="tab"
            >
              <Text style={[styles.filterChipText, activeTab === 'action_needed' && styles.filterChipTextActive]}>
                Action Needed ({actionNeededCount})
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.filterChip, activeTab === 'approved' && styles.filterChipActive]}
            onPress={() => setActiveTab('approved')}
            accessibilityRole="tab"
          >
            <Text style={[styles.filterChipText, activeTab === 'approved' && styles.filterChipTextActive]}>
              Approved ({approvedCount})
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <FlatList
        data={filteredListings}
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
            <Text style={styles.emptyTitle}>
              {activeTab === 'all' ? 'No craft listings yet' : 'No matching listings'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {activeTab === 'all'
                ? 'Document your craft with AI-guided photography, voice stories, and fair wage protection.'
                : 'Switch filters or tap below to start a new listing.'}
            </Text>
            {activeTab === 'all' && (
              <Button
                mode="contained"
                onPress={() => navigation.navigate('Capture')}
                buttonColor={colors.primary}
                textColor="#FFFFFF"
                style={styles.emptyActionBtn}
                icon="plus"
              >
                Create First Listing
              </Button>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const meta = STATE_META[item.state] || { label: item.state, color: colors.text, bg: colors.badgeNeutral };
          const titleEn = item.catalogue?.catalogue.title.en;
          const titleLocal = item.catalogue?.catalogue.title.local;
          const category = item.catalogue?.catalogue.category?.replace(/_/g, ' ');
          const firstPhoto = item.media?.find((m) => m.kind === 'image')?.url;
          const priceFloor = item.price?.floor_amount_paise ? Math.round(item.price.floor_amount_paise / 100) : null;
          const priceHigh = item.price?.recommended_high_paise ? Math.round(item.price.recommended_high_paise / 100) : null;

          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => handleCardPress(item)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Listing: ${titleEn || 'Untitled craft draft'}`}
            >
              <View style={styles.cardMainRow}>
                {/* Craft Thumbnail or Category Icon */}
                <View style={styles.thumbnailContainer}>
                  {firstPhoto ? (
                    <MediaImage url={firstPhoto} style={styles.thumbnailImage} />
                  ) : (
                    <View style={styles.thumbnailPlaceholder}>
                      <IconButton
                        icon={category ? 'palette-swatch-outline' : 'image-outline'}
                        size={22}
                        iconColor={colors.secondary}
                        style={{ margin: 0 }}
                      />
                    </View>
                  )}
                </View>

                {/* Craft Details Stack */}
                <View style={styles.cardDetails}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {titleEn || 'Untitled craft draft'}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: meta.color }]}>
                        {meta.label}
                      </Text>
                    </View>
                  </View>

                  {titleLocal && titleLocal !== titleEn && (
                    <Text style={styles.cardLocalTitle} numberOfLines={1}>
                      {titleLocal}
                    </Text>
                  )}

                  <View style={styles.metaRow}>
                    {category && (
                      <View style={styles.categoryPill}>
                        <Text style={styles.categoryText}>
                          {category.charAt(0).toUpperCase() + category.slice(1)}
                        </Text>
                      </View>
                    )}
                    {priceFloor ? (
                      <Text style={styles.priceHighlight}>
                        ₹{priceFloor} {priceHigh ? `- ₹${priceHigh}` : 'floor'}
                      </Text>
                    ) : (
                      <Text style={styles.metaText}>
                        Updated {new Date(item.updated_at).toLocaleDateString()}
                      </Text>
                    )}
                  </View>

                  {item.state === 'rejected' && item.rejection_reason ? (
                    <Text style={styles.rejectionText} numberOfLines={3}>
                      Coordinator: {item.rejection_reason}
                    </Text>
                  ) : null}
                </View>

                <IconButton
                  icon="chevron-right"
                  size={20}
                  iconColor={colors.textMuted}
                  style={{ margin: 0, alignSelf: 'center' }}
                />
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <FAB
        icon="plus"
        label="New Product"
        style={styles.fab}
        color="#FFFFFF"
        onPress={() => navigation.navigate('Capture')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  rejectionText: { color: colors.error, fontSize: 12, lineHeight: 16, marginTop: 6 },
  switchRoleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.indigoBorder,
    backgroundColor: colors.indigoLight,
  },
  switchRoleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary,
  },
  syncNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.indigoLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.indigoBorder,
    paddingVertical: 6,
    paddingHorizontal: spacing.lg,
  },
  syncNoticeText: {
    color: colors.secondary,
    fontSize: 12,
    fontWeight: '500',
  },
  statsContainer: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  statCardMiddle: {
    borderColor: colors.indigoBorder,
    backgroundColor: '#FAFBFD',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
    marginTop: 2,
  },
  filterTabsContainer: {
    marginVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
  },
  filterTabsContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  filterChipText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: 110,
  },
  card: {
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  cardMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbnailContainer: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#EDE7DD',
    marginRight: spacing.md,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.indigoLight,
  },
  cardDetails: {
    flex: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  cardLocalTitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
    fontStyle: 'italic',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 4,
  },
  categoryPill: {
    backgroundColor: colors.badgeNeutral,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryText: {
    fontSize: 11,
    color: colors.badgeNeutralText,
    fontWeight: '500',
  },
  priceHighlight: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  metaText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.indigoLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
    marginBottom: spacing.lg,
  },
  emptyActionBtn: {
    borderRadius: 8,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 28,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
});