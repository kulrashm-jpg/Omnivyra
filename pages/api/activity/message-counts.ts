
/**
 * GET /api/activity/message-counts?campaignId=...&activityIds=id1,id2,id3
 * Returns { [activityId]: { total, unread } } for comment indicators on activity cards.
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
    const { data: msgRows, error: msgError } = await supabase
      .from('activity_messages')
      .select('id, activity_id')
      .eq('campaign_id', campaignId)
      .in('activity_id', activityIds);

    if (msgError) {
      console.error('[activity/message-counts]', msgError);
      return res.status(500).json({ error: 'Failed to fetch counts' });
    }

    const msgIds = (msgRows || []).map((r: { id: string }) => r.id);
    let readMsgIds = new Set<string>();
    if (msgIds.length > 0 && access.userId) {
      const { data: readRows } = await supabase
        .from('message_reads')
        .select('message_id')
        .eq('message_source', 'activity')
        .eq('user_id', access.userId)
        .in('message_id', msgIds);
      readMsgIds = new Set((readRows || []).map((r: { message_id: string }) => r.message_id));
    }

    const counts: Record<string, { total: number; unread: number }> = {};
    for (const aid of activityIds) counts[aid] = { total: 0, unread: 0 };
    for (const r of msgRows || []) {
      const aid = String(r.activity_id || '');
      if (aid && activityIds.includes(aid)) {
        counts[aid].total += 1;
        if (!readMsgIds.has(r.id)) counts[aid].unread += 1;
      }
    }
    return res.status(200).json(counts);
  } catch (err: unknown) {
    console.error('[activity/message-counts]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Internal error' });
  }
}
