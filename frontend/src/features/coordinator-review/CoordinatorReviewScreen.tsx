// src/features/coordinator-review/CoordinatorReviewScreen.tsx
/**
 * @deprecated This monolithic screen has been split into 4 dedicated tabs in CoordinatorTabs:
 * - Queue: ListingQueueScreen
 * - Profiles: ProfileQueueScreen
 * - History: HistoryScreen
 * - Account: CoordinatorAccountScreen
 * Retained for backwards compatibility and reference.
 */
import React, { useState, useLayoutEffect, useRef, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, Keyboard, type LayoutChangeEvent } from 'react-native';
import { Text, Button, TextInput, IconButton } from 'react-native-paper';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../../store/authStore';
import type { CoordinatorStackParamList } from '../../types/navigation';
import { colors, spacing } from '../../theme';
import type { Claim, Listing, ArtisanProfile } from '../../types/contracts';
import { service, USE_LIVE_BACKEND } from '../../services';
import { ProcessingIndicator, BottomDock, ErrorRetryCard } from '../../components';

export default function CoordinatorReviewScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CoordinatorStackParamList>>();
  const route = useRoute<RouteProp<CoordinatorStackParamList, 'CoordinatorDashboard'>>();
  const headerHeight = useHeaderHeight();

  const isMock = !USE_LIVE_BACKEND;

  // Real DB listings query (only enabled when USE_LIVE_BACKEND is true)
  const {
    data: dbListings,
    isLoading: isFetchingListings,
    isError: isListingsError,
    error: listingsError,
    refetch: refetchListings,
  } = useQuery({
    queryKey: ['coordinatorListings'],
    queryFn: () => service.listListings(),
    enabled: USE_LIVE_BACKEND,
    retry: 1,
    staleTime: 10000,
  });

  // Query pending artisan profile verifications
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

  // Tab selection: 'listings' | 'profiles'
  const [activeTab, setActiveTab] = useState<'listings' | 'profiles'>('listings');
  const hasInitializedTab = useRef(false);

  const [adjustedTiers, setAdjustedTiers] = useState<Record<number, string>>({});
  const [profileActionLoading, setProfileActionLoading] = useState<Record<number, boolean>>({});
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);

  const formatSkillTier = (tier?: string | null) => {
    if (!tier) return 'Not Specified';
    switch (tier) {
      case 'unskilled': return 'Unskilled (Helper)';
      case 'semi_skilled': return 'Semi-Skilled (Apprentice)';
      case 'skilled': return 'Skilled (Artisan)';
      case 'highly_skilled': return 'Highly Skilled (Master Craftsman)';
      default: return tier.replace(/_/g, ' ');
    }
  };

  const formatIdProof = (type?: string | null) => {
    if (!type || type === 'none') return 'None';
    if (type === 'pehchan_card') return 'Pehchan Card';
    if (type === 'pm_vishwakarma') return 'PM Vishwakarma';
    return type.replace(/_/g, ' ');
  };

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
      if (USE_LIVE_BACKEND) {
        await refetchListings();
      }
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
      if (USE_LIVE_BACKEND) {
        await refetchListings();
      }
    } catch (err: any) {
      setProfileFeedback('Failed to reject profile. Please check connection and try again.');
    } finally {
      setProfileActionLoading((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const [selectedListingIndex, setSelectedListingIndex] = useState(0);
  const [showAllListings, setShowAllListings] = useState(false);

  // Filter listings awaiting coordinator approval, or fallback to all listings
  const pendingListings = (dbListings || []).filter((l) => l.state === 'awaiting_approval');
  const displayListings = pendingListings.length > 0 ? pendingListings : (showAllListings ? (dbListings || []) : []);
  const activeListing: Listing | null = isMock
    ? null
    : (displayListings[selectedListingIndex] || displayListings[0] || null);

  const listingId = isMock ? 'mock_listing_123' : (activeListing?.id ?? 'mock_listing_123');

  const pendingListingsCount = pendingListings.length;
  const pendingProfilesCount = pendingProfiles?.length || 0;

  useEffect(() => {
    if (!hasInitializedTab.current && !isFetchingListings && !isFetchingProfiles) {
      if (pendingListingsCount === 0 && pendingProfilesCount > 0) {
        setActiveTab('profiles');
      }
      hasInitializedTab.current = true;
    }
  }, [isFetchingListings, isFetchingProfiles, pendingListingsCount, pendingProfilesCount]);

  const scrollViewRef = useRef<ScrollView>(null);
  const inputOffsets = useRef<Record<string, number>>({});
  const activeInputRef = useRef<string | null>(null);
  const [keyboardSpace, setKeyboardSpace] = useState(0);

  const [loading, setLoading] = useState(false);
  const [evidenceNotes, setEvidenceNotes] = useState<Record<string, string>>({});
  const [claimDecisions, setClaimDecisions] = useState<Record<string, 'verified' | 'rejected'>>({});
  const [listingReason, setListingReason] = useState('');
  const [listingDecisionStatus, setListingDecisionStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');

  // Sync active listing state from DB when active listing changes
  useEffect(() => {
    if (activeListing) {
      setListingDecisionStatus(
        activeListing.state === 'approved'
          ? 'approved'
          : activeListing.state === 'rejected'
          ? 'rejected'
          : 'pending'
      );
      const existingDecisions: Record<string, 'verified' | 'rejected'> = {};
      const existingNotes: Record<string, string> = {};
      (activeListing.claims || []).forEach((c) => {
        if (c.coordinator_verified) {
          existingDecisions[c.claim] = 'verified';
        }
        if (c.evidence_note) {
          existingNotes[c.claim] = c.evidence_note;
        }
      });
      setClaimDecisions(existingDecisions);
      setEvidenceNotes(existingNotes);
    }
  }, [activeListing?.id, activeListing?.state]);

  const scrollToInput = (key: string | null) => {
    if (!key) return;
    const y = inputOffsets.current[key];
    if (typeof y === 'number') {
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, y - 16),
        animated: true,
      });
    }
  };

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        const h = e.endCoordinates?.height || 300;
        setKeyboardSpace(h);
        if (activeInputRef.current) {
          const key = activeInputRef.current;
          setTimeout(() => scrollToInput(key), 50);
          setTimeout(() => scrollToInput(key), 180);
        }
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardSpace(0);
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleInputLayout = (key: string, e: LayoutChangeEvent) => {
    inputOffsets.current[key] = e.nativeEvent.layout.y;
  };

  const handleInputFocus = (key: string) => {
    activeInputRef.current = key;
    scrollToInput(key);
    setTimeout(() => scrollToInput(key), 100);
    setTimeout(() => scrollToInput(key), 250);
    setTimeout(() => scrollToInput(key), 450);
  };

  const handleSwitchRole = async () => {
    try {
      await SecureStore.deleteItemAsync('userToken');
    } catch {}
    useAuthStore.getState().logout();
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={handleSwitchRole}
          style={styles.switchRoleBtn}
          accessibilityRole="button"
          accessibilityLabel="Switch Role"
        >
          <Text style={styles.switchRoleText}>Switch Role</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  // Mock claims used for demo mode (when USE_LIVE_BACKEND = false)
  const mockClaims: Claim[] = [
    { claim: 'handloom_weave', asserted_by_artisan: true, coordinator_verified: false, evidence_note: null },
    { claim: 'natural_dye', asserted_by_artisan: true, coordinator_verified: false, evidence_note: null },
  ];

  // In live backend mode, read real claims from active listing; otherwise use mock
  const activeClaims: Claim[] = isMock ? mockClaims : (activeListing?.claims || []);

  const [claimError, setClaimError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);

  const allClaimsDecided = activeClaims.length === 0 || activeClaims.every((c) => claimDecisions[c.claim]);

  const formatClaimLabel = (raw: string) => {
    if (raw === 'skill_level_master_self_declared') {
      return 'Master Craftsman Tier (Self-Declared)';
    }
    return raw
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const handleClaimDecision = async (claimId: string, decision: 'verified' | 'rejected') => {
    setClaimError(null);
    const prevDecision = claimDecisions[claimId];
    setClaimDecisions((prev) => ({ ...prev, [claimId]: decision }));
    try {
      await service.reviewClaim(listingId, claimId, {
        decision,
        evidence_note: evidenceNotes[claimId] ?? '',
        reason: decision === 'rejected' ? 'Insufficient evidence' : null,
      });
      if (USE_LIVE_BACKEND) {
        await refetchListings();
      }
    } catch (err) {
      // Revert optimistic update on failure
      setClaimDecisions((prev) => {
        const next = { ...prev };
        if (prevDecision) next[claimId] = prevDecision;
        else delete next[claimId];
        return next;
      });
      setClaimError('Could not save claim decision. Check connection and try again.');
    }
  };

  const handleListingDecision = async (decision: 'approved' | 'rejected') => {
    if (decision === 'approved' && !allClaimsDecided) {
      setClaimError('Resolve every claim (Verify or Reject) before approving the listing.');
      return;
    }
    if (decision === 'rejected' && !listingReason.trim()) {
      setReasonError('Reason is required to reject a listing.');
      return;
    }
    setReasonError(null);
    setClaimError(null);
    setLoading(true);
    try {
      await service.decideApproval(listingId, { decision, reason: listingReason });
      setListingDecisionStatus(decision);
      if (USE_LIVE_BACKEND) {
        await refetchListings();
      }
    } catch (err) {
      setClaimError('Could not submit decision. Check connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <ProcessingIndicator hint="Processing coordinator decision..." />;
  }

  const itemTitle = isMock
    ? 'Handcrafted Silk Saree'
    : (activeListing?.catalogue?.catalogue?.title?.en || activeListing?.catalogue?.catalogue?.title?.local || 'Handcrafted Artisan Craft');
  const craftCluster = isMock
    ? 'Varanasi Handloom Guild'
    : (activeListing?.catalogue?.catalogue?.category || 'Craft Cluster');

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[
          styles.container,
          {
            paddingBottom:
              activeTab === 'listings' && activeListing
                ? keyboardSpace > 0
                  ? keyboardSpace + 160
                  : 360
                : keyboardSpace > 0
                ? keyboardSpace + 60
                : 120,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Workstation Header */}
        <View style={styles.header}>
          <Text style={styles.kicker}>COMPLIANCE WORKSTATION</Text>
          <Text style={styles.title}>Coordinator Review</Text>
          <Text style={styles.subtitle}>
            Independent audit of artisan credentials and statutory craft provenance
          </Text>

          {/* Segmented Workstation Tab Bar */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'listings' && styles.tabItemActive]}
              onPress={() => setActiveTab('listings')}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'listings' }}
            >
              <Text style={[styles.tabLabel, activeTab === 'listings' && styles.tabLabelActive]}>
                Craft Listings
              </Text>
              {pendingListingsCount > 0 ? (
                <View style={[styles.tabBadge, activeTab === 'listings' && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, activeTab === 'listings' && styles.tabBadgeTextActive]}>
                    {pendingListingsCount}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'profiles' && styles.tabItemActive]}
              onPress={() => setActiveTab('profiles')}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'profiles' }}
            >
              <Text style={[styles.tabLabel, activeTab === 'profiles' && styles.tabLabelActive]}>
                Artisan Profiles
              </Text>
              {pendingProfilesCount > 0 ? (
                <View style={[styles.tabBadgeAmber, activeTab === 'profiles' && styles.tabBadgeAmberActive]}>
                  <Text style={styles.tabBadgeAmberText}>
                    {pendingProfilesCount}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
        </View>

        {/* TAB 1: ARTISAN PROFILES */}
        {activeTab === 'profiles' && (
          <View style={styles.tabContent}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Artisan Identity & Wage Classification
              </Text>
              <Text style={styles.sectionCaption}>
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
                const isAdjusted = Boolean(adjustedTiers[p.user_id] && p.declared_skill_level && adjustedTiers[p.user_id] !== p.declared_skill_level);
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
                        <Text style={[styles.profileDetailValue, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]}>
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
                              {tierKey === 'unskilled' ? 'Unskilled' : tierKey === 'semi_skilled' ? 'Semi-Skilled' : tierKey === 'skilled' ? 'Skilled' : 'Highly Skilled'}
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
          </View>
        )}

        {/* TAB 2: CRAFT LISTINGS */}
        {activeTab === 'listings' && (
          <View style={styles.tabContent}>
            {USE_LIVE_BACKEND && isFetchingListings ? (
              <ProcessingIndicator hint="Fetching craft listing review queue..." />
            ) : USE_LIVE_BACKEND && isListingsError ? (
              <ErrorRetryCard
                errorText={
                  (listingsError as any)?.response?.data?.error?.message ||
                  (listingsError as any)?.message ||
                  'Failed to load craft listings queue. Please check network connection.'
                }
                onRetry={() => refetchListings()}
                asCard
                style={{ marginTop: spacing.md }}
              />
            ) : !activeListing ? (
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconCircle}>
                  <IconButton icon="clipboard-check-outline" size={36} iconColor={colors.secondary} style={{ margin: 0 }} />
                </View>
                <Text style={styles.emptyCardTitle}>
                  {dbListings && dbListings.length > 0 ? 'All Listings Caught Up' : 'Review Queue Empty'}
                </Text>
                <Text style={styles.emptyCardSubtitle}>
                  {dbListings && dbListings.length > 0
                    ? `There are ${dbListings.length} craft(s) in the database, but none are currently awaiting coordinator approval.`
                    : 'No craft submissions found in the database. When artisans create and submit crafts, they will appear here.'}
                </Text>
                {dbListings && dbListings.length > 0 && !showAllListings && (
                  <Button
                    mode="contained"
                    onPress={() => setShowAllListings(true)}
                    style={[styles.refreshBtn, { marginBottom: spacing.sm }]}
                    buttonColor={colors.secondary}
                  >
                    Inspect In-Progress Crafts ({dbListings.length})
                  </Button>
                )}
                <Button
                  mode="outlined"
                  onPress={() => refetchListings()}
                  style={styles.refreshBtn}
                  textColor={colors.secondary}
                  icon="refresh"
                >
                  Refresh Queue
                </Button>
              </View>
            ) : (
              <>
                {/* Queue Item Selector Strip (if multiple listings available) */}
                {displayListings.length > 1 && (
                  <View style={styles.queueChipContainer}>
                    <Text style={styles.queueChipHeader}>
                      {pendingListings.length > 0 ? 'Review Queue' : 'Craft Listings in DB'} ({displayListings.length})
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.queueChipRow}>
                      {displayListings.map((l, idx) => (
                        <TouchableOpacity
                          key={l.id}
                          onPress={() => {
                            setSelectedListingIndex(idx);
                            setClaimError(null);
                            setReasonError(null);
                          }}
                          style={[
                            styles.queueChip,
                            selectedListingIndex === idx && styles.queueChipActive,
                          ]}
                        >
                          <Text style={[styles.queueChipText, selectedListingIndex === idx && styles.queueChipTextActive]}>
                            {l.catalogue?.catalogue?.title?.en || `Craft #${idx + 1}`} ({l.state})
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Listing Summary Card */}
                <View style={styles.summaryCard}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>ITEM</Text>
                    <Text style={styles.summaryValue}>{itemTitle}</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>CRAFT CLUSTER</Text>
                    <Text style={styles.summaryValue}>{craftCluster}</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>STATUS</Text>
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusBadgeText}>
                        {listingDecisionStatus === 'approved'
                          ? 'Approved'
                          : listingDecisionStatus === 'rejected'
                          ? 'Rejected'
                          : (activeListing?.state ? activeListing.state.replace(/_/g, ' ') : 'Pending Verification')}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Approved State Banner */}
                {listingDecisionStatus === 'approved' && (
                  <View style={styles.approvedCard}>
                    <Text style={styles.approvedTitle}>Listing Approved</Text>
                    <Text style={styles.approvedText}>
                      All sensitive claims have been verified. The catalog entry is signed and ready for marketplace publication.
                    </Text>
                  </View>
                )}

                {/* Sensitive Claims Section */}
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Sensitive Claims</Text>
                  <Text style={styles.sectionCaption}>
                    Statutory certification requires documented verification before marketplace export.
                  </Text>
                </View>

                {claimError && (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorBannerText}>{claimError}</Text>
                  </View>
                )}

                {activeClaims.length === 0 ? (
                  <View style={styles.noClaimsCard}>
                    <IconButton icon="shield-check-outline" size={24} iconColor={colors.secondary} style={{ margin: 0 }} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={styles.noClaimsTitle}>No Statutory Claims Asserted</Text>
                      <Text style={styles.noClaimsSubtitle}>
                        The artisan did not assert sensitive provenance claims (such as GI tags or certified handloom). You can verify craft quality and approve the listing.
                      </Text>
                    </View>
                  </View>
                ) : (
                  activeClaims.map((c) => {
                    const decision = claimDecisions[c.claim];
                    return (
                      <View
                        key={c.claim}
                        style={styles.claimCard}
                        onLayout={(e) => handleInputLayout(c.claim, e)}
                      >
                        <View style={styles.claimHeader}>
                          <View style={styles.claimTag}>
                            <Text style={styles.claimTagText}>CLAIM</Text>
                          </View>
                          <Text style={styles.claimTitle}>{formatClaimLabel(c.claim)}</Text>
                          <View
                            style={[
                              styles.claimStatusBadge,
                              decision === 'verified' && styles.claimStatusVerified,
                              decision === 'rejected' && styles.claimStatusRejected,
                            ]}
                          >
                            <Text
                              style={[
                                styles.claimStatusText,
                                decision === 'verified' && styles.claimStatusTextVerified,
                                decision === 'rejected' && styles.claimStatusTextRejected,
                              ]}
                            >
                              {decision === 'verified' ? 'Verified' : decision === 'rejected' ? 'Rejected' : 'Unreviewed'}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.artisanAssertion}>Asserted by artisan during craft recording.</Text>

                        <TextInput
                          mode="outlined"
                          label="Coordinator Evidence Note"
                          placeholder="e.g. Inspected loom mechanism and verified silk mark tag"
                          value={evidenceNotes[c.claim] || ''}
                          onChangeText={(text) => setEvidenceNotes((prev) => ({ ...prev, [c.claim]: text }))}
                          onFocus={() => handleInputFocus(c.claim)}
                          outlineColor={colors.border}
                          activeOutlineColor={colors.secondary}
                          textColor={colors.text}
                          style={styles.input}
                          theme={{ colors: { background: colors.surface } }}
                        />

                        <View style={styles.claimActionRow}>
                          <Button
                            mode={decision === 'verified' ? 'contained' : 'outlined'}
                            onPress={() => handleClaimDecision(c.claim, 'verified')}
                            buttonColor={decision === 'verified' ? colors.secondary : undefined}
                            textColor={decision === 'verified' ? '#FFFFFF' : colors.secondary}
                            style={[styles.claimBtn, decision !== 'verified' && styles.claimBtnOutlined]}
                          >
                            Verify Claim
                          </Button>
                          <Button
                            mode={decision === 'rejected' ? 'contained' : 'outlined'}
                            onPress={() => handleClaimDecision(c.claim, 'rejected')}
                            buttonColor={decision === 'rejected' ? colors.error : undefined}
                            textColor={decision === 'rejected' ? '#FFFFFF' : colors.error}
                            style={[styles.claimBtn, decision !== 'rejected' && styles.claimBtnRejectOutlined]}
                          >
                            Reject Claim
                          </Button>
                        </View>
                      </View>
                    );
                  })
                )}

                {/* Final Decision Section (visible if not yet approved/rejected) */}
                {listingDecisionStatus === 'pending' && (
                  <View
                    style={styles.decisionCard}
                    onLayout={(e) => handleInputLayout('decision', e)}
                  >
                    <Text style={styles.sectionTitle}>Final Decision</Text>
                    <Text style={styles.sectionCaption}>
                      Decision will be permanently logged against coordinator credentials.
                    </Text>

                    <TextInput
                      mode="outlined"
                      label="Decision Reason / Auditor Notes"
                      placeholder="Required if rejecting listing. Optional otherwise."
                      value={listingReason}
                      onChangeText={setListingReason}
                      onFocus={() => handleInputFocus('decision')}
                      outlineColor={colors.border}
                      activeOutlineColor={colors.secondary}
                      textColor={colors.text}
                      style={styles.input}
                      multiline
                      numberOfLines={3}
                      theme={{ colors: { background: colors.surface } }}
                    />

                    {reasonError && (
                      <View style={styles.errorBanner}>
                        <Text style={styles.errorBannerText}>{reasonError}</Text>
                      </View>
                    )}

                    {!allClaimsDecided && (
                      <View style={styles.instructionBanner}>
                        <Text style={styles.instructionText}>
                          All claims must be individually verified or rejected before approving.
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Docked Action Bar: ONLY on Craft Listings tab and when activeListing exists */}
      {Boolean(activeTab === 'listings' && activeListing && listingDecisionStatus === 'pending') && (
        <BottomDock>
          <View style={styles.actionRow}>
            <Button
              mode="contained"
              onPress={() => handleListingDecision('approved')}
              buttonColor={colors.secondary}
              textColor="#FFFFFF"
              disabled={!allClaimsDecided}
              style={styles.decisionBtn}
              contentStyle={{ height: 48 }}
            >
              Approve Listing
            </Button>
            <Button
              mode="outlined"
              onPress={() => handleListingDecision('rejected')}
              textColor={colors.error}
              style={[styles.decisionBtn, styles.rejectBtn]}
              contentStyle={{ height: 48 }}
            >
              Reject Listing
            </Button>
          </View>
        </BottomDock>
      )}

      {Boolean(activeTab === 'listings' && activeListing && listingDecisionStatus === 'approved') && (
        <BottomDock>
          <Button
            mode="contained"
            onPress={() => navigation.navigate('PublishExport', { listingId })}
            buttonColor={colors.secondary}
            textColor="#FFFFFF"
            style={styles.primaryActionBtn}
            contentStyle={{ height: 48 }}
          >
            Proceed to Marketplace Export
          </Button>
        </BottomDock>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl + 48,
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
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#EEF2F6',
    borderRadius: 10,
    padding: 4,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 8,
  },
  tabItemActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabLabelActive: {
    color: colors.secondary,
    fontWeight: '700',
  },
  tabBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeActive: {
    backgroundColor: colors.secondary,
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  tabBadgeTextActive: {
    color: '#FFFFFF',
  },
  tabBadgeAmber: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeAmberActive: {
    backgroundColor: '#D97706',
  },
  tabBadgeAmberText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  tabContent: {
    marginTop: spacing.sm,
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
  summaryCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: colors.textMuted,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  statusBadge: {
    backgroundColor: colors.badgeNeutral,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  approvedCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.secondary,
    borderRadius: 8,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  approvedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.secondary,
    marginBottom: 4,
  },
  approvedText: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  primaryActionBtn: {
    borderRadius: 8,
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
  },
  sectionHeader: {
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  sectionCaption: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  claimCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  claimHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  claimTag: {
    backgroundColor: colors.badgeNeutral,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  claimTagText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.textMuted,
  },
  claimTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  claimStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: colors.badgeNeutral,
  },
  claimStatusVerified: {
    backgroundColor: '#E8ECF2',
  },
  claimStatusRejected: {
    backgroundColor: '#F7EBE8',
  },
  claimStatusText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  claimStatusTextVerified: {
    color: colors.secondary,
  },
  claimStatusTextRejected: {
    color: colors.error,
  },
  artisanAssertion: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
    fontSize: 13,
  },
  claimActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 4,
  },
  claimBtn: {
    flex: 1,
    borderRadius: 8,
  },
  claimBtnOutlined: {
    borderColor: colors.border,
  },
  claimBtnRejectOutlined: {
    borderColor: colors.border,
  },
  decisionCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  instructionBanner: {
    backgroundColor: colors.badgeNeutral,
    padding: spacing.sm,
    borderRadius: 6,
    marginBottom: spacing.md,
  },
  instructionText: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  errorBanner: {
    backgroundColor: '#F7EBE8',
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 6,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorBannerText: {
    fontSize: 12,
    color: colors.error,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  decisionBtn: {
    flex: 1,
    borderRadius: 8,
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
  },
  rejectBtn: {
    borderColor: colors.error,
  },
  bottomSpacer: {
    height: 40,
  },
  switchRoleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: spacing.sm,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.indigoBorder,
    backgroundColor: colors.indigoLight,
  },
  switchRoleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary,
  },
  emptyQueueContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
    maxWidth: 320,
  },
  refreshBtn: {
    borderRadius: 8,
    borderColor: colors.border,
  },
  queueChipContainer: {
    marginBottom: spacing.md,
  },
  queueChipHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    marginBottom: 6,
  },
  queueChipRow: {
    gap: 8,
    paddingVertical: 2,
  },
  queueChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  queueChipActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  queueChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  queueChipTextActive: {
    color: '#FFFFFF',
  },
  noClaimsCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  noClaimsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  noClaimsSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  profileSection: {
    marginBottom: spacing.lg,
  },
  profileFeedbackBanner: {
    backgroundColor: '#E8ECF2',
    padding: spacing.sm,
    borderRadius: 6,
    marginBottom: spacing.sm,
  },
  profileFeedbackText: {
    fontSize: 12,
    color: colors.secondary,
    fontWeight: '600',
  },
  noProfilesCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  noProfilesTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  noProfilesSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  profileCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  profileCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  profileArtisanName: {
    fontSize: 15,
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
    borderRadius: 4,
  },
  profileStatusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  profileDetailsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.badgeNeutral,
    padding: spacing.sm,
    borderRadius: 6,
  },
  profileDetailCol: {
    flex: 1,
  },
  profileDetailLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.textMuted,
    marginBottom: 2,
  },
  profileDetailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  adjustTierContainer: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  adjustTierLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
  },
  tierChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },
  tierChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
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
    fontWeight: '600',
    color: '#B45309',
    marginTop: 2,
    fontStyle: 'italic',
  },
  profileActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  profileActionBtn: {
    flex: 1,
    borderRadius: 8,
  },
  profileRejectBtn: {
    borderColor: colors.error,
  },
});