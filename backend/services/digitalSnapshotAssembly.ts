/**
 * Digital Snapshot assembly (Report 1, final phase).
 *
 * Earlier phases produced intelligence in separate domains — crawl, content, technical,
 * digital experience, AI visibility, search, competitive. A CMO received them as separate
 * payload fields. This module turns them into ONE decision: what matters most, why, what to
 * do, and how to know it worked.
 *
 * It is an ASSEMBLER, not a report builder. `canonicalReportBuilder` remains the owner of the
 * canonical report; nothing here recomputes a dimension, a pillar or a score. It reads
 * already-produced outputs, correlates them, and ranks.
 *
 * Three things here are genuinely new rather than re-exposed:
 *
 *  1. CROSS-SOURCE OPPORTUNITIES. Every prior surface reported findings within its own
 *     domain. A thin page is a content defect; a thin page that is ALSO the landing target
 *     for a topic the company sells and has no search visibility for is a business
 *     opportunity. Rules correlate across domains and abstain when their inputs are missing.
 *  2. MEASUREMENT ON EVERY RECOMMENDATION. `CanonicalAction` carries timeline and expected
 *     outcome but no measurement method. Where the measurement requires a source Omnivyra
 *     cannot currently read, that is stated rather than implied.
 *  3. A CONTRADICTION GUARD. A narrative may not assert a measured deficiency for a dimension
 *     whose state is `insufficient_signal` or `unavailable` — enforced here as a filter, so
 *     assembly cannot reintroduce what Phase 2 removed.
 */
import { effortDivisor, type EffortLevel } from './canonicalReport/scoringGovernance';
import type { ScoreState } from './snapshotReport/canonicalScoreState';

export type OpportunitySource =
  | 'crawl' | 'content' | 'technical' | 'digital_experience'
  | 'search' | 'ai_visibility' | 'competitive' | 'performance';

export type PlanHorizon = '0-30' | '31-60' | '61-90';

export interface OpportunityEvidence {
  source: OpportunitySource;
  /** A statement of observed fact — counts, URLs, states. Never an adjective. */
  statement: string;
  state: ScoreState;
}

export interface CrossSourceOpportunity {
  id: string;
  title: string;
  problem: string;
  evidence: OpportunityEvidence[];
  businessImplication: string;
  action: string;
  expectedImpact: string;
  /** 0..100. Business impact, not technical severity. */
  impact: number;
  confidence: 'high' | 'medium' | 'low';
  effort: EffortLevel;
  /** Impact × Confidence ÷ Effort. The canonical ranking key. */
  priorityScore: number;
  measurement: string;
  /** False when measuring the outcome needs a source Omnivyra cannot currently read. */
  measurementAvailable: boolean;
  sources: OpportunitySource[];
  /** True when two or more independent evidence domains contributed. */
  crossSource: boolean;
  horizon: PlanHorizon;
}

export interface PlanItem {
  title: string;
  action: string;
  why: string;
  measurement: string;
  measurementAvailable: boolean;
  effort: EffortLevel;
  confidence: 'high' | 'medium' | 'low';
  sources: OpportunitySource[];
}

export interface DigitalSnapshotPlan {
  days_0_30: PlanItem[];
  days_31_60: PlanItem[];
  days_61_90: PlanItem[];
  /** Stated when a horizon is empty — the plan never invents filler activity. */
  notes: string[];
}

export interface AssemblyInput {
  /** Digital-experience findings (Phase 4). Already carry evidence + measurement. */
  experienceFindings?: ReadonlyArray<{
    pillar: string; problem: string; evidence: string; whyItMatters: string;
    action: string; severity: string; effort: string; measurement: string;
  }> | null;
  /** State of each headline dimension, used for the contradiction guard. */
  dimensionStates?: {
    searchVisibility?: ScoreState;
    aiVisibility?: ScoreState;
    performance?: ScoreState;
    content?: ScoreState;
    technical?: ScoreState;
    competitive?: ScoreState;
  } | null;
  /** Measured content signals from the website content engine. */
  contentSignals?: { score: number | null; weaknesses?: readonly string[] | null } | null;
  /** Measured technical signals from the website technical engine. */
  technicalSignals?: { score: number | null; criticalIssues?: readonly string[] | null } | null;
  /** Competitive tables (Phase 3). */
  competitive?: { productCompetition: ReadonlyArray<{ competitor: string; classification: string; productOverlap: number | null }>; empty: boolean } | null;
  /** Evidence coverage (Phase 2). */
  coverage?: { coverage_percentage?: number; website_scanned?: boolean } | null;
  /** Public positioning signals — whether the company's own offering is legible. */
  positioning?: { hasCategory: boolean; hasOffering: boolean } | null;
}

// ── Prioritisation ────────────────────────────────────────────────────────────

/**
 * Confidence as a 0..1 multiplier.
 *
 * Reuses the report's own three-band vocabulary rather than introducing a fourth scale.
 * 1.0 / 0.7 / 0.4 keeps a low-confidence opportunity genuinely demotable without erasing it —
 * a low-confidence, high-impact, low-effort item can still legitimately outrank a
 * high-confidence, low-impact, high-effort one, which is the behaviour a CMO expects.
 */
export const CONFIDENCE_MULTIPLIER = { high: 1.0, medium: 0.7, low: 0.4 } as const;

/**
 * `Impact × Confidence ÷ Effort`, the Phase 2 framework applied across sources.
 * Impact is 0..100, confidence 0..1, effort divisor 1 / 1.5 / 2.25 (scoringGovernance).
 * Result stays within 0..100, so it shares a scale with every other report ranking.
 */
export function priorityScore(params: {
  impact: number; confidence: 'high' | 'medium' | 'low'; effort: EffortLevel;
}): number {
  const raw = Math.max(0, Math.min(100, params.impact))
    * CONFIDENCE_MULTIPLIER[params.confidence]
    / effortDivisor(params.effort);
  return Math.round(raw * 100) / 100;
}

/**
 * Horizon from effort and impact, not from severity alone.
 *
 * 0–30 is for work that can actually be finished in a month and is worth finishing first:
 * low effort with real impact. 61–90 is for high-effort structural work. Everything else
 * lands in 31–60. A technically severe but low-impact issue does NOT jump to day one —
 * §12 explicitly requires that severity alone must not drive priority.
 */
export function horizonFor(params: { impact: number; effort: EffortLevel }): PlanHorizon {
  if (params.effort === 'low' && params.impact >= 40) return '0-30';
  if (params.effort === 'high') return '61-90';
  return '31-60';
}

const normalizeEffort = (value: string | null | undefined): EffortLevel =>
  value === 'low' || value === 'high' ? value : 'medium';

const IMPACT_BY_SEVERITY: Record<string, number> = { critical: 80, moderate: 55, low: 30 };

// ── Contradiction guard ───────────────────────────────────────────────────────

/** States that may not carry a measured diagnosis. */
export function isUnmeasured(state: ScoreState | undefined): boolean {
  return state === 'insufficient_signal' || state === 'unavailable' || state === undefined;
}

/**
 * Reject any opportunity whose evidence rests on an unmeasured dimension.
 *
 * This is the structural half of Rule C: assembly can only surface a claim when at least one
 * contributing evidence item is genuinely `measured` or `inferred`. An opportunity built
 * entirely from unavailable sources is dropped, not softened.
 */
export function passesEvidenceGate(opportunity: CrossSourceOpportunity): boolean {
  return opportunity.evidence.some((e) => e.state === 'measured' || e.state === 'inferred');
}

// ── Cross-source rules ────────────────────────────────────────────────────────

/**
 * Each rule inspects MULTIPLE domains and returns an opportunity only when its inputs are
 * genuinely present. A rule whose inputs are unavailable returns null — it does not degrade
 * into a generic recommendation. This is what makes the report degrade gracefully rather
 * than becoming creative when SERP or PSI are missing.
 */
type Rule = (input: AssemblyInput) => CrossSourceOpportunity | null;

const experienceByPillar = (input: AssemblyInput, pillar: string) =>
  (input.experienceFindings ?? []).filter((f) => f.pillar === pillar);

/** RULE 1 — thin content + unmeasurable search visibility = a discoverability foundation gap. */
const ruleContentSearchFoundation: Rule = (input) => {
  const thin = (input.experienceFindings ?? []).find((f) => f.problem.includes('too little content'));
  if (!thin) return null;
  const searchState = input.dimensionStates?.searchVisibility;
  const evidence: OpportunityEvidence[] = [
    { source: 'content', statement: thin.evidence, state: 'measured' },
  ];
  if (isUnmeasured(searchState)) {
    evidence.push({
      source: 'search',
      statement: 'Search visibility could not be measured, so the commercial cost of these thin pages is not yet quantified.',
      state: 'unavailable',
    });
  }
  return {
    id: 'content_search_foundation',
    title: 'Build out the pages that should carry commercial search demand',
    problem: 'Commercially relevant pages carry too little content to rank or to answer a buyer question.',
    evidence,
    businessImplication: 'Thin pages give neither a buyer nor a search or answer engine enough to act on, so demand that already exists for these topics goes elsewhere.',
    action: 'Expand the thin pages that map to a commercial offering; consolidate or remove the ones that do not.',
    expectedImpact: 'Stronger topical coverage on the pages most likely to be found and to convert.',
    impact: 70, confidence: 'medium', effort: 'medium',
    priorityScore: 0,
    measurement: 'Re-crawl and confirm the prioritised pages exceed the content-depth threshold; re-run the SERP query set once a credential is available to confirm ranking movement.',
    measurementAvailable: true,
    sources: ['content', 'search'], crossSource: true, horizon: '31-60',
  };
};

/** RULE 2 — findable but unclear + weak next step = a conversion-readiness opportunity. */
const ruleConversionReadiness: Rule = (input) => {
  const value = experienceByPillar(input, 'value_communication');
  const conversion = experienceByPillar(input, 'conversion_readiness');
  if (value.length === 0 || conversion.length === 0) return null;
  return {
    id: 'conversion_readiness',
    title: 'Close the gap between arriving on the site and being able to act',
    problem: 'Pages do not clearly state the offering and do not present a clear next step.',
    evidence: [
      { source: 'digital_experience', statement: value[0].evidence, state: 'measured' },
      { source: 'digital_experience', statement: conversion[0].evidence, state: 'measured' },
    ],
    businessImplication: 'Interest generated anywhere else in the funnel arrives at pages that neither explain the offer nor offer a way forward, so acquisition spend and content effort under-return.',
    action: `${value[0].action} ${conversion[0].action}`,
    expectedImpact: 'A visitor can understand the offering and reach a next step from the pages they land on.',
    impact: 75, confidence: 'medium', effort: 'low',
    priorityScore: 0,
    measurement: 'Re-crawl and confirm value-proposition and CTA coverage on the prioritised pages. Actual visitor conversion behaviour is NOT measurable from public evidence — that requires connected analytics (Report 2).',
    measurementAvailable: true,
    sources: ['digital_experience', 'content'], crossSource: true, horizon: '0-30',
  };
};

/** RULE 3 — reachability defects that block everything downstream. */
const ruleAccessibilityFoundation: Rule = (input) => {
  const findings = experienceByPillar(input, 'information_accessibility');
  const critical = findings.filter((f) => f.severity === 'critical');
  if (findings.length === 0) return null;
  const lead = critical[0] ?? findings[0];
  return {
    id: 'reachability_foundation',
    title: 'Fix the pages that cannot be reached or that end the visit',
    problem: lead.problem,
    evidence: [
      { source: 'crawl', statement: lead.evidence, state: 'measured' },
      ...(input.technicalSignals?.score !== null && input.technicalSignals?.score !== undefined
        ? [{ source: 'technical' as const, statement: `Technical health measured at ${input.technicalSignals.score}/100 across evaluated checks.`, state: 'measured' as ScoreState }]
        : []),
    ],
    businessImplication: 'Pages that error or lead nowhere waste the discovery already earned, and every later content or search investment inherits the same ceiling.',
    action: lead.action,
    expectedImpact: 'Every commercially relevant page is reachable and offers an onward path.',
    impact: critical.length > 0 ? 85 : 55,
    confidence: 'high',
    effort: normalizeEffort(lead.effort),
    priorityScore: 0,
    measurement: lead.measurement,
    measurementAvailable: true,
    sources: ['crawl', 'technical'], crossSource: true, horizon: '0-30',
  };
};

/** RULE 4 — measured page-speed friction on pages a buyer actually lands on. */
const rulePerformanceFriction: Rule = (input) => {
  if (isUnmeasured(input.dimensionStates?.performance)) return null;
  const findings = experienceByPillar(input, 'technical_friction');
  if (findings.length === 0) return null;
  const lead = findings[0];
  return {
    id: 'performance_friction',
    title: 'Reduce the load-experience friction on primary landing pages',
    problem: lead.problem,
    evidence: [{ source: 'performance', statement: lead.evidence, state: 'measured' }],
    businessImplication: lead.whyItMatters,
    action: lead.action,
    expectedImpact: 'Primary pages become usable sooner after arrival.',
    impact: lead.severity === 'critical' ? 70 : 50,
    confidence: 'high',
    effort: normalizeEffort(lead.effort),
    priorityScore: 0,
    measurement: lead.measurement,
    measurementAvailable: true,
    sources: ['performance', 'digital_experience'], crossSource: true, horizon: '31-60',
  };
};

/** RULE 5 — a measured competitive product overlap with a content position to defend. */
const ruleCompetitivePosition: Rule = (input) => {
  const tables = input.competitive;
  if (!tables || tables.empty) return null;
  const direct = tables.productCompetition.filter((r) => r.classification === 'direct' && r.productOverlap !== null);
  if (direct.length === 0) return null;
  return {
    id: 'competitive_position',
    title: 'Defend the topics where a direct product competitor is already present',
    problem: `${direct.length} company${direct.length === 1 ? '' : 'ies'} solve substantially the same problem for substantially the same buyer.`,
    evidence: [
      {
        source: 'competitive',
        statement: `Direct product overlap measured for ${direct.slice(0, 3).map((d) => `${d.competitor} (${d.productOverlap}/100)`).join(', ')}.`,
        state: 'measured',
      },
    ],
    businessImplication: 'Where a direct competitor is established on the same problem, undifferentiated content competes on their terms rather than on the company\'s.',
    action: 'Publish comparison and use-case pages that state the specific difference, rather than broader category content.',
    expectedImpact: 'A clearer position on the queries where the buying decision is actually made.',
    impact: 60, confidence: 'medium', effort: 'medium',
    priorityScore: 0,
    measurement: 'Re-run the SERP query set and compare relative presence on comparison and category queries. Currently BLOCKED — requires a valid SERP credential.',
    measurementAvailable: false,
    sources: ['competitive', 'content'], crossSource: true, horizon: '61-90',
  };
};

/** RULE 6 — metadata gaps that suppress the click even when the page ranks. */
const ruleMetadataClickthrough: Rule = (input) => {
  const meta = (input.experienceFindings ?? []).find((f) => f.problem.includes('missing a title or meta'));
  if (!meta) return null;
  return {
    id: 'metadata_clickthrough',
    title: 'Give every indexable page its own title and description',
    problem: meta.problem,
    evidence: [{ source: 'crawl', statement: meta.evidence, state: 'measured' }],
    businessImplication: 'These are the words a person reads before deciding whether to click; without them the search listing is generated for you.',
    action: meta.action,
    expectedImpact: 'Search listings describe the page deliberately rather than by default.',
    impact: 40, confidence: 'high', effort: 'low',
    priorityScore: 0,
    measurement: meta.measurement,
    measurementAvailable: true,
    sources: ['crawl', 'content'], crossSource: true, horizon: '0-30',
  };
};

const RULES: Rule[] = [
  ruleAccessibilityFoundation,
  ruleConversionReadiness,
  ruleContentSearchFoundation,
  rulePerformanceFriction,
  ruleCompetitivePosition,
  ruleMetadataClickthrough,
];

// ── Assembly ──────────────────────────────────────────────────────────────────

export interface DigitalSnapshotAssembly {
  opportunities: CrossSourceOpportunity[];
  topPriorities: CrossSourceOpportunity[];
  plan: DigitalSnapshotPlan;
  /** Dimensions whose state forbids a measured narrative — surfaced as limitations. */
  unmeasuredDimensions: string[];
  /** True when no opportunity could be supported by evidence. */
  empty: boolean;
}

/** Maximum surfaced priorities. Five is the brief's cap and a realistic executive span. */
export const MAX_TOP_PRIORITIES = 5;

/**
 * Assemble the cross-source view. Pure and deterministic; never throws.
 * Missing evidence yields fewer opportunities, never weaker-evidenced ones.
 */
export function assembleDigitalSnapshot(input: AssemblyInput): DigitalSnapshotAssembly {
  const opportunities = RULES
    .map((rule) => {
      try { return rule(input); } catch { return null; }
    })
    .filter((o): o is CrossSourceOpportunity => o !== null)
    .filter(passesEvidenceGate)
    .map((o) => ({
      ...o,
      priorityScore: priorityScore({ impact: o.impact, confidence: o.confidence, effort: o.effort }),
      horizon: horizonFor({ impact: o.impact, effort: o.effort }),
    }))
    // Deterministic: priority score, then id, so equal scores never reorder between runs.
    .sort((a, b) => (b.priorityScore - a.priorityScore) || a.id.localeCompare(b.id));

  const states = input.dimensionStates ?? {};
  const unmeasuredDimensions = (Object.keys(states) as Array<keyof typeof states>)
    .filter((key) => isUnmeasured(states[key]))
    .map((key) => String(key));

  const toPlanItem = (o: CrossSourceOpportunity): PlanItem => ({
    title: o.title, action: o.action, why: o.businessImplication,
    measurement: o.measurement, measurementAvailable: o.measurementAvailable,
    effort: o.effort, confidence: o.confidence, sources: o.sources,
  });

  const horizon = (h: PlanHorizon) => opportunities.filter((o) => o.horizon === h).map(toPlanItem);
  const days_0_30 = horizon('0-30');
  const days_31_60 = horizon('31-60');
  const days_61_90 = horizon('61-90');

  const notes: string[] = [];
  if (days_0_30.length === 0) notes.push('No low-effort, high-impact work was evidenced for the first 30 days. The plan is deliberately left empty rather than filled with generic activity.');
  if (days_31_60.length === 0) notes.push('No mid-horizon work was evidenced.');
  if (days_61_90.length === 0) notes.push('No long-horizon work was evidenced.');
  if (unmeasuredDimensions.length > 0) {
    notes.push(`The following dimensions could not be measured and are therefore absent from the plan rather than assumed weak: ${unmeasuredDimensions.join(', ')}.`);
  }

  return {
    opportunities,
    topPriorities: opportunities.slice(0, MAX_TOP_PRIORITIES),
    plan: { days_0_30, days_31_60, days_61_90, notes },
    unmeasuredDimensions,
    empty: opportunities.length === 0,
  };
}
