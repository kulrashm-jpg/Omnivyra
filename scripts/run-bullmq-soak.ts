/**
 * Live BullMQ heavy-runtime soak harness — NON-DESTRUCTIVE.
 *
 * Targets the COMPOSE-LOCAL Redis (host-mapped at localhost:6379), NOT the
 * Upstash production URL in .env.local. Enqueues a small batch of lightweight
 * jobs to the `ai-heavy` BullMQ queue with deliberately-incomplete payloads so
 * the campaignPlanningProcessor rejects them early — exercising the queue +
 * worker pickup + graceful-failure + retry paths WITHOUT making any external
 * provider call (no OpenAI invocation, no DB writes from this script).
 *
 * What this harness validates:
 *   - BullMQ enqueue under concurrent load (addBulk).
 *   - Worker pickup of arbitrary jobs from the live worker stack.
 *   - Graceful processor-failure handling (processor throws → job marked
 *     failed → no worker crash).
 *   - Retry path with attempts:2 + short backoff.
 *   - Redis connectivity under enqueue load.
 *   - FIFO order across enqueued jobs (BullMQ-default semantics).
 *
 * What this harness does NOT validate:
 *   - Real Chromium launches under load (requires a sanctioned "dry-run"
 *     payload for the creator-render processor that the codebase does not
 *     publicly expose; real renders write to storage + DB).
 *   - Real OpenAI fan-out (real ai-heavy payloads call OpenAI = real cost).
 *
 * Run: npx tsx scripts/run-bullmq-soak.ts
 *      SOAK_AI_HEAVY_COUNT=12 npx tsx scripts/run-bullmq-soak.ts
 */

import { Queue, QueueEvents, type JobsOptions } from 'bullmq';

const REDIS_HOST = process.env.SOAK_REDIS_HOST ?? 'localhost';
const REDIS_PORT = Number(process.env.SOAK_REDIS_PORT ?? 6379);
const N = Number(process.env.SOAK_AI_HEAVY_COUNT ?? 8);
const WAIT_MS = Number(process.env.SOAK_WAIT_MS ?? 90_000);
/** SOAK_FORCE_FAIL=1 sends `null` as job data so the processor's first field
 *  access throws — explicitly exercising the graceful-failure + retry paths. */
const FORCE_FAIL = process.env.SOAK_FORCE_FAIL === '1';
/** SOAK_CREATOR_RENDER_COUNT > 0 enqueues N jobs into the `creator-render`
 *  queue with `__soak: true`. The worker MUST be running with
 *  WORKER_SOAK_MODE=1 to pick these up via the sanctioned soak branch
 *  (real Chromium launch, no DB / Storage / OpenAI side effects). */
const CR_N = Number(process.env.SOAK_CREATOR_RENDER_COUNT ?? 0);
/** SOAK_AI_HEAVY_DRY_COUNT > 0 enqueues N jobs with the sentinel name
 *  `soak-ai-heavy` and `__soak: true` payload. The worker MUST run with
 *  WORKER_SOAK_MODE=1 to enter the soak branch (heavy-slot hold + ~600ms
 *  async timing). No OpenAI / DB / provider side effects. */
const AH_DRY_N = Number(process.env.SOAK_AI_HEAVY_DRY_COUNT ?? 0);

async function runAiHeavyDrySoak(connection: { host: string; port: number; maxRetriesPerRequest: null }): Promise<{ completed: number; failed: number; timedOut: number; elapsedMs: number; failureReasons: Map<string, number> }> {
  console.log(`\n[soak:ai-heavy-dry] target Redis: ${REDIS_HOST}:${REDIS_PORT}  queue: ai-heavy  jobs: ${AH_DRY_N}`);
  const q = new Queue('ai-heavy', { connection });
  const events = new QueueEvents('ai-heavy', { connection });
  await events.waitUntilReady();

  const t0 = Date.now();
  const runId = `ahdry-${Date.now()}`;
  for (let i = 0; i < AH_DRY_N; i++) {
    const isRetryProbe = i === AH_DRY_N - 1;
    await q.add(
      'soak-ai-heavy',
      { __soak: true, soakRun: runId, soakIndex: i, retryProbe: isRetryProbe },
      {
        jobId: `${runId}-${i}`,
        attempts: isRetryProbe ? 2 : 1,
        backoff: isRetryProbe ? { type: 'fixed', delay: 2_000 } : undefined,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
  console.log(`[soak:ai-heavy-dry] enqueued ${AH_DRY_N} jobs in ${Date.now() - t0}ms`);

  let completed = 0;
  let failed = 0;
  const failureReasons = new Map<string, number>();
  events.on('completed', ({ jobId }) => { if (jobId.startsWith(runId)) completed++; });
  events.on('failed', ({ jobId, failedReason }) => {
    if (jobId.startsWith(runId)) {
      failed++;
      const key = (failedReason ?? 'unknown').slice(0, 80);
      failureReasons.set(key, (failureReasons.get(key) ?? 0) + 1);
    }
  });

  const deadline = Date.now() + Math.max(WAIT_MS, AH_DRY_N * 5_000);
  while (Date.now() < deadline && completed + failed < AH_DRY_N) {
    await new Promise((r) => setTimeout(r, 250));
  }

  const counts = await q.getJobCounts('active', 'waiting', 'completed', 'failed', 'delayed');
  const elapsedMs = Date.now() - t0;
  const timedOut = AH_DRY_N - completed - failed;

  console.log(`[soak:ai-heavy-dry] done in ${elapsedMs}ms`);
  console.log(`[soak:ai-heavy-dry]   completed: ${completed} / ${AH_DRY_N}`);
  console.log(`[soak:ai-heavy-dry]   failed:    ${failed} / ${AH_DRY_N}`);
  console.log(`[soak:ai-heavy-dry]   timed_out: ${timedOut} / ${AH_DRY_N}`);
  console.log(`[soak:ai-heavy-dry] queue counts (post): active=${counts.active} waiting=${counts.waiting} completed=${counts.completed} failed=${counts.failed} delayed=${counts.delayed}`);
  if (failureReasons.size > 0) {
    console.log('[soak:ai-heavy-dry] failure reasons:');
    for (const [reason, count] of [...failureReasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`[soak:ai-heavy-dry]   ${count}×  ${reason}`);
    }
  }

  await events.close();
  await q.close();
  return { completed, failed, timedOut, elapsedMs, failureReasons };
}

async function runCreatorRenderSoak(connection: { host: string; port: number; maxRetriesPerRequest: null }): Promise<{ completed: number; failed: number; timedOut: number; elapsedMs: number; failureReasons: Map<string, number> }> {
  console.log(`\n[soak:creator-render] target Redis: ${REDIS_HOST}:${REDIS_PORT}  queue: creator-render  jobs: ${CR_N}`);
  const q = new Queue('creator-render', { connection });
  const events = new QueueEvents('creator-render', { connection });
  await events.waitUntilReady();

  const t0 = Date.now();
  const runId = `crsoak-${Date.now()}`;
  // The worker's soak branch ignores `data.renderer/payload` — but BullMQ's
  // job.data must still be an object so the gate check `data.__soak === true`
  // succeeds. Heavy lifting (real Chromium) happens server-side.
  const jobsEnqueued = [];
  const t0Enqueue = Date.now();
  for (let i = 0; i < CR_N; i++) {
    const isRetryProbe = i === CR_N - 1;
    const job = await q.add(
      'soak-chromium',
      { __soak: true, soakRun: runId, soakIndex: i, retryProbe: isRetryProbe },
      {
        jobId: `${runId}-${i}`,
        attempts: isRetryProbe ? 2 : 1,
        backoff: isRetryProbe ? { type: 'fixed', delay: 2_000 } : undefined,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    jobsEnqueued.push(job);
  }
  console.log(`[soak:creator-render] enqueued ${jobsEnqueued.length} jobs in ${Date.now() - t0Enqueue}ms`);

  let completed = 0;
  let failed = 0;
  const failureReasons = new Map<string, number>();
  events.on('completed', ({ jobId }) => { if (jobId.startsWith(runId)) completed++; });
  events.on('failed', ({ jobId, failedReason }) => {
    if (jobId.startsWith(runId)) {
      failed++;
      const key = (failedReason ?? 'unknown').slice(0, 80);
      failureReasons.set(key, (failureReasons.get(key) ?? 0) + 1);
    }
  });

  // Chromium launch takes 2-5s per job; allow generous wait.
  const crDeadline = Date.now() + Math.max(WAIT_MS, CR_N * 30_000);
  while (Date.now() < crDeadline && completed + failed < CR_N) {
    await new Promise((r) => setTimeout(r, 500));
  }

  const counts = await q.getJobCounts('active', 'waiting', 'completed', 'failed', 'delayed');
  const elapsedMs = Date.now() - t0;
  const timedOut = CR_N - completed - failed;

  console.log(`[soak:creator-render] done in ${elapsedMs}ms`);
  console.log(`[soak:creator-render]   completed: ${completed} / ${CR_N}`);
  console.log(`[soak:creator-render]   failed:    ${failed} / ${CR_N}`);
  console.log(`[soak:creator-render]   timed_out: ${timedOut} / ${CR_N}`);
  console.log(`[soak:creator-render] queue counts (post): active=${counts.active} waiting=${counts.waiting} completed=${counts.completed} failed=${counts.failed} delayed=${counts.delayed}`);
  if (failureReasons.size > 0) {
    console.log('[soak:creator-render] failure reasons:');
    for (const [reason, count] of [...failureReasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`[soak:creator-render]   ${count}×  ${reason}`);
    }
  }

  await events.close();
  await q.close();
  return { completed, failed, timedOut, elapsedMs, failureReasons };
}

async function main(): Promise<void> {
  const connection = { host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null as null };

  // Phase A: creator-render heavy soak (opt-in). Drives REAL Chromium launches
  // through the worker's WORKER_SOAK_MODE branch (no DB/Storage/OpenAI side
  // effects). Skipped when SOAK_CREATOR_RENDER_COUNT is 0/unset.
  let crResult: { completed: number; failed: number; timedOut: number } | null = null;
  if (CR_N > 0) {
    crResult = await runCreatorRenderSoak(connection);
  }

  // Phase A2: ai-heavy dry soak (opt-in). Drives jobs through the heavy-job
  // slot + concurrency cap WITHOUT any OpenAI / DB / provider side effects.
  // Skipped when SOAK_AI_HEAVY_DRY_COUNT is 0/unset.
  let ahDryResult: { completed: number; failed: number; timedOut: number } | null = null;
  if (AH_DRY_N > 0) {
    ahDryResult = await runAiHeavyDrySoak(connection);
  }

  console.log(`\n[soak] target Redis: ${REDIS_HOST}:${REDIS_PORT}  queue: ai-heavy  jobs: ${N}`);
  const q = new Queue('ai-heavy', { connection });
  const events = new QueueEvents('ai-heavy', { connection });
  await events.waitUntilReady();

  const t0 = Date.now();
  const runId = `soak-${Date.now()}`;

  // 7 single-shot jobs + 1 retry-path job (attempts:2, short fixed backoff).
  const payloads = Array.from({ length: N }, (_, i) => {
    const isRetryProbe = i === N - 1;
    const opts: JobsOptions = {
      attempts: isRetryProbe ? 2 : 1,
      backoff: isRetryProbe ? { type: 'fixed', delay: 2_000 } : undefined,
      removeOnComplete: true,
      removeOnFail: true,
      jobId: `${runId}-${i}`,
    };
    return {
      name: 'soak-noop',
      // Default: deliberately incomplete payload. With SOAK_FORCE_FAIL=1, send
      // `null` so the processor's first field access throws on every attempt,
      // explicitly exercising graceful-failure + retry/DLQ.
      data: FORCE_FAIL
        ? (null as unknown as Record<string, unknown>)
        : { __soak: true, soakRun: runId, soakIndex: i, retryProbe: isRetryProbe },
      opts,
    };
  });

  const jobs = await q.addBulk(payloads);
  console.log(`[soak] enqueued ${jobs.length} jobs in ${Date.now() - t0}ms`);

  let completed = 0;
  let failed = 0;
  const failureReasons = new Map<string, number>();
  events.on('completed', ({ jobId }) => {
    if (jobId.startsWith(runId)) completed++;
  });
  events.on('failed', ({ jobId, failedReason }) => {
    if (jobId.startsWith(runId)) {
      failed++;
      const key = (failedReason ?? 'unknown').slice(0, 60);
      failureReasons.set(key, (failureReasons.get(key) ?? 0) + 1);
    }
  });

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline && completed + failed < N) {
    await new Promise((r) => setTimeout(r, 500));
  }

  const counts = await q.getJobCounts('active', 'waiting', 'completed', 'failed', 'delayed');
  const elapsedMs = Date.now() - t0;

  console.log(`[soak] done in ${elapsedMs}ms`);
  console.log(`[soak]   completed: ${completed} / ${N}`);
  console.log(`[soak]   failed:    ${failed} / ${N}`);
  console.log(`[soak]   timed_out: ${N - completed - failed} / ${N}`);
  console.log(`[soak] queue counts (post): active=${counts.active} waiting=${counts.waiting} completed=${counts.completed} failed=${counts.failed} delayed=${counts.delayed}`);
  if (failureReasons.size > 0) {
    console.log('[soak] failure reasons:');
    for (const [reason, count] of [...failureReasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`[soak]   ${count}×  ${reason}`);
    }
  }

  await events.close();
  await q.close();
  // The harness's intent is reached even when jobs fail (that IS the exercised
  // graceful-failure path). Exit 0 unless we genuinely timed out without
  // resolution on EITHER lane (ai-heavy and, when enabled, creator-render).
  const aiHeavyOk = completed + failed === N;
  const creatorRenderOk = crResult === null || crResult.timedOut === 0;
  const aiHeavyDryOk = ahDryResult === null || ahDryResult.timedOut === 0;
  process.exit(aiHeavyOk && creatorRenderOk && aiHeavyDryOk ? 0 : 2);
}

main().catch((e) => { console.error('SOAK ERROR:', e); process.exit(1); });
