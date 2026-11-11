/**
 * Release-gate ACL snapshot (scripts/release/grants-acl-check.sql) — static
 * contract.
 *
 * The script runs against production with the read-only release credential, so
 * it must itself be incapable of writing: catalog SELECTs only, one statement
 * inside BEGIN … READ ONLY … ROLLBACK, no SET ROLE, no temp objects.
 *
 * S13-S17 (P10 in docs/release/grants-consumer-matrix.md) add the checks a
 * diff against an expected copy cannot provide: the whole API-exposed
 * population for anon / authenticated / authenticator / service_role / PUBLIC,
 * column-only privileges, ABSOLUTE PASS/FAIL/REVIEW assertions (an exposure
 * shared by the expected copy and production must still FAIL), SECURITY
 * DEFINER reachability and pg_graphql exposure.
 *
 * Behaviour (non-superuser pg_read_all_data role, seeded exposures FAIL,
 * removed seeds PASS, identical exposure in two databases → empty diff but
 * FAIL in both) is validated on a disposable cluster; this suite pins the text
 * so those properties cannot be edited away unnoticed.
 */

import * as fs from 'fs';
import * as path from 'path';

const FILE = path.resolve(__dirname, '../../../scripts/release/grants-acl-check.sql');
const raw = fs.readFileSync(FILE, 'utf8');
// SQL with line comments removed (the file uses no block comments and no `--` inside literals).
const sql = raw.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const lines = sql.split('\n').map((l) => l.trim()).filter(Boolean);

/** Text of a CTE body: from `name AS (` up to the next top-level CTE header. */
function cte(name: string): string {
  const start = sql.search(new RegExp(`^${name}(\\([^)]*\\))? AS (MATERIALIZED )?\\(`, 'm'));
  expect(start).toBeGreaterThan(-1);
  const bodyStart = sql.indexOf('\n', start) + 1;
  const rest = sql.slice(bodyStart);
  const next = rest.search(/^[a-z_0-9]+(\([^)]*\))? AS (MATERIALIZED )?\(/m);
  return sql.slice(start, bodyStart) + (next === -1 ? rest : rest.slice(0, next));
}

describe('grants-acl-check.sql — read-only by construction', () => {
  it('uses no block comments and no `--` inside string literals (so the strip above is complete)', () => {
    expect(raw).not.toMatch(/\/\*/);
    expect(raw.split('\n').filter((l) => /'[^']*--[^']*'/.test(l))).toEqual([]);
  });

  it('contains no raw control bytes', () => {
    // eslint-disable-next-line no-control-regex
    expect(raw).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });

  it('contains no write, DDL, DCL, session-role or transaction-control statement other than its own wrapper', () => {
    const forbidden = /^(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|comment|copy|vacuum|analyze|cluster|reindex|lock|call|do|set\s+role|set\s+session|reset|commit|end(\s+(work|transaction))?\s*;|abort|savepoint|prepare|execute|listen|notify|security\s+label|refresh|import|load|select\s+.*\binto\b)\b/i;
    expect(lines.filter((l) => forbidden.test(l))).toEqual([]);
    expect(sql).not.toMatch(/\b(set_config|pg_advisory|lo_create|lo_import|nextval|setval|dblink|pg_terminate_backend|pg_cancel_backend)\s*\(/i);
    expect(sql).not.toMatch(/\btemp(orary)?\s+table\b/i);
  });

  it('opens exactly one REPEATABLE READ READ ONLY transaction, sets only LOCAL settings, and always rolls back', () => {
    expect(lines.filter((l) => /^BEGIN\b/i.test(l))).toEqual(['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;']);
    expect(lines.filter((l) => /^SET\b/i.test(l)).every((l) => /^SET LOCAL /.test(l))).toBe(true);
    expect(sql).toMatch(/SET LOCAL search_path = pg_catalog, pg_temp;/);
    expect(lines[lines.length - 1]).toBe('ROLLBACK;');
    expect(lines[0]).toBe('\\set ON_ERROR_STOP on');
  });

  it('is a single statement (one result set for the SQL Editor) with a deterministic C-collated order', () => {
    const body = sql.slice(sql.indexOf('\nWITH\n'), sql.lastIndexOf('ROLLBACK;'));
    expect(body.split(';').filter((s) => s.trim()).length).toBe(1);
    expect(sql).toMatch(/ORDER BY section COLLATE "C", scope COLLATE "C", object COLLATE "C", k COLLATE "C", v COLLATE "C";/);
  });
});

describe('grants-acl-check.sql — S13 full-population effective privileges', () => {
  it('derives the exposed schemas from authenticator pgrst.db_schemas, else public + graphql_public, public always', () => {
    const cfg = cte('exp_cfg');
    expect(cfg).toMatch(/FROM pg_db_role_setting s/);
    expect(cfg).toMatch(/rolname = 'authenticator'/);
    expect(cfg).toMatch(/c LIKE 'pgrst\.db\\_schemas=%'/);
    const names = cte('exp_names');
    expect(names).toMatch(/unnest\(ARRAY\['public', 'graphql_public'\]\)/);
    expect(names).toMatch(/SELECT 'public', 'always'/);
  });

  it('covers every table, partitioned table, view, matview and foreign table in those schemas', () => {
    const pop = cte('pop_rels');
    expect(pop).toMatch(/c\.relkind IN \('r', 'p', 'v', 'm', 'f'\)/);
    expect(pop).toMatch(/JOIN pg_class c ON c\.relnamespace = e\.nsp/);
    // a NULL relacl is the owner-only built-in default, not "no ACL"
    expect(pop).toMatch(/coalesce\(c\.relacl, acldefault\('r', c\.relowner\)\)/);
  });

  it('checks anon, authenticated, authenticator, service_role and PUBLIC (grantee 0), skipping absent roles', () => {
    const roles = cte('roles13');
    expect(roles).toMatch(/FROM pg_roles r\s+WHERE r\.rolname IN \('anon', 'authenticated', 'authenticator', 'service_role'\)/);
    expect(roles).toMatch(/SELECT 'PUBLIC', 0::oid/);
    expect(sql).toMatch(/'role_absent'/);
  });

  it('checks all eight table privileges, MAINTAIN only on PG17+', () => {
    expect(cte('privs')).toMatch(/'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'/);
    expect(cte('privs')).toMatch(/SELECT 'MAINTAIN' WHERE current_setting\('server_version_num'\)::int >= 170000/);
    expect(cte('eff13')).toMatch(/has_table_privilege\('public', x\.rid, pv\.p\)/);
    expect(cte('eff13')).toMatch(/has_table_privilege\(r\.roid, x\.rid, pv\.p\)/);
  });

  it('reports direct grant, effective privileges, RLS, FORCE RLS and applicable policies per command', () => {
    expect(sql).toMatch(/'relkind=%s rls=%s force_rls=%s direct=%s effective=%s pol_sel\/ins\/upd\/del=%s\/%s\/%s\/%s pol_restrictive=%s'/);
    const pol = cte('pol13');
    expect(pol).toMatch(/JOIN roles13 r ON 0::oid = ANY \(p\.polroles\) OR r\.roid = ANY \(p\.polroles\)/);
    for (const cmd of ["'r'", "'a'", "'w'", "'d'"]) expect(pol).toContain(`p.polcmd IN ('*', ${cmd})`);
    expect(cte('direct13')).toMatch(/aclexplode\(x\.acl\)/);
  });
});

describe('grants-acl-check.sql — S14 column privileges', () => {
  it('reports attacl grants and privileges held only through columns for anon/authenticated', () => {
    const col = cte('colonly13');
    expect(col).toMatch(/has_any_column_privilege\(r\.roid, x\.rid, cp\.p\)/);
    expect(col).toMatch(/NOT has_table_privilege\(r\.roid, x\.rid, cp\.p\)/);
    expect(col).toMatch(/rname IN \('anon', 'authenticated'\)/);
    expect(sql).toMatch(/'S14_column_privilege', x\.nsp, x\.rel \|\| '\.' \|\| att\.attname/);
    expect(sql).toMatch(/aclexplode\(att\.attacl\)/);
  });
});

describe('grants-acl-check.sql — S15 absolute assertions', () => {
  const asrt = () => cte('asrt');

  it('never compares with another database: every verdict is computed from this catalog alone', () => {
    expect(raw).toMatch(/an exposure that the expected copy and production share/);
    expect(sql).not.toMatch(/dblink|postgres_fdw|\\copy|\\i\b|\\include/i);
    expect(asrt()).not.toMatch(/expected-grants|grants\.diff/);
  });

  it('(a) anon write set is INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/MAINTAIN plus column INSERT/UPDATE, in scope and population-wide', () => {
    expect(cte('anon_write')).toMatch(/\('INSERT'\), \('UPDATE'\), \('DELETE'\), \('TRUNCATE'\), \('TRIGGER'\), \('MAINTAIN'\)/);
    expect(cte('anon_pop')).toMatch(/unnest\(coalesce\(c\.colonly, '\{\}'\)\) \|\| '\(column\)'/);
    const a = asrt();
    expect(a).toMatch(/'a\.anon_no_write',\s+CASE WHEN s\.rid IS NULL THEN 'ABSENT'\s+WHEN s\.anon_write_held IS NULL THEN 'PASS'\s+ELSE 'FAIL anon holds ' \|\| s\.anon_write_held END/);
    expect(a).toMatch(/'population:' \|\| a\.nsp, a\.rel, 'a\.anon_no_write', 'FAIL anon holds '/);
    expect(a).toMatch(/'a\.anon_no_write:count'/);
    expect(a).toMatch(/CASE WHEN count\(a\.write_held\) = 0 THEN 'PASS' ELSE 'FAIL' END/);
  });

  it('(a) applies to every in-scope list (rel_objs), not a hand-picked subset', () => {
    expect(cte('scoped')).toMatch(/FROM rels x/);
    for (const t of ['brand_memory', 'content', 'content_asset', 'content_memory', 'content_originality',
      'content_revision', 'content_variant', 'publication_lineage']) {
      expect(raw).toContain(`('fix3:phase_a_revoked', '${t}')`);
    }
    for (const t of ['content_quality', 'content_block', 'content_recommendation', 'content_approval_history']) {
      expect(raw).toContain(`('fix3:table', '${t}')`);
    }
    expect((raw.match(/\('stack:no_revoke', '/g) || []).length).toBe(10);
  });

  it('(a′) anon expectation follows plan §C1: Phase-A recorded as found, public-read SELECT only, others none', () => {
    const a = asrt();
    expect(a).toMatch(/WHEN s\.scope IN \('fix3:phase_a_revoked', 'fix3:dependency', 'control:realtime'\)\s+THEN 'REVIEW anon holds '/);
    expect(a).toMatch(/s\.scope = 'close_anon:public_read'/);
    expect(a).toMatch(/ELSE 'FAIL anon holds ' \|\| s\.anon_held END/);
  });

  it('(b) authenticated holds nothing on the 8 Phase-A tables; (c) FIX3 authenticated is REVIEW, never auto-judged', () => {
    const a = asrt();
    expect(a).toMatch(/'b\.authenticated_has_nothing'[\s\S]*?ELSE 'FAIL authenticated holds '[\s\S]*?WHERE s\.scope = 'fix3:phase_a_revoked'/);
    const c = a.slice(a.indexOf("'c.authenticated_privileges'"), a.indexOf("WHERE s.scope = 'fix3:table'"));
    expect(c).toMatch(/'REVIEW authenticated holds %s rls=%s force_rls=%s policies_for_authenticated=%s'/);
    expect(c).not.toMatch(/'FAIL/);
  });

  it('(d) default ACLs of postgres/supabase_admin granting to anon/authenticated/PUBLIC are REVIEW, including the built-in function default', () => {
    const a = asrt();
    expect(a).toMatch(/pg_get_userbyid\(d\.defaclrole\) IN \('postgres', 'supabase_admin'\)/);
    expect(a).toMatch(/a\.grantee = 0 OR pg_get_userbyid\(a\.grantee\) IN \('anon', 'authenticated'\)/);
    expect(a).toMatch(/'REVIEW EXECUTE \(built-in default: no global function entry\)'/);
  });

  it('emits a summary row counting every status', () => {
    expect(sql).toMatch(/'S15_assert', '-', '-', 'summary',\s+format\('FAIL=%s REVIEW=%s PASS=%s ABSENT=%s'/);
  });
});

describe('grants-acl-check.sql — S16 SECURITY DEFINER and S17 pg_graphql', () => {
  it('lists SECURITY DEFINER functions in exposed schemas with client EXECUTE and search_path presence', () => {
    const sd = cte('sd16');
    expect(sd).toMatch(/WHERE p\.prosecdef/);
    expect(sd).toMatch(/has_function_privilege\('public', p\.oid, 'EXECUTE'\) AS x_public/);
    expect(sd).toMatch(/r\.rname = 'anon' AND has_function_privilege\(r\.roid, p\.oid, 'EXECUTE'\)/);
    expect(sd).toMatch(/r\.rname = 'authenticated' AND has_function_privilege\(r\.roid, p\.oid, 'EXECUTE'\)/);
    expect(sd).toMatch(/c LIKE 'search\\_path=%'/);
    expect(sql).toMatch(/coalesce\(f\.sp, 'MISSING'\)/);
  });

  it('follows client-executable SECURITY DEFINER bodies to in-scope tables', () => {
    expect(sql).toMatch(/'body_names_table:' \|\| f\.sig/);
    expect(sql).toMatch(/f\.prosrc ~\* \('\(from\|join\|into\|update\|table\)\\s\+\(public\\\.\)\?"\?' \|\| x\.name \|\| '\\M'\)/);
  });

  it('reports pg_graphql installation, schema USAGE and resolver EXECUTE for client roles', () => {
    expect(sql).toMatch(/WHERE x\.extname = 'pg_graphql'\), 'NOT_INSTALLED'\)/);
    expect(sql).toMatch(/\(VALUES \('graphql'\), \('graphql_public'\)\) g\(s\)/);
    expect(sql).toMatch(/has_schema_privilege\(r\.roid, n\.oid, 'USAGE'\)/);
    expect(sql).toMatch(/p\.proname IN \('graphql', 'resolve'\)/);
  });
});
