/**
 * D2 — provider evidence debt on REAL PostgreSQL, through the real writer, AS service_role.
 *
 * The governed build does not reproduce Supabase's default grants, so a new writer is only
 * proven when it runs as the role production uses. Every test switches to service_role
 * (SET LOCAL ROLE, inside a rolled-back transaction) before the writer runs.
 *
 * Real: sesEvidenceReconciliation.ts, the table, its CHECKs, unique key, guard trigger, RLS
 * and grants. Replaced: PostgREST, by the harness transport, plus one thing PostgREST does
 * that the harness transport does not: a JSON array for an array column becomes a Postgres array.
 *
 * Scope: the debt table only. A replay that reaches a task needs grants on tables this
 * build does not give service_role; that path is covered by the unit suite.
 */

import { db, inRollback, ORG_A, ORG_B } from './setup';

/**
 * PostgREST stores a JSON array sent for a Postgres ARRAY column as an array; the harness
 * transport sends every object or array as JSON text, which an array column rejects. Only
 * this table's two array columns are converted (jsonb keeps JSON, as in PostgREST), every
 * element is quoted, and no error is caught here: a refused privilege still reaches the
 * writer, which reports it as 'unrecorded' and fails these tests.
 */
const ARRAY_COLUMNS = new Set(['governance_record_ids', 'failed_operations']);
const pgArray = (v: unknown[]) => `{${v.map((e) => `"${String(e).replace(/["\\]/g, '\\$&')}"`).join(',')}}`;
const pgArrays = (row: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = ARRAY_COLUMNS.has(k) && Array.isArray(v) ? pgArray(v) : v;
  return out;
};
jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  const table = (t: string) => {
    const b = pgTable(client, t);
    const insert = b.insert;
    const update = b.update;
    b.insert = (row: any) => insert(Array.isArray(row) ? row.map(pgArrays) : pgArrays(row));
    b.update = (row: any) => update(pgArrays(row));
    return b;
  };
  return { __esModule: true, ownedDbTable: table, ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  recordEvidenceDebt, resolveEvidenceDebtIfOpen, reconcileSesEvidenceDebt, EVIDENCE_RECONCILIATION_TABLE,
} = require('../../services/providerEvents/sesEvidenceReconciliation');
/* eslint-enable @typescript-eslint/no-var-requires */

const T = `public.${EVIDENCE_RECONCILIATION_TABLE}`;
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
let seq = 0;
const debt = (over: Record<string, unknown> = {}) => ({
  companyId: ORG_A,
  provider: 'supabase_edge_ses',
  providerEventId: `sns-${Date.now()}-${++seq}`,
  providerMessageId: `msg-${seq}`,
  eventType: 'Complaint',
  signal: 'complaint',
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  channel: 'email',
  taskId: null,
  attemptId: null,
  governanceType: 'complaint',
  governanceRecordIds: [G1],
  failedOperations: ['delivery_evidence'],
  failureReason: 'evidence_insert_failed',
  evidence: { feedbackType: 'abuse' },
  ...over,
});
const asServiceRole = async () => {
  await db.query('SET LOCAL ROLE service_role');
  const { rows } = await db.query('SELECT current_user AS u');
  expect(rows[0].u).toBe('service_role');
};
const row = async (eventId: string) =>
  (await db.query(`SELECT * FROM ${T} WHERE provider_event_id = $1`, [eventId])).rows;
const sqlstate = async (sql: string, params: unknown[] = []) => {
  await db.query('SAVEPOINT x');
  try { await db.query(sql, params); await db.query('RELEASE SAVEPOINT x'); return 'ok'; } catch (e: any) {
    await db.query('ROLLBACK TO SAVEPOINT x'); return e.code ?? 'unknown';
  }
};

describe('D2 evidence debt as service_role (real schema)', () => {
  it('runs only against a loopback database', () => {
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(String(process.env.W6_DB_URL)).hostname);
  });

  it('privileges: service_role SELECT/INSERT/UPDATE only; no DELETE; nothing for anon/authenticated', async () => {
    const { rows } = await db.query(
      `SELECT r.rolname, p.priv, has_table_privilege(r.rolname, $1, p.priv) AS ok
         FROM pg_roles r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS p(priv)
        WHERE r.rolname IN ('service_role','anon','authenticated')`, [T]);
    const has = (role: string, priv: string) => rows.find((x: any) => x.rolname === role && x.priv === priv)?.ok;
    expect(['SELECT', 'INSERT', 'UPDATE'].map((p) => has('service_role', p))).toEqual([true, true, true]);
    expect(has('service_role', 'DELETE')).toBe(false);
    expect(has('service_role', 'TRUNCATE')).toBe(false);
    for (const r of ['anon', 'authenticated']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(has(r, p)).toBe(false);
    }
    const sr = await db.query(`SELECT rolsuper FROM pg_roles WHERE rolname = 'service_role'`);
    expect(sr.rows[0].rolsuper).toBe(false);
  });

  it('records a debt, address-free, through the real writer', () => inRollback(async () => {
    await asServiceRole();
    const d = debt();
    await expect(recordEvidenceDebt(d)).resolves.toBe('recorded');
    const rs = await row(d.providerEventId);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({
      company_id: ORG_A, status: 'open', governance_type: 'complaint', failure_reason: 'evidence_insert_failed',
      governance_record_ids: [G1], failed_operations: ['delivery_evidence'], reconcile_attempts: 0,
    });
    expect(JSON.stringify(rs[0])).not.toMatch(/@/);
  }));

  it('an SNS retry refreshes the open row: one row, earliest failure kept, records widened', () => inRollback(async () => {
    await asServiceRole();
    const d = debt();
    await recordEvidenceDebt(d);
    const [first] = await row(d.providerEventId);
    await expect(recordEvidenceDebt({ ...d, governanceRecordIds: [G2], failedOperations: ['delivery_evidence', 'restriction'], failureReason: 'retry' }))
      .resolves.toBe('recorded');
    const rs = await row(d.providerEventId);
    expect(rs).toHaveLength(1);
    expect(rs[0].first_failed_at).toEqual(first.first_failed_at);
    expect([...rs[0].governance_record_ids].sort()).toEqual([G1, G2].sort());
    expect(rs[0].failed_operations).toEqual(['delivery_evidence', 'restriction']);
    expect(rs[0].failure_reason).toBe('retry');
  }));

  it('resolves on a later full success; a resolved row is final', () => inRollback(async () => {
    await asServiceRole();
    const d = debt();
    await recordEvidenceDebt(d);
    await resolveEvidenceDebtIfOpen(d.provider, d.providerEventId);
    const [resolved] = await row(d.providerEventId);
    expect(resolved).toMatchObject({ status: 'resolved', resolution: 'provider_retry' });
    expect(resolved.resolved_at).not.toBeNull();

    // A late duplicate failure does not reopen or change it.
    await expect(recordEvidenceDebt({ ...d, governanceRecordIds: [G2], failureReason: 'late' })).resolves.toBe('recorded');
    expect(await row(d.providerEventId)).toEqual([resolved]);

    // Nor can service_role reopen it, rewrite it, or delete it directly.
    expect(await sqlstate(`UPDATE ${T} SET status = 'open', resolved_at = NULL, resolution = NULL WHERE id = $1`, [resolved.id])).toBe('23514');
    expect(await sqlstate(`UPDATE ${T} SET last_reconcile_reason = 'x' WHERE id = $1`, [resolved.id])).toBe('23514');
    expect(await sqlstate(`DELETE FROM ${T} WHERE id = $1`, [resolved.id])).toBe('42501');
  }));

  it('tenant and event identity are immutable on an open row', () => inRollback(async () => {
    await asServiceRole();
    const d = debt();
    await recordEvidenceDebt(d);
    const [r] = await row(d.providerEventId);
    expect(await sqlstate(`UPDATE ${T} SET company_id = $2 WHERE id = $1`, [r.id, ORG_B])).toBe('23514');
    expect(await sqlstate(`UPDATE ${T} SET provider_event_id = 'other' WHERE id = $1`, [r.id])).toBe('23514');
  }));

  it('refuses an address in the evidence summary: unrecorded, nothing stored', () => inRollback(async () => {
    await asServiceRole();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = debt({ evidence: { recipient: 'person@example.test' } });
    await expect(recordEvidenceDebt(d)).resolves.toBe('unrecorded');
    expect(await row(d.providerEventId)).toHaveLength(0);
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/person@example\.test/);
    spy.mockRestore();
  }));

  it('reconciliation scoped to one tenant never reads or touches another tenant\'s debt', () => inRollback(async () => {
    await asServiceRole();
    const a = debt({ companyId: ORG_A });
    const b = debt({ companyId: ORG_B });
    await recordEvidenceDebt(a);
    await recordEvidenceDebt(b);
    const [bBefore] = await row(b.providerEventId);

    const summary = await reconcileSesEvidenceDebt({ governanceSource: 'ses_reconciliation', companyId: ORG_A, limit: 500 });
    const [aAfter] = await row(a.providerEventId);
    // Open debts are only those created in this transaction; the build has none of its own.
    const openA = (await db.query(`SELECT count(*)::int AS n FROM ${T} WHERE status = 'open' AND company_id = $1`, [ORG_A])).rows[0].n;
    expect(summary).toEqual({ examined: openA, resolved: 0, stillOpen: openA, errors: 0 });
    expect(aAfter).toMatchObject({ status: 'open', reconcile_attempts: 1, last_reconcile_reason: 'task_unresolved' });
    expect(await row(b.providerEventId)).toEqual([bBefore]);
  }));

  it('anon and authenticated cannot read or write the table', () => inRollback(async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.query('SAVEPOINT r');
      await db.query(`SET LOCAL ROLE ${role}`);
      expect(await sqlstate(`SELECT 1 FROM ${T} LIMIT 1`)).toBe('42501');
      expect(await sqlstate(`INSERT INTO ${T} (company_id) VALUES ('x')`)).toBe('42501');
      await db.query('ROLLBACK TO SAVEPOINT r');
    }
  }));
});
