import React, { useCallback, useState, useLayoutEffect } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Image, ScrollView, Modal, Pressable } from 'react-native';
import { Text, FAB, IconButton, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
import { useDraftStore, PILOT_STATES } from '../../store/draftStore';
import { ProcessingIndicator } from '../../components';

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
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();

  const selectedState = useDraftStore((s) => s.selectedState);
  const selectedZone = useDraftStore((s) => s.selectedZone);
  const setSelectedState = useDraftStore((s) => s.setSelectedState);
  const setSelectedZone = useDraftStore((s) => s.setSelectedZone);

  const currentStateObj = PILOT_STATES.find((s) => s.code === selectedState) || PILOT_STATES[0];
  const currentZoneObj = currentStateObj.zones.find((z) => z.code === selectedZone) || currentStateObj.zones[0];

  const handleSwitchRole = async () => {
    await useAuthStore.getState().logout();
  };

  const handleStartNewListing = () => {
    navigation.navigate('Capture');
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRightRow}>
          <TouchableOpacity
            onPress={() => setLocationModalVisible(true)}
            style={styles.locationBtn}
            accessibilityRole="button"
            accessibilityLabel={`Location: ${selectedState} ${currentZoneObj?.name || ''}`}
          >
            <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.primary} />
            <Text style={styles.locationBtnText}>{selectedState} · {currentZoneObj?.name || 'Zone 1'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSwitchRole}
            style={styles.switchRoleBtn}
            accessibilityRole="button"
            accessibilityLabel="Switch Role"
          >
            <Text style={styles.switchRoleText}>Switch Role</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, selectedState, selectedZone, currentZoneObj]);

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
      case 'processing':
      case 'awaiting_approval':
      case 'approved':
      case 'export_queued':
      case 'exported':
      case 'rejected':
      case 'failed':
        navigation.navigate('ListingStatus', {
          listingId: listing.id,
          state: listing.state,
        });
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

      {/* Persistent Artisan Profile Quick-Access Banner */}
      <TouchableOpacity
        style={styles.profileBanner}
        onPress={() => navigation.navigate('ArtisanProfile')}
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
            color={profile?.profile_status === 'verified' ? '#1E40AF' : colors.primary}
          />
        </View>
        <View style={styles.profileBannerTextContainer}>
          <Text style={styles.profileBannerTitle}>
            {profile?.profile_status === 'verified'
              ? `Verified Profile · ${profile?.verified_skill_level?.replace(/_/g, ' ')}`
              : profile?.profile_status === 'pending_verification'
              ? 'Profile Verification in Review'
              : 'Complete Your Artisan Profile'}
          </Text>
          <Text style={styles.profileBannerSub}>
            {profile?.profile_status === 'verified'
              ? 'One-time verification active across all your listings'
              : 'Get verified once to unlock statutory rates without claim review'}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color="#9CA3AF" />
      </TouchableOpacity>

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
                onPress={handleStartNewListing}
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
          const titleEn = item.catalogue?.catalogue?.title?.en;
          const titleLocal = item.catalogue?.catalogue?.title?.local;
          const category = item.catalogue?.catalogue?.category?.replace(/_/g, ' ');
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
                    <Image source={{ uri: firstPhoto }} style={styles.thumbnailImage} />
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
        label="New Craft"
        style={styles.fab}
        color="#FFFFFF"
        onPress={handleStartNewListing}
      />

      {/* State / Location Selector Modal */}
      <Modal
        visible={locationModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLocationModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setLocationModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Artisan Location / State</Text>
                <Text style={styles.modalSubtitle}>
                  Used for official statutory minimum wage lookup
                </Text>
              </View>
              <IconButton
                icon="close"
                size={22}
                onPress={() => setLocationModalVisible(false)}
                iconColor={colors.text}
                style={{ margin: 0 }}
              />
            </View>

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalSectionLabel}>1. SELECT STATE</Text>
              <View style={styles.stateList}>
                {PILOT_STATES.map((st) => {
                  const isSelected = selectedState === st.code;
                  return (
                    <TouchableOpacity
                      key={st.code}
                      style={[styles.stateOptionCard, isSelected && styles.stateOptionSelected]}
                      onPress={() => setSelectedState(st.code)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.stateOptionLeft}>
                        <View style={styles.stateCodeRow}>
                          <Text style={[styles.stateName, isSelected && styles.stateNameSelected]}>
                            {st.name}
                          </Text>
                          <View style={[styles.stateBadge, isSelected && styles.stateBadgeSelected]}>
                            <Text style={[styles.stateBadgeText, isSelected && styles.stateBadgeTextSelected]}>
                              {st.code}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.stateNote}>{st.note}</Text>
                      </View>
                      <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                        {isSelected && <View style={styles.radioDot} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Zone selection for states with multiple zones */}
              {currentStateObj.zones.length > 1 && (
                <View style={styles.zoneModalSection}>
                  <Text style={styles.modalSectionLabel}>2. SELECT WAGE ZONE ({currentStateObj.code})</Text>
                  <View style={styles.stateList}>
                    {currentStateObj.zones.map((z) => {
                      const isZoneSelected = selectedZone === z.code;
                      return (
                        <TouchableOpacity
                          key={z.code}
                          style={[styles.stateOptionCard, isZoneSelected && styles.stateOptionSelected]}
                          onPress={() => setSelectedZone(z.code)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.stateOptionLeft}>
                            <Text style={[styles.stateName, isZoneSelected && styles.stateNameSelected]}>
                              {z.name}
                            </Text>
                            <Text style={styles.stateNote}>{z.note}</Text>
                          </View>
                          <View style={[styles.radioCircle, isZoneSelected && styles.radioCircleSelected]}>
                            {isZoneSelected && <View style={styles.radioDot} />}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </ScrollView>

            <Button
              mode="contained"
              onPress={() => setLocationModalVisible(false)}
              buttonColor={colors.primary}
              textColor="#FFFFFF"
              style={styles.modalCloseBtn}
            >
              Done
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginRight: spacing.sm,
  },
  locationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  locationBtnIcon: {
    fontSize: 12,
  },
  locationBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  switchRoleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
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
  profileBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: spacing.sm,
  },
  profileBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FDF7F4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileBannerTextContainer: {
    flex: 1,
  },
  profileBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
  },
  profileBannerSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.52)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    elevation: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  modalSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.8,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  zoneModalSection: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  stateList: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  stateOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  stateOptionSelected: {
    borderColor: colors.secondary,
    backgroundColor: colors.indigoLight,
  },
  stateOptionLeft: {
    flex: 1,
  },
  stateCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  stateName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  stateNameSelected: {
    color: colors.secondary,
  },
  stateBadge: {
    backgroundColor: colors.badgeNeutral,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  stateBadgeSelected: {
    backgroundColor: colors.secondary,
  },
  stateBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  stateBadgeTextSelected: {
    color: '#FFFFFF',
  },
  stateNote: {
    fontSize: 12,
    color: colors.textMuted,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  radioCircleSelected: {
    borderColor: colors.secondary,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.secondary,
  },
  modalCloseBtn: {
    borderColor: colors.border,
    borderRadius: 8,
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