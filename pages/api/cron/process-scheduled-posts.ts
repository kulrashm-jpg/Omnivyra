import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

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
import { bearerTokenMatches } from '../../../backend/security/constantTimeEqual';
import { authorizePostPublish } from '../../../lib/campaign/publishAuthorization';

const BATCH_SIZE = 20; // Max posts to process per invocation
// A refused post stays 'scheduled' and due, so it comes back on every run. The
// read must look past refused rows or the oldest 20 would hold the batch forever.
const DUE_SCAN_LIMIT = 500;

type DuePost = {
  id: string;
  user_id: string;
  social_account_id: string | null;
  platform: string;
  campaign_id: string | null;
  status: string;
  content: string | null;
  // Supabase JS types FK joins as arrays even when the FK is single-valued.
  // Use the [0] element if present.
  social_accounts: Array<{ company_id: string | null }> | { company_id: string | null } | null;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: cron host sets Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[cron/process-scheduled-posts] CRON_SECRET not configured; rejecting request to fail closed');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const triggeredByCronSecret = bearerTokenMatches(req.headers['authorization'], cronSecret);
  if (!triggeredByCronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date().toISOString();
  const results = {
    processed: 0,
    published: 0,
    failed: 0,
    skipped: 0,
    skipped_tenant_invalid: 0,
    skipped_unauthorized: 0,
    errors: [] as string[],
  };

  try {
    // Fetch due posts WITH their social account's owning org id so we can
    // bind tenant context per-post. The join uses the social_accounts
    // FK on scheduled_posts.social_account_id; posts with no resolved
    // social_account fall through to the per-post lookup below.
    const { data: duePosts, error: fetchErr } = await supabase
      .from('scheduled_posts')
      .select('id, user_id, social_account_id, platform, campaign_id, status, content, social_accounts(company_id)')
      .eq('status', 'scheduled')
      .lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true })
      .limit(DUE_SCAN_LIMIT);

    if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);
    if (!duePosts?.length) {
      return res.status(200).json({ ...results, message: 'No due posts' });
    }

    // ONE authorization predicate, shared with the publish worker and the
    // scheduler. publishNow deliberately does not evaluate it (authorization
    // stays at the route/worker layer), so without this a post on a paused
    // campaign reaches the platform from here alone.
    //
    // Same refusal as the scheduler: log and skip, and write nothing. The row
    // stays 'scheduled' with no queue job and no error, so it is neither failed
    // nor retried; each run only re-reads it, and it publishes once the campaign
    // is active again. A failed lookup fails the run before anything is written,
    // also as the scheduler does: the posts are still due next run.
    const campaignIds = [...new Set(
      (duePosts as unknown as DuePost[]).map((p) => p.campaign_id).filter((id): id is string => Boolean(id)),
    )];
    const campaignStatusById = new Map<string, string>();
    if (campaignIds.length > 0) {
      const { data: campaignRows, error: campaignsError } = await supabase
        .from('campaigns')
        .select('id, status')
        .in('id', campaignIds);
      if (campaignsError) throw new Error(`Failed to query campaigns: ${campaignsError.message}`);
      for (const row of (campaignRows ?? []) as Array<{ id: string; status: string | null }>) {
        campaignStatusById.set(row.id, String(row.status ?? ''));
      }
    }

    const eligiblePosts: DuePost[] = [];
    for (const post of duePosts as unknown as DuePost[]) {
      const authorization = authorizePostPublish({
        campaign_id: post.campaign_id,
        campaign_status: post.campaign_id ? (campaignStatusById.get(post.campaign_id) ?? null) : null,
        post_status: post.status,
        // publishNow's own short-circuit handles this; not selected here.
        platform_post_id: null,
        has_content: Boolean(post.content && String(post.content).trim().length > 0),
      });
      if (!authorization.authorized) {
        console.warn({
          campaign_id: post.campaign_id,
          scheduled_post_id: post.id,
          reason: authorization.code,
        });
        results.skipped_unauthorized++;
        continue;
      }
      eligiblePosts.push(post);
    }
    if (duePosts.length === DUE_SCAN_LIMIT && eligiblePosts.length < BATCH_SIZE) {
      console.warn(`[cron/process-scheduled-posts] read the ${DUE_SCAN_LIMIT}-row limit and found only ${eligiblePosts.length} authorized; later due posts were not considered this run`);
    }

    const batch = eligiblePosts.slice(0, BATCH_SIZE);
    results.processed = batch.length;

    for (const post of batch) {
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
        // CLASS-2 D8: every write here names the status it expects. The scan read `scheduled`; the
        // queue worker may have claimed the post since, and a blind `failed` flipped its live claim.
        await updatePostPublishStatus({
          post_id: post.id,
          status: 'FAILED',
          last_error: `No connected ${post.platform} account`,
          expectedFromStatus: 'scheduled',
        });
        results.skipped++;
        continue;
      }

      // Patch post row with resolved account if it was missing.
      if (!post.social_account_id) {
        await supabase
          .from('scheduled_posts')
          .update({ social_account_id: socialAccountId })
          .eq('id', post.id)
          .eq('status', 'scheduled');
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
          expectedFromStatus: 'scheduled',
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
          // publishNow threw: it restores the pre-claim status (`scheduled`) when nothing was sent, and
          // records an uncertain outcome itself when the call had started. Only the restored row is
          // this cron's to fail; any other state belongs to another execution or to reconciliation.
          await updatePostPublishStatus({
            post_id: post.id,
            status: 'FAILED',
            last_error: msg || 'Unexpected error',
            expectedFromStatus: 'scheduled',
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
      // Another execution holds this post's publish claim and owns its
      // outcome. Writing 'failed' here would overwrite the holder's live
      // 'publishing' row (or its 'published'), so nothing is written.
      if (result.suppressed) {
        results.skipped++;
        continue;
      }
      // A mirror of what publishNow already wrote, so it lands only on that status: once `failed`
      // the post is claimable, and another execution may hold it already.
      await updatePostPublishStatus({
        post_id:          post.id,
        status:           result.status,
        external_post_id: result.external_post_id,
        last_error:       result.status === 'PUBLISHED' ? undefined : result.message,
        expectedFromStatus: result.status.toLowerCase(),
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/process-scheduled-posts' });
