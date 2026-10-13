// Closure-014 — validate docs/security/CLOSURE_014_GRANT_IMPACT_QUERY.sql against the LOCAL cert Postgres (loopback only).
// Usage: CERT_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/cert/validate-grant-impact-query.cjs
// Never point this at production: the script refuses any non-loopback host.
//  1. run the exact file content read-only against the real schema (columns/joins);
//  2. inside ONE transaction that always ROLLs BACK, insert synthetic fixtures covering
//     every impact class, run both queries, compare with the expected classification.
// Also proves the READ ONLY wrapper refuses a write.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const URL_ = process.env.CERT_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'; // supabase CLI local default
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(URL_).hostname)) throw new Error('REFUSING non-loopback database target');
const sqlFile = fs.readFileSync(path.resolve(__dirname, '../../docs/security/CLOSURE_014_GRANT_IMPACT_QUERY.sql'), 'utf8');
const strip = (s) => s.replace(/--[^\n]*/g, '');
const body = strip(sqlFile).split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
const q1 = body.find((s) => s.startsWith('WITH write_tier') && s.includes('holders AS'));
const q2 = body.find((s) => s.startsWith('WITH write_tier') && s.includes('exact_sa AS'));

(async () => {
  const c = new Client({ connectionString: URL_, connectionTimeoutMillis: 5000, query_timeout: 60000 });
  await c.connect();
  const ref = (await c.query(`select current_setting('server_version') v, (select count(*) from pg_tables where schemaname='public')::int tables`)).rows[0];
  console.log('target: local cert postgres', ref.v, 'public tables', ref.tables);

  // 1. Exact file, read-only, real schema.
  const r1 = await c.query(sqlFile);
  const results = (Array.isArray(r1) ? r1 : [r1]).filter((r) => r.command === 'SELECT');
  console.log('file executed read-only: result sets', results.length, '| q1 columns', results[0].fields.map((f) => f.name).join(','),
    '| q1 rows', results[0].rowCount, '| q2 rows', results[1].rows.map((r) => `${r.metric}=${r.principals}`).join(' '));

  // Read-only wrapper refuses writes.
  await c.query('BEGIN TRANSACTION READ ONLY');
  try { await c.query(`update public.capability_assignments set reason = reason where false`); console.log('READ ONLY: NOT ENFORCED'); }
  catch (e) { console.log('READ ONLY enforced:', e.code, e.message.split('\n')[0]); }
  await c.query('ROLLBACK');

  // 2. Synthetic fixture matrix — always rolled back.
  await c.query('BEGIN');
  try {
    const co = (await c.query(`insert into public.companies (name) values ('C13G synthetic') returning id`)).rows[0].id;
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

    const rows = (await c.query(q1)).rows;
    const got = rows.filter((r) => Object.values(U).includes(r.principal_user_id))
      .map((r) => `${Object.keys(U).find((k) => U[k] === r.principal_user_id)}|${r.capability}|${r.grant_source}|${r.grant_scope}|${r.super_admin_role_status}|${r.account_state}|${r.impact}`).sort();
    const expected = [
      'deleted|cron.config.manage|capability_assignments|global|no_super_admin_row|deleted_cannot_authenticate|no_runtime_change',
      'inactiveSA|platform.controls.manage|capability_assignments|global|super_admin_row_not_active|can_authenticate|LOSES_platform_write_access',
      'lowerSA|ALL platform-tier write capabilities (via role)|user_company_roles.role|organization|active_noncanonical_super_admin_role|can_authenticate|RELEASE_BLOCKER_super_admin_lockout',
      'orgScoped|organization.delete|capability_assignments|organization|no_super_admin_row|can_authenticate|LOSES_platform_write_access',
      'parent|identity.admin|capability_assignments|global|no_super_admin_row|can_authenticate|LOSES_platform_write_access',
      'viewer|integration.platform.oauth.manage|capability_assignments|global|no_super_admin_row|can_authenticate|LOSES_platform_write_access',
    ].sort();
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    console.log('fixture matrix:', ok ? 'PASS' : 'FAIL');
    if (!ok) { console.log(' got:\n  ' + got.join('\n  ')); console.log(' expected:\n  ' + expected.join('\n  ')); }
    console.log(' excluded as expected: exactSA (unaffected), expired grant, revoked grant, read-only capabilities');
    const counts = (await c.query(q2)).rows.map((r) => `${r.metric}=${r.principals}/${r.grant_rows ?? '-'}`);
    console.log(' q2 with fixtures:', counts.join(' '));
  } finally {
    await c.query('ROLLBACK');
  }
  const left = (await c.query(`select (select count(*) from public.users where email like '%@c13g.invalid')::int u, (select count(*) from public.companies where name = 'C13G synthetic')::int co`)).rows[0];
  console.log('after rollback: synthetic users', left.u, 'companies', left.co);
  await c.end();
})().catch((e) => { console.error('validate failed:', e.message); process.exit(1); });
