// src/constants/states.ts
// Comprehensive list of all 36 Indian states and Union Territories in strict alphabetical order.
// Zone structures and notes match official notifications in wage_rates.json.

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

export const SUPPORTED_STATES: SupportedState[] = [
  {
    code: 'AN',
    name: 'Andaman and Nicobar Islands',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'AP',
    name: 'Andhra Pradesh',
    note: 'Zones 1–2',
    zones: [
      {
        code: 'zone_1',
        name: 'Zone 1',
        note: 'Municipal Corporations & Special Grade Municipalities (Visakhapatnam, Vijayawada, Guntur, Nellore, Kurnool)',
      },
      {
        code: 'zone_2',
        name: 'Zone 2',
        note: 'All areas outside Zone I',
      },
    ],
  },
  {
    code: 'AR',
    name: 'Arunachal Pradesh',
    note: 'Areas I–II',
    zones: [
      { code: 'zone_1', name: 'Area I', note: 'Area I (Plains/Towns)' },
      { code: 'zone_2', name: 'Area II', note: 'Area II (Hilly/Remote)' },
    ],
  },
  {
    code: 'AS',
    name: 'Assam',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'BR',
    name: 'Bihar',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'CH',
    name: 'Chandigarh',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'CG',
    name: 'Chhattisgarh',
    note: 'Zones A–C',
    zones: [
      { code: 'zone_1', name: 'Zone A', note: 'Municipal Corporations' },
      { code: 'zone_2', name: 'Zone B', note: 'Municipal Councils & Industrial Areas' },
      { code: 'zone_3', name: 'Zone C', note: 'Rural Panchayats' },
    ],
  },
  {
    code: 'DD',
    name: 'Dadra and Nagar Haveli and Daman and Diu',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'DL',
    name: 'Delhi (NCT)',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'GA',
    name: 'Goa',
    note: 'Zones A–B',
    zones: [
      { code: 'zone_1', name: 'Zone A', note: 'Urban Zone A' },
      { code: 'zone_2', name: 'Zone B', note: 'Rural Zone B / General Baseline' },
    ],
  },
  {
    code: 'GJ',
    name: 'Gujarat',
    note: 'Zones I–II',
    zones: [
      {
        code: 'zone_1',
        name: 'Zone I',
        note: 'Municipal Corporations & Urban Dev Authority areas',
      },
      {
        code: 'zone_2',
        name: 'Zone II',
        note: 'Other Municipalities',
      },
    ],
  },
  {
    code: 'HR',
    name: 'Haryana',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'HP',
    name: 'Himachal Pradesh',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'JK',
    name: 'Jammu and Kashmir',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'JH',
    name: 'Jharkhand',
    note: 'Areas A–C',
    zones: [
      { code: 'zone_1', name: 'Area A', note: 'Ranchi, Dhanbad, Jamshedpur, Deoghar' },
      { code: 'zone_2', name: 'Area B', note: 'Other Municipalities' },
      { code: 'zone_3', name: 'Area C', note: 'Rural areas' },
    ],
  },
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
    code: 'KL',
    name: 'Kerala',
    note: 'Zones 1–2',
    zones: [
      { code: 'zone_1', name: 'Zone 1', note: 'Thiruvananthapuram CPI Centre (Grade E)' },
      { code: 'zone_2', name: 'Zone 2', note: 'Kochi (Ernakulam) CPI Centre (Grade E)' },
    ],
  },
  {
    code: 'LA',
    name: 'Ladakh',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'LD',
    name: 'Lakshadweep',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'MP',
    name: 'Madhya Pradesh',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'MH',
    name: 'Maharashtra',
    note: 'Zones 1–3',
    zones: [
      {
        code: 'zone_1',
        name: 'Zone 1',
        note: 'Municipal corporation areas + industrial zones within 20 km (Mumbai, Pune)',
      },
      { code: 'zone_2', name: 'Zone 2', note: 'A and B class municipal council limits' },
      { code: 'zone_3', name: 'Zone 3', note: 'All other areas (rural and semi-urban)' },
    ],
  },
  {
    code: 'MN',
    name: 'Manipur',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'ML',
    name: 'Meghalaya',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'MZ',
    name: 'Mizoram',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'NL',
    name: 'Nagaland',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'OD',
    name: 'Odisha',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'PY',
    name: 'Puducherry',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'PB',
    name: 'Punjab',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'RJ',
    name: 'Rajasthan',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'SK',
    name: 'Sikkim',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'TN',
    name: 'Tamil Nadu',
    note: 'Zones A–B',
    zones: [
      {
        code: 'zone_1',
        name: 'Zone A',
        note: 'Corporations & Special Grade Municipalities',
      },
      {
        code: 'zone_2',
        name: 'Zone B',
        note: 'Other Municipalities',
      },
    ],
  },
  {
    code: 'TG',
    name: 'Telangana',
    note: 'Zones I–III',
    zones: [
      { code: 'zone_1', name: 'Zone I', note: 'GHMC & Municipal Corporations' },
      { code: 'zone_2', name: 'Zone II', note: 'District Headquarters & Municipalities' },
      { code: 'zone_3', name: 'Zone III', note: 'Townships & Rural Areas' },
    ],
  },
  {
    code: 'TR',
    name: 'Tripura',
    note: 'Statewide Unified Schedule',
    zones: [{ code: 'statewide', name: 'Statewide', note: 'Statewide Unified Schedule' }],
  },
  {
    code: 'UP',
    name: 'Uttar Pradesh',
    note: 'Tiers 1–3',
    zones: [
      { code: 'zone_1', name: 'Tier 1', note: 'Noida, Greater Noida, Ghaziabad' },
      {
        code: 'zone_2',
        name: 'Tier 2',
        note: 'Municipal Corporations: Lucknow, Kanpur, Agra, Varanasi, etc.',
      },
      { code: 'zone_3', name: 'Tier 3', note: 'Other Districts' },
    ],
  },
  {
    code: 'UK',
    name: 'Uttarakhand',
    note: 'Zones 1–2',
    zones: [
      {
        code: 'zone_1',
        name: 'Zone 1',
        note: 'Towns ≥ 1 Lakh (Dehradun, Haridwar, Haldwani, Roorkee, Rudrapur, Kashipur)',
      },
      {
        code: 'zone_2',
        name: 'Zone 2',
        note: 'Other Areas (Towns < 1 Lakh and rural)',
      },
    ],
  },
  {
    code: 'WB',
    name: 'West Bengal',
    note: 'Zones A–B',
    zones: [
      {
        code: 'zone_1',
        name: 'Zone A',
        note: 'Kolkata, Howrah, Siliguri, Asansol & Industrial Areas',
      },
      {
        code: 'zone_2',
        name: 'Zone B',
        note: 'Other Municipalities & Rural Areas',
      },
    ],
  },
];
