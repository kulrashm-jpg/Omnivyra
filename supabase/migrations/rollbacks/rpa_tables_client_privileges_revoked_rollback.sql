-- Rollback for 20270204000000_rpa_tables_client_privileges_revoked.sql.
--
-- Restores the pre-change CLIENT ACL on public.rpa_sessions and
-- public.rpa_retry_queue as reported by the D1 read-only production query pack
-- (2026-11-10): anon held SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER,
-- MAINTAIN on both tables.
-- BEFORE USE: confirm authenticated's pre-change ACL from the D1 raw output and
-- delete its GRANT below if it held nothing. This file assumes it held the same.
--
-- This RE-OPENS the exposure the forward migration closed (REFERENCES, TRIGGER
-- and MAINTAIN are not governed by RLS). Use it only to restore service, and only
-- if a client-role path the audit did not find depends on these grants.
-- service_role, postgres and the policies were not changed, so nothing else is restored.

BEGIN;

-- grant-ok: rollback restores the exact pre-change production ACL (D1, 2026-11-10)
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.rpa_sessions, public.rpa_retry_queue TO anon;

-- grant-ok: rollback, CONFIRM FROM D1 BEFORE USE (see header)
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.rpa_sessions, public.rpa_retry_queue TO authenticated;

COMMIT;
