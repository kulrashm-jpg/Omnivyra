-- ============================================================================
-- SECURITY: revoke client-role table privileges on rpa_sessions and rpa_retry_queue
-- Fix-forward, owner-approved 2026-11-10 (D1 security finding). LOCAL ONLY: NOT APPLIED.
-- ============================================================================
--
-- FINDING (D1, read-only production query pack, 2026-11-10; verified by virality-05)
--   anon holds table-level privileges on public.rpa_sessions and
--   public.rpa_retry_queue (SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER,
--   MAINTAIN). Both tables have RLS ENABLED but not FORCED, with one policy each
--   ("service_role_all", 20260527 / 20260528 / 20260529). RLS masks only row
--   access: REFERENCES, TRIGGER and MAINTAIN are NOT governed by RLS at all, so
--   this is a real exposure on rpa_sessions. On live code its storage_state was
--   PLAINTEXT browser session state (cookies), not encrypted; it was scrubbed to
--   invalidation markers in production under #17A (2026-11-10). Do not under-rate
--   this table: any row written by unsealed code holds live session material.
--   These are direct role grants (Supabase default privileges at CREATE TABLE),
--   so REVOKE ... FROM PUBLIC would NOT remove them.
--
-- CHANGE
--   REVOKE ALL on the two tables FROM PUBLIC, anon AND authenticated. The two
--   client roles are named explicitly because their grants are direct role grants
--   (FROM PUBLIC alone removes nothing); PUBLIC is included for consistency with
--   the *_client_privileges_revoked family. REVOKE ALL covers MAINTAIN on PG17.
--   NOT touched: service_role, postgres, the existing policies, RLS settings,
--   any other table. No application path uses a client role on these tables:
--   the RPA worker and its APIs use the service role.
--
-- POSTCONDITION
--   has_table_privilege() for anon and authenticated over all seven privileges
--   on both tables, AND has_any_column_privilege(SELECT, INSERT, UPDATE,
--   REFERENCES), because has_table_privilege cannot see a column grant such as
--   SELECT (storage_state). (PostgreSQL's REVOKE on a table also revokes the
--   matching column privileges, measured on PG17, so the REVOKE above removes
--   them; the column check makes that guarantee self-verifying, as the
--   *_client_privileges_revoked family does.) Any true RAISEs and the migration
--   rolls back. Measured with
--   has_table_privilege, never inferred from relacl (for a table, NULL relacl
--   means owner-only, and role grants are what matter here).
--
-- Re-runnable: REVOKE of an absent privilege is a no-op.
-- Rollback: rollbacks/rpa_tables_client_privileges_revoked_rollback.sql
--   (re-opens the exposure; for service restoration only).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.rpa_sessions') IS NULL OR to_regclass('public.rpa_retry_queue') IS NULL THEN
    RAISE EXCEPTION 'rpa client privileges: rpa_sessions or rpa_retry_queue is absent (apply 20260527/20260528 first)';
  END IF;
END
$$;

REVOKE ALL ON TABLE public.rpa_sessions, public.rpa_retry_queue FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
  r text;
  p text;
  privs text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRIGGER'];
  held text[] := ARRAY[]::text[];
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    privs := array_append(privs, 'MAINTAIN');
  END IF;
  FOREACH t IN ARRAY ARRAY['public.rpa_sessions', 'public.rpa_retry_queue'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        CONTINUE;
      END IF;
      FOREACH p IN ARRAY privs LOOP
        IF has_table_privilege(r, t, p) THEN
          held := held || format('%s %s %s', r, p, t);
        END IF;
      END LOOP;
      IF has_any_column_privilege(r, t, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
        held := held || format('%s column-privilege %s', r, t);
      END IF;
    END LOOP;
  END LOOP;
  IF array_length(held, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'rpa client privileges postcondition: still held: %', array_to_string(held, '; ');
  END IF;
END
$$;

COMMIT;
