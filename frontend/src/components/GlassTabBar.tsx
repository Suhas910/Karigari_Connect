// src/components/GlassTabBar.tsx
import React, { useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, Platform, Text } from 'react-native';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useAppTheme } from '../theme';

const ICON_MAP: Record<string, string> = {
  MyListings: 'package-variant-closed',
  InReview: 'clock-outline',
  Help: 'help-circle-outline',
  Profile: 'account-circle-outline',
  Queue: 'clipboard-check-outline',
  Profiles: 'account-check-outline',
  History: 'history',
  Account: 'account-circle-outline',
};

interface GlassTabBarProps extends BottomTabBarProps {
  variant?: 'artisan' | 'coordinator';
}

export default function GlassTabBar({
  state,
  descriptors,
  navigation,
  variant = 'artisan',
}: GlassTabBarProps) {
  const { colors, isDark } = useAppTheme();
  const isCoordinator = variant === 'coordinator';
  const activeColor = isCoordinator ? colors.secondary : colors.primary;

  // Translucent highlight backgrounds — adjusted for dark mode
  const highlightBg = isCoordinator
    ? (isDark ? 'rgba(138, 174, 216, 0.20)' : 'rgba(36, 51, 84, 0.15)')
    : (isDark ? 'rgba(212, 115, 79, 0.22)' : 'rgba(184, 74, 42, 0.16)');

  const highlightBorder = isCoordinator
    ? (isDark ? 'rgba(138, 174, 216, 0.30)' : 'rgba(36, 51, 84, 0.28)')
    : (isDark ? 'rgba(212, 115, 79, 0.30)' : 'rgba(184, 74, 42, 0.25)');

  const glassOverlayBg = isDark
    ? (isCoordinator ? 'rgba(30, 42, 61, 0.50)' : 'rgba(30, 30, 30, 0.50)')
    : (isCoordinator ? 'rgba(238, 242, 249, 0.50)' : 'rgba(255, 255, 255, 0.50)');

  const pillBorderColor = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255,255,255,0.4)';

  const tabWidth = 100 / state.routes.length;
  const translateX = useSharedValue(state.index * tabWidth);

  useEffect(() => {
    translateX.value = withSpring(state.index * tabWidth, {
      damping: 26,
      stiffness: 220,
      mass: 0.8,
    });
  }, [state.index, tabWidth]);

  const highlightStyle = useAnimatedStyle(() => ({
    left: `${translateX.value}%`,
  }));

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <View style={[styles.pillContainer, { borderColor: pillBorderColor }]}>
        <BlurView
          intensity={Platform.OS === 'ios' ? 30 : 60}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.glassOverlay, { backgroundColor: glassOverlayBg }]} />

        <Animated.View
          style={[
            { position: 'absolute', top: 0, bottom: 0 },
            { width: `${tabWidth}%` },
            highlightStyle,
          ]}
        >
          <View style={styles.highlightInner}>
            <BlurView
              intensity={Platform.OS === 'ios' ? 30 : 60}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[
                styles.highlightTint,
                { backgroundColor: highlightBg, borderColor: highlightBorder },
              ]}
            />
          </View>
        </Animated.View>

        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const label =
            (options.tabBarLabel as string) ??
            (options.title as string) ??
            route.name;
          const badge = (options as any).tabBarBadge;
          const iconName = ICON_MAP[route.name] || 'circle-outline';

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              onPress={onPress}
              style={styles.tab}
              activeOpacity={0.7}
            >
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons
                  name={iconName as any}
                  size={21}
                  color={isFocused ? activeColor : colors.textMuted}
                />
                {badge != null && (
                  <View style={[styles.badge, { backgroundColor: colors.warningAmber }]}>
                    <Text style={[styles.badgeText, { color: colors.onPrimary }]}>{badge}</Text>
                  </View>
                )}
              </View>
              <Text
                numberOfLines={2}
                adjustsFontSizeToFit={Platform.OS === 'ios'}
                minimumFontScale={0.8}
                maxFontSizeMultiplier={1.1}
                style={[
                  styles.label,
                  { color: isFocused ? activeColor : colors.textMuted },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 24 : 16,
    left: 6,
    right: 6,
  },
  pillContainer: {
    flexDirection: 'row',
    width: '100%',
    height: 68,
    borderRadius: 34,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  glassOverlay: {
    ...StyleSheet.absoluteFill,
  },
  highlightInner: {
    flex: 1,
    marginHorizontal: 3,
    marginVertical: 5,
    borderRadius: 28,
    overflow: 'hidden',
  },
  highlightTint: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    borderRadius: 28,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  iconWrap: {
    position: 'relative',
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  label: {
    fontSize: Platform.OS === 'ios' ? 9.5 : 8.2,
    fontWeight: Platform.OS === 'ios' ? '600' : '500',
    textAlign: 'center',
    width: '100%',
    letterSpacing: -0.2,
    includeFontPadding: false,
    paddingHorizontal: 1,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
});
