import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  LayoutAnimation,
  Modal,
} from 'react-native';
import { Text, TextInput, Button, ActivityIndicator, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { service } from '../../services';
import { useAppTheme, spacing } from '../../theme';
import type { ColorPalette } from '../../theme';
import type { Listing, SupportMessage } from '../../types/contracts';
import type { ArtisanStackParamList } from '../../types/navigation';

export default function HelpScreen() {
  const { t } = useTranslation();
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const queryClient = useQueryClient();
  
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Auto-dismiss feedback
  useEffect(() => {
    if (!feedback) return;
    const duration = feedback.type === 'success' ? 5000 : 7000;
    const timer = setTimeout(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setFeedback(null);
    }, duration);
    return () => clearTimeout(timer);
  }, [feedback]);

  const { data: listings } = useQuery({
    queryKey: ['listings'],
    queryFn: () => service.listListings(),
  });

  const { data: supportMessages, isLoading: isLoadingMessages } = useQuery({
    queryKey: ['supportMessages'],
    queryFn: () => service.getSupportMessages(),
  });

  const submitMutation = useMutation({
    mutationFn: (payload: { listing_id?: string | null; message: string }) =>
      service.submitSupportMessage(payload),
    onSuccess: () => {
      setMessageText('');
      setSelectedListingId(null);
      setFeedback({ type: 'success', text: t('help.sentSuccess') });
      queryClient.invalidateQueries({ queryKey: ['supportMessages'] });
    },
    onError: (err: any) => {
      setFeedback({
        type: 'error',
        text: err?.response?.data?.error?.message || t('help.sendFailed'),
      });
    },
  });

  const handleSubmit = () => {
    if (!messageText.trim()) {
      setFeedback({ type: 'error', text: t('help.emptyQuestion') });
      return;
    }
    setFeedback(null);
    submitMutation.mutate({
      listing_id: selectedListingId,
      message: messageText.trim(),
    });
  };

  const selectedListing = listings?.find((l) => l.id === selectedListingId);
  const selectedListingTitle = selectedListing?.catalogue?.catalogue?.title?.en || t('help.untitledCraft');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container} 
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        
        {/* Header Hero */}
        <View style={styles.headerHero}>
          <Text style={styles.heroTitle}>{t('help.title')}</Text>
          <Text style={styles.heroSubtitle}>{t('help.subtitle')}</Text>
        </View>

        {/* Feedback Alert */}
        {feedback && (
          <View style={[styles.feedbackBanner, feedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError]}>
            <MaterialCommunityIcons
              name={feedback.type === 'success' ? 'check-circle' : 'alert-circle'}
              size={20}
              color={feedback.type === 'success' ? colors.successGreen : colors.error}
            />
            <Text style={[styles.feedbackText, feedback.type === 'success' ? styles.feedbackSuccessText : styles.feedbackErrorText]}>
              {feedback.text}
            </Text>
            <TouchableOpacity
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setFeedback(null);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="close" size={18} color={feedback.type === 'success' ? colors.successGreen : colors.error} />
            </TouchableOpacity>
          </View>
        )}

        {/* Submission Form Area */}
        <View style={styles.formContainer}>
          <Text style={styles.fieldLabel}>{t('help.attachLabel')}</Text>
          
          <TouchableOpacity 
            style={styles.selectInput} 
            activeOpacity={0.7} 
            onPress={() => setModalVisible(true)}
          >
            <View style={styles.selectInputLeft}>
              <MaterialCommunityIcons name={selectedListingId ? 'tag-outline' : 'message-question-outline'} size={18} color={colors.primary} />
              <Text style={styles.selectInputText} numberOfLines={1}>
                {selectedListingId ? t('help.craftPrefix', { title: selectedListingTitle }) : t('help.generalQuestion')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-down" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          <Text style={styles.fieldLabel}>{t('help.messageLabel')}</Text>
          <TextInput
            mode="outlined"
            multiline
            numberOfLines={6}
            value={messageText}
            onChangeText={setMessageText}
            placeholder={t('help.messagePlaceholder')}
            placeholderTextColor={colors.textMuted}
            textColor={colors.text}
            outlineColor={colors.border}
            activeOutlineColor={colors.primary}
            style={styles.messageInput}
            contentStyle={styles.messageInputContent}
          />

          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={submitMutation.isPending}
            disabled={submitMutation.isPending || !messageText.trim()}
            buttonColor={colors.primary}
            textColor={colors.onPrimary}
            style={styles.submitBtn}
            icon="send"
            contentStyle={styles.submitBtnContent}
          >
            {t('help.send')}
          </Button>
        </View>

        {/* Previous Inquiries */}
        <View style={styles.inquiriesHeader}>
          <Text style={styles.inquiriesTitle}>{t('help.previousTitle')}</Text>
        </View>

        {isLoadingMessages ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.lg }} />
        ) : !supportMessages || supportMessages.length === 0 ? (
          <View style={styles.emptyMessagesBox}>
            <MaterialCommunityIcons name="message-outline" size={32} color={colors.border} style={{ marginBottom: 8 }} />
            <Text style={styles.emptyMessagesText}>{t('help.noPrevious')}</Text>
          </View>
        ) : (
          supportMessages.map((msg: SupportMessage) => {
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
                style={[styles.msgCard, isOpen ? styles.msgCardOpen : styles.msgCardResolved]}
              >
                <View style={styles.msgHeader}>
                  <Text style={styles.msgBody} numberOfLines={2}>{msg.message}</Text>
                </View>
                
                {msg.listing_title && (
                  <Text style={styles.msgAttachedText} numberOfLines={1}>
                    {t('help.craftPrefix', { title: msg.listing_title })}
                  </Text>
                )}

                <View style={styles.msgFooter}>
                  <View style={[styles.msgStatusPill, isOpen ? styles.pillOpen : styles.pillResolved]}>
                    <Text style={[styles.msgStatusText, isOpen ? styles.textOpen : styles.textResolved]}>
                      {isOpen ? t('help.statusOpen') : msg.status.toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.msgFooterRight}>
                    <Text style={styles.msgDate}>
                      {msg.created_at ? new Date(msg.created_at).toLocaleDateString() : ''}
                    </Text>
                    <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} />
                  </View>
                </View>
              </TouchableOpacity>
            )
          })
        )}
      </ScrollView>

      {/* Listing Selection Bottom Sheet Modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setModalVisible(false)} />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('help.selectListing')}</Text>
              <IconButton icon="close" size={20} iconColor={colors.textMuted} onPress={() => setModalVisible(false)} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScroll}>
              <TouchableOpacity
                style={styles.modalOption}
                onPress={() => {
                  setSelectedListingId(null);
                  setModalVisible(false);
                }}
              >
                <Text style={[styles.modalOptionText, selectedListingId === null && styles.modalOptionTextActive]}>
                  {t('help.generalQuestion')}
                </Text>
                {selectedListingId === null && <MaterialCommunityIcons name="check" size={20} color={colors.primary} />}
              </TouchableOpacity>

              {(listings || []).map((l: Listing) => {
                const title = l.catalogue?.catalogue?.title?.en || t('help.untitledCraft');
                const isSelected = selectedListingId === l.id;
                return (
                  <TouchableOpacity
                    key={l.id}
                    style={styles.modalOption}
                    onPress={() => {
                      setSelectedListingId(l.id);
                      setModalVisible(false);
                    }}
                  >
                    <Text style={[styles.modalOptionText, isSelected && styles.modalOptionTextActive]} numberOfLines={1}>
                      {title}
                    </Text>
                    {isSelected && <MaterialCommunityIcons name="check" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ColorPalette, isDark: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: 100,
    },
    headerHero: {
      marginBottom: spacing.lg,
    },
    heroTitle: {
      fontSize: 26,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 6,
    },
    heroSubtitle: {
      fontSize: 14,
      color: colors.textMuted,
      lineHeight: 20,
    },
    feedbackBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 8,
      marginBottom: spacing.md,
      gap: 8,
    },
    feedbackSuccess: {
      backgroundColor: colors.successLight,
      borderColor: colors.successBorder,
      borderWidth: 1,
    },
    feedbackError: {
      backgroundColor: colors.errorLight,
      borderColor: colors.errorBorder,
      borderWidth: 1,
    },
    feedbackText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '500',
    },
    feedbackSuccessText: {
      color: colors.successGreen,
    },
    feedbackErrorText: {
      color: colors.error,
    },
    formContainer: {
      marginBottom: spacing.xl,
    },
    fieldLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 8,
    },
    selectInput: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginBottom: spacing.lg,
    },
    selectInputLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    selectInputText: {
      fontSize: 14,
      color: colors.text,
      fontWeight: '500',
    },
    messageInput: {
      backgroundColor: colors.surface,
      fontSize: 14,
      marginBottom: spacing.lg,
      minHeight: 140, // Specifically increased minimum height
    },
    messageInputContent: {
      paddingTop: 16, // Explicit top padding inside the text box
      paddingBottom: 16, // Explicit bottom padding inside the text box
    },
    submitBtn: {
      borderRadius: 10,
    },
    submitBtnContent: {
      height: 48,
      flexDirection: 'row-reverse', // Flips the icon to the right side of the text
    },
    inquiriesHeader: {
      marginBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingBottom: 8,
    },
    inquiriesTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
    },
    emptyMessagesBox: {
      padding: spacing.xl,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyMessagesText: {
      fontSize: 14,
      color: colors.textMuted,
      textAlign: 'center',
    },
    msgCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderLeftWidth: 4,
      elevation: 1,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
    },
    msgCardOpen: {
      borderLeftColor: colors.warningText,
    },
    msgCardResolved: {
      borderLeftColor: colors.successGreen,
    },
    msgHeader: {
      marginBottom: 6,
    },
    msgBody: {
      fontSize: 14,
      color: colors.text,
      lineHeight: 20,
      fontWeight: '500',
    },
    msgAttachedText: {
      fontSize: 12,
      color: colors.textMuted,
      marginBottom: 12,
    },
    msgFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 4,
    },
    msgFooterRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    msgStatusPill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    pillOpen: {
      backgroundColor: colors.warningLight,
    },
    pillResolved: {
      backgroundColor: colors.successLight,
    },
    msgStatusText: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    textOpen: {
      color: colors.warningText,
    },
    textResolved: {
      color: colors.successGreen,
    },
    msgDate: {
      fontSize: 11,
      color: colors.textMuted,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    modalBackdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: '70%',
      paddingBottom: spacing.xl,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.text,
    },
    modalScroll: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    modalOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalOptionText: {
      fontSize: 14,
      color: colors.text,
      flex: 1,
    },
    modalOptionTextActive: {
      fontWeight: '700',
      color: colors.primary,
    },
  });
}