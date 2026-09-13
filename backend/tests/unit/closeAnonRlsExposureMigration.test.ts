/**
 * STEP 3AH-70 — static contract of the anonymous-exposure remediation migration.
 *
 * The migration's behaviour is proven against a live Supabase stack (local cert)
 * and by the real-schema suite; this pins the parts a reviewer must be able to
 * trust from the text alone: it is least-privilege, never widens access, never
 * drops anything, carries its own abort-on-exposure check, and its rollback is
 * the exact inverse.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261026000000_close_anon_rls_exposure.sql');
const ROLLBACK = path.join(ROOT, 'supabase/migrations/rollbacks/close_anon_rls_exposure_rollback.sql');
const sql = fs.readFileSync(MIGRATION, 'utf8');
const rollback = fs.readFileSync(ROLLBACK, 'utf8');
const code = sql.replace(/--[^\n]*/g, '');

/** Items of a named `text[] := ARRAY[ ... ]` literal. */
function arrayItems(text: string, name: string): string[] {
  const m = text.match(new RegExp(`${name} text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`array ${name} not found`);
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
}

const tables = arrayItems(sql, 'protected_tables');
const functions = arrayItems(sql, 'definer_functions');
const ownerViews = arrayItems(sql, 'owner_rights_views');
const invokerViews = arrayItems(sql, 'invoker_views');

describe('20261026000000_close_anon_rls_exposure', () => {
  it('covers the measured production exposure exactly: 177 tables, 29 definer functions, 37 views', () => {
    expect(tables).toHaveLength(177);
    expect(new Set(tables).size).toBe(177);
    expect(functions).toHaveLength(29);
    expect(ownerViews).toHaveLength(29);
    expect(invokerViews).toHaveLength(8);
  });

  it('lists are sorted, so the migration is deterministic', () => {
    for (const list of [tables, functions, ownerViews, invokerViews]) expect(list).toEqual([...list].sort());
  });

  it('includes the proven and credential-bearing exposures', () => {
    for (const t of ['feature_flags', 'analytics_serp_results', 'company_llm_configs', 'external_api_connections',
      'free_credit_grants', 'billing_policy_config', 'auth_audit_logs', 'consent_records']) {
      expect(tables).toContain(t);
    }
    for (const f of ['public.apply_credit_transaction_v2(uuid,text,integer,numeric,text,text,text,uuid,text,text,uuid,text,jsonb)',
      'public.security_get_secret(uuid)', 'public.soft_delete_company(uuid,uuid,text)', 'public.activate_invitation_membership(uuid,uuid,timestamp with time zone)']) {
      expect(functions).toContain(f);
    }
  });

  it('enables RLS and revokes anon + authenticated for every protected table', () => {
    expect(code).toMatch(/ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/);
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.%I FROM anon, authenticated/);
  });

  it('removes PUBLIC/anon/authenticated EXECUTE and keeps service_role', () => {
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION %s TO service_role/);
  });

  it('never widens access: no grant to anon/authenticated/PUBLIC, no blanket policy, no DISABLE', () => {
    expect(code).not.toMatch(/GRANT[^;]*\bTO\s+(anon|authenticated|public)\b/i);
    expect(code).not.toMatch(/CREATE\s+POLICY/i);
    expect(code).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(code).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('is non-destructive: drops no table, policy, view or function, and touches no row', () => {
    expect(code).not.toMatch(/\bDROP\s+(TABLE|POLICY|VIEW|FUNCTION)\b/i);
    expect(code).not.toMatch(/\b(INSERT\s+INTO|DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?(public\.|%I|")|UPDATE\s+public\.)/i);
  });

  it('retargets exactly the 11 unconditional {public} policies to service_role and keeps 4 public read-only tables', () => {
    const block = code.match(/FROM \(VALUES([\s\S]*?)\) AS x\(tbl, pol\)/);
    expect(block).not.toBeNull();
    const pairs = new Set([...block![1].matchAll(/\('([a-z_]+)', '([^']+)'\)/g)].map((m) => `${m[1]}.${m[2]}`));
    expect(pairs.size).toBe(11);
    expect(code).toMatch(/ALTER POLICY %I ON public\.%I TO service_role/);
    expect(arrayItems(sql, 'public_read_tables')).toEqual(['blog_relationships', 'blog_series', 'blog_series_posts', 'content_type']);
    expect(code).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.%I FROM anon, authenticated/);
  });

  it('revokes TRUNCATE (not governed by RLS) from anon/authenticated on every public table', () => {
    expect(code).toMatch(/REVOKE TRUNCATE ON TABLE public\.%I FROM anon, authenticated/);
    expect(code).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM authenticated;/);
    expect(code).toMatch(/RAISE EXCEPTION 'close_anon_rls_exposure: TRUNCATE \(not governed by RLS\) still held/);
    expect(rollback).toMatch(/GRANT TRUNCATE ON TABLE public\.%I TO anon, authenticated/);
  });

  it('closes the default-privilege root cause for future objects', () => {
    expect(code).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;/);
    expect(code).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;/);
    expect(code).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/);
  });

  it('skips absent objects so a clean replay succeeds', () => {
    expect(code).toMatch(/IF to_regclass\(format\('public\.%I', t\)\) IS NULL THEN/);
    expect(code).toMatch(/IF to_regprocedure\(f\) IS NULL THEN CONTINUE; END IF;/);
  });

  it('aborts its own transaction if anything it owns is still reachable', () => {
    expect(code).toMatch(/RAISE EXCEPTION 'close_anon_rls_exposure: tables still exposed/);
    expect(code).toMatch(/RAISE EXCEPTION 'close_anon_rls_exposure: SECURITY DEFINER functions still executable/);
    expect(code).toMatch(/RAISE EXCEPTION 'close_anon_rls_exposure: views still readable/);
    expect(code).toMatch(/RAISE EXCEPTION 'close_anon_rls_exposure: policies not retargeted/);
  });

  it('has no transaction control of its own (applied with psql -1)', () => {
    expect(code).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
  });

  it('rollback is the exact inverse over the same object lists', () => {
    expect(arrayItems(rollback, 'protected_tables')).toEqual(tables);
    expect(arrayItems(rollback, 'definer_functions')).toEqual(functions);
    expect(arrayItems(rollback, 'all_views')).toEqual([...ownerViews, ...invokerViews].sort());
    expect(rollback).toMatch(/DISABLE ROW LEVEL SECURITY/);
    expect(rollback).toMatch(/ALTER POLICY %I ON public\.%I TO public/);
  });
});
