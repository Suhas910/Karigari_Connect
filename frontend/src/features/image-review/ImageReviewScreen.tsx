// src/features/image-review/ImageReviewScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Image, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Button, ProgressBar, IconButton } from 'react-native-paper';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArtisanStackParamList } from '../../types/navigation';
import { useQuery } from '@tanstack/react-query';
import { service } from '../../services';
import { getDraft, saveDraft } from '../../services/database';
import { colors, spacing } from '../../theme';
import { StepHeader, BottomDock } from '../../components';

export default function ImageReviewScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, 'ImageReview'>>();
  const { draftId } = route.params;

  const [jobId, setJobId] = useState<string | null>(null);
  const [kickoffError, setKickoffError] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState<'enhanced' | 'original' | 'side_by_side'>('enhanced');
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [coverIndex, setCoverIndex] = useState<number>(0);

  // 1. Load photos from draft on mount
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      try {
        const draft = await getDraft(draftId);
        if (draft?.payload?.photos && Array.isArray(draft.payload.photos) && draft.payload.photos.length > 0) {
          setPhotos(draft.payload.photos);
          if (typeof draft.payload.coverIndex === 'number' && draft.payload.coverIndex < draft.payload.photos.length) {
            setCoverIndex(draft.payload.coverIndex);
          }
        } else {
          setPhotos([]);
        }
      } catch (err) {
        console.error('Failed to load photos in ImageReviewScreen', err);
      }
    })();
  }, [draftId]);

  // 2. Kick off image analysis once photos are loaded or on screen mount
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      try {
        const draft = await getDraft(draftId);
        const currentPhotos: string[] = draft?.payload?.photos || [];
        const mediaIds: Record<string, string> = draft?.payload?.photoMediaIds || {};
        const cover = typeof draft?.payload?.coverIndex === 'number' ? draft.payload.coverIndex : 0;
        // The server analyses a photo it has received, so it needs that photo's media id.
        const mediaId = mediaIds[currentPhotos[cover]] ?? currentPhotos.map((uri) => mediaIds[uri]).find(Boolean);
        if (!mediaId) {
          setKickoffError('Your photos have not uploaded yet. Go back to the camera and continue again.');
          return;
        }
        const result = await service.requestImageAnalysis(draftId, { media_id: mediaId });
        setJobId(result.job_id);
      } catch (err) {
        setKickoffError('Could not start photo processing. Check connection and try again.');
      }
    })();
  }, [draftId]);

  // 3. Poll job status — simulates upload (queued) -> AI studio processing -> complete
  const { data: job } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => service.getJobStatus(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === 'complete' ? false : 1000),
  });

  // 4. Query backend for studio results on complete status
  const {
    data: jobResult,
    isLoading: isFetchingResult,
    isError: isResultError,
  } = useQuery({
    queryKey: ['imageJobResult', jobId],
    queryFn: () => service.getImageJobResult(jobId!),
    enabled: !!jobId && job?.status === 'complete',
  });

  // 5. Persist imageAccepted flag and studio results on successful completion
  useEffect(() => {
    if (jobResult && jobResult.status === 'complete' && draftId) {
      (async () => {
        try {
          const existing = await getDraft(draftId);
          await saveDraft({
            id: draftId,
            listing_id: existing?.listing_id ?? draftId,
            state: existing?.state ?? 'draft',
            preferred_language: existing?.preferred_language ?? 'kn',
            payload: {
              ...(existing?.payload ?? {}),
              photos,
              coverIndex,
              imageAccepted: true,
              enhancedPhotos: jobResult.enhanced_urls || [jobResult.enhanced_url],
              qualityMetrics: jobResult.quality,
            },
          });
        } catch (dbErr) {
          console.error('Failed to update draft payload in ImageReview', dbErr);
        }
      })();
    }
  }, [jobResult, draftId, photos, coverIndex]);

  const isJobRunning = !kickoffError && (!job || job.status === 'processing' || job.status === 'queued');
  const isProcessing = isJobRunning || (job?.status === 'complete' && isFetchingResult && !jobResult);
  const isFailed = kickoffError || job?.status === 'failed' || isResultError;

  const handleRetake = () => {
    navigation.goBack();
  };

  const handleRemovePhoto = async (indexToRemove: number) => {
    const updated = photos.filter((_, idx) => idx !== indexToRemove);
    setPhotos(updated);
    if (selectedIndex >= updated.length) {
      setSelectedIndex(Math.max(0, updated.length - 1));
    }
    if (coverIndex === indexToRemove) {
      setCoverIndex(0);
    } else if (coverIndex > indexToRemove) {
      setCoverIndex(coverIndex - 1);
    }
    try {
      const existing = await getDraft(draftId);
      await saveDraft({
        id: draftId,
        listing_id: existing?.listing_id ?? draftId,
        state: existing?.state ?? 'draft',
        preferred_language: existing?.preferred_language ?? 'kn',
        payload: {
          ...(existing?.payload ?? {}),
          photos: updated,
        },
      });
    } catch (dbErr) {
      console.error('Failed to update draft photos on removal', dbErr);
    }
  };

  const handleSetCover = async (idx: number) => {
    setCoverIndex(idx);
    try {
      const existing = await getDraft(draftId);
      await saveDraft({
        id: draftId,
        listing_id: existing?.listing_id ?? draftId,
        state: existing?.state ?? 'draft',
        preferred_language: existing?.preferred_language ?? 'kn',
        payload: {
          ...(existing?.payload ?? {}),
          coverIndex: idx,
        },
      });
    } catch (dbErr) {
      console.error('Failed to persist cover photo index', dbErr);
    }
  };

  const handleContinue = async () => {
    try {
      const existing = await getDraft(draftId);
      await saveDraft({
        id: draftId,
        listing_id: existing?.listing_id ?? draftId,
        state: existing?.state ?? 'draft',
        preferred_language: existing?.preferred_language ?? 'kn',
        payload: {
          ...(existing?.payload ?? {}),
          photos,
          coverIndex,
          imageAccepted: true,
          enhancedPhotos: jobResult?.enhanced_urls || (jobResult?.enhanced_url ? [jobResult.enhanced_url] : []),
        },
      });
    } catch (dbErr) {
      console.error('Failed to update draft payload in handleContinue', dbErr);
    }
    navigation.navigate('Speak', { draftId });
  };

  // --- Processing Screen ---
  if (isProcessing) {
    const isQueued = !job || job.status === 'queued';
    const isStudioActive = job?.status === 'processing';
    const isFetching = job?.status === 'complete' && !jobResult;

    const progressValue = isQueued ? 0.35 : isStudioActive ? 0.75 : 0.95;
    const stageTitle = isQueued
      ? `Uploading ${photos.length} Photo${photos.length > 1 ? 's' : ''}...`
      : isStudioActive
      ? 'Processing Photos...'
      : 'Loading Review...';

    const stageSubtitle = isQueued
      ? 'Uploading camera captures to server'
      : isStudioActive
      ? 'AI image enhancement in progress'
      : 'Finalizing review';

    return (
      <View style={styles.processingContainer}>
        <StepHeader
          currentStep={2}
          totalSteps={5}
          title="Review Photos"
          subtitle="Processing"
        />

        <View style={styles.processingCenterWrapper}>
          <View style={styles.processingCard}>
            <Text style={styles.processingHeader}>{stageTitle}</Text>
            <Text style={styles.processingSub}>{stageSubtitle}</Text>

            <ProgressBar
              progress={progressValue}
              color={colors.secondary}
              style={styles.progressBar}
            />

            <View style={styles.stagesList}>
              <View style={styles.stageItem}>
                <View style={[styles.stageDot, !isQueued && styles.stageDotDone]} />
                <Text style={[styles.stageItemText, !isQueued && styles.stageItemDone]}>
                  1. Upload camera photos ({photos.length})
                </Text>
              </View>

              <View style={styles.stageItem}>
                <View style={[styles.stageDot, (isStudioActive || isFetching) && styles.stageDotActive, isFetching && styles.stageDotDone]} />
                <Text style={[styles.stageItemText, isFetching && styles.stageItemDone, isStudioActive && styles.stageItemCurrent]}>
                  2. AI enhancement
                </Text>
              </View>

              <View style={styles.stageItem}>
                <View style={[styles.stageDot, isFetching && styles.stageDotActive]} />
                <Text style={[styles.stageItemText, isFetching && styles.stageItemCurrent]}>
                  3. Finalize
                </Text>
              </View>
            </View>

            <Button
              mode="outlined"
              onPress={handleRetake}
              style={styles.cancelBtn}
              textColor={colors.textMuted}
            >
              Cancel & Retake
            </Button>
          </View>
        </View>
      </View>
    );
  }

  // --- Failure Screen ---
  if (isFailed) {
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>{kickoffError || 'Something went wrong processing your photos.'}</Text>
        <Button mode="contained" onPress={handleRetake} style={styles.retakeBtn} buttonColor={colors.primary}>
          Retake Photos
        </Button>
      </View>
    );
  }

  // --- Results Screen ---
  const enhancedPhotos = jobResult?.enhanced_urls && jobResult.enhanced_urls.length > 0
    ? jobResult.enhanced_urls
    : (jobResult?.enhanced_url ? [jobResult.enhanced_url] : []);

  const activeOriginalUri = photos[selectedIndex] || '';
  const activeEnhancedUri = (enhancedPhotos[selectedIndex] || jobResult?.enhanced_url || '').trim();
  // Only a real image URL. The legacy image job returns strings built by appending query
  // parameters to the original's path, which point at nothing.
  const hasEnhancedPhoto = /^https?:\/\//.test(activeEnhancedUri);
  const isCurrentCover = selectedIndex === coverIndex;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <StepHeader
        currentStep={2}
        totalSteps={5}
        title="Review Photos"
        subtitle={`Review ${photos.length} captured angle${photos.length > 1 ? 's' : ''} & pick primary cover`}
      />

      {/* Multi-Photo Horizontal Selector Strip */}
      <View style={styles.selectorContainer}>
        <View style={styles.selectorHeader}>
          <Text style={styles.selectorTitle}>Captured Angles ({photos.length})</Text>
          <Text style={styles.selectorHint}>Tap angle to inspect</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbStrip}
        >
          {photos.map((uri, idx) => {
            const isSelected = idx === selectedIndex;
            const isCover = idx === coverIndex;

            return (
              <TouchableOpacity
                key={idx}
                onPress={() => setSelectedIndex(idx)}
                style={[styles.thumbCard, isSelected && styles.thumbCardSelected]}
                accessibilityRole="button"
                accessibilityLabel={`Select photo ${idx + 1}`}
              >
                <Image source={{ uri }} style={styles.stripThumbImage} />
                {isCover && (
                  <View style={styles.coverPill}>
                    <Text style={styles.coverPillText}>COVER</Text>
                  </View>
                )}
                <View style={[styles.indexPill, isSelected && styles.indexPillActive]}>
                  <Text style={[styles.indexPillText, isSelected && styles.indexPillTextActive]}>
                    {idx + 1}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* 3-Way Segmented Comparison Toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, selectedView === 'enhanced' && styles.toggleBtnActive]}
          onPress={() => setSelectedView('enhanced')}
          accessibilityRole="button"
        >
          <Text style={[styles.toggleText, selectedView === 'enhanced' && styles.toggleTextActive]}>
            Cleaned Studio
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toggleBtn, selectedView === 'original' && styles.toggleBtnActive]}
          onPress={() => setSelectedView('original')}
          accessibilityRole="button"
        >
          <Text style={[styles.toggleText, selectedView === 'original' && styles.toggleTextActive]}>
            Original Camera
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toggleBtn, selectedView === 'side_by_side' && styles.toggleBtnActive]}
          onPress={() => setSelectedView('side_by_side')}
          accessibilityRole="button"
        >
          <Text style={[styles.toggleText, selectedView === 'side_by_side' && styles.toggleTextActive]}>
            Side by Side
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Preview: Single View or Side-by-Side View */}
      {selectedView === 'side_by_side' ? (
        <View style={styles.sideBySideRow}>
          {/* Left: Original Camera View */}
          <View style={styles.sideCard}>
            <View style={styles.sideHeader}>
              <Text style={styles.sideHeaderText}>Original Camera</Text>
            </View>
            <Image source={{ uri: activeOriginalUri }} style={styles.sideImage} />
          </View>

          {/* Right: Cleaned Studio View */}
          <View style={styles.sideCard}>
            <View style={styles.sideHeader}>
              <Text style={styles.sideHeaderText}>Cleaned Studio</Text>
            </View>
            {hasEnhancedPhoto ? (
              <Image source={{ uri: activeEnhancedUri }} style={styles.sideImage} />
            ) : (
              <View style={styles.sideEmptyPlaceholder}>
                <Text style={styles.sideEmptyText}>No Cleaned Photo</Text>
                <Text style={styles.sideEmptySub}>Backend AI pending</Text>
              </View>
            )}
          </View>
        </View>
      ) : selectedView === 'enhanced' ? (
        /* Cleaned Studio View */
        <View style={styles.previewCard}>
          {hasEnhancedPhoto ? (
            <Image source={{ uri: activeEnhancedUri }} style={styles.mainImage} />
          ) : (
            <View style={styles.emptyPlaceholder}>
              <Text style={styles.emptyPlaceholderTitle}>No Cleaned Photo Yet</Text>
              <Text style={styles.emptyPlaceholderSub}>
                Processed studio photo will appear here once the backend AI model runs.
              </Text>
            </View>
          )}
          {isCurrentCover && (
            <View style={styles.previewCoverFloatingBadge}>
              <Text style={styles.previewCoverFloatingText}>★ PRIMARY COVER</Text>
            </View>
          )}
        </View>
      ) : (
        /* Original Camera View */
        <View style={styles.previewCard}>
          <Image source={{ uri: activeOriginalUri }} style={styles.mainImage} />
          {isCurrentCover && (
            <View style={styles.previewCoverFloatingBadge}>
              <Text style={styles.previewCoverFloatingText}>★ PRIMARY COVER</Text>
            </View>
          )}
        </View>
      )}

      {/* Fresh Primary Cover Photo Card */}
      <View style={styles.coverCardContainer}>
        <View style={[styles.coverCard, isCurrentCover ? styles.coverCardActive : styles.coverCardInactive]}>
          <View style={[styles.coverIconCircle, isCurrentCover && styles.coverIconCircleActive]}>
            <IconButton
              icon={isCurrentCover ? 'star' : 'star-outline'}
              size={20}
              iconColor={isCurrentCover ? '#FFFFFF' : colors.secondary}
              style={{ margin: 0 }}
            />
          </View>

          <View style={styles.coverCardContent}>
            <Text style={[styles.coverCardTitle, isCurrentCover && styles.coverCardTitleActive]}>
              {isCurrentCover ? 'Primary Cover Photo' : 'Marketplace Cover'}
            </Text>
            <Text style={styles.coverCardSubtitle} numberOfLines={2}>
              {isCurrentCover
                ? 'Shown first to buyers on the marketplace'
                : `Set Angle ${selectedIndex + 1} as the main catalogue photo`}
            </Text>
          </View>

          {isCurrentCover ? (
            <View style={styles.activeCoverBadge}>
              <IconButton icon="check" size={14} iconColor={colors.secondary} style={{ margin: 0, marginRight: -2 }} />
              <Text style={styles.activeCoverBadgeText}>Cover</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.setCoverBtn}
              onPress={() => handleSetCover(selectedIndex)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Set angle ${selectedIndex + 1} as primary cover photo`}
            >
              <Text style={styles.setCoverBtnText}>Make Cover</Text>
            </TouchableOpacity>
          )}
        </View>

        {photos.length > 1 && (
          <TouchableOpacity
            style={styles.deleteAngleRow}
            onPress={() => handleRemovePhoto(selectedIndex)}
            accessibilityRole="button"
            accessibilityLabel={`Remove angle ${selectedIndex + 1}`}
          >
            <IconButton icon="trash-can-outline" size={15} iconColor={colors.primary} style={{ margin: 0 }} />
            <Text style={styles.deleteAngleText}>Remove Angle {selectedIndex + 1}</Text>
          </TouchableOpacity>
        )}
      </View>

      </ScrollView>

      {/* Docked Action Bar */}
      <BottomDock>
        <View style={styles.actionsStacked}>
          <Button
            mode="contained"
            onPress={handleContinue}
            style={styles.primaryContinueBtn}
            buttonColor={colors.primary}
            textColor="#FFFFFF"
            contentStyle={{ height: 48 }}
            labelStyle={styles.primaryContinueText}
          >
            Accept & Continue ({photos.length})
          </Button>
          <Button
            mode="outlined"
            onPress={handleRetake}
            style={styles.secondaryAddBtn}
            textColor={colors.secondary}
            contentStyle={{ height: 42 }}
            icon="camera-plus"
          >
            Add More Angles
          </Button>
        </View>
      </BottomDock>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flexGrow: 1,
    paddingBottom: spacing.xxl,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  processingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  processingCenterWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: spacing.xxl,
  },
  processingCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  processingHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  processingSub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  stagesList: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  stageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stageDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
  },
  stageDotActive: {
    backgroundColor: colors.primary,
  },
  stageDotDone: {
    backgroundColor: colors.secondary,
  },
  stageItemText: {
    fontSize: 13,
    color: colors.textMuted,
    flex: 1,
  },
  stageItemCurrent: {
    color: colors.primary,
    fontWeight: '700',
  },
  stageItemDone: {
    color: colors.text,
    fontWeight: '500',
  },
  processingNotice: {
    backgroundColor: '#F7F5F0',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.lg,
  },
  processingNoticeText: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
    textAlign: 'center',
  },
  cancelBtn: {
    borderRadius: 8,
    borderColor: colors.border,
  },
  selectorContainer: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  selectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  selectorTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  selectorHint: {
    fontSize: 11,
    color: colors.textMuted,
  },
  thumbStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  thumbCard: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    position: 'relative',
    overflow: 'hidden',
  },
  thumbCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2.5,
  },
  stripThumbImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#EDE7DD',
  },
  coverPill: {
    position: 'absolute',
    top: 2,
    left: 2,
    backgroundColor: colors.secondary,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  coverPillText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  indexPill: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(28, 25, 23, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  indexPillActive: {
    backgroundColor: colors.secondary,
  },
  indexPillText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  indexPillTextActive: {
    color: '#FFFFFF',
  },
  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.border,
    borderRadius: 8,
    padding: 3,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: colors.surface,
    borderColor: colors.indigoBorder,
    borderWidth: 1,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
  },
  toggleTextActive: {
    color: colors.secondary,
    fontWeight: '700',
  },
  previewCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  mainImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#FAF9F6',
  },
  emptyPlaceholder: {
    height: 280,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9F7F4',
    padding: spacing.lg,
  },
  emptyPlaceholderTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  emptyPlaceholderSub: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
    maxWidth: 240,
  },
  sideBySideRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sideCard: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  sideHeader: {
    backgroundColor: '#F9F7F4',
    paddingVertical: 5,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sideHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },
  sideImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#FAF9F6',
  },
  sideEmptyPlaceholder: {
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9F7F4',
    padding: spacing.xs,
  },
  sideEmptyText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
  },
  sideEmptySub: {
    fontSize: 9,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  previewCoverFloatingBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(36, 51, 84, 0.88)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    zIndex: 10,
    elevation: 3,
  },
  previewCoverFloatingText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  coverCardContainer: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  coverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  coverCardActive: {
    backgroundColor: colors.indigoLight,
    borderColor: colors.secondary,
  },
  coverCardInactive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  coverIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.badgeNeutral,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  coverIconCircleActive: {
    backgroundColor: colors.secondary,
  },
  coverCardContent: {
    flex: 1,
    marginRight: spacing.sm,
  },
  coverCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  coverCardTitleActive: {
    color: colors.secondary,
  },
  coverCardSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 15,
  },
  activeCoverBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.indigoBorder,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 20,
  },
  activeCoverBadgeText: {
    color: colors.secondary,
    fontSize: 12,
    fontWeight: '700',
  },
  setCoverBtn: {
    backgroundColor: colors.secondary,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  setCoverBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  deleteAngleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    paddingVertical: 4,
  },
  deleteAngleText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    marginLeft: 4,
  },
  actionsStacked: {
    gap: spacing.sm,
  },
  primaryContinueBtn: {
    width: '100%',
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
    borderRadius: 8,
  },
  primaryContinueText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryAddBtn: {
    width: '100%',
    borderRadius: 8,
    borderColor: colors.secondary,
  },
  hint: { color: colors.text, marginTop: spacing.md, textAlign: 'center' },
  retakeBtn: { marginTop: spacing.md, borderRadius: 8 },
});