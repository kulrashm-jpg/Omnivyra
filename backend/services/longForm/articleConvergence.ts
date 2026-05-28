/**
 * articleConvergence.ts
 *
 * Phase 5.5 — `evaluateArticleConvergence()`.
 *
 * The final article gate BEFORE any compatibility-core fallback. Combines
 * all per-section signals into a single shipRecommendation:
 *
 *   SHIP               — all gates clean
 *   SHIP_WITH_SOFTENING — claims need pre-publish softening but article ships
 *   PARTIAL_SHIP       — some sections abandoned; ship the rest
 *   REPAIR_REQUIRED    — more repair iterations needed
 *   ABORT              — escalate to fallback or abandon
 */

import type { SectionLifecycleHistoryEntry } from './sectionLifecycleManager';
import { SectionLifecycleState } from './sectionLifecycleManager';

// ── Public types ─────────────────────────────────────────────────────────────

export type ShipRecommendation =
  | 'SHIP'
  | 'SHIP_WITH_SOFTENING'
  | 'PARTIAL_SHIP'
  | 'REPAIR_REQUIRED'
  | 'ABORT';

export interface ArticleConvergenceResult {
  convergenceScore: number;        // 0..100
  shipRecommendation: ShipRecommendation;
  requiredRepairs: Array<{ sectionIndex: number; reason: string }>;
  optionalRepairs: Array<{ sectionIndex: number; reason: string }>;
  unsafeSections: Array<{ sectionIndex: number; reason: string }>;
  componentScores: {
    sectionPassRate: number;       // 0..100
    groundingCoverage: number;     // 0..100
    alignmentAverage: number;      // 0..100
    narrativeContinuity: number;   // 0..100
    repetitionScore: number;       // 0..100 (HIGHER IS BETTER → inverse of detector)
    assignmentCoverage: number;    // 0..100
  };
  reasoning: string[];
}

export interface AcceptedSectionMetric {
  sectionIndex: number;
  alignmentScore?: number;
  continuityScore?: number;
  groundingEvidenceCoverage?: number;
  consumptionRatio?: number;
}

export interface AbandonedSectionEntry {
  sectionIndex: number;
  reason: string;
}

export interface EvaluateArticleConvergenceInput {
  acceptedSections: AcceptedSectionMetric[];
  abandonedSections: AbandonedSectionEntry[];
  totalSections: number;
  /** Overall semantic-grounding coverage (0..100). */
  groundingCoverage?: number;
  /** Repetition score from semanticRepetitionDetector (0..100, HIGHER = MORE REPETITION). */
  repetitionScoreRaw?: number;
  /** Strategic-assignment consumption ratio (0..1). */
  assignmentCoverageRatio?: number;
  /** Narrative continuity overall (0..100). */
  narrativeContinuity?: number;
  /** Lifecycle history (for ABANDONED-state cross-check). */
  lifecycleHistory?: SectionLifecycleHistoryEntry[];
  /** Optional softening targets — if non-empty, ship will recommend SHIP_WITH_SOFTENING. */
  softeningTargets?: Array<{ sectionIndex: number; reason: string }>;
}

// ── Thresholds ───────────────────────────────────────────────────────────────

const PASS_RATE_SHIP = 0.92;
const PASS_RATE_PARTIAL_SHIP = 0.70;
const PASS_RATE_REPAIR = 0.50;

const CONVERGENCE_SHIP = 80;
const CONVERGENCE_PARTIAL = 60;
const CONVERGENCE_REPAIR = 45;

const ABORT_ABANDONED_SHARE = 0.5;
const ABORT_UNSAFE_SHARE = 0.4;

// ── Main ─────────────────────────────────────────────────────────────────────

export function evaluateArticleConvergence(
  input: EvaluateArticleConvergenceInput,
): ArticleConvergenceResult {
  const reasoning: string[] = [];
  const totalSections = Math.max(1, input.totalSections);
  const acceptedCount = input.acceptedSections.length;
  const abandonedCount = input.abandonedSections.length;
  const sectionPassRate = acceptedCount / totalSections;

  // ── Component scoring ─────────────────────────────────────────────────
  const groundingCoverage = clampPct(input.groundingCoverage ?? 0);
  const repetitionRaw = clampPct(input.repetitionScoreRaw ?? 0);
  // Inverse: low repetition score = high "uniqueness" component score.
  const repetitionScore = 100 - repetitionRaw;
  const assignmentCoverage = clampPct((input.assignmentCoverageRatio ?? 1) * 100);
  const narrativeContinuity = clampPct(input.narrativeContinuity ?? 70);

  const alignmentAvg = (() => {
    const vals = input.acceptedSections
      .map((s) => s.alignmentScore)
      .filter((v): v is number => typeof v === 'number');
    if (vals.length === 0) return 0;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  })();

  // ── Composite convergence ─────────────────────────────────────────────
  // Weighted blend:
  //   30% section pass rate
  //   20% grounding coverage
  //   15% alignment average
  //   15% narrative continuity
  //   10% repetition uniqueness
  //   10% assignment coverage
  const convergenceScore = Math.round(
    30 * sectionPassRate +
    20 * (groundingCoverage / 100) +
    15 * (alignmentAvg / 100) +
    15 * (narrativeContinuity / 100) +
    10 * (repetitionScore / 100) +
    10 * (assignmentCoverage / 100),
  ) * 1; // keep as 0..100
  const finalScore = Math.min(100, Math.max(0, convergenceScore));

  // ── Unsafe-section detection ─────────────────────────────────────────
  const unsafeSections: Array<{ sectionIndex: number; reason: string }> = [];

  for (const a of input.abandonedSections) {
    unsafeSections.push({ sectionIndex: a.sectionIndex, reason: a.reason });
  }
  // Cross-check lifecycle: if any section ABANDONED but not in abandonedSections, surface it.
  if (input.lifecycleHistory) {
    for (const h of input.lifecycleHistory) {
      if (h.finalState === SectionLifecycleState.ABANDONED
          && !unsafeSections.some((u) => u.sectionIndex === h.sectionIndex)) {
        unsafeSections.push({
          sectionIndex: h.sectionIndex,
          reason: h.abandonmentReason ?? 'lifecycle_abandoned',
        });
      }
    }
  }

  // ── Required vs optional repairs ─────────────────────────────────────
  const requiredRepairs: Array<{ sectionIndex: number; reason: string }> = [];
  const optionalRepairs: Array<{ sectionIndex: number; reason: string }> = [];

  // Sections with weak grounding (<40 coverage) are REQUIRED if high-risk.
  for (const sec of input.acceptedSections) {
    if (typeof sec.groundingEvidenceCoverage === 'number'
        && sec.groundingEvidenceCoverage < 40) {
      requiredRepairs.push({
        sectionIndex: sec.sectionIndex,
        reason: `Low grounding coverage (${sec.groundingEvidenceCoverage}).`,
      });
    }
    if (typeof sec.alignmentScore === 'number' && sec.alignmentScore < 50) {
      requiredRepairs.push({
        sectionIndex: sec.sectionIndex,
        reason: `Weak alignment score (${sec.alignmentScore}).`,
      });
    }
    if (typeof sec.consumptionRatio === 'number' && sec.consumptionRatio < 0.4) {
      optionalRepairs.push({
        sectionIndex: sec.sectionIndex,
        reason: `Assignment consumption ratio (${sec.consumptionRatio}).`,
      });
    }
  }

  if (repetitionRaw >= 55) {
    optionalRepairs.push({ sectionIndex: -1, reason: `Article-level semantic repetition score ${repetitionRaw}.` });
  }

  // ── Ship recommendation ───────────────────────────────────────────────
  const abandonedShare = abandonedCount / totalSections;
  const unsafeShare = unsafeSections.length / totalSections;

  let shipRecommendation: ShipRecommendation;

  if (abandonedShare >= ABORT_ABANDONED_SHARE || unsafeShare >= ABORT_UNSAFE_SHARE) {
    shipRecommendation = 'ABORT';
    reasoning.push(`${abandonedCount}/${totalSections} sections abandoned (share ${(abandonedShare * 100).toFixed(0)}%); unsafe share ${(unsafeShare * 100).toFixed(0)}%. ABORT.`);
  } else if (sectionPassRate >= PASS_RATE_SHIP && finalScore >= CONVERGENCE_SHIP && requiredRepairs.length === 0) {
    if ((input.softeningTargets?.length ?? 0) > 0) {
      shipRecommendation = 'SHIP_WITH_SOFTENING';
      reasoning.push(`Pass rate ${(sectionPassRate * 100).toFixed(0)}%; convergence ${finalScore}. ${input.softeningTargets?.length} claims need softening before publish.`);
    } else {
      shipRecommendation = 'SHIP';
      reasoning.push(`Pass rate ${(sectionPassRate * 100).toFixed(0)}%; convergence ${finalScore}. Clean ship.`);
    }
  } else if (sectionPassRate >= PASS_RATE_PARTIAL_SHIP && finalScore >= CONVERGENCE_PARTIAL && abandonedShare < ABORT_ABANDONED_SHARE) {
    shipRecommendation = 'PARTIAL_SHIP';
    reasoning.push(`Pass rate ${(sectionPassRate * 100).toFixed(0)}% with ${abandonedCount} abandoned section(s); ship partial.`);
  } else if (sectionPassRate >= PASS_RATE_REPAIR && finalScore >= CONVERGENCE_REPAIR) {
    shipRecommendation = 'REPAIR_REQUIRED';
    reasoning.push(`Pass rate ${(sectionPassRate * 100).toFixed(0)}% with convergence ${finalScore}; repair before ship.`);
  } else {
    shipRecommendation = 'ABORT';
    reasoning.push(`Pass rate ${(sectionPassRate * 100).toFixed(0)}% with convergence ${finalScore} below repair floor. ABORT.`);
  }

  if (requiredRepairs.length > 0 && shipRecommendation === 'SHIP') {
    shipRecommendation = 'REPAIR_REQUIRED';
    reasoning.push(`${requiredRepairs.length} required repairs prevent clean SHIP.`);
  }

  return {
    convergenceScore: finalScore,
    shipRecommendation,
    requiredRepairs,
    optionalRepairs,
    unsafeSections,
    componentScores: {
      sectionPassRate: Math.round(sectionPassRate * 100),
      groundingCoverage,
      alignmentAverage: alignmentAvg,
      narrativeContinuity,
      repetitionScore,
      assignmentCoverage,
    },
    reasoning,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}
