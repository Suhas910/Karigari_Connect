// src/features/coordinator-review/ListingQueueScreen.tsx
import React, { useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  RefreshControl,
} from 'react-native';
import { Text, Button, IconButton } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { service } from '../../services';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import { ProcessingIndicator, ErrorRetryCard } from '../../components';
import type { Listing } from '../../types/contracts';
import type { CoordinatorStackParamList } from '../../types/navigation';
import { getBestProductPhoto } from '../../utils/media';

export default function ListingQueueScreen() {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation<NativeStackNavigationProp<CoordinatorStackParamList>>();

  // Query listings awaiting approval
  const {
    data: dbListings,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['coordinatorListings', 'awaiting_approval'],
    queryFn: () => service.listListings('awaiting_approval'),
    retry: 1,
    staleTime: 5000,
  });

  const pendingListings = useMemo(() => {
    return (dbListings || []).filter((l) => l.state === 'awaiting_approval');
  }, [dbListings]);

  const renderItem = ({ item }: { item: Listing }) => {
    const title =
      item.catalogue?.catalogue?.title?.en ||
      item.catalogue?.catalogue?.title?.local ||
      'Handcrafted Craft';
    const category = item.catalogue?.catalogue?.category?.replace(/_/g, ' ') || 'Craft';
    const photo = getBestProductPhoto(item.media, []);
    const priceFloor = item.price?.floor_amount_paise
      ? Math.round(item.price.floor_amount_paise / 100)
      : null;
    const claims = item.claims || [];
    const pendingClaimsCount = claims.filter(
      (c) => c.asserted_by_artisan && !c.coordinator_verified
    ).length;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('CraftReviewDetail', { listingId: item.id })}
        activeOpacity={0.7}
      >
        <View style={styles.thumbnailBox}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.thumbnailImage} />
          ) : (
            <View style={styles.thumbnailFallback}>
              <MaterialCommunityIcons name="palette-swatch-outline" size={24} color={colors.secondary} />
            </View>
          )}
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{category}</Text>
            </View>
            <View style={styles.statusPill}>
              <Text style={styles.statusText}>PENDING REVIEW</Text>
            </View>
          </View>

          <Text style={styles.cardTitle} numberOfLines={2}>
            {title}
          </Text>

          <View style={styles.cardFooter}>
            {priceFloor ? (
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Floor: </Text>
                <Text style={styles.priceValue}>₹{priceFloor}</Text>
              </View>
            ) : (
              <Text style={styles.unpricedText}>Price pending</Text>
            )}

            {claims.length > 0 ? (
              <View
                style={[
                  styles.claimsBadge,
                  pendingClaimsCount > 0 ? styles.claimsBadgePending : styles.claimsBadgeDone,
                ]}
              >
                <MaterialCommunityIcons
                  name={pendingClaimsCount > 0 ? 'shield-alert-outline' : 'shield-check-outline'}
                  size={12}
                  color={pendingClaimsCount > 0 ? colors.warningText : colors.successGreen}
                  style={{ marginRight: 3 }}
                />
                <Text
                  style={[
                    styles.claimsBadgeText,
                    pendingClaimsCount > 0 ? styles.claimsTextPending : styles.claimsTextDone,
                  ]}
                >
                  {pendingClaimsCount > 0
                    ? `${pendingClaimsCount} claim${pendingClaimsCount > 1 ? 's' : ''}`
                    : 'Claims verified'}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <MaterialCommunityIcons
          name="chevron-right"
          size={24}
          color={colors.textMuted}
          style={styles.chevron}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.kicker}>CLUSTER COORDINATOR</Text>
        <Text style={styles.title}>Craft Review Queue</Text>
        <Text style={styles.subtitle}>
          Tap any craft submission to inspect photos, verify claims, and make approval decisions.
        </Text>
        {pendingListings.length > 0 && (
          <View style={styles.countBadge}>
            <MaterialCommunityIcons name="clock-outline" size={14} color={colors.secondary} />
            <Text style={styles.countBadgeText}>
              {pendingListings.length} craft{pendingListings.length > 1 ? 's' : ''} awaiting review
            </Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <ProcessingIndicator hint="Fetching craft review queue..." />
      ) : isError ? (
        <ErrorRetryCard
          errorText={
            (error as any)?.response?.data?.error?.message ||
            (error as any)?.message ||
            'Failed to load craft queue.'
          }
          onRetry={() => refetch()}
          asCard
          style={{ margin: spacing.lg }}
        />
      ) : pendingListings.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconCircle}>
            <IconButton icon="clipboard-check-outline" size={36} iconColor={colors.secondary} style={{ margin: 0 }} />
          </View>
          <Text style={styles.emptyCardTitle}>Queue Caught Up</Text>
          <Text style={styles.emptyCardSubtitle}>
            No craft submissions are currently awaiting coordinator approval.
          </Text>
          <Button
            mode="outlined"
            onPress={() => refetch()}
            style={styles.refreshBtn}
            textColor={colors.secondary}
            icon="refresh"
          >
            Refresh Queue
          </Button>
        </View>
      ) : (
        <FlatList
          data={pendingListings}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => refetch()}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
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
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 18,
    },
    countBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: colors.indigoLight,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
      gap: 5,
      marginTop: spacing.sm,
    },
    countBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.secondary,
    },
    listContent: {
      padding: spacing.lg,
      paddingTop: spacing.sm,
      gap: spacing.sm,
      paddingBottom: 100,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      elevation: 1,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
    },
    thumbnailBox: {
      width: 64,
      height: 64,
      borderRadius: 10,
      backgroundColor: colors.badgeNeutral,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbnailImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    thumbnailFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardBody: {
      flex: 1,
      marginLeft: 12,
      marginRight: 6,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 3,
    },
    categoryBadge: {
      backgroundColor: colors.badgeNeutral,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    categoryText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'capitalize',
    },
    statusPill: {
      backgroundColor: colors.warningLight,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    statusText: {
      fontSize: 9,
      fontWeight: '800',
      color: colors.warningText,
      letterSpacing: 0.4,
    },
    cardTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      lineHeight: 18,
      marginBottom: 6,
    },
    cardFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    priceRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    priceLabel: {
      fontSize: 11,
      color: colors.textMuted,
    },
    priceValue: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.primary,
    },
    unpricedText: {
      fontSize: 11,
      color: colors.textMuted,
      fontStyle: 'italic',
    },
    claimsBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    claimsBadgePending: {
      backgroundColor: colors.warningLight,
    },
    claimsBadgeDone: {
      backgroundColor: colors.successLight,
    },
    claimsBadgeText: {
      fontSize: 10,
      fontWeight: '700',
    },
    claimsTextPending: {
      color: colors.warningText,
    },
    claimsTextDone: {
      color: colors.successGreen,
    },
    chevron: {
      marginLeft: 4,
    },
    emptyCard: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      marginTop: spacing.xl,
    },
    emptyIconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.badgeNeutral,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    emptyCardTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    emptyCardSubtitle: {
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 18,
      maxWidth: 280,
      marginBottom: spacing.lg,
    },
    refreshBtn: {
      borderRadius: 10,
      borderColor: colors.border,
    },
  });
}
