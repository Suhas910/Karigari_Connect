// src/features/submit-approval/SubmitApprovalScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Button, Checkbox, Card } from 'react-native-paper';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArtisanStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { getDraft, saveDraft } from '../../services/database';
import { colors, spacing } from '../../theme';
import { StepHeader, BottomDock } from '../../components';

// Checklist items mirror the contract's actual gate conditions before awaiting_approval:
// catalogue valid, confirmations done, image accepted, price resolved, claims evidenced.
const CHECKLIST = [
  { key: 'catalogue', label: 'Product details confirmed' },
  { key: 'image', label: 'Photo quality accepted' },
  { key: 'price', label: 'Fair price reviewed' },
  { key: 'claims', label: 'No unverified sensitive claims pending' },
];

interface DraftPayload {
  catalogueConfirmed?: boolean;
  imageAccepted?: boolean;
  priceReviewed?: boolean;
}

export default function SubmitApprovalScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'SubmitApproval'>>();
  const { draftId } = route.params;

  const [draftPayload, setDraftPayload] = useState<DraftPayload>({});
  const [unverifiedClaims, setUnverifiedClaims] = useState<string[]>([]);
  const [checkedState, setCheckedState] = useState<Record<string, boolean>>({
    catalogue: false,
    image: false,
    price: false,
    claims: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!draftId) return;
    (async () => {
      try {
        const draft = await getDraft(draftId);
        const payload = (draft?.payload ?? {}) as DraftPayload & { claimsConfirmed?: boolean };
        setDraftPayload(payload);

        let unverified: string[] = [];
        try {
          const listing = await service.getListing(draftId);
          const claims = listing.claims ?? [];
          unverified = claims
            .filter((c) => c.asserted_by_artisan && !c.coordinator_verified)
            .map((c) => c.claim);
        } catch (err) {
          console.error('Failed to load listing claims', err);
        }
        setUnverifiedClaims(unverified);
        const claimsOk = unverified.length === 0;

        setCheckedState({
          catalogue: Boolean(payload.catalogueConfirmed),
          image: Boolean(payload.imageAccepted),
          price: Boolean(payload.priceReviewed),
          claims: claimsOk,
        });
      } catch (err) {
        console.error('Failed to load draft payload in SubmitApprovalScreen', err);
      }
    })();
  }, [draftId]);

  const handleToggle = async (key: string) => {
    if (key === 'claims' && unverifiedClaims.length > 0) {
      setSubmitError('Statutory claims (such as Master Craftsman tier) require coordinator verification before submission.');
      return;
    }
    setSubmitError(null);
    const newVal = !checkedState[key];
    const updated = { ...checkedState, [key]: newVal };
    setCheckedState(updated);

    try {
      const existing = await getDraft(draftId);
      const payload = { ...(existing?.payload ?? {}) };
      if (key === 'catalogue') payload.catalogueConfirmed = newVal;
      if (key === 'image') payload.imageAccepted = newVal;
      if (key === 'price') payload.priceReviewed = newVal;
      if (key === 'claims') payload.claimsConfirmed = newVal;

      await saveDraft({
        id: draftId,
        listing_id: existing?.listing_id ?? draftId,
        state: existing?.state ?? 'draft',
        preferred_language: existing?.preferred_language ?? 'en',
        payload,
      });
      setDraftPayload(payload);
    } catch (err) {
      console.error('Failed to persist checklist toggle', err);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await service.submitForApproval(draftId);
      setSubmitted(true);
    } catch (err) {
      setSubmitError('Could not submit for review. Some details may still need attention — check your listing and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'MyListings' }],
    });
  };

  if (submitted) {
    return (
      <View style={styles.submittedContainer}>
        <Card style={styles.submittedCard}>
          <Card.Content>
            <Text variant="titleLarge" style={styles.submittedTitle}>Listing Submitted</Text>
            <Text style={styles.submittedSubtitle}>
              Your cluster coordinator will review this listing shortly. You can track its status anytime on your listings page.
            </Text>
            <Button
              mode="contained"
              onPress={handleDone}
              buttonColor={colors.primary}
              style={styles.doneBtn}
            >
              Back to My Listings
            </Button>
          </Card.Content>
        </Card>
      </View>
    );
  }

  const allItemsChecked = CHECKLIST.every((item) => Boolean(checkedState[item.key]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { paddingBottom: 140 }]}
        showsVerticalScrollIndicator={false}
      >
        <StepHeader
          currentStep={5}
          totalSteps={5}
          title="Submit for Approval"
          subtitle="Final verification before coordinator review"
        />

        <View style={styles.content}>
          <Card style={styles.checklistCard}>
            <Card.Content>
              <Text style={styles.checklistHeader}>READINESS CHECKLIST</Text>
              {CHECKLIST.map((item) => {
                const checked = Boolean(checkedState[item.key]);
                return (
                  <TouchableOpacity
                    key={item.key}
                    style={styles.checklistRow}
                    onPress={() => handleToggle(item.key)}
                    activeOpacity={0.7}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                  >
                    <Checkbox
                      status={checked ? 'checked' : 'unchecked'}
                      onPress={() => handleToggle(item.key)}
                      color={colors.secondary}
                    />
                    <Text style={[styles.checklistLabel, checked && styles.checklistLabelDone]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </Card.Content>
          </Card>

          {unverifiedClaims.length > 0 && (
            <Card style={styles.claimWarningCard}>
              <Card.Content>
                <Text style={styles.claimWarningTitle}>STATUTORY CLAIMS PENDING REVIEW</Text>
                <Text style={styles.claimWarningSubtitle}>
                  The following claims require coordinator verification before this listing can be submitted:
                </Text>
                {unverifiedClaims.map((claim) => (
                  <Text key={claim} style={styles.claimWarningItem}>
                    • {claim === 'skill_level_master_self_declared' ? 'Master Craftsman Tier (Self-Declared)' : claim.replace(/_/g, ' ')}
                  </Text>
                ))}
              </Card.Content>
            </Card>
          )}

          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              {allItemsChecked
                ? 'Submitting locks this draft and forwards it to your coordinator review queue.'
                : 'Complete all readiness checklist steps above before submitting for coordinator review.'}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Docked Action Button */}
      <BottomDock>
        {submitError && <Text style={styles.errorText}>{submitError}</Text>}
        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={submitting}
          disabled={!allItemsChecked || submitting}
          buttonColor={colors.primary}
          style={styles.submitBtn}
          contentStyle={{ height: 48 }}
        >
          {allItemsChecked ? 'Submit for Coordinator Review' : 'Complete All Steps to Submit'}
        </Button>
      </BottomDock>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flexGrow: 1, paddingBottom: spacing.xxl },
  content: { paddingHorizontal: spacing.lg },
  submittedContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, backgroundColor: colors.background },
  submittedCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 0,
    padding: spacing.md,
  },
  submittedTitle: { color: colors.text, fontWeight: '700', marginBottom: spacing.xs, textAlign: 'center' },
  submittedSubtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: spacing.xl, textAlign: 'center' },
  doneBtn: { minHeight: spacing.tapTarget, justifyContent: 'center', borderRadius: 8 },
  checklistCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 0,
    marginBottom: spacing.md,
  },
  checklistHeader: {
    fontSize: 11,
    letterSpacing: 0.5,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  checklistRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  checklistLabel: { color: colors.textMuted, flex: 1, fontSize: 14 },
  checklistLabelDone: { color: colors.text, fontWeight: '500' },
  noticeBox: {
    backgroundColor: colors.badgeNeutral,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noticeText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  submitBtn: { minHeight: spacing.tapTarget, justifyContent: 'center', borderRadius: 8 },
  errorText: { color: colors.error, textAlign: 'center', marginBottom: spacing.md, fontSize: 13 },
  claimWarningCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D4CEBF',
    elevation: 0,
    marginBottom: spacing.md,
  },
  claimWarningTitle: {
    fontSize: 11,
    letterSpacing: 0.6,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  claimWarningSubtitle: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 16,
    marginBottom: spacing.xs,
  },
  claimWarningItem: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
    marginTop: 2,
  },
});