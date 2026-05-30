/**
 * Variant Execution & Experiment Orchestration — comprehensive suite.
 *
 * Covers PHASE 18 of the variant execution prompt:
 *
 *   PHASE 1  — variant execution contract (modes, validation)
 *   PHASE 2  — request-driven variant selection (single / pinned)
 *   PHASE 6  — best-variant resolution + winner fallback
 *   PHASE 7  — top-3 generation
 *   PHASE 8  — experiment-mode fan-out
 *   PHASE 9  — experiment tracker lifecycle
 *   PHASE 15 — safety + governance (planner doesn't bypass anything)
 *   PHASE 16 — operator controls + overrides
 *   PHASE 17 — legacy compatibility (strategy + render flows untouched)
 */

import {
  VARIANT_EXECUTION_MODES,
  isVariantExecutionMode,
  validateVariantExecutionRequest,
  type VariantExecutionRequest,
} from '../../services/creator/variantExecutionContract';
import { planVariantExecution } from '../../services/creator/variantExecutionPlanner';
import {
  clearVariantOperatorControls,
  defaultVariantOperatorControls,
  getVariantOperatorControls,
  setVariantOperatorControls,
} from '../../services/creator/variantOperatorControls';
import {
  clearExperimentTracker,
  completeExperiment,
  experimentTrackerStats,
  getExperiment,
  listExperiments,
  registerExperiment,
  transitionExperimentAsset,
} from '../../services/creator/variantExperimentTracker';
import {
  clearAllStrategyAnalytics,
  recordStrategyEvent,
} from '../../services/creator/strategyAnalyticsRecorder';

const COMPANY = 'co-execution';
const CAMPAIGN = 'camp-execution';

beforeEach(() => {
  clearAllStrategyAnalytics();
  clearVariantOperatorControls();
  clearExperimentTracker();
});

function baseRequest(overrides: Partial<VariantExecutionRequest> = {}): VariantExecutionRequest {
  return {
    companyId: COMPANY,
    strategyId: 'image:quote-image',
    mode: 'single_variant',
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 1 — contract                                                  */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 1 — Execution contract', () => {
  test('exposes 4 modes', () => {
    expect(VARIANT_EXECUTION_MODES).toEqual([
      'single_variant', 'best_variant', 'top_3_variants', 'experiment',
    ]);
  });

  test('isVariantExecutionMode guard', () => {
    expect(isVariantExecutionMode('single_variant')).toBe(true);
    expect(isVariantExecutionMode('top_3_variants')).toBe(true);
    expect(isVariantExecutionMode('foo')).toBe(false);
    expect(isVariantExecutionMode(null)).toBe(false);
  });

  test('validateVariantExecutionRequest rejects missing companyId', () => {
    expect(validateVariantExecutionRequest({
      companyId: '', strategyId: 'image:quote-image', mode: 'single_variant',
    } as any)).toMatchObject({ code: 'company_id_required' });
  });

  test('validateVariantExecutionRequest rejects missing strategyId', () => {
    expect(validateVariantExecutionRequest({
      companyId: COMPANY, strategyId: '', mode: 'single_variant',
    } as any)).toMatchObject({ code: 'strategy_id_required' });
  });

  test('validateVariantExecutionRequest rejects invalid mode', () => {
    expect(validateVariantExecutionRequest({
      companyId: COMPANY, strategyId: 'image:quote-image', mode: 'gibberish' as any,
    })).toMatchObject({ code: 'invalid_mode' });
  });

  test('validateVariantExecutionRequest rejects invalid variant family', () => {
    expect(validateVariantExecutionRequest({
      companyId: COMPANY, strategyId: 'image:quote-image', mode: 'single_variant', variantFamily: 'v9' as any,
    })).toMatchObject({ code: 'invalid_variant_family' });
  });

  test('validateVariantExecutionRequest accepts valid request', () => {
    expect(validateVariantExecutionRequest(baseRequest())).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 2 — request-driven variant selection                           */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 2 — Request-driven variant selection (single mode)', () => {
  test('pinned variant_id is honored', () => {
    const result = planVariantExecution(baseRequest({
      mode: 'single_variant',
      variantId: 'image:quote-image:v2',
    }));
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].variant.variant_id).toBe('image:quote-image:v2');
    expect(result.decisions[0].source).toBe('caller_pinned');
  });

  test('pinned variant_family is honored', () => {
    const result = planVariantExecution(baseRequest({
      mode: 'single_variant',
      variantFamily: 'v3',
    }));
    expect(result.decisions[0].variant.variant_family).toBe('v3');
    expect(result.decisions[0].source).toBe('caller_pinned');
  });

  test('cross-strategy pinned variant_id falls back to baseline', () => {
    const result = planVariantExecution(baseRequest({
      mode: 'single_variant',
      strategyId: 'image:quote-image',
      variantId: 'carousel:story-carousel:v2', // wrong strategy
    }));
    expect(result.decisions[0].variant.variant_family).toBe('v1');
    expect(result.decisions[0].source).toBe('baseline_fallback');
  });

  test('no pin → V1 baseline', () => {
    const result = planVariantExecution(baseRequest({ mode: 'single_variant' }));
    expect(result.decisions[0].variant.variant_family).toBe('v1');
    expect(result.decisions[0].source).toBe('baseline_fallback');
  });

  test('returns empty decisions when strategy unknown', () => {
    const result = planVariantExecution(baseRequest({ strategyId: 'image:not-real' }));
    expect(result.decisions).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 6 — best variant resolution                                    */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 6 — Best variant resolution', () => {
  test('no analytics data → V1 baseline fallback with explainability', () => {
    const result = planVariantExecution(baseRequest({ mode: 'best_variant' }));
    expect(result.decisions[0].variant.variant_family).toBe('v1');
    expect(result.decisions[0].source).toBe('baseline_fallback');
    expect(result.decisions[0].reasoning).toMatch(/No declared winner/);
  });

  test('engine winner is selected when thresholds met', () => {
    for (let i = 0; i < 4; i++) {
      recordStrategyEvent({ type: 'impression', companyId: COMPANY, strategyId: 'carousel:story-carousel', variantFamily: 'v1', weight: 50 });
      recordStrategyEvent({ type: 'click',      companyId: COMPANY, strategyId: 'carousel:story-carousel', variantFamily: 'v1', weight: 2 });
      recordStrategyEvent({ type: 'impression', companyId: COMPANY, strategyId: 'carousel:story-carousel', variantFamily: 'v2', weight: 50 });
      recordStrategyEvent({ type: 'click',      companyId: COMPANY, strategyId: 'carousel:story-carousel', variantFamily: 'v2', weight: 12 });
      recordStrategyEvent({ type: 'impression', companyId: COMPANY, strategyId: 'carousel:story-carousel', variantFamily: 'v3', weight: 50 });
      recordStrategyEvent({ type: 'click',      companyId: COMPANY, strategyId: 'carousel:story-carousel', variantFamily: 'v3', weight: 5 });
    }
    const result = planVariantExecution(baseRequest({
      strategyId: 'carousel:story-carousel',
      mode: 'best_variant',
    }));
    expect(result.decisions[0].variant.variant_family).toBe('v2');
    expect(result.decisions[0].source).toBe('winner_engine');
    expect(result.decisions[0].reasoning).toMatch(/Winning variant/);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 7 — top-3                                                      */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 7 — Top 3 generation', () => {
  test('returns 3 ranked decisions', () => {
    const result = planVariantExecution(baseRequest({ mode: 'top_3_variants' }));
    expect(result.decisions).toHaveLength(3);
    expect(result.decisions.map((d) => d.rank)).toEqual([1, 2, 3]);
    const families = result.decisions.map((d) => d.variant.variant_family);
    expect(families).toEqual(expect.arrayContaining(['v1', 'v2', 'v3']));
    for (const d of result.decisions) expect(d.source).toBe('experiment_fan_out');
  });

  test('annotates current leader + runner-up when winner exists', () => {
    for (let i = 0; i < 4; i++) {
      recordStrategyEvent({ type: 'impression', companyId: COMPANY, strategyId: 'image:promotional-image', variantFamily: 'v1', weight: 50 });
      recordStrategyEvent({ type: 'click',      companyId: COMPANY, strategyId: 'image:promotional-image', variantFamily: 'v1', weight: 2 });
      recordStrategyEvent({ type: 'impression', companyId: COMPANY, strategyId: 'image:promotional-image', variantFamily: 'v2', weight: 50 });
      recordStrategyEvent({ type: 'click',      companyId: COMPANY, strategyId: 'image:promotional-image', variantFamily: 'v2', weight: 12 });
      recordStrategyEvent({ type: 'impression', companyId: COMPANY, strategyId: 'image:promotional-image', variantFamily: 'v3', weight: 50 });
      recordStrategyEvent({ type: 'click',      companyId: COMPANY, strategyId: 'image:promotional-image', variantFamily: 'v3', weight: 5 });
    }
    const result = planVariantExecution(baseRequest({
      strategyId: 'image:promotional-image',
      mode: 'top_3_variants',
    }));
    const leader = result.decisions.find((d) => d.variant.variant_family === 'v2');
    const runnerUp = result.decisions.find((d) => d.variant.variant_family === 'v3');
    expect(leader!.reasoning).toMatch(/leader/);
    expect(runnerUp!.reasoning).toMatch(/runner-up/);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 8 — experiment fan-out                                         */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 8 — Experiment mode fan-out', () => {
  test('produces 3 decisions and registers an experiment', () => {
    const result = planVariantExecution(baseRequest({
      strategyId: 'infographic:comparison',
      mode: 'experiment',
      correlationId: 'corr-1',
    }));
    expect(result.decisions).toHaveLength(3);
    expect(result.experimentId).not.toBeNull();
    expect(result.experimentId).toMatch(/^exp_/);
    const exp = getExperiment({ companyId: COMPANY, experimentId: result.experimentId! });
    expect(exp).not.toBeNull();
    expect(exp!.strategy_id).toBe('infographic:comparison');
    expect(exp!.mode).toBe('experiment');
    expect(exp!.assets).toHaveLength(3);
    expect(exp!.correlation_id).toBe('corr-1');
  });

  test('experiment id is unique per request', () => {
    const a = planVariantExecution(baseRequest({ mode: 'experiment' }));
    const b = planVariantExecution(baseRequest({ mode: 'experiment' }));
    expect(a.experimentId).not.toBe(b.experimentId);
  });

  test('non-experiment modes do not register an experiment', () => {
    const single = planVariantExecution(baseRequest({ mode: 'single_variant' }));
    const top3 = planVariantExecution(baseRequest({ mode: 'top_3_variants' }));
    const best = planVariantExecution(baseRequest({ mode: 'best_variant' }));
    expect(single.experimentId).toBeNull();
    expect(top3.experimentId).toBeNull();
    expect(best.experimentId).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 9 — experiment tracker lifecycle                               */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 9 — Experiment tracker lifecycle', () => {
  test('aggregate state = slowest asset state', () => {
    const exp = registerExperiment({
      companyId: COMPANY,
      campaignId: CAMPAIGN,
      strategyId: 'image:quote-image',
      mode: 'experiment',
      variantIds: [
        { variant_id: 'image:quote-image:v1', variant_family: 'v1' },
        { variant_id: 'image:quote-image:v2', variant_family: 'v2' },
        { variant_id: 'image:quote-image:v3', variant_family: 'v3' },
      ],
    });
    expect(exp.state).toBe('created');
    transitionExperimentAsset({
      companyId: COMPANY,
      experimentId: exp.experiment_id,
      variantId: 'image:quote-image:v1',
      state: 'generated',
    });
    transitionExperimentAsset({
      companyId: COMPANY,
      experimentId: exp.experiment_id,
      variantId: 'image:quote-image:v2',
      state: 'published',
    });
    const after = getExperiment({ companyId: COMPANY, experimentId: exp.experiment_id });
    // V3 still at 'created' → aggregate is 'created'.
    expect(after!.state).toBe('created');
    transitionExperimentAsset({
      companyId: COMPANY,
      experimentId: exp.experiment_id,
      variantId: 'image:quote-image:v3',
      state: 'generated',
    });
    const after2 = getExperiment({ companyId: COMPANY, experimentId: exp.experiment_id });
    // Slowest is now 'generated'.
    expect(after2!.state).toBe('generated');
  });

  test('lifecycle is monotonic — earlier state is a no-op', () => {
    const exp = registerExperiment({
      companyId: COMPANY,
      strategyId: 'image:quote-image',
      mode: 'experiment',
      variantIds: [{ variant_id: 'image:quote-image:v1', variant_family: 'v1' }],
    });
    transitionExperimentAsset({
      companyId: COMPANY,
      experimentId: exp.experiment_id,
      variantId: 'image:quote-image:v1',
      state: 'published',
    });
    transitionExperimentAsset({
      companyId: COMPANY,
      experimentId: exp.experiment_id,
      variantId: 'image:quote-image:v1',
      state: 'created', // earlier — no-op
    });
    const after = getExperiment({ companyId: COMPANY, experimentId: exp.experiment_id });
    expect(after!.assets[0].state).toBe('published');
  });

  test('completeExperiment forces every asset to completed', () => {
    const exp = registerExperiment({
      companyId: COMPANY,
      strategyId: 'image:quote-image',
      mode: 'experiment',
      variantIds: [
        { variant_id: 'image:quote-image:v1', variant_family: 'v1' },
        { variant_id: 'image:quote-image:v2', variant_family: 'v2' },
      ],
    });
    const after = completeExperiment({ companyId: COMPANY, experimentId: exp.experiment_id });
    expect(after!.state).toBe('completed');
    expect(after!.assets.every((a) => a.state === 'completed')).toBe(true);
  });

  test('listExperiments filters by state', () => {
    const a = registerExperiment({
      companyId: COMPANY, strategyId: 'image:quote-image', mode: 'experiment',
      variantIds: [{ variant_id: 'image:quote-image:v1', variant_family: 'v1' }],
    });
    const b = registerExperiment({
      companyId: COMPANY, strategyId: 'carousel:story-carousel', mode: 'experiment',
      variantIds: [{ variant_id: 'carousel:story-carousel:v1', variant_family: 'v1' }],
    });
    completeExperiment({ companyId: COMPANY, experimentId: a.experiment_id });
    const active = listExperiments({ companyId: COMPANY, state: 'active' });
    const completed = listExperiments({ companyId: COMPANY, state: 'completed' });
    expect(active.map((e) => e.experiment_id)).toEqual([b.experiment_id]);
    expect(completed.map((e) => e.experiment_id)).toEqual([a.experiment_id]);
  });

  test('transition returns null for unknown experiment/variant', () => {
    expect(transitionExperimentAsset({
      companyId: COMPANY, experimentId: 'nope', variantId: 'x', state: 'generated',
    })).toBeNull();
  });

  test('stats expose bounded caps', () => {
    const stats = experimentTrackerStats();
    expect(stats.maxOrgs).toBeGreaterThan(0);
    expect(stats.maxExperimentsPerOrg).toBeGreaterThan(0);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 15 — safety + governance                                       */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 15 — Safety: planner produces plan only, not assets', () => {
  test('experiment-mode result carries variant ids only — no bypass of governance', () => {
    const result = planVariantExecution(baseRequest({ mode: 'experiment' }));
    // The planner returns VariantDefinition objects, not generated
    // assets. The downstream pipeline must run its existing
    // governance / QA / moderation gates before any asset is emitted.
    for (const decision of result.decisions) {
      expect(decision.variant).toHaveProperty('variant_id');
      expect(decision.variant).toHaveProperty('strategy_id');
      expect(decision).not.toHaveProperty('rendered_asset');
      expect(decision).not.toHaveProperty('published');
    }
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 16 — operator controls                                         */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 16 — Operator controls', () => {
  test('default controls = all switches off', () => {
    expect(getVariantOperatorControls(COMPANY)).toEqual(defaultVariantOperatorControls());
  });

  test('setVariantOperatorControls partial merge', () => {
    setVariantOperatorControls(COMPANY, { forceBaselineV1: true });
    const c = getVariantOperatorControls(COMPANY);
    expect(c.forceBaselineV1).toBe(true);
    expect(c.forceWinningVariant).toBe(false);
  });

  test('forceBaselineV1 collapses any request to V1 baseline', () => {
    setVariantOperatorControls(COMPANY, { forceBaselineV1: true });
    const result = planVariantExecution(baseRequest({
      strategyId: 'carousel:story-carousel',
      mode: 'experiment', // would normally fan out
    }));
    expect(result.resolvedMode).toBe('single_variant');
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].variant.variant_family).toBe('v1');
    expect(result.decisions[0].source).toBe('operator_forced');
    expect(result.appliedOverrides).toContain('forced_baseline_v1');
  });

  test('variantExplorationDisabled also collapses to V1 baseline', () => {
    setVariantOperatorControls(COMPANY, { variantExplorationDisabled: true });
    const result = planVariantExecution(baseRequest({
      mode: 'top_3_variants',
    }));
    expect(result.resolvedMode).toBe('single_variant');
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].variant.variant_family).toBe('v1');
    expect(result.appliedOverrides).toContain('variant_exploration_disabled');
  });

  test('experimentModeDisabled downgrades experiment → top_3', () => {
    setVariantOperatorControls(COMPANY, { experimentModeDisabled: true });
    const result = planVariantExecution(baseRequest({
      mode: 'experiment',
    }));
    expect(result.resolvedMode).toBe('top_3_variants');
    expect(result.decisions).toHaveLength(3);
    expect(result.experimentId).toBeNull(); // not registered as an experiment
    expect(result.appliedOverrides).toContain('experiment_disabled');
  });

  test('forceWinningVariant promotes any mode to best_variant', () => {
    setVariantOperatorControls(COMPANY, { forceWinningVariant: true });
    const result = planVariantExecution(baseRequest({ mode: 'top_3_variants' }));
    expect(result.resolvedMode).toBe('best_variant');
    expect(result.decisions).toHaveLength(1);
    expect(result.appliedOverrides).toContain('forced_winning_variant');
  });

  test('forceBaselineV1 wins over forceWinningVariant (more restrictive)', () => {
    setVariantOperatorControls(COMPANY, { forceBaselineV1: true, forceWinningVariant: true });
    const result = planVariantExecution(baseRequest({ mode: 'best_variant' }));
    expect(result.resolvedMode).toBe('single_variant');
    expect(result.decisions[0].variant.variant_family).toBe('v1');
    expect(result.appliedOverrides).toContain('forced_baseline_v1');
    expect(result.appliedOverrides).not.toContain('forced_winning_variant');
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 17 — legacy compatibility                                      */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 17 — Regression-safety', () => {
  test('planner does not throw on unknown strategy', () => {
    expect(() => planVariantExecution(baseRequest({ strategyId: 'image:fictional' }))).not.toThrow();
  });

  test('legacy callers (no variant pin, single mode) get V1 baseline — back-compat with pre-variant flow', () => {
    const result = planVariantExecution(baseRequest({ mode: 'single_variant' }));
    expect(result.decisions[0].variant.variant_family).toBe('v1');
  });

  test('cross-strategy variant_id in single mode falls back, does not throw', () => {
    const result = planVariantExecution(baseRequest({
      mode: 'single_variant',
      strategyId: 'image:quote-image',
      variantId: 'carousel:story-carousel:v2',
    }));
    expect(result.decisions[0].variant.strategy_id).toBe('image:quote-image');
    expect(result.decisions[0].source).toBe('baseline_fallback');
  });

  test('listExperiments returns [] for unknown company', () => {
    expect(listExperiments({ companyId: 'nope' })).toEqual([]);
  });

  test('clearing operator controls + tracker resets to baseline defaults', () => {
    setVariantOperatorControls(COMPANY, { forceBaselineV1: true });
    registerExperiment({
      companyId: COMPANY, strategyId: 'image:quote-image', mode: 'experiment',
      variantIds: [{ variant_id: 'image:quote-image:v1', variant_family: 'v1' }],
    });
    clearVariantOperatorControls();
    clearExperimentTracker();
    expect(getVariantOperatorControls(COMPANY)).toEqual(defaultVariantOperatorControls());
    expect(listExperiments({ companyId: COMPANY })).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Integration — end-to-end                                             */
/* ─────────────────────────────────────────────────────────────────── */

describe('Integration — end-to-end execution flow', () => {
  test('experiment plan → registered → transitioned → completed', () => {
    const result = planVariantExecution(baseRequest({
      strategyId: 'infographic:stats',
      mode: 'experiment',
      correlationId: 'corr-int',
    }));
    expect(result.decisions).toHaveLength(3);
    expect(result.experimentId).not.toBeNull();
    for (const decision of result.decisions) {
      transitionExperimentAsset({
        companyId: COMPANY,
        experimentId: result.experimentId!,
        variantId: decision.variant.variant_id,
        state: 'generated',
        assetId: `asset-${decision.variant.variant_family}`,
      });
    }
    const mid = getExperiment({ companyId: COMPANY, experimentId: result.experimentId! });
    expect(mid!.state).toBe('generated');
    for (const decision of result.decisions) {
      transitionExperimentAsset({
        companyId: COMPANY,
        experimentId: result.experimentId!,
        variantId: decision.variant.variant_id,
        state: 'published',
        scheduledPostId: `sched-${decision.variant.variant_family}`,
      });
    }
    completeExperiment({ companyId: COMPANY, experimentId: result.experimentId! });
    const finalExp = getExperiment({ companyId: COMPANY, experimentId: result.experimentId! });
    expect(finalExp!.state).toBe('completed');
    for (const asset of finalExp!.assets) {
      expect(asset.state).toBe('completed');
      expect(asset.asset_id).toMatch(/^asset-/);
      expect(asset.scheduled_post_id).toMatch(/^sched-/);
    }
  });
});
