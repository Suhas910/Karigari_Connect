// src/features/price/PriceScreen.tsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { Text, Button, Card, TextInput, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useTranslation } from 'react-i18next';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArtisanStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { getDraft, saveDraft } from '../../services/database';
import { useDraftStore } from '../../store/draftStore';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import type { PriceResult } from '../../types/contracts';
import { ProcessingIndicator, ErrorRetryCard, StepHeader, BottomDock } from '../../components';

const paiseToRupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

export default function PriceScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'Price'>>();
  const headerHeight = useHeaderHeight();
  const { draftId } = route.params;

  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const scrollViewRef = useRef<ScrollView>(null);
  const [price, setPrice] = useState<PriceResult | null>(null);
  const [sellingPrice, setSellingPrice] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [priceError, setPriceError] = useState<string | null>(null);

  const fetchPrice = async () => {
    setLoading(true);
    setPriceError(null);
    try {
      const existing = await getDraft(draftId);
      const cat = existing?.payload?.catalogue;
      const declaration = existing?.payload?.skillDeclaration || useDraftStore.getState().skillDeclaration;

      // Read persistent artisan profile to retrieve coordinator-verified or declared skill tier & zone
      let profileSkill: string | undefined;
      let profileZone: string | undefined;
      let profileState: string | undefined;
      let profileSource: 'coordinator_verified' | 'artisan_card_elevation' | 'self_declared' | undefined;

      try {
        const profile = await service.getArtisanProfile();
        if (profile) {
          if (profile.verified_skill_level && profile.profile_status === 'verified') {
            profileSkill = profile.verified_skill_level;
            profileSource = 'coordinator_verified';
          } else if (profile.declared_skill_level) {
            profileSkill = profile.declared_skill_level;
            profileSource =
              profile.id_proof_type === 'pehchan_card' || profile.id_proof_type === 'pm_vishwakarma'
                ? 'artisan_card_elevation'
                : 'self_declared';
          }

          if (profile.declared_zone) {
            const parts = profile.declared_zone.split('/');
            if (parts.length === 2) {
              profileState = parts[0];
              profileZone = parts[1];
            } else {
              profileZone = profile.declared_zone;
            }
          }

          if (profileState) {
            useDraftStore.getState().setSelectedState(profileState, profileZone);
          }
        }
      } catch (err) {
        // Fall back gracefully if offline or mock
      }

      const materialCostInr = cat?.material_cost_paise ? Math.round(cat.material_cost_paise / 100) : 800;
      const labourHours = cat?.labour?.hours ?? 12;
      const stateCode =
        profileState ||
        declaration?.stateCode ||
        useDraftStore.getState().selectedState ||
        cat?.labour?.state_code ||
        'KA';

      const zoneCode =
        profileZone ||
        declaration?.zone ||
        useDraftStore.getState().selectedZone ||
        'zone_1';

      let declaredSkill = declaration?.skillLevelSelfDeclared;
      if (declaration?.hasArtisanCard && declaredSkill === 'skilled') {
        declaredSkill = 'highly_skilled';
      }
      const skillLevel = profileSkill || declaredSkill || cat?.labour?.skill_level || 'skilled';
      const techniques = cat?.techniques && cat.techniques.length > 0 ? cat.techniques : [];
      const skillLevelSource =
        profileSource ||
        declaration?.source ||
        (declaration?.hasArtisanCard ? 'artisan_card_elevation' : 'self_declared');

      const result = await service.requestPrice(draftId, {
        material_cost_inr: materialCostInr,
        labour_hours: labourHours,
        state_code: stateCode,
        zone: zoneCode,
        skill_level: skillLevel,
        skill_level_source: skillLevelSource,
        techniques,
        comparables: [],
      });
      setPrice(result);

      if (result.status === 'available') {
        setSellingPrice(String(Math.round(result.recommended_low_paise / 100)));
      }

      if (result.status === 'available') {
        try {
          await saveDraft({
            id: draftId,
            listing_id: existing?.listing_id ?? draftId,
            state: existing?.state ?? 'draft',
            preferred_language: existing?.preferred_language ?? 'en',
            payload: {
              ...(existing?.payload ?? {}),
              priceReviewed: true,
              priceResult: result,
            },
          });
        } catch (dbErr) {
          console.error('Failed to update draft payload in PriceScreen', dbErr);
        }
      }
    } catch (err) {
      setPriceError(t('price.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handlePriceInputFocus = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 60);
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 200);
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 400);
  };

  useEffect(() => {
    fetchPrice();
  }, [draftId]);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }
    );
    return () => {
      showSub.remove();
    };
  }, []);

  const handleContinue = async () => {
    try {
      const existing = await getDraft(draftId);
      const floorPaise = price?.floor_amount_paise ?? 0;
      const parsedRupees = parseFloat(sellingPrice);
      const finalPricePaise = !isNaN(parsedRupees) && parsedRupees > 0
        ? Math.round(parsedRupees * 100)
        : floorPaise;

      await saveDraft({
        id: draftId,
        listing_id: existing?.listing_id ?? draftId,
        state: existing?.state ?? 'draft',
        preferred_language: existing?.preferred_language ?? 'en',
        payload: {
          ...(existing?.payload ?? {}),
          priceReviewed: true,
          finalPricePaise,
          sellingPriceRupees: Math.round(finalPricePaise / 100),
          priceResult: price,
        },
      });
    } catch (dbErr) {
      console.error('Failed to update draft payload on continue', dbErr);
    }
    navigation.navigate('SubmitApproval', { draftId });
  };

  if (loading) {
    return <ProcessingIndicator hint={t('price.calculating')} />;
  }

  if (priceError || !price) {
    return (
      <ErrorRetryCard
        errorText={priceError ?? t('price.genericError')}
        onRetry={fetchPrice}
        retryLabel={t('common.retry')}
      />
    );
  }

  // Hard rule: never invent a number. If unavailable, say so plainly — calm, not alarming.
  if (price.status === 'unavailable') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView contentContainerStyle={styles.container}>
          <StepHeader
            currentStep={5}
            totalSteps={5}
            title={t('price.protectionTitle')}
            subtitle={t('price.protectionSubtitle')}
          />

          <View style={styles.content}>
            <Card style={styles.unavailableCard}>
              <Card.Content>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  {t('price.underVerification')}
                </Text>
                <Text style={styles.unavailableText}>
                  {t('price.underVerificationText')}
                </Text>
              </Card.Content>
            </Card>

            {price.fallback_suggestion ? (
              <Card style={styles.fallbackCard}>
                <Card.Content>
                  <Text style={styles.fallbackBadge}>
                    {t('price.referenceOnly')}
                  </Text>
                  <Text variant="titleMedium" style={styles.fallbackTitle}>
                    {price.fallback_suggestion.used_tier === 'skilled' ? t('price.skilledTierRate') : price.fallback_suggestion.used_tier}: {t('price.perHour', { amount: `₹${price.fallback_suggestion.hourly_wage_inr.toFixed(2)}` })}
                  </Text>
                  <Text style={styles.fallbackNote}>
                    {price.fallback_suggestion.note}
                  </Text>
                </Card.Content>
              </Card>
            ) : null}
          </View>
        </ScrollView>

        <BottomDock>
          <Button
            mode="contained"
            onPress={handleContinue}
            buttonColor={colors.primary}
            style={styles.continueBtn}
            contentStyle={{ height: 48 }}
          >
            {t('price.continueToSubmission')}
          </Button>
        </BottomDock>
      </View>
    );
  }

  const floorRupees = Math.round((price.floor_amount_paise || 0) / 100);
  const recLowRupees = Math.round((price.recommended_low_paise || 0) / 100);
  const recHighRupees = Math.round((price.recommended_high_paise || 0) / 100);
  const sellingPriceNum = parseFloat(sellingPrice) || 0;
  const isBelowFloor = sellingPriceNum > 0 && sellingPriceNum < floorRupees;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView
        ref={scrollViewRef}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { paddingBottom: 160 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <StepHeader
          currentStep={5}
          totalSteps={5}
          title={t('price.title')}
          subtitle={t('price.subtitle')}
        />

        <View style={styles.content}>
          <Card style={styles.breakdownCard}>
            <Card.Content>
              <Text style={styles.sectionLabel}>{t('price.costBreakdown')}</Text>

              <View style={styles.mathRow}>
                <Text style={styles.mathLabel}>{t('price.rawMaterials')}</Text>
                <Text style={styles.mathValue}>{paiseToRupees(price.inputs.material_cost_paise)}</Text>
              </View>

              <View style={styles.mathRow}>
                <Text style={styles.mathLabel}>
                  {t('price.labourLine', { hours: price.inputs.labour_hours, rate: paiseToRupees(price.inputs.hourly_wage_paise) })}
                </Text>
                <Text style={styles.mathValue}>
                  {paiseToRupees(price.inputs.labour_hours * price.inputs.hourly_wage_paise)}
                </Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.mathRow}>
                <Text style={styles.floorLabel}>{t('price.floorLabel')}</Text>
                <Text style={styles.floorValue}>{paiseToRupees(price.floor_amount_paise)}</Text>
              </View>
              <Text style={styles.floorNotice}>
                {t('price.floorNotice')}
              </Text>
            </Card.Content>
          </Card>

          {/* Pending coordinator verification informational badge */}
          {price.status === 'available' &&
            price.inputs?.skill_level_source === 'self_declared' &&
            price.inputs?.skill_level === 'highly_skilled' && (
              <View style={styles.pendingVerificationCard}>
                <View style={styles.pendingBadgeHeader}>
                  <View style={styles.amberDot} />
                  <Text style={styles.pendingBadgeTitle}>{t('price.pendingVerification')}</Text>
                </View>
                <Text style={styles.pendingBadgeCaption}>
                  {t('price.pendingVerificationText')}
                </Text>
              </View>
            )}

          {/* Technique floor elevation informational badge */}
          {price.status === 'available' &&
            price.inputs?.skill_level_source === 'technique_floor' && (
              <View style={[styles.pendingVerificationCard, styles.techniqueElevationCard]}>
                <View style={styles.pendingBadgeHeader}>
                  <MaterialCommunityIcons name="shield-star-outline" size={16} color={colors.successGreen} style={{ marginRight: 6 }} />
                  <Text style={[styles.pendingBadgeTitle, { color: colors.successGreen }]}>
                    {t('price.techniqueElevation', { defaultValue: 'Technique Floor Applied' })}
                  </Text>
                </View>
                <Text style={[styles.pendingBadgeCaption, { color: colors.successGreen }]}>
                  {t('price.techniqueElevationText', {
                    skill: (price.inputs?.skill_level || 'skilled').replace(/_/g, ' '),
                    defaultValue: `Your wage floor was automatically elevated to ${(price.inputs?.skill_level || 'skilled').replace(/_/g, ' ')} tier based on specialized craft techniques.`
                  })}
                </Text>
              </View>
            )}

          <Card style={styles.statCard}>
            <Card.Content>
              <Text style={styles.statSectionLabel}>{t('price.recommendedBand')}</Text>
              <Text style={styles.statValue}>
                {paiseToRupees(price.recommended_low_paise)} – {paiseToRupees(price.recommended_high_paise)}
              </Text>
              <Text style={styles.explanationText}>{price.explanation}</Text>
            </Card.Content>
          </Card>

          {/* Your Listing / Asking Price Card */}
          <Card style={styles.sellingPriceCard}>
            <Card.Content>
              <Text style={styles.sectionLabel}>{t('price.yourPrice')}</Text>
              <Text style={styles.sellingPriceSubtitle}>
                {t('price.yourPriceText')}
              </Text>

              <View style={styles.priceInputRow}>
                <Text style={styles.currencyPrefix}>₹</Text>
                <TextInput
                  mode="outlined"
                  keyboardType="numeric"
                  value={sellingPrice}
                  onChangeText={(val) => setSellingPrice(val.replace(/[^0-9]/g, ''))}
                  onFocus={handlePriceInputFocus}
                  placeholder={t('price.enterPrice')}
                  placeholderTextColor={colors.placeholder}
                  style={styles.priceInput}
                  outlineColor={isBelowFloor ? colors.error : colors.border}
                  activeOutlineColor={isBelowFloor ? colors.error : colors.primary}
                  textColor={colors.text}
                />
              </View>

              {/* Quick Preset Buttons */}
              <View style={styles.presetChipsRow}>
                <Chip
                  style={[styles.presetChip, sellingPrice === String(floorRupees) && styles.presetChipActive]}
                  textStyle={[styles.presetChipText, sellingPrice === String(floorRupees) && styles.presetChipTextActive]}
                  onPress={() => setSellingPrice(String(floorRupees))}
                  compact
                >
                  {t('price.presetFloor', { amount: `₹${floorRupees.toLocaleString('en-IN')}` })}
                </Chip>
                <Chip
                  style={[styles.presetChip, sellingPrice === String(recLowRupees) && styles.presetChipFairActive]}
                  textStyle={[styles.presetChipText, sellingPrice === String(recLowRupees) && styles.presetChipFairTextActive]}
                  onPress={() => setSellingPrice(String(recLowRupees))}
                  compact
                >
                  {t('price.presetFair', { amount: `₹${recLowRupees.toLocaleString('en-IN')}` })}
                </Chip>
                <Chip
                  style={[styles.presetChip, sellingPrice === String(recHighRupees) && styles.presetChipActive]}
                  textStyle={[styles.presetChipText, sellingPrice === String(recHighRupees) && styles.presetChipTextActive]}
                  onPress={() => setSellingPrice(String(recHighRupees))}
                  compact
                >
                  {t('price.presetPremium', { amount: `₹${recHighRupees.toLocaleString('en-IN')}` })}
                </Chip>
              </View>

              {/* Below-floor safety alert */}
              {isBelowFloor && (
                <View style={styles.warningBox}>
                  <Text style={styles.warningText}>
                    {t('price.belowFloor', { price: `₹${sellingPriceNum.toLocaleString('en-IN')}`, floor: `₹${floorRupees.toLocaleString('en-IN')}` })}
                  </Text>
                </View>
              )}
            </Card.Content>
          </Card>

          {price.wage_source && (
            <View style={styles.sourceBox}>
              <Text style={styles.sourceLabel}>{t('price.wageSource')}</Text>
              <Text style={styles.sourceText}>
                {price.wage_source.state_code}
                {price.wage_source.zone ? ` · ${price.wage_source.zone.replace('_', ' ').toUpperCase()}` : ''}
                {price.inputs?.skill_level ? ` · ${price.inputs.skill_level.replace('_', ' ').toUpperCase()}` : ''}
                {' · '}{t('price.effective', { date: price.wage_source.effective_from })}
              </Text>
              <Text style={styles.sourceRef}>{price.wage_source.notification_ref}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Docked Action Button */}
      <BottomDock>
        <Button
          mode="contained"
          onPress={handleContinue}
          buttonColor={colors.primary}
          textColor="#FFFFFF"
          style={styles.continueBtn}
          contentStyle={{ height: 48 }}
        >
          {t('price.confirmProceed')}
        </Button>
      </BottomDock>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ColorPalette, isDark?: boolean) {
  return StyleSheet.create({
  container: { backgroundColor: colors.background, flexGrow: 1, paddingBottom: spacing.xxl },
  content: { paddingHorizontal: spacing.lg },
  breakdownCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 0,
    marginBottom: spacing.md,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  mathRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  mathLabel: { color: colors.text, fontSize: 14 },
  mathValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  floorLabel: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  floorValue: { color: colors.primary, fontSize: 20, fontWeight: '700' },
  floorNotice: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  statCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.indigoBorder,
    elevation: 0,
    marginBottom: spacing.md,
  },
  statSectionLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    fontWeight: '700',
    color: colors.secondary,
  },
  statValue: { color: colors.secondary, fontSize: 22, fontWeight: '700', marginVertical: spacing.xs },
  explanationText: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
  sourceBox: {
    backgroundColor: colors.badgeNeutral,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  sourceLabel: { color: colors.textMuted, fontWeight: '700', fontSize: 11, letterSpacing: 0.5 },
  sourceText: { color: colors.text, fontSize: 13, marginTop: spacing.xs, fontWeight: '500' },
  sourceRef: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  continueBtn: { minHeight: spacing.tapTarget, justifyContent: 'center', borderRadius: 8 },
  unavailableCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 0,
    marginBottom: spacing.lg,
  },
  cardTitle: { color: colors.text, fontWeight: '700', marginBottom: spacing.xs },
  unavailableText: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  sellingPriceCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 0,
    marginBottom: spacing.md,
  },
  sellingPriceSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  priceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  currencyPrefix: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginRight: spacing.sm,
  },
  priceInput: {
    flex: 1,
    backgroundColor: colors.surface,
    fontSize: 18,
    fontWeight: '600',
  },
  presetChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  presetChip: {
    backgroundColor: colors.badgeNeutral,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
  },
  presetChipActive: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
  },
  presetChipFairActive: {
    backgroundColor: colors.indigoLight,
    borderColor: colors.secondary,
  },
  presetChipText: {
    fontSize: 11,
    color: colors.text,
    fontWeight: '500',
  },
  presetChipTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  presetChipFairTextActive: {
    color: colors.secondary,
    fontWeight: '700',
  },
  warningBox: {
    backgroundColor: colors.badgeNeutral,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
    padding: spacing.sm,
    borderRadius: 4,
    marginTop: spacing.sm,
  },
  warningText: {
    color: colors.error,
    fontSize: 12,
    lineHeight: 16,
  },
  fallbackCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    elevation: 0,
    marginBottom: spacing.lg,
  },
  fallbackBadge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  fallbackTitle: {
    color: colors.text,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  fallbackNote: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  pendingVerificationCard: {
    backgroundColor: colors.warningLight,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  techniqueElevationCard: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successLight,
  },
  pendingBadgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  amberDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warningAmber,
    marginRight: 6,
  },
  pendingBadgeTitle: {
    color: colors.warningText,
    fontWeight: '700',
    fontSize: 13,
  },
  pendingBadgeCaption: {
    color: colors.warningText,
    fontSize: 12,
    lineHeight: 17,
  },
  });
}