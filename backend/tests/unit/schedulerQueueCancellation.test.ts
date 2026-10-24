/**
 * Queue-entry cancellation against the REAL deployed queue_jobs shape.
 *
 * The production defect these tests lock down: cancelScheduledPostQueueEntry
 * issued an UPDATE naming `completed_at` and `last_error`, neither of which
 * exists on queue_jobs in any schema this repo has ever had. PostgREST rejects
 * the whole statement when an update names an unknown column, so
 * `status='cancelled'` never landed either — production held 0 cancelled rows
 * out of 14.
 *
 * The fake below is therefore NOT a permissive recorder. It models the
 * persistence boundary that actually bit us:
 *
 *   - an UPDATE naming a column outside the deployed set is REJECTED WHOLE
 *     (PGRST204) and mutates nothing — exactly PostgREST's behaviour;
 *   - `.maybeSingle()` errors when more than one row matches (PGRST116),
 *     as supabase-js does;
 *   - INSERT enforces the partial unique index over live rows
 *     (uidx_queue_jobs_live_job_per_post), raising 23505.
 *
 * With that fake in place a test can only pass by writing columns that exist.
 */

import { QUEUE_JOBS_COLUMNS } from '../../scheduler/schedulerPostQueueControl';

// ── The authoritative deployed column set ───────────────────────────────────
// Transcribed from supabase/_schema/baseline.sql `CREATE TABLE public.queue_jobs`
// and confirmed read-only against production. Held INDEPENDENTLY of the source
// module so a test cannot be satisfied by editing the constant it asserts
// against — the module's own export is cross-checked against this list below.
const DEPLOYED_QUEUE_JOBS_COLUMNS = [
  'id',
  'scheduled_post_id',
  'job_type',
  'status',
  'attempts',
  'max_attempts',
  'scheduled_for',
  'next_retry_at',
  'error_message',
  'metadata',
  'created_at',
  'updated_at',
  'priority',
  'payload',
  'result_data',
  'error_code',
];

const LIVE_STATUSES = ['pending', 'processing'];
const LIVE_UNIQUE_INDEX = 'uidx_queue_jobs_live_job_per_post';

type QueueJobRow = {
  id: string;
  scheduled_post_id: string;
  status: string;
  scheduled_for?: string | null;
  attempts?: number | null;
  max_attempts?: number | null;
  next_retry_at?: string | null;
  error_message?: string | null;
  error_code?: string | null;
  retry_state?: string | null;
  metadata?: Record<string, unknown> | null;
  updated_at?: string;
  created_at?: string;
};

const rows: QueueJobRow[] = [];
const updatePayloads: Array<Record<string, unknown>> = [];
const queueOps = { add: [] as any[], removed: [] as string[] };
const rpcResponses: Record<string, any> = {};
/** When set, the next queue_jobs UPDATE fails with this PostgREST error. */
let forcedUpdateError: { message: string; code?: string } | null = null;
/** Enforce the partial unique index on INSERT (Agent B's migration). */
let liveUniqueIndexActive = true;
/** When true, the BullMQ enqueue throws (Redis unavailable). */
let failQueueAdd = false;
/** Fires once, after a SELECT resolves and before the following UPDATE. */
let afterSelect: (() => void) | null = null;
/** BullMQ job ids whose remove() throws (an active/locked job, a Redis error): the job survives. */
const failRemoveFor = new Set<string>();
/** BullMQ state per job id (default 'delayed', i.e. a scheduled job not yet due). */
const bullStates: Record<string, string> = {};
/** Runs on EVERY getJob (reset per test) — lets a test act in the gap before a restore. */
let onGetJob: ((id: string) => void) | null = null;

function matches(row: QueueJobRow, filters: Record<string, any>): boolean {
  for (const [key, value] of Object.entries(filters)) {
    // PostgREST JSON path (`metadata->platform_call`): a missing key or a
    // NULL column both read as NULL.
    const actual = key.includes('->')
      ? key.split('->').slice(1).reduce((v: any, k) => (v && typeof v === 'object' ? v[k] : undefined), (row as any)[key.split('->')[0]])
      : (row as any)[key];
    if (value === null) {
      // `.is(col, null)` — IS NULL.
      if (actual !== null && actual !== undefined) return false;
    } else if (Array.isArray(value)) {
      if (!value.includes(actual)) return false;
    } else if (actual !== value) {
      return false;
    }
  }
  return true;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: jest.fn(async (name: string) => {
      if (Object.prototype.hasOwnProperty.call(rpcResponses, name)) {
        return { data: rpcResponses[name], error: null };
      }
      return { data: null, error: { message: 'rpc missing' } };
    }),
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => {
    const filters: Record<string, any> = {};
    let pendingUpdate: Record<string, unknown> | null = null;

    const runUpdate = () => {
      // PostgREST validates the payload against the schema cache BEFORE
      // touching any row. An unknown column rejects the ENTIRE statement, so
      // every other key in the payload — `status` included — is discarded.
      const unknown = Object.keys(pendingUpdate!).filter(
        (k) => !DEPLOYED_QUEUE_JOBS_COLUMNS.includes(k),
      );
      if (unknown.length > 0) {
        return {
          data: null,
          error: {
            code: 'PGRST204',
            message: `Could not find the '${unknown[0]}' column of 'queue_jobs' in the schema cache`,
          },
        };
      }
      if (forcedUpdateError) {
        const err = forcedUpdateError;
        forcedUpdateError = null;
        return { data: null, error: err };
      }
      updatePayloads.push({ ...pendingUpdate! });
      const targets = rows.filter((r) => matches(r, filters));
      for (const row of targets) Object.assign(row, pendingUpdate!);
      return { data: targets, error: null };
    };

    const api: any = {
      select: jest.fn(() => api),
      eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
      in: jest.fn((k: string, v: any[]) => { filters[k] = v; return api; }),
      is: jest.fn((k: string, v: null) => { filters[k] = v; return api; }),
      order: jest.fn(() => api),
      limit: jest.fn(() => api),
      update: jest.fn((payload: Record<string, unknown>) => { pendingUpdate = payload; return api; }),
      maybeSingle: jest.fn(async () => {
        if (table !== 'queue_jobs') return { data: null, error: null };
        const found = rows.filter((r) => matches(r, filters));
        if (found.length > 1) {
          // supabase-js: maybeSingle errors when more than one row matches.
          return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } };
        }
        return { data: found[0] ?? null, error: null };
      }),
      then(resolve: any) {
        if (table !== 'queue_jobs') return Promise.resolve({ data: null, error: null }).then(resolve);
        if (pendingUpdate) return Promise.resolve(runUpdate()).then(resolve);
        const selected = rows.filter((r) => matches(r, filters));
        // Lets a test simulate a worker winning the race in the window between
        // the SELECT returning and the UPDATE landing. Without this the gap
        // cannot be reproduced at all, and a guard against it is untestable.
        if (afterSelect) { const hook = afterSelect; afterSelect = null; hook(); }
        return Promise.resolve({ data: selected, error: null }).then(resolve);
      },
    };
    return api;
  }),
}));

jest.mock('../../queue/bullmqClient', () => ({
  getQueue: jest.fn(() => ({
    getJobCounts: jest.fn(async () => ({ waiting: 0, active: 0, delayed: 0 })),
    add: jest.fn(async (...args: any[]) => {
      if (failQueueAdd) throw new Error('redis down');
      queueOps.add.push(args);
      return { id: args?.[2]?.jobId ?? 'bull-1' };
    }),
    // Faithful to BullMQ (Closure-008): a removed job is GONE — getJob then
    // resolves to undefined — and a job reports its state. The previous double
    // returned a job for every id even after remove(), which is how a restore
    // of a row whose job had been deleted looked like a working rollback.
    getJob: jest.fn(async (id: string) => {
      if (onGetJob) onGetJob(id);
      if (queueOps.removed.includes(id)) return undefined;
      return {
        remove: async () => {
          if (failRemoveFor.has(id)) throw new Error('job is locked');
          queueOps.removed.push(id);
        },
        getState: async () => bullStates[id] ?? 'delayed',
      };
    }),
  })),
  getEngagementPollingQueue: jest.fn(() => ({ add: jest.fn() })),
}));

jest.mock('../../db/queries', () => ({
  createQueueJob: jest.fn(async (payload: any) => {
    if (liveUniqueIndexActive && LIVE_STATUSES.includes(payload.status)) {
      const clash = rows.some(
        (r) => r.scheduled_post_id === payload.scheduled_post_id && LIVE_STATUSES.includes(r.status),
      );
      if (clash) {
        throw new Error(
          `Failed to create queue job: duplicate key value violates unique constraint "${LIVE_UNIQUE_INDEX}"`,
        );
      }
    }
    const id = `qj-new-${rows.length + 1}`;
    rows.push({
      id,
      scheduled_post_id: payload.scheduled_post_id,
      status: payload.status,
      scheduled_for: payload.scheduled_for,
      attempts: 0,
      max_attempts: 3,
    });
    return id;
  }),
}));

// Agent B owns backend/services/boltScheduleIdempotency.ts. This module imports
// the classifier from there and must NOT define its own; the mock stands in for
// B's implementation so this suite is independent of B's landing order.
jest.mock('../../services/boltScheduleIdempotency', () => ({
  isLiveQueueJobDuplicateViolation: (err: unknown) => {
    const message = err instanceof Error ? err.message : String((err as any)?.message ?? '');
    const lowered = message.toLowerCase();
    return (
      lowered.includes(LIVE_UNIQUE_INDEX) ||
      (lowered.includes('duplicate key value') && lowered.includes('queue_jobs'))
    );
  },
}));

function reset() {
  rows.length = 0;
  updatePayloads.length = 0;
  queueOps.add.length = 0;
  queueOps.removed.length = 0;
  failRemoveFor.clear();
  Object.keys(bullStates).forEach((k) => delete bullStates[k]);
  onGetJob = null;
  Object.keys(rpcResponses).forEach((k) => delete rpcResponses[k]);
  forcedUpdateError = null;
  liveUniqueIndexActive = true;
  failQueueAdd = false;
}

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function control() {
  return import('../../scheduler/schedulerPostQueueControl');
}

describe('queue_jobs cancellation — deployed schema', () => {
  beforeEach(() => {
    afterSelect = null;
    jest.clearAllMocks();
    reset();
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────
  test('cancellation actually transitions the row to cancelled', async () => {
    rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
    const { cancelScheduledPostQueueEntry } = await control();

    const result = await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });

    expect(result.errors).toEqual([]);
    expect(result.db_cancelled).toBe(1);
    expect(rows[0].status).toBe('cancelled');
    // The reason lands in the one deployed free-text terminal column.
    expect(rows[0].error_message).toBe('user_unscheduled');
    // The transition time lands in updated_at — the window key every queue
    // dashboard filters on.
    expect(typeof rows[0].updated_at).toBe('string');
    expect(Number.isNaN(Date.parse(rows[0].updated_at as string))).toBe(false);
    // error_code is a FAILURE classification and must stay NULL: the
    // super-admin health summary aggregates it across all statuses.
    expect(rows[0].error_code ?? null).toBeNull();
    // BullMQ peer removed.
    expect(queueOps.removed).toEqual(['qj-1']);
  });

  test('a row that reached a terminal state mid-flight is NOT stomped to cancelled', async () => {
    // `pendingIds` comes from a SELECT that has already returned. A worker can
    // pick the row up and finish publishing before the UPDATE lands. Without a
    // status predicate on the UPDATE, that row — now 'completed' — would be
    // relabelled 'cancelled' and have its error_message overwritten, erasing
    // the record of a publish that actually happened.
    rows.push({ id: 'qj-live', scheduled_post_id: 'sp-1', status: 'pending' });
    rows.push({ id: 'qj-won', scheduled_post_id: 'sp-1', status: 'pending' });
    const { cancelScheduledPostQueueEntry } = await control();
    const won = rows.find((r) => r.id === 'qj-won')!;

    // Both rows are live when the SELECT runs, so both land in the id list.
    // qj-won then finishes publishing in the window before the UPDATE — which
    // is the only way to reach the guard at all.
    afterSelect = () => {
      won.status = 'completed';
      won.error_message = null;
    };

    const result = await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });

    expect(rows.find((r) => r.id === 'qj-live')!.status).toBe('cancelled');
    // The winner is untouched: status preserved, reason NOT overwritten.
    expect(won.status).toBe('completed');
    expect(won.error_message ?? null).toBeNull();
    // And the count reflects what actually changed, not what was selected.
    expect(result.db_cancelled).toBe(1);
    // The winner's executor must never be removed on the strength of a
    // cancellation that did not apply to it.
    expect(queueOps.removed).not.toContain('qj-won');
  });

  test('db_cancelled reflects affected rows, so a zero-effect cancel cannot unhook an executor', async () => {
    // If the count came from the pre-read id list, a cancel that matched
    // nothing would still report success and pass the removal gate — which is
    // exactly how an executor gets destroyed while its authority stays live.
    rows.push({ id: 'qj-done', scheduled_post_id: 'sp-1', status: 'pending' });
    const { cancelScheduledPostQueueEntry } = await control();

    // Live at SELECT time, terminal by the time the UPDATE lands.
    afterSelect = () => { rows[0].status = 'completed'; };

    const result = await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });

    expect(result.db_cancelled).toBe(0);
    expect(queueOps.removed).toEqual([]);
  });

  test('cancellation is idempotent and leaves already-cancelled rows alone', async () => {
    rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'cancelled', error_message: 'first' });
    const { cancelScheduledPostQueueEntry } = await control();

    const result = await cancelScheduledPostQueueEntry('sp-1', { reason: 'second' });

    expect(result.db_cancelled).toBe(0);
    expect(result.errors).toEqual([]);
    expect(rows[0].error_message).toBe('first');
  });

  test('a failed DB cancel does NOT delete the BullMQ job that would publish the row', async () => {
    // The stranding mechanism: removal used to run regardless, so a rejected
    // UPDATE left a 'pending' row whose executor had been deleted — nothing
    // would ever publish it. Production still holds two such rows.
    rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
    forcedUpdateError = { code: '55P03', message: 'lock not available' };
    const { cancelScheduledPostQueueEntry } = await control();

    const result = await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });

    expect(result.db_cancelled).toBe(0);
    expect(result.errors.join(' ')).toContain('lock not available');
    expect(rows[0].status).toBe('pending');
    // The BullMQ peer survives, so the post still publishes at the old time —
    // wrong time, but visible and recoverable, rather than silently lost.
    expect(queueOps.removed).toEqual([]);
    expect(result.queue_removed).toBe(0);
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  test('every queue_jobs UPDATE names only columns that exist in production', async () => {
    rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
    const { cancelScheduledPostQueueEntry } = await control();
    await cancelScheduledPostQueueEntry('sp-1', { reason: 'schema_check' });

    expect(updatePayloads.length).toBeGreaterThan(0);
    for (const payload of updatePayloads) {
      const offending = Object.keys(payload).filter((k) => !DEPLOYED_QUEUE_JOBS_COLUMNS.includes(k));
      expect(offending).toEqual([]);
    }
    // Explicitly: the two columns that caused the outage.
    for (const payload of updatePayloads) {
      expect(Object.keys(payload)).not.toContain('completed_at');
      expect(Object.keys(payload)).not.toContain('last_error');
    }
  });

  // Closure-008 B1: a restore now happens ONLY when the prior BullMQ job
  // survived the cancel (here: its removal failed) — so this test makes it
  // survive, and still checks the restore UPDATE's columns.
  test('the rollback UPDATE also names only columns that exist', async () => {
    rpcResponses['try_scheduled_post_lock'] = true;
    rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
    failRemoveFor.add('qj-1');
    const { atomicCancelAndReEnqueueScheduledPost } = await control();

    // Force the enqueue to fail so the rollback branch runs. An INSERT clash is
    // classified as 'duplicate' rather than a failure, so the failure has to
    // come from the BullMQ side, after the queue_jobs row was created.
    failQueueAdd = true;

    const result = await atomicCancelAndReEnqueueScheduledPost({
      scheduledPostId: 'sp-1',
      userId: 'u-1',
      socialAccountId: 'sa-1',
      newScheduledFor: FUTURE(),
      reason: 'atomic_reschedule',
    });

    expect(result.enqueue).toBe('failed');
    expect(result.rollback).toBe('restored');
    for (const payload of updatePayloads) {
      const offending = Object.keys(payload).filter((k) => !DEPLOYED_QUEUE_JOBS_COLUMNS.includes(k));
      expect(offending).toEqual([]);
    }
    // The prior job is live again AND its BullMQ job still exists to run it.
    expect(rows.find((r) => r.id === 'qj-1')!.status).toBe('pending');
    expect(queueOps.removed).not.toContain('qj-1');
  });

  // ── Closure-008 B1: the rollback never fabricates a live row ─────────────
  describe('guarded rollback (Closure-008 B1)', () => {
    const reschedule = async () => {
      const { atomicCancelAndReEnqueueScheduledPost } = await control();
      return atomicCancelAndReEnqueueScheduledPost({
        scheduledPostId: 'sp-1', userId: 'u-1', socialAccountId: 'sa-1', newScheduledFor: FUTURE(), reason: 'atomic_reschedule',
      });
    };
    const live = () => rows.filter((r) => r.scheduled_post_id === 'sp-1' && LIVE_STATUSES.includes(r.status));

    beforeEach(() => {
      rpcResponses['try_scheduled_post_lock'] = true;
      failQueueAdd = true;
    });

    test('the cancel removed the BullMQ job: NOT restored — no live row is left with nothing to run it', async () => {
      rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
      const result = await reschedule();
      expect(result).toMatchObject({ ok: false, enqueue: 'failed', rollback: 'skipped', rollback_reason: 'bullmq_job_removed' });
      expect(rows.find((r) => r.id === 'qj-1')!.status).toBe('cancelled');
      expect(queueOps.removed).toContain('qj-1');
      // Nothing live blocks the safety-net cron from enqueueing the post at its new time.
      expect(live()).toEqual([]);
    });

    test('the failed enqueue\'s own new row is retired, not left pending without a job', async () => {
      rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
      await reschedule();
      const created = rows.filter((r) => r.id.startsWith('qj-new-'));
      expect(created).toHaveLength(1);
      expect(created[0].status).toBe('cancelled');
      expect(String(created[0].error_message)).toMatch(/^enqueue_failed:/);
    });

    test('a row that was PROCESSING is never restored (a worker owned it; the call may have started)', async () => {
      rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'processing' });
      failRemoveFor.add('qj-1'); // an active job cannot be removed — it survives
      bullStates['qj-1'] = 'active';
      const result = await reschedule();
      expect(result).toMatchObject({ rollback: 'skipped', rollback_reason: 'prior_job_was_processing' });
      expect(rows.find((r) => r.id === 'qj-1')!.status).toBe('cancelled');
    });

    test.each(['completed', 'failed', 'active'])('a surviving BullMQ job in state %s is not runnable: NOT restored', async (state) => {
      rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
      failRemoveFor.add('qj-1');
      bullStates['qj-1'] = state;
      const result = await reschedule();
      expect(result).toMatchObject({ rollback: 'skipped', rollback_reason: `bullmq_job_not_runnable:${state}` });
      expect(rows.find((r) => r.id === 'qj-1')!.status).toBe('cancelled');
      expect(live()).toEqual([]);
    });

    /** Fires `act` on the restore's getJob(qj-1) — the second one; the cancel's removal is the first. */
    const onRestoreLookup = (act: () => void) => {
      let seen = 0;
      onGetJob = (id) => { if (id === 'qj-1' && ++seen === 2) act(); };
    };

    test('the row moved on (a worker completed it) before the restore: the newer state is NOT overwritten', async () => {
      rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
      failRemoveFor.add('qj-1');
      onRestoreLookup(() => { rows.find((r) => r.id === 'qj-1')!.status = 'completed'; });
      const result = await reschedule();
      expect(result).toMatchObject({ rollback: 'skipped', rollback_reason: 'queue_job_state_changed' });
      expect(rows.find((r) => r.id === 'qj-1')!.status).toBe('completed');
    });

    test('a job captured while awaiting a BullMQ retry is restored to failed, not pending', async () => {
      rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'failed', retry_state: 'awaiting_retry' });
      failRemoveFor.add('qj-1');
      const result = await reschedule();
      expect(result.rollback).toBe('restored');
      expect(rows.find((r) => r.id === 'qj-1')!.status).toBe('failed');
    });

    test('a restore write that errors is reported as failed, never as restored', async () => {
      rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
      failRemoveFor.add('qj-1');
      onRestoreLookup(() => { forcedUpdateError = { message: 'connection reset' }; });
      const result = await reschedule();
      expect(result.rollback).toBe('failed');
      expect(result.rollback_reason).toContain('connection reset');
      expect(rows.find((r) => r.id === 'qj-1')!.status).toBe('cancelled');
    });

    test('an enqueue that fails with NO prior job reports rollback not_needed, never "attempted"', async () => {
      const result = await reschedule();
      expect(result).toMatchObject({ ok: false, enqueue: 'failed', rollback: 'not_needed' });
    });
  });

  // ── Closure-008 B3: a 'duplicate' after our cancel is success only at OUR time ─
  describe('duplicate after cancel (Closure-008 B3)', () => {
    const NEW_FOR = '2031-05-05T05:00:00.000Z';
    const OTHER_FOR = '2031-06-06T06:00:00.000Z';
    const run = async () => {
      const { atomicCancelAndReEnqueueScheduledPost } = await control();
      return atomicCancelAndReEnqueueScheduledPost({
        scheduledPostId: 'sp-1', userId: 'u-1', socialAccountId: 'sa-1', newScheduledFor: NEW_FOR, reason: 'atomic_reschedule',
      });
    };
    /** A concurrent reschedule inserts its live row in the gap after our cancel (the lock is no exclusion). */
    const concurrentInsertAt = (scheduledFor: string) => {
      onGetJob = (id) => {
        if (id === 'qj-old' && !rows.some((r) => r.id === 'qj-concurrent')) {
          rows.push({ id: 'qj-concurrent', scheduled_post_id: 'sp-1', status: 'pending', scheduled_for: scheduledFor });
        }
      };
    };

    beforeEach(() => {
      rpcResponses['try_scheduled_post_lock'] = true;
      rows.push({ id: 'qj-old', scheduled_post_id: 'sp-1', status: 'pending', scheduled_for: '2030-01-01T00:00:00.000Z' });
    });

    test('the surviving live job is for ANOTHER time: ok:false (was ok:true — a false success)', async () => {
      concurrentInsertAt(OTHER_FOR);
      const result = await run();
      expect(result).toMatchObject({ ok: false, enqueue: 'duplicate', duplicate_conflict: 'live_job_for_another_time' });
      expect(queueOps.add).toEqual([]);
    });

    test('an identical concurrent reschedule (same time) is still success', async () => {
      concurrentInsertAt(NEW_FOR);
      const result = await run();
      expect(result).toMatchObject({ ok: true, enqueue: 'duplicate' });
      expect(result.duplicate_conflict).toBeUndefined();
    });
  });

  // ── Closure-008 B4: a processing row whose platform call started is not "cancelled" ─
  describe('cancelling processing rows (Closure-008 B4)', () => {
    const cancel = async () => (await control()).cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });

    test('a job cancelled before execution (pending): cancelled, BullMQ job removed', async () => {
      rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
      const result = await cancel();
      expect(result).toMatchObject({ db_cancelled: 1, queue_removed: 1 });
      expect(result.call_started_not_cancelled).toBeUndefined();
      expect(rows[0].status).toBe('cancelled');
    });

    test('a job already processing, platform call NOT started: cancelled (the worker aborts before any call)', async () => {
      rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'processing', metadata: { other: 1 } });
      const result = await cancel();
      expect(result.db_cancelled).toBe(1);
      expect(rows[0].status).toBe('cancelled');
    });

    test('a processing job whose platform call STARTED is left to its worker: not cancelled, not removed, reported', async () => {
      rows.push({
        id: 'qj-1', scheduled_post_id: 'sp-1', status: 'processing',
        metadata: { platform_call: { started_at: '2030-01-01T00:00:00.000Z' } },
      });
      const result = await cancel();
      expect(result.db_cancelled).toBe(0);
      expect(result.queue_removed).toBe(0);
      expect(result.call_started_not_cancelled).toEqual(['qj-1']);
      expect(rows[0].status).toBe('processing');
      expect(queueOps.removed).toEqual([]);
    });

    test('a reschedule meeting a call-started job does NOT enqueue a replacement (ok:false)', async () => {
      rpcResponses['try_scheduled_post_lock'] = true;
      rows.push({
        id: 'qj-1', scheduled_post_id: 'sp-1', status: 'processing',
        metadata: { platform_call: { started_at: '2030-01-01T00:00:00.000Z' } },
      });
      const { atomicCancelAndReEnqueueScheduledPost } = await control();
      const result = await atomicCancelAndReEnqueueScheduledPost({
        scheduledPostId: 'sp-1', userId: 'u-1', socialAccountId: 'sa-1', newScheduledFor: FUTURE(), reason: 'atomic_reschedule',
      });
      expect(result).toMatchObject({ ok: false, enqueue: 'failed' });
      expect(queueOps.add).toEqual([]);
      expect(rows.find((r) => r.id === 'qj-1')!.status).toBe('processing');
    });

    test('a stale job whose row already reached a terminal state is untouched', async () => {
      rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'completed', metadata: { platform_call: { started_at: 'x' } } });
      const result = await cancel();
      expect(result).toMatchObject({ db_cancelled: 0, queue_removed: 0 });
      expect(rows[0].status).toBe('completed');
    });
  });

  test('the module-exported column list matches the deployed schema', async () => {
    expect([...QUEUE_JOBS_COLUMNS].sort()).toEqual([...DEPLOYED_QUEUE_JOBS_COLUMNS].sort());
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  test('atomicCancelAndReEnqueue cancels the old live row AND creates the replacement', async () => {
    rpcResponses['try_scheduled_post_lock'] = true;
    rows.push({ id: 'qj-old', scheduled_post_id: 'sp-1', status: 'pending', scheduled_for: '2020-01-01T00:00:00.000Z' });
    const newFor = FUTURE();
    const { atomicCancelAndReEnqueueScheduledPost } = await control();

    const result = await atomicCancelAndReEnqueueScheduledPost({
      scheduledPostId: 'sp-1',
      userId: 'u-1',
      socialAccountId: 'sa-1',
      newScheduledFor: newFor,
      reason: 'reschedule_retime',
    });

    expect(result.ok).toBe(true);
    expect(result.locked).toBe(true);
    expect(result.enqueue).toBe('enqueued');
    expect(result.cancel.db_cancelled).toBe(1);

    const old = rows.find((r) => r.id === 'qj-old')!;
    expect(old.status).toBe('cancelled');
    expect(old.error_message).toBe('reschedule_retime');

    const live = rows.filter((r) => LIVE_STATUSES.includes(r.status));
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe('qj-old');
    expect(live[0].scheduled_for).toBe(newFor);
    expect(queueOps.add).toHaveLength(1);
  });

  test('re-enqueue is refused when the cancel did not take effect', async () => {
    rpcResponses['try_scheduled_post_lock'] = true;
    rows.push({ id: 'qj-old', scheduled_post_id: 'sp-1', status: 'pending' });
    // The cancel UPDATE fails at the database.
    forcedUpdateError = { code: '55P03', message: 'lock not available' };
    const { atomicCancelAndReEnqueueScheduledPost } = await control();

    const result = await atomicCancelAndReEnqueueScheduledPost({
      scheduledPostId: 'sp-1',
      userId: 'u-1',
      socialAccountId: 'sa-1',
      newScheduledFor: FUTURE(),
      reason: 'reschedule_retime',
    });

    expect(result.ok).toBe(false);
    expect(result.enqueue).toBe('failed');
    expect(result.cancel.db_cancelled).toBe(0);
    // No replacement row, no second BullMQ job — the old job is still live and
    // a second one would be a double publish.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(queueOps.add).toHaveLength(0);
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────
  test('ordinary retry bookkeeping is untouched by cancellation', async () => {
    rows.push({
      id: 'qj-1',
      scheduled_post_id: 'sp-1',
      status: 'processing',
      attempts: 2,
      max_attempts: 3,
      next_retry_at: '2030-01-01T00:00:00.000Z',
    });
    const { cancelScheduledPostQueueEntry } = await control();
    await cancelScheduledPostQueueEntry('sp-1', { reason: 'atomic_reschedule' });

    const row = rows[0];
    expect(row.status).toBe('cancelled');
    // The cancel must not rewrite the retry policy columns.
    expect(row.attempts).toBe(2);
    expect(row.max_attempts).toBe(3);
    expect(row.next_retry_at).toBe('2030-01-01T00:00:00.000Z');
    for (const payload of updatePayloads) {
      expect(Object.keys(payload)).not.toContain('attempts');
      expect(Object.keys(payload)).not.toContain('max_attempts');
      expect(Object.keys(payload)).not.toContain('next_retry_at');
    }
  });

  test('cancellation touches only the target post and only its live rows', async () => {
    rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
    rows.push({ id: 'qj-2', scheduled_post_id: 'sp-2', status: 'pending' });
    rows.push({ id: 'qj-3', scheduled_post_id: 'sp-1', status: 'completed' });
    const { cancelScheduledPostQueueEntry } = await control();
    await cancelScheduledPostQueueEntry('sp-1', { reason: 'user_unscheduled' });

    expect(rows.find((r) => r.id === 'qj-1')!.status).toBe('cancelled');
    expect(rows.find((r) => r.id === 'qj-2')!.status).toBe('pending');
    expect(rows.find((r) => r.id === 'qj-3')!.status).toBe('completed');
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────
  test('a terminal failed row does not block a fresh enqueue', async () => {
    rows.push({ id: 'qj-failed', scheduled_post_id: 'sp-1', status: 'failed', error_message: 'PROVIDER_TIMEOUT' });
    const { enqueueScheduledPostAt } = await control();

    const outcome = await enqueueScheduledPostAt('sp-1', 'u-1', 'sa-1', FUTURE());

    expect(outcome).toBe('enqueued');
    expect(rows.filter((r) => LIVE_STATUSES.includes(r.status))).toHaveLength(1);
    expect(queueOps.add).toHaveLength(1);
  });

  test('a cancelled row does not block a fresh enqueue', async () => {
    rows.push({ id: 'qj-cancelled', scheduled_post_id: 'sp-1', status: 'cancelled', error_message: 'user_unscheduled' });
    const { enqueueScheduledPostAt } = await control();

    expect(await enqueueScheduledPostAt('sp-1', 'u-1', 'sa-1', FUTURE())).toBe('enqueued');
  });

  // ── 6 ─────────────────────────────────────────────────────────────────────
  test('a live row is reported as duplicate by the read guard, with no insert', async () => {
    rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
    const { enqueueScheduledPostAt } = await control();

    expect(await enqueueScheduledPostAt('sp-1', 'u-1', 'sa-1', FUTURE())).toBe('duplicate');
    expect(rows).toHaveLength(1);
    expect(queueOps.add).toHaveLength(0);
  });

  test('a concurrent second live job rejected by the unique index returns duplicate, not a throw', async () => {
    const { enqueueScheduledPostAt } = await control();
    const { createQueueJob } = await import('../../db/queries');

    // Simulate the interleaving the read guard cannot serialise: both SELECTs
    // observe no live row, then the index rejects the second INSERT.
    (createQueueJob as jest.Mock).mockImplementationOnce(async () => {
      throw new Error(
        `Failed to create queue job: duplicate key value violates unique constraint "${LIVE_UNIQUE_INDEX}"`,
      );
    });

    const outcome = await enqueueScheduledPostAt('sp-1', 'u-1', 'sa-1', FUTURE());

    expect(outcome).toBe('duplicate');
    // Crucially no BullMQ job: it would be an orphan with no queue_jobs row.
    expect(queueOps.add).toHaveLength(0);
  });

  test('a non-duplicate insert failure still propagates', async () => {
    const { enqueueScheduledPostAt } = await control();
    const { createQueueJob } = await import('../../db/queries');
    (createQueueJob as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('Failed to create queue job: connection reset');
    });

    await expect(enqueueScheduledPostAt('sp-1', 'u-1', 'sa-1', FUTURE())).rejects.toThrow('connection reset');
    expect(queueOps.add).toHaveLength(0);
  });

  test('the read guard fails closed when the duplicate lookup is unusable', async () => {
    // Two live rows make .maybeSingle() error — duplicate status is UNKNOWN.
    rows.push({ id: 'qj-1', scheduled_post_id: 'sp-1', status: 'pending' });
    rows.push({ id: 'qj-2', scheduled_post_id: 'sp-1', status: 'pending' });
    const { enqueueScheduledPostAt } = await control();

    await expect(enqueueScheduledPostAt('sp-1', 'u-1', 'sa-1', FUTURE())).rejects.toThrow(/duplicate check/i);
    expect(queueOps.add).toHaveLength(0);
  });
});
