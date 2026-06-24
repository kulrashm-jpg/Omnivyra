/**
 * customerDataFoundationService.ts
 *
 * READ-ONLY. Determines — from evidence only — whether Omnivyra has enough trustworthy
 * customer data to support recommendation / automation / lifecycle systems. Pure,
 * deterministic scoring over the measured outputs of 12A–15D. No recommendations generated,
 * no automation, no writes. UNKNOWN stays UNKNOWN.
 */

export type MaturityLevel = 'LEVEL_0' | 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | 'LEVEL_4';
export type FoundationStatus = 'FOUNDATION_READY' | 'FOUNDATION_PARTIAL' | 'FOUNDATION_INSUFFICIENT';
export type Readiness = 'READY' | 'PARTIAL' | 'NOT_READY';
export type JourneyObservability = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'UNOBSERVABLE';

export interface FoundationInput {
  population: { total: number; customer: number; qa: number; test: number; internal: number; unknown: number };
  telemetry_coverage_pct: number;        // 13H structural observability
  confidence: { high: number; medium: number; low: number; unknown: number }; // 13E signal counts
  revenue: { coverage_pct: number; customer_revenue_count: number; mrr_known: boolean }; // 15D
  value_coverage_pct: number;            // 14E % of population with value
  joinability: { joinable: number; total: number }; // audited entity joins
}

const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface FoundationScores { coverage_score: number; confidence_score: number; joinability_score: number; customer_integrity_score: number; telemetry_score: number; }

/** Pure: the five trust scores. */
export function computeFoundationScores(i: FoundationInput): FoundationScores {
  const confTotal = i.confidence.high + i.confidence.medium + i.confidence.low + i.confidence.unknown;
  return {
    customer_integrity_score: pct(i.population.customer, i.population.total),
    telemetry_score: round1(i.telemetry_coverage_pct),
    confidence_score: pct(i.confidence.high + i.confidence.medium, confTotal),
    joinability_score: pct(i.joinability.joinable, i.joinability.total),
    coverage_score: round1((i.revenue.coverage_pct + i.value_coverage_pct) / 2),
  };
}

// Weights — integrity dominates (contamination is the platform's central problem).
const WEIGHTS = { customer_integrity_score: 0.3, telemetry_score: 0.2, confidence_score: 0.2, joinability_score: 0.15, coverage_score: 0.15 };

export function computeFoundationScore(s: FoundationScores): number {
  return round1(Object.entries(WEIGHTS).reduce((a, [k, w]) => a + (s as any)[k] * w, 0));
}

/** Deterministic maturity level. Integrity < 20 caps maturity at visibility-only. */
export function computeMaturity(foundation: number, s: FoundationScores): MaturityLevel {
  let level: MaturityLevel = foundation < 20 ? 'LEVEL_0' : foundation < 40 ? 'LEVEL_1' : foundation < 60 ? 'LEVEL_2' : foundation < 80 ? 'LEVEL_3' : 'LEVEL_4';
  // Hard cap: without a trustworthy customer population you cannot exceed visibility.
  if (s.customer_integrity_score < 20 && (level === 'LEVEL_2' || level === 'LEVEL_3' || level === 'LEVEL_4')) level = 'LEVEL_1';
  return level;
}

export interface JourneyReadiness { journey: string; observability: JourneyObservability; }
// Deterministic journey observability (from 12A–15D evidence).
const JOURNEYS: JourneyReadiness[] = [
  { journey: 'acquisition', observability: 'PARTIAL' },     // 14A unjoinable cohorts
  { journey: 'onboarding', observability: 'PARTIAL' },      // 14A mid-funnel dark
  { journey: 'activation', observability: 'COMPLETE' },     // 14B readiness-based
  { journey: 'adoption', observability: 'PARTIAL' },        // 14D connection-presence
  { journey: 'value_realization', observability: 'PARTIAL' }, // 14E engagement blind
  { journey: 'execution', observability: 'PARTIAL' },       // 14G vendor-dominated
  { journey: 'monetization', observability: 'UNKNOWN' },    // 15D revenue UNKNOWN
  { journey: 'retention', observability: 'UNKNOWN' },       // no time-series (day-1 snapshots)
];

const OBS_WEIGHT: Record<JourneyObservability, number | null> = { COMPLETE: 1, PARTIAL: 0.5, UNKNOWN: 0, UNOBSERVABLE: null };

export function computeTelemetryReadiness(): { journeys: JourneyReadiness[]; telemetry_readiness_score: number } {
  const scored = JOURNEYS.filter((j) => OBS_WEIGHT[j.observability] != null);
  const score = scored.length ? round1((scored.reduce((a, j) => a + (OBS_WEIGHT[j.observability] as number), 0) / scored.length) * 100) : 0;
  return { journeys: JOURNEYS, telemetry_readiness_score: score };
}

// Readiness gating: a category is READY only if ALL its required scores clear the bar.
const REC_BAR = 60, REC_PARTIAL = 35;
function gate(scores: number[], bar: number, partial: number): Readiness {
  const min = Math.min(...scores);
  return min >= bar ? 'READY' : min >= partial ? 'PARTIAL' : 'NOT_READY';
}

export interface RecommendationReadiness { category: string; readiness: Readiness; limiting_factor: string }
export function computeRecommendationReadiness(s: FoundationScores, revenueKnown: boolean): RecommendationReadiness[] {
  const I = s.customer_integrity_score, C = s.confidence_score, T = s.telemetry_score, J = s.joinability_score, V = s.coverage_score;
  const mk = (category: string, scores: Array<[string, number]>): RecommendationReadiness => {
    const r = gate(scores.map(([, v]) => v), REC_BAR, REC_PARTIAL);
    const limiting = scores.reduce((m, x) => (x[1] < m[1] ? x : m))[0];
    return { category, readiness: r, limiting_factor: limiting };
  };
  return [
    mk('customer_recommendations', [['integrity', I], ['confidence', C]]),
    mk('customer_success_actions', [['integrity', I], ['telemetry', T]]),
    mk('growth_actions', [['integrity', I], ['value_coverage', V]]),
    mk('onboarding_guidance', [['integrity', I], ['telemetry', T], ['joinability', J]]),
    mk('retention_actions', [['integrity', I], ['telemetry', T]]),
    { category: 'monetization_actions', readiness: revenueKnown ? gate([I, V], REC_BAR, REC_PARTIAL) : 'NOT_READY', limiting_factor: revenueKnown ? 'integrity' : 'revenue UNKNOWN' },
  ];
}

const AUTO_BAR = 75, AUTO_PARTIAL = 55;
export interface AutomationReadiness { category: string; readiness: Readiness; limiting_factor: string }
export function computeAutomationReadiness(s: FoundationScores, telemetryReadiness: number): AutomationReadiness[] {
  const I = s.customer_integrity_score, C = s.confidence_score, J = s.joinability_score, T = telemetryReadiness;
  // Automation additionally HARD-requires integrity ≥ 50 (never automate on a contaminated population).
  const mk = (category: string, scores: number[]): AutomationReadiness => {
    const limiting = ['integrity', 'confidence', 'joinability', 'telemetry'][scores.indexOf(Math.min(...scores))];
    if (I < 50) return { category, readiness: 'NOT_READY', limiting_factor: 'customer integrity < 50 (contaminated population)' };
    return { category, readiness: gate(scores, AUTO_BAR, AUTO_PARTIAL), limiting_factor: limiting };
  };
  return [
    mk('alerts', [I, C, T]),
    mk('notifications', [I, C, J]),
    mk('interventions', [I, C, J, T]),
    mk('lifecycle_workflows', [I, C, J, T]),
    mk('autonomous_customer_success', [I, C, J, T]),
  ];
}

export interface FoundationResult {
  scores: FoundationScores; foundation_score: number; foundation_status: FoundationStatus; maturity_level: MaturityLevel;
  population: { total: number; customer: number; qa: number; test: number; internal: number; unknown: number; customer_purity_pct: number; contamination_pct: number };
  telemetry: { journeys: JourneyReadiness[]; telemetry_readiness_score: number };
  recommendation_readiness: RecommendationReadiness[];
  automation_readiness: AutomationReadiness[];
  answers: { dataset_trustworthy: string; recommendation_safe: string; automation_safe: string; maturity: string };
  unknown_gaps: string[];
}

/** Pure orchestrator. Read-only, evidence-only. */
export function calculateDataFoundation(i: FoundationInput): FoundationResult {
  const scores = computeFoundationScores(i);
  const foundation_score = computeFoundationScore(scores);
  const maturity_level = computeMaturity(foundation_score, scores);
  const telemetry = computeTelemetryReadiness();
  const foundation_status: FoundationStatus = foundation_score >= 60 ? 'FOUNDATION_READY' : foundation_score >= 35 ? 'FOUNDATION_PARTIAL' : 'FOUNDATION_INSUFFICIENT';
  const recommendation_readiness = computeRecommendationReadiness(scores, i.revenue.mrr_known);
  const automation_readiness = computeAutomationReadiness(scores, telemetry.telemetry_readiness_score);
  const purity = pct(i.population.customer, i.population.total);

  return {
    scores, foundation_score, foundation_status, maturity_level,
    population: { ...i.population, customer_purity_pct: purity, contamination_pct: round1(100 - purity) },
    telemetry, recommendation_readiness, automation_readiness,
    answers: {
      dataset_trustworthy: purity < 50 ? `NO — only ${purity}% of the population are real customers (${round1(100 - purity)}% QA/test/internal contamination).` : `PARTIAL — ${purity}% real customers.`,
      recommendation_safe: recommendation_readiness.some((r) => r.readiness === 'READY') ? 'PARTIAL — some categories ready.' : 'NO — no recommendation category is READY (integrity/confidence/coverage too low).',
      automation_safe: automation_readiness.every((a) => a.readiness === 'NOT_READY') ? 'NO — automation is unsafe (customer integrity below the hard 50 bar).' : 'PARTIAL.',
      maturity: maturity_level === 'LEVEL_0' ? 'LEVEL_0 (unusable)' : maturity_level === 'LEVEL_1' ? 'LEVEL_1 (visibility only)' : maturity_level === 'LEVEL_2' ? 'LEVEL_2 (operational)' : maturity_level === 'LEVEL_3' ? 'LEVEL_3 (recommendation-ready)' : 'LEVEL_4 (automation-ready)',
    },
    unknown_gaps: [
      'MRR/ARR/revenue UNKNOWN (15D) — monetization actions cannot be evidence-grounded',
      'retention/monetization journeys UNKNOWN — no time-series / no per-company revenue',
      'customer population is small (n=5 real) → all customer-only metrics are low-confidence',
    ],
  };
}
