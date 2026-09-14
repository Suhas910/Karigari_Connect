// src/features/price/PriceScreen.tsx
import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { Text, Button, Card, TextInput, Chip } from 'react-native-paper';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArtisanStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { apiErrorOf } from '../../services/api';
import { getDraft, saveDraft } from '../../services/database';
import { colors, spacing } from '../../theme';
import type { CatalogueDraft, PriceResult } from '../../types/contracts';
import { ProcessingIndicator, ErrorRetryCard, StepHeader, BottomDock } from '../../components';

const paiseToRupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

type Outcome = 'priced' | 'wage_unavailable' | 'details_missing';

export default function PriceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'Price'>>();
  const headerHeight = useHeaderHeight();
  const { draftId } = route.params;

  const scrollViewRef = useRef<ScrollView>(null);
  const [price, setPrice] = useState<PriceResult | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueDraft | null>(null);
  const [sellingPrice, setSellingPrice] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [priceError, setPriceError] = useState<string | null>(null);

  const fetchPrice = async () => {
    setLoading(true);
    setPriceError(null);
    setOutcome(null);
    try {
      const existing = await getDraft(draftId);
      // The catalogue the artisan confirmed. Never a default: a made-up hour count or
      // material cost produces a floor that looks official and is not.
      let cat: CatalogueDraft | null = existing?.payload?.catalogue ?? null;
      if (!cat) {
        const listing = await service.getListing(draftId).catch(() => null);
        cat = listing?.catalogue?.catalogue ?? null;
      }
      setCatalogue(cat);

      const hours = cat?.labour?.hours;
      const cost = cat?.material_cost_paise;
      const skill = cat?.labour?.skill_level;
      const stateCode = cat?.labour?.state_code;
      if (hours == null || cost == null || !skill || !stateCode) {
        setOutcome('details_missing');
        return;
      }

      const result = await service.requestPrice(draftId, {
        material_cost_paise: cost,
        labour_hours: hours,
        skill_level: skill,
        state_code: stateCode,
      });
      setPrice(result);
      setOutcome(result.status === 'available' ? 'priced' : 'wage_unavailable');

      if (existing?.payload?.finalPricePaise) {
        setSellingPrice(String(Math.round(existing.payload.finalPricePaise / 100)));
      } else if (result.status === 'available') {
        setSellingPrice(String(Math.round(result.recommended_low_paise / 100)));
      }

      if (result.status === 'available') {
        try {
          await saveDraft({
            id: draftId,
            listing_id: existing?.listing_id ?? draftId,
            state: existing?.state ?? 'draft',
            preferred_language: existing?.preferred_language ?? 'kn',
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
      const code = apiErrorOf(err)?.code;
      if (code === 'WAGE_RATE_UNAVAILABLE') {
        setOutcome('wage_unavailable');
      } else if (code === 'CATALOGUE_SCHEMA_INVALID') {
        setOutcome('details_missing');
      } else {
        setPriceError('Could not load price calculation. Check connection and try again.');
      }
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
        preferred_language: existing?.preferred_language ?? 'kn',
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
    return <ProcessingIndicator hint="Calculating fair wage protection…" />;
  }

  if (outcome === 'details_missing') {
    return (
      <ErrorRetryCard
        errorText="Some details are missing. The hours, material cost, skill level and state are needed to calculate a fair price."
        onRetry={() =>
          navigation.navigate('ConfirmDetails', {
            draftId,
            transcriptId: catalogue?.source?.transcript_id ?? '',
          })
        }
        retryLabel="Back to details"
      />
    );
  }

  // Hard rule: never invent a number. If unavailable, say so plainly — calm, not alarming.
  if (outcome === 'wage_unavailable') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView contentContainerStyle={styles.container}>
          <StepHeader
            currentStep={5}
            totalSteps={5}
            title="Price Protection"
            subtitle="Statutory fair wage lookup"
          />

          <View style={styles.content}>
            <Card style={styles.unavailableCard}>
              <Card.Content>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Wage rate under verification
                </Text>
                <Text style={styles.unavailableText}>
                  No official skilled-wage notification is on file for your craft cluster yet.
                  Your coordinator will establish a verified price floor before publishing.
                </Text>
              </Card.Content>
            </Card>
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
            Continue to Submission
          </Button>
        </BottomDock>
      </View>
    );
  }

  if (priceError || !price) {
    return (
      <ErrorRetryCard
        errorText={priceError ?? 'Something went wrong loading your price.'}
        onRetry={fetchPrice}
        retryLabel="Retry"
      />
    );
  }

  // Demo and offline wage tables mark their rates with this scheme instead of a real source URL.
  const isDemoRate = !!price.wage_source?.source_url?.startsWith('unsourced://');
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
          title="Fair Price Calculation"
          subtitle="Transparent cost breakdown and protected floor"
        />

        <View style={styles.content}>
          {isDemoRate && (
            <View style={styles.demoBanner}>
              <Text style={styles.demoBannerText}>
                DEMO RATE: this wage is not from an official notification. Do not use it for a real sale.
              </Text>
            </View>
          )}

          <Card style={styles.breakdownCard}>
            <Card.Content>
              <Text style={styles.sectionLabel}>COST BREAKDOWN</Text>

              <View style={styles.mathRow}>
                <Text style={styles.mathLabel}>Raw Materials</Text>
                <Text style={styles.mathValue}>{paiseToRupees(price.inputs.material_cost_paise)}</Text>
              </View>

              <View style={styles.mathRow}>
                <Text style={styles.mathLabel}>
                  Labour ({price.inputs.labour_hours} hrs @ {paiseToRupees(price.inputs.hourly_wage_paise)}/hr)
                </Text>
                <Text style={styles.mathValue}>
                  {paiseToRupees(price.inputs.labour_hours * price.inputs.hourly_wage_paise)}
                </Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.mathRow}>
                <Text style={styles.floorLabel}>Protected Minimum Floor</Text>
                <Text style={styles.floorValue}>{paiseToRupees(price.floor_amount_paise)}</Text>
              </View>
              <Text style={styles.floorNotice}>
                {isDemoRate
                  ? 'Calculated with a demo wage rate, so this floor is for illustration only.'
                  : 'Never sell below this amount. It covers your material expenses and official minimum skilled wage.'}
              </Text>
            </Card.Content>
          </Card>

          <Card style={styles.statCard}>
            <Card.Content>
              <Text style={styles.statSectionLabel}>RECOMMENDED MARKETPLACE BAND</Text>
              <Text style={styles.statValue}>
                {paiseToRupees(price.recommended_low_paise)} – {paiseToRupees(price.recommended_high_paise)}
              </Text>
              <Text style={styles.explanationText}>{price.explanation}</Text>
            </Card.Content>
          </Card>

          {/* Your Listing / Asking Price Card */}
          <Card style={styles.sellingPriceCard}>
            <Card.Content>
              <Text style={styles.sectionLabel}>YOUR LISTING PRICE</Text>
              <Text style={styles.sellingPriceSubtitle}>
                You set your final product asking price. Tap a suggestion or enter your own:
              </Text>

              <View style={styles.priceInputRow}>
                <Text style={styles.currencyPrefix}>₹</Text>
                <TextInput
                  mode="outlined"
                  keyboardType="numeric"
                  value={sellingPrice}
                  onChangeText={(val) => setSellingPrice(val.replace(/[^0-9]/g, ''))}
                  onFocus={handlePriceInputFocus}
                  placeholder="Enter asking price"
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
                  Floor: ₹{floorRupees.toLocaleString('en-IN')}
                </Chip>
                <Chip
                  style={[styles.presetChip, sellingPrice === String(recLowRupees) && styles.presetChipFairActive]}
                  textStyle={[styles.presetChipText, sellingPrice === String(recLowRupees) && styles.presetChipFairTextActive]}
                  onPress={() => setSellingPrice(String(recLowRupees))}
                  compact
                >
                  Fair: ₹{recLowRupees.toLocaleString('en-IN')}
                </Chip>
                <Chip
                  style={[styles.presetChip, sellingPrice === String(recHighRupees) && styles.presetChipActive]}
                  textStyle={[styles.presetChipText, sellingPrice === String(recHighRupees) && styles.presetChipTextActive]}
                  onPress={() => setSellingPrice(String(recHighRupees))}
                  compact
                >
                  Premium: ₹{recHighRupees.toLocaleString('en-IN')}
                </Chip>
              </View>

              {/* Below-floor safety alert */}
              {isBelowFloor && (
                <View style={styles.warningBox}>
                  <Text style={styles.warningText}>
                    Protected wage notice: ₹{sellingPriceNum.toLocaleString('en-IN')} is below your protected floor of ₹{floorRupees.toLocaleString('en-IN')}. Selling below this does not cover your full recorded materials and statutory skilled wages.
                  </Text>
                </View>
              )}
            </Card.Content>
          </Card>

          {price.wage_source && (
            <View style={styles.sourceBox}>
              <Text style={styles.sourceLabel}>STATUTORY WAGE SOURCE</Text>
              <Text style={styles.sourceText}>
                {price.wage_source.state_code} · Effective {price.wage_source.effective_from}
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
          style={styles.continueBtn}
          contentStyle={{ height: 48 }}
        >
          Confirm & Proceed to Submit
        </Button>
      </BottomDock>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flexGrow: 1, paddingBottom: spacing.xxl },
  content: { paddingHorizontal: spacing.lg },
  demoBanner: {
    backgroundColor: colors.badgeNeutral,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
    padding: spacing.sm,
    borderRadius: 4,
    marginBottom: spacing.md,
  },
  demoBannerText: { color: colors.error, fontSize: 12, fontWeight: '700', lineHeight: 16 },
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
});
