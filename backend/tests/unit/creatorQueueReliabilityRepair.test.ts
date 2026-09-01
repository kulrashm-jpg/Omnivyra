/**
 * Phase 161 — creatorQueueReliabilityService repair tests.
 *
 * The service used to write and read a `queue_jobs.last_error` column that
 * does not exist in the deployed database. PostgREST rejects the WHOLE
 * statement when an unknown column appears, so every cancellation UPDATE was
 * a silent no-op and the stuck-recovery SELECT returned an error the code
 * read as "no rows".
 *
 * The fake database below is therefore SCHEMA-STRICT: it knows the deployed
 * column list for `queue_jobs` and `creator_dead_letter_jobs` and returns a
 * PostgREST-shaped 42703 error for any unknown column in a SELECT list or an
 * UPDATE/INSERT payload. That makes "reintroduce the phantom column" a
 * BEHAVIOURAL failure here, not merely a compile failure.
 *
 * Every test drives the real exported functions.
 */

// ── deployed schema (authoritative probe of the live database) ─────────────
const QUEUE_JOB_COLUMNS = new Set([
  'id', 'scheduled_post_id', 'job_type', 'status', 'attempts', 'max_attempts',
  'scheduled_for', 'next_retry_at', 'error_message', 'metadata', 'created_at',
  'updated_at', 'priority', 'payload', 'result_data', 'error_code',
]);

const DLQ_COLUMNS = new Set([
  'id', 'scheduled_post_id', 'queue_job_id', 'failure_count', 'last_error_code',
  'last_error_message', 'first_failed_at', 'last_failed_at', 'status',
  'poisoned_reason', 'metadata', 'created_at', 'updated_at',
]);

const SCHEDULED_POST_COLUMNS = new Set([
  'id', 'user_id', 'company_id', 'campaign_id', 'platform', 'content',
  'scheduled_for', 'status', 'priority', 'error_code', 'error_message',
  'platform_post_id', 'post_url', 'published_at', 'is_thread_start',
  'metadata', 'created_at', 'updated_at',
]);

type Row = Record<string, any>;

let queueJobs: Row[] = [];
let dlqRows: Row[] = [];
let scheduledPosts: Row[] = [];
let bullJobs: Set<string> = new Set();
let removedExecutors: string[] = [];
/** Job ids whose `getJob` probe should THROW (Redis unreachable / errored). */
let bullProbeThrows: Set<string> = new Set();

/** Per-test error injection. Return a PostgREST-shaped error, or null. */
let onSelect: ((table: string, columns: string, filters: Record<string, any>) => any) | null = null;
let onWrite: ((table: string, payload: Row, filters: Record<string, any>) => any) | null = null;

/** Substitute the rows a SELECT returns (models a server-side filter the
 *  client did not get — proves the in-memory guards carry their own weight). */
let onSelectRows: ((table: string, columns: string, filters: Record<string, any>) => Row[] | null) | null = null;

/** Model the PostgREST reality that a valid UPDATE matching ZERO rows still
 *  returns `error === null`. Return true to succeed while changing nothing. */
let updateMatchesNothing: ((table: string, payload: Row, filters: Record<string, any>) => boolean) | null = null;

function columnsFor(table: string): Set<string> | null {
  if (table === 'queue_jobs') return QUEUE_JOB_COLUMNS;
  if (table === 'creator_dead_letter_jobs') return DLQ_COLUMNS;
  if (table === 'scheduled_posts') return SCHEDULED_POST_COLUMNS;
  return null;
}

function schemaError(table: string, names: string[]): any {
  const known = columnsFor(table);
  if (!known) return null;
  for (const name of names) {
    const clean = name.trim();
    if (!clean || clean === '*') continue;
    if (!known.has(clean)) {
      return { code: '42703', message: `column ${table}.${clean} does not exist` };
    }
  }
  return null;
}

function tableRows(table: string): Row[] {
  if (table === 'queue_jobs') return queueJobs;
  if (table === 'creator_dead_letter_jobs') return dlqRows;
  if (table === 'scheduled_posts') return scheduledPosts;
  return [];
}

function matches(row: Row, filters: Record<string, any>): boolean {
  for (const [key, value] of Object.entries(filters)) {
    if (key.endsWith('__lt')) {
      const field = key.slice(0, -4);
      if (!(row[field] && String(row[field]) < String(value))) return false;
    } else if (Array.isArray(value)) {
      if (!value.includes(row[key])) return false;
    } else if (row[key] !== value) {
      return false;
    }
  }
  return true;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const filters: Record<string, any> = {};
      let columns = '*';
      let limitN: number | null = null;
      let orderKey: string | null = null;
      let orderAsc = true;

      const settle = () => {
        const injected = onSelect ? onSelect(table, columns, filters) : null;
        if (injected) return { data: null, error: injected };
        const bad = schemaError(table, columns.split(','));
        if (bad) return { data: null, error: bad };
        const substituted = onSelectRows ? onSelectRows(table, columns, filters) : null;
        if (substituted) return { data: substituted.map((r) => ({ ...r })), error: null };
        let rows = tableRows(table).filter((r) => matches(r, filters));
        if (orderKey) {
          const key = orderKey;
          rows = [...rows].sort((a, b) => {
            const cmp = String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
            return orderAsc ? cmp : -cmp;
          });
        }
        if (limitN !== null) rows = rows.slice(0, limitN);
        return { data: rows.map((r) => ({ ...r })), error: null };
      };

      const api: any = {
        select: jest.fn((c?: string) => { if (c) columns = c; return api; }),
        eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
        in: jest.fn((k: string, v: any[]) => { filters[k] = v; return api; }),
        lt: jest.fn((k: string, v: any) => { filters[`${k}__lt`] = v; return api; }),
        gt: jest.fn(() => api),
        gte: jest.fn(() => api),
        order: jest.fn((k: string, o?: { ascending?: boolean }) => {
          orderKey = k;
          orderAsc = o?.ascending !== false;
          return api;
        }),
        limit: jest.fn((n: number) => { limitN = n; return api; }),
        maybeSingle: jest.fn(async () => {
          const res = settle();
          if (res.error) return res;
          return { data: (res.data as Row[])[0] ?? null, error: null };
        }),
        then: (resolve: any, reject: any) => Promise.resolve(settle()).then(resolve, reject),
      };
      return api;
    }),
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => {
    let payload: Row | null = null;
    const filters: Record<string, any> = {};

    const applyUpdate = () => {
      const injected = onWrite ? onWrite(table, payload as Row, filters) : null;
      if (injected) return { data: null, error: injected };
      const bad = schemaError(table, Object.keys(payload ?? {}));
      if (bad) return { data: null, error: bad };
      // A syntactically valid UPDATE that matches zero rows: no error, no change.
      if (updateMatchesNothing && updateMatchesNothing(table, payload as Row, filters)) {
        return { data: null, error: null };
      }
      for (const row of tableRows(table)) {
        if (matches(row, filters)) Object.assign(row, payload);
      }
      return { data: null, error: null };
    };

    const api: any = {
      insert: jest.fn(async (row: Row) => {
        const injected = onWrite ? onWrite(table, row, {}) : null;
        if (injected) return { data: null, error: injected };
        const bad = schemaError(table, Object.keys(row));
        if (bad) return { data: null, error: bad };
        const seeded = { id: `${table}-${tableRows(table).length + 1}`, ...row };
        tableRows(table).push(seeded);
        return { data: seeded, error: null };
      }),
      update: jest.fn((p: Row) => { payload = p; return api; }),
      eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
      in: jest.fn((k: string, v: any[]) => { filters[k] = v; return api; }),
      then: (resolve: any, reject: any) => Promise.resolve(applyUpdate()).then(resolve, reject),
    };
    return api;
  }),
}));

jest.mock('../../queue/bullmqClient', () => ({
  getQueue: jest.fn(() => ({
    getJob: jest.fn(async (id: string) => {
      if (bullProbeThrows.has(id)) throw new Error(`redis unreachable probing ${id}`);
      return bullJobs.has(id)
        ? { remove: async () => { bullJobs.delete(id); removedExecutors.push(id); } }
        : null;
    }),
    add: jest.fn(),
  })),
  getEngagementPollingQueue: jest.fn(() => ({ add: jest.fn() })),
}));

jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: {
    QUEUE_JOB_POISONED: 'queue_job_poisoned',
    QUEUE_DRIFT_DETECTED: 'queue_drift_detected',
  },
}));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));

const load = () => import('../../services/creatorQueueReliabilityService');

const ISO = (offsetMinutes: number) => new Date(Date.now() + offsetMinutes * 60_000).toISOString();

function seedQueueJob(row: Partial<Row> & { id: string }): Row {
  const full: Row = {
    scheduled_post_id: 'sp-1',
    job_type: 'publish',
    status: 'pending',
    attempts: 0,
    max_attempts: 3,
    next_retry_at: null,
    error_message: null,
    error_code: null,
    created_at: ISO(-600),
    updated_at: ISO(-600),
    ...row,
  };
  queueJobs.push(full);
  return full;
}

function seedScheduledPost(row: Partial<Row> & { id: string }): Row {
  const full: Row = {
    status: 'scheduled',
    platform: 'linkedin',
    created_at: ISO(-600),
    updated_at: ISO(-600),
    ...row,
  };
  scheduledPosts.push(full);
  return full;
}

const byId = (id: string) => queueJobs.find((r) => r.id === id) as Row;

beforeEach(() => {
  queueJobs = [];
  dlqRows = [];
  scheduledPosts = [];
  bullJobs = new Set();
  bullProbeThrows = new Set();
  removedExecutors = [];
  onSelect = null;
  onWrite = null;
  onSelectRows = null;
  updateMatchesNothing = null;
  jest.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// Schema conformance — the defect itself
// ───────────────────────────────────────────────────────────────────────────
describe('deployed-schema conformance', () => {
  test('reconciliation writes only columns that exist on queue_jobs', async () => {
    seedQueueJob({ id: 'a', status: 'pending', updated_at: ISO(-30) });
    seedQueueJob({ id: 'b', status: 'pending', updated_at: ISO(-10) });

    const q = await load();
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).resolves.toBe(1);
    // Would be a 42703 error (and therefore a throw) if a phantom column
    // were written or selected.
    expect(byId('a').status).toBe('cancelled');
  });

  test('stuck recovery reads and writes only columns that exist on queue_jobs', async () => {
    seedScheduledPost({ id: 'sp-1', status: 'scheduled' });
    seedQueueJob({ id: 'stale', status: 'processing', attempts: 1, updated_at: ISO(-60) });

    const q = await load();
    const result = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });
    expect(result.scanned).toBe(1);
    expect(result.recovered).toBe(1);
    expect(result.errors).toEqual([]);
  });

  test('cancellations leave error_code untouched so health aggregates are not polluted', async () => {
    // pages/api/super-admin/system-health-summary.ts::aggregateQueueStatus
    // buckets error_code across ALL statuses. Housekeeping must not inject one.
    seedQueueJob({ id: 'old', status: 'pending', updated_at: ISO(-30), error_code: null });
    seedQueueJob({ id: 'new', status: 'pending', updated_at: ISO(-5) });

    const q = await load();
    await q.reconcileDuplicateQueueJobs('sp-1');

    expect(byId('old').status).toBe('cancelled');
    expect(byId('old').error_message).toBe('duplicate_job_reconciliation');
    expect(byId('old').error_code).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// INVARIANT A — duplicate reconciliation
// ───────────────────────────────────────────────────────────────────────────
describe('reconcileDuplicateQueueJobs — invariant A', () => {
  test('the NEWEST live job survives and older live duplicates are cancelled', async () => {
    seedQueueJob({ id: 'oldest', status: 'pending', updated_at: ISO(-120) });
    seedQueueJob({ id: 'middle', status: 'processing', updated_at: ISO(-60) });
    seedQueueJob({ id: 'newest', status: 'pending', updated_at: ISO(-1) });

    const q = await load();
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).resolves.toBe(2);

    expect(byId('newest').status).toBe('pending');   // winner is never cancelled
    expect(byId('oldest').status).toBe('cancelled');
    expect(byId('middle').status).toBe('cancelled');
  });

  test('terminal historical rows are never candidates and are never touched', async () => {
    seedQueueJob({ id: 'done', status: 'completed', updated_at: ISO(-5), error_message: null });
    seedQueueJob({ id: 'dead', status: 'failed', updated_at: ISO(-4), error_message: 'boom' });
    seedQueueJob({ id: 'gone', status: 'cancelled', updated_at: ISO(-3) });
    seedQueueJob({ id: 'live', status: 'pending', updated_at: ISO(-120) });

    const q = await load();
    // Exactly one LIVE row → nothing to collapse, even though 4 rows exist.
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).resolves.toBe(0);

    expect(byId('done').status).toBe('completed');
    expect(byId('dead').status).toBe('failed');
    expect(byId('dead').error_message).toBe('boom');
    expect(byId('gone').status).toBe('cancelled');
    expect(byId('live').status).toBe('pending');
  });

  test('a lookup failure FAILS CLOSED and is distinguishable from an empty result', async () => {
    const q = await load();

    // Empty result: resolves with 0, nothing thrown.
    await expect(q.reconcileDuplicateQueueJobs('sp-empty')).resolves.toBe(0);

    // DB failure: must NOT read as "nothing to do".
    seedQueueJob({ id: 'x', status: 'pending', updated_at: ISO(-30) });
    seedQueueJob({ id: 'y', status: 'pending', updated_at: ISO(-10) });
    onSelect = () => ({ code: '08006', message: 'connection reset' });
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).rejects.toThrow(/connection reset/);

    onSelect = null;
    expect(byId('x').status).toBe('pending');
    expect(byId('y').status).toBe('pending');
  });

  test('a cancel-UPDATE failure throws and destroys NO executor', async () => {
    seedQueueJob({ id: 'loser', status: 'pending', updated_at: ISO(-30) });
    seedQueueJob({ id: 'winner', status: 'pending', updated_at: ISO(-5) });
    bullJobs.add('loser');
    bullJobs.add('winner');

    onWrite = () => ({ code: '55P03', message: 'lock not available' });

    const q = await load();
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).rejects.toThrow(/lock not available/);

    // The DB authority is still live, so the executor must survive.
    expect(removedExecutors).toEqual([]);
    expect(bullJobs.has('loser')).toBe(true);
  });

  test('executors are destroyed ONLY for rows the DB confirms are dead', async () => {
    seedQueueJob({ id: 'loser', status: 'pending', updated_at: ISO(-30) });
    seedQueueJob({ id: 'winner', status: 'pending', updated_at: ISO(-5) });
    bullJobs.add('loser');
    bullJobs.add('winner');

    const q = await load();
    await q.reconcileDuplicateQueueJobs('sp-1');

    expect(removedExecutors).toEqual(['loser']);
    expect(bullJobs.has('winner')).toBe(true);
  });

  test('an unverifiable cancel is NOT reported as a collapse and unhooks nothing', async () => {
    seedQueueJob({ id: 'loser', status: 'pending', updated_at: ISO(-30) });
    seedQueueJob({ id: 'winner', status: 'pending', updated_at: ISO(-5) });
    bullJobs.add('loser');

    let selects = 0;
    onSelect = () => {
      selects++;
      // 1st = candidate lookup (succeeds). 2nd = persistence read-back (fails).
      return selects >= 2 ? { code: '08006', message: 'confirm lookup down' } : null;
    };

    const q = await load();
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).rejects.toThrow(/confirm lookup down/);

    onSelect = null;
    // Death was never PROVEN → executor untouched.
    expect(removedExecutors).toEqual([]);
    expect(bullJobs.has('loser')).toBe(true);
  });

  test('a zero-row UPDATE (error===null, nothing changed) is reported as ZERO collapsed', async () => {
    // The production symptom: the service reported collapsing duplicates while
    // the database recorded no cancellations at all. `error === null` from
    // PostgREST does NOT mean a row was affected.
    seedQueueJob({ id: 'loser-1', status: 'pending', updated_at: ISO(-40) });
    seedQueueJob({ id: 'loser-2', status: 'pending', updated_at: ISO(-30) });
    seedQueueJob({ id: 'winner', status: 'pending', updated_at: ISO(-5) });
    bullJobs.add('loser-1');
    bullJobs.add('loser-2');

    updateMatchesNothing = (table) => table === 'queue_jobs';

    const q = await load();
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).resolves.toBe(0);

    updateMatchesNothing = null;
    expect(byId('loser-1').status).toBe('pending');
    expect(byId('loser-2').status).toBe('pending');
    // Nothing died, so no executor may be destroyed.
    expect(removedExecutors).toEqual([]);
    expect(bullJobs.has('loser-1')).toBe(true);
    expect(bullJobs.has('loser-2')).toBe(true);
  });

  test('a PARTIALLY persisted cancel reports only the rows that actually landed', async () => {
    seedQueueJob({ id: 'loser-1', status: 'pending', updated_at: ISO(-40) });
    seedQueueJob({ id: 'loser-2', status: 'pending', updated_at: ISO(-30) });
    seedQueueJob({ id: 'winner', status: 'pending', updated_at: ISO(-5) });
    bullJobs.add('loser-1');
    bullJobs.add('loser-2');

    // Only loser-1 actually flips; loser-2 stays live (e.g. a concurrent write).
    onSelectRows = (table, columns) => {
      if (table === 'queue_jobs' && columns === 'id, status') {
        return [
          { id: 'loser-1', status: 'cancelled' },
          { id: 'loser-2', status: 'pending' },
        ];
      }
      return null;
    };

    const q = await load();
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).resolves.toBe(1);

    onSelectRows = null;
    expect(removedExecutors).toEqual(['loser-1']);
    expect(bullJobs.has('loser-2')).toBe(true); // still live → still hooked up
  });

  test('a terminal row handed back by a lax SELECT is still never cancelled', async () => {
    // Proves the in-memory live-status guard carries its own weight and does
    // not merely trust the server-side filter.
    seedQueueJob({ id: 'done', status: 'completed', updated_at: ISO(-1), error_message: null });
    seedQueueJob({ id: 'live-old', status: 'pending', updated_at: ISO(-40) });
    seedQueueJob({ id: 'live-new', status: 'pending', updated_at: ISO(-10) });

    onSelectRows = (table, columns) => {
      if (table === 'queue_jobs' && columns.startsWith('id, status, updated_at')) {
        // A server that ignored `.in('status', …)` — returns the terminal row too.
        return queueJobs.map((r) => ({ ...r }));
      }
      return null;
    };

    const q = await load();
    const collapsed = await q.reconcileDuplicateQueueJobs('sp-1');

    onSelectRows = null;
    expect(collapsed).toBe(1);           // only live-old
    expect(byId('done').status).toBe('completed');
    expect(byId('done').error_message).toBeNull();
    expect(byId('live-new').status).toBe('pending');
    expect(byId('live-old').status).toBe('cancelled');
  });

  test('reconciliation converges and a repeat pass is a no-op', async () => {
    seedQueueJob({ id: 'a', status: 'pending', updated_at: ISO(-120) });
    seedQueueJob({ id: 'b', status: 'pending', updated_at: ISO(-60) });
    seedQueueJob({ id: 'c', status: 'pending', updated_at: ISO(-5) });

    const q = await load();
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).resolves.toBe(2);

    const afterFirst = queueJobs.map((r) => `${r.id}:${r.status}`).sort();
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).resolves.toBe(0);
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).resolves.toBe(0);

    expect(queueJobs.map((r) => `${r.id}:${r.status}`).sort()).toEqual(afterFirst);
    expect(byId('c').status).toBe('pending');
  });

  test('a single live job is left completely alone', async () => {
    seedQueueJob({ id: 'solo', status: 'processing', updated_at: ISO(-5) });
    bullJobs.add('solo');

    const q = await load();
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).resolves.toBe(0);

    expect(byId('solo').status).toBe('processing');
    expect(byId('solo').error_message).toBeNull();
    expect(removedExecutors).toEqual([]);
  });

  test('identical updated_at still converges on exactly one deterministic winner', async () => {
    const same = ISO(-30);
    seedQueueJob({ id: 'aaa', status: 'pending', updated_at: same, created_at: same });
    seedQueueJob({ id: 'bbb', status: 'pending', updated_at: same, created_at: same });
    seedQueueJob({ id: 'ccc', status: 'pending', updated_at: same, created_at: same });

    const q = await load();
    await expect(q.reconcileDuplicateQueueJobs('sp-1')).resolves.toBe(2);

    const live = queueJobs.filter((r) => r.status === 'pending' || r.status === 'processing');
    expect(live).toHaveLength(1);

    await expect(q.reconcileDuplicateQueueJobs('sp-1')).resolves.toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// INVARIANT B — stuck recovery
// ───────────────────────────────────────────────────────────────────────────
describe('recoverStuckProcessingJobs — invariant B', () => {
  test('only genuinely stale processing rows are recovered; fresh ones are untouched', async () => {
    seedScheduledPost({ id: 'sp-1', status: 'scheduled' });
    seedQueueJob({ id: 'stale', status: 'processing', attempts: 1, updated_at: ISO(-60) });
    seedQueueJob({ id: 'fresh', status: 'processing', attempts: 1, updated_at: ISO(-2) });
    seedQueueJob({ id: 'queued', status: 'pending', attempts: 0, updated_at: ISO(-600) });

    const q = await load();
    const result = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });

    expect(result.scanned).toBe(1);
    expect(result.recovered).toBe(1);

    // TERMINAL disposition — never 'pending'. `pending` has no consumer and
    // would both block re-enqueue and destroy publishProcessor's replay guard.
    expect(byId('stale').status).toBe('cancelled');
    expect(byId('stale').attempts).toBe(2);
    expect(byId('stale').error_message).toBe('stuck_processing_recovered');

    expect(byId('fresh').status).toBe('processing');
    expect(byId('fresh').attempts).toBe(1);
    expect(byId('fresh').error_message).toBeNull();

    expect(byId('queued').status).toBe('pending');
    expect(byId('queued').attempts).toBe(0);
  });

  test('a released claim is NEVER written back to pending', async () => {
    seedScheduledPost({ id: 'sp-1', status: 'scheduled' });
    seedQueueJob({ id: 'stale', status: 'processing', attempts: 1, updated_at: ISO(-60) });

    const q = await load();
    await q.recoverStuckProcessingJobs({ staleMinutes: 15 });

    // Nothing may leave this row in the scheduler's live suppression set.
    expect(byId('stale').status).not.toBe('pending');
    expect(byId('stale').status).not.toBe('processing');
    expect(['cancelled', 'failed']).toContain(byId('stale').status);
  });

  test('the orphaned executor is unhooked once the release is read back', async () => {
    seedScheduledPost({ id: 'sp-1', status: 'scheduled' });
    seedQueueJob({ id: 'stale', status: 'processing', attempts: 1, updated_at: ISO(-60) });
    bullJobs.add('stale');

    const q = await load();
    await q.recoverStuckProcessingJobs({ staleMinutes: 15 });

    expect(byId('stale').status).toBe('cancelled');
    expect(removedExecutors).toEqual(['stale']);
  });

  test('a lookup failure FAILS CLOSED and is distinguishable from "nothing found"', async () => {
    const q = await load();

    // Genuinely nothing stuck: resolves, does not throw.
    await expect(q.recoverStuckProcessingJobs({ staleMinutes: 15 })).resolves.toEqual({
      scanned: 0, recovered: 0, routed_to_dlq: 0, skipped_live: 0, errors: [],
    });

    seedQueueJob({ id: 'stale', status: 'processing', attempts: 1, updated_at: ISO(-60) });
    onSelect = () => ({ code: '42703', message: 'column queue_jobs.last_error does not exist' });
    await expect(q.recoverStuckProcessingJobs({ staleMinutes: 15 })).rejects.toThrow(/does not exist/);

    onSelect = null;
    expect(byId('stale').status).toBe('processing');
  });

  test('a failed recovery UPDATE is never counted as recovered', async () => {
    seedQueueJob({ id: 'stale', status: 'processing', attempts: 1, updated_at: ISO(-60) });
    onWrite = () => ({ code: '55P03', message: 'row is locked' });

    const q = await load();
    const result = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });

    expect(result.scanned).toBe(1);
    expect(result.recovered).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/row is locked/);

    onWrite = null;
    expect(byId('stale').status).toBe('processing');
    expect(byId('stale').attempts).toBe(1);
  });

  test('recovery is idempotent — a second pass finds nothing left to do', async () => {
    seedScheduledPost({ id: 'sp-1', status: 'scheduled' });
    seedQueueJob({ id: 'stale', status: 'processing', attempts: 1, updated_at: ISO(-60) });

    const q = await load();
    const first = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });
    expect(first.recovered).toBe(1);

    const second = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });
    expect(second.scanned).toBe(0);
    expect(second.recovered).toBe(0);

    const third = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });
    expect(third.recovered).toBe(0);

    expect(byId('stale').status).toBe('cancelled');
    expect(byId('stale').attempts).toBe(2); // incremented exactly once
  });

  test('a post still `publishing` inside the claim window is LIVE and is skipped', async () => {
    // The queue row looks stuck (processing, 60 min old) but the owning post
    // is mid-publish with a fresh claim. Touching it would cut a live publish.
    seedScheduledPost({ id: 'sp-live', status: 'publishing', updated_at: ISO(-2) });
    seedQueueJob({
      id: 'live-claim', scheduled_post_id: 'sp-live',
      status: 'processing', attempts: 1, updated_at: ISO(-60),
    });
    bullJobs.add('live-claim');

    const q = await load();
    const result = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });

    expect(result.scanned).toBe(1);
    expect(result.skipped_live).toBe(1);
    expect(result.recovered).toBe(0);
    expect(byId('live-claim').status).toBe('processing');
    expect(removedExecutors).toEqual([]);
  });

  test('a post `publishing` with a claim older than the window is genuinely abandoned', async () => {
    seedScheduledPost({ id: 'sp-dead', status: 'publishing', updated_at: ISO(-90) });
    seedQueueJob({
      id: 'dead-claim', scheduled_post_id: 'sp-dead',
      status: 'processing', attempts: 1, updated_at: ISO(-60),
    });

    const q = await load();
    const result = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });

    expect(result.skipped_live).toBe(0);
    expect(result.recovered).toBe(1);
    expect(byId('dead-claim').status).toBe('cancelled');
  });

  test('an unreadable scheduled_posts lookup FAILS CLOSED — no queue row is touched', async () => {
    seedScheduledPost({ id: 'sp-1', status: 'scheduled' });
    seedQueueJob({ id: 'stale', status: 'processing', attempts: 1, updated_at: ISO(-60) });
    bullJobs.add('stale');

    onSelect = (table) => (table === 'scheduled_posts' ? { code: '08006', message: 'posts lookup down' } : null);

    const q = await load();
    await expect(q.recoverStuckProcessingJobs({ staleMinutes: 15 })).rejects.toThrow(/posts lookup down/);

    onSelect = null;
    expect(byId('stale').status).toBe('processing');
    expect(removedExecutors).toEqual([]);
  });

  test('a release that does not persist is never counted as recovered', async () => {
    seedScheduledPost({ id: 'sp-1', status: 'scheduled' });
    seedQueueJob({ id: 'stale', status: 'processing', attempts: 1, updated_at: ISO(-60) });
    bullJobs.add('stale');

    updateMatchesNothing = (table) => table === 'queue_jobs';

    const q = await load();
    const result = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });

    updateMatchesNothing = null;
    expect(result.scanned).toBe(1);
    expect(result.recovered).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/did not persist/);

    expect(byId('stale').status).toBe('processing');
    expect(removedExecutors).toEqual([]);
    expect(bullJobs.has('stale')).toBe(true);
  });

  test('a missing scheduled_post is a proven orphan and is released', async () => {
    // Successful lookup returning no row is positive proof of absence — not
    // the same thing as a lookup error.
    seedQueueJob({ id: 'orphan', status: 'processing', attempts: 1, updated_at: ISO(-60) });

    const q = await load();
    const result = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });

    expect(result.recovered).toBe(1);
    expect(byId('orphan').status).toBe('cancelled');
  });

  test('existing retry semantics (max_attempts / next_retry_at) are left intact', async () => {
    seedQueueJob({
      id: 'stale',
      status: 'processing',
      attempts: 2,
      max_attempts: 7,
      next_retry_at: '2026-08-30T00:00:00.000Z',
      updated_at: ISO(-60),
    });

    const q = await load();
    await q.recoverStuckProcessingJobs({ staleMinutes: 15 });

    expect(byId('stale').max_attempts).toBe(7);
    expect(byId('stale').next_retry_at).toBe('2026-08-30T00:00:00.000Z');
    expect(byId('stale').attempts).toBe(3);
  });

  test('dryRun scans without mutating anything', async () => {
    seedQueueJob({ id: 'stale', status: 'processing', attempts: 1, updated_at: ISO(-60) });

    const q = await load();
    const result = await q.recoverStuckProcessingJobs({ staleMinutes: 15, dryRun: true });

    expect(result.scanned).toBe(1);
    expect(result.recovered).toBe(0);
    expect(byId('stale').status).toBe('processing');
    expect(byId('stale').attempts).toBe(1);
  });

  test('a job past the poison threshold is DLQd, cancelled, and only then unhooked', async () => {
    seedQueueJob({ id: 'poison', status: 'processing', attempts: 6, updated_at: ISO(-60) });
    bullJobs.add('poison');

    const q = await load();
    const result = await q.recoverStuckProcessingJobs({ staleMinutes: 15 });

    expect(result.routed_to_dlq).toBe(1);
    expect(result.recovered).toBe(0);
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0].status).toBe('poisoned');

    expect(byId('poison').status).toBe('cancelled');
    expect(byId('poison').error_message).toBe('poisoned:stuck_processing_recovery');
    expect(byId('poison').error_code).toBeNull();
    expect(removedExecutors).toEqual(['poison']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The cancel-then-remove failure mode
// ───────────────────────────────────────────────────────────────────────────
describe('routeToDeadLetterQueue — never orphan a live authority', () => {
  test('a failed cancel leaves the executor alive and is reported, not swallowed', async () => {
    seedQueueJob({ id: 'qj-1', status: 'processing', attempts: 5, updated_at: ISO(-60) });
    bullJobs.add('qj-1');

    // DLQ writes succeed; the queue_jobs cancel fails.
    onWrite = (table) => (table === 'queue_jobs' ? { code: '55P03', message: 'cancel blocked' } : null);

    const q = await load();
    const routed = await q.routeToDeadLetterQueue({
      scheduledPostId: 'sp-1',
      queueJobId: 'qj-1',
      errorCode: 'STUCK_PROCESSING',
      errorMessage: 'worker died',
      failureCount: 5,
      reason: 'stuck_processing_recovery',
    });

    expect(routed.ok).toBe(false);
    expect(routed.error).toMatch(/cancel blocked/);

    onWrite = null;
    // Authority still live → executor MUST still exist.
    expect(byId('qj-1').status).toBe('processing');
    expect(removedExecutors).toEqual([]);
    expect(bullJobs.has('qj-1')).toBe(true);
  });

  test('a cancel that reports success but persists nothing is treated as failure', async () => {
    seedQueueJob({ id: 'qj-1', status: 'processing', attempts: 5, updated_at: ISO(-60) });
    bullJobs.add('qj-1');

    updateMatchesNothing = (table) => table === 'queue_jobs';

    const q = await load();
    const routed = await q.routeToDeadLetterQueue({
      scheduledPostId: 'sp-1',
      queueJobId: 'qj-1',
      errorCode: 'STUCK_PROCESSING',
      errorMessage: 'worker died',
      failureCount: 5,
      reason: 'stuck_processing_recovery',
    });

    updateMatchesNothing = null;
    expect(routed.ok).toBe(false);
    expect(routed.error).toMatch(/did not persist/);
    expect(byId('qj-1').status).toBe('processing');
    expect(removedExecutors).toEqual([]);
    expect(bullJobs.has('qj-1')).toBe(true);
  });

  test('an ABSENT queue row is not a write failure, but still unhooks nothing', async () => {
    // No queue_jobs row for qj-gone: there is no authority left to cancel, so
    // the DLQ route stands. But absence is not read-back proof of death, so
    // the executor is still not ours to destroy.
    bullJobs.add('qj-gone');

    const q = await load();
    const routed = await q.routeToDeadLetterQueue({
      scheduledPostId: 'sp-1',
      queueJobId: 'qj-gone',
      errorCode: 'STUCK_PROCESSING',
      errorMessage: 'worker died',
      failureCount: 5,
      reason: 'stuck_processing_recovery',
    });

    expect(routed.ok).toBe(true);
    expect(dlqRows).toHaveLength(1);
    expect(removedExecutors).toEqual([]);
    expect(bullJobs.has('qj-gone')).toBe(true);
  });

  test('recordPublishFailure does not claim a DLQ route that failed', async () => {
    onWrite = () => ({ code: '08006', message: 'dlq write down' });

    const q = await load();
    const result = await q.recordPublishFailure({
      scheduledPostId: 'sp-1',
      queueJobId: 'qj-1',
      attemptCount: 5,
      errorCode: 'X',
      errorMessage: 'fail',
    });

    expect(result.routed_to_dlq).toBe(false);
    expect(result.retry_in_ms).toBeGreaterThan(0);
  });

  test('a successful cancel does unhook the executor', async () => {
    seedQueueJob({ id: 'qj-1', status: 'processing', attempts: 5, updated_at: ISO(-60) });
    bullJobs.add('qj-1');

    const q = await load();
    const routed = await q.routeToDeadLetterQueue({
      scheduledPostId: 'sp-1',
      queueJobId: 'qj-1',
      errorCode: 'STUCK_PROCESSING',
      errorMessage: 'worker died',
      failureCount: 5,
      reason: 'stuck_processing_recovery',
    });

    expect(routed.ok).toBe(true);
    expect(byId('qj-1').status).toBe('cancelled');
    expect(removedExecutors).toEqual(['qj-1']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Drift sweep — same phantom column, same fail-closed rule
// ───────────────────────────────────────────────────────────────────────────
describe('sweepQueueDrift', () => {
  test('cancels only live rows whose BullMQ peer is gone', async () => {
    seedQueueJob({ id: 'has-peer', status: 'pending', updated_at: ISO(-30) });
    seedQueueJob({ id: 'no-peer', status: 'pending', updated_at: ISO(-20) });
    seedQueueJob({ id: 'finished', status: 'completed', updated_at: ISO(-10) });
    bullJobs.add('has-peer');

    const q = await load();
    const result = await q.sweepQueueDrift({ maxScan: 100 });

    expect(result.scanned).toBe(2);
    expect(result.drift_found).toBe(1);
    expect(result.drift_cancelled).toBe(1);
    expect(byId('no-peer').status).toBe('cancelled');
    expect(byId('no-peer').error_message).toBe('drift_self_heal');
    expect(byId('has-peer').status).toBe('pending');
    expect(byId('finished').status).toBe('completed');
  });

  test('a getJob() THROW is UNKNOWN, never drift — a Redis blip cancels nothing', async () => {
    // The pre-repair code treated any probe throw as "peer missing" and
    // cancelled the row. Once the writes land, one transient Redis error
    // would mass-cancel every live row in the scan window.
    for (let i = 0; i < 5; i++) {
      seedQueueJob({ id: `blip-${i}`, status: 'pending', updated_at: ISO(-30 - i) });
      bullProbeThrows.add(`blip-${i}`);
    }
    seedQueueJob({ id: 'really-missing', status: 'pending', updated_at: ISO(-10) });

    const q = await load();
    const result = await q.sweepQueueDrift({ maxScan: 100 });

    expect(result.scanned).toBe(6);
    expect(result.peer_unknown).toBe(5);
    // Only the DEFINITIVE null counts as drift.
    expect(result.drift_found).toBe(1);
    expect(result.drift_cancelled).toBe(1);

    for (let i = 0; i < 5; i++) expect(byId(`blip-${i}`).status).toBe('pending');
    expect(byId('really-missing').status).toBe('cancelled');
  });

  test('a total Redis outage cancels nothing at all', async () => {
    seedQueueJob({ id: 'a', status: 'pending', updated_at: ISO(-30) });
    seedQueueJob({ id: 'b', status: 'processing', updated_at: ISO(-20) });
    bullProbeThrows.add('a');
    bullProbeThrows.add('b');

    const q = await load();
    const result = await q.sweepQueueDrift({ maxScan: 100 });

    expect(result.peer_unknown).toBe(2);
    expect(result.drift_found).toBe(0);
    expect(result.drift_cancelled).toBe(0);
    expect(byId('a').status).toBe('pending');
    expect(byId('b').status).toBe('processing');
  });

  test('drift_cancelled reports what PERSISTED, not what was attempted', async () => {
    seedQueueJob({ id: 'gone-1', status: 'pending', updated_at: ISO(-30) });
    seedQueueJob({ id: 'gone-2', status: 'pending', updated_at: ISO(-20) });
    // No BullMQ peers → both look like drift.

    updateMatchesNothing = (table) => table === 'queue_jobs';

    const q = await load();
    const result = await q.sweepQueueDrift({ maxScan: 100 });

    updateMatchesNothing = null;
    expect(result.drift_found).toBe(2);
    expect(result.drift_cancelled).toBe(0); // nothing actually landed
    expect(byId('gone-1').status).toBe('pending');
    expect(byId('gone-2').status).toBe('pending');
  });

  test('an unreadable queue fails closed instead of reporting a clean sweep', async () => {
    seedQueueJob({ id: 'no-peer', status: 'pending', updated_at: ISO(-20) });
    onSelect = () => ({ code: '08006', message: 'sweep lookup down' });

    const q = await load();
    await expect(q.sweepQueueDrift({ maxScan: 100 })).rejects.toThrow(/sweep lookup down/);
  });
});

export {};
