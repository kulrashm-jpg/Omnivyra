
/**
 * GET /api/calendar/message-counts?campaignId=...&dates=2025-03-01,2025-03-02,...
 * Returns { [date]: { total, unread } } for vertical markers on dashboard calendar.
 * Feature 1: Unread = messages not yet read by current user (message_reads).
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const { data: msgRows, error: msgError } = await supabase
      .from('calendar_messages')
      .select('id, message_date')
      .in('campaign_id', campaignIds.length ? campaignIds : [authCampaignId])
      .in('message_date', dates);

    if (msgError) {
      console.error('[calendar/message-counts]', msgError);
      return res.status(500).json({ error: 'Failed to fetch counts' });
    }

    const msgIds = (msgRows || []).map((r: { id: string }) => r.id);
    let readMsgIds = new Set<string>();
    if (msgIds.length > 0 && access.userId) {
      const { data: readRows } = await supabase
        .from('message_reads')
        .select('message_id')
        .eq('message_source', 'calendar')
        .eq('user_id', access.userId)
        .in('message_id', msgIds);
      readMsgIds = new Set((readRows || []).map((r: { message_id: string }) => r.message_id));
    }

    const counts: Record<string, { total: number; unread: number }> = {};
    for (const d of dates) counts[d] = { total: 0, unread: 0 };
    for (const r of msgRows || []) {
      const d = String(r.message_date || '');
      if (d && dates.includes(d)) {
        counts[d].total += 1;
        if (!readMsgIds.has(r.id)) counts[d].unread += 1;
      }
    }
    return res.status(200).json(counts);
  } catch (err: unknown) {
    console.error('[calendar/message-counts]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Internal error' });
  }
}
