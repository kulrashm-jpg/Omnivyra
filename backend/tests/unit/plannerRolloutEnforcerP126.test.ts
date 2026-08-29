/**
 * PHASE 126 — the planner rollout must not mutate process.env.
 *
 * Production hardens process.env as a readonly proxy whose set-trap returns
 * false. Under strict mode that THROWS, and applyActiveRolloutMode's
 * `process.env[k] = ...` loop crashed POST /api/campaigns/ai/plan with
 *   TypeError: 'set' on proxy: trap returned falsish for property
 *   'DISTRIBUTED_POOL_ENABLED'
 * taking campaign planning with it. The identical failure had already been hit
 * and guarded in creatorRenderFonts; the planner call site was missed.
 *
 * Why the existing suites never caught it:
 *   - NODE_ENV=test, so initEnforcer() never installs the proxy and
 *     process.env is freely writable in every test;
 *   - campaignAiOrchestratorCharacterization mocks applyActiveRolloutMode
 *     outright, so the real function never runs.
 *
 * This suite closes both gaps: it installs a readonly proxy with the SAME
 * throwing semantics as production and runs the REAL function against it.
 */

import {
  applyActiveRolloutMode,
  getActiveFeatureFlags,
  resolvePlannerFlag,
  isRolloutModeExplicit,
} from '../../services/plannerRolloutMode';

const FLAG_KEYS = [
  'DISTRIBUTED_POOL_ENABLED',
  'PROVIDER_BUCKET_ENABLED',
  'STREAMING_DRAFT_ENABLED',
  'ASYNC_REFINEMENT_ENABLED',
  'DISTRIBUTED_EVENTS_ENABLED',
  'DISTRIBUTED_METRICS_ENABLED',
] as const;

const realEnv = process.env;
/** Every write the code under test attempted while the proxy was installed. */
let attemptedWrites: string[] = [];

/**
 * Install a process.env proxy with production's semantics: the set-trap
 * returns false, which throws in strict mode. This module is strict (ESM →
 * TS), so an assignment here fails exactly as it does in production.
 */
function installReadonlyEnvProxy(seed: NodeJS.ProcessEnv): void {
  attemptedWrites = [];
  const target = { ...seed };
  const proxied = new Proxy(target, {
    get: (t, p: string) => (t as Record<string, unknown>)[p],
    has: (t, p: string) => p in t,
    set: (_t, p: string) => { attemptedWrites.push(p); return false; },
    deleteProperty: (_t, p: string) => { attemptedWrites.push('delete:' + p); return false; },
  }) as NodeJS.ProcessEnv;
  Object.defineProperty(process, 'env', { value: proxied, configurable: true, writable: true });
}

function restoreEnv(): void {
  Object.defineProperty(process, 'env', { value: realEnv, configurable: true, writable: true });
}

afterEach(restoreEnv);

describe('P126 — applyActiveRolloutMode under a production-style readonly env', () => {
  test('the proxy really does throw on assignment (the harness is faithful)', () => {
    installReadonlyEnvProxy({ NODE_ENV: 'production' });
    // If this ever stops throwing, every other test here becomes vacuous.
    expect(() => { (process.env as Record<string, string>).ANY_KEY = 'x'; }).toThrow(/proxy/i);
  });

  test('does NOT throw — the forbidden write is gone', () => {
    installReadonlyEnvProxy({ NODE_ENV: 'production' });
    expect(() => applyActiveRolloutMode()).not.toThrow();
  });

  test('attempts ZERO writes to process.env', () => {
    installReadonlyEnvProxy({ NODE_ENV: 'production' });
    applyActiveRolloutMode();
    // The original implementation attempted six.
    expect(attemptedWrites).toEqual([]);
  });

  test('still returns all six resolved flags', () => {
    installReadonlyEnvProxy({ NODE_ENV: 'production' });
    const flags = applyActiveRolloutMode();
    expect(Object.keys(flags).sort()).toEqual([...FLAG_KEYS].sort());
    for (const k of FLAG_KEYS) expect(typeof flags[k]).toBe('boolean');
  });

  test('the returned values match the resolver, not stale env', () => {
    installReadonlyEnvProxy({ NODE_ENV: 'production', PLANNER_ROLLOUT_MODE: 'full_production' });
    const flags = applyActiveRolloutMode();
    expect(flags).toEqual(getActiveFeatureFlags());
    // full_production turns every flag on.
    for (const k of FLAG_KEYS) expect(flags[k]).toBe(true);
  });

  test('legacy mode resolves every flag off', () => {
    installReadonlyEnvProxy({ NODE_ENV: 'production', PLANNER_ROLLOUT_MODE: 'legacy' });
    const flags = applyActiveRolloutMode();
    for (const k of FLAG_KEYS) expect(flags[k]).toBe(false);
  });
});

describe('P126 — resolvePlannerFlag preserves the existing precedence', () => {
  test('an explicit env var wins over the mode profile', () => {
    installReadonlyEnvProxy({
      NODE_ENV: 'production',
      PLANNER_ROLLOUT_MODE: 'legacy',            // profile says false
      DISTRIBUTED_POOL_ENABLED: 'true',          // operator says true
    });
    expect(resolvePlannerFlag('DISTRIBUTED_POOL_ENABLED', false)).toBe(true);
  });

  test('an explicitly set mode governs when no per-flag override exists', () => {
    installReadonlyEnvProxy({ NODE_ENV: 'production', PLANNER_ROLLOUT_MODE: 'full_production' });
    // Consumer default is false; the operator's explicit mode must win.
    expect(resolvePlannerFlag('DISTRIBUTED_EVENTS_ENABLED', false)).toBe(true);
  });

  test('with NO mode set, the consumer default is preserved', () => {
    // This is production today: PLANNER_ROLLOUT_MODE is unset on both tiers.
    // Treating that as `legacy` would silently disable distributed pooling and
    // provider bucketing for ALL AI traffic, since aiGatewayCore consumes both.
    installReadonlyEnvProxy({ NODE_ENV: 'production' });
    expect(isRolloutModeExplicit()).toBe(false);
    expect(resolvePlannerFlag('DISTRIBUTED_POOL_ENABLED', true)).toBe(true);
    expect(resolvePlannerFlag('PROVIDER_BUCKET_ENABLED', true)).toBe(true);
    expect(resolvePlannerFlag('STREAMING_DRAFT_ENABLED', true)).toBe(true);
    expect(resolvePlannerFlag('ASYNC_REFINEMENT_ENABLED', false)).toBe(false);
    expect(resolvePlannerFlag('DISTRIBUTED_EVENTS_ENABLED', false)).toBe(false);
    expect(resolvePlannerFlag('DISTRIBUTED_METRICS_ENABLED', false)).toBe(false);
  });

  test('an unknown mode string is not treated as an operator decision', () => {
    installReadonlyEnvProxy({ NODE_ENV: 'production', PLANNER_ROLLOUT_MODE: 'not-a-mode' });
    expect(isRolloutModeExplicit()).toBe(false);
    expect(resolvePlannerFlag('DISTRIBUTED_POOL_ENABLED', true)).toBe(true);
  });

  test('resolving a flag never writes to process.env either', () => {
    installReadonlyEnvProxy({ NODE_ENV: 'production', PLANNER_ROLLOUT_MODE: 'full_production' });
    for (const k of FLAG_KEYS) resolvePlannerFlag(k, false);
    expect(attemptedWrites).toEqual([]);
  });
});
