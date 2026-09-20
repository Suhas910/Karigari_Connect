// src/features/coordinator-review/ProfileQueueScreen.tsx
import React, { useState, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Text, Button, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { service } from '../../services';
import { useAppTheme, spacing } from '../../theme';
import type { ColorPalette } from '../../theme';
import { ProcessingIndicator, ErrorRetryCard } from '../../components';
import { formatSkillTier, formatIdProof } from './formatters';
import type { ArtisanProfile } from '../../types/contracts';

export default function ProfileQueueScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
        pendingProfiles.map((p: ArtisanProfile) => {
          const currentSelectedTier = adjustedTiers[p.user_id] || p.declared_skill_level;
          const isProcessing = profileActionLoading[p.user_id];
          const isAdjusted = Boolean(
            adjustedTiers[p.user_id] &&
              p.declared_skill_level &&
              adjustedTiers[p.user_id] !== p.declared_skill_level
          );

          const fullName =
            [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') ||
            p.name_as_per_aadhaar ||
            p.username ||
            `Artisan #${p.user_id}`;

          const addressString = [
            p.business_address_line,
            p.city,
            p.district,
            p.business_state_code,
            p.pincode,
          ]
            .filter(Boolean)
            .join(', ');

          return (
            <View key={p.user_id} style={styles.profileCard}>
              {/* Header */}
              <View style={styles.profileCardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileArtisanName}>{fullName}</Text>
                  <Text style={styles.profileArtisanMeta}>
                    ID #{p.user_id}
                    {p.phone_number ? ` · ${p.phone_number}` : ''}
                    {p.email ? ` · ${p.email}` : ''}
                  </Text>
                </View>
                <View style={styles.profileStatusBadge}>
                  <Text style={styles.profileStatusBadgeText}>Pending Verification</Text>
                </View>
              </View>

              {/* Personal & Jurisdiction */}
              <View style={styles.profileSectionBlock}>
                <Text style={styles.profileSectionHeader}>Personal & Jurisdiction</Text>
                <View style={styles.profileDetailsGrid}>
                  <View style={styles.profileDetailCol}>
                    <Text style={styles.profileDetailLabel}>GENDER</Text>
                    <Text style={styles.profileDetailValue}>
                      {p.gender
                        ? p.gender.charAt(0).toUpperCase() + p.gender.slice(1).replace(/_/g, ' ')
                        : 'Not declared'}
                    </Text>
                  </View>
                  <View style={styles.profileDetailCol}>
                    <Text style={styles.profileDetailLabel}>WAGE JURISDICTION</Text>
                    <Text style={styles.profileDetailValue}>{p.declared_zone || 'Not set'}</Text>
                  </View>
                </View>
              </View>

              {/* Business & Workshop Details */}
              <View style={styles.profileSectionBlock}>
                <Text style={styles.profileSectionHeader}>Business & Workshop Profile</Text>
                <View style={styles.profileDetailsGrid}>
                  <View style={styles.profileDetailCol}>
                    <Text style={styles.profileDetailLabel}>BUSINESS / BRAND</Text>
                    <Text style={styles.profileDetailValue}>
                      {p.business_name || p.brand_name || 'Individual Craftsperson'}
                    </Text>
                  </View>
                  <View style={styles.profileDetailCol}>
                    <Text style={styles.profileDetailLabel}>ESTABLISHMENT</Text>
                    <Text style={styles.profileDetailValue}>
                      {p.establishment_type
                        ? p.establishment_type.replace(/_/g, ' ').toUpperCase()
                        : 'INDIVIDUAL'}
                    </Text>
                  </View>
                </View>

                <View style={[styles.profileDetailsGrid, { marginTop: 8 }]}>
                  <View style={styles.profileDetailCol}>
                    <Text style={styles.profileDetailLabel}>WORKSHOP LOCATION</Text>
                    <Text style={styles.profileDetailValue}>
                      {p.location_type ? p.location_type.toUpperCase() : 'HOME WORKSHOP'}
                    </Text>
                  </View>
                  <View style={styles.profileDetailCol}>
                    <Text style={styles.profileDetailLabel}>PICKUP SCHEDULE</Text>
                    <Text style={styles.profileDetailValue}>
                      {p.pickup_days && p.pickup_days.length > 0
                        ? p.pickup_days.join(', ')
                        : 'Daily Available'}
                    </Text>
                  </View>
                </View>

                {addressString ? (
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.profileDetailLabel}>REGISTERED ADDRESS</Text>
                    <Text style={styles.profileDetailValue}>{addressString}</Text>
                  </View>
                ) : null}
              </View>

              {/* Statutory ID & Tax Registration */}
              <View style={styles.profileSectionBlock}>
                <Text style={styles.profileSectionHeader}>Statutory ID & Tax Registrations</Text>
                <View style={styles.profileDetailsGrid}>
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

                <View style={[styles.profileDetailsGrid, { marginTop: 8 }]}>
                  <View style={styles.profileDetailCol}>
                    <Text style={styles.profileDetailLabel}>GST STATUS</Text>
                    <Text style={styles.profileDetailValue}>
                      {p.gst_registered
                        ? p.gst_number || 'GST Registered'
                        : 'Exempt / Unregistered'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Confirm or Adjust Verified Tier */}
              <View style={styles.adjustTierContainer}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.adjustTierLabel}>Statutory Skill Determination:</Text>
                  <Text style={styles.declaredTag}>
                    Declared: {formatSkillTier(p.declared_skill_level)}
                  </Text>
                </View>
                <View style={styles.tierChipsRow}>
                  {(['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'] as const).map(
                    (tierKey) => (
                      <TouchableOpacity
                        key={tierKey}
                        onPress={() =>
                          setAdjustedTiers((prev) => ({ ...prev, [p.user_id]: tierKey }))
                        }
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
                    )
                  )}
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
                  textColor={colors.onPrimary}
                  loading={isProcessing}
                  disabled={isProcessing}
                  style={styles.profileActionBtn}
                  icon="check-decagram"
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
                  icon="close"
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

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
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
      backgroundColor: colors.indigoLight,
      borderWidth: 1,
      borderColor: colors.indigoBorder,
      borderRadius: 8,
      padding: 12,
      marginBottom: spacing.md,
    },
    profileFeedbackText: {
      color: colors.secondary,
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
      marginBottom: 10,
    },
    profileArtisanName: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.text,
    },
    profileArtisanMeta: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    profileStatusBadge: {
      backgroundColor: colors.warningLight,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    profileStatusBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.warningText,
    },
    profileSectionBlock: {
      marginTop: 10,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    profileSectionHeader: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.secondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 6,
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
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
      lineHeight: 16,
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
    declaredTag: {
      fontSize: 11,
      color: colors.textMuted,
      fontStyle: 'italic',
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
      color: colors.onPrimary,
    },
    adjustNotice: {
      fontSize: 11,
      color: colors.warningAmber,
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
}
