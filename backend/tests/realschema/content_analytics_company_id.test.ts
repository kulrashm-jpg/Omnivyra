/**
 * 20270217000030_content_analytics_company_id.sql: REAL-POSTGRES proof.
 * content_analytics.company_id is NOT NULL, FK -> companies ON DELETE RESTRICT, and a guard trigger derives it from
 * the row's scheduled post and refuses any value that disagrees.
 *
 * Every case runs in a ROLLED-BACK transaction (non-committing). Ids are fresh per run.
 *
 *     npm run test:realschema -- content_analytics_company_id
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const MIGRATION_FILE = '20270217000030_content_analytics_company_id.sql';
const ROLLBACK_FILE = path.join('rollbacks', 'content_analytics_company_id_rollback.sql');

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

/** Two companies, a user in A, and a standalone post of A (company given explicitly: 028 accepts it). */
async function seed(c: Client) {
  const A = randomUUID(), B = randomUUID(), user = randomUUID();
  await c.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'ca-A'), ($2, 'ca-B')`, [A, B]);
  await c.query(`INSERT INTO public.users (id, email) VALUES ($1, $2)`, [user, `ca-${user}@example.test`]);
  const post = (await c.query(
    `INSERT INTO public.scheduled_posts (user_id, company_id, platform, content_type, content, scheduled_for)
     VALUES ($1, $2, 'linkedin', 'post', 'ca', now()) RETURNING id`, [user, A])).rows[0].id as string;
  return { A, B, user, post };
}
const insertAnalytics = (c: Client, post: string, company: string | null = null) =>
  attemptIn(c, `INSERT INTO public.content_analytics (scheduled_post_id, platform, content_type, date, company_id)
                VALUES ($1, 'linkedin', 'post', current_date, $2) RETURNING company_id`, [post, company]);

describe('catalog state', () => {
  it('company_id is NOT NULL with exactly one FK -> companies(id) ON DELETE RESTRICT', async () => {
    const nn = (await db.query(`SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.content_analytics'::regclass AND attname = 'company_id' AND NOT attisdropped`)).rows[0];
    expect(nn).toEqual({ attnotnull: true });
    const fks = (await db.query(`SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.content_analytics'::regclass AND contype = 'f' AND confrelid = 'public.companies'::regclass`)).rows;
    expect(fks).toEqual([{ confdeltype: 'r' }]);
  });
  it('the guard is SECURITY INVOKER, search_path empty, not executable by anon/authenticated', async () => {
    const r = (await db.query(`SELECT prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth FROM pg_proc WHERE oid = 'public.content_analytics_company_id_guard()'::regprocedure`)).rows[0];
    expect(r).toEqual({ prosecdef: false, proconfig: ['search_path=""'], anon: false, auth: false });
  });
});

describe('the guard trigger', () => {
  it("an analytics row gets its post's company", () => rolledBack(async (c) => {
    const { A, post } = await seed(c);
    expect(await insertAnalytics(c, post)).toMatchObject({ ok: true, rows: [{ company_id: A }] });
  }));
  it("CRITICAL: an analytics row naming ANOTHER company than its post's is refused (23514)", () => rolledBack(async (c) => {
    const { B, post } = await seed(c);
    expect(await insertAnalytics(c, post, B)).toMatchObject({ ok: false, code: '23514' });
  }));
  it('an unrelated UPDATE (views) is not checked; moving the row to another company is refused', () => rolledBack(async (c) => {
    const { B, post } = await seed(c);
    await insertAnalytics(c, post);
    expect(await attemptIn(c, `UPDATE public.content_analytics SET views = 7 WHERE scheduled_post_id = $1`, [post])).toMatchObject({ ok: true });
    expect(await attemptIn(c, `UPDATE public.content_analytics SET company_id = $2 WHERE scheduled_post_id = $1`, [post, B]))
      .toMatchObject({ ok: false, code: '23514' });
  }));
});

describe('the migration itself', () => {
  it('HEAD CONTROL: without 030 a row is stored with no company; with it, the company is derived', () => rolledBack(async (c) => {
    await c.query(unwrapped(ROLLBACK_FILE));
    const { A, post } = await seed(c);
    const before = await attemptIn(c, `INSERT INTO public.content_analytics (scheduled_post_id, platform, content_type, date)
                                       VALUES ($1, 'linkedin', 'post', current_date) RETURNING id`, [post]);
    expect(before.ok).toBe(true);
    expect(await attemptIn(c, unwrapped(MIGRATION_FILE))).toMatchObject({ ok: true }); // backfills it from the post
    const after = (await c.query(`SELECT company_id FROM public.content_analytics WHERE id = $1`, [before.rows![0].id])).rows[0];
    expect(after).toEqual({ company_id: A });
  }));
  it('re-applies cleanly on the applied state (idempotent)', () => rolledBack(async (c) => {
    expect(await attemptIn(c, unwrapped(MIGRATION_FILE))).toMatchObject({ ok: true });
  }));
  it('PROVENANCE: a company_id column 030 did not create is refused by the apply AND by the rollback', () => rolledBack(async (c) => {
    await c.query(unwrapped(ROLLBACK_FILE));
    await c.query('ALTER TABLE public.content_analytics ADD COLUMN company_id uuid');
    const apply = await attemptIn(c, unwrapped(MIGRATION_FILE));
    expect(apply).toMatchObject({ ok: false });
    expect(apply.message).toMatch(/refusing to adopt it/);
    const rb = await attemptIn(c, unwrapped(ROLLBACK_FILE));
    expect(rb).toMatchObject({ ok: false });
    expect(rb.message).toMatch(/refusing to drop it/);
  }));
  it("028's rollback REFUSES while 030 is applied (roll back 030 first)", () => rolledBack(async (c) => {
    await c.query(unwrapped(path.join('rollbacks', 'hard_delete_company_named_dependents_rollback.sql')));
    const r = await attemptIn(c, unwrapped(path.join('rollbacks', 'scheduled_posts_company_id_rollback.sql')));
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/roll back 20270217000030 first/);
  }));
});
