/** Company profile — discovery, archetype peers, refine flows — split from companyProfileServiceRest1.ts (barrel preserved; importers unchanged). */
/** TEMP1 — split from companyProfileService.ts (barrel preserved; importers unchanged). */
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

import { storedCompetitorNames } from './companyProfileServiceRest1Rest2';

function buildNamedArchetypePeerCandidates(
  profile: CompanyProfile,
  archetype?: EntityArchetypeIntelligence | null,
): CompetitorCandidate[] {
  if (!isArchetypeInfluential(archetype) || isBusinessFirstOnlyArchetype(archetype)) return [];
  const values = new Set(archetypeValues(archetype));
  const topic = profileTopicLabel(profile, archetype).toLowerCase();
  const audience = profileAudienceLabel(profile, archetype).toLowerCase();
  const selected = ARCHETYPE_NAMED_PEER_PACKS.filter((entry) =>
    entry.values.some((value) => values.has(value)) ||
    entry.productSignals.some((signal) => topic.includes(signal.toLowerCase()) || audience.includes(signal.toLowerCase()))
  ).slice(0, 5);

  return selected.map((entry) => archetypeCandidate({
    name: entry.name,
    category: entry.category,
    description: entry.description,
    profile,
    archetype,
    classification: entry.values.includes(archetype.primary_archetype) ? 'direct_competitor' : 'authority_leader',
    productSignals: entry.productSignals,
  }));
}

function buildArchetypeNativeCompetitorCandidates(
  profile: CompanyProfile,
  archetype?: EntityArchetypeIntelligence | null,
): CompetitorCandidate[] {
  if (!isArchetypeInfluential(archetype) || isBusinessFirstOnlyArchetype(archetype)) return [];
  const values = archetypeValues(archetype);
  const topic = profileTopicLabel(profile, archetype);
  const audience = profileAudienceLabel(profile, archetype);
  const candidates: CompetitorCandidate[] = [];
  const add = (candidate: CompetitorCandidate) => {
    const key = candidate.name.toLowerCase();
    if (!candidates.some((existing) => existing.name.toLowerCase() === key)) candidates.push(candidate);
  };

  if (values.includes('MEDIA_NEWSLETTER')) {
    add(archetypeCandidate({
      name: `${topic} newsletters and publications`,
      category: 'Newsletter and publication peers',
      description: `Newsletters, publications, and podcasts serving ${audience} with similar editorial territory, trust model, and publishing cadence.`,
      profile,
      archetype,
      classification: 'direct_competitor',
      productSignals: ['newsletter', 'publication', 'readers', 'subscribers', 'editorial cadence'],
    }));
  }
  if (values.includes('MEDIA_NEWSLETTER')) {
    add(archetypeCandidate({
      name: `${topic} Substack and podcast peers`,
      category: 'Platform-native media peers',
      description: `Substack publications, podcasts, and platform-native media operators competing for ${audience}'s recurring attention and trust.`,
      profile,
      archetype,
      classification: 'seo_competitor',
      productSignals: ['substack', 'podcast', 'platform-native media', 'publication'],
    }));
  }
  if (values.includes('CREATOR_EDUCATOR')) {
    add(archetypeCandidate({
      name: `${topic} creator educators and course communities`,
      category: 'Creator education peers',
      description: `Creator-led education businesses, courses, workshops, and learning communities competing for ${audience}'s trust and learning budget.`,
      profile,
      archetype,
      classification: 'direct_competitor',
      productSignals: ['creator educator', 'courses', 'workshops', 'learning community'],
    }));
    add(archetypeCandidate({
      name: `${topic} YouTube and LinkedIn educators`,
      category: 'Platform-native creator peers',
      description: `YouTube educators, LinkedIn creators, and platform-native teachers competing for ${audience}'s attention, trust, and learning intent.`,
      profile,
      archetype,
      classification: 'seo_competitor',
      productSignals: ['youtube educator', 'linkedin creator', 'platform-native creator', 'courses'],
    }));
  }
  if (values.includes('THOUGHT_LEADER')) {
    add(archetypeCandidate({
      name: `${topic} authors, speakers, and thesis-led educators`,
      category: 'Thought-leader peers',
      description: `Authors, speakers, and thesis-led educators competing through worldview, authority, frameworks, and leadership narrative.`,
      profile,
      archetype,
      classification: 'authority_leader',
      productSignals: ['author', 'speaker', 'worldview', 'frameworks', 'authority'],
    }));
  }
  if (values.includes('COMMUNITY_LED')) {
    add(archetypeCandidate({
      name: `${topic} membership communities`,
      category: 'Community and membership peers',
      description: `Membership communities, expert networks, and audience-led groups competing for belonging, access, trust, and recurring participation.`,
      profile,
      archetype,
      classification: 'seo_competitor',
      productSignals: ['membership', 'community', 'network', 'access'],
    }));
  }
  if (values.includes('CONSULTANT_OPERATOR') || values.includes('PERSONAL_BRAND')) {
    add(archetypeCandidate({
      name: `${topic} operator-creators and public builders`,
      category: 'Operator creator peers',
      description: `Operator-creators, public builders, and advisor-writers competing through lived operating experience, public documentation, and trusted expertise.`,
      profile,
      archetype,
      classification: 'authority_leader',
      productSignals: ['operator creator', 'public building', 'advisory', 'systems thinking'],
    }));
  }
  if (values.includes('HYBRID_ENTITY')) {
    add(archetypeCandidate({
      name: `${topic} hybrid audience-led businesses`,
      category: 'Hybrid business and audience peers',
      description: `Businesses blending commercial offers with media, education, community, authority, or founder-led audience trust.`,
      profile,
      archetype,
      classification: 'direct_competitor',
      productSignals: ['hybrid entity', 'audience-led business', 'commercial offer', 'trust substitute'],
    }));
  }

  for (const namedCandidate of buildNamedArchetypePeerCandidates(profile, archetype)) add(namedCandidate);

  return candidates.slice(0, 12);
}

export function applyArchetypeContextToProfile(
  profile: CompanyProfile,
  archetype?: EntityArchetypeIntelligence | null,
): CompanyProfile {
  if (!isArchetypeInfluential(archetype)) {
    return {
      ...profile,
      report_settings: {
        ...(profile.report_settings ?? {}),
        entity_archetype: archetype ?? profile.report_settings?.entity_archetype ?? null,
      },
    };
  }

  const audienceLed = isAudienceLedArchetype(archetype);
  if (isBusinessFirstOnlyArchetype(archetype)) {
    return {
      ...profile,
      report_settings: {
        ...(profile.report_settings ?? {}),
        entity_archetype: archetype,
      },
    };
  }
  const valueSurface = archetype.primary_value_surface || null;
  const audienceRelationship = archetype.audience_relationship || null;
  const commercialMode = archetype.commercial_mode || null;
  const archetypePositioning = [
    archetype.primary_archetype,
    valueSurface,
    audienceRelationship,
  ].filter(Boolean).join('; ');

  if (!audienceLed) {
    return {
      ...profile,
      brand_positioning: [profile.brand_positioning, archetypePositioning]
        .filter(Boolean)
        .join('; ') || profile.brand_positioning,
      report_settings: {
        ...(profile.report_settings ?? {}),
        entity_archetype: archetype,
      },
    };
  }

  return {
    ...profile,
    products_services: profile.products_services || valueSurface || undefined,
    products_services_list: profile.products_services_list?.length
      ? profile.products_services_list
      : valueSurface ? [valueSurface] : profile.products_services_list,
    target_audience: profile.target_audience || audienceRelationship || undefined,
    target_audience_list: profile.target_audience_list?.length
      ? profile.target_audience_list
      : audienceRelationship ? [audienceRelationship] : profile.target_audience_list,
    category: profile.category || archetype.primary_archetype.toLowerCase().replace(/_/g, ' '),
    campaign_focus: profile.campaign_focus || valueSurface || undefined,
    brand_positioning: [profile.brand_positioning, archetypePositioning]
      .filter(Boolean)
      .join('; ') || profile.brand_positioning,
    sales_motion: profile.sales_motion || commercialMode || undefined,
    report_settings: {
      ...(profile.report_settings ?? {}),
      entity_archetype: archetype,
    },
  };
}

export function competitorValidationContextForProfile(profile: CompanyProfile): CompanyCompetitiveContext {
  const baseContext = extractCompetitiveContextFromProfile(profile);
  const signalText = profileDiscoverySignalText(profile);
  const matchedCategory = matchingRefineCategoryProfiles(signalText)[0];
  if (matchedCategory) return { ...baseContext, ...matchedCategory.context };
  return baseContext;
}

function refineDiscoverySignalText(
  profile: CompanyProfile,
  extraction: CompanyProfileExtractionOutput,
  discovery: RefineCompetitorDiscovery,
): string {
  return [
    profileDiscoverySignalText(profile, discovery.keywords),
    extraction.industry?.value,
    extraction.category?.value,
    extraction.products_services?.value,
    extraction.target_audience?.value,
    extraction.goals?.value,
    extraction.content_themes?.value,
    extraction.brand_voice?.value,
    extraction.unique_value_proposition?.value,
    ...discovery.keywords,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function buildRefineRecoveryContexts(params: {
  baseContext: CompanyCompetitiveContext;
  profile: CompanyProfile;
  extraction: CompanyProfileExtractionOutput;
  discovery: RefineCompetitorDiscovery;
}): CompanyCompetitiveContext[] {
  const signalText = refineDiscoverySignalText(params.profile, params.extraction, params.discovery);
  const contexts: CompanyCompetitiveContext[] = [];
  const pushContext = (context: CompanyCompetitiveContext) => {
    const key = [
      context.marketFocus,
      context.primaryService,
      context.targetCustomer,
      context.idealCustomerProfile,
      context.brandPositioning,
      context.businessModel,
    ].filter(Boolean).join('|').toLowerCase();
    if (!key || contexts.some((existing) => [
      existing.marketFocus,
      existing.primaryService,
      existing.targetCustomer,
      existing.idealCustomerProfile,
      existing.brandPositioning,
      existing.businessModel,
    ].filter(Boolean).join('|').toLowerCase() === key)) return;
    contexts.push(context);
  };

  pushContext({
    ...params.baseContext,
    marketFocus: [params.baseContext.marketFocus, ...params.discovery.keywords].filter(Boolean).join(', '),
    primaryService: params.baseContext.primaryService ?? params.discovery.keywords[0] ?? null,
    brandPositioning: params.baseContext.brandPositioning ?? params.profile.unique_value ?? null,
  });

  matchingRefineCategoryProfiles(signalText).forEach((categoryProfile) => {
    pushContext({ ...params.baseContext, ...categoryProfile.context });
  });

  return contexts;
}

export function buildPrioritizedRefineFallbackCandidates(params: {
  profile: CompanyProfile;
  extraction: CompanyProfileExtractionOutput;
  discovery: RefineCompetitorDiscovery;
}): CompetitorCandidate[] {
  const signalText = refineDiscoverySignalText(params.profile, params.extraction, params.discovery);
  return prioritizedKnownDatasetCompetitorCandidatesForSignal(signalText, params.profile.geography ?? null);
}

export async function discoverRefineCompetitorCandidates(
  profile: CompanyProfile,
): Promise<RefineCompetitorDiscovery> {
  const archetype = profile.report_settings?.entity_archetype ?? null;
  const storedCompetitorCandidates = buildCandidatesFromNames(
    storedCompetitorNames(profile),
    'profile_ai',
  );
  const archetypeSeeds = buildArchetypeNativeDiscoverySeeds(profile, archetype);
  const keywords = ensureMinimumDiscoveryKeywords(profile, [
    ...archetypeSeeds,
    ...generateDiscoveryKeywords(profile),
  ]);
  const archetypeCandidates = buildArchetypeNativeCompetitorCandidates(profile, archetype);
  const ownDomain =
    normalizeCompetitorDiscoveryDomain(profile.website_url)
    ?? normalizeCompetitorDiscoveryDomain(profile.name)
    ?? 'current-company.local';
  const initialDiscovery = await discoverCompetitorDomainsFromSerp({
    keywords,
    ownDomain,
    geography: profile.geography ?? null,
  });
  let serpDomains = initialDiscovery.domains;

  if (serpDomains.length === 0) {
    const retryKeywords = expandRefineDiscoveryKeywords(profile, keywords);
    const retryDiscovery = await discoverCompetitorDomainsFromSerp({
      keywords: retryKeywords,
      ownDomain,
      geography: profile.geography ?? null,
    });
    serpDomains = retryDiscovery.domains;
  }

  const serpCandidates = serpDomains.map((domain, index) => ({
    name: domainToName(domain),
    domain,
    source: 'serp_live' as const,
    classification: index === 0 ? 'direct_competitor' as const : index === 1 ? 'seo_competitor' as const : 'authority_leader' as const,
    rationale: 'Discovered through refine SERP competitor discovery.',
  }));
  const prioritizedFallbackCandidates = prioritizedKnownDatasetCompetitorCandidatesForSignal(
    profileDiscoverySignalText(profile, keywords),
    profile.geography ?? null,
  );
  const fallbackCandidates = prioritizedFallbackCandidates.length > 0
    ? prioritizedFallbackCandidates
    : knownDatasetCompetitorCandidates(profile.geography ?? null);
  const candidates = applyUserGuidedCompetitorSteering(profile, dedupeCompetitorCandidates([
    ...storedCompetitorCandidates,
    ...archetypeCandidates,
    ...(serpCandidates.length > 0 ? serpCandidates : fallbackCandidates),
  ]));
  const fallbackWithArchetype = applyUserGuidedCompetitorSteering(profile, dedupeCompetitorCandidates([
    ...storedCompetitorCandidates,
    ...archetypeCandidates,
    ...fallbackCandidates,
  ]));

  console.info('[refine][competitor-discovery]', {
    keywords_generated: keywords,
    archetype_keywords_generated: archetypeSeeds,
    stored_competitors: storedCompetitorCandidates.map((candidate) => candidate.name),
    archetype_candidates_generated: archetypeCandidates.map((candidate) => candidate.name),
    user_guided_competitors: profile.report_settings?.user_guidance?.competitors?.length ?? 0,
    serp_domains_found: serpDomains.length,
    final_candidates_count: candidates.length,
    fallback_used: serpCandidates.length === 0,
    fallback_scope: prioritizedFallbackCandidates.length > 0 ? 'category_specific' : 'broad_known_dataset',
  });

  return {
    candidates,
    fallbackCandidates: fallbackWithArchetype,
    keywords,
    serpDomains,
  };
}

export function inferBusinessModelLabel(input: {
  category?: string | null;
  industry?: string | null;
  productsServices?: string[] | null;
  uniqueValue?: string | null;
  brandPositioning?: string | null;
  contentThemes?: string[] | null;
  websiteUrl?: string | null;
}): string | null {
  const text = [
    input.category,
    input.industry,
    ...(input.productsServices ?? []),
    input.uniqueValue,
    input.brandPositioning,
    ...(input.contentThemes ?? []),
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

export type CompanyDomainShape = {
  provider_type: string | null;
  domain_role: string | null;
  operating_model: string | null;
  solution_domains: string[];
};

type CompanyDomainShapeInput = {
  category?: string | null;
  industry?: string | null;
  productsServices?: string[] | null;
  goals?: string[] | null;
  contentThemes?: string[] | null;
  targetAudience?: string[] | null;
  uniqueValue?: string | null;
  brandPositioning?: string | null;
  campaignFocus?: string | null;
  coreProblem?: string | null;
  painSymptoms?: string[] | null;
  authorityDomains?: string[] | null;
  websiteUrl?: string | null;
};

export function textFromValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => normalizeNonEmptyText(item))
      .filter((item): item is string => Boolean(item))
      .join(', ');
    return normalizeNonEmptyText(joined);
  }
  return normalizeNonEmptyText(value);
}

export function normalizeFieldValueList(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeStringArray(value);
  const text = textFromValue(value);
  if (!text) return [];
  const split = splitToList(text);
  return split.length > 1 ? split : [text];
}

function inferSolutionDomainsFromText(text: string, fallbackCategory?: string | null): string[] {
  const domains = new Set<string>();
  const add = (pattern: RegExp, label: string) => {
    if (pattern.test(text)) domains.add(label);
  };

  add(/\bmental\s+clarity\b|\bclarity\b|\bfocus\b|\bmindfulness\b/, 'mental clarity');
  add(/\bdecision[-\s]?making\b|\bdecision\b|\bdirection\b|\bguidance\b|\bchoice\b|\bchoices\b/, 'decision support');
  add(/\bself[-\s]?reflection\b|\breflect(ion|ive|ly)?\b|\bjournal(ing)?\b|\bintrospection\b/, 'self-reflection');
  add(/\bmental\s+(health|wellness|wellbeing)\b|\btherapy\b|\btherapeutic\b|\banxiety\b|\bstress\b|\bemotional\b|\bwellness\b/, 'mental wellness');
  add(/\bpersonal\s+growth\b|\bgrowth\b|\bself[-\s]?improvement\b|\bhabits?\b/, 'personal growth');
  add(/\bcareer\b|\bstudent\b|\bprofessionals?\b|\blife\s+direction\b/, 'career and life guidance');
  add(/\bcrm\b|\bsales\b|\blead\b|\bpipeline\b|\brevenue\b/, 'sales and CRM automation');
  add(/\bmarketing\b|\bcampaign\b|\bseo\b|\bcontent\b|\bbrand\b|\bvisibility\b|\bdemand\b/, 'marketing growth');
  add(/\bcustomer\s+engagement\b|\bengagement\b|\bretention\b|\blifecycle\b/, 'customer engagement');
  add(/\bconsult(ant|ants|ing|ancy)?\b|\badvisory\b|\badvisor\b|\bexpert[-\s]?led\b/, 'consulting and advisory');
  add(/\bpayments?\b|\bfintech\b|\bbilling\b|\bcheckout\b/, 'payments and fintech');
  add(/\bcommerce\b|\becommerce\b|\bretail\b|\bstore\b/, 'commerce');

  if (domains.size === 0) {
    const fallback = normalizeNonEmptyText(fallbackCategory);
    if (fallback) domains.add(fallback);
  }

  return Array.from(domains).slice(0, 6);
}

export function inferCompanyDomainShape(input: CompanyDomainShapeInput): CompanyDomainShape {
  const signalText = [
    input.category,
    input.industry,
    ...(input.productsServices ?? []),
    ...(input.goals ?? []),
    ...(input.contentThemes ?? []),
    ...(input.targetAudience ?? []),
    input.uniqueValue,
    input.brandPositioning,
    input.campaignFocus,
    input.coreProblem,
    ...(input.painSymptoms ?? []),
    ...(input.authorityDomains ?? []),
    input.websiteUrl,
  ]
    .map((value) => normalizeNonEmptyText(value))
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  if (!signalText) {
    return {
      provider_type: null,
      domain_role: null,
      operating_model: null,
      solution_domains: [],
    };
  }

  const hasAi = /\b(ai|artificial intelligence|machine learning|ml|llm|chatbot|assistant|automation|personalized|personalised)\b/.test(signalText);
  const hasConsulting = /\bconsult(ant|ants|ing|ancy)?\b|\badvisory\b|\badvisor\b|\bagency\b|\bexpert[-\s]?led\b/.test(signalText);
  const hasMarketplace = /\bmarketplace\b/.test(signalText);
  const hasCommerce = /\becommerce\b|\bcommerce\b|\bstore\b|\bretail\b/.test(signalText);
  const hasManufacturing = /\bmanufacturer\b|\bmanufacturing\b|\bhardware\b|\bvehicle\b|\bapparel\b|\bfootwear\b/.test(signalText);
  const hasSoftware = /\bsaas\b|\bsoftware\b|\bplatform\b|\bapp\b|\btool\b|\bproduct\b|\bdigital\b/.test(signalText);
  const solutionDomains = inferSolutionDomainsFromText(signalText, input.category);

  let providerType: string | null = null;
  let operatingModel: string | null = null;
  let domainRole: string | null = null;

  if (hasConsulting) {
    providerType = 'Consulting and advisory provider';
    operatingModel = 'Consulting/advisory service';
    domainRole = 'Consulting problem-solution provider';
  } else if (hasAi) {
    providerType = 'AI-powered solution provider';
    operatingModel = hasSoftware ? 'AI software platform' : 'AI-enabled service';
    domainRole = 'AI-powered problem-solution provider';
  } else if (hasMarketplace) {
    providerType = 'Marketplace operator';
    operatingModel = 'Marketplace';
    domainRole = 'Marketplace solution provider';
  } else if (hasCommerce) {
    providerType = 'Commerce operator';
    operatingModel = 'Commerce';
    domainRole = 'Commerce solution provider';
  } else if (hasManufacturing) {
    providerType = 'Product manufacturer';
    operatingModel = 'Manufacturing/product business';
    domainRole = 'Product solution provider';
  } else if (hasSoftware) {
    providerType = 'Software platform provider';
    operatingModel = 'Software platform';
    domainRole = 'Software solution provider';
  } else if (/\bservice(s)?\b|\bsupport\b|\bsolution(s)?\b/.test(signalText)) {
    providerType = 'Service provider';
    operatingModel = 'Service delivery';
    domainRole = 'Service solution provider';
  }

  return {
    provider_type: providerType,
    domain_role: domainRole,
    operating_model: operatingModel,
    solution_domains: solutionDomains,
  };
}

export function inferPartnershipPriorities(input: {
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

export function inferCriticalHiringFunctions(input: {
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

export function inferRegulatoryPolicySensitivity(input: {
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

export function inferMarketPulseCategories(input: {
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

export function withExistingList(existing: string[] | null | undefined, next: string[]): string[] | null {
  const normalizedExisting = normalizeStringArray(existing);
  if (normalizedExisting.length > 0) return normalizedExisting;
  return next.length > 0 ? next : null;
}

export function withExistingText(existing: string | null | undefined, next: string | null): string | null {
  return normalizeNonEmptyText(existing) ?? next ?? null;
}

function normalizeIndustryReviewKey(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildIndustryReview(params: {
  userIndustry?: string | null;
  aiIndustry: string[];
  existing?: NonNullable<NonNullable<CompanyProfile['report_settings']>['industry_review']> | null;
}): NonNullable<NonNullable<CompanyProfile['report_settings']>['industry_review']> | null {
  const userIndustry = normalizeNonEmptyText(params.userIndustry);
  const aiIndustry = normalizeStringArray(params.aiIndustry).join(', ');
  if (!userIndustry || !aiIndustry) return params.existing ?? null;
  const userTokens = new Set(normalizeIndustryReviewKey(userIndustry).split(' ').filter((token) => token.length > 2));
  const aiTokens = normalizeIndustryReviewKey(aiIndustry).split(' ').filter((token) => token.length > 2);
  const hasOverlap = aiTokens.some((token) => userTokens.has(token));
  return {
    ...(params.existing ?? {}),
    conflict: !hasOverlap,
    user_industry: userIndustry,
    ai_suggested_industry: aiIndustry,
    source: 'website_social_refinement',
    updated_at: new Date().toISOString(),
  };
}

export function rankedMarketAlternativesForProfile(competitors: RankedCompetitor[]) {
  return splitRankedCompetitorsForOutput(competitors, 8, 3).market_alternatives.map((competitor) => ({
    name: competitor.name,
    domain: competitor.domain,
    category: competitor.category,
    tier: competitor.tier,
    score: competitor.final_score,
    confidence: competitor.enrichment_confidence_score,
    rationale: competitor.rationale,
    use_case: competitor.enrichment?.icp?.use_case ?? competitor.fit_signals?.product_service ?? null,
    business_model: competitor.enrichment?.business_model ?? competitor.fit_signals?.business_model ?? null,
  }));
}

export function rankedCompetitorDetailsForProfile(competitors: RankedCompetitor[]) {
  return splitRankedCompetitorsForOutput(competitors, 8, 3).competitors.map((competitor) => ({
    name: competitor.name,
    domain: competitor.domain,
    category: competitor.category,
    tier: competitor.tier,
    score: competitor.relevance_score,
    confidence: competitor.enrichment_confidence_score,
    rationale: competitor.rationale,
  }));
}

