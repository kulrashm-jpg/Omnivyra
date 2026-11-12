/**
 * 20270217000028_scheduled_posts_company_id.sql: REAL-POSTGRES proof (design approved by e9, 2026-11-13).
 * scheduled_posts.company_id is NOT NULL, FK -> companies ON DELETE RESTRICT, backfilled from three
 * populations, and guarded by a trigger that derives it and refuses a post whose campaign and social
 * account belong to different companies (the fast-track defect, now impossible at the database level).
 *
 * Every case runs in a ROLLED-BACK transaction: nothing persists in the shared CI database (a plain,
 * non-committing suite). Ids are fresh per run.
 *
 *     npm run test:realschema -- scheduled_posts_company_id
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const MIGRATION_FILE = '20270217000028_scheduled_posts_company_id.sql';
const ROLLBACK_FILE = path.join('rollbacks', 'scheduled_posts_company_id_rollback.sql');
const ROLLBACK_029 = path.join('rollbacks', 'hard_delete_company_named_dependents_rollback.sql');

function unwrapped(file: string): string {
  const lines = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').split('\n');
  const out = lines.filter((l) => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;');
  if (lines.length - out.length !== 2) throw new Error(`${file}: expected exactly one BEGIN; and one COMMIT; line`);
  return out.join('\n');
}

function verifyBlock(): string {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
  const marker = 'DO $' + 'verify$';
  const start = sql.indexOf(marker);
  const end = sql.indexOf('$' + 'verify$;', start + marker.length);
  if (start < 0 || end < 0) throw new Error('verify block not found');
  return sql.slice(start, end + ('$' + 'verify$;').length);
}

/** Rolls back 028 in the enforced order: 029 first (it is applied on this branch), then 028. */
async function rollback028(c: Client): Promise<void> {
  await c.query(unwrapped(ROLLBACK_029));
  await c.query(unwrapped(ROLLBACK_FILE));
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

async function attemptIn(c: Client, sql: string, params: unknown[] = []): Promise<{ ok: boolean; code?: string; message?: string; rows?: any[] }> {
  await c.query('SAVEPOINT a');
  try {
    const r = await c.query(sql, params);
    await c.query('RELEASE SAVEPOINT a');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT a');
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code, message: err.message };
  }
}

/** A fresh world: companies A and B, a campaign in each, a user, and accounts in A, B and none. */
async function seed(c: Client) {
  const w = {
    A: randomUUID(), B: randomUUID(), campA: randomUUID(), campB: randomUUID(),
    user: randomUUID(), user2: randomUUID(), saA: randomUUID(), saB: randomUUID(), saNone: randomUUID(),
  };
  await c.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'sp-A'), ($2, 'sp-B')`, [w.A, w.B]);
  await c.query(`INSERT INTO public.campaigns (id, name, company_id) VALUES ($1, 'sp-cA', $2), ($3, 'sp-cB', $4)`, [w.campA, w.A, w.campB, w.B]);
  await c.query(`INSERT INTO public.users (id, email) VALUES ($1, $2), ($3, $4)`,
    [w.user, `sp-${w.user}@example.test`, w.user2, `sp-${w.user2}@example.test`]);
  await c.query(`INSERT INTO public.user_company_roles (user_id, company_id, role, status)
                 VALUES ($1, $2, 'MEMBER', 'active'), ($1, $3, 'MEMBER', 'inactive'), ($4, $2, 'MEMBER', 'active')`,
    [w.user, w.A, w.B, w.user2]);
  const acct = (id: string, co: string | null) => c.query(
    `INSERT INTO public.social_accounts (id, user_id, platform, platform_user_id, account_name, access_token, company_id, is_active)
     VALUES ($1::uuid, $2, 'linkedin', $1::text, 'sp', 'not-a-token', $3, true)`, [id, w.user, co]);
  await acct(w.saA, w.A); await acct(w.saB, w.B); await acct(w.saNone, null);
  return w;
}

const insertPost = (c: Client, p: { user: string; campaign?: string | null; account?: string | null; company?: string | null }) =>
  attemptIn(c, `INSERT INTO public.scheduled_posts (user_id, campaign_id, social_account_id, company_id, platform, content_type, content, scheduled_for)
                VALUES ($1, $2, $3, $4, 'linkedin', 'post', 'sp', now() + interval '1 day') RETURNING id, company_id`,
    [p.user, p.campaign ?? null, p.account ?? null, p.company ?? null]);

describe('catalog state', () => {
  it('company_id is NOT NULL with exactly one FK -> companies(id) ON DELETE RESTRICT', async () => {
    const nn = (await db.query(`SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.scheduled_posts'::regclass AND attname = 'company_id' AND NOT attisdropped`)).rows[0];
    expect(nn).toEqual({ attnotnull: true });
    const fks = (await db.query(`SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.scheduled_posts'::regclass AND contype = 'f' AND confrelid = 'public.companies'::regclass`)).rows;
    expect(fks).toEqual([{ confdeltype: 'r' }]);
  });
  it('the guard is SECURITY INVOKER, search_path empty, not executable by anon/authenticated', async () => {
    const r = (await db.query(`SELECT prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth FROM pg_proc WHERE oid = 'public.scheduled_posts_company_id_guard()'::regprocedure`)).rows[0];
    expect(r).toEqual({ prosecdef: false, proconfig: ['search_path=""'], anon: false, auth: false });
  });
});

describe('the guard trigger', () => {
  it('derives the company from the campaign', () => rolledBack(async (c) => {
    const w = await seed(c);
    expect(await insertPost(c, { user: w.user, campaign: w.campB })).toMatchObject({ ok: true, rows: [{ company_id: w.B }] });
  }));
  it('derives the company from the account (standalone post)', () => rolledBack(async (c) => {
    const w = await seed(c);
    expect(await insertPost(c, { user: w.user, account: w.saA })).toMatchObject({ ok: true, rows: [{ company_id: w.A }] });
  }));
  it("CRITICAL: company A's campaign post on company B's account is REFUSED (23514)", () => rolledBack(async (c) => {
    const w = await seed(c);
    expect(await insertPost(c, { user: w.user, campaign: w.campA, account: w.saB })).toMatchObject({ ok: false, code: '23514' });
  }));
  it('a campaign post on a company-less account is REFUSED (23514)', () => rolledBack(async (c) => {
    const w = await seed(c);
    expect(await insertPost(c, { user: w.user, campaign: w.campA, account: w.saNone })).toMatchObject({ ok: false, code: '23514' });
  }));
  it('no campaign, no account, no company: REFUSED by the trigger (23502, its own message)', () => rolledBack(async (c) => {
    const w = await seed(c);
    const r = await insertPost(c, { user: w.user });
    expect(r).toMatchObject({ ok: false, code: '23502' });
    expect(r.message).toMatch(/no company can be derived/);
  }));
  it('an explicit company contradicting the campaign is REFUSED (23514)', () => rolledBack(async (c) => {
    const w = await seed(c);
    expect(await insertPost(c, { user: w.user, campaign: w.campA, company: w.B })).toMatchObject({ ok: false, code: '23514' });
  }));
  it('UPDATE moving a campaign-A post onto a company-B account is REFUSED; an unrelated UPDATE is not checked', () => rolledBack(async (c) => {
    const w = await seed(c);
    const id = (await insertPost(c, { user: w.user, campaign: w.campA, account: w.saA })).rows![0].id;
    expect(await attemptIn(c, `UPDATE public.scheduled_posts SET social_account_id = $2 WHERE id = $1`, [id, w.saB]))
      .toMatchObject({ ok: false, code: '23514' });
    expect(await attemptIn(c, `UPDATE public.scheduled_posts SET status = 'scheduled' WHERE id = $1`, [id])).toMatchObject({ ok: true });
  }));
  it('deleting a company that still has posts is RESTRICTed (23503); CONTROL: without the post it deletes', () => rolledBack(async (c) => {
    const w = await seed(c);
    const C = randomUUID(); // a company with NO campaigns, so only the scheduled_posts FK can refuse
    await c.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'sp-C')`, [C]);
    const post = await insertPost(c, { user: w.user, company: C });
    expect(post.ok).toBe(true);
    expect(await attemptIn(c, `DELETE FROM public.companies WHERE id = $1`, [C])).toMatchObject({ ok: false, code: '23503' });
    await c.query(`DELETE FROM public.scheduled_posts WHERE id = $1`, [post.rows![0].id]);
    expect(await attemptIn(c, `DELETE FROM public.companies WHERE id = $1`, [C])).toMatchObject({ ok: true });
  }));
});

describe('the migration itself', () => {
  it('HEAD CONTROL: without 028 the cross-company post is ACCEPTED; with it, REFUSED', () => rolledBack(async (c) => {
    const w = await seed(c);
    await rollback028(c);
    const before = await attemptIn(c, `INSERT INTO public.scheduled_posts (user_id, campaign_id, social_account_id, platform, content_type, content, scheduled_for)
                                       VALUES ($1, $2, $3, 'linkedin', 'post', 'sp', now()) RETURNING id`, [w.user, w.campA, w.saB]);
    expect(before.ok).toBe(true);
    await c.query(`DELETE FROM public.scheduled_posts WHERE id = $1`, [before.rows![0].id]);
    await c.query(unwrapped(MIGRATION_FILE));
    expect(await insertPost(c, { user: w.user, campaign: w.campA, account: w.saB })).toMatchObject({ ok: false, code: '23514' });
  }));
  it('re-applies cleanly on the applied state (idempotent)', () => rolledBack(async (c) => {
    expect(await attemptIn(c, unwrapped(MIGRATION_FILE))).toMatchObject({ ok: true });
  }));
  it('backfills each population from its own source: (a) campaign, (b) account with ANY membership, (c) single active company', () => rolledBack(async (c) => {
    const w = await seed(c);
    await rollback028(c);
    const ins = async (campaign: string | null, account: string | null, user = w.user) => (await c.query(
      `INSERT INTO public.scheduled_posts (user_id, campaign_id, social_account_id, platform, content_type, content, scheduled_for)
       VALUES ($1, $2, $3, 'linkedin', 'post', 'sp', now()) RETURNING id`, [user, campaign, account])).rows[0].id as string;
    const a = await ins(w.campB, w.saB);
    const b = await ins(null, w.saB); // creator's B membership is INACTIVE: ANY membership counts for (b)
    const cc = await ins(null, null, w.user2); // user2: exactly one active company (A)
    const r = await attemptIn(c, unwrapped(MIGRATION_FILE));
    if (!r.ok) throw new Error(r.message); // other rows in the shared DB may legitimately refuse; surfaced verbatim
    const got = (await c.query(`SELECT id, company_id FROM public.scheduled_posts WHERE id = ANY($1)`, [[a, b, cc]])).rows;
    expect(Object.fromEntries(got.map((x: any) => [x.id, x.company_id]))).toEqual({ [a]: w.B, [b]: w.B, [cc]: w.A });
  }));
  it.each([
    ['(a) account in another company', (w: any) => [w.user, w.campA, w.saB], /preflight \(a\): posts whose social account/],
    ['(b) company-less account', (w: any) => [w.user, null, w.saNone], /preflight \(b\): standalone posts whose account has no company/],
    ['(b) creator not a member of the account company', (w: any) => [w.user2, null, w.saB], /preflight \(b\): standalone posts whose account company is not one/],
    ['(c) creator with no active company', (w: any) => [randomUUID(), null, null], /preflight \(c\)/],
  ])('its preflight REFUSES %s, naming the post, and changes nothing', (_label, row, pattern) => rolledBack(async (c) => {
    const w = await seed(c);
    await rollback028(c);
    const [user, campaign, account] = (row as (w: any) => unknown[])(w);
    if (user !== w.user && user !== w.user2) await c.query(`INSERT INTO public.users (id, email) VALUES ($1, $2)`, [user, `sp-${user}@example.test`]);
    const id = (await c.query(`INSERT INTO public.scheduled_posts (user_id, campaign_id, social_account_id, platform, content_type, content, scheduled_for)
                               VALUES ($1, $2, $3, 'linkedin', 'post', 'sp', now()) RETURNING id`, [user, campaign, account])).rows[0].id;
    const r = await attemptIn(c, unwrapped(MIGRATION_FILE));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(pattern as RegExp);
    expect(r.message).toContain(id);
    const col = (await c.query(`SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.scheduled_posts'::regclass AND attname = 'company_id' AND NOT attisdropped`)).rows[0].n;
    expect(col).toBe(0);
  }));
  it('PROVENANCE: a company_id column 028 did not create is refused by the apply AND by the rollback', () => rolledBack(async (c) => {
    await rollback028(c);
    await c.query('ALTER TABLE public.scheduled_posts ADD COLUMN company_id uuid'); // someone else's column
    const apply = await attemptIn(c, unwrapped(MIGRATION_FILE));
    expect(apply).toMatchObject({ ok: false });
    expect(apply.message).toMatch(/refusing to adopt it/);
    const rb = await attemptIn(c, unwrapped(ROLLBACK_FILE));
    expect(rb).toMatchObject({ ok: false });
    expect(rb.message).toMatch(/refusing to drop it/);
  }));
  it('CONTROL: its verify block CATCHES a SECURITY DEFINER guard', () => rolledBack(async (c) => {
    await c.query('ALTER FUNCTION public.scheduled_posts_company_id_guard() SECURITY DEFINER');
    const r = await attemptIn(c, verifyBlock());
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/must be SECURITY INVOKER/);
  }));
  it('the rollback removes the column, triggers and function; re-applying restores them', () => rolledBack(async (c) => {
    await rollback028(c);
    const gone = (await c.query(`SELECT to_regprocedure('public.scheduled_posts_company_id_guard()') AS f`)).rows[0].f;
    expect(gone).toBeNull();
    expect(await attemptIn(c, unwrapped(MIGRATION_FILE))).toMatchObject({ ok: true });
  }));
});

describe('social_accounts never move between companies (e9 option B)', () => {
  it('X -> Y is REFUSED (23514); X -> NULL is REFUSED', () => rolledBack(async (c) => {
    const w = await seed(c);
    expect(await attemptIn(c, `UPDATE public.social_accounts SET company_id = $2 WHERE id = $1`, [w.saA, w.B]))
      .toMatchObject({ ok: false, code: '23514' });
    expect(await attemptIn(c, `UPDATE public.social_accounts SET company_id = NULL WHERE id = $1`, [w.saA]))
      .toMatchObject({ ok: false, code: '23514' });
  }));
  it('CONTROL: NULL -> X adoption is ALLOWED (linkedin / x / youtube legacy rows)', () => rolledBack(async (c) => {
    const w = await seed(c);
    expect(await attemptIn(c, `UPDATE public.social_accounts SET company_id = $2 WHERE id = $1`, [w.saNone, w.A]))
      .toMatchObject({ ok: true });
  }));
  it('CONTROL: unrelated column updates (and re-asserting the same company) are unaffected', () => rolledBack(async (c) => {
    const w = await seed(c);
    expect(await attemptIn(c, `UPDATE public.social_accounts SET account_name = 'renamed', company_id = $2 WHERE id = $1`, [w.saA, w.A]))
      .toMatchObject({ ok: true });
  }));
  it('HEAD CONTROL: without 028 an account CAN move company; with it, it cannot', () => rolledBack(async (c) => {
    const w = await seed(c);
    await rollback028(c);
    expect(await attemptIn(c, `UPDATE public.social_accounts SET company_id = $2 WHERE id = $1`, [w.saA, w.B])).toMatchObject({ ok: true });
    await c.query(`UPDATE public.social_accounts SET company_id = $2 WHERE id = $1`, [w.saA, w.A]);
    await c.query(unwrapped(MIGRATION_FILE));
    expect(await attemptIn(c, `UPDATE public.social_accounts SET company_id = $2 WHERE id = $1`, [w.saA, w.B]))
      .toMatchObject({ ok: false, code: '23514' });
  }));
  it('the trigger function is SECURITY INVOKER, search_path empty, not executable by anon/authenticated', async () => {
    const r = (await db.query(`SELECT prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth FROM pg_proc WHERE oid = 'public.social_accounts_company_id_immutable()'::regprocedure`)).rows[0];
    expect(r).toEqual({ prosecdef: false, proconfig: ['search_path=""'], anon: false, auth: false });
  });
});

describe('05 review: enforced rollback order and the orphan repair path', () => {
  it("028's rollback REFUSES while 029's hard_delete_company is applied (roll back 029 first)", () => rolledBack(async (c) => {
    const r = await attemptIn(c, unwrapped(ROLLBACK_FILE));
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/roll back 20270217000029 first/);
  }));
  it('an orphaned account (its company no longer exists) can be cleared X -> NULL; a live one cannot', () => rolledBack(async (c) => {
    const w = await seed(c);
    const gone = randomUUID();
    await c.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'sp-gone')`, [gone]);
    const orphan = randomUUID();
    await c.query(`INSERT INTO public.social_accounts (id, user_id, platform, platform_user_id, account_name, access_token, company_id, is_active)
                   VALUES ($1::uuid, $2, 'linkedin', $1::text, 'sp', 'not-a-token', $3, true)`, [orphan, w.user, gone]);
    await c.query(`DELETE FROM public.companies WHERE id = $1`, [gone]); // no FK from social_accounts: the id dangles
    expect(await attemptIn(c, `UPDATE public.social_accounts SET company_id = NULL WHERE id = $1`, [orphan])).toMatchObject({ ok: true });
    expect(await attemptIn(c, `UPDATE public.social_accounts SET company_id = NULL WHERE id = $1`, [w.saA])).toMatchObject({ ok: false, code: '23514' });
  }));
});

describe('05 review F3: the orphan existence test is not answered under the caller\'s RLS', () => {
  it('sp_company_row_exists is SECURITY DEFINER, STABLE, search_path pg_catalog, public; EXECUTE for service_role only', async () => {
    const r = (await db.query(`SELECT prosecdef, provolatile, proconfig,
        has_function_privilege('anon', oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth,
        has_function_privilege('service_role', oid, 'EXECUTE') AS svc
      FROM pg_proc WHERE oid = 'public.sp_company_row_exists(uuid)'::regprocedure`)).rows[0];
    expect(r).toEqual({ prosecdef: true, provolatile: 's', proconfig: ['search_path=pg_catalog, public'], anon: false, auth: false, svc: true });
  });
  it('the immutability trigger calls the helper (not an inline RLS-subject EXISTS)', async () => {
    const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE oid = 'public.social_accounts_company_id_immutable()'::regprocedure`)).rows[0].prosrc as string;
    expect(src).toContain('public.sp_company_row_exists(OLD.company_id)');
    expect(src).not.toMatch(/FROM public\.companies/);
  });
});
