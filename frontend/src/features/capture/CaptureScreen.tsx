// src/features/capture/CaptureScreen.tsx
import React, { useRef, useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, Modal, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Text, ActivityIndicator, IconButton, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ArtisanStackParamList } from '../../types/navigation';
import { service } from '../../services';
import { getDraft, saveDraft } from '../../services/database';
import { useDraftStore } from '../../store/draftStore';
import { colors, spacing } from '../../theme';

export default function CaptureScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturedUris, setCapturedUris] = useState<string[]>([]);
  const [torchOn, setTorchOn] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [galleryVisible, setGalleryVisible] = useState(false);
  const { activeDraftId, setActiveDraft } = useDraftStore();
  // Refs, not state: background uploads finish after later renders and must see the latest values.
  const urisRef = useRef<string[]>([]);
  const mediaIdsRef = useRef<Record<string, string>>({});

  // Restore photos from active draft on mount if available
  useEffect(() => {
    if (!activeDraftId) return;
    (async () => {
      try {
        const draft = await getDraft(activeDraftId);
        if (draft?.payload?.photos && Array.isArray(draft.payload.photos)) {
          urisRef.current = draft.payload.photos;
          mediaIdsRef.current = draft.payload.photoMediaIds ?? {};
          setCapturedUris(draft.payload.photos);
        }
      } catch (err) {
        console.error('Failed to restore draft photos', err);
      }
    })();
  }, [activeDraftId]);

  if (!permission) {
    return <View style={styles.centered}><ActivityIndicator /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: colors.text, marginBottom: spacing.md, textAlign: 'center' }}>
          Camera access is needed to photograph your product.
        </Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={{ color: '#FFF' }}>Allow Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const ensureDraft = async () => {
    if (activeDraftId) return activeDraftId;
    const result = await service.createListing({ preferred_language: 'kn' });
    const newId = result.id;
    setActiveDraft(newId);
    await saveDraft({
      id: newId,
      listing_id: newId,
      state: 'draft',
      preferred_language: 'kn',
      payload: {},
    });
    return newId;
  };

  const setPhotos = (uris: string[]) => {
    urisRef.current = uris;
    setCapturedUris(uris);
  };

  // Photos and their server media ids, saved so a closed app can resume.
  const persistPhotos = async (draftId: string) => {
    try {
      const existing = await getDraft(draftId);
      await saveDraft({
        id: draftId,
        listing_id: existing?.listing_id ?? draftId,
        state: existing?.state ?? 'draft',
        preferred_language: existing?.preferred_language ?? 'kn',
        payload: {
          ...(existing?.payload ?? {}),
          photos: urisRef.current,
          photoMediaIds: mediaIdsRef.current,
        },
      });
    } catch (dbErr) {
      console.error('Failed to save photos to draft payload', dbErr);
    }
  };

  // Sends one photo to the server. False means it is still only on the phone.
  const uploadPhoto = async (draftId: string, uri: string) => {
    try {
      const res = await service.uploadMedia(draftId, 'image', {
        uri,
        name: uri.split('/').pop() || 'photo.jpg',
        type: 'image/jpeg',
      });
      mediaIdsRef.current = { ...mediaIdsRef.current, [uri]: res.media_id };
      return true;
    } catch (err) {
      return false;
    }
  };

  const handleCapture = async () => {
    if (!cameraRef.current) return;
    setIsSaving(true);
    setUploadError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo) return;

      const draftId = await ensureDraft();
      setPhotos([...urisRef.current, photo.uri]);
      await persistPhotos(draftId);

      // In the background, so the next photo can be taken straight away.
      uploadPhoto(draftId, photo.uri).then(async (ok) => {
        if (ok) {
          await persistPhotos(draftId);
        } else {
          setUploadError('Photo saved on your device, but upload failed. It will retry when you continue.');
        }
      });
    } catch (err) {
      setUploadError('Could not capture photo. Try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemovePhoto = async (indexToRemove: number) => {
    const removed = urisRef.current[indexToRemove];
    const { [removed]: _removedId, ...remaining } = mediaIdsRef.current;
    mediaIdsRef.current = remaining;
    setPhotos(urisRef.current.filter((_, idx) => idx !== indexToRemove));
    if (activeDraftId) {
      await persistPhotos(activeDraftId);
    }
  };

  const handleContinue = async () => {
    if (!activeDraftId) return;
    const notUploaded = () => urisRef.current.filter((uri) => !mediaIdsRef.current[uri]);

    if (notUploaded().length > 0) {
      setIsSaving(true);
      setUploadError(null);
      for (const uri of notUploaded()) {
        await uploadPhoto(activeDraftId, uri);
      }
      await persistPhotos(activeDraftId);
      setIsSaving(false);

      const remaining = notUploaded().length;
      if (remaining > 0) {
        setUploadError(
          remaining === 1
            ? '1 photo could not upload. Check your connection and try again, or remove it.'
            : `${remaining} photos could not upload. Check your connection and try again, or remove them.`
        );
        return;
      }
    }
    navigation.navigate('ImageReview', { draftId: activeDraftId });
  };

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        enableTorch={torchOn}
        flash={torchOn ? 'on' : 'off'}
      />

      {/* Top Bar with Back Button, Step Badge & Flashlight */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconButton icon="arrow-left" size={22} iconColor="#FFFFFF" style={{ margin: 0 }} />
        </TouchableOpacity>
        <View style={styles.topStepBadge}>
          <Text style={styles.topStepText}>Step 1 of 5: Photograph Product</Text>
        </View>
        <TouchableOpacity
          style={[styles.flashBtn, torchOn && styles.flashBtnActive]}
          onPress={() => setTorchOn((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel={torchOn ? 'Turn flashlight off' : 'Turn flashlight on'}
        >
          <IconButton
            icon={torchOn ? 'flashlight' : 'flashlight-off'}
            size={20}
            iconColor={torchOn ? colors.secondary : '#FFFFFF'}
            style={{ margin: 0 }}
          />
        </TouchableOpacity>
      </View>

      {/* Framing Guidelines */}
      <View style={styles.framingOverlay} pointerEvents="none">
        <View style={[styles.corner, styles.topLeft]} />
        <View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} />
        <View style={[styles.corner, styles.bottomRight]} />
      </View>

      {/* Bottom Controls */}
      <View style={styles.controls}>
        <Text style={styles.hint}>
          {capturedUris.length === 0
            ? 'Align product in center and take photo'
            : `${capturedUris.length} photo${capturedUris.length > 1 ? 's' : ''} captured — tap stack to view all`}
        </Text>
        {uploadError && <Text style={styles.errorText}>{uploadError}</Text>}

        <View style={styles.buttonRow}>
          {/* Left: Photo Stack Thumbnail */}
          {capturedUris.length > 0 ? (
            <TouchableOpacity
              style={styles.stackPreviewBtn}
              onPress={() => setGalleryVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={`View ${capturedUris.length} captured photos`}
            >
              {capturedUris.length > 1 && <View style={styles.stackBackdrop2} />}
              {capturedUris.length > 2 && <View style={styles.stackBackdrop1} />}
              <Image
                source={{ uri: capturedUris[capturedUris.length - 1] }}
                style={styles.stackThumb}
              />
              <View style={styles.stackCountBadge}>
                <Text style={styles.stackCountText}>{capturedUris.length}</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.sideSpacer} />
          )}

          {/* Center: Circular Shutter Button */}
          <TouchableOpacity
            style={styles.captureBtn}
            onPress={handleCapture}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
          >
            {isSaving ? <ActivityIndicator color="#FFF" /> : <View style={styles.captureBtnInner} />}
          </TouchableOpacity>

          {/* Right: Continue Action */}
          {capturedUris.length > 0 ? (
            <IconButton
              icon="arrow-right"
              size={28}
              iconColor="#FFFFFF"
              containerColor={colors.primary}
              onPress={handleContinue}
              style={styles.continueBtn}
            />
          ) : (
            <View style={styles.sideSpacer} />
          )}
        </View>
      </View>

      {/* Captured Photos Gallery Modal */}
      <Modal
        visible={galleryVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setGalleryVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Captured Angles</Text>
                <Text style={styles.modalSubtitle}>
                  {capturedUris.length} photo{capturedUris.length > 1 ? 's' : ''} stored for this listing
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setGalleryVisible(false)}
                style={styles.modalCloseBtn}
                accessibilityRole="button"
                accessibilityLabel="Close gallery"
              >
                <IconButton icon="close" size={20} iconColor={colors.text} style={{ margin: 0 }} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.galleryScrollView}
              contentContainerStyle={styles.galleryGrid}
              showsVerticalScrollIndicator={false}
            >
              {capturedUris.map((uri, idx) => (
                <View key={idx} style={styles.galleryCard}>
                  <View style={styles.galleryImageWrapper}>
                    <Image source={{ uri }} style={styles.galleryImage} />
                    {/* Clear 'X' mark remove button on top-left corner */}
                    <TouchableOpacity
                      onPress={() => handleRemovePhoto(idx)}
                      style={styles.removePhotoBadge}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove angle ${idx + 1}`}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <IconButton
                        icon="close"
                        size={15}
                        iconColor="#FFFFFF"
                        style={{ margin: 0 }}
                      />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.galleryCardFooter}>
                    <Text style={styles.galleryAngleText}>Angle {idx + 1}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={styles.modalFooter}>
              <Button
                mode="outlined"
                onPress={() => setGalleryVisible(false)}
                textColor={colors.text}
                style={styles.modalBtn}
              >
                Take More Angles
              </Button>
              <Button
                mode="contained"
                onPress={() => {
                  setGalleryVisible(false);
                  handleContinue();
                }}
                buttonColor={colors.primary}
                textColor="#FFFFFF"
                style={styles.modalBtn}
              >
                Review Photos ({capturedUris.length})
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  permissionBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 8,
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
  },
  topBar: {
    position: 'absolute',
    top: 50,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(28, 25, 23, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topStepBadge: {
    backgroundColor: 'rgba(28, 25, 23, 0.85)',
    borderWidth: 1,
    borderColor: colors.indigoBorder,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  flashBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(28, 25, 23, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flashBtnActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: colors.secondary,
  },
  topStepText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  framingOverlay: {
    position: 'absolute',
    top: '22%',
    left: '10%',
    right: '10%',
    height: 300,
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: 'rgba(255, 255, 255, 0.7)',
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2 },
  topRight: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    backgroundColor: 'rgba(28, 25, 23, 0.82)',
  },
  hint: {
    color: '#FFF',
    textAlign: 'center',
    marginBottom: spacing.md,
    fontSize: 13,
  },
  errorText: {
    color: '#FFB4A2',
    textAlign: 'center',
    marginBottom: spacing.sm,
    fontSize: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  sideSpacer: {
    width: 54,
    height: 54,
  },
  stackPreviewBtn: {
    width: 54,
    height: 54,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  stackBackdrop1: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    transform: [{ rotate: '-8deg' }],
  },
  stackBackdrop2: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    transform: [{ rotate: '5deg' }],
  },
  stackThumb: {
    width: 50,
    height: 50,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#333',
  },
  stackCountBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.secondary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  stackCountText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFF',
  },
  captureBtnInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFF',
  },
  continueBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    margin: 0,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.badgeNeutral,
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryScrollView: {
    maxHeight: 380,
  },
  galleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  galleryCard: {
    width: '47%',
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  galleryImageWrapper: {
    position: 'relative',
    width: '100%',
    aspectRatio: 1,
  },
  galleryImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#EDE7DD',
  },
  removePhotoBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
  },
  galleryCardFooter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  galleryAngleText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  modalBtn: {
    flex: 1,
    borderRadius: 8,
    minHeight: spacing.tapTarget,
    justifyContent: 'center',
  },
});