import React, { useState } from 'react';
import { View, StyleSheet, Modal, ScrollView, Platform, StatusBar, KeyboardAvoidingView, TouchableOpacity } from 'react-native';
import { Text, Button, TextInput, SegmentedButtons } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, spacing } from '../../theme';
import type { ArtisanProfile, PersonalDetailsUpdate } from '../../types/contracts';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

interface Props {
  visible: boolean;
  profile: ArtisanProfile | null;
  submitting: boolean;
  onSubmit: (payload: PersonalDetailsUpdate) => Promise<void>;
  onDismiss: () => void;
}

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const PersonalDetailsEditModal: React.FC<Props> = ({ visible, profile, submitting, onSubmit, onDismiss }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [firstName, setFirstName] = useState(profile?.first_name ?? '');
  const [middleName, setMiddleName] = useState(profile?.middle_name ?? '');
  const [lastName, setLastName] = useState(profile?.last_name ?? '');
  const [nameAsPerAadhaar, setNameAsPerAadhaar] = useState(profile?.name_as_per_aadhaar ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [gender, setGender] = useState(
    profile?.gender && profile.gender !== 'prefer_not_to_say' ? profile.gender : 'male'
  );
  const [error, setError] = useState<string | null>(null);

  const genderOptions = [
    { value: 'male', label: t('personalModal.male') },
    { value: 'female', label: t('personalModal.female') },
    { value: 'other', label: t('personalModal.other') },
  ];

  const handleSubmit = async () => {
    setError(null);
    if (!firstName.trim()) return setError(t('personalModal.errorFirstName'));
    if (email.trim() && !EMAIL_REGEX.test(email.trim())) {
      return setError(t('personalModal.errorEmail'));
    }

    try {
      await onSubmit({
        first_name: firstName.trim(),
        middle_name: middleName.trim() || undefined,
        last_name: lastName.trim() || undefined,
        name_as_per_aadhaar: nameAsPerAadhaar.trim() || undefined,
        email: email.trim() || undefined,
        gender: gender as PersonalDetailsUpdate['gender'],
      });
    } catch (err: any) {
      setError(err?.response?.data?.detail?.[0]?.msg || err?.response?.data?.detail || err?.message || t('personalModal.saveFailed'));
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
              <Text style={styles.heading}>{t('personalModal.title')}</Text>

              <TextInput label={t('personalModal.firstName')} value={firstName} onChangeText={setFirstName} mode="outlined" style={styles.input} />
              <TextInput label={t('personalModal.middleName')} value={middleName} onChangeText={setMiddleName} mode="outlined" style={styles.input} />
              <TextInput label={t('personalModal.lastName')} value={lastName} onChangeText={setLastName} mode="outlined" style={styles.input} />
              <TextInput label={t('personalModal.nameAsPerAadhaar')} value={nameAsPerAadhaar} onChangeText={setNameAsPerAadhaar} mode="outlined" style={styles.input} />

              <TextInput
                label={t('personalModal.email')}
                value={email}
                onChangeText={setEmail}
                mode="outlined"
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.input}
              />

              <Text style={styles.sectionLabel}>{t('personalModal.gender')}</Text>
              <SegmentedButtons
                value={gender}
                onValueChange={(v) => setGender(v as any)}
                buttons={genderOptions}
                theme={{
                  colors: {
                    secondaryContainer: colors.indigoLight,
                    onSecondaryContainer: colors.secondary,
                  },
                }}
                style={styles.input}
              />

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

const styles = StyleSheet.create({
  keyboardAvoid: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  topBackdrop: { flex: 1 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.xs },
  footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  footerButton: { flex: 1 },
});
