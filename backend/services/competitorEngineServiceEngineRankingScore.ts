/** Competitor engine — scoring + rationale (fn-level cycle with Final: deferred calls, runtime-safe) — split from competitorEngineServiceEngineRanking.ts (barrel preserved; importers unchanged). */
/** Competitor engine — scoring, ranking, entrypoints — split from competitorEngineServiceEngine.ts (barrel preserved; importers unchanged). */
/** TEMP — split from competitorEngineService.ts (barrel preserved; importers unchanged). */
import type { CompanyProfile } from './companyProfile/types';
import type {
  CompetitorCategory as NormalizedCompetitorCategory,
  CompetitorCapabilityVector,
  CompetitorDimensionScores,
  CompetitorDiscoverySource,
  CompetitorIntelligenceTier,
  CompetitorScoreCard,
  DebugCompetitorScoring,
} from '../../types/competitor';
import { isAudienceLedArchetype, isArchetypeInfluential, isBusinessFirstOnlyArchetype } from './companyProfile/entityArchetype';
import type { EntityArchetypeIntelligence } from './companyProfile/types';
import type { ResolvedReportInput } from './reportInputResolver';
import {
  enrichCompetitorCandidateSync,
  enrichCompetitorCandidates,
} from './competitorEnrichmentService';
import type {
  CompetitorEnrichmentProfile,
  CompetitorProductType,
  CompetitorScaleSignals,
} from './competitorEnrichmentKnowledge';
import { findKnownCompetitorProfile } from './competitorEnrichmentKnowledge';
import {
  categoryAffinity,
  normalizeCompetitorCategory,
  normalizeCompetitorTags,
  type CompetitorSecondaryTag,
  type StandardCompetitorCategory,
} from './competitorTaxonomy';
import {
  applyCompetitorFeedbackBoost,
  buildFeedbackMissingCompetitorCandidates,
  getCompetitorFeedbackDecision,
  loadCompetitorFeedbackMemory,
  type CompetitorFeedbackMemory,
} from './competitorFeedbackService';

import { type CompetitorSource, type CompetitorClassification, type CompetitorTier, type CompetitorThreatLevel, type CompetitorPositioning, type CompanyCompetitiveContext, type CompetitorCandidate, type RankedCompetitor, type ScoredCompetitor, type CompetitorScoreBreakdown, TRUSTED_SOURCES, FINAL_COMPETITOR_MIN_SCORE, MARKET_SUBSTITUTE_MAX_COUNT, FINAL_COMPETITOR_MIN_PROBLEM_OVERLAP, FINAL_COMPETITOR_MIN_ICP_OVERLAP, FINAL_COMPETITOR_MIN_FINAL_SCORE, FINAL_COMPETITOR_MIN_ENRICHMENT_CONFIDENCE, FINAL_COMPETITOR_MIN_COUNT, FINAL_COMPETITOR_MAX_COUNT, HIGH_AUTHORITY_MISMATCH_AUTHORITY, HIGH_AUTHORITY_MISMATCH_PROBLEM, FINAL_BLOCKED_SOURCES, TIER_PRIORITY, COMPANY_SUFFIX_PATTERN, UNRELATED_COMPETITOR_TEXT_PATTERN, AI_FEATURE_TOKENS, DELIVERY_MODEL_TOKENS, cleanText, firstFromList, splitToList, normalizeCompetitorDomain, domainToName, tokenizeCompetitorText, overlapRatio, boostedOverlapRatio, roundDimension, inferSegment, classifyRevenueTier, revenueAdjustment, toPercentScore, competitorIntelligenceTier, weightedCompetitorScore, buildCompanyCapabilityVector, buildCandidateCapabilityVector, capabilityVectorOverlap, discoverySourceFromCandidate, candidateDiscoverySources, employeeScaleFitForCandidate, classifyNormalizedCompetitorCategory, MEDIA_CONTENT_BRAND_SIGNALS, classifyProductFirstCompetition, competitorReasoning, failedCompetitorDimensions, computeCompetitorAuthorityScore, candidateSignalText, inferCompetitorIntelligence, competitorIntelligenceText, includesAnyToken, contextLabel } from './competitorEngineServiceModel';

import { buildCompetitorPositioning, inferCompetitorArchetypeCandidates, withArchetypeEnrichment, contextTokens, extractCompetitiveContextFromProfile, buildCompetitorFitSignals } from './competitorEngineServiceEngineDiscovery';

import { hasArchetypeNativePeerEvidence, hasArchetypeNativeContextEvidence, getFinalCompetitorsSync } from './competitorEngineServiceEngineRankingFinal';

export function buildCompetitorFitRationale(
  context: CompanyCompetitiveContext,
  geography: string | null,
  fallback: string,
): string {
  const parts: string[] = [];
  if (context.marketFocus) parts.push(`market focus: ${context.marketFocus}`);
  if (context.primaryService) parts.push(`product/service: ${context.primaryService}`);
  if (context.targetCustomer) parts.push(`buyer fit: ${context.targetCustomer}`);
  if (geography ?? context.geography) parts.push(`region: ${geography ?? context.geography}`);
  if (context.teamSize) parts.push(`team size: ${context.teamSize}`);
  if (context.revenueRange) parts.push(`revenue: ${context.revenueRange}`);
  return parts.length > 0 ? `${fallback} Fit signals used: ${parts.slice(0, 5).join('; ')}.` : fallback;
}

function buildScoringRationale(
  base: string,
  breakdown: CompetitorScoreBreakdown,
): string {
  return [
    base,
    `Competitive scoring: normalized category ${breakdown.score_card.category}, category ${breakdown.category}, tags ${breakdown.tags.join(', ') || 'none'}, product/service ${breakdown.score_card.dimensions.productServiceFit}, workflow ${breakdown.score_card.dimensions.workflowFit}, ICP ${breakdown.score_card.dimensions.icpFit}, customer evaluation ${breakdown.score_card.dimensions.customerEvaluationFit}, use case ${breakdown.score_card.dimensions.useCaseFit}, revenue scale ${breakdown.score_card.dimensions.revenueScaleFit}, employee scale ${breakdown.score_card.dimensions.employeeScaleFit}, geography ${breakdown.score_card.dimensions.geographyFit}, SEO intent ${breakdown.score_card.dimensions.seoIntentFit}; weighted score ${breakdown.score_card.overallScore} (${breakdown.tier}).`,
  ].join(' ');
}

function classifyCompetitiveTier(params: {
  problemOverlap: number;
  icpOverlap: number;
  affinity: 'same' | 'functional' | 'substitute';
}): CompetitorTier {
  if (params.affinity === 'same' && params.problemOverlap >= 0.6 && params.icpOverlap >= 0.5) return 'Tier 1';
  if (params.problemOverlap >= 0.45 && params.affinity !== 'substitute') return 'Tier 2';
  if (params.problemOverlap >= 0.55) return 'Tier 2';
  return 'Tier 3';
}

function classificationFromTier(tier: CompetitorTier): CompetitorClassification {
  if (tier === 'Tier 1') return 'direct_competitor';
  if (tier === 'Tier 2') return 'seo_competitor';
  return 'authority_leader';
}

export function isAuthorityDominatedMismatch(competitor: {
  authority_score?: number | null;
  problem_overlap?: number | null;
  icp_overlap?: number | null;
}): boolean {
  return (
    Number(competitor.authority_score ?? 0) > HIGH_AUTHORITY_MISMATCH_AUTHORITY &&
    Number(competitor.problem_overlap ?? 0) < HIGH_AUTHORITY_MISMATCH_PROBLEM
  );
}

function sourceEvidenceBoost(source: CompetitorSource): number {
  if (source === 'manual' || source === 'user') return 0.55;
  if (source === 'website' || source === 'social') return 0.45;
  if (source === 'serp_live' || source === 'known_category_dataset') return 0.35;
  if (source === 'market_substitute') return 0.35;
  if (source === 'archetype_native_peer') return 0.32;
  return 0;
}

export function evaluateCompetitorCandidate(
  candidate: CompetitorCandidate,
  context: CompanyCompetitiveContext,
): CompetitorScoreBreakdown {
  const enrichedCandidate = enrichCompetitorCandidateSync(candidate);
  const companyCategory = normalizeCompetitorCategory(context.marketFocus, [
    context.primaryService,
    context.targetCustomer,
    context.idealCustomerProfile,
    context.brandPositioning,
    context.businessModel,
  ].filter(Boolean).join(' '));
  const competitorCategory = normalizeCompetitorCategory(enrichedCandidate.category, candidateSignalText(enrichedCandidate, null));
  const affinity = categoryAffinity(companyCategory, competitorCategory);
  const domain = normalizeCompetitorDomain(enrichedCandidate.domain ?? enrichedCandidate.name);
  const candidateTokens = tokenizeCompetitorText(candidateSignalText(enrichedCandidate, domain));
  const tokens = contextTokens(context);
  const evidenceBoost = sourceEvidenceBoost(enrichedCandidate.source);
  const companyRevenueTier = classifyRevenueTier(context.revenueRange);
  const competitorRevenueTier = classifyRevenueTier(enrichedCandidate.revenueRange ?? context.revenueRange);

  const productOverlap = boostedOverlapRatio(candidateTokens, tokens.product, evidenceBoost);
  const marketFocusOverlap = boostedOverlapRatio(candidateTokens, tokens.market, Math.max(0.25, evidenceBoost - 0.1));
  const targetOverlap = boostedOverlapRatio(candidateTokens, tokens.target, Math.max(0.2, evidenceBoost - 0.15));
  const intentOverlap = overlapRatio(candidateTokens, tokens.intent);
  const geographyOverlap = tokens.geography.length > 0
    ? boostedOverlapRatio(candidateTokens, tokens.geography, enrichedCandidate.geography ? 0.55 : 0)
    : 0.45;
  const companySegment = inferSegment([context.targetCustomer, context.businessModel, context.marketFocus].filter(Boolean).join(' '));
  const competitorSegment = inferSegment([
    enrichedCandidate.targetCustomer,
    enrichedCandidate.businessModel,
    enrichedCandidate.description,
    enrichedCandidate.category,
    enrichedCandidate.name,
  ].filter(Boolean).join(' '));
  const segmentOverlap = companySegment && competitorSegment ? (companySegment === competitorSegment ? 1 : 0.25) : 0.45;
  const aiDepth = candidateTokens.filter((token) => AI_FEATURE_TOKENS.has(token)).length;
  const deliveryDepth = candidateTokens.filter((token) => DELIVERY_MODEL_TOKENS.has(token)).length;
  const featureDepth = Math.min(1, ((aiDepth * 0.18) + (deliveryDepth * 0.12) + (enrichedCandidate.productSignals?.length ?? 0) * 0.08) + evidenceBoost * 0.4);

  let problemOverlap = roundDimension(
    (Math.max(productOverlap, marketFocusOverlap) * 0.75) +
    (Math.min(productOverlap, marketFocusOverlap) * 0.25),
  );
  let icpOverlap = roundDimension((targetOverlap * 0.7) + (intentOverlap * 0.3));
  if (affinity === 'same') {
    problemOverlap = roundDimension(Math.max(problemOverlap, 0.68));
    icpOverlap = roundDimension(Math.max(icpOverlap, 0.58));
  } else if (affinity === 'functional') {
    problemOverlap = roundDimension(Math.max(problemOverlap, 0.58));
    icpOverlap = roundDimension(Math.max(icpOverlap, FINAL_COMPETITOR_MIN_ICP_OVERLAP));
  }
  if (
    enrichedCandidate.source === 'archetype_native_peer' &&
    hasArchetypeNativePeerEvidence(candidateSignalText(enrichedCandidate, domain)) &&
    hasArchetypeNativeContextEvidence(context)
  ) {
    problemOverlap = roundDimension(Math.max(problemOverlap, FINAL_COMPETITOR_MIN_PROBLEM_OVERLAP));
    icpOverlap = roundDimension(Math.max(icpOverlap, FINAL_COMPETITOR_MIN_ICP_OVERLAP));
  }
  const marketOverlap = roundDimension((geographyOverlap * 0.55) + (segmentOverlap * 0.45));
  const productDepth = roundDimension(featureDepth);
  const revenue = revenueAdjustment(companyRevenueTier, competitorRevenueTier);
  const authority = computeCompetitorAuthorityScore(enrichedCandidate);
  const targetCapabilityVector = buildCompanyCapabilityVector(context);
  const candidateCapabilityVector = buildCandidateCapabilityVector(enrichedCandidate);
  const vectorOverlap = capabilityVectorOverlap(targetCapabilityVector, candidateCapabilityVector);
  const workflowFit = roundDimension((marketFocusOverlap * 0.45) + (productOverlap * 0.35) + (intentOverlap * 0.20));
  const customerEvaluationFit = roundDimension(
    (intentOverlap * 0.45) +
    (targetOverlap * 0.30) +
    ((affinity === 'same' ? 1 : affinity === 'functional' ? 0.72 : 0.35) * 0.25),
  );
  const useCaseFit = roundDimension((productDepth * 0.60) + (problemOverlap * 0.40));
  const seoIntentFit = roundDimension((intentOverlap * 0.55) + (authority.authority_score * 0.45));
  const dimensions: CompetitorDimensionScores = {
    productServiceFit: toPercentScore((problemOverlap * 0.60) + (vectorOverlap * 0.40)),
    workflowFit: toPercentScore((workflowFit * 0.55) + (vectorOverlap * 0.45)),
    icpFit: toPercentScore(icpOverlap),
    customerEvaluationFit: toPercentScore(customerEvaluationFit),
    useCaseFit: toPercentScore((useCaseFit * 0.60) + (vectorOverlap * 0.40)),
    revenueScaleFit: toPercentScore(revenue),
    employeeScaleFit: employeeScaleFitForCandidate(enrichedCandidate, candidateSignalText(enrichedCandidate, domain)),
    geographyFit: toPercentScore(geographyOverlap),
    seoIntentFit: toPercentScore(seoIntentFit),
  };
  let overallScore = weightedCompetitorScore(dimensions);
  let finalScore = roundDimension(overallScore / 100);
  if (
    enrichedCandidate.source === 'archetype_native_peer' &&
    hasArchetypeNativePeerEvidence(candidateSignalText(enrichedCandidate, domain)) &&
    hasArchetypeNativeContextEvidence(context)
  ) {
    finalScore = roundDimension(Math.max(finalScore, FINAL_COMPETITOR_MIN_SCORE / 100));
    overallScore = Math.max(overallScore, FINAL_COMPETITOR_MIN_SCORE);
  }

  const tags = enrichedCandidate.tags ?? normalizeCompetitorTags({
    productType: enrichedCandidate.productType,
    businessModel: enrichedCandidate.businessModel,
    description: enrichedCandidate.description,
    category: competitorCategory,
  });

  const tier = classifyCompetitiveTier({ problemOverlap, icpOverlap, affinity });
  const normalizedCategory = classifyNormalizedCompetitorCategory({
    overallScore,
    dimensions,
    revenueTier: competitorRevenueTier,
    competitor: enrichedCandidate,
    affinity,
  }) ?? 'workflow-alternative';
  const reasoning = competitorReasoning({
    dimensions,
    category: normalizedCategory,
    revenueTier: competitorRevenueTier,
    affinity,
    competitor: enrichedCandidate,
  });
  const discoverySources = candidateDiscoverySources(enrichedCandidate);
  const intelligenceTier = competitorIntelligenceTier(overallScore);

  return {
    category: competitorCategory,
    tags,
    relevance_score: overallScore,
    score_card: {
      overallScore,
      category: normalizedCategory,
      tier: intelligenceTier,
      dimensions,
      reasoning,
      confidence: Math.round((enrichedCandidate.confidenceScore ?? enrichedCandidate.enrichment?.confidence_score ?? 0.15) * 100),
      discoverySources,
      capabilityVector: candidateCapabilityVector,
    },
    reasoning,
    discoverySources,
    capabilityVector: candidateCapabilityVector,
    problem_overlap: problemOverlap,
    icp_overlap: icpOverlap,
    market_overlap: marketOverlap,
    revenue_tier: competitorRevenueTier,
    product_depth: productDepth,
    authority_score: authority.authority_score,
    authority_signals: authority.authority_signals,
    final_score: finalScore,
    tier,
  };
}

export function scoreCompetitorCandidate(
  candidate: CompetitorCandidate,
  context: CompanyCompetitiveContext,
): number {
  const enrichedCandidate = enrichCompetitorCandidateSync(candidate);
  return evaluateCompetitorCandidate(enrichedCandidate, context).score_card.overallScore;
}

function classifyByIndex(index: number): CompetitorClassification {
  if (index === 0) return 'direct_competitor';
  if (index === 1) return 'seo_competitor';
  return 'authority_leader';
}

export function rankCompetitorCandidates(params: {
  candidates: CompetitorCandidate[];
  context: CompanyCompetitiveContext;
  max?: number;
  minScore?: number;
  allowTrustedBelowThreshold?: boolean;
}): RankedCompetitor[] {
  const max = params.max ?? 5;
  const minScore = params.minScore ?? 42;
  const allowTrustedBelowThreshold = params.allowTrustedBelowThreshold ?? true;
  const seen = new Set<string>();

  return params.candidates
    .map((candidate) => {
      const enrichedCandidate = enrichCompetitorCandidateSync(candidate);
      const businessFirstOnly = isBusinessFirstOnlyArchetype(params.context.entityArchetype);
      const explicitlyValidatedArchetypePeer = Boolean(enrichedCandidate.competitorIntelligence?.reasoning);
      if (
        enrichedCandidate.source === 'archetype_native_peer' &&
        businessFirstOnly &&
        !explicitlyValidatedArchetypePeer
      ) return null;
      const domain = normalizeCompetitorDomain(enrichedCandidate.domain ?? enrichedCandidate.name);
      const name = cleanText(enrichedCandidate.enrichment?.name) ?? cleanText(enrichedCandidate.name) ?? domainToName(domain);
      if (!name) return null;
      const breakdown = evaluateCompetitorCandidate(enrichedCandidate, params.context);
      if (isAuthorityDominatedMismatch(breakdown)) return null;
      // Product-first competition gate — applies ONLY to product/business-first companies
      // (e.g. Omnivyra). For a PRODUCT company, media/content producers (newsletters,
      // creators, publications) are FACILITATED customers, not competitors; narrow-overlap
      // (<70% functional) and off-segment products are EXCLUDED. Audience-led companies keep
      // their peer competitors (unchanged), since for them those peers ARE the competition.
      if (businessFirstOnly) {
        const gateProductType = enrichedCandidate.enrichment?.product_type ?? enrichedCandidate.productType ?? null;
        const gateText = [
          enrichedCandidate.name,
          enrichedCandidate.domain,
          enrichedCandidate.category,
          enrichedCandidate.description,
          enrichedCandidate.businessModel,
          enrichedCandidate.enrichment?.description,
          enrichedCandidate.enrichment?.category,
        ].filter(Boolean).join(' ');
        const competitionTier = classifyProductFirstCompetition({
          productType: gateProductType,
          functionalOverlap: breakdown.problem_overlap,
          segmentOverlap: Math.max(breakdown.icp_overlap, breakdown.market_overlap),
          isMediaContent:
            MEDIA_CONTENT_BRAND_SIGNALS.test(gateText) ||
            enrichedCandidate.source === 'archetype_native_peer',
          trustedProduct: TRUSTED_SOURCES.has(enrichedCandidate.source),
        });
        if (competitionTier === 'facilitated' || competitionTier === 'excluded') return null;
      }
      const positioning = buildCompetitorPositioning(enrichedCandidate, breakdown, params.context);
      const score = scoreCompetitorCandidate(enrichedCandidate, params.context);
      const trusted = TRUSTED_SOURCES.has(enrichedCandidate.source);
      if (score < minScore && !(allowTrustedBelowThreshold && trusted)) return null;
      const baseRationale =
        cleanText(enrichedCandidate.rationale) ??
        buildCompetitorFitRationale(
          params.context,
          params.context.geography,
          trusted
            ? 'Validated as a competitor from a trusted source.'
            : 'Validated as a likely competitor through shared market, offering, and ICP signals.',
        );
      return {
        name,
        domain,
        ...breakdown,
        positioning,
        relevance_score: score,
        source: enrichedCandidate.source,
        classification: enrichedCandidate.classification ?? null,
        enrichment: enrichedCandidate.enrichment ?? null,
        enrichment_confidence_score: enrichedCandidate.confidenceScore ?? enrichedCandidate.enrichment?.confidence_score ?? 0.15,
        rationale: buildScoringRationale(baseRationale, breakdown),
        competitor_intelligence: inferCompetitorIntelligence(enrichedCandidate, params.context),
        fit_signals: buildCompetitorFitSignals(params.context),
      } satisfies ScoredCompetitor;
    })
    .filter((item): item is ScoredCompetitor => Boolean(item))
    .sort((left, right) => right.relevance_score - left.relevance_score)
    .filter((item) => {
      const key = `${item.domain ?? item.name}`.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max)
    .map((item, index) => ({
      ...item,
      classification: item.classification ?? classificationFromTier(item.tier) ?? classifyByIndex(index),
    }));
}

export function filterProfileCompetitorNames(profile: CompanyProfile, competitors: string[], max = 5): string[] {
  const context = extractCompetitiveContextFromProfile(profile);
  return getFinalCompetitorsSync({
    candidates: competitors.map((name) => ({ name, source: 'profile_ai' })),
    context,
    max,
    minScore: 42,
    includeMarketSubstitutes: false,
  }).map((competitor) => competitor.name);
}

function normalizeCompetitorEntityName(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(COMPANY_SUFFIX_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function domainRootKey(value: string | null | undefined): string | null {
  const domain = normalizeCompetitorDomain(value);
  if (!domain) return null;
  return normalizeCompetitorEntityName(domain.split('.')[0] ?? domain);
}

export function finalCompetitorKey(candidate: Pick<CompetitorCandidate, 'name' | 'domain'>): string {
  const nameKey = normalizeCompetitorEntityName(cleanText(candidate.name));
  const domainKey = domainRootKey(candidate.domain ?? candidate.name);
  return nameKey || domainKey || '';
}

function candidateDedupeQuality(candidate: Partial<CompetitorCandidate>): number {
  const confidence = Number(candidate.confidenceScore ?? candidate.enrichment?.confidence_score ?? 0);
  const knownProfile = findKnownCompetitorProfile(candidate.name, candidate.domain);
  return (
    ((knownProfile?.confidence_score ?? 0) * 120) +
    (Number.isFinite(confidence) ? confidence * 100 : 0) +
    (candidate.enrichment ? 20 : 0) +
    (candidate.category ? 8 : 0) +
    (candidate.description ? 8 : 0) +
    (candidate.domain ? 6 : 0) +
    ((candidate.productSignals?.length ?? 0) > 0 ? 5 : 0)
  );
}

export function dedupeCompetitorCandidates<T extends Pick<CompetitorCandidate, 'name' | 'domain' | 'source'>>(
  candidates: T[],
): T[] {
  const byKey = new Map<string, T & { name: string; domain: string | null }>();
  const keysByEntity = new Map<string, string>();

  for (const candidate of candidates) {
    if (FINAL_BLOCKED_SOURCES.has(candidate.source)) continue;
    const name = cleanText(candidate.name);
    const nameKey = normalizeCompetitorEntityName(name);
    const domainKey = domainRootKey(candidate.domain ?? candidate.name);
    const entityKeys = [nameKey ? `name:${nameKey}` : null, domainKey ? `domain:${domainKey}` : null].filter(Boolean) as string[];
    const key = entityKeys.map((entityKey) => keysByEntity.get(entityKey)).find(Boolean) ?? finalCompetitorKey(candidate);
    if (!name || !key || entityKeys.length === 0) continue;
    const normalizedCandidate = {
      ...candidate,
      name,
      domain: normalizeCompetitorDomain(candidate.domain ?? candidate.name),
    };
    const existing = byKey.get(key);
    const mergedDiscoverySources = Array.from(new Set([
      ...((existing as Partial<CompetitorCandidate> | undefined)?.discoverySources ?? []),
      ...((normalizedCandidate as Partial<CompetitorCandidate>).discoverySources ?? []),
      discoverySourceFromCandidate(normalizedCandidate as CompetitorCandidate),
    ]));
    const winner = !existing || candidateDedupeQuality(normalizedCandidate) > candidateDedupeQuality(existing)
      ? normalizedCandidate
      : existing;
    byKey.set(key, {
      ...winner,
      discoverySources: mergedDiscoverySources,
    });
    for (const entityKey of entityKeys) {
      keysByEntity.set(entityKey, key);
    }
  }

  return Array.from(byKey.values());
}

export function detectedCompanyCategories(context: CompanyCompetitiveContext): StandardCompetitorCategory[] {
  const joinedContext = [
    context.marketFocus,
    context.primaryService,
    context.targetCustomer,
    context.idealCustomerProfile,
    context.brandPositioning,
    context.businessModel,
  ].filter(Boolean).join(' ');
  const weightedFields: Array<[string | null, number]> = [
    [context.marketFocus, 4],
    [context.primaryService, 4],
    [context.brandPositioning, 3],
    [context.targetCustomer, 2],
    [context.idealCustomerProfile, 2],
    [context.businessModel, 1],
  ];
  const scores = new Map<StandardCompetitorCategory, number>();
  for (const [value, weight] of weightedFields) {
    if (!cleanText(value)) continue;
    const category = normalizeCompetitorCategory(value, joinedContext);
    scores.set(category, (scores.get(category) ?? 0) + weight);
  }
  if (scores.size === 0 && cleanText(joinedContext)) {
    const category = normalizeCompetitorCategory(null, joinedContext);
    scores.set(category, 1);
  }
  return Array.from(scores.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([category]) => category);
}

