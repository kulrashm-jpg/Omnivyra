/**
 * Day Chat (Calendar) API
 * GET /api/calendar/messages?campaignId=&date=
 * POST /api/calendar/messages
 * Requires campaign access. Messages are threaded via parent_message_id.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { processMentions } from '../../../backend/services/collaborationMentionService';

type MessageRow = {
  id: string;
  campaign_id: string;
  message_date: string;
  parent_message_id: string | null;
  message_text: string;
  created_by: string;
  created_at: string;
};

function toResponse(row: MessageRow) {
  return {
    id: row.id,
    message_text: row.message_text,
    created_by: row.created_by,
    created_at: row.created_at,
    parent_message_id: row.parent_message_id,
  };
}

function parseDate(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const { data, error } = await supabase
      .from('calendar_messages')
      .select('id, campaign_id, message_date, parent_message_id, message_text, created_by, created_at')
      .eq('campaign_id', campaignId)
      .eq('message_date', date)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[calendar/messages] GET error:', error);
      return res.status(500).json({ error: error.message });
    }

    const list = (data || []).map((r: MessageRow) => toResponse(r));

    // Feature 1: Insert read records for current user when messages are loaded
    if (list.length > 0 && access.userId) {
      const reads = list.map((m: { id: string }) => ({
        message_id: m.id,
        message_source: 'calendar' as const,
        user_id: access.userId,
      }));
      for (const r of reads) {
        await supabase.from('message_reads').upsert(
          { ...r, read_at: new Date().toISOString() },
          { onConflict: 'message_id,message_source,user_id', ignoreDuplicates: false }
        );
      }
    }

    return res.status(200).json(list);
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

    const { data, error } = await supabase
      .from('calendar_messages')
      .insert(insert)
      .select('id, campaign_id, message_date, parent_message_id, message_text, created_by, created_at')
      .single();

    if (error) {
      console.error('[calendar/messages] POST error:', error);
      return res.status(500).json({ error: error.message });
    }

    const msg = data as MessageRow;

    // Step 4: Insert message event into calendar_events_index
    await supabase.from('calendar_events_index').insert({
      company_id: access.companyId,
      campaign_id: campaignId,
      event_date: date,
      event_type: 'message',
    });

    processMentions(msg.id, 'calendar', text, access.companyId, access.userId).catch((e) =>
      console.error('[calendar/messages] processMentions:', e)
    );

    return res.status(201).json(toResponse(msg));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
