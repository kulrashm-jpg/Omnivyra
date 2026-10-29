-- ============================================================================
-- session-readiness-check.sql: run this FIRST in the production verification
-- session, before preflight / parity / fingerprint / ACL snapshot.
--
-- It answers two questions about the credential the operator was issued:
--   1. Is it genuinely read-only?
--      Read-only by default, unable to write anything, not a superuser,
--      no BYPASSRLS, no pg_write_all_data.
--   2. Can it see enough of the catalog?
--      Otherwise verify-schema-parity.js reports columns hidden by
--      information_schema as false "missing" findings.
--
-- READ ONLY transaction, catalog reads only, ROLLBACK. It prints role
-- attributes and object NAMES only, never secrets.
-- It cannot verify that the password is freshly issued; the operator attests that.
--
--   psql "<operator-held URL>" -X -v ON_ERROR_STOP=1 -f scripts/release/session-readiness-check.sql
--
-- OUTPUT: lines "check | value | verdict" with verdict OK | FAIL | INFO, ending
-- with an `overall` line. Any FAIL means STOP: do not run the other checks
-- with this credential.
--
-- EXIT STATUS: psql exits 0 only when every check is OK/INFO. On any FAIL the
-- script deliberately raises an error, so psql (ON_ERROR_STOP) exits 3. A
-- connection or query error also exits non-zero. Treat any non-zero exit as STOP.
--
-- Role membership: the credential may be a member of pg_read_all_data and
-- nothing else. Every edge in pg_auth_members is followed (INHERIT, SET and
-- ADMIN options alike), because a membership granted WITH INHERIT FALSE,
-- SET TRUE is invisible to has_table_privilege() yet still allows
-- SET ROLE <writer>.
-- ============================================================================
\set ON_ERROR_STOP on
-- Read BEFORE the READ ONLY wrapper: inside it transaction_read_only is always on.
SELECT current_setting('transaction_read_only') AS pre_wrapper_tx_ro \gset
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

WITH me AS (
  SELECT r.* FROM pg_roles r WHERE r.rolname = current_user
),
writable AS (
  -- Ordinary tables in user schemas that this role could write (directly or
  -- via membership). A read-only credential must have none.
  SELECT count(*) AS n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p')
     AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg_toast%'
     AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
          OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE'))
),
create_schemas AS (
  SELECT count(*) AS n FROM pg_namespace n
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
     AND has_schema_privilege(n.oid, 'CREATE')
),
public_tables AS (
  SELECT c.oid, c.relname,
         (SELECT count(*) FROM pg_attribute a
           WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS cat_cols,
         (SELECT count(*) FROM information_schema.columns ic
           WHERE ic.table_schema = 'public' AND ic.table_name = c.relname) AS is_cols
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
),
hidden AS (
  SELECT count(*) AS n,
         string_agg(relname, ',' ORDER BY relname) FILTER (WHERE rn <= 10) AS sample
    FROM (SELECT relname, row_number() OVER (ORDER BY relname) AS rn
            FROM public_tables WHERE is_cols < cat_cols) h
),
ledger AS (
  -- pg_class lookup, not to_regclass(): to_regclass raises "permission denied
  -- for schema" when the role lacks USAGE, which must be a FAIL row, not an error.
  SELECT (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations') AS reg
),
memberships AS (
  -- Transitive closure over pg_auth_members from the credential, ignoring the
  -- inherit/set/admin options: any edge is a path to another role's rights.
  WITH RECURSIVE m(roleid) AS (
    SELECT am.roleid FROM pg_auth_members am WHERE am.member = (SELECT oid FROM me)
    UNION
    SELECT am.roleid FROM pg_auth_members am JOIN m ON am.member = m.roleid
  )
  SELECT r.rolname FROM m JOIN pg_roles r ON r.oid = m.roleid
),
not_allowlisted AS (
  SELECT rolname FROM memberships WHERE rolname <> 'pg_read_all_data'
),
checks AS (
  SELECT 10 AS ord, 'session.transaction_read_only (before wrapper)' AS chk, :'pre_wrapper_tx_ro'::text AS val,
         CASE WHEN :'pre_wrapper_tx_ro' = 'on' THEN 'OK' ELSE 'FAIL' END AS verdict
  UNION ALL
  SELECT 11, 'role.default_transaction_read_only (session value)', current_setting('default_transaction_read_only'),
         CASE WHEN current_setting('default_transaction_read_only') = 'on' THEN 'OK' ELSE 'FAIL' END
  UNION ALL
  SELECT 12, 'role.default_transaction_read_only (role setting)',
         COALESCE((SELECT string_agg(cfg, ';') FROM pg_db_role_setting s, unnest(s.setconfig) cfg
                    WHERE s.setrole = (SELECT oid FROM me) AND cfg LIKE 'default_transaction_read_only=%'), '(not set on role)'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) cfg
                            WHERE s.setrole = (SELECT oid FROM me) AND cfg = 'default_transaction_read_only=on')
              THEN 'OK' ELSE 'FAIL' END
  UNION ALL
  SELECT 20, 'role.name', current_user::text, 'INFO'
  UNION ALL
  SELECT 21, 'role.superuser', (SELECT rolsuper::text FROM me),
         CASE WHEN (SELECT rolsuper FROM me) THEN 'FAIL' ELSE 'OK' END
  UNION ALL
  SELECT 22, 'role.bypassrls', (SELECT rolbypassrls::text FROM me),
         CASE WHEN (SELECT rolbypassrls FROM me) THEN 'FAIL' ELSE 'OK' END
  UNION ALL
  SELECT 23, 'role.createrole/createdb/replication',
         (SELECT format('%s/%s/%s', rolcreaterole, rolcreatedb, rolreplication) FROM me),
         CASE WHEN (SELECT rolcreaterole OR rolcreatedb OR rolreplication FROM me) THEN 'FAIL' ELSE 'OK' END
  UNION ALL
  SELECT 24, 'role.valid_until', COALESCE((SELECT rolvaliduntil::text FROM me), '(none)'), 'INFO'
  UNION ALL
  SELECT 25, 'role.member_of_pg_write_all_data',
         pg_has_role(current_user, 'pg_write_all_data', 'USAGE')::text,
         CASE WHEN pg_has_role(current_user, 'pg_write_all_data', 'USAGE') THEN 'FAIL' ELSE 'OK' END
  UNION ALL
  SELECT 26, 'role.member_of (all, names only)',
         COALESCE((SELECT string_agg(g.rolname, ',' ORDER BY g.rolname)
                     FROM pg_roles g WHERE g.oid <> (SELECT oid FROM me)
                      AND pg_has_role(current_user, g.oid, 'MEMBER')), '(none)'),
         'INFO'
  UNION ALL
  -- has_table_privilege() ignores memberships held WITH INHERIT FALSE, SET TRUE
  -- (PG16+), which still allow SET ROLE <writer>. Walk pg_auth_members directly
  -- (every edge, whatever its options) and allow only pg_read_all_data.
  SELECT 27, 'role.member_of_not_allowlisted (pg_auth_members, all options)',
         COALESCE((SELECT string_agg(rolname, ',' ORDER BY rolname) FROM not_allowlisted), '(none)'),
         CASE WHEN EXISTS (SELECT 1 FROM not_allowlisted) THEN 'FAIL' ELSE 'OK' END
  UNION ALL
  SELECT 30, 'privilege.writable_tables (INSERT/UPDATE/DELETE/TRUNCATE)', (SELECT n::text FROM writable),
         CASE WHEN (SELECT n FROM writable) = 0 THEN 'OK' ELSE 'FAIL' END
  UNION ALL
  SELECT 31, 'privilege.schemas_with_CREATE', (SELECT n::text FROM create_schemas),
         CASE WHEN (SELECT n FROM create_schemas) = 0 THEN 'OK' ELSE 'FAIL' END
  UNION ALL
  SELECT 40, 'visibility.usage_on_public', has_schema_privilege('public', 'USAGE')::text,
         CASE WHEN has_schema_privilege('public', 'USAGE') THEN 'OK' ELSE 'FAIL' END
  UNION ALL
  SELECT 41, 'visibility.public_relations', (SELECT count(*)::text FROM public_tables), 'INFO'
  UNION ALL
  SELECT 42, 'visibility.public_relations_with_hidden_columns', (SELECT n::text FROM hidden),
         CASE WHEN (SELECT n FROM hidden) = 0 THEN 'OK' ELSE 'FAIL' END
  UNION ALL
  SELECT 43, 'visibility.hidden_columns_sample (first 10)', COALESCE((SELECT sample FROM hidden), '(none)'), 'INFO'
  UNION ALL
  SELECT 44, 'visibility.ledger_table_exists', ((SELECT reg FROM ledger) IS NOT NULL)::text,
         CASE WHEN (SELECT reg FROM ledger) IS NOT NULL THEN 'OK' ELSE 'FAIL' END
  UNION ALL
  SELECT 45, 'visibility.usage_on_supabase_migrations',
         COALESCE((SELECT has_schema_privilege(n.oid, 'USAGE')::text FROM pg_namespace n
                    WHERE n.nspname = 'supabase_migrations'), '(schema absent)'),
         CASE WHEN COALESCE((SELECT has_schema_privilege(n.oid, 'USAGE') FROM pg_namespace n
                              WHERE n.nspname = 'supabase_migrations'), false) THEN 'OK' ELSE 'FAIL' END
  UNION ALL
  SELECT 46, 'visibility.select_on_ledger',
         COALESCE((SELECT has_table_privilege(reg, 'SELECT')::text FROM ledger WHERE reg IS NOT NULL), '(absent)'),
         CASE WHEN COALESCE((SELECT has_table_privilege(reg, 'SELECT') FROM ledger WHERE reg IS NOT NULL), false)
              THEN 'OK' ELSE 'FAIL' END
  UNION ALL
  SELECT 47, 'visibility.client_roles_present (anon,authenticated,service_role)',
         (SELECT string_agg(r, ',' ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
           WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)),
         CASE WHEN (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3
              THEN 'OK' ELSE 'FAIL' END
)
SELECT string_agg(format('%s | %s | %s', chk, val, verdict), E'\n' ORDER BY ord) AS self_check_report,
       bool_and(verdict <> 'FAIL') AS self_check_ok
  FROM (SELECT ord, chk, val, verdict FROM checks
        UNION ALL
        SELECT 99, 'overall', format('%s FAIL', count(*) FILTER (WHERE verdict = 'FAIL')),
               CASE WHEN count(*) FILTER (WHERE verdict = 'FAIL') = 0 THEN 'OK' ELSE 'FAIL' END
          FROM checks) x \gset
\echo :self_check_report
\if :self_check_ok
ROLLBACK;
\else
\echo 'SELF-CHECK FAILED: STOP. Do not run anything else with this credential.'
-- Deliberate error: with ON_ERROR_STOP psql exits 3, so a FAIL can never exit 0.
SELECT 'self-check failed'::int;
\endif
