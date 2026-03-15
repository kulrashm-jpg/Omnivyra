/**
 * GET /api/engagement/influencers
 * Returns top influencers from influencer_intelligence.
 * Query params: organization_id, platform (optional), limit (optional)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  getTopInfluencers,
  getInfluencersByPlatform,
} from '../../../backend/services/influencerIntelligenceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as
      | string
      | undefined;
    const platform = req.query.platform as string | undefined;
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '10', 10)));

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const influencers = platform
      ? await getInfluencersByPlatform(organizationId, platform)
      : await getTopInfluencers(organizationId, limit);

    return res.status(200).json({
      influencers: influencers.map((i) => ({
        id: i.id,
        author_id: i.author_id,
        author_name: i.author_name ?? 'Unknown',
        platform: i.platform,
        influence_score: i.influence_score,
        message_count: i.message_count,
        thread_count: i.thread_count,
        reply_count: i.reply_count,
        recommendation_mentions: i.recommendation_mentions,
        question_answers: i.question_answers,
        last_active_at: i.last_active_at,
      })),
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch influencers';
    console.error('[engagement/influencers]', message);
    return res.status(500).json({ error: message });
  }
}
