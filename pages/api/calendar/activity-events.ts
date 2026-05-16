
/**
 * GET /api/calendar/activity-events
 * Returns scheduled activity events for the dashboard calendar.
 * Query: start (YYYY-MM-DD), end (YYYY-MM-DD), companyId
 * Performance: Loads only events for visible month.
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

function toLocalDateKey(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  if (!start || !end) {
    return res.status(400).json({ error: 'start and end (YYYY-MM-DD) required' });
  }

  const startDate = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T23:59:59.999Z');
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'Invalid start or end date' });
  }

  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  try {
    // 1. Get campaign IDs for this company (via campaign_versions)
    const { data: versionRows, error: vError } = await supabase
      .from('campaign_versions')
      .select('campaign_id')
      .eq('company_id', companyId);
    if (vError) {
      return res.status(500).json({ error: 'Failed to load campaigns' });
    }
    const campaignIds = Array.from(
      new Set((versionRows || []).map((r: { campaign_id: string }) => r.campaign_id).filter(Boolean))
    );
    const { data: roleRows, error: roleError } = await supabase
      .from('user_company_roles')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('status', 'active');
    if (roleError) {
      return res.status(500).json({ error: 'Failed to load company users' });
    }
    const companyUserIds = Array.from(
      new Set((roleRows || []).map((row: { user_id?: string }) => row.user_id).filter(Boolean))
    ) as string[];
    if (campaignIds.length === 0 && companyUserIds.length === 0) {
      return res.status(200).json([]);
    }

    // Support broad-range stage-filter fetch (no date bounds when stageFilter param is set)
    const stageFilter = typeof req.query.stageFilter === 'string' ? req.query.stageFilter.trim() : '';

    // 2. Query scheduled_posts — full range when stageFilter is active, otherwise month range
    const applyDateRange = <T extends { gte: (...args: any[]) => T; lte: (...args: any[]) => T }>(query: T) => {
      if (stageFilter) return query;
      return query.gte('scheduled_for', startIso).lte('scheduled_for', endIso);
    };

    let campaignPosts: any[] = [];
    if (campaignIds.length > 0) {
      let q = supabase
        .from('scheduled_posts')
        .select('id, campaign_id, platform, title, content, scheduled_for, repurpose_index, repurpose_total, content_type, repurpose_parent_execution_id, status, media_urls, media_types')
        .in('campaign_id', campaignIds)
        .in('status', ['scheduled', 'draft', 'publishing', 'published', 'pending'])
        .order('scheduled_for', { ascending: true });

      q = applyDateRange(q);

      if (campaignIdFilter && campaignIds.includes(campaignIdFilter)) {
        q = q.eq('campaign_id', campaignIdFilter);
      }

      const { data, error } = await q;
      if (error) {
        return res.status(500).json({ error: 'Failed to load scheduled posts' });
      }
      campaignPosts = data || [];
    }

    let standalonePosts: any[] = [];
    if (!campaignIdFilter && companyUserIds.length > 0) {
      let q = supabase
        .from('scheduled_posts')
        .select('id, campaign_id, platform, title, content, scheduled_for, repurpose_index, repurpose_total, content_type, repurpose_parent_execution_id, status, media_urls, media_types')
        .in('user_id', companyUserIds)
        .is('campaign_id', null)
        .in('status', ['scheduled', 'draft', 'publishing', 'published', 'pending'])
        .order('scheduled_for', { ascending: true });

      q = applyDateRange(q);

      const { data, error } = await q;
      if (error) {
        return res.status(500).json({ error: 'Failed to load standalone scheduled posts' });
      }
      standalonePosts = data || [];
    }

    const posts = [...campaignPosts, ...standalonePosts];

    const now = new Date().toISOString();
    const events = (posts || []).map((row: any) => {
      const scheduledFor = row.scheduled_for ? new Date(row.scheduled_for) : new Date();
      const dateStr = toLocalDateKey(scheduledFor);
      const title =
        (row.title && String(row.title).trim()) ||
        extractTitleFromContent(row.content);
      const status = String(row.status || 'scheduled');
      return {
        date: dateStr,
        platform: normalizePlatform(row.platform),
        title: String(title).trim() || 'Scheduled post',
        repurpose_index: row.repurpose_index != null ? Number(row.repurpose_index) : 1,
        repurpose_total: row.repurpose_total != null ? Number(row.repurpose_total) : 1,
        campaign_id: row.campaign_id || '',
        content_type: String(row.content_type || 'post').trim(),
        scheduled_post_id: row.id,
        execution_id: row.repurpose_parent_execution_id || null,
        status,
        scheduled_for: row.scheduled_for || null,
        is_overdue: status === 'scheduled' && row.scheduled_for && row.scheduled_for < now,
        content: String(row.content || '').trim() || null,
        media_urls: Array.isArray(row.media_urls)
          ? row.media_urls.filter((u: unknown): u is string => typeof u === 'string' && u.trim().length > 0)
          : [],
        media_types: Array.isArray(row.media_types)
          ? row.media_types.filter((t: unknown): t is string => typeof t === 'string')
          : [],
      };
    });

    return res.status(200).json(events);
  } catch (err: any) {
    console.error('[calendar/activity-events]', err);
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
}
