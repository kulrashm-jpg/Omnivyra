/**
 * BETA-022 RULE 5 — Verify the seeded beta environment against the LIVE stack.
 *
 * For every seeded account this proves, end-to-end against the running Supabase:
 *   1. LOGIN      — GoTrue password grant issues a JWT (real authentication).
 *   2. IDENTITY   — the JWT subject maps to the seeded public.users row.
 *   3. MEMBERSHIP — an ACTIVE user_company_roles row ties the user to the beta tenant
 *                   with the expected role (what the post-login / dashboard bootstrap reads).
 *   4. LOGOUT     — GoTrue revokes the session (204).
 * Then it verifies the tenant's seeded datasets are present (what the dashboard renders)
 * and that credits show a positive balance.
 *
 *   set -a; . ./path/to/beta.keys.env; set +a
 *   node scripts/beta/verify-beta.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { serviceClient, betaEnv, log, ok, fail } from './beta-client.mjs';
import { BETA } from './beta-fixtures.mjs';

const { url, anon } = betaEnv();
const sb = serviceClient();
let failures = 0;
const check = (cond, msg) => (cond ? ok(msg) : (fail(msg), failures++));

async function grant(email, password) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function logout(token) {
  const r = await fetch(`${url}/auth/v1/logout`, {
    method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${token}` },
  });
  return r.status;
}

async function main() {
  log('\n=== BETA-022 verify (live stack) ===');

  // ── Per-account auth journey (RULE 5) ───────────────────────────────────────
  for (const u of BETA.users) {
    log(`\n[${u.label}] ${u.email}`);
    const g = await grant(u.email, u.password);
    check(g.status === 200 && !!g.body.access_token, `login → JWT issued (${g.status})`);
    if (g.status !== 200) continue;

    const uid = g.body.user?.id;
    // identity → seeded public.users row
    const { data: urow } = await sb.from('users').select('id,email,role,active_company_id,status').eq('email', u.email).single();
    check(!!urow && urow.id === uid, 'identity → seeded public.users row (id matches JWT subject)');
    check(urow?.active_company_id === BETA.company.id && urow?.status === 'active', 'active_company_id + status=active (dashboard-ready)');

    // membership + role (what the dashboard bootstrap resolves)
    const { data: ucr } = await sb.from('user_company_roles')
      .select('role,status,company_id').eq('user_id', uid).eq('company_id', BETA.company.id).eq('status', 'active').maybeSingle();
    check(!!ucr, 'ACTIVE membership row in beta tenant');
    check(ucr?.role === u.role, `role = ${u.role} (permission binding)`);

    // wrong password must fail (auth still enforced — not weakened)
    const bad = await grant(u.email, 'wrong-password');
    check(bad.status >= 400, 'wrong password rejected (security intact)');

    // logout
    const lo = await logout(g.body.access_token);
    check(lo === 204 || lo === 200, `logout → session revoked (${lo})`);
  }

  // ── Tenant datasets present (RULE 5: seeded data loads) ──────────────────────
  log('\n[Tenant datasets — what the dashboard renders]');
  const counts = {};
  for (const [table, col, expect] of [
    ['reports', 'company_id', 2], ['campaigns', 'company_id', 1], ['content_items', 'campaign_id', 3],
    ['creator_assets', 'company_id', 2], ['scheduled_posts', 'campaign_id', 3], ['active_leads', 'company_id', 2],
    ['website_analytics_daily', 'company_id', BETA.analyticsDays], ['website_health_scores', 'company_id', 1],
  ]) {
    const val = col === 'campaign_id' ? BETA.campaign.id : BETA.company.id;
    const { count } = await sb.from(table).select('*', { count: 'exact', head: true }).eq(col, val);
    counts[table] = count;
    check((count || 0) >= expect, `${table}: ${count} row(s) (>= ${expect})`);
  }
  const { data: notif } = await sb.from('notifications').select('id', { count: 'exact' });
  const { data: wallet } = await sb.from('organization_credits').select('free_balance').eq('organization_id', BETA.company.id).single();
  check((wallet?.free_balance || 0) >= BETA.credits.initialFree, `credits wallet free_balance = ${wallet?.free_balance}`);

  log(`\n=== verify ${failures ? failures + ' FAILURE(S) — FAIL' : 'ALL CHECKS PASSED'} ===`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
