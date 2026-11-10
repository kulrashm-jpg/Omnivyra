-- ============================================================================
-- SECURITY (#23 Part 1): new public tables are born WITHOUT anon/authenticated grants.
-- Owner decision #23 (2026-11-10). Drafted by Release-controls (virality-83);
-- reviewer virality-05. LOCAL ONLY: NOT APPLIED.
-- ============================================================================
--
-- WHY THIS EXISTS
--   Production's default privileges (D1 q18, 2026-11-10) grant every table
--   that `postgres` creates in `public` to authenticated (arwdxtm) at CREATE
--   TABLE time. anon was already removed from that default; authenticated was
--   not. Every client-role REVOKE migration so far named its targets, so each
--   table created afterwards was born exposed again and the migration-quality
--   gate cannot catch it. This changes the source, so the class-wide REVOKE
--   (#23 Part 3, 20270205000001) does not start decaying the day it lands.
--
-- SCOPE
--   FOR ROLE postgres, IN SCHEMA public, ON TABLES only: postgres is the role
--   that runs our migrations (Management API and SQL editor). supabase_admin's
--   defaults (platform-owned) are untouched: we cannot and should not alter
--   them. Sequences and functions keep their defaults (separate decision).
--
-- KNOWN LIMIT
--   Supabase manages these defaults and may re-assert them during a platform
--   upgrade. The postcondition below, and a periodic re-run of the privilege
--   sweep (virality-05 s01), are how a re-assertion becomes visible.
--
-- Must run as postgres (ALTER DEFAULT PRIVILEGES FOR ROLE postgres).
-- Re-runnable: revoking an absent default privilege is a no-op.
-- Rollback: rollbacks/public_default_privileges_no_client_roles_rollback.sql

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- POSTCONDITION 1: the default ACL for (postgres, public, tables) names neither role.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(DISTINCT g.rolname, ', ')
    INTO bad
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) x
    JOIN pg_roles g ON g.oid = x.grantee
   WHERE d.defaclrole = 'postgres'::regrole
     AND n.nspname = 'public'
     AND d.defaclobjtype = 'r'
     AND g.rolname IN ('anon', 'authenticated');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'default privileges postcondition: postgres/public/tables still grants: %', bad;
  END IF;
END
$$;

-- POSTCONDITION 2 (functional): a table created now by postgres is born closed.
-- The probe table lives only inside this transaction and is dropped before COMMIT.
DO $$
DECLARE
  r text;
  p text;
  privs text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  held text[] := ARRAY[]::text[];
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'default privileges: must run as postgres (running as %)', current_user;
  END IF;
  IF current_setting('server_version_num')::int >= 170000 THEN
    privs := array_append(privs, 'MAINTAIN');
  END IF;
  CREATE TABLE IF NOT EXISTS public.__default_acl_probe_20270205000000 (id int);
  ALTER TABLE public.__default_acl_probe_20270205000000 ENABLE ROW LEVEL SECURITY;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      CONTINUE;
    END IF;
    FOREACH p IN ARRAY privs LOOP
      IF has_table_privilege(r, 'public.__default_acl_probe_20270205000000', p) THEN
        held := held || format('%s %s', r, p);
      END IF;
    END LOOP;
  END LOOP;
  DROP TABLE public.__default_acl_probe_20270205000000;
  IF array_length(held, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'default privileges postcondition: a new table is still born with: %', array_to_string(held, '; ');
  END IF;
END
$$;

COMMIT;
