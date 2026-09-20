import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Pressable,
} from 'react-native';
import { Text, TextInput, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { service } from '../../services';
import { useAuthStore } from '../../store/authStore';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import type { SupportMessage, SupportMessageReply } from '../../types/contracts';

// =========================================================================
// SUPABASE REALTIME REPLACEMENT GUIDE (FUTURE BACKEND INTEGRATION)
// =========================================================================
// To replace this polling/mock pattern with live Supabase Realtime:
// 1. Create a Supabase channel subscription:
//    const channel = supabase
//      .channel(`support-replies:${messageId}`)
//      .on('postgres_changes', {
//        event: 'INSERT',
//        schema: 'public',
//        table: 'support_message_replies',
//        filter: `message_id=eq.${messageId}`
//      }, (payload) => {
//        setReplies((prev) => [...prev, payload.new as SupportMessageReply]);
//      })
//      .subscribe();
// 2. Unsubscribe on unmount: () => { supabase.removeChannel(channel); }
// =========================================================================

type RouteParams = {
  SupportThread: {
    messageId: string;
    initialTitle?: string;
  };
};

export default function SupportThreadScreen() {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const route = useRoute<RouteProp<RouteParams, 'SupportThread'>>();
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { role: currentRole } = useAuthStore();

  const { messageId, initialTitle } = route.params;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parentMessage, setParentMessage] = useState<SupportMessage | null>(null);
  const [replies, setReplies] = useState<SupportMessageReply[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [threadReplies, allMessages] = await Promise.all([
          service.getSupportThread(messageId),
          service.getSupportMessages(),
        ]);
        if (isMounted) {
          const parent =
            allMessages.find((m) => m.id === messageId) ||
            ({
              id: messageId,
              artisan_id: 0,
              listing_id: null,
              message: initialTitle || 'Support Inquiry',
              status: 'open',
              created_at: new Date().toISOString(),
              artisan_name: 'Artisan',
              listing_title: initialTitle,
            } as SupportMessage);
          setParentMessage(parent);
          setReplies(threadReplies || []);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Failed to load support message thread.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [messageId]);

  useEffect(() => {
    if (replies.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 250);
    }
  }, [replies.length]);

  const handleSendReply = async () => {
    const text = replyText.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      const newReply = await service.replyToSupportMessage(messageId, text);
      setReplies((prev) => [...prev, newReply]);
      setReplyText('');
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (err: any) {
      setError(err?.message || 'Could not send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const isClosed = parentMessage?.status === 'resolved' || parentMessage?.status === 'closed';

  const handleCloseThread = () => {
    setShowActions(false);
    Alert.alert(
      'Close Inquiry?',
      'Mark this inquiry as resolved? No further replies can be sent once closed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Inquiry',
          style: 'default',
          onPress: async () => {
            setClosing(true);
            try {
              const updated = await service.closeSupportMessage(messageId);
              setParentMessage(updated);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not close inquiry.');
            } finally {
              setClosing(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteThread = () => {
    setShowActions(false);
    Alert.alert(
      'Clear Chat History?',
      'Permanently delete this conversation? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete History',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await service.deleteSupportMessage(messageId);
              navigation.goBack();
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not delete conversation.');
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const title =
    initialTitle ||
    parentMessage?.listing_title ||
    'Support Inquiry';

  const artisanName = parentMessage?.artisan_name || 'Artisan';

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : headerHeight}
    >
      {/* Actions overlay backdrop */}
      {showActions && (
        <Pressable style={styles.actionsBackdrop} onPress={() => setShowActions(false)}>
          <View style={styles.actionsSheet}>
            {!isClosed && (
              <TouchableOpacity
                style={styles.actionItem}
                onPress={handleCloseThread}
                disabled={closing}
              >
                <View style={[styles.actionIcon, styles.actionIconClose]}>
                  {closing ? (
                    <ActivityIndicator size={18} color={colors.successGreen} />
                  ) : (
                    <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.successGreen} />
                  )}
                </View>
                <View style={styles.actionTextGroup}>
                  <Text style={styles.actionTitle}>Close Inquiry</Text>
                  <Text style={styles.actionSubtitle}>Mark as resolved, stop replies</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            {isClosed && currentRole === 'artisan' && (
              <TouchableOpacity
                style={styles.actionItem}
                onPress={handleDeleteThread}
                disabled={deleting}
              >
                <View style={[styles.actionIcon, styles.actionIconDelete]}>
                  {deleting ? (
                    <ActivityIndicator size={18} color={colors.error} />
                  ) : (
                    <MaterialCommunityIcons name="delete-outline" size={20} color={colors.error} />
                  )}
                </View>
                <View style={styles.actionTextGroup}>
                  <Text style={[styles.actionTitle, { color: colors.error }]}>Clear Chat History</Text>
                  <Text style={styles.actionSubtitle}>Permanently delete this conversation</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionItem, styles.actionItemLast]}
              onPress={() => setShowActions(false)}
            >
              <Text style={styles.actionCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      )}

      <View style={styles.container}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading conversation...</Text>
          </View>
        ) : error && !parentMessage ? (
          <View style={styles.centered}>
            <MaterialCommunityIcons name="alert-circle-outline" size={36} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.goBackBtn}>
              <Text style={styles.goBackText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Chat header bar */}
            <View style={styles.chatHeader}>
              <View style={styles.chatHeaderAvatar}>
                <MaterialCommunityIcons
                  name={currentRole === 'coordinator' ? 'account-outline' : 'shield-account'}
                  size={18}
                  color={colors.secondary}
                />
              </View>
              <View style={styles.chatHeaderInfo}>
                <Text style={styles.chatHeaderName} numberOfLines={1}>
                  {currentRole === 'coordinator' ? artisanName : 'Cluster Coordinator'}
                </Text>
                <View style={styles.chatHeaderStatusRow}>
                  <View style={[styles.statusDot, isClosed ? styles.statusDotClosed : styles.statusDotOpen]} />
                  <Text style={styles.chatHeaderStatus}>
                    {isClosed ? 'Resolved' : 'Open'}
                    {parentMessage?.listing_title ? ` · ${parentMessage.listing_title}` : ''}
                  </Text>
                </View>
              </View>
              {/* Three-dot actions button */}
              {(!isClosed || (isClosed && currentRole === 'artisan')) && (
                <TouchableOpacity
                  style={styles.chatHeaderAction}
                  onPress={() => setShowActions(true)}
                >
                  <MaterialCommunityIcons name="dots-vertical" size={22} color={colors.text} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              ref={scrollViewRef}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Original inquiry bubble — shown as a "system" intro message */}
              {parentMessage && (
                <View style={styles.inquiryBubbleWrap}>
                  <View style={styles.inquiryBubble}>
                    <View style={styles.inquiryBubbleHeader}>
                      <MaterialCommunityIcons name="ticket-outline" size={13} color={colors.primary} />
                      <Text style={styles.inquiryBubbleLabel}>Original Inquiry</Text>
                    </View>
                    <Text style={styles.inquiryBubbleText}>{parentMessage.message}</Text>
                    <Text style={styles.inquiryBubbleDate}>
                      {parentMessage.created_at
                        ? new Date(parentMessage.created_at).toLocaleString([], {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Recently'}
                    </Text>
                  </View>
                </View>
              )}

              {/* Divider */}
              {replies.length > 0 && (
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>CONVERSATION</Text>
                  <View style={styles.dividerLine} />
                </View>
              )}

              {/* Message bubbles */}
              {replies.length === 0 ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="chat-processing-outline" size={28} color={colors.textMuted} />
                  <Text style={styles.emptyStateText}>No replies yet. Be the first to respond.</Text>
                </View>
              ) : (
                replies.map((r) => {
                  const isMe = r.sender_role === currentRole;
                  return (
                    <View
                      key={r.id}
                      style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}
                    >
                      {!isMe && (
                        <View style={styles.avatarSmall}>
                          <MaterialCommunityIcons
                            name={r.sender_role === 'coordinator' ? 'shield-account' : 'account'}
                            size={14}
                            color={colors.secondary}
                          />
                        </View>
                      )}
                      <View style={styles.bubbleWrap}>
                        {!isMe && (
                          <Text style={styles.senderLabel}>{r.sender_name}</Text>
                        )}
                        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                          <Text style={[styles.bubbleText, isMe ? styles.bubbleTextMe : styles.bubbleTextOther]}>
                            {r.body}
                          </Text>
                        </View>
                        <Text style={[styles.timestamp, isMe ? styles.timestampMe : styles.timestampOther]}>
                          {r.created_at
                            ? new Date(r.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : ''}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}

              {/* Closed banner inline */}
              {isClosed && (
                <View style={styles.closedBannerInline}>
                  <MaterialCommunityIcons name="shield-check" size={15} color={colors.successGreen} />
                  <Text style={styles.closedBannerInlineText}>This inquiry has been resolved and closed.</Text>
                </View>
              )}
            </ScrollView>

            {/* Input bar or closed footer */}
            {isClosed ? (
              <View style={[styles.closedFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <Text style={styles.closedFooterText}>Inquiry closed · No further replies can be sent</Text>
              </View>
            ) : (
              <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
                <TextInput
                  mode="outlined"
                  placeholder="Type a reply..."
                  placeholderTextColor={colors.placeholder}
                  value={replyText}
                  onChangeText={setReplyText}
                  outlineColor="transparent"
                  activeOutlineColor={colors.primary}
                  textColor={colors.text}
                  style={styles.textInput}
                  outlineStyle={styles.textInputOutline}
                  multiline
                  numberOfLines={2}
                  theme={{ colors: { background: colors.surfaceElevated } }}
                />
                <IconButton
                  icon="send"
                  mode="contained"
                  containerColor={replyText.trim() ? colors.primary : colors.border}
                  iconColor={replyText.trim() ? colors.onPrimary : colors.textMuted}
                  size={22}
                  loading={sending}
                  disabled={!replyText.trim() || sending}
                  onPress={handleSendReply}
                  style={styles.sendBtn}
                />
              </View>
            )}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ColorPalette, isDark: boolean) {
  return StyleSheet.create({
    keyboardAvoid: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },

    // Loading / error states
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      gap: spacing.sm,
    },
    loadingText: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 8,
    },
    errorText: {
      fontSize: 13,
      color: colors.error,
      textAlign: 'center',
    },
    goBackBtn: {
      marginTop: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: colors.surfaceElevated,
      borderRadius: 8,
    },
    goBackText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
    },

    // Chat header bar
    chatHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 10,
    },
    chatHeaderAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.indigoLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    chatHeaderInfo: {
      flex: 1,
      gap: 2,
    },
    chatHeaderName: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    chatHeaderStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    statusDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    statusDotOpen: {
      backgroundColor: colors.successGreen,
    },
    statusDotClosed: {
      backgroundColor: colors.textMuted,
    },
    chatHeaderStatus: {
      fontSize: 11,
      color: colors.textMuted,
    },
    chatHeaderAction: {
      padding: 4,
    },

    // Scroll
    scrollContent: {
      padding: spacing.md,
      paddingBottom: 20,
    },

    // Original inquiry bubble (system-style centered card)
    inquiryBubbleWrap: {
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    inquiryBubble: {
      backgroundColor: isDark ? colors.surface : colors.badgeNeutral,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 12,
      maxWidth: '90%',
      gap: 4,
    },
    inquiryBubbleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginBottom: 2,
    },
    inquiryBubbleLabel: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.5,
      color: colors.primary,
      textTransform: 'uppercase',
    },
    inquiryBubbleText: {
      fontSize: 13,
      color: colors.text,
      lineHeight: 19,
    },
    inquiryBubbleDate: {
      fontSize: 10,
      color: colors.textMuted,
      alignSelf: 'flex-end',
      marginTop: 4,
    },

    // Divider
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: spacing.sm,
      gap: 8,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    dividerText: {
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 1,
      color: colors.textMuted,
    },

    // Empty state
    emptyState: {
      alignItems: 'center',
      paddingVertical: spacing.xl,
      gap: 8,
    },
    emptyStateText: {
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
    },

    // Message bubbles
    msgRow: {
      flexDirection: 'row',
      marginBottom: 12,
      gap: 8,
    },
    msgRowMe: {
      justifyContent: 'flex-end',
    },
    msgRowOther: {
      justifyContent: 'flex-start',
    },
    avatarSmall: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.indigoLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 14,
      flexShrink: 0,
    },
    bubbleWrap: {
      maxWidth: '80%',
      gap: 2,
    },
    senderLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textMuted,
      paddingLeft: 4,
      marginBottom: 1,
    },
    bubble: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 18,
    },
    bubbleMe: {
      backgroundColor: colors.primary,
      borderBottomRightRadius: 4,
    },
    bubbleOther: {
      backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomLeftRadius: 4,
    },
    bubbleText: {
      fontSize: 14,
      lineHeight: 20,
    },
    bubbleTextMe: {
      color: colors.onPrimary,
    },
    bubbleTextOther: {
      color: colors.text,
    },
    timestamp: {
      fontSize: 10,
      marginTop: 2,
    },
    timestampMe: {
      color: colors.textMuted,
      alignSelf: 'flex-end',
      paddingRight: 4,
    },
    timestampOther: {
      color: colors.textMuted,
      paddingLeft: 4,
    },

    // Closed banner inline
    closedBannerInline: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: spacing.sm,
      padding: 8,
      backgroundColor: isDark ? colors.surface : colors.successLight,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    closedBannerInlineText: {
      fontSize: 12,
      color: colors.successGreen,
      fontWeight: '600',
    },

    // Input bar
    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: spacing.sm,
      paddingTop: 8,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 6,
    },
    textInput: {
      flex: 1,
      fontSize: 14,
      maxHeight: 120,
      backgroundColor: colors.surfaceElevated,
    },
    textInputOutline: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sendBtn: {
      margin: 0,
      borderRadius: 12,
      marginBottom: 4,
    },

    // Closed footer bar
    closedFooter: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    closedFooterText: {
      fontSize: 12,
      color: colors.textMuted,
      fontWeight: '500',
    },

    // Actions sheet (overlaid bottom sheet)
    actionsBackdrop: {
      ...StyleSheet.absoluteFill,
      zIndex: 999,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    actionsSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingTop: 12,
      paddingBottom: 28,
      paddingHorizontal: spacing.md,
      gap: 4,
    },
    actionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 14,
    },
    actionItemLast: {
      borderBottomWidth: 0,
      justifyContent: 'center',
    },
    actionIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionIconClose: {
      backgroundColor: colors.successLight,
    },
    actionIconDelete: {
      backgroundColor: colors.errorLight,
    },
    actionTextGroup: {
      flex: 1,
      gap: 2,
    },
    actionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    actionSubtitle: {
      fontSize: 12,
      color: colors.textMuted,
    },
    actionCancelText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textMuted,
    },
  });
}
