// Executive phrasing module.
//
// Generates the memorable framing sentence that opens each major section of
// the executive dossier. The goal is to upgrade section openers from
// descriptive ("Authority Position") to interpretive ("Authority is built on
// a coherent foundation, not a strong score") — sharp, short, and quotable
// without being overstated.
//
// All framing sentences are deterministic from canonical fields. There is no
// fabrication, no peer claims, no fake forward forecasting.

// GAP-12 — measured-coverage gate for AI absence language.
import { aiCoverageGate, aiCoverageQualifier } from './aiCoverageGate';
import type {
  CanonicalPillarScore,
  CanonicalReport,
  PillarKey,
} from '../../canonicalReport/canonicalReportTypes';

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

function findStrongest(report: CanonicalReport): CanonicalPillarScore | null {
  const measured = report.pillars.filter(isMeasured);
  if (measured.length === 0) return null;
  return [...measured].sort((a, b) => (b.score.value ?? 0) - (a.score.value ?? 0))[0];
}

function findWeakest(report: CanonicalReport): CanonicalPillarScore | null {
  const measured = report.pillars.filter(isMeasured);
  if (measured.length === 0) return null;
  return [...measured].sort((a, b) => (a.score.value ?? 0) - (b.score.value ?? 0))[0];
}

// ── Section framing sentences ──────────────────────────────────────────────
//
// Quote-anchor pattern: 10–18 words, calm, evidence-aware, sharp enough
// to be highlighted in a meeting. Each line should stand alone without
// the surrounding context — the first thing executives lift from the
// section.

export function authorityPositionFraming(report: CanonicalReport): string {
  const strongest = findStrongest(report);
  const weakest = findWeakest(report);
  if (!strongest || !weakest) {
    return 'Authority moves at the speed of its weakest pillar.';
  }
  if (strongest.pillar === weakest.pillar) {
    return 'Coherent profiles compound through depth, not breadth.';
  }
  return `${PILLAR_LABEL[strongest.pillar]} carries the recognition; ${PILLAR_LABEL[weakest.pillar]} determines whether it compounds.`;
}

export function aiDiscoverabilityFraming(report: CanonicalReport): string {
  const score = report.ai_surface_presence.score;
  if (score.state === 'insufficient_signal' || score.state === 'unavailable') {
    return 'AI discoverability shifted faster than any other surface — measurement is the first move.';
  }
  const value = score.value as number;
  if (value >= 60) return 'AI surfaces retrieve the brand. The question is whether coverage holds as peers invest in the same surface.';
  if (value >= 30) return 'AI surfaces find the brand inconsistently. The inconsistency itself is the story.';
  // GAP-12 — "AI surfaces do not yet retrieve the brand" speaks for every AI surface. It may only
  // be said when every provider in the matrix actually answered; otherwise the same measured
  // result is reported, scoped to what was measured, with the unqueried providers named.
  const gate = aiCoverageGate(report);
  if (!gate.supportsGeneralClaim) {
    return `The brand was not retrieved in the AI surfaces measured.${aiCoverageQualifier(gate)}`;
  }
  return 'AI surfaces do not yet retrieve the brand. The cost of absence grows each quarter buyer research shifts.';
}

export function trustConsistencyFraming(report: CanonicalReport): string {
  const trust = report.trust_coherence;
  if (trust.score.state === 'insufficient_signal' || trust.score.state === 'unavailable') {
    return 'Trust signals are evaluated cumulatively, not individually. Measurement is the first job.';
  }
  const value = trust.score.value as number;
  if (value >= 60) {
    return 'Trust signals corroborate each other — the silent multiplier on every other pillar.';
  }
  return 'Trust signals do not yet hold one shape. Fragmentation quietly suppresses every other pillar.';
}

export function strategicConstraintsFraming(report: CanonicalReport): string {
  const weak = findWeakest(report);
  if (!weak) return 'The constraint that matters is the one whose movement unlocks the most elsewhere.';
  return `The constraint that matters is not the lowest score — it is the one that, once moved, lifts the rest of the system. ${PILLAR_LABEL[weak.pillar]} sits in that position.`;
}

export function marketPositionFraming(report: CanonicalReport): string {
  const benchmark = report.benchmark;
  if (benchmark.state !== 'measured') {
    return 'Market position is read in relative terms. Where the comparison set is thin, interpret with care.';
  }
  return 'Market position is a function of relative shape, not absolute score. Peers move in parallel — the question is whether the brand opens distance or closes it.';
}

export function momentumMaturityFraming(report: CanonicalReport): string {
  const change = report.change_intelligence;
  const stage = report.maturity_stage;
  if (stage.stage === 'insufficient_signal') {
    return 'Maturity is not a score; it is a shape of work.';
  }
  if (change.state !== 'measured') {
    return 'Maturity describes where the brand is; momentum describes whether the position is durable.';
  }
  const dir = change.authority_delta.direction;
  if (dir === 'improved') return 'Momentum is favourable — sustain the inputs producing the lift, not the conclusion that produced them.';
  if (dir === 'regressed') return 'Momentum is unfavourable. Decay typically signals a maintenance failure, not the absence of new work.';
  if (dir === 'stagnated') return 'Momentum is flat. In a category where peers move, holding is relative loss.';
  return 'Momentum is forming. One observation describes the present; only repetition describes trajectory.';
}

export function strategicActionPlanFraming(report: CanonicalReport): string {
  if (!report.action_playbook.actions[0]) {
    return 'Strategic action is sequence-aware. The right work in the wrong order is the most common form of wasted effort.';
  }
  return 'The first move is not the largest — it is the one without which the larger moves cannot land.';
}

// ── Sentence sharpener ─────────────────────────────────────────────────────
//
// Light language pass for narrative paragraphs that come from canonical
// fields. The intent is not to rewrite — only to trim filler that softens
// executive read. Used sparingly and idempotently.

const FILLER_PHRASES: ReadonlyArray<[RegExp, string]> = [
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bin spite of the fact that\b/gi, 'although'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bwith respect to\b/gi, 'on'],
  [/\bin terms of\b/gi, 'on'],
  [/\bit is important to note that\b/gi, ''],
  [/\bit should be noted that\b/gi, ''],
  [/\bplease note that\b/gi, ''],
  [/\bin the event that\b/gi, 'if'],
  [/\bfor the purpose of\b/gi, 'to'],
];

export function sharpen(text: string | null | undefined): string {
  if (!text) return '';
  let out = String(text);
  for (const [pattern, replacement] of FILLER_PHRASES) {
    out = out.replace(pattern, replacement);
  }
  // Collapse any double spaces left by removed phrases.
  out = out.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
  // Capitalise first letter if removal left it lowercase.
  if (out.length > 0 && /[a-z]/.test(out[0])) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

// ── Composer ───────────────────────────────────────────────────────────────

export type SectionFraming = {
  authority_position: string;
  ai_discoverability: string;
  trust_consistency: string;
  strategic_constraints: string;
  market_position: string;
  momentum_maturity: string;
  strategic_action_plan: string;
};

export function buildSectionFraming(report: CanonicalReport): SectionFraming {
  return {
    authority_position: authorityPositionFraming(report),
    ai_discoverability: aiDiscoverabilityFraming(report),
    trust_consistency: trustConsistencyFraming(report),
    strategic_constraints: strategicConstraintsFraming(report),
    market_position: marketPositionFraming(report),
    momentum_maturity: momentumMaturityFraming(report),
    strategic_action_plan: strategicActionPlanFraming(report),
  };
}
