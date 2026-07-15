import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Activity Chat API
 * GET /api/activity/messages?activityId=&campaignId=
 * POST /api/activity/messages
 * Requires campaign access. Messages are threaded via parent_message_id.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { createMessage, listMessages } from '../../../backend/services/collaborationMessageService';
import { processMentions } from '../../../backend/services/collaborationMentionService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const activityId = typeof req.query.activityId === 'string' ? req.query.activityId.trim() : '';
  const campaignId =
    (typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '') ||
    (typeof req.body?.campaignId === 'string' ? req.body.campaignId.trim() : '');

  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId required' });
  }

  const access = await requireCampaignAccess(req, res, campaignId);
  if (!access) return;

  if (req.method === 'GET') {
    if (!activityId) {
      return res.status(400).json({ error: 'activityId required' });
    }
    try {
      const messages = await listMessages({
        table: 'activity_messages',
        select: 'id, activity_id, campaign_id, parent_message_id, message_text, created_by, created_at',
        source: 'activity',
        userId: access.userId,
        applyFilters: (query) => query.eq('activity_id', activityId).eq('campaign_id', campaignId),
      });
      return res.status(200).json(messages);
    } catch (error: any) {
      console.error('[activity/messages] GET error:', error);
      return res.status(500).json({ error: error?.message || 'Failed to load messages' });
    }
  }

  if (req.method === 'POST') {
    const { activityId: bodyActivityId, message_text, parent_message_id } = req.body || {};
    const actId = activityId || (typeof bodyActivityId === 'string' ? bodyActivityId.trim() : '');
    if (!actId) {
      return res.status(400).json({ error: 'activityId required' });
    }
    const text = typeof message_text === 'string' ? message_text.trim() : '';
    if (!text) {
      return res.status(400).json({ error: 'message_text required' });
    }

    const insert: Record<string, unknown> = {
      activity_id: actId,
      campaign_id: campaignId,
      message_text: text,
      created_by: access.userId,
      parent_message_id: typeof parent_message_id === 'string' && parent_message_id ? parent_message_id : null,
    };

    try {
      const message = await createMessage({
        table: 'activity_messages',
        select: 'id, activity_id, campaign_id, parent_message_id, message_text, created_by, created_at',
        insert,
      });
      processMentions(message.id, 'activity', text, access.companyId, access.userId).catch((e) =>
        console.error('[activity/messages] processMentions:', e)
      );

      return res.status(201).json(message);
    } catch (error: any) {
      console.error('[activity/messages] POST error:', error);
      return res.status(500).json({ error: error?.message || 'Failed to create message' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/activity/messages' });
