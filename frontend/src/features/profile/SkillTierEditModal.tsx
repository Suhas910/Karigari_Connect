// src/features/profile/SkillTierEditModal.tsx
// REVAMPED ARTISAN SKILL TIER & OFFICIAL ID MODAL
// 1. Android Status Bar Clearance:
//    - Uses transparent modal with statusBarTranslucent={true} and top backdrop spacing
//      to ensure the sheet stops cleanly below the device status bar (battery/network/time icons).
//    - Modern bottom sheet aesthetic with top drag handle pill and rounded sheet corners.
// 2. Revamped & Reimagined UX/UI:
//    - Live Statutory Fair Wage Floor Callout Banner calculating real-time hourly/daily rates
//      based on selected Skill Tier + State + Wage Zone under the Code on Wages 2019.
//    - 3 Grouped Sections with clear numbered badges:
//        1. Craft Experience Tier (Apprentice, Practicing, Skilled, Master)
//        2. Workshop Jurisdiction (State Pills + Compact Zone cards)
//        3. Official Craft Credential (Pehchan, Vishwakarma, Self-declared)
// 3. Fixed Credential Radio Alignment:
//    - Moved radio selection circle to the right (fixing the bullet point on the left of text).
//    - Added craft credential icon boxes on the left.
// 4. Sticky Bottom Action Dock:
//    - Submit button anchored at the bottom with safe area insets so artisans don't have to scroll.

import React from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Platform,
  StatusBar,
} from 'react-native';
import { Text, Button, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, spacing } from '../../theme';
import { type SkillOption } from '../../components';
import { PILOT_STATES } from '../../store/draftStore';
import type { ArtisanProfile, IdProofType } from '../../types/contracts';

interface CraftTierOption {
  id: SkillOption;
  emoji: string;
  title: string;
  experience: string;
  statutoryLevel: string;
}

const CRAFT_TIER_OPTIONS: CraftTierOption[] = [
  {
    id: 'beginner',
    emoji: '🌱',
    title: 'skillTierModal.tiers.beginner.title',
    experience: 'skillTierModal.tiers.beginner.experience',
    statutoryLevel: 'skillTierModal.tiers.beginner.statutory',
  },
  {
    id: 'intermediate',
    emoji: '🧵',
    title: 'skillTierModal.tiers.intermediate.title',
    experience: 'skillTierModal.tiers.intermediate.experience',
    statutoryLevel: 'skillTierModal.tiers.intermediate.statutory',
  },
  {
    id: 'skilled',
    emoji: '🛠️',
    title: 'skillTierModal.tiers.skilled.title',
    experience: 'skillTierModal.tiers.skilled.experience',
    statutoryLevel: 'skillTierModal.tiers.skilled.statutory',
  },
  {
    id: 'master',
    emoji: '🏆',
    title: 'skillTierModal.tiers.master.title',
    experience: 'skillTierModal.tiers.master.experience',
    statutoryLevel: 'skillTierModal.tiers.master.statutory',
  },
];

interface CredentialOption {
  type: IdProofType;
  label: string;
  helper: string;
  icon: 'card-account-details-outline' | 'certificate-outline' | 'shield-outline';
}

const ID_PROOFS: CredentialOption[] = [
  {
    type: 'pehchan_card',
    label: 'skillTierModal.proofs.pehchan_card.label',
    helper: 'skillTierModal.proofs.pehchan_card.helper',
    icon: 'card-account-details-outline',
  },
  {
    type: 'pm_vishwakarma',
    label: 'skillTierModal.proofs.pm_vishwakarma.label',
    helper: 'skillTierModal.proofs.pm_vishwakarma.helper',
    icon: 'certificate-outline',
  },
  {
    type: 'none',
    label: 'skillTierModal.proofs.none.label',
    helper: 'skillTierModal.proofs.none.helper',
    icon: 'shield-outline',
  },
];

// Grounded in wage_rates.json & State Minimum Wage Notifications
const WAGE_FLOOR_LOOKUP: Record<
  string,
  Record<string, Record<SkillOption, { hourly: number; daily: number }>>
> = {
  KA: {
    zone_1: {
      beginner: { hourly: 75.49, daily: 603.91 },
      intermediate: { hourly: 81.06, daily: 648.47 },
      skilled: { hourly: 87.19, daily: 697.5 },
      master: { hourly: 93.93, daily: 751.46 },
    },
    zone_2: {
      beginner: { hourly: 72.84, daily: 582.68 },
      intermediate: { hourly: 78.14, daily: 625.13 },
      skilled: { hourly: 83.98, daily: 671.82 },
      master: { hourly: 90.4, daily: 723.23 },
    },
    zone_3: {
      beginner: { hourly: 70.31, daily: 562.47 },
      intermediate: { hourly: 75.36, daily: 602.9 },
      skilled: { hourly: 80.92, daily: 647.38 },
      master: { hourly: 87.04, daily: 696.34 },
    },
    zone_4: {
      beginner: { hourly: 67.9, daily: 543.22 },
      intermediate: { hourly: 72.72, daily: 581.72 },
      skilled: { hourly: 78.01, daily: 624.08 },
      master: { hourly: 83.83, daily: 670.64 },
    },
  },
  UP: {
    statewide: {
      beginner: { hourly: 53.0, daily: 424.0 },
      intermediate: { hourly: 58.3, daily: 466.4 },
      skilled: { hourly: 65.3, daily: 522.4 },
      master: { hourly: 73.13, daily: 585.0 },
    },
  },
  WB: {
    zone_a: {
      beginner: { hourly: 48.5, daily: 388.0 },
      intermediate: { hourly: 53.35, daily: 426.8 },
      skilled: { hourly: 58.69, daily: 469.5 },
      master: { hourly: 64.56, daily: 516.48 },
    },
    zone_b: {
      beginner: { hourly: 44.2, daily: 353.6 },
      intermediate: { hourly: 48.62, daily: 388.96 },
      skilled: { hourly: 53.48, daily: 427.84 },
      master: { hourly: 58.83, daily: 470.62 },
    },
  },
};

interface SkillTierEditModalProps {
  visible: boolean;
  profile: ArtisanProfile | null;
  selectedSkill: SkillOption | null;
  onSelectSkill: (skill: SkillOption) => void;
  selectedState: string;
  onSelectState: (stateCode: string) => void;
  selectedZone: string;
  onSelectZone: (zoneCode: string) => void;
  idProofType: IdProofType;
  onChangeIdProofType: (type: IdProofType) => void;
  idProofNumber: string;
  onChangeIdProofNumber: (num: string) => void;
  submitting: boolean;
  onSubmit: () => Promise<void>;
  message: { type: 'success' | 'error'; text: string } | null;
  onDismiss: () => void;
}

export const SkillTierEditModal: React.FC<SkillTierEditModalProps> = ({
  visible,
  profile,
  selectedSkill,
  onSelectSkill,
  selectedState,
  onSelectState,
  selectedZone,
  onSelectZone,
  idProofType,
  onChangeIdProofType,
  idProofNumber,
  onChangeIdProofNumber,
  submitting,
  onSubmit,
  message,
  onDismiss,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const currentStateObj =
    PILOT_STATES.find((s) => s.code === (selectedState || 'KA')) || PILOT_STATES[0];
  const availableZones = currentStateObj.zones;
  const currentZoneObj =
    availableZones.find((z) => z.code === selectedZone) || availableZones[0];

  const status = profile?.profile_status || 'incomplete';

  // Live Statutory Fair Wage calculation
  const stateCode = selectedState || 'KA';
  const zoneCode = selectedZone || availableZones[0]?.code || 'zone_1';
  const activeSkill = selectedSkill || 'skilled';
  const wageData =
    WAGE_FLOOR_LOOKUP[stateCode]?.[zoneCode]?.[activeSkill] || {
      hourly: 87.19,
      daily: 697.5,
    };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      statusBarTranslucent={true}
      onRequestClose={onDismiss}
    >
      <View style={styles.modalRoot}>
        {/* Top Backdrop Area: Clears Android status bar and allows tap to dismiss */}
        <TouchableOpacity
          style={[
            styles.topBackdrop,
            {
              height:
                Platform.OS === 'android'
                  ? Math.max(StatusBar.currentHeight || 24, 28) + 24
                  : Math.max(insets.top, 24) + 16,
            },
          ]}
          activeOpacity={1}
          onPress={onDismiss}
          accessibilityLabel={t('skillTierModal.dismiss')}
        />

        {/* Sheet Body Container with rounded top corners */}
        <View style={styles.sheetContainer}>
          {/* Top Pill Drag Indicator */}
          <View style={styles.dragHandleContainer}>
            <View style={styles.dragHandle} />
          </View>

          {/* Modal Header */}
          <View style={styles.headerBar}>
            <View style={styles.headerTextGroup}>
              <Text style={styles.headerTitle}>{t('profile.skillTierTitle')}</Text>
              <Text style={styles.headerSubtitle}>
                {t('skillTierModal.subtitle')}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onDismiss}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <MaterialCommunityIcons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Scrollable Form Body */}
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Live Fair Wage Floor Callout Banner */}
            <View style={styles.wageFloorCard}>
              <View style={styles.wageFloorHeader}>
                <View style={styles.wageIconBadge}>
                  <MaterialCommunityIcons name="scale-balance" size={22} color={colors.primary} />
                </View>
                <View style={styles.wageHeaderDetails}>
                  <Text style={styles.wageEyebrow}>{t('skillTierModal.wageEyebrow')}</Text>
                  <View style={styles.wageRateRow}>
                    <Text style={styles.wageRateNumber}>₹{wageData.hourly.toFixed(2)}</Text>
                    <Text style={styles.wageRateUnit}>{t('skillTierModal.perHour')}</Text>
                    <Text style={styles.wageDailyPill}>
                      {t('skillTierModal.perDay', { amount: `₹${Math.round(wageData.daily)}` })}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.wageFloorDivider} />
              <View style={styles.wageFooterRow}>
                <MaterialCommunityIcons name="shield-check" size={15} color="#059669" />
                <Text style={styles.wageFooterText}>
                  {t('skillTierModal.protectedUnder', { state: currentStateObj.name, zone: currentZoneObj?.name || t('listings.zone1') })}
                </Text>
              </View>
            </View>

            {/* SECTION 1: Craft Skill & Experience Tier */}
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionStepBadge}>
                  <Text style={styles.sectionStepBadgeText}>1</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>{t('skillTierModal.section1Title')}</Text>
                  <Text style={styles.sectionSubtitle}>
                    {t('skillTierModal.section1Sub')}
                  </Text>
                </View>
              </View>

              <View style={styles.cardsStack}>
                {CRAFT_TIER_OPTIONS.map((opt) => {
                  const isSelected = selectedSkill === opt.id;
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      style={[styles.tierCard, isSelected && styles.tierCardSelected]}
                      onPress={() => onSelectSkill(opt.id)}
                      activeOpacity={0.7}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <View style={[styles.tierIconBox, isSelected && styles.tierIconBoxSelected]}>
                        <Text style={styles.tierEmoji}>{opt.emoji}</Text>
                      </View>
                      <View style={styles.tierInfo}>
                        <View style={styles.tierTitleRow}>
                          <Text style={[styles.tierTitle, isSelected && styles.tierTitleSelected]}>
                            {t(opt.title)}
                          </Text>
                          <Text
                            style={[
                              styles.tierStatutoryBadge,
                              isSelected && styles.tierStatutoryBadgeSelected,
                            ]}
                          >
                            {t(opt.statutoryLevel)}
                          </Text>
                        </View>
                        <Text style={styles.tierExperience}>{t(opt.experience)}</Text>
                      </View>
                      <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                        {isSelected && <View style={styles.radioInnerDot} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* SECTION 2: Workshop Jurisdiction & Wage Zone */}
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionStepBadge}>
                  <Text style={styles.sectionStepBadgeText}>2</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>{t('skillTierModal.section2Title')}</Text>
                  <Text style={styles.sectionSubtitle}>
                    {t('skillTierModal.section2Sub')}
                  </Text>
                </View>
              </View>

              {/* State Selection Pills */}
              <View style={styles.subFieldGroup}>
                <Text style={styles.fieldLabel}>{t('skillTierModal.stateLabel')}</Text>
                <View style={styles.statePillsRow}>
                  {PILOT_STATES.map((s) => {
                    const isSelected = (selectedState || 'KA') === s.code;
                    return (
                      <TouchableOpacity
                        key={s.code}
                        style={[styles.statePill, isSelected && styles.statePillSelected]}
                        onPress={() => onSelectState(s.code)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.statePillName,
                            isSelected && styles.statePillNameSelected,
                          ]}
                        >
                          {s.name}
                        </Text>
                        <View
                          style={[
                            styles.stateCodeBadge,
                            isSelected && styles.stateCodeBadgeSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.stateCodeText,
                              isSelected && styles.stateCodeTextSelected,
                            ]}
                          >
                            {s.code}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Geographic Wage Zone Cards */}
              <View style={styles.subFieldGroup}>
                <Text style={styles.fieldLabel}>
                  {t('skillTierModal.zoneLabel', { state: currentStateObj.name })}
                </Text>
                <View style={styles.cardsStack}>
                  {availableZones.map((z) => {
                    const isSelected = selectedZone === z.code;
                    return (
                      <TouchableOpacity
                        key={z.code}
                        style={[styles.zoneCard, isSelected && styles.zoneCardSelected]}
                        onPress={() => onSelectZone(z.code)}
                        activeOpacity={0.7}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <View style={styles.zoneCardText}>
                          <Text style={[styles.zoneName, isSelected && styles.zoneNameSelected]}>
                            {z.name}
                          </Text>
                          {z.note ? (
                            <Text style={styles.zoneNote} numberOfLines={2}>
                              {z.note}
                            </Text>
                          ) : null}
                        </View>
                        <View
                          style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}
                        >
                          {isSelected && <View style={styles.radioInnerDot} />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* SECTION 3: Official Craft Credential & ID Proof */}
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionStepBadge}>
                  <Text style={styles.sectionStepBadgeText}>3</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>{t('skillTierModal.section3Title')}</Text>
                  <Text style={styles.sectionSubtitle}>
                    {t('skillTierModal.section3Sub')}
                  </Text>
                </View>
              </View>

              <View style={styles.cardsStack}>
                {ID_PROOFS.map((proof) => {
                  const isSelected = idProofType === proof.type;
                  return (
                    <TouchableOpacity
                      key={proof.type}
                      style={[styles.proofCard, isSelected && styles.proofCardSelected]}
                      onPress={() => onChangeIdProofType(proof.type)}
                      activeOpacity={0.7}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                    >
                      {/* Left: Credential Icon Box */}
                      <View
                        style={[styles.proofIconBox, isSelected && styles.proofIconBoxSelected]}
                      >
                        <MaterialCommunityIcons
                          name={proof.icon}
                          size={22}
                          color={isSelected ? colors.primary : colors.textMuted}
                        />
                      </View>

                      {/* Center: Title & Helper */}
                      <View style={styles.proofTextContainer}>
                        <Text style={[styles.proofLabel, isSelected && styles.proofLabelSelected]}>
                          {t(proof.label)}
                        </Text>
                        <Text style={styles.proofHelper}>{t(proof.helper)}</Text>
                      </View>

                      {/* Right: Radio Circle (fixes the bullet-on-left issue) */}
                      <View
                        style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}
                      >
                        {isSelected && <View style={styles.radioInnerDot} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Dynamic ID Number Input if official card selected */}
              {idProofType !== 'none' && (
                <View style={styles.idInputSection}>
                  <Text style={styles.inputLabel}>{t('skillTierModal.idNumberLabel')}</Text>
                  <TextInput
                    mode="outlined"
                    value={idProofNumber}
                    onChangeText={onChangeIdProofNumber}
                    placeholder={
                      idProofType === 'pehchan_card'
                        ? t('skillTierModal.pehchanPlaceholder')
                        : t('skillTierModal.pmvPlaceholder')
                    }
                    outlineColor={colors.border}
                    activeOutlineColor={colors.primary}
                    style={styles.textInput}
                    autoCapitalize="characters"
                  />
                  <Text style={styles.inputHelpText}>
                    {t('skillTierModal.idNumberHelp')}
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>

          {/* Sticky Bottom Action Dock */}
          <View
            style={[
              styles.bottomDock,
              { paddingBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            {message && (
              <View
                style={[
                  styles.messageBanner,
                  message.type === 'error' ? styles.messageError : styles.messageSuccess,
                ]}
              >
                <MaterialCommunityIcons
                  name={message.type === 'error' ? 'alert-circle-outline' : 'check-circle-outline'}
                  size={18}
                  color={message.type === 'error' ? colors.error : '#065F46'}
                />
                <Text
                  style={[
                    styles.messageText,
                    message.type === 'error' ? styles.messageTextError : styles.messageTextSuccess,
                  ]}
                  numberOfLines={2}
                >
                  {message.text}
                </Text>
              </View>
            )}

            <Button
              mode="contained"
              onPress={onSubmit}
              loading={submitting}
              disabled={submitting}
              buttonColor={colors.primary}
              style={styles.submitBtn}
              labelStyle={styles.submitBtnLabel}
            >
              {status === 'pending_verification'
                ? t('skillTierModal.resubmit')
                : t('skillTierModal.submit')}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  topBackdrop: {
    width: '100%',
  },
  sheetContainer: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: colors.surface,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTextGroup: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.lg,
    paddingBottom: 24,
  },

  // Live Wage Floor Callout Card
  wageFloorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  wageFloorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  wageIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FAF5F2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FDE8E1',
  },
  wageHeaderDetails: {
    flex: 1,
  },
  wageEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.primary,
  },
  wageRateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
    gap: 4,
  },
  wageRateNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  wageRateUnit: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  wageDailyPill: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
    marginLeft: 4,
  },
  wageFloorDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 10,
  },
  wageFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  wageFooterText: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '600',
  },

  // Section Grouping
  sectionContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  sectionStepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionStepBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.text,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  subFieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  cardsStack: {
    gap: 8,
  },

  // Tier Card
  tierCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#FAFAFA',
    gap: 12,
  },
  tierCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FAF5F2',
  },
  tierIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierIconBoxSelected: {
    backgroundColor: '#FFFFFF',
  },
  tierEmoji: {
    fontSize: 20,
  },
  tierInfo: {
    flex: 1,
  },
  tierTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  tierTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  tierTitleSelected: {
    color: colors.primary,
  },
  tierStatutoryBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tierStatutoryBadgeSelected: {
    color: colors.primary,
    backgroundColor: '#FDE8E1',
  },
  tierExperience: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  // State Pills
  statePillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#FAFAFA',
    gap: 6,
  },
  statePillSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FAF5F2',
  },
  statePillName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  statePillNameSelected: {
    color: colors.primary,
  },
  stateCodeBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: '#E5E7EB',
  },
  stateCodeBadgeSelected: {
    backgroundColor: '#FDE8E1',
  },
  stateCodeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textMuted,
  },
  stateCodeTextSelected: {
    color: colors.primary,
  },

  // Zone Card
  zoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#FAFAFA',
    gap: 10,
  },
  zoneCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FAF5F2',
  },
  zoneCardText: {
    flex: 1,
  },
  zoneName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  zoneNameSelected: {
    color: colors.primary,
  },
  zoneNote: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Credential Cards (Fixed: Radio Circle on Right, Icon on Left)
  proofCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#FAFAFA',
    gap: 12,
  },
  proofCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FAF5F2',
  },
  proofIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofIconBoxSelected: {
    backgroundColor: '#FDE8E1',
  },
  proofTextContainer: {
    flex: 1,
  },
  proofLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  proofLabelSelected: {
    color: colors.primary,
  },
  proofHelper: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 15,
  },

  // Dynamic ID input
  idInputSection: {
    marginTop: 4,
    gap: 4,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    fontSize: 14,
  },
  inputHelpText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Radio Circle
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  radioCircleSelected: {
    borderColor: colors.primary,
  },
  radioInnerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },

  // Sticky Bottom Dock
  bottomDock: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 4,
  },
  messageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  messageError: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
  },
  messageSuccess: {
    backgroundColor: '#D1FAE5',
    borderColor: '#A7F3D0',
  },
  messageText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  messageTextError: {
    color: colors.error,
    fontWeight: '600',
  },
  messageTextSuccess: {
    color: '#065F46',
    fontWeight: '600',
  },
  submitBtn: {
    borderRadius: 14,
    paddingVertical: 4,
  },
  submitBtnLabel: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
