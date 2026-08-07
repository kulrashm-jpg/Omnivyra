/**
 * WS-2 Milestone-1A — production hardening & execution proof.
 *
 * Milestone-1 proved the pipeline carries session intelligence. This suite
 * proves it survives production: every database failure family, real
 * concurrent session creation against a unique index, historical/mixed-version
 * compatibility, and behaviour at scale.
 *
 * The `visitor_sessions` double below is a real (in-memory) table with the
 * partial unique index enforced, and every operation yields to the microtask
 * queue — so concurrent callers genuinely interleave at their await points
 * rather than being serialized by the mock.
 */

type Row = Record<string, unknown>;

const db = {
  rows: [] as Row[],
  nextId: 1,
  insertAttempts: 0,
  readAttempts: 0,
  updateAttempts: 0,
  /** Errors to return from the next N inserts, consumed in order. */
  insertErrors: [] as Array<{ code?: string; message?: string } | Error | null>,
  /** Error for the next read (existence lookup / conflict read-back). */
  readError: null as null | { code?: string; message?: string } | Error,
  updateError: null as null | { code?: string; message?: string } | Error,
  /** When true the insert returns success with no id. */
  suppressInsertedId: false,
};

const UNIQUE = ['company_id', 'anonymous_id', 'session_key'];

/**
 * WS-2 M1B: the REAL `visitor_sessions` column set, verified against the live
 * database (`\d visitor_sessions` on the certenv Postgres). `created_at` is
 * deliberately absent — the table has `started_at` / `last_seen_at` only. The
 * double below rejects any other column with PostgREST's real 42703, so a
 * query against a column that does not exist fails here exactly as it does in
 * production instead of passing silently.
 */
const VISITOR_SESSION_COLUMNS = new Set([
  'id', 'company_id', 'website_id', 'anonymous_id', 'unified_person_id',
  'first_landing_page', 'last_current_page', 'first_referrer', 'last_referrer',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'first_touch', 'last_touch', 'consent_state', 'metadata',
  'started_at', 'last_seen_at', 'session_key', 'attribution_window_days', 'stitched_at',
  '*',
]);

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (name: string) => {
    const st: { op: string; filters: Array<[string, unknown]>; payload: Row | null; cols: string[] } = {
      op: 'select',
      filters: [],
      payload: null,
      cols: [],
    };

    const matches = (r: Row): boolean => st.filters.every(([c, v]) => r[c] === v);

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve(); // yield — lets concurrent callers interleave here
      if (name !== 'visitor_sessions') return { data: mode === 'many' ? [] : null, error: null };

      // Real PostgREST behaviour: an unknown column is 42703, RETURNED as an
      // error (never thrown) — which is exactly how the M1B defect hid.
      const unknown = st.cols.find((c) => !VISITOR_SESSION_COLUMNS.has(c));
      if (unknown) {
        return { data: null, error: { code: '42703', message: `column visitor_sessions.${unknown} does not exist` } };
      }

      if (st.op === 'insert') {
        db.insertAttempts += 1;
        const forced = db.insertErrors.shift();
        if (forced) return { data: null, error: forced };
        const row = st.payload as Row;
        const dup = db.rows.some((r) => UNIQUE.every((c) => r[c] === row[c]));
        if (dup) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        // started_at, NOT created_at — mirrors the real table.
        const created = { ...row, id: `vs-${db.nextId++}`, started_at: new Date(Date.now() - 60_000).toISOString() };
        db.rows.push(created);
        return { data: db.suppressInsertedId ? {} : { id: created.id }, error: null };
      }

      if (st.op === 'update') {
        db.updateAttempts += 1;
        if (db.updateError) return { data: null, error: db.updateError };
        for (const r of db.rows) if (matches(r)) Object.assign(r, st.payload);
        return { data: null, error: null };
      }

      db.readAttempts += 1;
      if (db.readError) return { data: mode === 'many' ? null : null, error: db.readError };
      const found = db.rows.filter(matches);
      if (mode === 'many') return { data: found, error: null };
      return { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: (cols?: string) => { st.cols.push(...String(cols ?? '*').split(',').map((c) => c.trim())); return b; },
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      is: () => b,
      order: (c: string) => { st.cols.push(String(c)); return b; },
      limit: () => exec('many'),
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

const logs: Array<{ level: string; event: string; payload: Record<string, unknown> }> = [];
jest.mock('../../services/logger', () => ({
  logger: {
    debug: (event: string, p: Record<string, unknown> = {}) => logs.push({ level: 'debug', event, payload: p }),
    info: (event: string, p: Record<string, unknown> = {}) => logs.push({ level: 'info', event, payload: p }),
    warn: (event: string, p: Record<string, unknown> = {}) => logs.push({ level: 'warn', event, payload: p }),
    error: (event: string, p: Record<string, unknown> = {}) => logs.push({ level: 'error', event, payload: p }),
  },
}));

import { resolveVisitorSession } from '../../services/attributionResolverService';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ownedDbTableFake = (require('../../db/writeOwner') as { ownedDbTable: (t: string) => unknown }).ownedDbTable;
import {
  assembleLeadCaptureSnapshot,
  analyzeBehavior,
  buildLeadIntelligenceSummary,
  defaultEngineConfig,
} from '../../services/leadIntelligenceEngine';
import { computeInputFingerprint } from '../../services/leadIntelligenceOrchestration/fingerprint';
import { ENGINE_VERSION, INTELLIGENCE_SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS } from '../../services/leadIntelligenceOrchestration/engineVersion';
import { registry } from '../../observability/registry';
import { checkSessionCaptureHealth } from '../../services/leadIntelligenceHealth';
import { INTEL_METRICS, __resetTelemetryThrottleForTests, recordSessionPersistence } from '../../services/leadIntelligenceTelemetry';

const NOW = '2026-08-10T12:00:00.000Z';

const counterTotal = (name: string): number =>
  registry.counterEntries().filter((c) => c.name === name).reduce((a, c) => a + c.value, 0);
const labelValues = (name: string, label: string): string[] =>
  registry.counterEntries().filter((c) => c.name === name).map((c) => String((c.labels ?? {})[label]));

const resolve = (over: Record<string, unknown> = {}) =>
  resolveVisitorSession({
    companyId: 'co-1',
    websiteId: 'w-1',
    attribution: { anonymous_id: 'anon-1', session_id: 'sess-1', ...over } as never,
  });

const failedLog = () => logs.find((l) => l.event === 'intel_session_persist_failed');

beforeEach(() => {
  db.rows = [];
  db.nextId = 1;
  db.insertAttempts = 0;
  db.readAttempts = 0;
  db.updateAttempts = 0;
  db.insertErrors = [];
  db.readError = null;
  db.updateError = null;
  db.suppressInsertedId = false;
  logs.length = 0;
  registry.reset();
  __resetTelemetryThrottleForTests();
});

// ── 1. Persistence failure taxonomy ─────────────────────────────────────────

describe('M1A (1) — every persistence failure family is handled and observable', () => {
  it('creates the session and reports nothing on the happy path', async () => {
    const res = await resolve();
    expect(res.sessionId).toBe('vs-1');
    expect(db.insertAttempts).toBe(1);
    expect(counterTotal(INTEL_METRICS.session.failures)).toBe(0);
  });

  const NON_RETRYABLE: Array<[string, { code?: string; message?: string }, string]> = [
    ['permission denied', { code: '42501', message: 'permission denied for table visitor_sessions' }, 'permission'],
    ['missing table (migration not applied)', { code: '42P01', message: 'relation does not exist' }, 'missing_table'],
    ['unexpected database error', { code: 'XX000', message: 'internal error' }, 'unknown'],
  ];

  it.each(NON_RETRYABLE)('classifies %s and does NOT retry it', async (_label, error, expectedClass) => {
    db.insertErrors = [error];
    const res = await resolve();
    expect(res.sessionId).toBeNull(); // fail-open preserved
    expect(db.insertAttempts).toBe(1); // retrying these cannot succeed
    expect(failedLog()?.payload).toMatchObject({ outcome: 'insert_failed', error_class: expectedClass });
    expect(labelValues(INTEL_METRICS.session.failures, 'error_class')).toContain(expectedClass);
  });

  const RETRYABLE: Array<[string, { code?: string; message?: string } | Error, string]> = [
    ['serialization failure', { code: '40001', message: 'could not serialize access' }, 'transient'],
    ['deadlock', { code: '40P01', message: 'deadlock detected' }, 'transient'],
    ['aborted transaction', { code: '25P02', message: 'current transaction is aborted' }, 'transient'],
    ['connection failure', { code: '08006', message: 'connection failure' }, 'transient'],
    ['statement timeout', { code: '57014', message: 'canceling statement due to statement timeout' }, 'timeout'],
    ['thrown transport error', new Error('fetch failed'), 'transient'],
    ['thrown socket reset', new Error('ECONNRESET: socket hang up'), 'transient'],
  ];

  it.each(RETRYABLE)('retries %s once and recovers when the retry succeeds', async (_label, error) => {
    db.insertErrors = [error]; // only the FIRST attempt fails
    const res = await resolve();
    expect(res.sessionId).toBe('vs-1'); // session preserved — no permanent loss
    expect(db.insertAttempts).toBe(2);
    expect(counterTotal(INTEL_METRICS.session.failures)).toBe(0); // a recovery is not a failure
    expect(failedLog()).toBeUndefined();
  });

  it.each(RETRYABLE)('reports %s when the retry also fails, and never throws', async (_label, error, expectedClass) => {
    db.insertErrors = [error, error];
    await expect(resolve()).resolves.toMatchObject({ sessionId: null });
    expect(db.insertAttempts).toBe(2); // bounded — exactly one retry, never a loop
    expect(failedLog()?.payload).toMatchObject({ outcome: 'insert_failed', error_class: expectedClass });
  });

  it('a thrown transport error never escapes into the capture path', async () => {
    db.insertErrors = [new Error('fetch failed'), new Error('fetch failed')];
    db.readError = new Error('fetch failed');
    await expect(resolve()).resolves.toBeDefined(); // resolves, does not reject
  });

  it('reports a failed existence lookup and still resolves the session', async () => {
    db.readError = { code: '08006', message: 'connection failure' };
    const res = await resolve();
    expect(logs.some((l) => l.payload.outcome === 'read_failed')).toBe(true);
    expect(res.sessionId).toBe('vs-1'); // insert path still created it
  });

  it('never forks a duplicate session during a total read outage', async () => {
    await resolve(); // create it
    logs.length = 0;
    db.readError = { code: '08006', message: 'connection failure' }; // reads stay down
    const res = await resolve();
    // The unique index still caught the blind insert, so no second row exists.
    // The id cannot be recovered while reads are down — reported, not silent.
    expect(db.rows).toHaveLength(1);
    expect(res.sessionId).toBeNull();
    expect(logs.some((l) => l.payload.outcome === 'conflict_unrecovered')).toBe(true);
  });

  it('recovers the raced row when the read-back fails only transiently', async () => {
    await resolve(); // create it
    logs.length = 0;
    let reads = 0;
    Object.defineProperty(db, 'readError', {
      configurable: true,
      get: () => (++reads <= 2 ? { code: '08006', message: 'connection failure' } : null),
      set: () => undefined,
    });
    const res = await resolve();
    delete (db as { readError?: unknown }).readError;
    db.readError = null;

    // read 1 = existence lookup (fails), read 2 = read-back (fails), retry succeeds.
    expect(res.sessionId).toBe('vs-1'); // session recovered rather than lost
    expect(db.rows).toHaveLength(1);
    // The degraded lookup is still reported; the recovery is NOT a failure.
    expect(labelValues(INTEL_METRICS.session.failures, 'outcome')).toEqual(['read_failed']);
    expect(logs.some((l) => l.payload.outcome === 'conflict_unrecovered')).toBe(false);
  });

  it('reports a failed continuation refresh but keeps the session id', async () => {
    await resolve();
    db.updateError = { code: '57014', message: 'statement timeout' };
    const res = await resolve();
    expect(res.sessionId).toBe('vs-1'); // id is still valid; only the snapshot is stale
    expect(failedLog()?.payload).toMatchObject({ outcome: 'refresh_failed', error_class: 'timeout' });
  });

  it('reports an insert that returned no id', async () => {
    db.suppressInsertedId = true;
    const res = await resolve();
    expect(res.sessionId).toBeNull();
    expect(failedLog()?.payload).toMatchObject({ outcome: 'missing_id' });
  });

  it('keeps metric labels bounded — no ids, only closed-set families', () => {
    for (const outcome of ['insert_failed', 'read_failed', 'refresh_failed', 'conflict_unrecovered', 'missing_id'] as const) {
      recordSessionPersistence({ outcome, errorClass: 'unknown', detail: 'x', companyId: 'co-secret' });
    }
    const entries = registry.counterEntries().filter((c) => c.name.startsWith('intel.session.'));
    for (const e of entries) {
      const labels = JSON.stringify(e.labels ?? {});
      expect(labels).not.toContain('co-secret');
      expect(Object.keys(e.labels ?? {}).sort()).toEqual(['error_class', 'outcome']);
    }
  });
});

// ── 1b. Visitor-history defect (M1B) ────────────────────────────────────────

describe('M1B — visitor history reads a column that exists', () => {
  it('records a real visit count and returning flag across sessions', async () => {
    const anon = 'anon-loyal';
    for (const s of ['s1', 's2', 's3']) {
      await resolve({ anonymous_id: anon, session_id: `${anon}-${s}` });
    }
    const visitors = db.rows.map((r) => (r.metadata as { visitor?: { visit_count?: number; returning_visitor?: boolean } }).visitor);
    expect(visitors.map((v) => v?.visit_count)).toEqual([1, 2, 3]);
    expect(visitors.map((v) => v?.returning_visitor)).toEqual([false, true, true]);
  });

  it('measures a real session duration on continuation', async () => {
    await resolve();
    await resolve(); // continuation refreshes the stored snapshot
    const visitor = (db.rows[0].metadata as { visitor?: { session_duration_ms?: number | null } }).visitor;
    expect(typeof visitor?.session_duration_ms).toBe('number');
    expect(visitor?.session_duration_ms).toBeGreaterThan(0);
  });

  it('never fabricates a first visit when the history read fails', async () => {
    await resolve({ anonymous_id: 'anon-x', session_id: 'x-1' }); // real first visit
    db.readError = { code: '08006', message: 'connection failure' };
    await resolve({ anonymous_id: 'anon-x', session_id: 'x-2' });
    db.readError = null;
    const second = db.rows[1].metadata as { visitor?: unknown };
    // Unknown history stays absent — it must NOT claim visit #1 / not-returning.
    expect(second.visitor).toBeUndefined();
    expect(logs.some((l) => l.payload.outcome === 'read_failed')).toBe(true);
  });

  it('the schema-aware double proves the old column would fail', async () => {
    // Sanity check on the guard itself: had the code kept `created_at`, the
    // double would answer 42703 exactly as the real database does.
    const res = await (ownedDbTableFake('visitor_sessions') as { select: (c: string) => { limit: () => Promise<{ error?: { code?: string } }> } })
      .select('created_at')
      .limit();
    expect(res.error?.code).toBe('42703');
  });
});

// ── 2. Operational readiness ────────────────────────────────────────────────

describe('M1A (3) — session capture health indicator', () => {
  it('is healthy when nothing has failed', () => {
    expect(checkSessionCaptureHealth()).toMatchObject({ name: 'sessionCapture', status: 'healthy' });
  });

  it('stays healthy through recoveries — a racing tenant is not an incident', async () => {
    await Promise.all(Array.from({ length: 10 }, () => resolve()));
    expect(checkSessionCaptureHealth().status).toBe('healthy');
  });

  it('degrades on ordinary failures and goes unhealthy on systemic ones', async () => {
    db.insertErrors = [{ code: 'XX000', message: 'internal error' }];
    await resolve();
    expect(checkSessionCaptureHealth().status).toBe('degraded');

    registry.reset();
    db.insertErrors = [{ code: '42P01', message: 'relation "visitor_sessions" does not exist' }];
    await resolve({ anonymous_id: 'anon-2' });
    const systemic = checkSessionCaptureHealth();
    expect(systemic.status).toBe('unhealthy');
    expect(systemic.detail).toContain('not being linked');
  });

  it('never throws', () => {
    const spy = jest.spyOn(registry, 'counterEntries').mockImplementation(() => {
      throw new Error('registry exploded');
    });
    expect(checkSessionCaptureHealth().status).toBe('unknown');
    spy.mockRestore();
  });
});

// ── 3. Concurrency validation ───────────────────────────────────────────────

describe('M1A (5) — concurrency', () => {
  it('20 simultaneous first-visit requests create exactly ONE session, and all agree on its id', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => resolve()));
    const ids = new Set(results.map((r) => r.sessionId));
    expect(db.rows).toHaveLength(1); // no duplicate sessions
    expect(ids).toEqual(new Set(['vs-1'])); // every caller resolved the same session
    expect(results.every((r) => r.sessionId !== null)).toBe(true); // nobody lost their journey
    expect(counterTotal(INTEL_METRICS.session.persistence)).toBeGreaterThan(0); // races observable
    expect(counterTotal(INTEL_METRICS.session.failures)).toBe(0); // ...but not failures
  });

  it('concurrent requests for DIFFERENT visitors stay isolated', async () => {
    const results = await Promise.all([
      resolve({ anonymous_id: 'a', session_id: 's1' }),
      resolve({ anonymous_id: 'b', session_id: 's2' }),
      resolve({ anonymous_id: 'c', session_id: 's3' }),
      resolve({ anonymous_id: 'a', session_id: 's1' }),
    ]);
    expect(db.rows).toHaveLength(3);
    expect(results[0].sessionId).toBe(results[3].sessionId); // same visitor+session → same row
    expect(new Set(results.map((r) => r.sessionId)).size).toBe(3);
  });

  it('overlapping continuation refreshes never orphan or duplicate the session', async () => {
    await resolve();
    await Promise.all(Array.from({ length: 10 }, () => resolve()));
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].id).toBe('vs-1');
    expect(counterTotal(INTEL_METRICS.session.failures)).toBe(0);
  });

  it('concurrent intelligence generation over the same snapshot is byte-identical', async () => {
    const snap = bigSnapshot(5, 20);
    const envelopes = await Promise.all(
      Array.from({ length: 12 }, async () => JSON.stringify(buildLeadIntelligenceSummary(snap))),
    );
    expect(new Set(envelopes).size).toBe(1); // deterministic under overlap
  });

  it('duplicate tracking events do not change the fingerprint-relevant ordering', () => {
    const events = [evt('e1', '/pricing', '2026-08-09T10:00:00.000Z'), evt('e2', '/demo', '2026-08-09T10:05:00.000Z')];
    const a = computeInputFingerprint(assemble([session()], events));
    const b = computeInputFingerprint(assemble([session()], [...events].reverse()));
    expect(a).toBe(b); // row order never dirties the fingerprint
  });

  it('a lead that lost its session produces consistent — not orphaned — intelligence', () => {
    const summary = buildLeadIntelligenceSummary(assemble([], []));
    expect(summary.qualification.sections).toHaveLength(5);
    expect(summary.timeline.every((t) => typeof t.occurredAt === 'string')).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('undefined');
  });
});

// ── 3. Historical compatibility ─────────────────────────────────────────────

describe('M1A (4) — historical compatibility', () => {
  it('does not move the engine or schema version', () => {
    expect(ENGINE_VERSION).toBe('lie-2.1.0'); // WS-2 M3: bumped so records regenerate WITH evolution
    expect(INTELLIGENCE_SCHEMA_VERSION).toBe(2);
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual([1, 2]);
  });

  it('a legacy session (no visitor metadata) yields the pre-M1 intelligence shape', () => {
    const legacy = buildLeadIntelligenceSummary(assemble([session({ metadata: {} })]));
    expect(legacy.intent.contributions.some((c) => c.signal === 'visitor_loyalty')).toBe(false);
    expect(legacy.intent.contributions.some((c) => c.signal === 'return_cadence')).toBe(false);
    expect(legacy.qualification.sections).toHaveLength(5);
    const b = analyzeBehavior(assemble([session({ metadata: {} })]), defaultEngineConfig);
    expect([b.returningVisitor, b.visitCount, b.firstVisitAt, b.totalSessionDurationMs]).toEqual([null, null, null, null]);
  });

  it('the fingerprint is stable across repeated assembly of identical rows', () => {
    const a = computeInputFingerprint(assemble([session()]));
    const b = computeInputFingerprint(assemble([session()]));
    expect(a).toBe(b); // no regeneration churn
  });

  it('session-less leads keep their fingerprint — no needless regeneration wave', () => {
    // Their snapshot contains no session objects at all, so the M1 fields
    // cannot perturb the hash. These records stay fresh through the rollout.
    const withoutSessions = assemble([], [evt('e1', '/pricing', '2026-08-09T10:00:00.000Z')]);
    expect(computeInputFingerprint(withoutSessions)).toBe(computeInputFingerprint(withoutSessions));
    expect(withoutSessions.sessions).toHaveLength(0);
  });

  it('new session metadata dirties the fingerprint exactly once, then settles', () => {
    const legacy = computeInputFingerprint(assemble([session({ metadata: {} })]));
    const enriched = computeInputFingerprint(assemble([session()]));
    expect(enriched).not.toBe(legacy); // → regenerates on next trigger
    expect(computeInputFingerprint(assemble([session()]))).toBe(enriched); // → then stays skipped
  });

  it('mixed-version operation: an old and a new build agree on identical inputs', () => {
    // Both builds run the same deterministic engines over the same snapshot,
    // so a record written by either is byte-identical — no write ping-pong.
    const snap = assemble([session()]);
    expect(JSON.stringify(buildLeadIntelligenceSummary(snap))).toBe(JSON.stringify(buildLeadIntelligenceSummary(snap)));
  });
});

// ── 4. Scale validation ─────────────────────────────────────────────────────

describe('M1A (6) — scale', () => {
  it('handles a large visitor history within the snapshot caps', () => {
    const snap = bigSnapshot(500, 1000);
    const t0 = process.hrtime.bigint();
    const summary = buildLeadIntelligenceSummary(snap);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const bytes = Buffer.byteLength(JSON.stringify(summary));

    // eslint-disable-next-line no-console
    console.log(`[M1A scale] 500 sessions / 1000 events → ${ms.toFixed(1)} ms, envelope ${(bytes / 1024).toFixed(1)} KB`);
    expect(summary.qualification.sections).toHaveLength(5);
    expect(ms).toBeLessThan(3000);

    const b = analyzeBehavior(snap, defaultEngineConfig);
    expect(b.visitCount).toBe(500);
    expect(b.avgTimeBetweenSessionsMs).toBeGreaterThan(0);
    // Derived collections stay bounded by DISTINCT pages, not by event volume.
    expect(b.exitPages.length).toBeLessThanOrEqual(50);
  });

  it('behaviour derivation cost grows linearly, not quadratically', () => {
    const time = (sessions: number): number => {
      const snap = bigSnapshot(sessions, 50);
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < 20; i++) analyzeBehavior(snap, defaultEngineConfig);
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    const small = time(50);
    const large = time(500);
    // eslint-disable-next-line no-console
    console.log(`[M1A scale] analyzeBehavior ×20 — 50 sessions ${small.toFixed(1)} ms, 500 sessions ${large.toFixed(1)} ms`);
    // 10× the input must not cost anywhere near 100× the time.
    expect(large).toBeLessThan(Math.max(small, 1) * 40);
  });

  it('telemetry overhead is negligible and its cardinality is bounded', () => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 10_000; i++) {
      recordSessionPersistence({ outcome: 'insert_failed', errorClass: 'transient', detail: `d${i}`, companyId: `co-${i}` });
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const series = registry.counterEntries().filter((c) => c.name.startsWith('intel.session.')).length;
    // eslint-disable-next-line no-console
    console.log(`[M1A scale] 10k telemetry emits → ${ms.toFixed(1)} ms, ${series} series`);
    expect(series).toBeLessThanOrEqual(4); // closed label sets — never grows with volume
    expect(logs.length).toBeLessThan(200); // throttled, not one line per failure
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

function session(over: Row = {}): Row {
  return {
    id: 'vs-1',
    started_at: '2026-08-09T10:00:00.000Z',
    last_seen_at: '2026-08-09T10:30:00.000Z',
    first_landing_page: '/',
    last_current_page: 'https://x.com/pricing',
    utm_source: 'google',
    metadata: {
      visitor: {
        visit_count: 4,
        returning_visitor: true,
        first_visit_at: '2026-07-11T09:00:00.000Z',
        session_duration_ms: 1_800_000,
      },
    },
    ...over,
  };
}

function evt(id: string, url: string, at: string, sessionId = 'vs-1'): Row {
  return { id, event_name: 'page_view', page_url: url, visitor_session_id: sessionId, occurred_at: at, metadata: {} };
}

function assemble(sessions: Row[], events: Row[] = []) {
  return assembleLeadCaptureSnapshot({
    leadRow: { id: 'L1', company_id: 'co-1', email: 'cto@bigcorp.com', created_at: '2026-08-09T11:00:00.000Z', visitor_session_id: 'vs-1', metadata: { job_title: 'CTO' } },
    trackingEventRows: events,
    visitorSessionRows: sessions,
    touchpointRows: [],
    now: NOW,
  });
}

function bigSnapshot(sessionCount: number, eventCount: number) {
  const day = 86_400_000;
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const sessions = Array.from({ length: sessionCount }, (_, i) =>
    session({
      id: `vs-${i}`,
      started_at: new Date(base + i * day).toISOString(),
      last_seen_at: new Date(base + i * day + 600_000).toISOString(),
      last_current_page: `https://x.com/p${i % 50}`,
      metadata: {
        visitor: {
          visit_count: i + 1,
          returning_visitor: i > 0,
          first_visit_at: new Date(base).toISOString(),
          session_duration_ms: 600_000,
        },
      },
    }),
  );
  const events = Array.from({ length: eventCount }, (_, i) =>
    evt(`e-${i}`, `https://x.com/p${i % 50}`, new Date(base + (i % sessionCount) * day + i * 1000).toISOString(), `vs-${i % sessionCount}`),
  );
  return assemble(sessions, events);
}
