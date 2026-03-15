/**
 * GET /api/calendar/batch
 * Batch load: activity-events + activity message counts + calendar message counts
 * Query: start, end, companyId, campaignId?
 * Returns: { events, activityMessageCounts, calendarMessageCounts }
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

function extractTitleFromContent(content: string | null | undefined): string {
  if (!content || typeof content !== 'string') return 'Scheduled post';
  const match = content.match(/Content for "([^"]+)"/);
  return match ? match[1] : (content.slice(0, 80).trim() || 'Scheduled post');
}

function normalizePlatform(platform: string): string {
  const p = (platform || '').toLowerCase().trim();
  return p === 'twitter' ? 'x' : p;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
  const start = typeof req.query.start === 'string' ? req.query.start.trim() : '';
  const end = typeof req.query.end === 'string' ? req.query.end.trim() : '';
  const campaignIdFilter = typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '';

  const access = await enforceCompanyAccess({ req, res, companyId: companyId || null });
  if (!access) return;

  if (!companyId || !start || !end) {
    return res.status(400).json({ error: 'companyId, start, end (YYYY-MM-DD) required' });
  }

  const startDate = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T23:59:59.999Z');
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'Invalid start or end date' });
  }

  try {
    // 1. Campaign IDs
    const { data: versionRows, error: vError } = await supabase
      .from('campaign_versions')
      .select('campaign_id')
      .eq('company_id', companyId);
    if (vError) return res.status(500).json({ error: 'Failed to load campaigns' });
    const campaignIds = Array.from(
      new Set((versionRows || []).map((r: { campaign_id: string }) => r.campaign_id).filter(Boolean))
    );
    if (campaignIds.length === 0) {
      return res.status(200).json({ events: [], activityMessageCounts: {}, calendarMessageCounts: {} });
    }

    const effectiveCampaignIds = campaignIdFilter && campaignIds.includes(campaignIdFilter)
      ? [campaignIdFilter]
      : campaignIds;

    const startDateStr = start;
    const endDateStr = end;

    // Step 5: Read activity events from calendar_events_index (avoids heavy scheduled_posts joins)
    let activityEventsQ = supabase
      .from('calendar_events_index')
      .select('event_date, platform, title, repurpose_index, repurpose_total, campaign_id, scheduled_post_id, activity_execution_id')
      .eq('event_type', 'activity')
      .in('campaign_id', effectiveCampaignIds)
      .gte('event_date', startDateStr)
      .lte('event_date', endDateStr)
      .order('event_date', { ascending: true });

    const { data: indexRows, error: idxError } = await activityEventsQ;
    if (idxError) return res.status(500).json({ error: 'Failed to load calendar events' });

    const events = (indexRows || []).map((row: any) => ({
      date: String(row.event_date || ''),
      platform: normalizePlatform(row.platform || ''),
      title: (row.title && String(row.title).trim()) || 'Scheduled post',
      repurpose_index: row.repurpose_index != null ? Number(row.repurpose_index) : 1,
      repurpose_total: row.repurpose_total != null ? Number(row.repurpose_total) : 1,
      campaign_id: row.campaign_id || '',
      content_type: 'post',
      scheduled_post_id: row.scheduled_post_id,
      execution_id: row.activity_execution_id || null,
    }));

    // 3. Activity message counts - collect execution_ids from events
    const executionIds = Array.from(new Set(events.map((e: { execution_id?: string }) => e.execution_id).filter(Boolean) as string[]));
    const activityMessageCounts: Record<string, number> = {};
    if (executionIds.length > 0) {
      const byCampaign: Record<string, string[]> = {};
      events.forEach((e: { execution_id?: string; campaign_id: string }) => {
        if (e.execution_id) {
          if (!byCampaign[e.campaign_id]) byCampaign[e.campaign_id] = [];
          if (!byCampaign[e.campaign_id].includes(e.execution_id)) byCampaign[e.campaign_id].push(e.execution_id);
        }
      });
      for (const [cid, aids] of Object.entries(byCampaign)) {
        const { data: msgRows } = await supabase
          .from('activity_messages')
          .select('activity_id')
          .eq('campaign_id', cid)
          .in('activity_id', aids);
        for (const r of msgRows || []) {
          const aid = String(r.activity_id || '');
          if (aid) activityMessageCounts[aid] = (activityMessageCounts[aid] ?? 0) + 1;
        }
      }
    }

    // 4. Calendar message counts per date (from calendar_events_index)
    const dates: string[] = [];
    const d = new Date(startDate);
    while (d <= endDate) {
      dates.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    const calendarMessageCounts: Record<string, number> = {};
    if (dates.length > 0) {
      const { data: msgRows } = await supabase
        .from('calendar_events_index')
        .select('event_date')
        .eq('event_type', 'message')
        .in('campaign_id', effectiveCampaignIds)
        .gte('event_date', startDateStr)
        .lte('event_date', endDateStr);
      for (const r of msgRows || []) {
        const dateStr = String(r.event_date || '');
        if (dateStr && dates.includes(dateStr)) {
          calendarMessageCounts[dateStr] = (calendarMessageCounts[dateStr] ?? 0) + 1;
        }
      }
    }

    return res.status(200).json({
      events,
      activityMessageCounts,
      calendarMessageCounts,
    });
  } catch (err: unknown) {
    console.error('[calendar/batch]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Internal error' });
  }
}
