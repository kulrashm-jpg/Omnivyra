import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

// LEGACY ENGINE - DO NOT EXTEND
// Scheduled for removal after DB-platform intelligence cutover.
// API Endpoint for Individual Post Management
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import {
  cancelLegacyScheduledPost,
  getLegacyScheduledPostById,
  publishLegacyScheduledPostNow,
  updateLegacyScheduledPost,
} from '@/backend/services/structuredPlanScheduler';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enqueueScheduledPostAt } from '@/backend/scheduler/schedulerService';
import { resolvePublishMedia } from '@/backend/services/creator/creatorPublishResolution';
import { hasUncertainOutcome, PUBLISH_OUTCOME_UNCERTAIN } from '@/backend/queue/publishOutcome';

async function requireUserId(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    return null;
  }
  return user.id;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log(`[NEW SCHEDULER ACTIVE] invoked pages/api/schedule/posts/[id].ts handler (${req.method || 'unknown'})`);
  const userId = await requireUserId(req, res);
  if (!userId) return;

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Post ID is required',
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        // Get specific post
        const post = await getLegacyScheduledPostById({ userId, id });
        
        if (!post) {
          return res.status(404).json({
            success: false,
            error: 'Post not found',
          });
        }

        res.status(200).json({
          success: true,
          data: post,
        });
        break;

      case 'PUT':
        // Update post
        const updateData = req.body;
        
        // Validate update data
        if (!(await getLegacyScheduledPostById({ userId, id }))) {
          return res.status(404).json({ success: false, error: 'Post not found' });
        }

        // Single publishing-resolution path — only when this PUT actually carries
        // media/refs (preserve "undefined = don't touch"). Legacy `mediaUrls` is
        // fallback transport only; no-op when no creator asset refs are sent.
        let patchMediaUrls = updateData.mediaUrls;
        if (updateData.mediaUrls !== undefined || updateData.assetRefs !== undefined || updateData.creatorAttachments !== undefined) {
          // ROUTE-AUTH-001 (STEP 3AH-85) — the companyId scopes which creator
          // assets the refs resolve to (and whose storage URLs get published),
          // so a client-supplied one must be a company the caller belongs to.
          const requestedCompanyId = updateData.companyId != null && String(updateData.companyId).trim()
            ? String(updateData.companyId).trim()
            : null;
          if (requestedCompanyId) {
            const companyAccess = await enforceCompanyAccess({ req, res, companyId: requestedCompanyId });
            if (!companyAccess) return;
          }
          const { mediaUrls } = await resolvePublishMedia({
            companyId: requestedCompanyId ?? userId,
            userId,
            platform: String(updateData.platform ?? ''),
            assetRefs: updateData.assetRefs,
            creatorAttachments: updateData.creatorAttachments,
            legacyMediaUrls: updateData.mediaUrls || [],
          });
          patchMediaUrls = mediaUrls;
        }

        // A status change on a post whose last attempt may already have
        // published it would re-queue it without reconciliation.
        if (updateData.status !== undefined && (await refuseIfOutcomeUncertain(res, id, userId))) return;

        await updateLegacyScheduledPost({
          userId,
          id,
          patch: {
            content: updateData.content,
            title: updateData.title,
            hashtags: updateData.hashtags,
            mediaUrls: patchMediaUrls,
            scheduledFor: updateData.scheduledFor,
            status: updateData.status,
            contentType: updateData.contentType,
          },
        });

        try {
          const { data: row } = await supabase
            .from('scheduled_posts')
            .select('id, social_account_id, scheduled_for, status')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();
          if (row?.id && row.social_account_id && row.scheduled_for && row.status === 'scheduled') {
            await enqueueScheduledPostAt(row.id, userId, String(row.social_account_id), String(row.scheduled_for));
          }
        } catch (enqueueError: any) {
          console.warn('[schedule/posts/:id] enqueueScheduledPostAt failed after update (non-fatal):', enqueueError?.message);
        }
        
        res.status(200).json({
          success: true,
          message: 'Post updated successfully',
        });
        break;

      case 'DELETE':
        // Cancel/delete post
        if (!(await getLegacyScheduledPostById({ userId, id }))) {
          return res.status(404).json({ success: false, error: 'Post not found' });
        }

        await cancelLegacyScheduledPost({ userId, id });
        
        res.status(200).json({
          success: true,
          message: 'Post cancelled successfully',
        });
        break;

      case 'POST':
        // Publish post immediately
        const postToPublish = await getLegacyScheduledPostById({ userId, id });
        
        if (!postToPublish) {
          return res.status(404).json({
            success: false,
            error: 'Post not found',
          });
        }

        if (await refuseIfOutcomeUncertain(res, id, userId)) return;

        // Queue for immediate publishing (DB scheduler picks up due posts)
        await publishLegacyScheduledPostNow({ userId, id });
        try {
          const { data: row } = await supabase
            .from('scheduled_posts')
            .select('id, social_account_id, scheduled_for')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();
          if (row?.id && row.social_account_id && row.scheduled_for) {
            await enqueueScheduledPostAt(row.id, userId, String(row.social_account_id), String(row.scheduled_for));
          }
        } catch (enqueueError: any) {
          console.warn('[schedule/posts/:id] enqueueScheduledPostAt failed after publish-now queue (non-fatal):', enqueueError?.message);
        }
        const result = { success: true, queued: true, postId: id };
        
        res.status(200).json({
          success: true,
          data: result,
          message: 'Post published successfully',
        });
        break;

      default:
        res.setHeader('Allow', ['GET', 'PUT', 'DELETE', 'POST']);
        res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * Refuse (409, PUBLISH_OUTCOME_UNCERTAIN) when the post's last publish attempt
 * may already have published it: re-scheduling or "publish now" here would
 * queue it again. The operator reconciles it first
 * (POST /api/super-admin/publish/reconcile). Returns true when it responded.
 *
 * A read-then-write check: the durable backstop is that every publish path
 * (worker, publish-now, cron, thread orchestrator) refuses a row carrying the
 * uncertain code whatever its status (backend/queue/publishOutcome.ts), and
 * neither writer below touches error_code.
 */
async function refuseIfOutcomeUncertain(res: NextApiResponse, id: string, userId: string): Promise<boolean> {
  const { data: current } = await supabase
    .from('scheduled_posts')
    .select('id, status, error_code, platform_post_id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!current || !hasUncertainOutcome(current)) return false;
  res.status(409).json({
    success: false,
    error:
      'This post may already have been published: its last attempt reached the platform but the result was not ' +
      'saved. Check the platform and have the outcome reconciled before scheduling or publishing it again.',
    code: PUBLISH_OUTCOME_UNCERTAIN,
    requires: 'reconciliation',
  });
  return true;
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/schedule/posts/:id' });
