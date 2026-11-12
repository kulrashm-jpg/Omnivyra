/**
 * CLASS-2 on REAL PostgreSQL (migration 20270217000008, community_ai_actions_one_pending), with
 * INDEPENDENT CONNECTIONS. e9 rule 2026-11-12: sandbox-only evidence does not close a unit.
 *
 * At most ONE pending community AI action per (tenant, organization, platform, action_type, target):
 * two writers that both read "none pending" and insert can no longer both succeed - the second waits
 * on the first's uncommitted index entry and, after the commit, fails 23505 (which the writers read
 * as "already pending"). CONTROL: with the index dropped (only it - the migration is not re-run),
 * both inserts commit: two pending rows, each of which could be approved and sent.
 *
 * Each arrangement is asserted before the subject. This file COMMITS its rows (two connections), so
 * it runs in the committing pass; it uses its own tenant id and deletes its rows.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { db, seedTenants, ORG_B } from './setup';

const ORG = ORG_B;
const TENANT = ORG_B;
const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20270217000008_community_ai_actions_pending_unique.sql'), 'utf8');
/** The CREATE UNIQUE INDEX statement exactly as migrated. */
function indexSql(): string {
  const start = MIGRATION.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS community_ai_actions_one_pending');
  const end = MIGRATION.indexOf(';', start);
  if (start < 0 || end < 0) throw new Error('index statement not found in the migration');
  return MIGRATION.slice(start, end + 1);
}

let c1: Client;
let c2: Client;
let pid2: number;
const created: string[] = [];
const target = () => `urn:li:activity:c08-${randomUUID()}`;

const INSERT = `INSERT INTO public.community_ai_actions (id, tenant_id, organization_id, platform, action_type, target_id, status)
                VALUES ($1, $2, $3, 'linkedin', 'reply', $4, $5)`;
async function insertOn(c: Client | typeof db, t: string, status = 'pending', tenant = TENANT): Promise<string> {
  const id = randomUUID();
  created.push(id);
  await c.query(INSERT, [id, tenant, ORG, t, status]);
  return id;
}
async function sqlstate(p: Promise<unknown>): Promise<string> {
  try { await p; return 'ok'; } catch (e: any) { return String(e?.code ?? 'error'); }
}
async function pendingCount(t: string): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.community_ai_actions WHERE target_id = $1 AND status = 'pending'`, [t]);
  return rows[0].n;
}
async function indexPresent(): Promise<boolean> {
  return (await db.query(`SELECT to_regclass('public.community_ai_actions_one_pending') IS NOT NULL AS ok`)).rows[0].ok;
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
    if (created.length) await c1.query(`DELETE FROM public.community_ai_actions WHERE id = ANY($1::uuid[])`, [created]);
    const { rows } = await c1.query(`SELECT to_regclass('public.community_ai_actions_one_pending') IS NOT NULL AS ok`);
    if (!rows[0].ok) await c1.query(indexSql()); // a failed control must not leave the index dropped
  }
  await c1?.end().catch(() => undefined);
  await c2?.end().catch(() => undefined);
});

describe('community_ai_actions_one_pending - single connection', () => {
  it('a second PENDING row for the same key is refused (23505)', async () => {
    expect(await indexPresent()).toBe(true);
    const t = target();
    await insertOn(db, t);
    expect(await sqlstate(insertOn(db, t))).toBe('23505');
    expect(await pendingCount(t)).toBe(1);
  });

  it('other statuses for the key, another target, and another tenant are allowed', async () => {
    const t = target();
    await insertOn(db, t);
    expect(await sqlstate(insertOn(db, t, 'approved'))).toBe('ok');
    expect(await sqlstate(insertOn(db, t, 'failed'))).toBe('ok');
    expect(await sqlstate(insertOn(db, target()))).toBe('ok');
    expect(await sqlstate(insertOn(db, t, 'pending', randomUUID()))).toBe('ok');
  });

  it('once the pending row moves on (approved), a new pending row for the key is allowed', async () => {
    const t = target();
    const first = await insertOn(db, t);
    const moved = await db.query(`UPDATE public.community_ai_actions SET status = 'approved' WHERE id = $1 RETURNING id`, [first]);
    expect(moved.rowCount).toBe(1); // arrangement: it really moved
    expect(await sqlstate(insertOn(db, t))).toBe('ok');
  });
});

describe('community_ai_actions_one_pending - two connections', () => {
  it('two writers insert the same pending action: connection 2 WAITS, then fails 23505 - ONE pending row', async () => {
    const t = target();
    await c1.query('BEGIN');
    await insertOn(c1, t);
    const second = sqlstate(insertOn(c2, t));
    let waited = false;
    for (let i = 0; i < 50 && !waited; i += 1) {
      const { rows } = await db.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid2]);
      waited = rows[0]?.wait_event_type === 'Lock';
      if (!waited) await new Promise((r) => setTimeout(r, 100));
    }
    expect(waited).toBe(true);
    await c1.query('COMMIT');
    expect(await second).toBe('23505');
    expect(await pendingCount(t)).toBe(1);
  });

  it('CONTROL - the index DROPPED: both writers commit, TWO pending rows (the duplicate that could be sent twice)', async () => {
    const t = target();
    await db.query('DROP INDEX public.community_ai_actions_one_pending');
    try {
      expect(await indexPresent()).toBe(false); // arrangement: the index is really gone
      await c1.query('BEGIN');
      await insertOn(c1, t);
      expect(await sqlstate(insertOn(c2, t))).toBe('ok'); // nothing to wait on
      await c1.query('COMMIT');
      expect(await pendingCount(t)).toBe(2);
    } finally {
      await c1.query('ROLLBACK').catch(() => undefined);
      // Restore: the duplicate must go before the unique index can be rebuilt.
      await db.query(`DELETE FROM public.community_ai_actions WHERE target_id = $1`, [t]);
      await db.query(indexSql());
    }
    expect(await indexPresent()).toBe(true);
  });
});
