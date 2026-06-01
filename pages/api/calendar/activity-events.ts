
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
import { isSupportedManualVideoUpload } from '../../../lib/shared/contentTypeClassification';

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

    // ── ASSET TYPE LOOKUP (calendar content-type fix) ────────────────────────
    // scheduled_posts.content_type holds the PLATFORM-NATIVE value (e.g.
    // `tweet` / `post` / `feed_post` / `pin` / `reel`), not the user-selected
    // canonical asset type (`post` / `poll` / `article` / `story` / `carousel`
    // / `reel` / `image`). That normalization happens inside
    // boltScheduleBlockProcessor (toDbContentType → FALLBACK_CT_MAP) so the
    // chk_content_type DB constraint is satisfied. It is also the reason every
    // calendar card was rendering "Post": for X every asset maps to `tweet`,
    // for LinkedIn polls/carousels map to `post`, etc. — so the card title
    // looked identical regardless of the format the user actually picked.
    //
    // To surface the user-selected asset on the calendar without changing the
    // stored scheduled_posts shape, we look up the matching daily_content_plans
    // row (FK: daily_content_plans.scheduled_post_id) and emit the original
    // `content_type` as `asset_type`. The renderer prefers `asset_type` and
    // falls back to `content_type` for legacy events (pre-FK rows, ad-hoc
    // standalone posts) so nothing breaks.
    const assetTypeByPostId = new Map<string, string>();
    const scheduledPostIds = posts
      .map((p) => p?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (scheduledPostIds.length > 0) {
      try {
        // Chunked to keep the IN-list size bounded; .in() with 1000+ values
        // can blow past PostgREST query-string limits.
        const CHUNK = 500;
        for (let i = 0; i < scheduledPostIds.length; i += CHUNK) {
          const chunk = scheduledPostIds.slice(i, i + CHUNK);
          const { data: planRows } = await supabase
            .from('daily_content_plans')
            .select('scheduled_post_id, content_type')
            .in('scheduled_post_id', chunk);
          for (const row of planRows || []) {
            const spid = (row as any)?.scheduled_post_id;
            const ct = (row as any)?.content_type;
            if (typeof spid === 'string' && spid && typeof ct === 'string' && ct.trim()) {
              assetTypeByPostId.set(spid, ct.trim().toLowerCase());
            }
          }
        }
      } catch (lookupErr: any) {
        // Never let asset-type enrichment break the calendar — fall back to
        // platform-native content_type for affected events.
        console.warn('[calendar/activity-events] asset_type lookup skipped:', lookupErr?.message);
      }
    }

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
      const platformNativeType = String(row.content_type || 'post').trim();
      // asset_type is the user-selected canonical format (post/poll/article/story/…)
      // sourced from daily_content_plans. Falls back to the platform-native type
      // when there is no matching plan row (standalone posts, legacy data).
      const assetType = (row.id && assetTypeByPostId.get(row.id)) || platformNativeType;
      return {
        date: dateStr,
        platform: normalizePlatform(row.platform),
        title: String(title).trim() || 'Scheduled post',
        repurpose_index: row.repurpose_index != null ? Number(row.repurpose_index) : 1,
        repurpose_total: row.repurpose_total != null ? Number(row.repurpose_total) : 1,
        campaign_id: row.campaign_id || '',
        content_type: platformNativeType,
        asset_type: assetType,
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
          .select('id, campaign_id, platform, content_type, content_status, content, scheduled_post_id, title, topic, date, scheduled_time, execution_id')
          .in('campaign_id', campaignIdFilter && campaignIds.includes(campaignIdFilter) ? [campaignIdFilter] : campaignIds)
          .is('scheduled_post_id', null);
        if (!stageFilter) {
          pq = pq.gte('date', start).lte('date', end);
        }
        const { data: pendingRows } = await pq.limit(2000);
        for (const r of pendingRows || []) {
          const dateStr = typeof r.date === 'string' ? r.date.slice(0, 10) : '';
          if (!dateStr) continue;
          const canonical = resolveCanonicalState({
            content_status: r.content_status,
            content: r.content,
            scheduled_post_id: null,
          });
          // SEMANTIC FIX: pending visibility is ONLY for genuine manual
          // video-upload tasks. A row is emitted as pending iff it is
          // canonical PENDING_CREATOR *and* its content type is a
          // supported manual video upload (reel/short/video). This makes
          // it structurally impossible for image / carousel / text+image
          // (AI-generated) to ever render with a [PENDING] badge — they
          // are excluded here and surface via their own ready/scheduled
          // state, not the pending feed. No READY_FOR_REVIEW /
          // READY_FOR_SCHEDULE rows enter the pending feed anymore.
          if (
            canonical !== CanonicalContentState.PENDING_CREATOR ||
            !isSupportedManualVideoUpload(r.content_type)
          ) {
            continue;
          }
          const badge = CANONICAL_BADGE[canonical];
          const pendingType = String(r.content_type || 'post').trim();
          // Enrich the WAITING_FOR_ASSET card so it can show a brief + CTA +
          // scheduled time + an upload deep-link (daily_plan_id). All derived
          // from the row's creator guidance content; never throws.
          const pendingContent = (r.content && typeof r.content === 'object' && !Array.isArray(r.content))
            ? r.content as Record<string, any>
            : (() => { try { return JSON.parse(String(r.content || '')); } catch { return {}; } })();
          const themeTreatment = (pendingContent.theme_treatment && typeof pendingContent.theme_treatment === 'object') ? pendingContent.theme_treatment : {};
          const marketingPackage = (pendingContent.marketing_package && typeof pendingContent.marketing_package === 'object') ? pendingContent.marketing_package : {};
          const creatorGuidance = (pendingContent.creator_guidance && typeof pendingContent.creator_guidance === 'object') ? pendingContent.creator_guidance : {};
          const pendingBrief = String(
            themeTreatment.summary || themeTreatment.hook || pendingContent.summary || r.topic || ''
          ).trim() || null;
          const pendingCta = String(
            marketingPackage.cta || themeTreatment.CTA_direction || themeTreatment.cta || ''
          ).trim() || null;
          const pendingTime = String(r.scheduled_time || '').match(/^(\d{1,2}):(\d{2})/);
          const pendingScheduledFor = `${dateStr}T${pendingTime ? `${pendingTime[1].padStart(2, '0')}:${pendingTime[2]}` : '09:00'}:00`;
          events.push({
            date: dateStr,
            platform: normalizePlatform(r.platform || ''),
            title: String(r.title || r.topic || 'Awaiting Video Upload').trim(),
            repurpose_index: 1,
            repurpose_total: 1,
            campaign_id: r.campaign_id || '',
            content_type: pendingType,
            // Pending events come directly from daily_content_plans so the
            // canonical asset type is the same value as the row's content_type.
            asset_type: pendingType,
            scheduled_post_id: null as any,
            // daily_content_plans row id — drives the calendar card's
            // "Upload media" deep-link into the activity workspace.
            daily_plan_id: r.id,
            execution_id: r.execution_id || null,
            status: 'pending',
            canonical_state: canonical,
            canonical_badge: badge.short, // 'V' (Awaiting Video Upload)
            canonical_label: badge.label, // 'Awaiting Video Upload'
            canonical_group: badge.group, // 'pending' (video-upload only)
            pending: true,
            scheduled_for: pendingScheduledFor,
            is_overdue: false,
            content: pendingBrief,
            cta: pendingCta,
            // Structured VIDEO CREATION BRIEF — pending/video rows only, so
            // the drawer can render it inline (no extra screen / fetch).
            // Scheduled + BOLT Text branches never carry these.
            theme_treatment: themeTreatment,
            creator_guidance: creatorGuidance,
            marketing_package: marketingPackage,
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
