// src/store/draftStore.ts
import { create } from 'zustand';
import { SUPPORTED_STATES, type SupportedState, type StateZone } from '../constants/states';

export type SkillLevel = 'unskilled' | 'semi_skilled' | 'skilled' | 'highly_skilled';

export interface SkillDeclaration {
  skillLevelSelfDeclared: SkillLevel;
  hasArtisanCard: boolean;
  source: 'self_declared' | 'technique_floor' | 'artisan_card_elevation' | 'coordinator_verified';
  zone?: string;
  stateCode?: string;
}

export type { StateZone, SupportedState };

// Kept as PILOT_STATES for backward compatibility — 8 existing files import
// this name (ArtisanProfileScreen, SkillTierEditModal, LiveListingsScreen,
// InReviewListingsScreen, MyListingsScreen, ArtisanExperienceScreen). Full
// list now lives in constants/states.ts.
export const PILOT_STATES: SupportedState[] = SUPPORTED_STATES;

interface DraftState {
  activeDraftId: string | null;
  skillDeclaration: SkillDeclaration | null;
  selectedState: string;
  selectedZone: string;
  setActiveDraft: (id: string) => void;
  clearDraft: () => void;
  setSkillDeclaration: (declaration: SkillDeclaration) => void;
  setSelectedState: (stateCode: string, zoneCode?: string) => void;
  setSelectedZone: (zoneCode: string) => void;
}

// Persists the local draftId from the first capture so later actions safely attach to it.
export const useDraftStore = create<DraftState>((set) => ({
  activeDraftId: null,
  skillDeclaration: null,
  selectedState: 'KA',
  selectedZone: 'zone_1',
  setActiveDraft: (id) => set({ activeDraftId: id }),
  clearDraft: () => set({ activeDraftId: null, skillDeclaration: null }),
  setSkillDeclaration: (declaration) => set({ skillDeclaration: declaration }),
  setSelectedState: (stateCode, zoneCode) => {
    const upper = stateCode.toUpperCase();
    const st = PILOT_STATES.find((s) => s.code === upper);
    const defaultZone = zoneCode || st?.zones[0]?.code || 'zone_1';
    set({ selectedState: upper, selectedZone: defaultZone });
  },
  setSelectedZone: (zoneCode) => set({ selectedZone: zoneCode }),
}));