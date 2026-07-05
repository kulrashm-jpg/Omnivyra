/**
 * BETA-022 RULE 6 — Deterministic reset / cleanup.
 *
 * Removes every row the beta seed creates (by fixed id, child-first) plus the 5 beta
 * auth users and their public.users rows. Safe to run repeatedly; leaves the schema and
 * all non-beta data untouched. `seed-beta.mjs` calls this first for perfect idempotency.
 *
 *   node scripts/beta/reset-beta.mjs
 */
import { serviceClient, betaEnv, log, ok, warn } from './beta-client.mjs';
import { BETA, BETA_IDS, BETA_EMAILS } from './beta-fixtures.mjs';

// child-first delete order (respects FKs)
const BY_ID = [
  'engagement_messages', 'engagement_threads',
  'active_leads', 'active_lead_runs',
  'scheduled_posts', 'creator_assets', 'content_items',
  'notifications',
  'free_credit_claims', 'organization_credits',
  'reports', 'user_company_roles', 'campaign_versions', 'campaigns',
];
// NOTE: credit_transactions is an immutable, append-only ledger (a DB trigger blocks
// DELETE/UPDATE). It is intentionally NOT reset — the single fixed grant row is inserted
// idempotently by the seed and persists across re-seeds. The visible balance comes from
// the mutable organization_credits wallet, which IS reset each run.

export async function resetBeta(sb = serviceClient()) {
  betaEnv(); // guards prod
  log('· Resetting beta datasets…');

  for (const table of BY_ID) {
    const ids = BETA_IDS[table] || [];
    if (!ids.length) continue;
    const { error } = await sb.from(table).delete().in('id', ids);
    if (error) warn(`${table}: ${error.message}`);
  }

  // rows without individually-tracked ids → delete by company/website scope
  for (const [table, col, val] of [
    ['website_analytics_daily', 'company_id', BETA.company.id],
    ['website_health_scores', 'company_id', BETA.company.id],
    ['company_profiles', 'company_id', BETA.company.id],
    ['social_accounts', 'company_id', BETA.company.id],
    ['websites', 'id', BETA.website.id],
  ]) {
    const q = sb.from(table).delete();
    const { error } = await (col === 'id' ? q.eq('id', val) : q.eq(col, val));
    if (error) warn(`${table}: ${error.message}`);
  }

  // public.users (by email) — must go before companies so nothing dangles
  const { error: uErr } = await sb.from('users').delete().in('email', BETA_EMAILS);
  if (uErr) warn(`users: ${uErr.message}`);

  // company last
  const { error: cErr } = await sb.from('companies').delete().eq('id', BETA.company.id);
  if (cErr) warn(`companies: ${cErr.message}`);

  // auth users (paginate, delete by email)
  let deleted = 0;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { warn(`auth listUsers: ${error.message}`); break; }
    const batch = (data?.users || []).filter((u) => BETA_EMAILS.includes(u.email));
    for (const u of batch) {
      const { error: dErr } = await sb.auth.admin.deleteUser(u.id);
      if (!dErr) deleted++;
    }
    if (!data?.users || data.users.length < 200) break;
  }
  ok(`reset complete (auth users removed: ${deleted})`);
}

// run directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('reset-beta.mjs')) {
  resetBeta().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
