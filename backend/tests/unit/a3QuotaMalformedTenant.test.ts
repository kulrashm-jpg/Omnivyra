/**
 * A3 / Phase 1.1 — `readDurableUsage` under a malformed tenant id.
 *
 * WHY THIS EXISTS. A3 retyped `outreach_*.company_id` from `text` to `uuid`.
 * Before that change, filtering on a non-UUID tenant id matched no rows and the
 * limiter observed ZERO usage — it would have PERMITTED a send. After it,
 * PostgreSQL answers `22P02` (invalid_text_representation) instead.
 *
 * The Phase 1 integration review recorded that as "throws 22P02", which was
 * imprecise and is the reason this file exists rather than a code change:
 * `safeDb` already catches every failure mode, and `readDurableUsage` already
 * converts a failed read into usage at the CEILING with `ok: false`, which makes
 * the limiter DEFER. So the retype moved this path from fail-OPEN to
 * fail-CLOSED, which is the direction the module's own contract demands —
 * "an optimization must never be able to authorize a send the truth would
 * refuse".
 *
 * There is therefore NO application-code correction to make, and deliberately no
 * UUID validator invented here: the architecture's defined invalid-input path is
 * `safeDb` → ceiling → defer, and adding a second, application-level definition
 * of "valid tenant" would be a competing rule with no owner. These tests pin the
 * behaviour so a future refactor cannot silently restore the fail-open reading.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  /** SQLSTATE returned for the next matching table read, or null for success. */
  failWith: null as { table: string; code: string; message: string } | null,
  filtersSeen: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st: { filters: Array<[string, unknown]> } = { filters: [] };
    const rows = () => (db.tables[table] ??= []);
    const matches = (r: Row) =>
      st.filters.every(([c, v]) => (c.startsWith('__gte__') ? String(r[c.slice(7)] ?? '') >= String(v) : r[c] === v));

    const exec = async (): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.filtersSeen.push({ table, filters: st.filters });
      if (db.failWith && db.failWith.table === table) {
        return { data: null, error: { code: db.failWith.code, message: db.failWith.message } };
      }
      return { data: rows().filter(matches), error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      gte: (c: string, v: unknown) => { st.filters.push([`__gte__${c}`, v]); return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
}));

jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => null }));

import { readDurableUsage } from '../../services/leadOutreachExecution/quota';

const ORG = '00000000-0000-4000-8000-00000000000a';
const MALFORMED = 'm8-db-12345-1';
const LEAD = 'lead-1';
const AT = '2026-09-01T00:00:00.000Z';

/** The exact error PostgREST surfaces for a non-UUID literal against a uuid column. */
const INVALID_TEXT_REPRESENTATION = {
  code: '22P02',
  message: 'invalid input syntax for type uuid: "m8-db-12345-1"',
};

beforeEach(() => {
  db.tables = {};
  db.failWith = null;
  db.filtersSeen = [];
});

describe('A3 — readDurableUsage with a malformed (non-UUID) companyId', () => {
  it('does not throw — the failure is absorbed by the defined invalid-input path', async () => {
    db.failWith = { table: 'outreach_attempts', ...INVALID_TEXT_REPRESENTATION };
    await expect(readDurableUsage(MALFORMED, LEAD, AT)).resolves.toBeDefined();
  });

  it('reports usage at the CEILING so the limiter defers, never permits', async () => {
    db.failWith = { table: 'outreach_attempts', ...INVALID_TEXT_REPRESENTATION };
    const usage = await readDurableUsage(MALFORMED, LEAD, AT);

    expect(usage.ok).toBe(false);
    expect(usage.tenantCount).toBe(Number.MAX_SAFE_INTEGER);
    expect(usage.leadCount).toBe(Number.MAX_SAFE_INTEGER);
    // The regression this pins: zero usage would read as "quota available".
    expect(usage.tenantCount).not.toBe(0);
  });

  it('fails closed on the per-lead read too, not only the tenant read', async () => {
    db.failWith = { table: 'outreach_tasks', ...INVALID_TEXT_REPRESENTATION };
    const usage = await readDurableUsage(MALFORMED, LEAD, AT);

    expect(usage.ok).toBe(false);
    expect(usage.leadCount).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('still filters on the tenant — a malformed id is never widened to all tenants', async () => {
    db.failWith = { table: 'outreach_attempts', ...INVALID_TEXT_REPRESENTATION };
    await readDurableUsage(MALFORMED, LEAD, AT);

    const attemptRead = db.filtersSeen.find((f) => f.table === 'outreach_attempts');
    expect(attemptRead?.filters).toEqual(
      expect.arrayContaining([['company_id', MALFORMED]]),
    );
  });

  it('invents no UUID validation of its own — the value reaches the database unaltered', async () => {
    db.failWith = { table: 'outreach_attempts', ...INVALID_TEXT_REPRESENTATION };
    await readDurableUsage(MALFORMED, LEAD, AT);

    const sent = db.filtersSeen.find((f) => f.table === 'outreach_attempts')?.filters.find(([c]) => c === 'company_id');
    expect(sent?.[1]).toBe(MALFORMED);
  });
});

describe('A3 — a well-formed tenant id is unaffected by the retype', () => {
  it('counts real attempts and reports ok', async () => {
    db.tables.outreach_attempts = [
      { id: 'a1', task_id: 't1', company_id: ORG, started_at: '2026-08-31T12:00:00.000Z' },
      { id: 'a2', task_id: 't2', company_id: ORG, started_at: '2026-08-31T13:00:00.000Z' },
    ];
    db.tables.outreach_tasks = [{ id: 't1', company_id: ORG, lead_id: LEAD }];

    const usage = await readDurableUsage(ORG, LEAD, AT);

    expect(usage.ok).toBe(true);
    expect(usage.tenantCount).toBe(2);
    expect(usage.leadCount).toBe(1);
  });

  it('excludes another tenant’s attempts', async () => {
    db.tables.outreach_attempts = [
      { id: 'a1', task_id: 't1', company_id: ORG, started_at: '2026-08-31T12:00:00.000Z' },
      { id: 'a2', task_id: 't9', company_id: '00000000-0000-4000-8000-00000000000b', started_at: '2026-08-31T12:00:00.000Z' },
    ];
    db.tables.outreach_tasks = [{ id: 't1', company_id: ORG, lead_id: LEAD }];

    const usage = await readDurableUsage(ORG, LEAD, AT);

    expect(usage.tenantCount).toBe(1);
    expect(usage.leadCount).toBe(1);
  });
});
