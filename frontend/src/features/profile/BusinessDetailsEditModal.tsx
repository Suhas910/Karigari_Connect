import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Modal, ScrollView, Platform, StatusBar, TouchableOpacity, KeyboardAvoidingView } from 'react-native';
import { Text, Button, TextInput, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useAppTheme, spacing } from '../../theme';
import type { ColorPalette } from '../../theme';
import { PILOT_STATES } from '../../store/draftStore';
import { lookupPincode } from '../../services/pincodeLookup';
import type { ArtisanProfile, BusinessDetailsUpdate } from '../../types/contracts';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

interface Props {
  visible: boolean;
  profile: ArtisanProfile | null;
  submitting: boolean;
  onSubmit: (payload: BusinessDetailsUpdate) => Promise<void>;
  onDismiss: () => void;
}

const ALL_ESTABLISHMENT_TYPE_KEYS: { value: NonNullable<BusinessDetailsUpdate['establishment_type']>; key: string }[] = [
  { value: 'individual', key: 'businessModal.establishmentTypes.individual' },
  { value: 'proprietorship', key: 'businessModal.establishmentTypes.proprietorship' },
  { value: 'partnership', key: 'businessModal.establishmentTypes.partnership' },
  { value: 'llp', key: 'businessModal.establishmentTypes.llp' },
  { value: 'pvt_ltd', key: 'businessModal.establishmentTypes.pvt_ltd' },
  { value: 'public_ltd', key: 'businessModal.establishmentTypes.public_ltd' },
  { value: 'huf', key: 'businessModal.establishmentTypes.huf' },
  { value: 'trust', key: 'businessModal.establishmentTypes.trust' },
  { value: 'society', key: 'businessModal.establishmentTypes.society' },
];

export const BusinessDetailsEditModal: React.FC<Props> = ({ visible, profile, submitting, onSubmit, onDismiss }) => {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [businessName, setBusinessName] = useState(profile?.business_name ?? '');
  const [brandName, setBrandName] = useState(profile?.brand_name ?? '');
  const [establishmentType, setEstablishmentType] = useState<NonNullable<BusinessDetailsUpdate['establishment_type']>>(
    (profile?.establishment_type as NonNullable<BusinessDetailsUpdate['establishment_type']>) ?? 'individual'
  );
  const [panNumber, setPanNumber] = useState(profile?.pan_number ?? '');
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [gstRegistered, setGstRegistered] = useState(profile?.gst_registered ?? false);
  const [gstNumber, setGstNumber] = useState(profile?.gst_number ?? '');
  const [enrollmentNumber, setEnrollmentNumber] = useState(profile?.enrollment_number ?? '');
  const [addressLine, setAddressLine] = useState(profile?.business_address_line ?? '');
  const [pincode, setPincode] = useState(profile?.pincode ?? '');
  const [district, setDistrict] = useState(profile?.district ?? '');
  const [city, setCity] = useState(profile?.city ?? '');
  const [stateCode, setStateCode] = useState(profile?.business_state_code ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pincodeChecking, setPincodeChecking] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const currentEstablishmentLabel = t(
    ALL_ESTABLISHMENT_TYPE_KEYS.find((e) => e.value === establishmentType)?.key || 'businessModal.establishmentTypes.individual'
  );

  const handlePincodeChange = async (value: string) => {
    setPincode(value);
    if (value.length === 6) {
      setPincodeChecking(true);
      const result = await lookupPincode(value);
      setPincodeChecking(false);
      if (result) {
        setDistrict(result.district);
        setCity(result.city);
        const match = PILOT_STATES.find((s) => s.name.toLowerCase() === result.state.toLowerCase());
        if (match) setStateCode(match.code);
      }
      // No match found -> leave fields as-is, artisan fills manually. Never block.
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (!businessName.trim()) return setError(t('businessModal.errorBusinessName'));
    if (panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber.toUpperCase())) {
      return setError(t('businessModal.errorPan'));
    }
    if (gstRegistered && !gstNumber.trim()) return setError(t('businessModal.errorGst'));
    if (!gstRegistered && !enrollmentNumber.trim()) {
      return setError(t('businessModal.errorEnrollment'));
    }
    if (!gstRegistered && enrollmentNumber.trim() && !/^[a-zA-Z0-9]+$/.test(enrollmentNumber.trim())) {
      return setError(t('businessModal.errorInvalidEnrollment'));
    }
    if (pincode && !/^\d{6}$/.test(pincode)) return setError(t('businessModal.errorPincode'));

    try {
      await onSubmit({
        business_name: businessName.trim(),
        brand_name: brandName.trim() || undefined,
        establishment_type: establishmentType as BusinessDetailsUpdate['establishment_type'],
        pan_number: panNumber ? panNumber.toUpperCase() : undefined,
        ...(aadhaarNumber ? { aadhaar_number: aadhaarNumber } : {}),
        gst_registered: gstRegistered,
        gst_number: gstRegistered && gstNumber ? gstNumber.toUpperCase() : undefined,
        enrollment_number: !gstRegistered && enrollmentNumber ? enrollmentNumber.trim() : undefined,
        business_address_line: addressLine.trim() || undefined,
        pincode: pincode || undefined,
        district: district || undefined,
        city: city || undefined,
        business_state_code: stateCode || undefined,
      });
    } catch (err: any) {
      setError(err?.response?.data?.detail?.[0]?.msg || err?.response?.data?.detail || err?.message || t('businessModal.saveFailed'));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onDismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoid}
      >
        <View
          style={[
            styles.backdrop,
            Platform.OS === 'android' && keyboardHeight > 0 && { paddingBottom: keyboardHeight },
          ]}
        >
          <TouchableOpacity style={styles.topBackdrop} activeOpacity={1} onPress={onDismiss} />
          <View
            style={[
              styles.sheet,
              {
                paddingTop: Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 24),
                maxHeight: keyboardHeight > 0 ? (Platform.OS === 'ios' ? '75%' : '65%') : '92%',
              },
            ]}
          >
            <View style={styles.dragHandle} />
            <ScrollView
              contentContainerStyle={[
                styles.scrollContent,
                { paddingBottom: keyboardHeight > 0 ? 30 : spacing.lg },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.heading}>{t('businessModal.title')}</Text>

              <TextInput label={t('businessModal.businessName')} value={businessName} onChangeText={setBusinessName} mode="outlined" style={styles.input} />
              <TextInput label={t('businessModal.brandName')} value={brandName} onChangeText={setBrandName} mode="outlined" style={styles.input} />

              <Text style={styles.sectionLabel}>{t('businessModal.establishmentType')}</Text>
              <TouchableOpacity
                style={styles.dropdownTrigger}
                onPress={() => setDropdownOpen(!dropdownOpen)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${t('businessModal.establishmentType')}, currently ${currentEstablishmentLabel}`}
              >
              <View style={styles.dropdownValueRow}>
                <MaterialCommunityIcons name="domain" size={20} color={colors.secondary} />
                <Text style={styles.dropdownSelectedText}>
                  {currentEstablishmentLabel}
                </Text>
              </View>
              <MaterialCommunityIcons
                name={dropdownOpen ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={colors.textMuted}
              />
            </TouchableOpacity>

            {dropdownOpen && (
              <View style={styles.dropdownContainer}>
                {ALL_ESTABLISHMENT_TYPE_KEYS.map((item) => {
                  const isSelected = establishmentType === item.value;
                  const itemLabel = t(item.key);
                  return (
                    <TouchableOpacity
                      key={item.value}
                      style={[styles.dropdownItem, isSelected && styles.dropdownItemSelected]}
                      onPress={() => {
                        setEstablishmentType(item.value);
                        setDropdownOpen(false);
                      }}
                    >
                      <Text style={[styles.dropdownItemText, isSelected && styles.dropdownItemTextSelected]}>
                        {itemLabel}
                      </Text>
                      {isSelected && (
                        <MaterialCommunityIcons name="check" size={18} color={colors.secondary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <TextInput label={t('businessModal.panNumber')} value={panNumber} onChangeText={(v) => setPanNumber(v.toUpperCase())} mode="outlined" autoCapitalize="characters" maxLength={10} style={styles.input} />
            <TextInput label={t('businessModal.aadhaarNumber')} value={aadhaarNumber} onChangeText={setAadhaarNumber} mode="outlined" keyboardType="number-pad" maxLength={12} style={styles.input} />

            <View style={styles.switchRow}>
              <Text style={styles.sectionLabel}>{t('businessModal.gstRegistered')}</Text>
              <Switch value={gstRegistered} onValueChange={setGstRegistered} color={colors.secondary} />
            </View>
            {gstRegistered ? (
              <TextInput label={t('businessModal.gstNumber')} value={gstNumber} onChangeText={(v) => setGstNumber(v.toUpperCase())} mode="outlined" autoCapitalize="characters" style={styles.input} />
            ) : (
              <TextInput label={t('businessModal.enrollmentNumber')} value={enrollmentNumber} onChangeText={setEnrollmentNumber} mode="outlined" style={styles.input} />
            )}

            <TextInput label={t('businessModal.address')} value={addressLine} onChangeText={setAddressLine} mode="outlined" multiline style={styles.input} />
            <TextInput
              label={t('businessModal.pincode')}
              value={pincode}
              onChangeText={handlePincodeChange}
              mode="outlined"
              keyboardType="number-pad"
              maxLength={6}
              right={pincodeChecking ? <TextInput.Icon icon="loading" /> : undefined}
              style={styles.input}
            />
            <TextInput label={t('businessModal.district')} value={district} onChangeText={setDistrict} mode="outlined" style={styles.input} />
            <TextInput label={t('businessModal.city')} value={city} onChangeText={setCity} mode="outlined" style={styles.input} />
            <TextInput label={t('businessModal.state')} value={PILOT_STATES.find((s) => s.code === stateCode)?.name ?? stateCode} mode="outlined" editable={false} style={styles.input} />

            {error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <Button mode="outlined" onPress={onDismiss} style={styles.footerButton} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button mode="contained" onPress={handleSubmit} style={styles.footerButton} loading={submitting} disabled={submitting} buttonColor={colors.primary}>
              {t('common.done', { defaultValue: 'Save' })}
            </Button>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>
  );
};

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    keyboardAvoid: { flex: 1 },
    backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    topBackdrop: { flex: 1 },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
    dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },
    scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
    heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
    sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.xs, marginTop: spacing.sm },
    input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
    dropdownTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      minHeight: 50,
      marginBottom: spacing.sm,
    },
    dropdownValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    dropdownSelectedText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    dropdownContainer: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: spacing.xs,
      marginBottom: spacing.sm,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 3,
    },
    dropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 11,
      paddingHorizontal: spacing.md,
      borderRadius: 8,
    },
    dropdownItemSelected: {
      backgroundColor: colors.indigoLight,
    },
    dropdownItemText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    dropdownItemTextSelected: {
      color: colors.secondary,
      fontWeight: '700',
    },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
    error: { color: colors.error, fontSize: 13, marginTop: spacing.xs },
    footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
    footerButton: { flex: 1 },
  });
}
