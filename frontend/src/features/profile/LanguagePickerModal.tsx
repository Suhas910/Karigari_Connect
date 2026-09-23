import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, ScrollView, Animated } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme, spacing } from '../../theme';
import type { ColorPalette } from '../../theme';
import { setAppLanguage } from '../../i18n';

export const LANGUAGES = [
  { code: 'en', native: 'English', label: 'English', shortCode: 'EN' },
  { code: 'hi', native: 'हिन्दी', label: 'Hindi (हिन्दी)', shortCode: 'HI' },
  { code: 'kn', native: 'ಕನ್ನಡ', label: 'Kannada (ಕನ್ನಡ)', shortCode: 'KN' },
  { code: 'bn', native: 'বাংলা', label: 'Bengali (বাংলা)', shortCode: 'BN' },
  { code: 'ta', native: 'தமிழ்', label: 'Tamil (தமிழ்)', shortCode: 'TA' },
  { code: 'te', native: 'తెలుగు', label: 'Telugu (తెలుగు)', shortCode: 'TE' },
  { code: 'mr', native: 'मराठी', label: 'Marathi (मराठी)', shortCode: 'MR' },
  { code: 'gu', native: 'ગુજરાતી', label: 'Gujarati (ગુજરાતી)', shortCode: 'GU' },
  { code: 'or', native: 'ଓଡ଼ିଆ', label: 'Odia (ଓଡ଼ିଆ)', shortCode: 'OR' },
];

interface LanguagePickerModalProps {
  visible: boolean;
  onDismiss: () => void;
}

export const LanguagePickerModal: React.FC<LanguagePickerModalProps> = ({
  visible,
  onDismiss,
}) => {
  const { t, i18n } = useTranslation();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Track if user has touched/scrolled the list
  const [hasInteracted, setHasInteracted] = useState(false);
  const bounceValue = useRef(new Animated.Value(0)).current;

  // Reset interaction state and start animation every time modal opens
  useEffect(() => {
    if (visible) {
      setHasInteracted(false);
      
      Animated.loop(
        Animated.sequence([
          Animated.timing(bounceValue, {
            toValue: 4,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(bounceValue, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      bounceValue.stopAnimation();
    }
  }, [visible, bounceValue]);

  const handleSelectLanguage = async (code: string) => {
    try {
      await setAppLanguage(code);
    } catch (err) {
      console.error('Failed to change language', err);
    }
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onDismiss}
        />
        <View style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.iconBox}>
              <MaterialCommunityIcons name="translate" size={24} color={colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>{t('languagePicker.title')}</Text>
              <Text style={styles.headerSubtitle}>
                {t('languagePicker.subtitle')}
              </Text>
            </View>
            <TouchableOpacity onPress={onDismiss} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* List Wrapper for positioning the floating arrow */}
          <View style={styles.listWrapper}>
            <ScrollView
              style={styles.optionsScroll}
              contentContainerStyle={styles.optionsContentContainer}
              showsVerticalScrollIndicator={true}
              persistentScrollbar={true} // Forces scrollbar to stay visible on Android
              onScrollBeginDrag={() => setHasInteracted(true)} // Hide arrow on touch
              nestedScrollEnabled
            >
              <View style={styles.optionsList}>
                {LANGUAGES.map((lang) => {
                  const isSelected = i18n.language === lang.code;
                  return (
                    <TouchableOpacity
                      key={lang.code}
                      style={[styles.langOption, isSelected && styles.langOptionSelected]}
                      onPress={() => handleSelectLanguage(lang.code)}
                      activeOpacity={0.7}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <View style={styles.langLeft}>
                        <Text style={[styles.langLabel, isSelected && styles.langLabelSelected]}>
                          {lang.label}
                        </Text>
                        <Text style={styles.nativeText}>{lang.native}</Text>
                      </View>

                      <View style={styles.langRight}>
                        <View style={[styles.badgeChip, isSelected && styles.badgeChipSelected]}>
                          <Text style={[styles.badgeText, isSelected && styles.badgeTextSelected]}>
                            {lang.shortCode}
                          </Text>
                        </View>
                        {isSelected && (
                          <MaterialCommunityIcons
                            name="check-circle"
                            size={22}
                            color={colors.primary}
                          />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {/* Floating Arrow Cue */}
            {!hasInteracted && (
              <Animated.View 
                style={[
                  styles.floatingArrowContainer, 
                  { transform: [{ translateY: bounceValue }] }
                ]}
                pointerEvents="none"
              >
                <MaterialCommunityIcons 
                  name="chevron-down-circle" 
                  size={32} 
                  color={colors.primary} 
                  style={styles.arrowIconBackground}
                />
              </Animated.View>
            )}
          </View>

          <Button
            mode="outlined"
            onPress={onDismiss}
            style={styles.cancelBtn}
            textColor={colors.textMuted}
          >
            {t('common.close')}
          </Button>
        </View>
      </View>
    </Modal>
  );
};

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
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
      shadowColor: colors.shadow,
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
      backgroundColor: colors.indigoLight,
      justifyContent: 'center',
      alignItems: 'center',
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
    listWrapper: {
      position: 'relative',
      maxHeight: 290, 
      marginVertical: spacing.sm,
    },
    optionsScroll: {
      flexGrow: 0,
    },
    optionsContentContainer: {
      paddingRight:10, // Pushes content left so scrollbar doesn't overlap borders
      paddingBottom: 8, // Extra padding at bottom for smooth scrolling past the arrow
    },
    optionsList: {
      gap: 10,
    },
    floatingArrowContainer: {
      position: 'absolute',
      bottom: 4,
      alignSelf: 'center',
      zIndex: 10,
      elevation: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      borderRadius: 16,
    },
    arrowIconBackground: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    langOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 14,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    langOptionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    langLeft: {
      flex: 1,
    },
    langLabel: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    langLabelSelected: {
      color: colors.primary,
    },
    nativeText: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    langRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    badgeChip: {
      backgroundColor: colors.badgeNeutral,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
    badgeChipSelected: {
      backgroundColor: colors.primaryLight,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textMuted,
    },
    badgeTextSelected: {
      color: colors.primary,
    },
    cancelBtn: {
      marginTop: spacing.md,
      borderRadius: 12,
      borderColor: colors.border,
    },
  });
}