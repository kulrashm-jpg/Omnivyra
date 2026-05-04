/**
 * Validation script for Meta integrations.
 *
 * Run: npx ts-node backend/scripts/validateMetaIntegrations.ts
 *
 * Checks every tenant's Meta state:
 *   - IG rows have a 17-digit IG business id (not a FB user id)
 *   - Facebook rows have page_access_token set (or are inactive)
 *   - Threads rows have linked_page_id + linked_ig_business_id
 *   - No row's token_expires_at is in the past
 *   - meta_oauth_connections.token_expires_at not expired
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

type Row = {
  id: string;
  user_id: string;
  company_id: string | null;
  platform: string;
  platform_user_id: string;
  account_name: string;
  is_active: boolean;
  is_system_user: boolean | null;
  meta_connection_id: string | null;
  page_access_token: string | null;
  ig_user_token: string | null;
  threads_token: string | null;
  linked_page_id: string | null;
  linked_ig_business_id: string | null;
  token_expires_at: string | null;
};

type ConnRow = {
  id: string;
  user_id: string;
  company_id: string;
  fb_user_id: string;
  token_expires_at: string;
  refresh_failed_at: string | null;
  refresh_error: string | null;
};

type Issue = {
  scope: 'connection' | 'social_account';
  id: string;
  tenant: string | null;
  user: string;
  platform?: string;
  problem: string;
};

const IG_BUSINESS_ID_RE = /^17\d{15}$/;

async function main() {
  const issues: Issue[] = [];
  const summary: Record<string, number> = {
    connections_total: 0,
    connections_expired: 0,
    connections_refresh_failed: 0,
    rows_total: 0,
    rows_inactive: 0,
    rows_expired: 0,
    facebook_missing_page_token: 0,
    instagram_wrong_id: 0,
    instagram_missing_link: 0,
    threads_missing_link: 0,
    rows_no_meta_connection: 0,
  };

  const { data: connections, error: connErr } = await supabase
    .from('meta_oauth_connections')
    .select('id, user_id, company_id, fb_user_id, token_expires_at, refresh_failed_at, refresh_error');
  if (connErr) {
    console.error('Failed to read meta_oauth_connections:', connErr.message);
    process.exit(2);
  }

  for (const c of (connections ?? []) as ConnRow[]) {
    summary.connections_total++;
    if (new Date(c.token_expires_at).getTime() < Date.now()) {
      summary.connections_expired++;
      issues.push({
        scope: 'connection',
        id: c.id,
        tenant: c.company_id,
        user: c.user_id,
        problem: `connection token expired at ${c.token_expires_at}`,
      });
    }
    if (c.refresh_failed_at) {
      summary.connections_refresh_failed++;
      issues.push({
        scope: 'connection',
        id: c.id,
        tenant: c.company_id,
        user: c.user_id,
        problem: `refresh failing since ${c.refresh_failed_at}: ${c.refresh_error ?? '(no error)'}`,
      });
    }
  }

  const { data: rows, error: rowErr } = await supabase
    .from('social_accounts')
    .select(
      'id, user_id, company_id, platform, platform_user_id, account_name, is_active, is_system_user, meta_connection_id, page_access_token, ig_user_token, threads_token, linked_page_id, linked_ig_business_id, token_expires_at',
    )
    .in('platform', ['facebook', 'instagram', 'threads']);

  if (rowErr) {
    console.error('Failed to read social_accounts:', rowErr.message);
    process.exit(2);
  }

  for (const r of (rows ?? []) as Row[]) {
    summary.rows_total++;
    if (!r.is_active) summary.rows_inactive++;
    if (r.token_expires_at && new Date(r.token_expires_at).getTime() < Date.now()) {
      summary.rows_expired++;
      issues.push({
        scope: 'social_account',
        id: r.id,
        tenant: r.company_id,
        user: r.user_id,
        platform: r.platform,
        problem: `token_expires_at ${r.token_expires_at} is in the past`,
      });
    }
    if (!r.is_system_user && !r.meta_connection_id) {
      summary.rows_no_meta_connection++;
      issues.push({
        scope: 'social_account',
        id: r.id,
        tenant: r.company_id,
        user: r.user_id,
        platform: r.platform,
        problem: 'meta_connection_id is null (not linked to a parent OAuth connection)',
      });
    }

    if (r.platform === 'facebook') {
      if (r.is_active && !r.is_system_user && !r.page_access_token) {
        summary.facebook_missing_page_token++;
        issues.push({
          scope: 'social_account',
          id: r.id,
          tenant: r.company_id,
          user: r.user_id,
          platform: 'facebook',
          problem: 'active facebook row has no page_access_token',
        });
      }
    }

    if (r.platform === 'instagram') {
      if (r.is_active && !IG_BUSINESS_ID_RE.test(r.platform_user_id)) {
        summary.instagram_wrong_id++;
        issues.push({
          scope: 'social_account',
          id: r.id,
          tenant: r.company_id,
          user: r.user_id,
          platform: 'instagram',
          problem: `platform_user_id "${r.platform_user_id}" does not match IG Business Account format`,
        });
      }
      if (r.is_active && !r.linked_page_id) {
        summary.instagram_missing_link++;
        issues.push({
          scope: 'social_account',
          id: r.id,
          tenant: r.company_id,
          user: r.user_id,
          platform: 'instagram',
          problem: 'instagram row missing linked_page_id',
        });
      }
    }

    if (r.platform === 'threads') {
      if (r.is_active && (!r.linked_page_id || !r.linked_ig_business_id)) {
        summary.threads_missing_link++;
        issues.push({
          scope: 'social_account',
          id: r.id,
          tenant: r.company_id,
          user: r.user_id,
          platform: 'threads',
          problem: 'threads row missing linked_page_id or linked_ig_business_id',
        });
      }
    }
  }

  console.log('=== meta integration validation ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nIssues found: ${issues.length}`);
  for (const issue of issues) {
    console.log(
      `[${issue.scope}] ${issue.platform ?? ''} id=${issue.id} tenant=${issue.tenant ?? 'null'} user=${issue.user} :: ${issue.problem}`,
    );
  }
  process.exit(issues.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('validateMetaIntegrations crashed:', err);
  process.exit(2);
});
