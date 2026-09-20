// src/features/coordinator-review/CraftReviewDetailScreen.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Image,
  type LayoutChangeEvent,
} from 'react-native';
import { Text, Button, TextInput, Card } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
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

const REJECTION_CATEGORIES: {
  key: string;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  { key: 'catalogue', label: 'Catalogue & Specs', icon: 'file-document-edit-outline' },
  { key: 'image', label: 'Media & Photos', icon: 'camera-outline' },
  { key: 'price', label: 'Price & Labour', icon: 'currency-inr' },
  { key: 'claims', label: 'Provenance Claims', icon: 'shield-alert-outline' },
];

export default function CraftReviewDetailScreen() {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation<NativeStackNavigationProp<CoordinatorStackParamList>>();
  const route = useRoute<RouteProp<CoordinatorStackParamList, 'CraftReviewDetail'>>();
  const { listingId } = route.params;
  const headerHeight = useHeaderHeight();

  // Query listing details
  const {
    data: listing,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['listingDetail', listingId],
    queryFn: () => service.getListing(listingId),
    retry: 1,
  });

  const scrollViewRef = useRef<ScrollView>(null);
  const inputOffsets = useRef<Record<string, number>>({});
  const activeInputRef = useRef<string | null>(null);
  const [keyboardSpace, setKeyboardSpace] = useState(0);

  // Section review toggle states (local checks)
  const [imagesReviewed, setImagesReviewed] = useState(false);
  const [detailsReviewed, setDetailsReviewed] = useState(false);

  // Claim states
  const [evidenceNotes, setEvidenceNotes] = useState<Record<string, string>>({});
  const [claimDecisions, setClaimDecisions] = useState<Record<string, 'verified' | 'rejected'>>({});
  const [claimError, setClaimError] = useState<string | null>(null);

  // Decision form states
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [listingDecisionStatus, setListingDecisionStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [listingReason, setListingReason] = useState('');
  const [rejectionCategories, setRejectionCategories] = useState<string[]>([]);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    if (listing) {
      setListingDecisionStatus(
        listing.state === 'approved'
          ? 'approved'
          : listing.state === 'rejected'
          ? 'rejected'
          : 'pending'
      );
      if (listing.rejection_reason) {
        setListingReason(listing.rejection_reason);
      }
      if (listing.rejection_categories && listing.rejection_categories.length > 0) {
        setRejectionCategories(listing.rejection_categories);
      } else if (listing.rejection_flags && listing.rejection_flags.length > 0) {
        setRejectionCategories(listing.rejection_flags);
      }

      const existingDecisions: Record<string, 'verified' | 'rejected'> = {};
      const existingNotes: Record<string, string> = {};
      (listing.claims || []).forEach((c) => {
        if (c.coordinator_verified) {
          existingDecisions[c.claim] = 'verified';
        }
        if (c.evidence_note) {
          existingNotes[c.claim] = c.evidence_note;
        }
      });
      setClaimDecisions(existingDecisions);
      setEvidenceNotes(existingNotes);
    }
  }, [listing]);

  const scrollToInput = (key: string | null) => {
    if (!key) return;
    const y = inputOffsets.current[key];
    if (typeof y === 'number') {
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, y - 24),
        animated: true,
      });
    }
  };

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        const h = e.endCoordinates?.height || 300;
        setKeyboardSpace(h);
        if (activeInputRef.current) {
          const key = activeInputRef.current;
          setTimeout(() => scrollToInput(key), 50);
          setTimeout(() => scrollToInput(key), 180);
        }
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardSpace(0);
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleInputLayout = (key: string, e: LayoutChangeEvent) => {
    inputOffsets.current[key] = e.nativeEvent.layout.y;
  };

  const handleInputFocus = (key: string) => {
    activeInputRef.current = key;
    scrollToInput(key);
  };

  const activeClaims: Claim[] = listing?.claims || [];
  const allClaimsDecided =
    activeClaims.length === 0 || activeClaims.every((c) => Boolean(claimDecisions[c.claim]));

  const handleClaimDecision = async (claimId: string, decision: 'verified' | 'rejected') => {
    setClaimError(null);
    const prevDecision = claimDecisions[claimId];
    setClaimDecisions((prev) => ({ ...prev, [claimId]: decision }));
    try {
      await service.reviewClaim(listingId, claimId, {
        decision,
        evidence_note: evidenceNotes[claimId] ?? '',
        reason: decision === 'rejected' ? 'Insufficient evidence' : null,
      });
      if (USE_LIVE_BACKEND) {
        await refetch();
      }
    } catch (err) {
      setClaimDecisions((prev) => {
        const next = { ...prev };
        if (prevDecision) next[claimId] = prevDecision;
        else delete next[claimId];
        return next;
      });
      setClaimError('Could not save claim decision. Please check connection and try again.');
    }
  };

  const toggleRejectionCategory = (catKey: string) => {
    setRejectionCategories((prev) =>
      prev.includes(catKey) ? prev.filter((k) => k !== catKey) : [...prev, catKey]
    );
  };

  const handleListingDecision = async (decision: 'approved' | 'rejected') => {
    setDecisionError(null);
    setClaimError(null);

    if (decision === 'approved') {
      if (!imagesReviewed || !detailsReviewed) {
        setDecisionError('Please mark both Product Media (Section 1) and Craft Details (Section 2) as verified before approving.');
        return;
      }
      if (!allClaimsDecided) {
        setDecisionError('All statutory claims must be individually verified or rejected before approval.');
        return;
      }
    }

    if (decision === 'rejected') {
      if (rejectionCategories.length === 0) {
        setDecisionError('Please select at least one rejection category explaining what needs revision.');
        return;
      }
      if (!listingReason.trim()) {
        setDecisionError('Please provide a specific reason or note explaining why this listing was rejected.');
        return;
      }
    }

    setDecisionLoading(true);
    try {
      await service.decideApproval(listingId, {
        decision,
        reason: listingReason,
        rejection_categories: decision === 'rejected' ? rejectionCategories : [],
      });
      setListingDecisionStatus(decision);
      await refetch();
    } catch (err: any) {
      setDecisionError(err?.message || 'Failed to submit decision. Please try again.');
    } finally {
      setDecisionLoading(false);
    }
  };

  if (isLoading) {
    return <ProcessingIndicator hint="Loading craft details for review..." />;
  }

  if (isError || !listing) {
    return (
      <ErrorRetryCard
        errorText={
          (error as any)?.response?.data?.error?.message ||
          (error as any)?.message ||
          'Failed to load craft submission.'
        }
        onRetry={() => refetch()}
        asCard
        style={{ margin: spacing.lg }}
      />
    );
  }

  const catalogue = listing.catalogue?.catalogue;
  const titleEn = catalogue?.title?.en || 'Handcrafted Craft';
  const titleLocal = catalogue?.title?.local;
  const descriptionEn = catalogue?.description?.en;
  const descriptionLocal = catalogue?.description?.local;
  const category = catalogue?.category?.replace(/_/g, ' ') || 'Craft';
  const materials = catalogue?.materials || [];
  const techniques = catalogue?.techniques || [];
  const labourHours = catalogue?.labour?.hours;
  const skillLevel = catalogue?.labour?.skill_level;
  const stateCode = catalogue?.labour?.state_code;
  const wageFloor = listing.price?.floor_amount_paise
    ? Math.round(listing.price.floor_amount_paise / 100)
    : null;
  const notificationRef = listing.price?.wage_source?.notification_ref;

  // Media items: prioritize authentic product photos over any fallback placeholders
  const allImages = (listing.media || []).filter(
    (m: MediaAsset) => m.kind === 'image'
  );
  const realImages = allImages.filter((m) => !isPlaceholder(m.url));
  const imageAssets = realImages.length > 0 ? realImages : allImages;

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[
          styles.container,
          { paddingBottom: keyboardSpace > 0 ? keyboardSpace + 80 : 120 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header Bar */}
        <View style={styles.header}>
          <Text style={styles.kicker}>CLUSTER AUDIT · #{listing.id.slice(0, 8).toUpperCase()}</Text>
          <Text style={styles.title}>{titleEn}</Text>
          {titleLocal ? <Text style={styles.localTitle}>"{titleLocal}"</Text> : null}
          <View style={styles.metaRow}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>{category}</Text>
            </View>
            <View
              style={[
                styles.stateBadge,
                listingDecisionStatus === 'approved'
                  ? styles.stateBadgeApproved
                  : listingDecisionStatus === 'rejected'
                  ? styles.stateBadgeRejected
                  : styles.stateBadgePending,
              ]}
            >
              <Text
                style={[
                  styles.stateBadgeText,
                  listingDecisionStatus === 'approved'
                    ? styles.stateTextApproved
                    : listingDecisionStatus === 'rejected'
                    ? styles.stateTextRejected
                    : styles.stateTextPending,
                ]}
              >
                {listingDecisionStatus.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        {/* SECTION 1: Product Images */}
        <Card style={styles.sectionCard}>
          <Card.Content>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleGroup}>
                <MaterialCommunityIcons name="image-multiple-outline" size={20} color={colors.primary} />
                <Text style={styles.sectionTitle}>1. Product Media ({imageAssets.length})</Text>
              </View>
              <TouchableOpacity
                style={[styles.reviewCheckBtn, imagesReviewed && styles.reviewCheckBtnActive]}
                onPress={() => setImagesReviewed((prev) => !prev)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={imagesReviewed ? 'check-circle' : 'checkbox-blank-circle-outline'}
                  size={16}
                  color={imagesReviewed ? colors.successGreen : colors.textMuted}
                />
                <Text
                  style={[styles.reviewCheckText, imagesReviewed && styles.reviewCheckTextActive]}
                >
                  {imagesReviewed ? 'Images Verified' : 'Mark Verified'}
                </Text>
              </TouchableOpacity>
            </View>

            {imageAssets.length === 0 ? (
              <Text style={styles.emptyNotice}>No media images attached to this listing.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.imageGallery}
              >
                {imageAssets.map((asset, idx) => (
                  <View key={asset.id || idx} style={styles.galleryItem}>
                    {asset.url ? (
                      <Image
                        source={{ uri: normalizeMediaUrl(asset.url) || asset.url }}
                        style={styles.galleryImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.galleryPlaceholder}>
                        <MaterialCommunityIcons name="image" size={32} color={colors.textMuted} />
                      </View>
                    )}
                    <View style={styles.variantBadge}>
                      <Text style={styles.variantText}>{asset.variant || 'photo'}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </Card.Content>
        </Card>

        {/* SECTION 2: Craft Details & Specs */}
        <Card style={styles.sectionCard}>
          <Card.Content>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleGroup}>
                <MaterialCommunityIcons name="card-text-outline" size={20} color={colors.primary} />
                <Text style={styles.sectionTitle}>2. Craft Details & Wage Floor</Text>
              </View>
              <TouchableOpacity
                style={[styles.reviewCheckBtn, detailsReviewed && styles.reviewCheckBtnActive]}
                onPress={() => setDetailsReviewed((prev) => !prev)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={detailsReviewed ? 'check-circle' : 'checkbox-blank-circle-outline'}
                  size={16}
                  color={detailsReviewed ? colors.successGreen : colors.textMuted}
                />
                <Text
                  style={[styles.reviewCheckText, detailsReviewed && styles.reviewCheckTextActive]}
                >
                  {detailsReviewed ? 'Details Verified' : 'Mark Verified'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.specTable}>
              <View style={styles.specRow}>
                <Text style={styles.specLabel}>Category</Text>
                <Text style={styles.specValue}>{category}</Text>
              </View>

              {materials.length > 0 && (
                <View style={styles.specRow}>
                  <Text style={styles.specLabel}>Materials</Text>
                  <Text style={styles.specValue}>{materials.join(', ')}</Text>
                </View>
              )}

              {techniques.length > 0 && (
                <View style={styles.specRow}>
                  <Text style={styles.specLabel}>Techniques</Text>
                  <Text style={styles.specValue}>{techniques.join(', ')}</Text>
                </View>
              )}

              <View style={styles.specRow}>
                <Text style={styles.specLabel}>Labour & Skill</Text>
                <Text style={styles.specValue}>
                  {labourHours ? `${labourHours} hrs · ` : ''}
                  {formatSkillTier(skillLevel)}
                  {stateCode ? ` (${stateCode})` : ''}
                </Text>
              </View>

              {wageFloor && (
                <View style={[styles.specRow, styles.specRowHighlight]}>
                  <Text style={styles.specLabelHighlight}>Statutory Wage Floor</Text>
                  <Text style={styles.specValueHighlight}>₹{wageFloor}</Text>
                </View>
              )}

              {notificationRef && (
                <View style={styles.specRow}>
                  <Text style={styles.specLabel}>Wage Notification</Text>
                  <Text style={[styles.specValue, { fontSize: 11 }]}>{notificationRef}</Text>
                </View>
              )}

              {descriptionEn && (
                <View style={styles.descBlock}>
                  <Text style={styles.specLabel}>Description (English)</Text>
                  <Text style={styles.descText}>{descriptionEn}</Text>
                </View>
              )}

              {descriptionLocal && (
                <View style={styles.descBlock}>
                  <Text style={styles.specLabel}>Description (Local)</Text>
                  <Text style={styles.descText}>{descriptionLocal}</Text>
                </View>
              )}
            </View>
          </Card.Content>
        </Card>

        {/* SECTION 3: Provenance Claims */}
        <Card style={styles.sectionCard}>
          <Card.Content>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleGroup}>
                <MaterialCommunityIcons name="shield-check-outline" size={20} color={colors.primary} />
                <Text style={styles.sectionTitle}>3. Statutory Provenance Claims ({activeClaims.length})</Text>
              </View>
            </View>

            {claimError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{claimError}</Text>
              </View>
            )}

            {activeClaims.length === 0 ? (
              <Text style={styles.emptyNotice}>No provenance claims asserted on this craft.</Text>
            ) : (
              activeClaims.map((c) => {
                const decision = claimDecisions[c.claim];
                const note = evidenceNotes[c.claim] ?? '';
                const inputKey = `claim_${c.claim}`;

                return (
                  <View key={c.claim} style={styles.claimCard}>
                    <View style={styles.claimHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.claimName}>{formatClaimLabel(c.claim)}</Text>
                        <Text style={styles.claimSub}>Asserted by artisan in submission</Text>
                      </View>
                      {decision && (
                        <View
                          style={[
                            styles.claimStatusBadge,
                            decision === 'verified'
                              ? styles.claimBadgeVerified
                              : styles.claimBadgeRejected,
                          ]}
                        >
                          <MaterialCommunityIcons
                            name={decision === 'verified' ? 'check' : 'close'}
                            size={12}
                            color={decision === 'verified' ? colors.successGreen : colors.error}
                          />
                          <Text
                            style={[
                              styles.claimStatusText,
                              decision === 'verified'
                                ? styles.claimTextVerified
                                : styles.claimTextRejected,
                            ]}
                          >
                            {decision.toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View
                      style={styles.claimInputWrap}
                      onLayout={(e) => handleInputLayout(inputKey, e)}
                    >
                      <TextInput
                        mode="outlined"
                        label="Audit / Evidence Note"
                        placeholder="e.g. Master certificate verified against cluster registry"
                        value={note}
                        onChangeText={(txt) =>
                          setEvidenceNotes((prev) => ({ ...prev, [c.claim]: txt }))
                        }
                        onFocus={() => handleInputFocus(inputKey)}
                        outlineColor={colors.border}
                        activeOutlineColor={colors.secondary}
                        textColor={colors.text}
                        style={styles.input}
                        theme={{ colors: { background: colors.surface } }}
                      />
                    </View>

                    <View style={styles.claimActionsRow}>
                      <Button
                        mode={decision === 'verified' ? 'contained' : 'outlined'}
                        onPress={() => handleClaimDecision(c.claim, 'verified')}
                        buttonColor={decision === 'verified' ? colors.secondary : undefined}
                        textColor={decision === 'verified' ? colors.onPrimary : colors.secondary}
                        style={styles.claimActionBtn}
                        contentStyle={{ height: 40 }}
                        icon="check-decagram"
                      >
                        Verify
                      </Button>
                      <Button
                        mode={decision === 'rejected' ? 'contained' : 'outlined'}
                        onPress={() => handleClaimDecision(c.claim, 'rejected')}
                        buttonColor={decision === 'rejected' ? colors.error : undefined}
                        textColor={decision === 'rejected' ? colors.onPrimary : colors.error}
                        style={[styles.claimActionBtn, { borderColor: colors.error }]}
                        contentStyle={{ height: 40 }}
                        icon="close-circle-outline"
                      >
                        Reject
                      </Button>
                    </View>
                  </View>
                );
              })
            )}
          </Card.Content>
        </Card>

        {/* DECISION FORM */}
        <Card style={styles.decisionCard} onLayout={(e) => handleInputLayout('decision', e)}>
          <Card.Content>
            <View style={styles.decisionHeader}>
              <MaterialCommunityIcons name="gavel" size={20} color={colors.secondary} />
              <Text style={styles.decisionTitle}>Coordinator Final Decision</Text>
            </View>

            {listingDecisionStatus === 'approved' ? (
              <View style={styles.approvedNotice}>
                <MaterialCommunityIcons name="check-decagram" size={32} color={colors.successGreen} />
                <Text style={styles.approvedNoticeTitle}>Listing is Approved</Text>
                <Text style={styles.approvedNoticeSubtitle}>
                  All statutory claims verified and minimum wage rates confirmed. Ready for marketplace export.
                </Text>
                <Button
                  mode="contained"
                  onPress={() => navigation.navigate('PublishExport', { listingId })}
                  buttonColor={colors.secondary}
                  style={{ marginTop: spacing.md, width: '100%' }}
                  contentStyle={{ height: 48 }}
                  icon="cloud-upload-outline"
                >
                  Proceed to Marketplace Export
                </Button>
              </View>
            ) : (
              <View>
                <Text style={styles.decisionSubtitle}>
                  Approve to queue for marketplace export, or reject with specific feedback categories so the artisan can revise.
                </Text>

                {decisionError && (
                  <View style={styles.errorBox}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.error} />
                    <Text style={styles.errorText}>{decisionError}</Text>
                  </View>
                )}

                {/* TASK 3: Rejection Category Chips */}
                <View style={styles.rejectionSection}>
                  <Text style={styles.rejectionSectionLabel}>
                    Rejection Categories (Required if rejecting):
                  </Text>
                  <View style={styles.chipsRow}>
                    {REJECTION_CATEGORIES.map((cat) => {
                      const isSelected = rejectionCategories.includes(cat.key);
                      return (
                        <TouchableOpacity
                          key={cat.key}
                          style={[styles.catChip, isSelected && styles.catChipSelected]}
                          onPress={() => toggleRejectionCategory(cat.key)}
                          activeOpacity={0.7}
                        >
                          <MaterialCommunityIcons
                            name={cat.icon}
                            size={14}
                            color={isSelected ? colors.error : colors.textMuted}
                            style={{ marginRight: 4 }}
                          />
                          <Text
                            style={[styles.catChipText, isSelected && styles.catChipTextSelected]}
                          >
                            {cat.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Feedback Notes */}
                <TextInput
                  mode="outlined"
                  label="Decision Notes / Feedback"
                  placeholder="Required if rejecting listing. Enter instructions for artisan..."
                  value={listingReason}
                  onChangeText={setListingReason}
                  onFocus={() => handleInputFocus('decision')}
                  outlineColor={colors.border}
                  activeOutlineColor={colors.secondary}
                  textColor={colors.text}
                  style={styles.input}
                  multiline
                  numberOfLines={3}
                  theme={{ colors: { background: colors.surface } }}
                />

                {(!imagesReviewed || !detailsReviewed) && (
                  <View style={styles.warningNote}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.warningText} />
                    <Text style={styles.warningNoteText}>
                      Product Media (Section 1) and Craft Details (Section 2) must both be marked as verified before approving.
                    </Text>
                  </View>
                )}
                {!allClaimsDecided && (
                  <View style={styles.warningNote}>
                    <MaterialCommunityIcons name="information-outline" size={14} color={colors.warningText} />
                    <Text style={styles.warningNoteText}>
                      Every statutory claim must be resolved before this listing can be approved.
                    </Text>
                  </View>
                )}

                {/* Decision Action Buttons */}
                <View style={styles.decisionActions}>
                  <Button
                    mode="contained"
                    onPress={() => handleListingDecision('approved')}
                    loading={decisionLoading}
                    disabled={decisionLoading}
                    buttonColor={colors.secondary}
                    textColor="#FFFFFF"
                    style={styles.decisionBtn}
                    contentStyle={{ height: 48 }}
                    icon="check"
                  >
                    Approve Listing
                  </Button>
                  <Button
                    mode="outlined"
                    onPress={() => handleListingDecision('rejected')}
                    loading={decisionLoading}
                    disabled={decisionLoading}
                    textColor={colors.error}
                    style={[styles.decisionBtn, { borderColor: colors.error }]}
                    contentStyle={{ height: 48 }}
                    icon="close"
                  >
                    Reject with Feedback
                  </Button>
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
    keyboardAvoid: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      padding: spacing.md,
      gap: spacing.md,
    },
    header: {
      paddingHorizontal: spacing.xs,
      paddingTop: spacing.xs,
    },
    kicker: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.2,
      color: colors.textMuted,
      marginBottom: 3,
    },
    title: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.text,
      lineHeight: 26,
    },
    localTitle: {
      fontSize: 14,
      fontStyle: 'italic',
      color: colors.textMuted,
      marginTop: 2,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
    },
    categoryBadge: {
      backgroundColor: colors.badgeNeutral,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    categoryBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'capitalize',
    },
    stateBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    stateBadgePending: {
      backgroundColor: colors.warningLight,
    },
    stateBadgeApproved: {
      backgroundColor: colors.successLight,
    },
    stateBadgeRejected: {
      backgroundColor: colors.errorLight,
    },
    stateBadgeText: {
      fontSize: 11,
      fontWeight: '800',
    },
    stateTextPending: {
      color: colors.warningText,
    },
    stateTextApproved: {
      color: colors.successGreen,
    },
    stateTextRejected: {
      color: colors.error,
    },
    sectionCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      elevation: 1,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    sectionTitleGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.text,
    },
    reviewCheckBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    reviewCheckBtnActive: {
      backgroundColor: colors.successLight,
      borderColor: colors.successBorder,
    },
    reviewCheckText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textMuted,
    },
    reviewCheckTextActive: {
      color: colors.successGreen,
    },
    imageGallery: {
      gap: spacing.sm,
      paddingVertical: 4,
    },
    galleryItem: {
      width: 120,
      height: 120,
      borderRadius: 10,
      backgroundColor: colors.badgeNeutral,
      overflow: 'hidden',
      position: 'relative',
    },
    galleryImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    galleryPlaceholder: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    variantBadge: {
      position: 'absolute',
      bottom: 4,
      left: 4,
      backgroundColor: 'rgba(0,0,0,0.6)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    variantText: {
      fontSize: 9,
      fontWeight: '700',
      color: '#fff',
      textTransform: 'uppercase',
    },
    specTable: {
      gap: 8,
    },
    specRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    specRowHighlight: {
      backgroundColor: colors.indigoLight,
      paddingHorizontal: 8,
      borderRadius: 6,
      borderBottomWidth: 0,
    },
    specLabel: {
      fontSize: 12,
      color: colors.textMuted,
    },
    specValue: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      maxWidth: '65%',
      textAlign: 'right',
    },
    specLabelHighlight: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.secondary,
    },
    specValueHighlight: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.secondary,
    },
    descBlock: {
      marginTop: 4,
      gap: 4,
    },
    descText: {
      fontSize: 12,
      color: colors.text,
      lineHeight: 18,
    },
    claimCard: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 10,
      marginBottom: 10,
      gap: 8,
    },
    claimHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    claimName: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    claimSub: {
      fontSize: 11,
      color: colors.textMuted,
    },
    claimStatusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    claimBadgeVerified: {
      backgroundColor: colors.successLight,
    },
    claimBadgeRejected: {
      backgroundColor: colors.errorLight,
    },
    claimStatusText: {
      fontSize: 10,
      fontWeight: '800',
    },
    claimTextVerified: {
      color: colors.successGreen,
    },
    claimTextRejected: {
      color: colors.error,
    },
    claimInputWrap: {
      width: '100%',
    },
    claimActionsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    claimActionBtn: {
      flex: 1,
      borderRadius: 8,
    },
    decisionCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: colors.secondary,
      elevation: 2,
    },
    decisionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },
    decisionTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.secondary,
    },
    decisionSubtitle: {
      fontSize: 12,
      color: colors.textMuted,
      lineHeight: 17,
      marginBottom: spacing.md,
    },
    rejectionSection: {
      marginBottom: spacing.md,
      gap: 6,
    },
    rejectionSectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
    },
    chipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    catChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    catChipSelected: {
      backgroundColor: colors.errorLight,
      borderColor: colors.error,
    },
    catChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textMuted,
    },
    catChipTextSelected: {
      color: colors.error,
      fontWeight: '700',
    },
    input: {
      fontSize: 13,
      marginBottom: spacing.sm,
    },
    warningNote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.warningLight,
      padding: 8,
      borderRadius: 6,
      marginBottom: spacing.sm,
    },
    warningNoteText: {
      fontSize: 11,
      color: colors.warningText,
      flex: 1,
    },
    decisionActions: {
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    decisionBtn: {
      borderRadius: 10,
    },
    approvedNotice: {
      alignItems: 'center',
      padding: spacing.md,
      gap: 6,
    },
    approvedNoticeTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.successGreen,
    },
    approvedNoticeSubtitle: {
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 17,
    },
    emptyNotice: {
      fontSize: 12,
      color: colors.textMuted,
      fontStyle: 'italic',
      paddingVertical: 4,
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.errorLight,
      padding: 8,
      borderRadius: 6,
      marginBottom: spacing.sm,
    },
    errorText: {
      fontSize: 11,
      color: colors.error,
      flex: 1,
    },
  });
}
