// Authority Momentum Shape.
//
// Distinguishes the qualitative shape of the brand's authority trajectory:
// compounding, stable, fragile, stagnating, or declining. The classifier
// reads canonical change_intelligence + pillar configuration and returns
// a structured momentum interpretation.
//
// All output is evidence-aware and maturity-aware. There are no fabricated
// forecasts and no alarmist phrasing — fragility is named only when the
// pillar spread genuinely makes the lift unsupported, decline only when
// the canonical change_intelligence reports it.

import type {
  CanonicalReport,
  PillarKey,
} from '../../canonicalReport/canonicalReportTypes';

export type MomentumShapeKind =
  | 'compounding'
  | 'stable'
  | 'fragile'
  | 'stagnating'
  | 'declining'
  | 'insufficient_history';

export type MomentumShape = {
  kind: MomentumShapeKind;
  label: string;
  /** What the trajectory currently reads as. */
  reading: string;
  /** Calm strategic interpretation of the shape. */
  interpretation: string;
};

function pillarSpread(report: CanonicalReport): { gap: number; min: number; max: number } | null {
  const values: number[] = [];
  for (const p of report.pillars) {
    if (
      typeof p.score.value === 'number' &&
      p.score.state !== 'insufficient_signal' &&
      p.score.state !== 'unavailable'
    ) {
      values.push(p.score.value);
    }
  }
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, gap: max - min };
}

function pillarValue(report: CanonicalReport, pillar: PillarKey): number | null {
  const p = report.pillars.find((x) => x.pillar === pillar);
  if (!p || typeof p.score.value !== 'number' || p.score.state === 'insufficient_signal' || p.score.state === 'unavailable') return null;
  return p.score.value;
}

export function classifyMomentumShape(report: CanonicalReport): MomentumShape {
  const change = report.change_intelligence;
  if (change.state !== 'measured') {
    return {
      kind: 'insufficient_history',
      label: 'Insufficient History',
      reading: 'Trajectory cannot yet be classified — fewer than two comparable observations are on record.',
      interpretation: 'Momentum shape needs repeated observation to interpret. The dossier records the present state honestly until a baseline forms.',
    };
  }

  const direction = change.authority_delta.direction;
  const overall = report.authority_overview.overall_score.value ?? null;
  const sp = pillarSpread(report);
  const foundation = pillarValue(report, 'foundation');
  const trust = pillarValue(report, 'trust');

  // Declining — canonical regressed direction, no qualifications.
  if (direction === 'regressed') {
    return {
      kind: 'declining',
      label: 'Declining Authority',
      reading: 'Authority has regressed since the last comparable snapshot.',
      interpretation: 'Decay typically signals a maintenance failure rather than the absence of new work. Identify what drifted before adding new initiatives — every new variable makes attribution harder.',
    };
  }

  // Fragile — improvement riding on top of an unsupported substrate, OR
  // stagnation with high pillar spread (unstable plateau).
  if (
    direction === 'improved' &&
    sp && sp.gap >= 30 &&
    (foundation == null || foundation < 50)
  ) {
    return {
      kind: 'fragile',
      label: 'Fragile Authority',
      reading: 'Authority is moving upward, but the lift is concentrated in a few pillars while others remain materially weaker.',
      interpretation: 'Fragile authority gains regress unless the supporting pillars catch up. Foundation and trust coherence are what convert short-term lift into durable position.',
    };
  }

  if (
    direction === 'stagnated' &&
    sp && sp.gap >= 25
  ) {
    return {
      kind: 'fragile',
      label: 'Fragile Plateau',
      reading: 'Authority is holding position, but the pillar spread suggests the plateau is unevenly supported.',
      interpretation: 'A plateau on uneven pillars is structurally less stable than the score suggests. The next move is not new growth — it is closing the gap that makes the current position fragile.',
    };
  }

  // Compounding — improvement, broadly supported.
  if (
    direction === 'improved' &&
    overall != null && overall >= 55 &&
    sp && sp.gap < 25 &&
    (trust == null || trust >= 45)
  ) {
    return {
      kind: 'compounding',
      label: 'Compounding Authority',
      reading: 'Authority is moving upward and the supporting pillars are moving with it.',
      interpretation: 'When pillars move together, lift becomes durable. The work driving today\'s trajectory should be sustained — not switched — and one or two underlying inputs should be named so the lift survives changes in team focus.',
    };
  }

  // Improvement that doesn't qualify as either fragile or compounding — a recovering or building shape, treat as stable+momentum.
  if (direction === 'improved') {
    return {
      kind: 'compounding',
      label: 'Building Authority',
      reading: 'Authority is moving upward, with the supporting pillars holding their position.',
      interpretation: 'Building momentum is the precondition for compounding. Continue the work; identify the inputs producing the lift so they can be deliberately reinforced rather than treated as accidental.',
    };
  }

  // Stagnating — flat, low band.
  if (direction === 'stagnated' && (overall == null || overall < 50)) {
    return {
      kind: 'stagnating',
      label: 'Stagnating Authority',
      reading: 'Authority is holding position at a stage that does not yet generate compounding behaviour.',
      interpretation: 'Stagnation at a developing or foundational level is the most expensive condition over multi-quarter horizons. Pick one pillar and commit — decisive selection beats balancing pillars at half-effort.',
    };
  }

  // Stable — flat, operational+ band, coherent pillars.
  if (direction === 'stagnated') {
    return {
      kind: 'stable',
      label: 'Stable Authority',
      reading: 'Authority is holding position at an operational band, with pillars moving as a coherent system.',
      interpretation: 'Stable systems at this band are doing the precondition work for compounding — coherence first, then differentiation. The next move is depth in one pillar, not parallel investment across all.',
    };
  }

  // First observation — no comparable baseline.
  return {
    kind: 'insufficient_history',
    label: 'First Observation',
    reading: 'This is the first comparable observation on record. Trajectory cannot yet be read.',
    interpretation: 'Momentum shape will resolve as repeated observations accumulate. Until then, treat the present read as the baseline rather than the trend.',
  };
}
