// src/features/coordinator-review/ArtisanInquiriesListScreen.tsx
import React, { useState, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { Text, Card, ActivityIndicator, Searchbar, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';

import type { CoordinatorStackParamList } from '../../types/navigation';
import type { SupportMessage } from '../../types/contracts';
import { service } from '../../services';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ArtisanInquiriesListScreen() {
  const { t } = useTranslation();
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, isDark, insets.top), [colors, isDark, insets.top]);
  const navigation = useNavigation<NativeStackNavigationProp<CoordinatorStackParamList>>();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('all');

  const { data: supportMessages, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['supportMessages'],
    queryFn: () => service.getSupportMessages(),
    staleTime: 5000,
  });

  const filteredMessages = useMemo(() => {
    if (!supportMessages) return [];
    return supportMessages.filter((msg) => {
      if (statusFilter !== 'all' && msg.status !== statusFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchName = msg.artisan_name?.toLowerCase().includes(q);
      const matchMsg = msg.message?.toLowerCase().includes(q);
      const matchTitle = msg.listing_title?.toLowerCase().includes(q);
      return matchName || matchMsg || matchTitle;
    });
  }, [supportMessages, statusFilter, searchQuery]);

  // Safely calculate counts to prevent undefined.length UI crashes
  const safeMessages = supportMessages || [];
  const openCount = safeMessages.filter((m) => m.status === 'open').length;
  const resolvedCount = safeMessages.filter((m) => m.status === 'resolved').length;

  return (
    <View style={styles.screen}>
      {/* Pinned Top Section */}
      <View style={styles.topSection}>
        
        {/* 1. Header Row */}
        <View style={styles.headerRow}>
          <TouchableOpacity 
            onPress={() => navigation.goBack()} 
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialCommunityIcons name="arrow-left" size={26} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTextContainer}>
            <Text style={styles.kicker}>{t('coordinator.inquiries.kicker', 'CLUSTER SUPPORT QUEUE')}</Text>
            <Text style={styles.title}>{t('coordinator.inquiries.title', 'Artisan Inquiries')}</Text>
          </View>
        </View>

        {/* 2. Search Container */}
        <View style={styles.searchContainer}>
          <Searchbar
            placeholder={t('coordinator.inquiries.searchPlaceholder', 'Search inquiries, crafts, or artisans...')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchBar}
            inputStyle={styles.searchInput}
            iconColor={colors.textMuted}
            elevation={0}
          />
        </View>

        {/* 3. Filter Container */}
        <View style={styles.filterContainer}>
          <Chip 
            selected={statusFilter === 'all'} 
            onPress={() => setStatusFilter('all')} 
            style={[styles.filterChip, statusFilter === 'all' && styles.filterChipActive]} 
            textStyle={[styles.filterChipText, statusFilter === 'all' && styles.filterChipTextActive]}
            showSelectedOverlay
          >
            {t('coordinator.inquiries.filterAll', { count: safeMessages.length })}
          </Chip>
          <Chip 
            selected={statusFilter === 'open'} 
            onPress={() => setStatusFilter('open')} 
            style={[styles.filterChip, statusFilter === 'open' && styles.filterChipActive]} 
            textStyle={[styles.filterChipText, statusFilter === 'open' && styles.filterChipTextActive]}
          >
            {t('coordinator.inquiries.filterOpen', { count: openCount })}
          </Chip>
          <Chip 
            selected={statusFilter === 'resolved'} 
            onPress={() => setStatusFilter('resolved')} 
            style={[styles.filterChip, statusFilter === 'resolved' && styles.filterChipActive]} 
            textStyle={[styles.filterChipText, statusFilter === 'resolved' && styles.filterChipTextActive]}
          >
            {t('coordinator.inquiries.filterResolved', { count: resolvedCount })}
          </Chip>
        </View>
      </View>

      {/* Scrolling Content */}
      <ScrollView 
        contentContainerStyle={styles.scrollContent} 
        showsVerticalScrollIndicator={false} 
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.secondary]} />
        }
      >
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.secondary} />
            <Text style={styles.loadingText}>{t('coordinator.inquiries.loading', 'Loading artisan inquiries...')}</Text>
          </View>
        ) : filteredMessages.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <MaterialCommunityIcons name="check-all" size={36} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>{t('coordinator.inquiries.emptyTitle', 'No Inquiries Found')}</Text>
            <Text style={styles.emptySub}>
              {searchQuery 
                ? t('coordinator.inquiries.emptySub', 'Try adjusting your search criteria.') 
                : t('coordinator.inquiries.emptySub', 'Try adjusting your search criteria.')}
            </Text>
          </View>
        ) : (
          filteredMessages.map((msg: SupportMessage) => {
            const isOpen = msg.status === 'open';
            return (
              <TouchableOpacity 
                key={msg.id} 
                activeOpacity={0.8} 
                onPress={() => navigation.navigate('SupportThread', { messageId: msg.id, initialTitle: msg.listing_title || undefined })}
              >
                <Card style={styles.msgCard}>
                  <Card.Content>
                    <View style={styles.cardTopRow}>
                      <View style={styles.artisanTag}>
                        <MaterialCommunityIcons name="account-circle" size={20} color={colors.secondary} />
                        <Text style={styles.artisanName}>{msg.artisan_name ? msg.artisan_name : `Artisan #${msg.artisan_id}`}</Text>
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
                        <Text style={styles.craftTitleText} numberOfLines={1}>{msg.listing_title}</Text>
                      </View>
                    )}
                    
                    <Text style={styles.msgBody} numberOfLines={3}>{msg.message}</Text>
                    
                    <View style={styles.cardFooter}>
                      <Text style={styles.timestamp}>{msg.created_at ? new Date(msg.created_at).toLocaleString() : 'Recently'}</Text>
                      <View style={styles.replyRow}>
                        <Text style={styles.replyText}>{t('coordinator.inquiries.openDiscussion', 'Open Discussion')}</Text>
                        <MaterialCommunityIcons name="chevron-right" size={18} color={colors.secondary} />
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

function createStyles(colors: ColorPalette, isDark: boolean, topInset: number) {
  return StyleSheet.create({
    screen: { 
      flex: 1, 
      backgroundColor: colors.background 
    },
    topSection: {
      paddingTop: topInset + spacing.md, 
      backgroundColor: colors.background,
    },
    headerRow: { 
      flexDirection: 'row', 
      alignItems: 'center', 
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
    backBtn: { 
      marginRight: spacing.md,
      marginTop: 8,
    },
    headerTextContainer: { 
      flex: 1,
      justifyContent: 'center',
    },
    kicker: { 
      fontSize: 10, 
      fontWeight: '700', 
      color: colors.secondary, 
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 2 
    },
    title: { 
      fontSize: 20, 
      fontWeight: '800', 
      color: colors.text 
    },
    searchContainer: {
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
    searchBar: { 
      backgroundColor: isDark ? colors.surface : colors.surfaceElevated, 
      borderRadius: 24, 
      borderWidth: 1, 
      borderColor: colors.border, 
      height: 48, 
    },
    searchInput: { 
      fontSize: 14, 
      alignSelf: 'center',
      minHeight: 0 
    },
    filterContainer: { 
      flexDirection: 'row', 
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    filterChip: { 
      backgroundColor: 'transparent', 
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 20,
    },
    filterChipActive: { 
      backgroundColor: isDark ? 'rgba(88, 101, 242, 0.15)' : colors.indigoLight, 
      borderColor: colors.secondary 
    },
    filterChipText: { 
      fontSize: 12, 
      fontWeight: '600',
      color: colors.textMuted 
    },
    filterChipTextActive: { 
      color: colors.secondary, 
      fontWeight: '700' 
    },
    scrollContent: { 
      padding: spacing.md, 
      paddingBottom: 100 
    },
    centered: { 
      paddingVertical: 60, 
      justifyContent: 'center', 
      alignItems: 'center' 
    },
    loadingText: { 
      marginTop: spacing.md, 
      color: colors.textMuted, 
      fontSize: 14 
    },
    emptyCard: { 
      alignItems: 'center', 
      justifyContent: 'center', 
      paddingVertical: 60 
    },
    emptyIconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.badgeNeutral,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    emptyTitle: { 
      fontSize: 18, 
      fontWeight: '800', 
      color: colors.text, 
      marginBottom: spacing.xs 
    },
    emptySub: { 
      fontSize: 13, 
      color: colors.textMuted, 
      textAlign: 'center',
      maxWidth: 280
    },
    msgCard: { 
      backgroundColor: colors.surface, 
      borderRadius: 16, 
      borderWidth: 1, 
      borderColor: colors.border, 
      marginBottom: spacing.md,
      elevation: 1,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 4,
    },
    cardTopRow: { 
      flexDirection: 'row', 
      justifyContent: 'space-between', 
      alignItems: 'center', 
      marginBottom: 10 
    },
    artisanTag: { 
      flexDirection: 'row', 
      alignItems: 'center', 
      gap: 8 
    },
    artisanName: { 
      fontSize: 15, 
      fontWeight: '700', 
      color: colors.text 
    },
    statusBadge: { 
      paddingHorizontal: 10, 
      paddingVertical: 4, 
      borderRadius: 8 
    },
    statusOpen: { 
      backgroundColor: colors.warningLight 
    },
    statusResolved: { 
      backgroundColor: colors.successLight 
    },
    statusText: { 
      fontSize: 10, 
      fontWeight: '800', 
      letterSpacing: 0.5 
    },
    statusTextOpen: { 
      color: colors.warningText 
    },
    statusTextResolved: { 
      color: colors.successGreen 
    },
    craftTitleRow: { 
      flexDirection: 'row', 
      alignItems: 'center', 
      backgroundColor: colors.primaryLight, 
      paddingHorizontal: spacing.sm, 
      paddingVertical: 4, 
      borderRadius: 8, 
      marginBottom: 8, 
      gap: 6 
    },
    craftTitleText: { 
      fontSize: 12, 
      fontWeight: '700', 
      color: colors.primary 
    },
    msgBody: { 
      fontSize: 13, 
      lineHeight: 20, 
      color: colors.text, 
      marginBottom: 12 
    },
    cardFooter: { 
      flexDirection: 'row', 
      justifyContent: 'space-between', 
      alignItems: 'center', 
      paddingTop: 10, 
      borderTopWidth: 1, 
      borderTopColor: colors.badgeNeutral 
    },
    timestamp: { 
      fontSize: 11, 
      color: colors.textMuted 
    },
    replyRow: { 
      flexDirection: 'row', 
      alignItems: 'center', 
      gap: 4 
    },
    replyText: { 
      fontSize: 12, 
      fontWeight: '700', 
      color: colors.secondary 
    },
  });
}