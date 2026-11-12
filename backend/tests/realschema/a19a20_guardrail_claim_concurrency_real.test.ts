/**
 * CLASS-2 A19 + A20 on REAL PostgreSQL (migration 20270217000021), with INDEPENDENT CONNECTIONS.
 *
 * A19 community_ai_claim_within_limits: the execution guardrails and the REAL claim
 * (claim_community_ai_action_for_execution) in one transaction under a per (organization, platform)
 * advisory lock. A20 usage_execution_reserve: the meter + live reservations under a per
 * (organization, month) lock.
 *
 * Each race: connection 1 takes the last unit and holds its transaction open; connection 2's call
 * must WAIT on the advisory lock (observed in pg_stat_activity), and after connection 1 commits it
 * must be REFUSED. The control replaces the function with a copy WITHOUT the lock line: connection 2
 * then does not wait, does not see connection 1's uncommitted claim, and both take the unit - the
 * lock, not the count, is what holds the limit.
 *
 * This file COMMITS its rows (it races two connections), so it runs in the committing pass.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { db, inRollback, seedTenants, ORG_A } from './setup';
import { approvedAction, openTenant, refusalsOf, statusOf } from './helpers/c3ClaimFixtures';

const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20270217000021_atomic_guardrail_claim_and_engagement_reserve.sql'), 'utf8');
/** The CREATE OR REPLACE FUNCTION statement of `name`, exactly as migrated. */
function functionSql(name: string): string {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = MIGRATION.indexOf('$fn$;', start);
  if (start < 0 || end < 0) throw new Error(`function ${name} not found in the migration`);
  return MIGRATION.slice(start, end + '$fn$;'.length);
}
/** The same function WITHOUT its advisory lock (the no-lock control). */
function withoutLock(name: string): string {
  const sql = functionSql(name);
  const out = sql.replace(/PERFORM pg_advisory_xact_lock\([^;]*\);/, 'NULL; -- CONTROL: no lock');
  if (out === sql) throw new Error(`no advisory lock line in ${name} - the control would be vacuous`);
  return out;
}

let c1: Client;
let c2: Client;
let pid2: number;
const created: string[] = [];

async function within(c: Client | typeof db, id: string, source: 'scheduler' | 'evaluation', point = 'scheduler') {
  const { rows } = await c.query(`SELECT * FROM public.community_ai_claim_within_limits($1, $2, $2, $3, NULL, NULL, $4)`, [id, ORG_A, point, source]);
  return rows[0] as { claimed: boolean; code: string | null; current_status: string | null };
}
async function guardrails(limits: { daily?: number | null; perPost?: number | null; perEval?: number | null; enabled?: boolean } | null) {
  await db.query(`DELETE FROM public.execution_guardrails WHERE company_id = $1`, [ORG_A]);
  if (limits) {
    await db.query(
      `INSERT INTO public.execution_guardrails (company_id, auto_execution_enabled, daily_platform_limit, per_post_reply_limit, per_evaluation_limit)
       VALUES ($1, $2, $3, $4, $5)`, [ORG_A, limits.enabled ?? true, limits.daily ?? null, limits.perPost ?? null, limits.perEval ?? null]);
  }
}
async function action(o: { actionType?: string; targetId?: string } = {}) {
  const { id } = await approvedAction(db, { org: ORG_A, actionType: o.actionType ?? 'like', targetId: o.targetId });
  created.push(id);
  return id;
}
async function setStatus(id: string, status: string, executedAt: string | null) {
  await db.query(`UPDATE public.community_ai_actions SET status = $2, executed_at = $3::timestamptz WHERE id = $1`, [id, status, executedAt]);
}
/** Wait until connection 2 is blocked on an advisory lock (or fail after 5 s). */
async function waitUntilBlocked(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const { rows } = await db.query(`SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = $1`, [pid2]);
    if (rows[0]?.wait_event_type === 'Lock' && rows[0]?.wait_event === 'advisory') return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('connection 2 never waited on the advisory lock');
}
async function isBlocked(): Promise<boolean> {
  const { rows } = await db.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid2]);
  return rows[0]?.wait_event_type === 'Lock';
}

beforeAll(async () => {
  await db.query('BEGIN');
  await seedTenants();
  await openTenant(db, ORG_A, { auto: true });
  await db.query('COMMIT');
  c1 = new Client({ connectionString: process.env.W6_DB_URL });
  c2 = new Client({ connectionString: process.env.W6_DB_URL });
  await c1.connect();
  await c2.connect();
  pid2 = Number((await c2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
});
afterAll(async () => {
  await c1?.query('ROLLBACK').catch(() => undefined);
  await c2?.query('ROLLBACK').catch(() => undefined);
  await c1?.end().catch(() => undefined);
  await c2?.end().catch(() => undefined);
  // Restore the migrated functions (a failed control may have left the no-lock copy).
  await db.query(functionSql('community_ai_claim_within_limits')).catch(() => undefined);
  await db.query(functionSql('usage_execution_reserve')).catch(() => undefined);
  await db.query(`DELETE FROM public.usage_execution_reservations WHERE organization_id = $1`, [ORG_A]).catch(() => undefined);
  await db.query(`DELETE FROM public.execution_guardrails WHERE company_id = $1`, [ORG_A]).catch(() => undefined);
  await db.query(`DELETE FROM public.usage_meter_monthly WHERE organization_id = $1`, [ORG_A]).catch(() => undefined);
  if (created.length) {
    await db.query(`DELETE FROM public.community_ai_action_logs WHERE action_id = ANY($1::uuid[])`, [created]).catch(() => undefined);
    await db.query(`DELETE FROM public.community_ai_actions WHERE id = ANY($1::uuid[])`, [created]).catch(() => undefined);
  }
});

describe('A19 community_ai_claim_within_limits - two connections', () => {
  it('daily limit 1: connection 2 WAITS on the lock, then is REFUSED; its row stays approved with one refusal record', async () => {
    await guardrails({ daily: 1 });
    const x = await action();
    const y = await action();
    await c1.query('BEGIN');
    expect(await within(c1, x, 'scheduler')).toEqual({ claimed: true, code: null, current_status: 'executing' });
    const second = within(c2, y, 'scheduler');
    await waitUntilBlocked();
    await c1.query('COMMIT');
    expect(await second).toEqual({ claimed: false, code: 'GUARDRAIL_DAILY_PLATFORM_LIMIT', current_status: 'approved' });
    expect(await statusOf(db, y)).toBe('approved');
    expect((await refusalsOf(db, y)).map((r) => r.code)).toEqual(['GUARDRAIL_DAILY_PLATFORM_LIMIT']);
  });

  it('CONTROL - the same function WITHOUT the lock: connection 2 does not wait and BOTH claim (over the limit)', async () => {
    await guardrails({ daily: 1 });
    const x = await action();
    const y = await action();
    await db.query(withoutLock('community_ai_claim_within_limits'));
    try {
      await c1.query('BEGIN');
      expect((await within(c1, x, 'scheduler')).claimed).toBe(true);
      const second = within(c2, y, 'scheduler');
      await new Promise((r) => setTimeout(r, 300));
      expect(await isBlocked()).toBe(false);
      expect((await second).claimed).toBe(true); // did not see connection 1's uncommitted claim
      await c1.query('COMMIT');
    } finally {
      await c1.query('ROLLBACK').catch(() => undefined);
      await db.query(functionSql('community_ai_claim_within_limits'));
    }
  });
});

describe('A19 parity with canExecuteAction (single connection, rolled back)', () => {
  it('daily window is UTC midnight: executed yesterday 23:59:59 UTC does not count; today 00:00:00 UTC does', async () => {
    await inRollback(async () => {
      await guardrails({ daily: 1 });
      const old = await action();
      await setStatus(old, 'executed', `${new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}T23:59:59Z`);
      const a = await action();
      expect((await within(db, a, 'scheduler')).claimed).toBe(true);
      await setStatus(a, 'executed', `${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      const b = await action();
      expect((await within(db, b, 'scheduler')).code).toBe('GUARDRAIL_DAILY_PLATFORM_LIMIT');
    });
  });

  it('an EXECUTING row counts whatever its age', async () => {
    await inRollback(async () => {
      await guardrails({ daily: 1 });
      const stuck = await action();
      await setStatus(stuck, 'executing', null);
      await db.query(`UPDATE public.community_ai_actions SET updated_at = now() - interval '3 days' WHERE id = $1`, [stuck]);
      const a = await action();
      expect((await within(db, a, 'scheduler')).code).toBe('GUARDRAIL_DAILY_PLATFORM_LIMIT');
    });
  });

  it('per-post: counts replies to the SAME target only, and applies only to a reply (limit 1)', async () => {
    await inRollback(async () => {
      await guardrails({ perPost: 1 });
      const target = `https://www.linkedin.com/feed/update/urn:li:activity:pp-${Date.now()}/`;
      const done = await action({ actionType: 'reply', targetId: target });
      await setStatus(done, 'executed', new Date(Date.now() - 30 * 86_400_000).toISOString()); // any age counts
      expect((await within(db, await action({ actionType: 'reply', targetId: target }), 'scheduler')).code).toBe('GUARDRAIL_PER_POST_LIMIT');
      expect((await within(db, await action({ actionType: 'like', targetId: target }), 'scheduler')).claimed).toBe(true);
      expect((await within(db, await action({ actionType: 'reply' }), 'scheduler')).claimed).toBe(true);
    });
  });

  it('per-evaluation: only for source evaluation, last 10 minutes (limit 1)', async () => {
    await inRollback(async () => {
      await guardrails({ perEval: 1 });
      const recent = await action();
      await setStatus(recent, 'executed', new Date(Date.now() - 5 * 60_000).toISOString());
      expect((await within(db, await action(), 'evaluation', 'auto')).code).toBe('GUARDRAIL_PER_EVALUATION_LIMIT');
      expect((await within(db, await action(), 'scheduler')).claimed).toBe(true);
      await setStatus(recent, 'executed', new Date(Date.now() - 11 * 60_000).toISOString());
      expect((await within(db, await action(), 'evaluation', 'auto')).claimed).toBe(true);
    });
  });

  it('auto_execution_enabled false refuses; no guardrail row claims (default open)', async () => {
    await inRollback(async () => {
      await guardrails({ enabled: false });
      expect((await within(db, await action(), 'scheduler')).code).toBe('GUARDRAIL_AUTO_DISABLED');
      await guardrails(null);
      expect((await within(db, await action(), 'scheduler')).claimed).toBe(true);
    });
  });

  it('the CLAIM decides everything else, its answer unchanged: a row already executing -> CLAIM_CONFLICT; another org -> TENANT_SCOPE_VIOLATION', async () => {
    await inRollback(async () => {
      await guardrails({ daily: 100 });
      const a = await action();
      await setStatus(a, 'executing', null);
      expect(await within(db, a, 'scheduler')).toEqual({ claimed: false, code: 'CLAIM_CONFLICT', current_status: 'executing' });
      const b = await action();
      const { rows } = await db.query(`SELECT * FROM public.community_ai_claim_within_limits($1, $2, $2, 'scheduler', NULL, NULL, 'scheduler')`,
        [b, '00000000-0000-4000-8000-0000000000ff']);
      expect(rows[0].claimed).toBe(false);
      expect(rows[0].code).toBe('TENANT_SCOPE_VIOLATION');
    });
  });
});

describe('A20 usage_execution_reserve', () => {
  const ym = () => ({ y: new Date().getUTCFullYear(), m: new Date().getUTCMonth() + 1 });
  async function meter(n: number) {
    const { y, m } = ym();
    await db.query(`DELETE FROM public.usage_meter_monthly WHERE organization_id = $1`, [ORG_A]);
    await db.query(`INSERT INTO public.usage_meter_monthly (organization_id, year, month, automation_executions) VALUES ($1, $2, $3, $4)`, [ORG_A, y, m, n]);
  }
  async function reserve(c: Client | typeof db, actionId: string, allowedUntil = 10, ttl = 3600) {
    const { y, m } = ym();
    const { rows } = await c.query(`SELECT * FROM public.usage_execution_reserve($1, $2, $3, $4, $5, $6)`, [ORG_A, y, m, actionId, allowedUntil, ttl]);
    return rows[0] as { granted: boolean; reservation_id: string | null; used: string };
  }

  it('meter 9 of 10: connection 2 WAITS, then is REFUSED - one unit, one grant', async () => {
    await db.query(`DELETE FROM public.usage_execution_reservations WHERE organization_id = $1`, [ORG_A]);
    await meter(9);
    const x = await action();
    const y = await action();
    await c1.query('BEGIN');
    expect((await reserve(c1, x)).granted).toBe(true);
    const second = reserve(c2, y);
    await waitUntilBlocked();
    await c1.query('COMMIT');
    const r = await second;
    expect(r.granted).toBe(false);
    expect(Number(r.used)).toBe(10);
  });

  it('CONTROL - WITHOUT the lock: both are granted (overshoot)', async () => {
    await db.query(`DELETE FROM public.usage_execution_reservations WHERE organization_id = $1`, [ORG_A]);
    await meter(9);
    const x = await action();
    const y = await action();
    await db.query(withoutLock('usage_execution_reserve'));
    try {
      await c1.query('BEGIN');
      expect((await reserve(c1, x)).granted).toBe(true);
      expect((await reserve(c2, y)).granted).toBe(true);
      await c1.query('COMMIT');
    } finally {
      await c1.query('ROLLBACK').catch(() => undefined);
      await db.query(functionSql('usage_execution_reserve'));
    }
  });

  it('idempotent per action; a released reservation stops counting; an expired one does not count and is retired', async () => {
    await inRollback(async () => {
      await db.query(`DELETE FROM public.usage_execution_reservations WHERE organization_id = $1`, [ORG_A]);
      await meter(8);
      const x = await action();
      const first = await reserve(db, x);
      const again = await reserve(db, x);
      expect(again.reservation_id).toBe(first.reservation_id);           // same grant
      expect((await reserve(db, await action())).granted).toBe(true);    // 8 + 1 (x) + 1 = 10
      expect((await reserve(db, await action())).granted).toBe(false);   // full
      const { rows } = await db.query(`SELECT public.usage_execution_release($1, $2) AS ok`, [first.reservation_id, ORG_A]);
      expect(rows[0].ok).toBe(true);
      expect((await reserve(db, await action())).granted).toBe(true);    // x no longer counts
      await db.query(`UPDATE public.usage_execution_reservations SET reserved_at = now() - interval '2 hours' WHERE organization_id = $1 AND released_at IS NULL`, [ORG_A]);
      expect((await reserve(db, await action())).granted).toBe(true);    // expired ones (ttl 3600) do not count
    });
  });

  it('release of another organization\'s reservation does nothing', async () => {
    await inRollback(async () => {
      await meter(0);
      const r = await reserve(db, await action());
      const { rows } = await db.query(`SELECT public.usage_execution_release($1, $2) AS ok`, [r.reservation_id, '00000000-0000-4000-8000-0000000000ff']);
      expect(rows[0].ok).toBe(false);
    });
  });
});
