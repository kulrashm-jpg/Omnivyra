/**
 * CLASS-2 D6 on REAL PostgreSQL (migration 20270217000009, outreach_quota_consume / _release), with
 * INDEPENDENT CONNECTIONS. e9 rule 2026-11-12: sandbox-only evidence does not close a unit.
 *
 * The WS-3 database limiter layer (used when Redis is unusable): under a per-tenant transaction
 * advisory lock, used = attempts in the window + LIVE reservations; within the limits a reservation is
 * written and returned. A reservation stops counting when its attempt exists, when released, or after
 * its TTL.
 *
 * The race: connection 1 takes the last unit and holds its transaction; connection 2 must WAIT on the
 * advisory lock and, after the commit, be REFUSED. CONTROL: the consume FUNCTION statement (only it -
 * the migration pins its own body hashes, so a whole-file mutant would be refused, a false kill) is
 * replaced with a copy WITHOUT the lock line: connection 2 does not wait and both are granted.
 *
 * Window: every call passes p_since = THIS TEST's start (the database clock, taken in beforeEach), so
 * attempts left by earlier tests - and by other committing suites in the shared tenant - are outside it
 * and the counts are exact. outreach_attempts is APPEND-ONLY in the real schema (ws3_append_only trigger)
 * and outreach_tasks is RESTRICT-referenced by it, so attempts are never deleted: the window, not a
 * DELETE, isolates the tests (found on the CI-faithful replay, CI 43193095547). Each arrangement is
 * asserted before the subject. This file COMMITS its rows (two connections), so it runs in the
 * committing pass.
 */
import fs from 'fs';
import path from 'path';

import { Client } from 'pg';
import { db, seedTenants, ORG_A, ORG_B } from './setup';

const ORG = ORG_B;
/** This test's window start (database clock), set in beforeEach. */
let SINCE = '';
const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20270217000009_outreach_quota_atomic_consume.sql'), 'utf8');
function consumeSql(): string {
  const start = MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.outreach_quota_consume(');
  const end = MIGRATION.indexOf('$fn$;', start);
  if (start < 0 || end < 0) throw new Error('outreach_quota_consume not found in the migration');
  return MIGRATION.slice(start, end + '$fn$;'.length);
}
function consumeWithoutLock(): string {
  const sql = consumeSql();
  const out = sql.replace(/PERFORM pg_advisory_xact_lock\([^;]*\);/, 'NULL; -- CONTROL: no lock');
  if (out === sql) throw new Error('no advisory lock line - the control would be vacuous');
  return out;
}

let c1: Client;
let c2: Client;
let pid2: number;
const tasks: string[] = [];
const rnd = () => Math.random().toString(36).slice(2, 10);

async function newTask(lead: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.outreach_tasks (company_id, lead_id, plan_task_id, channel, action,
        status, planner_version, translation_version, governance_version, execution_runtime_version, materialized_at)
     VALUES ($1,$2,$3,'email','Say hello','pending','p','t','g','r', now()) RETURNING id`,
    [ORG, lead, `d6-plan-${rnd()}`]);
  tasks.push(rows[0].id);
  return rows[0].id as string;
}
type Grant = { granted: boolean; reservation_id: string | null; tenant_used: number; lead_used: number };
async function consume(c: Client | typeof db, lead: string, task: string, tenantLimit: number | null, leadLimit: number | null, ttl = 3600): Promise<Grant> {
  const { rows } = await c.query(`SELECT * FROM public.outreach_quota_consume($1, $2, $3, $4::timestamptz, $5, $6, $7)`,
    [ORG, lead, task, SINCE, tenantLimit, leadLimit, ttl]);
  return rows[0];
}
async function live(): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.outreach_quota_reservations WHERE company_id = $1 AND released_at IS NULL`, [ORG]);
  return rows[0].n;
}
async function clearReservations() { await db.query(`DELETE FROM public.outreach_quota_reservations WHERE company_id = $1`, [ORG]); }
async function waitUntilBlocked(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const { rows } = await db.query(`SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = $1`, [pid2]);
    if (rows[0]?.wait_event_type === 'Lock' && rows[0]?.wait_event === 'advisory') return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('connection 2 never waited on the advisory lock');
}

beforeAll(async () => {
  await db.query('BEGIN');
  await seedTenants();
  await db.query('COMMIT');
  c1 = new Client({ connectionString: process.env.W6_DB_URL });
  c2 = new Client({ connectionString: process.env.W6_DB_URL });
  await c1.connect();
  await c2.connect();
  pid2 = Number((await c2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
});
// Cleanup runs on OUR connection: setup.ts closes the shared `db` in its own afterAll, which runs
// first - a cleanup through `db` would silently do nothing.
afterAll(async () => {
  await c1?.query('ROLLBACK').catch(() => undefined);
  await c2?.query('ROLLBACK').catch(() => undefined);
  if (c1) {
    await c1.query(consumeSql()); // a failed control must not leave the no-lock copy installed
    await c1.query(`DELETE FROM public.outreach_quota_reservations WHERE company_id = $1`, [ORG]);
    if (tasks.length) {
      // Attempts are append-only, and a task with an attempt is RESTRICT-protected: only attempt-less tasks go.
      await c1.query(`DELETE FROM public.outreach_tasks t WHERE t.id = ANY($1::uuid[])
                        AND NOT EXISTS (SELECT 1 FROM public.outreach_attempts a WHERE a.task_id = t.id)`, [tasks]);
    }
  }
  await c1?.end().catch(() => undefined);
  await c2?.end().catch(() => undefined);
});
// Every case starts with NO reservation and NO attempt in ITS window (the tenant limit counts every
// attempt in the window - one left by an earlier case would skew it). The window opens strictly after
// every earlier commit: a short pause, then the database clock.
beforeEach(async () => {
  await clearReservations();
  await new Promise((r) => setTimeout(r, 20));
  SINCE = ((await db.query('SELECT clock_timestamp() AS t')).rows[0].t as Date).toISOString();
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.outreach_attempts WHERE company_id = $1 AND started_at >= $2::timestamptz`, [ORG, SINCE]);
  expect(rows[0].n).toBe(0); // arrangement: an empty window
});

describe('D6 outreach_quota_consume - single connection', () => {
  it('tenant limit 2: grant, grant, refuse (a refusal writes nothing)', async () => {
    const lead = `d6-${rnd()}`;
    expect((await consume(db, lead, await newTask(lead), 2, null)).granted).toBe(true);
    expect((await consume(db, lead, await newTask(lead), 2, null)).granted).toBe(true);
    const third = await consume(db, lead, await newTask(lead), 2, null);
    expect(third).toMatchObject({ granted: false, reservation_id: null, tenant_used: 2 });
    expect(await live()).toBe(2);
  });

  it('per-LEAD limit 1 refuses a second for the same lead, not for another lead', async () => {
    const a = `d6-${rnd()}`; const b = `d6-${rnd()}`;
    expect((await consume(db, a, await newTask(a), null, 1)).granted).toBe(true);
    expect((await consume(db, a, await newTask(a), null, 1)).granted).toBe(false);
    expect((await consume(db, b, await newTask(b), null, 1)).granted).toBe(true);
  });

  it('a reservation stops counting once ITS attempt exists (no double count)', async () => {
    const lead = `d6-${rnd()}`;
    const t1 = await newTask(lead);
    expect((await consume(db, lead, t1, 2, null)).granted).toBe(true);
    await db.query(`INSERT INTO public.outreach_attempts (company_id, task_id, attempt_number, channel, transport, started_at)
                    VALUES ($1, $2, 1, 'email', 'supabase_edge_ses', now())`, [ORG, t1]);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.outreach_attempts WHERE task_id = $1`, [t1]);
    expect(rows[0].n).toBe(1); // arrangement: the attempt exists
    const g = await consume(db, lead, await newTask(lead), 2, null);
    expect(g).toMatchObject({ granted: true, tenant_used: 2 }); // attempt 1 + this one, not 3
  });

  it('released, or older than its TTL -> no longer counts; a release by another tenant does nothing', async () => {
    const lead = `d6-${rnd()}`;
    const g1 = await consume(db, lead, await newTask(lead), 1, null);
    expect(g1.granted).toBe(true);
    expect((await consume(db, lead, await newTask(lead), 1, null)).granted).toBe(false);
    const other = await db.query(`SELECT public.outreach_quota_release($1, $2) AS ok`, [g1.reservation_id, ORG_A]);
    expect(other.rows[0].ok).toBe(false);
    const own = await db.query(`SELECT public.outreach_quota_release($1, $2) AS ok`, [g1.reservation_id, ORG]);
    expect(own.rows[0].ok).toBe(true);
    const g2 = await consume(db, lead, await newTask(lead), 1, null, 60);
    expect(g2.granted).toBe(true);
    const aged = await db.query(`UPDATE public.outreach_quota_reservations SET reserved_at = now() - interval '2 minutes' WHERE id = $1 RETURNING id`, [g2.reservation_id]);
    expect(aged.rowCount).toBe(1); // arrangement: it is now older than the 60 s TTL
    expect((await consume(db, lead, await newTask(lead), 1, null, 60)).granted).toBe(true);
  });

  it('grants: anon and authenticated hold nothing on the table and cannot EXECUTE', async () => {
    const { rows } = await db.query(`SELECT
      has_table_privilege('anon', 'public.outreach_quota_reservations', 'SELECT') AS a_sel,
      has_table_privilege('authenticated', 'public.outreach_quota_reservations', 'INSERT') AS u_ins,
      has_function_privilege('anon', 'public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer)', 'EXECUTE') AS a_exec,
      has_function_privilege('service_role', 'public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer)', 'EXECUTE') AS s_exec`);
    expect(rows[0]).toEqual({ a_sel: false, u_ins: false, a_exec: false, s_exec: true });
  });
});

describe('D6 outreach_quota_consume - two connections', () => {
  it('one unit left: connection 2 WAITS on the lock, then is REFUSED - exactly one grant', async () => {
    const lead = `d6-${rnd()}`;
    const t1 = await newTask(lead); const t2 = await newTask(lead);
    await c1.query('BEGIN');
    expect((await consume(c1, lead, t1, 1, null)).granted).toBe(true);
    const second = consume(c2, lead, t2, 1, null);
    await waitUntilBlocked();
    await c1.query('COMMIT');
    expect((await second).granted).toBe(false);
    expect(await live()).toBe(1);
  });

  it('CONTROL - the consume FUNCTION without its lock line: connection 2 does not wait and BOTH are granted', async () => {
    const lead = `d6-${rnd()}`;
    const t1 = await newTask(lead); const t2 = await newTask(lead);
    await db.query(consumeWithoutLock());
    try {
      const { rows } = await db.query(`SELECT position('CONTROL: no lock' in prosrc) > 0 AS mutated FROM pg_proc
                                        WHERE oid = to_regprocedure('public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer)')`);
      expect(rows[0].mutated).toBe(true); // arrangement: the no-lock copy IS installed
      await c1.query('BEGIN');
      expect((await consume(c1, lead, t1, 1, null)).granted).toBe(true);
      const second = consume(c2, lead, t2, 1, null);
      await new Promise((r) => setTimeout(r, 300));
      const { rows: w } = await db.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid2]);
      expect(w[0]?.wait_event_type).not.toBe('Lock');
      expect((await second).granted).toBe(true); // over the limit: the race the lock closes
      await c1.query('COMMIT');
    } finally {
      await c1.query('ROLLBACK').catch(() => undefined);
      await db.query(consumeSql());
    }
    const { rows } = await db.query(`SELECT position('CONTROL: no lock' in prosrc) > 0 AS mutated FROM pg_proc
                                      WHERE oid = to_regprocedure('public.outreach_quota_consume(uuid, text, uuid, timestamptz, integer, integer, integer)')`);
    expect(rows[0].mutated).toBe(false); // restored
  });
});

