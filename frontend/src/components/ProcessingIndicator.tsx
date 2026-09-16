// src/components/ProcessingIndicator.tsx
import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { colors, spacing } from '../theme';

interface ProcessingIndicatorProps {
  hint?: string;
  style?: StyleProp<ViewStyle>;
}

export default function ProcessingIndicator({ hint, style }: ProcessingIndicatorProps) {
  return (
    <View style={[styles.centered, style]}>
      <ActivityIndicator size="large" color={colors.primary} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  hint: {
    color: colors.text,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
