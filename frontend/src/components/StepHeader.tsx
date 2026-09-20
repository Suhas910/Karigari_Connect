// src/components/StepHeader.tsx
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAppTheme, spacing, type ColorPalette } from '../theme';

interface StepHeaderProps {
  currentStep: number;
  totalSteps?: number;
  title: string;
  subtitle?: string;
}

export default function StepHeader({
  currentStep,
  totalSteps = 5,
  title,
  subtitle,
}: StepHeaderProps) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const progressPercent = Math.min(100, Math.max(0, (currentStep / totalSteps) * 100));

  return (
    <View style={styles.container}>
      <View style={styles.textRow}>
        <View style={styles.pillRow}>
          <View style={styles.stepPill}>
            <Text style={styles.stepPillText}>{t('common.stepOf', { current: currentStep, total: totalSteps })}</Text>
          </View>
        </View>
        <Text variant="titleMedium" style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.track}>
        <View style={[styles.bar, { width: `${progressPercent}%` }]} />
      </View>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      backgroundColor: colors.background,
    },
    textRow: {
      marginBottom: spacing.sm,
    },
    pillRow: {
      flexDirection: 'row',
      marginBottom: 6,
    },
    stepPill: {
      backgroundColor: colors.indigoLight,
      borderColor: colors.indigoBorder,
      borderWidth: 1,
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    stepPillText: {
      fontSize: 10,
      letterSpacing: 0.8,
      color: colors.secondary,
      fontWeight: '700',
    },
    title: {
      color: colors.text,
      fontWeight: '700',
      fontSize: 20,
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    track: {
      height: 3,
      backgroundColor: colors.border,
      borderRadius: 2,
      overflow: 'hidden',
    },
    bar: {
      height: '100%',
      backgroundColor: colors.secondary,
      borderRadius: 2,
    },
  });
}
