// src/store/draftStore.ts
import { create } from 'zustand';

export type SkillLevel = 'unskilled' | 'semi_skilled' | 'skilled' | 'highly_skilled';

export interface SkillDeclaration {
  skillLevelSelfDeclared: SkillLevel;
  hasArtisanCard: boolean;
  source: 'self_declared' | 'technique_floor' | 'artisan_card_elevation' | 'coordinator_verified';
  zone?: string;
  stateCode?: string;
}

export interface StateZone {
  code: string;
  name: string;
  note: string;
}

export interface SupportedState {
  code: string;
  name: string;
  note: string;
  zones: StateZone[];
}

export const PILOT_STATES: SupportedState[] = [
  {
    code: 'KA',
    name: 'Karnataka',
    note: 'Zones 1–4',
    zones: [
      { code: 'zone_1', name: 'Zone 1', note: 'Bengaluru (BBMP) & Agglomeration Areas' },
      { code: 'zone_2', name: 'Zone 2', note: 'Other Municipal Corporations (Mysore, Mangalore, Hubballi, etc.)' },
      { code: 'zone_3', name: 'Zone 3', note: 'District Headquarters' },
      { code: 'zone_4', name: 'Zone 4', note: 'Rural & all other parts of Karnataka' },
    ],
  },
  {
    code: 'UP',
    name: 'Uttar Pradesh',
    note: 'Statewide Unified Schedule',
    zones: [
      { code: 'statewide', name: 'Statewide', note: 'Unified schedule (Varanasi, Lucknow, etc.)' },
    ],
  },
  {
    code: 'WB',
    name: 'West Bengal',
    note: 'Zones A & B',
    zones: [
      { code: 'zone_a', name: 'Zone A', note: 'Kolkata, Municipalities & Notified Areas' },
      { code: 'zone_b', name: 'Zone B', note: 'Rural & rest of West Bengal (Shantiniketan, etc.)' },
    ],
  },
];

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