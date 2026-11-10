-- ============================================================================
-- SECURITY (#23 Part 1): tables that POSTGRES creates in public are born WITHOUT
-- anon/authenticated grants. Owner decision #23 (2026-11-10).
-- Drafted by Release-controls (virality-83); reviewer virality-05. LOCAL ONLY: NOT APPLIED.
-- ============================================================================
--
-- WHAT IS ACTUALLY FIXED, AND WHAT IS NOT (D1 q18, 2026-11-10)
--   public has TWO creator-role table defaults:
--     postgres       -> {postgres=arwdDxtm, authenticated=arwdxtm, service_role=arwdDxtm}  (no anon)
--     supabase_admin -> {postgres, anon=arwdDxtm, authenticated=arwdDxtm, service_role}     (anon incl. TRUNCATE)
--   This migration changes the POSTGRES default only: every table our migrations
--   create (they run as postgres) is born with no authenticated grant. For anon
--   the postgres default already granted nothing, so the anon gap is NOT closed
--   by this file.
--
-- RESIDUAL 1 (OPEN, owner/Supabase): supabase_admin's default still grants anon
--   and authenticated on tables it creates in public. ALTER DEFAULT PRIVILEGES
--   FOR ROLE supabase_admin needs membership in that role or superuser; postgres
--   on Supabase is neither (sandbox-verified: a non-member gets 42501 "permission
--   denied to change default privileges"). It cannot be fixed from a migration.
--   Postcondition 3 REPORTS it on every apply, so the record never overstates
--   the fix.
-- RESIDUAL 2 (OPEN, named): sequence (S) and function (f) defaults are unchanged.
--   Both creator roles grant authenticated (and supabase_admin anon) USAGE/
--   EXECUTE; vanilla PostgreSQL also grants EXECUTE to PUBLIC on new functions,
--   so a new SECURITY DEFINER function is born client-executable unless its
--   migration revokes it (enforced today only by the migration-quality gate's
--   SECURITY DEFINER rule). A separate decision.
--
-- PROBE LIMIT: postcondition 2's probe table is created by postgres, so it
-- proves the postgres default only. It says nothing about supabase_admin.
--
-- KNOWN LIMIT: Supabase manages these defaults and may re-assert them during a
-- platform upgrade; re-run the privilege sweep (virality-05 s01) to detect it.
--
-- Must run as postgres. Re-runnable (revoking an absent default is a no-op).
-- Rollback: rollbacks/public_default_privileges_no_client_roles_rollback.sql

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- POSTCONDITION 1: the postgres default for public tables names neither client role.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(DISTINCT g.rolname, ', ')
    INTO bad
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) x
    JOIN pg_roles g ON g.oid = x.grantee
   WHERE d.defaclrole = 'postgres'::regrole
     AND (n.nspname = 'public' OR d.defaclnamespace = 0)  -- 0 = an all-schemas default also applies to public
     AND d.defaclobjtype = 'r'
     AND g.rolname IN ('anon', 'authenticated');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'default privileges postcondition: postgres/public/tables still grants: %', bad;
  END IF;
END
$$;

-- POSTCONDITION 2 (functional, postgres path only): a table created now by postgres is born closed.
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
    RAISE EXCEPTION 'default privileges postcondition: a table created by postgres is still born with: %', array_to_string(held, '; ');
  END IF;
END
$$;

-- POSTCONDITION 3 (reporting, every creator role): state what is actually true.
-- Not an error: residual 1 cannot be fixed here. Recorded in the apply record.
DO $$
DECLARE
  residual text;
BEGIN
  SELECT string_agg(DISTINCT format('%s -> %s', d.defaclrole::regrole, g.rolname), '; ')
    INTO residual
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) x
    JOIN pg_roles g ON g.oid = x.grantee
   WHERE (n.nspname = 'public' OR d.defaclnamespace = 0)
     AND d.defaclobjtype = 'r'
     AND g.rolname IN ('anon', 'authenticated')
   GROUP BY ();
  IF residual IS NOT NULL THEN
    RAISE NOTICE 'RESIDUAL (not fixed by this migration): public table defaults still granting client roles: %', residual;
  ELSE
    RAISE NOTICE 'No creator role''s public table default grants a client role.';
  END IF;
END
$$;

COMMIT;

-- RESIDUAL REPORT AS A RESULT SET (virality-05 review): an HTTP SQL endpoint may
-- discard NOTICE output, but it returns the LAST statement's rows. This read-only
-- SELECT therefore puts the unfixed residual into the apply record itself.
-- Zero rows means no creator role's public table default grants a client role.
SELECT d.defaclrole::regrole::text AS creator_role,
       CASE WHEN d.defaclnamespace = 0 THEN '(all schemas)' ELSE 'public' END AS scope,
       g.rolname                  AS client_role,
       string_agg(x.privilege_type, ',' ORDER BY x.privilege_type) AS privileges,
       'RESIDUAL: not fixed by 20270205000000' AS note
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) x
  JOIN pg_roles g ON g.oid = x.grantee
 WHERE (n.nspname = 'public' OR d.defaclnamespace = 0)
   AND d.defaclobjtype = 'r'
   AND g.rolname IN ('anon', 'authenticated')
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3;
