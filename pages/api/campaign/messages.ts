
/**
 * Campaign Chat API
 * GET /api/campaign/messages?campaignId=
 * POST /api/campaign/messages
 * Requires campaign access. Messages are threaded via parent_message_id.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { createMessage, listMessages } from '../../../backend/services/collaborationMessageService';
import { processMentions } from '../../../backend/services/collaborationMentionService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId =
    (typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '') ||
    (typeof req.body?.campaignId === 'string' ? req.body.campaignId.trim() : '');

  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId required' });
  }

  const access = await requireCampaignAccess(req, res, campaignId);
  if (!access) return;

  if (req.method === 'GET') {
    try {
      const messages = await listMessages({
        table: 'campaign_messages',
        select: 'id, campaign_id, parent_message_id, message_text, created_by, created_at',
        source: 'campaign',
        userId: access.userId,
        applyFilters: (query) => query.eq('campaign_id', campaignId),
      });
      return res.status(200).json(messages);
    } catch (error: any) {
      console.error('[campaign/messages] GET error:', error);
      return res.status(500).json({ error: error?.message || 'Failed to load messages' });
    }
  }

  if (req.method === 'POST') {
    const { message_text, parent_message_id } = req.body || {};
    const text = typeof message_text === 'string' ? message_text.trim() : '';
    if (!text) {
      return res.status(400).json({ error: 'message_text required' });
    }

    const insert: Record<string, unknown> = {
      campaign_id: campaignId,
      message_text: text,
      created_by: access.userId,
      parent_message_id: typeof parent_message_id === 'string' && parent_message_id ? parent_message_id : null,
    };

    try {
      const message = await createMessage({
        table: 'campaign_messages',
        select: 'id, campaign_id, parent_message_id, message_text, created_by, created_at',
        insert,
      });
      processMentions(message.id, 'campaign', text, access.companyId, access.userId).catch((e) =>
        console.error('[campaign/messages] processMentions:', e)
      );

      return res.status(201).json(message);
    } catch (error: any) {
      console.error('[campaign/messages] POST error:', error);
      return res.status(500).json({ error: error?.message || 'Failed to create message' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
