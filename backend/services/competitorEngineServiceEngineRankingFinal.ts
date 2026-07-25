/** Competitor engine — final selection + entrypoints — split from competitorEngineServiceEngineRanking.ts (barrel preserved; importers unchanged). */
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

import { isAuthorityDominatedMismatch, rankCompetitorCandidates, finalCompetitorKey, dedupeCompetitorCandidates, detectedCompanyCategories } from './competitorEngineServiceEngineRankingScore';

// Module-level dev-debug latch — moved here from the Model part because the ASSIGNMENTS live
// in filterFinalCompetitorsWithAudit below (an imported binding cannot be assigned across
// modules). The getter stays public via the competitorEngineService barrel.
let latestDebugCompetitorScoring: DebugCompetitorScoring | undefined;

export function getLatestDebugCompetitorScoring(): DebugCompetitorScoring | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  return latestDebugCompetitorScoring;
}

function competitorEvidenceText(competitor: Partial<RankedCompetitor>): string {
  return [
    competitor.name,
    competitor.domain,
    competitor.category,
    competitor.rationale,
    competitor.enrichment?.category,
    competitor.enrichment?.description,
    competitor.enrichment?.business_model,
    competitor.enrichment?.product_type,
    competitor.enrichment?.icp?.age_group,
    competitor.enrichment?.icp?.use_case,
    competitor.enrichment?.icp?.user_intent,
  ].filter(Boolean).join(' ');
}

function hasStrictCategoryFit(
  competitor: Partial<RankedCompetitor>,
  context: CompanyCompetitiveContext,
): boolean {
  if (UNRELATED_COMPETITOR_TEXT_PATTERN.test(competitorEvidenceText(competitor))) return false;
  const topCategories = detectedCompanyCategories(context);
  if (topCategories.length === 0) return true;
  const competitorCategory = normalizeCompetitorCategory(
    competitor.category,
    competitorEvidenceText(competitor),
  );
  return topCategories.some((companyCategory) => {
    if (companyCategory === 'mental_wellness_ai' && competitorCategory === 'ai_companion') {
      const evidence = competitorEvidenceText(competitor).toLowerCase();
      const wellnessUseCase =
        /\b(mental wellness|mental wellbeing|mental health|therapy|therapeutic|clarity|decision[-\s]?making|decision support|self[-\s]?reflection|guided journaling)\b/.test(evidence);
      const companionUseCase =
        /\b(companionship|relationship|conversation partner|romantic|friend|connection)\b/.test(evidence);
      return wellnessUseCase && !companionUseCase;
    }
    const affinity = categoryAffinity(companyCategory, competitorCategory);
    return affinity === 'same' || affinity === 'functional';
  });
}

function rankedCompetitorQuality(competitor: RankedCompetitor): number {
  return (
    Number(competitor.enrichment_confidence_score ?? competitor.enrichment?.confidence_score ?? 0) * 100 +
    Number(competitor.final_score ?? 0) * 10 +
    Number(competitor.problem_overlap ?? 0) * 5 +
    Number(competitor.icp_overlap ?? 0) * 5
  );
}

function dedupeRankedCompetitors(competitors: RankedCompetitor[]): RankedCompetitor[] {
  const byKey = new Map<string, RankedCompetitor>();
  for (const competitor of competitors) {
    const key = finalCompetitorKey(competitor);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || rankedCompetitorQuality(competitor) > rankedCompetitorQuality(existing)) {
      byKey.set(key, competitor);
    }
  }
  return Array.from(byKey.values());
}

function sortFinalCompetitors(left: RankedCompetitor, right: RankedCompetitor): number {
  const tierDelta = (TIER_PRIORITY[left.tier] ?? 99) - (TIER_PRIORITY[right.tier] ?? 99);
  if (tierDelta !== 0) return tierDelta;
  const finalDelta = Number(right.final_score ?? 0) - Number(left.final_score ?? 0);
  if (finalDelta !== 0) return finalDelta;
  const relevanceDelta = Number(right.relevance_score ?? 0) - Number(left.relevance_score ?? 0);
  if (relevanceDelta !== 0) return relevanceDelta;
  return left.name.localeCompare(right.name);
}

function finalCompetitorOutputLimit(max?: number): number {
  return Math.min(max ?? FINAL_COMPETITOR_MAX_COUNT, FINAL_COMPETITOR_MAX_COUNT);
}

function applyHybridCompositionPreservation(
  sorted: RankedCompetitor[],
  context: CompanyCompetitiveContext,
  max?: number,
): RankedCompetitor[] {
  // Archetype-native (audience) peers are no longer a producible source, so the former
  // hybrid audience/commercial interleaving is inert — return the top-N by final rank.
  return sorted.slice(0, finalCompetitorOutputLimit(max));
}

function finalCompetitorRankingPoolSize(candidateCount: number, max?: number): number {
  return Math.min(
    candidateCount,
    Math.max(max ?? FINAL_COMPETITOR_MAX_COUNT, FINAL_COMPETITOR_MAX_COUNT, FINAL_COMPETITOR_MIN_COUNT * 3),
  );
}

function filterFinalCompetitorsWithAudit(params: {
  competitors: RankedCompetitor[];
  context: CompanyCompetitiveContext;
  max?: number;
  minScore?: number;
  feedbackMemory?: CompetitorFeedbackMemory | null;
}): RankedCompetitor[] {
  const minScore = params.minScore ?? FINAL_COMPETITOR_MIN_SCORE;
  const audit = {
    initial_candidates: params.competitors.length,
    removed_due_to_threshold: 0,
    removed_due_to_category: 0,
    removed_due_to_confidence: 0,
    suppressed_by_feedback: [] as string[],
    boosted_by_feedback: [] as string[],
    final_count: 0,
    debugCompetitorScoring: undefined as DebugCompetitorScoring | undefined,
  };
  const filtered: RankedCompetitor[] = [];
  const fallbackFiltered: RankedCompetitor[] = [];
  const rejected: DebugCompetitorScoring['rejected'] = [];

  for (const competitor of dedupeRankedCompetitors(params.competitors)) {
    const feedbackDecision = getCompetitorFeedbackDecision(params.feedbackMemory, competitor);
    if (feedbackDecision?.suppressed) {
      audit.suppressed_by_feedback.push(competitor.name);
      continue;
    }
    const enrichmentConfidence = Number(
      competitor.enrichment_confidence_score ?? competitor.enrichment?.confidence_score ?? 0,
    );
    if (!Number.isFinite(enrichmentConfidence) || enrichmentConfidence < FINAL_COMPETITOR_MIN_ENRICHMENT_CONFIDENCE) {
      audit.removed_due_to_confidence += 1;
      rejected.push({
        company: competitor.name,
        score: competitor.score_card?.overallScore ?? competitor.relevance_score ?? 0,
        failedDimensions: failedCompetitorDimensions(competitor),
      });
      continue;
    }
    if (!hasStrictCategoryFit(competitor, params.context)) {
      audit.removed_due_to_category += 1;
      rejected.push({
        company: competitor.name,
        score: competitor.score_card?.overallScore ?? competitor.relevance_score ?? 0,
        failedDimensions: ['categoryFit', ...failedCompetitorDimensions(competitor)],
      });
      continue;
    }
    const gateCandidate: Partial<RankedCompetitor> = competitor;
    if (!hasPassedFinalCompetitorGate(gateCandidate, FINAL_COMPETITOR_MIN_SCORE)) {
      audit.removed_due_to_threshold += 1;
      rejected.push({
        company: gateCandidate.name ?? 'unknown',
        score: gateCandidate.score_card?.overallScore ?? gateCandidate.relevance_score ?? 0,
        failedDimensions: failedCompetitorDimensions(gateCandidate),
      });
      continue;
    }
    const boosted = applyCompetitorFeedbackBoost(competitor, feedbackDecision);
    if (boosted !== competitor) audit.boosted_by_feedback.push(competitor.name);
    if (Number(boosted.score_card?.overallScore ?? boosted.relevance_score ?? 0) >= minScore) {
      filtered.push(boosted);
    } else {
      fallbackFiltered.push(boosted);
    }
  }

  const accepted = filtered.length > 0 ? filtered : fallbackFiltered;
  const sortedCompetitors = accepted
    .sort(sortFinalCompetitors)
    .filter((competitor, _index, sorted) => {
      if (competitor.source !== 'market_substitute') return true;
      return sorted.filter((item) => item.source === 'market_substitute').indexOf(competitor) < MARKET_SUBSTITUTE_MAX_COUNT;
    });
  const finalCompetitors = applyHybridCompositionPreservation(sortedCompetitors, params.context, params.max);
  audit.final_count = finalCompetitors.length;
  if (process.env.NODE_ENV !== 'production') {
    audit.debugCompetitorScoring = { rejected };
    latestDebugCompetitorScoring = audit.debugCompetitorScoring;
  } else {
    latestDebugCompetitorScoring = undefined;
  }
  console.info('[competitor-final-filter][audit]', audit);
  console.info('[competitor-feedback][trace]', {
    suppressed_by_feedback: audit.suppressed_by_feedback,
    boosted_by_feedback: audit.boosted_by_feedback,
  });
  return finalCompetitors;
}

export function hasPassedFinalCompetitorGate(
  competitor: Partial<RankedCompetitor> | null | undefined,
  minScore = FINAL_COMPETITOR_MIN_SCORE,
): competitor is RankedCompetitor {
  if (!competitor) return false;
  if (!competitor.name || typeof competitor.name !== 'string') return false;
  if (!competitor.source || FINAL_BLOCKED_SOURCES.has(competitor.source)) return false;
  if (!cleanText(competitor.category)) return false;
  if (!Number.isFinite(competitor.relevance_score) || Number(competitor.relevance_score) < minScore) return false;
  if (!Number.isFinite(competitor.final_score) || Number(competitor.final_score) <= 0) return false;
  if (Math.round(Number(competitor.final_score) * 100) < minScore) return false;
  const scoreCard = competitor.score_card;
  if (!scoreCard || !scoreCard.dimensions || Number(scoreCard.overallScore ?? 0) < 40) return false;
  const primaryDominance = Math.max(
    Number(scoreCard.dimensions.productServiceFit ?? 0),
    Number(scoreCard.dimensions.workflowFit ?? 0),
    Number(scoreCard.dimensions.useCaseFit ?? 0),
    Number(scoreCard.dimensions.customerEvaluationFit ?? 0),
  );
  if (primaryDominance < 40) return false;
  if (
    Number(competitor.problem_overlap ?? 0) < FINAL_COMPETITOR_MIN_PROBLEM_OVERLAP &&
    Number(scoreCard.dimensions.workflowFit ?? 0) < 50 &&
    Number(scoreCard.dimensions.useCaseFit ?? 0) < 50
  ) return false;
  if (
    Number(competitor.icp_overlap ?? 0) < FINAL_COMPETITOR_MIN_ICP_OVERLAP &&
    Number(scoreCard.dimensions.customerEvaluationFit ?? 0) < 50
  ) return false;
  if (Number(competitor.final_score ?? 0) < FINAL_COMPETITOR_MIN_FINAL_SCORE) return false;
  if (!Number.isFinite(competitor.authority_score) || Number(competitor.authority_score) < 0) return false;
  if (!competitor.authority_signals || typeof competitor.authority_signals !== 'object') return false;
  const positioning = competitor.positioning;
  if (!positioning || typeof positioning !== 'object') return false;
  if (!['low', 'medium', 'high'].includes(String(positioning.threat_level))) return false;
  if (!Array.isArray(positioning.strengths_vs_company) || positioning.strengths_vs_company.length === 0) return false;
  if (!Array.isArray(positioning.weaknesses_vs_company) || positioning.weaknesses_vs_company.length === 0) return false;
  if (!cleanText(positioning.differentiation)) return false;
  if (isAuthorityDominatedMismatch(competitor)) return false;
  const enrichmentConfidence = Number(
    competitor.enrichment_confidence_score ?? competitor.enrichment?.confidence_score ?? 0,
  );
  if (
    !competitor.enrichment ||
    !Number.isFinite(enrichmentConfidence) ||
    enrichmentConfidence < FINAL_COMPETITOR_MIN_ENRICHMENT_CONFIDENCE
  ) return false;
  return true;
}

function toRevalidationCandidate(candidate: CompetitorCandidate): CompetitorCandidate {
  const hasStrategicInlineEvidence = Boolean(
    cleanText(candidate.category) &&
    (cleanText(candidate.description) || cleanText(candidate.useCase) || (candidate.productSignals?.length ?? 0) > 0) &&
    (cleanText(candidate.targetCustomer) || cleanText(candidate.businessModel)),
  );
  // Inline enrichment is preserved only for genuinely self-evidenced sources. It must NOT be
  // preserved for archetype-native peers: their inline fields were synthesized from the subject
  // company's own profile, which let them bypass the overlap gate via self-comparison.
  const preserveInlineEnrichment =
    candidate.source === 'market_substitute' ||
    (TRUSTED_SOURCES.has(candidate.source) && hasStrategicInlineEvidence);
  const revalidationCandidate = {
    ...candidate,
    name: candidate.name,
    domain: normalizeCompetitorDomain(candidate.domain ?? candidate.name),
    source: candidate.source,
    classification: candidate.classification ?? undefined,
    rationale: preserveInlineEnrichment ? candidate.rationale : undefined,
    category: preserveInlineEnrichment ? candidate.category : undefined,
    tags: preserveInlineEnrichment ? candidate.tags : undefined,
    description: preserveInlineEnrichment ? candidate.description : undefined,
    targetCustomer: preserveInlineEnrichment ? candidate.targetCustomer : undefined,
    useCase: preserveInlineEnrichment ? candidate.useCase : undefined,
    geography: preserveInlineEnrichment ? candidate.geography : undefined,
    businessModel: preserveInlineEnrichment ? candidate.businessModel : undefined,
    revenueRange: preserveInlineEnrichment ? candidate.revenueRange : undefined,
    productSignals: preserveInlineEnrichment ? candidate.productSignals : undefined,
    productType: preserveInlineEnrichment ? candidate.productType : undefined,
    scaleSignals: preserveInlineEnrichment ? candidate.scaleSignals : undefined,
    confidenceScore: preserveInlineEnrichment ? candidate.confidenceScore : undefined,
    enrichment: preserveInlineEnrichment ? candidate.enrichment : undefined,
    competitorIntelligence: preserveInlineEnrichment ? candidate.competitorIntelligence : undefined,
  };
  return preserveInlineEnrichment && !revalidationCandidate.enrichment
    ? withArchetypeEnrichment(revalidationCandidate)
    : revalidationCandidate;
}

function hasStrongNamedCompetitor(competitors: RankedCompetitor[]): boolean {
  return competitors.some((competitor) =>
    competitor.source !== 'market_substitute' &&
    Number(competitor.score_card?.overallScore ?? competitor.relevance_score ?? 0) >= 70
  );
}

function addMarketSubstitutesWhenNeeded(params: {
  candidates: CompetitorCandidate[];
  context: CompanyCompetitiveContext;
  finalCompetitors: RankedCompetitor[];
  max?: number;
  includeMarketSubstitutes?: boolean;
}): CompetitorCandidate[] {
  if (params.includeMarketSubstitutes !== true) return params.candidates;
  if (params.finalCompetitors.length === 0) return params.candidates;
  if (params.finalCompetitors.length >= finalCompetitorOutputLimit(params.max)) return params.candidates;
  if (hasStrongNamedCompetitor(params.finalCompetitors)) return params.candidates;
  if (params.candidates.some((candidate) => candidate.source === 'market_substitute')) return params.candidates;
  const substitutes = inferCompetitorArchetypeCandidates(params.context, 'market_substitute');
  if (substitutes.length === 0) return params.candidates;
  console.info('[competitor-final-filter][market-substitutes-added]', {
    reason: 'no_strong_named_competitor_at_or_above_70',
    substitute_count: substitutes.length,
    substitutes: substitutes.map((candidate) => candidate.name),
  });
  return dedupeCompetitorCandidates([...params.candidates, ...substitutes]).map(toRevalidationCandidate);
}

export function splitRankedCompetitorsForOutput(
  competitors: RankedCompetitor[],
  competitorMax = FINAL_COMPETITOR_MAX_COUNT,
  alternativeMax = MARKET_SUBSTITUTE_MAX_COUNT,
): { competitors: RankedCompetitor[]; market_alternatives: RankedCompetitor[] } {
  const sorted = [...competitors].sort(sortFinalCompetitors);
  return {
    competitors: sorted
      .filter((competitor) => competitor.source !== 'market_substitute')
      .slice(0, competitorMax),
    market_alternatives: sorted
      .filter((competitor) => competitor.source === 'market_substitute')
      .slice(0, alternativeMax),
  };
}

export function buildCompetitorIntelligenceContext(
  competitors: Array<Pick<RankedCompetitor, 'name' | 'source' | 'category' | 'tier' | 'relevance_score' | 'rationale' | 'competitor_intelligence'>>,
  options?: { max?: number; includeBusinessFirst?: boolean },
): string {
  const items = competitors
    .filter((competitor) => options?.includeBusinessFirst || competitor.competitor_intelligence)
    .slice(0, options?.max ?? 5)
    .map((competitor) => {
      const intelligence = competitor.competitor_intelligence;
      return [
        `${competitor.name} (${competitor.source}, ${competitor.category}, ${competitor.tier}, score ${competitor.relevance_score})`,
        intelligence?.archetype_peer_category ? `peer category: ${intelligence.archetype_peer_category}` : null,
        intelligence?.audience_overlap ? `audience overlap: ${intelligence.audience_overlap}` : null,
        intelligence?.narrative_overlap ? `narrative overlap: ${intelligence.narrative_overlap}` : null,
        intelligence?.trust_model ? `trust model: ${intelligence.trust_model}` : null,
        intelligence?.publication_identity ? `publication identity: ${intelligence.publication_identity}` : null,
        intelligence?.ecosystem_role ? `ecosystem role: ${intelligence.ecosystem_role}` : null,
        intelligence?.monetization_adjacency ? `monetization adjacency: ${intelligence.monetization_adjacency}` : null,
        intelligence?.creator_operator_identity ? `creator/operator identity: ${intelligence.creator_operator_identity}` : null,
        intelligence?.educational_role ? `educational role: ${intelligence.educational_role}` : null,
        intelligence?.worldview_adjacency ? `worldview adjacency: ${intelligence.worldview_adjacency}` : null,
        intelligence?.platform_native_context ? `platform/native context: ${intelligence.platform_native_context}` : null,
      ].filter(Boolean).join('; ');
    });
  return items.join('\n');
}

export function assertCompetitorOutputPartition(
  partition: { competitors: Array<{ name?: string | null; source?: string | null }>; market_alternatives?: Array<{ name?: string | null; source?: string | null }> },
  context = 'competitor_output',
): void {
  const substituteCompetitors = partition.competitors
    .filter((competitor) => competitor.source === 'market_substitute')
    .map((competitor) => competitor.name || 'unnamed');
  if (substituteCompetitors.length > 0) {
    throw new Error(`${context}_market_substitute_in_competitors:${substituteCompetitors.join(',')}`);
  }

  const nonSubstituteAlternatives = (partition.market_alternatives ?? [])
    .filter((competitor) => competitor.source !== 'market_substitute')
    .map((competitor) => competitor.name || 'unnamed');
  if (nonSubstituteAlternatives.length > 0) {
    throw new Error(`${context}_named_competitor_in_market_alternatives:${nonSubstituteAlternatives.join(',')}`);
  }
}

export async function getFinalCompetitors(params: {
  candidates: CompetitorCandidate[];
  context: CompanyCompetitiveContext;
  max?: number;
  minScore?: number;
  useNetwork?: boolean;
  useStoredCache?: boolean;
  companyId?: string | null;
  feedbackMemory?: CompetitorFeedbackMemory | null;
  includeMarketSubstitutes?: boolean;
}): Promise<RankedCompetitor[]> {
  const minScore = params.minScore ?? FINAL_COMPETITOR_MIN_SCORE;
  const feedbackMemory = params.feedbackMemory ?? (params.companyId
    ? await loadCompetitorFeedbackMemory({
        companyId: params.companyId,
        categories: detectedCompanyCategories(params.context),
      })
    : null);
  const candidates = dedupeCompetitorCandidates([
    ...params.candidates,
    ...buildFeedbackMissingCompetitorCandidates(feedbackMemory),
  ]).map(toRevalidationCandidate);

  const runPipeline = async (pipelineCandidates: CompetitorCandidate[]): Promise<RankedCompetitor[]> => {
    if (pipelineCandidates.length === 0) return [];
    const enriched = await enrichCompetitorCandidates({
      candidates: pipelineCandidates,
      useNetwork: params.useNetwork,
      useStoredCache: params.useStoredCache,
    });

    const ranked = rankCompetitorCandidates({
      candidates: enriched,
      context: params.context,
      max: finalCompetitorRankingPoolSize(enriched.length, params.max),
      minScore: FINAL_COMPETITOR_MIN_SCORE,
      allowTrustedBelowThreshold: false,
    });
    return filterFinalCompetitorsWithAudit({
      competitors: ranked,
      context: params.context,
      max: params.max,
      minScore,
      feedbackMemory,
    });
  };

  let finalCompetitors = await runPipeline(candidates);
  const expandedCandidates = addMarketSubstitutesWhenNeeded({
    candidates,
    context: params.context,
    finalCompetitors,
    max: params.max,
    includeMarketSubstitutes: params.includeMarketSubstitutes,
  });
  if (expandedCandidates.length !== candidates.length) {
    finalCompetitors = await runPipeline(expandedCandidates);
  } else if (candidates.length === 0) {
    finalCompetitors = await runPipeline(expandedCandidates);
  }
  return finalCompetitors;
}

export function getFinalCompetitorsSync(params: {
  candidates: CompetitorCandidate[];
  context: CompanyCompetitiveContext;
  max?: number;
  minScore?: number;
  feedbackMemory?: CompetitorFeedbackMemory | null;
  includeMarketSubstitutes?: boolean;
}): RankedCompetitor[] {
  const minScore = params.minScore ?? FINAL_COMPETITOR_MIN_SCORE;
  const candidates = dedupeCompetitorCandidates([
    ...params.candidates,
    ...buildFeedbackMissingCompetitorCandidates(params.feedbackMemory),
  ]).map(toRevalidationCandidate);
  const runPipeline = (pipelineCandidates: CompetitorCandidate[]): RankedCompetitor[] => {
    if (pipelineCandidates.length === 0) return [];
    const ranked = rankCompetitorCandidates({
      candidates: pipelineCandidates,
      context: params.context,
      max: finalCompetitorRankingPoolSize(pipelineCandidates.length, params.max),
      minScore: FINAL_COMPETITOR_MIN_SCORE,
      allowTrustedBelowThreshold: false,
    });
    return filterFinalCompetitorsWithAudit({
      competitors: ranked,
      context: params.context,
      max: params.max,
      minScore,
      feedbackMemory: params.feedbackMemory,
    });
  };

  let finalCompetitors = runPipeline(candidates);
  const expandedCandidates = addMarketSubstitutesWhenNeeded({
    candidates,
    context: params.context,
    finalCompetitors,
    max: params.max,
    includeMarketSubstitutes: params.includeMarketSubstitutes,
  });
  if (expandedCandidates.length !== candidates.length) {
    finalCompetitors = runPipeline(expandedCandidates);
  } else if (candidates.length === 0) {
    finalCompetitors = runPipeline(expandedCandidates);
  }
  return finalCompetitors;
}

export function buildCandidatesFromNames(
  names: string[],
  source: CompetitorSource,
): CompetitorCandidate[] {
  return Array.from(new Set(names.map((name) => cleanText(name)).filter((name): name is string => Boolean(name))))
    .map((name) => ({
      name,
      domain: normalizeCompetitorDomain(name),
      source,
    }));
}

export function splitCompetitorNames(value?: string | string[] | null): string[] {
  if (Array.isArray(value)) return value.map((item) => cleanText(item)).filter((item): item is string => Boolean(item));
  return splitToList(value);
}



