import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Community Threads API
 * Returns multi-part threads from community_threads.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';

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
    const threadType = (req.query.threadType as string)?.trim();

    // Always: no company -> 400 (requireCompanyContext); no access -> refused there.
    const companyContext = await requireCompanyContext({ req, res, companyId });
    if (!companyContext) return;

    const { data: postIds, error: postsError } = await supabase
      .from('community_posts')
      .select('id')
      .eq('company_id', companyContext.companyId);
    if (postsError) {
      console.error('[community/threads] posts lookup failed', postsError.message);
      return res.status(500).json({ error: 'Failed to load posts' });
    }
    const ids = (postIds ?? []).map((r: { id: string }) => r.id);
    // A post that is not this company's - another company's, or none at all - is the SAME 404.
    if (postId && !ids.includes(postId)) {
      return res.status(404).json({ error: 'Post not found' });
    }

    let query = supabase
      .from('community_threads')
      .select('id, post_id, thread_type, thread_content, created_at');

    if (postId) {
      query = query.eq('post_id', postId);
    }

    if (threadType) {
      query = query.eq('thread_type', threadType);
    }

    if (ids.length === 0) {
      return res.status(200).json({ threads: [] });
    }
    query = query.in('post_id', ids);

    const { data, error } = await query.order('created_at', { ascending: false }).limit(50);

    if (error) {
      console.error('[community/threads]', error.message);
      return res.status(500).json({ error: error.message });
    }

    const threads = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      post_id: r.post_id,
      thread_type: r.thread_type,
      thread_content: r.thread_content,
      created_at: r.created_at,
    }));

    return res.status(200).json({ threads });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch community threads';
    console.error('[community/threads]', message);
    return res.status(500).json({ error: message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community/threads' });
