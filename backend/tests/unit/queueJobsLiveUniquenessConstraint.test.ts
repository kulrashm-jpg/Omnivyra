/**
 * queue_jobs — "at most one LIVE job per (scheduled_post_id, job_type)".
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * Both scheduler enqueue paths guard against a duplicate publish job with a
 * read-before-insert:
 *
 *     SELECT live job for post  ->  if none, INSERT
 *
 * Commit 76a166d2 repaired the READ half of that guard (a failed lookup no
 * longer means "nothing queued"; both paths now fail closed). It explicitly
 * carried the remaining gap forward: "queue_jobs has no unique constraint".
 * A guard that reads correctly still cannot survive interleaving —
 *
 *     A: SELECT -> none
 *     B: SELECT -> none
 *     A: INSERT       (live job #1)
 *     B: INSERT       (live job #2)   <-- double publish, irreversible
 *
 * — because neither SELECT can see a row the other transaction has not
 * committed yet. Neither SELECT is wrong. The only place the second INSERT can
 * be stopped is the database, via the partial unique index
 * `uidx_queue_jobs_live_job_per_post`.
 *
 * These tests therefore do NOT test the classifier in isolation. They stand a
 * persistence layer behind the REAL exported `findDuePostsAndEnqueue` /
 * `enqueueScheduledPostAt` that ENFORCES that index with Postgres' own
 * semantics — the INSERT itself rejects the second live row with a PostgREST
 * SQLSTATE 23505 error, and a multi-row INSERT aborts wholly, exactly as the
 * migration makes the real table behave — and then assert the outcome the
 * product needs: at most one accepted live job, reported as a duplicate, never
 * as a crash and never as a silent success.
 *
 * SCOPE NOTE (Phase 160 agent partition)
 * --------------------------------------
 * `findDuePostsAndEnqueue` (schedulerService.ts) is the path this agent owns
 * and changed, so every DB-rejection outcome is asserted through it.
 * `enqueueScheduledPostAt` lives in schedulerPostQueueControl.ts, which another
 * agent owns; it is exercised REAL and UNMODIFIED here, both for the
 * read-side/terminal-row behaviour it already has and to pin the seam contract
 * that agent consumes — see "the seam schedulerPostQueueControl consumes".
 *
 * Nothing is published and no real database is touched.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// ── The persistence layer under test: a queue_jobs table that actually
//    enforces the partial unique index. ──────────────────────────────────────
type QueueJobRow = {
  id: string;
  scheduled_post_id: string;
  job_type: string;
  status: string;
  scheduled_for?: string | null;
  priority?: number | null;
  updated_at?: string | null;
};

const INDEX_NAME = 'uidx_queue_jobs_live_job_per_post';

const MIGRATION_PATH = join(
  __dirname,
  '../../../supabase/migrations/20261009000000_queue_jobs_live_publish_uniqueness.sql',
);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, 'utf8');

/**
 * The enforced index is READ OUT OF THE MIGRATION, not hardcoded here.
 *
 * This matters: without it the in-memory table would enforce whatever this test
 * file says, and the migration could be weakened — CREATE INDEX instead of
 * CREATE UNIQUE INDEX, a different key, a predicate that no longer covers
 * 'pending' — with every runtime test still green. Deriving it makes the
 * migration the single source of truth for the invariant, so weakening it shows
 * up as a LOST RACE below rather than only as a string assertion.
 */
function parseIndexFromMigration(sql: string) {
  const stmt = sql.replace(/\s+/g, ' ');
  const create = new RegExp(
    `CREATE\\s+(UNIQUE\\s+)?INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${INDEX_NAME}\\s+ON\\s+public\\.queue_jobs\\s*\\(([^)]*)\\)\\s*(WHERE\\s+status\\s+IN\\s*\\(([^)]*)\\))?`,
    'i',
  ).exec(stmt);

  if (!create) {
    // No such index in the migration at all -> the table enforces nothing.
    return { isUnique: false, keyColumns: [] as string[], liveStatuses: [] as string[] };
  }

  return {
    isUnique: Boolean(create[1]),
    keyColumns: create[2].split(',').map((c) => c.trim()).filter(Boolean),
    liveStatuses: (create[4] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean),
  };
}

const INDEX = parseIndexFromMigration(MIGRATION_SQL);
const LIVE_STATUSES = INDEX.liveStatuses;

/** PostgREST-shaped unique_violation, byte-compatible with what supabase-js returns. */
function uniqueViolation() {
  return {
    code: '23505',
    message: `duplicate key value violates unique constraint "${INDEX_NAME}"`,
    details: 'Key (scheduled_post_id, job_type) already exists.',
    hint: null,
  };
}

const db: {
  rows: QueueJobRow[];
  seq: number;
  /** true models the PRE-index database (no constraint at all). */
  indexDisabled: boolean;
  /** Await barrier used to force the SELECT/SELECT/INSERT/INSERT interleaving. */
  beforeInsert: null | (() => Promise<void>);
  /**
   * FIFO of non-duplicate DB faults. One is consumed per INSERT ATTEMPT, so a
   * fault can be made to persist across the cron's bulk attempt AND its
   * per-post fallback attempt — which is the only way to observe how the
   * fallback classifies it.
   */
  insertFaults: Array<{ code?: string; message: string }>;
  scheduledPosts: Array<Record<string, unknown>>;
  campaigns: Array<Record<string, unknown>>;
} = {
  rows: [],
  seq: 0,
  indexDisabled: false,
  beforeInsert: null,
  insertFaults: [],
  scheduledPosts: [],
  campaigns: [],
};

/**
 * The index predicate, expressed once. A row participates in the uniqueness
 * check only while it is live; terminal rows are history.
 */
function violatesLiveUniqueIndex(candidate: Record<string, string>): boolean {
  if (db.indexDisabled) return false;
  // A non-unique index rejects nothing; a predicate that does not cover this
  // row's status does not apply to it.
  if (!INDEX.isUnique) return false;
  if (!LIVE_STATUSES.includes(candidate.status)) return false;
  return db.rows.some(
    (r) =>
      LIVE_STATUSES.includes(r.status) &&
      INDEX.keyColumns.every((col) => (r as Record<string, any>)[col] === candidate[col]),
  );
}

/** The INSERT boundary. Returns a PostgREST result; never throws. */
async function insertQueueJob(payload: Record<string, any>): Promise<{ data: any; error: any }> {
  if (db.beforeInsert) await db.beforeInsert();

  if (db.insertFaults.length > 0) {
    return { data: null, error: db.insertFaults.shift() };
  }

  const candidate = {
    scheduled_post_id: String(payload.scheduled_post_id),
    job_type: String(payload.job_type ?? 'publish'),
    status: String(payload.status ?? 'pending'),
  };
  if (violatesLiveUniqueIndex(candidate)) {
    return { data: null, error: uniqueViolation() };
  }

  const row: QueueJobRow = {
    id: `qj-${++db.seq}`,
    ...candidate,
    scheduled_for: payload.scheduled_for ?? null,
    priority: payload.priority ?? 0,
    updated_at: new Date().toISOString(),
  };
  db.rows.push(row);
  return { data: row, error: null };
}

// ── Mocks: the real modules, with only the outermost seams replaced ──────────

// schedulerService re-exports the intelligence-jobs module, whose import graph
// reaches @/config and throws under test. It is not under test here; the
// scheduler + post-queue-control modules stay REAL.
jest.mock('../../scheduler/schedulerIntelligenceJobs', () => ({}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    // No advisory-lock RPC deployed — the realistic worst case, and the one the
    // fallback "optimistic check" is explicitly best-effort about.
    rpc: jest.fn(async () => ({ data: null, error: { message: 'function does not exist' } })),
    from: jest.fn((table: string) => makeBuilder(table)),
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => makeBuilder(table)),
}));

/**
 * `createQueueJob` keeps the REAL insert shape, including its error re-wrap: it
 * turns the PostgREST error into `new Error('Failed to create queue job: ...')`
 * and DROPS the structured `code`. That wrap is exactly why the classifier must
 * also match on the message, so the test reproduces it rather than handing the
 * caller a clean 23505 object.
 */
jest.mock('../../db/queries', () => ({
  createQueueJob: jest.fn(async (payload: any) => {
    const { data, error } = await insertQueueJob({
      scheduled_post_id: payload.scheduled_post_id,
      job_type: payload.job_type,
      status: payload.status,
      scheduled_for: payload.scheduled_for,
      priority: payload.priority ?? 0,
    });
    if (error || !data) {
      throw new Error(`Failed to create queue job: ${error?.message}`);
    }
    return data.id;
  }),
}));

const bullAdds: Array<{ name: string; data: any; opts: any }> = [];
jest.mock('../../queue/bullmqClient', () => ({
  getQueue: jest.fn(() => ({
    getJobCounts: jest.fn(async () => ({ waiting: 0, active: 0, delayed: 0 })),
    add: jest.fn(async (name: string, data: any, opts: any) => {
      bullAdds.push({ name, data, opts });
      return { id: opts?.jobId ?? 'bull-1' };
    }),
    addBulk: jest.fn(async (jobs: any[]) => {
      for (const j of jobs) bullAdds.push({ name: j.name, data: j.data, opts: j.opts });
      return jobs.map((j) => ({ id: j.opts?.jobId }));
    }),
    getJob: jest.fn(async () => null),
  })),
  getEngagementPollingQueue: jest.fn(() => ({ add: jest.fn() })),
}));

// ── Minimal chainable PostgREST-ish builder over the in-memory tables ────────
function makeBuilder(table: string): any {
  const filters: Record<string, any> = {};
  let mode: 'select' | 'insert' | 'update' = 'select';
  let insertPayload: any[] = [];
  let updatePayload: Record<string, any> | null = null;

  const source = (): any[] => {
    if (table === 'queue_jobs') return db.rows;
    if (table === 'scheduled_posts') return db.scheduledPosts as any[];
    if (table === 'campaigns') return db.campaigns as any[];
    return [];
  };

  const matches = (r: any) =>
    Object.entries(filters).every(([k, v]) => {
      if (k.endsWith('__in')) return (v as any[]).includes(r[k.slice(0, -4)]);
      if (k.endsWith('__lte')) return String(r[k.slice(0, -5)]) <= String(v);
      return r[k] === v;
    });

  const rowsNow = () => source().filter(matches);

  const runWrite = async (): Promise<{ data: any; error: any }> => {
    if (mode === 'insert') {
      const inserted: any[] = [];
      for (const payload of insertPayload) {
        const { data, error } = await insertQueueJob(payload);
        // Postgres aborts the WHOLE statement on a constraint violation, and a
        // multi-row INSERT is one statement — so nothing is persisted.
        if (error) {
          for (const done of inserted) {
            const i = db.rows.indexOf(done);
            if (i >= 0) db.rows.splice(i, 1);
          }
          return { data: null, error };
        }
        inserted.push(data);
      }
      return { data: inserted, error: null };
    }
    if (mode === 'update' && updatePayload) {
      const targets = rowsNow();
      for (const r of targets) Object.assign(r, updatePayload);
      return { data: targets, error: null };
    }
    return { data: rowsNow(), error: null };
  };

  const api: any = {
    select: jest.fn(() => api),
    insert: jest.fn((p: any) => { mode = 'insert'; insertPayload = Array.isArray(p) ? p : [p]; return api; }),
    update: jest.fn((p: any) => { mode = 'update'; updatePayload = p; return api; }),
    eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
    in: jest.fn((k: string, v: any[]) => { filters[`${k}__in`] = v; return api; }),
    lte: jest.fn((k: string, v: any) => { filters[`${k}__lte`] = v; return api; }),
    order: jest.fn(() => api),
    limit: jest.fn(() => api),
    maybeSingle: jest.fn(async () => {
      const rows = rowsNow();
      // .maybeSingle() errors on >1 row, exactly like PostgREST.
      if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } };
      return { data: rows[0] ?? null, error: null };
    }),
    single: jest.fn(async () => ({ data: rowsNow()[0] ?? null, error: null })),
    then: (resolve: any, reject?: any) => runWrite().then(resolve, reject),
  };
  return api;
}

const POST_A = '11111111-1111-4111-8111-111111111111';
const POST_B = '99999999-9999-4999-8999-999999999999';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN = '44444444-4444-4444-8444-444444444444';

const futureIso = (msAhead = 10 * 60 * 1000) => new Date(Date.now() + msAhead).toISOString();
const liveRowsFor = (postId: string) =>
  db.rows.filter((r) => r.scheduled_post_id === postId && LIVE_STATUSES.includes(r.status));

async function loadScheduler() {
  return import('../../scheduler/schedulerService');
}

/** Seed one due, released post on an active campaign. */
function seedDuePost(id: string) {
  db.scheduledPosts.push({
    id,
    user_id: USER_ID,
    social_account_id: ACCOUNT_ID,
    platform: 'linkedin',
    scheduled_for: new Date(Date.now() - 60_000).toISOString(),
    status: 'scheduled',
    priority: 0,
    campaign_id: CAMPAIGN,
  });
  if (!db.campaigns.some((c) => c.id === CAMPAIGN)) {
    db.campaigns.push({ id: CAMPAIGN, status: 'active' });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  db.rows = [];
  db.seq = 0;
  db.indexDisabled = false;
  db.beforeInsert = null;
  db.insertFaults = [];
  db.scheduledPosts = [];
  db.campaigns = [];
  bullAdds.length = 0;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the migration declares the invariant it is supposed to declare', () => {
  const sql = MIGRATION_SQL;

  test('a PARTIAL unique index on (scheduled_post_id, job_type) over live statuses only', () => {
    expect(INDEX.isUnique).toBe(true);
    expect(INDEX.keyColumns).toEqual(['scheduled_post_id', 'job_type']);
    expect(INDEX.liveStatuses).toEqual(['pending', 'processing']);
  });

  test('the index name the code classifies on is the one the migration creates', async () => {
    const { QUEUE_JOBS_LIVE_UNIQUE_INDEX } = await loadScheduler();
    expect(QUEUE_JOBS_LIVE_UNIQUE_INDEX).toBe(INDEX_NAME);
    expect(sql).toContain(QUEUE_JOBS_LIVE_UNIQUE_INDEX);
  });

  test('it is NOT a total unique constraint — terminal rows must not block re-enqueue', () => {
    // A total constraint would break /api/scheduler/retry and reschedule.
    expect(sql).not.toMatch(/ADD CONSTRAINT\s+\w*queue_jobs\w*\s+UNIQUE/i);
    expect(sql).toMatch(/WHERE status IN \('pending', 'processing'\)/);
  });

  test('the pre-flight RAISES on live duplicates and never deletes or rewrites a row', () => {
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i);
    expect(sql).toMatch(/HAVING count\(\*\) > 1/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+public\.queue_jobs\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
  });

  test('it does not attempt CONCURRENTLY, which cannot run inside the migration transaction', () => {
    expect(sql).toMatch(/^\s*CREATE UNIQUE INDEX IF NOT EXISTS/m);
    expect(sql).not.toMatch(/^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/im);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a legitimate first enqueue is unaffected', () => {
  test('a due post with no live job is enqueued exactly once by the cron cycle', async () => {
    seedDuePost(POST_A);
    const { findDuePostsAndEnqueue } = await loadScheduler();

    const result = await findDuePostsAndEnqueue();

    expect(result).toMatchObject({ found: 1, created: 1, skipped: 0 });
    expect(liveRowsFor(POST_A)).toHaveLength(1);
    expect(bullAdds).toHaveLength(1);
    expect(bullAdds[0].data).toMatchObject({ scheduled_post_id: POST_A, user_id: USER_ID });
  });

  test('the precise-time path also enqueues a first job', async () => {
    const { enqueueScheduledPostAt } = await loadScheduler();

    await expect(enqueueScheduledPostAt(POST_A, USER_ID, ACCOUNT_ID, futureIso())).resolves.toBe('enqueued');
    expect(liveRowsFor(POST_A)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('terminal rows are history and never block a re-enqueue', () => {
  // These are the two recovery paths a total UNIQUE (scheduled_post_id) would
  // have broken: POST /api/scheduler/retry and reschedule.
  for (const terminal of ['failed', 'cancelled', 'completed']) {
    test(`a '${terminal}' row does not stop the cron cycle re-enqueueing the post`, async () => {
      db.rows.push({ id: 'qj-old', scheduled_post_id: POST_A, job_type: 'publish', status: terminal });
      seedDuePost(POST_A);
      const { findDuePostsAndEnqueue } = await loadScheduler();

      const result = await findDuePostsAndEnqueue();

      expect(result).toMatchObject({ created: 1, skipped: 0 });
      expect(liveRowsFor(POST_A)).toHaveLength(1);
      expect(db.rows).toHaveLength(2); // history preserved, not overwritten
    });

    test(`a '${terminal}' row does not stop the retry path re-enqueueing the post`, async () => {
      db.rows.push({ id: 'qj-old', scheduled_post_id: POST_A, job_type: 'publish', status: terminal });
      const { enqueueScheduledPostAt } = await loadScheduler();

      await expect(enqueueScheduledPostAt(POST_A, USER_ID, ACCOUNT_ID, futureIso())).resolves.toBe('enqueued');
      expect(liveRowsFor(POST_A)).toHaveLength(1);
      expect(db.rows).toHaveLength(2);
    });
  }

  test('many terminal rows accumulate for one post — the lifetime is one-to-MANY', async () => {
    // Re-proves the cardinality the partial predicate depends on: a post may
    // own several queue_jobs rows, but at most one of them may be live.
    db.rows.push(
      { id: 'qj-1', scheduled_post_id: POST_A, job_type: 'publish', status: 'failed' },
      { id: 'qj-2', scheduled_post_id: POST_A, job_type: 'publish', status: 'cancelled' },
      { id: 'qj-3', scheduled_post_id: POST_A, job_type: 'publish', status: 'failed' },
    );
    const { enqueueScheduledPostAt } = await loadScheduler();

    await expect(enqueueScheduledPostAt(POST_A, USER_ID, ACCOUNT_ID, futureIso())).resolves.toBe('enqueued');
    expect(db.rows.filter((r) => r.scheduled_post_id === POST_A)).toHaveLength(4);
    expect(liveRowsFor(POST_A)).toHaveLength(1);
  });

  test('the INDEX permits cancel -> terminal -> re-enqueue: a cancelled row frees the slot', async () => {
    // What this pins is the INDEX's behaviour, not the production health of
    // cancelScheduledPostQueueEntry. That function is separately known to be
    // broken in production (0 rows have EVER reached status 'cancelled', and
    // two live rows have been stranded since May 2026); its repair belongs to
    // schedulerPostQueueControl.ts, which another agent owns this phase. The
    // assertion here is the one this migration is responsible for: ONCE a row
    // becomes terminal, the partial predicate stops covering it and the slot is
    // free — so the index cannot be what blocks a reschedule.
    const { enqueueScheduledPostAt, cancelScheduledPostQueueEntry } = await loadScheduler();

    await expect(enqueueScheduledPostAt(POST_A, USER_ID, ACCOUNT_ID, futureIso())).resolves.toBe('enqueued');
    // While the first job is live, a second is refused.
    await expect(enqueueScheduledPostAt(POST_A, USER_ID, ACCOUNT_ID, futureIso())).resolves.toBe('duplicate');

    await cancelScheduledPostQueueEntry(POST_A, { reason: 'test_reschedule' });
    expect(liveRowsFor(POST_A)).toHaveLength(0);

    // ...and once cancelled, the re-enqueue is accepted by the index.
    await expect(enqueueScheduledPostAt(POST_A, USER_ID, ACCOUNT_ID, futureIso())).resolves.toBe('enqueued');
    expect(liveRowsFor(POST_A)).toHaveLength(1);
    expect(db.rows).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a duplicate is absorbed as a duplicate, not as a crash or a silent success', () => {
  test('the read-side guard still short-circuits before any INSERT', async () => {
    db.rows.push({ id: 'qj-live', scheduled_post_id: POST_A, job_type: 'publish', status: 'pending' });
    seedDuePost(POST_A);
    const { findDuePostsAndEnqueue } = await loadScheduler();

    const result = await findDuePostsAndEnqueue();

    expect(result).toMatchObject({ found: 1, created: 0, skipped: 1 });
    expect(liveRowsFor(POST_A)).toHaveLength(1);
    expect(bullAdds).toHaveLength(0);
  });

  test('when the guard MISSES, the DATABASE rejects the insert and the cycle reports SKIPPED', async () => {
    seedDuePost(POST_A);
    // The guard is bypassed exactly as a race bypasses it: the live row appears
    // AFTER the cycle's duplicate-guard SELECT returned "none" and BEFORE the
    // INSERT lands.
    db.beforeInsert = async () => {
      db.beforeInsert = null;
      db.rows.push({ id: 'qj-winner', scheduled_post_id: POST_A, job_type: 'publish', status: 'pending' });
    };
    const { findDuePostsAndEnqueue } = await loadScheduler();

    const result = await findDuePostsAndEnqueue();

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);     // not a failure, not a crash
    expect(liveRowsFor(POST_A)).toHaveLength(1); // not a second row
  });

  test('the whole cycle survives it — the sibling posts still enqueue', async () => {
    seedDuePost(POST_A);
    seedDuePost(POST_B);
    db.beforeInsert = async () => {
      db.beforeInsert = null;
      db.rows.push({ id: 'qj-winner', scheduled_post_id: POST_A, job_type: 'publish', status: 'pending' });
    };
    const { findDuePostsAndEnqueue } = await loadScheduler();

    const result = await findDuePostsAndEnqueue();

    // The bulk statement aborts wholly, the per-post fallback re-tries each:
    // POST_B is genuinely free and must still be queued.
    expect(result).toMatchObject({ found: 2, created: 1, skipped: 1 });
    expect(liveRowsFor(POST_A)).toHaveLength(1);
    expect(liveRowsFor(POST_B)).toHaveLength(1);
    expect(bullAdds.map((b) => b.data.scheduled_post_id)).toEqual([POST_B]);
  });

  test('a rejected insert never produces an orphan BullMQ job', async () => {
    // An orphan BullMQ job (queued, with no queue_jobs row behind it) is worse
    // than a duplicate row: the worker cannot resolve or cancel it, and it
    // publishes against a job the DB has no record of.
    seedDuePost(POST_A);
    db.beforeInsert = async () => {
      db.beforeInsert = null;
      db.rows.push({ id: 'qj-winner', scheduled_post_id: POST_A, job_type: 'publish', status: 'processing' });
    };
    const { findDuePostsAndEnqueue } = await loadScheduler();

    await findDuePostsAndEnqueue();

    expect(bullAdds).toHaveLength(0);
    expect(db.rows).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a NON-duplicate failure is never swallowed as "already queued"', () => {
  test('the cron cycle does not count a DB fault as skipped OR created', async () => {
    // The classifier must be narrow. If a statement timeout were read as
    // "already queued" the post would be silently dropped: nothing queued it,
    // and the cycle would report it as handled.
    seedDuePost(POST_A);
    // Two faults: the bulk attempt consumes the first and the per-post fallback
    // the second, so it is the FALLBACK's classification being asserted — the
    // branch this agent added.
    const timeout = { message: 'canceling statement due to statement timeout' };
    db.insertFaults = [{ ...timeout }, { ...timeout }];
    const { findDuePostsAndEnqueue } = await loadScheduler();

    const result = await findDuePostsAndEnqueue();

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0); // NOT absorbed as a duplicate
    expect(liveRowsFor(POST_A)).toHaveLength(0);
    expect(bullAdds).toHaveLength(0);
  });

  test('a foreign-key violation is not a duplicate either', async () => {
    seedDuePost(POST_A);
    const fk = { code: '23503', message: 'insert or update on table "queue_jobs" violates foreign key constraint' };
    db.insertFaults = [{ ...fk }, { ...fk }];
    const { findDuePostsAndEnqueue } = await loadScheduler();

    const result = await findDuePostsAndEnqueue();

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0);
  });

  test('the precise-time path still THROWS a non-duplicate insert failure', async () => {
    const { enqueueScheduledPostAt } = await loadScheduler();
    db.insertFaults = [{ message: 'connection terminated unexpectedly' }];

    await expect(enqueueScheduledPostAt(POST_A, USER_ID, ACCOUNT_ID, futureIso())).rejects.toThrow(
      /connection terminated/i,
    );
    expect(bullAdds).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('THE RACE: two simultaneous cron cycles for one post', () => {
  /**
   * Reproduces the interleaving verbatim. Both cycles complete their
   * duplicate-guard SELECT before either is allowed to INSERT, so the
   * read-before-insert guard is defeated by construction — precisely the
   * scenario it cannot handle. Only the database can settle it.
   */
  async function runConcurrentCycles() {
    const { findDuePostsAndEnqueue } = await loadScheduler();

    let arrived = 0;
    let releaseBoth: () => void = () => undefined;
    const bothArrived = new Promise<void>((resolve) => { releaseBoth = resolve; });

    db.beforeInsert = async () => {
      arrived += 1;
      if (arrived >= 2) releaseBoth();
      await bothArrived; // neither INSERT proceeds until both SELECTs are done
    };

    return Promise.allSettled([findDuePostsAndEnqueue(), findDuePostsAndEnqueue()]);
  }

  test('at most ONE live queue_job exists afterwards', async () => {
    seedDuePost(POST_A);
    await runConcurrentCycles();
    expect(liveRowsFor(POST_A)).toHaveLength(1);
  });

  test('exactly one cycle reports created:1 and the other skipped:1', async () => {
    seedDuePost(POST_A);
    const settled = await runConcurrentCycles();

    const results = settled.map((s) => (s.status === 'fulfilled' ? s.value : null));
    expect(results.filter((r) => r && r.created === 1 && r.skipped === 0)).toHaveLength(1);
    expect(results.filter((r) => r && r.created === 0 && r.skipped === 1)).toHaveLength(1);
  });

  test('neither cycle crashes — no rejected promise, no aborted run', async () => {
    seedDuePost(POST_A);
    const settled = await runConcurrentCycles();
    expect(settled.every((s) => s.status === 'fulfilled')).toBe(true);
  });

  test('only ONE BullMQ publish job is created', async () => {
    seedDuePost(POST_A);
    await runConcurrentCycles();
    expect(bullAdds).toHaveLength(1);
    expect(bullAdds[0].data.scheduled_post_id).toBe(POST_A);
  });

  test('the surviving row is a real, resolvable job — its id backs the BullMQ jobId', async () => {
    seedDuePost(POST_A);
    await runConcurrentCycles();
    const live = liveRowsFor(POST_A);
    expect(bullAdds[0].opts.jobId).toBe(live[0].id);
  });

  test('WITHOUT the database index the very same race produces TWO live jobs', async () => {
    // Proves the suite actually exercises the constraint and is not passing for
    // some incidental reason: remove the index, the race is lost again.
    seedDuePost(POST_A);
    db.indexDisabled = true;
    await runConcurrentCycles();
    expect(liveRowsFor(POST_A)).toHaveLength(2);
    expect(bullAdds).toHaveLength(2);
  });

  test('the cron cycle and the precise-time path race each other to the same outcome', async () => {
    // The two paths that actually collide in production: the safety-net cron
    // tick and POST /api/scheduler/retry.
    seedDuePost(POST_A);
    const { findDuePostsAndEnqueue, enqueueScheduledPostAt } = await loadScheduler();

    let arrived = 0;
    let releaseBoth: () => void = () => undefined;
    const bothArrived = new Promise<void>((resolve) => { releaseBoth = resolve; });
    db.beforeInsert = async () => {
      arrived += 1;
      if (arrived >= 2) releaseBoth();
      await bothArrived;
    };

    const settled = await Promise.allSettled([
      findDuePostsAndEnqueue(),
      enqueueScheduledPostAt(POST_A, USER_ID, ACCOUNT_ID, futureIso()),
    ]);

    // Whoever loses, the database admits exactly one live job and exactly one
    // BullMQ job is created for it.
    expect(liveRowsFor(POST_A)).toHaveLength(1);
    expect(bullAdds).toHaveLength(1);
    expect(settled.filter((s) => s.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a genuinely different post is unaffected', () => {
  test('two different posts each get their own live job under the same race', async () => {
    seedDuePost(POST_A);
    const { enqueueScheduledPostAt, findDuePostsAndEnqueue } = await loadScheduler();

    let arrived = 0;
    let release: () => void = () => undefined;
    const bothArrived = new Promise<void>((resolve) => { release = resolve; });
    db.beforeInsert = async () => {
      arrived += 1;
      if (arrived >= 2) release();
      await bothArrived;
    };

    const [cycle, precise] = await Promise.all([
      findDuePostsAndEnqueue(),
      enqueueScheduledPostAt(POST_B, USER_ID, ACCOUNT_ID, futureIso()),
    ]);

    expect(cycle).toMatchObject({ created: 1, skipped: 0 });
    expect(precise).toBe('enqueued');
    expect(liveRowsFor(POST_A)).toHaveLength(1);
    expect(liveRowsFor(POST_B)).toHaveLength(1);
    expect(bullAdds).toHaveLength(2);
  });

  test('a live job for another post does not suppress this one', async () => {
    db.rows.push({ id: 'qj-other', scheduled_post_id: POST_B, job_type: 'publish', status: 'pending' });
    seedDuePost(POST_A);
    const { findDuePostsAndEnqueue } = await loadScheduler();

    const result = await findDuePostsAndEnqueue();

    expect(result).toMatchObject({ created: 1, skipped: 0 });
    expect(liveRowsFor(POST_A)).toHaveLength(1);
    expect(liveRowsFor(POST_B)).toHaveLength(1);
  });

  test('the INDEX does not conflate job_types: a live non-publish job leaves the publish slot free', () => {
    // The key includes job_type on purpose, so a hypothetical future
    // non-publish job for the same post cannot be mistaken for a live publish
    // job. (The application's read-side guard is job_type-agnostic today and
    // would still short-circuit — that is the guard's choice, not the index's,
    // and it is what the two `.in('status', ...)` lookups already do. What is
    // asserted here is only what the DATABASE would admit.)
    db.rows.push({ id: 'qj-other-type', scheduled_post_id: POST_A, job_type: 'archive', status: 'pending' });

    expect(violatesLiveUniqueIndex({ scheduled_post_id: POST_A, job_type: 'publish', status: 'pending' })).toBe(false);
    // ...while a second live PUBLISH job for the same post is still refused.
    db.rows.push({ id: 'qj-pub', scheduled_post_id: POST_A, job_type: 'publish', status: 'pending' });
    expect(violatesLiveUniqueIndex({ scheduled_post_id: POST_A, job_type: 'publish', status: 'pending' })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the bulk-insert path specifically', () => {
  test('a bulk 23505 aborts the whole statement and persists nothing', async () => {
    seedDuePost(POST_A);
    seedDuePost(POST_B);
    // POST_B is the raced one; it is second in the bulk payload, so the
    // all-or-nothing semantics are what stop POST_A being written twice.
    db.rows.push({ id: 'qj-winner', scheduled_post_id: POST_B, job_type: 'publish', status: 'pending' });
    const beforeCount = db.rows.length;
    const { findDuePostsAndEnqueue } = await loadScheduler();

    const result = await findDuePostsAndEnqueue();

    // POST_B is caught by the read-side guard, so only POST_A reaches the bulk
    // insert and it succeeds: exactly one new row.
    expect(db.rows.length).toBe(beforeCount + 1);
    expect(result).toMatchObject({ created: 1, skipped: 1 });
  });

  test('a concurrent writer winning the race is counted as SKIPPED, not as a failure', async () => {
    seedDuePost(POST_A);
    // Another writer inserts the live row after the cycle's duplicate-guard
    // lookup and before its insert. The bulk statement aborts, the per-post
    // fallback then hits the index, and that must read as "already queued".
    db.beforeInsert = async () => {
      db.beforeInsert = null;
      db.rows.push({ id: 'qj-winner', scheduled_post_id: POST_A, job_type: 'publish', status: 'pending' });
    };
    const { findDuePostsAndEnqueue } = await loadScheduler();

    const result = await findDuePostsAndEnqueue();

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(liveRowsFor(POST_A)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('unique-violation classification', () => {
  test('classifies the structured PostgREST 23505 error', async () => {
    const { isLiveQueueJobDuplicateViolation } = await loadScheduler();
    expect(isLiveQueueJobDuplicateViolation(uniqueViolation())).toBe(true);
  });

  test('classifies the error AFTER createQueueJob re-wraps it and drops the code', async () => {
    // This is the shape the scheduler actually sees in production.
    const { isLiveQueueJobDuplicateViolation } = await loadScheduler();
    const wrapped = new Error(`Failed to create queue job: ${uniqueViolation().message}`);
    expect((wrapped as any).code).toBeUndefined();
    expect(isLiveQueueJobDuplicateViolation(wrapped)).toBe(true);
  });

  test('classifies a message that names the table but not the index', async () => {
    const { isLiveQueueJobDuplicateViolation } = await loadScheduler();
    expect(
      isLiveQueueJobDuplicateViolation(
        new Error('Failed to create queue job: duplicate key value violates unique constraint on public.queue_jobs'),
      ),
    ).toBe(true);
  });

  test('does NOT classify an unrelated DB failure as a duplicate', async () => {
    const { isLiveQueueJobDuplicateViolation } = await loadScheduler();
    expect(isLiveQueueJobDuplicateViolation(new Error('Failed to create queue job: statement timeout'))).toBe(false);
    expect(isLiveQueueJobDuplicateViolation({ code: '23503', message: 'foreign key violation' })).toBe(false);
    expect(isLiveQueueJobDuplicateViolation({ code: '23502', message: 'null value in column violates not-null' })).toBe(false);
    expect(isLiveQueueJobDuplicateViolation(null)).toBe(false);
    expect(isLiveQueueJobDuplicateViolation(undefined)).toBe(false);
    expect(isLiveQueueJobDuplicateViolation('')).toBe(false);
  });

  test('a 23505 that NAMES A DIFFERENT unique index is not this duplicate', async () => {
    const { isLiveQueueJobDuplicateViolation } = await loadScheduler();

    // The exact PostgREST shape a scheduled_posts idempotency collision
    // produces: SQLSTATE 23505 AND a constraint name from another table. The
    // SQLSTATE alone would say "duplicate"; the constraint name is the more
    // specific evidence and must win, or a caller would conclude a live
    // queue_job exists when none does.
    //
    // `isIdempotencyCollision` — the sibling predicate in the same module —
    // answers TRUE for this, which is right for ITS question and wrong for
    // this one. That is why this classifier weighs the evidence itself instead
    // of delegating to it.
    const scheduledPostsCollision = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "uidx_scheduled_posts_idempotency_key"',
    };
    expect(isLiveQueueJobDuplicateViolation(scheduledPostsCollision)).toBe(false);

    const { isIdempotencyCollision } = await import('../../services/boltScheduleIdempotency');
    expect(isIdempotencyCollision(scheduledPostsCollision)).toBe(true); // the sibling still answers its own question

    // Plain Error form (code dropped by a re-wrap) must agree.
    expect(
      isLiveQueueJobDuplicateViolation(
        new Error('duplicate key value violates unique constraint "uidx_scheduled_posts_idempotency_key"'),
      ),
    ).toBe(false);
  });

  test('a bare 23505 with no constraint name is still read as this duplicate', async () => {
    // queue_jobs has exactly two unique constraints: the pkey on a
    // gen_random_uuid() column, and this index. At the scheduler's insert
    // sites a nameless 23505 has no other reachable source.
    const { isLiveQueueJobDuplicateViolation } = await loadScheduler();
    expect(isLiveQueueJobDuplicateViolation({ code: '23505', message: 'conflict' })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the seam schedulerPostQueueControl consumes', () => {
  /**
   * schedulerPostQueueControl.ts is owned by another agent this phase and is
   * UNMODIFIED here, so `enqueueScheduledPostAt` still lets a DB rejection
   * escape as a throw rather than returning 'duplicate'. These two tests pin
   * the contract that agent's change depends on — the classifier's name, its
   * signature, and the fact that the error that path actually receives IS
   * classified — so the two halves cannot drift apart.
   */
  test('the classifier is exported under a stable name with a one-argument signature', async () => {
    const mod = await loadScheduler();
    expect(typeof mod.isLiveQueueJobDuplicateViolation).toBe('function');
    expect(mod.isLiveQueueJobDuplicateViolation.length).toBe(1);
    const leaf = await import('../../services/boltScheduleIdempotency');
    // Same function object: the scheduler re-export is not a divergent copy.
    expect(mod.isLiveQueueJobDuplicateViolation).toBe(leaf.isLiveQueueJobDuplicateViolation);
    expect(mod.QUEUE_JOBS_LIVE_UNIQUE_INDEX).toBe(leaf.QUEUE_JOBS_LIVE_UNIQUE_INDEX);
  });

  test('a raced enqueueScheduledPostAt reports duplicate, and the index still admitted only one', async () => {
    // INTEGRATION NOTE. This test previously asserted that the raced call THREW,
    // and that the thrown error classified as a duplicate — which was true while
    // the consumer of this seam had not yet been written. That consumer now
    // exists: `enqueueScheduledPostAt` catches the 23505 itself, via this very
    // classifier, and reports 'duplicate'. So the throw is no longer observable
    // from outside, and asserting it would pin a pre-integration assumption
    // rather than the shipped contract.
    //
    // What this test is actually for survives unchanged: the DATABASE, not
    // timing, decided the race — one live row, and no BullMQ job for the loser
    // (an orphan job with no queue_jobs row behind it is unresolvable).
    const {
      enqueueScheduledPostAt,
      isLiveQueueJobDuplicateViolation,
      QUEUE_JOBS_LIVE_UNIQUE_INDEX,
    } = await loadScheduler();
    db.beforeInsert = async () => {
      db.beforeInsert = null;
      db.rows.push({ id: 'qj-winner', scheduled_post_id: POST_A, job_type: 'publish', status: 'pending' });
    };

    const outcome = await enqueueScheduledPostAt(POST_A, USER_ID, ACCOUNT_ID, futureIso());

    expect(outcome).toBe('duplicate');
    expect(liveRowsFor(POST_A)).toHaveLength(1);
    expect(bullAdds).toHaveLength(0);
    // The classifier that produced that outcome is still the one this module
    // exports, and still recognises the error shape the insert path raises.
    expect(
      isLiveQueueJobDuplicateViolation(
        new Error(
          `Failed to create queue job: duplicate key value violates unique constraint "${QUEUE_JOBS_LIVE_UNIQUE_INDEX}"`,
        ),
      ),
    ).toBe(true);
  });
});
