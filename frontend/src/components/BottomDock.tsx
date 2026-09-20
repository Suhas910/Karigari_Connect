// src/components/BottomDock.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, Platform, Keyboard, type ViewStyle, type StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme, spacing, type ColorPalette } from '../theme';

interface BottomDockProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export default function BottomDock({ children, style }: BottomDockProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return (
    <View
      style={[
        styles.dock,
        {
          paddingBottom: keyboardVisible
            ? spacing.sm + 2
            : Math.max(insets.bottom, spacing.md),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function createStyles(colors: ColorPalette, isDark: boolean) {
  return StyleSheet.create({
    dock: {
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm + 4,
      // Elevation for Android
      elevation: 8,
      // Subtle shadow for iOS
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: -3 },
      shadowOpacity: isDark ? 0.25 : 0.06,
      shadowRadius: 4,
    },
  });
}
