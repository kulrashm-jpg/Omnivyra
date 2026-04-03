
/**
 * POST /api/schedule/reschedule
 * Updates scheduled_posts.scheduled_for for drag-and-drop rescheduling.
 * Payload: { scheduled_post_id, new_date (YYYY-MM-DD), companyId? }
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

function parseDate(str: string): Date | null {
  const m = String(str || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return Number.isFinite(d.getTime()) ? d : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { scheduled_post_id, new_date } = req.body || {};
  const postId = typeof scheduled_post_id === 'string' ? scheduled_post_id.trim() : '';
  const newDate = parseDate(typeof new_date === 'string' ? new_date : '');

  if (!postId || !newDate) {
    return res.status(400).json({ error: 'scheduled_post_id and new_date (YYYY-MM-DD) required' });
  }

  try {
    const { data: post, error: postErr } = await supabase
      .from('scheduled_posts')
      .select('id, campaign_id, scheduled_for')
      .eq('id', postId)
      .single();

    if (postErr || !post) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }

    const { data: cv } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', post.campaign_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const companyId = (typeof req.body?.companyId === 'string' ? req.body.companyId.trim() : '') || cv?.company_id || '';
    const access = await enforceCompanyAccess({ req, res, companyId: companyId || null });
    if (!access) return;

    if (companyId && cv && cv.company_id !== companyId) {
      return res.status(403).json({ error: 'Post not in company scope' });
    }

    const oldScheduled = post.scheduled_for ? new Date(post.scheduled_for) : new Date();
    const newScheduledFor = new Date(newDate);
    newScheduledFor.setHours(oldScheduled.getHours(), oldScheduled.getMinutes(), oldScheduled.getSeconds(), 0);

    const { error } = await supabase
      .from('scheduled_posts')
      .update({
        scheduled_for: newScheduledFor.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', postId);

    if (error) {
      console.error('[schedule/reschedule]', error);
      return res.status(500).json({ error: error.message });
    }

    // Step 3: Update calendar_events_index event_date
    const newDateStr = newDate.toISOString().slice(0, 10);
    await supabase
      .from('calendar_events_index')
      .update({ event_date: newDateStr })
      .eq('scheduled_post_id', postId)
      .eq('event_type', 'activity');

    return res.status(200).json({
      success: true,
      scheduled_post_id: postId,
      new_date: newDate.toISOString().slice(0, 10),
    });
  } catch (err: unknown) {
    console.error('[schedule/reschedule]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Internal error' });
  }
}
