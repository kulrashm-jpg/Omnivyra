import { CompanyProfile, ProfileCompletenessResult } from './types';

/** Commercial strategy fields; when saved by user they are added to user_locked_fields. */
export const COMMERCIAL_FIELD_NAMES = [
  'target_customer_segment',
  'ideal_customer_profile',
  'pricing_model',
  'sales_motion',
  'avg_deal_size',
  'sales_cycle',
  'key_metrics',
] as const;

/** Marketing intelligence fields; when saved by user they are added to user_locked_fields. */
export const MARKETING_INTELLIGENCE_FIELD_NAMES = [
  'marketing_channels',
  'content_strategy',
  'campaign_focus',
  'key_messages',
  'brand_positioning',
  'competitive_advantages',
  'growth_priorities',
] as const;

/** Problem & Transformation Intelligence fields; when saved they are added to user_locked_fields. */
export const PROBLEM_TRANSFORMATION_FIELD_NAMES = [
  'core_problem_statement',
  'pain_symptoms',
  'awareness_gap',
  'problem_impact',
  'life_with_problem',
  'life_after_solution',
  'desired_transformation',
  'transformation_mechanism',
  'authority_domains',
] as const;

const SECTION_WEIGHTS = {
  identity: 0.2,
  brand_strategy: 0.15,
  customer_icp: 0.15,
  problem_transformation: 0.25,
  campaign_guidance: 0.15,
  commercial: 0.1,
} as const;

const IDENTITY_FIELDS = ['name', 'industry', 'category', 'business_classification', 'website_url', 'geography'] as const;
const BRAND_STRATEGY_FIELDS = [
  'brand_voice',
  'brand_positioning',
  'unique_value',
  'key_messages',
  'competitive_advantages',
] as const;
const CUSTOMER_ICP_FIELDS = [
  'target_audience',
  'target_customer_segment',
  'ideal_customer_profile',
] as const;
const PROBLEM_TRANSFORMATION_FIELDS = [
  'core_problem_statement',
  'pain_symptoms',
  'awareness_gap',
  'problem_impact',
  'life_with_problem',
  'life_after_solution',
  'desired_transformation',
  'transformation_mechanism',
  'authority_domains',
] as const;
const CAMPAIGN_GUIDANCE_FIELDS = [
  'content_themes',
  'campaign_focus',
  'content_strategy',
  'campaign_purpose_intent',
  'growth_priorities',
  'goals',
] as const;
const COMMERCIAL_FIELDS = [
  'pricing_model',
  'sales_motion',
  'avg_deal_size',
  'sales_cycle',
  'key_metrics',
  'marketing_channels',
] as const;

function hasValue(profile: CompanyProfile | null, field: string): boolean {
  if (!profile) return false;
  const val = (profile as Record<string, unknown>)[field];
  if (val == null) return false;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'object') return Object.keys(val as object).length > 0;
  return String(val).trim().length > 0;
}

function sectionScore(profile: CompanyProfile | null, fields: readonly string[]): number {
  if (!profile) return 0;
  let filled = 0;
  for (const f of fields) {
    if (hasValue(profile, f)) filled++;
  }
  return fields.length > 0 ? (filled / fields.length) * 100 : 0;
}

export function calculateCompanyProfileCompleteness(
  profile: CompanyProfile | null
): ProfileCompletenessResult {
  const section_scores = {
    identity: sectionScore(profile, IDENTITY_FIELDS),
    brand_strategy: sectionScore(profile, BRAND_STRATEGY_FIELDS),
    customer_icp: sectionScore(profile, CUSTOMER_ICP_FIELDS),
    problem_transformation: sectionScore(profile, PROBLEM_TRANSFORMATION_FIELDS),
    campaign_guidance: sectionScore(profile, CAMPAIGN_GUIDANCE_FIELDS),
    commercial: sectionScore(profile, COMMERCIAL_FIELDS),
  };

  const missing_sections: string[] = [];
  if (section_scores.identity < 100) missing_sections.push('identity');
  if (section_scores.brand_strategy < 100) missing_sections.push('brand_strategy');
  if (section_scores.customer_icp < 100) missing_sections.push('customer_icp');
  if (section_scores.problem_transformation < 100) missing_sections.push('problem_transformation');
  if (section_scores.campaign_guidance < 100) missing_sections.push('campaign_guidance');
  if (section_scores.commercial < 100) missing_sections.push('commercial');

  const score = Math.round(
    section_scores.identity * SECTION_WEIGHTS.identity +
      section_scores.brand_strategy * SECTION_WEIGHTS.brand_strategy +
      section_scores.customer_icp * SECTION_WEIGHTS.customer_icp +
      section_scores.problem_transformation * SECTION_WEIGHTS.problem_transformation +
      section_scores.campaign_guidance * SECTION_WEIGHTS.campaign_guidance +
      section_scores.commercial * SECTION_WEIGHTS.commercial
  );

  return {
    score: Math.min(100, Math.max(0, score)),
    section_scores,
    missing_sections,
  };
}
