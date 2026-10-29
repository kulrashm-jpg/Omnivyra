-- ============================================================================
-- pg-stat-statements-probe.sql — READ-ONLY search of pg_stat_statements for the
-- statement text of the three applied-SQL candidates (FIX3 20261212000000, the
-- out-of-repo `authenticated` revoke on the 8 Phase-A tables, close_anon
-- 20261026000000).
--
-- FOR AN AUTHORIZED OPERATOR ONLY.
--
--   psql "<operator-held URL>" -X -v ON_ERROR_STOP=1 -f scripts/release/pg-stat-statements-probe.sql > pgss.out
--
-- VISIBILITY FIRST. PostgreSQL shows other users' statement text as
-- `<insufficient privilege>` unless the session holds pg_read_all_stats (or is
-- a superuser). The release-gate credential (pg_read_all_data) does NOT. The
-- SQL Editor runs as `postgres`, so without pg_read_all_stats the candidate
-- filters can never match. This script therefore prints, before anything else:
--   inspectable = true | false
-- and, when false, the single verdict line
--   NOT INSPECTABLE: <reason> — record "not inspectable", NEVER "absent"
-- and stops. Run it as `postgres` (owner) or with pg_read_all_stats granted to
-- the credential (an owner decision) to get a usable answer.
--
-- WHAT A RESULT CAN AND CANNOT SHOW
--   * A match is per-statement evidence that this text ran since the last
--     stats reset. Utility statements (REVOKE/GRANT/ALTER/CREATE/DO) are kept
--     only when pg_stat_statements.track_utility is on (recorded below).
--   * NO MATCH PROVES NOTHING: entries are evicted (pg_stat_statements.max),
--     and reset on stats reset, restart or upgrade (stats_reset recorded below).
--   * Normalised statements replace constants with $n; utility statements are
--     stored as written but one migration file becomes many entries. A match
--     is never byte identity of the file that was applied.
--
-- Catalog / statistics reads only. BEGIN TRANSACTION READ ONLY … ROLLBACK.
-- Only statements that BEGIN with DDL/DCL keywords AND name a candidate object
-- are printed, so ordinary application queries (which may carry data) are not.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog, pg_temp;

SELECT
  (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_stat_statements') AS pgss_schema,
  (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    OR pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS pgss_can_read_text
\gset

\echo 'current_user:' :USER
\if :{?pgss_schema}
\else
\echo 'NOT INSPECTABLE: extension pg_stat_statements is not installed — record "not inspectable", NEVER "absent"'
ROLLBACK;
\quit
\endif

SELECT :'pgss_schema' <> '' AS pgss_installed \gset
\if :pgss_installed
\else
\echo 'NOT INSPECTABLE: extension pg_stat_statements is not installed — record "not inspectable", NEVER "absent"'
ROLLBACK;
\quit
\endif

\echo 'inspectable =' :pgss_can_read_text
\if :pgss_can_read_text
\else
\echo 'NOT INSPECTABLE: this role lacks pg_read_all_stats, so other users'' statement text reads <insufficient privilege> — record "not inspectable", NEVER "absent"'
ROLLBACK;
\quit
\endif

-- settings that bound what an empty result could mean
SELECT 'setting' AS k, name AS item, setting AS v
  FROM pg_settings
 WHERE name IN ('pg_stat_statements.track', 'pg_stat_statements.track_utility', 'pg_stat_statements.max', 'pg_stat_statements.save')
 ORDER BY name COLLATE "C";

SELECT format('SELECT %L AS k, %L AS item, stats_reset::text AS v FROM %I.pg_stat_statements_info',
              'info', 'stats_reset', :'pgss_schema') AS info_sql \gset
:info_sql;

-- candidate statements (DDL/DCL only, naming a candidate object)
SELECT format($q$
SELECT CASE
         WHEN s.query ~* '\m(content_quality|content_block|content_recommendation|content_approval_history|omnivyra_touch_updated_at|set_content_updated_at)\M' THEN 'fix3'
         WHEN s.query ~* '\mauthenticated\M' AND s.query ~* '\m(brand_memory|content|content_asset|content_memory|content_originality|content_revision|content_variant|publication_lineage)\M' THEN 'revoke8'
         ELSE 'close_anon'
       END AS candidate,
       md5(s.query) AS query_md5,
       length(s.query) AS query_length,
       s.calls,
       r.rolname AS run_as,
       s.query
  FROM %I.pg_stat_statements s
  LEFT JOIN pg_roles r ON r.oid = s.userid
 WHERE s.query ~* '^\s*(revoke|grant|alter|create|drop|do|comment)\M'
   AND (s.query ~* '\m(content_quality|content_block|content_recommendation|content_approval_history|omnivyra_touch_updated_at|set_content_updated_at)\M'
        OR (s.query ~* '\mauthenticated\M' AND s.query ~* '\m(brand_memory|content|content_asset|content_memory|content_originality|content_revision|content_variant|publication_lineage)\M')
        OR s.query ~* '(close_anon|alter\s+default\s+privileges|revoke\s+all\s+on\s+(table\s+)?public\.)')
 ORDER BY 1 COLLATE "C", 2 COLLATE "C"
$q$, :'pgss_schema') AS cand_sql \gset
:cand_sql;

ROLLBACK;
