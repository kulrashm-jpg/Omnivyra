/**
 * Engagement Polling Job Processor
 *
 * Selects recently published posts (last 30 days), calls ingestComments for
 * each. One failure does not stop the loop; summary returned.
 * No evaluation/action/notification changes — ingestion only.
 *
 * Tenant containment: posts are joined to their owning organization via
 * social_accounts.company_id. Each per-org batch is wrapped in `runJob`
 * so the canonical tenant guard rejects soft-deleted / suspended orgs
 * BEFORE any per-post ingestion runs. Posts whose owning org is invalid
 * are skipped (counted in `posts_skipped_tenant_invalid`).
 */

import { supabase } from '../../db/supabaseClient';
import { ingestComments } from '../../services/engagementIngestionService';
import { runJob } from '../../services/jobRunner';

const BATCH_SIZE = 50;
const PUBLISHED_WITHIN_DAYS = 30;

export type EngagementPollingResult = {
  total_processed: number;
  total_ingested_comments: number;
  failures_count: number;
  posts_skipped_tenant_invalid: number;
  orgs_scanned: number;
};

interface PostWithOrg {
  id: string;
  // Supabase JS types FK joins as arrays even when the FK is single-valued.
  social_accounts:
    | Array<{ company_id: string | null }>
    | { company_id: string | null }
    | null;
}

/**
 * Process one engagement polling job: select published posts, ingest comments
 * for each. Per-org batches run inside runJob so cross-tenant ingestion is
 * impossible — a post whose owning org is soft-deleted is skipped, not
 * silently ingested.
 */
export async function processEngagementPollingJob(): Promise<EngagementPollingResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - PUBLISHED_WITHIN_DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  // Pull posts WITH their owning org id (resolved via social_accounts FK)
  // so we can group + tenant-validate before ingesting.
  const { data: posts, error } = await supabase
    .from('scheduled_posts')
    .select('id, social_accounts(company_id)')
    .eq('status', 'published')
    .not('platform_post_id', 'is', null)
    .gte('published_at', cutoffIso)
    .order('published_at', { ascending: false })
    .limit(BATCH_SIZE);

  if (error) {
    console.error('[engagementPolling] Query error:', error.message);
    throw new Error(`Failed to query scheduled_posts: ${error.message}`);
  }

  const list = (posts ?? []) as unknown as PostWithOrg[];

  // Group by owning org so each tenant's batch runs under one runJob
  // execution. Posts with no resolvable org go into a synthetic '__orphan'
  // bucket and are reported as tenant_invalid.
  const byOrg = new Map<string, string[]>();
  for (const post of list) {
    const joined = Array.isArray(post.social_accounts)
      ? post.social_accounts
      : post.social_accounts ? [post.social_accounts] : [];
    const orgId = joined[0]?.company_id ?? null;
    const key = orgId ?? '__orphan';
    const bucket = byOrg.get(key) ?? [];
    bucket.push(post.id);
    byOrg.set(key, bucket);
  }

  let totalIngested = 0;
  let failuresCount = 0;
  let postsSkippedTenantInvalid = 0;

  // Time-bucket idempotency key — within the same hour, the same org's
  // batch collapses (BullMQ at-least-once delivery + cron overlaps).
  const hourBucket = Math.floor(Date.now() / 3_600_000);

  for (const [orgId, postIds] of byOrg.entries()) {
    if (orgId === '__orphan') {
      postsSkippedTenantInvalid += postIds.length;
      console.warn(`[engagementPolling] skipped ${postIds.length} posts with no resolvable org`);
      continue;
    }

    const outcome = await runJob(
      {
        jobName:        'queue:engagement-polling',
        triggerSource:  'queue',
        tenantId:       orgId,
        principalKind:  'queue:engagement-polling',
        idempotencyKey: `queue:engagement-polling:${orgId}:${hourBucket}`,
        retryOwner:     'external', // BullMQ owns retry on the outer job
        // One engagement poll per org at a time. The hourly idempotency
        // bucket already collapses replays; the concurrency cap stops
        // overlapping deliveries (BullMQ at-least-once + cron retrigger)
        // from racing on the same per-post external API calls.
        concurrency: {
          key:                 `tenant:${orgId}:queue:engagement-polling`,
          max:                 1,
          maxPerSecond:        10,
          maxRetriesPerMinute: 12,
        },
      },
      async () => {
        let ingested = 0;
        let failures = 0;
        for (const postId of postIds) {
          try {
            const result = await ingestComments(postId);
            if (result.success) {
              ingested += result.ingested;
            } else {
              failures += 1;
              console.warn(`[engagementPolling] ingest failed for ${postId}:`, result.error);
            }
          } catch (e) {
            failures += 1;
            console.warn(`[engagementPolling] ingest error for ${postId}:`, (e as Error)?.message);
          }
        }
        return { ingested, failures };
      },
    );

    if (outcome.status === 'completed') {
      totalIngested += outcome.result.ingested;
      failuresCount += outcome.result.failures;
    } else if (outcome.status === 'tenant_invalid') {
      postsSkippedTenantInvalid += postIds.length;
      console.warn(
        `[engagementPolling] tenant_invalid for org=${orgId}; skipped ${postIds.length} posts; reason=${outcome.reason}`,
      );
    } else {
      // failed / dead_letter_skip — count this org's posts as failures.
      failuresCount += postIds.length;
      console.error(
        `[engagementPolling] runJob ${outcome.status} for org=${orgId}; reason=${
          'reason' in outcome ? outcome.reason : (outcome.error as Error)?.message ?? 'unknown'
        }`,
      );
    }
  }

  const summary: EngagementPollingResult = {
    total_processed:               list.length,
    total_ingested_comments:       totalIngested,
    failures_count:                failuresCount,
    posts_skipped_tenant_invalid:  postsSkippedTenantInvalid,
    orgs_scanned:                  byOrg.size - (byOrg.has('__orphan') ? 1 : 0),
  };

  console.log(
    `[engagementPolling] total_processed=${summary.total_processed} total_ingested_comments=${summary.total_ingested_comments} failures_count=${summary.failures_count} skipped_tenant_invalid=${summary.posts_skipped_tenant_invalid} orgs_scanned=${summary.orgs_scanned}`,
  );

  return summary;
}
