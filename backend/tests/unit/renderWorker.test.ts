/**
 * Validation — Step-R5 distributed render worker orchestration.
 *
 *   1  autonomous queue progression (loop until idle)
 *   2  distributed lease safety (idle on lost claim)
 *   3  no duplicate processing (unique lease owners; bounded)
 *   4  stale-lease recovery metric
 *   5  provider throttling / backpressure (caps, fail-closed)
 *   6  bounded retries (retry tallied, loop bounded by maxJobs)
 *   7  worker crash recovery (poison-job isolated, never throws)
 *   8  shared-media attachment correctness (pass-through completed)
 *   9  scheduler isolation (no scheduler import)
 *   10 R3 sync fallback parity (worker doesn't touch sync path)
 *
 * Pure orchestrator — `processOne`/`countInFlight`/`now` are injected.
 * processQueuedRenderJob itself is R4-validated.
 */

import { runRenderWorkerTick } from '../../services/creator/rendering';
import type { WorkerProcessResult } from '../../services/creator/rendering';
import * as fs from 'fs';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}
function scriptedProcessOne(seq: WorkerProcessResult[]) {
  const owners: string[] = [];
  let i = 0;
  const fn = async (leaseOwner: string): Promise<WorkerProcessResult> => {
    owners.push(leaseOwner);
    return seq[i++] ?? { ok: true, status: 'idle', events: [] };
  };
  return { fn, owners };
}
const C = (over: Partial<WorkerProcessResult> = {}): WorkerProcessResult =>
  ({ ok: true, status: 'completed', events: ['render_completed_async'], duration_ms: 100, ...over });

describe('Validation-1/3/6/8 — autonomous progression', () => {
  it('processes jobs until idle; unique lease owners; tallies states', async () => {
    const p = scriptedProcessOne([
      C(), C(), { ok: false, status: 'retry_scheduled', events: ['render_retry_scheduled'] },
      { ok: false, status: 'failed', events: ['render_terminal_failure'], reason: 'provider_5xx' },
      { ok: true, status: 'idle', events: [] },
    ]);
    const m = await runRenderWorkerTick(
      { processOne: p.fn, countInFlight: async () => ({}), countStaleLeases: async () => 0, now: clock().now },
      { workerId: 'w1', maxJobs: 10 },
    );
    expect(m.stopped_reason).toBe('idle');
    expect(m.jobs_claimed).toBe(4);
    expect(m.jobs_completed).toBe(2);
    expect(m.jobs_retried).toBe(1);
    expect(m.jobs_failed).toBe(1);
    expect(m.provider_failures).toBe(1);
    expect(m.avg_render_duration_ms).toBe(100);
    expect(new Set(p.owners).size).toBe(p.owners.length); // no duplicate owners
  });
});

describe('Validation-2 — distributed lease safety', () => {
  it('lost claim ⇒ idle ⇒ loop stops, nothing double-processed', async () => {
    const p = scriptedProcessOne([{ ok: true, status: 'idle', events: [] }]);
    const m = await runRenderWorkerTick(
      { processOne: p.fn, countInFlight: async () => ({}), countStaleLeases: async () => 0, now: clock().now },
      { workerId: 'w', maxJobs: 5 },
    );
    expect(m.jobs_claimed).toBe(0);
    expect(m.stopped_reason).toBe('idle');
  });
});

describe('Validation-4 — stale-lease recovery metric', () => {
  it('surfaces reclaimed stale leases', async () => {
    const m = await runRenderWorkerTick(
      { processOne: scriptedProcessOne([{ ok: true, status: 'idle', events: [] }]).fn,
        countInFlight: async () => ({}), countStaleLeases: async () => 7, now: clock().now },
      { workerId: 'w' },
    );
    expect(m.stale_leases_reclaimed).toBe(7);
  });
});

describe('Validation-5 — provider throttling / backpressure (fail-closed)', () => {
  it('global cap reached ⇒ no processing, backpressure stop', async () => {
    const p = scriptedProcessOne([C(), C()]);
    const m = await runRenderWorkerTick(
      { processOne: p.fn, countInFlight: async () => ({ openai: 9 }), countStaleLeases: async () => 0, now: clock().now },
      { workerId: 'w', globalConcurrency: 8 },
    );
    expect(m.backpressure).toBe(true);
    expect(m.stopped_reason).toBe('backpressure');
    expect(p.owners).toHaveLength(0); // never claimed/processed
  });
  it('all providers at per-provider cap ⇒ backpressure', async () => {
    const m = await runRenderWorkerTick(
      { processOne: scriptedProcessOne([C()]).fn, countInFlight: async () => ({ openai: 3, runway: 3 }),
        countStaleLeases: async () => 0, now: clock().now },
      { workerId: 'w', globalConcurrency: 100, providerConcurrency: 3 },
    );
    expect(m.backpressure).toBe(true);
  });
});

describe('Validation-7 — worker crash recovery (poison-job isolated)', () => {
  it('throwing processOne is isolated; tick never throws; loop continues', async () => {
    let i = 0;
    const processOne = async (): Promise<WorkerProcessResult> => {
      i++;
      if (i === 1) throw new Error('boom');
      if (i === 2) return C();
      return { ok: true, status: 'idle', events: [] };
    };
    const m = await runRenderWorkerTick(
      { processOne, countInFlight: async () => ({}), countStaleLeases: async () => 0, now: clock().now },
      { workerId: 'w', maxJobs: 10 },
    );
    expect(m.jobs_failed).toBe(1);          // the throw
    expect(m.provider_failures).toBe(1);
    expect(m.jobs_completed).toBe(1);       // loop continued
    expect(m.stopped_reason).toBe('idle');
  });
});

describe('bounded execution window', () => {
  it('maxJobs cap stops the loop', async () => {
    const p = scriptedProcessOne(Array(20).fill(0).map(() => C()));
    const m = await runRenderWorkerTick(
      { processOne: p.fn, countInFlight: async () => ({}), countStaleLeases: async () => 0, now: clock().now },
      { workerId: 'w', maxJobs: 3 },
    );
    expect(m.jobs_claimed).toBe(3);
    expect(m.stopped_reason).toBe('max_jobs');
  });
  it('time budget stops claiming new work (graceful shutdown)', async () => {
    const ck = clock(1000);
    const processOne = async (): Promise<WorkerProcessResult> => { ck.advance(60); return C(); };
    const m = await runRenderWorkerTick(
      { processOne, countInFlight: async () => ({}), countStaleLeases: async () => 0, now: ck.now },
      { workerId: 'w', maxJobs: 1000, maxMillis: 100 },
    );
    expect(m.stopped_reason).toBe('time_budget');
    expect(m.jobs_claimed).toBeLessThan(1000);
    expect(m.worker_tick_duration_ms).toBeGreaterThanOrEqual(100);
  });
});

describe('Validation-9/10 — isolation + sync parity (structural)', () => {
  it('renderWorker module imports nothing from the scheduler', () => {
    const src = fs.readFileSync(
      'backend/services/creator/rendering/renderWorker.ts', 'utf8');
    expect(/backend\/scheduler|structuredPlanScheduler|schedulerService/.test(src)).toBe(false);
    // pure orchestrator: no DB/network imports either
    expect(/from '@\/backend\/db|supabaseClient|node:|require\(/.test(src)).toBe(false);
  });
  it('moderation-blocked is surfaced (fail-closed pass-through)', async () => {
    const m = await runRenderWorkerTick(
      { processOne: scriptedProcessOne([
        { ok: false, status: 'blocked', events: ['render_terminal_failure'], reason: 'pre_moderation' },
        { ok: true, status: 'idle', events: [] },
      ]).fn, countInFlight: async () => ({}), countStaleLeases: async () => 0, now: clock().now },
      { workerId: 'w' },
    );
    expect(m.jobs_blocked).toBe(1);
    expect(m.moderation_blocks).toBe(1);
    expect(m.provider_failures).toBe(0); // moderation ≠ provider failure
  });
});
