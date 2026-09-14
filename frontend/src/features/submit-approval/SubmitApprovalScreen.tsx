// src/features/submit-approval/SubmitApprovalScreen.tsx
import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, Card } from 'react-native-paper';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { ArtisanStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { apiErrorOf } from '../../services/api';
import { colors, spacing } from '../../theme';
import { StepHeader, BottomDock, ProcessingIndicator, ErrorRetryCard } from '../../components';

// The checklist comes from GET /listings/{id}/readiness, the same checks the server runs on
// submit and on approval. It used to be four boxes the artisan ticked by hand, including
// "No unverified sensitive claims pending", and the server checked nothing.
export default function SubmitApprovalScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'SubmitApproval'>>();
  const { draftId } = route.params;

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: readiness, isLoading, isError, refetch } = useQuery({
    queryKey: ['readiness', draftId],
    queryFn: () => service.getReadiness(draftId),
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await service.submitForApproval(draftId);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        apiErrorOf(err)?.message ??
          'Could not submit for review. Check your connection and try again.'
      );
      refetch();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = () => {
    navigation.reset({ index: 0, routes: [{ name: 'MyListings' }] });
  };

  if (submitted) {
    return (
      <View style={styles.submittedContainer}>
        <Card style={styles.submittedCard}>
          <Card.Content>
            <Text variant="titleLarge" style={styles.submittedTitle}>Listing Submitted</Text>
            <Text style={styles.submittedSubtitle}>
              Your cluster coordinator will review this listing. You can track its status on your listings page.
            </Text>
            <Button mode="contained" onPress={handleDone} buttonColor={colors.primary} style={styles.doneBtn}>
              Back to My Listings
            </Button>
          </Card.Content>
        </Card>
      </View>
    );
  }

  if (isLoading) {
    return <ProcessingIndicator hint="Checking your listing..." />;
  }
  if (isError || !readiness) {
    return <ErrorRetryCard errorText="Could not check your listing. Check connection and try again." onRetry={() => refetch()} />;
  }

  const submitProblems = readiness.submit;
  const coordinatorChecks = readiness.approve.filter((problem) => !submitProblems.includes(problem));
  const ready = submitProblems.length === 0;

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
          subtitle="Final check before coordinator review"
        />

        <View style={styles.content}>
          <Card style={styles.card}>
            <Card.Content>
              <Text style={styles.cardHeader}>BEFORE YOU SUBMIT</Text>
              {ready ? (
                <Text style={styles.readyText}>Everything needed to submit is done.</Text>
              ) : (
                submitProblems.map((problem) => (
                  <Text key={problem} style={styles.problem}>• {problem}</Text>
                ))
              )}
            </Card.Content>
          </Card>

          <Card style={styles.card}>
            <Card.Content>
              <Text style={styles.cardHeader}>YOUR COORDINATOR WILL CHECK</Text>
              {coordinatorChecks.length === 0 ? (
                <Text style={styles.muted}>Nothing else is outstanding.</Text>
              ) : (
                coordinatorChecks.map((problem) => (
                  <Text key={problem} style={styles.muted}>• {problem}</Text>
                ))
              )}
            </Card.Content>
          </Card>
        </View>
      </ScrollView>

      <BottomDock>
        {submitError && <Text style={styles.errorText}>{submitError}</Text>}
        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={submitting}
          disabled={!ready || submitting}
          buttonColor={colors.primary}
          style={styles.submitBtn}
          contentStyle={{ height: 48 }}
        >
          {ready ? 'Submit for Coordinator Review' : 'Finish the Steps Above to Submit'}
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 0,
    marginBottom: spacing.md,
  },
  cardHeader: { fontSize: 11, letterSpacing: 0.5, fontWeight: '700', color: colors.textMuted, marginBottom: spacing.sm },
  readyText: { color: colors.secondary, fontSize: 14, fontWeight: '600' },
  problem: { color: colors.text, fontSize: 14, lineHeight: 21 },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  submitBtn: { minHeight: spacing.tapTarget, justifyContent: 'center', borderRadius: 8 },
  errorText: { color: colors.error, textAlign: 'center', marginBottom: spacing.md, fontSize: 13 },
});
