/** Company profile — stored competitors, refinement, persistence — split from companyProfileServiceRest1Rest2.ts (barrel preserved; importers unchanged). */
/** TEMP2 — split from companyProfileServiceRest1.ts (barrel preserved; importers unchanged). */
/** TEMP1 — split from companyProfileService.ts (barrel preserved; importers unchanged). */
import { ownedDbTable } from '../db/writeOwner';
// WAVE-1C-001 §C1
import { parseModelOutputOr } from './ai/safety';
import { isSelfOrPlatformDomain } from './companyProfile/competitorDomainFilter';
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
  listKnownCompetitorProfiles,
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

import { COMPANY_PROFILES_TABLE, COMPANY_PROFILE_FALLBACK_COLUMNS, MARKET_PULSE_DEFAULT_CATEGORY_SET, normalizeNonEmptyText, normalizeStringArray, normalizeRecommendationContext, mapStrategyProfileToExistingFields, fillMissingText, ensureMinimumDiscoveryKeywords, expandRefineDiscoveryKeywords, knownDatasetCompetitorCandidates, buildProfileForCompetitorDiscovery, type RefineCompetitorDiscovery, matchingRefineCategoryProfiles, prioritizedKnownDatasetCompetitorCandidatesForSignal, profileDiscoverySignalText, archetypeValues, profileAudienceLabel, profileTopicLabel, buildArchetypeNativeDiscoverySeeds, archetypeCandidate, ARCHETYPE_NAMED_PEER_PACKS } from './companyProfileServiceCore';

import { applyArchetypeContextToProfile, competitorValidationContextForProfile, buildRefineRecoveryContexts, buildPrioritizedRefineFallbackCandidates, discoverRefineCompetitorCandidates, inferBusinessModelLabel, textFromValue, normalizeFieldValueList, inferCompanyDomainShape, inferPartnershipPriorities, inferCriticalHiringFunctions, inferRegulatoryPolicySensitivity, inferMarketPulseCategories, withExistingList, withExistingText, buildIndustryReview, rankedMarketAlternativesForProfile, rankedCompetitorDetailsForProfile } from './companyProfileServiceRest1Enrich';

import { rankedCompetitorIntelligenceForProfile, rankedCompetitorQualityForProfile, buildAiMarketPulseSettings, upsertCompanyProfilePayload, shouldRefineProfile, storeRefinementAudit, stripCompetitorFieldsFromReportSettings } from './companyProfileServiceRest1Rest2Pulse';
// CKRE-002 §3 — refresh gate (orchestration only; does NOT modify AI prompts/models/extraction).
import { evaluateRefreshGate, finalizeAiRefresh, type RefreshGateResult } from './crawl/refreshOrchestrator';

export function sanitizeStoredCompetitorsForRead(profile: CompanyProfile | null): CompanyProfile | null {
  if (!profile) return null;
  const reportSettings = profile.report_settings ?? null;
  return {
    ...profile,
    competitors: null,
    competitors_list: [],
    report_settings: stripCompetitorFieldsFromReportSettings(reportSettings),
  };
}

// ─── Language refinement ──────────────────────────────────────────────────────

export function storedCompetitorNames(profile: CompanyProfile | null): string[] {
  if (!profile) return [];
  return mergeStringArrays(
    [],
    [
      ...(Array.isArray(profile.competitors_list) ? profile.competitors_list : []),
      ...splitToList(typeof profile.competitors === 'string' ? profile.competitors : null),
    ],
  );
}

function withProfileReadCompetitors(profile: CompanyProfile, names: string[]): CompanyProfile {
  const reportSettings = profile.report_settings ?? null;
  const competitorsList = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))).slice(0, 8);
  return {
    ...profile,
    competitors: competitorsList.length > 0 ? competitorsList.join(', ') : null,
    competitors_list: competitorsList,
    report_settings: stripCompetitorFieldsFromReportSettings(reportSettings),
  };
}

export async function revalidateStoredCompetitorsForProfileRead(profile: CompanyProfile | null): Promise<CompanyProfile | null> {
  if (!profile) return null;
  const rawNames = storedCompetitorNames(profile);
  if (rawNames.length === 0) return withProfileReadCompetitors(profile, []);

  try {
    const finalCompetitors = await getFinalCompetitors({
      candidates: buildCandidatesFromNames(rawNames, 'profile_ai'),
      context: competitorValidationContextForProfile(profile),
      max: 8,
      minScore: 42,
      useNetwork: false,
      useStoredCache: false,
      companyId: profile.company_id,
      includeMarketSubstitutes: false,
    });
    const splitReadCompetitors = splitRankedCompetitorsForOutput(finalCompetitors, 8, 0);
    assertCompetitorOutputPartition(splitReadCompetitors, 'profile_read_competitor_output');
    const finalNames = splitReadCompetitors.competitors
      .filter((competitor) => hasPassedFinalCompetitorGate(competitor, 42))
      .map((competitor) => competitor.name);
    if (finalNames.length !== rawNames.length || finalNames.some((name, index) => name !== rawNames[index])) {
      console.info('[company-profile][stored-competitors-revalidated]', {
        company_id: profile.company_id,
        stored_count: rawNames.length,
        validated_count: finalNames.length,
      });
    }
    return withProfileReadCompetitors(profile, finalNames);
  } catch (error) {
    console.warn('[company-profile][stored-competitors-cleared]', {
      company_id: profile.company_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return withProfileReadCompetitors(profile, []);
  }
}

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
  options?: { force?: boolean; manualRefresh?: boolean }
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
  let workingProfile = applyApprovedStrategicGuidance({ ...profile });

  const existingSourceUrls = new Set(
    (workingProfile.source_urls || []).map((url) => normalizeUrl(url)).filter((u): u is string => Boolean(u))
  );

  console.info('[refine] phase=crawl start', { company: companyId, website: workingProfile.website_url });
  let discoveredSources: Array<{ label: string; url: string }> = [];
  let discoveredSummaries: Array<{ label: string; url: string; summary: string }> = [];
  // CKRE-002 §3 — the refresh gate decides whether the AI chain below runs.
  let refreshGate: RefreshGateResult | null = null;
  if (workingProfile.website_url) {
    // CKRE-001 §1 — instrument the refresh crawl (events + deterministic
    // fingerprint/change detection). This does NOT change AI extraction or
    // refinement; it only supplies crawl context for observability.
    const crawlResult = await crawlWebsiteSources(workingProfile.website_url, existingSourceUrls, {
      companyId,
      workflow: 'profile_refresh',
    });
    discoveredSources = crawlResult.urls;
    discoveredSummaries = crawlResult.summaries;
    workingProfile = mergeDiscoveredSocialProfiles(workingProfile, crawlResult.social_links);
    console.info('[refine] phase=crawl done', { elapsed: elapsed(), pages: discoveredSources.length });

    // ── CKRE-002 §2/§3 — AI GATE (orchestration; no prompt/model/extraction change) ──
    // Consult the Refresh Policy Engine. On SKIP/DEFER/METADATA_ONLY the LLM
    // chain below is skipped (deterministic incremental refresh + savings);
    // AI runs only when policy permits. Fail-open: an error runs the AI as before.
    refreshGate = await evaluateRefreshGate({
      companyId,
      changeDecision: crawlResult.changeDecision ?? null,
      metadata: crawlResult.metadata,
      manualRefresh: options?.manualRefresh === true,
      workflow: 'profile_refresh',
    });
    if (refreshGate.skipAi) {
      // Merge any deterministic metadata written by the incremental path so the
      // returned profile reflects it (persistence already happened in the gate).
      if (refreshGate.action === 'REFRESH_METADATA_ONLY' && crawlResult.metadata) {
        if (crawlResult.metadata.logoUrl) workingProfile.logo_url = crawlResult.metadata.logoUrl;
        if (crawlResult.metadata.faviconUrl) workingProfile.favicon_url = crawlResult.metadata.faviconUrl;
        if (crawlResult.metadata.country) workingProfile.geography = crawlResult.metadata.country;
      }
      console.info('[refine] phase=gate skip-ai', { action: refreshGate.action, verdict: refreshGate.verdict });
      const skipDetails: CompanyProfileRefinementDetails = {
        company_id: workingProfile.company_id, before_profile: profile, after_profile: workingProfile,
        source_urls: discoveredSources, source_summaries: [], changed_fields: [], created_at: new Date().toISOString(),
      };
      return { profile: workingProfile, details: skipDetails };
    }
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
  const entityArchetype = inferEntityArchetype({
    profile: workingProfile,
    evidence: evidenceForExtraction,
  });
  workingProfile = {
    ...workingProfile,
    report_settings: {
      ...(workingProfile.report_settings ?? {}),
      entity_archetype: entityArchetype,
    },
  };
  const extractionPrompt = buildExtractionPrompt(evidenceForExtraction, workingProfile, entityArchetype);

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

  const extractionParsed = parseModelOutputOr<any>(extractionResult.output, {}, { surface: 'profile.competitorExtraction' });
  let extraction = buildExtractionWithDefaults(extractionParsed);
  let missingFieldQuestions = missingFieldQuestionsRaw;
  if (!extraction.missing_fields || extraction.missing_fields.length === 0) {
    extraction.missing_fields = computeMissingFields(extraction);
  }
  if (missingFieldQuestions.length === 0 && extraction.missing_fields.length > 0) {
    try { missingFieldQuestions = await generateMissingFieldQuestions(companyId, extraction); }
    catch { console.warn('[refine] Missing-field questionnaire generation failed.'); }
  }

  const preliminaryClassification = classifyCompanyBusiness(workingProfile, extraction);
  workingProfile = {
    ...workingProfile,
    business_classification: preliminaryClassification.business_classification,
    industry: preliminaryClassification.industry.join(', '),
    industry_list: preliminaryClassification.industry,
    category: preliminaryClassification.category,
    category_list: [preliminaryClassification.category],
  };

  const profileForCompetitorDiscovery = applyArchetypeContextToProfile(
    buildProfileForCompetitorDiscovery(workingProfile, extraction),
    entityArchetype,
  );
  const competitorDiscovery = await discoverRefineCompetitorCandidates(profileForCompetitorDiscovery);
  const baseRefinedPayload = await buildRefinedPayload(workingProfile, extraction, competitorDiscovery, entityArchetype);
  const mergedProfileForStrategy = {
    ...workingProfile,
    ...baseRefinedPayload,
  } as CompanyProfile;
  const [derivedStrategyProfile, marketingIntelligenceDraft] = await Promise.all([
    deriveStrategyProfileDraft(mergedProfileForStrategy, evidenceForExtraction, entityArchetype),
    generateMarketingIntelligenceDraft(mergedProfileForStrategy, entityArchetype),
  ]);

  const refinedPayload = applyApprovedStrategicGuidance({
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
  } as CompanyProfile);

  refinedPayload.competitors = Array.isArray(refinedPayload.competitors_list) && refinedPayload.competitors_list.length > 0
    ? refinedPayload.competitors_list.join(', ')
    : null;

  const { data, error, omittedSchemaFields } = await upsertCompanyProfilePayload(
    refinedPayload as Record<string, unknown>,
    workingProfile,
    'refine',
  );
  if (error) throw new Error(`Failed to refine company profile: ${error.message}`);
  if (!data) throw new Error('Failed to refine company profile: no profile returned after save');
  if (omittedSchemaFields.length > 0) {
    console.warn('Company profile refine used non-persisted fields:', omittedSchemaFields.join(', '));
  }

  const auditDetails: CompanyProfileRefinementDetails = {
    company_id: workingProfile.company_id,
    before_profile: workingProfile,
    after_profile: data,
    source_urls: dedupedSourceList,
    source_summaries: evidenceForExtraction,
    changed_fields: buildChangedFields(workingProfile, data),
    created_at: new Date().toISOString(),
    extraction_output: extraction,
    entity_archetype: entityArchetype,
    competitor_intelligence: data.report_settings?.competitor_intelligence ?? null,
    missing_fields_questions: missingFieldQuestions,
  };
  await storeRefinementAudit(auditDetails);

  // CKRE-002 §5/§6/§7 — finalize: create the knowledge version + completion
  // events for this AI refresh. Best-effort; never affects the returned profile.
  if (refreshGate) {
    await finalizeAiRefresh({
      companyId,
      gate: refreshGate,
      workflow: 'profile_refresh',
      executionMs: Date.now() - t0,
      affectedSections: refreshGate.verdict ? ['business'] : [],
    });
  }

  return { profile: data, details: auditDetails };
};

async function buildRefinedPayload(
  workingProfile: CompanyProfile,
  extraction: CompanyProfileExtractionOutput,
  competitorDiscovery: RefineCompetitorDiscovery,
  entityArchetype?: EntityArchetypeIntelligence | null,
) {
  const existingConfidence = workingProfile.field_confidence || {};
  const marketPulseSettings = buildAiMarketPulseSettings(workingProfile, extraction);

  const industryUpdate = updateArrayField(workingProfile.industry_list ?? splitToList(workingProfile.industry), extraction.industry?.value, extraction.industry?.source, existingConfidence.industry, extraction.industry?.confidence);
  const categoryUpdate = updateArrayField(workingProfile.category_list ?? splitToList(workingProfile.category), extraction.category?.value, extraction.category?.source, existingConfidence.category, extraction.category?.confidence);
  const geographyUpdate = updateArrayField(workingProfile.geography_list ?? splitToList(workingProfile.geography), extraction.geography?.value, extraction.geography?.source, existingConfidence.geography, extraction.geography?.confidence);
  const themesUpdate = updateArrayField(workingProfile.content_themes_list ?? splitToList(workingProfile.content_themes), extraction.content_themes?.value, extraction.content_themes?.source, existingConfidence.content_themes, extraction.content_themes?.confidence);
  const productsUpdate = updateArrayField(workingProfile.products_services_list ?? splitToList(workingProfile.products_services), extraction.products_services?.value, extraction.products_services?.source, existingConfidence.products_services, extraction.products_services?.confidence);
  const audienceUpdate = updateArrayField(workingProfile.target_audience_list ?? splitToList(workingProfile.target_audience), extraction.target_audience?.value, extraction.target_audience?.source, existingConfidence.target_audience, extraction.target_audience?.confidence);
  const goalsUpdate = updateArrayField(workingProfile.goals_list ?? splitToList(workingProfile.goals), extraction.goals?.value, extraction.goals?.source, existingConfidence.goals, extraction.goals?.confidence);
  const brandVoiceUpdate = updateArrayField(workingProfile.brand_voice_list ?? splitToList(workingProfile.brand_voice), extraction.brand_voice?.value, extraction.brand_voice?.source, existingConfidence.brand_voice, extraction.brand_voice?.confidence);
  const nameUpdate = updateScalarField(workingProfile.name, extraction.company_name?.value, extraction.company_name?.source, existingConfidence.company_name, extraction.company_name?.confidence);
  const websiteUpdate = {
    value: workingProfile.website_url ?? null,
    confidence: workingProfile.website_url ? 'High' : 'Low',
    questions: [],
  };
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
    if (entry.platform === 'pinterest' && !workingProfile.pinterest_url) workingProfile.pinterest_url = entry.url;
    if (entry.platform === 'whatsapp' && !workingProfile.whatsapp_url) workingProfile.whatsapp_url = entry.url;
    if (entry.platform === 'blog' && !workingProfile.blog_url) workingProfile.blog_url = entry.url;
  });

  const classificationInputProfile: CompanyProfile = {
    ...workingProfile,
    industry: industryUpdate.value.join(', ') || workingProfile.industry,
    category: categoryUpdate.value.join(', ') || workingProfile.category,
    products_services: productsUpdate.value.join(', ') || workingProfile.products_services,
    target_audience: audienceUpdate.value.join(', ') || workingProfile.target_audience,
    goals: goalsUpdate.value.join(', ') || workingProfile.goals,
    brand_voice: brandVoiceUpdate.value.join(', ') || workingProfile.brand_voice,
    unique_value: uniqueUpdate.value ?? workingProfile.unique_value,
    content_themes: themesUpdate.value.join(', ') || workingProfile.content_themes,
    industry_list: industryUpdate.value,
    category_list: categoryUpdate.value,
    products_services_list: productsUpdate.value,
    target_audience_list: audienceUpdate.value,
    goals_list: goalsUpdate.value,
    brand_voice_list: brandVoiceUpdate.value,
    content_themes_list: themesUpdate.value,
  };
  const businessClassification = classifyCompanyBusiness(classificationInputProfile, extraction);
  const cleanIndustryList = businessClassification.industry;
  const cleanCategory = businessClassification.category;
  const cleanCategoryList = [cleanCategory];
  const userIndustryBaseline =
    normalizeNonEmptyText(workingProfile.report_settings?.default_inputs?.industry) ??
    normalizeNonEmptyText(workingProfile.industry);
  const finalIndustryList = userIndustryBaseline
    ? normalizeStringArray([userIndustryBaseline])
    : cleanIndustryList;
  const industryReview = buildIndustryReview({
    userIndustry: userIndustryBaseline,
    aiIndustry: cleanIndustryList,
    existing: workingProfile.report_settings?.industry_review ?? null,
  });

  const extractionConfidence = computeConfidenceScore(extraction);
  const locked = new Set<string>(Array.isArray(workingProfile.user_locked_fields) ? workingProfile.user_locked_fields : []);
  const pick = <T>(refinedVal: T, workingVal: T, field: string): T =>
    locked.has(field) ? workingVal : (refinedVal ?? workingVal ?? null) as T;
  const contextForCompetitorFit = extractCompetitiveContextFromProfile(
    applyArchetypeContextToProfile({
      ...workingProfile,
      business_classification: businessClassification.business_classification,
      industry: finalIndustryList.join(', '),
      category: cleanCategory,
      geography: geographyUpdate.value.join(', ') || workingProfile.geography,
      products_services: productsUpdate.value.join(', ') || workingProfile.products_services,
      target_audience: audienceUpdate.value.join(', ') || workingProfile.target_audience,
      industry_list: finalIndustryList,
      category_list: cleanCategoryList,
      geography_list: geographyUpdate.value,
      products_services_list: productsUpdate.value,
      target_audience_list: audienceUpdate.value,
    }, entityArchetype),
  );
  let rankedCompetitors = await getFinalCompetitors({
    candidates: competitorDiscovery.candidates,
    context: contextForCompetitorFit,
    max: 8,
    minScore: 42,
    useNetwork: true,
    useStoredCache: false,
    companyId: workingProfile.company_id,
    includeMarketSubstitutes: true,
  });

  if (rankedCompetitors.length < 3 && competitorDiscovery.fallbackCandidates.length > 0) {
    const prioritizedFallbackCandidates = buildPrioritizedRefineFallbackCandidates({
      profile: workingProfile,
      extraction,
      discovery: competitorDiscovery,
    });
    const retryRankedCompetitors = await getFinalCompetitors({
      candidates: [
        ...competitorDiscovery.candidates,
        ...prioritizedFallbackCandidates,
        ...competitorDiscovery.fallbackCandidates,
      ],
      context: contextForCompetitorFit,
      max: 8,
      minScore: 42,
      useNetwork: false,
      useStoredCache: false,
      companyId: workingProfile.company_id,
      includeMarketSubstitutes: true,
    });
    if (retryRankedCompetitors.length > rankedCompetitors.length) rankedCompetitors = retryRankedCompetitors;
  }

  rankedCompetitors = rankedCompetitors.filter((competitor) => hasPassedFinalCompetitorGate(competitor, 42));

  if (rankedCompetitors.length < 3 && competitorDiscovery.fallbackCandidates.length > 0) {
    const prioritizedFallbackCandidates = buildPrioritizedRefineFallbackCandidates({
      profile: workingProfile,
      extraction,
      discovery: competitorDiscovery,
    });
    for (const recoveryContext of buildRefineRecoveryContexts({
      baseContext: contextForCompetitorFit,
      profile: workingProfile,
      extraction,
      discovery: competitorDiscovery,
    })) {
      const recoveryRankedCompetitors = (await getFinalCompetitors({
        candidates: [
          ...competitorDiscovery.candidates,
          ...prioritizedFallbackCandidates,
          ...competitorDiscovery.fallbackCandidates,
        ],
        context: recoveryContext,
        max: 8,
        minScore: 42,
        useNetwork: false,
        useStoredCache: false,
        companyId: workingProfile.company_id,
        includeMarketSubstitutes: true,
      })).filter((competitor) => hasPassedFinalCompetitorGate(competitor, 42));
      if (recoveryRankedCompetitors.length > rankedCompetitors.length) {
        rankedCompetitors = recoveryRankedCompetitors;
      }
      if (rankedCompetitors.length >= 3) break;
    }
  }

  if (rankedCompetitors.length === 0) {
    console.warn('[refine][competitor-final-gate-empty]', {
      keywords_generated: competitorDiscovery.keywords,
      serp_domains_found: competitorDiscovery.serpDomains.length,
      final_competitors_count: 0,
    });
  }

  if (rankedCompetitors.length > 0 && rankedCompetitors.length < 3) {
    console.warn('[refine][competitor-final-gate-below-target]', {
      keywords_generated: competitorDiscovery.keywords,
      serp_domains_found: competitorDiscovery.serpDomains.length,
      final_competitors_count: rankedCompetitors.length,
      target_competitors_count: 3,
    });
  }

  console.info('[refine][competitor-final-gate]', {
    keywords_generated: competitorDiscovery.keywords,
    serp_domains_found: competitorDiscovery.serpDomains.length,
    final_competitors_count: rankedCompetitors.length,
  });

  // Never let the profiled company's OWN domain — or the platform's own domain
  // (omnivyra.com) — surface as a "competitor" in the persisted first-load
  // scorecard. Shared with the read-time scrub in the company-profile GET.
  const rankedCompetitorsClean = rankedCompetitors.filter(
    (c) => !isSelfOrPlatformDomain(c.domain, workingProfile.website_url),
  );

  const splitCompetitorOutput = splitRankedCompetitorsForOutput(rankedCompetitorsClean, 8, 3);
  assertCompetitorOutputPartition(splitCompetitorOutput, 'refine_profile_competitor_output');
  const competitorValues = splitCompetitorOutput.competitors.map((item) => item.name);
  const competitorDetails = rankedCompetitorDetailsForProfile(rankedCompetitorsClean);
  const competitorIntelligence = rankedCompetitorIntelligenceForProfile(rankedCompetitorsClean);
  const competitorQuality = rankedCompetitorQualityForProfile(rankedCompetitorsClean);
  const marketAlternatives = rankedMarketAlternativesForProfile(rankedCompetitorsClean);
  const marketPulseWithAlternatives = marketPulseSettings || workingProfile.report_settings?.market_pulse
    ? {
        ...(workingProfile.report_settings?.market_pulse ?? {}),
        ...(marketPulseSettings ?? {}),
        business_model: businessClassification.business_classification.level_1,
        provider_type: businessClassification.business_classification.level_2,
        solution_domains: businessClassification.business_classification.level_3,
        competitor_details: competitorDetails,
        competitor_quality: competitorQuality,
        market_alternatives: marketAlternatives,
      }
    : null;

  const mergedSourceUrls = Array.from(
    new Set([...(workingProfile.source_urls || [])].map((url) => normalizeUrl(url)).filter((u): u is string => Boolean(u)))
  );

  const fieldConfidence = {
    company_name: nameUpdate.confidence, industry: industryReview?.conflict ? 'Needs Review' : 'High',
    category: 'High', business_classification: 'High', geography: geographyUpdate.confidence,
    competitors: competitorValues.length > 0 ? 'High' : 'Low', content_themes: themesUpdate.confidence,
    products_services: productsUpdate.confidence, target_audience: audienceUpdate.confidence,
    goals: goalsUpdate.confidence, brand_voice: brandVoiceUpdate.confidence,
    website_url: websiteUpdate.confidence, unique_value_proposition: uniqueUpdate.confidence,
  };

  console.log('MERGED PROFILE:', { industry_list: finalIndustryList, category_list: cleanCategoryList, business_classification: businessClassification.business_classification });
  console.info('Company profile extraction summary', {
    company_id: workingProfile.company_id,
    counts: {
      industry: finalIndustryList.length, category: cleanCategoryList.length,
      geography: geographyUpdate.value.length, social_profiles: mergedSocialProfiles.length,
    },
  });

  return {
    company_id: workingProfile.company_id,
    name: pick(nameUpdate.value, workingProfile.name, 'name'),
    industry: finalIndustryList.join(', '),
    category: cleanCategory,
    business_classification: businessClassification.business_classification,
    website_url: workingProfile.website_url ?? null,
    linkedin_url: workingProfile.linkedin_url ?? null,
    facebook_url: workingProfile.facebook_url ?? null,
    instagram_url: workingProfile.instagram_url ?? null,
    x_url: workingProfile.x_url ?? null,
    youtube_url: workingProfile.youtube_url ?? null,
    tiktok_url: workingProfile.tiktok_url ?? null,
    reddit_url: workingProfile.reddit_url ?? null,
    pinterest_url: workingProfile.pinterest_url ?? null,
    whatsapp_url: workingProfile.whatsapp_url ?? null,
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
    industry_list: finalIndustryList,
    category_list: cleanCategoryList,
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
      entity_archetype: entityArchetype ?? workingProfile.report_settings?.entity_archetype ?? null,
      competitor_intelligence: competitorIntelligence.length > 0 ? competitorIntelligence : workingProfile.report_settings?.competitor_intelligence ?? null,
      industry_review: industryReview,
      market_pulse: marketPulseWithAlternatives,
    },
  };
}

export async function refineProfileWithAI(
  profile: CompanyProfile,
  options?: { force?: boolean; manualRefresh?: boolean }
): Promise<CompanyProfile> {
  const result = await runProfileRefinement(profile, options);
  return result.profile;
}

export async function refineProfileWithAIWithDetails(
  profile: CompanyProfile,
  options?: { force?: boolean; manualRefresh?: boolean }
): Promise<{ profile: CompanyProfile; details: CompanyProfileRefinementDetails }> {
  return runProfileRefinement(profile, options);
}



