// src/features/coordinator-review/CraftReviewDetailScreen.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, Keyboard, Image, type LayoutChangeEvent } from 'react-native';
import { Text, Button, TextInput, Card } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useHeaderHeight } from '@react-navigation/elements';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { service, USE_LIVE_BACKEND } from '../../services';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import { ProcessingIndicator, ErrorRetryCard } from '../../components';
import type { Claim, Listing, MediaAsset } from '../../types/contracts';
import type { CoordinatorStackParamList } from '../../types/navigation';
import { formatClaimLabel, formatSkillTier } from './formatters';
import { isPlaceholder, normalizeMediaUrl } from '../../utils/media';

const REJECTION_CATEGORIES = [
  { key: 'catalogue', label: 'Catalogue & Specs', icon: 'file-document-edit-outline' },
  { key: 'image', label: 'Media & Photos', icon: 'camera-outline' },
  { key: 'price', label: 'Price & Labour', icon: 'currency-inr' },
  { key: 'claims', label: 'Provenance Claims', icon: 'shield-alert-outline' },
] as const;

export default function CraftReviewDetailScreen() {
  const { t } = useTranslation();
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation<NativeStackNavigationProp<CoordinatorStackParamList>>();
  const route = useRoute<RouteProp<CoordinatorStackParamList, 'CraftReviewDetail'>>();
  const { listingId } = route.params;
  const headerHeight = useHeaderHeight();

  const { data: listing, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['listingDetail', listingId],
    queryFn: () => service.getListing(listingId),
    retry: 1,
  });

  const scrollViewRef = useRef<ScrollView>(null);
  const inputOffsets = useRef<Record<string, number>>({});
  const activeInputRef = useRef<string | null>(null);
  const [keyboardSpace, setKeyboardSpace] = useState(0);

  const [imagesReviewed, setImagesReviewed] = useState(false);
  const [detailsReviewed, setDetailsReviewed] = useState(false);
  const [evidenceNotes, setEvidenceNotes] = useState<Record<string, string>>({});
  const [claimDecisions, setClaimDecisions] = useState<Record<string, 'verified' | 'rejected'>>({});
  const [claimError, setClaimError] = useState<string | null>(null);

  const [decisionLoading, setDecisionLoading] = useState(false);
  const [listingDecisionStatus, setListingDecisionStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [listingReason, setListingReason] = useState('');
  const [rejectionCategories, setRejectionCategories] = useState<string[]>([]);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    if (listing) {
      setListingDecisionStatus(listing.state === 'approved' ? 'approved' : listing.state === 'rejected' ? 'rejected' : 'pending');
      if (listing.rejection_reason) setListingReason(listing.rejection_reason);
      if (listing.rejection_categories && listing.rejection_categories.length > 0) setRejectionCategories(listing.rejection_categories);
      else if (listing.rejection_flags && listing.rejection_flags.length > 0) setRejectionCategories(listing.rejection_flags);

      const existingDecisions: Record<string, 'verified' | 'rejected'> = {};
      const existingNotes: Record<string, string> = {};
      (listing.claims || []).forEach((c) => {
        if (c.coordinator_verified) existingDecisions[c.claim] = 'verified';
        if (c.evidence_note) existingNotes[c.claim] = c.evidence_note;
      });
      setClaimDecisions(existingDecisions);
      setEvidenceNotes(existingNotes);
    }
  }, [listing]);

  const scrollToInput = (key: string | null) => {
    if (!key) return;
    const y = inputOffsets.current[key];
    if (typeof y === 'number') scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
  };

  useEffect(() => {
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      const h = e.endCoordinates?.height || 300;
      setKeyboardSpace(h);
      if (activeInputRef.current) {
        const key = activeInputRef.current;
        setTimeout(() => scrollToInput(key), 50);
        setTimeout(() => scrollToInput(key), 180);
      }
    });
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardSpace(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const handleInputLayout = (key: string, e: LayoutChangeEvent) => { inputOffsets.current[key] = e.nativeEvent.layout.y; };
  const handleInputFocus = (key: string) => { activeInputRef.current = key; scrollToInput(key); };

  const activeClaims: Claim[] = listing?.claims || [];
  const allClaimsDecided = activeClaims.length === 0 || activeClaims.every((c) => Boolean(claimDecisions[c.claim]));

  const handleClaimDecision = async (claimId: string, decision: 'verified' | 'rejected') => {
    setClaimError(null);
    const prevDecision = claimDecisions[claimId];
    setClaimDecisions((prev) => ({ ...prev, [claimId]: decision }));
    try {
      await service.reviewClaim(listingId, claimId, { decision, evidence_note: evidenceNotes[claimId] ?? '', reason: decision === 'rejected' ? 'Insufficient evidence' : null });
      if (USE_LIVE_BACKEND) await refetch();
    } catch (err) {
      setClaimDecisions((prev) => { const next = { ...prev }; if (prevDecision) next[claimId] = prevDecision; else delete next[claimId]; return next; });
      setClaimError('Could not save claim decision. Please check connection and try again.');
    }
  };

  const toggleRejectionCategory = (catKey: string) => {
    setRejectionCategories((prev) => prev.includes(catKey) ? prev.filter((k) => k !== catKey) : [...prev, catKey]);
  };

  const handleListingDecision = async (decision: 'approved' | 'rejected') => {
    setDecisionError(null);
    setClaimError(null);
    if (decision === 'approved' && (!imagesReviewed || !detailsReviewed)) return setDecisionError('Please mark both Product Media and Craft Details as verified before approving.');
    if (decision === 'approved' && !allClaimsDecided) return setDecisionError('All statutory claims must be individually verified or rejected before approval.');
    if (decision === 'rejected' && rejectionCategories.length === 0) return setDecisionError('Please select at least one rejection category explaining what needs revision.');
    if (decision === 'rejected' && !listingReason.trim()) return setDecisionError('Please provide a specific reason or note explaining why this listing was rejected.');
    
    setDecisionLoading(true);
    try {
      await service.decideApproval(listingId, { decision, reason: listingReason, rejection_categories: decision === 'rejected' ? rejectionCategories : [] });
      setListingDecisionStatus(decision);
      await refetch();
    } catch (err: any) {
      setDecisionError(err?.message || 'Failed to submit decision. Please try again.');
    } finally {
      setDecisionLoading(false);
    }
  };

  if (isLoading) return <ProcessingIndicator hint="Loading craft details for review..." />;
  if (isError || !listing) return <ErrorRetryCard errorText={(error as any)?.message || 'Failed to load craft submission.'} onRetry={() => refetch()} asCard style={{ margin: spacing.lg }} />;

  const catalogue = listing.catalogue?.catalogue;
  const wageFloor = listing.price?.floor_amount_paise ? Math.round(listing.price.floor_amount_paise / 100) : null;
  const imageAssets = (listing.media || []).filter((m: MediaAsset) => m.kind === 'image');

  return (
    <KeyboardAvoidingView style={styles.keyboardAvoid} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}>
      <ScrollView ref={scrollViewRef} contentContainerStyle={[styles.container, { paddingBottom: keyboardSpace > 0 ? keyboardSpace + 80 : 120 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        
        <View style={styles.header}>
          <Text style={styles.kicker}>{t('coordinator.review.kicker', 'CLUSTER AUDIT')} · #{listing.id.slice(0, 8).toUpperCase()}</Text>
          <Text style={styles.title}>{catalogue?.title?.en || 'Handcrafted Craft'}</Text>
          {catalogue?.title?.local ? <Text style={styles.localTitle}>"{catalogue.title.local}"</Text> : null}
        </View>

        {/* Section 1 */}
        <Card style={styles.sectionCard}>
          <Card.Content>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleGroup}>
                <MaterialCommunityIcons name="image-multiple-outline" size={20} color={colors.primary} />
                <Text style={styles.sectionTitle}>{t('coordinator.review.mediaSection', '1. Product Media')} ({imageAssets.length})</Text>
              </View>
              <TouchableOpacity style={[styles.reviewCheckBtn, imagesReviewed && styles.reviewCheckBtnActive]} onPress={() => setImagesReviewed(!imagesReviewed)} activeOpacity={0.7}>
                <MaterialCommunityIcons name={imagesReviewed ? 'check-circle' : 'checkbox-blank-circle-outline'} size={16} color={imagesReviewed ? colors.successGreen : colors.textMuted} />
                <Text style={[styles.reviewCheckText, imagesReviewed && styles.reviewCheckTextActive]}>{imagesReviewed ? t('coordinator.review.imagesVerified', 'Images Verified') : t('coordinator.review.markVerified', 'Mark Verified')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imageGallery}>
              {imageAssets.map((asset, idx) => (
                <View key={asset.id || idx} style={styles.galleryItem}>
                  {asset.url ? <Image source={{ uri: normalizeMediaUrl(asset.url) || asset.url }} style={styles.galleryImage} resizeMode="cover" /> : <View style={styles.galleryPlaceholder}><MaterialCommunityIcons name="image" size={32} color={colors.textMuted} /></View>}
                </View>
              ))}
            </ScrollView>
          </Card.Content>
        </Card>

        {/* Section 2 */}
        <Card style={styles.sectionCard}>
          <Card.Content>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleGroup}>
                <MaterialCommunityIcons name="card-text-outline" size={20} color={colors.primary} />
                <Text style={styles.sectionTitle}>{t('coordinator.review.detailsSection', '2. Craft Details & Wage Floor')}</Text>
              </View>
              <TouchableOpacity style={[styles.reviewCheckBtn, detailsReviewed && styles.reviewCheckBtnActive]} onPress={() => setDetailsReviewed(!detailsReviewed)} activeOpacity={0.7}>
                <MaterialCommunityIcons name={detailsReviewed ? 'check-circle' : 'checkbox-blank-circle-outline'} size={16} color={detailsReviewed ? colors.successGreen : colors.textMuted} />
                <Text style={[styles.reviewCheckText, detailsReviewed && styles.reviewCheckTextActive]}>{detailsReviewed ? t('coordinator.review.detailsVerified', 'Details Verified') : t('coordinator.review.markVerified', 'Mark Verified')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.specTable}>
              {wageFloor && (
                <View style={[styles.specRow, styles.specRowHighlight]}>
                  <Text style={styles.specLabelHighlight}>{t('coordinator.review.wageFloor', 'Statutory Wage Floor')}</Text>
                  <Text style={styles.specValueHighlight}>₹{wageFloor}</Text>
                </View>
              )}
            </View>
          </Card.Content>
        </Card>

        {/* Decision */}
        <Card style={styles.decisionCard} onLayout={(e) => handleInputLayout('decision', e)}>
          <Card.Content>
            <View style={styles.decisionHeader}>
              <MaterialCommunityIcons name="gavel" size={20} color={colors.secondary} />
              <Text style={styles.decisionTitle}>{t('coordinator.review.decisionTitle', 'Coordinator Final Decision')}</Text>
            </View>
            {listingDecisionStatus === 'approved' ? (
              <View style={styles.approvedNotice}>
                <MaterialCommunityIcons name="check-decagram" size={32} color={colors.successGreen} />
                <Text style={styles.approvedNoticeTitle}>{t('coordinator.review.approvedTitle', 'Listing is Approved')}</Text>
                <Button mode="contained" onPress={() => navigation.navigate('PublishExport', { listingId })} buttonColor={colors.secondary} style={{ marginTop: spacing.md }} icon="cloud-upload-outline">{t('coordinator.review.proceedExport', 'Proceed to Marketplace Export')}</Button>
              </View>
            ) : (
              <View>
                <Text style={styles.rejectionSectionLabel}>{t('coordinator.review.rejectionCategories', 'Rejection Categories (Required if rejecting):')}</Text>
                <View style={styles.chipsRow}>
                  {REJECTION_CATEGORIES.map((cat) => (
                    <TouchableOpacity key={cat.key} style={[styles.catChip, rejectionCategories.includes(cat.key) && styles.catChipSelected]} onPress={() => toggleRejectionCategory(cat.key)}>
                      <Text style={[styles.catChipText, rejectionCategories.includes(cat.key) && styles.catChipTextSelected]}>{cat.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput mode="outlined" value={listingReason} onChangeText={setListingReason} onFocus={() => handleInputFocus('decision')} multiline numberOfLines={3} style={styles.input} />
                <View style={styles.decisionActions}>
                  <Button mode="contained" onPress={() => handleListingDecision('approved')} loading={decisionLoading} buttonColor={colors.secondary}>{t('coordinator.review.approveBtn', 'Approve Listing')}</Button>
                  <Button mode="outlined" onPress={() => handleListingDecision('rejected')} loading={decisionLoading} textColor={colors.error}>{t('coordinator.review.rejectBtn', 'Reject with Feedback')}</Button>
                </View>
              </View>
            )}
          </Card.Content>
        </Card>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    keyboardAvoid: { flex: 1, backgroundColor: colors.background },
    container: { padding: spacing.md, gap: spacing.md },
    header: { paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
    kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: colors.textMuted, marginBottom: 3 },
    title: { fontSize: 22, fontWeight: '800', color: colors.text, lineHeight: 26 },
    localTitle: { fontSize: 14, fontStyle: 'italic', color: colors.textMuted, marginTop: 2 },
    sectionCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, elevation: 1 },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
    sectionTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
    reviewCheckBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    reviewCheckBtnActive: { backgroundColor: colors.successLight, borderColor: colors.successBorder },
    reviewCheckText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
    reviewCheckTextActive: { color: colors.successGreen },
    imageGallery: { gap: spacing.sm, paddingVertical: 4 },
    galleryItem: { width: 120, height: 120, borderRadius: 10, backgroundColor: colors.badgeNeutral, overflow: 'hidden' },
    galleryImage: { width: '100%', height: '100%', resizeMode: 'cover' },
    galleryPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    specTable: { gap: 8 },
    specRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
    specRowHighlight: { backgroundColor: colors.indigoLight, paddingHorizontal: 8, borderRadius: 6, borderBottomWidth: 0 },
    specLabelHighlight: { fontSize: 12, fontWeight: '700', color: colors.secondary },
    specValueHighlight: { fontSize: 15, fontWeight: '800', color: colors.secondary },
    decisionCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: colors.secondary, elevation: 2 },
    decisionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
    decisionTitle: { fontSize: 15, fontWeight: '800', color: colors.secondary },
    rejectionSectionLabel: { fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 6 },
    chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
    catChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
    catChipSelected: { backgroundColor: colors.errorLight, borderColor: colors.error },
    catChipText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
    catChipTextSelected: { color: colors.error, fontWeight: '700' },
    input: { fontSize: 13, marginBottom: spacing.sm, backgroundColor: colors.surface },
    decisionActions: { gap: spacing.sm, marginTop: spacing.xs },
    approvedNotice: { alignItems: 'center', padding: spacing.md, gap: 6 },
    approvedNoticeTitle: { fontSize: 16, fontWeight: '800', color: colors.successGreen },
  });
}