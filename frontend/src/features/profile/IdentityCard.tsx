// src/features/profile/IdentityCard.tsx
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../../theme';
import type { ArtisanProfile, ProfileStatus } from '../../types/contracts';

interface IdentityCardProps {
  profile: ArtisanProfile | null;
  onPressInfo: () => void;
}

const STATUS_CONFIG: Record<
  ProfileStatus,
  {
    label: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    bgColor: string;
    textColor: string;
    borderColor: string;
  }
> = {
  verified: {
    label: 'profile.status.verified',
    icon: 'shield-check',
    bgColor: colors.indigoLight,
    textColor: colors.secondary,
    borderColor: colors.indigoBorder,
  },
  pending_verification: {
    label: 'profile.status.pending_verification',
    icon: 'clock-outline',
    bgColor: '#FEF3C7',
    textColor: '#92400E',
    borderColor: '#FDE68A',
  },
  rejected: {
    label: 'profile.status.rejected',
    icon: 'alert-circle-outline',
    bgColor: '#FEE2E2',
    textColor: colors.error,
    borderColor: '#FCA5A5',
  },
  incomplete: {
    label: 'profile.status.incomplete',
    icon: 'account-outline',
    bgColor: colors.badgeNeutral,
    textColor: colors.textMuted,
    borderColor: colors.border,
  },
};

export const IdentityCard: React.FC<IdentityCardProps> = ({ profile, onPressInfo }) => {
  const { t } = useTranslation();
  const status: ProfileStatus = profile?.profile_status || 'incomplete';
  const statusConfig = STATUS_CONFIG[status];

  // Assumption & Constraint Flag:
  // ArtisanProfile currently has `user_id: number`, but no dedicated alphanumeric short ID string like '#KRG-84219'.
  // We format user_id into '#KRG-XXXXX' format for visual fidelity to mockup without modifying schema/backend.
  const shortId = profile?.user_id
    ? `#KRG-${String(profile.user_id).padStart(5, '0')}`
    : '#KRG-00001';

  // Assumption & Constraint Flag:
  // ArtisanProfile stores `role: string` (e.g. 'artisan'), but does not store an artisan-level craft category string.
  // Crafts belong to per-listing catalogues. We present the standard role label in terracotta.
  const roleCraftSubtitle = t('profile.roleSubtitle');

  const username = profile?.username || 'artisan';
  const displayName = profile?.name_as_per_aadhaar?.trim() || username;
  const phoneNumber = profile?.phone_number || t('profile.noMobile');

  return (
    <View style={styles.card}>
      {/* Top row: Avatar, Name & Short ID Badge */}
      <View style={styles.topRow}>
        <View style={styles.avatarCircle}>
          <MaterialCommunityIcons name="account" size={32} color={colors.primary} />
        </View>

        <View style={styles.nameContainer}>
          <Text style={styles.artisanName} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.roleSubtitle} numberOfLines={1}>
            {roleCraftSubtitle}
          </Text>
        </View>

        <View style={styles.idChip}>
          <Text style={styles.idChipText}>{shortId}</Text>
        </View>
      </View>

      {/* Contact Row: Phone + Handle */}
      <View style={styles.contactRow}>
        <MaterialCommunityIcons name="phone-outline" size={14} color={colors.textMuted} />
        <Text style={styles.contactText} numberOfLines={1}>
          {phoneNumber}
        </Text>
        <Text style={styles.contactDot}>•</Text>
        <Text style={styles.handleText} numberOfLines={1}>
          @{username}
        </Text>
      </View>

      {/* Status Pill with Tappable Info Icon */}
      <View
        style={[
          styles.statusPill,
          {
            backgroundColor: statusConfig.bgColor,
            borderColor: statusConfig.borderColor,
          },
        ]}
      >
        <View style={styles.statusLeft}>
          <MaterialCommunityIcons
            name={statusConfig.icon}
            size={16}
            color={statusConfig.textColor}
          />
          <Text
            style={[styles.statusText, { color: statusConfig.textColor }]}
            numberOfLines={1}
          >
            {t(statusConfig.label)}
          </Text>
        </View>

        <TouchableOpacity
          onPress={onPressInfo}
          style={styles.infoButton}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('profile.statusInfoA11y')}
        >
          <MaterialCommunityIcons
            name="information-outline"
            size={18}
            color={statusConfig.textColor}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FAF5F2',
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  artisanName: {
    fontFamily: typography.heading,
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
  },
  roleSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 2,
  },
  idChip: {
    backgroundColor: colors.badgeNeutral,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
  },
  idChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.3,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md - 2,
    gap: 6,
  },
  contactText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  contactDot: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '700',
  },
  handleText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '600',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: spacing.md,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  infoButton: {
    padding: 2,
    marginLeft: 8,
  },
});
