/**
 * Phase 22C — listByClaimer tests (in-memory queue).
 */

import {
  createInMemoryExecutionQueue,
} from '../../../services/orchestration/distributed/distributedExecutionQueue';

describe('DistributedExecutionQueue.listByClaimer', () => {
  test('returns only entries claimed by the specified worker', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: { emit: () => {} } });
    await q.enqueue({ executionId: 'a', companyId: 'co', kind: 'execution_start' });
    await q.enqueue({ executionId: 'b', companyId: 'co', kind: 'execution_start' });
    await q.enqueue({ executionId: 'c', companyId: 'co', kind: 'execution_start' });
    await q.claim({ workerId: 'w_a' });
    await q.claim({ workerId: 'w_b' });
    await q.claim({ workerId: 'w_a' });
    const claimedByA = await q.listByClaimer('w_a');
    expect(claimedByA.length).toBe(2);
    expect(claimedByA.every((e) => e.claimedByWorkerId === 'w_a')).toBe(true);
  });

  test('returns only entries with status=claimed', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: { emit: () => {} } });
    const e1 = await q.enqueue({ executionId: 'a', companyId: 'co', kind: 'execution_start' });
    const e2 = await q.enqueue({ executionId: 'b', companyId: 'co', kind: 'execution_start' });
    await q.claim({ workerId: 'w_a' });
    await q.claim({ workerId: 'w_a' });
    // Complete one entry — it should drop out of the listByClaimer result.
    await q.ack({ queueEntryId: e1.queueEntryId, workerId: 'w_a', outcome: 'completed' });
    const list = await q.listByClaimer('w_a');
    expect(list.length).toBe(1);
    expect(list[0].queueEntryId).toBe(e2.queueEntryId);
  });

  test('respects the limit option', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: { emit: () => {} } });
    for (let i = 0; i < 5; i += 1) {
      await q.enqueue({ executionId: `e${i}`, companyId: 'co', kind: 'execution_start' });
    }
    await q.claim({ workerId: 'w', limit: 5 });
    const limited = await q.listByClaimer('w', { limit: 2 });
    expect(limited.length).toBe(2);
  });

  test('empty workerId returns empty array', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: { emit: () => {} } });
    const r = await q.listByClaimer('');
    expect(r).toEqual([]);
  });

  test('unknown worker returns empty array', async () => {
    const q = createInMemoryExecutionQueue({ telemetry: { emit: () => {} } });
    const r = await q.listByClaimer('unknown_worker');
    expect(r).toEqual([]);
  });
});
