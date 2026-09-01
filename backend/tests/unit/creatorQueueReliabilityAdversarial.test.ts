/**
 * ADVERSARIAL / INDEPENDENT VERIFICATION SUITE — creatorQueueReliabilityService
 * =============================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `backend/tests/unit/creatorQueueReliability.test.ts` passes against a service
 * that is provably broken in production: every `queue_jobs` write in
 * `creatorQueueReliabilityService.ts` names a column — `last_error` — that does
 * NOT exist on the deployed `queue_jobs` table, and one SELECT reads it too.
 * PostgREST rejects the ENTIRE statement (SQLSTATE 42703), so `status` never
 * changes and the SELECT returns `{ data: null, error }` which the service
 * reads as "no rows". Production evidence: zero `cancelled` rows have EVER been
 * written, and two rows have been stranded in a live state for 109 and 103 days.
 *
 * The existing suite cannot see any of this because its fake Supabase layer
 * silently accepts whatever payload it is handed. That fixture is incapable of
 * detecting this entire defect class.
 *
 * FIXTURE FIDELITY MODEL
 * ----------------------
 * The fake below models the ONE boundary property that matters: PostgREST
 * validates every column named in a statement (select list, filter keys, and
 * update/insert payload keys) against the table's actual schema BEFORE
 * executing it. An unknown column means:
 *
 *   1. the WHOLE statement is rejected — partial application never happens;
 *   2. NOTHING is mutated;
 *   3. the client returns `{ data: null, error: { code: '42703', ... } }`
 *      and does NOT throw (supabase-js only throws under `.throwOnError()`).
 *
 * Property (3) is what makes the defect invisible: `const { data } = await ...`
 * discards the error, `data` is null, and the caller concludes "nothing found".
 *
 * The fixture additionally implements real `.order()` / `.limit()` semantics so
 * that "keeps the newest" and "bounded scan" are genuinely exercised rather
 * than assumed.
 *
 * SCHEMA SOURCE OF TRUTH
 * ----------------------
 * `DEPLOYED_QUEUE_JOBS_COLUMNS` is the column set probed directly against the
 * deployed database. `DEPLOYED_DLQ_COLUMNS` is from
 * `supabase/migrations/20260658_creator_enterprise_reliability.sql`.
 * Note that `creator_cron_lease` (same migration) DOES have a `last_error`
 * column — the likely origin of the copy-paste that produced this defect.
 *
 * MUTATION LIST FOR INTEGRATION (run these against the REPAIRED service; each
 * must turn at least one test in this file red):
 *   M1  reconcile: keep the OLDEST live row instead of the newest
 *   M2  reconcile: cancel the winner as well as the losers
 *   M3  reconcile: make it non-idempotent (re-cancel already-cancelled rows)
 *   M4  reconcile/sweep/recover: swallow the SELECT `error` and return zeros
 *   M5  recover: drop the staleness filter so fresh `processing` jobs recover
 *   M6  recover: do not increment `attempts` on re-queue
 *   M7  any path: count the transition without persisting it (drop the UPDATE)
 *   M8  any path: reintroduce a phantom column in a payload or select list
 */

// ─────────────────────────────────────────────────────────────────────────────
// Deployed schema — asserted explicitly so this fixture is self-documenting.
// ─────────────────────────────────────────────────────────────────────────────

const DEPLOYED_QUEUE_JOBS_COLUMNS: string[] = [
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

const DEPLOYED_DLQ_COLUMNS: string[] = [
  'id',
  'scheduled_post_id',
  'queue_job_id',
  'failure_count',
  'last_error_code',
  'last_error_message',
  'first_failed_at',
  'last_failed_at',
  'status',
  'poisoned_reason',
  'metadata',
];

const SCHEMA: Record<string, Set<string>> = {
  queue_jobs: new Set(DEPLOYED_QUEUE_JOBS_COLUMNS),
  creator_dead_letter_jobs: new Set(DEPLOYED_DLQ_COLUMNS),
};

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

// ─────────────────────────────────────────────────────────────────────────────
// Mutable fixture state (module-scope `let` — the mock factories below only run
// lazily when the service is `await import`ed inside a test, so these are
// initialised by then).
// ─────────────────────────────────────────────────────────────────────────────

type Stmt = {
  kind: 'select' | 'update' | 'insert';
  table: string;
  columns: string[];
  rejected: boolean;
  rejectedColumns: string[];
  matchedIds: string[];
};

let queueJobs: Array<Record<string, any>> = [];
let dlqRows: Array<Record<string, any>> = [];
let bullJobs: Set<string> = new Set();
let statements: Stmt[] = [];
/** Row id -> number of times a payload was actually applied to it. */
let mutationsById: Record<string, number> = {};
/** Force a transport-level failure on a schema-VALID statement. */
let injectedError: { table: string; kind: 'select' | 'update'; error: any } | null = null;

function pgUndefinedColumn(table: string, column: string) {
  return {
    code: '42703',
    message: `column ${table}.${column} does not exist`,
    details: null,
    hint: null,
  };
}

function unknownColumns(table: string, cols: string[]): string[] {
  const known = SCHEMA[table];
  if (!known) return [];
  return cols.filter((c) => c && c !== '*' && !known.has(c));
}

function parseSelect(spec: string | undefined): string[] {
  if (!spec || spec.trim() === '*') return ['*'];
  return spec.split(',').map((s) => s.trim()).filter(Boolean);
}

function tableRows(table: string): Array<Record<string, any>> {
  if (table === 'queue_jobs') return queueJobs;
  if (table === 'creator_dead_letter_jobs') return dlqRows;
  return [];
}

type Filter = { op: 'eq' | 'in' | 'lt' | 'gt' | 'lte' | 'gte' | 'neq'; key: string; value: any };

function applyFilters(rows: Array<Record<string, any>>, filters: Filter[]): Array<Record<string, any>> {
  return rows.filter((r) =>
    filters.every((f) => {
      const v = r[f.key];
      switch (f.op) {
        case 'eq': return v === f.value;
        case 'neq': return v !== f.value;
        case 'in': return Array.isArray(f.value) && f.value.includes(v);
        case 'lt': return v != null && v < f.value;
        case 'lte': return v != null && v <= f.value;
        case 'gt': return v != null && v > f.value;
        case 'gte': return v != null && v >= f.value;
        default: return true;
      }
    }),
  );
}

/** Seed helper — refuses columns outside the deployed set so tests cannot lie. */
function seedQueueJob(row: Record<string, any>): void {
  const bad = unknownColumns('queue_jobs', Object.keys(row));
  if (bad.length > 0) {
    throw new Error(`test seeded phantom queue_jobs column(s): ${bad.join(', ')}`);
  }
  queueJobs.push({ ...row });
}

function rowById(id: string): Record<string, any> | undefined {
  return queueJobs.find((r) => r.id === id);
}

function phantomStatements(): Stmt[] {
  return statements.filter((s) => s.rejectedColumns.length > 0);
}

function queueJobUpdates(): Stmt[] {
  return statements.filter((s) => s.table === 'queue_jobs' && s.kind === 'update');
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake read path — models PostgREST column validation.
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      let columns: string[] = ['*'];
      const filters: Filter[] = [];
      let orderBy: { key: string; ascending: boolean } | null = null;
      let limitN: number | null = null;

      function run(): { data: any; error: any } {
        const named = [...columns, ...filters.map((f) => f.key)];
        if (orderBy) named.push(orderBy.key);
        const bad = unknownColumns(table, named);
        const stmt: Stmt = {
          kind: 'select',
          table,
          columns: Array.from(new Set(named)),
          rejected: bad.length > 0,
          rejectedColumns: bad,
          matchedIds: [],
        };
        statements.push(stmt);
        if (bad.length > 0) {
          // PostgREST rejects the whole statement; nothing is read.
          return { data: null, error: pgUndefinedColumn(table, bad[0]) };
        }
        if (injectedError && injectedError.table === table && injectedError.kind === 'select') {
          return { data: null, error: injectedError.error };
        }
        let rows = applyFilters(tableRows(table), filters).map((r) => ({ ...r }));
        if (orderBy) {
          const { key, ascending } = orderBy;
          rows = rows.slice().sort((a, b) => {
            const av = a[key];
            const bv = b[key];
            if (av === bv) return 0;
            const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1;
            return ascending ? cmp : -cmp;
          });
        }
        if (limitN != null) rows = rows.slice(0, limitN);
        stmt.matchedIds = rows.map((r) => r.id);
        return { data: rows, error: null };
      }

      const api: any = {
        select: (spec?: string) => { columns = parseSelect(spec); return api; },
        eq: (k: string, v: any) => { filters.push({ op: 'eq', key: k, value: v }); return api; },
        neq: (k: string, v: any) => { filters.push({ op: 'neq', key: k, value: v }); return api; },
        in: (k: string, v: any[]) => { filters.push({ op: 'in', key: k, value: v }); return api; },
        lt: (k: string, v: any) => { filters.push({ op: 'lt', key: k, value: v }); return api; },
        lte: (k: string, v: any) => { filters.push({ op: 'lte', key: k, value: v }); return api; },
        gt: (k: string, v: any) => { filters.push({ op: 'gt', key: k, value: v }); return api; },
        gte: (k: string, v: any) => { filters.push({ op: 'gte', key: k, value: v }); return api; },
        order: (k: string, opts?: { ascending?: boolean }) => {
          orderBy = { key: k, ascending: opts?.ascending !== false };
          return api;
        },
        limit: (n: number) => { limitN = n; return api; },
        maybeSingle: async () => {
          const res = run();
          if (res.error) return { data: null, error: res.error };
          return { data: (res.data as any[])[0] ?? null, error: null };
        },
        single: async () => {
          const res = run();
          if (res.error) return { data: null, error: res.error };
          return { data: (res.data as any[])[0] ?? null, error: null };
        },
        then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
      };
      return api;
    }),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Fake write path — same column validation, applied to UPDATE/INSERT payloads.
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => {
    let payload: any = null;
    const filters: Filter[] = [];

    function run(): { data: any; error: any } {
      const named = [...Object.keys(payload ?? {}), ...filters.map((f) => f.key)];
      const bad = unknownColumns(table, named);
      const stmt: Stmt = {
        kind: 'update',
        table,
        columns: Array.from(new Set(named)),
        rejected: bad.length > 0,
        rejectedColumns: bad,
        matchedIds: [],
      };
      statements.push(stmt);
      if (bad.length > 0) {
        // Whole statement rejected — NOTHING is mutated.
        return { data: null, error: pgUndefinedColumn(table, bad[0]) };
      }
      if (injectedError && injectedError.table === table && injectedError.kind === 'update') {
        return { data: null, error: injectedError.error };
      }
      const targets = applyFilters(tableRows(table), filters);
      for (const row of targets) {
        Object.assign(row, payload);
        mutationsById[row.id] = (mutationsById[row.id] ?? 0) + 1;
      }
      stmt.matchedIds = targets.map((r) => r.id);
      return { data: null, error: null };
    }

    const api: any = {
      insert: async (row: any) => {
        const bad = unknownColumns(table, Object.keys(row ?? {}));
        statements.push({
          kind: 'insert',
          table,
          columns: Object.keys(row ?? {}),
          rejected: bad.length > 0,
          rejectedColumns: bad,
          matchedIds: [],
        });
        if (bad.length > 0) return { data: null, error: pgUndefinedColumn(table, bad[0]) };
        const id = `${table}-${tableRows(table).length + 1}`;
        tableRows(table).push({ id, ...row });
        return { data: null, error: null };
      },
      update: (p: any) => { payload = p; return api; },
      eq: (k: string, v: any) => { filters.push({ op: 'eq', key: k, value: v }); return api; },
      in: (k: string, v: any[]) => { filters.push({ op: 'in', key: k, value: v }); return api; },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    };
    return api;
  }),
}));

jest.mock('../../queue/bullmqClient', () => ({
  getQueue: jest.fn(() => ({
    getJob: jest.fn(async (id: string) =>
      bullJobs.has(id) ? { remove: async () => { bullJobs.delete(id); } } : null),
    add: jest.fn(),
  })),
  getEngagementPollingQueue: jest.fn(() => ({ add: jest.fn() })),
}));

const warnSpy = jest.fn();
jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), warn: (...args: any[]) => warnSpy(...args), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: {
    QUEUE_JOB_POISONED: 'queue_job_poisoned',
    QUEUE_DRIFT_DETECTED: 'queue_drift_detected',
  },
}));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));

type Svc = typeof import('../../services/creatorQueueReliabilityService');
async function loadService(): Promise<Svc> {
  return (await import('../../services/creatorQueueReliabilityService')) as Svc;
}

const ISO = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe('creatorQueueReliabilityService — adversarial schema-faithful verification', () => {
  beforeEach(() => {
    queueJobs = [];
    dlqRows = [];
    bullJobs = new Set();
    statements = [];
    mutationsById = {};
    injectedError = null;
    warnSpy.mockClear();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Fixture integrity. These two are EXPECTED to pass on broken main — they
  // test the fixture, not the service. They exist so that a green suite after
  // the repair cannot be explained by "the fixture stopped checking".
  // ───────────────────────────────────────────────────────────────────────────

  test('FIXTURE: deployed queue_jobs column set is exactly the probed set and excludes last_error', () => {
    expect(DEPLOYED_QUEUE_JOBS_COLUMNS).toHaveLength(16);
    expect(SCHEMA.queue_jobs.has('last_error')).toBe(false);
    expect(SCHEMA.queue_jobs.has('error_message')).toBe(true);
    expect(SCHEMA.queue_jobs.has('error_code')).toBe(true);
  });

  test('FIXTURE: a phantom column rejects the whole statement and mutates nothing', async () => {
    seedQueueJob({ id: 'fx-1', scheduled_post_id: 'sp-fx', status: 'pending', updated_at: ISO(0) });
    const { ownedDbTable } = await import('../../db/writeOwner');
    const res: any = await (ownedDbTable('queue_jobs') as any)
      .update({ status: 'cancelled', last_error: 'nope', updated_at: ISO(0) })
      .eq('id', 'fx-1');
    expect(res.error).toBeTruthy();
    expect(res.error.code).toBe('42703');
    // status untouched, and no partial application of the valid keys
    expect(rowById('fx-1')!.status).toBe('pending');
    expect(mutationsById['fx-1']).toBeUndefined();

    const { supabase } = await import('../../db/supabaseClient');
    const sel: any = await (supabase.from('queue_jobs') as any).select('id, last_error').eq('id', 'fx-1');
    expect(sel.data).toBeNull();
    expect(sel.error.code).toBe('42703');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T1 — the direct phantom-column detector.
  // ───────────────────────────────────────────────────────────────────────────

  test('T1: no queue_jobs statement names a column outside the deployed set', async () => {
    const svc = await loadService();

    seedQueueJob({ id: 'q1', scheduled_post_id: 'sp1', status: 'pending', updated_at: ISO(0), attempts: 0 });
    seedQueueJob({ id: 'q2', scheduled_post_id: 'sp1', status: 'pending', updated_at: ISO(60_000), attempts: 0 });
    seedQueueJob({ id: 'q3', scheduled_post_id: 'sp2', status: 'processing', updated_at: ISO(60 * 60 * 1000), attempts: 1 });
    seedQueueJob({ id: 'q4', scheduled_post_id: 'sp3', status: 'processing', updated_at: ISO(60 * 60 * 1000), attempts: 9 });

    // Exercise every write path plus the stuck-recovery read path.
    await svc.routeToDeadLetterQueue({
      scheduledPostId: 'sp1', queueJobId: 'q1', errorCode: 'E', errorMessage: 'm',
      failureCount: 5, reason: 'poison_threshold_exceeded',
    });
    await svc.reconcileDuplicateQueueJobs('sp1');
    await svc.sweepQueueDrift({ maxScan: 100 });
    await svc.recoverStuckProcessingJobs({ staleMinutes: 15 });

    const offenders = phantomStatements().map((s) => ({
      table: s.table, kind: s.kind, bad: s.rejectedColumns, named: s.columns,
    }));
    expect(offenders).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T2 — DLQ routing must actually free the slot.
  // ───────────────────────────────────────────────────────────────────────────

  test('T2: routeToDeadLetterQueue persists status=cancelled on the live queue_jobs row', async () => {
    const svc = await loadService();
    seedQueueJob({ id: 'q-dlq', scheduled_post_id: 'sp-dlq', status: 'pending', updated_at: ISO(0), attempts: 4 });
    bullJobs.add('q-dlq');

    await svc.routeToDeadLetterQueue({
      scheduledPostId: 'sp-dlq', queueJobId: 'q-dlq', errorCode: 'BOOM', errorMessage: 'exploded',
      failureCount: 5, reason: 'poison_threshold_exceeded',
    });

    expect(dlqRows).toHaveLength(1);
    expect(rowById('q-dlq')!.status).toBe('cancelled');
    expect(bullJobs.has('q-dlq')).toBe(false);

    // The poisoning diagnostic must survive into a real column, not be dropped.
    const upd = queueJobUpdates().filter((s) => !s.rejected);
    expect(upd.length).toBeGreaterThan(0);
    const carriesReason = queueJobs.some((r) =>
      JSON.stringify(r).includes('poison'));
    expect(carriesReason).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T3 — duplicate reconciliation: newest wins, older live rows really cancel.
  // ───────────────────────────────────────────────────────────────────────────

  test('T3: reconcileDuplicateQueueJobs keeps the NEWEST live row and persists cancellation of the rest', async () => {
    const svc = await loadService();
    seedQueueJob({ id: 'old', scheduled_post_id: 'sp-d', status: 'pending', updated_at: '2026-01-01T00:00:00.000Z' });
    seedQueueJob({ id: 'mid', scheduled_post_id: 'sp-d', status: 'pending', updated_at: '2026-01-01T01:00:00.000Z' });
    seedQueueJob({ id: 'new', scheduled_post_id: 'sp-d', status: 'processing', updated_at: '2026-01-01T02:00:00.000Z' });

    const collapsed = await svc.reconcileDuplicateQueueJobs('sp-d');

    expect(collapsed).toBe(2);
    expect(rowById('new')!.status).toBe('processing');   // winner untouched
    expect(rowById('old')!.status).toBe('cancelled');
    expect(rowById('mid')!.status).toBe('cancelled');
    expect(mutationsById['new']).toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T4 — idempotence after convergence.
  // ───────────────────────────────────────────────────────────────────────────

  test('T4: a second reconciliation after convergence is a no-op', async () => {
    const svc = await loadService();
    seedQueueJob({ id: 'i-old', scheduled_post_id: 'sp-i', status: 'pending', updated_at: '2026-01-01T00:00:00.000Z' });
    seedQueueJob({ id: 'i-new', scheduled_post_id: 'sp-i', status: 'pending', updated_at: '2026-01-01T02:00:00.000Z' });

    const first = await svc.reconcileDuplicateQueueJobs('sp-i');
    expect(first).toBe(1);
    expect(rowById('i-old')!.status).toBe('cancelled');

    const updatesAfterFirst = queueJobUpdates().length;
    const mutationsAfterFirst = { ...mutationsById };

    const second = await svc.reconcileDuplicateQueueJobs('sp-i');

    expect(second).toBe(0);
    expect(mutationsById).toEqual(mutationsAfterFirst);
    expect(queueJobUpdates().length).toBe(updatesAfterFirst);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T5 — terminal rows are never re-touched.
  // ───────────────────────────────────────────────────────────────────────────

  test('T5: reconciliation never targets completed/failed/cancelled rows', async () => {
    const svc = await loadService();
    seedQueueJob({ id: 't-done', scheduled_post_id: 'sp-t', status: 'completed', updated_at: '2026-01-01T05:00:00.000Z' });
    seedQueueJob({ id: 't-fail', scheduled_post_id: 'sp-t', status: 'failed', updated_at: '2026-01-01T04:00:00.000Z' });
    seedQueueJob({ id: 't-canc', scheduled_post_id: 'sp-t', status: 'cancelled', updated_at: '2026-01-01T03:00:00.000Z' });
    seedQueueJob({ id: 't-live-old', scheduled_post_id: 'sp-t', status: 'pending', updated_at: '2026-01-01T01:00:00.000Z' });
    seedQueueJob({ id: 't-live-new', scheduled_post_id: 'sp-t', status: 'pending', updated_at: '2026-01-01T02:00:00.000Z' });

    const collapsed = await svc.reconcileDuplicateQueueJobs('sp-t');

    expect(collapsed).toBe(1);
    expect(rowById('t-live-old')!.status).toBe('cancelled');
    expect(rowById('t-live-new')!.status).toBe('pending');
    for (const id of ['t-done', 't-fail', 't-canc']) {
      expect(mutationsById[id]).toBeUndefined();
    }
    // Belt and braces: no statement matched a terminal row.
    const touchedTerminal = statements
      .filter((s) => s.kind === 'update' && s.table === 'queue_jobs')
      .flatMap((s) => s.matchedIds)
      .filter((id) => TERMINAL_STATUSES.includes(String(rowById(id)?.status)) && id !== 't-live-old');
    expect(touchedTerminal).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T6 — drift sweep must persist what it counts.
  // ───────────────────────────────────────────────────────────────────────────

  test('T6: sweepQueueDrift persists the cancellation it reports', async () => {
    const svc = await loadService();
    seedQueueJob({ id: 'd-live', scheduled_post_id: 'sp-dr', status: 'pending', updated_at: ISO(120_000) });
    seedQueueJob({ id: 'd-gone', scheduled_post_id: 'sp-dr2', status: 'pending', updated_at: ISO(60_000) });
    bullJobs.add('d-live');

    const res = await svc.sweepQueueDrift({ maxScan: 100 });

    expect(res.scanned).toBe(2);
    expect(res.drift_found).toBe(1);
    expect(res.drift_cancelled).toBe(1);
    // The reported count must correspond to a real transition.
    expect(rowById('d-gone')!.status).toBe('cancelled');
    expect(rowById('d-live')!.status).toBe('pending');
    const cancelledInStore = queueJobs.filter((r) => r.status === 'cancelled').length;
    expect(cancelledInStore).toBe(res.drift_cancelled);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T7 — stuck recovery: stale recovers with retry semantics, fresh untouched.
  // ───────────────────────────────────────────────────────────────────────────

  test('T7: recoverStuckProcessingJobs requeues only genuinely stale rows and increments attempts', async () => {
    const svc = await loadService();
    seedQueueJob({
      id: 's-stale', scheduled_post_id: 'sp-s1', status: 'processing',
      attempts: 1, max_attempts: 5, updated_at: ISO(45 * 60 * 1000),
    });
    seedQueueJob({
      id: 's-fresh', scheduled_post_id: 'sp-s2', status: 'processing',
      attempts: 0, max_attempts: 5, updated_at: ISO(60 * 1000),
    });
    seedQueueJob({
      id: 's-pending', scheduled_post_id: 'sp-s3', status: 'pending',
      attempts: 0, max_attempts: 5, updated_at: ISO(45 * 60 * 1000),
    });

    const res = await svc.recoverStuckProcessingJobs({ staleMinutes: 15 });

    expect(res.scanned).toBe(1);
    expect(res.recovered).toBe(1);
    expect(res.routed_to_dlq).toBe(0);

    // DISPOSITION NOTE. This originally asserted 'pending', on the assumption
    // that "recovery" means putting the row back on the queue. That assumption
    // is wrong against this codebase, and the repair correctly rejects it:
    //
    //   - nothing consumes `queue_jobs.status='pending'` as work.
    //     findDuePostsAndEnqueue selects from scheduled_posts
    //     (.eq('status','scheduled').lte('scheduled_for', now)) and reads
    //     queue_jobs ONLY into the suppression set — so a row parked at
    //     'pending' is never executed AND permanently blocks a replacement
    //     job for that post.
    //   - publishProcessor keys its 5-minute replay guard on
    //     `queueJob.status === 'processing'`. Writing 'pending' over it
    //     destroys the only job-level duplicate guard there is.
    //
    // Cancelling is the correct terminal disposition: it releases the
    // suppression so the still-'scheduled' post gets a fresh job next cycle,
    // and the dead executor is unhooked only after a read-back proves the row
    // is terminal. Both claims above were verified against the source.
    expect(rowById('s-stale')!.status).toBe('cancelled');
    // Retry semantics are still preserved across the transition.
    expect(rowById('s-stale')!.attempts).toBe(2);

    expect(rowById('s-fresh')!.status).toBe('processing');
    expect(rowById('s-fresh')!.attempts).toBe(0);
    expect(mutationsById['s-fresh']).toBeUndefined();
    expect(mutationsById['s-pending']).toBeUndefined();
  });

  test('T8: recoverStuckProcessingJobs routes to DLQ once attempts reach the poison threshold', async () => {
    const svc = await loadService();
    seedQueueJob({
      id: 's-poison', scheduled_post_id: 'sp-p', status: 'processing',
      attempts: 4, max_attempts: 5, updated_at: ISO(45 * 60 * 1000),
    });

    const res = await svc.recoverStuckProcessingJobs({ staleMinutes: 15 });

    expect(res.scanned).toBe(1);
    expect(res.routed_to_dlq).toBe(1);
    expect(res.recovered).toBe(0);
    expect(dlqRows).toHaveLength(1);
    expect(rowById('s-poison')!.status).toBe('cancelled');
  });

  test('T8b: dryRun scans without mutating anything', async () => {
    const svc = await loadService();
    seedQueueJob({
      id: 's-dry', scheduled_post_id: 'sp-dry', status: 'processing',
      attempts: 1, max_attempts: 5, updated_at: ISO(45 * 60 * 1000),
    });

    const res = await svc.recoverStuckProcessingJobs({ staleMinutes: 15, dryRun: true });

    expect(res.scanned).toBe(1);
    expect(res.recovered).toBe(0);
    expect(mutationsById['s-dry']).toBeUndefined();
    expect(rowById('s-dry')!.status).toBe('processing');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T9 — a DB error must never be reported as "nothing found".
  // ───────────────────────────────────────────────────────────────────────────

  test('T9a: recoverStuckProcessingJobs surfaces a read failure rather than reporting a clean empty scan', async () => {
    const svc = await loadService();
    seedQueueJob({
      id: 'e-1', scheduled_post_id: 'sp-e', status: 'processing',
      attempts: 1, max_attempts: 5, updated_at: ISO(45 * 60 * 1000),
    });
    injectedError = {
      table: 'queue_jobs', kind: 'select',
      error: { code: '57P01', message: 'terminating connection due to administrator command' },
    };

    let threw = false;
    let res: any = null;
    try {
      res = await svc.recoverStuckProcessingJobs({ staleMinutes: 15 });
    } catch {
      threw = true;
    }

    // The failure must be OBSERVABLE somewhere: thrown, logged, or carried on
    // the result. What is forbidden is a silent zero indistinguishable from a
    // genuinely empty scan. (Broken main does none of these: the `{ data: null,
    // error }` return is discarded and `scanned: 0` is reported as success.)
    const errorSurfaced =
      threw ||
      warnSpy.mock.calls.length > 0 ||
      (!!res && (Object.prototype.hasOwnProperty.call(res, 'error') ||
                 Object.prototype.hasOwnProperty.call(res, 'failed')));
    expect(errorSurfaced).toBe(true);
  });

  test('T9b: sweepQueueDrift surfaces a read failure rather than reporting a clean empty sweep', async () => {
    const svc = await loadService();
    seedQueueJob({ id: 'e-2', scheduled_post_id: 'sp-e2', status: 'pending', updated_at: ISO(60_000) });
    injectedError = {
      table: 'queue_jobs', kind: 'select',
      error: { code: '57P01', message: 'terminating connection due to administrator command' },
    };

    let threw = false;
    try {
      await svc.sweepQueueDrift({ maxScan: 100 });
    } catch {
      threw = true;
    }
    expect(threw || warnSpy.mock.calls.length > 0).toBe(true);
  });

  test('T9c: reconcileDuplicateQueueJobs surfaces a write failure rather than reporting success', async () => {
    const svc = await loadService();
    seedQueueJob({ id: 'w-old', scheduled_post_id: 'sp-w', status: 'pending', updated_at: '2026-01-01T00:00:00.000Z' });
    seedQueueJob({ id: 'w-new', scheduled_post_id: 'sp-w', status: 'pending', updated_at: '2026-01-01T02:00:00.000Z' });
    injectedError = {
      table: 'queue_jobs', kind: 'update',
      error: { code: '55P03', message: 'lock not available' },
    };

    let threw = false;
    let collapsed = -1;
    try {
      collapsed = await svc.reconcileDuplicateQueueJobs('sp-w');
    } catch {
      threw = true;
    }

    // Nothing actually changed, so the service must not claim it collapsed a row.
    expect(rowById('w-old')!.status).toBe('pending');
    expect(threw || collapsed === 0).toBe(true);
    expect(threw || warnSpy.mock.calls.length > 0).toBe(true);
  });
});

// PB-010: mark this suite as a MODULE for tsc so its top-level declarations do
// not collide with identically named declarations in sibling suites.
export {};
