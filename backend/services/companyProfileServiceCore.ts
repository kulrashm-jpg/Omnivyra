/** Company profile — types, normalization, field mapping — split from companyProfileService.ts (barrel preserved; importers unchanged). */
import { ownedDbTable } from '../db/writeOwner';
/**
 * companyProfileService.ts — orchestration only.
 * All helpers/types live in ./companyProfile/* sub-modules.
 * This file stays under 500 lines.
 */

import { randomUUID } from 'crypto';
import { runCompletionWithOperation } from './aiGateway';
import { refineLanguageOutput } from './languageRefinementService';
import { supabase } from '../db/supabaseClient';

// ─── Re-export everything public so existing imports continue to work ─────────
export type {
  StrategyProfile,
  CompanyProfile,
  NormalizedCompanyProfile,
  CompanyProfileRefinementDetails,
  ProfileCompletenessResult,
  ProblemTransformationQuestionsResult,
  ProblemTransformationRefinedOutput,
  ProblemTransformationExistingFields,
  ProblemTransformationPromptResult,
  SaveProfileOptions,
  CompanyProfileExtractionOutput,
  EnrichmentField,
  EnrichmentOutput,
  ExtractedEvidence,
  EntityArchetype,
  EntityArchetypeIntelligence,
  UserGuidedIntelligence,
} from './companyProfile/types';

export {
  upsertCompanyProfileGovernanceSettings,
  getCompanyProfileReviewStatus,
  toLimitedCompanyProfile,
} from './companyProfile/governance';

export {
  COMMERCIAL_FIELD_NAMES,
  MARKETING_INTELLIGENCE_FIELD_NAMES,
  PROBLEM_TRANSFORMATION_FIELD_NAMES,
  calculateCompanyProfileCompleteness,
} from './companyProfile/fieldConstants';

export {
  normalizeCompanyProfile,
  validateCompanyProfile,
  mergeStringArrays,
  splitToList,
  normalizeCompanyId,
  normalizeUrl,
  normalizeSocialUrl,
  shouldSkipUrl,
  isPlaceholderUrl,
} from './companyProfile/normalization';

export {
  buildProblemTransformationQuestions,
  buildProblemTransformationStrategicPrompt,
  refineProblemTransformationAnswers,
} from './companyProfile/problemTransformation';

export { deriveStrategyProfileDraft } from './companyProfile/strategyProfile';
export { generateMarketingIntelligenceDraft } from './companyProfile/marketingIntelligence';

// ─── Private imports used by this module ─────────────────────────────────────
import type { StrategyProfile, RecommendationContext, CompanyProfile, SaveProfileOptions, CompanyProfileRefinementDetails, ProblemTransformationExistingFields, ProblemTransformationRefinedOutput, CompanyProfileExtractionOutput, EntityArchetypeIntelligence } from './companyProfile/types';
import { COMMERCIAL_FIELD_NAMES, MARKETING_INTELLIGENCE_FIELD_NAMES, PROBLEM_TRANSFORMATION_FIELD_NAMES } from './companyProfile/fieldConstants';
import {
  normalizeCompanyId,
  mergeStringArrays,
  splitToList,
  normalizeUrl,
  shouldSkipUrl,
  updateArrayField,
  updateScalarField,
} from './companyProfile/normalization';
import {
  crawlWebsiteSources,
  cleanEvidenceWithAi,
  buildExtractionPrompt,
  generateMissingFieldQuestions,
  buildSourceList,
  buildSocialProfileList,
  mergeDiscoveredSocialProfiles,
  buildChangedFields,
} from './companyProfile/refinementHelpers';
import {
  buildExtractionWithDefaults,
  computeMissingFields,
  computeConfidenceScore,
} from './companyProfile/extractionSchema';
import { refineProblemTransformationAnswers } from './companyProfile/problemTransformation';
import { deriveStrategyProfileDraft } from './companyProfile/strategyProfile';
import { generateMarketingIntelligenceDraft } from './companyProfile/marketingIntelligence';
import { inferEntityArchetype, isArchetypeInfluential, isAudienceLedArchetype, isBusinessFirstOnlyArchetype } from './companyProfile/entityArchetype';
import {
  applyApprovedStrategicGuidance,
  applyUserGuidedCompetitorSteering,
} from './companyProfile/userGuidance';
import { classifyCompanyBusiness } from './companyProfile/businessClassification';
import { buildSavePayload } from './companyProfile/savePayload';
import { safeParseRecommendationContext, withRecommendationContextDefaults } from '../../utils/safeJson';
import {
  type CompetitorCandidate,
} from './competitorEngineService';
import {

  discoverCompetitorDomainsFromSerp,
  domainToName,
  generateDiscoveryKeywords,
  normalizeDomain as normalizeCompetitorDiscoveryDomain,
} from './reportCompetitorIntelligenceServiceHelpers';


export const COMPANY_PROFILES_TABLE = 'company_profiles' as const;
export const COMPANY_PROFILE_FALLBACK_COLUMNS = [
  'company_id',
  'name',
  'industry',
  'category',
  'business_classification',
  'website_url',
  'logo_url',
  'favicon_url',
  'industry_list',
  'category_list',
  'geography_list',
  'competitors_list',
  'content_themes_list',
  'products_services_list',
  'target_audience_list',
  'goals_list',
  'brand_voice_list',
  'social_profiles',
  'field_confidence',
  'overall_confidence',
  'source_urls',
  'linkedin_url',
  'facebook_url',
  'instagram_url',
  'x_url',
  'youtube_url',
  'tiktok_url',
  'reddit_url',
  'pinterest_url',
  'whatsapp_url',
  'blog_url',
  'other_social_links',
  'products_services',
  'target_audience',
  'geography',
  'brand_voice',
  'goals',
  'competitors',
  'unique_value',
  'content_themes',
  'confidence_score',
  'source',
  'last_refined_at',
  'created_at',
  'updated_at',
  'target_customer_segment',
  'ideal_customer_profile',
  'pricing_model',
  'sales_motion',
  'avg_deal_size',
  'sales_cycle',
  'key_metrics',
  'user_locked_fields',
  'last_edited_by',
  'marketing_channels',
  'content_strategy',
  'campaign_focus',
  'key_messages',
  'brand_positioning',
  'competitive_advantages',
  'growth_priorities',
  'campaign_purpose_intent',
  'core_problem_statement',
  'pain_symptoms',
  'awareness_gap',
  'problem_impact',
  'life_with_problem',
  'life_after_solution',
  'desired_transformation',
  'transformation_mechanism',
  'authority_domains',
  'forced_context_fields',
  'recommendation_context',
  'strategic_inputs',
  'platform_content_type_prefs',
  'report_settings',
] as const;

export const MARKET_PULSE_DEFAULT_CATEGORY_SET = [
  'competitor_moves',
  'product_positioning',
  'partnerships_alliances',
  'growth_expansion',
  'hiring_talent',
  'regulatory_policy',
  'capital_business_health',
  'demand_category_momentum',
  'technology_platform_shifts',
] as const;

export function normalizeNonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0),
    ),
  );
}

function coerceStrategyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0),
  ));
}

function joinStrategyList(value: unknown): string | null {
  const normalized = coerceStrategyList(value);
  return normalized.length > 0 ? normalized.join('; ') : null;
}

function mergeTextBlocks(...values: Array<string | null | undefined>): string | null {
  const merged = values
    .map((value) => normalizeNonEmptyText(value))
    .filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);

  return merged.length > 0 ? merged.join('\n\n') : null;
}

function createEmptyRecommendationContext(): RecommendationContext {
  return {
    version: 1,
    key_threat: '',
    biggest_advantage: '',
    strategic_focus: '',
    contrarian_beliefs: [],
    typical_angles: [],
    insights: [],
  };
}

export function normalizeRecommendationContext(
  value: unknown,
): RecommendationContext | null {
  const parsed = safeParseRecommendationContext(value);
  if (!parsed) return null;

  const source = withRecommendationContextDefaults(parsed);

  return {
    version: typeof source.version === 'number' ? source.version : 1,
    key_threat: normalizeNonEmptyText(source.key_threat) ?? '',
    biggest_advantage: normalizeNonEmptyText(source.biggest_advantage) ?? '',
    strategic_focus: normalizeNonEmptyText(source.strategic_focus) ?? '',
    contrarian_beliefs: coerceStrategyList(source.contrarian_beliefs),
    typical_angles: coerceStrategyList(source.typical_angles),
    insights: Array.isArray(source.insights)
      ? source.insights.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item),
        )
      : createEmptyRecommendationContext().insights,
  };
}

function buildStrategyRecommendationContext(
  strategyProfile: StrategyProfile | null | undefined,
  existingValue: RecommendationContext | null | undefined,
): RecommendationContext | null {
  if (!strategyProfile) return existingValue ?? null;

  const existing = normalizeRecommendationContext(existingValue) ?? createEmptyRecommendationContext();

  return {
    version: existing.version || 1,
    key_threat: normalizeNonEmptyText(strategyProfile.worldview) ?? existing.key_threat,
    biggest_advantage: joinStrategyList(strategyProfile.differentiation) ?? existing.biggest_advantage,
    strategic_focus: joinStrategyList(strategyProfile.primaryFocus) ?? existing.strategic_focus,
    contrarian_beliefs:
      coerceStrategyList(strategyProfile.contrarianBeliefs).length > 0
        ? coerceStrategyList(strategyProfile.contrarianBeliefs)
        : existing.contrarian_beliefs,
    typical_angles:
      coerceStrategyList(strategyProfile.typicalAngles).length > 0
        ? coerceStrategyList(strategyProfile.typicalAngles)
        : existing.typical_angles,
    insights: existing.insights,
  };
}

export function mapStrategyProfileToExistingFields(
  strategyProfile: StrategyProfile | null | undefined,
  existing?: Pick<
    CompanyProfile,
    'brand_positioning' | 'growth_priorities' | 'competitive_advantages' | 'recommendation_context'
  > | null,
): Partial<CompanyProfile> {
  if (!strategyProfile) return {};

  const biggestAdvantage = joinStrategyList(strategyProfile.differentiation);
  const strategicFocus = joinStrategyList(strategyProfile.primaryFocus);
  const keyThreat = normalizeNonEmptyText(strategyProfile.worldview);

  return {
    brand_positioning: biggestAdvantage ?? existing?.brand_positioning ?? null,
    growth_priorities: strategicFocus ?? existing?.growth_priorities ?? null,
    competitive_advantages: mergeTextBlocks(
      biggestAdvantage,
      existing?.competitive_advantages,
      keyThreat,
    ),
    recommendation_context: buildStrategyRecommendationContext(
      strategyProfile,
      existing?.recommendation_context,
    ),
  };
}

export function fillMissingText(current: string | null | undefined, fallback: string | null | undefined): string | null {
  const existing = normalizeNonEmptyText(current);
  if (existing) return existing;
  return normalizeNonEmptyText(fallback) ?? null;
}

function fillMissingList(current: string[] | null | undefined, fallback: string[] | null | undefined): string[] | null {
  const existing = Array.isArray(current)
    ? current.map((item) => normalizeNonEmptyText(item)).filter((item): item is string => Boolean(item))
    : [];

  if (existing.length > 0) return existing;

  const next = Array.isArray(fallback)
    ? fallback.map((item) => normalizeNonEmptyText(item)).filter((item): item is string => Boolean(item))
    : [];

  return next.length > 0 ? Array.from(new Set(next)).slice(0, 8) : null;
}

export function ensureMinimumDiscoveryKeywords(profile: CompanyProfile, keywords: string[]): string[] {
  const base = normalizeNonEmptyText(profile.category)
    ?? normalizeNonEmptyText(profile.products_services)
    ?? normalizeNonEmptyText(profile.industry)
    ?? normalizeNonEmptyText(profile.name)
    ?? 'business software';
  const merged = [...keywords];
  [
    `${base} competitors`,
    `${base} alternatives`,
    `${base} tools`,
    `${base} apps`,
    `${base} market leaders`,
  ].forEach((keyword) => {
    if (!merged.some((item) => item.toLowerCase() === keyword.toLowerCase())) {
      merged.push(keyword);
    }
  });
  return merged.slice(0, 10);
}

export function expandRefineDiscoveryKeywords(profile: CompanyProfile, keywords: string[]): string[] {
  const terms = [
    profile.category,
    profile.products_services,
    profile.industry,
    profile.target_audience,
    profile.ideal_customer_profile,
    profile.brand_positioning,
  ]
    .flatMap((value) => splitToList(Array.isArray(value) ? value.join(', ') : value))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 6);
  const expanded = [...keywords];
  terms.forEach((term) => {
    [`best ${term}`, `${term} competitors`, `${term} alternatives`, `${term} platforms`].forEach((query) => {
      if (!expanded.some((item) => item.toLowerCase() === query.toLowerCase())) {
        expanded.push(query);
      }
    });
  });
  return ensureMinimumDiscoveryKeywords(profile, expanded).slice(0, 10);
}

export function buildProfileForCompetitorDiscovery(
  workingProfile: CompanyProfile,
  extraction: CompanyProfileExtractionOutput,
): CompanyProfile {
  const existingConfidence = workingProfile.field_confidence || {};
  const industryUpdate = updateArrayField(workingProfile.industry_list ?? splitToList(workingProfile.industry), extraction.industry?.value, extraction.industry?.source, existingConfidence.industry, extraction.industry?.confidence);
  const categoryUpdate = updateArrayField(workingProfile.category_list ?? splitToList(workingProfile.category), extraction.category?.value, extraction.category?.source, existingConfidence.category, extraction.category?.confidence);
  const geographyUpdate = updateArrayField(workingProfile.geography_list ?? splitToList(workingProfile.geography), extraction.geography?.value, extraction.geography?.source, existingConfidence.geography, extraction.geography?.confidence);
  const productsUpdate = updateArrayField(workingProfile.products_services_list ?? splitToList(workingProfile.products_services), extraction.products_services?.value, extraction.products_services?.source, existingConfidence.products_services, extraction.products_services?.confidence);
  const audienceUpdate = updateArrayField(workingProfile.target_audience_list ?? splitToList(workingProfile.target_audience), extraction.target_audience?.value, extraction.target_audience?.source, existingConfidence.target_audience, extraction.target_audience?.confidence);
  const classified = classifyCompanyBusiness({
    ...workingProfile,
    industry: industryUpdate.value.join(', ') || workingProfile.industry,
    category: categoryUpdate.value.join(', ') || workingProfile.category,
    products_services: productsUpdate.value.join(', ') || workingProfile.products_services,
    target_audience: audienceUpdate.value.join(', ') || workingProfile.target_audience,
    industry_list: industryUpdate.value,
    category_list: categoryUpdate.value,
    products_services_list: productsUpdate.value,
    target_audience_list: audienceUpdate.value,
  }, extraction);

  return {
    ...workingProfile,
    business_classification: classified.business_classification,
    industry: classified.industry.join(', '),
    category: classified.category,
    geography: geographyUpdate.value.join(', ') || workingProfile.geography,
    products_services: productsUpdate.value.join(', ') || workingProfile.products_services,
    target_audience: audienceUpdate.value.join(', ') || workingProfile.target_audience,
    industry_list: classified.industry,
    category_list: [classified.category],
    geography_list: geographyUpdate.value,
    products_services_list: productsUpdate.value,
    target_audience_list: audienceUpdate.value,
    competitors: workingProfile.competitors ?? null,
    competitors_list: workingProfile.competitors_list ?? splitToList(workingProfile.competitors),
  };
}

export type RefineCompetitorDiscovery = {
  candidates: CompetitorCandidate[];
  fallbackCandidates: CompetitorCandidate[];
  keywords: string[];
  serpDomains: string[];
};

export function profileDiscoverySignalText(profile: CompanyProfile, keywords: string[] = []): string {
  return [
    profile.name,
    profile.website_url,
    profile.industry,
    profile.category,
    profile.products_services,
    profile.target_audience,
    profile.goals,
    profile.content_themes,
    profile.brand_voice,
    profile.ideal_customer_profile,
    profile.brand_positioning,
    profile.unique_value,
    ...(profile.industry_list ?? []),
    ...(profile.category_list ?? []),
    ...(profile.products_services_list ?? []),
    ...(profile.target_audience_list ?? []),
    ...(profile.goals_list ?? []),
    ...(profile.content_themes_list ?? []),
    ...(profile.brand_voice_list ?? []),
    ...(profile.competitors_list ?? []),
    profile.competitors,
    ...keywords,
  ].filter(Boolean).join(' ').toLowerCase();
}

function cleanCompetitorText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : null;
}

function pushUniqueText(target: string[], value: string | null | undefined, max = 80) {
  const cleaned = cleanCompetitorText(value);
  if (!cleaned) return;
  const truncated = cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned;
  if (!target.some((item) => item.toLowerCase() === truncated.toLowerCase())) target.push(truncated);
}

export function archetypeValues(archetype?: EntityArchetypeIntelligence | null): string[] {
  return archetype ? [archetype.primary_archetype, ...(archetype.secondary_archetypes ?? [])] : [];
}

export function profileAudienceLabel(profile: CompanyProfile, archetype?: EntityArchetypeIntelligence | null): string {
  return cleanCompetitorText(profile.target_audience)
    ?? cleanCompetitorText(profile.ideal_customer_profile)
    ?? cleanCompetitorText(archetype?.audience_relationship)
    ?? 'the same audience';
}

export function profileTopicLabel(profile: CompanyProfile, archetype?: EntityArchetypeIntelligence | null): string {
  return cleanCompetitorText(profile.content_themes)
    ?? cleanCompetitorText(profile.category)
    ?? cleanCompetitorText(profile.products_services)
    ?? cleanCompetitorText(archetype?.primary_value_surface)
    ?? 'the same topic';
}

export function buildArchetypeNativeDiscoverySeeds(
  profile: CompanyProfile,
  archetype?: EntityArchetypeIntelligence | null,
): string[] {
  if (!isArchetypeInfluential(archetype) || isBusinessFirstOnlyArchetype(archetype)) return [];
  const values = archetypeValues(archetype);
  const audience = profileAudienceLabel(profile, archetype);
  const topic = profileTopicLabel(profile, archetype);
  const valueSurface = cleanCompetitorText(archetype?.primary_value_surface);
  const commercialMode = cleanCompetitorText(archetype?.commercial_mode);
  const seeds: string[] = [];

  if (values.includes('MEDIA_NEWSLETTER')) {
    pushUniqueText(seeds, `${topic} newsletters`);
    pushUniqueText(seeds, `${topic} publications`);
    pushUniqueText(seeds, `${audience} newsletter communities`);
    pushUniqueText(seeds, `${topic} podcast and newsletter peers`);
  }
  if (values.includes('CREATOR_EDUCATOR')) {
    pushUniqueText(seeds, `${topic} creator educators`);
    pushUniqueText(seeds, `${topic} courses and communities`);
    pushUniqueText(seeds, `${audience} education creators`);
  }
  if (values.includes('THOUGHT_LEADER')) {
    pushUniqueText(seeds, `${topic} authors and speakers`);
    pushUniqueText(seeds, `${topic} thought leaders`);
    pushUniqueText(seeds, `${topic} leadership education peers`);
  }
  if (values.includes('PERSONAL_BRAND')) {
    pushUniqueText(seeds, `${topic} founder-led brands`);
    pushUniqueText(seeds, `${topic} personal brand peers`);
  }
  if (values.includes('COMMUNITY_LED')) {
    pushUniqueText(seeds, `${topic} communities`);
    pushUniqueText(seeds, `${audience} membership communities`);
  }
  if (values.includes('CONSULTANT_OPERATOR')) {
    pushUniqueText(seeds, `${topic} operator advisors`);
    pushUniqueText(seeds, `${topic} public builders`);
    pushUniqueText(seeds, `${topic} consultant creators`);
  }
  if (values.includes('HYBRID_ENTITY')) {
    pushUniqueText(seeds, `${topic} audience-led businesses`);
    pushUniqueText(seeds, `${topic} creator business peers`);
    pushUniqueText(seeds, `${topic} ecosystem operators`);
  }
  pushUniqueText(seeds, valueSurface ? `${valueSurface} peers` : null);
  pushUniqueText(seeds, commercialMode ? `${commercialMode} alternatives` : null);

  return seeds.slice(0, 10);
}

// NOTE: Hardcoded competitor injection has been removed from this module.
// The former `archetypeCandidate` helper and `ARCHETYPE_NAMED_PEER_PACKS` roster
// (Morning Brew, Lenny's Newsletter, Justin Welsh, Seth Godin, …) injected static named
// entities as "competitors" based purely on an archetype label. Competitors are now
// evidence-driven only (stored/user/AI-extracted names + SERP-live discovery), validated
// by the ranking engine's multi-signal gate. Archetype contributes discovery search seeds
// (`buildArchetypeNativeDiscoverySeeds`) and descriptive metadata only — never candidates.

