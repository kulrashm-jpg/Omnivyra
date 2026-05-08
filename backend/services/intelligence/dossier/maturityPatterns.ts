// Maturity-pattern observations for the executive dossier.
//
// Generates "What Leaders Typically Do" interpretive lines per maturity stage.
// These are pattern observations that follow logically from the canonical
// 6-stage maturity model — NOT fabricated benchmark statistics, NOT fake peer
// percentages, NOT invented industry claims.
//
// The goal is to give the reader a sense of *what shape of work* tends to
// produce stage advancement, so the dossier reads as a strategic interpretation
// rather than a flat scorecard. All observations are stage-driven and would
// hold true even with no peer data at all.
//
// (Strategic-shape observations now live in `authorityShape.ts` as the
// canonical Authority Shape system.)

import type { CanonicalReport } from '../../canonicalReport/canonicalReportTypes';

export type MaturityStage =
  | 'insufficient_signal'
  | 'foundational'
  | 'emerging'
  | 'developing'
  | 'operational'
  | 'advanced'
  | 'leading';

export type MaturityPattern = {
  /** What leaders at this stage focus on. */
  leaders_focus_on: string;
  /** What leaders at this stage typically avoid. */
  leaders_avoid: string;
  /** The shape of work that tends to advance to the next stage. */
  what_advances: string;
};

const STAGE_PATTERNS: Record<Exclude<MaturityStage, 'insufficient_signal'>, MaturityPattern> = {
  foundational: {
    leaders_focus_on:
      'closing technical gaps before measuring authority. At this stage, the work is unglamorous: indexability, schema correctness, structural extractability.',
    leaders_avoid:
      'investing in content amplification or backlink campaigns while the foundation is still leaking. Distribution on top of an unstable base wastes spend.',
    what_advances:
      'a stable, extractable, machine-readable foundation. Once the substrate holds, every subsequent investment compounds rather than dissipates.',
  },
  emerging: {
    leaders_focus_on:
      'one pillar at a time, deliberately. The temptation at this stage is breadth; the leverage is depth — picking one pillar and moving it from foundational to operational before opening a second front.',
    leaders_avoid:
      'parallel campaigns across multiple pillars at half-effort. The most expensive mistake at the emerging stage is spreading thin enough that no pillar reaches a self-sustaining state.',
    what_advances:
      'a single pillar reaching operational reliability. That reliability is what changes how the brand reads in evaluation — peers see a brand that does one thing convincingly rather than four things partially.',
  },
  developing: {
    leaders_focus_on:
      'consistency. The shift from developing to operational is rarely about new work — it is about producing work that holds the same shape over time and across surfaces.',
    leaders_avoid:
      'reinventing voice, structure, or signal architecture mid-quarter. Developing-stage brands lose ground when their public surface drifts faster than their evaluators can re-anchor on them.',
    what_advances:
      'rhythmic, predictable output that allows evaluators to form a stable picture. Authority compounds when the brand becomes legible — not when it becomes louder.',
  },
  operational: {
    leaders_focus_on:
      'differentiation. Operational-stage brands have proven they can run the playbook; the question becomes which signals they will own that peers do not.',
    leaders_avoid:
      'parity moves — adding the same proof points peers have. At this stage, parity raises the floor without changing position. Distinctiveness is what shifts the read.',
    what_advances:
      'a small number of authoritative artifacts that no peer can credibly replicate — proprietary research, primary data, named expertise. These are what convert operational competence into advanced authority.',
  },
  advanced: {
    leaders_focus_on:
      'compounding. Advanced-stage brands have the substrate, the signal, and the corroboration; the work shifts to ensuring each new effort adds to a coherent, citable body of authority.',
    leaders_avoid:
      'campaign-shaped thinking. At advanced maturity, episodic launches lose to continuous investment in a thesis that the entire ecosystem reinforces.',
    what_advances:
      'a thesis the brand owns in evaluators\' minds. The signal that takes brands from advanced to leading is not volume — it is identification with a position.',
  },
  leading: {
    leaders_focus_on:
      'defence. At the leading stage, the strategic question inverts: defending the dimensions that produced the position is higher-leverage than reaching for a new one.',
    leaders_avoid:
      'reaching. Leading brands lose their position by chasing adjacencies before the core is institutionalised. Regression is more expensive than slower expansion.',
    what_advances:
      'institutionalisation. Codifying the inputs that produced today\'s position into team rituals means the position survives leadership changes, focus shifts, and market noise.',
  },
};

export function maturityPatternFor(report: CanonicalReport): MaturityPattern | null {
  const stage = report.maturity_stage.stage;
  if (stage === 'insufficient_signal') return null;
  return STAGE_PATTERNS[stage];
}
