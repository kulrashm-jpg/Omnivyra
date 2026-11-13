/**
 * 20270217000048_creator_audit_log_company_backfill_once.sql: REAL-POSTGRES proof (owner ruling via 83, 2026-11-13).
 * One-time company_id backfill of NULL creator_audit_log rows under an append-only trigger that is disabled ONLY
 * inside the migration's own transaction.
 *
 * Cases run in ROLLED-BACK transactions (non-committing), except the atomicity control, which runs the whole file in
 * its own transaction that FAILS (so nothing commits) and then inspects the trigger from a second connection.
 *
 *     npm run test:realschema -- creator_audit_log_company_backfill_once
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

describe('048 creator_audit_log one-time company backfill', () => {
  it('resolves via campaign, then via the post\'s campaign; conflicts and unresolved stay NULL; set rows untouched; trigger back ON', () => rolledBack(async (c) => {
    const w = await seedWorld(c);
    expect(await triggerState(c)).toBe('O');
    expect(await attemptIn(c, BODY)).toEqual({ ok: true });
    expect(await companyOf(c, w.viaCampaign)).toBe(w.companyA);
    expect(await companyOf(c, w.viaPost)).toBe(w.companyA);
    expect(await companyOf(c, w.unresolved)).toBeNull();
    expect(await companyOf(c, w.conflict)).toBeNull();
    expect(await companyOf(c, w.alreadySet)).toBe(w.companyB);
    expect(await triggerState(c)).toBe('O');
    // the append-only guarantee is back: an UPDATE is refused again
    const r = await attemptIn(c, `UPDATE public.creator_audit_log SET company_id = NULL WHERE id = '${w.viaCampaign}'`);
    expect(r).toMatchObject({ ok: false, code: 'P0001' });
    expect(r.message).toMatch(/append-only/);
  }));

  it('re-apply is a no-op (0 resolvable rows) and leaves the trigger ON', () => rolledBack(async (c) => {
    const w = await seedWorld(c);
    expect(await attemptIn(c, BODY)).toEqual({ ok: true });
    expect(await attemptIn(c, BODY)).toEqual({ ok: true });
    expect(await companyOf(c, w.viaPost)).toBe(w.companyA);
    expect(await triggerState(c)).toBe('O');
  }));

  it('Embrosales STOP: a row resolving to 73e5fa6f aborts the whole migration; nothing written, trigger untouched', () => rolledBack(async (c) => {
    const emb = `73e5fa6f-${randomUUID().slice(9)}`;
    const w = await seedWorld(c, emb);
    const r = await attemptIn(c, BODY);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/048 STOP: .* Embrosales/);
    expect(await companyOf(c, w.viaCampaign)).toBeNull();
    expect(await triggerState(c)).toBe('O');
  }));

});

void db;
