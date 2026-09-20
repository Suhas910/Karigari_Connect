import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  LayoutAnimation,
} from 'react-native';
import { Text, TextInput, Button, Card, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { service } from '../../services';
import { useAppTheme, spacing } from '../../theme';
import type { ColorPalette } from '../../theme';
import type { Listing, SupportMessage } from '../../types/contracts';
import type { ArtisanStackParamList } from '../../types/navigation';

export default function HelpScreen() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [isMessageFocused, setIsMessageFocused] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Auto-dismiss success/error feedback banner after a few seconds
  useEffect(() => {
    if (!feedback) return;
    const duration = feedback.type === 'success' ? 5000 : 7000;
    const timer = setTimeout(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setFeedback(null);
    }, duration);
    return () => clearTimeout(timer);
  }, [feedback]);

  // Fetch artisan's listings to populate the dropdown
  const { data: listings } = useQuery({
    queryKey: ['listings'],
    queryFn: () => service.listListings(),
  });

  // Fetch artisan's past submitted support messages
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
      setPickerOpen(false);
      setIsMessageFocused(false);
      setFeedback({
        type: 'success',
        text: t('help.sentSuccess'),
      });
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Header Hero */}
        <View style={styles.headerHero}>
          <View style={styles.heroIconCircle}>
            <MaterialCommunityIcons name="help-circle-outline" size={32} color={colors.primary} />
          </View>
          <Text style={styles.heroTitle}>{t('help.title')}</Text>
          <Text style={styles.heroSubtitle}>
            {t('help.subtitle')}
          </Text>
        </View>

        {/* Feedback Alert */}
        {feedback && (
          <View
            style={[
              styles.feedbackBanner,
              feedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError,
            ]}
          >
            <MaterialCommunityIcons
              name={feedback.type === 'success' ? 'check-circle' : 'alert-circle'}
              size={18}
              color={feedback.type === 'success' ? colors.successGreen : colors.error}
              style={{ marginRight: 8 }}
            />
            <Text
              style={[
                styles.feedbackText,
                feedback.type === 'success' ? styles.feedbackSuccessText : styles.feedbackErrorText,
              ]}
            >
              {feedback.text}
            </Text>
            <TouchableOpacity
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setFeedback(null);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ padding: 4, marginLeft: 6 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close') || 'Close'}
            >
              <MaterialCommunityIcons
                name="close"
                size={16}
                color={feedback.type === 'success' ? colors.successGreen : colors.error}
              />
            </TouchableOpacity>
          </View>
        )}

        {/* Submission Card */}
        <Card style={styles.formCard}>
          <Card.Content>
            <Text style={styles.fieldLabel}>{t('help.attachLabel')}</Text>

            {/* Dropdown Selector */}
            <TouchableOpacity
              style={styles.pickerSelector}
              onPress={() => setPickerOpen(!pickerOpen)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={selectedListingId ? 'palette-outline' : 'help-circle-outline'}
                size={20}
                color={colors.primary}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.pickerSelectorText} numberOfLines={1}>
                {selectedListingId ? t('help.craftPrefix', { title: selectedListingTitle }) : t('help.generalQuestion')}
              </Text>
              <MaterialCommunityIcons
                name={pickerOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.textMuted}
              />
            </TouchableOpacity>

            {/* Dropdown Options */}
            {pickerOpen && (
              <View style={styles.pickerDropdown}>
                <TouchableOpacity
                  style={[styles.pickerOption, selectedListingId === null && styles.pickerOptionActive]}
                  onPress={() => {
                    setSelectedListingId(null);
                    setPickerOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      selectedListingId === null && styles.pickerOptionTextActive,
                    ]}
                  >
                    {t('help.generalQuestion')}
                  </Text>
                  {selectedListingId === null && (
                    <MaterialCommunityIcons name="check" size={16} color={colors.primary} />
                  )}
                </TouchableOpacity>

                {(listings || []).map((l: Listing) => {
                  const title = l.catalogue?.catalogue?.title?.en || t('help.untitledCraft');
                  const isSelected = selectedListingId === l.id;
                  return (
                    <TouchableOpacity
                      key={l.id}
                      style={[styles.pickerOption, isSelected && styles.pickerOptionActive]}
                      onPress={() => {
                        setSelectedListingId(l.id);
                        setPickerOpen(false);
                      }}
                    >
                      <Text
                        style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextActive]}
                        numberOfLines={1}
                      >
                        {title} ({l.state.replace(/_/g, ' ')})
                      </Text>
                      {isSelected && (
                        <MaterialCommunityIcons name="check" size={16} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>{t('help.messageLabel')}</Text>
            <TextInput
              mode="outlined"
              multiline
              numberOfLines={isMessageFocused || messageText ? 7 : 4}
              value={messageText}
              onChangeText={setMessageText}
              onFocus={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setIsMessageFocused(true);
              }}
              onBlur={() => {
                if (!messageText.trim()) {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setIsMessageFocused(false);
                }
              }}
              placeholder={t('help.messagePlaceholder')}
              placeholderTextColor={colors.placeholder}
              textColor={colors.text}
              outlineColor={colors.border}
              activeOutlineColor={colors.primary}
              style={[
                styles.messageInput,
                { minHeight: isMessageFocused || messageText ? 150 : 96 },
              ]}
              contentStyle={[
                styles.messageInputContent,
                { textAlign: messageText ? 'left' : 'center' },
              ]}
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
            >
              {t('help.send')}
            </Button>
          </Card.Content>
        </Card>

        {/* Previous Inquiries Section */}
        <View style={styles.inquiriesHeader}>
          <Text style={styles.inquiriesTitle}>{t('help.previousTitle')}</Text>
        </View>

        {isLoadingMessages ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.lg }} />
        ) : !supportMessages || supportMessages.length === 0 ? (
          <View style={styles.emptyMessagesCard}>
            <Text style={styles.emptyMessagesText}>{t('help.noPrevious')}</Text>
          </View>
        ) : (
          supportMessages.map((msg: SupportMessage) => (
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
                  <View style={styles.msgHeader}>
                    <View style={styles.msgStatusPill}>
                      <Text style={styles.msgStatusText}>
                        {msg.status === 'open' ? t('help.statusOpen') : msg.status.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.msgDate}>
                      {msg.created_at ? new Date(msg.created_at).toLocaleDateString() : ''}
                    </Text>
                  </View>

                  {msg.listing_title && (
                    <View style={styles.msgAttachedListing}>
                      <MaterialCommunityIcons name="tag-outline" size={14} color={colors.secondary} />
                      <Text style={styles.msgAttachedText}>{t('help.craftPrefix', { title: msg.listing_title })}</Text>
                    </View>
                  )}

                  <Text style={styles.msgBody}>{msg.message}</Text>

                  <View style={styles.threadHintRow}>
                    <MaterialCommunityIcons name="chat-processing-outline" size={14} color={colors.primary} />
                    <Text style={styles.threadHintText}>View conversation & replies</Text>
                    <MaterialCommunityIcons name="chevron-right" size={16} color={colors.primary} />
                  </View>
                </Card.Content>
              </Card>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: spacing.md,
      paddingBottom: 100,
    },
    headerHero: {
      alignItems: 'center',
      marginBottom: spacing.md,
      paddingHorizontal: spacing.sm,
    },
    heroIconCircle: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.surfaceElevated,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    heroTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 4,
    },
    heroSubtitle: {
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 18,
    },
    feedbackBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 10,
      marginBottom: spacing.md,
    },
    feedbackSuccess: {
      backgroundColor: colors.successLight,
      borderWidth: 1,
      borderColor: colors.successBorder,
    },
    feedbackError: {
      backgroundColor: colors.errorLight,
      borderWidth: 1,
      borderColor: colors.errorBorder,
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
    formCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.lg,
      elevation: 2,
    },
    fieldLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textMuted,
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    pickerSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    pickerSelectorText: {
      flex: 1,
      fontSize: 14,
      color: colors.text,
      fontWeight: '500',
    },
    pickerDropdown: {
      marginTop: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    pickerOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pickerOptionActive: {
      backgroundColor: colors.surfaceElevated,
    },
    pickerOptionText: {
      fontSize: 13,
      color: colors.text,
      flex: 1,
    },
    pickerOptionTextActive: {
      fontWeight: '700',
      color: colors.primary,
    },
    messageInput: {
      backgroundColor: colors.surface,
      marginBottom: spacing.md,
    },
    messageInputContent: {
      paddingTop: 10,
      paddingBottom: 10,
    },
    submitBtn: {
      borderRadius: 10,
      paddingVertical: 2,
    },
    inquiriesHeader: {
      marginBottom: spacing.sm,
    },
    inquiriesTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    emptyMessagesCard: {
      padding: 24,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    emptyMessagesText: {
      fontSize: 13,
      color: colors.textMuted,
    },
    msgCard: {
      backgroundColor: colors.surface,
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
    msgStatusPill: {
      backgroundColor: colors.badgeNeutral,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
    },
    msgStatusText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.secondary,
    },
    msgDate: {
      fontSize: 11,
      color: colors.textMuted,
    },
    msgAttachedListing: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
    },
    msgAttachedText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.secondary,
      marginLeft: 4,
    },
    msgBody: {
      fontSize: 14,
      color: colors.text,
      lineHeight: 20,
    },
    threadHintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 10,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 5,
    },
    threadHintText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.primary,
      flex: 1,
    },
  });
}
