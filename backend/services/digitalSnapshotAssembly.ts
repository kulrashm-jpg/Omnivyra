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
  | 'search' | 'ai_visibility' | 'competitive' | 'performance'
  /** REMEDIATION-007 — the public Google Ads Transparency record. PUBLIC_OBSERVED at source. */
  | 'advertising';

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
  /**
   * REMEDIATION-004 — what KIND of work this is, declared by the rule that knows.
   * The conversion dependency below reads these rather than matching on `id`, so a new
   * demand-generation rule inherits the sequencing by declaring itself, not by being
   * remembered at a gate somewhere else.
   */
  kind?: 'conversion_remediation' | 'demand_generation';
  /**
   * Set by `ruleConversionReadiness` when the evidence is strong enough that remediation
   * should precede demand generation. Absent/false means the conversion opportunity exists
   * but is not severe enough to re-sequence other work.
   */
  materiallyDeficient?: boolean;
  /**
   * REMEDIATION-004 — set on a demand-generation opportunity that was sequenced behind a
   * materially deficient conversion path. It is a STATED dependency, not a hidden demotion:
   * the opportunity is still emitted with its own evidence intact.
   */
  dependsOn?: string;
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
  /**
   * REMEDIATION-005 — the opportunity id this item was sequenced behind, when it was.
   *
   * Optional, so every plan item that carries no dependency is byte-identical to before and
   * no other consumer of this type is affected. It states a DECISION RELATIONSHIP — this work
   * is ordered after that work — and never a measured outcome. Slice 004 recorded the
   * dependency on the opportunity and dropped it here, so the reader saw the ordering with no
   * way to know why.
   */
  dependsOn?: string;
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
  /**
   * REMEDIATION-007 — the public advertising surface, reduced to what a decision may rest on.
   *
   * Deliberately NOT the whole `SnapshotAdvertising`: a rule needs the access state, whether a
   * subject legal name was available to search with, and how many advertisers were actually
   * attributable. Creative, message and destination are NOT here because the acquisition does
   * not capture them — only opaque creative ids — so no rule may reason about them.
   */
  advertising?: {
    accessState: string;
    /** Null ⇒ MATCHED was structurally unreachable, so absence proves nothing. */
    subjectLegalNameUsed: string | null;
    matchedAdvertiserCount: number;
    observedAt: string | null;
  } | null;
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
    kind: 'demand_generation',
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

  // ─── REMEDIATION-004 (DEFECT B) — ONE STRONG FINDING IS ENOUGH ────────────
  //
  // This used to require BOTH pillars to have produced a finding. The consequence was that
  // the single most serious conversion defect the crawl can detect — a site with NO
  // discoverable conversion path at all, which `digitalExperience` raises at severity
  // `critical` — produced no opportunity whatsoever if the pages happened to explain the
  // offering clearly. A site could be told nothing about the fact that a visitor has no way
  // to act, because it passed the OTHER half of the test.
  //
  // The threshold is now evidence-aware rather than a count, mirroring
  // `ruleAccessibilityFoundation` which already leads on `severity === 'critical'`:
  //   • one CRITICAL finding on either pillar is sufficient on its own;
  //   • otherwise both pillars are still required, so a single weak/moderate signal cannot
  //     become a definitive conversion conclusion.
  // No new severity vocabulary is introduced and no finding type is invented.
  const findings = [...value, ...conversion];
  if (findings.length === 0) return null;
  const critical = findings.filter((f) => f.severity === 'critical');
  const bothPillars = value.length > 0 && conversion.length > 0;
  if (critical.length === 0 && !bothPillars) return null;

  // Evidence states only what was actually found; a pillar that produced nothing
  // contributes nothing rather than an assumed defect.
  const lead = critical[0] ?? value[0] ?? conversion[0];
  const evidence: OpportunityEvidence[] = [
    ...(value.length > 0 ? [{ source: 'digital_experience' as const, statement: value[0].evidence, state: 'measured' as ScoreState }] : []),
    ...(conversion.length > 0 ? [{ source: 'digital_experience' as const, statement: conversion[0].evidence, state: 'measured' as ScoreState }] : []),
  ];
  const action = [value[0]?.action, conversion[0]?.action].filter(Boolean).join(' ').trim();

  return {
    id: 'conversion_readiness',
    kind: 'conversion_remediation',
    // Materially deficient when a critical defect backs it, or when both halves of the
    // path are impaired. This is what re-sequences demand generation below.
    materiallyDeficient: critical.length > 0 || bothPillars,
    title: 'Close the gap between arriving on the site and being able to act',
    problem: lead.problem,
    evidence,
    businessImplication: 'Interest generated anywhere else in the funnel arrives at pages that neither explain the offer nor offer a way forward, so acquisition spend and content effort under-return.',
    action,
    expectedImpact: 'A visitor can understand the offering and reach a next step from the pages they land on.',
    // A critical defect is a stronger claim than a pair of moderate ones, and says so.
    impact: critical.length > 0 ? 85 : 75,
    confidence: critical.length > 0 ? 'high' : 'medium',
    effort: 'low',
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
    kind: 'demand_generation',
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

/**
 * RULE 7 — public advertising posture. REMEDIATION-007.
 *
 * Ads evidence reached Report 1 in slice 006 but only as a SECTION: it was visible and inert,
 * producing no opportunity, no recommendation and no plan item — the "list of observations"
 * failure this report criticises elsewhere. This rule is the decision half.
 *
 * ─── WHAT IT MAY REASON ABOUT, AND WHAT IT MAY NOT ────────────────────────
 * Google Ads Transparency establishes PRESENCE and advertiser IDENTITY. It does not establish
 * spend, impressions, clicks, CTR, conversion rate, CAC or ROAS, and the acquisition captures
 * only opaque creative ids — no headline, CTA or landing URL. So this rule reasons about
 * posture alone and never about performance or creative.
 *
 * ─── THREE PRECONDITIONS, ALL REFUSALS ───────────────────────────────────
 *   • no observation at all            → abstain (never "no advertising")
 *   • access state is not `observed`   → abstain: blocked/unreachable is not absence
 *   • no subject legal name was used   → abstain: MATCHED was unreachable, so neither presence
 *                                        NOR absence was establishable
 *
 * ─── TWO BRANCHES, EACH NEEDING SOMETHING TO SAY ─────────────────────────
 * (a) Advertising IS attributable AND the conversion path carries a critical defect. That is a
 *     genuine cross-source finding: paid demand is being bought into a path public evidence
 *     shows is incomplete. It is deliberately distinct from the conversion opportunity itself —
 *     that one says "fix the pages", this one says "verify the paid landing experience before
 *     scaling spend" — and it is `demand_generation`, so slice 004 sequences it BEHIND the
 *     remediation automatically. No new mechanism.
 * (b) Advertising is NOT attributable and absence WAS establishable. A conditional prompt to
 *     assess paid acquisition. Conditional is the whole point: the observation covers the Google
 *     record only, so it can never support "this company does not advertise".
 *
 * Advertising observed with a healthy conversion path yields NOTHING. An observation with no
 * decision attached is not an opportunity — it is already rendered in the Public Advertising
 * section, and repeating it here would be the duplication §17 warns about.
 */
const ruleAdvertisingPosture: Rule = (input) => {
  const ads = input.advertising ?? null;
  if (!ads) return null;
  if (ads.accessState !== 'observed') return null;
  if (ads.subjectLegalNameUsed === null) return null;

  const observedOn = ads.observedAt ? ` (observed ${ads.observedAt.slice(0, 10)})` : '';

  if (ads.matchedAdvertiserCount > 0) {
    const conversion = experienceByPillar(input, 'conversion_readiness');
    const critical = conversion.filter((f) => f.severity === 'critical');
    if (critical.length === 0) return null;
    return {
      id: 'advertising_conversion_posture',
      kind: 'demand_generation',
      title: 'Verify the paid landing experience before scaling spend',
      problem: 'Advertising is publicly attributable to this company while the conversion path carries a critical defect.',
      evidence: [
        {
          source: 'advertising',
          statement: `${ads.matchedAdvertiserCount} verified advertiser account(s) attributable to this company in the public Ads Transparency record${observedOn}`,
          state: 'measured',
        },
        { source: 'digital_experience', statement: critical[0].evidence, state: 'measured' },
      ],
      businessImplication: 'Paid demand is being bought into a path that public evidence shows is incomplete, so the spend already being made is working against a ceiling the pages impose.',
      action: 'Confirm which pages the ads land on and that each offers the next step the ad promises, before increasing budget.',
      expectedImpact: 'Paid arrivals reach a page that can act on the intent the ad created.',
      impact: 80, confidence: 'high', effort: 'low',
      priorityScore: 0,
      measurement: 'Re-crawl the landing pages and confirm a next step is present. Ad performance is NOT measurable from public evidence — no spend, click or conversion figure is available from the Ads Transparency record.',
      measurementAvailable: true,
      sources: ['advertising', 'digital_experience'], crossSource: true, horizon: '0-30',
    };
  }

  return {
    id: 'paid_acquisition_consideration',
    kind: 'demand_generation',
    title: 'Assess whether paid acquisition should complement the current organic strategy',
    problem: 'No advertising attributable to this company was found in the public Ads Transparency record.',
    evidence: [
      {
        source: 'advertising',
        statement: `No verified advertiser account attributable to this company was found in the public Ads Transparency record${observedOn}`,
        state: 'measured',
      },
    ],
    businessImplication: 'The public record shows no attributable paid activity on this channel, which may be a deliberate choice or an unexplored option — the record cannot distinguish the two, and it covers this provider only.',
    action: 'Review whether paid acquisition has a role alongside the current organic approach. This is a question to answer, not a change to make.',
    expectedImpact: 'A deliberate position on paid acquisition, held for a stated reason.',
    // Deliberately modest and low-confidence: a conditional prompt, not a recommendation to spend.
    impact: 35, confidence: 'low', effort: 'medium',
    priorityScore: 0,
    measurement: 'None available from public evidence. Whether paid acquisition is worthwhile depends on economics this report cannot observe.',
    measurementAvailable: false,
    // NOTE: `horizonFor` derives the real horizon from impact x effort and overwrites this, as it
    // does for every rule. Declared to match what it produces (impact 35 + medium effort => 31-60)
    // rather than a number that reads as a promise the assembly will not keep. Impact below 40 is
    // what keeps a low-confidence question out of the first thirty days.
    sources: ['advertising'], crossSource: false, horizon: '31-60',
  };
};

const RULES: Rule[] = [
  ruleAccessibilityFoundation,
  ruleConversionReadiness,
  ruleContentSearchFoundation,
  rulePerformanceFriction,
  ruleCompetitivePosition,
  ruleMetadataClickthrough,
  ruleAdvertisingPosture,
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

  // ─── REMEDIATION-004 (DEFECT A) — CONVERSION SEQUENCES DEMAND ─────────────
  //
  // "Fix conversion before sending more demand" existed in this codebase only as prose, and
  // only on the Report 2 path. Nothing read the conversion state to sequence Report 1's own
  // recommendations, so a report could rank "expand the thin pages that should carry search
  // demand" above "a visitor has no way to act" purely because someone typed 70 and 75.
  //
  // This is the ONE shared decision point every rule's output passes through, so the
  // dependency is applied here rather than duplicated into each demand-generation rule.
  //
  // It is a RE-SEQUENCING, not a suppression (§4). The demand opportunity keeps its evidence,
  // its action and its place in the report; it simply cannot outrank the remediation it
  // depends on, and it now says what it is waiting for. Three states, three behaviours:
  //   • materially deficient conversion → demand is ordered behind it and carries `dependsOn`
  //   • conversion present but not material → nothing moves
  //   • NO conversion opportunity (including "not measurable") → nothing moves, because an
  //     absent conversion finding is not evidence that conversion is fine OR broken.
  const blocking = opportunities.find((o) => o.kind === 'conversion_remediation' && o.materiallyDeficient === true);
  const sequenced = blocking
    ? opportunities.map((o) => {
        if (o.kind !== 'demand_generation') return o;
        // The dependency is a FACT about the decision, so it is recorded on every demand item
        // whenever a materially deficient conversion path exists — not only when the numbers
        // happened to need moving. Stating it only on re-ordered items would hide the
        // sequencing in exactly the common case where the scores were already in order.
        const dependent = { ...o, dependsOn: blocking.id };
        if (o.priorityScore < blocking.priorityScore) return dependent;
        // Order strictly behind the dependency without inventing a new scale: the smallest
        // representable step below it on the existing 2-decimal priority score.
        return { ...dependent, priorityScore: Math.max(0, Math.round((blocking.priorityScore - 0.01) * 100) / 100) };
      }).sort((a, b) => (b.priorityScore - a.priorityScore) || a.id.localeCompare(b.id))
    : opportunities;

  const states = input.dimensionStates ?? {};
  const unmeasuredDimensions = (Object.keys(states) as Array<keyof typeof states>)
    .filter((key) => isUnmeasured(states[key]))
    .map((key) => String(key));

  const toPlanItem = (o: CrossSourceOpportunity): PlanItem => ({
    title: o.title, action: o.action, why: o.businessImplication,
    measurement: o.measurement, measurementAvailable: o.measurementAvailable,
    effort: o.effort, confidence: o.confidence, sources: o.sources,
    // REMEDIATION-005 — carried through rather than dropped. Spread-free and explicit so a
    // future field is a deliberate addition, which is how this one came to be missing.
    ...(o.dependsOn ? { dependsOn: o.dependsOn } : {}),
  });

  // Everything downstream reads the SEQUENCED list — the plan, the top priorities and the
  // returned opportunities. A gate the consumers do not read is the defect this slice fixes.
  const horizon = (h: PlanHorizon) => sequenced.filter((o) => o.horizon === h).map(toPlanItem);
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
    opportunities: sequenced,
    topPriorities: sequenced.slice(0, MAX_TOP_PRIORITIES),
    plan: { days_0_30, days_31_60, days_61_90, notes },
    unmeasuredDimensions,
    empty: sequenced.length === 0,
  };
}
