import React, { useMemo } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme, spacing, typography } from '../../theme';
import type { ColorPalette } from '../../theme';
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
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const status: ProfileStatus = profile?.profile_status || 'incomplete';

  const getStatusInfo = () => {
    switch (status) {
      case 'verified':
        return {
          title: t('statusModal.verified.title'),
          subtitle: t('statusModal.verified.subtitle', {
            level: profile?.verified_skill_level
              ? t(`skillLevels.${profile.verified_skill_level}`, { defaultValue: profile.verified_skill_level.replace(/_/g, ' ') })
              : t('skillLevels.skilled'),
          }),
          desc: t('statusModal.verified.desc'),
          icon: 'shield-check' as const,
          color: colors.secondary,
          bgColor: colors.indigoLight,
        };
      case 'pending_verification':
        return {
          title: t('statusModal.pending.title'),
          subtitle: t('statusModal.pending.subtitle'),
          desc: t('statusModal.pending.desc'),
          icon: 'clock-outline' as const,
          color: colors.warningText,
          bgColor: colors.warningLight,
        };
      case 'rejected':
        return {
          title: t('statusModal.rejected.title'),
          subtitle: t('statusModal.rejected.subtitle'),
          desc: t('statusModal.rejected.desc'),
          icon: 'alert-circle-outline' as const,
          color: colors.error,
          bgColor: colors.errorLight,
        };
      default:
        return {
          title: t('statusModal.incomplete.title'),
          subtitle: t('statusModal.incomplete.subtitle'),
          desc: t('statusModal.incomplete.desc'),
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
              {t('statusModal.statutoryNote')}
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
            {t('statusModal.gotIt')}
          </Button>
        </View>
      </View>
    </Modal>
  );
};

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
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
      shadowColor: colors.shadow,
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
      backgroundColor: colors.primaryLight,
      borderWidth: 1,
      borderColor: colors.border,
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
}
