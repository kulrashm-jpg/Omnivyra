import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isSuperAdmin } from '../../../backend/services/rbacService';
import { getScheduledPost } from '../../../backend/db/queries';
import { updatePostPublishStatus } from '../../../backend/db/scheduledPostsStore';
import { publishNow } from '../../../backend/services/publishNowService';
import { authorizePostPublish } from '../../../lib/campaign/publishAuthorization';
import { supabase } from '../../../backend/db/supabaseClient';
import { resolveEngagementCapability } from '../../../backend/services/engagementCapabilityMap';
import { logAuditEvent } from '../../../backend/services/auditLoggingService';
import {
  validatePublishReadiness,
  assertMediaAccessible,
} from '../../../backend/services/publishReadinessValidator';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { post_id, dry_run } = req.body || {};
  if (!post_id) {
    return res.status(400).json({ error: 'post_id is required' });
  }

  try {
    const post = await getScheduledPost(post_id);
    if (!post) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }

    // NB: creator asset re-resolution + media-snapshot refresh now happens inside
    // publishNow() (the shared async-worker path), so it covers this sync publish-now
    // call AND the cron/queue workers from one place — no duplication here.

    const capability = resolveEngagementCapability(post.platform, 'post_create');
    if (capability.status !== 'api_verified') {
      void logAuditEvent({
        operation: 'INSERT',
        table: 'social_publish_rejected',
        companyId: post.user_id ?? 'unknown',
        userId: user.id,
        success: false,
        errorMessage: capability.reason ?? 'Unsupported action',
        metadata: {
          platform: post.platform,
          action: 'post_create',
          code: 'ACTION_NOT_SUPPORTED',
          post_id,
        },
      }).catch(() => {});
      return res.status(400).json({
        error: capability.reason ?? `Publishing is not supported on ${post.platform}.`,
        code: 'ACTION_NOT_SUPPORTED',
        platform: post.platform,
        action: 'post_create',
      });
    }

    // Hard validation: platform × content-capability compatibility. Runs
    // before account resolution so we never trigger a refresh / DB write on
    // a publish that will be rejected (e.g. Instagram + text-only post).
    // Centralized publish-readiness gate (Round-3 item 1+7). Composes the
    // registry validator + adapter-reality enforcement (LinkedIn/X media
    // strip, Threads no-path, TikTok finalize guard) + canonical state —
    // no duplicate validation logic. Mode-gated via PUBLISH_GUARD_MODE.
    // skipSchedulingReadiness: this is a manual publish-now, so we gate on
    // capability/adapter-reality/media, not on canonical scheduling state.
    const readiness = validatePublishReadiness({
      platform: post.platform,
      contentSignals: { contentType: post.content_type },
      hasText: !!(post.content && post.content.trim().length > 0),
      mediaUrls: post.media_urls ?? [],
      skipSchedulingReadiness: true,
    });
    if (readiness.ok === false) {
      void logAuditEvent({
        operation: 'INSERT',
        table: 'social_publish_rejected',
        companyId: post.user_id ?? 'unknown',
        userId: user.id,
        success: false,
        errorMessage: readiness.message,
        metadata: {
          platform: (readiness.context?.platform as string) ?? post.platform,
          code: readiness.code,
          post_id,
        },
      }).catch(() => {});
      // Preserve the existing 400 response shape (error/code/platform);
      // `capability` retained for back-compat when present in context.
      return res.status(400).json({
        error: readiness.message,
        code: readiness.code,
        platform: (readiness.context?.platform as string) ?? post.platform,
        capability: (readiness.context?.capability as string) ?? null,
      });
    }
    // Non-fatal warnings (e.g. TIKTOK_FINALIZE_UNCONFIRMED) surfaced
    // separately — already throttle-logged inside the validator.
    const publishWarnings = readiness.warnings.map((w) => ({ code: w.code, message: w.message }));

    // Asset accessibility — catch expired signed URLs before the adapter
    // (flag-gated; default on). Best-effort; only a confirmed dead asset blocks.
    if (
      String(process.env.PUBLISH_MEDIA_ACCESSIBILITY_CHECK ?? '1') !== '0' &&
      Array.isArray(post.media_urls) && post.media_urls.length > 0
    ) {
      const dead = await assertMediaAccessible(post.media_urls);
      if (dead) {
        void logAuditEvent({
          operation: 'INSERT', table: 'social_publish_rejected',
          companyId: post.user_id ?? 'unknown', userId: user.id, success: false,
          errorMessage: dead.message,
          metadata: { code: dead.code, post_id, platform: post.platform },
        }).catch(() => {});
        return res.status(400).json({ error: dead.message, code: dead.code, platform: post.platform });
      }
    }

    // Allow: post owner OR super-admin
    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin && post.user_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden: you do not own this post' });
    }

    // ── R6-B — publish authorization, converged with the scheduled path ─────
    //
    // Ownership (above) answers "is this your post". This answers "may this
    // post be published at all" — the question the canonical queue path has
    // always asked and this route never did. Before R6-B it validated
    // capability and media but read neither `status` nor `campaign_id`, so a
    // campaign post could be published straight past the release decision the
    // CMO made in the planner (P1/B1).
    //
    // The predicate is REUSED, not reproduced: authorizePostPublish already
    // encodes the campaign-linked vs standalone split — a post with no
    // campaign_id skips the campaign gate by design, so standalone publishing
    // keeps working (PromotionWorkspace and the multi-platform scheduler both
    // stage `status='scheduled'`, `campaign_id=null` rows, which stay
    // authorized). `failed` remains releasable so manual retry still works.
    //
    // ORDER: after ownership, so a non-owner still gets the plain 403 and
    // learns nothing about campaign or release state; and before the
    // social-account patch below, so a denied request performs no write.
    //
    // Idempotency precedes authorization, exactly as it does in
    // publishProcessor (its Step-2 platform_post_id short-circuit runs before
    // Step-3 authorization): an already-published single-row post keeps its
    // existing idempotent 200 rather than being re-judged by a release gate it
    // has legitimately moved past. Thread roots are excluded from that skip —
    // publishNow's own short-circuit exempts them too, because a published
    // root may still have unpublished children.
    const alreadyPublishedSingleRow =
      typeof post.platform_post_id === 'string' &&
      post.platform_post_id.trim().length > 0 &&
      post.is_thread_start !== true;

    if (!alreadyPublishedSingleRow) {
      // Same lookup semantics as publishProcessor.ts: a missing or unreadable
      // campaign leaves the status null ⇒ not active ⇒ denied. Fail closed.
      let campaignStatus: string | null = null;
      if (post.campaign_id) {
        const { data: campaignRow, error: campaignError } = await supabase
          .from('campaigns')
          .select('status')
          .eq('id', post.campaign_id)
          .single();
        campaignStatus =
          campaignError || !campaignRow ? null : ((campaignRow as { status?: string }).status ?? null);
      }

      const authorization = authorizePostPublish({
        campaign_id: post.campaign_id,
        campaign_status: campaignStatus,
        post_status: (post as { status?: string | null }).status ?? null,
        // Handled by the short-circuit above; passing it here would
        // double-report the same condition (mirrors publishProcessor).
        platform_post_id: null,
        is_thread_start: post.is_thread_start === true,
        has_content: Boolean(post.content && String(post.content).trim().length > 0),
      });

      if (!authorization.authorized) {
        void logAuditEvent({
          operation: 'INSERT',
          table: 'social_publish_rejected',
          companyId: post.user_id ?? 'unknown',
          userId: user.id,
          success: false,
          errorMessage: authorization.reason,
          metadata: {
            platform: post.platform,
            code: authorization.code,
            post_id,
            campaign_id: post.campaign_id ?? null,
          },
        }).catch(() => {});
        return res.status(409).json({
          error: authorization.reason,
          code: authorization.code,
        });
      }
    }

    // Resolve social_account_id — fall back to user's connected account for this platform
    let socialAccountId: string | null = post.social_account_id || null;
    if (!socialAccountId) {
      const platformNorm = post.platform === 'x' ? 'twitter' : post.platform;
      const { data: acct } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', post.user_id)
        .eq('is_active', true)
        .in('platform', [post.platform, platformNorm])
        .limit(1)
        .maybeSingle();
      socialAccountId = acct?.id ?? null;
    }

    if (!socialAccountId) {
      return res.status(422).json({
        error: `No connected ${post.platform} account found. Please connect your account in Settings → Social Accounts.`,
      });
    }

    // Patch the post row with the resolved account so publishNow and future jobs use it
    if (!post.social_account_id) {
      await supabase
        .from('scheduled_posts')
        .update({ social_account_id: socialAccountId })
        .eq('id', post.id);
    }

    if (dry_run) {
      return res.status(200).json({
        status: 'DRY_RUN',
        platform: post.platform,
        social_account_id: socialAccountId,
        payload_preview: {
          platform: post.platform,
          content: post.content?.slice(0, 200),
          scheduled_time: post.scheduled_for,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const result = await publishNow({
      scheduled_post_id: post.id,
      social_account_id: socialAccountId,
      user_id: post.user_id,
    });

    await updatePostPublishStatus({
      post_id: post.id,
      status: result.status,
      external_post_id: result.external_post_id,
      last_error: result.status === 'PUBLISHED' ? undefined : result.message,
    });

    return res.status(200).json({
      status: result.status,
      platform: post.platform,
      external_post_id: result.external_post_id,
      post_url: result.post_url,
      message: result.message,
      timestamp: result.timestamp,
      // additive — non-fatal publish-readiness warnings (back-compat safe)
      ...(publishWarnings.length > 0 ? { warnings: publishWarnings } : {}),
    });
  } catch (error: any) {
    console.error('[publish] error:', error);
    try {
      await updatePostPublishStatus({
        post_id,
        status: 'FAILED',
        last_error: error?.message || 'Publish failed',
      });
    } catch (_) {}
    return res.status(500).json({ error: error?.message || 'Failed to publish scheduled post' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(withIdempotency(handler, { scope: 'social-publish' }), { route: '/api/social/publish' });
