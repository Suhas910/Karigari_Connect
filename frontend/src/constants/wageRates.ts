// src/constants/wageRates.ts
// Single source of truth for statutory minimum wage rates in the frontend.
// Mechanically generates lookup mappings from wage_rates.json at module load time.
// Never invents or fabricates wages for tiers not officially notified by the state.

import wageRatesRaw from './wage_rates.json';
import {
  type SkillOption,
  SKILL_OPTIONS,
  STATUTORY_SKILL_TO_OPTION,
} from '../components/SkillTierPicker';

export interface WageFloorPreview {
  hourly: number;
  daily: number;
  notificationRef?: string;
  zoneNote?: string;
}

export interface RawWageRate {
  state_code: string;
  zone: string;
  skill_level: string;
  hourly_wage_inr: number;
  daily_wage_inr: number;
  notification_ref?: string;
  zone_note?: string;
  caution?: string;
  effective_from?: string;
  effective_to?: string;
  source_url?: string;
  verification_status?: string;
}

interface WageRatesJson {
  schema_version: string;
  derivation_rule: string;
  rates: RawWageRate[];
}

const wageRatesData = wageRatesRaw as unknown as WageRatesJson;

/**
 * Mechanically built lookup table from wage_rates.json.
 * Shape: [stateCode][zoneCode][skillOption] -> { hourly, daily, ... }
 * If a state does not notify a tier (e.g. UP has no highly_skilled / master tier),
 * that key is omitted / undefined.
 */
export const WAGE_FLOOR_LOOKUP: Record<
  string,
  Record<string, Partial<Record<SkillOption, WageFloorPreview>>>
> = {};

for (const r of wageRatesData.rates) {
  const state = r.state_code.toUpperCase();
  const zone = r.zone;
  const option = STATUTORY_SKILL_TO_OPTION[r.skill_level];

  if (!option) continue;

  if (!WAGE_FLOOR_LOOKUP[state]) {
    WAGE_FLOOR_LOOKUP[state] = {};
  }
  if (!WAGE_FLOOR_LOOKUP[state][zone]) {
    WAGE_FLOOR_LOOKUP[state][zone] = {};
  }

  WAGE_FLOOR_LOOKUP[state][zone][option] = {
    hourly: r.hourly_wage_inr,
    daily: r.daily_wage_inr,
    notificationRef: r.notification_ref,
    zoneNote: r.zone_note,
  };
}

const ZONE_ALIASES: Record<string, string> = {
  zone_a: 'zone_1',
  zone_b: 'zone_2',
  zone_c: 'zone_3',
  zone_d: 'zone_4',
  zone_1: 'zone_a',
  zone_2: 'zone_b',
  zone_3: 'zone_c',
  zone_4: 'zone_d',
};

/**
 * Looks up the statutory fair wage floor for preview banners and fare calculations.
 * Accepts either a frontend SkillOption ('beginner' | 'intermediate' | 'skilled' | 'master')
 * or a statutory skill level string ('unskilled' | 'semi_skilled' | 'skilled' | 'highly_skilled').
 *
 * Follows the same fallback hierarchy as pricing_service.py:
 * 1. Exact zone match
 * 2. Normalized zone alias (e.g. zone_a <-> zone_1)
 * 3. Statewide fallback
 * 4. First available zone fallback for the given skill option
 * Returns null if the state/zone has no official notification for this tier (e.g. UP master).
 */
export function getWageFloorPreview(
  stateCode?: string | null,
  zoneCode?: string | null,
  skillLevelOrOption?: string | SkillOption | null
): WageFloorPreview | null {
  if (!stateCode || !skillLevelOrOption) return null;

  const normalizedOption: SkillOption | undefined =
    STATUTORY_SKILL_TO_OPTION[skillLevelOrOption] ||
    (SKILL_OPTIONS.includes(skillLevelOrOption as SkillOption)
      ? (skillLevelOrOption as SkillOption)
      : undefined);

  if (!normalizedOption) return null;

  const rawState = stateCode.toUpperCase();
  const upperState = rawState === 'DN' ? 'DD' : rawState;
  const stateTable = WAGE_FLOOR_LOOKUP[upperState];
  if (!stateTable) return null;

  const targetZone = zoneCode || 'zone_1';

  // 1. Exact zone match
  if (stateTable[targetZone]?.[normalizedOption]) {
    return stateTable[targetZone][normalizedOption]!;
  }

  // 2. Zone alias normalization
  const alias = ZONE_ALIASES[targetZone];
  if (alias && stateTable[alias]?.[normalizedOption]) {
    return stateTable[alias][normalizedOption]!;
  }

  // 3. Statewide fallback
  if (stateTable['statewide']?.[normalizedOption]) {
    return stateTable['statewide'][normalizedOption]!;
  }

  // 4. First available zone fallback for the given skill tier
  for (const z of Object.keys(stateTable)) {
    if (stateTable[z]?.[normalizedOption]) {
      return stateTable[z][normalizedOption]!;
    }
  }

  return null;
}
