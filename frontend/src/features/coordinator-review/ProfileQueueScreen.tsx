// src/features/coordinator-review/ProfileQueueScreen.tsx
import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Text, Button, IconButton } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { service } from '../../services';
import { colors, spacing } from '../../theme';
import { ProcessingIndicator, ErrorRetryCard } from '../../components';
import { formatSkillTier, formatIdProof } from './formatters';

export default function ProfileQueueScreen() {
  const [adjustedTiers, setAdjustedTiers] = useState<Record<number, string>>({});
  const [profileActionLoading, setProfileActionLoading] = useState<Record<number, boolean>>({});
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);

  const {
    data: pendingProfiles,
    isLoading: isFetchingProfiles,
    isError: isProfilesError,
    error: profilesError,
    refetch: refetchProfiles,
  } = useQuery({
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
      await service.reviewArtisanProfile(userId, {
        decision: 'verified',
        verified_skill_level: tierToVerify,
      });
      setProfileFeedback(`Artisan #${userId} verified at ${formatSkillTier(tierToVerify)}.`);
      await refetchProfiles();
    } catch (err: any) {
      setProfileFeedback('Failed to verify profile. Please check connection and try again.');
    } finally {
      setProfileActionLoading((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleRejectProfile = async (userId: number) => {
    setProfileFeedback(null);
    setProfileActionLoading((prev) => ({ ...prev, [userId]: true }));
    try {
      await service.reviewArtisanProfile(userId, {
        decision: 'rejected',
        reason: 'Coordinator rejected profile claims',
      });
      setProfileFeedback(`Artisan #${userId} profile rejected.`);
      await refetchProfiles();
    } catch (err: any) {
      setProfileFeedback('Failed to reject profile. Please check connection and try again.');
    } finally {
      setProfileActionLoading((prev) => ({ ...prev, [userId]: false }));
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.kicker}>VERIFICATION QUEUE</Text>
        <Text style={styles.title}>Artisan Identity & Skills</Text>
        <Text style={styles.subtitle}>
          Verify government ID credentials to establish legally protected wage floors across all crafts.
        </Text>
      </View>

      {profileFeedback && (
        <View style={styles.profileFeedbackBanner}>
          <Text style={styles.profileFeedbackText}>{profileFeedback}</Text>
        </View>
      )}

      {isFetchingProfiles ? (
        <ProcessingIndicator hint="Fetching artisan profile verification queue..." />
      ) : isProfilesError ? (
        <ErrorRetryCard
          errorText={
            (profilesError as any)?.response?.data?.error?.message ||
            (profilesError as any)?.message ||
            'Failed to load artisan profiles queue. Please check network connection.'
          }
          onRetry={() => refetchProfiles()}
          asCard
          style={{ marginTop: spacing.md }}
        />
      ) : !pendingProfiles || pendingProfiles.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconCircle}>
            <IconButton icon="account-check-outline" size={36} iconColor={colors.secondary} style={{ margin: 0 }} />
          </View>
          <Text style={styles.emptyCardTitle}>All Artisan Profiles Verified</Text>
          <Text style={styles.emptyCardSubtitle}>
            There are currently no artisan identity credentials or statutory skill declarations waiting for verification.
          </Text>
          <Button
            mode="outlined"
            onPress={() => refetchProfiles()}
            style={styles.refreshBtn}
            textColor={colors.secondary}
            icon="refresh"
          >
            Refresh Profiles Queue
          </Button>
        </View>
      ) : (
        pendingProfiles.map((p) => {
          const currentSelectedTier = adjustedTiers[p.user_id] || p.declared_skill_level;
          const isProcessing = profileActionLoading[p.user_id];
          const isAdjusted = Boolean(
            adjustedTiers[p.user_id] &&
              p.declared_skill_level &&
              adjustedTiers[p.user_id] !== p.declared_skill_level
          );

          return (
            <View key={p.user_id} style={styles.profileCard}>
              <View style={styles.profileCardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileArtisanName}>{p.username || `Artisan #${p.user_id}`}</Text>
                  <Text style={styles.profileArtisanMeta}>
                    User #{p.user_id} {p.phone_number ? `· ${p.phone_number}` : ''}
                  </Text>
                </View>
                <View style={styles.profileStatusBadge}>
                  <Text style={styles.profileStatusBadgeText}>Pending Verification</Text>
                </View>
              </View>

              <View style={styles.profileDetailsGrid}>
                <View style={styles.profileDetailCol}>
                  <Text style={styles.profileDetailLabel}>DECLARED TIER</Text>
                  <Text style={styles.profileDetailValue}>{formatSkillTier(p.declared_skill_level)}</Text>
                </View>
                <View style={styles.profileDetailCol}>
                  <Text style={styles.profileDetailLabel}>WAGE JURISDICTION</Text>
                  <Text style={styles.profileDetailValue}>{p.declared_zone || 'Not set'}</Text>
                </View>
              </View>

              <View style={[styles.profileDetailsGrid, { marginTop: 8 }]}>
                <View style={styles.profileDetailCol}>
                  <Text style={styles.profileDetailLabel}>GOVT ID PROOF</Text>
                  <Text style={styles.profileDetailValue}>{formatIdProof(p.id_proof_type)}</Text>
                </View>
                <View style={styles.profileDetailCol}>
                  <Text style={styles.profileDetailLabel}>REGISTRATION NUMBER</Text>
                  <Text
                    style={[
                      styles.profileDetailValue,
                      { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
                    ]}
                  >
                    {p.id_proof_number || 'None provided'}
                  </Text>
                </View>
              </View>

              {/* Confirm or Adjust Verified Tier */}
              <View style={styles.adjustTierContainer}>
                <Text style={styles.adjustTierLabel}>Statutory Skill Determination:</Text>
                <View style={styles.tierChipsRow}>
                  {(['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'] as const).map((tierKey) => (
                    <TouchableOpacity
                      key={tierKey}
                      onPress={() => setAdjustedTiers((prev) => ({ ...prev, [p.user_id]: tierKey }))}
                      style={[
                        styles.tierChip,
                        currentSelectedTier === tierKey && styles.tierChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.tierChipText,
                          currentSelectedTier === tierKey && styles.tierChipTextActive,
                        ]}
                      >
                        {tierKey === 'unskilled'
                          ? 'Unskilled'
                          : tierKey === 'semi_skilled'
                          ? 'Semi-Skilled'
                          : tierKey === 'skilled'
                          ? 'Skilled'
                          : 'Highly Skilled'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {isAdjusted ? (
                  <Text style={styles.adjustNotice}>
                    Adjusted from self-declared {formatSkillTier(p.declared_skill_level)}
                  </Text>
                ) : null}
              </View>

              <View style={styles.profileActionRow}>
                <Button
                  mode="contained"
                  onPress={() => handleVerifyProfile(p.user_id, p.declared_skill_level)}
                  buttonColor={colors.secondary}
                  textColor="#FFFFFF"
                  loading={isProcessing}
                  disabled={isProcessing}
                  style={styles.profileActionBtn}
                >
                  Verify Profile
                </Button>
                <Button
                  mode="outlined"
                  onPress={() => handleRejectProfile(p.user_id)}
                  textColor={colors.error}
                  loading={isProcessing}
                  disabled={isProcessing}
                  style={[styles.profileActionBtn, styles.profileRejectBtn]}
                >
                  Reject
                </Button>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingBottom: 100,
    backgroundColor: colors.background,
    flexGrow: 1,
  },
  header: {
    marginBottom: spacing.lg,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.textMuted,
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  profileFeedbackBanner: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    padding: 12,
    marginBottom: spacing.md,
  },
  profileFeedbackText: {
    color: '#1E40AF',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.badgeNeutral,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  emptyCardSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
    maxWidth: 340,
  },
  refreshBtn: {
    borderRadius: 8,
  },
  profileCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    elevation: 1,
  },
  profileCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  profileArtisanName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  profileArtisanMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  profileStatusBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  profileStatusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  profileDetailsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  profileDetailCol: {
    flex: 1,
  },
  profileDetailLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    marginBottom: 2,
  },
  profileDetailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  adjustTierContainer: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  adjustTierLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 6,
  },
  tierChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tierChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tierChipActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  tierChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },
  tierChipTextActive: {
    color: '#FFFFFF',
  },
  adjustNotice: {
    fontSize: 11,
    color: '#D97706',
    fontWeight: '600',
    marginTop: 6,
  },
  profileActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  profileActionBtn: {
    flex: 1,
    borderRadius: 8,
  },
  profileRejectBtn: {
    borderColor: colors.error,
  },
});
