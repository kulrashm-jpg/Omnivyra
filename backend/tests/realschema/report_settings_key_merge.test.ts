/**
 * report_settings unit 1 — REAL-POSTGRES proof of public.merge_report_settings_keys
 * (supabase/migrations/20270217000000_report_settings_merge_keys_rpc.sql), NON-COMMITTING part:
 * the catalog state and the migration itself (re-apply, its verify block, re-closing a grant, the
 * rollback), each in a ROLLED-BACK transaction. Nothing here persists in the shared CI database.
 *
 * Every case that COMMITS (the merge semantics and the interleaved writers) lives in
 * report_settings_key_merge_concurrency_real.test.ts, which the harness runs in its second pass,
 * after every non-committing suite (83's rule, from the D-2 leak in CI-2).
 *
 *     npm run test:realschema -- report_settings_key_merge
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const CO = 'rsmerge-co-00000000-0000-4000-8000-0000000051a1';
const FN = 'public.merge_report_settings_keys(text, jsonb, timestamptz, text[], text[])';

beforeAll(async () => {
  const fn = (await db.query(`SELECT to_regprocedure($1) AS f`, [FN])).rows[0];
  if (!fn?.f) throw new Error('merge_report_settings_keys (20270217000000) is not installed in this database');
});

describe('catalog state', () => {
  it('SECURITY INVOKER, search_path pinned, EXECUTE for service_role only', async () => {
    const r = (await db.query(
      `SELECT prosecdef, proconfig, proacl IS NULL AS default_acl,
              has_function_privilege('anon', oid, 'EXECUTE') AS anon_x,
              has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_x,
              has_function_privilege('service_role', oid, 'EXECUTE') AS svc_x,
              EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0) AS public_x
         FROM pg_proc WHERE oid = to_regprocedure($1)`, [FN])).rows[0];
    expect(r).toMatchObject({ prosecdef: false, default_acl: false, anon_x: false, auth_x: false, svc_x: true, public_x: false });
    expect(r.proconfig).toContain('search_path=pg_catalog, public, pg_temp');
  });
  it('exactly one function of that name (no second, differently-granted entry point)', async () => {
    const r = (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'merge_report_settings_keys'`)).rows[0];
    expect(r.n).toBe(1);
  });
});

// ── Sandbox parity (05/e9 rule, 2026-11-12: sandbox-only evidence does not close a unit). Every case
// of the pg-sandbox proof (sql_proof.js, 44/44) that the suites above did not already cover lives here,
// against the replayed real schema.
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const MIGRATION_FILE = '20270217000000_report_settings_merge_keys_rpc.sql';
const ROLLBACK_FILE = path.join('rollbacks', 'report_settings_merge_keys_rpc_rollback.sql');

/** The file's statements without its own BEGIN/COMMIT (the test owns the transaction). */
function unwrapped(file: string): string {
  const lines = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').split('\n');
  const out = lines.filter((l) => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;');
  if (lines.length - out.length !== 2) throw new Error(`${file}: expected exactly one BEGIN; and one COMMIT; line`);
  return out.join('\n');
}

/** The migration's own postcondition block, run alone (to prove it catches a widened grant). */
function verifyBlock(): string {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
  const marker = 'DO $' + 'verify$';
  const start = sql.indexOf(marker);
  const end = sql.indexOf('$' + 'verify$;', start + marker.length);
  if (start < 0 || end < 0) throw new Error('verify block not found');
  return sql.slice(start, end + ('$' + 'verify$;').length);
}

/** One rolled-back transaction as the connection's own role (DDL/grants, nothing persists). */
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

describe('sandbox parity: the migration itself', () => {
  it('re-applies cleanly on the applied state (idempotent)', async () => {
    const r = await rolledBack((c) => attemptIn(c, unwrapped(MIGRATION_FILE)));
    expect(r).toEqual({ ok: true });
  });

  it('CONTROL: its verify block CATCHES an anon grant', async () => {
    const r = await rolledBack(async (c) => {
      await c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`);
      return attemptIn(c, verifyBlock());
    });
    expect(r.ok).toBe(false);
    expect(String(r.message)).toMatch(/anon has EXECUTE/);
  });

  it('re-applying RE-CLOSES a widened grant', async () => {
    const r = await rolledBack(async (c) => {
      await c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`);
      const applied = await attemptIn(c, unwrapped(MIGRATION_FILE));
      const anon = (await c.query(`SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS x`, [FN])).rows[0].x;
      return { applied, anon };
    });
    expect(r).toEqual({ applied: { ok: true }, anon: false });
  });

  it('the rollback drops the function and leaves the data', async () => {
    const r = await rolledBack(async (c) => {
      // A row with data, created INSIDE this rolled-back transaction (nothing persists).
      await c.query(
        `INSERT INTO public.company_profiles (company_id, name, report_settings, updated_at)
         VALUES ($1, 'rsmerge-rollback', '{"bootstrap":"kept","market_pulse":{"a":1}}'::jsonb, now())`, [CO]);
      const before = (await c.query('SELECT report_settings FROM public.company_profiles WHERE company_id = $1', [CO])).rows[0];
      const rb = await attemptIn(c, unwrapped(ROLLBACK_FILE));
      const fn = (await c.query('SELECT to_regprocedure($1) AS f', [FN])).rows[0].f;
      const after = (await c.query('SELECT report_settings FROM public.company_profiles WHERE company_id = $1', [CO])).rows[0];
      return { rb, fn, before, same: JSON.stringify(before) === JSON.stringify(after) };
    });
    expect(r.before).toEqual({ report_settings: { bootstrap: 'kept', market_pulse: { a: 1 } } });
    expect(r).toMatchObject({ rb: { ok: true }, fn: null, same: true });
  });
});
