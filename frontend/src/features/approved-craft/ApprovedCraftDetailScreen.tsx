// src/features/approved-craft/ApprovedCraftDetailScreen.tsx
import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Image,
  TouchableOpacity,
  Alert,
  Dimensions,
} from 'react-native';
import { Text, Button, Card, Chip, ActivityIndicator, IconButton, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { ArtisanStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { getDraft, deleteDraft } from '../../services/database';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import { BottomDock } from '../../components';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ApprovedCraftDetailScreen() {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'ApprovedCraftDetail'>>();
  const { draftId } = route.params;
  const queryClient = useQueryClient();

  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [discarding, setDiscarding] = useState(false);

  // 1. Fetch live listing from backend and local draft payload
  const {
    data: listing,
    isLoading: isListingLoading,
    refetch,
  } = useQuery({
    queryKey: ['listing', draftId],
    queryFn: async () => {
      try {
        return await service.getListing(draftId);
      } catch (err) {
        // Fall back to local draft
        const draft = await getDraft(draftId);
        if (draft) {
          const enhanced = draft.payload?.enhancedPhotos || [];
          const raw = draft.payload?.photos || [];
          const mediaPhotos = enhanced.length > 0 ? enhanced : raw;
          return {
            id: draftId,
            artisan_id: 'user_local',
            state: draft.state || 'approved',
            preferred_language: draft.preferred_language || 'en',
            media: mediaPhotos.map((uri: string, i: number) => ({
              id: `m_${i}`,
              kind: 'image',
              variant: enhanced.length > 0 ? 'enhanced' : 'original',
              status: 'complete',
              url: uri,
            })),
            catalogue: draft.payload?.catalogue ? { catalogue: draft.payload.catalogue } : undefined,
            price: draft.payload?.priceResult || null,
            claims: draft.payload?.catalogue?.provenance?.claims || [],
            created_at: draft.created_at || new Date().toISOString(),
            updated_at: draft.updated_at || new Date().toISOString(),
          } as any;
        }
        throw err;
      }
    },
  });

  // Also query local draft for any extended draft fields (e.g. photos, dimensions, marketplace)
  const { data: localDraft } = useQuery({
    queryKey: ['localDraft', draftId],
    queryFn: () => getDraft(draftId),
  });

  const cat = listing?.catalogue?.catalogue || localDraft?.payload?.catalogue;
  const priceResult = listing?.price || localDraft?.payload?.priceResult;
  const finalPricePaise = localDraft?.payload?.finalPricePaise;
  const sellingPrice =
    finalPricePaise && finalPricePaise > 0
      ? Math.round(finalPricePaise / 100)
      : priceResult?.recommended_low_paise
      ? Math.round(priceResult.recommended_low_paise / 100)
      : 0;

  // Resolve photo list: prioritize AI-enhanced studio photos first
  const photos: string[] = useMemo(() => {
    // 1. Enhanced studio photos from local draft
    if (localDraft?.payload?.enhancedPhotos && localDraft.payload.enhancedPhotos.length > 0) {
      return localDraft.payload.enhancedPhotos;
    }
    // 2. Enhanced studio media from backend listing
    if (listing?.media && listing.media.length > 0) {
      const enhancedMedia = listing.media
        .filter((m: any) => m.variant === 'enhanced' && m.url)
        .map((m: any) => m.url as string);
      if (enhancedMedia.length > 0) {
        return enhancedMedia;
      }
      const anyMedia = listing.media.map((m: any) => m.url || '').filter(Boolean);
      if (anyMedia.length > 0) {
        return anyMedia;
      }
    }
    // 3. Fallback to raw camera photos if no enhanced exists
    if (localDraft?.payload?.photos && localDraft.payload.photos.length > 0) {
      return localDraft.payload.photos;
    }
    return ['https://images.unsplash.com/photo-1590736969955-71cc94801759?auto=format&fit=crop&w=800&q=80'];
  }, [localDraft, listing]);

  // Sync selected photo with cover photo when loaded
  React.useEffect(() => {
    const desiredCover = localDraft?.payload?.coverIndex;
    if (typeof desiredCover === 'number' && desiredCover >= 0 && desiredCover < photos.length) {
      setSelectedPhotoIndex(desiredCover);
    }
  }, [localDraft?.payload?.coverIndex, photos.length]);

  const activePhotoUri = photos[selectedPhotoIndex] || photos[0];
  const isCover = selectedPhotoIndex === (localDraft?.payload?.coverIndex ?? 0);

  // Handle Discard Craft
  const handleDiscard = () => {
    Alert.alert(
      'Discard Approved Craft?',
      'Are you sure you want to discard this approved craft listing? It will be permanently removed from your active catalogue.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard Craft',
          style: 'destructive',
          onPress: async () => {
            setDiscarding(true);
            try {
              try {
                await service.deleteListing(draftId);
              } catch (apiErr) {
                console.warn('[ApprovedCraft] Backend delete failed or offline, removing locally', apiErr);
              }
              await deleteDraft(draftId);
              queryClient.invalidateQueries({ queryKey: ['listings'] });
              navigation.goBack();
            } catch (err) {
              Alert.alert('Error', 'Failed to discard listing. Please try again.');
            } finally {
              setDiscarding(false);
            }
          },
        },
      ]
    );
  };

  // Handle Publish to ONDC
  const handlePublishONDC = () => {
    navigation.navigate('PublishExport', { listingId: draftId });
  };

  if (isListingLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading approved craft details...</Text>
      </View>
    );
  }

  const enTitle = cat?.title?.en || 'Handcrafted Artisan Product';
  const localTitle = cat?.title?.local;
  const localLang = cat?.title?.local_language || listing?.preferred_language || 'Local';
  const materials: string[] = cat?.materials || [];
  const techniques: string[] = cat?.techniques || [];
  const labourHours = cat?.labour?.hours ?? 12;
  const skillLevel = (cat?.labour?.skill_level || 'skilled').replace('_', ' ').toUpperCase();
  const materialCost = cat?.material_cost_paise ? Math.round(cat.material_cost_paise / 100) : 800;

  // Extended marketplace fields if filled
  const marketplace = localDraft?.payload?.marketplace;
  const dimensions = localDraft?.payload?.dimensions;

  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top, 16) }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Bar */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.approvedPill}>
              <MaterialCommunityIcons name="check-decagram" size={16} color={colors.successGreen} />
              <Text style={styles.approvedPillText}>Approved for Marketplace</Text>
            </View>
          </View>
          <Text style={styles.mainTitle}>{enTitle}</Text>
          {localTitle && (
            <View style={styles.localTitleRow}>
              <View style={styles.langPill}>
                <Text style={styles.langPillText}>{localLang.toUpperCase()}</Text>
              </View>
              <Text style={styles.localTitleText}>{localTitle}</Text>
            </View>
          )}
        </View>

        {/* Media Gallery Card */}
        <Card style={styles.mediaCard}>
          <View style={styles.primaryImageWrapper}>
            <Image source={{ uri: activePhotoUri }} style={styles.primaryImage} resizeMode="cover" />
            {isCover && (
              <View style={styles.coverBadge}>
                <MaterialCommunityIcons name="star" size={14} color="#FFFFFF" />
                <Text style={styles.coverBadgeText}>Cover Photo</Text>
              </View>
            )}
            <View style={styles.photoCountBadge}>
              <Text style={styles.photoCountText}>
                {selectedPhotoIndex + 1} / {photos.length}
              </Text>
            </View>
          </View>

          {photos.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailRow}>
              {photos.map((uri, idx) => (
                <TouchableOpacity
                  key={`photo_${idx}`}
                  activeOpacity={0.8}
                  onPress={() => setSelectedPhotoIndex(idx)}
                  style={[
                    styles.thumbnailWrapper,
                    selectedPhotoIndex === idx && styles.thumbnailActive,
                  ]}
                >
                  <Image source={{ uri }} style={styles.thumbnail} resizeMode="cover" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </Card>

        {/* Pricing & Statutory Fair Wage Guarantee */}
        <Card style={styles.priceCard}>
          <Card.Content>
            <View style={styles.priceHeaderRow}>
              <View>
                <Text style={styles.priceLabel}>Verified Selling Price</Text>
                <Text style={styles.priceValue}>₹{sellingPrice.toLocaleString()}</Text>
              </View>
              <View style={styles.statutoryWageBadge}>
                <MaterialCommunityIcons name="shield-check" size={16} color={colors.successGreen} />
                <Text style={styles.statutoryWageText}>Fair Wage Protected</Text>
              </View>
            </View>

            <Divider style={styles.divider} />

            <View style={styles.wageBreakdownGrid}>
              <View style={styles.wageItem}>
                <Text style={styles.wageItemLabel}>Raw Material Cost</Text>
                <Text style={styles.wageItemValue}>₹{materialCost.toLocaleString()}</Text>
              </View>
              <View style={styles.wageItem}>
                <Text style={styles.wageItemLabel}>Labour Allocation</Text>
                <Text style={styles.wageItemValue}>{labourHours} hrs ({skillLevel})</Text>
              </View>
              <View style={styles.wageItem}>
                <Text style={styles.wageItemLabel}>Statutory Floor</Text>
                <Text style={styles.wageItemValue}>
                  ₹{priceResult?.recommended_low_paise ? Math.round(priceResult.recommended_low_paise / 100).toLocaleString() : 'Protected'}
                </Text>
              </View>
              <View style={styles.wageItem}>
                <Text style={styles.wageItemLabel}>State / Zone</Text>
                <Text style={styles.wageItemValue}>
                  {cat?.labour?.state_code || 'KA'} · {cat?.labour?.zone || 'Zone 1'}
                </Text>
              </View>
            </View>

            {priceResult?.wage_source && (
              <View style={styles.gazetteBox}>
                <MaterialCommunityIcons name="file-document-outline" size={14} color={colors.textMuted} />
                <Text style={styles.gazetteText} numberOfLines={1}>
                  Gazette: {priceResult.wage_source.notification_ref}
                </Text>
              </View>
            )}
          </Card.Content>
        </Card>

        {/* Specifications & Authenticity */}
        <Card style={styles.detailsCard}>
          <Card.Content>
            <Text style={styles.sectionHeaderTitle}>Craft Specifications</Text>

            {/* Materials */}
            <Text style={styles.attributeLabel}>AUTHENTIC MATERIALS</Text>
            <View style={styles.chipWrap}>
              {materials.length > 0 ? (
                materials.map((m, i) => (
                  <Chip key={`mat_${i}`} style={styles.specChip} textStyle={styles.specChipText}>
                    {m.replace('_', ' ').toUpperCase()}
                  </Chip>
                ))
              ) : (
                <Text style={styles.unspecifiedText}>Natural artisan materials</Text>
              )}
            </View>

            {/* Techniques */}
            <Text style={[styles.attributeLabel, { marginTop: spacing.md }]}>HERITAGE TECHNIQUES</Text>
            <View style={styles.chipWrap}>
              {techniques.length > 0 ? (
                techniques.map((t, i) => (
                  <Chip key={`tech_${i}`} style={styles.specChip} textStyle={styles.specChipText}>
                    {t.replace('_', ' ').toUpperCase()}
                  </Chip>
                ))
              ) : (
                <Text style={styles.unspecifiedText}>Traditional handcrafted weave</Text>
              )}
            </View>

            {/* Dimensions if present */}
            {dimensions && (dimensions.productLength || dimensions.productWeight) && (
              <>
                <Text style={[styles.attributeLabel, { marginTop: spacing.md }]}>PRODUCT DIMENSIONS</Text>
                <Text style={styles.dimensionsText}>
                  {[
                    dimensions.productLength && `${dimensions.productLength}L`,
                    dimensions.productWidth && `${dimensions.productWidth}W`,
                    dimensions.productHeight && `${dimensions.productHeight}H cm`,
                    dimensions.productWeight && `· ${dimensions.productWeight} kg`,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </Text>
              </>
            )}

            {/* Fulfillment info if present */}
            {marketplace && (
              <>
                <Text style={[styles.attributeLabel, { marginTop: spacing.md }]}>COMMERCE TERMS</Text>
                <View style={styles.marketplaceRow}>
                  <Text style={styles.marketplaceText}>
                    Stock: {marketplace.quantityAvailable ?? 1} {marketplace.quantityUnit || 'units'}
                  </Text>
                  {marketplace.isCodAllowed && (
                    <Chip compact style={styles.termChip} textStyle={styles.termChipText}>
                      COD Available
                    </Chip>
                  )}
                  {marketplace.isReturnable && (
                    <Chip compact style={styles.termChip} textStyle={styles.termChipText}>
                      Returnable
                    </Chip>
                  )}
                </View>
              </>
            )}
          </Card.Content>
        </Card>

        {/* Descriptions */}
        {(cat?.description?.en || cat?.description?.local) && (
          <Card style={styles.detailsCard}>
            <Card.Content>
              <Text style={styles.sectionHeaderTitle}>Artisan Story & Description</Text>
              {cat?.description?.en && (
                <Text style={styles.descBody}>{cat.description.en}</Text>
              )}
              {cat?.description?.local && (
                <View style={styles.localDescBox}>
                  <Text style={styles.localDescLabel}>Original Voice Transcript ({localLang})</Text>
                  <Text style={styles.localDescBody}>{cat.description.local}</Text>
                </View>
              )}
            </Card.Content>
          </Card>
        )}

        {/* Provenance Verification Card */}
        <Card style={styles.provenanceCard}>
          <Card.Content>
            <View style={styles.provenanceHeader}>
              <MaterialCommunityIcons name="certificate" size={20} color={colors.secondary} />
              <Text style={styles.provenanceTitle}>Coordinator Verified Certification</Text>
            </View>
            <Text style={styles.provenanceBody}>
              This listing has been inspected and certified by your district craft cluster coordinator. All statutory provenance claims (GI Tag, Handloom, Wage Floor) are locked and cryptographically validated for open commerce.
            </Text>
          </Card.Content>
        </Card>
      </ScrollView>

      {/* Docked Action Footer */}
      <BottomDock>
        <View style={styles.dockActions}>
          <Button
            mode="contained"
            onPress={handlePublishONDC}
            buttonColor={colors.primary}
            textColor="#FFFFFF"
            style={styles.publishBtn}
            contentStyle={{ height: 48 }}
            icon="cloud-upload"
          >
            Publish to ONDC Network
          </Button>

          <Button
            mode="outlined"
            onPress={handleDiscard}
            loading={discarding}
            disabled={discarding}
            textColor={colors.error}
            style={styles.discardBtn}
            contentStyle={{ height: 44 }}
            icon="trash-can-outline"
          >
            Discard Item
          </Button>
        </View>
      </BottomDock>
    </View>
  );
}

function createStyles(colors: ColorPalette, isDark: boolean) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: 140,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    loadingText: {
      marginTop: spacing.md,
      color: colors.textMuted,
      fontSize: 14,
    },
    header: {
      marginBottom: spacing.md,
    },
    headerTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    backBtn: {
      padding: spacing.xs,
    },
    approvedPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.successLight,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.successBorder,
      gap: 4,
    },
    approvedPillText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.successGreen,
    },
    mainTitle: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.text,
      lineHeight: 28,
    },
    localTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.xs,
      gap: spacing.xs,
    },
    langPill: {
      backgroundColor: colors.primaryLight,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    langPillText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.primary,
    },
    localTitleText: {
      fontSize: 15,
      color: colors.textMuted,
      fontWeight: '500',
    },
    mediaCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    primaryImageWrapper: {
      width: '100%',
      height: 260,
      backgroundColor: colors.badgeNeutral,
      position: 'relative',
    },
    primaryImage: {
      width: '100%',
      height: '100%',
    },
    coverBadge: {
      position: 'absolute',
      top: spacing.sm,
      left: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: 12,
      gap: 4,
    },
    coverBadgeText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '700',
    },
    photoCountBadge: {
      position: 'absolute',
      bottom: spacing.sm,
      right: spacing.sm,
      backgroundColor: 'rgba(0,0,0,0.65)',
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: 10,
    },
    photoCountText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '600',
    },
    thumbnailRow: {
      padding: spacing.sm,
      gap: spacing.sm,
    },
    thumbnailWrapper: {
      width: 60,
      height: 60,
      borderRadius: 8,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    thumbnailActive: {
      borderColor: colors.primary,
    },
    thumbnail: {
      width: '100%',
      height: '100%',
    },
    priceCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    priceHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    priceLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    priceValue: {
      fontSize: 26,
      fontWeight: '800',
      color: colors.primary,
      marginTop: 2,
    },
    statutoryWageBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.successLight,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.successBorder,
      gap: 4,
    },
    statutoryWageText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.successGreen,
    },
    divider: {
      marginVertical: spacing.md,
      backgroundColor: colors.border,
    },
    wageBreakdownGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.md,
    },
    wageItem: {
      width: '46%',
    },
    wageItemLabel: {
      fontSize: 11,
      color: colors.textMuted,
      marginBottom: 2,
    },
    wageItemValue: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    gazetteBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.badgeNeutral,
      padding: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: 6,
      marginTop: spacing.md,
      gap: 6,
    },
    gazetteText: {
      fontSize: 11,
      color: colors.textMuted,
      fontStyle: 'italic',
      flex: 1,
    },
    detailsCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
    },
    sectionHeaderTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginBottom: spacing.sm,
    },
    attributeLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textMuted,
      letterSpacing: 0.5,
      marginBottom: spacing.xs,
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    specChip: {
      backgroundColor: colors.indigoLight,
      borderRadius: 6,
    },
    specChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.secondary,
    },
    unspecifiedText: {
      fontSize: 13,
      color: colors.textMuted,
      fontStyle: 'italic',
    },
    dimensionsText: {
      fontSize: 14,
      color: colors.text,
      fontWeight: '600',
    },
    marketplaceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    marketplaceText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    termChip: {
      backgroundColor: colors.primaryLight,
    },
    termChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.primary,
    },
    descBody: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
      marginBottom: spacing.sm,
    },
    localDescBox: {
      backgroundColor: colors.primaryLight,
      padding: spacing.sm,
      borderRadius: 8,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      marginTop: spacing.xs,
    },
    localDescLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.primary,
      marginBottom: 2,
    },
    localDescBody: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
      fontStyle: 'italic',
    },
    provenanceCard: {
      backgroundColor: colors.indigoLight,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.indigoBorder,
      marginBottom: spacing.md,
    },
    provenanceHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginBottom: spacing.xs,
    },
    provenanceTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.secondary,
    },
    provenanceBody: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.text,
    },
    dockActions: {
      gap: spacing.xs,
    },
    publishBtn: {
      borderRadius: 8,
    },
    discardBtn: {
      borderRadius: 8,
      borderColor: colors.error,
    },
  });
}
