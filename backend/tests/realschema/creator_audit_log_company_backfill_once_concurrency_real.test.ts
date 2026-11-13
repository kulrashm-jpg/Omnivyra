/**
 * 20270217000048_creator_audit_log_company_backfill_once.sql: REAL-POSTGRES proof (owner ruling via 83, 2026-11-13).
 * One-time company_id backfill of NULL creator_audit_log rows under an append-only trigger that is disabled ONLY
 * inside the migration's own transaction.
 *
 * COMMITTING suite (CI runs *_concurrency_real files in the second pass): the atomicity negative control commits a
 * seed world, runs the WHOLE migration file with a forced failure between DISABLE and ENABLE in its own transaction,
 * then inspects the trigger and rows from a SECOND connection. Seeds are removed in finally.
 *
 *     npm run test:realschema -- creator_audit_log_company_backfill_once_concurrency_real
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const FILE = path.resolve(__dirname, '../../../supabase/migrations/20270217000048_creator_audit_log_company_backfill_once.sql');
const RAW = fs.readFileSync(FILE, 'utf8');
function unwrapped(sql: string): string {
  const lines = sql.split('\n');
  const out = lines.filter((l) => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;');
  if (lines.length - out.length !== 2) throw new Error('expected exactly one BEGIN; and one COMMIT; line');
  return out.join('\n');
}
const BODY = unwrapped(RAW);

async function rolledBack<T>(body: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    return await body(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}
async function attemptIn(c: Client, sql: string): Promise<{ ok: boolean; code?: string; message?: string }> {
  await c.query('SAVEPOINT a');
  try {
    await c.query(sql);
    await c.query('RELEASE SAVEPOINT a');
    return { ok: true };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT a');
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code, message: err.message };
  }
}
const triggerState = async (c: Client) => (await c.query(
  `SELECT t.tgenabled::text AS s FROM pg_trigger t JOIN pg_class k ON k.oid = t.tgrelid
    WHERE k.relname = 'creator_audit_log' AND t.tgname = 'trg_creator_audit_log_no_update'`)).rows[0]?.s;

async function seedWorld(c: Client, companyA = randomUUID()) {
  const companyB = randomUUID();
  const user = randomUUID();
  const campA = randomUUID();
  const campB = randomUUID();
  const postA = randomUUID();
  await c.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'cal048-a'), ($2, 'cal048-b')`, [companyA, companyB]);
  await c.query(`INSERT INTO public.users (id, email) VALUES ($1, $2)`, [user, `cal048-${user}@example.test`]);
  await c.query(`INSERT INTO public.campaigns (id, name, company_id) VALUES ($1, 'a', $2), ($3, 'b', $4)`, [campA, companyA, campB, companyB]);
  await c.query(`INSERT INTO public.scheduled_posts (id, user_id, campaign_id, platform, content_type, content, scheduled_for)
                 VALUES ($1, $2, $3, 'linkedin', 'post', 'x', now())`, [postA, user, campA]);
  const ins = async (campaign: string | null, post: string | null, company: string | null = null) => (await c.query(
    `INSERT INTO public.creator_audit_log (action, campaign_id, scheduled_post_id, company_id)
     VALUES ('publish_succeeded', $1, $2, $3) RETURNING id`, [campaign, post, company])).rows[0].id as string;
  return {
    companyA, companyB,
    viaCampaign: await ins(campA, postA),
    viaPost: await ins(null, postA),
    unresolved: await ins(null, null),
    conflict: await ins(campB, postA), // campaign says B, post's campaign says A
    alreadySet: await ins(campA, postA, companyB), // deliberately "wrong" - a non-NULL row is never touched
  };
}
const companyOf = async (c: Client, id: string) => (await c.query(`SELECT company_id FROM public.creator_audit_log WHERE id = $1`, [id])).rows[0].company_id;

describe('048 atomicity (committing)', () => {
  it('NEGATIVE CONTROL (atomicity): a failure AFTER the DISABLE rolls back everything - from another session the trigger is ON and no row changed', async () => {
    const setup = new Client({ connectionString: url });
    await setup.connect();
    // commit a world so a second session can see it; removed in finally
    await setup.query('BEGIN');
    const w = await seedWorld(setup as unknown as Client);
    await setup.query('COMMIT');
    try {
      const sabotaged = RAW.replace(
        'ALTER TABLE public.creator_audit_log ENABLE TRIGGER trg_creator_audit_log_no_update;',
        'SELECT 1 / 0; -- forced failure between DISABLE and ENABLE\nALTER TABLE public.creator_audit_log ENABLE TRIGGER trg_creator_audit_log_no_update;',
      );
      expect(sabotaged).not.toBe(RAW); // the sabotage really applied
      const runner = new Client({ connectionString: url });
      await runner.connect();
      let failed: { code?: string } | null = null;
      try { await runner.query(sabotaged); } catch (e) { failed = e as { code?: string }; }
      await runner.query('ROLLBACK').catch(() => undefined);
      await runner.end();
      expect(failed?.code).toBe('22012'); // division_by_zero
      const observer = new Client({ connectionString: url });
      await observer.connect();
      try {
        expect(await triggerState(observer)).toBe('O');
        expect(await companyOf(observer, w.viaCampaign)).toBeNull();
      } finally {
        await observer.end();
      }
    } finally {
      // cleanup needs the trigger off for DELETE: do it in one transaction and restore
      await setup.query('BEGIN');
      await setup.query('ALTER TABLE public.creator_audit_log DISABLE TRIGGER trg_creator_audit_log_no_update');
      await setup.query('DELETE FROM public.creator_audit_log WHERE id = ANY($1::uuid[])', [[w.viaCampaign, w.viaPost, w.unresolved, w.conflict, w.alreadySet]]);
      await setup.query('ALTER TABLE public.creator_audit_log ENABLE TRIGGER trg_creator_audit_log_no_update');
      await setup.query(`DELETE FROM public.scheduled_posts WHERE content = 'x' AND campaign_id IN (SELECT id FROM public.campaigns WHERE company_id IN ($1, $2))`, [w.companyA, w.companyB]);
      await setup.query('DELETE FROM public.campaigns WHERE company_id IN ($1, $2)', [w.companyA, w.companyB]);
      await setup.query('DELETE FROM public.companies WHERE id IN ($1, $2)', [w.companyA, w.companyB]);
      await setup.query(`DELETE FROM public.users WHERE email LIKE 'cal048-%@example.test'`);
      await setup.query('COMMIT');
      await setup.end();
    }
  });
});

void db;
