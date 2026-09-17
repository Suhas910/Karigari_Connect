// src/features/submit-approval/SubmitApprovalScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { Text, Button, Card } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { ArtisanStackParamList } from '../../types/navigation';
import type { Listing } from '../../types/contracts';
import { service } from '../../services';
import { getDraft, saveDraft } from '../../services/database';
import { colors, spacing } from '../../theme';
import { StepHeader, BottomDock } from '../../components';
import { useDraftStore, PILOT_STATES } from '../../store/draftStore';

interface GateDefinition {
  key: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  titleKey: string;
  descKey: string;
}

const GATES: GateDefinition[] = [
  {
    key: 'catalogue',
    icon: 'file-document-edit-outline',
    titleKey: 'submit.gateCatalogueTitle',
    descKey: 'submit.gateCatalogueDesc',
  },
  {
    key: 'image',
    icon: 'camera-burst',
    titleKey: 'submit.gateImageTitle',
    descKey: 'submit.gateImageDesc',
  },
  {
    key: 'price',
    icon: 'scale-balance',
    titleKey: 'submit.gatePriceTitle',
    descKey: 'submit.gatePriceDesc',
  },
  {
    key: 'claims',
    icon: 'shield-check-outline',
    titleKey: 'submit.gateClaimsTitle',
    descKey: 'submit.gateClaimsDesc',
  },
];

interface DraftPayload {
  catalogueConfirmed?: boolean;
  imageAccepted?: boolean;
  priceReviewed?: boolean;
  claimsConfirmed?: boolean;
}

export default function SubmitApprovalScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'SubmitApproval'>>();
  const { draftId } = route.params;

  const selectedState = useDraftStore((s) => s.selectedState);
  const selectedZone = useDraftStore((s) => s.selectedZone);
  const currentStateObj = PILOT_STATES.find((s) => s.code === selectedState) || PILOT_STATES[0];
  const currentZoneObj = currentStateObj.zones.find((z) => z.code === selectedZone) || currentStateObj.zones[0];

  const [listing, setListing] = useState<Listing | null>(null);
  const [, setDraftPayload] = useState<DraftPayload>({});
  const [unverifiedClaims, setUnverifiedClaims] = useState<string[]>([]);
  const [checkedState, setCheckedState] = useState<Record<string, boolean>>({
    catalogue: false,
    image: false,
    price: false,
    claims: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!draftId) return;
    (async () => {
      try {
        const draft = await getDraft(draftId);
        const payload = (draft?.payload ?? {}) as DraftPayload;
        setDraftPayload(payload);

        let unverified: string[] = [];
        try {
          const l = await service.getListing(draftId);
          setListing(l);
          const claims = l.claims ?? [];
          unverified = claims
            .filter((c) => c.asserted_by_artisan && !c.coordinator_verified)
            .map((c) => c.claim);
        } catch (err) {
          console.error('Failed to load listing', err);
        }
        setUnverifiedClaims(unverified);
        const claimsOk = unverified.length === 0;

        setCheckedState({
          catalogue: Boolean(payload.catalogueConfirmed),
          image: Boolean(payload.imageAccepted),
          price: Boolean(payload.priceReviewed),
          claims: claimsOk,
        });
      } catch (err) {
        console.error('Failed to load draft payload in SubmitApprovalScreen', err);
      }
    })();
  }, [draftId]);

  const handleToggle = async (key: string) => {
    if (key === 'claims' && unverifiedClaims.length > 0) {
      setSubmitError(t('submit.claimsNeedVerification'));
      return;
    }
    setSubmitError(null);
    const newVal = !checkedState[key];
    const updated = { ...checkedState, [key]: newVal };
    setCheckedState(updated);

    try {
      const existing = await getDraft(draftId);
      const payload = { ...(existing?.payload ?? {}) };
      if (key === 'catalogue') payload.catalogueConfirmed = newVal;
      if (key === 'image') payload.imageAccepted = newVal;
      if (key === 'price') payload.priceReviewed = newVal;
      if (key === 'claims') payload.claimsConfirmed = newVal;

      await saveDraft({
        id: draftId,
        listing_id: existing?.listing_id ?? draftId,
        state: existing?.state ?? 'draft',
        preferred_language: existing?.preferred_language ?? 'en',
        payload,
      });
      setDraftPayload(payload);
    } catch (err) {
      console.error('Failed to persist checklist toggle', err);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await service.submitForApproval(draftId);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(t('submit.submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'MyListings' }],
    });
  };

  const handleListAnother = () => {
    navigation.reset({
      index: 1,
      routes: [{ name: 'MyListings' }, { name: 'Capture' }],
    });
  };

  // Craft preview details
  const titleEn = listing?.catalogue?.catalogue?.title?.en || t('listings.untitledDraft', { defaultValue: 'Handcrafted Piece' });
  const category = listing?.catalogue?.catalogue?.category?.replace(/_/g, ' ');
  const firstPhoto = listing?.media?.find((m) => m.kind === 'image')?.url;
  const priceFloor = listing?.price?.floor_amount_paise ? Math.round(listing.price.floor_amount_paise / 100) : null;
  const priceHigh = listing?.price?.recommended_high_paise ? Math.round(listing.price.recommended_high_paise / 100) : null;

  const completedCount = GATES.filter((g) => Boolean(checkedState[g.key])).length;
  const allItemsChecked = completedCount === GATES.length;

  if (submitted) {
    return (
      <View style={styles.successRoot}>
        <ScrollView contentContainerStyle={styles.successScroll} showsVerticalScrollIndicator={false}>
          {/* Celebratory Icon Badge with concentric glowing ring */}
          <View style={styles.successIconOuter}>
            <View style={styles.successIconInner}>
              <MaterialCommunityIcons name="check-decagram" size={54} color="#059669" />
            </View>
          </View>

          <Text style={styles.successTitle}>{t('submit.successTitle')}</Text>
          <Text style={styles.successSubtitle}>
            {t('submit.successSubtitle')}
          </Text>

          {/* Submission Receipt / Summary Card */}
          <Card style={styles.receiptCard}>
            <Card.Content style={styles.receiptContent}>
              <View style={styles.receiptHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.receiptEyebrow}>{t('submit.successRefId')}</Text>
                  <Text style={styles.receiptRefCode}>#{draftId.slice(0, 8).toUpperCase()}</Text>
                </View>
                <View style={styles.receiptStatusPill}>
                  <MaterialCommunityIcons name="clock-outline" size={13} color={colors.secondary} />
                  <Text style={styles.receiptStatusText}>{t('submit.successStatusValue')}</Text>
                </View>
              </View>

              <View style={styles.receiptDivider} />

              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Craft</Text>
                <Text style={styles.receiptDetailValue} numberOfLines={1}>{titleEn}</Text>
              </View>

              {priceFloor && (
                <View style={styles.receiptDetailRow}>
                  <Text style={styles.receiptDetailLabel}>Fair Floor Price</Text>
                  <Text style={styles.receiptDetailPrice}>₹{priceFloor}</Text>
                </View>
              )}

              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Jurisdiction</Text>
                <Text style={styles.receiptDetailValue}>{selectedState} · {currentZoneObj?.name}</Text>
              </View>
            </Card.Content>
          </Card>

          {/* Reassuring note */}
          <View style={styles.successNoticeBox}>
            <MaterialCommunityIcons name="shield-check" size={20} color="#059669" style={{ marginRight: 8 }} />
            <Text style={styles.successNoticeText}>
              {t('submit.submittedText')}
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.successActions}>
            <Button
              mode="contained"
              onPress={handleDone}
              buttonColor={colors.primary}
              style={styles.actionBtnPrimary}
              contentStyle={{ height: 48 }}
              icon="view-list"
            >
              {t('submit.viewInReviewBtn')}
            </Button>
            <Button
              mode="outlined"
              onPress={handleListAnother}
              textColor={colors.secondary}
              style={styles.actionBtnSecondary}
              contentStyle={{ height: 48 }}
              icon="plus"
            >
              {t('submit.listAnotherBtn')}
            </Button>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { paddingBottom: 140 }]}
        showsVerticalScrollIndicator={false}
      >
        <StepHeader
          currentStep={5}
          totalSteps={5}
          title={t('submit.title')}
          subtitle={t('submit.subtitle')}
        />

        <View style={styles.content}>
          {/* Craft Showcase Hero Card */}
          <View style={styles.craftHeroCard}>
            <View style={styles.craftThumbnailBox}>
              {firstPhoto ? (
                <Image source={{ uri: firstPhoto }} style={styles.craftThumbnailImage} />
              ) : (
                <View style={styles.craftThumbnailFallback}>
                  <MaterialCommunityIcons name="palette-swatch-outline" size={28} color={colors.secondary} />
                </View>
              )}
            </View>

            <View style={styles.craftHeroDetails}>
              <Text style={styles.craftHeroEyebrow}>{t('submit.showcaseEyebrow')}</Text>
              <Text style={styles.craftHeroTitle} numberOfLines={2}>
                {titleEn}
              </Text>
              <View style={styles.craftHeroMetaRow}>
                {category && (
                  <View style={styles.craftCategoryBadge}>
                    <Text style={styles.craftCategoryText}>{category}</Text>
                  </View>
                )}
                <View style={styles.craftLocationBadge}>
                  <MaterialCommunityIcons name="map-marker-outline" size={11} color={colors.textMuted} />
                  <Text style={styles.craftLocationText}>{selectedState} · {currentZoneObj?.name}</Text>
                </View>
              </View>
              {priceFloor && (
                <Text style={styles.craftHeroPrice}>
                  ₹{priceFloor} {priceHigh ? `– ₹${priceHigh}` : ''}
                  <Text style={styles.craftHeroPriceUnit}> (Statutory Fair Price)</Text>
                </Text>
              )}
            </View>
          </View>

          {/* Readiness Meter Card */}
          <View style={styles.readinessCard}>
            <View style={styles.readinessHeaderRow}>
              <View style={styles.readinessTitleGroup}>
                <MaterialCommunityIcons
                  name={allItemsChecked ? 'shield-check' : 'clipboard-check-outline'}
                  size={18}
                  color={allItemsChecked ? '#059669' : colors.primary}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.readinessTitle}>{t('submit.checklistHeader')}</Text>
              </View>
              <View style={[styles.readinessBadge, allItemsChecked ? styles.readinessBadgeDone : styles.readinessBadgePending]}>
                <Text style={[styles.readinessBadgeText, allItemsChecked ? styles.readinessBadgeTextDone : styles.readinessBadgeTextPending]}>
                  {t('submit.readinessScore', { completed: completedCount, total: 4 })}
                </Text>
              </View>
            </View>

            {/* Visual Progress Bar */}
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressBar,
                  { width: `${(completedCount / 4) * 100}%` },
                  allItemsChecked && styles.progressBarDone,
                ]}
              />
            </View>

            <Text style={styles.readinessSubtext}>
              {allItemsChecked ? t('submit.noticeReady') : t('submit.noticeIncomplete')}
            </Text>
          </View>

          {/* Milestone Pipeline Cards */}
          <View style={styles.gatesContainer}>
            {GATES.map((gate) => {
              const checked = Boolean(checkedState[gate.key]);
              return (
                <TouchableOpacity
                  key={gate.key}
                  style={[styles.gateCard, checked && styles.gateCardChecked]}
                  onPress={() => handleToggle(gate.key)}
                  activeOpacity={0.7}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                >
                  <View style={[styles.gateIconBox, checked && styles.gateIconBoxChecked]}>
                    <MaterialCommunityIcons
                      name={gate.icon}
                      size={22}
                      color={checked ? colors.secondary : colors.textMuted}
                    />
                  </View>

                  <View style={styles.gateContent}>
                    <Text style={[styles.gateTitle, checked && styles.gateTitleChecked]}>
                      {t(gate.titleKey)}
                    </Text>
                    <Text style={styles.gateDesc}>
                      {t(gate.descKey)}
                    </Text>
                  </View>

                  <View style={[styles.gatePill, checked ? styles.gatePillChecked : styles.gatePillPending]}>
                    {checked ? (
                      <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" style={{ marginRight: 3 }} />
                    ) : (
                      <MaterialCommunityIcons name="pencil-outline" size={12} color={colors.primary} style={{ marginRight: 3 }} />
                    )}
                    <Text style={[styles.gatePillText, checked ? styles.gatePillTextChecked : styles.gatePillTextPending]}>
                      {checked ? t('submit.statusVerified') : t('submit.statusTapToVerify')}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Statutory Claims Warning */}
          {unverifiedClaims.length > 0 && (
            <Card style={styles.claimWarningCard}>
              <Card.Content>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.error} style={{ marginRight: 6 }} />
                  <Text style={styles.claimWarningTitle}>{t('submit.claimsPendingTitle')}</Text>
                </View>
                <Text style={styles.claimWarningSubtitle}>
                  {t('submit.claimsPendingText')}
                </Text>
                {unverifiedClaims.map((claim) => (
                  <Text key={claim} style={styles.claimWarningItem}>
                    • {claim === 'skill_level_master_self_declared' ? t('submit.masterSelfDeclared') : claim.replace(/_/g, ' ')}
                  </Text>
                ))}
              </Card.Content>
            </Card>
          )}

          {/* Journey Roadmap Card: What Happens Next? */}
          <Card style={styles.roadmapCard}>
            <Card.Content>
              <View style={styles.roadmapHeader}>
                <MaterialCommunityIcons name="map-marker-path" size={18} color={colors.secondary} style={{ marginRight: 6 }} />
                <Text style={styles.roadmapTitle}>{t('submit.whatHappensTitle')}</Text>
              </View>

              <View style={styles.roadmapStep}>
                <View style={styles.stepNumberBadge}>
                  <Text style={styles.stepNumberText}>1</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>{t('submit.step1Title')}</Text>
                  <Text style={styles.stepDesc}>{t('submit.step1Desc')}</Text>
                </View>
              </View>

              <View style={styles.roadmapStep}>
                <View style={styles.stepNumberBadge}>
                  <Text style={styles.stepNumberText}>2</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>{t('submit.step2Title')}</Text>
                  <Text style={styles.stepDesc}>{t('submit.step2Desc')}</Text>
                </View>
              </View>

              <View style={[styles.roadmapStep, { borderLeftWidth: 0, paddingBottom: 0 }]}>
                <View style={[styles.stepNumberBadge, { backgroundColor: '#059669' }]}>
                  <Text style={styles.stepNumberText}>3</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>{t('submit.step3Title')}</Text>
                  <Text style={styles.stepDesc}>{t('submit.step3Desc')}</Text>
                </View>
              </View>
            </Card.Content>
          </Card>
        </View>
      </ScrollView>

      {/* Docked Action Button */}
      <BottomDock>
        {submitError && (
          <View style={styles.errorBox}>
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.error} style={{ marginRight: 6 }} />
            <Text style={styles.errorText}>{submitError}</Text>
          </View>
        )}
        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={submitting}
          disabled={!allItemsChecked || submitting}
          buttonColor={allItemsChecked ? colors.primary : '#9CA3AF'}
          style={styles.submitBtn}
          contentStyle={{ height: 48 }}
          icon={allItemsChecked ? 'send-check' : 'lock-outline'}
        >
          {allItemsChecked ? t('submit.submitBtn') : t('submit.completeAllBtn')}
        </Button>
      </BottomDock>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flexGrow: 1,
    paddingBottom: spacing.xxl,
  },
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },

  // Craft Hero Card
  craftHeroCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  craftThumbnailBox: {
    width: 76,
    height: 76,
    borderRadius: 10,
    backgroundColor: colors.badgeNeutral,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  craftThumbnailImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  craftThumbnailFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  craftHeroDetails: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  craftHeroEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  craftHeroTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 20,
    marginBottom: 4,
  },
  craftHeroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 3,
  },
  craftCategoryBadge: {
    backgroundColor: colors.badgeNeutral,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  craftCategoryText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'capitalize',
  },
  craftLocationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  craftLocationText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },
  craftHeroPrice: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  craftHeroPriceUnit: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },

  // Readiness Meter Card
  readinessCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  readinessHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  readinessTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  readinessTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: 0.5,
  },
  readinessBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  readinessBadgeDone: {
    backgroundColor: '#D1FAE5',
  },
  readinessBadgePending: {
    backgroundColor: '#FEF3C7',
  },
  readinessBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  readinessBadgeTextDone: {
    color: '#065F46',
  },
  readinessBadgeTextPending: {
    color: '#92400E',
  },
  progressTrack: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressBarDone: {
    backgroundColor: '#059669',
  },
  readinessSubtext: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },

  // Gates / Milestone cards
  gatesContainer: {
    gap: 8,
  },
  gateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 12,
  },
  gateCardChecked: {
    borderColor: '#CBD5E1',
  },
  gateIconBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  gateIconBoxChecked: {
    backgroundColor: colors.indigoLight,
  },
  gateContent: {
    flex: 1,
    marginRight: 8,
  },
  gateTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  gateTitleChecked: {
    color: colors.text,
  },
  gateDesc: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 15,
    marginTop: 2,
  },
  gatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
  },
  gatePillChecked: {
    backgroundColor: colors.secondary,
  },
  gatePillPending: {
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
  },
  gatePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  gatePillTextChecked: {
    color: '#FFFFFF',
  },
  gatePillTextPending: {
    color: colors.primary,
  },

  // Claims Warning Card
  claimWarningCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    elevation: 0,
  },
  claimWarningTitle: {
    fontSize: 11,
    letterSpacing: 0.6,
    fontWeight: '700',
    color: colors.error,
  },
  claimWarningSubtitle: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 16,
    marginBottom: 4,
  },
  claimWarningItem: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
    marginTop: 2,
  },

  // Roadmap Card
  roadmapCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 1,
  },
  roadmapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  roadmapTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: 0.6,
  },
  roadmapStep: {
    flexDirection: 'row',
    paddingLeft: 4,
    paddingBottom: 14,
    borderLeftWidth: 2,
    borderLeftColor: '#E5E7EB',
    marginLeft: 12,
  },
  stepNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -12,
    marginRight: 10,
  },
  stepNumberText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  stepDesc: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
  },

  // Bottom dock
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    flex: 1,
  },
  submitBtn: {
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
    borderRadius: 10,
  },

  // Success screen
  successRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  successScroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    paddingVertical: 48,
  },
  successIconOuter: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  successIconInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  successSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: spacing.xl,
    maxWidth: 320,
  },
  receiptCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
    marginBottom: spacing.lg,
  },
  receiptContent: {
    padding: spacing.md,
  },
  receiptHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  receiptEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  receiptRefCode: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginTop: 1,
  },
  receiptStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.indigoLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  receiptStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.secondary,
  },
  receiptDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 12,
  },
  receiptDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  receiptDetailLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  receiptDetailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    maxWidth: '65%',
  },
  receiptDetailPrice: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  successNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    padding: spacing.md,
    marginBottom: spacing.xl,
    width: '100%',
  },
  successNoticeText: {
    flex: 1,
    fontSize: 12,
    color: '#065F46',
    lineHeight: 18,
  },
  successActions: {
    width: '100%',
    gap: spacing.sm,
  },
  actionBtnPrimary: {
    borderRadius: 10,
  },
  actionBtnSecondary: {
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1.5,
  },
});