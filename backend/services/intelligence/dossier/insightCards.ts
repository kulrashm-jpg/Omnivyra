// Strategic insight card builder.
//
// Generates a small set of HIGH-SIGNAL insight cards from the canonical
// report. Each card carries the canonical 4-part shape:
//
//   Observation — what was detected
//   Interpretation — why it matters
//   Business Impact — how it affects authority/discoverability/trust
//   Strategic Direction — what should happen next
//
// Cards are derived from real canonical fields. No SEO-tool phrasing,
// no generic "improve your visibility" filler.

import type {
  CanonicalAction,
  CanonicalPillarScore,
  CanonicalReport,
  PillarKey,
} from '../../canonicalReport/canonicalReportTypes';

export type InsightCardKind =
  | 'authority_position'
  | 'pillar_throttle'
  | 'pillar_momentum'
  | 'ai_visibility'
  | 'trust_coherence'
  | 'maturity_tension'
  | 'change_intelligence';

export type InsightCard = {
  kind: InsightCardKind;
  /** Tone of the card — drives how the renderer styles it. */
  tone: 'risk' | 'opportunity' | 'momentum' | 'context';
  observation: string;
  interpretation: string;
  business_impact: string;
  strategic_direction: string;
  /** Pillar (when relevant) for visual accent. */
  pillar: PillarKey | null;
};

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

const SCORE_RANGE_NARRATIVE = (value: number): string => {
  if (value >= 75) return 'in the leading band';
  if (value >= 50) return 'in the operational band';
  if (value >= 25) return 'in the developing band';
  return 'in the foundational band';
};

function isMeasured(score: CanonicalPillarScore['score']): boolean {
  return typeof score.value === 'number' && score.state !== 'insufficient_signal' && score.state !== 'unavailable';
}

function findMeasuredPillar(report: CanonicalReport, predicate: (p: CanonicalPillarScore) => boolean): CanonicalPillarScore | null {
  return report.pillars.find((p) => isMeasured(p.score) && predicate(p)) ?? null;
}

function findWeakest(report: CanonicalReport): CanonicalPillarScore | null {
  const measured = report.pillars.filter((p) => isMeasured(p.score));
  if (measured.length === 0) return null;
  return [...measured].sort((a, b) => (a.score.value ?? 0) - (b.score.value ?? 0))[0];
}

function findStrongest(report: CanonicalReport): CanonicalPillarScore | null {
  const measured = report.pillars.filter((p) => isMeasured(p.score));
  if (measured.length === 0) return null;
  return [...measured].sort((a, b) => (b.score.value ?? 0) - (a.score.value ?? 0))[0];
}

function topAction(report: CanonicalReport): CanonicalAction | null {
  return report.action_playbook.actions[0] ?? null;
}

// ── Card generators ──────────────────────────────────────────────────────────

function authorityPositionCard(report: CanonicalReport): InsightCard | null {
  const overall = report.authority_overview.overall_score;
  if (!isMeasured(overall)) return null;
  const value = overall.value as number;
  const stage = report.maturity_stage.label;

  return {
    kind: 'authority_position',
    tone: 'context',
    pillar: null,
    observation: `Authority Index: ${value}/100. ${SCORE_RANGE_NARRATIVE(value).charAt(0).toUpperCase() + SCORE_RANGE_NARRATIVE(value).slice(1)}. Stage: ${stage}.`,
    interpretation:
      'The headline composite — the single number the board uses to track authority over time. Movement here lags the underlying work by one to two quarters.',
    business_impact:
      value >= 60
        ? 'The brand operates from a competitive baseline. Incremental work now compounds rather than repairs.'
        : value >= 30
          ? 'There is structural ground to gain before authority compounds. Today\'s investment lays the substrate for later non-linear returns.'
          : 'Authority is structurally thin. The brand is largely invisible in the surfaces that matter — the cost of waiting grows each quarter.',
    strategic_direction:
      report.maturity_stage.unlock.explanation ?? 'Sequence work toward the next maturity threshold deliberately — concentration beats breadth.',
  };
}

function pillarThrottleCard(report: CanonicalReport): InsightCard | null {
  const weakest = findWeakest(report);
  if (!weakest) return null;
  const value = weakest.score.value as number;

  return {
    kind: 'pillar_throttle',
    tone: 'risk',
    pillar: weakest.pillar,
    observation: `${PILLAR_LABEL[weakest.pillar]}: ${value}/100. The lowest-measured pillar in the report.`,
    interpretation:
      weakest.primary_signal ?? `${PILLAR_LABEL[weakest.pillar]} is the rate-limiter on the rest of the system.`,
    business_impact:
      'A throttle at this pillar slows every other pillar\'s contribution. Work elsewhere underperforms until this one closes the gap.',
    strategic_direction: `Make ${PILLAR_LABEL[weakest.pillar]} the lead pillar next cycle. A 10–15 point lift here moves the Authority Index more than the same effort applied anywhere else.`,
  };
}

function pillarMomentumCard(report: CanonicalReport): InsightCard | null {
  const strongest = findStrongest(report);
  if (!strongest) return null;
  const value = strongest.score.value as number;
  if (value < 50) return null; // momentum stories require operational+ scoring

  return {
    kind: 'pillar_momentum',
    tone: 'momentum',
    pillar: strongest.pillar,
    observation: `${PILLAR_LABEL[strongest.pillar]}: ${value}/100. The leading pillar — what evaluators see first.`,
    interpretation:
      strongest.primary_signal ?? `${PILLAR_LABEL[strongest.pillar]} is the surface most visible to evaluators today.`,
    business_impact:
      'Strong pillars are differentiation. Reducing investment here to chase a weaker pillar erodes the signal currently producing visibility.',
    strategic_direction: `Defend ${PILLAR_LABEL[strongest.pillar]} deliberately. Maintain the inputs that produced this score; treat regression as more expensive than slower expansion elsewhere.`,
  };
}

function aiVisibilityCard(report: CanonicalReport): InsightCard | null {
  const score = report.ai_surface_presence.score;
  if (score.state === 'insufficient_signal' || score.state === 'unavailable') return null;
  const value = score.value as number;
  const matrix = report.ai_surface_presence.citation_matrix;
  const measured = matrix?.coverage.measured_cells ?? 0;
  const total = matrix?.coverage.total_cells ?? 0;

  return {
    kind: 'ai_visibility',
    tone: value >= 50 ? 'momentum' : 'opportunity',
    pillar: 'discoverability',
    observation: `AI surface presence: ${value}/100${matrix && total > 0 ? ` · ${measured} of ${total} provider × query-class cells measured` : ''}.`,
    interpretation:
      value >= 60
        ? 'The brand is meaningfully retrievable in AI answer surfaces. Citation patterns reinforce its presence where buyers increasingly start research.'
        : value >= 30
          ? 'Retrieval is uneven. Some surfaces find the brand; others do not — the inconsistency is the story.'
          : 'The brand is largely absent from AI answer surfaces. The cost of absence grows each quarter as buyer research shifts further toward AI-mediated discovery.',
    business_impact:
      'AI surfaces are the discoverability layer that grew most in the last 24 months. Gains here translate directly into top-of-funnel attention captured.',
    strategic_direction:
      report.executive_insights.next_unlock.text ?? 'Prioritise entity clarity, structural extractability, and citation-readiness — the signal compounds once the substrate exists.',
  };
}

function trustCoherenceCard(report: CanonicalReport): InsightCard | null {
  const trust = report.trust_coherence;
  if (trust.score.state === 'insufficient_signal' || trust.score.state === 'unavailable') return null;
  const value = trust.score.value as number;

  return {
    kind: 'trust_coherence',
    tone: value >= 60 ? 'momentum' : 'risk',
    pillar: 'trust',
    observation: `Trust coherence: ${value}/100 across consistency, review, and expertise signals.`,
    interpretation:
      value >= 60
        ? 'Public-facing signals reinforce each other — what evaluators verify off-site agrees with what the brand asserts on-site.'
        : 'Public-facing signals are fragmented — off-site verification does not yet match on-site assertion.',
    business_impact:
      'Coherence is the silent multiplier. AI systems and high-stakes buyers both penalise inconsistency; fractures here compound across every other pillar\'s reading.',
    strategic_direction: 'Audit description, NAP, founder credentials, and review parity. Every authoritative source should agree — the work is unglamorous but the multiplier is real.',
  };
}

function maturityTensionCard(report: CanonicalReport): InsightCard | null {
  const stage = report.maturity_stage;
  if (stage.stage === 'insufficient_signal') return null;

  return {
    kind: 'maturity_tension',
    tone: 'context',
    pillar: stage.blocker.pillar,
    observation: `Stage: ${stage.label}. Next: ${stage.next_stage ?? 'none — the brand is at Leading.'}`,
    interpretation: stage.why_this_stage,
    business_impact:
      stage.next_stage
        ? `The threshold to ${stage.next_stage} is real — the brand either clears it or it does not. Stage transitions are what shift the strategic story, not score increments alone.`
        : 'At the Leading stage, the strategic question inverts: defending position is higher-leverage than expanding it.',
    strategic_direction: stage.unlock.explanation,
  };
}

function changeIntelligenceCard(report: CanonicalReport): InsightCard | null {
  const change = report.change_intelligence;
  if (change.state !== 'measured') return null;
  if (change.notable_changes.length === 0) {
    return {
      kind: 'change_intelligence',
      tone: 'context',
      pillar: null,
      observation: 'No significant movement since the last snapshot.',
      interpretation:
        'The brand held position. In strategic terms, holding is rarely neutral — peers are moving, and stillness becomes relative loss over enough quarters.',
      business_impact:
        'Stagnation is the most expensive condition over multi-quarter horizons. The brand is neither compounding nor declining — but its peer set is.',
      strategic_direction:
        'Pick one pillar and commit. Decisive selection beats balancing five pillars at half-effort.',
    };
  }
  const direction = change.authority_delta.direction;
  return {
    kind: 'change_intelligence',
    tone: direction === 'improved' ? 'momentum' : direction === 'regressed' ? 'risk' : 'context',
    pillar: null,
    observation: change.notable_changes[0],
    interpretation:
      change.notable_changes.length === 1
        ? 'A single significant movement — material enough to track, isolated enough to attribute.'
        : `${change.notable_changes.length} significant changes since the last snapshot. Multi-pillar, not single-issue.`,
    business_impact:
      direction === 'improved'
        ? 'Trajectory is favourable. Sustain the actions driving the lift; do not switch them.'
        : direction === 'regressed'
          ? 'Trajectory is unfavourable. Diagnose before adding new initiatives — decay typically signals a maintenance failure, not a strategy gap.'
          : 'Trajectory is mixed. Worth checking whether the gains and losses are coupled or merely concurrent.',
    strategic_direction:
      direction === 'improved'
        ? 'Continue the work. Attribute clearly to one or two underlying inputs so the lift survives changes in team focus.'
        : 'Pause new initiatives. Diagnose what caused the move before adding more variables.',
  };
}

// ── Composer ─────────────────────────────────────────────────────────────────

export function buildExecutiveInsightCards(report: CanonicalReport): InsightCard[] {
  // Compression rule: only the highest-leverage insights deserve the
  // executive snapshot. The candidate list is ordered by strategic
  // dominance; we keep the top 4. Lower-priority insights (pillar
  // momentum, maturity tension, change intelligence) live elsewhere in
  // the dossier rather than competing for attention here.
  const candidates: Array<InsightCard | null> = [
    authorityPositionCard(report),
    pillarThrottleCard(report),
    aiVisibilityCard(report),
    trustCoherenceCard(report),
    pillarMomentumCard(report),
    maturityTensionCard(report),
    changeIntelligenceCard(report),
  ];
  return candidates.filter((c): c is InsightCard => c !== null).slice(0, 4);
}
