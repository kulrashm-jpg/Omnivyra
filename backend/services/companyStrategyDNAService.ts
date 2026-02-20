/**
 * Company Strategy DNA
 * One deterministic strategy interpretation layer derived from company profile.
 * No scoring changes. No architecture refactor.
 */

import type { CompanyProfile } from './companyProfileService';

export type StrategyDNAMode =
  | 'problem_transformation'
  | 'authority_positioning'
  | 'commercial_growth'
  | 'audience_engagement'
  | 'educational_default';

export type StrategyDNAGrowthMotion =
  | 'trust_building'
  | 'conversion_acceleration'
  | 'educational';

export type StrategyDNAContentStyle =
  | 'educational'
  | 'authority'
  | 'commercial'
  | 'engagement';

export type StrategyDNADecisionFocus =
  | 'awareness'
  | 'awareness_to_trust'
  | 'consideration_to_conversion';

export type CompanyStrategyDNA = {
  mode: StrategyDNAMode;
  growth_motion: StrategyDNAGrowthMotion;
  content_style: StrategyDNAContentStyle;
  decision_focus: StrategyDNADecisionFocus;
};

const hasValue = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0 && v.some((x) => hasValue(x));
  return true;
};

/** Deterministic mode selection: priority order 1–5 */
function resolveMode(profile: CompanyProfile | null): StrategyDNAMode {
  if (!profile) return 'educational_default';

  if (hasValue(profile.core_problem_statement) || hasValue(profile.desired_transformation)) {
    return 'problem_transformation';
  }
  if (hasValue(profile.authority_domains)) {
    return 'authority_positioning';
  }
  if (
    hasValue(profile.pricing_model) ||
    hasValue(profile.sales_motion) ||
    hasValue(profile.key_metrics)
  ) {
    return 'commercial_growth';
  }
  if (hasValue(profile.target_audience) || hasValue(profile.brand_voice)) {
    return 'audience_engagement';
  }
  return 'educational_default';
}

/** Map mode → growth_motion deterministically */
function modeToGrowthMotion(mode: StrategyDNAMode): StrategyDNAGrowthMotion {
  switch (mode) {
    case 'problem_transformation':
      return 'trust_building';
    case 'authority_positioning':
      return 'trust_building';
    case 'commercial_growth':
      return 'conversion_acceleration';
    case 'audience_engagement':
      return 'educational';
    case 'educational_default':
    default:
      return 'educational';
  }
}

/** Map mode → content_style deterministically */
function modeToContentStyle(mode: StrategyDNAMode): StrategyDNAContentStyle {
  switch (mode) {
    case 'problem_transformation':
      return 'educational';
    case 'authority_positioning':
      return 'authority';
    case 'commercial_growth':
      return 'commercial';
    case 'audience_engagement':
      return 'engagement';
    case 'educational_default':
    default:
      return 'educational';
  }
}

/** Map mode → decision_focus deterministically */
function modeToDecisionFocus(mode: StrategyDNAMode): StrategyDNADecisionFocus {
  switch (mode) {
    case 'problem_transformation':
      return 'awareness_to_trust';
    case 'authority_positioning':
      return 'awareness_to_trust';
    case 'commercial_growth':
      return 'consideration_to_conversion';
    case 'audience_engagement':
      return 'awareness';
    case 'educational_default':
    default:
      return 'awareness';
  }
}

/**
 * Builds deterministic Company Strategy DNA from company profile.
 */
export function buildCompanyStrategyDNA(
  profile: CompanyProfile | null
): CompanyStrategyDNA {
  const mode = resolveMode(profile);
  return {
    mode,
    growth_motion: modeToGrowthMotion(mode),
    content_style: modeToContentStyle(mode),
    decision_focus: modeToDecisionFocus(mode),
  };
}
