// src/components/ConfidenceDot.tsx
import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors } from '../theme';

export const getConfidenceColor = (score: number) => {
  return score >= 0.85 ? colors.text : colors.border;
};

interface ConfidenceDotProps {
  confidence: number;
  style?: StyleProp<ViewStyle>;
}

export default function ConfidenceDot({ confidence, style }: ConfidenceDotProps) {
  const isHigh = confidence >= 0.85;
  return (
    <View
      style={[
        styles.dot,
        isHigh ? styles.dotFilled : styles.dotOutlined,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotFilled: {
    backgroundColor: colors.text,
  },
  dotOutlined: {
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    backgroundColor: 'transparent',
  },
});
