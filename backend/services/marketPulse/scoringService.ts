/**
 * Market Pulse — Centralized Scoring Service.
 *
 * Single source of truth for per-finding scoring. Replaces the scattered
 * `?? 65 / ?? 60 / 75` literals previously inlined in
 * `marketPulseV2Service.syncLegacyJobIntoRun`.
 *
 * BEHAVIOR-PRESERVING by default:
 *   - When invoked without enrichment data, returns the same numeric defaults
 *     the legacy code produced (relevance=65, confidence=60 or run.confidence_index,
 *     freshness=75). Existing rankings stay stable.
 *
 * ADDITIVE on top of that:
 *   - When topic momentum / risk / company context are present, scores reflect
 *     them. Higher signal → higher score → better ranking. Lower bound is the
 *     legacy default so no current row regresses.
 *
 * NEW FIELDS (additive, nullable in DB):
 *   - priority_tier:        'P0' | 'P1' | 'P2'
 *   - severity_modifier:    0..1 multiplier (currently flat 1.0; reserved for
 *                           Phase 1B per-category severity dampening)
 *   - company_alignment_score: 0..1 from token overlap with company context
 */

import type { MarketPulseExecutorContext } from './executorContext';

export type ImpactType = 'opportunity' | 'risk' | 'watch';
export type PriorityTier = 'P0' | 'P1' | 'P2';

export interface ScoreFindingTopic {
  title: string;
  summary?: string | null;
  /** Per-topic 0..1 momentum (LLM-emitted or DB-aggregated). */
  momentum_score?: number | null;
  /** Per-topic 0..1 confidence. Currently rare; falls back to run-level. */
  confidence_score?: number | null;
  /** LOW | MEDIUM | HIGH (case-insensitive). */
  risk_level?: string | null;
  regions?: string[];
  primary_category?: string | null;
  narrative_phase?: string | null;
  shelf_life_days?: number | null;
  velocity_score?: number | null;
}

export interface ScoreFindingRunContext {
  /** 0..100 from `marketPulseJobProcessor.computeConfidenceIndex`. */
  confidence_index?: number | null;
  /** Run started_at (ISO). Used for freshness when topic timestamp absent. */
  started_at?: string | null;
  objective?: string | null;
}

export interface ScoreFindingInputs {
  topic: ScoreFindingTopic;
  run: ScoreFindingRunContext;
  /** V2 taxonomy category (already mapped from V1 if applicable). */
  category: string;
  /** Resolved impact type. */
  impactType: ImpactType;
  /**
   * Company-aware enrichment block. Pass `null` to preserve pre-Phase-1A
   * defaults exactly. Pass populated object to enable alignment scoring.
   */
  companyContext?: MarketPulseExecutorContext | null;
}

export interface ScoreFindingOutput {
  relevance_score: number;          // 0..100
  confidence_score: number;         // 0..100
  freshness_score: number;          // 0..100
  priority_tier: PriorityTier;
  severity_modifier: number;        // 0..1
  company_alignment_score: number;  // 0..1
}

const LEGACY_RELEVANCE_DEFAULT = 65;
const LEGACY_CONFIDENCE_DEFAULT = 60;
const LEGACY_FRESHNESS_DEFAULT = 75;

/** Clamp to inclusive [min, max]. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/** Lowercase tokenizer used for Jaccard alignment scoring. */
function tokenize(text: string): Set<string> {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

/** Normalize an array of context strings into a deduped lowercase token set. */
function tokensFromList(values: Array<string | null | undefined> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(values)) return out;
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    for (const token of tokenize(text)) out.add(token);
  }
  return out;
}

/**
 * Compute company alignment as Jaccard overlap between topic text and the
 * union of company-context terms (competitors, growth_priorities,
 * solution_domains, regulatory_sensitivity, core_offerings, business_model,
 * provider_type, domain_role, partnership_priorities, hiring_functions,
 * market_alternatives, operating_model).
 *
 * Region match adds a +0.15 boost (capped at 1.0).
 *
 * Returns 0.5 (neutral) when no company context provided — preserves legacy
 * behavior where alignment was implicit/uniform.
 */
export function computeCompanyAlignment(
  topic: ScoreFindingTopic,
  context: MarketPulseExecutorContext | null | undefined,
): number {
  if (!context) return 0.5;

  const topicText = `${topic.title ?? ''} ${topic.summary ?? ''}`;
  const topicTokens = tokenize(topicText);
  if (topicTokens.size === 0) return 0.5;

  const competitorTerms = [
    ...(context.named_competitors ?? []),
    ...((context.competitor_details ?? []).map((c) => c?.name).filter(Boolean) as string[]),
    ...((context.market_alternatives ?? []).map((m) => m?.name).filter(Boolean) as string[]),
  ];

  const contextTerms = [
    ...competitorTerms,
    ...(context.growth_priorities ?? []),
    ...(context.partnership_priorities ?? []),
    ...(context.regulatory_policy_sensitivity ?? []),
    ...(context.solution_domains ?? []),
    ...(context.core_offerings ?? []),
    ...(context.critical_hiring_functions ?? []),
    context.business_model ?? null,
    context.provider_type ?? null,
    context.domain_role ?? null,
    context.operating_model ?? null,
  ];

  const contextTokens = tokensFromList(contextTerms);
  if (contextTokens.size === 0) return 0.5;

  let intersection = 0;
  for (const token of topicTokens) {
    if (contextTokens.has(token)) intersection++;
  }
  const union = topicTokens.size + contextTokens.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;

  // Region overlap is a strong alignment signal — small additive boost.
  const operatingMarkets = tokensFromList(context.primary_operating_markets ?? []);
  const expansionMarkets = tokensFromList(context.target_expansion_markets ?? []);
  const topicRegionTokens = tokensFromList(topic.regions ?? []);
  let regionBoost = 0;
  for (const token of topicRegionTokens) {
    if (operatingMarkets.has(token) || expansionMarkets.has(token)) {
      regionBoost = 0.15;
      break;
    }
  }

  // Jaccard tends to be small (token universes are large); rescale upward so
  // a single legitimate competitor-name match registers visibly. Capped at 1.0.
  const rescaled = Math.min(1, jaccard * 6);
  return clamp(rescaled + regionBoost, 0, 1);
}

/**
 * Step-function freshness score in 0..100. Mirrors the recency curve in
 * `marketPulseAggregationService.computeRecencyScore` so V2 findings and
 * aggregated signals share a freshness scale.
 */
function computeFreshnessFromAge(ageMs: number): number {
  const hours = ageMs / (60 * 60 * 1000);
  if (hours <= 6) return 100;
  if (hours <= 24) return 90;
  if (hours <= 48) return 75;
  if (hours <= 72) return 60;
  if (hours <= 120) return 45;
  return 30;
}

/**
 * Severity modifier. Currently a flat 1.0 — reserved for Phase 1B per-category
 * dampening (e.g., demand_category_momentum risks dampened vs regulatory_policy
 * risks). Returning a value lets the persisted column be populated now without
 * back-fill later.
 */
function computeSeverityModifier(
  _category: string,
  _impactType: ImpactType,
  _context: MarketPulseExecutorContext | null | undefined,
): number {
  return 1.0;
}

const IMPACT_WEIGHT: Record<ImpactType, number> = {
  risk: 1.0,
  watch: 0.6,
  opportunity: 0.5,
};

/**
 * Composite score → priority tier.
 *
 *   composite = impact_weight * 0.35
 *             + (confidence_score / 100) * 0.25
 *             + (relevance_score / 100) * 0.25
 *             + alignment * 0.15
 *
 *   P0: composite >= 0.75
 *   P1: composite >= 0.50
 *   P2: otherwise
 */
export function derivePriorityTier(
  impactType: ImpactType,
  confidenceScore: number,
  relevanceScore: number,
  companyAlignment: number,
  severityModifier: number,
): PriorityTier {
  const impactComponent = (IMPACT_WEIGHT[impactType] ?? 0.5) * severityModifier;
  const composite =
    impactComponent * 0.35 +
    clamp(confidenceScore / 100, 0, 1) * 0.25 +
    clamp(relevanceScore / 100, 0, 1) * 0.25 +
    clamp(companyAlignment, 0, 1) * 0.15;

  if (composite >= 0.75) return 'P0';
  if (composite >= 0.5) return 'P1';
  return 'P2';
}

/**
 * Single entry point for per-finding scoring.
 *
 * Behavior matrix:
 *   - topic.momentum_score present  → relevance = momentum * 100; else 65
 *   - topic.confidence_score present → confidence = confidence * 100;
 *     else run.confidence_index ?? 60
 *   - run.started_at present         → freshness = step(ageMs); else 75
 *   - companyContext present         → alignment via Jaccard + region boost;
 *                                       else 0.5 (neutral)
 *
 * All four scores are clamped to [0, 100] (or [0, 1] for alignment / severity).
 */
export function scoreFinding(input: ScoreFindingInputs): ScoreFindingOutput {
  const { topic, run, category, impactType, companyContext } = input;

  // Relevance — prefer topic momentum (0..1) when provided.
  const relevance_score =
    typeof topic.momentum_score === 'number' && Number.isFinite(topic.momentum_score)
      ? clamp(topic.momentum_score * 100, 0, 100)
      : LEGACY_RELEVANCE_DEFAULT;

  // Confidence — prefer per-topic confidence, fall back to run-level index,
  // then to legacy default.
  let confidence_score: number;
  if (typeof topic.confidence_score === 'number' && Number.isFinite(topic.confidence_score)) {
    confidence_score = clamp(topic.confidence_score * 100, 0, 100);
  } else if (typeof run.confidence_index === 'number' && Number.isFinite(run.confidence_index)) {
    confidence_score = clamp(run.confidence_index, 0, 100);
  } else {
    confidence_score = LEGACY_CONFIDENCE_DEFAULT;
  }

  // Freshness — derive from run start time when available; else legacy literal.
  let freshness_score = LEGACY_FRESHNESS_DEFAULT;
  if (run.started_at) {
    const startedAt = new Date(run.started_at).getTime();
    if (Number.isFinite(startedAt)) {
      freshness_score = computeFreshnessFromAge(Date.now() - startedAt);
    }
  }

  // Company alignment — neutral 0.5 when no context supplied.
  const company_alignment_score = computeCompanyAlignment(topic, companyContext ?? null);

  // Severity modifier — 1.0 for now; reserved for category-aware dampening.
  const severity_modifier = computeSeverityModifier(category, impactType, companyContext ?? null);

  const priority_tier = derivePriorityTier(
    impactType,
    confidence_score,
    relevance_score,
    company_alignment_score,
    severity_modifier,
  );

  return {
    relevance_score,
    confidence_score,
    freshness_score,
    priority_tier,
    severity_modifier,
    company_alignment_score,
  };
}

/**
 * Cohort-level digest used by alert wiring + UI summary chips.
 * Returns counts grouped by priority_tier across an array of scored findings.
 */
export function summarizePriorityTiers(
  scores: Array<Pick<ScoreFindingOutput, 'priority_tier'>>,
): { P0: number; P1: number; P2: number; total: number } {
  const out = { P0: 0, P1: 0, P2: 0, total: scores.length };
  for (const s of scores) {
    if (s.priority_tier === 'P0') out.P0++;
    else if (s.priority_tier === 'P1') out.P1++;
    else out.P2++;
  }
  return out;
}
