// src/features/confirm-details/ConfirmDetailsScreen.tsx
import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Keyboard, type LayoutChangeEvent } from 'react-native';
import { Text, Button, TextInput, Chip } from 'react-native-paper';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useTranslation } from 'react-i18next';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArtisanStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { getDraft, saveDraft } from '../../services/database';
import { colors, spacing } from '../../theme';
import type { CatalogueResult } from '../../types/contracts';
import { ConfidenceDot, ProcessingIndicator, ErrorRetryCard, StepHeader, BottomDock } from '../../components';

export default function ConfirmDetailsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'ConfirmDetails'>>();
  const headerHeight = useHeaderHeight();
  const { draftId, transcriptId } = route.params;

  const scrollViewRef = useRef<ScrollView>(null);
  const listContainerOffsetY = useRef<number>(0);
  const fieldOffsets = useRef<Record<string, number>>({});
  const activeFieldRef = useRef<string | null>(null);
  const [keyboardSpace, setKeyboardSpace] = useState(0);

  const [result, setResult] = useState<CatalogueResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Holds a translation key so the message follows language changes.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editedFields, setEditedFields] = useState<Record<string, any>>({});
  const [confirmedFields, setConfirmedFields] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await service.requestCatalogueGeneration(draftId, {
          transcript_id: transcriptId,
          image_media_ids: [],
          confirmed_facts: {},
          taxonomy_version: '0.1.0',
        });
        setResult(res);
      } catch (err) {
        // Contract: CATALOGUE_SCHEMA_INVALID -> "Keep the draft, show retry."
        setLoadError('confirm.generateError');
      } finally {
        setLoading(false);
      }
    })();
  }, [draftId, transcriptId]);

  if (loading) {
    return <ProcessingIndicator hint={t('confirm.generating')} />;
  }

  if (loadError || !result) {
    return (
      <ErrorRetryCard
        errorText={t(loadError ?? 'confirm.loadError')}
        onRetry={() => {
          setLoading(true);
          setLoadError(null);
          service.requestCatalogueGeneration(draftId, {
            transcript_id: transcriptId,
            image_media_ids: [],
            confirmed_facts: {},
            taxonomy_version: '0.1.0',
          }).then(setResult).catch(() => setLoadError('confirm.generateError')).finally(() => setLoading(false));
        }}
        retryLabel={t('common.retry')}
      />
    );
  }

  const { catalogue, field_confidence, needs_confirmation } = result;

  // Flatten the fields we actually need to show for confirmation.
  // Per contract: low confidence != wrong — always needs explicit user action, never auto-accept.
  // If API couldn't extract or translate, fields show educational placeholders guiding the artisan.
  const fieldsToConfirm = [
    {
      key: 'category',
      label: t('confirm.fields.category'),
      value: catalogue.category || '',
      placeholder: t('confirm.fields.categoryPlaceholder'),
    },
    {
      key: 'materials',
      label: t('confirm.fields.materials'),
      value: Array.isArray(catalogue.materials) ? catalogue.materials.filter(Boolean).join(', ') : (catalogue.materials || ''),
      placeholder: t('confirm.fields.materialsPlaceholder'),
    },
    {
      key: 'techniques',
      label: t('confirm.fields.techniques'),
      value: Array.isArray(catalogue.techniques) ? catalogue.techniques.filter(Boolean).join(', ') : (catalogue.techniques || ''),
      placeholder: t('confirm.fields.techniquesPlaceholder'),
    },
    {
      key: 'labour.hours',
      label: t('confirm.fields.hours'),
      value: catalogue.labour?.hours ? String(catalogue.labour.hours) : '',
      placeholder: t('confirm.fields.hoursPlaceholder'),
    },
    {
      key: 'material_cost_paise',
      label: t('confirm.fields.materialCost'),
      value: catalogue.material_cost_paise ? String(Math.round(catalogue.material_cost_paise / 100)) : '',
      placeholder: t('confirm.fields.materialCostPlaceholder'),
    },
    {
      key: 'title.en',
      label: t('confirm.fields.title'),
      value: catalogue.title?.en || '',
      placeholder: t('confirm.fields.titlePlaceholder'),
    },
    {
      key: 'description.en',
      label: t('confirm.fields.description'),
      value: catalogue.description?.en || '',
      placeholder: t('confirm.fields.descriptionPlaceholder'),
    },
  ];

  const handleFieldChange = (key: string, value: string) => {
    setEditedFields((prev) => ({ ...prev, [key]: value }));
    if (value.trim().length > 0) {
      setConfirmedFields((prev) => new Set(prev).add(key));
    }
  };

  const handleConfirmField = (key: string) => {
    setConfirmedFields((prev) => new Set(prev).add(key));
  };

  const getFieldConfidence = (key: string): number | undefined => {
    if (field_confidence[key] !== undefined) return field_confidence[key];
    if (key === 'title.en') return field_confidence['title'] ?? field_confidence['title.en'];
    if (key === 'description.en') return field_confidence['description'] ?? field_confidence['description.en'];
    if (key === 'labour.hours') return field_confidence['labour.hours'] ?? field_confidence['labour_hours'];
    return undefined;
  };

  const isFieldInNeedsConfirmation = (key: string): boolean => {
    if (needs_confirmation.includes(key)) return true;
    if (key === 'title.en' && (needs_confirmation.includes('title') || needs_confirmation.includes('title.en'))) return true;
    if (key === 'description.en' && (needs_confirmation.includes('description') || needs_confirmation.includes('description.en'))) return true;
    if (key === 'labour.hours' && (needs_confirmation.includes('labour_hours') || needs_confirmation.includes('labour.hours'))) return true;
    return false;
  };

  const isFieldConfirmed = (key: string): boolean => {
    if (confirmedFields.has(key)) return true;
    if (key === 'title.en' && (confirmedFields.has('title') || confirmedFields.has('title.en'))) return true;
    if (key === 'description.en' && (confirmedFields.has('description') || confirmedFields.has('description.en'))) return true;
    if (key === 'labour.hours' && (confirmedFields.has('labour_hours') || confirmedFields.has('labour.hours'))) return true;
    return false;
  };

  const allNeedsConfirmationHandled = fieldsToConfirm
    .filter((field) => isFieldInNeedsConfirmation(field.key))
    .every((field) => isFieldConfirmed(field.key));

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    const corrections = Object.entries(editedFields).map(([field, new_value]) => ({
      field,
      old_value: (catalogue as any)[field],
      new_value,
      source: 'artisan',
    }));

    const finalCatalogue = {
      ...catalogue,
      category: editedFields['category'] !== undefined ? editedFields['category'] : (catalogue.category || ''),
      materials: editedFields['materials'] !== undefined
        ? editedFields['materials'].split(',').map((s: string) => s.trim()).filter(Boolean)
        : (catalogue.materials || []),
      techniques: editedFields['techniques'] !== undefined
        ? editedFields['techniques'].split(',').map((s: string) => s.trim()).filter(Boolean)
        : (catalogue.techniques || []),
      labour: {
        ...catalogue.labour,
        hours: editedFields['labour.hours'] !== undefined
          ? (parseFloat(editedFields['labour.hours']) || 0)
          : (catalogue.labour?.hours || 0),
      },
      material_cost_paise: editedFields['material_cost_paise'] !== undefined
        ? Math.round((parseFloat(editedFields['material_cost_paise']) || 0) * 100)
        : (catalogue.material_cost_paise || 45000),
      title: {
        ...catalogue.title,
        en: editedFields['title.en'] !== undefined ? editedFields['title.en'] : (catalogue.title?.en || ''),
      },
      description: {
        ...catalogue.description,
        en: editedFields['description.en'] !== undefined ? editedFields['description.en'] : (catalogue.description?.en || ''),
      },
    };

    try {
      await service.confirmListing(draftId, {
        catalogue: finalCatalogue,
        confirmed_fields: fieldsToConfirm.map((f) => f.key),
        corrections,
      });

      try {
        const existing = await getDraft(draftId);
        await saveDraft({
          id: draftId,
          listing_id: existing?.listing_id ?? draftId,
          state: existing?.state ?? 'draft',
          preferred_language: existing?.preferred_language ?? 'en',
          payload: {
            ...(existing?.payload ?? {}),
            catalogue: finalCatalogue,
            catalogueConfirmed: true,
          },
        });
      } catch (dbErr) {
        console.error('Failed to update draft payload in ConfirmDetails', dbErr);
      }

      navigation.navigate('Price', { draftId });
    } catch (err) {
      // Contract: CATALOGUE_SCHEMA_INVALID -> keep the draft, show retry. Never lose edits on failure.
      setSubmitError(t('confirm.saveError'));
    } finally {
      setSubmitting(false);
    }
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
          title={t('confirm.title')}
          subtitle={t('confirm.subtitle')}
        />

        <View
          style={styles.listContainer}
          onLayout={(e) => {
            listContainerOffsetY.current = e.nativeEvent.layout.y;
          }}
        >
          {fieldsToConfirm.map((field) => {
            const confidence = getFieldConfidence(field.key);
            const needsConfirmation = isFieldInNeedsConfirmation(field.key);
            const isConfirmed = isFieldConfirmed(field.key);

            return (
              <View
                key={field.key}
                style={styles.fieldCard}
                onLayout={(e) => handleFieldLayout(field.key, e)}
              >
                <View style={styles.fieldHeader}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  {confidence !== undefined && (
                    <ConfidenceDot confidence={confidence} />
                  )}
                </View>

                <TextInput
                  mode="outlined"
                  value={editedFields[field.key] !== undefined ? editedFields[field.key] : field.value}
                  onChangeText={(text) => handleFieldChange(field.key, text)}
                  onFocus={() => handleFieldFocus(field.key)}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.textMuted}
                  keyboardType={field.key === 'material_cost_paise' || field.key === 'labour.hours' ? 'numeric' : 'default'}
                  style={styles.input}
                  outlineColor={colors.border}
                  activeOutlineColor={colors.primary}
                  multiline={field.key === 'description.en'}
                  numberOfLines={field.key === 'description.en' ? 3 : 1}
                />

                {needsConfirmation && (
                  <Button
                    mode={isConfirmed ? 'contained' : 'outlined'}
                    onPress={() => handleConfirmField(field.key)}
                    buttonColor={isConfirmed ? colors.secondary : undefined}
                    textColor={isConfirmed ? '#FFFFFF' : colors.text}
                    style={styles.confirmBtn}
                    labelStyle={{ fontSize: 12 }}
                    compact
                  >
                    {isConfirmed ? t('confirm.confirmed') : t('confirm.tapToConfirm')}
                  </Button>
                )}
              </View>
            );
          })}
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
          {allNeedsConfirmationHandled ? t('confirm.continue') : t('confirm.confirmHighlighted')}
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
  submitBtn: {
    marginTop: spacing.md,
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
    borderRadius: 8,
  },
  errorText: { color: colors.error, marginTop: spacing.sm, textAlign: 'center' },
});