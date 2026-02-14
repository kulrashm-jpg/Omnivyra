/**
 * Hybrid Context Mode + Weighted Campaign Classification
 * Shared constants and validation for campaign_versions.
 */

export type BuildMode = 'full_context' | 'focused_context' | 'no_context';

export const BUILD_MODES: BuildMode[] = ['full_context', 'focused_context', 'no_context'];

export const CONTEXT_SCOPE_OPTIONS = [
  'commercial_strategy',
  'marketing_intelligence',
  'campaign_purpose',
  'brand_positioning',
  'competitive_advantages',
  'growth_priorities',
] as const;

export type ContextScopeOption = (typeof CONTEXT_SCOPE_OPTIONS)[number];

export const CAMPAIGN_TYPES = [
  'brand_awareness',
  'network_expansion',
  'lead_generation',
  'authority_positioning',
  'engagement_growth',
  'product_promotion',
] as const;

export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export type CampaignWeights = Record<string, number>;

export const DEFAULT_BUILD_MODE_SCRATCH: BuildMode = 'no_context';
export const DEFAULT_BUILD_MODE_RECOMMENDATION: BuildMode = 'full_context';
export const DEFAULT_BUILD_MODE_OPPORTUNITY: BuildMode = 'focused_context';

export const BACKWARD_COMPAT_DEFAULTS = {
  build_mode: 'full_context' as BuildMode,
  campaign_types: ['brand_awareness'] as string[],
  campaign_weights: { brand_awareness: 100 } as CampaignWeights,
};

export function normalizeCampaignTypes(
  types: string[] | null | undefined
): string[] {
  if (!types || !Array.isArray(types)) return [...BACKWARD_COMPAT_DEFAULTS.campaign_types];
  const valid = types.filter((t) =>
    CAMPAIGN_TYPES.includes(t as CampaignType)
  );
  return valid.length > 0 ? valid : [...BACKWARD_COMPAT_DEFAULTS.campaign_types];
}

export function normalizeCampaignWeights(
  types: string[],
  weights: CampaignWeights | null | undefined
): CampaignWeights {
  if (types.length === 1) {
    return { [types[0]]: 100 };
  }
  if (!weights || typeof weights !== 'object') {
    const perType = Math.floor(100 / types.length);
    const remainder = 100 - perType * types.length;
    const result: CampaignWeights = {};
    types.forEach((t, i) => {
      result[t] = perType + (i < remainder ? 1 : 0);
    });
    return result;
  }
  const sum = types.reduce((s, t) => s + (Number(weights[t]) || 0), 0);
  if (sum !== 100) {
    const perType = Math.floor(100 / types.length);
    const remainder = 100 - perType * types.length;
    const result: CampaignWeights = {};
    types.forEach((t, i) => {
      result[t] = perType + (i < remainder ? 1 : 0);
    });
    return result;
  }
  const filtered: CampaignWeights = {};
  types.forEach((t) => {
    filtered[t] = Number(weights[t]) || 0;
  });
  return filtered;
}

export function getPrimaryCampaignType(weights: CampaignWeights): string {
  const entries = Object.entries(weights).filter(([, v]) => v > 0);
  if (entries.length === 0) return 'brand_awareness';
  return entries.reduce((a, b) => (a[1] >= b[1] ? a : b))[0];
}

export function validateCampaignWeights(
  types: string[],
  weights: CampaignWeights
): { valid: boolean; error?: string } {
  if (types.length === 1) return { valid: true };
  const keys = Object.keys(weights);
  for (const t of types) {
    if (!keys.includes(t)) {
      return { valid: false, error: `Missing weight for type: ${t}` };
    }
  }
  for (const k of keys) {
    if (!types.includes(k)) {
      return { valid: false, error: `Extra weight key not in types: ${k}` };
    }
  }
  const sum = types.reduce((s, t) => s + (weights[t] ?? 0), 0);
  if (sum !== 100) {
    return { valid: false, error: `Weights must sum to 100, got ${sum}` };
  }
  return { valid: true };
}
