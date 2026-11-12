/**
 * 20270217000029_hard_delete_company_named_dependents.sql: REAL-POSTGRES proof (e9 ruling, 2026-11-13).
 * hard_delete_company refuses a company with campaigns or scheduled posts by NAME (COMPANY_HAS_CONTENT,
 * counts in DETAIL) before any delete; a company without content is deleted as before.
 *
 * Every case runs in a ROLLED-BACK transaction (non-committing). Ids are fresh per run.
 *
 *     npm run test:realschema -- hard_delete_company_named_dependents
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const MIGRATION_FILE = '20270217000029_hard_delete_company_named_dependents.sql';
const ROLLBACK_FILE = path.join('rollbacks', 'hard_delete_company_named_dependents_rollback.sql');
const PRE_IMAGE_MD5 = 'c6ab4be202337450548e1190c8c2d034'; // 20261210000001 body, CR removed

function unwrapped(file: string): string {
  const lines = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').split('\n');
  const out = lines.filter((l) => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;');
  if (lines.length - out.length !== 2) throw new Error(`${file}: expected exactly one BEGIN; and one COMMIT; line`);
  return out.join('\n');
}

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

async function attemptIn(c: Client, sql: string, params: unknown[] = []): Promise<{ ok: boolean; code?: string; message?: string; detail?: string }> {
  await c.query('SAVEPOINT a');
  try {
    await c.query(sql, params);
    await c.query('RELEASE SAVEPOINT a');
    return { ok: true };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT a');
    const err = e as { code?: string; message?: string; detail?: string };
    return { ok: false, code: err.code, message: err.message, detail: err.detail };
  }
}

async function seedCompany(c: Client) {
  const co = randomUUID();
  const user = randomUUID();
  await c.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'hdc-029')`, [co]);
  await c.query(`INSERT INTO public.users (id, email) VALUES ($1, $2)`, [user, `hdc-${user}@example.test`]);
  await c.query(`INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'MEMBER', 'active')`, [user, co]);
  return { co, user };
}
const hardDelete = (c: Client, co: string) =>
  attemptIn(c, `SELECT * FROM public.hard_delete_company($1::uuid, $1::uuid, 'hdc-029 test')`, [co]);
const remaining = async (c: Client, co: string) => (await c.query(
  `SELECT (SELECT count(*) FROM public.companies WHERE id = $1)::int AS company,
          (SELECT count(*) FROM public.user_company_roles WHERE company_id = $1)::int AS memberships`, [co])).rows[0];

describe('hard_delete_company refuses a company with content by name', () => {
  it('a company with a STANDALONE scheduled post: COMPANY_HAS_CONTENT (0 campaigns, 1 post), nothing deleted', () => rolledBack(async (c) => {
    const { co, user } = await seedCompany(c);
    await c.query(`INSERT INTO public.scheduled_posts (user_id, company_id, platform, content_type, content, scheduled_for)
                   VALUES ($1, $2, 'linkedin', 'post', 'hdc', now())`, [user, co]);
    const r = await hardDelete(c, co);
    expect(r).toMatchObject({ ok: false, code: 'P0001', message: 'COMPANY_HAS_CONTENT' });
    expect(r.detail).toMatch(/^0 campaign\(s\), 1 scheduled post\(s\)/);
    expect(await remaining(c, co)).toEqual({ company: 1, memberships: 1 });
  }));
  it('a company with a campaign: COMPANY_HAS_CONTENT (1 campaign), nothing deleted', () => rolledBack(async (c) => {
    const { co } = await seedCompany(c);
    await c.query(`INSERT INTO public.campaigns (id, name, company_id) VALUES ($1, 'hdc', $2)`, [randomUUID(), co]);
    const r = await hardDelete(c, co);
    expect(r).toMatchObject({ ok: false, code: 'P0001', message: 'COMPANY_HAS_CONTENT' });
    expect(r.detail).toMatch(/^1 campaign\(s\), 0 scheduled post\(s\)/);
    expect(await remaining(c, co)).toEqual({ company: 1, memberships: 1 });
  }));
  it('CONTROL: a company without content is hard-deleted (memberships too)', () => rolledBack(async (c) => {
    const { co } = await seedCompany(c);
    expect(await hardDelete(c, co)).toMatchObject({ ok: true });
    expect(await remaining(c, co)).toEqual({ company: 0, memberships: 0 });
  }));
  it('the existing checks still come first (COMPANY_NOT_FOUND)', () => rolledBack(async (c) => {
    expect(await hardDelete(c, randomUUID())).toMatchObject({ ok: false, message: 'COMPANY_NOT_FOUND' });
  }));
});

describe('the migration itself', () => {
  it('grants: EXECUTE for service_role only; SECURITY DEFINER with search_path=public', async () => {
    const r = (await db.query(`SELECT prosecdef, proconfig,
        has_function_privilege('anon', oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth,
        has_function_privilege('service_role', oid, 'EXECUTE') AS svc
      FROM pg_proc WHERE oid = 'public.hard_delete_company(uuid, uuid, text)'::regprocedure`)).rows[0];
    expect(r).toEqual({ prosecdef: true, proconfig: ['search_path=public'], anon: false, auth: false, svc: true });
  });
  it('re-applies cleanly (idempotent)', () => rolledBack(async (c) => {
    expect(await attemptIn(c, unwrapped(MIGRATION_FILE))).toMatchObject({ ok: true });
  }));
  it('its preflight REFUSES to overwrite a body that is neither the pre-image nor its own', () => rolledBack(async (c) => {
    await c.query(`CREATE OR REPLACE FUNCTION public.hard_delete_company(p_company_id uuid, p_actor uuid, p_reason text)
      RETURNS TABLE(deleted_memberships integer, deleted_profiles integer) LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = public AS $x$ BEGIN RETURN; END $x$`);
    const r = await attemptIn(c, unwrapped(MIGRATION_FILE));
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/refusing to overwrite/);
  }));
  it('the rollback restores the pre-image VERBATIM (md5) and the bare-23503 behaviour; re-apply restores the name', () => rolledBack(async (c) => {
    await c.query(unwrapped(ROLLBACK_FILE));
    const md5 = (await c.query(`SELECT md5(replace(prosrc, E'\\r', '')) AS m FROM pg_proc WHERE oid = 'public.hard_delete_company(uuid, uuid, text)'::regprocedure`)).rows[0].m;
    expect(md5).toBe(PRE_IMAGE_MD5);
    const { co } = await seedCompany(c);
    await c.query(`INSERT INTO public.campaigns (id, name, company_id) VALUES ($1, 'hdc', $2)`, [randomUUID(), co]);
    expect(await hardDelete(c, co)).toMatchObject({ ok: false, code: '23503' });
    expect(await attemptIn(c, unwrapped(MIGRATION_FILE))).toMatchObject({ ok: true });
    expect(await hardDelete(c, co)).toMatchObject({ ok: false, message: 'COMPANY_HAS_CONTENT' });
  }));
});
