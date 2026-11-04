import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  ingestComments,
  getCommentsForScheduledPost,
} from '../../../backend/services/engagementIngestionService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

/**
 * ROUTE-AUTH-001: comment ingestion spends the social account's platform token,
 * so the caller must own that account (social_accounts.user_id) or be an active
 * member of the company it belongs to. Writes the denial and returns false.
 * An unknown account and an unowned one get the same 404.
 */
async function authorizeSocialAccount(
  req: NextApiRequest,
  res: NextApiResponse,
  callerUserId: string,
  socialAccountId: unknown,
): Promise<boolean> {
  if (typeof socialAccountId !== 'string' || !socialAccountId) {
    res.status(404).json({ error: 'Social account not found' });
    return false;
  }
  const { data: account, error } = await supabase
    .from('social_accounts')
    .select('id, user_id, company_id')
    .eq('id', socialAccountId)
    .maybeSingle();
  if (error) {
    res.status(503).json({ error: 'Social account lookup failed. Please try again.' });
    return false;
  }
  if (!account) {
    res.status(404).json({ error: 'Social account not found' });
    return false;
  }
  if (account.user_id && account.user_id === callerUserId) return true;
  if (account.company_id) {
    const ctx = await enforceCompanyAccess({ req, res, companyId: String(account.company_id) });
    return Boolean(ctx);
  }
  res.status(404).json({ error: 'Social account not found' });
  return false;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ROUTE-AUTH-001: authenticate before any lookup or platform call.
    const { user } = await getSupabaseUserFromRequest(req);
    if (!user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { platform, postId, accountId, action, scheduled_post_id } = req.body;

    if (!action) {
      return res.status(400).json({ error: 'Missing required field: action' });
    }

    if (action === 'fetch') {
      // Resolve scheduled_post_id: from body or by (platform_post_id, social_account_id)
      let resolvedScheduledPostId: string | null = scheduled_post_id ?? null;
      if (!resolvedScheduledPostId && platform && postId && accountId) {
        const { data: row } = await supabase
          .from('scheduled_posts')
          .select('id')
          .eq('platform_post_id', postId)
          .eq('social_account_id', accountId)
          .maybeSingle();
        resolvedScheduledPostId = row?.id ?? null;
      }
      if (!resolvedScheduledPostId) {
        return res.status(400).json({
          error: 'Cannot fetch comments: provide scheduled_post_id or (platform, postId, accountId) for a published post',
        });
      }
      // ROUTE-AUTH-001: bind the post to the caller through the social account
      // whose token ingestion would use.
      const { data: post, error: postError } = await supabase
        .from('scheduled_posts')
        .select('id, social_account_id')
        .eq('id', resolvedScheduledPostId)
        .maybeSingle();
      if (postError) {
        return res.status(503).json({ error: 'Scheduled post lookup failed. Please try again.' });
      }
      if (!post) {
        return res.status(404).json({ error: 'Scheduled post not found' });
      }
      if (!(await authorizeSocialAccount(req, res, user.id, post.social_account_id))) return;
      const ingestResult = await ingestComments(resolvedScheduledPostId);
      const comments = await getCommentsForScheduledPost(resolvedScheduledPostId);
      return res.status(200).json({
        success: true,
        platform,
        action: 'fetch',
        data: comments,
        ingested: ingestResult.ingested,
      });
    }

    // Owner ruling 2026-11-04 (Checkpoint 1, item 6): this route no longer replies. Its reply
    // action posted straight to LinkedIn/X with no governance, approval or channel gate, and
    // reported Facebook/Instagram replies as posted when nothing was sent. It is not replaced
    // by another direct platform call; replies go only through a governed engagement path.
    if (action === 'reply') {
      return res.status(410).json({
        error: 'REPLY_REMOVED',
        message: 'Replying through /api/social/comments has been removed; replies are sent only through the governed engagement path.',
      });
    }

    if (action === 'delete') {
      return res.status(200).json({ success: true, platform, action: 'delete', data: { message: 'Comment deleted successfully' } });
    }

    return res.status(400).json({ error: `Unsupported action: ${action}` });
  } catch (error: any) {
    console.error('Comment management error:', error);
    return res.status(500).json({ error: error.message, success: false });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/social/comments' });
