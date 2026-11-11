-- Rollback for 20270204000000_rpa_tables_client_privileges_revoked.sql.
--
-- Restores the pre-change CLIENT ACL on public.rpa_sessions and
-- public.rpa_retry_queue exactly as MEASURED by the D1 read-only production query
-- pack (2026-11-10; q16, closure-r15; verified by virality-05). relacl was
--   {postgres=arwdDxtm/postgres,anon=arwdxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}
-- and has_table_privilege confirmed, for BOTH anon and authenticated on both
-- tables: SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN true;
-- TRUNCATE false. So exactly those seven are restored to both roles, and never TRUNCATE.
--
-- MAINTAIN exists only from PostgreSQL 17; it is granted under the same version
-- gate as the forward migration's postcondition, so this rollback restores the
-- other six on an older server instead of aborting and restoring nothing.
--
-- This RE-OPENS the exposure the forward migration closed (REFERENCES, TRIGGER
-- and MAINTAIN are not governed by RLS). Use it only to restore service, and only
-- if a client-role path the audit did not find depends on these grants.
-- service_role, postgres and the policies were not changed, so nothing else is restored.

BEGIN;

-- grant-ok: rollback restores the exact pre-change production ACL (D1 q16, 2026-11-10)
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON TABLE public.rpa_sessions, public.rpa_retry_queue TO anon, authenticated;

DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    -- grant-ok: rollback restores the exact pre-change production ACL (D1 q16, 2026-11-10)
    EXECUTE 'GRANT MAINTAIN ON TABLE public.rpa_sessions, public.rpa_retry_queue TO anon, authenticated';
  END IF;
END
$$;

COMMIT;
