// src/features/profile/BusinessDetailsCard.tsx
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '../../theme';

interface BusinessDetailsCardProps {
  businessName: string | null;
  cityState: string | null;
  isConfigured: boolean;
  onPress: () => void;
}

export const BusinessDetailsCard: React.FC<BusinessDetailsCardProps> = ({
  businessName,
  cityState,
  isConfigured,
  onPress,
}) => {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Business details: ${businessName || 'not set'}. Tap to edit.`}
    >
      <View style={styles.iconSquare}>
        <MaterialCommunityIcons name="briefcase-outline" size={22} color={colors.primary} />
      </View>
      <View style={styles.textStack}>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {businessName || 'Business details'}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
          {cityState || (isConfigured ? 'Configured' : 'Tap to add PAN, GST, address')}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  iconSquare: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FAF5F2',
    borderWidth: 1,
    borderColor: '#F3E5E0',
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
