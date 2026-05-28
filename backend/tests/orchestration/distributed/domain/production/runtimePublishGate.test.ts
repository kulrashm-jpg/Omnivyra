/**
 * Phase 27B.1 — runtimePublishGate tests.
 */

import {
  runtimePublishGate,
  RuntimePublishGateError,
  type PublishGateTxClient,
  type RunInTransaction,
  type RuntimePublishGateTelemetryEvent,
} from '../../../../../services/orchestration/distributed/domain/production/runtimePublishGate';

interface FakeRow {
  id: string;
  platformPostId: string | null;
  publishedAt: Date | null;
}

function makeFakeTx(rows: Map<string, FakeRow>): {
  runInTransaction: RunInTransaction;
  txCalls: number;
  events: Array<{ event: RuntimePublishGateTelemetryEvent; payload: Record<string, unknown> }>;
} {
  let txCalls = 0;
  const events: Array<{ event: RuntimePublishGateTelemetryEvent; payload: Record<string, unknown> }> = [];

  const tx: PublishGateTxClient = {
    async selectForUpdate({ scheduledPostId }) {
      const row = rows.get(scheduledPostId);
      if (!row) return { exists: false, platformPostId: null };
      return { exists: true, platformPostId: row.platformPostId };
    },
    async updatePlatformPostId({ scheduledPostId, platformPostId, publishedAt }) {
      const row = rows.get(scheduledPostId);
      if (!row || row.platformPostId) return { updated: 0 };
      row.platformPostId = platformPostId;
      row.publishedAt = publishedAt;
      return { updated: 1 };
    },
  };

  const runInTransaction: RunInTransaction = async (body) => {
    txCalls += 1;
    return body(tx);
  };

  return { runInTransaction, get txCalls() { return txCalls; }, events };
}

function makeAdapter(platformPostId: string): jest.Mock {
  return jest.fn(async () => ({ platformPostId }));
}

describe('runtimePublishGate', () => {
  test('publishes when platform_post_id is empty', async () => {
    const rows = new Map([['post-1', { id: 'post-1', platformPostId: null, publishedAt: null }]]);
    const { runInTransaction, events } = makeFakeTx(rows);
    const adapter = makeAdapter('xpost-99');

    const result = await runtimePublishGate({
      executionId: 'exec-1', provider: 'x', socialAccountId: 'acc-1',
      scheduledPostId: 'post-1', contentFingerprint: 'fp-1',
      adapter, runInTransaction,
      telemetry: { emit: (event, payload) => events.push({ event, payload }) },
    });

    expect(result).toEqual({ outcome: 'published', platformPostId: 'xpost-99', suppressed: false });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(rows.get('post-1')?.platformPostId).toBe('xpost-99');
    expect(events.some((e) => e.event === 'runtime_publish_gate_started')).toBe(true);
    expect(events.some((e) => e.event === 'runtime_publish_gate_adapter_called')).toBe(true);
    expect(events.some((e) => e.event === 'runtime_publish_gate_completed')).toBe(true);
  });

  test('short-circuits when platform_post_id already populated', async () => {
    const rows = new Map([['post-2', { id: 'post-2', platformPostId: 'existing-id', publishedAt: new Date() }]]);
    const { runInTransaction, events } = makeFakeTx(rows);
    const adapter = makeAdapter('should-not-be-used');

    const result = await runtimePublishGate({
      executionId: 'exec-2', provider: 'linkedin', socialAccountId: 'acc-2',
      scheduledPostId: 'post-2', contentFingerprint: 'fp-2',
      adapter, runInTransaction,
      telemetry: { emit: (event, payload) => events.push({ event, payload }) },
    });

    expect(result.outcome).toBe('duplicate');
    expect(result.platformPostId).toBe('existing-id');
    expect(adapter).not.toHaveBeenCalled();
    expect(events.some((e) => e.event === 'runtime_publish_gate_duplicate_suppressed')).toBe(true);
  });

  test('throws ROW_MISSING when scheduled_post does not exist', async () => {
    const rows = new Map<string, FakeRow>();
    const { runInTransaction, events } = makeFakeTx(rows);
    const adapter = makeAdapter('unused');

    await expect(
      runtimePublishGate({
        executionId: 'exec-3', provider: 'x', socialAccountId: 'acc-3',
        scheduledPostId: 'missing', contentFingerprint: 'fp-3',
        adapter, runInTransaction,
        telemetry: { emit: (event, payload) => events.push({ event, payload }) },
      }),
    ).rejects.toThrow(RuntimePublishGateError);
    expect(adapter).not.toHaveBeenCalled();
    expect(events.some((e) => e.event === 'runtime_publish_gate_failed')).toBe(true);
  });

  test('wraps adapter errors as ADAPTER_THREW', async () => {
    const rows = new Map([['post-4', { id: 'post-4', platformPostId: null, publishedAt: null }]]);
    const { runInTransaction, events } = makeFakeTx(rows);
    const adapter = jest.fn(async () => { throw new Error('429 rate limited'); });

    await expect(
      runtimePublishGate({
        executionId: 'exec-4', provider: 'x', socialAccountId: 'acc-4',
        scheduledPostId: 'post-4', contentFingerprint: 'fp-4',
        adapter, runInTransaction,
        telemetry: { emit: (event, payload) => events.push({ event, payload }) },
      }),
    ).rejects.toMatchObject({ code: 'ADAPTER_THREW' });
    expect(rows.get('post-4')?.platformPostId).toBeNull();
    expect(events.some((e) => e.event === 'runtime_publish_gate_failed')).toBe(true);
  });

  test('concurrent same-postId calls publish exactly once', async () => {
    // Simulate serialization by serializing the transaction body access
    // to the shared row map.
    const rows = new Map([['post-5', { id: 'post-5', platformPostId: null, publishedAt: null }]]);
    const adapter = jest.fn(async () => ({ platformPostId: 'race-99' }));
    let txMutex = Promise.resolve();
    const runInTransaction: RunInTransaction = async (body) => {
      const release = txMutex;
      let releaseFn: () => void = () => {};
      txMutex = new Promise<void>((res) => { releaseFn = res; });
      await release;
      try {
        return await body({
          async selectForUpdate({ scheduledPostId }) {
            const row = rows.get(scheduledPostId);
            if (!row) return { exists: false, platformPostId: null };
            return { exists: true, platformPostId: row.platformPostId };
          },
          async updatePlatformPostId({ scheduledPostId, platformPostId, publishedAt }) {
            const row = rows.get(scheduledPostId);
            if (!row || row.platformPostId) return { updated: 0 };
            row.platformPostId = platformPostId;
            row.publishedAt = publishedAt;
            return { updated: 1 };
          },
        });
      } finally {
        releaseFn();
      }
    };

    const [r1, r2, r3] = await Promise.all([1, 2, 3].map((n) =>
      runtimePublishGate({
        executionId: `exec-${n}`, provider: 'x', socialAccountId: 'acc',
        scheduledPostId: 'post-5', contentFingerprint: 'fp-5',
        adapter, runInTransaction,
        telemetry: { emit: () => {} },
      })
    ));

    const outcomes = [r1, r2, r3].map((r) => r.outcome).sort();
    expect(outcomes).toEqual(['duplicate', 'duplicate', 'published']);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(rows.get('post-5')?.platformPostId).toBe('race-99');
  });

  test('rejects on missing input fields', async () => {
    const rows = new Map<string, FakeRow>();
    const { runInTransaction } = makeFakeTx(rows);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runtimePublishGate({
        executionId: '',
        provider: 'x',
        socialAccountId: 'acc',
        scheduledPostId: 'p',
        contentFingerprint: 'fp',
        adapter: makeAdapter('x'),
        runInTransaction,
      } as any),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
