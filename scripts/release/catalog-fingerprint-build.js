#!/usr/bin/env node
/**
 * Builds scripts/release/catalog-fingerprint.sql (READ-ONLY catalog fingerprint).
 *
 * The object lists for close_anon are DERIVED from the committed migration
 * supabase/migrations/20261026000000_close_anon_rls_exposure.sql, never typed by
 * hand, so the fingerprint cannot drift from the migration it audits.
 *
 *   node scripts/release/catalog-fingerprint-build.js           # rewrite the .sql
 *   node scripts/release/catalog-fingerprint-build.js --check   # exit 1 if stale
 *
 * This script only reads repository files and writes one repository file. It
 * never connects to any database.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CLOSE_ANON = 'supabase/migrations/20261026000000_close_anon_rls_exposure.sql';
const FIX3 = 'supabase/migrations/20261212000000_content_quality_collaboration_tenant_consistent.sql';
const OUT = 'scripts/release/catalog-fingerprint.sql';

// FIX3: the four tables it creates/reconciles, `content` (lifecycle CHECK + FK
// parent) and `user_company_roles` (referenced by the STEP 8 policy text).
const FIX3_TABLES = ['content_quality', 'content_block', 'content_recommendation', 'content_approval_history'];
const FIX3_AUX_TABLES = ['content', 'user_company_roles'];
// OD-11: STEP 7 adopts whichever executor exists; both name variants are fingerprinted.
const FIX3_FUNCTIONS = ['public.set_content_updated_at()', 'public.omnivyra_touch_updated_at()'];
// The separate `authenticated` revoke on 8 Phase-A tables. Its SQL text is NOT in
// the repository; the table list comes from the owner's report (memory note
// project_fix3_verified_prod_20261028).
const PHASE_A_TABLES = [
  'brand_memory', 'content', 'content_asset', 'content_memory',
  'content_originality', 'content_revision', 'content_variant', 'publication_lineage',
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function namedArray(sql, name) {
  const m = sql.match(new RegExp(`\\b${name}\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`array ${name} not found in ${CLOSE_ANON}`);
  const items = [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
  if (items.length === 0) throw new Error(`array ${name} is empty`);
  return items;
}

function closeAnonPolicies(sql) {
  const m = sql.match(/SELECT \* FROM \(VALUES([\s\S]*?)\) AS x\(tbl, pol\)/);
  if (!m) throw new Error('policy VALUES block not found');
  const pairs = [...m[1].matchAll(/\('((?:[^']|'')*)',\s*'((?:[^']|'')*)'\)/g)].map((x) => [x[1], x[2]]);
  if (pairs.length === 0) throw new Error('policy VALUES block is empty');
  return pairs;
}

function extractTargets() {
  const ca = read(CLOSE_ANON);
  const fix3 = read(FIX3);
  for (const t of FIX3_TABLES) {
    if (!fix3.includes(`CREATE TABLE IF NOT EXISTS public.${t} (`)) {
      throw new Error(`FIX3 migration no longer creates public.${t}`);
    }
  }
  for (const f of FIX3_FUNCTIONS) {
    const bare = f.replace(/^public\./, '').replace(/\(\)$/, '');
    if (!fix3.includes(bare)) throw new Error(`FIX3 migration no longer names ${f}`);
  }
  return {
    protectedTables: namedArray(ca, 'protected_tables'),
    definerFunctions: namedArray(ca, 'definer_functions'),
    ownerRightsViews: namedArray(ca, 'owner_rights_views'),
    invokerViews: namedArray(ca, 'invoker_views'),
    retargetedTables: namedArray(ca, 'retargeted_tables'),
    publicReadTables: namedArray(ca, 'public_read_tables'),
    policies: closeAnonPolicies(ca),
  };
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

function relationRows(t) {
  const rows = [];
  const add = (names, tag) => names.forEach((n) => rows.push([n, tag]));
  add(t.protectedTables, 'close_anon:table');
  add(t.ownerRightsViews, 'close_anon:owner_view');
  add(t.invokerViews, 'close_anon:invoker_view');
  add(t.retargetedTables, 'close_anon:retargeted_policy_table');
  add(t.publicReadTables, 'close_anon:public_read_table');
  add(FIX3_TABLES, 'fix3:table');
  add(FIX3_AUX_TABLES, 'fix3:aux');
  add(PHASE_A_TABLES, 'revoke8:table');
  return rows;
}

function functionRows(t) {
  return [
    ...t.definerFunctions.map((f) => [f, 'close_anon:definer_fn']),
    ...FIX3_FUNCTIONS.map((f) => [f, 'fix3:updated_at_executor']),
  ];
}

function valuesBlock(rows, indent) {
  return rows.map((r) => `${indent}(${r.map(lit).join(', ')})`).join(',\n');
}

function build() {
  const t = extractTargets();
  const rel = valuesBlock(relationRows(t), '    ');
  const fn = valuesBlock(functionRows(t), '    ');
  const pol = valuesBlock(t.policies, '    ');
  const detailTables = [...FIX3_TABLES, ...FIX3_AUX_TABLES];
  const detail = valuesBlock(detailTables.map((x) => [x]), '    ');
  const counts = `-- Targets: ${relationRows(t).length} relation rows (close_anon ${t.protectedTables.length} tables, ` +
    `${t.ownerRightsViews.length}+${t.invokerViews.length} views, ${t.retargetedTables.length} retargeted, ` +
    `${t.publicReadTables.length} public-read; FIX3 ${FIX3_TABLES.length}+${FIX3_AUX_TABLES.length}; revoke8 ${PHASE_A_TABLES.length}), ` +
    `${functionRows(t).length} functions, ${t.policies.length} close_anon policies.`;
  return TEMPLATE
    .replace('{{COUNTS}}', counts)
    .replace('{{REL}}', rel)
    .replace('{{FN}}', fn)
    .replace('{{POL}}', pol)
    .replace('{{DETAIL}}', detail);
}

const TEMPLATE = String.raw`-- ============================================================================
-- READ-ONLY CATALOG FINGERPRINT — applied-SQL semantic equivalence (release gate)
-- GENERATED by scripts/release/catalog-fingerprint-build.js — do not edit by hand.
-- ============================================================================
-- Candidates:
--   close_anon : supabase/migrations/20261026000000_close_anon_rls_exposure.sql
--   fix3       : supabase/migrations/20261212000000_content_quality_collaboration_tenant_consistent.sql
--   revoke8    : the separate REVOKE of authenticated on 8 Phase-A tables (SQL text not in repo)
{{COUNTS}}
--
-- Catalog reads only: no row data, no writes, no temp objects. Runs inside
-- BEGIN TRANSACTION READ ONLY and ends with ROLLBACK.
--
-- Output: one line per fact, TAB-separated: section, object, property, value.
-- Values are escaped (\\ \n \r \t). Lines are ordered with COLLATE "C", so two runs
-- on equal catalogs are byte-identical. OIDs are never emitted. The owner of an
-- object appears only in property "owner"; in ACLs the owner is written <owner>.
-- Compare two outputs with scripts/release/semantic-compare-catalog.js.
--
-- NOT COVERED here (by design): the orchestration stack (20261127000000,
-- 20261226000000 … 20261231000010: 18 tables, 27 functions) and PR #349
-- (customer_readiness_snapshots, execution_approvals). Those are verified by
-- scripts/verify-schema-parity.js --strict (existence, RLS, privileges, function
-- markers) and scripts/release/grants-acl-check.sql (ACLs, policies,
-- publications); a difference in them produces no fact in this file.
-- Publication membership IS recorded here (section pub) for every publication;
-- membership of an in-scope table is semantic, other tables are info.
--
-- Line endings (format /3): def_md5 hashes pg_get_functiondef() raw, so CR bytes
-- kept in prosrc by a CRLF submission (e.g. the SQL Editor) change it.
-- def_md5_lf hashes the same text with every CRLF PAIR replaced by LF (a lone CR
-- is kept); the comparator reports "raw differs, _lf equal" as eol_only.
-- View and policy text is deparsed by the server and carries CR only inside
-- string literals, where it is a value: it is never normalized.
--
-- Usage: psql -X -v ON_ERROR_STOP=1 -f scripts/release/catalog-fingerprint.sql > out.tsv
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\pset format unaligned
\pset tuples_only on
\pset null ''
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
SET LOCAL search_path = pg_catalog, pg_temp;

SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS fp_has_ledger \gset

WITH
fp_rel(relname, cand) AS (VALUES
{{REL}}
),
fp_fn(sig, cand) AS (VALUES
{{FN}}
),
fp_pol(tbl, pol) AS (VALUES
{{POL}}
),
fp_detail(relname) AS (VALUES
{{DETAIL}}
),
fp_roles(rolname) AS (VALUES ('anon'), ('authenticated'), ('service_role'), ('public')),
fp_privs(priv) AS (
  SELECT v.priv FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS v(priv)
  UNION ALL
  -- PostgreSQL 17+: MAINTAIN (VACUUM/ANALYZE/CLUSTER/REINDEX/LOCK TABLE) is a grantable table privilege
  SELECT 'MAINTAIN' WHERE current_setting('server_version_num')::int >= 170000
),
rel AS (
  SELECT r.relname, string_agg(DISTINCT r.cand, ',' ORDER BY r.cand) AS cands, c.oid AS reloid
    FROM fp_rel r
    LEFT JOIN pg_class c ON c.relname = r.relname
     AND c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   GROUP BY r.relname, c.oid
),
fn AS (
  SELECT f.sig, string_agg(DISTINCT f.cand, ',' ORDER BY f.cand) AS cands, to_regprocedure(f.sig) AS fnoid
    FROM fp_fn f GROUP BY f.sig
),
facts(section, object, property, value) AS (
  -- meta (environment; never semantic)
  SELECT 'meta', 'session', 'transaction_read_only', current_setting('transaction_read_only')
  UNION ALL SELECT 'meta', 'session', 'server_version_num', current_setting('server_version_num')
  UNION ALL SELECT 'meta', 'session', 'fingerprint_format', 'catalog-fingerprint/3'

  -- scope: which candidate each object belongs to
  UNION ALL SELECT 'scope', 'rel:public.' || relname, 'candidates', cands FROM rel
  UNION ALL SELECT 'scope', 'fn:' || sig, 'candidates', cands FROM fn

  -- relations: existence, kind, RLS flags, options, owner
  UNION ALL SELECT 'rel', 'rel:public.' || r.relname, 'exists', (r.reloid IS NOT NULL)::text FROM rel r
  UNION ALL SELECT 'rel', 'rel:public.' || r.relname, 'relkind', c.relkind::text FROM rel r JOIN pg_class c ON c.oid = r.reloid
  UNION ALL SELECT 'rel', 'rel:public.' || r.relname, 'relrowsecurity', c.relrowsecurity::text FROM rel r JOIN pg_class c ON c.oid = r.reloid
  UNION ALL SELECT 'rel', 'rel:public.' || r.relname, 'relforcerowsecurity', c.relforcerowsecurity::text FROM rel r JOIN pg_class c ON c.oid = r.reloid
  UNION ALL SELECT 'rel', 'rel:public.' || r.relname, 'reloptions',
         coalesce((SELECT string_agg(o, ',' ORDER BY o COLLATE "C") FROM unnest(c.reloptions) o), '')
    FROM rel r JOIN pg_class c ON c.oid = r.reloid
  UNION ALL SELECT 'rel', 'rel:public.' || r.relname, 'owner', pg_get_userbyid(c.relowner) FROM rel r JOIN pg_class c ON c.oid = r.reloid
  UNION ALL SELECT 'rel', 'rel:public.' || r.relname, 'acl_is_default', (c.relacl IS NULL)::text FROM rel r JOIN pg_class c ON c.oid = r.reloid
  -- view / materialized view definition (owner-rights views run as their owner: a redefinition is semantic)
  UNION ALL SELECT 'rel', 'rel:public.' || r.relname, 'viewdef_md5', md5(pg_get_viewdef(c.oid))
    FROM rel r JOIN pg_class c ON c.oid = r.reloid WHERE c.relkind IN ('v', 'm')

  -- table ACL per grantee (catalog; NULL relacl expanded with acldefault; PUBLIC explicit; * = WITH GRANT OPTION)
  UNION ALL SELECT 'acl', 'rel:public.' || r.relname,
         'grantee:' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' WHEN a.grantee = c.relowner THEN '<owner>' ELSE pg_get_userbyid(a.grantee) END,
         string_agg(a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END, ',' ORDER BY a.privilege_type)
    FROM rel r JOIN pg_class c ON c.oid = r.reloid
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   GROUP BY r.relname, a.grantee, c.relowner

  -- effective table privileges for the API roles and PUBLIC (includes role membership)
  UNION ALL SELECT 'eff', 'rel:public.' || r.relname, 'role:' || ro.rolname,
         string_agg(p.priv || '=' || CASE WHEN has_table_privilege(ro.rolname, r.reloid, p.priv) THEN 't' ELSE 'f' END, ',' ORDER BY p.priv)
    FROM rel r CROSS JOIN fp_roles ro CROSS JOIN fp_privs p
   WHERE r.reloid IS NOT NULL AND (ro.rolname = 'public' OR EXISTS (SELECT 1 FROM pg_roles x WHERE x.rolname = ro.rolname))
   GROUP BY r.relname, ro.rolname

  -- column ACLs (attacl)
  UNION ALL SELECT 'colacl', 'rel:public.' || r.relname,
         'col:' || at.attname || ':grantee:' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' WHEN a.grantee = c.relowner THEN '<owner>' ELSE pg_get_userbyid(a.grantee) END,
         string_agg(a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END, ',' ORDER BY a.privilege_type)
    FROM rel r JOIN pg_class c ON c.oid = r.reloid
    JOIN pg_attribute at ON at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped AND at.attacl IS NOT NULL
    CROSS JOIN LATERAL aclexplode(at.attacl) a
   GROUP BY r.relname, at.attname, a.grantee, c.relowner

  -- policies (full text + md5) on every target relation
  UNION ALL SELECT 'policy', 'rel:public.' || p.tablename, 'policy:' || p.policyname || ':' || x.k, x.v
    FROM pg_policies p
    JOIN (SELECT DISTINCT relname FROM rel WHERE reloid IS NOT NULL) r ON r.relname = p.tablename
    CROSS JOIN LATERAL (VALUES
      ('permissive', p.permissive::text),
      ('roles', (SELECT string_agg(x, ',' ORDER BY x COLLATE "C") FROM unnest(p.roles::text[]) x)),
      ('cmd', p.cmd::text),
      ('qual', coalesce(p.qual, '<none>')),
      ('with_check', coalesce(p.with_check, '<none>')),
      ('expr_md5', md5(coalesce(p.qual, '') || '|' || coalesce(p.with_check, '')))
    ) AS x(k, v)
   WHERE p.schemaname = 'public'
  UNION ALL SELECT 'policy', 'rel:public.' || r.relname, 'policy_count',
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = r.relname)::text
    FROM (SELECT DISTINCT relname FROM rel WHERE reloid IS NOT NULL) r
  -- the 11 close_anon {public} policies: present or not
  UNION ALL SELECT 'policy', 'rel:public.' || tbl, 'close_anon_policy:' || pol || ':exists',
         EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = tbl AND p.policyname = pol)::text
    FROM fp_pol

  -- FIX3 detail tables: columns, constraints, indexes, triggers
  UNION ALL SELECT 'col', 'rel:public.' || c.relname, 'col:' || a.attname,
         format_type(a.atttypid, a.atttypmod) || '|notnull=' || a.attnotnull::text
         || '|default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '<none>')
         || '|identity=' || a.attidentity::text || '|generated=' || a.attgenerated::text
         || '|collation=' || coalesce((SELECT co.collname FROM pg_collation co WHERE co.oid = a.attcollation AND a.attcollation <> 0), '<none>')
    FROM fp_detail fd JOIN pg_class c ON c.relname = fd.relname AND c.relnamespace = 'public'::regnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  UNION ALL SELECT 'col', 'rel:public.' || c.relname, 'column_order',
         (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
    FROM fp_detail fd JOIN pg_class c ON c.relname = fd.relname AND c.relnamespace = 'public'::regnamespace
  UNION ALL SELECT 'con', 'rel:public.' || c.relname, 'con:' || k.conname,
         k.contype::text || '|' || pg_get_constraintdef(k.oid) || '|validated=' || k.convalidated::text
         || '|deferrable=' || k.condeferrable::text || '|deferred=' || k.condeferred::text
    FROM fp_detail fd JOIN pg_class c ON c.relname = fd.relname AND c.relnamespace = 'public'::regnamespace
    JOIN pg_constraint k ON k.conrelid = c.oid
  UNION ALL SELECT 'idx', 'rel:public.' || c.relname, 'idx:' || i.relname,
         pg_get_indexdef(x.indexrelid) || '|valid=' || x.indisvalid::text || '|ready=' || x.indisready::text || '|live=' || x.indislive::text
    FROM fp_detail fd JOIN pg_class c ON c.relname = fd.relname AND c.relnamespace = 'public'::regnamespace
    JOIN pg_index x ON x.indrelid = c.oid JOIN pg_class i ON i.oid = x.indexrelid
  UNION ALL SELECT 'trg', 'rel:public.' || c.relname, 'trg:' || t.tgname,
         t.tgenabled::text || '|' || pg_get_triggerdef(t.oid)
    FROM fp_detail fd JOIN pg_class c ON c.relname = fd.relname AND c.relnamespace = 'public'::regnamespace
    JOIN pg_trigger t ON t.tgrelid = c.oid AND NOT t.tgisinternal

  -- functions: existence, definition hash, security, config, owner, ACL, effective EXECUTE
  UNION ALL SELECT 'fn', 'fn:' || f.sig, 'exists', (f.fnoid IS NOT NULL)::text FROM fn f
  UNION ALL SELECT 'fn', 'fn:' || f.sig, x.k, x.v
    FROM fn f JOIN pg_proc p ON p.oid = f.fnoid
    CROSS JOIN LATERAL (VALUES
      ('def_md5', md5(pg_get_functiondef(p.oid))),
      ('def_md5_lf', md5(replace(pg_get_functiondef(p.oid), E'\r\n', E'\n'))),
      ('prosecdef', p.prosecdef::text),
      ('provolatile', p.provolatile::text),
      ('proleakproof', p.proleakproof::text),
      ('lang', (SELECT l.lanname::text FROM pg_language l WHERE l.oid = p.prolang)),
      ('result', pg_get_function_result(p.oid)),
      ('proconfig', coalesce((SELECT string_agg(x, ',' ORDER BY x COLLATE "C") FROM unnest(p.proconfig) x), '')),
      ('owner', pg_get_userbyid(p.proowner)),
      ('acl_is_default', (p.proacl IS NULL)::text)
    ) AS x(k, v)
  UNION ALL SELECT 'fnacl', 'fn:' || f.sig,
         'grantee:' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' WHEN a.grantee = p.proowner THEN '<owner>' ELSE pg_get_userbyid(a.grantee) END,
         string_agg(a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END, ',' ORDER BY a.privilege_type)
    FROM fn f JOIN pg_proc p ON p.oid = f.fnoid
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   GROUP BY f.sig, a.grantee, p.proowner
  UNION ALL SELECT 'eff', 'fn:' || f.sig, 'role:' || ro.rolname,
         'EXECUTE=' || CASE WHEN has_function_privilege(ro.rolname, f.fnoid, 'EXECUTE') THEN 't' ELSE 'f' END
    FROM fn f CROSS JOIN fp_roles ro
   WHERE f.fnoid IS NOT NULL AND (ro.rolname = 'public' OR EXISTS (SELECT 1 FROM pg_roles x WHERE x.rolname = ro.rolname))

  -- default privileges (pg_default_acl), every row
  UNION ALL SELECT 'defacl',
         'defacl:' || pg_get_userbyid(d.defaclrole) || ':' || coalesce(n.nspname, '*') || ':' || d.defaclobjtype::text,
         'grantee:' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
         string_agg(a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END, ',' ORDER BY a.privilege_type)
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   GROUP BY d.defaclrole, n.nspname, d.defaclobjtype, a.grantee
  UNION ALL SELECT 'defacl', 'defacl:all', 'row_count', (SELECT count(*) FROM pg_default_acl)::text

  -- publications (logical replication / Supabase Realtime): flags, and every member table;
  -- the value names the candidate scope of an in-scope public table, else out_of_scope
  UNION ALL SELECT 'pub', 'pub:' || pb.pubname, 'flags',
         format('all_tables=%s|insert=%s|update=%s|delete=%s|truncate=%s',
                pb.puballtables, pb.pubinsert, pb.pubupdate, pb.pubdelete, pb.pubtruncate)
    FROM pg_publication pb
  UNION ALL SELECT 'pub', 'pub:' || pt.pubname, 'table:' || pt.schemaname || '.' || pt.tablename,
         'member|scope=' || coalesce((SELECT string_agg(DISTINCT r.cand, ',' ORDER BY r.cand) FROM fp_rel r
                                       WHERE pt.schemaname = 'public' AND r.relname = pt.tablename), 'out_of_scope')
    FROM pg_publication_tables pt

  -- close_anon step 5b: TRUNCATE on any public table by anon/authenticated (expected: none)
  UNION ALL SELECT 'global', 'public_tables', 'truncate_holders',
         coalesce((SELECT string_agg(c.relname || ':' || ro.rolname, ',' ORDER BY c.relname COLLATE "C", ro.rolname)
                     FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) ro(rolname)
                    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
                      AND EXISTS (SELECT 1 FROM pg_roles x WHERE x.rolname = ro.rolname)
                      AND has_table_privilege(ro.rolname, c.oid, 'TRUNCATE')), '<none>')
  UNION ALL SELECT 'global', 'public_tables', 'rls_disabled_count',
         (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity)::text
)
SELECT concat_ws(E'\t', section, object, property,
         replace(replace(replace(replace(coalesce(value, '<null>'), '\', '\\'), E'\n', '\n'), E'\r', '\r'), E'\t', '\t'))
  FROM facts
 ORDER BY section COLLATE "C", object COLLATE "C", property COLLATE "C", value COLLATE "C";

-- ledger: is the applied text retained? (absent schema => no lines)
\if :fp_has_ledger
SELECT line FROM (
SELECT concat_ws(E'\t', 'ledger', 'version:' || v.version, x.k, x.v) AS line
  FROM (VALUES ('20261026000000'), ('20261212000000')) AS v(version)
  LEFT JOIN supabase_migrations.schema_migrations m ON m.version = v.version
  CROSS JOIN LATERAL (VALUES
    ('present', (m.version IS NOT NULL)::text),
    ('name', coalesce(m.name, '<none>')),
    ('n_statements', coalesce(cardinality(m.statements), 0)::text),
    ('statements_md5', coalesce(md5(array_to_string(m.statements, E'\n')), '<none>'))
  ) AS x(k, v)
) AS ledger_lines
 ORDER BY line COLLATE "C";
\endif

ROLLBACK;
`;

function main() {
  const sql = build();
  const out = path.join(ROOT, OUT);
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur !== sql) {
      process.stderr.write(`${OUT} is stale; run node scripts/release/catalog-fingerprint-build.js\n`);
      process.exit(1);
    }
    process.stdout.write(`${OUT} is up to date\n`);
    return;
  }
  fs.writeFileSync(out, sql);
  process.stdout.write(`wrote ${OUT}\n`);
}

module.exports = { build, extractTargets, FIX3_TABLES, FIX3_AUX_TABLES, FIX3_FUNCTIONS, PHASE_A_TABLES };

if (require.main === module) main();
