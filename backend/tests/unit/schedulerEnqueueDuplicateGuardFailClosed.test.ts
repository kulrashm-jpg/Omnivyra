/**
 * enqueueScheduledPostAt — duplicate-guard must not collapse "query failed"
 * into "not a duplicate".
 *
 * The guard has to keep THREE states distinct:
 *   (a) query ok  + row found -> 'duplicate', no enqueue
 *   (b) query ok  + no row    -> enqueue (unchanged behaviour)
 *   (c) query FAILED          -> duplicate status UNKNOWN -> fail closed, NO enqueue
 *
 * Before the fix `error` was discarded, so (c) produced data=null and was
 * indistinguishable from (b): a second publish job was enqueued for a post
 * that may already have been queued. Publishing twice to a public social
 * platform is irreversible.
 *
 * These tests drive the REAL exported `enqueueScheduledPostAt` through
 * `backend/scheduler/schedulerService` (the module every production caller
 * imports) with the DB / queue seams mocked. Nothing is published.
 */

type QueueJobRow = { id: string; scheduled_post_id: string; status: string };

const state: {
  queueJobRows: QueueJobRow[];
  queueJobsSelectError: { message: string } | null;
} = {
  queueJobRows: [],
  queueJobsSelectError: null,
};

const createdQueueJobs: Array<Record<string, unknown>> = [];
const bullAdds: Array<{ name: string; data: any; opts: any }> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: jest.fn(async () => ({ data: null, error: { message: 'rpc missing' } })),
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ maybeSingle: jest.fn(async () => ({ data: null, error: null })) })),
      })),
    })),
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => {
    const filters: Record<string, any> = {};
    let payload: Record<string, any> | null = null;
    let ids: string[] = [];

    const matching = () =>
      state.queueJobRows.filter(
        (r) =>
          (!filters.scheduled_post_id || r.scheduled_post_id === filters.scheduled_post_id) &&
          (!filters.status ||
            (Array.isArray(filters.status) ? filters.status.includes(r.status) : r.status === filters.status)),
      );

    const api: any = {
      select: jest.fn(() => api),
      eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
      in: jest.fn((k: string, v: any[]) => { if (payload) { ids = v; } filters[k] = v; return api; }),
      order: jest.fn(() => api),
      limit: jest.fn(() => api),
      update: jest.fn((p: Record<string, any>) => { payload = p; return api; }),
      maybeSingle: jest.fn(async () => {
        if (table !== 'queue_jobs') return { data: null, error: null };
        if (state.queueJobsSelectError) return { data: null, error: state.queueJobsSelectError };
        return { data: matching()[0] ?? null, error: null };
      }),
      then(resolve: any) {
        if (table !== 'queue_jobs') return Promise.resolve({ data: null, error: null }).then(resolve);
        if (payload) {
          for (const id of ids) {
            const row = state.queueJobRows.find((r) => r.id === id);
            if (row) Object.assign(row, payload);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        if (state.queueJobsSelectError) {
          return Promise.resolve({ data: null, error: state.queueJobsSelectError }).then(resolve);
        }
        return Promise.resolve({ data: matching(), error: null }).then(resolve);
      },
    };
    return api;
  }),
}));

jest.mock('../../queue/bullmqClient', () => ({
  getQueue: jest.fn(() => ({
    getJobCounts: jest.fn(async () => ({ waiting: 0, active: 0, delayed: 0 })),
    add: jest.fn(async (name: string, data: any, opts: any) => {
      bullAdds.push({ name, data, opts });
      return { id: opts?.jobId ?? 'bull-job-1' };
    }),
    getJob: jest.fn(async () => null),
  })),
  getEngagementPollingQueue: jest.fn(() => ({ add: jest.fn() })),
}));

jest.mock('../../db/queries', () => ({
  createQueueJob: jest.fn(async (payload: any) => {
    createdQueueJobs.push(payload);
    const id = `qj-new-${state.queueJobRows.length + 1}`;
    state.queueJobRows.push({
      id,
      scheduled_post_id: payload.scheduled_post_id,
      status: payload.status ?? 'pending',
    });
    return id;
  }),
}));

const POST_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

/** Always in the future so the 'past' short-circuit never masks the result. */
const futureIso = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();

async function loadEnqueue() {
  const mod = await import('../../scheduler/schedulerService');
  return mod.enqueueScheduledPostAt;
}

function reset() {
  state.queueJobRows.length = 0;
  state.queueJobsSelectError = null;
  createdQueueJobs.length = 0;
  bullAdds.length = 0;
}

describe('enqueueScheduledPostAt — duplicate guard fails closed on a DB error', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reset();
  });

  // 1. duplicate exists -> no duplicate enqueue
  test('an existing pending queue_job returns "duplicate" and enqueues nothing', async () => {
    state.queueJobRows.push({ id: 'qj-existing', scheduled_post_id: POST_ID, status: 'pending' });
    const enqueueScheduledPostAt = await loadEnqueue();

    const result = await enqueueScheduledPostAt(POST_ID, USER_ID, ACCOUNT_ID, futureIso());

    expect(result).toBe('duplicate');
    expect(createdQueueJobs).toHaveLength(0);
    expect(bullAdds).toHaveLength(0);
  });

  // 2. no duplicate -> normal enqueue (proves the fix does not over-suppress)
  test('no existing queue_job still enqueues normally', async () => {
    const enqueueScheduledPostAt = await loadEnqueue();

    const result = await enqueueScheduledPostAt(POST_ID, USER_ID, ACCOUNT_ID, futureIso());

    expect(result).toBe('enqueued');
    expect(createdQueueJobs).toHaveLength(1);
    expect(createdQueueJobs[0]).toMatchObject({ scheduled_post_id: POST_ID, job_type: 'publish' });
    expect(bullAdds).toHaveLength(1);
    expect(bullAdds[0].data).toMatchObject({ scheduled_post_id: POST_ID, user_id: USER_ID });
  });

  // 3. query error -> NO enqueue (the core regression)
  test('a failing duplicate lookup refuses to enqueue instead of assuming "not duplicate"', async () => {
    state.queueJobsSelectError = { message: 'connection terminated unexpectedly' };
    const enqueueScheduledPostAt = await loadEnqueue();

    await expect(
      enqueueScheduledPostAt(POST_ID, USER_ID, ACCOUNT_ID, futureIso()),
    ).rejects.toThrow(/duplicate check/i);

    // The irreversible part: nothing reached the DB or the publish queue.
    expect(createdQueueJobs).toHaveLength(0);
    expect(bullAdds).toHaveLength(0);
  });

  // 3b. a pre-existing job plus a failing lookup must never double-publish
  test('a failing lookup does not enqueue a second job for an already-queued post', async () => {
    state.queueJobRows.push({ id: 'qj-existing', scheduled_post_id: POST_ID, status: 'processing' });
    state.queueJobsSelectError = { message: 'statement timeout' };
    const enqueueScheduledPostAt = await loadEnqueue();

    await expect(
      enqueueScheduledPostAt(POST_ID, USER_ID, ACCOUNT_ID, futureIso()),
    ).rejects.toThrow();

    expect(bullAdds).toHaveLength(0);
    expect(state.queueJobRows).toHaveLength(1); // still just the original job
  });

  // 4. the query error is surfaced / logged
  test('the underlying DB error is surfaced to the caller and logged', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    state.queueJobsSelectError = { message: 'PGRST301 jwt expired' };
    const enqueueScheduledPostAt = await loadEnqueue();

    try {
      await expect(
        enqueueScheduledPostAt(POST_ID, USER_ID, ACCOUNT_ID, futureIso()),
      ).rejects.toThrow('PGRST301 jwt expired');

      const logged = errorSpy.mock.calls.some((call) =>
        JSON.stringify(call).includes('PGRST301 jwt expired'),
      );
      expect(logged).toBe(true);
      const mentionsPost = errorSpy.mock.calls.some((call) => JSON.stringify(call).includes(POST_ID));
      expect(mentionsPost).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  // 5. a subsequent successful retry can enqueue normally
  test('a retry after the DB recovers enqueues normally', async () => {
    state.queueJobsSelectError = { message: 'connection reset by peer' };
    const enqueueScheduledPostAt = await loadEnqueue();

    await expect(
      enqueueScheduledPostAt(POST_ID, USER_ID, ACCOUNT_ID, futureIso()),
    ).rejects.toThrow();
    expect(bullAdds).toHaveLength(0);

    // DB recovers; the post was never marked queued, so the retry proceeds.
    state.queueJobsSelectError = null;

    const result = await enqueueScheduledPostAt(POST_ID, USER_ID, ACCOUNT_ID, futureIso());
    expect(result).toBe('enqueued');
    expect(createdQueueJobs).toHaveLength(1);
    expect(bullAdds).toHaveLength(1);
  });

  // 6. an empty result is NOT an error — no false duplicate suppression
  test('an empty result set (data:null, error:null) is treated as "no duplicate", not as a failure', async () => {
    const enqueueScheduledPostAt = await loadEnqueue();

    // No rows at all for this post, and no error — the ordinary first-schedule case.
    expect(state.queueJobRows).toHaveLength(0);
    state.queueJobsSelectError = null;

    const result = await enqueueScheduledPostAt(POST_ID, USER_ID, ACCOUNT_ID, futureIso());

    expect(result).toBe('enqueued');
    expect(bullAdds).toHaveLength(1);
  });

  // 6b. rows exist but for a DIFFERENT post -> still not a duplicate
  test('a pending job belonging to another post does not suppress this enqueue', async () => {
    state.queueJobRows.push({ id: 'qj-other', scheduled_post_id: 'other-post', status: 'pending' });
    const enqueueScheduledPostAt = await loadEnqueue();

    const result = await enqueueScheduledPostAt(POST_ID, USER_ID, ACCOUNT_ID, futureIso());

    expect(result).toBe('enqueued');
    expect(bullAdds).toHaveLength(1);
  });

  // Past-due short-circuit is unchanged and still runs AFTER the guard.
  test('a past-due post still returns "past" without enqueueing', async () => {
    const enqueueScheduledPostAt = await loadEnqueue();

    const result = await enqueueScheduledPostAt(
      POST_ID,
      USER_ID,
      ACCOUNT_ID,
      new Date(Date.now() - 60_000).toISOString(),
    );

    expect(result).toBe('past');
    expect(bullAdds).toHaveLength(0);
  });
});
