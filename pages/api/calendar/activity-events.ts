
/**
 * GET /api/calendar/activity-events
 * Returns scheduled activity events for the dashboard calendar.
 * Query: start (YYYY-MM-DD), end (YYYY-MM-DD), companyId
 * Performance: Loads only events for visible month.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  resolveCanonicalState,
  CANONICAL_BADGE,
  CanonicalContentState,
} from '../../../lib/shared/contentLifecycle';

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
      // Canonical state (additive — legacy `status` preserved unchanged).
      const canonical = resolveCanonicalState({
        scheduled_post_status: status,
        scheduled_post_id: row.id,
      });
      const badge = CANONICAL_BADGE[canonical];
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
        // ── additive canonical fields ──
        canonical_state: canonical,
        canonical_badge: badge.short,
        canonical_label: badge.label,
        canonical_group: badge.group,
        pending: false,
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

    // ── PENDING CREATOR VISIBILITY (Round-2 item 2) ────────────────────────
    // Surface daily_content_plans that have NO scheduled_posts row yet, so
    // pending creator work is visible on the calendar BEFORE upload. Dedup
    // is structural: only rows with scheduled_post_id IS NULL are emitted
    // (rows that DO have one are already represented by the feed above).
    // Additive only — existing scheduled events are untouched. Disable with
    // CALENDAR_PENDING_VISIBILITY=0.
    if (
      String(process.env.CALENDAR_PENDING_VISIBILITY ?? '1') !== '0' &&
      campaignIds.length > 0
    ) {
      try {
        let pq = supabase
          .from('daily_content_plans')
          .select('id, campaign_id, platform, content_type, content_status, content, scheduled_post_id, title, topic, date')
          .in('campaign_id', campaignIdFilter && campaignIds.includes(campaignIdFilter) ? [campaignIdFilter] : campaignIds)
          .is('scheduled_post_id', null);
        if (!stageFilter) {
          pq = pq.gte('date', start).lte('date', end);
        }
        const { data: pendingRows } = await pq.limit(2000);
        const PENDING_GROUPS = new Set<CanonicalContentState>([
          CanonicalContentState.PENDING_CREATOR,
          CanonicalContentState.READY_FOR_REVIEW,
          CanonicalContentState.READY_FOR_SCHEDULE,
        ]);
        for (const r of pendingRows || []) {
          const dateStr = typeof r.date === 'string' ? r.date.slice(0, 10) : '';
          if (!dateStr) continue;
          const canonical = resolveCanonicalState({
            content_status: r.content_status,
            content: r.content,
            scheduled_post_id: null,
          });
          if (!PENDING_GROUPS.has(canonical)) continue; // skip planned/generating/terminal noise
          const badge = CANONICAL_BADGE[canonical];
          events.push({
            date: dateStr,
            platform: normalizePlatform(r.platform || ''),
            title: String(r.title || r.topic || 'Pending creator asset').trim(),
            repurpose_index: 1,
            repurpose_total: 1,
            campaign_id: r.campaign_id || '',
            content_type: String(r.content_type || 'post').trim(),
            scheduled_post_id: null as any,
            execution_id: null,
            status: 'pending',
            canonical_state: canonical,
            canonical_badge: badge.short, // 'P' for PENDING_CREATOR
            canonical_label: badge.label, // 'Pending creator asset'
            canonical_group: badge.group, // 'pending'
            pending: true,
            scheduled_for: null,
            is_overdue: false,
            content: null,
            media_urls: [],
            media_types: [],
          } as any);
        }
      } catch (pendErr: any) {
        // Never let pending-visibility break the existing calendar.
        console.warn('[calendar/activity-events] pending visibility skipped:', pendErr?.message);
      }
    }

    return res.status(200).json(events);
  } catch (err: any) {
    console.error('[calendar/activity-events]', err);
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
}
