/**
 * Generic capability-aware registry evaluator.
 * ---------------------------------------------
 * Shared engine for canonical, capability-aware Setup-style modules. A registry
 * is a list of categories; each category declares a capability + a set of
 * factors. Factors may themselves be "unavailable" (no canonical signal yet),
 * in which case they render as a capability note and are excluded from scoring.
 *
 * Scoring is deterministic and weighted:
 *   overall  = weighted mean of SCORED category scores
 *   category = weighted mean of its SCORED (available, weight>0) factor scores
 * Only supported && enabled && available categories with at least one scored
 * factor contribute; weights renormalize across that set. No magic numbers.
 *
 * ONE ENGINE. This is the single evaluation pipeline + capability model for
 * every command-center capability module. Setup (config/setupRegistry.ts) and
 * Readiness (config/readinessRegistry.ts) both compile to
 * `CapabilityCategoryDef<S>[]` and are evaluated here. Rendering is the single
 * shared components/command-center/CategoryFactorsPanel. Signals are produced
 * only by build*Signals() (lib/setup, lib/readiness) — no raw API access
 * elsewhere. Refresh is driven solely by the `setup:changed` event
 * (lib/setup/setupEvents), one subscription in useCommandCenterCore.
 *
 * ── FROZEN ARCHITECTURE — extension points only ──────────────────────────────
 * The Readiness (and Setup) architecture is frozen. To extend WITHOUT changing
 * the engine, panel, event system, or hook wiring:
 *
 *   • NEW CATEGORY  — add a `CapabilityCategoryDef<S>` entry to the module's
 *     registry (id, title, weight, capability(signals), factors(signals)).
 *     weight 0 = capability-only (informational, never scored).
 *   • NEW FACTOR    — add a `CapabilityFactorDef<S>` to a category's factors():
 *     evaluate(signals) returns either { score, missing?, recommendation?,
 *     nextAction? } or { available:false, reason } (a capability provider).
 *   • NEW CAPABILITY PROVIDER — add the canonical signal to the module's
 *     `Signals` contract, populate it in build*Signals() (the ONLY place raw API
 *     shapes are read), and have the factor's evaluate() read it. If a signal
 *     for the current company is unreadable, return { available:false, reason }
 *     — never a heuristic.
 *
 * A future Mastery module follows the same contract (a MASTERY_REGISTRY +
 * buildMasterySignals) and reuses this engine + panel unchanged.
 */

export interface CategoryCapability {
  supported: boolean;
  enabled: boolean;
  available: boolean;
  reason: string | null;
}

export type FactorStatus = 'done' | 'in_progress' | 'missing' | 'unavailable';

/** A factor either has no canonical signal (unavailable) or a 0..1 score. */
/**
 * A factor's next action references a canonical action by id (see
 * config/commandCenterActions). NO URLs here — the resolver owns destinations +
 * context params. `label` optionally overrides the action's default label.
 */
export interface FactorNextAction {
  actionId: string;
  label?: string;
}

export type FactorEvalResult =
  | { available: false; reason: string }
  | {
      available?: true;
      score: number;
      missing?: string[];
      recommendation?: string;
      nextAction?: FactorNextAction;
    };

export interface CapabilityFactorDef<S> {
  id: string;
  title: string;
  description: string;
  weight: number;
  evaluate: (signals: S) => FactorEvalResult;
}

export interface CapabilityCategoryDef<S> {
  id: string;
  title: string;
  /** Scoring weight; 0 = capability-only (never scored). */
  weight: number;
  capability: (signals: S) => CategoryCapability;
  factors: (signals: S) => CapabilityFactorDef<S>[];
}

export interface EvaluatedFactor {
  id: string;
  title: string;
  description: string;
  category: string;
  weight: number;
  available: boolean;
  score: number;
  status: FactorStatus;
  missing: string[];
  recommendation: string;
  nextAction?: FactorNextAction;
  /** Canonical reason when the factor is unavailable. */
  reason: string | null;
}

export interface EvaluatedCategory {
  id: string;
  title: string;
  weight: number;
  capability: CategoryCapability;
  scored: boolean;
  score: number;
  percent: number;
  status: FactorStatus;
  factors: EvaluatedFactor[];
  completedCount: number;
  totalCount: number;
}

export interface CapabilityEvaluation {
  categories: EvaluatedCategory[];
  overallPercent: number;
  summary: { completedCount: number; inProgressCount: number; totalCount: number };
}

function statusFromScore(score: number): FactorStatus {
  if (score >= 1) return 'done';
  if (score > 0) return 'in_progress';
  return 'missing';
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function weightedMean(items: Array<{ score: number; weight: number }>): number {
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  if (totalWeight === 0) return 0;
  const earned = items.reduce((sum, i) => sum + clamp01(i.score) * i.weight, 0);
  return earned / totalWeight;
}

export function evaluateCapabilityRegistry<S>(
  registry: CapabilityCategoryDef<S>[],
  signals: S,
): CapabilityEvaluation {
  const categories: EvaluatedCategory[] = [];

  for (const categoryDef of registry) {
    const capability = categoryDef.capability(signals);
    const categoryEvaluable = capability.supported && capability.enabled && capability.available;

    const factors: EvaluatedFactor[] = categoryEvaluable
      ? categoryDef.factors(signals).map((def) => {
          const result = def.evaluate(signals);
          if (result.available === false) {
            return {
              id: def.id,
              title: def.title,
              description: def.description,
              category: categoryDef.id,
              weight: def.weight,
              available: false,
              score: 0,
              status: 'unavailable' as FactorStatus,
              missing: [],
              recommendation: '',
              reason: result.reason,
            };
          }
          const score = clamp01(result.score);
          return {
            id: def.id,
            title: def.title,
            description: def.description,
            category: categoryDef.id,
            weight: def.weight,
            available: true,
            score,
            status: statusFromScore(score),
            missing: result.missing ?? [],
            recommendation: result.recommendation ?? '',
            nextAction: result.nextAction,
            reason: null,
          };
        })
      : [];

    const scoredFactors = factors.filter((f) => f.available && f.weight > 0);
    const scored = categoryEvaluable && categoryDef.weight > 0 && scoredFactors.length > 0;
    const catScore = scored
      ? weightedMean(scoredFactors.map((f) => ({ score: f.score, weight: f.weight })))
      : 0;

    categories.push({
      id: categoryDef.id,
      title: categoryDef.title,
      weight: categoryDef.weight,
      capability,
      scored,
      score: catScore,
      percent: Math.round(catScore * 100),
      status: scored ? statusFromScore(catScore) : 'missing',
      factors,
      completedCount: scoredFactors.filter((f) => f.status === 'done').length,
      totalCount: scoredFactors.length,
    });
  }

  const scoredCategories = categories.filter((c) => c.scored);
  const overall = weightedMean(scoredCategories.map((c) => ({ score: c.score, weight: c.weight })));

  const allScored = scoredCategories.flatMap((c) => c.factors.filter((f) => f.available && f.weight > 0));
  return {
    categories,
    overallPercent: Math.round(overall * 100),
    summary: {
      completedCount: allScored.filter((f) => f.status === 'done').length,
      inProgressCount: allScored.filter((f) => f.status === 'in_progress').length,
      totalCount: allScored.length,
    },
  };
}
