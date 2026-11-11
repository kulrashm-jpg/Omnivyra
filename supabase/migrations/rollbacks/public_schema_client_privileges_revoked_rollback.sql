-- Rollback for 20270205000001_public_schema_client_privileges_revoked.sql.
--
-- Restores EXACTLY the client-role privileges the forward migration captured in
-- public.client_privilege_revoke_snapshot (table and column level, anon /
-- authenticated / PUBLIC, WITH GRANT OPTION where it was held). Relations that
-- no longer exist are skipped and reported. The snapshot rows are kept as audit.
-- This RE-OPENS the exposure; use it only to restore a client-role path that
-- the forward migration broke.

BEGIN;

DO $$
DECLARE
  s record;
  missing int := 0;
  restored int := 0;
BEGIN
  IF to_regclass('public.client_privilege_revoke_snapshot') IS NULL THEN
    RAISE EXCEPTION 'rollback: snapshot table is absent; nothing to restore from';
  END IF;
  FOR s IN
    SELECT relname, attname, grantee, privilege_type, is_grantable
      FROM public.client_privilege_revoke_snapshot
     WHERE migration_version = '20270205000001'
     ORDER BY relname, attname, grantee, privilege_type
  LOOP
    IF to_regclass(format('public.%I', s.relname)) IS NULL THEN
      missing := missing + 1;
      CONTINUE;
    END IF;
    -- grant-ok: rollback restores the exact pre-change ACL captured in the snapshot
    EXECUTE format('GRANT %s%s ON TABLE public.%I TO %s%s',
                   s.privilege_type,
                   CASE WHEN s.attname = '' THEN '' ELSE format(' (%I)', s.attname) END,
                   s.relname,
                   CASE WHEN s.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(s.grantee) END,
                   CASE WHEN s.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
    restored := restored + 1;
  END LOOP;
  RAISE NOTICE 'rollback restored % privilege(s); % skipped (relation no longer exists)', restored, missing;
END
$$;

COMMIT;
