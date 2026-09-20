import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Modal, ScrollView, Platform, StatusBar, KeyboardAvoidingView, TouchableOpacity } from 'react-native';
import { Text, Button, TextInput } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useAppTheme, spacing } from '../../theme';
import type { ColorPalette } from '../../theme';
import type { ArtisanProfile, BankDetailsUpdate } from '../../types/contracts';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

interface Props {
  visible: boolean;
  profile: ArtisanProfile | null;
  submitting: boolean;
  onSubmit: (payload: BankDetailsUpdate) => Promise<void>;
  onDismiss: () => void;
}

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const BankDetailsEditModal: React.FC<Props> = ({ visible, profile, submitting, onSubmit, onDismiss }) => {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [accountHolderName, setAccountHolderName] = useState(profile?.account_holder_name ?? '');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState(profile?.ifsc_code ?? '');
  const [bankName, setBankName] = useState(profile?.bank_name ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!accountHolderName.trim()) return setError(t('bankModal.errorHolderName'));
    if (ifscCode && !IFSC_REGEX.test(ifscCode.toUpperCase())) {
      return setError(t('bankModal.errorIfsc'));
    }

    try {
      await onSubmit({
        account_holder_name: accountHolderName.trim(),
        ...(accountNumber ? { account_number: accountNumber.trim() } : {}),
        ifsc_code: ifscCode ? ifscCode.toUpperCase() : undefined,
        bank_name: bankName.trim() || undefined,
      });
    } catch (err: any) {
      setError(err?.response?.data?.detail?.[0]?.msg || err?.response?.data?.detail || err?.message || t('bankModal.saveFailed'));
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
              <Text style={styles.heading}>{t('bankModal.title')}</Text>

              <TextInput
                label={t('bankModal.accountHolderName')}
                value={accountHolderName}
                onChangeText={setAccountHolderName}
                mode="outlined"
                style={styles.input}
              />

              <TextInput
                label={profile?.account_number ? t('bankModal.accountNumberOnFile', { number: profile.account_number }) : t('bankModal.accountNumber')}
                value={accountNumber}
                onChangeText={setAccountNumber}
                mode="outlined"
                keyboardType="number-pad"
                placeholder={t('bankModal.accountNumberPlaceholder')}
                style={styles.input}
              />

              <TextInput
                label={t('bankModal.ifscCode')}
                value={ifscCode}
                onChangeText={(v) => setIfscCode(v.toUpperCase())}
                mode="outlined"
                autoCapitalize="characters"
                maxLength={11}
                style={styles.input}
              />

              <TextInput
                label={t('bankModal.bankName')}
                value={bankName}
                onChangeText={setBankName}
                mode="outlined"
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

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    keyboardAvoid: { flex: 1 },
    backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    topBackdrop: { flex: 1 },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
    dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },
    scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
    heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
    input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
    error: { color: colors.error, fontSize: 13, marginTop: spacing.xs },
    footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
    footerButton: { flex: 1 },
  });
}
