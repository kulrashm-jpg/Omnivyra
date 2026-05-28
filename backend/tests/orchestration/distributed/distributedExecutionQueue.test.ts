/**
 * Phase 20A — DistributedExecutionQueue unit tests.
 */

import {
  createInMemoryExecutionQueue,
  type QueueTelemetrySink,
} from '../../../services/orchestration/distributed/distributedExecutionQueue';

function sink(): { sink: QueueTelemetrySink; events: Array<{ event: string; payload: Record<string, unknown> }> } {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  return { events, sink: { emit(event, payload) { events.push({ event, payload }); } } };
}

describe('DistributedExecutionQueue — enqueue + dedup', () => {
  test('enqueue creates a queued entry', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    const e = await q.enqueue({
      executionId: 'exec_1', companyId: 'co', kind: 'execution_start',
    });
    expect(e.status).toBe('queued');
    expect(e.attemptCount).toBe(0);
    expect(e.dedupKey).toBe('execution_start:exec_1');
  });

  test('duplicate enqueue with same dedupKey returns existing entry', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    const a = await q.enqueue({ executionId: 'exec_1', companyId: 'co', kind: 'execution_start' });
    const b = await q.enqueue({ executionId: 'exec_1', companyId: 'co', kind: 'execution_start' });
    expect(b.queueEntryId).toBe(a.queueEntryId);
    expect((await q.listByExecution('exec_1')).length).toBe(1);
  });

  test('different kinds enqueue separately for same execution', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    await q.enqueue({ executionId: 'exec_1', companyId: 'co', kind: 'execution_start' });
    await q.enqueue({ executionId: 'exec_1', companyId: 'co', kind: 'execution_recovery' });
    expect((await q.listByExecution('exec_1')).length).toBe(2);
  });
});

describe('DistributedExecutionQueue — claim + ordering', () => {
  test('claim returns the earliest-eligible entry', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    await q.enqueue({ executionId: 'e_late', companyId: 'co', kind: 'execution_start', runAtIso: new Date(Date.now() + 60_000).toISOString() });
    await q.enqueue({ executionId: 'e_early', companyId: 'co', kind: 'execution_start' });
    const claimed = await q.claim({ workerId: 'w' });
    expect(claimed.length).toBe(1);
    expect(claimed[0].executionId).toBe('e_early');
  });

  test('claim respects priority among same-runAt entries', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    const baseIso = new Date(2025, 0, 1).toISOString();
    await q.enqueue({ executionId: 'low', companyId: 'co', kind: 'execution_start', priority: 10, runAtIso: baseIso });
    await q.enqueue({ executionId: 'high', companyId: 'co', kind: 'execution_start', priority: 90, runAtIso: baseIso });
    const [first] = await q.claim({ workerId: 'w' });
    expect(first.executionId).toBe('high');
  });

  test('claim does not return delayed entries', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    await q.enqueue({
      executionId: 'e_future', companyId: 'co', kind: 'execution_start',
      runAtIso: new Date(Date.now() + 60_000).toISOString(),
    });
    const claimed = await q.claim({ workerId: 'w' });
    expect(claimed.length).toBe(0);
  });

  test('claim respects kind + companyId filters', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    await q.enqueue({ executionId: 'a', companyId: 'co1', kind: 'execution_start' });
    await q.enqueue({ executionId: 'b', companyId: 'co2', kind: 'execution_recovery' });
    const onlyRec = await q.claim({ workerId: 'w', kind: 'execution_recovery' });
    expect(onlyRec.length).toBe(1);
    expect(onlyRec[0].executionId).toBe('b');
  });
});

describe('DistributedExecutionQueue — ack + retry', () => {
  test('ack completed marks the entry completed', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    const e = await q.enqueue({ executionId: 'exec_1', companyId: 'co', kind: 'execution_start' });
    await q.claim({ workerId: 'w' });
    const after = await q.ack({ queueEntryId: e.queueEntryId, workerId: 'w', outcome: 'completed' });
    expect(after?.status).toBe('completed');
  });

  test('ack failed reschedules a retry with backoff', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    const e = await q.enqueue({ executionId: 'exec_1', companyId: 'co', kind: 'execution_start', maxAttempts: 3 });
    await q.claim({ workerId: 'w' });
    const after = await q.ack({
      queueEntryId: e.queueEntryId, workerId: 'w', outcome: 'failed', retryAfterMs: 1,
    });
    expect(after?.status).toBe('queued');
    expect(after?.attemptCount).toBe(1);
    expect(Date.parse(after!.runAtIso)).toBeGreaterThan(Date.now() - 5_000);
  });

  test('ack failed past maxAttempts dead-letters', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    const e = await q.enqueue({
      executionId: 'exec_1', companyId: 'co', kind: 'execution_start', maxAttempts: 2,
    });
    // Claim → fail twice; on the second fail attemptCount reaches 2 and dead-letters.
    for (let i = 0; i < 2; i += 1) {
      const cl = await q.claim({ workerId: 'w', nowMs: Date.now() + i * 1_000_000 });
      if (cl.length === 0) break;
      await q.ack({
        queueEntryId: e.queueEntryId, workerId: 'w', outcome: 'failed', retryAfterMs: 1,
      });
    }
    const after = await q.get(e.queueEntryId);
    expect(after?.status).toBe('dead_lettered');
    expect(after?.attemptCount).toBe(2);
  });

  test('ack by non-owner is a no-op (telemetry only)', async () => {
    const { sink: s, events } = sink();
    const q = createInMemoryExecutionQueue({ telemetry: s });
    const e = await q.enqueue({ executionId: 'exec_1', companyId: 'co', kind: 'execution_start' });
    await q.claim({ workerId: 'w_owner' });
    const result = await q.ack({
      queueEntryId: e.queueEntryId, workerId: 'w_intruder', outcome: 'completed',
    });
    expect(result).toBeNull();
    expect(events.some((ev) => ev.event === 'execution_dedup_suppressed' && ev.payload.reason === 'ack_by_non_owner')).toBe(true);
  });
});

describe('DistributedExecutionQueue — visibility reclaim', () => {
  test('reclaimExpired resets visibility-expired claims to queued', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    await q.enqueue({ executionId: 'exec_1', companyId: 'co', kind: 'execution_start' });
    await q.claim({ workerId: 'w', visibilityMs: 30 });
    await new Promise((r) => setTimeout(r, 80));
    const reclaimed = await q.reclaimExpired();
    expect(reclaimed.length).toBe(1);
    expect(reclaimed[0].status).toBe('queued');
    expect(reclaimed[0].claimedByWorkerId).toBeNull();
  });

  test('live claims are NOT reclaimed', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    await q.enqueue({ executionId: 'exec_1', companyId: 'co', kind: 'execution_start' });
    await q.claim({ workerId: 'w', visibilityMs: 60_000 });
    const reclaimed = await q.reclaimExpired();
    expect(reclaimed.length).toBe(0);
  });
});

describe('DistributedExecutionQueue — inspection', () => {
  test('countByStatus tallies entries', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    await q.enqueue({ executionId: 'a', companyId: 'co', kind: 'execution_start' });
    await q.enqueue({ executionId: 'b', companyId: 'co', kind: 'execution_start' });
    const counts = await q.countByStatus();
    expect(counts.queued).toBe(2);
    expect(counts.claimed).toBe(0);
  });

  test('depth filters by companyId + kind', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: sink().sink });
    await q.enqueue({ executionId: 'a', companyId: 'co1', kind: 'execution_start' });
    await q.enqueue({ executionId: 'b', companyId: 'co2', kind: 'execution_start' });
    await q.enqueue({ executionId: 'c', companyId: 'co1', kind: 'execution_recovery' });
    expect(await q.depth({ companyId: 'co1' })).toBe(2);
    expect(await q.depth({ companyId: 'co1', kind: 'execution_start' })).toBe(1);
  });
});
