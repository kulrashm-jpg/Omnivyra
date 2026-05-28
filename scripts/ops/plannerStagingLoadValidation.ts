#!/usr/bin/env tsx
/**
 * Planner staging load validation harness.
 *
 * Runs a suite of synthetic load scenarios against the planner and prints a
 * structured JSON report on stdout suitable for `jq` post-processing or CI
 * upload. Designed for STAGING only — uses the live planner code path but
 * pinned to a synthetic test campaign.
 *
 * Usage:
 *   tsx scripts/ops/plannerStagingLoadValidation.ts --scenario all
 *   tsx scripts/ops/plannerStagingLoadValidation.ts \
 *     --scenario concurrent_storm,bullmq_saturation \
 *     --concurrency 20 --duration-s 60
 *
 * Required env:
 *   STAGING_CAMPAIGN_ID            — a test campaign id we can plan against
 *   STAGING_COMPANY_ID             — the company that owns it
 *   REDIS_URL                      — staging Redis (or local docker)
 *
 * Optional env:
 *   PLANNER_LOAD_TARGET_RPS        — target plans per second (default 1)
 *   PLANNER_LOAD_DURATION_SECONDS  — total run seconds (default 30)
 *
 * Scenarios emit one JSON object per planner attempt:
 *   { scenario, attempt_idx, started_at, ended_at, duration_ms,
 *     succeeded, generation_mode, salvage_used, refinement_status,
 *     alignment_budget_exceeded, drafting_budget_exceeded,
 *     planner_total_budget_exceeded, overload_active }
 *
 * The footer prints aggregates:
 *   { scenario, attempts, p50_ms, p95_ms, p99_ms, success_rate,
 *     salvage_rate, refinement_completion_rate, timeout_rate }
 *
 * SAFE TO RUN AGAINST STAGING. NEVER POINT AT PRODUCTION CAMPAIGN IDS.
 */

/* eslint-disable no-console */

import { performance } from 'perf_hooks';

type ScenarioName =
  | 'concurrent_storm'
  | 'redis_outage_simulation'
  | 'provider_429_storm'
  | 'bullmq_saturation'
  | 'worker_crash_recovery'
  | 'streaming_aborts'
  | 'refinement_backlog'
  | 'semaphore_exhaustion'
  | 'global_overload_activation';

interface ScenarioConfig {
  name: ScenarioName;
  description: string;
  concurrency: number;
  durationSeconds: number;
  /** Setup env tweaks specific to the scenario. Reverted in teardown. */
  envOverrides: Record<string, string | undefined>;
}

interface AttemptResult {
  scenario: ScenarioName;
  attemptIdx: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  succeeded: boolean;
  generationMode?: string;
  salvageUsed?: boolean;
  refinementStatus?: string;
  alignmentBudgetExceeded?: boolean;
  draftingBudgetExceeded?: boolean;
  plannerTotalBudgetExceeded?: boolean;
  overloadActive?: boolean;
  errorMessage?: string;
}

function parseArgs(): { scenarios: ScenarioName[]; concurrency?: number; durationS?: number } {
  const args = process.argv.slice(2);
  let scenarios: ScenarioName[] = ['concurrent_storm'];
  let concurrency: number | undefined;
  let durationS: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      if (args[i + 1] === 'all') {
        scenarios = [
          'concurrent_storm',
          'redis_outage_simulation',
          'provider_429_storm',
          'bullmq_saturation',
          'worker_crash_recovery',
          'streaming_aborts',
          'refinement_backlog',
          'semaphore_exhaustion',
          'global_overload_activation',
        ];
      } else {
        scenarios = args[i + 1].split(',').map((s) => s.trim() as ScenarioName);
      }
      i++;
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      concurrency = Number(args[i + 1]);
      i++;
    } else if (args[i] === '--duration-s' && args[i + 1]) {
      durationS = Number(args[i + 1]);
      i++;
    }
  }
  return { scenarios, concurrency, durationS };
}

function buildScenario(name: ScenarioName, overrides: { concurrency?: number; durationS?: number }): ScenarioConfig {
  const base = {
    concurrency: overrides.concurrency ?? Math.max(1, Number(process.env.PLANNER_LOAD_TARGET_RPS ?? '1')),
    durationSeconds: overrides.durationS ?? Number(process.env.PLANNER_LOAD_DURATION_SECONDS ?? 30),
  };
  switch (name) {
    case 'concurrent_storm':
      return {
        name,
        description: 'N parallel plans against the same campaign to validate distributed semaphore + token bucket back-pressure',
        concurrency: base.concurrency,
        durationSeconds: base.durationSeconds,
        envOverrides: {},
      };
    case 'redis_outage_simulation':
      return {
        name,
        description: 'Distributed pool disabled — validates local fallback path',
        concurrency: base.concurrency,
        durationSeconds: base.durationSeconds,
        envOverrides: { DISTRIBUTED_POOL_ENABLED: 'false' },
      };
    case 'provider_429_storm':
      return {
        name,
        description: 'Aggressive QPS limit forces token-bucket exhaustion',
        concurrency: Math.max(2, base.concurrency),
        durationSeconds: base.durationSeconds,
        envOverrides: { OPENAI_QPS_LIMIT: '1', PROVIDER_BUCKET_BURST: '1' },
      };
    case 'bullmq_saturation':
      return {
        name,
        description: 'Aggressive BullMQ pressure thresholds to trigger overload mode',
        concurrency: base.concurrency,
        durationSeconds: base.durationSeconds,
        envOverrides: { BULLMQ_WAITING_PRESSURE_THRESHOLD: '0' },
      };
    case 'worker_crash_recovery':
      return {
        name,
        description: 'Forces lease expiration by setting tiny TTL — validates dead-worker reclamation',
        concurrency: base.concurrency,
        durationSeconds: base.durationSeconds,
        envOverrides: { PLANNER_SEM_LEASE_TTL_MS_OVERRIDE: '2000' },
      };
    case 'streaming_aborts':
      return {
        name,
        description: 'Aggressive drafting budget forces abort-mid-stream → exercises streamed salvage',
        concurrency: base.concurrency,
        durationSeconds: base.durationSeconds,
        envOverrides: { DRAFTING_BUDGET_MS: '5000', STREAMING_DRAFT_ENABLED: 'true' },
      };
    case 'refinement_backlog':
      return {
        name,
        description: 'Async refinement enabled with tiny worker concurrency to build a backlog',
        concurrency: base.concurrency,
        durationSeconds: base.durationSeconds,
        envOverrides: { ASYNC_REFINEMENT_ENABLED: 'true', PLANNER_REFINEMENT_CONCURRENCY: '1' },
      };
    case 'semaphore_exhaustion':
      return {
        name,
        description: 'Cluster-wide drafting cap set to 1; N parallel plans must queue',
        concurrency: Math.max(3, base.concurrency),
        durationSeconds: base.durationSeconds,
        envOverrides: { MAX_DRAFTING_CONCURRENCY: '1' },
      };
    case 'global_overload_activation':
      return {
        name,
        description: 'All overload thresholds set low — every plan should run in degraded mode',
        concurrency: Math.max(2, base.concurrency),
        durationSeconds: base.durationSeconds,
        envOverrides: {
          PLANNER_OVERLOAD_QUEUE_THRESHOLD: '0',
          PLANNER_OVERLOAD_WAIT_MS: '0',
          BULLMQ_WAITING_PRESSURE_THRESHOLD: '0',
        },
      };
  }
}

async function runOnePlan(scenario: ScenarioName, attemptIdx: number): Promise<AttemptResult> {
  const campaignId = process.env.STAGING_CAMPAIGN_ID;
  if (!campaignId) {
    throw new Error('STAGING_CAMPAIGN_ID required');
  }
  const startedAt = performance.now();
  const startWallMs = Date.now();
  try {
    const { runCampaignAiPlan } =
      (await import('../../backend/services/campaignAiOrchestrator')) as typeof import('../../backend/services/campaignAiOrchestrator');
    const result = await runCampaignAiPlan({
      campaignId,
      mode: 'generate_plan',
      message: 'staging load test plan',
    } as any);
    const endedAt = performance.now();
    const raw = (result as any)?.omnivyre_decision?.raw ?? {};
    return {
      scenario,
      attemptIdx,
      startedAt: startWallMs,
      endedAt: Date.now(),
      durationMs: Math.round(endedAt - startedAt),
      succeeded: !!(result as any)?.plan,
      generationMode: raw.generation_mode,
      salvageUsed: !!raw.partial_salvage_used,
      refinementStatus: raw.async_refinement_enqueued ? 'enqueued' : 'inline',
      alignmentBudgetExceeded: !!raw.alignment_budget_exceeded,
      draftingBudgetExceeded: !!raw.drafting_budget_exceeded,
      plannerTotalBudgetExceeded: !!raw.planner_total_budget_exceeded,
      overloadActive: !!raw.planner_overload_active,
    };
  } catch (err) {
    const endedAt = performance.now();
    return {
      scenario,
      attemptIdx,
      startedAt: startWallMs,
      endedAt: Date.now(),
      durationMs: Math.round(endedAt - startedAt),
      succeeded: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function applyEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    original[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return original;
}

function restoreEnv(original: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function runScenario(cfg: ScenarioConfig): Promise<AttemptResult[]> {
  console.error(`[planner-load] scenario=${cfg.name} concurrency=${cfg.concurrency} duration_s=${cfg.durationSeconds}`);
  const restoreOriginal = applyEnv(cfg.envOverrides);
  const results: AttemptResult[] = [];
  const endAt = Date.now() + cfg.durationSeconds * 1000;
  let attemptIdx = 0;
  try {
    while (Date.now() < endAt) {
      const batch: Promise<AttemptResult>[] = [];
      for (let i = 0; i < cfg.concurrency; i++) {
        batch.push(runOnePlan(cfg.name, attemptIdx++));
      }
      const batchResults = await Promise.all(batch);
      for (const r of batchResults) {
        console.log(JSON.stringify(r));
        results.push(r);
      }
    }
  } finally {
    restoreEnv(restoreOriginal);
  }
  return results;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function aggregate(scenario: ScenarioName, results: AttemptResult[]): Record<string, unknown> {
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const successes = results.filter((r) => r.succeeded);
  const salvage = results.filter((r) => r.salvageUsed);
  const refined = results.filter((r) => r.refinementStatus === 'inline' || r.refinementStatus === 'completed');
  const timeouts = results.filter(
    (r) => r.draftingBudgetExceeded || r.alignmentBudgetExceeded || r.plannerTotalBudgetExceeded,
  );
  return {
    aggregate: true,
    scenario,
    attempts: results.length,
    p50_ms: percentile(durations, 50),
    p95_ms: percentile(durations, 95),
    p99_ms: percentile(durations, 99),
    success_rate: successes.length / Math.max(1, results.length),
    salvage_rate: salvage.length / Math.max(1, results.length),
    refinement_completion_rate: refined.length / Math.max(1, results.length),
    timeout_rate: timeouts.length / Math.max(1, results.length),
  };
}

async function main(): Promise<void> {
  const { scenarios, concurrency, durationS } = parseArgs();
  for (const name of scenarios) {
    const cfg = buildScenario(name, { concurrency, durationS });
    const results = await runScenario(cfg);
    console.log(JSON.stringify(aggregate(name, results)));
  }
}

main().catch((err) => {
  console.error('[planner-load] FATAL:', err);
  process.exit(1);
});
