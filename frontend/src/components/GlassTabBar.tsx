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
import { colors } from '../theme';

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
  const isCoordinator = variant === 'coordinator';
  const activeColor = isCoordinator ? colors.secondary : colors.primary;

  const highlightBg = isCoordinator
    ? 'rgba(36, 51, 84, 0.15)' // colors.secondary (#243354)
    : 'rgba(184, 74, 42, 0.16)'; // colors.primary (#B84A2A)

  const highlightBorder = isCoordinator
    ? 'rgba(36, 51, 84, 0.28)'
    : 'rgba(184, 74, 42, 0.25)';

  const glassOverlayBg = isCoordinator
    ? 'rgba(238, 242, 249, 0.50)' // colors.indigoLight (#EEF2F9)
    : 'rgba(255, 255, 255, 0.50)'; // pure white translucent glass

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
      <View style={styles.pillContainer}>
        <BlurView
          intensity={Platform.OS === 'ios' ? 30 : 60}
          tint="light"
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
              tint="light"
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
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                )}
              </View>
              <Text
                numberOfLines={2}
                maxFontSizeMultiplier={1.15}
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
    left: 8,
    right: 8,
    alignItems: 'center',
  },
  pillContainer: {
    flexDirection: 'row',
    width: '100%',
    height: 70,
    borderRadius: 35,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  glassOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
  },
  highlightInner: {
    flex: 1,
    marginHorizontal: 3,
    marginVertical: 5,
    borderRadius: 30,
    overflow: 'hidden',
  },
  highlightTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(193,80,46,0.16)', // colors.primary translucent
    borderWidth: 1,
    borderColor: 'rgba(193,80,46,0.25)',
    borderRadius: 30,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
    paddingHorizontal: 1,
  },
  iconWrap: {
    position: 'relative',
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  label: {
    fontSize: 9.5,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 12.5,
    includeFontPadding: false,
    paddingHorizontal: 0,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#F59E0B',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
  },
});
