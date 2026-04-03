
/**
 * Community Threads API
 * Returns multi-part threads from community_threads.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = (req.query.companyId as string)?.trim() || user?.defaultCompanyId;
    const postId = (req.query.postId as string)?.trim();
    const threadType = (req.query.threadType as string)?.trim();

    if (companyId) {
      const companyContext = await requireCompanyContext({ req, res, companyId });
      if (!companyContext) return;
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

    if (companyId) {
      const { data: postIds } = await supabase
        .from('community_posts')
        .select('id')
        .eq('company_id', companyId);
      const ids = (postIds ?? []).map((r: { id: string }) => r.id);
      if (ids.length > 0) {
        query = query.in('post_id', ids);
      } else {
        return res.status(200).json({ threads: [] });
      }
    } else if (!postId) {
      return res.status(400).json({ error: 'companyId or postId required' });
    }

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
