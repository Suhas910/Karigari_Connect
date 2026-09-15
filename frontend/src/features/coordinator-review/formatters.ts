// src/features/coordinator-review/formatters.ts

export const formatSkillTier = (tier?: string | null): string => {
  if (!tier) return 'Not Specified';
  switch (tier) {
    case 'unskilled':
      return 'Unskilled (Helper)';
    case 'semi_skilled':
      return 'Semi-Skilled (Apprentice)';
    case 'skilled':
      return 'Skilled (Artisan)';
    case 'highly_skilled':
      return 'Highly Skilled (Master Craftsman)';
    default:
      return tier.replace(/_/g, ' ');
  }
};

export const formatIdProof = (type?: string | null): string => {
  if (!type || type === 'none') return 'None';
  if (type === 'pehchan_card') return 'Pehchan Card';
  if (type === 'pm_vishwakarma') return 'PM Vishwakarma';
  return type.replace(/_/g, ' ');
};

export const formatClaimLabel = (raw: string): string => {
  if (raw === 'skill_level_master_self_declared') {
    return 'Master Craftsman Tier (Self-Declared)';
  }
  return raw
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};
