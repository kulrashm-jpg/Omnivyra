// Canonical 6-stage Authority Maturity Model.
//
// Phase 3 extends the Phase 1 5-tier system_maturity classification (which mapped
// foundation × authority into structurally_weak / early_stage / building_baseline /
// operational / leading) into the 6 explicit stages required by the prompt:
//
//   Foundational → Emerging → Developing → Operational → Advanced → Leading
//
// Each stage carries: a numeric range, an entry criterion, a blocker explanation,
// and an unlock explanation. The model is evidence-aware — it explicitly handles
// the case where the overall score is null (insufficient signal).

import type {
  CanonicalReport,
  CanonicalScore,
  ConfidenceBand,
  EvidenceTrace,
  PillarKey,
  ScoreState,
  SystemMaturityClass,
} from '../canonicalReport/canonicalReportTypes';

export type MaturityStage =
  | 'insufficient_signal'
  | 'foundational'
  | 'emerging'
  | 'developing'
  | 'operational'
  | 'advanced'
  | 'leading';

export const MATURITY_STAGES: readonly MaturityStage[] = [
  'foundational',
  'emerging',
  'developing',
  'operational',
  'advanced',
  'leading',
] as const;

export type MaturityStageMeta = {
  stage: MaturityStage;
  label: string;
  range: { min: number; max: number };
  one_line: string;
};

export const MATURITY_STAGE_META: Record<MaturityStage, MaturityStageMeta> = {
  insufficient_signal: {
    stage: 'insufficient_signal',
    label: 'Insufficient Signal',
    range: { min: -1, max: -1 },
    one_line: 'No measured authority yet — the report cannot place the brand on the maturity curve.',
  },
  foundational: {
    stage: 'foundational',
    label: 'Foundational',
    range: { min: 0, max: 24 },
    one_line: 'Fundamentals are still being built — index integrity and extraction readiness need work first.',
  },
  emerging: {
    stage: 'emerging',
    label: 'Emerging',
    range: { min: 25, max: 39 },
    one_line: 'Foundation is forming, but topical authority and AI surface presence are still nascent.',
  },
  developing: {
    stage: 'developing',
    label: 'Developing',
    range: { min: 40, max: 54 },
    one_line: 'Authority is starting to compound — search visibility builds while AI surfacing remains uneven.',
  },
  operational: {
    stage: 'operational',
    label: 'Operational',
    range: { min: 55, max: 69 },
    one_line: 'The brand operates competitively — most pillars hold their own, with one or two still trailing.',
  },
  advanced: {
    stage: 'advanced',
    label: 'Advanced',
    range: { min: 70, max: 84 },
    one_line: 'Authority is well-established and compounding across most pillars; trust + momentum are differentiating.',
  },
  leading: {
    stage: 'leading',
    label: 'Leading',
    range: { min: 85, max: 100 },
    one_line: 'Brand reads as category-defining — every pillar is in the operational-or-better band.',
  },
};

export type MaturityClassification = {
  stage: MaturityStage;
  // Stage one tier higher; null when already at leading or insufficient.
  next_stage: MaturityStage | null;
  // Human-readable explanation of *why* the brand is at this stage.
  why_this_stage: string;
  // What blocks the transition to next_stage, with pillar attribution.
  blocker: { pillar: PillarKey | null; explanation: string };
  // What unlocks the next stage — pillar / move pair.
  unlock: { pillar: PillarKey | null; explanation: string };
  evidence: EvidenceTrace;
  confidence: ConfidenceBand;
};

function stageFromValue(value: number | null, state: ScoreState): MaturityStage {
  if (state === 'insufficient_signal' || state === 'unavailable' || value == null) {
    return 'insufficient_signal';
  }
  for (const stage of MATURITY_STAGES) {
    const meta = MATURITY_STAGE_META[stage];
    if (value >= meta.range.min && value <= meta.range.max) return stage;
  }
  return 'foundational';
}

function nextStageOf(stage: MaturityStage): MaturityStage | null {
  if (stage === 'insufficient_signal') return null;
  const idx = MATURITY_STAGES.indexOf(stage);
  if (idx < 0 || idx >= MATURITY_STAGES.length - 1) return null;
  return MATURITY_STAGES[idx + 1];
}

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

// ── Core classifier ───────────────────────────────────────────────────────────

export function classifyMaturity(report: CanonicalReport): MaturityClassification {
  const overall = report.authority_overview.overall_score;
  const stage = stageFromValue(overall.value, overall.state);

  if (stage === 'insufficient_signal') {
    return {
      stage,
      next_stage: null,
      why_this_stage:
        'The maturity stage cannot yet be classified — no pillar has measured evidence in this snapshot.',
      blocker: {
        pillar: null,
        explanation:
          'Evidence coverage is below the threshold required to place the brand on the maturity curve.',
      },
      unlock: {
        pillar: null,
        explanation:
          'Connect crawler / search / competitor signal so at least one pillar can be measured.',
      },
      evidence: overall.evidence,
      confidence: 'low',
    };
  }

  // The blocking pillar is the lowest-scoring measured pillar.
  const measuredPillars = report.pillars.filter(
    (p) => typeof p.score.value === 'number' && p.score.state !== 'insufficient_signal' && p.score.state !== 'unavailable',
  );
  const weakestPillar = [...measuredPillars].sort((a, b) => (a.score.value ?? 0) - (b.score.value ?? 0))[0];
  const strongestPillar = [...measuredPillars].sort((a, b) => (b.score.value ?? 0) - (a.score.value ?? 0))[0];

  const stageMeta = MATURITY_STAGE_META[stage];
  const nextStage = nextStageOf(stage);
  const nextMeta = nextStage ? MATURITY_STAGE_META[nextStage] : null;
  const pointsToNext = nextMeta
    ? Math.max(0, nextMeta.range.min - (overall.value ?? 0))
    : 0;

  const whyThisStage = `Authority Index sits at ${overall.value}/100 — within the ${stageMeta.label} band (${stageMeta.range.min}–${stageMeta.range.max}). ${stageMeta.one_line}${strongestPillar ? ` ${PILLAR_LABEL[strongestPillar.pillar]} is the strongest pillar at ${strongestPillar.score.value}/100.` : ''}`;

  const blocker = weakestPillar
    ? {
        pillar: weakestPillar.pillar,
        explanation: `${PILLAR_LABEL[weakestPillar.pillar]} at ${weakestPillar.score.value}/100 is the lowest measured pillar and the dominant drag on the Authority Index.${nextMeta ? ` ${pointsToNext} point${pointsToNext === 1 ? '' : 's'} stand between the current stage and ${nextMeta.label}.` : ''}`,
      }
    : {
        pillar: null,
        explanation: 'No single pillar dominates as a drag; advancement requires balanced lift across measured pillars.',
      };

  const unlock = nextMeta && weakestPillar
    ? {
        pillar: weakestPillar.pillar,
        explanation: `Lift ${PILLAR_LABEL[weakestPillar.pillar]} above the ${nextMeta.label} threshold (${nextMeta.range.min}/100) to advance. ${weakestPillar.primary_signal ?? ''}`.trim(),
      }
    : nextMeta
      ? {
          pillar: null,
          explanation: `Compound lift across measured pillars to clear the ${nextMeta.range.min}/100 threshold for ${nextMeta.label}.`,
        }
      : {
          pillar: null,
          explanation:
            'Already at the Leading stage. Defend the position by sustaining momentum and reinforcing trust signals.',
        };

  return {
    stage,
    next_stage: nextStage,
    why_this_stage: whyThisStage,
    blocker,
    unlock,
    evidence: overall.evidence,
    confidence: overall.confidence,
  };
}

// ── Bridge: legacy SystemMaturityClass → MaturityStage ────────────────────────
//
// The Phase 1 SystemMaturityClass values still flow through narratives elsewhere
// in the report. Phase 3 does NOT ship a parallel system; instead the maturity
// model derives stage from the authority overall score, and the legacy class is
// preserved as a compatibility view.

export function legacyClassFromStage(stage: MaturityStage): SystemMaturityClass {
  if (stage === 'leading' || stage === 'advanced') return 'leading';
  if (stage === 'operational') return 'operational';
  if (stage === 'developing') return 'building_baseline';
  if (stage === 'emerging') return 'early_stage';
  if (stage === 'foundational') return 'structurally_weak';
  return 'building_baseline';
}
