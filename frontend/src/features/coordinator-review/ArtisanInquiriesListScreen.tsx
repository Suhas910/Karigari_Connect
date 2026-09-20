// src/features/coordinator-review/ArtisanInquiriesListScreen.tsx
import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Text, Card, ActivityIndicator, Searchbar, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';

import type { CoordinatorStackParamList } from '../../types/navigation';
import type { SupportMessage } from '../../types/contracts';
import { service } from '../../services';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ArtisanInquiriesListScreen() {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const navigation = useNavigation<NativeStackNavigationProp<CoordinatorStackParamList>>();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('all');

  const {
    data: supportMessages,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['supportMessages'],
    queryFn: () => service.getSupportMessages(),
    staleTime: 5000,
  });

  const filteredMessages = useMemo(() => {
    if (!supportMessages) return [];
    return supportMessages.filter((msg) => {
      // Filter by status
      if (statusFilter !== 'all' && msg.status !== statusFilter) {
        return false;
      }
      // Filter by query
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchName = msg.artisan_name?.toLowerCase().includes(q);
      const matchMsg = msg.message?.toLowerCase().includes(q);
      const matchTitle = msg.listing_title?.toLowerCase().includes(q);
      return matchName || matchMsg || matchTitle;
    });
  }, [supportMessages, statusFilter, searchQuery]);

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTitleBox}>
            <Text style={styles.kicker}>CLUSTER SUPPORT QUEUE</Text>
            <Text style={styles.title}>Artisan Inquiries</Text>
          </View>
        </View>

        {/* Search & Filter */}
        <Searchbar
          placeholder="Search inquiries, crafts, or artisans..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchBar}
          inputStyle={styles.searchInput}
          iconColor={colors.textMuted}
        />

        <View style={styles.filterRow}>
          <Chip
            selected={statusFilter === 'all'}
            onPress={() => setStatusFilter('all')}
            style={[styles.filterChip, statusFilter === 'all' && styles.filterChipActive]}
            textStyle={[styles.filterChipText, statusFilter === 'all' && styles.filterChipTextActive]}
          >
            All ({supportMessages?.length || 0})
          </Chip>
          <Chip
            selected={statusFilter === 'open'}
            onPress={() => setStatusFilter('open')}
            style={[styles.filterChip, statusFilter === 'open' && styles.filterChipActive]}
            textStyle={[styles.filterChipText, statusFilter === 'open' && styles.filterChipTextActive]}
          >
            Open ({supportMessages?.filter((m) => m.status === 'open').length || 0})
          </Chip>
          <Chip
            selected={statusFilter === 'resolved'}
            onPress={() => setStatusFilter('resolved')}
            style={[styles.filterChip, statusFilter === 'resolved' && styles.filterChipActive]}
            textStyle={[styles.filterChipText, statusFilter === 'resolved' && styles.filterChipTextActive]}
          >
            Resolved ({supportMessages?.filter((m) => m.status === 'resolved').length || 0})
          </Chip>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[colors.secondary]}
          />
        }
      >
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.secondary} />
            <Text style={styles.loadingText}>Loading artisan inquiries...</Text>
          </View>
        ) : filteredMessages.length === 0 ? (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons name="check-all" size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No Inquiries Found</Text>
            <Text style={styles.emptySub}>
              {searchQuery ? 'Try adjusting your search criteria.' : 'No active inquiries from artisans at this time.'}
            </Text>
          </View>
        ) : (
          filteredMessages.map((msg: SupportMessage) => {
            const isOpen = msg.status === 'open';
            return (
              <TouchableOpacity
                key={msg.id}
                activeOpacity={0.7}
                onPress={() =>
                  navigation.navigate('SupportThread', {
                    messageId: msg.id,
                    initialTitle: msg.listing_title || undefined,
                  })
                }
              >
                <Card style={styles.msgCard}>
                  <Card.Content>
                    <View style={styles.cardTopRow}>
                      <View style={styles.artisanTag}>
                        <MaterialCommunityIcons name="account-circle" size={18} color={colors.secondary} />
                        <Text style={styles.artisanName}>
                          {msg.artisan_name ? msg.artisan_name : `Artisan #${msg.artisan_id}`}
                        </Text>
                      </View>
                      <View style={[styles.statusBadge, isOpen ? styles.statusOpen : styles.statusResolved]}>
                        <Text style={[styles.statusText, isOpen ? styles.statusTextOpen : styles.statusTextResolved]}>
                          {msg.status.toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    {msg.listing_title && (
                      <View style={styles.craftTitleRow}>
                        <MaterialCommunityIcons name="tag-outline" size={14} color={colors.primary} />
                        <Text style={styles.craftTitleText} numberOfLines={1}>
                          {msg.listing_title}
                        </Text>
                      </View>
                    )}

                    <Text style={styles.msgBody} numberOfLines={3}>
                      {msg.message}
                    </Text>

                    <View style={styles.cardFooter}>
                      <Text style={styles.timestamp}>
                        {msg.created_at ? new Date(msg.created_at).toLocaleString() : 'Recently'}
                      </Text>
                      <View style={styles.replyRow}>
                        <Text style={styles.replyText}>Open Discussion</Text>
                        <MaterialCommunityIcons name="chevron-right" size={16} color={colors.secondary} />
                      </View>
                    </View>
                  </Card.Content>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ColorPalette, isDark: boolean) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTop: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    backBtn: {
      padding: spacing.xs,
      marginRight: spacing.xs,
    },
    headerTitleBox: {
      flex: 1,
    },
    kicker: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.secondary,
      letterSpacing: 1,
    },
    title: {
      fontSize: 17,
      fontWeight: '800',
      color: colors.text,
    },
    searchBar: {
      backgroundColor: colors.background,
      elevation: 0,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      height: 44,
      marginBottom: spacing.sm,
    },
    searchInput: {
      fontSize: 14,
      minHeight: 0,
    },
    filterRow: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    filterChip: {
      backgroundColor: colors.background,
      borderColor: colors.border,
    },
    filterChipActive: {
      backgroundColor: colors.indigoLight,
      borderColor: colors.secondary,
    },
    filterChipText: {
      fontSize: 12,
      color: colors.textMuted,
    },
    filterChipTextActive: {
      color: colors.secondary,
      fontWeight: '700',
    },
    container: {
      padding: spacing.md,
      paddingBottom: 100,
    },
    centered: {
      paddingVertical: 60,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingText: {
      marginTop: spacing.md,
      color: colors.textMuted,
      fontSize: 14,
    },
    emptyCard: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 60,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginTop: spacing.sm,
    },
    emptySub: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 4,
      textAlign: 'center',
    },
    msgCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.sm,
    },
    cardTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    artisanTag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    artisanName: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
    },
    statusOpen: {
      backgroundColor: colors.warningLight,
    },
    statusResolved: {
      backgroundColor: colors.successLight,
    },
    statusText: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    statusTextOpen: {
      color: colors.warningText,
    },
    statusTextResolved: {
      color: colors.successGreen,
    },
    craftTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primaryLight,
      paddingHorizontal: spacing.xs,
      paddingVertical: 3,
      borderRadius: 6,
      marginBottom: 6,
      gap: 4,
    },
    craftTitleText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.primary,
    },
    msgBody: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
      marginBottom: 8,
    },
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 6,
      borderTopWidth: 1,
      borderTopColor: colors.badgeNeutral,
    },
    timestamp: {
      fontSize: 11,
      color: colors.textMuted,
    },
    replyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    replyText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.secondary,
    },
  });
}
