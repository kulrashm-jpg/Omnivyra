import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Day Chat (Calendar) API
 * GET /api/calendar/messages?campaignId=&date=
 * POST /api/calendar/messages
 * Requires campaign access. Messages are threaded via parent_message_id.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { createMessage, listMessages } from '../../../backend/services/collaborationMessageService';
import { processMentions } from '../../../backend/services/collaborationMentionService';

function parseDate(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId =
    (typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '') ||
    (typeof req.body?.campaignId === 'string' ? req.body.campaignId.trim() : '');
  const date =
    parseDate(req.query.date) ||
    parseDate(req.body?.date);

  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId required' });
  }

  const access = await requireCampaignAccess(req, res, campaignId);
  if (!access) return;

  if (req.method === 'GET') {
    if (!date) {
      return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
    }
    try {
      const messages = await listMessages({
        table: 'calendar_messages',
        select: 'id, campaign_id, message_date, parent_message_id, message_text, created_by, created_at',
        source: 'calendar',
        userId: access.userId,
        applyFilters: (query) => query.eq('campaign_id', campaignId).eq('message_date', date),
      });
      return res.status(200).json(messages);
    } catch (error: any) {
      console.error('[calendar/messages] GET error:', error);
      return res.status(500).json({ error: error?.message || 'Failed to load messages' });
    }
  }

  if (req.method === 'POST') {
    if (!date) {
      return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
    }
    const { message_text, parent_message_id } = req.body || {};
    const text = typeof message_text === 'string' ? message_text.trim() : '';
    if (!text) {
      return res.status(400).json({ error: 'message_text required' });
    }

    const insert: Record<string, unknown> = {
      campaign_id: campaignId,
      message_date: date,
      message_text: text,
      created_by: access.userId,
      parent_message_id: typeof parent_message_id === 'string' && parent_message_id ? parent_message_id : null,
    };

    try {
      const message = await createMessage({
        table: 'calendar_messages',
        select: 'id, campaign_id, message_date, parent_message_id, message_text, created_by, created_at',
        insert,
      });

      // calendar_events_index teardown: the 'message' index row was only read
      // by the (now-removed) /api/calendar/batch route. calendar_messages above
      // is the canonical store; message counts read it via message-counts.ts.

      processMentions(message.id, 'calendar', text, access.companyId, access.userId).catch((e) =>
        console.error('[calendar/messages] processMentions:', e)
      );

      return res.status(201).json(message);
    } catch (error: any) {
      console.error('[calendar/messages] POST error:', error);
      return res.status(500).json({ error: error?.message || 'Failed to create message' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/calendar/messages' });
