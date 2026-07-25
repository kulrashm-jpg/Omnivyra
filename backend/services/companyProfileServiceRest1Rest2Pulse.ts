/** Company profile — market-pulse settings, profile reads + assembly — split from companyProfileServiceRest1Rest2.ts (barrel preserved; importers unchanged). */
/** TEMP2 — split from companyProfileServiceRest1.ts (barrel preserved; importers unchanged). */
/** TEMP1 — split from companyProfileService.ts (barrel preserved; importers unchanged). */
import { ownedDbTable } from '../db/writeOwner';
// W4-5 (Batch D cache stack)
import { defineRolloutFlag, resolveRolloutSync } from '../../lib/platform/rollout';
import { memoRequest } from './requestScopedMemo';
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
  findKnownCompetitorProfile,
  type CompetitorEnrichmentProfile,
} from './competitorEnrichmentKnowledge';
import {
  assertCompetitorOutputPartition,
  buildCandidatesFromNames,
  dedupeCompetitorCandidates,
  extractCompetitiveContextFromProfile,
  getFinalCompetitors,
  hasPassedFinalCompetitorGate,
  HIGH_CONFIDENCE_NAMED_COMPETITOR_SCORE,
  splitRankedCompetitorsForOutput,
  type CompanyCompetitiveContext,
  type CompetitorCandidate,
  type RankedCompetitor,
} from './competitorEngineService';
import {

  discoverCompetitorDomainsFromSerp,
  domainToName,
  generateDiscoveryKeywords,
  normalizeDomain as normalizeCompetitorDiscoveryDomain,
} from './reportCompetitorIntelligenceServiceHelpers';

import { COMPANY_PROFILES_TABLE, COMPANY_PROFILE_FALLBACK_COLUMNS, MARKET_PULSE_DEFAULT_CATEGORY_SET, normalizeNonEmptyText, normalizeStringArray, normalizeRecommendationContext, mapStrategyProfileToExistingFields, fillMissingText, ensureMinimumDiscoveryKeywords, expandRefineDiscoveryKeywords, buildProfileForCompetitorDiscovery, type RefineCompetitorDiscovery, profileDiscoverySignalText, archetypeValues, profileAudienceLabel, profileTopicLabel, buildArchetypeNativeDiscoverySeeds } from './companyProfileServiceCore';

import { applyArchetypeContextToProfile, competitorValidationContextForProfile, buildRefineRecoveryContexts, discoverRefineCompetitorCandidates, inferBusinessModelLabel, textFromValue, normalizeFieldValueList, inferCompanyDomainShape, inferPartnershipPriorities, inferCriticalHiringFunctions, inferRegulatoryPolicySensitivity, inferMarketPulseCategories, withExistingList, withExistingText, buildIndustryReview, rankedMarketAlternativesForProfile, rankedCompetitorDetailsForProfile } from './companyProfileServiceRest1Enrich';

import { sanitizeStoredCompetitorsForRead, revalidateStoredCompetitorsForProfileRead, refineProfileForPrompts, refineProfileWithAI } from './companyProfileServiceRest1Rest2Competitors';

export function rankedCompetitorIntelligenceForProfile(competitors: RankedCompetitor[]) {
  return splitRankedCompetitorsForOutput(competitors, 8, 3).competitors
    .map((competitor) => ({
      name: competitor.name,
      source: competitor.source,
      category: competitor.category,
      tier: competitor.tier,
      score: competitor.relevance_score,
      confidence: competitor.enrichment_confidence_score,
      rationale: competitor.rationale,
      ...(competitor.competitor_intelligence ?? {}),
    }))
    .filter((competitor) => competitor.source === 'archetype_native_peer' || competitor.archetype_peer_category || competitor.narrative_overlap);
}

export function rankedCompetitorQualityForProfile(competitors: RankedCompetitor[]) {
  const namedCompetitors = splitRankedCompetitorsForOutput(competitors, 8, 3).competitors;
  const highestScore = namedCompetitors.reduce(
    (max, competitor) => Math.max(max, Number(competitor.relevance_score ?? 0)),
    0,
  );
  const thresholdMet = highestScore >= HIGH_CONFIDENCE_NAMED_COMPETITOR_SCORE;
  return {
    highest_score: namedCompetitors.length > 0 ? highestScore : null,
    threshold: HIGH_CONFIDENCE_NAMED_COMPETITOR_SCORE,
    threshold_met: thresholdMet,
    detail_mode: thresholdMet ? 'high_confidence' as const : 'expanded_context' as const,
  };
}

export function buildAiMarketPulseSettings(
  workingProfile: CompanyProfile,
  extraction: CompanyProfileExtractionOutput,
): NonNullable<NonNullable<CompanyProfile['report_settings']>['market_pulse']> | null {
  const existing = workingProfile.report_settings?.market_pulse ?? null;

  const geography = Array.from(
    new Set([
      ...normalizeStringArray(workingProfile.geography_list),
      ...normalizeFieldValueList(extraction.geography?.value),
      ...splitToList(workingProfile.geography),
    ]),
  );
  const productsServices = Array.from(
    new Set([
      ...normalizeStringArray(workingProfile.products_services_list),
      ...normalizeFieldValueList(extraction.products_services?.value),
      ...splitToList(workingProfile.products_services),
    ]),
  );
  const goals = Array.from(
    new Set([
      ...normalizeStringArray(workingProfile.goals_list),
      ...normalizeFieldValueList(extraction.goals?.value),
      ...splitToList(workingProfile.goals),
      ...splitToList(workingProfile.growth_priorities),
    ]),
  );
  const contentThemes = Array.from(
    new Set([
      ...normalizeStringArray(workingProfile.content_themes_list),
      ...normalizeFieldValueList(extraction.content_themes?.value),
      ...splitToList(workingProfile.content_themes),
    ]),
  );
  const targetAudience = Array.from(
    new Set([
      ...normalizeStringArray(workingProfile.target_audience_list),
      ...normalizeFieldValueList(extraction.target_audience?.value),
      ...splitToList(workingProfile.target_audience),
    ]),
  );
  const categoryText = normalizeNonEmptyText(workingProfile.category)
    ?? textFromValue(extraction.category?.value)
    ?? null;
  const industryText = normalizeNonEmptyText(workingProfile.industry)
    ?? textFromValue(extraction.industry?.value)
    ?? null;
  const uniqueValue = normalizeNonEmptyText(workingProfile.unique_value)
    ?? textFromValue(extraction.unique_value_proposition?.value)
    ?? null;
  const domainShape = inferCompanyDomainShape({
    category: categoryText,
    industry: industryText,
    productsServices,
    goals,
    contentThemes,
    targetAudience,
    uniqueValue,
    brandPositioning: workingProfile.brand_positioning ?? null,
    campaignFocus: workingProfile.campaign_focus ?? null,
    coreProblem: workingProfile.core_problem_statement ?? null,
    painSymptoms: workingProfile.pain_symptoms ?? null,
    authorityDomains: workingProfile.authority_domains ?? null,
    websiteUrl: workingProfile.website_url ?? null,
  });

  const businessModel = inferBusinessModelLabel({
    category: categoryText,
    industry: industryText,
    productsServices,
    uniqueValue,
    brandPositioning: workingProfile.brand_positioning ?? null,
    contentThemes,
    websiteUrl: workingProfile.website_url ?? null,
  });
  const categorySignals = [
    ...productsServices,
    domainShape.provider_type,
    domainShape.domain_role,
    domainShape.operating_model,
    ...domainShape.solution_domains,
  ].filter((value): value is string => Boolean(normalizeNonEmptyText(value)));

  const next = {
    primary_operating_markets: withExistingList(existing?.primary_operating_markets, geography),
    target_expansion_markets: existing?.target_expansion_markets ?? null,
    named_competitors: null,
    business_model: withExistingText(existing?.business_model, businessModel),
    provider_type: withExistingText(existing?.provider_type, domainShape.provider_type),
    domain_role: withExistingText(existing?.domain_role, domainShape.domain_role),
    operating_model: withExistingText(existing?.operating_model, domainShape.operating_model),
    solution_domains: withExistingList(existing?.solution_domains, domainShape.solution_domains),
    competitor_details: null,
    competitor_quality: null,
    market_alternatives: null,
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
        category: categoryText,
        goals,
        productsServices: categorySignals,
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

function schemaCacheMissingCompanyProfileColumn(error: unknown): string | null {
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  const match = message.match(/Could not find the '([^']+)' column of 'company_profiles' in the schema cache/i);
  return match?.[1] ?? null;
}

export async function upsertCompanyProfilePayload(
  payload: Record<string, unknown>,
  existing: CompanyProfile | null,
  context: string,
): Promise<{ data: CompanyProfile | null; error: { message?: string } | null; omittedSchemaFields: string[] }> {
  const remainingPayload: Record<string, unknown> = { ...payload };
  const omittedSchemaFields: string[] = [];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const validColumns = await getCompanyProfileColumns(existing);
    omittedSchemaFields.forEach((field) => validColumns.delete(field));
    const { safePayload, skippedFields } = filterCompanyProfilePayload(remainingPayload, validColumns);
    if (skippedFields.length > 0) {
      console.warn(`Filtered company profile fields before ${context}:`, skippedFields.join(', '));
    }

    const { data, error } = await ownedDbTable(COMPANY_PROFILES_TABLE)
      .upsert(safePayload, { onConflict: 'company_id' })
      .select('*')
      .single();
    if (!error) {
      const nonPersistedFields = Object.fromEntries(
        omittedSchemaFields
          .filter((field) => Object.prototype.hasOwnProperty.call(payload, field))
          .map((field) => [field, payload[field]]),
      );
      return {
        data: data ? ({ ...(data as CompanyProfile), ...nonPersistedFields } as CompanyProfile) : null,
        error: null,
        omittedSchemaFields,
      };
    }

    const missingColumn = schemaCacheMissingCompanyProfileColumn(error);
    if (missingColumn && Object.prototype.hasOwnProperty.call(remainingPayload, missingColumn)) {
      console.warn(`[company-profile][schema-cache-missing-column] dropping ${missingColumn} during ${context}`);
      delete remainingPayload[missingColumn];
      omittedSchemaFields.push(missingColumn);
      companyProfileColumnsCache?.delete(missingColumn);
      continue;
    }

    return { data: null, error, omittedSchemaFields };
  }

  return {
    data: null,
    error: { message: `Exceeded company profile schema-cache retry limit during ${context}` },
    omittedSchemaFields,
  };
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
  const { data, error } = await ownedDbTable('company_profiles')
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
  const { data, error } = await ownedDbTable('company_profiles')
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

export const storeRefinementAudit = async (details: CompanyProfileRefinementDetails) => {
  try {
    const { error } = await ownedDbTable('company_profile_refinements').insert({
      company_id: details.company_id,
      before_profile: details.before_profile,
      after_profile: details.after_profile,
      source_urls: details.source_urls,
      source_summaries: details.source_summaries,
      changed_fields: details.changed_fields,
      extraction_output: details.entity_archetype
        ? {
            ...(details.extraction_output ?? {}),
            entity_archetype: details.entity_archetype,
            competitor_intelligence: details.competitor_intelligence,
          }
        : details.extraction_output,
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
  const lastRefinedAt = source === 'ai_refined' ? nowIso : existing?.last_refined_at ?? null;
  const confidenceScore = input.confidence_score ?? existing?.confidence_score ?? 0;

  const shouldRefreshClassification =
    source === 'ai_refined' ||
    !existing?.business_classification ||
    ['industry', 'industry_list', 'category', 'category_list', 'products_services', 'products_services_list', 'target_audience', 'target_audience_list', 'goals', 'goals_list', 'unique_value', 'content_themes', 'content_themes_list']
      .some((key) => input[key as keyof CompanyProfile] !== undefined);
  const classifiedInput = { ...input, company_id: companyId } as Partial<CompanyProfile>;
  if (shouldRefreshClassification) {
    const classification = classifyCompanyBusiness({
      ...(existing ?? {}),
      ...input,
      company_id: companyId,
    } as CompanyProfile);
    classifiedInput.business_classification = classification.business_classification;
    classifiedInput.industry = classification.industry.join(', ');
    classifiedInput.industry_list = classification.industry;
    classifiedInput.category = classification.category;
    classifiedInput.category_list = [classification.category];
  }

  const payload = buildSavePayload(classifiedInput, existing, companyId, source, lastRefinedAt, nowIso, confidenceScore);
  const hasExplicitCompetitorInput = input.competitors !== undefined || input.competitors_list !== undefined;
  const competitorsLocked = Array.isArray(existing?.user_locked_fields) && existing!.user_locked_fields.includes('competitors');
  // When the user has locked competitors (saved them explicitly before), preserve
  // their picks through refinement: feed as trusted 'manual' and skip network
  // discovery so an auto-refine doesn't replace the set until the user edits again.
  const preserveLockedCompetitors = competitorsLocked && !hasExplicitCompetitorInput;
  const rawCompetitorInputs = mergeStringArrays(
    [],
    hasExplicitCompetitorInput
      ? [
          ...(Array.isArray(input.competitors_list) ? input.competitors_list : []),
          ...splitToList(typeof input.competitors === 'string' ? input.competitors : null),
        ]
      : [
          ...(Array.isArray(existing?.competitors_list) ? existing.competitors_list : []),
          ...splitToList(typeof existing?.competitors === 'string' ? existing.competitors : null),
        ],
  );
  const finalCompetitors = await getFinalCompetitors({
    candidates: buildCandidatesFromNames(
      rawCompetitorInputs,
      (hasExplicitCompetitorInput && source === 'user') || competitorsLocked ? 'manual' : 'profile_ai',
    ),
    context: competitorValidationContextForProfile({
      ...(existing ?? {}),
      ...classifiedInput,
      company_id: companyId,
    } as CompanyProfile),
    max: 8,
    useNetwork: !preserveLockedCompetitors,
    companyId,
  });
  const splitSavedCompetitors = splitRankedCompetitorsForOutput(finalCompetitors, 8, 0);
  assertCompetitorOutputPartition(splitSavedCompetitors, 'save_profile_competitor_output');
  payload.competitors_list = splitSavedCompetitors.competitors.map((competitor) => competitor.name);
  payload.competitors = payload.competitors_list.length > 0 ? payload.competitors_list.join(', ') : null;

  const lockedSet = new Set<string>(Array.isArray(existing?.user_locked_fields) ? existing.user_locked_fields : []);
  let didLock = false;
  if (!options?.suppressUserLocks) {
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
    // Lock competitors when the user explicitly saves them, so subsequent
    // refinement preserves their picks (fed as trusted 'manual', no network
    // re-discovery) until the user edits competitors again.
    if (hasExplicitCompetitorInput && source === 'user' && rawCompetitorInputs.length > 0) {
      lockedSet.add('competitors');
      didLock = true;
    }
  }
  if (didLock) {
    payload.user_locked_fields = Array.from(lockedSet);
    payload.last_edited_by = 'user';
  }

  const { data, error, omittedSchemaFields } = await upsertCompanyProfilePayload(
    payload as Record<string, unknown>,
    existing,
    'save',
  );
  if (omittedSchemaFields.length > 0) {
    console.warn('Company profile save used non-persisted fields:', omittedSchemaFields.join(', '));
  }
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
    archetype: profile?.report_settings?.entity_archetype ?? null,
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
  const derived = await deriveStrategyProfileDraft(
    profile,
    options?.sourceSummaries ?? [],
    profile.report_settings?.entity_archetype ?? null,
  );
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

// W4-5 (audit B-35): getProfile is fetched 2–4× per generation pipeline and
// its `autoRefine ?? true` default can insert a HIDDEN LLM refine into any
// read path that forgot to pass false. Under the 'profile-cache' flag:
//   1. the raw profile row is request-memoized (same-request re-reads hit the
//      memo; zero staleness — one request sees one snapshot),
//   2. autoRefine becomes OPT-IN on read paths (only callers that explicitly
//      pass autoRefine:true trigger the staleness-driven LLM refine; the
//      refresh cron / explicit refine flows are unaffected).
// Flag off (default) = fetch-per-call + autoRefine-by-default, as before.
// Kill: ROLLOUT_PROFILE_CACHE_KILL. Invalidation: writes happen through
// updateProfile paths which always re-read (memo is request-scoped only —
// no cross-request profile cache in this batch, freshness preserved).
const PROFILE_CACHE_FLAG = defineRolloutFlag({
  key: 'profile-cache',
  description: 'W4-5: request-memoized profile reads + opt-in autoRefine (audit B-35)',
});

export async function getProfile(
  companyId?: string,
  options?: { autoRefine?: boolean; languageRefine?: boolean; includeStoredCompetitors?: boolean }
): Promise<CompanyProfile | null> {
  const resolvedCompanyId = normalizeCompanyId(companyId);
  const cacheOn = resolveRolloutSync(PROFILE_CACHE_FLAG, { tenantId: resolvedCompanyId ?? undefined }).mode !== 'off';
  const profile = cacheOn
    ? await memoRequest(`profile:raw:${resolvedCompanyId}`, () => fetchProfileRaw(resolvedCompanyId))
    : await fetchProfileRaw(resolvedCompanyId);
  if (!profile) return null;

  let result: CompanyProfile | null = profile;
  const autoRefineDefault = cacheOn ? false : true; // W4-5: opt-in under the flag
  if ((options?.autoRefine ?? autoRefineDefault) && shouldRefineProfile(profile.last_refined_at)) {
    result = await refineProfileWithAI(profile, { force: true });
  }
  if ((options?.languageRefine ?? false) && result) {
    result = await refineProfileForPrompts(result);
  }
  return options?.includeStoredCompetitors ? await revalidateStoredCompetitorsForProfileRead(result) : sanitizeStoredCompetitorsForRead(result);
}

export function stripCompetitorFieldsFromReportSettings(
  reportSettings: CompanyProfile['report_settings'] | null | undefined,
): CompanyProfile['report_settings'] | null | undefined {
  if (!reportSettings) return reportSettings;
  const defaultInputs = reportSettings.default_inputs
    ? (() => {
        const {
          competitors: _competitors,
          competitors_list: _competitorsList,
          ...rest
        } = reportSettings.default_inputs as Record<string, unknown>;
        return { ...rest, competitors: [] } as NonNullable<CompanyProfile['report_settings']>['default_inputs'];
      })()
    : reportSettings.default_inputs;
  const marketPulse = reportSettings.market_pulse
    ? (() => {
        const {
          named_competitors: _namedCompetitors,
          competitor_details: _competitorDetails,
          competitor_quality: _competitorQuality,
          market_alternatives: _marketAlternatives,
          ...rest
        } = reportSettings.market_pulse as Record<string, unknown>;
        return {
          ...rest,
          named_competitors: [],
          competitor_details: null,
          competitor_quality: null,
          market_alternatives: null,
        } as NonNullable<CompanyProfile['report_settings']>['market_pulse'];
      })()
    : reportSettings.market_pulse;

  return {
    ...reportSettings,
    default_inputs: defaultInputs,
    market_pulse: marketPulse,
  };
}

