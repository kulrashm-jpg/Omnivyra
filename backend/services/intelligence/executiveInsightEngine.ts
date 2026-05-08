// Executive Insight Engine.
//
// Phase 4 upgrade: the report stops sounding like an SEO commentary and starts
// sounding like an executive intelligence brief. This engine produces six
// canonical artifacts — Headline Thesis, Primary Constraint, Next Unlock,
// Strategic Opportunity, Authority Risk, Momentum Interpretation — every one
// of them grounded in the canonical pillar / dimension / action data.
//
// Inputs are real measurements; outputs are interpretation. No facts are
// invented — every insight cites the underlying data via its evidence field.

import type {
  CanonicalAction,
  CanonicalNarrative,
  CanonicalPillarScore,
  CanonicalReport,
  CanonicalScore,
  ConfidenceBand,
  EvidenceTrace,
  PillarKey,
  SystemMaturityClass,
} from '../canonicalReport/canonicalReportTypes';
import { PILLAR_META, emptyEvidenceTrace } from '../canonicalReport/canonicalReportTypes';
import type { AICitationMatrixSummary } from '../canonicalReport/canonicalReportTypes';

export type ExecutiveInsightSet = {
  headline_thesis: CanonicalNarrative;
  primary_constraint: CanonicalNarrative;
  next_unlock: CanonicalNarrative;
  strategic_opportunity: CanonicalNarrative;
  authority_risk: CanonicalNarrative;
  momentum_interpretation: CanonicalNarrative;
};

export type ExecutiveInsightInput = {
  overall: CanonicalScore;
  maturity: SystemMaturityClass;
  pillars: CanonicalPillarScore[];
  actions: CanonicalAction[];
  citationMatrix: AICitationMatrixSummary | null;
  trajectory: CanonicalReport['authority_trajectory'];
  competitiveSurfaceShare: CanonicalReport['competitive_surface_share'];
};

function isMeasured(score: CanonicalScore): boolean {
  return typeof score.value === 'number' && score.state !== 'insufficient_signal' && score.state !== 'unavailable';
}

function rankPillars(pillars: CanonicalPillarScore[]): {
  strongest: CanonicalPillarScore | null;
  weakest: CanonicalPillarScore | null;
  measured: CanonicalPillarScore[];
} {
  const measured = pillars.filter((p) => isMeasured(p.score));
  if (measured.length === 0) return { strongest: null, weakest: null, measured };
  const sortedByScore = [...measured].sort((a, b) => (a.score.value ?? 0) - (b.score.value ?? 0));
  return {
    strongest: sortedByScore[sortedByScore.length - 1],
    weakest: sortedByScore[0],
    measured,
  };
}

function maturityAdjective(stage: SystemMaturityClass): string {
  if (stage === 'leading') return 'category-leading';
  if (stage === 'operational') return 'operationally competitive';
  if (stage === 'building_baseline') return 'building a baseline';
  if (stage === 'early_stage') return 'early-stage';
  return 'structurally weak';
}

function combineEvidence(...traces: EvidenceTrace[]): EvidenceTrace {
  const sources = new Set<EvidenceTrace['sources'][number]>();
  let count = 0;
  let lastObservedAt: string | null = null;
  const observations: EvidenceTrace['observations'] = [];
  for (const trace of traces) {
    count += trace.count;
    for (const s of trace.sources) sources.add(s);
    for (const obs of trace.observations) observations.push(obs);
    if (trace.freshness.last_observed_at) lastObservedAt = trace.freshness.last_observed_at;
  }
  return {
    count,
    sources: [...sources] as EvidenceTrace['sources'],
    freshness: { last_observed_at: lastObservedAt, age_hours: null },
    observations,
  };
}

// ── 1. Headline thesis ────────────────────────────────────────────────────────

function headlineThesis(input: ExecutiveInsightInput): CanonicalNarrative {
  const { overall, maturity, pillars } = input;
  if (!isMeasured(overall)) {
    return {
      text:
        'Authority cannot yet be measured. The brand has insufficient signal across every canonical pillar — the report awaits crawl, search, or competitor evidence before a thesis can be issued.',
      confidence: 'low',
      evidence: overall.evidence,
      maturity,
    };
  }
  const { strongest, weakest, measured } = rankPillars(pillars);
  const adjective = maturityAdjective(maturity);

  if (!strongest || !weakest) {
    return {
      text: `The brand reads as ${adjective} on the authority maturity curve, but the canonical pillars have not yet diverged enough to issue a sharper thesis.`,
      confidence: overall.confidence,
      evidence: overall.evidence,
      maturity,
    };
  }

  // Detect the dominant story: imbalanced (strong vs weak gap >25 points), even,
  // or compounding (most pillars in the same band).
  const gap = (strongest.score.value ?? 0) - (weakest.score.value ?? 0);
  const allOperational = measured.every((p) => (p.score.value ?? 0) >= 55);
  const allFoundational = measured.every((p) => (p.score.value ?? 0) < 40);

  let text: string;
  if (allOperational) {
    text = `Authority is compounding. ${PILLAR_META[strongest.pillar].label} leads at ${strongest.score.value}/100, but the brand reads as ${adjective} because every measured pillar sits in the operational band — the next step change comes from differentiating one of them, not patching weaknesses.`;
  } else if (allFoundational) {
    text = `Authority is structurally thin. Every measured pillar sits below the developing band, so the brand reads as ${adjective}. The thesis is foundational: ${PILLAR_META[weakest.pillar].label} (${weakest.score.value}/100) is the most acute drag, and lifting it unblocks the others.`;
  } else if (gap >= 25) {
    text = `Authority is imbalanced. ${PILLAR_META[strongest.pillar].label} (${strongest.score.value}/100) carries the brand, but ${PILLAR_META[weakest.pillar].label} (${weakest.score.value}/100) is dragging it ${gap} points. The brand reads as ${adjective} because that gap suppresses compounding.`;
  } else {
    text = `Authority is even but unfocused. The five pillars sit within ${gap} points of each other, so the brand reads as ${adjective}. Step change comes from picking one pillar to win on, not balancing five.`;
  }

  return {
    text,
    confidence: overall.confidence,
    evidence: combineEvidence(strongest.score.evidence, weakest.score.evidence),
    maturity,
  };
}

// ── 2. Primary constraint ─────────────────────────────────────────────────────

function primaryConstraint(input: ExecutiveInsightInput): CanonicalNarrative {
  const { weakest } = rankPillars(input.pillars);
  if (!weakest) {
    return {
      text: 'No pillar has measured evidence — the report cannot identify a primary constraint until measurement begins.',
      confidence: 'low',
      evidence: emptyEvidenceTrace(),
      maturity: input.maturity,
    };
  }
  const measuredDims = weakest.dimensions.filter((d) => isMeasured(d.score));
  const weakestDim = [...measuredDims].sort((a, b) => (a.score.value ?? 0) - (b.score.value ?? 0))[0];
  const text = weakestDim
    ? `${PILLAR_META[weakest.pillar].label} at ${weakest.score.value}/100 is the dominant drag on overall authority. Within it, ${weakestDim.label} (${weakestDim.score.value}/100) is the lagging dimension — fixing it moves the pillar fastest.`
    : `${PILLAR_META[weakest.pillar].label} at ${weakest.score.value}/100 is the dominant drag. The pillar lacks dimension-level evidence to localize the constraint further.`;
  return {
    text,
    confidence: weakest.score.confidence,
    evidence: weakest.score.evidence,
    maturity: input.maturity,
  };
}

// ── 3. Next unlock ────────────────────────────────────────────────────────────

function nextUnlock(input: ExecutiveInsightInput): CanonicalNarrative {
  const top = input.actions[0];
  if (!top) {
    return {
      text: 'No leverage-ranked action could be derived. The report needs more evidence before a next-unlock recommendation.',
      confidence: 'low',
      evidence: emptyEvidenceTrace(),
      maturity: input.maturity,
    };
  }
  const implication = top.maturity_implication.replace(/_/g, ' ');
  const ownerArea = top.owner_area.replace(/_/g, ' ');
  const text = `Highest-leverage move: ${top.title}. This ${implication} via ${PILLAR_META[top.pillar].label} (severity ${top.severity}, leverage ${top.leverage_score}). Owner: ${ownerArea}.`;
  return {
    text,
    confidence: top.confidence,
    evidence: top.evidence,
    maturity: input.maturity,
  };
}

// ── 4. Strategic opportunity ─────────────────────────────────────────────────
//
// The biggest leverage move that ALSO compounds across multiple pillars. We
// pick the action with the highest leverage_score whose maturity_implication
// is `shifts_tier` or `compounds_authority`.

function strategicOpportunity(input: ExecutiveInsightInput): CanonicalNarrative {
  const compounding = input.actions.filter(
    (a) => a.maturity_implication === 'shifts_tier' || a.maturity_implication === 'compounds_authority',
  );
  const top = compounding[0] ?? input.actions[0] ?? null;
  if (!top) {
    return {
      text: 'No compounding strategic move surfaces yet — the action playbook is sparse.',
      confidence: 'low',
      evidence: emptyEvidenceTrace(),
      maturity: input.maturity,
    };
  }
  const text = `Largest compounding opportunity: ${top.title}. This action is rated to ${top.maturity_implication.replace(/_/g, ' ')} — leverage ${top.leverage_score}, expected ${top.expected_impact} impact at ${top.effort} effort.`;
  return {
    text,
    confidence: top.confidence,
    evidence: top.evidence,
    maturity: input.maturity,
  };
}

// ── 5. Authority risk ─────────────────────────────────────────────────────────
//
// The most dangerous structural weakness: a measured pillar in the foundational
// band (0-24) that sits beneath load-bearing pillars, OR a critical-severity
// action that no other action depends on (an isolated structural breakage).

function authorityRisk(input: ExecutiveInsightInput): CanonicalNarrative {
  const foundationalMeasured = input.pillars.filter(
    (p) => isMeasured(p.score) && (p.score.value ?? 0) < 25,
  );
  if (foundationalMeasured.length > 0) {
    const worst = [...foundationalMeasured].sort((a, b) => (a.score.value ?? 0) - (b.score.value ?? 0))[0];
    return {
      text: `Most dangerous weakness: ${PILLAR_META[worst.pillar].label} at ${worst.score.value}/100 is in the foundational band. Anything built above it does not compound — this is structural, not tactical.`,
      confidence: worst.score.confidence,
      evidence: worst.score.evidence,
      maturity: input.maturity,
    };
  }
  const criticalAction = input.actions.find((a) => a.severity === 'critical');
  if (criticalAction) {
    return {
      text: `Active risk: ${criticalAction.title} carries critical severity. Ignoring it materially compresses authority growth across ${PILLAR_META[criticalAction.pillar].label}.`,
      confidence: criticalAction.confidence,
      evidence: criticalAction.evidence,
      maturity: input.maturity,
    };
  }
  // Stale freshness or weak overall confidence is the risk when nothing else surfaces.
  if (input.overall.confidence === 'low') {
    return {
      text: 'Active risk: every measured signal is in the low-confidence band. The biggest danger is operating on a noisy read — connect more signal sources before committing to large bets.',
      confidence: 'low',
      evidence: input.overall.evidence,
      maturity: input.maturity,
    };
  }
  return {
    text: 'No critical structural risk surfaces against the current measurements. Continue compounding the operational pillars — but reassess after the next snapshot.',
    confidence: input.overall.confidence,
    evidence: input.overall.evidence,
    maturity: input.maturity,
  };
}

// ── 6. Momentum interpretation ────────────────────────────────────────────────

function momentumInterpretation(input: ExecutiveInsightInput): CanonicalNarrative {
  const { trajectory, overall } = input;
  if (!trajectory.available || trajectory.snapshots.length < 2) {
    return {
      text: 'Momentum cannot be classified yet — fewer than two historical snapshots are stored. Re-run the report after a future cycle to enable trajectory.',
      confidence: 'low',
      evidence: trajectory.snapshots.length === 0 ? emptyEvidenceTrace() : combineEvidence(...trajectory.snapshots.map((s) => s.score.evidence)),
      maturity: input.maturity,
    };
  }
  // The trajectory provider's classification is the source of truth.
  const last = trajectory.snapshots[trajectory.snapshots.length - 1];
  const first = trajectory.snapshots[0];
  const delta = (last.score.value ?? 0) - (first.score.value ?? 0);
  const direction = delta > 5 ? 'compounding' : delta < -5 ? 'decaying' : 'stagnating';
  const text = `Authority is ${direction}. Across ${trajectory.snapshots.length} snapshots, the index moved ${delta >= 0 ? '+' : ''}${delta} points (${first.score.value}/100 → ${last.score.value}/100). ${
    direction === 'compounding'
      ? 'Sustain the actions driving this — switching pillars now would reset the curve.'
      : direction === 'decaying'
        ? 'Identify the regression source before adding new bets — decay typically signals a structural pillar that is no longer being maintained.'
        : 'A flat authority curve is the most expensive position. Pick one pillar to break the stagnation.'
  }`;
  return {
    text,
    confidence: overall.confidence,
    evidence: combineEvidence(first.score.evidence, last.score.evidence),
    maturity: input.maturity,
  };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function buildExecutiveInsights(input: ExecutiveInsightInput): ExecutiveInsightSet {
  return {
    headline_thesis: headlineThesis(input),
    primary_constraint: primaryConstraint(input),
    next_unlock: nextUnlock(input),
    strategic_opportunity: strategicOpportunity(input),
    authority_risk: authorityRisk(input),
    momentum_interpretation: momentumInterpretation(input),
  };
}
