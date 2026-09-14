// src/features/coordinator-review/CoordinatorReviewScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Keyboard, type LayoutChangeEvent } from 'react-native';
import { Text, Button, TextInput } from 'react-native-paper';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { CoordinatorStackParamList } from '../../types/navigation';
import { colors, spacing } from '../../theme';
import { service } from '../../services';
import { apiErrorOf } from '../../services/api';
import { BottomDock, ErrorRetryCard, ProcessingIndicator } from '../../components';
import MediaImage from '../../components/MediaImage';

const toWords = (id?: string | null) => (id ?? '').replace(/_/g, ' ');
const rupees = (paise?: number | null) =>
  paise == null ? '—' : `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

const STATE_LABEL: Record<string, string> = {
  awaiting_approval: 'Awaiting your review',
  approved: 'Approved',
  rejected: 'Sent back to the artisan',
};

export default function CoordinatorReviewScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CoordinatorStackParamList>>();
  const route = useRoute<RouteProp<CoordinatorStackParamList, 'ListingReview'>>();
  const { listingId } = route.params;
  const headerHeight = useHeaderHeight();

  const scrollViewRef = useRef<ScrollView>(null);
  const inputOffsets = useRef<Record<string, number>>({});
  const activeInputRef = useRef<string | null>(null);
  const [keyboardSpace, setKeyboardSpace] = useState(0);

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [listingReason, setListingReason] = useState('');
  const [busyClaim, setBusyClaim] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const listingQuery = useQuery({ queryKey: ['listing', listingId], queryFn: () => service.getListing(listingId) });
  const readinessQuery = useQuery({ queryKey: ['readiness', listingId], queryFn: () => service.getReadiness(listingId) });

  const scrollToInput = (key: string | null) => {
    if (!key) return;
    const y = inputOffsets.current[key];
    if (typeof y === 'number') {
      scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
    }
  };

  useEffect(() => {
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      setKeyboardSpace(e.endCoordinates?.height || 300);
      if (activeInputRef.current) {
        const key = activeInputRef.current;
        setTimeout(() => scrollToInput(key), 50);
        setTimeout(() => scrollToInput(key), 180);
      }
    });
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setKeyboardSpace(0)
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
    setTimeout(() => scrollToInput(key), 100);
    setTimeout(() => scrollToInput(key), 300);
  };

  const refresh = async () => {
    await Promise.all([listingQuery.refetch(), readinessQuery.refetch()]);
  };

  if (listingQuery.isLoading) {
    return <ProcessingIndicator hint="Loading the listing..." />;
  }
  if (listingQuery.isError || !listingQuery.data) {
    return <ErrorRetryCard errorText="Could not load this listing." onRetry={() => listingQuery.refetch()} />;
  }

  const listing = listingQuery.data;
  const cat = listing.catalogue?.catalogue ?? null;
  const price = listing.price;
  const approveProblems = readinessQuery.data?.approve ?? [];
  const awaiting = listing.state === 'awaiting_approval';
  const assertedClaims = listing.claims.filter((c) => c.asserted_by_artisan);
  const unassertedClaims = listing.claims.filter((c) => !c.asserted_by_artisan);
  const photos = listing.media.filter((m) => m.kind === 'image');
  const isDemoCatalogue = cat?.source?.catalogue_provider === 'fixture';
  const isDemoTranscript = cat?.source?.asr_provider === 'fixture';
  const isDemoRate = !!price?.wage_source?.source_url?.startsWith('unsourced://');
  const canApprove = awaiting && !readinessQuery.isLoading && approveProblems.length === 0 && !deciding;

  const decideClaim = async (claim: string, decision: 'verified' | 'rejected') => {
    const note = (notes[claim] ?? '').trim();
    if (!note) {
      setActionError(
        decision === 'verified'
          ? 'Write down the evidence you checked before verifying the claim.'
          : 'Write down why you are rejecting the claim.'
      );
      return;
    }
    setActionError(null);
    setBusyClaim(claim);
    try {
      await service.reviewClaim(listingId, claim, {
        decision,
        evidence_note: note,
        reason: decision === 'rejected' ? note : null,
      });
      await refresh();
    } catch (err) {
      setActionError(apiErrorOf(err)?.message ?? 'Could not save the claim decision. Check connection and try again.');
    } finally {
      setBusyClaim(null);
    }
  };

  const decideListing = async (decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && !listingReason.trim()) {
      setActionError('Write a reason the artisan can act on before sending the listing back.');
      return;
    }
    setActionError(null);
    setDeciding(true);
    try {
      await service.decideApproval(listingId, { decision, reason: listingReason.trim() });
      await refresh();
    } catch (err) {
      setActionError(apiErrorOf(err)?.message ?? 'Could not submit the decision. Check connection and try again.');
    } finally {
      setDeciding(false);
    }
  };

  const detailRows: [string, string][] = [
    ['Category', toWords(cat?.category) || '—'],
    ['Materials', (cat?.materials ?? []).map(toWords).join(', ') || '—'],
    ['Techniques', (cat?.techniques ?? []).map(toWords).join(', ') || '—'],
    ['Finish', toWords(cat?.finish) || '—'],
    ['Hours to make', cat?.labour?.hours != null ? String(cat.labour.hours) : '—'],
    ['Skill level', toWords(cat?.labour?.skill_level) || '—'],
    ['State', cat?.labour?.state_code || '—'],
    ['Material cost', rupees(cat?.material_cost_paise)],
  ];

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[styles.container, { paddingBottom: keyboardSpace > 0 ? keyboardSpace + 160 : 200 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.kicker}>{STATE_LABEL[listing.state] ?? toWords(listing.state)}</Text>
          <Text style={styles.title}>{cat?.title?.en || 'Untitled listing'}</Text>
          {cat?.title?.local ? <Text style={styles.subtitle}>{cat.title.local}</Text> : null}
        </View>

        {(isDemoCatalogue || isDemoTranscript) && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningBannerText}>
              {isDemoCatalogue
                ? 'Demo details: this catalogue was not made from the artisan’s description.'
                : 'Demo transcript: the artisan’s recording was not listened to.'}
            </Text>
          </View>
        )}

        {photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
            {photos.map((photo) => (
              <View key={photo.id} style={styles.photoCard}>
                <MediaImage url={photo.url} style={styles.photo} />
                <Text style={styles.photoLabel}>{photo.variant === 'enhanced' ? 'Cleaned copy' : 'Original'}</Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.muted}>No photo was uploaded.</Text>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Details</Text>
          {cat ? (
            <>
              {detailRows.map(([label, value]) => (
                <View key={label} style={styles.row}>
                  <Text style={styles.rowLabel}>{label}</Text>
                  <Text style={styles.rowValue}>{value}</Text>
                </View>
              ))}
              {cat.description?.en ? <Text style={styles.description}>{cat.description.en}</Text> : null}
            </>
          ) : (
            <Text style={styles.muted}>The artisan has not confirmed any details yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Price</Text>
          {price?.status === 'available' ? (
            <>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Wage floor</Text>
                <Text style={styles.rowValue}>{rupees(price.floor_amount_paise)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Recommended band</Text>
                <Text style={styles.rowValue}>
                  {rupees(price.recommended_low_paise)} – {rupees(price.recommended_high_paise)}
                </Text>
              </View>
              {price.wage_source && (
                <Text style={isDemoRate ? styles.warningText : styles.muted}>
                  Wage source: {price.wage_source.notification_ref}
                  {isDemoRate ? ' (demonstration rate, not a government notification)' : ''}
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.warningText}>
              No price with a wage floor yet. A listing cannot be approved without one.
            </Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Claims the artisan made</Text>
          <Text style={styles.sectionCaption}>
            A claim reaches buyers only once you verify it with evidence. Rejecting removes it.
          </Text>
        </View>

        {assertedClaims.length === 0 && <Text style={styles.muted}>The artisan made no claims.</Text>}

        {assertedClaims.map((c) => {
          const verified = c.coordinator_verified;
          return (
            <View key={c.claim} style={styles.card} onLayout={(e) => handleInputLayout(c.claim, e)}>
              <View style={styles.claimHeader}>
                <Text style={styles.claimTitle}>{toWords(c.claim)}</Text>
                <Text style={[styles.claimStatus, verified && styles.claimStatusVerified]}>
                  {verified ? 'Verified' : 'To review'}
                </Text>
              </View>
              {verified ? (
                <Text style={styles.muted}>Evidence: {c.evidence_note}</Text>
              ) : (
                <>
                  <TextInput
                    mode="outlined"
                    label="Evidence checked, or reason for rejecting"
                    value={notes[c.claim] ?? ''}
                    onChangeText={(text) => setNotes((prev) => ({ ...prev, [c.claim]: text }))}
                    onFocus={() => handleInputFocus(c.claim)}
                    outlineColor={colors.border}
                    activeOutlineColor={colors.secondary}
                    textColor={colors.text}
                    style={styles.input}
                    disabled={!awaiting}
                  />
                  <View style={styles.claimActions}>
                    <Button
                      mode="contained"
                      onPress={() => decideClaim(c.claim, 'verified')}
                      buttonColor={colors.secondary}
                      textColor="#FFFFFF"
                      style={styles.claimBtn}
                      disabled={!awaiting || busyClaim !== null}
                      loading={busyClaim === c.claim}
                    >
                      Verify
                    </Button>
                    <Button
                      mode="outlined"
                      onPress={() => decideClaim(c.claim, 'rejected')}
                      textColor={colors.error}
                      style={[styles.claimBtn, styles.rejectOutline]}
                      disabled={!awaiting || busyClaim !== null}
                    >
                      Reject
                    </Button>
                  </View>
                </>
              )}
            </View>
          );
        })}

        {unassertedClaims.length > 0 && (
          <Text style={styles.muted}>
            Not said by the artisan, so never shown to buyers: {unassertedClaims.map((c) => toWords(c.claim)).join(', ')}.
          </Text>
        )}

        {awaiting && (
          <View style={styles.card} onLayout={(e) => handleInputLayout('decision', e)}>
            <Text style={styles.sectionTitle}>Decision</Text>
            {readinessQuery.isLoading ? (
              <Text style={styles.muted}>Checking the listing...</Text>
            ) : approveProblems.length === 0 ? (
              <Text style={styles.readyText}>Ready to approve.</Text>
            ) : (
              <>
                <Text style={styles.sectionCaption}>Approval is blocked until these are resolved:</Text>
                {approveProblems.map((problem) => (
                  <Text key={problem} style={styles.problem}>• {problem}</Text>
                ))}
              </>
            )}
            <TextInput
              mode="outlined"
              label="Note for the artisan (required to send back)"
              value={listingReason}
              onChangeText={setListingReason}
              onFocus={() => handleInputFocus('decision')}
              outlineColor={colors.border}
              activeOutlineColor={colors.secondary}
              textColor={colors.text}
              style={styles.input}
              multiline
              numberOfLines={3}
            />
          </View>
        )}

        {actionError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{actionError}</Text>
          </View>
        )}
      </ScrollView>

      {awaiting && (
        <BottomDock>
          <View style={styles.actionRow}>
            <Button
              mode="contained"
              onPress={() => decideListing('approved')}
              buttonColor={colors.secondary}
              textColor="#FFFFFF"
              disabled={!canApprove}
              loading={deciding}
              style={styles.decisionBtn}
              contentStyle={{ height: 48 }}
            >
              Approve
            </Button>
            <Button
              mode="outlined"
              onPress={() => decideListing('rejected')}
              textColor={colors.error}
              disabled={deciding}
              style={[styles.decisionBtn, styles.rejectOutline]}
              contentStyle={{ height: 48 }}
            >
              Send back
            </Button>
          </View>
        </BottomDock>
      )}

      {listing.state === 'approved' && (
        <BottomDock>
          <Button
            mode="contained"
            onPress={() => navigation.navigate('PublishExport', { listingId })}
            buttonColor={colors.secondary}
            textColor="#FFFFFF"
            style={styles.decisionBtn}
            contentStyle={{ height: 48 }}
          >
            Validate for Export
          </Button>
        </BottomDock>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  header: { marginBottom: spacing.md },
  kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase' },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  warningBanner: {
    backgroundColor: colors.badgeNeutral,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
    padding: spacing.sm,
    borderRadius: 4,
    marginBottom: spacing.md,
  },
  warningBannerText: { color: colors.error, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  photoStrip: { gap: spacing.sm, marginBottom: spacing.md },
  photoCard: { alignItems: 'center' },
  photo: { width: 140, height: 140, borderRadius: 8, backgroundColor: colors.badgeNeutral },
  photoLabel: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionHeader: { marginBottom: spacing.sm },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  sectionCaption: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: spacing.md },
  rowLabel: { fontSize: 13, color: colors.textMuted },
  rowValue: { fontSize: 13, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right', textTransform: 'capitalize' },
  description: { fontSize: 13, color: colors.text, lineHeight: 19, marginTop: spacing.sm },
  muted: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginBottom: spacing.sm },
  warningText: { fontSize: 12, color: colors.error, lineHeight: 17, marginTop: spacing.xs },
  claimHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  claimTitle: { fontSize: 15, fontWeight: '700', color: colors.text, textTransform: 'capitalize' },
  claimStatus: { fontSize: 11, fontWeight: '700', color: colors.error },
  claimStatusVerified: { color: colors.secondary },
  input: { backgroundColor: colors.surface, marginBottom: spacing.sm, fontSize: 13 },
  claimActions: { flexDirection: 'row', gap: spacing.sm },
  claimBtn: { flex: 1, borderRadius: 8 },
  rejectOutline: { borderColor: colors.error },
  readyText: { fontSize: 13, color: colors.secondary, fontWeight: '700', marginBottom: spacing.sm },
  problem: { fontSize: 12, color: colors.text, lineHeight: 18 },
  errorBanner: {
    backgroundColor: '#F7EBE8',
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 6,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorBannerText: { fontSize: 12, color: colors.error },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  decisionBtn: { flex: 1, borderRadius: 8, minHeight: spacing.tapTarget, justifyContent: 'center' },
});
