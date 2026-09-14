// src/features/confirm-details/ConfirmDetailsScreen.tsx
import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Keyboard, type LayoutChangeEvent } from 'react-native';
import { Text, Button, TextInput, Chip } from 'react-native-paper';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArtisanStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { apiErrorOf } from '../../services/api';
import { getDraft, saveDraft } from '../../services/database';
import { colors, spacing } from '../../theme';
import type { CatalogueDraft, CatalogueResult } from '../../types/contracts';
import { ConfidenceDot, ProcessingIndicator, ErrorRetryCard, StepHeader, BottomDock } from '../../components';

const SKILL_LEVELS = [
  { id: 'unskilled', label: 'Unskilled' },
  { id: 'semi_skilled', label: 'Semi-skilled' },
  { id: 'skilled', label: 'Skilled' },
  { id: 'highly_skilled', label: 'Highly skilled' },
];

// Catalogue values are taxonomy ids (handloom_weave); the artisan reads and types words.
const toWords = (id: string) => id.replace(/_/g, ' ');
const toId = (words: string) => words.trim().toLowerCase().replace(/[\s-]+/g, '_');
const toIds = (words: string) => words.split(',').map(toId).filter(Boolean);

type TextField = {
  key: string;
  label: string;
  placeholder: string;
  numeric?: boolean;
  multiline?: boolean;
  maxLength?: number;
};

const TEXT_FIELDS: TextField[] = [
  { key: 'category', label: 'Category', placeholder: 'e.g., handloom saree, terracotta vessel' },
  { key: 'materials', label: 'Materials', placeholder: 'e.g., silk, cotton' },
  { key: 'techniques', label: 'Techniques', placeholder: 'e.g., handloom weave, extra weft' },
  { key: 'labour.hours', label: 'Hours to make', placeholder: 'e.g., 12', numeric: true },
  { key: 'material_cost_paise', label: 'Material cost (₹)', placeholder: 'e.g., 800', numeric: true },
  { key: 'labour.state_code', label: 'State (2-letter code)', placeholder: 'e.g., KA', maxLength: 2 },
  { key: 'title.en', label: 'Title (English)', placeholder: 'e.g., Handwoven silk saree with extra-weft border' },
  { key: 'description.en', label: 'Description', placeholder: 'What the piece is and how it was made', multiline: true },
];
const SKILL_KEY = 'labour.skill_level';
const KNOWN_KEYS = new Set([...TEXT_FIELDS.map((f) => f.key), SKILL_KEY]);

const initialValues = (cat: CatalogueDraft): Record<string, string> => ({
  category: toWords(cat.category || ''),
  materials: (cat.materials || []).map(toWords).join(', '),
  techniques: (cat.techniques || []).map(toWords).join(', '),
  'labour.hours': cat.labour?.hours != null ? String(cat.labour.hours) : '',
  material_cost_paise: cat.material_cost_paise != null ? String(cat.material_cost_paise / 100) : '',
  'labour.state_code': cat.labour?.state_code ?? '',
  [SKILL_KEY]: cat.labour?.skill_level ?? '',
  'title.en': cat.title?.en ?? '',
  'description.en': cat.description?.en ?? '',
});

type LoadError = { text: string; needsVoice?: boolean };
type ClaimDecision = 'yes' | 'no';

export default function ConfirmDetailsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'ConfirmDetails'>>();
  const headerHeight = useHeaderHeight();
  const { draftId, transcriptId } = route.params;

  const scrollViewRef = useRef<ScrollView>(null);
  const listContainerOffsetY = useRef<number>(0);
  const fieldOffsets = useRef<Record<string, number>>({});
  const activeFieldRef = useRef<string | null>(null);
  const initialRef = useRef<Record<string, string>>({});
  const [keyboardSpace, setKeyboardSpace] = useState(0);

  const [result, setResult] = useState<CatalogueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmedFields, setConfirmedFields] = useState<Set<string>>(new Set());
  const [claimDecisions, setClaimDecisions] = useState<Record<string, ClaimDecision>>({});

  const scrollToField = (key: string | null) => {
    if (!key) return;
    const cardY = fieldOffsets.current[key];
    if (typeof cardY === 'number') {
      const absoluteY = (listContainerOffsetY.current || 0) + cardY;
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, absoluteY - 16),
        animated: true,
      });
    }
  };

  // Listen for keyboard height changes across Android and iOS
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        const h = e.endCoordinates?.height || 300;
        setKeyboardSpace(h);
        if (activeFieldRef.current) {
          const key = activeFieldRef.current;
          setTimeout(() => scrollToField(key), 50);
          setTimeout(() => scrollToField(key), 180);
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

  const handleFieldLayout = (key: string, e: LayoutChangeEvent) => {
    fieldOffsets.current[key] = e.nativeEvent.layout.y;
  };

  const handleFieldFocus = (key: string) => {
    activeFieldRef.current = key;
    scrollToField(key);
    setTimeout(() => scrollToField(key), 100);
    setTimeout(() => scrollToField(key), 250);
    setTimeout(() => scrollToField(key), 450);
  };

  const loadCatalogue = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Opening this screen again reuses the stored catalogue for the same transcript.
      // Generating again would discard confirmed edits and spend a model request.
      const listing = await service.getListing(draftId).catch(() => null);
      const stored = listing?.catalogue;
      const res: CatalogueResult =
        stored?.catalogue && (!transcriptId || stored.catalogue.source?.transcript_id === transcriptId)
          ? stored
          : await service.requestCatalogueGeneration(draftId, {
              transcript_id: transcriptId,
              image_media_ids: [],
              confirmed_facts: {},
              taxonomy_version: '0.1.0',
            });
      const normalised: CatalogueResult = {
        ...res,
        field_confidence: res.field_confidence ?? {},
        needs_confirmation: res.needs_confirmation ?? [],
      };
      const start = initialValues(normalised.catalogue);
      initialRef.current = start;
      setValues(start);
      setConfirmedFields(new Set());
      setClaimDecisions({});
      setResult(normalised);
    } catch (err) {
      // Contract: CATALOGUE_SCHEMA_INVALID -> "Keep the draft, show retry."
      const code = apiErrorOf(err)?.code;
      if (code === 'LISTING_STATE_INVALID') {
        setLoadError({ text: 'We need your spoken description before the details can be filled in.', needsVoice: true });
      } else if (code === 'PROVIDER_UNAVAILABLE') {
        setLoadError({ text: 'The service is busy. Your draft is safe. Try again in a minute.' });
      } else {
        setLoadError({ text: 'Could not generate catalogue details. Your draft is safe. Try again.' });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCatalogue();
  }, [draftId, transcriptId]);

  if (loading) {
    return <ProcessingIndicator hint="Generating your product details…" />;
  }

  if (loadError || !result) {
    const needsVoice = !!loadError?.needsVoice;
    return (
      <ErrorRetryCard
        errorText={loadError?.text ?? 'Something went wrong loading your draft.'}
        onRetry={needsVoice ? () => navigation.navigate('Speak', { draftId }) : loadCatalogue}
        retryLabel={needsVoice ? 'Record description' : 'Retry'}
      />
    );
  }

  const { catalogue, field_confidence, needs_confirmation } = result;
  const isDemo = result.adapter?.provider === 'fixture' || catalogue.source?.catalogue_provider === 'fixture';
  const claims = catalogue.provenance?.claims ?? [];
  const claimNames = Array.from(
    new Set([
      ...claims.map((c) => c.claim),
      ...needs_confirmation.filter((k) => k.startsWith('provenance.')).map((k) => k.slice('provenance.'.length)),
    ])
  );
  // Anything the backend asks about that this screen has no field for still gets a card,
  // so an unfamiliar key can never leave the Continue button disabled.
  const otherKeys = needs_confirmation.filter((k) => !KNOWN_KEYS.has(k) && !k.startsWith('provenance.'));
  const allNeedsConfirmationHandled = needs_confirmation.every((key) => confirmedFields.has(key));

  const confirm = (key: string) => setConfirmedFields((prev) => new Set(prev).add(key));

  const handleFieldChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (value.trim().length > 0) {
      confirm(key);
    }
  };

  const handleClaimDecision = (name: string, decision: ClaimDecision) => {
    setClaimDecisions((prev) => ({ ...prev, [name]: decision }));
    confirm(`provenance.${name}`);
  };

  const handleSubmit = async () => {
    const hours = parseFloat(values['labour.hours']);
    const rupees = parseFloat(values.material_cost_paise);
    const stateCode = (values['labour.state_code'] || '').trim().toUpperCase();
    const skill = values[SKILL_KEY];
    // Pricing refuses without these, and the app must not fill them in for the artisan.
    if (!(hours > 0) || !(rupees >= 0) || !skill || !/^[A-Z]{2}$/.test(stateCode)) {
      setSubmitError('Add the hours, material cost, skill level and 2-letter state code before pricing.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const corrections = Object.keys(values)
      .filter((field) => values[field] !== initialRef.current[field])
      .map((field) => ({ field, old_value: initialRef.current[field], new_value: values[field], source: 'artisan' }));

    // "Yes" is the artisan's own assertion; a coordinator still has to verify it.
    // "No" removes the claim.
    const finalClaims = claims
      .filter((c) => claimDecisions[c.claim] !== 'no')
      .map((c) => (claimDecisions[c.claim] === 'yes' ? { ...c, asserted_by_artisan: true } : c));

    const finalCatalogue: CatalogueDraft = {
      ...catalogue,
      category: toId(values.category || ''),
      materials: toIds(values.materials || ''),
      techniques: toIds(values.techniques || ''),
      labour: { hours, skill_level: skill, state_code: stateCode },
      material_cost_paise: Math.round(rupees * 100),
      title: { ...catalogue.title, en: values['title.en'] || '' },
      description: { ...catalogue.description, en: values['description.en'] || '' },
      provenance: { ...catalogue.provenance, claims: finalClaims },
    };

    try {
      await service.confirmListing(draftId, {
        catalogue: finalCatalogue,
        confirmed_fields: Array.from(confirmedFields),
        corrections,
      });

      try {
        const existing = await getDraft(draftId);
        await saveDraft({
          id: draftId,
          listing_id: existing?.listing_id ?? draftId,
          state: existing?.state ?? 'draft',
          preferred_language: existing?.preferred_language ?? 'kn',
          payload: {
            ...(existing?.payload ?? {}),
            catalogueConfirmed: true,
            catalogue: finalCatalogue,
          },
        });
      } catch (dbErr) {
        console.error('Failed to update draft payload in ConfirmDetails', dbErr);
      }

      navigation.navigate('Price', { draftId });
    } catch (err) {
      // Contract: CATALOGUE_SCHEMA_INVALID -> keep the draft, show retry. Never lose edits on failure.
      setSubmitError('Could not save your confirmation. Your edits are kept. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderConfirmButton = (key: string) => {
    if (!needs_confirmation.includes(key)) return null;
    const isConfirmed = confirmedFields.has(key);
    return (
      <Button
        mode={isConfirmed ? 'contained' : 'outlined'}
        onPress={() => confirm(key)}
        buttonColor={isConfirmed ? colors.secondary : undefined}
        textColor={isConfirmed ? '#FFFFFF' : colors.text}
        style={styles.confirmBtn}
        labelStyle={{ fontSize: 12 }}
        compact
      >
        {isConfirmed ? 'Confirmed' : 'Tap to confirm this field'}
      </Button>
    );
  };

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
          { paddingBottom: keyboardSpace > 0 ? keyboardSpace + 140 : 160 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <StepHeader
          currentStep={4}
          totalSteps={5}
          title="Confirm Details"
          subtitle="Check every detail. Tap a value to change it."
        />

        {isDemo && (
          <View style={styles.demoBanner}>
            <Text style={styles.demoBannerText}>
              Demo details: these were not made from your description. Replace every field with your own.
            </Text>
          </View>
        )}

        <View
          style={styles.listContainer}
          onLayout={(e) => {
            listContainerOffsetY.current = e.nativeEvent.layout.y;
          }}
        >
          {TEXT_FIELDS.map((field) => {
            const confidence = field_confidence[field.key];
            return (
              <View
                key={field.key}
                style={styles.fieldCard}
                onLayout={(e) => handleFieldLayout(field.key, e)}
              >
                <View style={styles.fieldHeader}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  {confidence !== undefined && <ConfidenceDot confidence={confidence} />}
                </View>

                <TextInput
                  mode="outlined"
                  value={values[field.key] ?? ''}
                  onChangeText={(text) => handleFieldChange(field.key, text)}
                  onFocus={() => handleFieldFocus(field.key)}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  outlineColor={colors.border}
                  activeOutlineColor={colors.primary}
                  keyboardType={field.numeric ? 'decimal-pad' : 'default'}
                  autoCapitalize={field.maxLength === 2 ? 'characters' : 'sentences'}
                  maxLength={field.maxLength}
                  multiline={field.multiline}
                  numberOfLines={field.multiline ? 3 : 1}
                />

                {renderConfirmButton(field.key)}
              </View>
            );
          })}

          <View style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Skill level</Text>
            <View style={styles.chipRow}>
              {SKILL_LEVELS.map((level) => {
                const selected = values[SKILL_KEY] === level.id;
                return (
                  <Chip
                    key={level.id}
                    selected={selected}
                    onPress={() => handleFieldChange(SKILL_KEY, level.id)}
                    style={[styles.chip, selected && styles.chipSelected]}
                    textStyle={selected ? styles.chipTextSelected : styles.chipText}
                    compact
                  >
                    {level.label}
                  </Chip>
                );
              })}
            </View>
            {renderConfirmButton(SKILL_KEY)}
          </View>

          {claimNames.length > 0 && (
            <View style={styles.fieldCard}>
              <Text style={styles.fieldLabel}>Claims about your craft</Text>
              <Text style={styles.claimIntro}>
                Is each of these true? A coordinator checks every claim before buyers see it.
              </Text>
              {claimNames.map((name) => {
                const decision = claimDecisions[name];
                return (
                  <View key={name} style={styles.claimRow}>
                    <Text style={styles.claimName}>{toWords(name)}</Text>
                    <View style={styles.claimButtons}>
                      <Button
                        mode={decision === 'yes' ? 'contained' : 'outlined'}
                        onPress={() => handleClaimDecision(name, 'yes')}
                        buttonColor={decision === 'yes' ? colors.secondary : undefined}
                        textColor={decision === 'yes' ? '#FFFFFF' : colors.text}
                        style={styles.claimBtn}
                        labelStyle={{ fontSize: 12 }}
                        compact
                      >
                        Yes, this is true
                      </Button>
                      <Button
                        mode={decision === 'no' ? 'contained' : 'outlined'}
                        onPress={() => handleClaimDecision(name, 'no')}
                        buttonColor={decision === 'no' ? colors.primary : undefined}
                        textColor={decision === 'no' ? '#FFFFFF' : colors.text}
                        style={styles.claimBtn}
                        labelStyle={{ fontSize: 12 }}
                        compact
                      >
                        No, remove it
                      </Button>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {otherKeys.map((key) => (
            <View key={key} style={styles.fieldCard}>
              <Text style={styles.fieldLabel}>{toWords(key.replace(/\./g, ' '))}</Text>
              {renderConfirmButton(key)}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Docked Action Button */}
      <BottomDock>
        {submitError && <Text style={styles.errorText}>{submitError}</Text>}
        <Button
          mode="contained"
          onPress={handleSubmit}
          disabled={!allNeedsConfirmationHandled || submitting}
          loading={submitting}
          buttonColor={colors.primary}
          style={styles.submitBtn}
          contentStyle={{ height: 48 }}
        >
          {allNeedsConfirmationHandled
            ? 'Continue to Pricing'
            : (() => {
                // Say how many are left: the unconfirmed ones can be scrolled out of view.
                const left = needs_confirmation.filter((key) => !confirmedFields.has(key)).length;
                return `Confirm ${left} more detail${left === 1 ? '' : 's'} to continue`;
              })()}
        </Button>
      </BottomDock>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: { flex: 1, backgroundColor: colors.background },
  container: { backgroundColor: colors.background, flexGrow: 1, paddingBottom: spacing.xxl + 48 },
  listContainer: { paddingHorizontal: spacing.lg },
  fieldCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.surface,
    fontSize: 15,
  },
  confirmBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderColor: colors.border,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  chip: {
    backgroundColor: colors.badgeNeutral,
    borderColor: colors.border,
    borderWidth: 1,
  },
  chipSelected: {
    backgroundColor: colors.indigoLight,
    borderColor: colors.secondary,
  },
  chipText: { fontSize: 12, color: colors.text },
  chipTextSelected: { fontSize: 12, color: colors.secondary, fontWeight: '700' },
  claimIntro: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  claimRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
  },
  claimName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  claimButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  claimBtn: {
    borderRadius: 6,
    borderColor: colors.border,
  },
  demoBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.badgeNeutral,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
    padding: spacing.sm,
    borderRadius: 4,
  },
  demoBannerText: { color: colors.error, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  submitBtn: {
    marginTop: spacing.md,
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
    borderRadius: 8,
  },
  errorText: { color: colors.error, marginTop: spacing.sm, textAlign: 'center' },
});
