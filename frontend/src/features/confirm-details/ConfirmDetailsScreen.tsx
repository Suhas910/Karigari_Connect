// src/features/confirm-details/ConfirmDetailsScreen.tsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Keyboard, TouchableOpacity, type LayoutChangeEvent } from 'react-native';
import { Text, Button, TextInput, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useTranslation } from 'react-i18next';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArtisanStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { getDraft, saveDraft } from '../../services/database';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import type { CatalogueResult, MarketplaceInfo, DimensionSet } from '../../types/contracts';
import { ConfidenceDot, ProcessingIndicator, ErrorRetryCard, StepHeader, BottomDock } from '../../components';

type TabKey = 'product' | 'marketplace' | 'dimensions';
const UNIT_OPTIONS: MarketplaceInfo['unit'][] = ['piece', 'pair', 'set', 'meter', 'kg', 'dozen'];

const EMPTY_DIMS: DimensionSet = { length_cm: 0, width_cm: 0, height_cm: 0, weight_g: 0 };

export default function ConfirmDetailsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'ConfirmDetails'>>();
  const headerHeight = useHeaderHeight();
  const { draftId, transcriptId, declared_language } = route.params;

  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const scrollViewRef = useRef<ScrollView>(null);
  const listContainerOffsetY = useRef<number>(0);
  const fieldOffsets = useRef<Record<string, number>>({});
  const activeFieldRef = useRef<string | null>(null);
  const [keyboardSpace, setKeyboardSpace] = useState(0);

  const [result, setResult] = useState<CatalogueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editedFields, setEditedFields] = useState<Record<string, any>>({});
  const [confirmedFields, setConfirmedFields] = useState<Set<string>>(new Set());

  // --- tabs + marketplace/dimensions local state ---
  const [activeTab, setActiveTab] = useState<TabKey>('product');
  const [marketplace, setMarketplace] = useState<MarketplaceInfo>({
    quantity_available: 0,
    unit: 'piece',
    min_order_qty: 1,
    max_order_qty: null,
    cod_available: false,
    returnable: false,
    cancellable: false,
  });
  const [productDims, setProductDims] = useState<DimensionSet>(EMPTY_DIMS);
  const [hasBox, setHasBox] = useState(false);
  const [boxDims, setBoxDims] = useState<DimensionSet>(EMPTY_DIMS);
  const [editingQtyField, setEditingQtyField] = useState<'quantity_available' | 'min_order_qty' | 'max_order_qty' | null>(null);
  const [qtyInputText, setQtyInputText] = useState<string>('');

  // hydrate marketplace/dimensions from an existing draft, once catalogue loads
  const hydratedRef = useRef(false);

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
        const draft = await getDraft(draftId);
        const resolvedLang = declared_language || draft?.preferred_language || 'en';
        const res = await service.requestCatalogueGeneration(draftId, {
          transcript_id: transcriptId,
          image_media_ids: [],
          confirmed_facts: {},
          taxonomy_version: '0.1.0',
          declared_language: resolvedLang,
        });
        setResult(res);
      } catch (err) {
        // Contract: CATALOGUE_SCHEMA_INVALID -> "Keep the draft, show retry."
        setLoadError('confirm.generateError');
      } finally {
        setLoading(false);
      }
    })();
  }, [draftId, transcriptId, declared_language]);

  if (loading) {
    return <ProcessingIndicator hint={t('confirm.generating')} />;
  }

  if (loadError || !result) {
    return (
      <ErrorRetryCard
        errorText={t(loadError ?? 'confirm.loadError')}
        onRetry={async () => {
          setLoading(true);
          setLoadError(null);
          try {
            const draft = await getDraft(draftId);
            const resolvedLang = declared_language || draft?.preferred_language || 'en';
            const res = await service.requestCatalogueGeneration(draftId, {
              transcript_id: transcriptId,
              image_media_ids: [],
              confirmed_facts: {},
              taxonomy_version: '0.1.0',
              declared_language: resolvedLang,
            });
            setResult(res);
          } catch {
            setLoadError('confirm.generateError');
          } finally {
            setLoading(false);
          }
        }}
        retryLabel={t('common.retry')}
      />
    );
  }

  const { catalogue, field_confidence, needs_confirmation } = result;

  // hydrate marketplace/dimensions once, from whatever the backend already has
  if (!hydratedRef.current) {
    hydratedRef.current = true;
    if (catalogue.marketplace) {
      setMarketplace((prev) => ({ ...prev, ...catalogue.marketplace }));
    }
    if (catalogue.dimensions?.product) {
      setProductDims((prev) => ({ ...prev, ...catalogue.dimensions!.product }));
    }
    if (catalogue.dimensions?.packaging) {
      setHasBox(true);
      setBoxDims((prev) => ({ ...prev, ...catalogue.dimensions!.packaging! }));
    }
  }

  // Input fields: populated with extracted catalogue details
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
      value: catalogue.labour?.hours && catalogue.labour.hours > 0 ? String(catalogue.labour.hours) : '',
      placeholder: t('confirm.fields.hoursPlaceholder'),
    },
    {
      key: 'material_cost_paise',
      label: t('confirm.fields.materialCost'),
      value: catalogue.material_cost_paise && catalogue.material_cost_paise > 0 ? String(Math.round(catalogue.material_cost_paise / 100)) : '',
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

  const handleFieldChange = (key: string, text: string) => {
    setEditedFields((prev) => ({ ...prev, [key]: text }));
    if (text.trim().length > 0) {
      setConfirmedFields((prev) => new Set(prev).add(key));
    }
  };

  const handleConfirmField = (key: string) => {
    setConfirmedFields((prev) => new Set(prev).add(key));
  };

  const getFieldConfidence = (key: string): number | undefined => {
    if (field_confidence && field_confidence[key] !== undefined) return field_confidence[key];
    if (key === 'title.en' && field_confidence?.title !== undefined) return field_confidence.title;
    if (key === 'description.en' && field_confidence?.description !== undefined) return field_confidence.description;
    if (key === 'labour.hours' && (field_confidence?.labour_hours !== undefined || field_confidence?.['labour.hours'] !== undefined)) {
      return field_confidence['labour.hours'] ?? field_confidence.labour_hours;
    }
    return undefined;
  };

  // Requirement 4: Ensure labour.hours ("Hours to make") always has the tap-to-confirm button
  const isFieldInNeedsConfirmation = (key: string): boolean => {
    if (key === 'labour.hours') return true;
    if (key === 'material_cost_paise') return true;
    if (needs_confirmation.includes(key)) return true;
    if (key === 'title.en' && (needs_confirmation.includes('title') || needs_confirmation.includes('title.en'))) return true;
    if (key === 'description.en' && (needs_confirmation.includes('description') || needs_confirmation.includes('description.en'))) return true;
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

  // --- marketplace tab required-field gate ---
  const marketplaceValid =
    marketplace.quantity_available > 0 &&
    !!marketplace.unit &&
    marketplace.min_order_qty >= 1;

  // Requirement 1: Product dimensions are required fields
  const dimensionsValid =
    productDims.length_cm > 0 &&
    productDims.width_cm > 0 &&
    productDims.height_cm > 0 &&
    productDims.weight_g > 0 &&
    (!hasBox || (boxDims.length_cm > 0 && boxDims.width_cm > 0 && boxDims.height_cm > 0 && boxDims.weight_g > 0));

  const productTabIncomplete = !allNeedsConfirmationHandled;
  const marketplaceTabIncomplete = !marketplaceValid;
  const dimensionsTabIncomplete = !dimensionsValid;

  const canContinue = allNeedsConfirmationHandled && marketplaceValid && dimensionsValid;

  const updateProductDim = (field: keyof DimensionSet, text: string) => {
    setProductDims((prev) => ({ ...prev, [field]: parseFloat(text) || 0 }));
  };
  const updateBoxDim = (field: keyof DimensionSet, text: string) => {
    setBoxDims((prev) => ({ ...prev, [field]: parseFloat(text) || 0 }));
  };

  const stepQuantity = (delta: number) => {
    setMarketplace((prev) => ({ ...prev, quantity_available: Math.max(0, prev.quantity_available + delta) }));
  };
  const stepMinOrder = (delta: number) => {
    setMarketplace((prev) => ({ ...prev, min_order_qty: Math.max(1, prev.min_order_qty + delta) }));
  };
  const stepMaxOrder = (delta: number) => {
    setMarketplace((prev) => {
      const current = prev.max_order_qty;
      if (current === null || current === undefined) {
        if (delta > 0) {
          return { ...prev, max_order_qty: Math.max(1, prev.min_order_qty || 1) };
        }
        return { ...prev, max_order_qty: null };
      }
      const nextVal = current + delta;
      return {
        ...prev,
        max_order_qty: nextVal <= 0 ? null : nextVal,
      };
    });
  };

  const startEditingQty = (
    field: 'quantity_available' | 'min_order_qty' | 'max_order_qty',
    currentVal: number | null | undefined
  ) => {
    setEditingQtyField(field);
    if (field === 'max_order_qty' && (currentVal === null || currentVal === undefined || currentVal <= 0)) {
      setQtyInputText('');
    } else {
      setQtyInputText(currentVal !== undefined && currentVal !== null ? String(currentVal) : '');
    }
  };

  const commitQty = (field: 'quantity_available' | 'min_order_qty' | 'max_order_qty') => {
    const trimmed = qtyInputText.trim();
    const parsed = parseInt(trimmed, 10);
    if (field === 'quantity_available') {
      setMarketplace((prev) => ({
        ...prev,
        quantity_available: isNaN(parsed) ? 0 : Math.max(0, parsed),
      }));
    } else if (field === 'min_order_qty') {
      setMarketplace((prev) => ({
        ...prev,
        min_order_qty: isNaN(parsed) ? 1 : Math.max(1, parsed),
      }));
    } else if (field === 'max_order_qty') {
      setMarketplace((prev) => ({
        ...prev,
        max_order_qty: isNaN(parsed) || trimmed === '' || parsed <= 0 ? null : parsed,
      }));
    }
    setEditingQtyField(null);
    setQtyInputText('');
  };

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
        : (catalogue.material_cost_paise || 0),
      title: {
        ...catalogue.title,
        en: editedFields['title.en'] !== undefined ? editedFields['title.en'] : (catalogue.title?.en || ''),
      },
      description: {
        ...catalogue.description,
        en: editedFields['description.en'] !== undefined ? editedFields['description.en'] : (catalogue.description?.en || ''),
      },
      provenance: catalogue.provenance,
      source: catalogue.source,
      marketplace,
      dimensions: {
        product: productDims,
        packaging: hasBox ? boxDims : null,
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

  // Requirement 2: Yes / No button selector for boolean choices
  const renderYesNoField = (
    label: string,
    value: boolean,
    onChange: (val: boolean) => void
  ) => (
    <View style={styles.fieldCard}>
      <View style={styles.toggleRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.yesNoRow}>
          <Button
            mode={value ? 'contained' : 'outlined'}
            onPress={() => onChange(true)}
            buttonColor={value ? colors.secondary : undefined}
            textColor={value ? colors.onPrimary : colors.textMuted}
            style={[styles.yesNoBtn, value && styles.yesNoBtnActive]}
            labelStyle={styles.yesNoLabel}
            compact
          >
            Yes
          </Button>
          <Button
            mode={!value ? 'contained' : 'outlined'}
            onPress={() => onChange(false)}
            buttonColor={!value ? colors.secondary : undefined}
            textColor={!value ? colors.onPrimary : colors.textMuted}
            style={[styles.yesNoBtn, !value && styles.yesNoBtnActive]}
            labelStyle={styles.yesNoLabel}
            compact
          >
            No
          </Button>
        </View>
      </View>
    </View>
  );

  const renderDimGroup = (
    label: string,
    dims: DimensionSet,
    onChange: (field: keyof DimensionSet, text: string) => void,
    isRequired: boolean = true
  ) => (
    <View style={styles.dimGroup}>
      <Text style={styles.dimGroupTitle}>{label} {isRequired && '*'}</Text>
      <View style={styles.dimRow}>
        <View style={styles.dimInputWrap}>
          <Text style={styles.dimInputLabel}>Length (cm) {isRequired && '*'}</Text>
          <TextInput
            mode="outlined"
            value={dims.length_cm ? String(dims.length_cm) : ''}
            onChangeText={(t) => onChange('length_cm', t)}
            keyboardType="numeric"
            placeholder="e.g., 20"
            placeholderTextColor={colors.placeholder}
            textColor={colors.text}
            style={styles.dimInput}
            outlineColor={colors.border}
            activeOutlineColor={colors.primary}
          />
        </View>
        <View style={styles.dimInputWrap}>
          <Text style={styles.dimInputLabel}>Width (cm) {isRequired && '*'}</Text>
          <TextInput
            mode="outlined"
            value={dims.width_cm ? String(dims.width_cm) : ''}
            onChangeText={(t) => onChange('width_cm', t)}
            keyboardType="numeric"
            placeholder="e.g., 15"
            placeholderTextColor={colors.placeholder}
            textColor={colors.text}
            style={styles.dimInput}
            outlineColor={colors.border}
            activeOutlineColor={colors.primary}
          />
        </View>
      </View>
      <View style={styles.dimRow}>
        <View style={styles.dimInputWrap}>
          <Text style={styles.dimInputLabel}>Height (cm) {isRequired && '*'}</Text>
          <TextInput
            mode="outlined"
            value={dims.height_cm ? String(dims.height_cm) : ''}
            onChangeText={(t) => onChange('height_cm', t)}
            keyboardType="numeric"
            placeholder="e.g., 10"
            placeholderTextColor={colors.placeholder}
            textColor={colors.text}
            style={styles.dimInput}
            outlineColor={colors.border}
            activeOutlineColor={colors.primary}
          />
        </View>
        <View style={styles.dimInputWrap}>
          <Text style={styles.dimInputLabel}>Weight (g) {isRequired && '*'}</Text>
          <TextInput
            mode="outlined"
            value={dims.weight_g ? String(dims.weight_g) : ''}
            onChangeText={(t) => onChange('weight_g', t)}
            keyboardType="numeric"
            placeholder="e.g., 500"
            placeholderTextColor={colors.placeholder}
            textColor={colors.text}
            style={styles.dimInput}
            outlineColor={colors.border}
            activeOutlineColor={colors.primary}
          />
        </View>
      </View>
    </View>
  );

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

        {/* Tab bar */}
        <View style={styles.tabBar}>
          {([
            { key: 'product' as TabKey, label: 'Product Details', incomplete: productTabIncomplete },
            { key: 'marketplace' as TabKey, label: 'Marketplace', incomplete: marketplaceTabIncomplete },
            { key: 'dimensions' as TabKey, label: 'Dimensions', incomplete: dimensionsTabIncomplete },
          ]).map((tab) => (
            <Button
              key={tab.key}
              mode={activeTab === tab.key ? 'contained' : 'outlined'}
              onPress={() => setActiveTab(tab.key)}
              buttonColor={activeTab === tab.key ? colors.primary : undefined}
              textColor={activeTab === tab.key ? colors.onPrimary : colors.text}
              style={styles.tabButton}
              labelStyle={{ fontSize: 12 }}
              compact
            >
              {tab.label}
              {tab.incomplete ? ' •' : ''}
            </Button>
          ))}
        </View>

        {/* --- Tab: Product Details --- */}
        {activeTab === 'product' && (
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
                    placeholderTextColor={colors.placeholder}
                    textColor={colors.text}
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
                      textColor={isConfirmed ? colors.onPrimary : colors.text}
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
        )}

        {/* --- Tab: Marketplace --- */}
        {activeTab === 'marketplace' && (
          <View style={styles.listContainer}>
            <View style={styles.fieldCard}>
              <Text style={styles.fieldLabel}>Quantity Available *</Text>
              <View style={styles.stepperRow}>
                <Button mode="outlined" onPress={() => stepQuantity(-1)} compact style={styles.stepperBtn}>−</Button>
                {editingQtyField === 'quantity_available' ? (
                  <View style={styles.qtyEditContainer}>
                    <TextInput
                      mode="outlined"
                      value={qtyInputText}
                      onChangeText={setQtyInputText}
                      keyboardType="number-pad"
                      autoFocus
                      selectTextOnFocus
                      onBlur={() => commitQty('quantity_available')}
                      onSubmitEditing={() => commitQty('quantity_available')}
                      style={styles.qtyTextInput}
                      dense
                    />
                    <TouchableOpacity
                      onPress={() => commitQty('quantity_available')}
                      style={styles.qtyApplyBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Save quantity"
                    >
                      <MaterialCommunityIcons name="check" size={16} color={colors.onPrimary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => startEditingQty('quantity_available', marketplace.quantity_available)}
                    style={styles.stepperValueContainer}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Quantity Available: ${marketplace.quantity_available}. Tap to type number.`}
                  >
                    <Text style={styles.stepperValue}>{marketplace.quantity_available}</Text>
                    <MaterialCommunityIcons name="pencil-outline" size={12} color={colors.textMuted} style={styles.stepperEditIcon} />
                  </TouchableOpacity>
                )}
                <Button mode="outlined" onPress={() => stepQuantity(1)} compact style={styles.stepperBtn}>+</Button>
              </View>
            </View>

            {/* Requirement 3: Unit pill background color in deep indigo (#243354) */}
            <View style={styles.fieldCard}>
              <Text style={styles.fieldLabel}>Unit *</Text>
              <View style={styles.chipRow}>
                {UNIT_OPTIONS.map((u) => {
                  const isSelected = marketplace.unit === u;
                  return (
                    <Chip
                      key={u}
                      selected={isSelected}
                      selectedColor={colors.onPrimary}
                      theme={{
                        colors: {
                          onSecondaryContainer: colors.onPrimary,
                          onSurfaceVariant: colors.onPrimary,
                          primary: colors.onPrimary,
                        },
                      }}
                      onPress={() => setMarketplace((prev) => ({ ...prev, unit: u }))}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                      textStyle={isSelected ? styles.chipTextSelected : styles.chipText}
                      showSelectedOverlay={false}
                    >
                      {u}
                    </Chip>
                  );
                })}
              </View>
            </View>

            <View style={styles.fieldCard}>
              <Text style={styles.fieldLabel}>Minimum Order Quantity *</Text>
              <View style={styles.stepperRow}>
                <Button mode="outlined" onPress={() => stepMinOrder(-1)} compact style={styles.stepperBtn}>−</Button>
                {editingQtyField === 'min_order_qty' ? (
                  <View style={styles.qtyEditContainer}>
                    <TextInput
                      mode="outlined"
                      value={qtyInputText}
                      onChangeText={setQtyInputText}
                      keyboardType="number-pad"
                      autoFocus
                      selectTextOnFocus
                      onBlur={() => commitQty('min_order_qty')}
                      onSubmitEditing={() => commitQty('min_order_qty')}
                      style={styles.qtyTextInput}
                      dense
                    />
                    <TouchableOpacity
                      onPress={() => commitQty('min_order_qty')}
                      style={styles.qtyApplyBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Save minimum order quantity"
                    >
                      <MaterialCommunityIcons name="check" size={16} color={colors.onPrimary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => startEditingQty('min_order_qty', marketplace.min_order_qty)}
                    style={styles.stepperValueContainer}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Minimum Order: ${marketplace.min_order_qty}. Tap to type number.`}
                  >
                    <Text style={styles.stepperValue}>{marketplace.min_order_qty}</Text>
                    <MaterialCommunityIcons name="pencil-outline" size={12} color={colors.textMuted} style={styles.stepperEditIcon} />
                  </TouchableOpacity>
                )}
                <Button mode="outlined" onPress={() => stepMinOrder(1)} compact style={styles.stepperBtn}>+</Button>
              </View>
            </View>

            <View style={styles.fieldCard}>
              <Text style={styles.fieldLabel}>Maximum Order Quantity (optional)</Text>
              <View style={styles.stepperRow}>
                <Button mode="outlined" onPress={() => stepMaxOrder(-1)} compact style={styles.stepperBtn}>−</Button>
                {editingQtyField === 'max_order_qty' ? (
                  <View style={styles.qtyEditContainer}>
                    <TextInput
                      mode="outlined"
                      value={qtyInputText}
                      onChangeText={setQtyInputText}
                      keyboardType="number-pad"
                      autoFocus
                      selectTextOnFocus
                      placeholder="No limit"
                      onBlur={() => commitQty('max_order_qty')}
                      onSubmitEditing={() => commitQty('max_order_qty')}
                      style={styles.qtyTextInput}
                      dense
                    />
                    <TouchableOpacity
                      onPress={() => commitQty('max_order_qty')}
                      style={styles.qtyApplyBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Save maximum order quantity"
                    >
                      <MaterialCommunityIcons name="check" size={16} color={colors.onPrimary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => startEditingQty('max_order_qty', marketplace.max_order_qty)}
                    style={styles.stepperValueContainer}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Maximum Order: ${marketplace.max_order_qty && marketplace.max_order_qty > 0 ? marketplace.max_order_qty : 'No limit'}. Tap to type number.`}
                  >
                    <Text style={styles.stepperValue}>
                      {marketplace.max_order_qty && marketplace.max_order_qty > 0 ? marketplace.max_order_qty : 'No limit'}
                    </Text>
                    <MaterialCommunityIcons name="pencil-outline" size={12} color={colors.textMuted} style={styles.stepperEditIcon} />
                  </TouchableOpacity>
                )}
                <Button mode="outlined" onPress={() => stepMaxOrder(1)} compact style={styles.stepperBtn}>+</Button>
              </View>
            </View>

            {/* Requirement 2: Yes / No buttons for Cash on Delivery, Returnable, Cancellable */}
            {renderYesNoField('Cash on Delivery Available', marketplace.cod_available, (v) =>
              setMarketplace((prev) => ({ ...prev, cod_available: v }))
            )}

            {renderYesNoField('Returnable', marketplace.returnable, (v) =>
              setMarketplace((prev) => ({ ...prev, returnable: v }))
            )}

            {renderYesNoField('Cancellable', marketplace.cancellable, (v) =>
              setMarketplace((prev) => ({ ...prev, cancellable: v }))
            )}
          </View>
        )}

        {/* --- Tab: Dimensions --- */}
        {activeTab === 'dimensions' && (
          <View style={styles.listContainer}>
            <View style={styles.fieldCard}>
              {renderDimGroup('Product Dimensions', productDims, updateProductDim, true)}
            </View>

            <View style={styles.fieldCard}>
              <View style={styles.toggleRow}>
                <Text style={styles.fieldLabel}>Ships in a box?</Text>
                <View style={styles.yesNoRow}>
                  <Button
                    mode={hasBox ? 'contained' : 'outlined'}
                    onPress={() => setHasBox(true)}
                    buttonColor={hasBox ? colors.secondary : undefined}
                    textColor={hasBox ? colors.onPrimary : colors.textMuted}
                    style={[styles.yesNoBtn, hasBox && styles.yesNoBtnActive]}
                    labelStyle={styles.yesNoLabel}
                    compact
                  >
                    Yes
                  </Button>
                  <Button
                    mode={!hasBox ? 'contained' : 'outlined'}
                    onPress={() => setHasBox(false)}
                    buttonColor={!hasBox ? colors.secondary : undefined}
                    textColor={!hasBox ? colors.onPrimary : colors.textMuted}
                    style={[styles.yesNoBtn, !hasBox && styles.yesNoBtnActive]}
                    labelStyle={styles.yesNoLabel}
                    compact
                  >
                    No
                  </Button>
                </View>
              </View>
              {hasBox && renderDimGroup('Packaging Box Dimensions', boxDims, updateBoxDim, true)}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Docked Action Button */}
      <BottomDock>
        {submitError && <Text style={styles.errorText}>{submitError}</Text>}
        <Button
          mode="contained"
          onPress={handleSubmit}
          disabled={!canContinue || submitting}
          loading={submitting}
          buttonColor={colors.primary}
          textColor="#FFFFFF"
          style={styles.submitBtn}
          contentStyle={{ height: 48 }}
        >
          {canContinue ? t('confirm.continue') : t('confirm.confirmHighlighted')}
        </Button>
      </BottomDock>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ColorPalette, isDark?: boolean) {
  return StyleSheet.create({
    keyboardAvoid: { flex: 1, backgroundColor: colors.background },
    container: { backgroundColor: colors.background, flexGrow: 1, paddingBottom: spacing.xxl + 48 },
    listContainer: { paddingHorizontal: spacing.lg },
    tabBar: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.xs,
    },
    tabButton: {
      flex: 1,
      borderRadius: 8,
    },
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
      color: colors.text,
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
    stepperRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      marginTop: spacing.xs,
    },
    stepperBtn: {
      minWidth: spacing.tapTarget,
      borderRadius: 8,
    },
    stepperValueContainer: {
      minWidth: 80,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 5,
      paddingHorizontal: 10,
      backgroundColor: colors.surfaceElevated,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4,
    },
    stepperEditIcon: {
      opacity: 0.5,
    },
    qtyEditContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      minWidth: 110,
      gap: 6,
    },
    qtyTextInput: {
      minWidth: 70,
      height: 40,
      backgroundColor: colors.surface,
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    qtyApplyBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperValue: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    chip: {
      marginRight: spacing.xs,
      marginBottom: spacing.xs,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
    },
    chipSelected: {
      backgroundColor: colors.secondary,
      borderColor: colors.secondary,
    },
    chipText: {
      color: colors.text,
      fontSize: 12,
    },
    chipTextSelected: {
      color: colors.onPrimary,
      fontWeight: '700',
      fontSize: 12,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    yesNoRow: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    yesNoBtn: {
      borderRadius: 6,
      borderColor: colors.border,
      minWidth: 54,
    },
    yesNoBtnActive: {
      borderColor: colors.secondary,
    },
    yesNoLabel: {
      fontSize: 12,
      fontWeight: '600',
      marginHorizontal: 8,
      marginVertical: 4,
    },
    dimGroup: {
      marginTop: spacing.sm,
    },
    dimGroupTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      marginBottom: spacing.sm,
    },
    dimRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    dimInputWrap: {
      flex: 1,
    },
    dimInputLabel: {
      fontSize: 11,
      color: colors.textMuted,
      marginBottom: 4,
    },
    dimInput: {
      backgroundColor: colors.surface,
      fontSize: 14,
    },
  });
}
