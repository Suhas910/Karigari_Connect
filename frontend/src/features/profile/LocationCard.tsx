import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme, spacing } from '../../theme';
import type { ColorPalette } from '../../theme';

interface LocationCardProps {
  stateName: string;
  zoneName: string;
  zoneNote: string;
  isConfigured?: boolean;
  onPress: () => void;
}

export const LocationCard: React.FC<LocationCardProps> = ({
  stateName,
  zoneName,
  zoneNote,
  isConfigured = true,
  onPress,
}) => {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t('profile.locationA11y', { state: stateName, zone: zoneName })}
    >
      {/* Pin icon in rounded terracotta square */}
      <View style={styles.iconSquare}>
        <MaterialCommunityIcons name="map-marker-outline" size={22} color={colors.primary} />
      </View>

      {/* State + Zone and Subtitle */}
      <View style={styles.textStack}>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {stateName} · {zoneName}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
          {zoneNote || t('profile.jurisdictionNote')}
        </Text>
      </View>

      {/* Right-aligned Chevron */}
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
};

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 3,
      elevation: 2,
    },
    iconSquare: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.primaryLight,
      borderWidth: 1,
      borderColor: colors.border,
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
  });
}
