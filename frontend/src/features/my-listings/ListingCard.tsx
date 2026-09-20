// src/features/my-listings/ListingCard.tsx
import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import type { Listing, ListingState } from '../../types/contracts';
import { getBestProductPhoto } from '../../utils/media';

export function getStateMeta(
  state: ListingState,
  colors: ColorPalette
): { label: string; color: string; bg: string } {
  const metaMap: Record<ListingState, { label: string; color: string; bg: string }> = {
    draft: { label: 'Draft', color: colors.text, bg: colors.badgeNeutral },
    processing: { label: 'Processing', color: colors.text, bg: colors.badgeNeutral },
    awaiting_confirmation: { label: 'Needs Confirm', color: colors.onPrimary, bg: colors.primary },
    awaiting_approval: { label: 'In Review', color: colors.secondary, bg: colors.indigoLight },
    approved: { label: 'Approved', color: colors.onPrimary, bg: colors.secondary },
    export_queued: { label: 'Export Queued', color: colors.text, bg: colors.badgeNeutral },
    exported: { label: 'Export Staged', color: colors.onPrimary, bg: colors.secondary },
    rejected: { label: 'Needs Revision', color: colors.onPrimary, bg: colors.error },
    failed: { label: 'Failed', color: colors.onPrimary, bg: colors.error },
  };
  return metaMap[state] || { label: state, color: colors.text, bg: colors.badgeNeutral };
}

/** @deprecated Use getStateMeta(state, colors) with dynamic theme colors */
export const STATE_META: Record<ListingState, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#1C1917', bg: '#EFECE6' },
  processing: { label: 'Processing', color: '#1C1917', bg: '#EFECE6' },
  awaiting_confirmation: { label: 'Needs Confirm', color: '#FFFFFF', bg: '#B84A2A' },
  awaiting_approval: { label: 'In Review', color: '#243354', bg: '#EEF2F9' },
  approved: { label: 'Approved', color: '#FFFFFF', bg: '#243354' },
  export_queued: { label: 'Export Queued', color: '#1C1917', bg: '#EFECE6' },
  exported: { label: 'Export Staged', color: '#FFFFFF', bg: '#243354' },
  rejected: { label: 'Needs Revision', color: '#FFFFFF', bg: '#8F2D18' },
  failed: { label: 'Failed', color: '#FFFFFF', bg: '#8F2D18' },
};

interface ListingCardProps {
  item: Listing;
  onPress: (item: Listing) => void;
}

export const ListingCard: React.FC<ListingCardProps> = ({ item, onPress }) => {
  const { t } = useTranslation();
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const meta = getStateMeta(item.state, colors);
  const titleEn = item.catalogue?.catalogue?.title?.en;
  const titleLocal = item.catalogue?.catalogue?.title?.local;
  const category = item.catalogue?.catalogue?.category?.replace(/_/g, ' ');
  const firstPhoto = getBestProductPhoto(item.media);
  const [imageError, setImageError] = React.useState(false);
  const showImage = !!firstPhoto && !imageError;
  const priceFloor = item.price?.floor_amount_paise ? Math.round(item.price.floor_amount_paise / 100) : null;
  const priceHigh = item.price?.recommended_high_paise ? Math.round(item.price.recommended_high_paise / 100) : null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(item)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t('listings.listingA11y', { title: titleEn || t('listings.untitledDraft') })}
    >
      <View style={styles.cardMainRow}>
        {/* Craft Thumbnail or Category Icon */}
        <View style={styles.thumbnailContainer}>
          {showImage ? (
            <Image
              source={{ uri: firstPhoto }}
              style={styles.thumbnailImage}
              onError={() => setImageError(true)}
            />
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
              {titleEn || t('listings.untitledDraft')}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
              <Text style={[styles.statusBadgeText, { color: meta.color }]}>
                {t(`listingState.${item.state}`, { defaultValue: meta.label })}
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
                ₹{priceFloor} {priceHigh ? `- ₹${priceHigh}` : t('listings.floor')}
              </Text>
            ) : (
              <Text style={styles.metaText}>
                {item.updated_at
                  ? t('listings.updatedOn', { date: new Date(item.updated_at).toLocaleDateString() })
                  : t('listings.updatedRecently')}
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

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      marginBottom: spacing.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: colors.shadow,
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
}
