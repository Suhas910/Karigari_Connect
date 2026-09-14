import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated, Modal, Pressable, ScrollView } from 'react-native';
import { Text, Button, ActivityIndicator, IconButton } from 'react-native-paper';
import { useAudioRecorder, useAudioPlayer, RecordingPresets, AudioModule, setAudioModeAsync } from 'expo-audio';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArtisanStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { apiErrorOf } from '../../services/api';
import { getDraft, saveDraft } from '../../services/database';
import { colors, spacing } from '../../theme';
import { StepHeader, BottomDock } from '../../components';

const LANGUAGES = [
  { code: 'kn', native: 'ಕನ್ನಡ', label: 'Kannada (ಕನ್ನಡ)' },
  { code: 'hi', native: 'हिन्दी', label: 'Hindi (हिन्दी)' },
  { code: 'en', native: 'English', label: 'English' },
];

export default function SpeakScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'Speak'>>();
  const { draftId } = route.params;

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [audioMediaId, setAudioMediaId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const player = useAudioPlayer(audioUri);

  const glowAnim = useRef(new Animated.Value(0)).current;

  // Restore the preferred language, the recording and its transcription job from the draft
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      try {
        const draft = await getDraft(draftId);
        if (draft?.preferred_language && draft.preferred_language !== i18n.language) {
          await i18n.changeLanguage(draft.preferred_language);
        }
        if (draft?.payload?.audioUri) {
          setAudioUri(draft.payload.audioUri);
          setHasRecording(true);
        }
        if (draft?.payload?.audioMediaId) {
          setAudioMediaId(draft.payload.audioMediaId);
        }
        if (draft?.payload?.transcriptId) {
          setJobId(draft.payload.transcriptId);
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

  const currentLang = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  // Poll transcription job (contract: GET /jobs/{job_id}). Stops once it has finished either way.
  const { data: job } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => service.getJobStatus(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) =>
      query.state.data?.status === 'complete' || query.state.data?.status === 'failed' ? false : 1500,
  });
  const isProcessing = !!jobId && (!job || job.status === 'processing' || job.status === 'queued');
  const isFailed = job?.status === 'failed';
  const isComplete = job?.status === 'complete';

  const { data: jobResult } = useQuery({
    queryKey: ['jobResult', jobId],
    queryFn: () => service.getJobResult(jobId!),
    enabled: !!jobId && (isComplete || isFailed),
  });
  const transcriptText = jobResult?.original_text ?? jobResult?.transcript ?? null;
  const failure = jobResult?.error;
  const failureText = !isFailed
    ? null
    : failure?.code === 'ASR_LOW_CONFIDENCE'
    ? t('speak.noSpeech', 'We could not hear any speech. Please record again, closer to the phone.')
    : failure?.code === 'MEDIA_QUALITY_INSUFFICIENT'
    ? t('speak.unreadableRecording', 'This recording could not be read. Please record again.')
    : failure?.action === 'retry_later'
    ? t('speak.providerBusy', 'The service is busy. Your recording is saved. Try again in a minute.')
    : t('speak.transcriptionFailed');
  const canRetry =
    !!audioUri && !sending && !isRecording && ((isFailed && failure?.action === 'retry_later') || !!recordError);

  const persist = async (changes: Record<string, unknown>) => {
    try {
      const existing = await getDraft(draftId);
      await saveDraft({
        id: draftId,
        listing_id: existing?.listing_id ?? draftId,
        state: existing?.state ?? 'draft',
        preferred_language: i18n.language,
        payload: { ...(existing?.payload ?? {}), ...changes },
      });
    } catch (dbErr) {
      console.error('Failed to save recording to draft', dbErr);
    }
  };

  const handleSelectLanguage = async (code: string) => {
    await i18n.changeLanguage(code);
    setMenuVisible(false);
    setRecordError(null); // it was translated into the previous language
    try {
      const existing = await getDraft(draftId);
      await saveDraft({
        id: draftId,
        listing_id: existing?.listing_id ?? draftId,
        state: existing?.state ?? 'draft',
        preferred_language: code,
        payload: existing?.payload ?? {},
      });
    } catch (err) {
      console.error('Failed to update draft preferred_language', err);
    }
  };

  // Upload the recording (unless the server already has it), then transcribe it.
  const sendRecording = async (uri: string, mediaId: string | null) => {
    setRecordError(null);
    setSending(true);
    try {
      let id = mediaId;
      if (!id) {
        const uploaded = await service.uploadMedia(draftId, 'audio', {
          uri,
          name: uri.split('/').pop() || 'voice-note.m4a',
          type: 'audio/mp4',
        });
        id = uploaded.media_id;
        setAudioMediaId(id);
        await persist({ audioMediaId: id });
      }
      const res = await service.requestTranscription(draftId, {
        audio_media_id: id,
        declared_language: i18n.language,
      });
      setJobId(res.job_id);
      await persist({ transcriptId: res.job_id });
    } catch (err) {
      // Contract: PROVIDER_UNAVAILABLE -> keep the recording and offer a retry.
      const code = apiErrorOf(err)?.code;
      setRecordError(
        code === 'MEDIA_QUALITY_INSUFFICIENT'
          ? t('speak.unreadableRecording', 'This recording could not be read. Please record again.')
          : t('speak.processingError')
      );
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    setRecordError(null);
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        setRecordError(t('speak.micPermissionRequired'));
        return;
      }
      // iOS refuses to record until the audio session allows it; without this every
      // recording failed to start.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setJobId(null);
      setIsRecording(true);
    } catch (err) {
      console.warn('[Speak] Could not start recording', err);
      setRecordError(t('speak.startRecordingError'));
    }
  };

  const stopRecording = async () => {
    setRecordError(null);
    try {
      await recorder.stop();
      setIsRecording(false);
      // Back to playback mode, so "Play recording" uses the speaker, not the earpiece.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) {
        setRecordError(t('speak.processingError'));
        return;
      }
      setHasRecording(true);
      setAudioUri(uri);
      setAudioMediaId(null);
      await persist({ audioUri: uri, audioMediaId: null, transcriptId: null });
      await sendRecording(uri, null);
    } catch (err) {
      setIsRecording(false);
      setRecordError(t('speak.processingError'));
    }
  };

  const playRecording = async () => {
    await player.seekTo(0);
    player.play();
  };

  const handleContinue = () => {
    if (!jobId) return;
    navigation.navigate('ConfirmDetails', { draftId, transcriptId: jobId });
  };

  return (
    <View style={styles.container}>
      <StepHeader
        currentStep={3}
        totalSteps={5}
        title={t('speak.title')}
        subtitle={t('speak.subtitle')}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.guideCard}>
          <Text style={styles.guideTitle}>{t('speak.guideTitle')}</Text>
          <Text style={styles.guideItem}>• {t('speak.guideItemMaterials')}</Text>
          <Text style={styles.guideItem}>• {t('speak.guideItemLabour')}</Text>
          <Text style={styles.guideItem}>• {t('speak.guideItemTechnique')}</Text>
        </View>

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
              style={[styles.micBtn, isRecording && styles.micActive]}
              onPress={isRecording ? stopRecording : startRecording}
              disabled={isProcessing || sending}
              accessibilityRole="button"
              accessibilityLabel={isRecording ? t('speak.stop') : t('speak.start')}
            >
              <IconButton
                icon={isRecording ? 'stop' : 'microphone'}
                size={48}
                iconColor="#FFFFFF"
              />
            </TouchableOpacity>
          </View>

          <Text style={styles.statusText}>
            {isRecording
              ? t('speak.recordingActive')
              : hasRecording
              ? t('speak.recordingFinished')
              : t('speak.tapToRecord')}
          </Text>
        </View>

        {recordError && <Text style={styles.errorText}>{recordError}</Text>}
        {failureText && <Text style={styles.errorText}>{failureText}</Text>}

        {canRetry && (
          <Button
            mode="outlined"
            onPress={() => sendRecording(audioUri!, audioMediaId)}
            textColor={colors.text}
            style={styles.retryBtn}
            icon="refresh"
          >
            {t('speak.tryAgain', 'Try again')}
          </Button>
        )}

        {(isProcessing || sending) && (
          <View style={styles.processingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.processingText}>
              {sending ? t('speak.uploading', 'Sending your recording...') : t('speak.transcribing')}
            </Text>
          </View>
        )}

        {isComplete && transcriptText && (
          <View style={styles.transcriptCard}>
            <Text style={styles.guideTitle}>{t('speak.heardTitle', 'What we heard')}</Text>
            {jobResult?.adapter?.provider === 'fixture' && (
              <Text style={styles.demoText}>
                {t('speak.demoTranscript', 'Demo transcript: your recording was not listened to.')}
              </Text>
            )}
            <Text style={styles.transcriptText}>{transcriptText}</Text>
            {jobResult?.needs_replay && (
              <Text style={styles.guideItem}>
                {t('speak.replayHint', 'Listen to your recording and check the words. You can correct the details on the next screen.')}
              </Text>
            )}
            {audioUri && (
              <Button
                mode="outlined"
                onPress={playRecording}
                textColor={colors.text}
                style={styles.playBtn}
                icon="play"
              >
                {t('speak.playRecording', 'Play recording')}
              </Button>
            )}
          </View>
        )}
      </ScrollView>

      {/* Dedicated Language Selection Modal */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setMenuVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  {t('speak.languageLabel') || 'Select Voice Language'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  Choose the language you will record in
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

            <View style={styles.langList}>
              {LANGUAGES.map((lang) => {
                const isSelected = i18n.language === lang.code;
                return (
                  <TouchableOpacity
                    key={lang.code}
                    style={[styles.langOptionCard, isSelected && styles.langOptionSelected]}
                    onPress={() => handleSelectLanguage(lang.code)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.langOptionLeft}>
                      <Text
                        style={[
                          styles.langOptionNative,
                          isSelected && styles.langOptionNativeSelected,
                        ]}
                      >
                        {lang.native}
                      </Text>
                      <Text style={styles.langOptionLabel}>{lang.label}</Text>
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
              })}
            </View>

            <Button
              mode="outlined"
              onPress={() => setMenuVisible(false)}
              textColor={colors.text}
              style={styles.modalCloseBtn}
            >
              Done
            </Button>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Docked Action Footer */}
      <BottomDock>
        {isComplete ? (
          <View style={styles.dockCompleteContainer}>
            <Button
              mode="outlined"
              onPress={() => setMenuVisible(true)}
              textColor={colors.text}
              style={styles.langBtnCompact}
              contentStyle={{ height: 44 }}
              icon="translate"
            >
              {currentLang.native} ({currentLang.code.toUpperCase()})
            </Button>
            <Button
              mode="contained"
              onPress={handleContinue}
              buttonColor={colors.primary}
              textColor="#FFFFFF"
              style={styles.continueBtn}
              contentStyle={{ height: 48 }}
            >
              {t('speak.continueBtn')}
            </Button>
          </View>
        ) : (
          <Button
            mode="outlined"
            onPress={() => setMenuVisible(true)}
            textColor={colors.text}
            style={styles.langBtnStandalone}
            contentStyle={{ height: 48 }}
            icon="translate"
          >
            {t('speak.languageLabel')}: {currentLang.label}
          </Button>
        )}
      </BottomDock>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-between',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  guideCard: {
    width: '100%',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
  },
  guideTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  guideItem: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 20,
  },
  transcriptCard: {
    width: '100%',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.indigoBorder,
    marginTop: spacing.md,
  },
  demoText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.error,
    marginBottom: spacing.xs,
  },
  transcriptText: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
    marginBottom: spacing.xs,
  },
  playBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderColor: colors.border,
  },
  retryBtn: {
    marginTop: spacing.sm,
    borderRadius: 8,
    borderColor: colors.border,
  },
  micSection: {
    alignItems: 'center',
    marginVertical: spacing.md,
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
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  micActive: {
    backgroundColor: colors.secondary,
  },
  statusText: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.md,
    fontWeight: '500',
  },
  dockCompleteContainer: {
    gap: spacing.sm,
  },
  langBtnCompact: {
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  langBtnStandalone: {
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
  },
  continueBtn: {
    width: '100%',
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
    borderRadius: 8,
  },
  errorText: {
    color: colors.error,
    textAlign: 'center',
    fontSize: 13,
    marginTop: spacing.sm,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  processingText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  // Language Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.52)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    elevation: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  langList: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  langOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  langOptionSelected: {
    borderColor: colors.secondary,
    backgroundColor: colors.indigoLight,
  },
  langOptionLeft: {
    flex: 1,
  },
  langOptionNative: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  langOptionNativeSelected: {
    color: colors.secondary,
  },
  langOptionLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
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
    borderColor: colors.border,
    borderRadius: 8,
  },
});
