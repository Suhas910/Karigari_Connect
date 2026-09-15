// src/features/profile/VoiceFeedbackModal.tsx
// ARCHITECTURAL NOTE & CONTRACT CONSTRAINT:
// Send Voice Feedback is a new entry point with no dedicated backend audio submission endpoint in the current contract.
// Per project instructions, this is stubbed behind mockApi.ts with a clearly marked TODO.
// No real backend endpoint has been fabricated.

import React, { useState } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, Alert } from 'react-native';
import { Text, Button, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '../../theme';
import { mockApi } from '../../services/mockApi';

interface VoiceFeedbackModalProps {
  visible: boolean;
  onDismiss: () => void;
}

export const VoiceFeedbackModal: React.FC<VoiceFeedbackModalProps> = ({
  visible,
  onDismiss,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      setHasRecording(true);
    } else {
      setIsRecording(true);
      setHasRecording(false);
    }
  };

  const handleSend = async () => {
    setSubmitting(true);
    try {
      // TODO: Connect to backend cluster voice notes API once contract PS 26090 endpoint is finalized.
      // Currently stubbed behind mockApi per instruction.
      const res = await mockApi.submitVoiceFeedback!('simulated://audio_memo_001.m4a', noteText);
      Alert.alert('Feedback Sent', res.message, [
        {
          text: 'OK',
          onPress: () => {
            setHasRecording(false);
            setNoteText('');
            onDismiss();
          },
        },
      ]);
    } catch (err) {
      Alert.alert('Error', 'Failed to send voice feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setIsRecording(false);
    setHasRecording(false);
    setNoteText('');
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleCancel}
        />
        <View style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.iconBox}>
              <MaterialCommunityIcons name="microphone-outline" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Send Voice Feedback</Text>
              <Text style={styles.headerSubtitle}>
                Voice message or idea to your cluster coordinator
              </Text>
            </View>
            <TouchableOpacity onPress={handleCancel} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Voice Recording Widget */}
          <View style={styles.recordWidget}>
            <TouchableOpacity
              style={[
                styles.micButton,
                isRecording && styles.micButtonRecording,
                hasRecording && styles.micButtonRecorded,
              ]}
              onPress={toggleRecording}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording voice note'}
            >
              <MaterialCommunityIcons
                name={isRecording ? 'stop' : hasRecording ? 'check' : 'microphone'}
                size={32}
                color={isRecording ? '#FFFFFF' : hasRecording ? '#065F46' : colors.primary}
              />
            </TouchableOpacity>
            <Text style={styles.micHint}>
              {isRecording
                ? 'Recording... Tap to finish'
                : hasRecording
                ? 'Voice note recorded (0:18)'
                : 'Tap microphone to speak'}
            </Text>
          </View>

          {/* Optional Note Text */}
          <TextInput
            mode="outlined"
            label="Optional note or context"
            placeholder="e.g. Question about craft classification"
            value={noteText}
            onChangeText={setNoteText}
            multiline
            numberOfLines={2}
            style={styles.textInput}
            outlineColor={colors.border}
            activeOutlineColor={colors.primary}
          />

          {/* Action Buttons */}
          <View style={styles.actionRow}>
            <Button
              mode="outlined"
              onPress={handleCancel}
              style={styles.cancelButton}
              textColor={colors.textMuted}
            >
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={handleSend}
              loading={submitting}
              disabled={submitting || (!hasRecording && !noteText.trim())}
              buttonColor={colors.primary}
              style={styles.sendButton}
            >
              Send Memo
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheetContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: spacing.md,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FAF5F2',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F3E5E0',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  recordWidget: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    backgroundColor: '#FAF8F5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: spacing.sm,
  },
  micButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  micButtonRecording: {
    backgroundColor: colors.primary,
    borderColor: colors.error,
  },
  micButtonRecorded: {
    backgroundColor: '#D1FAE5',
    borderColor: '#059669',
  },
  micHint: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 10,
  },
  textInput: {
    marginTop: spacing.sm,
    backgroundColor: '#FFFFFF',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: spacing.md,
  },
  cancelButton: {
    borderRadius: 12,
    borderColor: colors.border,
  },
  sendButton: {
    borderRadius: 12,
  },
});
