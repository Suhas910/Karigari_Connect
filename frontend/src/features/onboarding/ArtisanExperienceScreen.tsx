import React, { useState } from "react";
import { View, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Text, Button, RadioButton } from "react-native-paper";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ArtisanStackParamList } from "../../types/navigation";
import { useTranslation } from "react-i18next";
import { useDraftStore, PILOT_STATES, type SkillLevel } from "../../store/draftStore";
import { getDraft, saveDraft } from "../../services/database";
import { colors, spacing, typography } from "../../theme";
import { StepHeader, BottomDock, SkillTierPicker, type SkillOption, OPTION_TO_STATUTORY_SKILL as OPTION_TO_SKILL_LEVEL } from "../../components";

export default function ArtisanExperienceScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ArtisanStackParamList>>();
  const route = useRoute<RouteProp<ArtisanStackParamList, "ArtisanExperience">>();
  const draftId = route.params?.draftId;

  const [selected, setSelected] = useState<SkillOption | null>(null);
  const [hasCard, setHasCard] = useState<boolean | null>(null);
  const selectedState = useDraftStore((s) => s.selectedState);
  const selectedZone = useDraftStore((s) => s.selectedZone);
  const setSelectedZone = useDraftStore((s) => s.setSelectedZone);
  const setSkillDeclaration = useDraftStore((s) => s.setSkillDeclaration);

  const currentStateObj = PILOT_STATES.find((s) => s.code === selectedState) || PILOT_STATES[0];
  const availableZones = currentStateObj.zones;

  const canContinue = selected !== null && hasCard !== null && Boolean(selectedZone);

  async function handleContinue() {
    if (!selected || hasCard === null) return;
    const baseSkill = OPTION_TO_SKILL_LEVEL[selected];
    // Official artisan card holders with seasoned craft mastery qualify for the highest statutory tier
    const finalSkill: SkillLevel =
      hasCard && (baseSkill === "skilled" || baseSkill === "highly_skilled")
        ? "highly_skilled"
        : baseSkill;

    const isCardElevated = Boolean(hasCard && (baseSkill === "skilled" || baseSkill === "highly_skilled"));
    const declaration = {
      skillLevelSelfDeclared: finalSkill,
      hasArtisanCard: hasCard,
      source: isCardElevated ? ("artisan_card_elevation" as const) : ("self_declared" as const),
      zone: selectedZone,
      stateCode: selectedState,
    };
    setSkillDeclaration(declaration);

    if (draftId) {
      try {
        const existing = await getDraft(draftId);
        await saveDraft({
          id: draftId,
          listing_id: existing?.listing_id ?? draftId,
          state: existing?.state ?? "draft",
          preferred_language: existing?.preferred_language ?? "en",
          payload: {
            ...(existing?.payload ?? {}),
            skillDeclaration: declaration,
          },
        });
      } catch (dbErr) {
        console.error("Failed to update draft with skillDeclaration", dbErr);
      }
      navigation.navigate("Price", { draftId });
    } else {
      navigation.navigate("Capture");
    }
  }

  return (
    <View style={styles.outerContainer}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <StepHeader
          currentStep={5}
          totalSteps={5}
          title={t("onboarding.skillQuestion.title", "Craft Experience Profile")}
          subtitle={t("onboarding.skillQuestion.subtitle", "Skill tier for fair wage lookup")}
        />

        <SkillTierPicker selected={selected} onSelect={setSelected} />

        <View style={styles.cardSection}>
          <Text variant="bodyMedium" style={styles.cardQuestion}>
            {t("onboarding.skillQuestion.artisanCardPrompt.question")}
          </Text>
          <View style={styles.cardOptionsRow}>
            <TouchableOpacity
              style={[styles.pillButton, hasCard === true && styles.pillButtonSelected]}
              onPress={() => setHasCard(true)}
            >
              <Text
                style={[styles.pillText, hasCard === true && styles.pillTextSelected]}
              >
                {t("onboarding.skillQuestion.artisanCardPrompt.yes")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pillButton, hasCard === false && styles.pillButtonSelected]}
              onPress={() => setHasCard(false)}
            >
              <Text
                style={[styles.pillText, hasCard === false && styles.pillTextSelected]}
              >
                {t("onboarding.skillQuestion.artisanCardPrompt.no")}
              </Text>
            </TouchableOpacity>
          </View>
          {hasCard === true && (
            <Text variant="bodySmall" style={styles.helperText}>
              {t("onboarding.skillQuestion.artisanCardPrompt.helperText")}
            </Text>
          )}
        </View>

        {/* State & Zone Jurisdiction Section */}
        <View style={styles.zoneSection}>
          <View style={styles.zoneSectionHeader}>
            <Text style={styles.zoneSectionTitle}>
              {t('experience.zoneTitle')}
            </Text>
            <Text style={styles.zoneSectionSub}>
              {t('experience.zoneSub', { state: `${currentStateObj.name} (${currentStateObj.code})` })}
            </Text>
          </View>

          {availableZones.length > 1 ? (
            <View style={styles.zoneList}>
              {availableZones.map((z) => {
                const isZoneSelected = selectedZone === z.code;
                return (
                  <TouchableOpacity
                    key={z.code}
                    style={[styles.zoneCard, isZoneSelected && styles.zoneCardSelected]}
                    onPress={() => setSelectedZone(z.code)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.zoneCardLeft}>
                      <Text style={[styles.zoneName, isZoneSelected && styles.zoneNameSelected]}>
                        {z.name}
                      </Text>
                      <Text style={styles.zoneNote}>{z.note}</Text>
                    </View>
                    <RadioButton
                      value={z.code}
                      status={isZoneSelected ? "checked" : "unchecked"}
                      onPress={() => setSelectedZone(z.code)}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={styles.singleZoneCard}>
              <Text style={styles.singleZoneTitle}>{availableZones[0]?.name || t('experience.statewide')}</Text>
              <Text style={styles.singleZoneNote}>{availableZones[0]?.note || t('experience.unifiedSchedule')}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <BottomDock>
        <Button
          mode="contained"
          onPress={handleContinue}
          disabled={!canContinue}
          buttonColor={colors.primary}
          style={styles.cta}
          contentStyle={styles.ctaContent}
        >
          {t("common.continue", "Proceed to Price Protection")}
        </Button>
      </BottomDock>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 120,
  },
  title: {
    fontFamily: typography.heading,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontFamily: typography.body,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  optionsGroup: {
    marginBottom: spacing.xl,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: "#fff",
  },
  optionCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: "#FFF1EA",
  },
  optionIcon: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  optionLabel: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: 16,
    color: colors.text,
  },
  cardSection: {
    marginBottom: spacing.xl,
  },
  cardQuestion: {
    fontFamily: typography.body,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  cardOptionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  pillButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E0D5C7",
    backgroundColor: "#fff",
  },
  pillButtonSelected: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  pillText: {
    fontFamily: typography.body,
    color: colors.text,
  },
  pillTextSelected: {
    color: "#fff",
  },
  helperText: {
    marginTop: spacing.sm,
    color: colors.text,
    opacity: 0.7,
  },
  cta: {
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  ctaContent: {
    minHeight: 48,
  },
  zoneSection: {
    marginBottom: spacing.xl,
  },
  zoneSectionHeader: {
    marginBottom: spacing.sm,
  },
  zoneSectionTitle: {
    fontFamily: typography.body,
    fontWeight: "700",
    color: colors.text,
    fontSize: 16,
  },
  zoneSectionSub: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  zoneList: {
    gap: spacing.xs,
  },
  zoneCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 14,
    padding: spacing.md,
    backgroundColor: "#fff",
    marginBottom: spacing.xs,
  },
  zoneCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: "#FFF1EA",
  },
  zoneCardLeft: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  zoneName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 2,
  },
  zoneNameSelected: {
    color: colors.primary,
  },
  zoneNote: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  singleZoneCard: {
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0D5C7",
    backgroundColor: "#fff",
  },
  singleZoneTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 2,
  },
  singleZoneNote: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
