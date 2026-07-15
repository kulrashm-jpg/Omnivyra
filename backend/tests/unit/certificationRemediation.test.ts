/**
 * Certification remediation (§14 of the independent certification) —
 * verifies each blocker fix at runtime where possible, source level otherwise.
 */
import fs from 'fs';
import path from 'path';
import type { Queue } from 'bullmq';
import {
  buildRunwayPollKey,
  getRunwayJobStatus,
  completeRunwayOperation,
  RunwayPersistError,
} from '../../../lib/platform/runway';
import { acquireLease, withLease } from '../../../lib/platform/distributedLock';
import { definePool } from '../../../lib/platform/concurrency';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function redisReachable(): Promise<boolean> {
  try {
    const { getRedisHealthSnapshot } = await import('../../../lib/redis/canonicalClient');
    return (await getRedisHealthSnapshot(1_000)).reachable;
  } catch { return false; }
}

describe('§14.1 async planner — deterministic failure surfacing', () => {
  const fakeQueue = (job: { state: string; failedReason?: string; removed?: { v: boolean } } | null) =>
    ({
      getJob: async () => job === null ? null : {
        failedReason: job.failedReason,
        getState: async () => job.state,
        remove: async () => { if (job.removed) job.removed.v = true; },
      },
    }) as unknown as Queue;

  test('failed job → state failed with reason, job removed (re-submit re-runs)', async () => {
    const removed = { v: false };
    const status = await getRunwayJobStatus(fakeQueue({ state: 'failed', failedReason: 'boom', removed }), 'k');
    expect(status).toEqual({ state: 'failed', failedReason: 'boom' });
    expect(removed.v).toBe(true);
  });

  test('completed-with-no-result → surfaced and removed', async () => {
    const removed = { v: false };
    const status = await getRunwayJobStatus(fakeQueue({ state: 'completed', removed }), 'k');
    expect(status.state).toBe('completed_no_result');
    expect(removed.v).toBe(true);
  });

  test('waiting/active → pending/active; absent → absent; errors → pending (safe)', async () => {
    expect((await getRunwayJobStatus(fakeQueue({ state: 'waiting' }), 'k')).state).toBe('pending');
    expect((await getRunwayJobStatus(fakeQueue({ state: 'active' }), 'k')).state).toBe('active');
    expect((await getRunwayJobStatus(fakeQueue(null), 'k')).state).toBe('absent');
    const throwing = { getJob: async () => { throw new Error('redis down'); } } as unknown as Queue;
    expect((await getRunwayJobStatus(throwing, 'k')).state).toBe('pending');
  });

  test('persistence failure now THROWS so the job fails (was: silent complete)', async () => {
    // saveAiExecutionResult returns false in test env (no DB row) → must throw.
    await expect(completeRunwayOperation({
      pollKey: 'cert-unit-key', action: 'unit', organizationId: 'org', actorUserId: 'u', module: 'm',
      payload: { x: 1 },
    })).rejects.toBeInstanceOf(RunwayPersistError);
    expect(read('lib/platform/runway.ts')).toContain("enable 'result-store-compression'");
  });

  test('plan.ts poll branch surfaces failure envelopes and keeps the 202 contract', () => {
    const src = read('pages/api/campaigns/ai/plan.ts');
    expect(src).toContain('getRunwayJobStatus(getAiHeavyQueue(), pollKey)');
    expect(src).toMatch(/status: 'failed',[\s\S]{0,400}?retryable: true/);
    expect(src).toMatch(/jobStatus\.state === 'pending' \|\| jobStatus\.state === 'active'/);
  });

  test('poll keys are key-order-stable and circular-safe', () => {
    expect(buildRunwayPollKey('op', 's', { a: 1, b: 2 })).toBe(buildRunwayPollKey('op', 's', { b: 2, a: 1 }));
    const circ: Record<string, unknown> = { a: 1 };
    circ.self = circ;
    expect(() => buildRunwayPollKey('op', 's', circ)).not.toThrow();
  });
});

describe('§14.2 Redis shared-connection compatibility', () => {
  test('spread consumers use getRawConnectionOptions; no spread of getConnectionConfig remains', () => {
    expect(read('backend/services/orchestration/events/durableOrchestrationEventStream.ts'))
      .toContain('...getRawConnectionOptions()');
    expect(read('backend/services/orchestration/events/distributedOrchestrationEventTransport.ts'))
      .toContain('getRawConnectionOptions()');
    for (const rel of [
      'backend/services/orchestration/events/durableOrchestrationEventStream.ts',
      'backend/services/orchestration/events/distributedOrchestrationEventTransport.ts',
    ]) {
      expect(read(rel)).not.toContain('getConnectionConfig');
    }
  });

  test('AI cache shared branch tracks availability via connection events', () => {
    const src = read('backend/services/aiResponseCache.ts');
    expect(src).toMatch(/_client\.on\('error',\s*\(\) => \{ _available = false; \}\)/);
    expect(src).toMatch(/_client\.on\('ready',\s*\(\) => \{ _available = true; \}\)/);
    expect(src).not.toContain('_available = true; // per-op try/catch');
  });
});

describe('§14.3 distributed lease — renewal + fencing', () => {
  test('withLease renews at half-TTL and records ownership-loss (source contract)', () => {
    const src = read('lib/platform/distributedLock.ts');
    expect(src).toMatch(/Math\.max\(1_000, Math\.floor\(\(ttlSeconds \* 1_000\) \/ 2\)\)/);
    expect(src).toContain("recordRawCounter('lock.ownership_lost'");
    expect(src).toContain("recordRawCounter('lock.renewed'");
    expect(src).toContain('clearInterval(heartbeat)');
  });

  test('live: a body outliving its TTL keeps the lease (renewal prevents takeover)', async () => {
    if (!(await redisReachable())) return;
    const name = `cert-renew-${Date.now()}`;
    const holder = withLease(name, 2, async () => {
      await new Promise((r) => setTimeout(r, 3_200)); // outlives the 2 s TTL
      return 'done';
    });
    await new Promise((r) => setTimeout(r, 2_600)); // past original expiry
    const rival = await acquireLease(name, 5);
    expect(rival.acquired).toBe(false); // renewal held the lock
    expect((await holder)).toMatchObject({ ran: true, value: 'done' });
    const after = await acquireLease(name, 5);
    expect(after.acquired).toBe(true); // released cleanly at the end
    await after.release();
  }, 15_000);

  test('fencing token is consumed by timer telemetry (stale-holder signal)', () => {
    expect(read('backend/scheduler/cron.ts')).toContain("recordRawHistogram('cron.timer.fence'");
  });
});

describe('§14.4 pool FIFO fairness', () => {
  test('a woken waiter keeps its position ahead of later arrivals', async () => {
    const pool = definePool({ name: 'cert-fifo', defaultLimit: 1 });
    const order: string[] = [];
    let releaseA!: () => void;
    const aGate = new Promise<void>((r) => { releaseA = r; });
    const a = pool.run(async () => { order.push('A'); await aGate; });
    await new Promise((r) => setTimeout(r, 10));
    const b = pool.run(async () => { order.push('B'); await new Promise((r) => setTimeout(r, 20)); });
    const c = pool.run(async () => { order.push('C'); });
    await new Promise((r) => setTimeout(r, 10));
    releaseA();
    await new Promise((r) => setTimeout(r, 5));
    // D arrives while B holds the slot — must NOT jump ahead of C.
    const d = pool.run(async () => { order.push('D'); });
    await Promise.all([a, b, c, d]);
    expect(order).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('housekeeping corrections', () => {
  test('response cache stores only explicit 200s and its docs no longer overclaim adoption', () => {
    const src = read('lib/platform/responseCache.ts');
    expect(src).toMatch(/if \(res\.statusCode === 200\) \{/);
    expect(src).not.toContain('res.statusCode === undefined');
    expect(src).toContain('has NO adopter yet');
  });
  test('retryBudget/cacheClient docstrings match reality', () => {
    expect(read('lib/platform/retryBudget.ts')).toContain('first consumer is the planner-draft');
    expect(read('lib/platform/cacheClient.ts')).toContain('coalescing is per-request');
  });
});
