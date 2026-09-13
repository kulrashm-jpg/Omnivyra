-- verify-anon-exposure.sql — READ-ONLY production verification for
-- 20261026000000_close_anon_rls_exposure.sql (STEP 3AH-70).
-- Run:  psql "$SUPABASE_POOLER_DB_URL" -X -f scripts/security/verify-anon-exposure.sql
-- Everything runs in a READ ONLY transaction that is rolled back. Object lists are taken
-- from the migration's protected set via the same names; see verify-anon-exposure.js for
-- the scripted PASS/FAIL version (which also runs anonymous REST GET/HEAD probes).
BEGIN TRANSACTION READ ONLY;

-- Q1. Tables that are RLS-off AND anonymously reachable anywhere in public.
--     BEFORE: 177 · AFTER: 0
SELECT count(*) AS rls_off_anon_readable_tables
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
   AND NOT c.relrowsecurity AND has_table_privilege('anon', c.oid, 'SELECT');

-- Q2. RLS-off public tables with any anon/authenticated privilege (the exposure itself).
--     BEFORE: 177 rows · AFTER: 0 rows. (On RLS-enabled tables anon/authenticated grants are
--     governed by policies — except TRUNCATE, which Q2b covers.)
SELECT c.relname,
       has_table_privilege('anon', c.oid, 'SELECT')   AS anon_select,
       has_table_privilege('anon', c.oid, 'INSERT')   AS anon_insert,
       has_table_privilege('anon', c.oid, 'UPDATE')   AS anon_update,
       has_table_privilege('anon', c.oid, 'DELETE')   AS anon_delete,
       has_table_privilege('anon', c.oid, 'TRUNCATE') AS anon_truncate,
       has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS authn_any,
       has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS service_role_all
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
   AND (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 ORDER BY 1;

-- Q2b. TRUNCATE is not governed by RLS. BEFORE: 835 · AFTER: 0
SELECT count(*) AS tables_truncatable_by_anon_or_authenticated
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
   AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'));

-- Q2c. service_role keeps full DML on every table.  AFTER: 0
SELECT count(*) AS tables_missing_service_role_dml
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
   AND NOT has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE');

-- Q3. SECURITY DEFINER functions callable by anon/authenticated.  BEFORE: 29 · AFTER: 0
SELECT p.oid::regprocedure AS function,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
 ORDER BY 1;

-- Q4. Views readable by anon (any) or by authenticated (owner-rights only).  AFTER: 0 rows
SELECT c.relname,
       coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false') AS security_invoker,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authn_select
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v','m')
   AND (has_table_privilege('anon', c.oid, 'SELECT')
        OR (coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false') NOT IN ('true','on')
            AND has_table_privilege('authenticated', c.oid, 'SELECT')))
 ORDER BY 1;

-- Q5. Unconditional policies that reach anon (role public/anon, USING/WITH CHECK true).
--     AFTER: only the 4 intentionally public SELECT policies
--     (content_type, blog_series, blog_series_posts, blog_relationships) + none that write.
SELECT tablename, policyname, cmd, roles::text
  FROM pg_policies
 WHERE schemaname = 'public' AND roles::text ~ '(public|anon)'
   AND coalesce(qual, 'true') = 'true' AND coalesce(with_check, 'true') = 'true'
 ORDER BY 1, 2;

-- Q6. Intentionally public tables: readable, RLS on, not writable by anon.
SELECT c.relname, c.relrowsecurity AS rls,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') AS anon_write
  FROM pg_class c
 WHERE c.oid IN ('public.content_type'::regclass, 'public.blog_series'::regclass,
                 'public.blog_series_posts'::regclass, 'public.blog_relationships'::regclass);

-- Q7. Browser realtime path must be intact: credit_transactions RLS on, authenticated SELECT, policy present.
SELECT c.relrowsecurity AS rls, has_table_privilege('authenticated', c.oid, 'SELECT') AS authn_select,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'credit_transactions') AS policies
  FROM pg_class c WHERE c.oid = 'public.credit_transactions'::regclass;

-- Q8. Root cause: default privileges for objects postgres creates in public.  AFTER: no 'anon=' entry.
SELECT pg_get_userbyid(d.defaclrole) AS owner, d.defaclobjtype AS objtype, d.defaclacl::text AS acl
  FROM pg_default_acl d
 WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace IN (0, 'public'::regnamespace::oid)
 ORDER BY 2;

-- Q9. Server functionality: service_role keeps BYPASSRLS.
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('service_role', 'anon', 'authenticated') ORDER BY 1;

-- Q10. Ledger.  AFTER: 1 row.
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '20261026000000';

ROLLBACK;
