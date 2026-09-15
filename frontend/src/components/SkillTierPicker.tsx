// src/components/SkillTierPicker.tsx
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, RadioButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, spacing, typography } from '../theme';

export type SkillOption = 'beginner' | 'intermediate' | 'skilled' | 'master';

export const SKILL_OPTIONS: SkillOption[] = ['beginner', 'intermediate', 'skilled', 'master'];

export const OPTION_TO_STATUTORY_SKILL: Record<SkillOption, 'unskilled' | 'semi_skilled' | 'skilled' | 'highly_skilled'> = {
  beginner: 'unskilled',
  intermediate: 'semi_skilled',
  skilled: 'skilled',
  master: 'highly_skilled',
};

export const STATUTORY_SKILL_TO_OPTION: Record<string, SkillOption> = {
  unskilled: 'beginner',
  semi_skilled: 'intermediate',
  skilled: 'skilled',
  highly_skilled: 'master',
};

interface SkillTierPickerProps {
  selected: SkillOption | null;
  onSelect: (option: SkillOption) => void;
  disabled?: boolean;
}

export const SkillTierPicker: React.FC<SkillTierPickerProps> = ({
  selected,
  onSelect,
  disabled = false,
}) => {
  const { t } = useTranslation();

  return (
    <View style={styles.optionsGroup}>
      {SKILL_OPTIONS.map((opt) => {
        const isSelected = selected === opt;
        return (
          <TouchableOpacity
            key={opt}
            style={[
              styles.optionCard,
              isSelected && styles.optionCardSelected,
              disabled && styles.optionCardDisabled,
            ]}
            onPress={() => !disabled && onSelect(opt)}
            activeOpacity={disabled ? 1 : 0.7}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={styles.optionIcon}>
              {t(`onboarding.skillQuestion.options.${opt}.icon`)}
            </Text>
            <View style={styles.textContainer}>
              <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                {t(`onboarding.skillQuestion.options.${opt}.label`)}
              </Text>
            </View>
            <RadioButton
              value={opt}
              status={isSelected ? 'checked' : 'unchecked'}
              onPress={() => !disabled && onSelect(opt)}
              color={colors.primary}
              disabled={disabled}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  optionsGroup: {
    gap: spacing.md,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2DDD5',
    gap: spacing.sm,
  },
  optionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FDF7F4',
  },
  optionCardDisabled: {
    opacity: 0.6,
  },
  optionIcon: {
    fontSize: 24,
    width: 32,
    textAlign: 'center',
  },
  textContainer: {
    flex: 1,
  },
  optionLabel: {
    fontFamily: typography.body,
    fontSize: 15,
    color: '#1C1917',
    fontWeight: '600',
  },
  optionLabelSelected: {
    color: colors.primary,
  },
});
