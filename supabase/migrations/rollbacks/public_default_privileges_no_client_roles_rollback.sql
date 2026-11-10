-- Rollback for 20270205000000_public_default_privileges_no_client_roles.sql.
--
-- Restores the pre-change default exactly as MEASURED by D1 q18 (2026-11-10):
--   postgres / public / tables = {postgres=arwdDxtm, authenticated=arwdxtm, service_role=arwdDxtm}
-- i.e. authenticated held SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN
-- (no TRUNCATE); anon held nothing. Re-opens the "born exposed" default; use only
-- to restore a path that depends on it.

BEGIN;

-- grant-ok: rollback restores the exact pre-change default ACL (D1 q18, 2026-11-10)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO authenticated;

DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    -- grant-ok: rollback restores the exact pre-change default ACL (D1 q18, 2026-11-10)
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT MAINTAIN ON TABLES TO authenticated';
  END IF;
END
$$;

COMMIT;
