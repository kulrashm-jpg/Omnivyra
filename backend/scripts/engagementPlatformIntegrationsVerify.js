/**
 * PHASE 1 — Verify Platform Integrations
 * Checks that the engagement pipeline has the prerequisites to ingest data.
 *
 * Pipeline needs:
 * 1. social_accounts (active) with tokens
 * 2. user_company_roles linking users to companies
 * 3. scheduled_posts: status=published, platform_post_id not null, social_account_id set
 * 4. Workers + cron running (enqueueEngagementPolling every 10 min)
 *
 * Run: node backend/scripts/engagementPlatformIntegrationsVerify.js
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('=== PHASE 1 — Verify Platform Integrations ===\n');
  console.log('Using Supabase REST API:', SUPABASE_URL.replace(/\/\/.*@/, '//***@'), '\n');

  try {
    // 1. social_accounts — active accounts by platform
    console.log('1. social_accounts (is_active = true):');
    const { data: accounts, error: e1 } = await supabase
      .from('social_accounts')
      .select('id, platform, user_id, is_active')
      .eq('is_active', true);

    if (e1) {
      console.log('   Error:', e1.message);
    } else {
      const byPlatform = (accounts || []).reduce((acc, a) => {
        const p = (a.platform || 'unknown').toLowerCase();
        acc[p] = (acc[p] || 0) + 1;
        return acc;
      }, {});
      const total = (accounts || []).length;
      console.log('   Total active:', total);
      if (Object.keys(byPlatform).length) {
        console.table(Object.entries(byPlatform).map(([platform, n]) => ({ platform, count: n })));
      } else {
        console.log('   ⚠️  No active social accounts — connect platforms first');
      }
    }

    // 2. user_company_roles — users linked to companies
    console.log('\n2. user_company_roles (status = active):');
    const { data: roles, error: e2 } = await supabase
      .from('user_company_roles')
      .select('user_id, company_id')
      .eq('status', 'active');

    if (e2) {
      console.log('   Error:', e2.message);
    } else {
      const byCompany = (roles || []).reduce((acc, r) => {
        acc[r.company_id] = (acc[r.company_id] || 0) + 1;
        return acc;
      }, {});
      const totalRoles = (roles || []).length;
      console.log('   Total active roles:', totalRoles);
      if (Object.keys(byCompany).length) {
        const rows = Object.entries(byCompany).slice(0, 10).map(([company_id, n]) => ({ company_id: company_id.slice(0, 8) + '…', users: n }));
        console.table(rows);
      }
    }

    // 3. Cross-check: users with social accounts who are in a company
    const accountUserIds = new Set((accounts || []).map((a) => a.user_id));
    const roleUserIds = new Set((roles || []).map((r) => r.user_id));
    const linkedUsers = [...accountUserIds].filter((uid) => roleUserIds.has(uid)).length;
    console.log('\n   Users with BOTH social account AND company role:', linkedUsers);
    if (linkedUsers === 0 && (accounts || []).length > 0) {
      console.log('   ⚠️  Social accounts exist but users have no company role — add users to companies');
    }

    // 4. scheduled_posts — breakdown
    console.log('\n3. scheduled_posts:');
    const { count: totalPosts } = await supabase.from('scheduled_posts').select('*', { count: 'exact', head: true });
    const { count: publishedCount } = await supabase
      .from('scheduled_posts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'published');
    const { count: withPlatformPostId } = await supabase
      .from('scheduled_posts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'published')
      .not('platform_post_id', 'is', null);
    const { count: withSocialAccount } = await supabase
      .from('scheduled_posts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'published')
      .not('platform_post_id', 'is', null)
      .not('social_account_id', 'is', null);

    console.log('   Total posts:', totalPosts ?? 0);
    console.log('   Published (status=published):', publishedCount ?? 0);
    console.log('   Published + platform_post_id:', withPlatformPostId ?? 0, '← ingestion candidates');
    console.log('   Published + platform_post_id + social_account_id:', withSocialAccount ?? 0, '← token available');

    if ((withSocialAccount ?? 0) === 0) {
      console.log('   ⚠️  No ingestion candidates — need posts that:');
      console.log('      • status = published');
      console.log('      • platform_post_id set (after publish to platform)');
      console.log('      • social_account_id set (linked to OAuth account)');
    }

    // 5. Sample published posts (for debugging)
    const { data: samplePosts } = await supabase
      .from('scheduled_posts')
      .select('id, platform, status, platform_post_id, social_account_id, campaign_id, published_at')
      .eq('status', 'published')
      .limit(5);

    if ((samplePosts || []).length > 0) {
      console.log('\n4. Sample published posts:');
      console.table(
        (samplePosts || []).map((p) => ({
          id: p.id?.slice(0, 8) + '…',
          platform: p.platform,
          platform_post_id: p.platform_post_id ? 'yes' : 'NO',
          social_account_id: p.social_account_id ? 'yes' : 'NO',
        }))
      );
    }

    // Root cause summary
    console.log('\n=== INTEGRATION HEALTH ===');
    const hasAccounts = (accounts || []).length > 0;
    const hasRoles = (roles || []).length > 0;
    const hasCandidates = (withSocialAccount ?? 0) > 0;

    if (!hasAccounts) {
      console.log('BLOCKER: No active social_accounts. Connect platforms via OAuth.');
    } else if (!hasRoles) {
      console.log('BLOCKER: No user_company_roles. Add users to companies.');
    } else if (linkedUsers === 0) {
      console.log('BLOCKER: Users with social accounts are not in any company. Link them.');
    } else if (!hasCandidates) {
      console.log('BLOCKER: No published posts with platform_post_id and social_account_id.');
      console.log('   → Publish content to a platform first (creates platform_post_id).');
      console.log('   → Ensure posts have social_account_id (set when scheduling).');
    } else {
      console.log('OK: Integrations and ingestion candidates present.');
      console.log('   → Ensure workers are running: npm run start:workers');
      console.log('   → Cron will enqueue engagement polling every 10 min.');
    }

    console.log('\n=== Phase 1 complete ===');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

run();
