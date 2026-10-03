import type { PersistedDecisionObject } from '../decisionObjectService';
import type { ResolvedReportInput } from '../reportInputResolver';
import type { PublicAuditResult } from '../publicDomainAuditService';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
import { classifyDecisionType } from '../decisionTypeRegistry';
import { impactScore } from '../reportDecisionUtils';
import { buildDecisionBusinessImpact } from '../businessImpactFormatter';
import { average, averageNumber, clamp } from '../snapshotReportNarrativeHelpers';
// BETA-EXEC-004: deterministic measured-evidence tail for why-it-matters (Phase 2/6).
import { type EngineEvidenceInput, evidenceTailForDecision } from './engineEvidenceNarrative';
import type { ScoreState } from './canonicalScoreState';
import type {
  CompanyNarrativeContext,
  MarketPositionClaim,
  SnapshotInsight,
  SnapshotOpportunity,
  StrategicContext,
} from './types';
import {
  aiVisibilityTactics,
  authorityActionTactics,
  backlinkTactics,
  comparisonPageTactics,
  competitorGapTactics,
  contentDepthTactics,
  guessFocusPage,
  inferStructuredActionTrack,
  isAuthorityDecision,
  isContentDecision,
  isOpportunityCandidate,
  lowestDepthPageTargets,
  positioningProofTactics,
  replaceLegacyOmnivyraReferences,
  scrubActionCompanyReferences,
  structuredReasoning,
  topTrafficPotentialPages,
} from './actionTacticHelpers';
import {
  splitCandidates,
  firstNonEmpty,
  normalizePageLabel,
  personalizeEntityReferences,
  recommendationTimeline,
  confidencePercent,
} from './narrativeHelpers';

export { confidencePercent };

export function uniqueById(decisions: PersistedDecisionObject[]): PersistedDecisionObject[] {
  const byId = new Map<string, PersistedDecisionObject>();
  for (const decision of decisions) {
    byId.set(decision.id, decision);
  }
  return [...byId.values()];
}

export function toInsight(
  decision: PersistedDecisionObject,
  companyContext?: CompanyNarrativeContext,
  engineEvidence?: EngineEvidenceInput | null,
): SnapshotInsight {
  return {
    decision_id: decision.id,
    title: personalizeEntityReferences(decision.title, companyContext),
    description: personalizeEntityReferences(decision.description, companyContext),
    why_it_matters: personalizeEntityReferences(buildWhyItMatters(decision, engineEvidence), companyContext),
    business_impact: personalizeEntityReferences(buildDecisionBusinessImpact(decision), companyContext),
    issue_type: decision.issue_type,
    confidence_score: Number(decision.confidence_score ?? 0),
    impact_score: impactScore(decision),
    recommendation: decision.recommendation,
    action_type: decision.action_type,
  };
}

export function toOpportunity(decision: PersistedDecisionObject): SnapshotOpportunity {
  return {
    decision_id: decision.id,
    title: decision.title,
    recommendation: decision.recommendation,
    confidence_score: Number(decision.confidence_score ?? 0),
    action_type: decision.action_type,
  };
}

/**
 * WP-18 — THE ONLY PLACE A MARKET-POSITION CLAIM IS PRODUCED.
 *
 * NO EVIDENCE ≠ MEASURED ZERO ≠ behind / at parity / ahead.
 *
 * This function takes `number | null`, and `null` has no path to a claim: it returns
 * `{ marketPosition: null, marketPositionState: 'insufficient_signal' }`. Because every
 * claim in the report is produced here, "no evidence → 'ahead'" is now structurally
 * impossible rather than merely currently-avoided — a caller cannot reach `'ahead'` without
 * first producing a finite number out of genuinely observed evidence.
 *
 * A MEASURED ZERO IS NOT ABSENCE. `avgDelta === 0` is finite, so it is a real reading and
 * resolves through the unchanged thresholds to `'at parity'`.
 *
 * Thresholds (`>= 6`, `<= -4`), their order and their meanings are the pre-existing ones and
 * are deliberately untouched: a fully observed input yields exactly the pre-fix answer.
 *
 * `insufficient_signal` is the repository's existing abstention state (`ScoreState` in
 * ./canonicalScoreState.ts) — the same value WP-15 reached for an unobservable competitor
 * axis and the default of `emptyCanonicalScore`. No new vocabulary is introduced.
 */
export function resolveMarketPosition(avgDelta: number | null | undefined): {
  marketPosition: MarketPositionClaim | null;
  marketPositionState: ScoreState;
} {
  if (avgDelta == null || !Number.isFinite(avgDelta)) {
    return { marketPosition: null, marketPositionState: 'insufficient_signal' };
  }
  return {
    marketPosition: avgDelta >= 6 ? 'below market' : avgDelta <= -4 ? 'ahead' : 'at parity',
    marketPositionState: 'measured',
  };
}

export function assessPositioningAndMarket(params: {
  companyContext: CompanyNarrativeContext;
  competitorIntelligence: CompetitorIntelligenceResult;
  decisions: PersistedDecisionObject[];
  publicAudit?: Awaited<ReturnType<typeof import('../publicDomainAuditService').buildPublicDomainAuditDecisions>> | null;
}): StrategicContext {
  const companyName = params.companyContext.companyName || params.companyContext.domain || 'this business';
  const positioningLabel = params.companyContext.positioning || params.companyContext.tagline || params.companyContext.homepageHeadline || 'its core market promise';
  const claritySignals = [
    params.companyContext.positioning,
    params.companyContext.tagline,
    params.companyContext.homepageHeadline,
    params.companyContext.primaryOffering,
  ].filter(Boolean).length;
  const consistencyPenalties = params.decisions.filter((decision) =>
    /(content_gap|weak_content_depth|missing_supporting_content|trust_gap|weak_brand_presence|competitor_dominance)/.test(decision.issue_type),
  ).length;
  // WP-18 — AN EMPTY GAP SET IS NOT A PRESSURE READING OF ZERO.
  //
  // `average([])` returns 0 (snapshotReportNarrativeHelpers.ts:7-10), and `generated_gaps` is
  // empty exactly when there was nothing to compare: `buildCompetitorGaps` returns `[]` when
  // the company baseline is null and again when no competitor was observed. The old
  // expression converted that absence into the number 0 and handed it to three consumers as a
  // measured "no competitive pressure at all" reading — most damagingly to the
  // `competitorPressure - 50` fallback below, which then read it as 50 points ahead of the
  // market. That is the live defect this workstream closes.
  //
  // THE SIBLING `?? 0`, AND WHY IT WAS NOT ITSELF THE COLLAPSE. `CompetitorGap.impact_score`
  // is declared `number`, and every one of the five producers in
  // reportCompetitorIntelligenceServiceEngine.ts (lines 308, 326, 344, 362, 380) writes it as
  // `clamp(<constant> + <gap>, 0, <max>)` behind a `<gap> !== null` guard, so it is always a
  // finite number; the only other handler, the normalizer in ...ServiceModel.ts:400, spreads
  // gaps through without touching it, and `assessPositioningAndMarket` has exactly one caller
  // (snapshotReportService.ts:242) which passes a freshly built result, never a rehydrated
  // one. The per-element `?? 0` was therefore a dead branch rather than a collapse of
  // unavailable evidence into a measured zero. It is replaced by the same type guard WP-17
  // used rather than simply deleted, so that the dead branch cannot come back to life: a
  // non-numeric impact can now only drop OUT of the mean, never enter it as a fabricated 0,
  // and the denominator follows the observed count instead of staying pinned at the slice
  // width — the same dilution WP-15 and WP-17 removed from their own averagers.
  //
  // THE GUARD IS ON THE RAW VALUE, NOT ON `Number(...)`. `Number(null)` is 0, and 0 is
  // finite, so coercing first and filtering after would re-create the exact collapse this
  // workstream exists to remove. `typeof value === 'number'` is checked before anything else.
  //
  // A GENUINELY MEASURED 0 STILL COUNTS. `0` is a number and is finite, so it survives the
  // guard and averages as zero. Only absence abstains.
  const observedGapImpacts = (params.competitorIntelligence.generated_gaps ?? [])
    .slice(0, 3)
    .map((gap) => gap.impact_score)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const competitorPressure: number | null = averageNumber(observedGapImpacts);
  const fallbackUsed =
    params.competitorIntelligence.discovery_metadata?.is_fallback_used === true ||
    params.competitorIntelligence.discovery_metadata?.serp_status === 'fallback';
  // WP-18 — business interpretation unchanged. With no observed pressure the penalty is 6,
  // which is exactly what the pre-fix `average([]) === 0` produced through the final `: 6`
  // arm. The arm is now reached because nothing was observed, not because a 0 was invented.
  const differentiationPenalty = fallbackUsed
    ? 8
    : competitorPressure == null
      ? 6
      : competitorPressure >= 70
        ? 22
        : competitorPressure >= 50
          ? 14
          : 6;
  const rawStrengthScore = clamp((claritySignals * 22) + (40 - Math.min(consistencyPenalties * 5, 25)) - differentiationPenalty, 0, 100);
  const positioningStrength: import('./types').PositioningStrength =
    rawStrengthScore >= 70 ? 'strong' : rawStrengthScore >= 45 ? 'moderate' : 'weak';

  const positioningNarrative =
    `${companyName}'s positioning as ${positioningLabel} is currently ${positioningStrength}, because clarity signals ${claritySignals >= 3 ? 'are visible' : 'are limited'} and cross-page reinforcement is ${consistencyPenalties <= 2 ? 'mostly consistent' : 'fragmented'}.`;
  const positioningGap = positioningStrength === 'weak'
    ? 'This positioning is not consistently reinforced in buyer-stage content and proof-led decision pages.'
    : positioningStrength === 'moderate'
      ? 'Positioning exists but is inconsistently reinforced in comparison and decision-stage content.'
      : null;

  const competitorCount = params.competitorIntelligence.detected_competitors.length;
  const marketType: import('./types').MarketType =
    // WP-18 — `competitorPressure == null` means no gap impact was observed, and an
    // unobserved pressure can no longer argue either for or against saturation. The
    // threshold (68) and every arm below are unchanged; with no evidence this evaluates
    // false, exactly as the pre-fix `0 >= 68` did.
    competitorCount >= 3 && competitorPressure != null && competitorPressure >= 68
      ? 'saturated'
      : competitorCount >= 2
        ? 'competitive'
        : params.publicAudit?.site_structure.blog_pages.length
          ? 'niche'
          : 'emerging';

  const keySuccessFactor =
    marketType === 'saturated'
      ? 'differentiated proof and authority depth'
      : marketType === 'competitive'
        ? 'consistent positioning plus stronger comparison-page coverage'
        : marketType === 'niche'
          ? 'focused relevance in core intent clusters'
          : 'early category ownership through clear positioning and coverage';
  const marketNarrative = `This market is ${marketType}, where ${keySuccessFactor} determines visibility.`;

  const strategyAlignment =
    positioningStrength === 'weak' && (marketType === 'saturated' || marketType === 'competitive')
      ? `Prioritize positioning clarity and proof architecture for ${companyName} before broad expansion.`
      : positioningStrength === 'strong' && (marketType === 'emerging' || marketType === 'niche')
        ? `Leverage ${companyName}'s clear positioning to expand coverage faster in core demand clusters.`
        : `Sequence positioning reinforcement with demand-capture execution so ${companyName} improves visibility without diluting differentiation.`;

  const competitorDeltas = (params.competitorIntelligence.comparison?.competitors ?? [])
    .map((item) => item.deltas_vs_company)
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    // WP-17 — UNAVAILABLE IS NOT A MEASURED ZERO.
    //
    // THE DEFECT. These three dimensions were read as `Number(delta.<dim> ?? 0)`. `?? 0`
    // turns an UNAVAILABLE dimension into the number 0 — a confident reading of "exactly at
    // parity on this axis" manufactured from nothing — and the denominator stayed pinned at 3
    // however little had actually been observed. Under this repository's `"strict": false`
    // compiler nothing flags it, and the declared type is not a runtime guarantee either:
    // `subtractMetrics` produces these deltas through `delta(...) as number`, and `delta()`
    // returns `null` whenever either operand is non-numeric.
    //
    // WHY IT IS WRITTEN THIS WAY NOW. `authority_score`, `seo_coverage` and `content_depth`
    // are exactly the non-nullable members of the canonical `ComparisonMetrics`, so the
    // dilution is inert *today*. It goes live the instant any one of them is widened to
    // `number | null` — which is the same step that made the identical construct in
    // `visualIntelligenceHelpers.ts` (WP-15) and `buildCompetitorStanding` (WP-12) publish
    // fabricated parity. Averaging only what was genuinely observed removes the trap before
    // the widening can spring it, and costs nothing while the contract stays narrow.
    //
    // THE CONTRACT. Take only dimensions carrying genuine numeric evidence, over a
    // denominator equal to that observed count. A genuinely MEASURED 0 is data and still
    // counts as 0. When a competitor has no observed dimension at all, `averageNumber`
    // returns null for the empty set and that entry drops out entirely — it becomes
    // indistinguishable from a competitor that was never compared, which routes the
    // decision down the abstention path this function ALREADY has on the line below
    // (`competitorPressure - 50`) instead of injecting a fabricated 0 into the mean.
    //
    // `marketPosition` is a closed three-value union with no representation for "unknown"
    // (see `StrategicContext` in ./types.ts), and widening it would cascade through the
    // PDF, export-renderer and canonical-report payloads owned by other workstreams. So
    // the conservative option the EXISTING contract allows is the one taken here: abstain
    // from the competitor-delta evidence, do not invent a state. No new vocabulary, no new
    // threshold, and the dimension order is preserved so a fully observed delta yields a
    // bit-identical mean to the pre-fix code.
    .map((delta) => averageNumber(
      [delta.authority_score, delta.seo_coverage, delta.content_depth]
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    ))
    .filter((value): value is number => value != null);
  // WP-18 — THE EVIDENCE LADDER, WITH A BOTTOM RUNG THAT ABSTAINS.
  //
  // Rung 1: at least one competitor carried an observed delta (WP-17 already guarantees each
  //         entry's own mean is observed-only). Unchanged.
  // Rung 2: no deltas, but at least one observed gap impact. Unchanged anchor and arithmetic
  //         (`competitorPressure - 50`).
  // Rung 3 (NEW): neither. `average([])` used to make this rung indistinguishable from rung 2
  //         with a pressure of exactly 0, producing `-50`, which cleared the `<= -4` arm and
  //         published 'ahead'. The report told a customer it was ahead of the market on zero
  //         competitive evidence. There is now no number here at all.
  const avgDelta: number | null = competitorDeltas.length > 0
    ? average(competitorDeltas)
    : competitorPressure != null
      ? competitorPressure - 50
      : null;
  const { marketPosition, marketPositionState } = resolveMarketPosition(avgDelta);
  const marketPositionStatement = marketPosition == null
    ? `${companyName}'s position relative to competitors could not be established: no competitive evidence was observed for this report.`
    : `${companyName} is currently ${marketPosition} relative to competitors in this market.`;
  const positionImplication =
    marketPosition == null
      ? 'No claim is made about relative market position until competitive evidence is observed. Connecting competitor comparison evidence will establish where this business actually stands.'
      : marketPosition === 'below market'
        ? 'If unchanged, this position will limit ability to compete for high-intent queries and reduce qualified demand capture.'
        : marketPosition === 'at parity'
          ? 'If unchanged, this position will maintain baseline visibility but make it hard to outpace stronger competitors in decision-stage queries.'
          : 'If unchanged, this position can hold near-term advantage, but weak reinforcement could erode lead as competitors increase depth.';
  const executionRisk =
    positioningStrength === 'weak'
      ? 'If content depth is not expanded alongside authority work, improvements may remain limited.'
      : marketType === 'saturated'
        ? 'If execution is fragmented across channels, gains will dilute and competitor pressure will outpace progress.'
        : 'If sequencing is inconsistent, visibility gains may appear but conversion lift can remain constrained.';
  const resilienceGuidance =
    'What ensures success: consistent content, authority, and structure alignment executed in the same priority sequence.';

  return {
    positioningStrength,
    positioningNarrative,
    positioningGap,
    marketType,
    marketNarrative,
    keySuccessFactor,
    strategyAlignment,
    marketPosition,
    marketPositionState,
    marketPositionStatement,
    positionImplication,
    executionRisk,
    resilienceGuidance,
  };
}

export function resolverInputsPresent(resolvedInput?: ResolvedReportInput | null): number {
  if (!resolvedInput) return 0;

  let count = 0;
  if (resolvedInput.resolved.websiteDomain) count += 1;
  if (resolvedInput.resolved.businessType) count += 1;
  if (resolvedInput.resolved.geography) count += 1;
  if (resolvedInput.resolved.socialLinks.length > 0) count += 1;
  if (resolvedInput.resolved.competitors.length > 0) count += 1;
  return count;
}

export function isSeoDecision(decision: PersistedDecisionObject): boolean {
  return [
    'seo_gap',
    'ranking_gap',
    'ranking_opportunity',
    'keyword_decay',
    'keyword_opportunity',
    'impression_click_gap',
  ].includes(decision.issue_type);
}

export function isGeoDecision(decision: PersistedDecisionObject): boolean {
  return [
    'geo_gap',
    'geo_mismatch',
    'geo_opportunity',
    'regional_mismatch',
    'wrong_geo_traffic',
    'localized_content_gap',
  ].includes(decision.issue_type) || classifyDecisionType(decision.issue_type) === 'geo';
}

export function isCompetitorDecision(decision: PersistedDecisionObject): boolean {
  return [
    'competitor_gap',
    'competitor_dominance',
    'competitor_content_gap',
    'competitor_backlink_advantage',
  ].includes(decision.issue_type);
}

export function describeBusinessContext(resolvedInput?: ResolvedReportInput | null): string {
  const businessType = resolvedInput?.resolved.businessType?.trim();
  const geography = resolvedInput?.resolved.geography?.trim();

  if (businessType && geography) return `${businessType} in ${geography}`;
  if (businessType) return businessType;
  if (geography) return `teams targeting ${geography}`;
  return 'the business';
}

export function inferPrimarySurface(decision: PersistedDecisionObject, resolvedInput?: ResolvedReportInput | null): string {
  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const keyword = typeof payload.keyword === 'string' ? payload.keyword : null;
  const theme = typeof payload.keyword_theme === 'string' ? payload.keyword_theme : null;
  const domain = resolvedInput?.resolved.websiteDomain || 'your site';

  if (keyword) return `"${keyword}"`;
  if (theme) return `"${theme}"`;
  if (isAuthorityDecision(decision)) return `${domain}'s trust surface`;
  if (isContentDecision(decision)) return `${domain}'s core content coverage`;
  return domain;
}

export function signalKeyFromIssueType(issueType: string): string {
  const category = classifyDecisionType(issueType);
  if (category === 'authority' || category === 'trust') return 'authority_signal';
  if (category === 'content_strategy' || category === 'market') return 'content_coverage_signal';
  if (category === 'geo' || category === 'distribution') return 'geo_relevance_signal';
  if (category === 'opportunity') return 'opportunity_gap_signal';
  if (/(keyword|ranking|impression_click_gap|visibility|search)/.test(issueType)) return 'visibility_signal';
  return 'technical_signal';
}

export function evidenceSignalFromDecision(decision: PersistedDecisionObject): string {
  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const evidence = (decision.evidence ?? {}) as Record<string, unknown>;
  const keyword =
    (typeof payload.keyword === 'string' && payload.keyword.trim()) ||
    (typeof payload.keyword_theme === 'string' && payload.keyword_theme.trim()) ||
    null;
  const avgPosition = typeof evidence.avg_position === 'number' ? evidence.avg_position : null;
  const mentionCount = typeof evidence.mention_count === 'number' ? evidence.mention_count : null;
  const baseSignal = signalKeyFromIssueType(decision.issue_type).replace(/_/g, ' ');

  if (keyword && avgPosition != null) return `${baseSignal}; ${keyword} avg position ${avgPosition.toFixed(1)}`;
  if (keyword && mentionCount != null) return `${baseSignal}; ${keyword} mentions ${mentionCount}`;
  if (keyword) return `${baseSignal}; keyword theme ${keyword}`;
  if (avgPosition != null) return `${baseSignal}; avg position ${avgPosition.toFixed(1)}`;
  if (mentionCount != null) return `${baseSignal}; mention count ${mentionCount}`;
  return baseSignal;
}

export function withEvidence(text: string, signal: string): string {
  const compact = text.trim().replace(/\s+/g, ' ');
  return `${compact} This is supported by ${signal}.`;
}

export function buildWhyItMatters(
  decision: PersistedDecisionObject,
  engineEvidence?: EngineEvidenceInput | null,
): string {
  const category = classifyDecisionType(decision.issue_type);
  const evidenceSignal = evidenceSignalFromDecision(decision);
  const base =
    category === 'authority' || category === 'trust'
      ? withEvidence('This directly affects whether buyers trust the brand enough to continue toward action.', evidenceSignal)
      : category === 'content_strategy' || category === 'market'
        ? withEvidence('This limits how often the business shows up for high-intent questions and comparison moments.', evidenceSignal)
        : category === 'geo' || category === 'distribution'
          ? withEvidence('This can cause the right audience to miss the offer or see it in the wrong context.', evidenceSignal)
          : category === 'opportunity'
            ? withEvidence('This is one of the clearest near-term gains available without requiring a full strategy reset.', evidenceSignal)
            : withEvidence('This is shaping discoverability, buyer confidence, or conversion quality in the near term.', evidenceSignal);
  // BETA-EXEC-004: append the measured driver from the mapped engine domain, when available.
  // Deterministic; returns null (no tail) when the decision does not map to a measured domain.
  const tail = engineEvidence
    ? evidenceTailForDecision(`${decision.issue_type} ${decision.action_type}`, engineEvidence)
    : null;
  return tail ? `${base} ${tail}` : base;
}

export function inferEffortLevel(decision: PersistedDecisionObject): 'low' | 'medium' | 'high' {
  const effort = Number(decision.effort_score ?? 0);
  if (effort <= 25) return 'low';
  if (effort <= 55) return 'medium';
  return 'high';
}
