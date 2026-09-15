// src/features/profile/SettingsRow.tsx
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '../../theme';

interface SettingsRowProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconBgColor: string;
  iconColor: string;
  title: string;
  subtitle: string;
  badgeText?: string;
  showDivider?: boolean;
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
  onPress,
}) => {
  return (
    <View>
      <TouchableOpacity
        style={styles.row}
        onPress={onPress}
        activeOpacity={0.65}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${subtitle}`}
      >
        {/* Icon in rounded colored square */}
        <View style={[styles.iconSquare, { backgroundColor: iconBgColor }]}>
          <MaterialCommunityIcons name={icon} size={22} color={iconColor} />
        </View>

        {/* Text stack */}
        <View style={styles.textStack}>
          <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
            {subtitle}
          </Text>
        </View>

        {/* Optional Chip + Chevron */}
        <View style={styles.rightContainer}>
          {badgeText ? (
            <View style={styles.badgeChip}>
              <Text style={styles.badgeChipText}>{badgeText}</Text>
            </View>
          ) : null}
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
        </View>
      </TouchableOpacity>

      {showDivider && <View style={styles.divider} />}
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
    color: colors.text,
    letterSpacing: -0.1,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
    marginTop: 2,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeChip: {
    backgroundColor: colors.badgeNeutral,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 42 + spacing.md + (spacing.sm + 4),
  },
});
