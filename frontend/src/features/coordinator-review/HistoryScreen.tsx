// src/features/coordinator-review/HistoryScreen.tsx
import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { service } from '../../services';
import { colors, spacing } from '../../theme';
import { ProcessingIndicator } from '../../components';
import type { Listing } from '../../types/contracts';
import { formatSkillTier } from './formatters';

const DECIDED_STATES = new Set(['approved', 'rejected', 'exported']);

export default function HistoryScreen() {
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'exported' | 'rejected'>('all');
  const [expandedListingId, setExpandedListingId] = useState<string | null>(null);

  const {
    data: dbListings,
    isLoading: isFetchingListings,
    isRefetching: isRefetchingListings,
    refetch: refetchListings,
  } = useQuery({
    queryKey: ['coordinatorListings'],
    queryFn: () => service.listListings(),
    retry: 1,
    staleTime: 10000,
  });

  const decidedListings = (dbListings || []).filter((l) => DECIDED_STATES.has(l.state));
  const filteredListings = decidedListings.filter((l) => {
    if (statusFilter === 'all') return true;
    return l.state === statusFilter;
  });

  const countApproved = (dbListings || []).filter((l) => l.state === 'approved').length;
  const countExported = (dbListings || []).filter((l) => l.state === 'exported').length;
  const countRejected = (dbListings || []).filter((l) => l.state === 'rejected').length;

  const handleRefresh = async () => {
    await refetchListings();
  };

  if (isFetchingListings) {
    return <ProcessingIndicator hint="Loading audit history..." />;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefetchingListings}
          onRefresh={handleRefresh}
          colors={[colors.secondary]}
        />
      }
    >
      <View style={styles.header}>
        <Text style={styles.kicker}>DECISION AUDIT TRAIL</Text>
        <Text style={styles.title}>Review History</Text>
        <Text style={styles.subtitle}>
          Immutable record of coordinator decisions, approved crafts, and marketplace exports.
        </Text>
      </View>

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {(
          [
            { key: 'all', label: `All (${decidedListings.length})` },
            { key: 'approved', label: `Approved (${countApproved})` },
            { key: 'exported', label: `Exported (${countExported})` },
            { key: 'rejected', label: `Rejected (${countRejected})` },
          ] as const
        ).map((tab) => {
          const active = statusFilter === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setStatusFilter(tab.key)}
              style={[styles.filterChip, active && styles.filterChipActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* History Items Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {statusFilter === 'all'
            ? `Decided Craft Listings (${decidedListings.length})`
            : `${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Listings (${filteredListings.length})`}
        </Text>
      </View>

      {filteredListings.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconCircle}>
            <IconButton icon="history" size={36} iconColor={colors.textMuted} style={{ margin: 0 }} />
          </View>
          <Text style={styles.emptyCardTitle}>No Listings Found</Text>
          <Text style={styles.emptyCardSubtitle}>
            {statusFilter === 'all'
              ? 'When crafts in the review queue are approved or rejected, their decision audit record will appear here.'
              : `No listings with status "${statusFilter}".`}
          </Text>
        </View>
      ) : (
        filteredListings.map((listing: Listing) => {
          const titleEn = listing.catalogue?.catalogue?.title?.en || 'Untitled Craft';
          const titleLocal = listing.catalogue?.catalogue?.title?.local;
          const category = listing.catalogue?.catalogue?.category?.replace(/_/g, ' ');
          const priceFloor = listing.price?.floor_amount_paise
            ? Math.round(listing.price.floor_amount_paise / 100)
            : null;
          const recLow = listing.price?.recommended_low_paise
            ? Math.round(listing.price.recommended_low_paise / 100)
            : null;
          const recHigh = listing.price?.recommended_high_paise
            ? Math.round(listing.price.recommended_high_paise / 100)
            : null;
          const verifiedClaims = (listing.claims || []).filter((c) => c.coordinator_verified);
          const isExpanded = expandedListingId === listing.id;

          const isApproved = listing.state === 'approved';
          const isExported = listing.state === 'exported';
          const isRejected = listing.state === 'rejected';

          return (
            <TouchableOpacity
              key={listing.id}
              style={styles.historyCard}
              activeOpacity={0.85}
              onPress={() => setExpandedListingId(isExpanded ? null : listing.id)}
            >
              <View style={styles.cardHeaderRow}>
                <View style={{ flex: 1, marginRight: spacing.sm }}>
                  <Text style={styles.cardTitle} numberOfLines={isExpanded ? undefined : 1}>
                    {titleEn}
                  </Text>
                  {titleLocal && titleLocal !== titleEn && (
                    <Text style={styles.cardLocalTitle} numberOfLines={1}>
                      {titleLocal}
                    </Text>
                  )}
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    isExported
                      ? styles.badgeExported
                      : isApproved
                      ? styles.badgeApproved
                      : styles.badgeRejected,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      isExported
                        ? styles.badgeTextExported
                        : isApproved
                        ? styles.badgeTextApproved
                        : styles.badgeTextRejected,
                    ]}
                  >
                    {listing.state.toUpperCase().replace(/_/g, ' ')}
                  </Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                {category && (
                  <View style={styles.categoryPill}>
                    <Text style={styles.categoryText}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </Text>
                  </View>
                )}
                {priceFloor && (
                  <Text style={styles.priceFloorText}>Protected Floor: ₹{priceFloor}</Text>
                )}
                {recLow && recHigh && (
                  <Text style={styles.retailPriceText}>Rec: ₹{recLow} - ₹{recHigh}</Text>
                )}
              </View>

              {verifiedClaims.length > 0 && (
                <View style={styles.claimsRow}>
                  {verifiedClaims.map((c) => (
                    <View key={c.claim} style={styles.verifiedClaimPill}>
                      <Text style={styles.verifiedClaimText}>✓ {c.claim.replace(/_/g, ' ')}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Expandable audit detail view */}
              {isExpanded && (
                <View style={styles.expandedDetails}>
                  <Text style={styles.expandedHeading}>Listing & Decision Details</Text>
                  <Text style={styles.detailLine}>
                    <Text style={styles.detailBold}>Listing ID: </Text>
                    {listing.id}
                  </Text>
                  <Text style={styles.detailLine}>
                    <Text style={styles.detailBold}>Artisan ID: </Text>#{listing.artisan_id}
                  </Text>
                  {listing.price?.wage_source && (
                    <Text style={styles.detailLine}>
                      <Text style={styles.detailBold}>Wage Reference: </Text>
                      {listing.price.wage_source.notification_ref || listing.price.wage_source.state_code}
                    </Text>
                  )}
                  {isRejected && (
                    <View style={styles.rejectionNotice}>
                      <Text style={styles.rejectionTitle}>Rejection / Edit Notice:</Text>
                      <Text style={styles.rejectionText}>
                        Returned to artisan for revision or clarification.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              <View style={styles.cardFooter}>
                <Text style={styles.footerDate}>
                  Decided: {listing.updated_at ? new Date(listing.updated_at).toLocaleDateString() : 'Recently'}
                </Text>
                <Text style={styles.expandHint}>
                  {isExpanded ? 'Tap to collapse ▲' : 'Tap for details ▼'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingBottom: 100,
    backgroundColor: colors.background,
    flexGrow: 1,
  },
  header: {
    marginBottom: spacing.lg,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.textMuted,
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  statsContainer: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
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
  sectionHeader: {
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.badgeNeutral,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  emptyCardSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 340,
  },
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    elevation: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  cardLocalTitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeApproved: {
    backgroundColor: '#DCFCE7',
  },
  badgeTextApproved: {
    color: '#166534',
  },
  badgeExported: {
    backgroundColor: '#DBEAFE',
  },
  badgeTextExported: {
    color: '#1E40AF',
  },
  badgeRejected: {
    backgroundColor: '#FEE2E2',
  },
  badgeTextRejected: {
    color: '#991B1B',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: spacing.sm,
  },
  categoryPill: {
    backgroundColor: colors.surface,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.secondary,
  },
  priceFloorText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  claimsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  verifiedClaimPill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  verifiedClaimText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#1E40AF',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  footerArtisan: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
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
    fontWeight: '600',
    color: colors.textMuted,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  retailPriceText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  expandedDetails: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  expandedHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  detailLine: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 2,
  },
  detailBold: {
    fontWeight: '700',
    color: colors.text,
  },
  rejectionNotice: {
    backgroundColor: '#FEE2E2',
    padding: 6,
    borderRadius: 4,
    marginTop: 6,
  },
  rejectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.error,
  },
  rejectionText: {
    fontSize: 11,
    color: '#991B1B',
  },
  expandHint: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.secondary,
  },
});
