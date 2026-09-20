// src/features/profile/SettingsRow.tsx
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme, spacing } from '../../theme';

interface SettingsRowProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconBgColor: string;
  iconColor: string;
  title: string;
  subtitle: string;
  badgeText?: string;
  showDivider?: boolean;
  /** Optional element rendered on the right side (replaces chevron when provided). */
  rightElement?: React.ReactNode;
  onPress: () => void;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({
  icon,
  iconBgColor,
  iconColor,
  title,
  subtitle,
  badgeText,
  showDivider = true,
  rightElement,
  onPress,
}) => {
  const { colors } = useAppTheme();

  return (
    <View>
      <TouchableOpacity
        style={styles.row}
        onPress={onPress}
        activeOpacity={0.65}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${subtitle}`}
      >
        <View style={[styles.iconSquare, { backgroundColor: iconBgColor }]}>
          <MaterialCommunityIcons name={icon} size={22} color={iconColor} />
        </View>

        <View style={styles.textStack}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1} ellipsizeMode="tail">
            {title}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1} ellipsizeMode="tail">
            {subtitle}
          </Text>
        </View>

        <View style={styles.rightContainer}>
          {badgeText ? (
            <View style={[styles.badgeChip, { backgroundColor: colors.badgeNeutral, borderColor: colors.border }]}>
              <Text style={[styles.badgeChipText, { color: colors.text }]}>{badgeText}</Text>
            </View>
          ) : null}
          {rightElement ?? (
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
          )}
        </View>
      </TouchableOpacity>

      {showDivider && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    minHeight: spacing.tapTarget,
  },
  iconSquare: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textStack: {
    flex: 1,
    marginHorizontal: spacing.sm + 4,
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeChip: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  badgeChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    marginLeft: 42 + spacing.md + (spacing.sm + 4),
  },
});
