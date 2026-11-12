import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Community Engagement API
 * Returns engagement signals from engagement_signals.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';

/** Newest posts a company-wide listing reads its rows from (bounded: the .in() list and PostgREST's row cap). */
const POST_WINDOW = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // SECURITY (2026-11-13): resolveUserContext does NOT refuse - an anonymous caller gets an unauthenticated
    // context. This route used to run the access check only when a company was known, so an anonymous request
    // with just a postId read ANY company's rows. Now: authenticated, a company (the query's or the user's
    // default) ALWAYS access-checked, and a postId only narrows within that company's posts.
    const user = await resolveUserContext(req);
    if (!user?.authenticated || !user.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const companyId = (req.query.companyId as string)?.trim() || user.defaultCompanyId;
    const postId = (req.query.postId as string)?.trim();
    const platform = (req.query.platform as string)?.trim();
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));

    // Always: no company -> 400 (requireCompanyContext); no access -> refused there.
    const companyContext = await requireCompanyContext({ req, res, companyId });
    if (!companyContext) return;

    // The post scope. With a postId, an O(1) existence check scoped to this company decides the 404 - never
    // membership in a list a PostgREST row cap could silently truncate. A post that is not this company's
    // (another company's, an unknown id, or not an id at all) is the SAME 404. Without one, the company's newest
    // POST_WINDOW posts, and the response says when that window was full instead of hiding older posts' rows.
    let scopeIds: string[];
    let truncated = false;
    if (postId) {
      if (!UUID_RE.test(postId)) {
        return res.status(404).json({ error: 'Post not found' });
      }
      const { data: own, error: ownError } = await supabase
        .from('community_posts')
        .select('id')
        .eq('company_id', companyContext.companyId)
        .eq('id', postId)
        .maybeSingle();
      if (ownError) {
        console.error('[community/engagement] post lookup failed', ownError.message);
        return res.status(500).json({ error: 'Failed to load posts' });
      }
      if (!own) {
        return res.status(404).json({ error: 'Post not found' });
      }
      scopeIds = [postId];
    } else {
      const { data: postRows, error: postsError } = await supabase
        .from('community_posts')
        .select('id')
        .eq('company_id', companyContext.companyId)
        .order('created_at', { ascending: false })
        .limit(POST_WINDOW + 1);
      if (postsError) {
        console.error('[community/engagement] posts lookup failed', postsError.message);
        return res.status(500).json({ error: 'Failed to load posts' });
      }
      const rows = (postRows ?? []) as Array<{ id: string }>;
      truncated = rows.length > POST_WINDOW;
      scopeIds = rows.slice(0, POST_WINDOW).map((r) => r.id);
    }

    let query = supabase
      .from('engagement_signals')
      .select('id, post_id, platform, engagement_type, engagement_count, captured_at')
      .order('captured_at', { ascending: false })
      .limit(limit);

    if (postId) {
      query = query.eq('post_id', postId);
    }

    if (platform) {
      query = query.eq('platform', platform);
    }

    if (scopeIds.length === 0) {
      return res.status(200).json({ engagement: [], truncated: false });
    }
    query = query.in('post_id', scopeIds);

    const { data, error } = await query;

    if (error) {
      console.error('[community/engagement]', error.message);
      return res.status(500).json({ error: error.message });
    }

    const engagement = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      post_id: r.post_id,
      platform: r.platform,
      engagement_type: r.engagement_type,
      engagement_count: r.engagement_count ?? 0,
      captured_at: r.captured_at,
    }));

    return res.status(200).json({ engagement, truncated });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch engagement';
    console.error('[community/engagement]', message);
    return res.status(500).json({ error: message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community/engagement' });
