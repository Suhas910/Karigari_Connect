import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Modal,
  Pressable,
  FlatList,
  Platform,
} from 'react-native';
import { Text, Button, ActivityIndicator, IconButton, TextInput, Chip } from 'react-native-paper';
import { useAudioRecorder, RecordingPresets, AudioModule } from 'expo-audio';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArtisanStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { getDraft, saveDraft } from '../../services/database';
import { useAppTheme, spacing, type ColorPalette } from '../../theme';
import { StepHeader, BottomDock } from '../../components';
import { SCHEDULED_LANGUAGES, POPULAR_LANGUAGES, type ScheduledLanguage } from '../../constants/languages';
import { getSpeakTranslations } from '../../constants/speakTranslations';

const MAX_RECORDING_SECONDS = 60;

export default function SpeakScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'Speak'>>();
  const { draftId } = route.params;
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);

  // Selected language state (defaults to i18n language or Hindi/Kannada/English)
  const [selectedLanguageCode, setSelectedLanguageCode] = useState<string>(() => {
    return i18n.language || 'hi';
  });

  // Search filter for language modal
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'popular'>('all');

  const [glowAnim] = useState(() => new Animated.Value(0));

  // Sync draft's preferred language and existing recording on load
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      try {
        const draft = await getDraft(draftId);
        const targetLang = draft?.payload?.userSelectedLanguage
          ? draft.preferred_language
          : (draft?.preferred_language || i18n.language || 'hi');

        if (targetLang) {
          setSelectedLanguageCode(targetLang);
        }

        if (draft?.payload?.transcriptId) {
          setJobId(draft.payload.transcriptId);
          setHasRecording(true);
        }
      } catch (err) {
        console.error('Failed to sync preferred language or recording from draft', err);
      }
    })();
  }, [draftId]);

  // Pulsing glow animation loop while recording
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (isRecording) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 900,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      glowAnim.stopAnimation();
      glowAnim.setValue(0);
    }
    return () => {
      animation?.stop();
    };
  }, [isRecording]);

  const glowScale1 = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.28],
  });
  const glowOpacity1 = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 0.12],
  });

  const glowScale2 = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.1, 1.5],
  });
  const glowOpacity2 = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.04],
  });

  // Resolve current active language object
  const currentLang = useMemo(() => {
    return (
      SCHEDULED_LANGUAGES.find((l) => l.code === selectedLanguageCode) ||
      SCHEDULED_LANGUAGES.find((l) => l.code === 'hi') ||
      SCHEDULED_LANGUAGES[0]
    );
  }, [selectedLanguageCode]);

  // Page-scoped translation strings matching selected voice language
  const speakText = useMemo(() => {
    return getSpeakTranslations(selectedLanguageCode);
  }, [selectedLanguageCode]);

  // Filtered languages for modal search
  const filteredLanguages = useMemo(() => {
    const list = activeTab === 'popular' ? POPULAR_LANGUAGES : SCHEDULED_LANGUAGES;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.native.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q) ||
        l.script.toLowerCase().includes(q)
    );
  }, [searchQuery, activeTab]);

  // Poll transcription job — contract: GET /jobs/{job_id}
  const { data: job } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => service.getJobStatus(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'complete' || status === 'failed' ? false : 2000;
    },
  });

  const isProcessing = !!jobId && (!job || job.status === 'processing' || job.status === 'queued');
  const isProcessingCombined = isUploading || isProcessing;
  const isFailed = job?.status === 'failed';
  const isComplete = job?.status === 'complete';

  // Format seconds as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleSelectLanguage = async (code: string) => {
    setSelectedLanguageCode(code);
    setMenuVisible(false);
    setSearchQuery('');
    try {
      const existing = await getDraft(draftId);
      await saveDraft({
        id: draftId,
        listing_id: existing?.listing_id ?? draftId,
        state: existing?.state ?? 'draft',
        preferred_language: code,
        payload: {
          ...(existing?.payload ?? {}),
          userSelectedLanguage: true,
        },
      });
    } catch (err) {
      console.error('Failed to update draft preferred_language', err);
    }
  };

  const startRecording = async () => {
    if (isProcessingCombined) return;
    setRecordError(null);
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        setRecordError(speakText.micPermissionRequired);
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
    } catch (err) {
      setRecordError(speakText.startRecordingError);
    }
  };

  const stopRecording = async () => {
    if (isUploading) return;
    setRecordError(null);
    setIsUploading(true);
    try {
      await recorder.stop();
      setIsRecording(false);
      setHasRecording(true);
      const recordedUri = recorder.uri;

      const res = await service.requestTranscription(draftId, {
        audioUri: recordedUri || undefined,
        audio_media_id: 'audio_recorded',
        declared_language: selectedLanguageCode,
      });
      setJobId(res.job_id);

      try {
        const existing = await getDraft(draftId);
        await saveDraft({
          id: draftId,
          listing_id: existing?.listing_id ?? draftId,
          state: existing?.state ?? 'draft',
          preferred_language: selectedLanguageCode,
          payload: {
            ...(existing?.payload ?? {}),
            audioUri: recordedUri || existing?.payload?.audioUri,
            transcriptId: res.job_id,
          },
        });
      } catch (dbErr) {
        console.error('Failed to save audioUri/transcriptId to draft', dbErr);
      }
    } catch (err) {
      setHasRecording(false);
      setRecordError(speakText.processingError);
    } finally {
      setIsUploading(false);
    }
  };

  // Timer: count seconds during recording, auto-stop at 60s
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } else {
      setRecordingDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  useEffect(() => {
    if (isRecording && recordingDuration >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [isRecording, recordingDuration]);

  // Clean up recording if unmounted while recording
  useEffect(() => {
    return () => {
      try {
        if (recorder && recorder.isRecording) {
          recorder.stop().catch(() => {});
        }
      } catch {
        // Native shared object may have been released automatically by useReleasingSharedObject
      }
    };
  }, [recorder]);

  const handleContinue = () => {
    navigation.navigate('ConfirmDetails', {
      draftId,
      transcriptId: jobId ?? 'transcript_uuid',
      declared_language: selectedLanguageCode,
    });
  };

  return (
    <View style={styles.container}>
      <StepHeader
        currentStep={3}
        totalSteps={5}
        title={speakText.title}
        subtitle={speakText.subtitle}
      />

      <View style={styles.content}>
        {/* Selected Language Indicator Banner / Pill */}
        <TouchableOpacity
          style={styles.languageSelectorBar}
          onPress={() => setMenuVisible(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Language: ${currentLang.name}`}
        >
          <View style={styles.langPillBadge}>
            <IconButton icon="translate" size={16} iconColor={colors.secondary} style={{ margin: 0 }} />
            <Text style={styles.langPillCode}>{currentLang.code.toUpperCase()}</Text>
          </View>
          <View style={styles.langSelectorTextWrap}>
            <Text style={styles.langSelectorTitle}>
              {currentLang.native} <Text style={styles.langSelectorSub}>({currentLang.name})</Text>
            </Text>
            <Text style={styles.langBhashiniHint}>{speakText.bhashiniBadge}</Text>
          </View>
          <IconButton icon="chevron-down" size={20} iconColor={colors.secondary} style={{ margin: 0 }} />
        </TouchableOpacity>

        {/* What to Mention Guide Card */}
        <View style={styles.guideCard}>
          <View style={styles.guideCardHeader}>
            <IconButton icon="lightbulb-outline" size={18} iconColor={colors.primary} style={{ margin: 0, marginRight: 6 }} />
            <Text style={styles.guideTitle}>{speakText.guideTitle}</Text>
          </View>
          <View style={styles.guideItemsContainer}>
            <View style={styles.guideItemRow}>
              <View style={styles.guideBullet} />
              <Text style={styles.guideItem}>{speakText.guideItemMaterials}</Text>
            </View>
            <View style={styles.guideItemRow}>
              <View style={styles.guideBullet} />
              <Text style={styles.guideItem}>{speakText.guideItemLabour}</Text>
            </View>
            <View style={styles.guideItemRow}>
              <View style={styles.guideBullet} />
              <Text style={styles.guideItem}>{speakText.guideItemTechnique}</Text>
            </View>
          </View>
        </View>

        {/* Microphone Section */}
        <View style={styles.micSection}>
          <View style={styles.micWrapper}>
            {isRecording && (
              <>
                <Animated.View
                  style={[
                    styles.glowRingOuter,
                    {
                      transform: [{ scale: glowScale2 }],
                      opacity: glowOpacity2,
                    },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.glowRingInner,
                    {
                      transform: [{ scale: glowScale1 }],
                      opacity: glowOpacity1,
                    },
                  ]}
                />
              </>
            )}

            <TouchableOpacity
              style={[
                styles.micBtn,
                isRecording && styles.micActive,
                isProcessingCombined && styles.micDisabled,
              ]}
              onPress={isRecording ? stopRecording : startRecording}
              disabled={isProcessingCombined}
              accessibilityRole="button"
              accessibilityLabel={isRecording ? t('speak.stop') : t('speak.start')}
            >
              <IconButton
                icon={isRecording ? 'stop' : 'microphone'}
                size={46}
                iconColor={colors.onPrimary}
              />
            </TouchableOpacity>
          </View>

          {/* Status Message */}
          <Text style={[styles.statusText, isRecording && styles.statusTextActive]}>
            {isRecording
              ? speakText.recordingActive
              : hasRecording
              ? speakText.recordingFinished
              : speakText.tapToRecord}
          </Text>

          {/* Recording Timer */}
          {isRecording && (
            <View style={styles.timerContainer}>
              <View style={styles.timerPill}>
                <View style={styles.recordingRedDot} />
                <Text style={[styles.timerText, recordingDuration >= 50 && styles.timerWarning]}>
                  {formatTime(recordingDuration)} / 01:00
                </Text>
              </View>
              {recordingDuration >= 50 && (
                <Text style={styles.timerWarningHint}>
                  {speakText.approachingLimit}
                </Text>
              )}
            </View>
          )}

          {/* Processing / Transcribing State */}
          {isProcessingCombined && (
            <View style={styles.processingCard}>
              <ActivityIndicator size="small" color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.processingTitle}>{speakText.transcribing}</Text>
                <Text style={styles.processingSubtitle}>
                  {currentLang.native} ({currentLang.name}) → English Catalogue
                </Text>
              </View>
            </View>
          )}

          {/* Error Message */}
          {recordError && (
            <View style={styles.errorBox}>
              <IconButton icon="alert-circle" size={18} iconColor={colors.error} style={{ margin: 0, marginRight: 4 }} />
              <Text style={styles.errorText}>{recordError}</Text>
            </View>
          )}

          {/* Transcription Failed Notice */}
          {isFailed && (
            <View style={styles.errorBox}>
              <IconButton icon="alert-circle" size={18} iconColor={colors.error} style={{ margin: 0, marginRight: 4 }} />
              <Text style={styles.errorText}>{speakText.transcriptionFailed}</Text>
            </View>
          )}
        </View>
      </View>

      {/* 22 Scheduled Languages Searchable Modal */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setMenuVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, paddingRight: spacing.sm }}>
                <Text style={styles.modalTitle}>
                  {speakText.selectVoiceLanguage}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {speakText.chooseDialect}
                </Text>
              </View>
              <IconButton
                icon="close"
                size={22}
                onPress={() => setMenuVisible(false)}
                iconColor={colors.text}
                style={{ margin: 0 }}
              />
            </View>

            {/* Search Input with Clear High Contrast */}
            <View style={styles.searchWrapper}>
              <TextInput
                mode="outlined"
                placeholder={speakText.searchLanguage}
                placeholderTextColor={colors.placeholder}
                textColor={colors.text}
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={styles.searchInput}
                outlineColor={colors.inputBorder}
                activeOutlineColor={colors.secondary}
                left={<TextInput.Icon icon="magnify" color={colors.textMuted} />}
                right={
                  searchQuery ? (
                    <TextInput.Icon icon="close-circle" onPress={() => setSearchQuery('')} color={colors.textMuted} />
                  ) : null
                }
              />
            </View>

            {/* Filter Tabs: Quick Picks vs All 22 */}
            <View style={styles.tabRow}>
              <Chip
                selected={activeTab === 'all'}
                onPress={() => setActiveTab('all')}
                style={[styles.filterChip, activeTab === 'all' && styles.filterChipActive]}
                textStyle={[styles.filterChipText, activeTab === 'all' && styles.filterChipTextActive]}
              >
                {speakText.allScheduledLanguages}
              </Chip>
              <Chip
                selected={activeTab === 'popular'}
                onPress={() => setActiveTab('popular')}
                style={[styles.filterChip, activeTab === 'popular' && styles.filterChipActive]}
                textStyle={[styles.filterChipText, activeTab === 'popular' && styles.filterChipTextActive]}
              >
                {speakText.popularLanguages}
              </Chip>
            </View>

            {/* List of 22 Scheduled Languages */}
            <FlatList
              data={filteredLanguages}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              style={styles.langFlatList}
              contentContainerStyle={{ paddingBottom: spacing.md }}
              renderItem={({ item }) => {
                const isSelected = selectedLanguageCode === item.code;
                return (
                  <TouchableOpacity
                    style={[styles.langOptionCard, isSelected && styles.langOptionSelected]}
                    onPress={() => handleSelectLanguage(item.code)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.langOptionLeft}>
                      <View style={styles.langNameRow}>
                        <Text
                          style={[
                            styles.langOptionNative,
                            isSelected && styles.langOptionNativeSelected,
                          ]}
                        >
                          {item.native}
                        </Text>
                        <View style={styles.langCodeBadge}>
                          <Text style={styles.langCodeBadgeText}>{item.code.toUpperCase()}</Text>
                        </View>
                      </View>
                      <Text style={styles.langOptionLabel}>
                        {item.name} · <Text style={styles.langScriptText}>{item.script}</Text>
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.radioCircle,
                        isSelected && styles.radioCircleSelected,
                      ]}
                    >
                      {isSelected && <View style={styles.radioDot} />}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />

            <Button
              mode="contained"
              onPress={() => setMenuVisible(false)}
              buttonColor={colors.secondary}
              textColor={colors.onPrimary}
              style={styles.modalCloseBtn}
            >
              {t('common.done')}
            </Button>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Docked Action Footer - Appears once recording & transcription are complete */}
      {isComplete && (
        <BottomDock>
          <View style={styles.dockCompleteContainer}>
            <View style={styles.successRecordedBanner}>
              <IconButton icon="check-circle" size={18} iconColor={colors.successGreen} style={{ margin: 0, marginRight: 6 }} />
              <Text style={styles.successRecordedText}>
                {currentLang.native} ({currentLang.name}) {speakText.audioTranscribedLabel}
              </Text>
            </View>
            <View style={styles.dockActionButtonsRow}>
              <Button
                mode="outlined"
                onPress={startRecording}
                textColor={colors.text}
                style={styles.reRecordBtn}
                contentStyle={{ height: 48 }}
                icon="microphone"
              >
                {speakText.reRecord}
              </Button>
              <Button
                mode="contained"
                onPress={handleContinue}
                buttonColor={colors.primary}
                textColor={colors.onPrimary}
                style={styles.continueBtn}
                contentStyle={{ height: 48 }}
                icon="arrow-right"
              >
                {speakText.continueBtn}
              </Button>
            </View>
          </View>
        </BottomDock>
      )}
    </View>
  );
}

function createStyles(colors: ColorPalette, isDark: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: 'space-between',
    },
    content: {
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
    },

    // Language Selector Bar
    languageSelectorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: colors.indigoBorder,
      paddingHorizontal: 14,
      paddingVertical: 10,
      width: '100%',
      marginBottom: spacing.md,
      elevation: 2,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 3,
    },
    langPillBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.indigoLight,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
      marginRight: 10,
    },
    langPillCode: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.secondary,
      marginLeft: 2,
    },
    langSelectorTextWrap: {
      flex: 1,
    },
    langSelectorTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    langSelectorSub: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textMuted,
    },
    langBhashiniHint: {
      fontSize: 11,
      color: colors.secondary,
      fontWeight: '600',
      marginTop: 1,
    },

    // Guide Card
    guideCard: {
      width: '100%',
      backgroundColor: isDark ? colors.surfaceElevated : '#FAF9F6',
      padding: spacing.md,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.lg,
    },
    guideCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    guideTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: 0.3,
    },
    guideItemsContainer: {
      gap: 4,
      paddingLeft: 4,
    },
    guideItemRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    guideBullet: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: colors.primary,
      marginRight: 8,
    },
    guideItem: {
      fontSize: 13,
      color: colors.text,
      lineHeight: 19,
    },

    // Microphone Section
    micSection: {
      alignItems: 'center',
      marginVertical: spacing.sm,
      width: '100%',
    },
    micWrapper: {
      width: 150,
      height: 150,
      justifyContent: 'center',
      alignItems: 'center',
    },
    glowRingOuter: {
      position: 'absolute',
      width: 150,
      height: 150,
      borderRadius: 75,
      backgroundColor: colors.secondary,
    },
    glowRingInner: {
      position: 'absolute',
      width: 124,
      height: 124,
      borderRadius: 62,
      backgroundColor: colors.secondary,
    },
    micBtn: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 6,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
    },
    micActive: {
      backgroundColor: colors.secondary,
    },
    micDisabled: {
      opacity: 0.5,
    },
    statusText: {
      color: colors.textMuted,
      fontSize: 14,
      marginTop: spacing.md,
      fontWeight: '600',
    },
    statusTextActive: {
      color: colors.secondary,
      fontWeight: '700',
    },
    timerContainer: {
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    timerPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.errorLight,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.errorBorder,
    },
    recordingRedDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.error,
      marginRight: 6,
    },
    timerText: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.error,
    },
    timerWarning: {
      color: colors.error,
    },
    timerWarningHint: {
      fontSize: 12,
      color: colors.error,
      marginTop: 3,
      fontWeight: '600',
    },

    // Processing Card
    processingCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.indigoLight,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.indigoBorder,
      marginTop: spacing.md,
      gap: 12,
      width: '100%',
    },
    processingTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.secondary,
    },
    processingSubtitle: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 2,
    },

    // Error Box
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.errorLight,
      borderWidth: 1,
      borderColor: colors.errorBorder,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      marginTop: spacing.md,
      width: '100%',
    },
    errorText: {
      color: colors.error,
      fontSize: 13,
      fontWeight: '600',
      flex: 1,
    },

    // Dock Action Footer
    dockCompleteContainer: {
      gap: spacing.sm,
      width: '100%',
    },
    successRecordedBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.successLight,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      justifyContent: 'center',
    },
    successRecordedText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.successGreen,
    },
    dockActionButtonsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    reRecordBtn: {
      flex: 1,
      borderColor: colors.inputBorder,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    continueBtn: {
      flex: 2,
      borderRadius: 10,
    },

    // Modal Styles
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    modalCard: {
      width: '100%',
      maxHeight: '85%',
      backgroundColor: colors.surfaceElevated,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      elevation: 20,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: spacing.sm,
    },
    modalTitle: {
      fontSize: 19,
      fontWeight: '800',
      color: colors.text,
    },
    modalSubtitle: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
      lineHeight: 16,
    },
    searchWrapper: {
      marginVertical: spacing.sm,
    },
    searchInput: {
      backgroundColor: colors.surface,
      fontSize: 14,
      height: 46,
    },
    tabRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: spacing.sm,
    },
    filterChip: {
      backgroundColor: colors.badgeNeutral,
      borderRadius: 8,
    },
    filterChipActive: {
      backgroundColor: colors.indigoLight,
      borderWidth: 1,
      borderColor: colors.secondary,
    },
    filterChipText: {
      fontSize: 12,
      color: colors.textMuted,
      fontWeight: '600',
    },
    filterChipTextActive: {
      color: colors.secondary,
      fontWeight: '700',
    },
    langFlatList: {
      maxHeight: 340,
      marginVertical: spacing.xs,
    },
    langOptionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 12,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginBottom: 8,
    },
    langOptionSelected: {
      borderColor: colors.secondary,
      backgroundColor: colors.indigoLight,
    },
    langOptionLeft: {
      flex: 1,
    },
    langNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    langOptionNative: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 2,
    },
    langOptionNativeSelected: {
      color: colors.secondary,
    },
    langCodeBadge: {
      backgroundColor: colors.badgeNeutral,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    langCodeBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.badgeNeutralText,
    },
    langOptionLabel: {
      fontSize: 12,
      color: colors.textMuted,
    },
    langScriptText: {
      color: colors.secondary,
      fontWeight: '500',
    },
    radioCircle: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: colors.inputBorder,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: spacing.sm,
    },
    radioCircleSelected: {
      borderColor: colors.secondary,
    },
    radioDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.secondary,
    },
    modalCloseBtn: {
      borderRadius: 10,
      marginTop: spacing.xs,
    },
  });
}