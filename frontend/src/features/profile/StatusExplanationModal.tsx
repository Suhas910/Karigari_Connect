// src/features/profile/StatusExplanationModal.tsx
import React from 'react';
import { View, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../../theme';
import type { ArtisanProfile, ProfileStatus } from '../../types/contracts';

interface StatusExplanationModalProps {
  visible: boolean;
  profile: ArtisanProfile | null;
  onDismiss: () => void;
}

export const StatusExplanationModal: React.FC<StatusExplanationModalProps> = ({
  visible,
  profile,
  onDismiss,
}) => {
  const status: ProfileStatus = profile?.profile_status || 'incomplete';

  const getStatusInfo = () => {
    switch (status) {
      case 'verified':
        return {
          title: 'VERIFIED ARTISAN PROFILE',
          subtitle: `Verified at ${profile?.verified_skill_level?.replace(/_/g, ' ') || 'Skilled'} tier.`,
          desc: 'Your identity and craft experience have been verified by your cluster coordinator. All your craft listings automatically unlock legal minimum wage floors without waiting for per-listing claim reviews.',
          icon: 'shield-check' as const,
          color: '#1E40AF',
          bgColor: colors.indigoLight,
        };
      case 'pending_verification':
        return {
          title: 'PENDING COORDINATOR REVIEW',
          subtitle: 'Profile submitted to cluster coordinator',
          desc: 'Your craft experience, jurisdiction, and official ID credentials have been queued for coordinator audit. You can still create drafts and listings in the meantime.',
          icon: 'clock-outline' as const,
          color: '#B45309',
          bgColor: '#FEF3C7',
        };
      case 'rejected':
        return {
          title: 'VERIFICATION REJECTED',
          subtitle: 'Credentials require correction',
          desc: 'Your profile was not approved by the coordinator. Please review your ID registration number or declared skill tier in "Skill Tier & Official ID" and resubmit.',
          icon: 'alert-circle-outline' as const,
          color: colors.error,
          bgColor: '#FEE2E2',
        };
      default:
        return {
          title: 'PROFILE INCOMPLETE',
          subtitle: 'One-time coordinator verification',
          desc: 'Submit your craft skill tier, workshop jurisdiction, and official ID proof once. Once verified, you skip the coordinator claim gate on every craft listing.',
          icon: 'account-outline' as const,
          color: colors.textMuted,
          bgColor: colors.badgeNeutral,
        };
    }
  };

  const info = getStatusInfo();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onDismiss}
        />
        <View style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={[styles.iconBox, { backgroundColor: info.bgColor }]}>
              <MaterialCommunityIcons name={info.icon} size={24} color={info.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: info.color }]}>
                {info.title}
              </Text>
              <Text style={styles.headerSubtitle}>{info.subtitle}</Text>
            </View>
            <TouchableOpacity onPress={onDismiss} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Description */}
          <Text style={styles.descriptionText}>{info.desc}</Text>

          {/* Key benefits / Statutory Info Box */}
          <View style={styles.statutoryBox}>
            <MaterialCommunityIcons name="scale-balance" size={20} color={colors.primary} />
            <Text style={styles.statutoryText}>
              Statutory Protection: Grounded in State Minimum Wages notifications under the Code on Wages 2019 to prevent price suppression on open commerce.
            </Text>
          </View>

          {/* Action Button */}
          <Button
            mode="contained"
            onPress={onDismiss}
            buttonColor={colors.primary}
            style={styles.actionBtn}
            labelStyle={styles.actionBtnLabel}
          >
            Got It
          </Button>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheetContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  descriptionText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
    marginTop: spacing.md,
  },
  statutoryBox: {
    flexDirection: 'row',
    backgroundColor: '#FAF5F2',
    borderWidth: 1,
    borderColor: '#F3E5E0',
    borderRadius: 12,
    padding: 12,
    gap: 10,
    marginTop: spacing.md,
    alignItems: 'flex-start',
  },
  statutoryText: {
    flex: 1,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  actionBtn: {
    marginTop: spacing.lg,
    borderRadius: 12,
  },
  actionBtnLabel: {
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: 2,
  },
});
