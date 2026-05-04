import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * GET /api/activity/message-counts?campaignId=...&activityIds=id1,id2,id3
 * Returns { [activityId]: { total, unread } } for comment indicators on activity cards.
 * Feature 1: Unread = messages not yet read by current user (message_reads).
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { getMessageCounts } from '../../../backend/services/collaborationMessageService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '';
  const activityIdsRaw = typeof req.query.activityIds === 'string' ? req.query.activityIds : '';
  const activityIds = activityIdsRaw
    ? activityIdsRaw.split(',').map((id) => id.trim()).filter(Boolean)
    : [];

  const access = await requireCampaignAccess(req, res, campaignId);
  if (!access) return;

  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId required' });
  }

  if (activityIds.length === 0) {
    return res.status(200).json({});
  }

  try {
    const counts = await getMessageCounts({
      table: 'activity_messages',
      select: 'id, activity_id',
      groupField: 'activity_id',
      groupValues: activityIds,
      source: 'activity',
      userId: access.userId,
      applyFilters: (query) => query.eq('campaign_id', campaignId).in('activity_id', activityIds),
    });
    return res.status(200).json(counts);
  } catch (err: unknown) {
    console.error('[activity/message-counts]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Internal error' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

