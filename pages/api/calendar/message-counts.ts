import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * GET /api/calendar/message-counts?campaignId=...&dates=2025-03-01,2025-03-02,...
 * Returns { [date]: { total, unread } } for vertical markers on dashboard calendar.
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
  const campaignIdsRaw = typeof req.query.campaignIds === 'string' ? req.query.campaignIds : '';
  const campaignIds = campaignIdsRaw
    ? campaignIdsRaw.split(',').map((id) => id.trim()).filter(Boolean)
    : campaignId ? [campaignId] : [];
  const authCampaignId = campaignIds[0] || campaignId;
  const datesRaw = typeof req.query.dates === 'string' ? req.query.dates : '';
  const dates = datesRaw
    ? datesRaw.split(',').map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];

  const access = await requireCampaignAccess(req, res, authCampaignId);
  if (!access) return;

  if (!authCampaignId) {
    return res.status(400).json({ error: 'campaignId or campaignIds required' });
  }

  if (dates.length === 0) {
    return res.status(200).json({});
  }

  try {
    const counts = await getMessageCounts({
      table: 'calendar_messages',
      select: 'id, message_date',
      groupField: 'message_date',
      groupValues: dates,
      source: 'calendar',
      userId: access.userId,
      applyFilters: (query) =>
        query
          .in('campaign_id', campaignIds.length ? campaignIds : [authCampaignId])
          .in('message_date', dates),
    });
    return res.status(200).json(counts);
  } catch (err: unknown) {
    console.error('[calendar/message-counts]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Internal error' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

