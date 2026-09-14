// src/features/publish-export/PublishExportScreen.tsx
import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Button, Switch } from 'react-native-paper';
import { useRoute, useNavigation, useFocusEffect, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import QRCode from 'react-native-qrcode-svg';
import type { CoordinatorStackParamList } from '../../types/navigation';
import { colors, spacing } from '../../theme';
import type { ExportResult } from '../../types/contracts';
import { service } from '../../services';
import { apiErrorOf } from '../../services/api';
import { ErrorRetryCard, ProcessingIndicator, BottomDock } from '../../components';

export default function PublishExportScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<CoordinatorStackParamList>>();
  const route = useRoute<RouteProp<CoordinatorStackParamList, 'PublishExport'>>();
  const { listingId } = route.params;

  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [isVerifyingListing, setIsVerifyingListing] = useState(true);
  const [staleError, setStaleError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showJsonPayload, setShowJsonPayload] = useState(false);
  const [simulateBroadcast, setSimulateBroadcast] = useState(false);

  // ITEM 4: Freshness check on focus.
  // AI_INTERFACE_CONTRACTS.md: Provenance guard must run immediately before export.
  // Re-fetch listing on screen focus to prevent stale client-side state from bypassing approval or claim verification.
  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;
      const verifyFreshness = async () => {
        try {
          setIsVerifyingListing(true);
          setStaleError(null);
          const listing = await service.getListing(listingId);
          if (!isActive) return;

          // If listing is no longer approved, or contains unverified claims, block export
          // Only claims the artisan made need a decision; unasserted ones never reach a buyer.
          const hasUnverifiedClaims = listing.claims?.some((c) => c.asserted_by_artisan && !c.coordinator_verified);
          if (listing.state !== 'approved' && listing.state !== 'exported') {
            setStaleError('Listing status changed — please review again');
          } else if (hasUnverifiedClaims) {
            setStaleError('Listing status changed — please review again');
          }
        } catch (err) {
          if (isActive) {
            setStaleError('Listing status changed — please review again');
          }
        } finally {
          if (isActive) {
            setIsVerifyingListing(false);
          }
        }
      };

      if (!exportResult) {
        verifyFreshness();
      } else {
        setIsVerifyingListing(false);
      }
      return () => {
        isActive = false;
      };
    }, [listingId, exportResult])
  );

  const handleExport = async (overrideSimulation?: boolean) => {
    if (staleError) return;
    const isSimulating = overrideSimulation !== undefined ? overrideSimulation : simulateBroadcast;
    setLoading(true);
    setExportError(null);
    try {
      const res = await service.requestExport(listingId, {
        target: 'ondc_retail',
        schema_version: '1.0.0',
        simulate_network_submission: isSimulating,
      });
      setExportResult(res);
    } catch (err) {
      // Contract: EXPORT_CONTRACT_INVALID -> "show export not ready; do not claim marketplace publication."
      const reason = apiErrorOf(err)?.message;
      setExportError(
        reason
          ? `Export not ready. ${reason}`
          : 'Export not ready. The listing payload did not pass validation — check with coordinator before retrying.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <ProcessingIndicator hint="Validating and signing export payload..." />;
  }

  if (isVerifyingListing && !exportResult && !staleError) {
    return <ProcessingIndicator hint="Verifying listing readiness for export..." />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.kicker}>MARKETPLACE INTEGRATION</Text>
          <Text style={styles.title}>Export Listing</Text>
          <Text style={styles.subtitle}>ID: {listingId} · Target: ONDC Retail Network (v1.0.0)</Text>
        </View>

        {/* Pre-Export Initiation Card */}
        {!exportResult && !exportError && !staleError && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ready for Local Gateway Staging</Text>
              <Text style={styles.cardText}>
                This listing has been verified by the craft coordinator. Proceeding will validate schema conformity against ONDC standards, seal the record with a cryptographic signature, and stage it on the local gateway.
              </Text>
            </View>

            {/* Explicit Demo Simulation Switch Card */}
            <View style={styles.demoControlCard}>
              <View style={styles.demoControlRow}>
                <View style={{ flex: 1, marginRight: spacing.sm }}>
                  <Text style={styles.demoControlTitle}>DEMO BROADCAST SIMULATION</Text>
                  <Text style={styles.demoControlSubtitle}>
                    {simulateBroadcast
                      ? 'Demo Simulation Active: Simulating live ONDC registry broadcast for presentation.'
                      : 'MVP Default: Local gateway staging only. Live ONDC production broadcast is not claimed.'}
                  </Text>
                </View>
                <Switch
                  value={simulateBroadcast}
                  onValueChange={setSimulateBroadcast}
                  color={colors.secondary}
                />
              </View>
            </View>
          </>
        )}

        {/* Stale State / Provenance Guard Error */}
        {staleError && (
          <ErrorRetryCard
            asCard
            errorText={staleError}
            onRetry={() => navigation.goBack()}
            retryLabel="Return to Review"
          />
        )}

      {/* Error State with Retry */}
      {exportError && (
        <ErrorRetryCard
          asCard
          errorText={exportError}
          onRetry={() => handleExport()}
          retryLabel="Retry Export Pipeline"
        />
      )}

      {/* Post-Export Result */}
      {exportResult && (
        <>
          {/* Stepper Pipeline Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Export Pipeline Status</Text>

            {/* Step 1: Schema Validation */}
            <View style={styles.pipelineStep}>
              <View style={styles.stepIndicator}>
                <View style={[styles.stepDot, exportResult.contract_validation.passed ? styles.stepDotSuccess : styles.stepDotPending]} />
                <View style={styles.stepConnector} />
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>1. Schema Validation</Text>
                <Text style={styles.stepMeta}>
                  {exportResult.contract_validation.passed
                    ? `Passed · Conforms to ${exportResult.contract_validation.schema_source}`
                    : 'Validation Failed'}
                </Text>
              </View>
            </View>

            {/* Step 2: Payload Signing */}
            <View style={styles.pipelineStep}>
              <View style={styles.stepIndicator}>
                <View style={[styles.stepDot, exportResult.payload_hash ? styles.stepDotSuccess : styles.stepDotPending]} />
                <View style={styles.stepConnector} />
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>2. Payload Cryptographic Hash</Text>
                <Text style={styles.stepMeta}>
                  SHA-256: {exportResult.payload_hash ? `${exportResult.payload_hash.substring(0, 16)}...` : 'Pending'}
                </Text>
              </View>
            </View>

            {/* Step 3: Network Submission */}
            <View style={styles.pipelineStep}>
              <View style={styles.stepIndicator}>
                <View style={[styles.stepDot, styles.stepDotPending]} />
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>3. ONDC Network Submission</Text>
                <Text style={styles.stepMeta}>
                  {exportResult.network_submission === 'simulated'
                    ? 'Simulated for a demo · Nothing was sent to the ONDC network'
                    : 'Not sent · Validated and staged only'}
                </Text>
              </View>
            </View>
          </View>

          {/* Explicit Demo Simulation Switch on Result */}
          <View style={styles.demoControlCard}>
            <View style={styles.demoControlRow}>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={styles.demoControlTitle}>DEMO BROADCAST SIMULATION</Text>
                <Text style={styles.demoControlSubtitle}>
                  {simulateBroadcast
                    ? 'Showing simulated live ONDC registry broadcast.'
                    : 'MVP Default: Staged locally. Switch on to simulate live registry broadcast.'}
                </Text>
              </View>
              <Switch
                value={simulateBroadcast}
                onValueChange={(val) => {
                  setSimulateBroadcast(val);
                  handleExport(val);
                }}
                color={colors.secondary}
              />
            </View>
          </View>

          {(exportResult.warnings ?? []).length > 0 && (
            <View style={styles.warningsCard}>
              <Text style={styles.cardTitle}>Before this can go live</Text>
              {(exportResult.warnings ?? []).map((warning) => (
                <Text key={warning} style={styles.warningItem}>• {warning}</Text>
              ))}
            </View>
          )}

          {/* Verifiable Provenance QR Code */}
          <View style={styles.qrCard}>
            <Text style={styles.kicker}>DIGITAL PROVENANCE</Text>
            <Text style={styles.qrTitle}>Verifiable Craft Credential</Text>
            <Text style={styles.qrSubtitle}>
              Encodes the listing id and the SHA-256 hash of the validated payload, so a copy of the payload can be matched to this export.
            </Text>

            <View style={styles.qrCodeWrapper}>
              <QRCode
                value={JSON.stringify({
                  listing_id: listingId,
                  target: exportResult.target,
                  hash: exportResult.payload_hash,
                  status: exportResult.status,
                })}
                size={160}
                color={colors.text}
                backgroundColor="#FFFFFF"
              />
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>REGISTRY HASH</Text>
              <Text style={styles.metaValue} numberOfLines={1} ellipsizeMode="middle">
                {exportResult.payload_hash || 'N/A'}
              </Text>
            </View>
          </View>

          {/* Technical JSON Payload Drawer */}
          <View style={styles.jsonCard}>
            <TouchableOpacity
              onPress={() => setShowJsonPayload((prev) => !prev)}
              style={styles.jsonToggleRow}
              accessibilityRole="button"
            >
              <Text style={styles.jsonToggleText}>
                {showJsonPayload ? 'Hide Technical Payload' : 'Inspect Signed JSON Payload'}
              </Text>
              <Text style={styles.jsonToggleIcon}>{showJsonPayload ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {showJsonPayload && (
              <View style={styles.jsonContent}>
                <Text style={styles.jsonCodeText}>
                  {JSON.stringify(
                    {
                      export_id: exportResult.export_id,
                      target: exportResult.target,
                      status: exportResult.status,
                      payload_hash: exportResult.payload_hash,
                      contract_validation: exportResult.contract_validation,
                      network_submission: exportResult.network_submission,
                    },
                    null,
                    2
                  )}
                </Text>
              </View>
            )}
          </View>

        </>
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>

    {/* Docked Action Bar */}
    {!exportResult && !exportError && !staleError && (
      <BottomDock>
        <Button
          mode="contained"
          onPress={() => handleExport()}
          buttonColor={colors.primary}
          textColor="#FFFFFF"
          style={styles.primaryBtn}
          contentStyle={{ height: 48 }}
        >
          {simulateBroadcast ? 'Simulate ONDC Broadcast (Demo)' : 'Validate & Stage for Export'}
        </Button>
      </BottomDock>
    )}

    {exportResult && (
      <BottomDock>
        <Button
          mode="outlined"
          onPress={() => navigation.navigate('ReviewQueue')}
          textColor={colors.secondary}
          style={styles.returnBtn}
          contentStyle={{ height: 48 }}
        >
          Return to Review Queue
        </Button>
      </BottomDock>
    )}
  </View>
);
}

const styles = StyleSheet.create({
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
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  cardText: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
    marginBottom: spacing.lg,
  },
  primaryBtn: {
    borderRadius: 8,
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
  },
  pipelineStep: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  stepIndicator: {
    width: 24,
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  stepDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stepDotSuccess: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  stepDotPending: {
    backgroundColor: colors.badgeNeutral,
    borderColor: colors.border,
  },
  stepConnector: {
    width: 2,
    flex: 1,
    minHeight: 24,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  stepContent: {
    flex: 1,
    paddingBottom: spacing.sm,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  stepMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  warningsCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  warningItem: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  qrCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  qrTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
    marginBottom: 4,
  },
  qrSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  qrCodeWrapper: {
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  metaRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.badgeNeutral,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 6,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
  },
  metaValue: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: colors.text,
    maxWidth: '70%',
  },
  jsonCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  jsonToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  jsonToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.secondary,
  },
  jsonToggleIcon: {
    fontSize: 10,
    color: colors.secondary,
  },
  jsonContent: {
    backgroundColor: colors.badgeNeutral,
    borderRadius: 6,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  jsonCodeText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: colors.text,
    lineHeight: 16,
  },
  returnBtn: {
    borderRadius: 8,
    borderColor: colors.border,
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
  },
  demoControlCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.indigoBorder,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  demoControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  demoControlTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.secondary,
    marginBottom: 3,
  },
  demoControlSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  bottomSpacer: {
    height: 40,
  },
});