/**
 * Community Posts API
 * Returns platform-ready posts from community_posts.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = (req.query.companyId as string)?.trim() || user?.defaultCompanyId;
    const platform = (req.query.platform as string)?.trim();
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));

    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    let query = supabase
      .from('community_posts')
      .select('id, narrative_id, platform, post_content, post_type, scheduled_at, published_at, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (platform) {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[community/posts]', error.message);
      return res.status(500).json({ error: error.message });
    }

    const posts = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      narrative_id: r.narrative_id,
      platform: r.platform,
      post_content: r.post_content,
      post_type: r.post_type,
      scheduled_at: r.scheduled_at,
      published_at: r.published_at,
      created_at: r.created_at,
    }));

    return res.status(200).json({ posts });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch community posts';
    console.error('[community/posts]', message);
    return res.status(500).json({ error: message });
  }
}
