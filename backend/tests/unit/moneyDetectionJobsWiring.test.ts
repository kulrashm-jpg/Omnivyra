/**
 * MONEY detect-only jobs are ON A TIMER and actually allowed to run
 * (2026-11-12, e9 ruling). Same harness as readinessSnapshotIntentGate: the
 * REAL gate, the REAL context-warm path and the REAL shouldRunCronJob, with
 * only the Redis client stubbed.
 *
 *  1. Each job is in ALWAYS_RUN_JOBS, so an idle platform (or a Redis fault,
 *     indistinguishable from idle) does not silently stop money detection.
 *  2. The worker cycle (backend/scheduler/cron.ts) actually iterates
 *     MONEY_DETECTION_JOBS through shouldRunCronJob.
 *  3. Each timer run uses the SAME job name and idempotency key as its
 *     /api/cron route (one audit lineage per period).
 *  4. The three jobs stay DETECT-ONLY: their service files contain no
 *     insert/update/upsert/delete/rpc. A writer added later fails here and must
 *     go through the report-only + owner-approval path instead.
 */
import fs from 'fs';
import path from 'path';

const zrangebyscoreResult: { value: string[] | Error } = { value: [] };
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: jest.fn(() => ({
    zrangebyscore: jest.fn(async () => {
      if (zrangebyscoreResult.value instanceof Error) throw zrangebyscoreResult.value;
      return zrangebyscoreResult.value;
    }),
    zadd: jest.fn(async () => 1),
    zremrangebyscore: jest.fn(async () => 0),
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    hincrby: jest.fn(async () => 1),
    hgetall: jest.fn(async () => ({})),
    expire: jest.fn(async () => 1),
    scan: jest.fn(async () => ['0', [] as string[]]),
    pipeline: jest.fn(() => ({ hincrby: jest.fn(), expire: jest.fn(), exec: jest.fn(async () => []) })),
  })),
}));
const mockRunJobSpecs: Array<{ jobName: string; idempotencyKey?: string; triggerSource: string }> = [];
jest.mock('../../services/jobRunner', () => ({
  runJob: async (spec: { jobName: string; idempotencyKey?: string; triggerSource: string }) => {
    mockRunJobSpecs.push(spec);
    return { status: 'completed' };
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { warmIntentContext, getIntentGate, ALWAYS_RUN_JOBS } from '../../services/intentExecutionService';
import { shouldRunCronJob } from '../../services/adminRuntimeConfig';
import { MONEY_DETECTION_JOBS, runMoneyDetectionJob } from '../../jobs/moneyDetectionJobs';

const ROOT = path.join(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const KEYS = MONEY_DETECTION_JOBS.map((j) => j.key);

beforeEach(() => { zrangebyscoreResult.value = []; mockRunJobSpecs.length = 0; });

it('exactly the three detect-only jobs are wired', () => {
  expect(KEYS.sort()).toEqual(['billingOrphanUsageScan', 'billingReservationReconcile', 'creditReconciliation']);
});

describe.each(KEYS)('%s', (key) => {
  it('is in ALWAYS_RUN_JOBS', () => {
    expect(ALWAYS_RUN_JOBS.has(key)).toBe(true);
  });
  it('is ALLOWED with an empty activity set, and when Redis errors', async () => {
    await warmIntentContext();
    expect(getIntentGate(key)).toMatchObject({ allowed: true, reason: null });
    zrangebyscoreResult.value = new Error('redis unavailable');
    await warmIntentContext();
    expect(getIntentGate(key).allowed).toBe(true);
  });
  it('shouldRunCronJob fires on an idle platform when never run before', async () => {
    await warmIntentContext();
    const job = MONEY_DETECTION_JOBS.find((j) => j.key === key)!;
    expect(shouldRunCronJob(key, job.intervalMs, 0)).toBe(true);
  });
});

it('control: a non-exempt job is still gated on an idle platform (the gate is real)', async () => {
  await warmIntentContext();
  expect(getIntentGate('healthSnapshot').allowed).toBe(false);
});

it('the worker cycle iterates MONEY_DETECTION_JOBS through shouldRunCronJob', () => {
  const cron = read('backend/scheduler/cron.ts');
  expect(cron).toMatch(/import \{ runMoneyDetectionJob, MONEY_DETECTION_JOBS \} from '\.\.\/jobs\/moneyDetectionJobs'/);
  expect(cron).toMatch(/for \(const job of MONEY_DETECTION_JOBS\) \{\s*if \(shouldRunCronJob\(job\.key, job\.intervalMs,/);
  expect(cron).toMatch(/await runMoneyDetectionJob\(job\.key\)/);
});

it.each([
  ['creditReconciliation', 'pages/api/cron/credit-reconciliation.ts'],
  ['billingReservationReconcile', 'pages/api/cron/billing-reservation-reconcile.ts'],
  ['billingOrphanUsageScan', 'pages/api/cron/billing-orphan-usage-scan.ts'],
] as const)('%s: timer run uses the route\'s job name and idempotency key', async (key, route) => {
  const now = Date.UTC(2026, 10, 12, 13, 37);
  jest.useFakeTimers().setSystemTime(now);
  try {
    await runMoneyDetectionJob(key);
  } finally {
    jest.useRealTimers();
  }
  const spec = mockRunJobSpecs.at(-1)!;
  const src = read(route);
  expect(src).toContain(`jobName:       '${spec.jobName}'`);
  // Evaluate the route's own key expression at the same instant.
  const m = src.match(/idempotencyKey:\s*`([^`]+)`/);
  expect(m).not.toBeNull();
  const routeKey = new Function('Date', 'Math', `return \`${m![1]}\`;`)(
    class extends Date { constructor() { super(now); } static now() { return now; } }, Math,
  );
  expect(spec.idempotencyKey).toBe(routeKey);
  expect(spec.triggerSource).toBe('scheduler');
});

it.each([
  'backend/services/creditReconciliation.ts',
  'backend/services/billing/jobs/reservationReconciliationJob.ts',
  'backend/services/billing/jobs/orphanUsageReconciliationJob.ts',
])('%s stays detect-only: no insert/update/upsert/delete/rpc', (rel) => {
  expect(read(rel)).not.toMatch(/\.(insert|update|upsert|delete)\(|\.rpc\(/);
});
