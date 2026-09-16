// src/features/profile/LanguagePickerModal.tsx
import React from 'react';
import { View, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../theme';

export const LANGUAGES = [
  { code: 'en', native: 'English', label: 'English', shortCode: 'EN' },
  { code: 'hi', native: 'हिन्दी', label: 'Hindi (हिन्दी)', shortCode: 'HI' },
  { code: 'kn', native: 'ಕನ್ನಡ', label: 'Kannada (ಕನ್ನಡ)', shortCode: 'KN' },
];

interface LanguagePickerModalProps {
  visible: boolean;
  onDismiss: () => void;
}

export const LanguagePickerModal: React.FC<LanguagePickerModalProps> = ({
  visible,
  onDismiss,
}) => {
  const { i18n } = useTranslation();

  const handleSelectLanguage = async (code: string) => {
    try {
      await i18n.changeLanguage(code);
    } catch (err) {
      console.error('Failed to change language', err);
    }
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onDismiss}
        />
        <View style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.iconBox}>
              <MaterialCommunityIcons name="translate" size={24} color={colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>App Language / भाषा</Text>
              <Text style={styles.headerSubtitle}>
                Select primary language for audio & cataloging
              </Text>
            </View>
            <TouchableOpacity onPress={onDismiss} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Language Options */}
          <View style={styles.optionsList}>
            {LANGUAGES.map((lang) => {
              const isSelected = i18n.language === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[styles.langOption, isSelected && styles.langOptionSelected]}
                  onPress={() => handleSelectLanguage(lang.code)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={styles.langLeft}>
                    <Text style={[styles.langLabel, isSelected && styles.langLabelSelected]}>
                      {lang.label}
                    </Text>
                    <Text style={styles.nativeText}>{lang.native}</Text>
                  </View>

                  <View style={styles.langRight}>
                    <View style={[styles.badgeChip, isSelected && styles.badgeChipSelected]}>
                      <Text style={[styles.badgeText, isSelected && styles.badgeTextSelected]}>
                        {lang.shortCode}
                      </Text>
                    </View>
                    {isSelected && (
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={22}
                        color={colors.primary}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Button
            mode="outlined"
            onPress={onDismiss}
            style={styles.cancelBtn}
            textColor={colors.textMuted}
          >
            Close
          </Button>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheetContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: spacing.md,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.indigoLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  optionsList: {
    gap: 10,
    marginVertical: spacing.sm,
  },
  langOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: '#FAFAFA',
  },
  langOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FAF5F2',
  },
  langLeft: {
    flex: 1,
  },
  langLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  langLabelSelected: {
    color: colors.primary,
  },
  nativeText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  langRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  badgeChip: {
    backgroundColor: colors.badgeNeutral,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeChipSelected: {
    backgroundColor: '#F3E5E0',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  badgeTextSelected: {
    color: colors.primary,
  },
  cancelBtn: {
    marginTop: spacing.md,
    borderRadius: 12,
    borderColor: colors.border,
  },
});
