/**
 * HARNESS FIDELITY: hosted Supabase default table privileges (PI-LDB 2F, requirement 11).
 *
 * scripts/ci/schema-bootstrap.sql reproduces the hosted default
 *   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role
 * so that a migration's REVOKE from service_role is tested against a privilege that is actually
 * there. Without it every `has_table_privilege('service_role', t, 'TRUNCATE') = false` assertion
 * is vacuously true. This file is the NEGATIVE CONTROL for that line: it fails if the bootstrap
 * stops granting the default (the vacuous state), and it pins that the client roles are NOT given
 * a default (the bootstrap's deliberate minimum scope). Disposable database only.
 */
import { db, inRollback } from './setup';

const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];

describe('harness: hosted default table privileges are reproduced', () => {
  it('a table postgres creates in public arrives with ALL privileges for service_role (not vacuous)', async () => {
    await inRollback(async () => {
      expect((await one('SELECT current_user u')).u).toBe('postgres');
      await db.query('CREATE TABLE public.zz_harness_default_acl_probe (id int)');
      const p = await one(`SELECT
          has_table_privilege('service_role', 'public.zz_harness_default_acl_probe', 'SELECT')   s,
          has_table_privilege('service_role', 'public.zz_harness_default_acl_probe', 'DELETE')   d,
          has_table_privilege('service_role', 'public.zz_harness_default_acl_probe', 'TRUNCATE') t`);
      expect(p).toEqual({ s: true, d: true, t: true });
    });
  });

  it('the default is the minimum scope: anon and authenticated get NO default table privilege', async () => {
    await inRollback(async () => {
      await db.query('CREATE TABLE public.zz_harness_default_acl_probe (id int)');
      const p = await one(`SELECT
          has_table_privilege('anon',          'public.zz_harness_default_acl_probe', 'SELECT') a,
          has_table_privilege('authenticated', 'public.zz_harness_default_acl_probe', 'SELECT') u`);
      expect(p).toEqual({ a: false, u: false });
    });
  });

  it('the default is defined in pg_default_acl for postgres in public, as the bootstrap states', async () => {
    const r = await one(`SELECT count(*)::int n FROM pg_default_acl d
       JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE d.defaclrole = 'postgres'::regrole AND n.nspname = 'public' AND d.defaclobjtype = 'r'
        AND array_to_string(d.defaclacl, ',') LIKE '%service_role=arwdDxt%'`);
    expect(r.n).toBe(1);
  });
});
