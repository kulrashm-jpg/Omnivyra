/**
 * W6 — real-schema cover for 20261026000000_close_anon_rls_exposure (STEP 3AH-70).
 *
 * The replay database carries the production schema but not production's
 * grants (the baseline is ACL-free). So each test first RECREATES production's
 * exposure by running the migration's own rollback, which grants what Supabase's
 * default privileges grant, proves the exposure is real, then runs the real
 * migration text and asserts what each role can do. Everything happens in a
 * transaction that is rolled back.
 *
 * Roles are exercised with SET LOCAL ROLE, which is exactly the privilege
 * context PostgREST uses for anon / authenticated / service_role requests.
 */
import fs from 'fs';
import path from 'path';
import { db, inRollback, attempt } from './setup';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261026000000_close_anon_rls_exposure.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'supabase/migrations/rollbacks/close_anon_rls_exposure_rollback.sql'), 'utf8');

function arrayItems(text: string, name: string): string[] {
  const m = text.match(new RegExp(`${name} text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`array ${name} not found`);
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
}
const TABLES = arrayItems(MIGRATION, 'protected_tables');
const FUNCTIONS = arrayItems(MIGRATION, 'definer_functions');
const OWNER_VIEWS = arrayItems(MIGRATION, 'owner_rights_views');
const PUBLIC_READ = arrayItems(MIGRATION, 'public_read_tables');

async function existing(kind: 'rel' | 'fn', names: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const n of names) {
    const q = kind === 'rel' ? 'SELECT to_regclass($1) IS NOT NULL AS ok' : 'SELECT to_regprocedure($1) IS NOT NULL AS ok';
    const { rows } = await db.query(q, [kind === 'rel' ? `public."${n}"` : n]);
    if (rows[0].ok) out.push(n);
  }
  return out;
}

const as = (role: string, sql: string) => attempt(`SET LOCAL ROLE ${role}; ${sql}`);

/**
 * Production's pre-fix privilege state. The rollback re-grants anon/authenticated;
 * Supabase's default privileges also grant service_role ALL on every public table,
 * which the ACL-free baseline does not carry, so add that too.
 */
async function recreateProductionGrants(tables: string[]): Promise<void> {
  await db.query(ROLLBACK);
  for (const t of tables) await db.query(`GRANT ALL ON TABLE public."${t}" TO service_role`);
}

describe('close_anon_rls_exposure — role behaviour on the replayed production schema', () => {
  let tables: string[] = [];
  let functions: string[] = [];
  let ownerViews: string[] = [];

  beforeAll(async () => {
    tables = await existing('rel', TABLES);
    functions = await existing('fn', FUNCTIONS);
    ownerViews = await existing('rel', OWNER_VIEWS);
  });

  it('the replayed schema contains the exposed objects', () => {
    expect(tables.length).toBeGreaterThanOrEqual(150);
    expect(functions.length).toBeGreaterThanOrEqual(20);
  });

  it('reproduces the production exposure, then the migration closes it for anon and authenticated', async () => {
    await inRollback(async () => {
      await recreateProductionGrants(tables); // production's pre-fix grants
      expect(await as('anon', 'SELECT 1 FROM public.feature_flags LIMIT 1')).toBe('ok');
      expect(await as('anon', 'DELETE FROM public.free_credit_grants WHERE false')).toBe('ok');

      await db.query(MIGRATION);

      const leaks: string[] = [];
      for (const t of tables) {
        for (const role of ['anon', 'authenticated']) {
          for (const stmt of [`SELECT 1 FROM public."${t}" LIMIT 1`, `DELETE FROM public."${t}" WHERE false`, `TRUNCATE public."${t}"`]) {
            const r = await as(role, stmt);
            if (r !== '42501') leaks.push(`${role}: ${stmt} → ${r}`);
          }
        }
      }
      expect(leaks).toEqual([]);
    });
  });

  it('keeps service_role able to read and write every protected table (BYPASSRLS + grants)', async () => {
    await inRollback(async () => {
      await recreateProductionGrants(tables); // production's pre-fix grants
      await db.query(MIGRATION);
      const { rows } = await db.query(
        `SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1)
           AND (NOT c.relrowsecurity OR NOT has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))`,
        [tables],
      );
      expect(rows.map((r) => r.relname)).toEqual([]);
      const bypass = await db.query(`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role'`);
      expect(bypass.rows[0].rolbypassrls).toBe(true);
      expect(await as('service_role', 'SELECT count(*) FROM public.feature_flags')).toBe('ok');
      expect(await as('service_role', 'DELETE FROM public.free_credit_grants WHERE false')).toBe('ok');
    });
  });

  it('makes SECURITY DEFINER functions server-only', async () => {
    await inRollback(async () => {
      await recreateProductionGrants(tables); // production's pre-fix grants
      await db.query(MIGRATION);
      const { rows } = await db.query(
        `SELECT f,
                has_function_privilege('anon', f::regprocedure, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', f::regprocedure, 'EXECUTE') AS authn,
                has_function_privilege('service_role', f::regprocedure, 'EXECUTE') AS svc
           FROM unnest($1::text[]) AS f`,
        [functions],
      );
      expect(rows.filter((r) => r.anon || r.authn).map((r) => r.f)).toEqual([]);
      expect(rows.filter((r) => !r.svc).map((r) => r.f)).toEqual([]);
    });
  });

  it('closes owner-rights views (they bypass RLS) and keeps intentional public reads read-only', async () => {
    await inRollback(async () => {
      await recreateProductionGrants(tables); // production's pre-fix grants
      await db.query(MIGRATION);
      for (const v of ownerViews) {
        expect(`${v}:${await as('anon', `SELECT 1 FROM public."${v}" LIMIT 1`)}`).toBe(`${v}:42501`);
        expect(`${v}:${await as('authenticated', `SELECT 1 FROM public."${v}" LIMIT 1`)}`).toBe(`${v}:42501`);
      }
      for (const t of await existing('rel', PUBLIC_READ)) {
        expect(await as('anon', `SELECT 1 FROM public."${t}" LIMIT 1`)).toBe('ok');
        expect(await as('anon', `DELETE FROM public."${t}" WHERE false`)).toBe('42501');
        expect(await as('anon', `TRUNCATE public."${t}"`)).toBe('42501');
      }
    });
  });

  it('removes TRUNCATE — which RLS does not govern — from anon/authenticated on every public table', async () => {
    await inRollback(async () => {
      await recreateProductionGrants(tables);
      // Pre-fix: anon HOLDS the privilege and RLS cannot stop it. (Executing it here would be refused
      // by the foreign-key rule, 0A000, only because other tables reference companies.)
      const pre = await db.query(`SELECT has_table_privilege('anon', 'public.companies', 'TRUNCATE') AS t`);
      expect(pre.rows[0].t).toBe(true);
      await db.query(MIGRATION);
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
           AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'))`,
      );
      expect(rows[0].n).toBe(0);
      expect(await as('anon', 'TRUNCATE public.companies')).toBe('42501');
      expect(await as('authenticated', 'TRUNCATE public.companies')).toBe('42501');
    });
  });

  it('is idempotent: applying it twice is a no-op', async () => {
    await inRollback(async () => {
      await recreateProductionGrants(tables); // production's pre-fix grants
      await db.query(MIGRATION);
      const snap = `SELECT md5(string_agg(c.relname || c.relrowsecurity::text || coalesce(c.relacl::text, ''), '|' ORDER BY c.relname)) AS h
                      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace`;
      const first = (await db.query(snap)).rows[0].h;
      await db.query(MIGRATION);
      expect((await db.query(snap)).rows[0].h).toBe(first);
    });
  });
});
