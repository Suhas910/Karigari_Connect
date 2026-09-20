// src/components/ConfidenceDot.tsx
import React, { useMemo } from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useAppTheme, type ColorPalette } from '../theme';

export const getConfidenceColor = (score: number, colors?: ColorPalette) => {
  if (colors) {
    return score >= 0.85 ? colors.text : colors.border;
  }
  return score >= 0.85 ? '#1C1917' : '#E2DDD5';
};

interface ConfidenceDotProps {
  confidence: number;
  style?: StyleProp<ViewStyle>;
}

export default function ConfidenceDot({ confidence, style }: ConfidenceDotProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
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
}
