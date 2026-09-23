// src/features/coordinator-review/ProfileQueueScreen.tsx
import React, { useState, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Text, Button, IconButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { service } from '../../services';
import { useAppTheme, spacing } from '../../theme';
import type { ColorPalette } from '../../theme';
import { ProcessingIndicator, ErrorRetryCard } from '../../components';
import { formatSkillTier, formatIdProof } from './formatters';
import type { ArtisanProfile } from '../../types/contracts';

export default function ProfileQueueScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [adjustedTiers, setAdjustedTiers] = useState<Record<number, string>>({});
  const [profileActionLoading, setProfileActionLoading] = useState<Record<number, boolean>>({});
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);

  const { data: pendingProfiles, isLoading: isFetchingProfiles, isError: isProfilesError, error: profilesError, refetch: refetchProfiles } = useQuery({
    queryKey: ['pendingArtisanProfiles'],
    queryFn: () => service.getPendingArtisanProfiles(),
    retry: 1,
    staleTime: 10000,
  });

  const handleVerifyProfile = async (userId: number, declaredTier?: string | null) => {
    setProfileFeedback(null);
    const tierToVerify = adjustedTiers[userId] || declaredTier;
    if (!tierToVerify) {
      setProfileFeedback('Please select a statutory skill tier before verifying this profile.');
      return;
    }
    setProfileActionLoading((prev) => ({ ...prev, [userId]: true }));
    try {
      await service.reviewArtisanProfile(userId, { decision: 'verified', verified_skill_level: tierToVerify });
      setProfileFeedback(`Artisan #${userId} verified at ${formatSkillTier(tierToVerify)}.`);
      await refetchProfiles();
    } catch (err: any) {
      setProfileFeedback('Failed to verify profile.');
    } finally {
      setProfileActionLoading((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleRejectProfile = async (userId: number) => {
    setProfileFeedback(null);
    setProfileActionLoading((prev) => ({ ...prev, [userId]: true }));
    try {
      await service.reviewArtisanProfile(userId, { decision: 'rejected', reason: 'Coordinator rejected profile claims' });
      setProfileFeedback(`Artisan #${userId} profile rejected.`);
      await refetchProfiles();
    } catch (err: any) {
      setProfileFeedback('Failed to reject profile.');
    } finally {
      setProfileActionLoading((prev) => ({ ...prev, [userId]: false }));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.kicker}>{t('coordinator.profiles.kicker', 'VERIFICATION QUEUE')}</Text>
        <Text style={styles.title}>{t('coordinator.profiles.title', 'Artisan Identity & Skills')}</Text>
        <Text style={styles.subtitle}>{t('coordinator.profiles.subtitle', 'Verify government ID credentials to establish legally protected wage floors across all crafts.')}</Text>
      </View>

      {profileFeedback && (
        <View style={styles.profileFeedbackBanner}>
          <Text style={styles.profileFeedbackText}>{profileFeedback}</Text>
        </View>
      )}

      {isFetchingProfiles ? (
        <ProcessingIndicator hint="Fetching artisan profile verification queue..." />
      ) : isProfilesError ? (
        <ErrorRetryCard errorText={(profilesError as any)?.message || 'Failed to load artisan profiles queue.'} onRetry={() => refetchProfiles()} asCard style={{ marginTop: spacing.md }} />
      ) : !pendingProfiles || pendingProfiles.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconCircle}><IconButton icon="account-check-outline" size={36} iconColor={colors.secondary} style={{ margin: 0 }} /></View>
          <Text style={styles.emptyCardTitle}>{t('coordinator.profiles.emptyTitle', 'All Artisan Profiles Verified')}</Text>
          <Button mode="outlined" onPress={() => refetchProfiles()} style={{ borderRadius: 8 }} textColor={colors.secondary} icon="refresh">Refresh Profiles Queue</Button>
        </View>
      ) : (
        pendingProfiles.map((p: ArtisanProfile) => {
          const currentSelectedTier = adjustedTiers[p.user_id] || p.declared_skill_level;
          const isProcessing = profileActionLoading[p.user_id];
          const fullName = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') || p.username || `Artisan #${p.user_id}`;

          return (
            <View key={p.user_id} style={styles.profileCard}>
              <View style={styles.profileCardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileArtisanName}>{fullName}</Text>
                  <Text style={styles.profileArtisanMeta}>ID #{p.user_id}</Text>
                </View>
              </View>

              <View style={styles.profileSectionBlock}>
                <Text style={styles.profileSectionHeader}>{t('coordinator.profiles.personalSection', 'Personal & Jurisdiction')}</Text>
              </View>
              <View style={styles.profileSectionBlock}>
                <Text style={styles.profileSectionHeader}>{t('coordinator.profiles.businessSection', 'Business & Workshop Profile')}</Text>
              </View>
              <View style={styles.profileSectionBlock}>
                <Text style={styles.profileSectionHeader}>{t('coordinator.profiles.idSection', 'Statutory ID & Tax Registrations')}</Text>
              </View>

              <View style={styles.adjustTierContainer}>
                <Text style={styles.adjustTierLabel}>{t('coordinator.profiles.skillSection', 'Statutory Skill Determination:')}</Text>
                <View style={styles.tierChipsRow}>
                  {(['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'] as const).map((tierKey) => (
                    <TouchableOpacity key={tierKey} onPress={() => setAdjustedTiers((prev) => ({ ...prev, [p.user_id]: tierKey }))} style={[styles.tierChip, currentSelectedTier === tierKey && styles.tierChipActive]}>
                      <Text style={[styles.tierChipText, currentSelectedTier === tierKey && styles.tierChipTextActive]}>{tierKey}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.profileActionRow}>
                <Button mode="contained" onPress={() => handleVerifyProfile(p.user_id, p.declared_skill_level)} buttonColor={colors.secondary} loading={isProcessing} style={styles.profileActionBtn}>{t('coordinator.profiles.verifyBtn', 'Verify Profile')}</Button>
                <Button mode="outlined" onPress={() => handleRejectProfile(p.user_id)} textColor={colors.error} loading={isProcessing} style={[styles.profileActionBtn, { borderColor: colors.error }]}>{t('coordinator.profiles.rejectBtn', 'Reject')}</Button>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    container: { padding: spacing.lg, paddingBottom: 100, backgroundColor: colors.background, flexGrow: 1 },
    header: { marginBottom: spacing.lg },
    kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: colors.textMuted, marginBottom: 4 },
    title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
    subtitle: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
    profileFeedbackBanner: { backgroundColor: colors.indigoLight, borderWidth: 1, borderColor: colors.indigoBorder, borderRadius: 8, padding: 12, marginBottom: spacing.md },
    profileFeedbackText: { color: colors.secondary, fontSize: 13, fontWeight: '600' },
    emptyCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.xl, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
    emptyIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.badgeNeutral, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
    emptyCardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: spacing.lg },
    profileCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md, elevation: 1 },
    profileCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
    profileArtisanName: { fontSize: 16, fontWeight: '800', color: colors.text },
    profileArtisanMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    profileSectionBlock: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
    profileSectionHeader: { fontSize: 11, fontWeight: '800', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
    adjustTierContainer: { marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
    adjustTierLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginBottom: 6 },
    tierChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tierChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    tierChipActive: { backgroundColor: colors.secondary, borderColor: colors.secondary },
    tierChipText: { fontSize: 11, fontWeight: '600', color: colors.text },
    tierChipTextActive: { color: colors.onPrimary },
    profileActionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    profileActionBtn: { flex: 1, borderRadius: 8 },
  });
}