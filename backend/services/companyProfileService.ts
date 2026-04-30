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
import type { StrategyProfile, RecommendationContext, CompanyProfile, SaveProfileOptions, CompanyProfileRefinementDetails, ProblemTransformationExistingFields, ProblemTransformationRefinedOutput, CompanyProfileExtractionOutput } from './companyProfile/types';
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
import { buildSavePayload } from './companyProfile/savePayload';
import { safeParseRecommendationContext, withRecommendationContextDefaults } from '../../utils/safeJson';
import {
  buildCandidatesFromNames,
  extractCompetitiveContextFromProfile,
  getFinalCompetitors,
  getFinalCompetitorsSync,
  type CompetitorSource,
} from './competitorEngineService';

const COMPANY_PROFILES_TABLE = 'company_profiles' as const;
const COMPANY_PROFILE_FALLBACK_COLUMNS = [
  'company_id',
  'name',
  'industry',
  'category',
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

const MARKET_PULSE_DEFAULT_CATEGORY_SET = [
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

function normalizeNonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringArray(value: unknown): string[] {
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

function normalizeRecommendationContext(
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

function mapStrategyProfileToExistingFields(
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

function fillMissingText(current: string | null | undefined, fallback: string | null | undefined): string | null {
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

function mapExtractionCompetitorSource(source?: string | null): CompetitorSource {
  if (source === 'website' || source === 'social' || source === 'user') return source;
  return 'profile_ai';
}

function inferBusinessModelLabel(input: {
  category?: string | null;
  industry?: string | null;
  productsServices?: string[] | null;
  websiteUrl?: string | null;
}): string | null {
  const text = [
    input.category,
    input.industry,
    ...(input.productsServices ?? []),
    input.websiteUrl,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!text) return null;
  if (/\bmarketplace\b/.test(text)) return 'Marketplace';
  if (/\bagency\b|\bconsult(ing|ancy)?\b|\bservice(s)?\b/.test(text)) return 'Service';
  if (/\becommerce\b|\bstore\b|\bretail\b/.test(text)) return 'Commerce';
  if (/\bmanufacturer\b|\bmanufacturing\b|\bvehicle\b|\bapparel\b|\bfootwear\b|\bhardware\b/.test(text)) return 'Manufacturer';
  if (/\bsaas\b|\bsoftware\b|\bplatform\b|\bcrm\b|\bautomation\b|\bpayments\b/.test(text)) return 'SaaS';
  return null;
}

function inferPartnershipPriorities(input: {
  businessModel?: string | null;
  productsServices?: string[];
  category?: string | null;
}): string[] {
  const text = [input.businessModel, input.category, ...(input.productsServices ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\bpayments\b|\bapi\b|\bplatform\b|\bintegration\b/.test(text)) {
    return ['integration partners', 'platform partners'];
  }
  if (/\bmarketplace\b|\bagency\b|\bservice\b/.test(text)) {
    return ['channel partners', 'referral partners'];
  }
  if (/\bcommerce\b|\bretail\b|\bmanufacturer\b/.test(text)) {
    return ['distribution partners', 'channel partners'];
  }
  if (/\bsaas\b|\bsoftware\b|\bcrm\b|\bautomation\b/.test(text)) {
    return ['integration partners', 'channel partners'];
  }
  return [];
}

function inferCriticalHiringFunctions(input: {
  businessModel?: string | null;
  productsServices?: string[];
  category?: string | null;
}): string[] {
  const text = [input.businessModel, input.category, ...(input.productsServices ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\bpayments\b|\bapi\b|\bplatform\b|\bsoftware\b|\bsaas\b/.test(text)) {
    return ['engineering', 'product', 'customer success'];
  }
  if (/\bagency\b|\bservice\b|\bconsult(ing|ancy)?\b/.test(text)) {
    return ['delivery', 'account management', 'business development'];
  }
  if (/\bcommerce\b|\bretail\b|\bmarketplace\b/.test(text)) {
    return ['operations', 'partnerships', 'growth marketing'];
  }
  if (/\bmanufacturer\b|\bmanufacturing\b|\bvehicle\b|\bapparel\b|\bfootwear\b/.test(text)) {
    return ['operations', 'supply chain', 'sales'];
  }
  return [];
}

function inferRegulatoryPolicySensitivity(input: {
  businessModel?: string | null;
  industry?: string | null;
  geography?: string[];
  productsServices?: string[];
}): string[] {
  const text = [input.businessModel, input.industry, ...(input.productsServices ?? []), ...(input.geography ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const sensitivities = new Set<string>();

  if (/\bpayments\b|\bfintech\b/.test(text)) {
    sensitivities.add('financial compliance');
    sensitivities.add('data privacy');
  }
  if (/\bmarketplace\b|\bservice\b|\bagency\b/.test(text)) {
    sensitivities.add('labor laws');
  }
  if (/\bhealth\b|\bmedical\b|\bpharma\b/.test(text)) {
    sensitivities.add('sector regulation');
  }
  if (/\bmanufacturer\b|\bcommerce\b|\bretail\b|\bapparel\b|\bfootwear\b/.test(text)) {
    sensitivities.add('trade policy');
  }
  if ((input.geography ?? []).length > 1) {
    sensitivities.add('cross-border compliance');
  }
  if (sensitivities.size === 0 && /\bdata\b|\bsoftware\b|\bplatform\b|\bsaas\b/.test(text)) {
    sensitivities.add('data privacy');
  }

  return Array.from(sensitivities);
}

function inferMarketPulseCategories(input: {
  businessModel?: string | null;
  category?: string | null;
  goals?: string[];
  productsServices?: string[];
  competitors?: string[];
}): string[] {
  const text = [
    input.businessModel,
    input.category,
    ...(input.goals ?? []),
    ...(input.productsServices ?? []),
    ...(input.competitors ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const categories = new Set<string>();
  if ((input.competitors ?? []).length > 0) categories.add('competitor_moves');
  if (/\bgrowth\b|\bexpand\b|\bexpansion\b|\bscale\b/.test(text)) categories.add('growth_expansion');
  if (/\bpartner\b|\bintegration\b|\balliance\b|\bchannel\b/.test(text)) categories.add('partnerships_alliances');
  if (/\bhiring\b|\btalent\b|\brecruit\b/.test(text)) categories.add('hiring_talent');
  if (/\bregulat|\bpolicy\b|\bprivacy\b|\bcompliance\b|\blabor law\b|\btrade\b/.test(text)) categories.add('regulatory_policy');
  if (/\bproduct\b|\bplatform\b|\bsaas\b|\bsoftware\b|\bfeature\b|\bpositioning\b/.test(text)) categories.add('product_positioning');
  if (/\bai\b|\bautomation\b|\bapi\b|\btech\b/.test(text)) categories.add('technology_platform_shifts');
  if (/\bdemand\b|\bcategory\b|\bmarket\b/.test(text)) categories.add('demand_category_momentum');

  const filtered = Array.from(categories).filter((item) =>
    MARKET_PULSE_DEFAULT_CATEGORY_SET.includes(item as (typeof MARKET_PULSE_DEFAULT_CATEGORY_SET)[number]),
  );

  return filtered.length > 0 ? filtered : ['competitor_moves', 'growth_expansion', 'regulatory_policy'];
}

function withExistingList(existing: string[] | null | undefined, next: string[]): string[] | null {
  const normalizedExisting = normalizeStringArray(existing);
  if (normalizedExisting.length > 0) return normalizedExisting;
  return next.length > 0 ? next : null;
}

function withExistingText(existing: string | null | undefined, next: string | null): string | null {
  return normalizeNonEmptyText(existing) ?? next ?? null;
}

function buildAiMarketPulseSettings(
  workingProfile: CompanyProfile,
  extraction: CompanyProfileExtractionOutput,
): NonNullable<NonNullable<CompanyProfile['report_settings']>['market_pulse']> | null {
  const existing = workingProfile.report_settings?.market_pulse ?? null;

  const geography = Array.from(
    new Set([
      ...normalizeStringArray(workingProfile.geography_list),
      ...normalizeStringArray(extraction.geography?.value),
      ...splitToList(workingProfile.geography),
    ]),
  );
  const productsServices = Array.from(
    new Set([
      ...normalizeStringArray(workingProfile.products_services_list),
      ...normalizeStringArray(extraction.products_services?.value),
      ...splitToList(workingProfile.products_services),
    ]),
  );
  const goals = Array.from(
    new Set([
      ...normalizeStringArray(workingProfile.goals_list),
      ...normalizeStringArray(extraction.goals?.value),
      ...splitToList(workingProfile.goals),
      ...splitToList(workingProfile.growth_priorities),
    ]),
  );

  const businessModel = inferBusinessModelLabel({
    category: workingProfile.category ?? (Array.isArray(extraction.category?.value) ? extraction.category.value.join(', ') : String(extraction.category?.value || '')),
    industry: workingProfile.industry ?? (Array.isArray(extraction.industry?.value) ? extraction.industry.value.join(', ') : String(extraction.industry?.value || '')),
    productsServices,
    websiteUrl: workingProfile.website_url ?? null,
  });

  const next = {
    primary_operating_markets: withExistingList(existing?.primary_operating_markets, geography),
    target_expansion_markets: existing?.target_expansion_markets ?? null,
    named_competitors: null,
    business_model: withExistingText(existing?.business_model, businessModel),
    core_offerings: withExistingList(existing?.core_offerings, productsServices),
    growth_priorities: withExistingList(existing?.growth_priorities, goals),
    partnership_priorities: withExistingList(
      existing?.partnership_priorities,
      inferPartnershipPriorities({
        businessModel,
        productsServices,
        category: workingProfile.category ?? null,
      }),
    ),
    critical_hiring_functions: withExistingList(
      existing?.critical_hiring_functions,
      inferCriticalHiringFunctions({
        businessModel,
        productsServices,
        category: workingProfile.category ?? null,
      }),
    ),
    regulatory_policy_sensitivity: withExistingList(
      existing?.regulatory_policy_sensitivity,
      inferRegulatoryPolicySensitivity({
        businessModel,
        industry: workingProfile.industry ?? null,
        geography,
        productsServices,
      }),
    ),
    default_categories: withExistingList(
      existing?.default_categories,
      inferMarketPulseCategories({
        businessModel,
        category: workingProfile.category ?? null,
        goals,
        productsServices,
        competitors: [],
      }),
    ),
    exclusions: existing?.exclusions ?? null,
    preferred_regions: withExistingList(existing?.preferred_regions, geography),
    updated_at: new Date().toISOString(),
  };

  const hasAnyValue = Object.entries(next).some(([key, value]) => {
    if (key === 'updated_at') return false;
    if (Array.isArray(value)) return value.length > 0;
    return normalizeNonEmptyText(value as string | null | undefined) !== null;
  });

  return hasAnyValue ? next : null;
}

let companyProfileColumnsCache: Set<string> | null = null;

async function getCompanyProfileColumns(existingProfile?: CompanyProfile | null): Promise<Set<string>> {
  if (companyProfileColumnsCache && companyProfileColumnsCache.size > 0) {
    return new Set(companyProfileColumnsCache);
  }

  try {
    const { data, error } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', COMPANY_PROFILES_TABLE);

    if (!error && Array.isArray(data) && data.length > 0) {
      companyProfileColumnsCache = new Set(
        data
          .map((row) => String((row as { column_name?: string | null }).column_name ?? '').trim())
          .filter(Boolean),
      );
      return new Set(companyProfileColumnsCache);
    }

    if (error) {
      console.warn('Failed to introspect company_profiles columns:', error.message);
    }
  } catch (error) {
    console.warn(
      'Failed to introspect company_profiles columns:',
      error instanceof Error ? error.message : String(error),
    );
  }

  if (existingProfile && typeof existingProfile === 'object') {
    const inferred = Object.keys(existingProfile).filter(Boolean);
    if (inferred.length > 0) {
      companyProfileColumnsCache = new Set(inferred);
      return new Set(companyProfileColumnsCache);
    }
  }

  companyProfileColumnsCache = new Set(COMPANY_PROFILE_FALLBACK_COLUMNS);
  return new Set(companyProfileColumnsCache);
}

function filterCompanyProfilePayload(
  payload: Record<string, unknown>,
  validColumns: Set<string>,
): { safePayload: Record<string, unknown>; skippedFields: string[] } {
  const safePayload: Record<string, unknown> = {};
  const skippedFields: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    if (validColumns.has(key)) {
      safePayload[key] = value;
      continue;
    }
    skippedFields.push(key);
    console.warn('Skipped unknown profile field:', key);
  }

  return { safePayload, skippedFields };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export const shouldRefineProfile = (lastRefinedAt?: string | null): boolean => {
  if (!lastRefinedAt) return true;
  const last = new Date(lastRefinedAt).getTime();
  if (Number.isNaN(last)) return true;
  const diffDays = (Date.now() - last) / (1000 * 60 * 60 * 24);
  return diffDays >= 7;
};

const fetchProfileRaw = async (companyId: string): Promise<CompanyProfile | null> => {
  const { data, error } = await supabase
    .from('company_profiles')
    .select('*')
    .eq('company_id', companyId)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch company profile: ${error.message}`);
  }
  return {
    ...(data as CompanyProfile),
    recommendation_context: normalizeRecommendationContext((data as CompanyProfile)?.recommendation_context),
  };
};

export const getLatestProfile = async (): Promise<CompanyProfile | null> => {
  const { data, error } = await supabase
    .from('company_profiles')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch latest company profile: ${error.message}`);
  if (!data) return null;
  return {
    ...(data as CompanyProfile),
    recommendation_context: normalizeRecommendationContext((data as CompanyProfile)?.recommendation_context),
  };
};

const storeRefinementAudit = async (details: CompanyProfileRefinementDetails) => {
  try {
    const { error } = await supabase.from('company_profile_refinements').insert({
      company_id: details.company_id,
      before_profile: details.before_profile,
      after_profile: details.after_profile,
      source_urls: details.source_urls,
      source_summaries: details.source_summaries,
      changed_fields: details.changed_fields,
      extraction_output: details.extraction_output,
      missing_fields_questions: details.missing_fields_questions,
      overall_confidence: details.after_profile.overall_confidence ?? 0,
      created_at: details.created_at,
    });
    if (error) console.warn('Failed to store company profile refinement audit', error.message);
  } catch {
    console.warn('Failed to store company profile refinement audit');
  }
};

// ─── saveProfile ──────────────────────────────────────────────────────────────

export async function saveProfile(
  input: Partial<CompanyProfile>,
  options?: SaveProfileOptions
): Promise<CompanyProfile> {
  let companyId = input.company_id;
  if (!companyId) companyId = randomUUID();
  companyId = normalizeCompanyId(companyId);
  console.log('Resolved company_id:', companyId);
  const existing = await fetchProfileRaw(companyId);
  const nowIso = new Date().toISOString();
  const source = (options?.source ?? 'user') as 'user' | 'ai_refined';
  const lastRefinedAt = nowIso;
  const confidenceScore = input.confidence_score ?? existing?.confidence_score ?? 0;

  const payload = buildSavePayload(input, existing, companyId, source, lastRefinedAt, nowIso, confidenceScore);
  const rawCompetitorInputs = mergeStringArrays(
    [],
    [
      ...(Array.isArray(input.competitors_list) ? input.competitors_list : []),
      ...splitToList(typeof input.competitors === 'string' ? input.competitors : null),
    ],
  );
  const finalCompetitors = await getFinalCompetitors({
    candidates: buildCandidatesFromNames(
      rawCompetitorInputs,
      source === 'user' ? 'manual' : 'profile_ai',
    ),
    context: extractCompetitiveContextFromProfile({
      ...(existing ?? {}),
      ...input,
      company_id: companyId,
    } as CompanyProfile),
    max: 8,
    useNetwork: true,
  });
  payload.competitors_list = finalCompetitors.map((competitor) => competitor.name);
  payload.competitors = payload.competitors_list.length > 0 ? payload.competitors_list.join(', ') : null;

  const lockedSet = new Set<string>(Array.isArray(existing?.user_locked_fields) ? existing.user_locked_fields : []);
  let didLock = false;
  for (const key of COMMERCIAL_FIELD_NAMES) {
    const val = input[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') { lockedSet.add(key); didLock = true; }
  }
  for (const key of MARKETING_INTELLIGENCE_FIELD_NAMES) {
    const val = input[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') { lockedSet.add(key); didLock = true; }
  }
  for (const key of PROBLEM_TRANSFORMATION_FIELD_NAMES) {
    const val = input[key as keyof CompanyProfile];
    const hasVal = Array.isArray(val) ? val.length > 0 : val !== undefined && val !== null && String(val).trim() !== '';
    if (hasVal) { lockedSet.add(key); didLock = true; }
  }
  if (didLock) {
    payload.user_locked_fields = Array.from(lockedSet);
    payload.last_edited_by = 'user';
  }

  const validColumns = await getCompanyProfileColumns(existing);
  const { safePayload, skippedFields } = filterCompanyProfilePayload(
    payload as Record<string, unknown>,
    validColumns,
  );
  if (skippedFields.length > 0) {
    console.warn('Filtered company profile fields before save:', skippedFields.join(', '));
  }

  const { data, error } = await supabase
    .from(COMPANY_PROFILES_TABLE)
    .upsert(safePayload, { onConflict: 'company_id' })
    .select('*')
    .single();
  if (error) {
    console.warn('Profile save error:', error.message);
    return (existing ?? null) as CompanyProfile;
  }
  return data ?? ((existing ?? null) as CompanyProfile);
}

// ─── saveProblemTransformationAnswers ─────────────────────────────────────────

export async function saveProblemTransformationAnswers(
  companyId: string,
  rawAnswers: (string | null | undefined)[]
): Promise<CompanyProfile> {
  const resolvedId = normalizeCompanyId(companyId);
  const profile = await fetchProfileRaw(resolvedId);
  const existingPT: ProblemTransformationExistingFields = profile
    ? {
        core_problem_statement: profile.core_problem_statement ?? null,
        pain_symptoms: profile.pain_symptoms ?? [],
        awareness_gap: profile.awareness_gap ?? null,
        problem_impact: profile.problem_impact ?? null,
        life_with_problem: profile.life_with_problem ?? null,
        life_after_solution: profile.life_after_solution ?? null,
        desired_transformation: profile.desired_transformation ?? null,
        transformation_mechanism: profile.transformation_mechanism ?? null,
        authority_domains: profile.authority_domains ?? [],
      }
    : {};
  const refined = await refineProblemTransformationAnswers(rawAnswers, {
    companyId: resolvedId,
    profile,
    existingFields: existingPT,
  });
  const lockedSet = new Set<string>(Array.isArray(profile?.user_locked_fields) ? profile.user_locked_fields : []);
  const merged: Partial<CompanyProfile> = { company_id: resolvedId };

  const applyField = <K extends keyof ProblemTransformationRefinedOutput>(
    key: K,
    refinedVal: ProblemTransformationRefinedOutput[K],
    existingVal: unknown
  ) => {
    (merged as Record<string, unknown>)[key] = lockedSet.has(key) && existingVal != null ? existingVal : refinedVal;
  };

  applyField('core_problem_statement', refined.core_problem_statement, profile?.core_problem_statement);
  applyField('pain_symptoms', refined.pain_symptoms, profile?.pain_symptoms);
  applyField('awareness_gap', refined.awareness_gap, profile?.awareness_gap);
  applyField('problem_impact', refined.problem_impact, profile?.problem_impact);
  applyField('life_with_problem', refined.life_with_problem, profile?.life_with_problem);
  applyField('life_after_solution', refined.life_after_solution, profile?.life_after_solution);
  applyField('desired_transformation', refined.desired_transformation, profile?.desired_transformation);
  applyField('transformation_mechanism', refined.transformation_mechanism, profile?.transformation_mechanism);
  applyField('authority_domains', refined.authority_domains, profile?.authority_domains);

  const fieldConfidence: Record<string, string> = { ...(profile?.field_confidence || {}) };
  for (const key of PROBLEM_TRANSFORMATION_FIELD_NAMES) {
    const val = (merged as Record<string, unknown>)[key];
    if (val != null && (Array.isArray(val) ? val.length > 0 : String(val).trim())) {
      fieldConfidence[key] = 'Medium';
    }
  }
  merged.field_confidence = fieldConfidence;

  return saveProfile({ ...profile, ...merged } as Partial<CompanyProfile>, { source: 'ai_refined' });
}

export async function saveStrategyProfileOverride(
  companyId: string,
  strategyProfile: StrategyProfile | null | undefined,
  options?: { source?: 'user' | 'ai_refined' }
): Promise<CompanyProfile> {
  const resolvedId = normalizeCompanyId(companyId);
  const existing = await fetchProfileRaw(resolvedId);
  return saveProfile(
    {
      ...(existing || { company_id: resolvedId }),
      company_id: resolvedId,
      ...mapStrategyProfileToExistingFields(strategyProfile, existing),
    },
    { source: options?.source ?? 'user' },
  );
}

export async function deriveAndStoreStrategyProfile(
  companyId: string,
  options?: {
    sourceSummaries?: Array<{ label: string; url: string; summary: string }>;
    forceOverride?: boolean;
  }
): Promise<CompanyProfile | null> {
  const resolvedId = normalizeCompanyId(companyId);
  const profile = await fetchProfileRaw(resolvedId);
  if (!profile) return null;
  const derived = await deriveStrategyProfileDraft(profile, options?.sourceSummaries ?? []);
  if (!derived.strategyProfile) return profile;
  return saveProfile(
    {
      ...profile,
      ...mapStrategyProfileToExistingFields(derived.strategyProfile, profile),
    },
    { source: 'ai_refined' },
  );
}

// ─── getProfile ───────────────────────────────────────────────────────────────

export async function getProfile(
  companyId?: string,
  options?: { autoRefine?: boolean; languageRefine?: boolean }
): Promise<CompanyProfile | null> {
  const resolvedCompanyId = normalizeCompanyId(companyId);
  const profile = await fetchProfileRaw(resolvedCompanyId);
  if (!profile) return null;

  let result: CompanyProfile | null = profile;
  if ((options?.autoRefine ?? true) && shouldRefineProfile(profile.last_refined_at)) {
    result = await refineProfileWithAI(profile, { force: true });
  }
  if ((options?.languageRefine ?? false) && result) {
    result = await refineProfileForPrompts(result);
  }
  return sanitizeStoredCompetitorsForRead(result);
}

function sanitizeStoredCompetitorsForRead(profile: CompanyProfile | null): CompanyProfile | null {
  if (!profile) return null;
  const reportSettings = profile.report_settings ?? null;
  return {
    ...profile,
    competitors: null,
    competitors_list: [],
    report_settings: reportSettings
      ? {
          ...reportSettings,
          default_inputs: reportSettings.default_inputs
            ? {
                ...reportSettings.default_inputs,
                competitors: [],
              }
            : reportSettings.default_inputs,
          market_pulse: reportSettings.market_pulse
            ? {
                ...reportSettings.market_pulse,
                named_competitors: [],
              }
            : reportSettings.market_pulse,
        }
      : reportSettings,
  };
}

// ─── Language refinement ──────────────────────────────────────────────────────

async function refineProfileField(value: string | null | undefined): Promise<string | null> {
  if (value == null || typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const r = await refineLanguageOutput({ content: trimmed, card_type: 'general' });
    return (r.refined as string) || trimmed;
  } catch (err) {
    console.warn('[company-profile] refineProfileField failed, using original:', err instanceof Error ? err.message : String(err));
    return trimmed;
  }
}

export async function refineProfileForPrompts(profile: CompanyProfile | null): Promise<CompanyProfile | null> {
  if (!profile) return null;
  const out = { ...profile };
  const fields: Array<keyof CompanyProfile> = [
    'target_audience', 'brand_voice', 'unique_value', 'brand_positioning',
    'key_messages', 'competitive_advantages', 'ideal_customer_profile', 'target_customer_segment',
  ];
  for (const key of fields) {
    const val = out[key];
    if (typeof val === 'string' && val.trim()) {
      (out as Record<string, unknown>)[key] = await refineProfileField(val);
    }
  }
  return out;
}

// ─── AI refinement pipeline ───────────────────────────────────────────────────

const runProfileRefinement = async (
  profile: CompanyProfile,
  options?: { force?: boolean }
): Promise<{ profile: CompanyProfile; details: CompanyProfileRefinementDetails }> => {
  if (!options?.force && !shouldRefineProfile(profile.last_refined_at)) {
    const details: CompanyProfileRefinementDetails = {
      company_id: profile.company_id, before_profile: profile, after_profile: profile,
      source_urls: [], source_summaries: [], changed_fields: [], created_at: new Date().toISOString(),
    };
    return { profile, details };
  }

  const companyId = profile.company_id ? String(profile.company_id) : null;
  const t0 = Date.now();
  const elapsed = () => `${Date.now() - t0}ms`;
  let workingProfile = { ...profile };

  const existingSourceUrls = new Set(
    (workingProfile.source_urls || []).map((url) => normalizeUrl(url)).filter((u): u is string => Boolean(u))
  );

  console.info('[refine] phase=crawl start', { company: companyId, website: workingProfile.website_url });
  let discoveredSources: Array<{ label: string; url: string }> = [];
  let discoveredSummaries: Array<{ label: string; url: string; summary: string }> = [];
  if (workingProfile.website_url) {
    const crawlResult = await crawlWebsiteSources(workingProfile.website_url, existingSourceUrls);
    discoveredSources = crawlResult.urls;
    discoveredSummaries = crawlResult.summaries;
    workingProfile = mergeDiscoveredSocialProfiles(workingProfile, crawlResult.social_links);
    console.info('[refine] phase=crawl done', { elapsed: elapsed(), pages: discoveredSources.length });
  }

  const sourceList = [...discoveredSources, ...buildSourceList(workingProfile)];
  const dedupedSourceList = Array.from(new Map(sourceList.map((item) => [item.url, item])).values());

  console.info('[refine] phase=social-fetch start', { elapsed: elapsed(), urls: dedupedSourceList.length });
  const { fetchUrlSummary } = await import('./companyProfile/refinementHelpers');
  const socialSummaries = await Promise.all(
    dedupedSourceList.map(async (source) => ({
      label: source.label,
      url: source.url,
      summary: await fetchUrlSummary(source.url),
    }))
  );
  console.info('[refine] phase=social-fetch done', { elapsed: elapsed(), fetched: socialSummaries.filter((s) => s.summary).length });

  const summarizedSources = [
    ...discoveredSummaries,
    ...socialSummaries.filter((entry) => entry.summary),
  ].filter((entry) => !shouldSkipUrl(entry.url)).slice(0, 40);

  const socialEvidenceLines = (workingProfile.social_profiles || [])
    .map((entry) => entry?.url).filter(Boolean).map((url) => `- ${url}`);
  const socialEvidence = socialEvidenceLines.length > 0
    ? [{ label: 'social_profiles', url: 'social_profiles', summary: `SOCIAL PROFILES FOUND:\n${socialEvidenceLines.join('\n')}` }]
    : [];
  const evidenceWithSocial = [...summarizedSources, ...socialEvidence];

  console.info('[refine] phase=clean-evidence start', { elapsed: elapsed(), evidenceCount: evidenceWithSocial.length });
  const cleanedEvidence = await cleanEvidenceWithAi(companyId, evidenceWithSocial);
  console.info('[refine] phase=clean-evidence done', { elapsed: elapsed() });

  const evidenceForExtraction = cleanedEvidence.length > 0 ? cleanedEvidence : evidenceWithSocial;
  const extractionPrompt = buildExtractionPrompt(evidenceForExtraction, workingProfile);

  console.info('[refine] phase=extraction start', { elapsed: elapsed() });
  const [extractionResult, missingFieldQuestionsRaw] = await Promise.all([
    runCompletionWithOperation({
      companyId, campaignId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      operation: 'profileExtraction',
      messages: [
        { role: 'system', content: extractionPrompt.systemPrompt },
        { role: 'user', content: extractionPrompt.userPrompt },
      ],
    }),
    (async () => {
      try {
        return await generateMissingFieldQuestions(companyId, buildExtractionWithDefaults({}));
      } catch {
        return [] as Array<{ field: string; question: string; options: string[]; allow_multiple?: boolean }>;
      }
    })(),
  ]);
  console.info('[refine] phase=extraction done', { elapsed: elapsed() });

  const extractionParsed = JSON.parse(extractionResult.output?.trim() || '{}');
  let extraction = buildExtractionWithDefaults(extractionParsed);
  let missingFieldQuestions = missingFieldQuestionsRaw;
  if (!extraction.missing_fields || extraction.missing_fields.length === 0) {
    extraction.missing_fields = computeMissingFields(extraction);
  }
  if (missingFieldQuestions.length === 0 && extraction.missing_fields.length > 0) {
    try { missingFieldQuestions = await generateMissingFieldQuestions(companyId, extraction); }
    catch { console.warn('[refine] Missing-field questionnaire generation failed.'); }
  }

  const baseRefinedPayload = buildRefinedPayload(workingProfile, extraction);
  const mergedProfileForStrategy = {
    ...workingProfile,
    ...baseRefinedPayload,
  } as CompanyProfile;
  const [derivedStrategyProfile, marketingIntelligenceDraft] = await Promise.all([
    deriveStrategyProfileDraft(mergedProfileForStrategy, evidenceForExtraction),
    generateMarketingIntelligenceDraft(mergedProfileForStrategy),
  ]);

  const refinedPayload = {
    ...baseRefinedPayload,
    ...mapStrategyProfileToExistingFields(derivedStrategyProfile.strategyProfile, {
      brand_positioning: baseRefinedPayload.brand_positioning ?? workingProfile.brand_positioning ?? null,
      growth_priorities: baseRefinedPayload.growth_priorities ?? workingProfile.growth_priorities ?? null,
      competitive_advantages: baseRefinedPayload.competitive_advantages ?? workingProfile.competitive_advantages ?? null,
      recommendation_context: workingProfile.recommendation_context ?? null,
    }),
    marketing_channels: fillMissingText(
      baseRefinedPayload.marketing_channels ?? workingProfile.marketing_channels ?? null,
      marketingIntelligenceDraft.marketing_channels,
    ),
    content_strategy: fillMissingText(
      baseRefinedPayload.content_strategy ?? workingProfile.content_strategy ?? null,
      marketingIntelligenceDraft.content_strategy,
    ),
    campaign_focus: fillMissingText(
      baseRefinedPayload.campaign_focus ?? workingProfile.campaign_focus ?? null,
      marketingIntelligenceDraft.campaign_focus,
    ),
    key_messages: fillMissingText(
      baseRefinedPayload.key_messages ?? workingProfile.key_messages ?? null,
      marketingIntelligenceDraft.key_messages,
    ),
    brand_positioning: fillMissingText(
      baseRefinedPayload.brand_positioning ?? workingProfile.brand_positioning ?? null,
      marketingIntelligenceDraft.brand_positioning,
    ),
    competitive_advantages: fillMissingText(
      baseRefinedPayload.competitive_advantages ?? workingProfile.competitive_advantages ?? null,
      marketingIntelligenceDraft.competitive_advantages,
    ),
    growth_priorities: fillMissingText(
      baseRefinedPayload.growth_priorities ?? workingProfile.growth_priorities ?? null,
      marketingIntelligenceDraft.growth_priorities,
    ),
    competitors_list: Array.isArray(baseRefinedPayload.competitors_list)
      ? baseRefinedPayload.competitors_list
      : [],
  };

  refinedPayload.competitors = Array.isArray(refinedPayload.competitors_list) && refinedPayload.competitors_list.length > 0
    ? refinedPayload.competitors_list.join(', ')
    : null;

  const { data, error } = await supabase
    .from('company_profiles')
    .upsert(refinedPayload, { onConflict: 'company_id' })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to refine company profile: ${error.message}`);

  const auditDetails: CompanyProfileRefinementDetails = {
    company_id: workingProfile.company_id,
    before_profile: workingProfile,
    after_profile: data,
    source_urls: dedupedSourceList,
    source_summaries: evidenceForExtraction,
    changed_fields: buildChangedFields(workingProfile, data),
    created_at: new Date().toISOString(),
    extraction_output: extraction,
    missing_fields_questions: missingFieldQuestions,
  };
  await storeRefinementAudit(auditDetails);

  return { profile: data, details: auditDetails };
};

function buildRefinedPayload(workingProfile: CompanyProfile, extraction: CompanyProfileExtractionOutput) {
  const existingConfidence = workingProfile.field_confidence || {};
  const marketPulseSettings = buildAiMarketPulseSettings(workingProfile, extraction);

  const industryUpdate = updateArrayField(workingProfile.industry_list ?? splitToList(workingProfile.industry), extraction.industry?.value, extraction.industry?.source, existingConfidence.industry, extraction.industry?.confidence);
  const categoryUpdate = updateArrayField(workingProfile.category_list ?? splitToList(workingProfile.category), extraction.category?.value, extraction.category?.source, existingConfidence.category, extraction.category?.confidence);
  const geographyUpdate = updateArrayField(workingProfile.geography_list ?? splitToList(workingProfile.geography), extraction.geography?.value, extraction.geography?.source, existingConfidence.geography, extraction.geography?.confidence);
  const competitorsUpdate = updateArrayField(workingProfile.competitors_list ?? splitToList(workingProfile.competitors), extraction.competitors?.value, extraction.competitors?.source, existingConfidence.competitors, extraction.competitors?.confidence);
  const themesUpdate = updateArrayField(workingProfile.content_themes_list ?? splitToList(workingProfile.content_themes), extraction.content_themes?.value, extraction.content_themes?.source, existingConfidence.content_themes, extraction.content_themes?.confidence);
  const productsUpdate = updateArrayField(workingProfile.products_services_list ?? splitToList(workingProfile.products_services), extraction.products_services?.value, extraction.products_services?.source, existingConfidence.products_services, extraction.products_services?.confidence);
  const audienceUpdate = updateArrayField(workingProfile.target_audience_list ?? splitToList(workingProfile.target_audience), extraction.target_audience?.value, extraction.target_audience?.source, existingConfidence.target_audience, extraction.target_audience?.confidence);
  const goalsUpdate = updateArrayField(workingProfile.goals_list ?? splitToList(workingProfile.goals), extraction.goals?.value, extraction.goals?.source, existingConfidence.goals, extraction.goals?.confidence);
  const brandVoiceUpdate = updateArrayField(workingProfile.brand_voice_list ?? splitToList(workingProfile.brand_voice), extraction.brand_voice?.value, extraction.brand_voice?.source, existingConfidence.brand_voice, extraction.brand_voice?.confidence);
  const nameUpdate = updateScalarField(workingProfile.name, extraction.company_name?.value, extraction.company_name?.source, existingConfidence.company_name, extraction.company_name?.confidence);
  const websiteUpdate = updateScalarField(workingProfile.website_url, extraction.website_url?.value, extraction.website_url?.source, existingConfidence.website_url, extraction.website_url?.confidence);
  const uniqueUpdate = updateScalarField(workingProfile.unique_value, extraction.unique_value_proposition?.value, extraction.unique_value_proposition?.source, existingConfidence.unique_value_proposition, extraction.unique_value_proposition?.confidence);

  const mergedSocialProfiles = buildSocialProfileList(workingProfile.social_profiles, extraction.social_profiles);
  mergedSocialProfiles.forEach((entry) => {
    if (entry.platform === 'linkedin' && !workingProfile.linkedin_url) workingProfile.linkedin_url = entry.url;
    if (entry.platform === 'facebook' && !workingProfile.facebook_url) workingProfile.facebook_url = entry.url;
    if (entry.platform === 'instagram' && !workingProfile.instagram_url) workingProfile.instagram_url = entry.url;
    if (entry.platform === 'x' && !workingProfile.x_url) workingProfile.x_url = entry.url;
    if (entry.platform === 'youtube' && !workingProfile.youtube_url) workingProfile.youtube_url = entry.url;
    if (entry.platform === 'tiktok' && !workingProfile.tiktok_url) workingProfile.tiktok_url = entry.url;
    if (entry.platform === 'reddit' && !workingProfile.reddit_url) workingProfile.reddit_url = entry.url;
    if (entry.platform === 'blog' && !workingProfile.blog_url) workingProfile.blog_url = entry.url;
  });

  const extractionConfidence = computeConfidenceScore(extraction);
  const locked = new Set<string>(Array.isArray(workingProfile.user_locked_fields) ? workingProfile.user_locked_fields : []);
  const pick = <T>(refinedVal: T, workingVal: T, field: string): T =>
    locked.has(field) ? workingVal : (refinedVal ?? workingVal ?? null) as T;
  const contextForCompetitorFit = extractCompetitiveContextFromProfile({
    ...workingProfile,
    industry: industryUpdate.value.join(', ') || workingProfile.industry,
    category: categoryUpdate.value.join(', ') || workingProfile.category,
    geography: geographyUpdate.value.join(', ') || workingProfile.geography,
    products_services: productsUpdate.value.join(', ') || workingProfile.products_services,
    target_audience: audienceUpdate.value.join(', ') || workingProfile.target_audience,
    industry_list: industryUpdate.value,
    category_list: categoryUpdate.value,
    geography_list: geographyUpdate.value,
    products_services_list: productsUpdate.value,
    target_audience_list: audienceUpdate.value,
  });
  const competitorSource = mapExtractionCompetitorSource(extraction.competitors?.source);
  const rankedCompetitors = getFinalCompetitorsSync({
    candidates: competitorsUpdate.value.map((name) => ({ name, source: competitorSource })),
    context: contextForCompetitorFit,
    max: 8,
    minScore: 42,
  });
  const competitorValues = rankedCompetitors.length > 0 ? rankedCompetitors.map((item) => item.name) : [];

  const mergedSourceUrls = Array.from(
    new Set([...(workingProfile.source_urls || [])].map((url) => normalizeUrl(url)).filter((u): u is string => Boolean(u)))
  );

  const fieldConfidence = {
    company_name: nameUpdate.confidence, industry: industryUpdate.confidence,
    category: categoryUpdate.confidence, geography: geographyUpdate.confidence,
    competitors: competitorsUpdate.confidence, content_themes: themesUpdate.confidence,
    products_services: productsUpdate.confidence, target_audience: audienceUpdate.confidence,
    goals: goalsUpdate.confidence, brand_voice: brandVoiceUpdate.confidence,
    website_url: websiteUpdate.confidence, unique_value_proposition: uniqueUpdate.confidence,
  };

  console.log('MERGED PROFILE:', { industry_list: industryUpdate.value, category_list: categoryUpdate.value });
  console.info('Company profile extraction summary', {
    company_id: workingProfile.company_id,
    counts: {
      industry: industryUpdate.value.length, category: categoryUpdate.value.length,
      geography: geographyUpdate.value.length, social_profiles: mergedSocialProfiles.length,
    },
  });

  return {
    company_id: workingProfile.company_id,
    name: pick(nameUpdate.value, workingProfile.name, 'name'),
    industry: pick(industryUpdate.value.join(', '), workingProfile.industry, 'industry'),
    category: pick(categoryUpdate.value.join(', '), workingProfile.category, 'category'),
    website_url: pick(websiteUpdate.value, workingProfile.website_url, 'website_url'),
    linkedin_url: workingProfile.linkedin_url ?? null,
    facebook_url: workingProfile.facebook_url ?? null,
    instagram_url: workingProfile.instagram_url ?? null,
    x_url: workingProfile.x_url ?? null,
    youtube_url: workingProfile.youtube_url ?? null,
    tiktok_url: workingProfile.tiktok_url ?? null,
    reddit_url: workingProfile.reddit_url ?? null,
    blog_url: workingProfile.blog_url ?? null,
    other_social_links: workingProfile.other_social_links ?? null,
    products_services: pick(productsUpdate.value.join(', '), workingProfile.products_services, 'products_services'),
    target_audience: pick(audienceUpdate.value.join(', '), workingProfile.target_audience, 'target_audience'),
    geography: pick(geographyUpdate.value.join(', '), workingProfile.geography, 'geography'),
    brand_voice: pick(brandVoiceUpdate.value.join(', '), workingProfile.brand_voice, 'brand_voice'),
    goals: pick(goalsUpdate.value.join(', '), workingProfile.goals, 'goals'),
    competitors: competitorValues.length > 0 ? competitorValues.join(', ') : null,
    unique_value: pick(uniqueUpdate.value, workingProfile.unique_value, 'unique_value'),
    content_themes: pick(themesUpdate.value.join(', '), workingProfile.content_themes, 'content_themes'),
    industry_list: pick(industryUpdate.value, workingProfile.industry_list, 'industry_list'),
    category_list: pick(categoryUpdate.value, workingProfile.category_list, 'category_list'),
    geography_list: pick(geographyUpdate.value, workingProfile.geography_list, 'geography_list'),
    competitors_list: competitorValues,
    content_themes_list: pick(themesUpdate.value, workingProfile.content_themes_list, 'content_themes_list'),
    products_services_list: pick(productsUpdate.value, workingProfile.products_services_list, 'products_services_list'),
    target_audience_list: pick(audienceUpdate.value, workingProfile.target_audience_list, 'target_audience_list'),
    goals_list: pick(goalsUpdate.value, workingProfile.goals_list, 'goals_list'),
    brand_voice_list: pick(brandVoiceUpdate.value, workingProfile.brand_voice_list, 'brand_voice_list'),
    social_profiles: locked.has('social_profiles') ? workingProfile.social_profiles : (mergedSocialProfiles ?? workingProfile.social_profiles ?? null),
    field_confidence: fieldConfidence ?? workingProfile.field_confidence ?? null,
    overall_confidence: Math.max(workingProfile.overall_confidence ?? 0, extractionConfidence),
    source_urls: mergedSourceUrls,
    confidence_score: Math.max(workingProfile.confidence_score ?? 0, extractionConfidence),
    source: 'ai_refined' as const,
    last_refined_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    target_customer_segment: workingProfile.target_customer_segment ?? null,
    ideal_customer_profile: workingProfile.ideal_customer_profile ?? null,
    pricing_model: workingProfile.pricing_model ?? null,
    sales_motion: workingProfile.sales_motion ?? null,
    avg_deal_size: workingProfile.avg_deal_size ?? null,
    sales_cycle: workingProfile.sales_cycle ?? null,
    key_metrics: workingProfile.key_metrics ?? null,
    user_locked_fields: workingProfile.user_locked_fields ?? null,
    last_edited_by: workingProfile.last_edited_by ?? null,
    marketing_channels: workingProfile.marketing_channels ?? null,
    content_strategy: workingProfile.content_strategy ?? null,
    campaign_focus: workingProfile.campaign_focus ?? null,
    key_messages: workingProfile.key_messages ?? null,
    brand_positioning: workingProfile.brand_positioning ?? null,
    competitive_advantages: workingProfile.competitive_advantages ?? null,
    growth_priorities: workingProfile.growth_priorities ?? null,
    report_settings: {
      ...(workingProfile.report_settings ?? {}),
      market_pulse: marketPulseSettings ?? workingProfile.report_settings?.market_pulse ?? null,
    },
  };
}

export async function refineProfileWithAI(
  profile: CompanyProfile,
  options?: { force?: boolean }
): Promise<CompanyProfile> {
  const result = await runProfileRefinement(profile, options);
  return result.profile;
}

export async function refineProfileWithAIWithDetails(
  profile: CompanyProfile,
  options?: { force?: boolean }
): Promise<{ profile: CompanyProfile; details: CompanyProfileRefinementDetails }> {
  return runProfileRefinement(profile, options);
}
