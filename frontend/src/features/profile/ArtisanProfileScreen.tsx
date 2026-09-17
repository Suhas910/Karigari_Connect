// src/features/profile/ArtisanProfileScreen.tsx
// Context & Architectural Notes:
// 1. Existing data model, API calls, and state synchronisation with draftStore are 100% preserved.
// 2. The verbose inline form has been restructured into a compact card layout:
//    - Identity Card (avatar, name, short ID chip, role subtitle, contact info, status pill with info button)
//    - Location Card (terracotta pin icon, state/zone, jurisdiction note, "Configured" chip)
//    - Workshop & ID Services list (compact icon rows with chevron)
//    - Full-width pill logout button in footer
// 3. Detailed form inputs (Skill Tier picker, State pills, Zone cards, ID proof radios, ID number input)
//    are encapsulated in SkillTierEditModal to avoid structural changes to navigation stacks.

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { service } from '../../services';
import { colors, spacing } from '../../theme';
import { type SkillOption, OPTION_TO_STATUTORY_SKILL, STATUTORY_SKILL_TO_OPTION } from '../../components';
import { PILOT_STATES, useDraftStore } from '../../store/draftStore';
import { useAuthStore } from '../../store/authStore';
import type {
  ArtisanProfile,
  IdProofType,
  PersonalDetailsUpdate,
  BusinessDetailsUpdate,
  BankDetailsUpdate,
} from '../../types/contracts';

import { IdentityCard } from './IdentityCard';
import { SettingsRow } from './SettingsRow';
import { StatusExplanationModal } from './StatusExplanationModal';
import { SkillTierEditModal } from './SkillTierEditModal';
import { LanguagePickerModal, LANGUAGES } from './LanguagePickerModal';
import { PersonalDetailsEditModal } from './PersonalDetailsEditModal';
import { BusinessDetailsEditModal } from './BusinessDetailsEditModal';
import { BankDetailsEditModal } from './BankDetailsEditModal';

// Translation keys under profile.skillShort / profile.idProofShort.
const SKILL_LABEL_MAP: Record<SkillOption, string> = {
  beginner: 'profile.skillShort.beginner',
  intermediate: 'profile.skillShort.intermediate',
  skilled: 'profile.skillShort.skilled',
  master: 'profile.skillShort.master',
};

const ID_PROOF_LABEL_MAP: Record<IdProofType, string> = {
  pehchan_card: 'profile.idProofShort.pehchan_card',
  pm_vishwakarma: 'profile.idProofShort.pm_vishwakarma',
  none: 'profile.idProofShort.none',
};

export default function ArtisanProfileScreen() {
  const { t, i18n } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [profile, setProfile] = useState<ArtisanProfile | null>(null);

  // Draft store jurisdictions
  const selectedState = useDraftStore((s) => s.selectedState);
  const setSelectedState = useDraftStore((s) => s.setSelectedState);
  const selectedZone = useDraftStore((s) => s.selectedZone);
  const setSelectedZone = useDraftStore((s) => s.setSelectedZone);

  // Form states
  const [selectedSkill, setSelectedSkill] = useState<SkillOption | null>('skilled');
  const [idProofType, setIdProofType] = useState<IdProofType>('none');
  const [idProofNumber, setIdProofNumber] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal display states
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [personalModalVisible, setPersonalModalVisible] = useState(false);
  const [businessModalVisible, setBusinessModalVisible] = useState(false);
  const [bankModalVisible, setBankModalVisible] = useState(false);
  const [personalSubmitting, setPersonalSubmitting] = useState(false);
  const [businessSubmitting, setBusinessSubmitting] = useState(false);
  const [bankSubmitting, setBankSubmitting] = useState(false);

  const handlePersonalSubmit = async (payload: PersonalDetailsUpdate) => {
    setPersonalSubmitting(true);
    try {
      const updated = await service.submitPersonalDetails(payload);
      setProfile(updated);
      setPersonalModalVisible(false);
    } finally {
      setPersonalSubmitting(false);
    }
  };

  const handleBusinessSubmit = async (payload: BusinessDetailsUpdate) => {
    setBusinessSubmitting(true);
    try {
      const updated = await service.submitBusinessDetails(payload);
      setProfile(updated);
      setBusinessModalVisible(false);
    } finally {
      setBusinessSubmitting(false);
    }
  };

  const handleBankSubmit = async (payload: BankDetailsUpdate) => {
    setBankSubmitting(true);
    try {
      const updated = await service.submitBankDetails(payload);
      setProfile(updated);
      setBankModalVisible(false);
    } finally {
      setBankSubmitting(false);
    }
  };

  const currentStateObj = PILOT_STATES.find((s) => s.code === (selectedState || 'KA')) || PILOT_STATES[0];
  const currentZoneObj = currentStateObj.zones.find((z) => z.code === selectedZone) || currentStateObj.zones[0];

  const handleSwitchRole = async () => {
    await useAuthStore.getState().logout();
  };

  const handleSelectState = (stateCode: string) => {
    setSelectedState(stateCode);
    const targetState = PILOT_STATES.find((s) => s.code === stateCode);
    if (targetState && targetState.zones.length > 0) {
      setSelectedZone(targetState.zones[0].code);
    }
  };

  // Load profile on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const p = await service.getArtisanProfile();
        setProfile(p);
        if (p.declared_skill_level && STATUTORY_SKILL_TO_OPTION[p.declared_skill_level]) {
          setSelectedSkill(STATUTORY_SKILL_TO_OPTION[p.declared_skill_level]);
        }
        if (p.id_proof_type) {
          setIdProofType(p.id_proof_type);
        }
        if (p.id_proof_number) {
          setIdProofNumber(p.id_proof_number);
        }
        if (p.declared_zone) {
          const [state, zone] = p.declared_zone.split('/');
          if (state) setSelectedState(state, zone);
        }
        if (p.declared_skill_level) {
          useDraftStore.getState().setSkillDeclaration({
            skillLevelSelfDeclared: p.declared_skill_level as any,
            hasArtisanCard: p.id_proof_type === 'pehchan_card' || p.id_proof_type === 'pm_vishwakarma',
            source:
              p.verified_skill_level && p.profile_status === 'verified'
                ? 'coordinator_verified'
                : p.id_proof_type === 'pehchan_card' || p.id_proof_type === 'pm_vishwakarma'
                ? 'artisan_card_elevation'
                : 'self_declared',
            stateCode: p.declared_zone ? p.declared_zone.split('/')[0] : undefined,
            zone: p.declared_zone ? p.declared_zone.split('/')[1] : undefined,
          });
        }
      } catch (err) {
        console.error('Failed to load artisan profile', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSubmit = async () => {
    if (!selectedSkill) {
      setMessage({ type: 'error', text: t('profile.selectSkill') });
      return;
    }
    if (!selectedZone) {
      setMessage({ type: 'error', text: t('profile.selectZone') });
      return;
    }
    if (idProofType !== 'none' && !idProofNumber.trim()) {
      setMessage({ type: 'error', text: t('profile.enterIdNumber') });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const updated = await service.submitArtisanProfile({
        declared_skill_level: OPTION_TO_STATUTORY_SKILL[selectedSkill],
        declared_zone: `${selectedState}/${selectedZone}`,
        id_proof_type: idProofType,
        id_proof_number: idProofType !== 'none' ? idProofNumber.trim() : null,
      });
      setProfile(updated);
      useDraftStore.getState().setSelectedState(selectedState, selectedZone);
      useDraftStore.getState().setSkillDeclaration({
        skillLevelSelfDeclared: OPTION_TO_STATUTORY_SKILL[selectedSkill],
        hasArtisanCard: idProofType === 'pehchan_card' || idProofType === 'pm_vishwakarma',
        source:
          idProofType === 'pehchan_card' || idProofType === 'pm_vishwakarma'
            ? 'artisan_card_elevation'
            : 'self_declared',
        stateCode: selectedState,
        zone: selectedZone,
      });
      setMessage({
        type: 'success',
        text: t('profile.submitted'),
      });
      // Close edit modal after brief delay or keep banner visible
      setTimeout(() => {
        setEditModalVisible(false);
        setMessage(null);
      }, 1400);
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err?.response?.data?.error?.message || t('profile.submitFailed'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Subtitles for "YOUR DETAILS" section
  const personalFullName = profile?.first_name
    ? [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' ')
    : null;
  const personalSubtitle = personalFullName || profile?.email || t('profile.personalSubtitlePlaceholder');

  const businessLoc = [profile?.city, profile?.business_state_code].filter(Boolean).join(', ');
  const businessSubtitle = profile?.business_name
    ? (businessLoc ? `${profile.business_name} • ${businessLoc}` : profile.business_name)
    : t('profile.businessSubtitlePlaceholder');

  const bankSubtitle = profile?.bank_name
    ? (profile.account_number ? `${profile.bank_name} • ${profile.account_number}` : profile.bank_name)
    : (profile?.account_number || t('profile.bankSubtitlePlaceholder'));

  const stateSubtitle = `${currentStateObj.name} • ${currentZoneObj?.name || t('listings.zone1')}`;

  // Row 1 subtitle: Declared Tier + Credential
  const tierName = selectedSkill ? t(SKILL_LABEL_MAP[selectedSkill]) : t('profile.declaredTier');
  const idProofName = t(ID_PROOF_LABEL_MAP[idProofType]);
  const skillSubtitle = `${tierName} • ${idProofName}`;

  // Row 2 subtitle: Current active language
  const currentLang = LANGUAGES.find((l) => l.code === i18n.language) || LANGUAGES[0];
  const langSubtitle = t('profile.languageSelected', { language: currentLang.label });

  const username = profile?.username || 'artisan';
  const displayName = profile?.name_as_per_aadhaar?.trim() || username;

  return (
    <View style={styles.outerContainer}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Identity Card (Top) */}
        <IdentityCard
          profile={profile}
          onPressInfo={() => setStatusModalVisible(true)}
        />

        {/* 2. Section: "YOUR DETAILS" */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeaderTitle}>{t('profile.yourDetailsHeader')}</Text>
        </View>

        <View style={styles.settingsCard}>
          {/* Row 1: Personal Details */}
          <SettingsRow
            icon="account-details-outline"
            iconBgColor="#FAF5F2"
            iconColor={colors.primary}
            title={t('profile.personalDetailsTitle')}
            subtitle={personalSubtitle}
            badgeText={profile?.first_name ? t('profile.configured') : undefined}
            showDivider={true}
            onPress={() => setPersonalModalVisible(true)}
          />

          {/* Row 2: State & Jurisdiction */}
          <SettingsRow
            icon="map-marker-outline"
            iconBgColor="#FAF5F2"
            iconColor={colors.primary}
            title={t('profile.stateJurisdictionTitle')}
            subtitle={stateSubtitle}
            badgeText={selectedState && selectedZone ? t('profile.configured') : undefined}
            showDivider={true}
            onPress={() => setEditModalVisible(true)}
          />

          {/* Row 3: Business Details */}
          <SettingsRow
            icon="briefcase-outline"
            iconBgColor="#FAF5F2"
            iconColor={colors.primary}
            title={t('profile.businessDetailsTitle')}
            subtitle={businessSubtitle}
            badgeText={profile?.business_name || profile?.pan_number ? t('profile.configured') : undefined}
            showDivider={true}
            onPress={() => setBusinessModalVisible(true)}
          />

          {/* Row 4: Bank Details */}
          <SettingsRow
            icon="bank-outline"
            iconBgColor="#FAF5F2"
            iconColor={colors.primary}
            title={t('profile.bankDetailsTitle')}
            subtitle={bankSubtitle}
            badgeText={profile?.account_number ? t('profile.configured') : undefined}
            showDivider={false}
            onPress={() => setBankModalVisible(true)}
          />
        </View>

        {/* 3. Section: "WORKSHOP & ID SERVICES" */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeaderTitle}>{t('profile.servicesHeader')}</Text>
        </View>

        <View style={styles.settingsCard}>
          {/* Row 1: Skill Tier & Official ID */}
          <SettingsRow
            icon="certificate-outline"
            iconBgColor="#FAF5F2"
            iconColor={colors.primary}
            title={t('profile.skillTierTitle')}
            subtitle={skillSubtitle}
            showDivider={true}
            onPress={() => setEditModalVisible(true)}
          />

          {/* Row 2: App Language / भाषा */}
          <SettingsRow
            icon="translate"
            iconBgColor={colors.indigoLight}
            iconColor={colors.secondary}
            title={t('profile.appLanguage')}
            subtitle={langSubtitle}
            badgeText={currentLang.shortCode}
            showDivider={false}
            onPress={() => setLanguageModalVisible(true)}
          />
        </View>

        {/* 8. Footer: Full-Width Pill Logout Button */}
        <TouchableOpacity
          style={styles.logoutPillButton}
          onPress={handleSwitchRole}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t('profile.logoutA11y', { username: displayName })}
        >
          <View style={styles.logoutLeft}>
            <MaterialCommunityIcons name="logout-variant" size={18} color={colors.primary} />
            <Text style={styles.logoutText}>{t('profile.logout')}</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>

      {/* Sub-Views & Modals */}
      <PersonalDetailsEditModal
        visible={personalModalVisible}
        profile={profile}
        submitting={personalSubmitting}
        onSubmit={handlePersonalSubmit}
        onDismiss={() => setPersonalModalVisible(false)}
      />

      <BusinessDetailsEditModal
        visible={businessModalVisible}
        profile={profile}
        submitting={businessSubmitting}
        onSubmit={handleBusinessSubmit}
        onDismiss={() => setBusinessModalVisible(false)}
      />

      <BankDetailsEditModal
        visible={bankModalVisible}
        profile={profile}
        submitting={bankSubmitting}
        onSubmit={handleBankSubmit}
        onDismiss={() => setBankModalVisible(false)}
      />

      <StatusExplanationModal
        visible={statusModalVisible}
        profile={profile}
        onDismiss={() => setStatusModalVisible(false)}
      />

      <SkillTierEditModal
        visible={editModalVisible}
        profile={profile}
        selectedSkill={selectedSkill}
        onSelectSkill={setSelectedSkill}
        selectedState={selectedState}
        onSelectState={handleSelectState}
        selectedZone={selectedZone}
        onSelectZone={setSelectedZone}
        idProofType={idProofType}
        onChangeIdProofType={setIdProofType}
        idProofNumber={idProofNumber}
        onChangeIdProofNumber={setIdProofNumber}
        submitting={submitting}
        onSubmit={handleSubmit}
        message={message}
        onDismiss={() => {
          setEditModalVisible(false);
          setMessage(null);
        }}
      />

      <LanguagePickerModal
        visible={languageModalVisible}
        onDismiss={() => setLanguageModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: 100,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: spacing.xs,
  },
  sectionHeaderTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.textMuted,
  },
  sectionHeaderCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  settingsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  logoutPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.badgeNeutral,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: spacing.tapTarget,
    marginTop: spacing.sm,
  },
  logoutLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  logoutHandle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    maxWidth: 120,
  },
});
