/**
 * 20270217000025_campaigns_company_id_not_null.sql: REAL-POSTGRES proof (owner ruling, option A).
 * campaigns.company_id is NOT NULL and campaigns_company_id_fkey is ON DELETE RESTRICT.
 *
 * Every case runs in a ROLLED-BACK transaction as the connection's own role: nothing persists in the
 * shared CI database (so this is a plain, non-committing suite).
 *
 *     npm run test:realschema -- campaigns_company_id_not_null
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const MIGRATION_FILE = '20270217000025_campaigns_company_id_not_null.sql';
const ROLLBACK_FILE = path.join('rollbacks', 'campaigns_company_id_not_null_rollback.sql');

const CO = '0000c0de-0000-4000-8000-00000000c025';
const CAMP = '0000ca4e-0000-4000-8000-00000000c025';
const ACTOR = '0000ac70-0000-4000-8000-00000000c025';

/** The file's statements without its own BEGIN/COMMIT (the test owns the transaction). */
function unwrapped(file: string): string {
  const lines = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').split('\n');
  const out = lines.filter((l) => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;');
  if (lines.length - out.length !== 2) throw new Error(`${file}: expected exactly one BEGIN; and one COMMIT; line`);
  return out.join('\n');
}

/** The migration's own postcondition block, run alone (to prove it catches a widened FK). */
function verifyBlock(): string {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
  const marker = 'DO $' + 'verify$';
  const start = sql.indexOf(marker);
  const end = sql.indexOf('$' + 'verify$;', start + marker.length);
  if (start < 0 || end < 0) throw new Error('verify block not found');
  return sql.slice(start, end + ('$' + 'verify$;').length);
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

/** Runs sql under a savepoint; returns the SQLSTATE/message on failure, the tx stays usable. */
async function attemptIn(c: Client, sql: string, params: unknown[] = []): Promise<{ ok: boolean; code?: string; message?: string }> {
  await c.query('SAVEPOINT a');
  try {
    await c.query(sql, params);
    await c.query('RELEASE SAVEPOINT a');
    return { ok: true };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT a');
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code, message: err.message };
  }
}

const seedCompany = (c: Client) => c.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'nn-co')`, [CO]);
const seedCampaign = (c: Client, companyId: string | null) =>
  c.query(`INSERT INTO public.campaigns (id, name, company_id) VALUES ($1, 'nn-camp', $2)`, [CAMP, companyId]);
const count = async (c: Client, sql: string, p: unknown[]) => Number((await c.query(sql, p)).rows[0].n);

describe('catalog state', () => {
  it('campaigns.company_id is NOT NULL', async () => {
    const r = (await db.query(
      `SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.campaigns'::regclass AND attname = 'company_id' AND NOT attisdropped`,
    )).rows[0];
    expect(r).toEqual({ attnotnull: true });
  });

  it('exactly one FK campaigns(company_id) -> companies(id), ON DELETE RESTRICT', async () => {
    const r = (await db.query(
      `SELECT conname, confdeltype FROM pg_constraint
        WHERE conrelid = 'public.campaigns'::regclass AND contype = 'f'
          AND confrelid = 'public.companies'::regclass
          AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.campaigns'::regclass AND attname = 'company_id')]::int2[]`,
    )).rows;
    expect(r).toEqual([{ conname: 'campaigns_company_id_fkey', confdeltype: 'r' }]);
  });
});

describe('behaviour', () => {
  it('a campaign WITHOUT a company is refused (23502)', async () => {
    const r = await rolledBack(async (c) => {
      await seedCompany(c);
      return attemptIn(c, `INSERT INTO public.campaigns (id, name, company_id) VALUES ($1, 'nn', NULL)`, [CAMP]);
    });
    expect(r).toMatchObject({ ok: false, code: '23502' });
  });

  it('hard_delete_company on a company WITH a campaign aborts (23503) and deletes NOTHING', async () => {
    const r = await rolledBack(async (c) => {
      await seedCompany(c);
      await seedCampaign(c, CO);
      const del = await attemptIn(c, `SELECT * FROM public.hard_delete_company($1::uuid, $2::uuid, 'nn-test')`, [CO, ACTOR]);
      return {
        del,
        company: await count(c, 'SELECT count(*) AS n FROM public.companies WHERE id = $1', [CO]),
        campaign: await count(c, 'SELECT count(*) AS n FROM public.campaigns WHERE id = $1', [CAMP]),
      };
    });
    expect(r.del).toMatchObject({ ok: false, code: '23503' });
    expect(r).toMatchObject({ company: 1, campaign: 1 });
  });

  it('CONTROL: the same company WITHOUT a campaign is hard-deleted (RESTRICT, not the function, is the refusal)', async () => {
    const r = await rolledBack(async (c) => {
      await seedCompany(c);
      const del = await attemptIn(c, `SELECT * FROM public.hard_delete_company($1::uuid, $2::uuid, 'nn-test')`, [CO, ACTOR]);
      return { del, company: await count(c, 'SELECT count(*) AS n FROM public.companies WHERE id = $1', [CO]) };
    });
    expect(r).toEqual({ del: { ok: true }, company: 0 });
  });
});

describe('the migration itself', () => {
  it('re-applies cleanly on the applied state (idempotent)', async () => {
    const r = await rolledBack((c) => attemptIn(c, unwrapped(MIGRATION_FILE)));
    expect(r).toEqual({ ok: true });
  });

  it('its preflight REFUSES while any campaign has company_id NULL (and changes nothing)', async () => {
    const r = await rolledBack(async (c) => {
      const rb = await attemptIn(c, unwrapped(ROLLBACK_FILE));
      await seedCampaign(c, null);
      const applied = await attemptIn(c, unwrapped(MIGRATION_FILE));
      const nullable = (await c.query(
        `SELECT NOT attnotnull AS nullable FROM pg_attribute WHERE attrelid = 'public.campaigns'::regclass AND attname = 'company_id'`,
      )).rows[0].nullable;
      return { rb, applied, nullable };
    });
    expect(r.rb).toEqual({ ok: true });
    expect(r.applied.ok).toBe(false);
    expect(String(r.applied.message)).toMatch(/still have company_id NULL/);
    expect(r.nullable).toBe(true);
  });

  it('CONTROL: its verify block CATCHES an FK widened back to SET NULL', async () => {
    const r = await rolledBack(async (c) => {
      await c.query('ALTER TABLE public.campaigns DROP CONSTRAINT campaigns_company_id_fkey');
      await c.query('ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL');
      return attemptIn(c, verifyBlock());
    });
    expect(r.ok).toBe(false);
    expect(String(r.message)).toMatch(/not ON DELETE RESTRICT/);
  });

  it('the rollback restores a nullable column and ON DELETE SET NULL; re-applying restores RESTRICT', async () => {
    const r = await rolledBack(async (c) => {
      const rb = await attemptIn(c, unwrapped(ROLLBACK_FILE));
      const after = (await c.query(
        `SELECT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.campaigns'::regclass AND attname = 'company_id') AS notnull,
                (SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.campaigns'::regclass AND conname = 'campaigns_company_id_fkey') AS deltype`,
      )).rows[0];
      const reapplied = await attemptIn(c, unwrapped(MIGRATION_FILE));
      const again = (await c.query(
        `SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.campaigns'::regclass AND conname = 'campaigns_company_id_fkey'`,
      )).rows[0].confdeltype;
      return { rb, after, reapplied, again };
    });
    expect(r).toEqual({ rb: { ok: true }, after: { notnull: false, deltype: 'n' }, reapplied: { ok: true }, again: 'r' });
  });
});
