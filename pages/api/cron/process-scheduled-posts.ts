
/**
 * POST /api/cron/process-scheduled-posts
 *
 * Cron endpoint — called every minute. Finds all scheduled posts whose
 * scheduled_for time has passed, resolves their social account, and
 * publishes them via publishNow.
 *
 * Tenant containment: each post is wrapped in `runJob` with the owning
 * organizationId resolved from social_accounts.company_id. The canonical
 * tenant guard rejects soft-deleted / suspended orgs BEFORE any platform
 * call. Posts whose owning org is invalid are marked FAILED with a
 * terminal classification so the loop doesn't retry forever.
 *
 * Protected by CRON_SECRET env var (set in your cron host).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { publishNow } from '../../../backend/services/publishNowService';
import { updatePostPublishStatus } from '../../../backend/db/scheduledPostsStore';
import { runJob } from '../../../backend/services/jobRunner';

const BATCH_SIZE = 20; // Max posts to process per invocation

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: cron host sets Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  const triggeredByCronSecret = !!cronSecret && req.headers['authorization'] === `Bearer ${cronSecret}`;
  if (cronSecret && !triggeredByCronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date().toISOString();
  const results = {
    processed: 0,
    published: 0,
    failed: 0,
    skipped: 0,
    skipped_tenant_invalid: 0,
    errors: [] as string[],
  };

  try {
    // Fetch due posts WITH their social account's owning org id so we can
    // bind tenant context per-post. The join uses the social_accounts
    // FK on scheduled_posts.social_account_id; posts with no resolved
    // social_account fall through to the per-post lookup below.
    const { data: duePosts, error: fetchErr } = await supabase
      .from('scheduled_posts')
      .select('id, user_id, social_account_id, platform, campaign_id, status, social_accounts(company_id)')
      .eq('status', 'scheduled')
      .lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);
    if (!duePosts?.length) {
      return res.status(200).json({ ...results, message: 'No due posts' });
    }

    results.processed = duePosts.length;

    for (const post of duePosts as unknown as Array<{
      id: string;
      user_id: string;
      social_account_id: string | null;
      platform: string;
      campaign_id: string | null;
      status: string;
      // Supabase JS types FK joins as arrays even when the FK is single-valued.
      // Use the [0] element if present.
      social_accounts: Array<{ company_id: string | null }> | { company_id: string | null } | null;
    }>) {
      const joinedAccts = Array.isArray(post.social_accounts)
        ? post.social_accounts
        : post.social_accounts ? [post.social_accounts] : [];
      // Resolve social account first so we can derive tenantId.
      let socialAccountId: string | null = post.social_account_id || null;
      let resolvedOrgId: string | null = joinedAccts[0]?.company_id ?? null;

      if (!socialAccountId) {
        const platformNorm = post.platform === 'x' ? 'twitter' : post.platform;
        const { data: acct } = await supabase
          .from('social_accounts')
          .select('id, company_id')
          .eq('user_id', post.user_id)
          .eq('is_active', true)
          .in('platform', [post.platform, platformNorm])
          .limit(1)
          .maybeSingle();
        socialAccountId = acct?.id ?? null;
        resolvedOrgId = (acct?.company_id as string | undefined) ?? null;
      }

      if (!socialAccountId) {
        // No connected account — terminal classification, do not retry.
        await updatePostPublishStatus({
          post_id: post.id,
          status: 'FAILED',
          last_error: `No connected ${post.platform} account`,
        });
        results.skipped++;
        continue;
      }

      // Patch post row with resolved account if it was missing.
      if (!post.social_account_id) {
        await supabase
          .from('scheduled_posts')
          .update({ social_account_id: socialAccountId })
          .eq('id', post.id);
      }

      // Per-post runJob with tenant containment. The runner rejects
      // soft-deleted orgs BEFORE the publishNow call lands on the
      // platform. The idempotency key is derived from the post id so a
      // re-delivery within the same minute collapses to one execution.
      const minuteBucket = Math.floor(Date.now() / 60_000);
      const outcome = await runJob(
        {
          jobName:        'cron:process-scheduled-posts',
          triggerSource:  triggeredByCronSecret ? 'cron' : 'admin',
          tenantId:       resolvedOrgId,
          principalUserId: post.user_id,
          principalKind:  triggeredByCronSecret ? 'cron-secret' : 'super-admin',
          idempotencyKey: `cron:process-scheduled-posts:${post.id}:${minuteBucket}`,
          payload:        { post_id: post.id, social_account_id: socialAccountId },
          // Match publishProcessor's per-tenant cap so cron-driven and
          // queue-driven publishes share the same governor scope. The
          // key is identical so a tenant's 5-concurrent-publish limit
          // is global across both code paths, not per-path.
          concurrency: resolvedOrgId
            ? {
                key:                 `tenant:${resolvedOrgId}:queue:publish`,
                max:                 5,
                maxPerSecond:        30,
                maxRetriesPerMinute: 60,
              }
            : undefined,
        },
        async () => publishNow({
          scheduled_post_id: post.id,
          social_account_id: socialAccountId!,
          user_id:           post.user_id,
        }),
      );

      if (outcome.status === 'tenant_invalid') {
        // Owning org is gone or suspended — mark FAILED with terminal
        // classification so the cron doesn't keep retrying this post.
        await updatePostPublishStatus({
          post_id: post.id,
          status: 'FAILED',
          last_error: `Tenant invalid: ${outcome.reason}`,
        });
        results.skipped_tenant_invalid++;
        results.errors.push(`[${post.id}] tenant_invalid: ${outcome.reason}`);
        continue;
      }

      if (outcome.status === 'dead_letter_skip') {
        // Operator must explicitly replay. Don't re-execute.
        results.skipped++;
        continue;
      }

      if (outcome.status === 'failed') {
        results.failed++;
        const msg = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
        results.errors.push(`[${post.id}] ${msg}`);
        try {
          await updatePostPublishStatus({
            post_id: post.id,
            status: 'FAILED',
            last_error: msg || 'Unexpected error',
          });
        } catch (_) { /* fail-soft */ }
        continue;
      }

      if (outcome.status === 'pressure_rejected') {
        // Governor refused — back off and let the next cron tick retry.
        // Don't mark FAILED (the post is still publishable next minute).
        results.skipped++;
        results.errors.push(`[${post.id}] pressure_rejected: ${outcome.reason} key=${outcome.key}`);
        continue;
      }

      const result = outcome.result;
      await updatePostPublishStatus({
        post_id:          post.id,
        status:           result.status,
        external_post_id: result.external_post_id,
        last_error:       result.status === 'PUBLISHED' ? undefined : result.message,
      });

      if (result.status === 'PUBLISHED') {
        results.published++;
      } else {
        results.failed++;
        if (result.message) results.errors.push(`[${post.id}] ${result.message}`);
      }
    }

    console.log('[cron/process-scheduled-posts]', results);
    return res.status(200).json(results);
  } catch (err: any) {
    console.error('[cron/process-scheduled-posts] fatal:', err?.message);
    return res.status(500).json({ error: err?.message });
  }
}
