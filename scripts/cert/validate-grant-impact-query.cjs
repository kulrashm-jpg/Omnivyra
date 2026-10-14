'use strict';
// Closure-014 — validate docs/security/CLOSURE_014_GRANT_IMPACT_QUERY.sql against the LOCAL cert Postgres (loopback only).
// Usage: CERT_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/cert/validate-grant-impact-query.cjs
// Never point this at production: the script refuses any non-loopback host BEFORE a client is constructed.
//  1. run the exact file content (READ ONLY transaction ending in ROLLBACK) against the real schema;
//  2. prove the READ ONLY wrapper refuses a write: the UPDATE must fail with SQLSTATE 25006 — success or any
//     other error FAILS the validator;
//  3. inside ONE transaction that always ROLLs BACK, insert synthetic fixtures covering every impact class, run
//     the queries, compare with the expected classification — a mismatch FAILS the validator;
//  4. confirm no synthetic row survives the rollback — any leftover FAILS the validator.
// Closure-014A: every check fails closed (non-zero exit), rollback is attempted on every path, the client is
// always closed, and a cleanup failure never masks the original error.
const fs = require('fs');
const path = require('path');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'; // supabase CLI local default
const SQL_PATH = path.resolve(__dirname, '../../docs/security/CLOSURE_014_GRANT_IMPACT_QUERY.sql');
const SYNTHETIC_EMAIL = '%@c13g.invalid';
const SYNTHETIC_COMPANY = 'C13G synthetic';

/** The exact expected classification (unchanged since Closure-013 follow-up). */
const EXPECTED_MATRIX = Object.freeze([
  'deleted|cron.config.manage|capability_assignments|global|no_super_admin_row|deleted_cannot_authenticate|no_runtime_change',
  'inactiveSA|platform.controls.manage|capability_assignments|global|super_admin_row_not_active|can_authenticate|LOSES_platform_write_access',
  'lowerSA|ALL platform-tier write capabilities (via role)|user_company_roles.role|organization|active_noncanonical_super_admin_role|can_authenticate|RELEASE_BLOCKER_super_admin_lockout',
  'orgScoped|organization.delete|capability_assignments|organization|no_super_admin_row|can_authenticate|LOSES_platform_write_access',
  'parent|identity.admin|capability_assignments|global|no_super_admin_row|can_authenticate|LOSES_platform_write_access',
  'viewer|integration.platform.oauth.manage|capability_assignments|global|no_super_admin_row|can_authenticate|LOSES_platform_write_access',
].slice().sort());

class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}

/** Throws unless the URL's host is loopback. Never echoes the URL (it carries credentials). */
function assertLoopbackTarget(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { throw new ValidationError('REFUSING unparseable database target'); }
  if (!LOOPBACK_HOSTS.has(host)) throw new ValidationError('REFUSING non-loopback database target');
  return host;
}

/** Split the SQL file into its two per-query statements (comments stripped); both must exist. */
function splitQueries(sqlFile) {
  const body = sqlFile.replace(/--[^\n]*/g, '').split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
  const q1 = body.find((s) => s.startsWith('WITH write_tier') && s.includes('holders AS'));
  const q2 = body.find((s) => s.startsWith('WITH write_tier') && s.includes('exact_sa AS'));
  if (!q1 || !q2) throw new ValidationError('grant-impact SQL does not contain the expected Query 1 / Query 2');
  return { q1, q2 };
}

/** ROLLBACK; never throws — returns the rollback error (or null) so callers decide without masking. */
async function rollbackQuietly(c) {
  try { await c.query('ROLLBACK'); return null; } catch (e) { return e; }
}

const describeErr = (e) => (e && (e.code ? `SQLSTATE ${e.code}` : e.message)) || 'unknown error';

/** Concise diagnostic for a failed ROLLBACK (never echoes connection details). */
function noteRollbackFailure(rbErr, step, log) {
  log(`diagnostic: ROLLBACK failed during ${step} (${describeErr(rbErr)})`);
}

/**
 * Keep the PRIMARY error as the one thrown; when the rollback also failed, log a diagnostic and attach the
 * rollback error as `rollbackError` so it is available without replacing the original failure.
 */
function withRollbackDiagnostic(primary, rbErr, step, log) {
  if (!rbErr) return primary;
  noteRollbackFailure(rbErr, step, log);
  if (primary && typeof primary === 'object') primary.rollbackError = rbErr;
  return primary;
}

/** The READ ONLY wrapper must refuse a write with SQLSTATE 25006. Anything else fails closed. */
async function assertReadOnlyEnforced(c, log = () => {}) {
  await c.query('BEGIN TRANSACTION READ ONLY');
  let failure = null;
  let code = null;
  try {
    await c.query('update public.capability_assignments set reason = reason where false');
    failure = 'the UPDATE SUCCEEDED inside a READ ONLY transaction';
  } catch (e) {
    code = e && e.code;
    if (code !== '25006') failure = `unexpected database error (SQLSTATE ${code || 'none'}) instead of 25006`;
  }
  const rbErr = await rollbackQuietly(c);
  if (failure) throw withRollbackDiagnostic(new ValidationError(`READ ONLY enforcement check FAILED: ${failure}`), rbErr, 'READ ONLY enforcement check', log);
  if (rbErr) {
    noteRollbackFailure(rbErr, 'READ ONLY enforcement check', log);
    throw new ValidationError(`READ ONLY enforcement check: ROLLBACK failed (${describeErr(rbErr)})`);
  }
  log(`READ ONLY enforced: SQLSTATE ${code}`);
  return code;
}

/** Synthetic fixture matrix in ONE transaction that is always rolled back; a mismatch throws. */
async function runFixtureMatrix(c, { q1, q2 }, log = () => {}) {
  await c.query('BEGIN');
  let primary = null;
  try {
    const co = (await c.query(`insert into public.companies (name) values ('${SYNTHETIC_COMPANY}') returning id`)).rows[0].id;
    const mk = async (k, extra = '') => (await c.query(
      `insert into public.users (id, email, supabase_uid, has_password${extra ? ', is_deleted' : ''}) values (gen_random_uuid(), $1, gen_random_uuid()::text, false${extra ? ', true' : ''}) returning id`,
      [`c13g-${k}@c13g.invalid`])).rows[0].id;
    const U = {
      exactSA: await mk('exact-sa'), lowerSA: await mk('lower-sa'), inactiveSA: await mk('inactive-sa'),
      viewer: await mk('viewer'), expired: await mk('expired'), revoked: await mk('revoked'), readOnly: await mk('read-only'),
      deleted: await mk('deleted', 'x'), orgScoped: await mk('org-scoped'), parent: await mk('parent'),
    };
    const role = (u, r, s) => c.query(`insert into public.user_company_roles (user_id, company_id, role, status) values ($1,$2,$3,$4)`, [u, co, r, s]);
    const grant = (u, cap, o = {}) => c.query(
      `insert into public.capability_assignments (user_id, organization_id, capability, reason, expires_at, revoked_at) values ($1,$2,$3,'C13G synthetic',$4,$5)`,
      [u, o.org ?? null, cap, o.expires ?? null, o.revoked ?? null]);
    await role(U.exactSA, 'SUPER_ADMIN', 'active'); await grant(U.exactSA, 'billing.grant_free_credits');
    await role(U.lowerSA, 'super_admin', 'active');
    await role(U.inactiveSA, 'SUPER_ADMIN', 'inactive'); await grant(U.inactiveSA, 'platform.controls.manage');
    await role(U.viewer, 'VIEW_ONLY', 'active'); await grant(U.viewer, 'integration.platform.oauth.manage'); await grant(U.viewer, 'super_admin.dashboard.view');
    await grant(U.expired, 'billing.plan.manage', { expires: new Date(Date.now() - 60e3).toISOString() });
    await grant(U.revoked, 'billing.plan.manage', { revoked: new Date().toISOString() });
    await grant(U.readOnly, 'consumption.view.aggregate');
    await grant(U.deleted, 'cron.config.manage');
    await grant(U.orgScoped, 'organization.delete', { org: co });
    await grant(U.parent, 'identity.admin');

    const ids = Object.values(U);
    const got = (await c.query(q1)).rows
      .filter((r) => ids.includes(r.principal_user_id))
      .map((r) => `${Object.keys(U).find((k) => U[k] === r.principal_user_id)}|${r.capability}|${r.grant_source}|${r.grant_scope}|${r.super_admin_role_status}|${r.account_state}|${r.impact}`)
      .sort();
    if (JSON.stringify(got) !== JSON.stringify(EXPECTED_MATRIX)) {
      throw new ValidationError(`fixture matrix MISMATCH\n got:\n  ${got.join('\n  ')}\n expected:\n  ${EXPECTED_MATRIX.join('\n  ')}`);
    }
    log('fixture matrix: PASS (excluded as expected: exactSA unaffected, expired grant, revoked grant, read-only capabilities)');
    const counts = (await c.query(q2)).rows.map((r) => `${r.metric}=${r.principals}/${r.grant_rows ?? '-'}`);
    log(` q2 with fixtures: ${counts.join(' ')}`);
  } catch (e) {
    primary = e;
  }
  const rbErr = await rollbackQuietly(c);
  // The original failure wins; the rollback was still attempted and, if it failed, is attached + logged.
  if (primary) throw withRollbackDiagnostic(primary, rbErr, 'fixture matrix', log);
  if (rbErr) {
    noteRollbackFailure(rbErr, 'fixture matrix', log);
    throw new ValidationError(`fixture matrix: ROLLBACK failed (${describeErr(rbErr)})`);
  }
}

/** No synthetic row may survive. */
async function assertNoSyntheticRows(c, log = () => {}) {
  const left = (await c.query(
    `select (select count(*) from public.users where email like $1)::int u, (select count(*) from public.companies where name = $2)::int co`,
    [SYNTHETIC_EMAIL, SYNTHETIC_COMPANY])).rows[0];
  log(`after rollback: synthetic users ${left.u} companies ${left.co}`);
  if (left.u !== 0 || left.co !== 0) throw new ValidationError(`synthetic rows survived the rollback (users ${left.u}, companies ${left.co})`);
}

/** The whole validation on a connected client. Throws on the first failure. */
async function runValidation(c, sqlFile, log = () => {}) {
  const queries = splitQueries(sqlFile);
  const ref = (await c.query(`select current_setting('server_version') v, (select count(*) from pg_tables where schemaname='public')::int tables`)).rows[0];
  log(`target: local cert postgres ${ref.v}; public tables ${ref.tables}`);

  // 1. The exact file — its own READ ONLY transaction ends in ROLLBACK.
  const r1 = await c.query(sqlFile);
  const results = (Array.isArray(r1) ? r1 : [r1]).filter((r) => r.command === 'SELECT');
  if (results.length !== 4) throw new ValidationError(`expected 4 result sets from the SQL file, got ${results.length}`);
  log(`file executed read-only: result sets ${results.length}; q1 columns ${results[0].fields.map((f) => f.name).join(',')}; q1 rows ${results[0].rowCount}`);

  await assertReadOnlyEnforced(c, log);
  await runFixtureMatrix(c, queries, log);
  await assertNoSyntheticRows(c, log);
}

/**
 * CLI entry. Resolves and checks the target BEFORE constructing a client, always closes the client, and
 * returns the exit code (0 pass, 1 fail). A cleanup failure is reported but never replaces the original error.
 */
async function main({
  url = process.env.CERT_DB_URL || DEFAULT_URL,
  ClientCtor = null,
  sqlFile = null,
  log = (m) => console.log(m),
  logError = (m) => console.error(m),
} = {}) {
  let primary = null;
  let client = null;
  try {
    const host = assertLoopbackTarget(url);
    log(`database target host: ${host} (loopback)`);
    const Ctor = ClientCtor || require('pg').Client;
    const sql = sqlFile ?? fs.readFileSync(SQL_PATH, 'utf8');
    client = new Ctor({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 60000 });
    await client.connect();
    await runValidation(client, sql, log);
  } catch (e) {
    primary = e;
  } finally {
    if (client) {
      try { await client.end(); } catch (e) { logError(`client close failed: ${e && e.message}`); }
    }
  }
  if (primary) {
    logError(`VALIDATION FAILED: ${primary.message}`);
    return 1;
  }
  log('VALIDATION PASS');
  return 0;
}

module.exports = {
  EXPECTED_MATRIX, ValidationError, assertLoopbackTarget, splitQueries, assertReadOnlyEnforced,
  runFixtureMatrix, assertNoSyntheticRows, runValidation, main,
};

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}
