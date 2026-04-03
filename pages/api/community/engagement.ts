
/**
 * Community Engagement API
 * Returns engagement signals from engagement_signals.
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
    const platform = (req.query.platform as string)?.trim();
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));

    if (companyId) {
      const companyContext = await requireCompanyContext({ req, res, companyId });
      if (!companyContext) return;
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

    if (companyId) {
      const { data: postIds } = await supabase
        .from('community_posts')
        .select('id')
        .eq('company_id', companyId);
      const ids = (postIds ?? []).map((r: { id: string }) => r.id);
      if (ids.length > 0) {
        query = query.in('post_id', ids);
      } else {
        return res.status(200).json({ engagement: [] });
      }
    } else if (!postId) {
      return res.status(400).json({ error: 'companyId or postId required' });
    }

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

    return res.status(200).json({ engagement });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch engagement';
    console.error('[community/engagement]', message);
    return res.status(500).json({ error: message });
  }
}
