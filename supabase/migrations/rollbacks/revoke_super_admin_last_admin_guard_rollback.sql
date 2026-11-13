-- Rollback of 20270217000052_revoke_super_admin_last_admin_guard.sql (e1, M2).
-- Drops ONLY what 052 created. The route then answers 503 REVOKE_UNAVAILABLE (fail-closed): it never falls back to
-- the unguarded two-statement downgrade.
DROP FUNCTION IF EXISTS public.revoke_super_admin(uuid);
