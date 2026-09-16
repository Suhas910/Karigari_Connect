// src/features/coordinator-review/ListingQueueScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  type LayoutChangeEvent,
} from 'react-native';
import { Text, Button, TextInput, IconButton } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useHeaderHeight } from '@react-navigation/elements';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { service, USE_LIVE_BACKEND } from '../../services';
import { colors, spacing } from '../../theme';
import { ProcessingIndicator, ErrorRetryCard } from '../../components';
import type { Claim, Listing } from '../../types/contracts';
import { formatClaimLabel } from './formatters';

export default function ListingQueueScreen() {
  const navigation = useNavigation<any>();
  const headerHeight = useHeaderHeight();
  const isMock = !USE_LIVE_BACKEND;

  // Real DB listings query
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

  const [selectedListingIndex, setSelectedListingIndex] = useState(0);

  // Filter listings awaiting coordinator approval
  const pendingListings = (dbListings || []).filter((l) => l.state === 'awaiting_approval');
  const displayListings = pendingListings;
  const activeListing: Listing | null = isMock
    ? null
    : (displayListings[selectedListingIndex] || displayListings[0] || null);

  const listingId = isMock ? 'mock_listing_123' : (activeListing?.id ?? 'mock_listing_123');

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

  const mockClaims: Claim[] = [
    { claim: 'handloom_weave', asserted_by_artisan: true, coordinator_verified: false, evidence_note: null },
    { claim: 'natural_dye', asserted_by_artisan: true, coordinator_verified: false, evidence_note: null },
  ];

  const activeClaims: Claim[] = isMock ? mockClaims : (activeListing?.claims || []);

  const [claimError, setClaimError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);

  const allClaimsDecided = activeClaims.length === 0 || activeClaims.every((c) => claimDecisions[c.claim]);

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
              keyboardSpace > 0
                ? keyboardSpace + 80
                : 120,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.kicker}>CLUSTER COORDINATOR</Text>
          <Text style={styles.title}>Craft Review Queue</Text>
          <Text style={styles.subtitle}>
            Audit artisan claims, verify evidence, and approve listings for marketplace export.
          </Text>
        </View>

        {claimError && (
          <View style={styles.claimErrorBanner}>
            <Text style={styles.claimErrorText}>{claimError}</Text>
          </View>
        )}

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
            <Text style={styles.emptyCardTitle}>All Listings Caught Up</Text>
            <Text style={styles.emptyCardSubtitle}>
              {dbListings && dbListings.length > 0
                ? `There are ${dbListings.length} craft(s) in the database, but none are currently awaiting coordinator approval.`
                : 'No craft submissions waiting in the queue. New submissions from artisans will appear here.'}
            </Text>
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
                  Awaiting Approval ({displayListings.length})
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
                        {l.catalogue?.catalogue?.title?.en || `Craft #${idx + 1}`}
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
                <Text style={styles.summaryLabel}>CLUSTER</Text>
                <Text style={styles.summaryValue}>{craftCluster.replace(/_/g, ' ')}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>STATUS</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>
                    {activeListing?.state ? activeListing.state.toUpperCase() : 'AWAITING APPROVAL'}
                  </Text>
                </View>
              </View>

              {/* Statutory Wage Protected Price Floor */}
              {activeListing?.price && (
                <>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>WAGE FLOOR</Text>
                    <Text style={[styles.summaryValue, { color: colors.primary, fontWeight: '700' }]}>
                      ₹{Math.round(activeListing.price.floor_amount_paise / 100)}
                    </Text>
                  </View>
                  {activeListing.price.wage_source && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>STATE NOTIFICATION</Text>
                      <Text style={[styles.summaryValue, { fontSize: 11, maxWidth: '60%' }]} numberOfLines={1}>
                        {activeListing.price.wage_source.notification_ref}
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>

            {/* If listing is already approved */}
            {listingDecisionStatus === 'approved' && (
              <View style={styles.approvedCard}>
                <Text style={styles.approvedTitle}>Listing Approved</Text>
                <Text style={styles.approvedText}>
                  All statutory claims verified and minimum wage compliance checked. Ready to export to ONDC.
                </Text>
              </View>
            )}

            {/* Claims Review Section */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Statutory Provenance Claims</Text>
              <Text style={styles.sectionCaption}>
                Verify individual GI Tag, handloom weave, and natural dye assertions with audit notes.
              </Text>
            </View>

            {activeClaims.length === 0 ? (
              <View style={styles.emptyClaimsCard}>
                <Text style={styles.emptyClaimsText}>No statutory provenance claims asserted on this craft.</Text>
              </View>
            ) : (
              activeClaims.map((c) => {
                const decision = claimDecisions[c.claim];
                const note = evidenceNotes[c.claim] ?? '';
                const inputKey = `claim_${c.claim}`;
                return (
                  <View key={c.claim} style={styles.claimCard}>
                    <View style={styles.claimHeader}>
                      <MaterialCommunityIcons
                        name={c.claim === 'gi_tag' ? 'certificate' : 'tag-check'}
                        size={20}
                        color={colors.primary}
                      />
                      <Text style={styles.claimTitle}>{formatClaimLabel(c.claim)}</Text>
                    </View>

                    <Text style={styles.assertedNotice}>Asserted by artisan in catalogue submission</Text>

                    <View
                      style={styles.inputContainer}
                      onLayout={(e) => handleInputLayout(inputKey, e)}
                    >
                      <TextInput
                        mode="outlined"
                        label="Evidence Note / Reference"
                        placeholder="e.g. Master card verified, cluster sample audited"
                        value={note}
                        onChangeText={(txt) => setEvidenceNotes((prev) => ({ ...prev, [c.claim]: txt }))}
                        onFocus={() => handleInputFocus(inputKey)}
                        outlineColor={colors.border}
                        activeOutlineColor={colors.secondary}
                        textColor={colors.text}
                        style={styles.input}
                        theme={{ colors: { background: colors.surface } }}
                      />
                    </View>

                    <View style={styles.claimButtonGroup}>
                      <Button
                        mode={decision === 'verified' ? 'contained' : 'outlined'}
                        onPress={() => handleClaimDecision(c.claim, 'verified')}
                        buttonColor={decision === 'verified' ? colors.secondary : undefined}
                        textColor={decision === 'verified' ? '#FFFFFF' : colors.secondary}
                        style={styles.claimBtn}
                      >
                        Verify Claim
                      </Button>
                      <Button
                        mode={decision === 'rejected' ? 'contained' : 'outlined'}
                        onPress={() => handleClaimDecision(c.claim, 'rejected')}
                        buttonColor={decision === 'rejected' ? colors.error : undefined}
                        textColor={decision === 'rejected' ? '#FFFFFF' : colors.error}
                        style={[styles.claimBtn, styles.rejectBtn]}
                      >
                        Reject Claim
                      </Button>
                    </View>
                  </View>
                );
              })
            )}

            {/* Coordinator Final Decision Form */}
            {listingDecisionStatus === 'pending' && (
              <View
                style={styles.decisionFormContainer}
                onLayout={(e) => handleInputLayout('decision', e)}
              >
                <Text style={styles.decisionFormTitle}>Coordinator Decision Notes</Text>
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

                {/* Final Decision Action Buttons (Inline inside form) */}
                <View style={[styles.actionRow, { marginTop: spacing.md }]}>
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
              </View>
            )}

            {/* Approved State: Proceed to Marketplace Export */}
            {Boolean(activeListing && listingDecisionStatus === 'approved') && (
              <View style={{ marginTop: spacing.md }}>
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
              </View>
            )}
          </>
        )}
      </ScrollView>
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
  claimErrorBanner: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    padding: 10,
    marginBottom: spacing.md,
  },
  claimErrorText: {
    color: colors.error,
    fontSize: 12,
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
  queueChipContainer: {
    marginBottom: spacing.md,
  },
  queueChipHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  queueChipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  queueChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
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
  emptyClaimsCard: {
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  emptyClaimsText: {
    fontSize: 13,
    color: colors.textMuted,
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
  claimTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  assertedNotice: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  inputContainer: {
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    fontSize: 13,
  },
  claimButtonGroup: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  claimBtn: {
    flex: 1,
    borderRadius: 6,
  },
  rejectBtn: {
    borderColor: colors.error,
  },
  decisionFormContainer: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  decisionFormTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    padding: spacing.sm,
    borderRadius: 6,
    marginTop: spacing.sm,
  },
  errorBannerText: {
    fontSize: 12,
    color: colors.error,
    fontWeight: '600',
  },
  instructionBanner: {
    backgroundColor: '#EFF6FF',
    padding: spacing.sm,
    borderRadius: 6,
    marginTop: spacing.sm,
  },
  instructionText: {
    fontSize: 12,
    color: '#1E40AF',
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  decisionBtn: {
    flex: 1,
    borderRadius: 8,
  },
  primaryActionBtn: {
    borderRadius: 8,
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
  },
});
