// src/features/help/HelpScreen.tsx
import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, TextInput, Button, Card, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { service } from '../../services';
import { colors, spacing } from '../../theme';
import type { Listing, SupportMessage } from '../../types/contracts';

export default function HelpScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
              color={feedback.type === 'success' ? '#166534' : colors.error}
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
              numberOfLines={5}
              value={messageText}
              onChangeText={setMessageText}
              placeholder={t('help.messagePlaceholder')}
              outlineColor={colors.border}
              activeOutlineColor={colors.primary}
              style={styles.messageInput}
            />

            <Button
              mode="contained"
              onPress={handleSubmit}
              loading={submitMutation.isPending}
              disabled={submitMutation.isPending || !messageText.trim()}
              buttonColor={colors.primary}
              textColor="#FFFFFF"
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
            <Card key={msg.id} style={styles.msgCard}>
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
              </Card.Content>
            </Card>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: '#F3F4F6',
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
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  feedbackError: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  feedbackText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  feedbackSuccessText: {
    color: '#166534',
  },
  feedbackErrorText: {
    color: colors.error,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
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
    backgroundColor: '#FFFFFF',
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
    backgroundColor: '#F3F4F6',
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
    backgroundColor: '#FFFFFF',
    marginBottom: spacing.md,
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
    backgroundColor: '#FFFFFF',
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
});
