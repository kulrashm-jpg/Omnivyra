/**
 * Activity Chat API
 * GET /api/activity/messages?activityId=&campaignId=
 * POST /api/activity/messages
 * Requires campaign access. Messages are threaded via parent_message_id.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { processMentions } from '../../../backend/services/collaborationMentionService';

type MessageRow = {
  id: string;
  activity_id: string;
  campaign_id: string;
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const { data, error } = await supabase
      .from('activity_messages')
      .select('id, activity_id, campaign_id, parent_message_id, message_text, created_by, created_at')
      .eq('activity_id', activityId)
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[activity/messages] GET error:', error);
      return res.status(500).json({ error: error.message });
    }

    const list = (data || []).map((r: MessageRow) => toResponse(r));

    // Insert read records for current user (Feature 1: unread logic)
    if (list.length > 0) {
      const reads = list.map((m) => ({
        message_id: m.id,
        message_source: 'activity' as const,
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

    const { data, error } = await supabase
      .from('activity_messages')
      .insert(insert)
      .select('id, activity_id, campaign_id, parent_message_id, message_text, created_by, created_at')
      .single();

    if (error) {
      console.error('[activity/messages] POST error:', error);
      return res.status(500).json({ error: error.message });
    }

    const msg = data as MessageRow;
    processMentions(msg.id, 'activity', text, access.companyId, access.userId).catch((e) =>
      console.error('[activity/messages] processMentions:', e)
    );

    return res.status(201).json(toResponse(msg));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
