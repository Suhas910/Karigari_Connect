// src/features/coordinator-review/CoordinatorAccountScreen.tsx
import React from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Text, Button, Card, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';

import { useAuthStore } from '../../store/authStore';
import { service, USE_LIVE_BACKEND } from '../../services';
import { colors, spacing } from '../../theme';
import type { SupportMessage } from '../../types/contracts';

export default function CoordinatorAccountScreen() {
  const { userId } = useAuthStore();

  const handleSwitchRole = async () => {
    try {
      await SecureStore.deleteItemAsync('userToken');
      await SecureStore.deleteItemAsync('userRole');
      await SecureStore.deleteItemAsync('userId');
    } catch {}
    useAuthStore.getState().logout();
  };

  const {
    data: supportMessages,
    isLoading: isLoadingMessages,
    isRefetching: isRefetchingMessages,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ['supportMessages'],
    queryFn: () => service.getSupportMessages(),
    retry: 1,
    staleTime: 10000,
  });

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefetchingMessages}
          onRefresh={refetchMessages}
          colors={[colors.secondary]}
        />
      }
    >
      <View style={styles.header}>
        <Text style={styles.kicker}>CLUSTER COORDINATOR</Text>
        <Text style={styles.title}>Account & Overview</Text>
        <Text style={styles.subtitle}>
          Active coordinator session, cluster jurisdiction, and artisan inquiries.
        </Text>
      </View>

      {/* Coordinator Identity Card */}
      <Card style={styles.identityCard}>
        <Card.Content style={styles.identityCardContent}>
          <View style={styles.avatarCircle}>
            <MaterialCommunityIcons name="shield-account" size={32} color={colors.secondary} />
          </View>
          <View style={styles.identityInfo}>
            <View style={styles.identityRow}>
              <Text style={styles.identityName}>Cluster Coordinator</Text>
              <View style={styles.coordinatorBadge}>
                <Text style={styles.coordinatorBadgeText}>Coordinator</Text>
              </View>
            </View>
            <Text style={styles.identitySub}>
              ID: {userId || 'coord_demo'} · MoSJE Field Supervisor
            </Text>
            <Text style={styles.jurisdictionText}>
              Jurisdiction: Karnataka & Uttar Pradesh Handloom Clusters
            </Text>
          </View>
        </Card.Content>
      </Card>

      {/* Account / Session Card */}
      <Card style={styles.sessionCard}>
        <Card.Content>
          <Text style={styles.sessionCardTitle}>Session Management</Text>
          <Text style={styles.sessionCardDesc}>
            To change accounts or switch to artisan capture mode:
          </Text>
          <Button
            mode="outlined"
            onPress={handleSwitchRole}
            textColor={colors.primary}
            style={styles.switchRoleBtn}
            icon="logout-variant"
          >
            Switch Role / Sign Out
          </Button>
        </Card.Content>
      </Card>

      {/* Artisan Support Inquiries Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          Artisan Support Messages ({supportMessages?.length ?? 0})
        </Text>
        <Text style={styles.sectionCaption}>
          Questions and verification assistance requests submitted by artisans in your cluster.
        </Text>
      </View>

      {isLoadingMessages ? (
        <ActivityIndicator size="small" color={colors.secondary} style={{ marginVertical: spacing.lg }} />
      ) : !supportMessages || supportMessages.length === 0 ? (
        <View style={styles.emptyMessagesCard}>
          <MaterialCommunityIcons name="check-all" size={32} color={colors.textMuted} style={{ marginBottom: 8 }} />
          <Text style={styles.emptyMessagesText}>No open support inquiries from artisans.</Text>
        </View>
      ) : (
        supportMessages.map((msg: SupportMessage) => (
          <Card key={msg.id} style={styles.msgCard}>
            <Card.Content>
              <View style={styles.msgHeader}>
                <View style={styles.artisanTag}>
                  <MaterialCommunityIcons name="account-outline" size={14} color={colors.secondary} />
                  <Text style={styles.artisanTagName}>
                    {msg.artisan_name ? `${msg.artisan_name}` : `Artisan #${msg.artisan_id}`}
                  </Text>
                </View>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>{msg.status.toUpperCase()}</Text>
                </View>
              </View>

              {msg.listing_title && (
                <View style={styles.attachedListingRow}>
                  <MaterialCommunityIcons name="tag-outline" size={13} color={colors.primary} />
                  <Text style={styles.attachedListingText}>Craft: {msg.listing_title}</Text>
                </View>
              )}

              <Text style={styles.msgBodyText}>{msg.message}</Text>

              <Text style={styles.msgTime}>
                Received: {msg.created_at ? new Date(msg.created_at).toLocaleString() : 'Recently'}
              </Text>
            </Card.Content>
          </Card>
        ))
      )}

      {/* App Info Footer */}
      <View style={styles.appInfoFooter}>
        <Text style={styles.appInfoTitle}>Karigari Connect · Coordinator Console</Text>
        <Text style={styles.appInfoSub}>Version 1.0.1</Text>
      </View>
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
  identityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    elevation: 2,
  },
  identityCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  avatarCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#E0E7FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  identityInfo: {
    flex: 1,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  identityName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  coordinatorBadge: {
    backgroundColor: colors.indigoLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  coordinatorBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.secondary,
  },
  identitySub: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
  },
  jurisdictionText: {
    fontSize: 11,
    color: colors.secondary,
    fontWeight: '500',
  },
  sessionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  sessionCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  sessionCardDesc: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  switchRoleBtn: {
    borderColor: colors.primary,
    borderRadius: 8,
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
  emptyMessagesCard: {
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMessagesText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  msgCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    elevation: 1,
  },
  msgHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  artisanTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  artisanTagName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  statusPill: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  attachedListingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  attachedListingText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  msgBodyText: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 19,
    marginBottom: 6,
  },
  msgTime: {
    fontSize: 10,
    color: colors.textMuted,
  },
  appInfoFooter: {
    marginTop: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  appInfoTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 2,
  },
  appInfoSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  envPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
  },
  envDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  envText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.text,
  },
});
