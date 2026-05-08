// Constraint narrative module.
//
// Generates the 4-part strategic interpretation block that opens every major
// section of the executive dossier:
//
//   1. The Constraint           — what is fundamentally limiting authority growth
//   2. Why It Matters           — strategic implication for the brand's position
//   3. What Happens If Unresolved — trajectory implication if the constraint persists
//   4. What Unlocks Improvement — next-stage leverage available to leadership
//
// These are NOT recommendation cards. They are interpretive statements that
// translate canonical numbers into executive narrative. Output is deterministic
// from canonical fields (pillar scores, maturity stage, citation matrix,
// trust signals, change intelligence, action playbook).
//
// Hard constraints honoured:
//   - No fabricated benchmark statistics
//   - No fake peer comparisons
//   - No alarmist forward forecasting
//   - Calm, analytical, executive-grade language only

import type {
  CanonicalPillarScore,
  CanonicalReport,
  PillarKey,
} from '../../canonicalReport/canonicalReportTypes';

export type ConstraintNarrative = {
  constraint: string;
  why_matters: string;
  if_unresolved: string;
  unlock: string;
};

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

function isMeasured(p: CanonicalPillarScore): boolean {
  return typeof p.score.value === 'number' && p.score.state !== 'insufficient_signal' && p.score.state !== 'unavailable';
}

function findWeakest(report: CanonicalReport): CanonicalPillarScore | null {
  const measured = report.pillars.filter(isMeasured);
  if (measured.length === 0) return null;
  return [...measured].sort((a, b) => (a.score.value ?? 0) - (b.score.value ?? 0))[0];
}

function findStrongest(report: CanonicalReport): CanonicalPillarScore | null {
  const measured = report.pillars.filter(isMeasured);
  if (measured.length === 0) return null;
  return [...measured].sort((a, b) => (b.score.value ?? 0) - (a.score.value ?? 0))[0];
}

function bandFor(value: number | null | undefined): 'foundational' | 'developing' | 'operational' | 'leading' | 'unmeasured' {
  if (value == null) return 'unmeasured';
  if (value >= 75) return 'leading';
  if (value >= 50) return 'operational';
  if (value >= 25) return 'developing';
  return 'foundational';
}

// ── Authority Position constraint ───────────────────────────────────────────

export function authorityPositionConstraint(report: CanonicalReport): ConstraintNarrative | null {
  const weakest = findWeakest(report);
  const strongest = findStrongest(report);
  if (!weakest) return null;

  const weakLabel = PILLAR_LABEL[weakest.pillar];
  const weakBand = bandFor(weakest.score.value);
  const strongLabel = strongest ? PILLAR_LABEL[strongest.pillar] : null;

  const constraint =
    weakLabel === strongLabel
      ? `${weakLabel} reads ${weakest.score.value}/100 — no single pillar yet pulls authority forward.`
      : `${weakLabel} sits at ${weakest.score.value}/100 — the lowest pillar in the canonical structure and the rate-limiter on every other pillar's contribution.`;

  const why_matters =
    weakBand === 'foundational' || weakBand === 'developing'
      ? `An authority system moves at the speed of its weakest pillar. Investment in ${strongLabel ?? 'other pillars'} compounds slower than it should until ${weakLabel} closes the gap.`
      : `${weakLabel} is performing — but the pillar spread itself signals where the next material lift sits. Closing the gap between strongest and weakest is what shifts the system.`;

  const if_unresolved =
    weakBand === 'foundational'
      ? `Without movement here, the system stays in a posture where activity does not translate into measurable authority gain.`
      : `Without movement here, the brand will continue to read as competent in pockets but uneven as a whole — the kind of profile that loses to more coherent peers in evaluation.`;

  const unlock = `Treat ${weakLabel} as the lead pillar for the next planning cycle. A 10–15 point lift here moves the Authority Index more than the same effort on any other pillar.`;

  return { constraint, why_matters, if_unresolved, unlock };
}

// ── AI Discoverability constraint ───────────────────────────────────────────

export function aiDiscoverabilityConstraint(report: CanonicalReport): ConstraintNarrative | null {
  const score = report.ai_surface_presence.score;
  if (score.state === 'insufficient_signal' || score.state === 'unavailable') return null;
  const value = score.value as number;
  const matrix = report.ai_surface_presence.citation_matrix;
  const measured = matrix?.coverage.measured_cells ?? 0;
  const total = matrix?.coverage.total_cells ?? 0;

  const coverageHint =
    matrix && total > 0 && measured < total
      ? ` Citation appears in ${measured} of ${total} provider × query-class cells — the absences are as informative as the presences.`
      : '';

  const constraint =
    value >= 60
      ? `AI surface presence reads ${value}/100. The brand is meaningfully retrievable, but coverage is not yet uniform across providers and query classes.${coverageHint}`
      : value >= 30
        ? `AI surface presence reads ${value}/100. The brand is partially retrievable — some surfaces find it, others do not.${coverageHint}`
        : `AI surface presence reads ${value}/100. The brand is largely absent from the surfaces buyers increasingly query.${coverageHint}`;

  const why_matters =
    value >= 60
      ? `AI answer surfaces are now where category research begins. A meaningful presence is a competitive position — uneven coverage across providers is where peers can quietly overtake.`
      : `AI answer surfaces are now where category research begins. Absence here means the brand is not in the consideration set for the question types buyers actually ask.`;

  const if_unresolved =
    value >= 30
      ? `If retrieval gaps persist, the brand keeps producing content that does not get cited, while peers with structurally cleaner content compound at its expense.`
      : `If absence persists, the brand pays a discoverability cost that grows quarter over quarter as buyer behaviour continues to shift toward AI-mediated research.`;

  const unlock =
    value >= 60
      ? `The leverage is in coverage uniformity. Identify the provider × query-class cells where retrieval drops and rebuild the answers those cells are looking for.`
      : `The leverage is in citation-readiness: entity clarity, structured answers, schema density, and authoritative corroboration. These compound — once the structure exists, every new piece of content benefits.`;

  return { constraint, why_matters, if_unresolved, unlock };
}

// ── Trust & Consistency constraint ──────────────────────────────────────────

export function trustConsistencyConstraint(report: CanonicalReport): ConstraintNarrative | null {
  const trust = report.trust_coherence;
  if (trust.score.state === 'insufficient_signal' || trust.score.state === 'unavailable') return null;
  const value = trust.score.value as number;

  const constraint =
    value >= 60
      ? `Trust coherence reads ${value}/100. Public-facing signals reinforce each other — what evaluators verify off-site agrees with what the brand asserts on-site.`
      : value >= 30
        ? `Trust coherence reads ${value}/100. Public-facing signals are partially aligned but contain enough fragmentation to be detectable.`
        : `Trust coherence reads ${value}/100. Public-facing signals are fragmented — the brand's external story does not hold a single, consistent shape.`;

  const why_matters =
    value >= 60
      ? `Coherence is the silent multiplier — every other pillar reads stronger when trust signals corroborate each other. The current coherence is an asset to defend.`
      : `Coherence is the silent multiplier — AI systems and high-stakes buyers both penalise inconsistency. Small fractures here compound across every other pillar's reading.`;

  const if_unresolved =
    value >= 60
      ? `If coherence is allowed to drift — through inconsistent NAP data, mismatched founder bios, or stale review surfaces — the multiplier inverts and other pillars lose lift.`
      : `If fragmentation persists, the brand keeps paying a hidden tax on every other authority signal it produces. The cost does not announce itself; it shows up as underperformance with no obvious cause.`;

  const unlock =
    value >= 60
      ? `Maintain the discipline. Audit description, NAP, founder credentials, and review parity on a fixed cadence — the goal is not improvement, it is non-regression.`
      : `Audit the brand's description, NAP, founder credentials, and review presence for consistency. The work is unglamorous but the multiplier effect on every other pillar is real.`;

  return { constraint, why_matters, if_unresolved, unlock };
}

// ── Strategic Constraints (synthesised from primary_constraint + risk) ─────

export function strategicConstraintNarrative(report: CanonicalReport): ConstraintNarrative | null {
  const weak = findWeakest(report);
  const primary = report.executive_insights.primary_constraint.text;
  const risk = report.executive_insights.authority_risk.text;
  if (!weak && !primary) return null;

  const constraint = primary || (weak ? `${PILLAR_LABEL[weak.pillar]} is the dominant drag on the system.` : 'No single constraint dominates the current evidence set.');

  const why_matters =
    `Strategic constraints are not the worst metrics on the page — they are the metrics whose movement would unlock the most elsewhere. ${weak ? `${PILLAR_LABEL[weak.pillar]} qualifies because it sits below the rest of the system and gates compounding behaviour.` : 'The current constraint qualifies because resolving it changes how every other pillar reads.'}`;

  const if_unresolved =
    risk
      ? `If unresolved, ${risk.charAt(0).toLowerCase()}${risk.slice(1)}`
      : `If unresolved, the brand will continue to convert effort into incremental rather than compounding gains — the slowest and most expensive way to build authority.`;

  const unlock =
    weak
      ? `The unlock is concentration, not breadth. Direct the next planning cycle's discretionary effort toward ${PILLAR_LABEL[weak.pillar]} until the gap closes; do not dilute attention across already-stronger pillars.`
      : `The unlock is concentration, not breadth. Pick the constraint identified above and resolve it before opening a second front.`;

  return { constraint, why_matters, if_unresolved, unlock };
}

// ── Market Position constraint ──────────────────────────────────────────────

export function marketPositionConstraint(report: CanonicalReport): ConstraintNarrative | null {
  const benchmark = report.benchmark;
  const competitive = report.competitive_surface_share;
  if (benchmark.state !== 'measured' && (!competitive.summary?.text || competitive.summary.text.length < 10)) return null;

  const overlay = benchmark.overlay;
  const percentile = overlay?.percentile ?? null;

  const constraint =
    percentile != null
      ? `The brand reads at the ${percentile}${ordinalSuffix(percentile)} percentile of the measurable peer set on the dimensions where comparison is sound.`
      : `Peer comparison is the most-misread part of authority intelligence. The brand's relative shape — not its absolute score — is what determines whether it wins evaluation.`;

  const why_matters =
    `Buyers and AI systems both evaluate brands relative to alternatives. Absolute improvement matters less than improvement that visibly opens distance from the peer median.`;

  const if_unresolved =
    `If relative shape is ignored, the brand can improve on every dimension and still lose ground — peers that move faster on the dimensions evaluators actually weight will simply outpace it.`;

  const unlock =
    `Identify the two or three dimensions where the brand is closest to the peer median. Closing those is what changes how the brand reads in side-by-side comparison; the dimensions where the brand is far behind are usually the wrong place to start.`;

  return { constraint, why_matters, if_unresolved, unlock };
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

// ── Momentum & Maturity constraint ──────────────────────────────────────────

export function momentumMaturityConstraint(report: CanonicalReport): ConstraintNarrative | null {
  // Note: The momentum direction sentence + trajectory implication are now
  // owned by `momentumShape.ts` to avoid duplicate commentary. This block
  // focuses strictly on the maturity *transition* — not the trajectory.
  const stage = report.maturity_stage;
  if (stage.stage === 'insufficient_signal') return null;

  const constraint = stage.next_stage
    ? `The brand is at the ${stage.label} stage. Stage transitions are non-linear — ${stage.label} → ${stage.next_stage} demands a different shape of work than ${stage.label} stability does.`
    : `The brand is at the ${stage.label} stage — there is no further stage. The strategic question inverts.`;

  const why_matters = stage.next_stage
    ? `Maturity transition friction is the most actionable strategic signal in the dossier. The threshold is real; the work that produced today's stage is rarely the work that produces tomorrow's.`
    : `At leading, defending position becomes higher-leverage than expanding it. The cost of regression here exceeds the cost of slower expansion.`;

  const if_unresolved = stage.next_stage
    ? `If the friction blocking ${stage.next_stage} is not addressed, the brand keeps doing operationally correct work without earning the structural unlock that separates the stages.`
    : `If the institutional rituals that produced this position are not codified, the position becomes vulnerable to leadership change, focus shift, and market noise.`;

  const unlock = stage.unlock?.explanation
    ? stage.unlock.explanation
    : `Identify the specific friction blocking advancement and treat it as the lead investment of the next planning cycle. Stage transitions reward attribution discipline more than initiative volume.`;

  return { constraint, why_matters, if_unresolved, unlock };
}

// ── Composer ────────────────────────────────────────────────────────────────

export type SectionConstraintNarratives = {
  authority_position: ConstraintNarrative | null;
  ai_discoverability: ConstraintNarrative | null;
  trust_consistency: ConstraintNarrative | null;
  strategic_constraints: ConstraintNarrative | null;
  market_position: ConstraintNarrative | null;
  momentum_maturity: ConstraintNarrative | null;
};

export function buildSectionConstraintNarratives(report: CanonicalReport): SectionConstraintNarratives {
  return {
    authority_position: authorityPositionConstraint(report),
    ai_discoverability: aiDiscoverabilityConstraint(report),
    trust_consistency: trustConsistencyConstraint(report),
    strategic_constraints: strategicConstraintNarrative(report),
    market_position: marketPositionConstraint(report),
    momentum_maturity: momentumMaturityConstraint(report),
  };
}
