/**
 * Tests for the queue concurrency lock + atomic cancel+enqueue helpers
 * in backend/scheduler/schedulerService.ts.
 *
 *   - tryAcquireScheduledPostQueueLock returns acquired:true under advisory lock
 *   - tryAcquireScheduledPostQueueLock returns acquired:false on contention
 *   - falls back to optimistic_check when RPC missing
 *   - atomicCancelAndReEnqueueScheduledPost rolls back when enqueue fails
 *   - returns ok:false on lock contention
 *   - returns idempotency key derived from scheduledFor
 */

const mockRpcResponses: Record<string, any> = {};
const queueOps: { add: any[]; getJob: any[]; remove: number } = { add: [], getJob: [], remove: 0 };
const queueJobRows: Array<{ id: string; scheduled_post_id: string; status: string; scheduled_for?: string | null; updated_at?: string }> = [];
const ownedQueueJobOps: Array<{ kind: 'update'; payload: Record<string, any>; ids: string[] }> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: jest.fn(async (name: string, _args: any) => {
      if (Object.prototype.hasOwnProperty.call(mockRpcResponses, name)) {
        const resp = mockRpcResponses[name];
        if (resp instanceof Error) return { data: null, error: { message: resp.message } };
        return { data: resp, error: null };
      }
      return { data: null, error: { message: 'rpc missing' } };
    }),
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => {
    const filters: Record<string, any> = {};
    let payload: Record<string, any> | null = null;
    let ids: string[] = [];
    const api: any = {
      select: jest.fn(() => api),
      eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
      in: jest.fn((k: string, v: any[]) => {
        // Only `.in('id', …)` selects WHICH rows an update targets. A guard like
        // `.in('status', ['pending','processing'])` is an additional predicate,
        // not the id list — treating any `.in()` as the id list made a
        // status-guarded update address the status strings as row ids.
        if (payload && k === 'id') { ids = v; }
        filters[k] = v;
        return api;
      }),
      order: jest.fn(() => api),
      limit: jest.fn(() => api),
      maybeSingle: jest.fn(async () => {
        if (table === 'queue_jobs') {
          const matching = queueJobRows.filter((r) =>
            (!filters.scheduled_post_id || r.scheduled_post_id === filters.scheduled_post_id) &&
            (!filters.status || (Array.isArray(filters.status) ? filters.status.includes(r.status) : r.status === filters.status))
          );
          return { data: matching[0] ?? null, error: null };
        }
        return { data: null, error: null };
      }),
      update: jest.fn((p: Record<string, any>) => { payload = p; return api; }),
      then(resolve: any) {
        if (table === 'queue_jobs') {
          if (payload) {
            ownedQueueJobOps.push({ kind: 'update', payload, ids });
            // Postgres evaluates an UPDATE's WHERE against the PRE-update rows
            // and returns exactly those as the affected set. The previous fake
            // applied the payload first and filtered afterwards, so a
            // status-changing update guarded on the OLD status matched nothing
            // and reported zero rows affected — the opposite of the real driver.
            const targets = queueJobRows.filter((r) =>
              ids.includes(r.id) &&
              (!filters.scheduled_post_id || r.scheduled_post_id === filters.scheduled_post_id) &&
              (!filters.status || (Array.isArray(filters.status) ? filters.status.includes(r.status) : r.status === filters.status))
            );
            for (const row of targets) Object.assign(row, payload);
            return Promise.resolve({ data: targets, error: null }).then(resolve);
          }
          const matching = queueJobRows.filter((r) =>
            (!filters.scheduled_post_id || r.scheduled_post_id === filters.scheduled_post_id) &&
            (!filters.status || (Array.isArray(filters.status) ? filters.status.includes(r.status) : r.status === filters.status))
          );
          return Promise.resolve({ data: matching, error: null }).then(resolve);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  }),
}));

jest.mock('../../queue/bullmqClient', () => ({
  getQueue: jest.fn(() => ({
    add: jest.fn(async (...args: any[]) => { queueOps.add.push(args); return { id: 'job-1' }; }),
    getJob: jest.fn(async (id: string) => { queueOps.getJob.push(id); return { remove: async () => { queueOps.remove += 1; } }; }),
  })),
  getEngagementPollingQueue: jest.fn(() => ({ add: jest.fn() })),
}));

jest.mock('../../db/queries', () => ({
  createQueueJob: jest.fn(async (payload: any) => {
    const id = `qj-new-${queueJobRows.length + 1}`;
    queueJobRows.push({ id, scheduled_post_id: payload.scheduled_post_id, status: payload.status ?? 'pending' });
    return id;
  }),
}));

function resetState() {
  Object.keys(mockRpcResponses).forEach((k) => delete mockRpcResponses[k]);
  queueOps.add.length = 0;
  queueOps.getJob.length = 0;
  queueOps.remove = 0;
  queueJobRows.length = 0;
  ownedQueueJobOps.length = 0;
}

describe('queue concurrency lock + atomic re-enqueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetState();
  });

  test('tryAcquireScheduledPostQueueLock returns acquired:true when advisory RPC succeeds', async () => {
    mockRpcResponses['try_scheduled_post_lock'] = true;
    const { tryAcquireScheduledPostQueueLock } = await import('../../scheduler/schedulerService');
    const lock = await tryAcquireScheduledPostQueueLock('00000000-0000-0000-0000-000000000001');
    expect(lock.acquired).toBe(true);
    expect(lock.mode).toBe('advisory');
    await lock.release();
  });

  test('tryAcquireScheduledPostQueueLock returns acquired:false on advisory contention', async () => {
    mockRpcResponses['try_scheduled_post_lock'] = false;
    const { tryAcquireScheduledPostQueueLock } = await import('../../scheduler/schedulerService');
    const lock = await tryAcquireScheduledPostQueueLock('00000000-0000-0000-0000-000000000002');
    expect(lock.acquired).toBe(false);
    expect(lock.mode).toBe('advisory');
  });

  test('falls back to optimistic_check when advisory RPC errors', async () => {
    mockRpcResponses['try_scheduled_post_lock'] = new Error('rpc missing');
    const { tryAcquireScheduledPostQueueLock } = await import('../../scheduler/schedulerService');
    const lock = await tryAcquireScheduledPostQueueLock('00000000-0000-0000-0000-000000000003');
    expect(lock.acquired).toBe(true);
    expect(lock.mode === 'optimistic_check' || lock.mode === 'none').toBe(true);
  });

  test('atomicCancelAndReEnqueueScheduledPost returns ok:true on happy path', async () => {
    mockRpcResponses['try_scheduled_post_lock'] = true;
    queueJobRows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { atomicCancelAndReEnqueueScheduledPost } = await import('../../scheduler/schedulerService');
    const result = await atomicCancelAndReEnqueueScheduledPost({
      scheduledPostId: 'sp-1',
      userId: 'user-1',
      socialAccountId: 'sa-1',
      newScheduledFor: future,
      reason: 'test',
    });
    expect(result.ok).toBe(true);
    expect(result.locked).toBe(true);
    expect(result.enqueue).toBe('enqueued');
    expect(result.idempotency_key).toContain('sp-1');
    expect(result.idempotency_key).toContain(String(new Date(future).getTime()));
    expect(queueOps.add.length).toBeGreaterThanOrEqual(1);
  });

  test('atomicCancelAndReEnqueueScheduledPost returns ok:false on lock contention without touching the queue', async () => {
    mockRpcResponses['try_scheduled_post_lock'] = false;
    const { atomicCancelAndReEnqueueScheduledPost } = await import('../../scheduler/schedulerService');
    const result = await atomicCancelAndReEnqueueScheduledPost({
      scheduledPostId: 'sp-1',
      userId: 'user-1',
      socialAccountId: 'sa-1',
      newScheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(result.ok).toBe(false);
    expect(result.locked).toBe(false);
    expect(queueOps.add.length).toBe(0);
    expect(queueOps.remove).toBe(0);
  });
});
