// src/features/my-listings/ListingCard.tsx
import React from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { colors, spacing } from '../../theme';
import type { Listing, ListingState } from '../../types/contracts';

export const STATE_META: Record<ListingState, { label: string; color: string; bg: string }> = {
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

interface ListingCardProps {
  item: Listing;
  onPress: (item: Listing) => void;
}

export const ListingCard: React.FC<ListingCardProps> = ({ item, onPress }) => {
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
      onPress={() => onPress(item)}
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
                Updated {item.updated_at ? new Date(item.updated_at).toLocaleDateString() : 'recently'}
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
};

export default ListingCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbnailContainer: {
    width: 60,
    height: 60,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    marginRight: spacing.md,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.badgeNeutral,
  },
  cardDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardLocalTitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  categoryPill: {
    backgroundColor: colors.surface,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.secondary,
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
});
