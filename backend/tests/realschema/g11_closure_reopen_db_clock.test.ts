/**
 * G-11 — a manual closure's reopen is stamped by the DATABASE clock (20270129000003), on REAL
 * PostgreSQL. closed_at comes from the column default now(); reopened_at used to come from the app
 * clock, so with the app behind the database the CHECK reopened_at >= closed_at refused a legitimate
 * reopen (23514 → 503 closure_unavailable). Measured on the sandbox 2026-11-08: closed_at
 * 11:13:32.146627 (DB) vs reopened_at 11:13:32.146 (app).
 *
 * The app-behind-database skew is INJECTED (the global Date runs LAG_MS behind), so the outcome is
 * deterministic: with the stamp in the trigger the reopen succeeds and reopened_at is a database
 * time; without it (the pre-fix service, or a trigger that does not stamp) it is refused.
 */

import { db, inRollback, seedTenants, ORG_A } from './setup';
import { newProspect, newUser, one } from './helpers/journeyFixtures';

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

/* eslint-disable @typescript-eslint/no-var-requires */
const { closeProspectToJourneys, reopenProspectToJourneys } = require('../../services/orchestration/contactEnrolmentClosure');
/* eslint-enable @typescript-eslint/no-var-requires */

const LAG_MS = 5_000;
const RealDate = Date;
class AppBehindDb extends RealDate {
  constructor(...a: unknown[]) { if (a.length === 0) super(RealDate.now() - LAG_MS); else super(...(a as [string])); }
  static now(): number { return RealDate.now() - LAG_MS; }
}
const setGlobalDate = (d: unknown) => { (global as unknown as { Date: unknown }).Date = d; };
afterEach(() => setGlobalDate(RealDate));

async function closedProspect() {
  await seedTenants();
  const actor = await newUser();
  const { prospectId, personId } = await newProspect(ORG_A, { email: 'reopen@example.test' });
  const closed = await closeProspectToJourneys({ organizationId: ORG_A, prospectId, reason: 'hold', actorUserId: actor });
  expect(closed.ok).toBe(true);
  return { actor, prospectId, personId, closureId: String(closed.value.id) };
}

describe('G-11 manual reopen with the app clock behind the database', () => {
  it(`the reopen succeeds with the app ${LAG_MS} ms behind, and reopened_at is a database time >= closed_at`, () => inRollback(async () => {
    const c = await closedProspect();
    setGlobalDate(AppBehindDb);
    const appNow = Date.now();
    const out = await reopenProspectToJourneys({
      organizationId: ORG_A, prospectId: c.prospectId, reason: 'reopen', actorUserId: c.actor, personId: c.personId, email: 'reopen@example.test', phone: null,
    });
    setGlobalDate(RealDate);
    expect(out).toMatchObject({ ok: true, value: { id: c.closureId, reopenedBy: c.actor, reopenReason: 'reopen' } });
    const row = await one(`SELECT closed_at, reopened_at, reopened_at >= closed_at AS ordered,
      (extract(epoch FROM reopened_at) * 1000)::float8 AS reopened_ms FROM public.contact_enrolment_closures WHERE id = $1`, [c.closureId]);
    expect(row.ordered).toBe(true);
    expect(Number(row.reopened_ms)).toBeGreaterThan(appNow + LAG_MS / 2);       // the DB clock, not the lagged app clock
  }), 120_000);

  it('a writer-supplied reopened_at is ignored: the trigger stamps the database time, even for a value before closed_at', () => inRollback(async () => {
    const c = await closedProspect();
    await db.query(`UPDATE public.contact_enrolment_closures
      SET reopened_by = closed_by, reopen_reason = 'direct', reopened_at = closed_at - interval '1 hour' WHERE id = $1`, [c.closureId]);
    const row = await one(`SELECT reopened_at >= closed_at AS ordered, reopened_at > closed_at - interval '1 minute' AS stamped
      FROM public.contact_enrolment_closures WHERE id = $1`, [c.closureId]);
    expect(row).toEqual({ ordered: true, stamped: true });
  }), 120_000);

  it('SAME transaction, no lag: closed_at is the transaction start now(); the reopen stamp clock_timestamp() is >= it (measured)', () => inRollback(async () => {
    const c = await closedProspect();
    const out = await reopenProspectToJourneys({
      organizationId: ORG_A, prospectId: c.prospectId, reason: 'reopen', actorUserId: c.actor, personId: c.personId, email: 'reopen@example.test', phone: null,
    });
    expect(out.ok).toBe(true);
    const row = await one(`SELECT closed_at = now() AS closed_at_is_tx_start, reopened_at >= closed_at AS ordered,
      (extract(epoch FROM reopened_at - closed_at) * 1e6)::bigint AS gap_us, clock_timestamp() >= now() AS clock_ge_now
      FROM public.contact_enrolment_closures WHERE id = $1`, [c.closureId]);
    console.log('B3-SAME-TX', JSON.stringify(row)); // eslint-disable-line no-console
    expect(row).toMatchObject({ closed_at_is_tx_start: true, ordered: true, clock_ge_now: true });
    expect(Number(row.gap_us)).toBeGreaterThanOrEqual(0);
  }), 120_000);

  it('unchanged: a second reopen is refused (23514) and a non-reopen change to a closure is refused (23514)', () => inRollback(async () => {
    const c = await closedProspect();
    await db.query(`UPDATE public.contact_enrolment_closures SET reopened_by = closed_by, reopen_reason = 'first' WHERE id = $1`, [c.closureId]);
    for (const sql of [
      `UPDATE public.contact_enrolment_closures SET reopen_reason = 'second' WHERE id = $1`,
      `UPDATE public.contact_enrolment_closures SET close_reason = 'rewritten' WHERE id = $1`,
    ]) {
      await db.query('SAVEPOINT s');
      const code = await db.query(sql, [c.closureId]).then(() => 'ok', (e: { code?: string }) => e.code);
      await db.query('ROLLBACK TO SAVEPOINT s');
      expect(code).toBe('23514');
    }
  }), 120_000);
});
