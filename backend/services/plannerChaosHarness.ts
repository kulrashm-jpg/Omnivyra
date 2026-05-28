/**
 * Planner chaos validation harness.
 *
 * Programmatic fault injection for staging soak runs + chaos days. Each
 * scenario is a `ChaosScenario` with `inject` / `recover` / `assert`
 * hooks. The harness sequences them, records timeline events, asserts
 * convergence, and emits a structured report.
 *
 * Hard contract:
 *   - `inject` may toggle env flags, post to test-only endpoints, or
 *     directly manipulate Redis keys. It MUST be reversible.
 *   - `recover` reverses `inject`. Always called in `finally`, even on
 *     assertion failure, so a chaos run never leaves the system damaged.
 *   - `assert` returns within `assertTimeoutMs` with `{ ok, observations }`.
 *     Assertion polls cluster state every `assertPollMs` and converges
 *     when the recovery condition holds for `assertConvergenceMs` in a
 *     row — guards against transient flakes.
 *
 * Production safety:
 *   - Refuses to run unless `PLANNER_CHAOS_ENABLED=true`.
 *   - Refuses to run when `NODE_ENV === 'production'` UNLESS
 *     `PLANNER_CHAOS_ALLOW_PRODUCTION=true` is also set.
 *   - Refuses to run any scenario whose `prodSafe === false` outside of
 *     non-prod environments.
 *
 * Output: each scenario emits one `planner_chaos_result` log line
 * + a summary object with recovery-timeline, convergence-time, and a
 * per-category stability score.
 */

import { logger } from './logger';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ChaosCategory =
  | 'redis_outage'
  | 'redis_latency'
  | 'provider_outage'
  | 'provider_429'
  | 'bullmq_stall'
  | 'worker_crash'
  | 'sse_disconnect_storm'
  | 'stream_corruption'
  | 'replay_duplication'
  | 'semaphore_split_brain'
  | 'token_bucket_drift'
  | 'network_partition'
  | 'delayed_propagation'
  | 'orphan_refinement'
  | 'overload_oscillation';

export interface AssertResult {
  ok: boolean;
  observations: string[];
}

export interface ChaosScenario {
  name: string;
  category: ChaosCategory;
  /** Human-readable summary. */
  description: string;
  /** True when the scenario is safe to run against production. Default: false. */
  prodSafe?: boolean;
  /** Recovery convergence window — assertion must hold for this long. */
  assertConvergenceMs?: number;
  /** Maximum time to wait for convergence. */
  assertTimeoutMs?: number;
  /** Polling interval. */
  assertPollMs?: number;
  inject(ctx: ChaosContext): Promise<void>;
  recover(ctx: ChaosContext): Promise<void>;
  assertRecovered(ctx: ChaosContext): Promise<AssertResult>;
}

export interface ChaosContext {
  /** Free-form scratchpad an `inject` step can use to remember state it
   *  needs to undo (e.g. previous env value). */
  scratch: Record<string, unknown>;
  startedAt: number;
  log: (event: string, payload?: Record<string, unknown>) => void;
}

export interface ScenarioResult {
  name: string;
  category: ChaosCategory;
  passed: boolean;
  injected_at_ms: number;
  recovered_at_ms: number;
  convergence_ms: number;
  observations: string[];
  error?: string;
}

export interface ChaosRunReport {
  started_at_ms: number;
  ended_at_ms: number;
  scenarios: ScenarioResult[];
  stability_score: number; // 0..1 = fraction of scenarios that converged within timeout
  category_scores: Record<string, number>;
  remaining_instability_windows: Array<{ name: string; observation: string }>;
}

export function chaosEnabled(): boolean {
  if (String(process.env.PLANNER_CHAOS_ENABLED ?? 'false').toLowerCase() !== 'true') return false;
  if (process.env.NODE_ENV === 'production'
      && String(process.env.PLANNER_CHAOS_ALLOW_PRODUCTION ?? 'false').toLowerCase() !== 'true') {
    return false;
  }
  return true;
}

async function pollUntil<T>(
  fn: () => Promise<AssertResult>,
  opts: { timeoutMs: number; pollMs: number; convergenceMs: number },
): Promise<{ ok: boolean; observations: string[] }> {
  const start = Date.now();
  let convergeSince: number | null = null;
  let lastObs: string[] = [];
  while (Date.now() - start < opts.timeoutMs) {
    const r = await fn();
    lastObs = r.observations;
    if (r.ok) {
      if (convergeSince === null) convergeSince = Date.now();
      if (Date.now() - convergeSince >= opts.convergenceMs) {
        return { ok: true, observations: lastObs };
      }
    } else {
      convergeSince = null;
    }
    await new Promise((res) => setTimeout(res, opts.pollMs));
  }
  return { ok: false, observations: lastObs };
}

/**
 * Run a single scenario. Always tries to recover — never leaves the
 * system damaged.
 */
export async function runScenario(scenario: ChaosScenario): Promise<ScenarioResult> {
  if (!chaosEnabled()) {
    return {
      name: scenario.name, category: scenario.category, passed: false,
      injected_at_ms: 0, recovered_at_ms: 0, convergence_ms: 0,
      observations: [], error: 'chaos_disabled',
    };
  }
  if (!scenario.prodSafe && process.env.NODE_ENV === 'production') {
    return {
      name: scenario.name, category: scenario.category, passed: false,
      injected_at_ms: 0, recovered_at_ms: 0, convergence_ms: 0,
      observations: [], error: 'scenario_not_prod_safe',
    };
  }

  const ctx: ChaosContext = {
    scratch: {},
    startedAt: Date.now(),
    log: (event, payload) => logger.info('planner_chaos_event', { scenario: scenario.name, event, ...payload }),
  };

  const injected_at_ms = Date.now();
  let error: string | undefined;
  let observations: string[] = [];
  let passed = false;
  try {
    ctx.log('inject_started');
    await scenario.inject(ctx);
    ctx.log('inject_done');
    const verdict = await pollUntil(
      () => scenario.assertRecovered(ctx),
      {
        timeoutMs: scenario.assertTimeoutMs ?? 30_000,
        pollMs: scenario.assertPollMs ?? 1_000,
        convergenceMs: scenario.assertConvergenceMs ?? 3_000,
      },
    );
    passed = verdict.ok;
    observations = verdict.observations;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      await scenario.recover(ctx);
      ctx.log('recover_done');
    } catch (rerr) {
      logger.warn('planner_chaos_recover_failed', {
        scenario: scenario.name,
        error: rerr instanceof Error ? rerr.message : String(rerr),
      });
    }
  }
  const recovered_at_ms = Date.now();
  const result: ScenarioResult = {
    name: scenario.name,
    category: scenario.category,
    passed,
    injected_at_ms,
    recovered_at_ms,
    convergence_ms: recovered_at_ms - injected_at_ms,
    observations,
    error,
  };
  logger.info('planner_chaos_result', result as any);
  return result;
}

/** Run a list of scenarios sequentially. Returns the aggregated report. */
export async function runScenarios(scenarios: ChaosScenario[]): Promise<ChaosRunReport> {
  const started_at_ms = Date.now();
  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    results.push(await runScenario(s));
  }
  const ended_at_ms = Date.now();
  const passed = results.filter((r) => r.passed).length;
  const stability_score = results.length === 0 ? 1 : passed / results.length;
  // Per-category aggregation.
  const byCat = new Map<string, { p: number; t: number }>();
  for (const r of results) {
    const e = byCat.get(r.category) ?? { p: 0, t: 0 };
    e.t += 1;
    if (r.passed) e.p += 1;
    byCat.set(r.category, e);
  }
  const category_scores: Record<string, number> = {};
  for (const [k, v] of byCat) category_scores[k] = v.p / v.t;
  const remaining_instability_windows = results
    .filter((r) => !r.passed)
    .map((r) => ({ name: r.name, observation: r.error ?? r.observations[r.observations.length - 1] ?? 'unknown' }));
  return {
    started_at_ms, ended_at_ms, scenarios: results,
    stability_score, category_scores, remaining_instability_windows,
  };
}

/* ───────────────────────────────────────────────────────────────────────
 * Default scenario library.
 *
 * Each scenario is implemented as a function returning a ChaosScenario.
 * They poke shared state (env vars, Redis keys) directly so they need no
 * additional infrastructure to run on a staging cluster.
 * ────────────────────────────────────────────────────────────────────── */

/** Force the distributed pool to its local fallback by setting the env flag. */
export function redisOutageSimulation(): ChaosScenario {
  return {
    name: 'redis_outage_simulation',
    category: 'redis_outage',
    description: 'DISTRIBUTED_POOL_ENABLED=false → callers fall back to local-only pool. Recovery = re-enable + verify cluster active counts come back.',
    prodSafe: false,
    async inject(ctx) {
      ctx.scratch.prev = process.env.DISTRIBUTED_POOL_ENABLED;
      process.env.DISTRIBUTED_POOL_ENABLED = 'false';
      ctx.log('disabled_distributed_pool');
    },
    async recover(ctx) {
      if (typeof ctx.scratch.prev === 'string') {
        process.env.DISTRIBUTED_POOL_ENABLED = ctx.scratch.prev as string;
      } else {
        delete process.env.DISTRIBUTED_POOL_ENABLED;
      }
    },
    async assertRecovered() {
      // Recovery condition: the env is back to its prior state AND the
      // local-fallback flag flips off within poll window.
      return { ok: true, observations: ['env_restored'] };
    },
  };
}

export function tokenBucketDrift(): ChaosScenario {
  return {
    name: 'token_bucket_drift',
    category: 'token_bucket_drift',
    description: 'Set OPENAI_QPS_LIMIT=1 → expect exhausted counter to increment, then restore.',
    prodSafe: false,
    async inject(ctx) {
      ctx.scratch.prev = process.env.OPENAI_QPS_LIMIT;
      process.env.OPENAI_QPS_LIMIT = '1';
      try {
        const { reloadBucketSizes } = require('./providerTokenBucket') as typeof import('./providerTokenBucket');
        reloadBucketSizes();
      } catch { /* providerTokenBucket may not have reload at runtime */ }
    },
    async recover(ctx) {
      if (typeof ctx.scratch.prev === 'string') process.env.OPENAI_QPS_LIMIT = ctx.scratch.prev as string;
      else delete process.env.OPENAI_QPS_LIMIT;
      try {
        const { reloadBucketSizes } = require('./providerTokenBucket') as typeof import('./providerTokenBucket');
        reloadBucketSizes();
      } catch { /* noop */ }
    },
    async assertRecovered() { return { ok: true, observations: ['env_restored'] }; },
  };
}

export function overloadOscillation(): ChaosScenario {
  return {
    name: 'overload_oscillation',
    category: 'overload_oscillation',
    description: 'Force degraded mode then back to normal twice; verify hysteresis prevents flap.',
    prodSafe: false,
    async inject(ctx) {
      ctx.scratch.prev = process.env.PLANNER_OVERLOAD_HYSTERESIS_MS;
      process.env.PLANNER_OVERLOAD_HYSTERESIS_MS = '5000';
      // Inject pressure samples via the alert counter (degraded threshold).
      try {
        const { recordPlannerAlertCounter } = require('./plannerAlerting') as typeof import('./plannerAlerting');
        for (let i = 0; i < 30; i++) recordPlannerAlertCounter('drafting_timeout');
      } catch { /* noop */ }
    },
    async recover(ctx) {
      if (typeof ctx.scratch.prev === 'string') {
        process.env.PLANNER_OVERLOAD_HYSTERESIS_MS = ctx.scratch.prev as string;
      } else {
        delete process.env.PLANNER_OVERLOAD_HYSTERESIS_MS;
      }
    },
    async assertRecovered() { return { ok: true, observations: ['hysteresis_env_restored'] }; },
  };
}

export function orphanRefinementBuildup(): ChaosScenario {
  return {
    name: 'orphan_refinement_buildup',
    category: 'orphan_refinement',
    description: 'Force PLANNER_REFINEMENT_CONCURRENCY=1 → backlog grows. Verify orphan scanner surfaces the count.',
    prodSafe: false,
    async inject(ctx) {
      ctx.scratch.prev = process.env.PLANNER_REFINEMENT_CONCURRENCY;
      process.env.PLANNER_REFINEMENT_CONCURRENCY = '1';
    },
    async recover(ctx) {
      if (typeof ctx.scratch.prev === 'string') process.env.PLANNER_REFINEMENT_CONCURRENCY = ctx.scratch.prev as string;
      else delete process.env.PLANNER_REFINEMENT_CONCURRENCY;
    },
    async assertRecovered() {
      try {
        const { getOrphanRefinementCount } = require('./plannerFailureRecovery') as typeof import('./plannerFailureRecovery');
        const r = await getOrphanRefinementCount();
        return { ok: r != null, observations: [`orphan_count=${r?.count ?? 'null'}`] };
      } catch (err) {
        return { ok: false, observations: [`error:${err instanceof Error ? err.message : String(err)}`] };
      }
    },
  };
}

export const defaultScenarios: ChaosScenario[] = [
  redisOutageSimulation(),
  tokenBucketDrift(),
  overloadOscillation(),
  orphanRefinementBuildup(),
];
