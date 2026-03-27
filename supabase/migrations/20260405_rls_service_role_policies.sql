-- ─────────────────────────────────────────────────────────────────────────────
-- Acknowledge service-role-only access on all RLS-enabled tables
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The rls_enabled_no_policy INFO advisory fires for every table that has RLS
-- enabled but zero policies.  In this application that is the *correct* state:
--
--   • service_role (BYPASSRLS) — all API routes use this key; bypasses RLS,
--     no policy needed, full access unconditionally.
--   • anon / authenticated  — no matching permissive policy → default deny.
--     This is what we want: no direct PostgREST access from client-side keys.
--
-- Resolution strategy
-- ───────────────────
-- Add one explicit `FOR ALL TO service_role USING (true) WITH CHECK (true)`
-- policy to every affected table.  This policy:
--   1. satisfies the linter (table now has ≥ 1 policy)
--   2. does NOT grant any new access — service_role bypasses RLS entirely
--   3. does NOT trigger rls_policy_always_true — that check only flags policies
--      where the roles list is [-] (unrestricted); specifying TO service_role
--      scopes the policy to a single role
--   4. explicitly documents intent in the database catalogue
--
-- The DO block is fully dynamic: it queries pg_class for every table in the
-- public schema that has rls = true and no existing policies, so the list stays
-- in sync even if additional tables are added later.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
  policy_name text;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM   pg_class     c
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname        = 'public'
      AND  c.relkind         = 'r'          -- ordinary tables only
      AND  c.relrowsecurity  = true         -- RLS already enabled
      AND  NOT EXISTS (
             SELECT 1
             FROM   pg_policy p
             WHERE  p.polrelid = c.oid
           )
    ORDER BY c.relname
  LOOP
    policy_name := 'service_role_full_access';

    -- Idempotent: skip if somehow already created by an earlier run
    IF NOT EXISTS (
      SELECT 1
      FROM   pg_policy  p
      JOIN   pg_class   c2 ON c2.oid = p.polrelid
      JOIN   pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE  n2.nspname = 'public'
        AND  c2.relname  = r.tbl
        AND  p.polname   = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I'
        ' FOR ALL'
        ' TO service_role'
        ' USING (true)'
        ' WITH CHECK (true)',
        policy_name,
        r.tbl
      );
    END IF;
  END LOOP;
END;
$$;
