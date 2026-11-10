/**
 * Release-gate credential self-check (scripts/release/session-readiness-check.sql)
 * — static contract.
 *
 * The script is the FIRST thing run with a production credential, so it must
 * itself be incapable of writing, and it must make a failing credential
 * impossible to miss:
 *   - catalog reads only, inside BEGIN TRANSACTION READ ONLY … ROLLBACK;
 *   - transaction_read_only is captured BEFORE its own READ ONLY wrapper
 *     (inside the wrapper it is always `on`, so a check there proves nothing);
 *   - role membership is walked through pg_auth_members directly, so a
 *     membership granted WITH INHERIT FALSE, SET TRUE (invisible to
 *     has_table_privilege) still FAILs — only pg_read_all_data is allowed;
 *   - any FAIL makes psql exit non-zero (a deliberate error under
 *     ON_ERROR_STOP), so the gate never depends on someone reading the table.
 *
 * Behaviour against real LOGIN roles is validated on a disposable cluster (see
 * the release-gate plan); this suite pins the text so those properties cannot
 * be edited away unnoticed.
 */

import * as fs from 'fs';
import * as path from 'path';

const FILE = path.resolve(__dirname, '../../../scripts/release/session-readiness-check.sql');
const raw = fs.readFileSync(FILE, 'utf8');
// SQL with comments removed (line comments only; the file uses no block comments).
const sql = raw.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const lines = sql.split('\n').map((l) => l.trim()).filter(Boolean);

describe('session-readiness-check.sql — read-only by construction', () => {
  it('uses no block comments (so the line-comment strip above is complete)', () => {
    expect(raw).not.toMatch(/\/\*/);
  });

  it('contains no write, DDL, DCL, session-role or transaction-control statement other than its own wrapper', () => {
    const forbidden = /^(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|comment|copy|vacuum|analyze|cluster|reindex|lock|call|do|set\s+role|set\s+session|reset|commit|end|prepare|execute|listen|notify|security\s+label|refresh|import|load)\b/i;
    const offending = lines.filter((l) => forbidden.test(l));
    expect(offending).toEqual([]);
  });

  it('opens exactly one READ ONLY transaction, sets local timeouts, and rolls back on success', () => {
    expect(lines.filter((l) => /^BEGIN\b/i.test(l))).toEqual(['BEGIN TRANSACTION READ ONLY;']);
    expect(sql).toMatch(/SET LOCAL statement_timeout = '\d+s';/);
    expect(sql).toMatch(/SET LOCAL lock_timeout = '\d+s';/);
    expect(lines.filter((l) => /^SET\b/i.test(l)).every((l) => /^SET LOCAL /.test(l))).toBe(true);
    expect(sql).toMatch(/\\if :self_check_ok\s+ROLLBACK;/);
  });

  it('stops psql on any error', () => {
    expect(lines[0]).toBe('\\set ON_ERROR_STOP on');
  });
});

describe('session-readiness-check.sql — fails closed', () => {
  it('captures transaction_read_only before its own READ ONLY wrapper and judges that value', () => {
    const capture = sql.indexOf("SELECT current_setting('transaction_read_only') AS pre_wrapper_tx_ro \\gset");
    const begin = sql.indexOf('BEGIN TRANSACTION READ ONLY;');
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(begin);
    expect(sql).toMatch(/CASE WHEN :'pre_wrapper_tx_ro' = 'on' THEN 'OK' ELSE 'FAIL' END/);
  });

  it('walks pg_auth_members recursively and FAILs on any membership except pg_read_all_data', () => {
    expect(sql).toMatch(/WITH RECURSIVE m\(roleid\) AS \(/);
    expect(sql).toMatch(/FROM pg_auth_members am WHERE am\.member = \(SELECT oid FROM me\)/);
    expect(sql).toMatch(/FROM pg_auth_members am JOIN m ON am\.member = m\.roleid/);
    expect(sql).toMatch(/not_allowlisted AS \(\s*SELECT rolname FROM memberships WHERE rolname <> 'pg_read_all_data'\s*\),/);
    expect(sql).toMatch(/memberships AS \([\s\S]*?\)\s*SELECT r\.rolname FROM m JOIN pg_roles r ON r\.oid = m\.roleid\s*\),/);
    expect(sql).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM not_allowlisted\) THEN 'FAIL' ELSE 'OK' END/);
    // No option filter: SET-only / NOINHERIT / ADMIN-only edges all count.
    const membership = sql.slice(sql.indexOf('memberships AS ('), sql.indexOf('not_allowlisted AS ('));
    expect(membership).not.toMatch(/inherit_option|set_option|admin_option/);
  });

  it('keeps the write-capability and visibility checks', () => {
    for (const check of [
      'role.superuser', 'role.bypassrls', 'role.member_of_pg_write_all_data',
      'privilege.writable_tables', 'privilege.schemas_with_CREATE',
      'visibility.public_relations_with_hidden_columns', 'visibility.select_on_ledger',
      'role.default_transaction_read_only (role setting)',
    ]) expect(raw).toContain(`'${check}`);
  });

  // N1: ADMIN option on any walked edge (even pg_read_all_data), database CREATE, and
  // sequence USAGE/UPDATE are write surfaces too.
  it('FAILs on ADMIN option anywhere on the membership walk, on database CREATE, and on writable sequences', () => {
    const admin = sql.slice(sql.indexOf('admin_edges AS ('), sql.indexOf('writable_sequences AS ('));
    expect(admin).toMatch(/WITH RECURSIVE e\(roleid, admin_option\) AS \(/);
    expect(admin).toMatch(/FROM pg_auth_members am WHERE am\.member = \(SELECT oid FROM me\)/);
    expect(admin).toMatch(/FROM pg_auth_members am JOIN e ON am\.member = e\.roleid/);
    expect(admin).toMatch(/WHERE e\.admin_option\s*\)/);
    expect(admin).not.toMatch(/pg_read_all_data/); // no exemption for the allowed role
    expect(sql).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM admin_edges\) THEN 'FAIL' ELSE 'OK' END/);
    expect(sql).toMatch(/CASE WHEN has_database_privilege\(current_database\(\), 'CREATE'\) THEN 'FAIL' ELSE 'OK' END/);
    expect(sql).toMatch(/c\.relkind = 'S'/);
    expect(sql).toMatch(/has_sequence_privilege\(c\.oid, 'USAGE'\) OR has_sequence_privilege\(c\.oid, 'UPDATE'\)/);
    expect(sql).toMatch(/CASE WHEN \(SELECT n FROM writable_sequences\) = 0 THEN 'OK' ELSE 'FAIL' END/);
  });

  it('exits non-zero on any FAIL: a deliberate error in the \\else branch under ON_ERROR_STOP', () => {
    expect(sql).toMatch(/bool_and\(verdict <> 'FAIL'\) AS self_check_ok/);
    expect(sql).toMatch(/\\if :self_check_ok\s+ROLLBACK;\s+\\else[\s\S]*SELECT 'self-check failed'::int;\s+\\endif/);
  });

  it('always prints the report, including the overall line', () => {
    expect(sql).toMatch(/SELECT 99, 'overall'/);
    expect(sql).toMatch(/\\echo :self_check_report/);
  });
});
