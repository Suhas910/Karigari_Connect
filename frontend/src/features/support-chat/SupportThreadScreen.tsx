import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
  Modal,
} from 'react-native';
import { Text, TextInput, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { service } from '../../services';
import { useAuthStore } from '../../store/authStore';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import type { SupportMessage, SupportMessageReply } from '../../types/contracts';

type RouteParams = {
  SupportThread: {
    messageId: string;
    initialTitle?: string;
  };
};

export default function SupportThreadScreen() {
  const { t } = useTranslation();
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

  // Custom Modal States
  const [closeModalVisible, setCloseModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);

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
  }, [messageId, initialTitle]);

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

  const handleCloseThreadPrompt = () => {
    setShowActions(false);
    setCloseModalVisible(true);
  };

  const executeCloseThread = async () => {
    setClosing(true);
    try {
      const updated = await service.closeSupportMessage(messageId);
      setParentMessage(updated);
      setCloseModalVisible(false);
    } catch (err: any) {
      setError(err?.message || 'Could not close inquiry.');
      setCloseModalVisible(false);
    } finally {
      setClosing(false);
    }
  };

  const handleDeleteThreadPrompt = () => {
    setShowActions(false);
    setDeleteModalVisible(true);
  };

  const executeDeleteThread = async () => {
    setDeleting(true);
    try {
      await service.deleteSupportMessage(messageId);
      setDeleteModalVisible(false);
      navigation.goBack();
    } catch (err: any) {
      setError(err?.message || 'Could not delete conversation.');
      setDeleteModalVisible(false);
      setDeleting(false);
    }
  };

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
          <View style={[styles.actionsSheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            {!isClosed && (
              <TouchableOpacity style={styles.actionItem} onPress={handleCloseThreadPrompt} disabled={closing}>
                <View style={[styles.actionIcon, styles.actionIconClose]}>
                  <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.successGreen} />
                </View>
                <View style={styles.actionTextGroup}>
                  <Text style={styles.actionTitle}>{t('help.closeInquiry', 'Close Inquiry')}</Text>
                  <Text style={styles.actionSubtitle}>{t('help.closeInquirySub', 'Mark as resolved, stop replies')}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            {isClosed && currentRole === 'artisan' && (
              <TouchableOpacity style={styles.actionItem} onPress={handleDeleteThreadPrompt} disabled={deleting}>
                <View style={[styles.actionIcon, styles.actionIconDelete]}>
                  <MaterialCommunityIcons name="delete-outline" size={20} color={colors.error} />
                </View>
                <View style={styles.actionTextGroup}>
                  <Text style={[styles.actionTitle, { color: colors.error }]}>{t('help.clearHistory', 'Clear Chat History')}</Text>
                  <Text style={styles.actionSubtitle}>{t('help.clearHistorySub', 'Permanently delete this conversation')}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.actionItem, styles.actionItemLast]} onPress={() => setShowActions(false)}>
              <Text style={styles.actionCancelText}>{t('common.cancel', 'Cancel')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      )}

      {/* Custom Alert Modal for Closing Inquiry */}
      <Modal visible={closeModalVisible} transparent animationType="fade" onRequestClose={() => setCloseModalVisible(false)}>
        <View style={styles.alertOverlay}>
          <View style={styles.alertBox}>
            <Text style={styles.alertTitle}>{t('help.alertCloseTitle', 'Close Inquiry?')}</Text>
            <Text style={styles.alertDesc}>
              {t('help.alertCloseDesc', 'Mark this inquiry as resolved? No further replies can be sent once closed.')}
            </Text>
            <View style={styles.alertActions}>
              <TouchableOpacity onPress={() => setCloseModalVisible(false)} style={styles.alertBtn} disabled={closing}>
                <Text style={styles.alertCancelText}>{t('common.cancel', 'CANCEL').toUpperCase()}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={executeCloseThread} style={styles.alertBtn} disabled={closing}>
                {closing ? (
                  <ActivityIndicator size={16} color={colors.primary} />
                ) : (
                  <Text style={styles.alertConfirmText}>{t('help.closeInquiry', 'CLOSE INQUIRY').toUpperCase()}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Custom Alert Modal for Deleting Thread */}
      <Modal visible={deleteModalVisible} transparent animationType="fade" onRequestClose={() => setDeleteModalVisible(false)}>
        <View style={styles.alertOverlay}>
          <View style={styles.alertBox}>
            <Text style={styles.alertTitle}>{t('help.alertDeleteTitle', 'Clear Chat History?')}</Text>
            <Text style={styles.alertDesc}>
              {t('help.alertDeleteDesc', 'Permanently delete this conversation? This cannot be undone.')}
            </Text>
            <View style={styles.alertActions}>
              <TouchableOpacity onPress={() => setDeleteModalVisible(false)} style={styles.alertBtn} disabled={deleting}>
                <Text style={styles.alertCancelText}>{t('common.cancel', 'CANCEL').toUpperCase()}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={executeDeleteThread} style={styles.alertBtn} disabled={deleting}>
                {deleting ? (
                  <ActivityIndicator size={16} color={colors.error} />
                ) : (
                  <Text style={styles.alertDeleteText}>{t('help.clearHistory', 'DELETE').toUpperCase()}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.container}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>{t('help.loadingThread', 'Loading conversation...')}</Text>
          </View>
        ) : error && !parentMessage ? (
          <View style={styles.centered}>
            <MaterialCommunityIcons name="alert-circle-outline" size={36} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.goBackBtn}>
              <Text style={styles.goBackText}>{t('common.goBack', 'Go Back')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Chat Header Bar */}
            <View style={styles.chatHeader}>
              <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBackBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
              </TouchableOpacity>
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
                  <Text style={styles.chatHeaderStatus} numberOfLines={1}>
                    {isClosed ? t('help.statusResolved', 'Resolved') : t('help.statusOpen', 'Open')}
                    {parentMessage?.listing_title ? ` · ${parentMessage.listing_title}` : ''}
                  </Text>
                </View>
              </View>
              {(!isClosed || (isClosed && currentRole === 'artisan')) && (
                <TouchableOpacity style={styles.chatHeaderAction} onPress={() => setShowActions(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <MaterialCommunityIcons name="dots-vertical" size={24} color={colors.text} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              ref={scrollViewRef}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Distinct Original Inquiry Context Card */}
              {parentMessage && (
                <View style={styles.contextCard}>
                  <View style={styles.contextCardHeader}>
                    <MaterialCommunityIcons name="message-alert-outline" size={16} color={colors.secondary} />
                    <Text style={styles.contextCardLabel}>{t('help.originalInquiry', 'Original Inquiry')}</Text>
                  </View>
                  <Text style={styles.contextCardText}>{parentMessage.message}</Text>
                  <Text style={styles.contextCardDate}>
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
              )}

              {/* Divider */}
              {replies.length > 0 && (
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>{t('help.conversationStart', 'CONVERSATION START')}</Text>
                  <View style={styles.dividerLine} />
                </View>
              )}

              {/* Message bubbles */}
              {replies.length === 0 ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="chat-processing-outline" size={32} color={colors.textMuted} />
                  <Text style={styles.emptyStateText}>{t('help.noReplies', 'No replies yet. Be the first to respond.')}</Text>
                </View>
              ) : (
                replies.map((r) => {
                  const isMe = r.sender_role === currentRole;
                  return (
                    <View key={r.id} style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
                      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                        {!isMe && <Text style={styles.senderLabel}>{r.sender_name}</Text>}
                        <Text style={[styles.bubbleText, isMe ? styles.bubbleTextMe : styles.bubbleTextOther]}>
                          {r.body}
                        </Text>
                        <Text style={[styles.timestamp, isMe ? styles.timestampMe : styles.timestampOther]}>
                          {r.created_at
                            ? new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
                  <MaterialCommunityIcons name="shield-check" size={16} color={colors.successGreen} />
                  <Text style={styles.closedBannerInlineText}>{t('help.resolvedBanner', 'This inquiry has been resolved and closed.')}</Text>
                </View>
              )}
            </ScrollView>

            {/* Input bar or closed footer */}
            {isClosed ? (
              <View style={[styles.closedFooter, { paddingBottom: Math.max(insets.bottom, 20) }]}>
                <MaterialCommunityIcons name="lock-outline" size={16} color={colors.textMuted} />
                <Text style={styles.closedFooterText}>{t('help.closedFooter', 'Inquiry closed · No further replies can be sent')}</Text>
              </View>
            ) : (
              <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <TextInput
                  mode="outlined"
                  placeholder={t('help.typeReply', 'Type a reply...')}
                  placeholderTextColor={colors.placeholder}
                  value={replyText}
                  onChangeText={setReplyText}
                  outlineColor={colors.border}
                  activeOutlineColor={colors.primary}
                  textColor={colors.text}
                  style={styles.textInput}
                  outlineStyle={styles.textInputOutline}
                  contentStyle={styles.textInputContent}
                  multiline
                  numberOfLines={1}
                  theme={{ colors: { background: colors.surface } }}
                />
                <View style={styles.sendBtnWrap}>
                  <IconButton
                    icon="send"
                    mode="contained"
                    containerColor={replyText.trim() ? colors.primary : colors.surfaceElevated}
                    iconColor={replyText.trim() ? colors.onPrimary : colors.textMuted}
                    size={22}
                    loading={sending}
                    disabled={!replyText.trim() || sending}
                    onPress={handleSendReply}
                    style={styles.sendBtn}
                  />
                </View>
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
      marginTop: spacing.md,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.surfaceElevated,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    goBackText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },

    // Chat header bar
    chatHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    headerBackBtn: {
      marginRight: 4,
    },
    chatHeaderAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.indigoLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    chatHeaderInfo: {
      flex: 1,
      justifyContent: 'center',
    },
    chatHeaderName: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 2,
    },
    chatHeaderStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusDotOpen: {
      backgroundColor: colors.warningText,
    },
    statusDotClosed: {
      backgroundColor: colors.successGreen,
    },
    chatHeaderStatus: {
      fontSize: 12,
      color: colors.textMuted,
      fontWeight: '500',
    },
    chatHeaderAction: {
      padding: 4,
    },

    // Scroll
    scrollContent: {
      padding: spacing.md,
      paddingBottom: 24,
    },

    // Context Card (Replacing the weird original inquiry bubble)
    contextCard: {
      backgroundColor: isDark ? colors.surfaceElevated : colors.indigoLight,
      borderRadius: 12,
      padding: spacing.md,
      marginBottom: spacing.xs, // Reduced margin here
      borderWidth: 1,
      borderColor: isDark ? colors.border : colors.indigoBorder,
    },
    contextCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8,
    },
    contextCardLabel: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.5,
      color: colors.secondary,
      textTransform: 'uppercase',
    },
    contextCardText: {
      fontSize: 14,
      color: colors.text,
      lineHeight: 20,
      fontWeight: '500',
      marginBottom: 8,
    },
    contextCardDate: {
      fontSize: 11,
      color: colors.textMuted,
    },

    // Divider
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.xs, // Manually reduced to hug the context card
      marginBottom: spacing.md,
      gap: 12,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    dividerText: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
      color: colors.textMuted,
    },

    // Empty state
    emptyState: {
      alignItems: 'center',
      paddingVertical: spacing.xl,
      gap: 12,
    },
    emptyStateText: {
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
    },

    // Message bubbles
    msgRow: {
      flexDirection: 'row',
      marginBottom: 16,
    },
    msgRowMe: {
      justifyContent: 'flex-end',
    },
    msgRowOther: {
      justifyContent: 'flex-start',
    },
    bubble: {
      maxWidth: '85%',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 18,
    },
    bubbleMe: {
      backgroundColor: colors.primary,
      borderBottomRightRadius: 4, 
    },
    bubbleOther: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomLeftRadius: 4, 
    },
    senderLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.secondary,
      marginBottom: 4,
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
      marginTop: 4,
    },
    timestampMe: {
      color: colors.primaryLight,
      alignSelf: 'flex-end',
    },
    timestampOther: {
      color: colors.textMuted,
      alignSelf: 'flex-start',
    },

    // Closed banner inline
    closedBannerInline: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: spacing.md,
      padding: 12,
      backgroundColor: isDark ? colors.surface : colors.successLight,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: isDark ? colors.border : colors.successBorder,
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
      paddingHorizontal: spacing.md,
      paddingTop: 12,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 8,
    },
    textInput: {
      flex: 1,
      fontSize: 14,
      maxHeight: 140, 
      backgroundColor: colors.surface,
    },
    textInputOutline: {
      borderRadius: 16, 
      borderWidth: 1,
      borderColor: colors.border,
    },
    textInputContent: {
      paddingTop: 16, 
      paddingBottom: 16, 
    },
    sendBtnWrap: {
      height: 52, 
      justifyContent: 'center',
    },
    sendBtn: {
      margin: 0,
      borderRadius: 12,
    },

    // Closed footer bar
    closedFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 16,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 6,
    },
    closedFooterText: {
      fontSize: 12,
      color: colors.textMuted,
      fontWeight: '600',
    },

    // Actions sheet (overlaid bottom sheet)
    actionsBackdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 999,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    actionsSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 16,
      paddingHorizontal: spacing.lg,
    },
    actionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 16,
    },
    actionItemLast: {
      borderBottomWidth: 0,
      justifyContent: 'center',
      paddingVertical: 20,
    },
    actionIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
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
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    actionSubtitle: {
      fontSize: 13,
      color: colors.textMuted,
    },
    actionCancelText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textMuted,
    },

    // Custom Alert Modal Styles
    alertOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.xl,
    },
    alertBox: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 24,
      width: '100%',
      maxWidth: 340,
      elevation: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
    },
    alertTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 8,
    },
    alertDesc: {
      fontSize: 14,
      color: colors.textMuted,
      lineHeight: 20,
      marginBottom: 24,
    },
    alertActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 16,
    },
    alertBtn: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      minWidth: 80,
      alignItems: 'center',
      justifyContent: 'center',
    },
    alertCancelText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.secondary, // Uses the app's secondary/accent color
    },
    alertConfirmText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.primary, // Uses the app's primary color
    },
    alertDeleteText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.error, // Uses red error color for destructive actions
    },
  });
}