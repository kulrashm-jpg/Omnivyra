/**
 * POST /api/activity-workspace/schedule
 * Saves a finalized platform variant as a scheduled_posts row so it appears on the dashboard calendar.
 * If a post already exists for the same execution_id + platform, it is updated in place (idempotent).
 *
 * Falls back to any active social_account for the user when no platform-specific one is found,
 * so inserts succeed even before the social_account_id NOT NULL column is relaxed via DDL.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { enqueueScheduledPostAt } from '@/backend/scheduler/schedulerService';
import { grantEarnCredit } from '@/backend/services/earnCreditsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[schedule] method:', req.method, 'url:', req.url);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method not allowed: ${req.method}` });
  }

  // Resolve current user — always use the real Supabase JWT user ID
  // (resolveUserContext can return 'content_architect' for platform-level sessions,
  // which has no social_accounts and cannot schedule posts on behalf of a real user)
  let userId: string;
  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (error || !user?.id) {
      console.warn('[schedule] unauthenticated request');
      return res.status(401).json({ error: 'Authentication required' });
    }
    userId = user.id;
    console.log('[schedule] resolved userId:', userId);
  } catch (authErr) {
    console.error('[schedule] auth error:', authErr);
    return res.status(401).json({ error: 'Authentication required' });
  }

  const {
    executionId,
    platform,
    contentType,
    title,
    content,
    scheduledDate,
    scheduledTime,
    repurposeIndex,
    repurposeTotal,
  } = req.body || {};

  let campaignId: string = String(req.body?.campaignId || '').trim();
  let companyId: string = String(req.body?.companyId || '').trim();

  console.log('[schedule] body:', { campaignId, platform, content: content?.slice?.(0,30), scheduledDate, executionId });

  if (!campaignId || !platform || !content || !scheduledDate) {
    return res.status(400).json({ error: 'campaignId, platform, content, and scheduledDate are required' });
  }

  // Resolve companyId from campaign_versions when the workspace payload didn't supply it
  if (!companyId) {
    const { data: cv, error: cvErr } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cvErr) console.warn('[schedule] companyId lookup error:', cvErr);
    companyId = cv?.company_id || '';
    console.log('[schedule] resolved companyId:', companyId);
  }

  const timeStr =
    typeof scheduledTime === 'string' && /^\d{2}:\d{2}/.test(scheduledTime) ? scheduledTime : '09:00';
  // Build UTC timestamp so calendar date-range queries (which use UTC bounds) match correctly
  const scheduledFor = new Date(`${scheduledDate}T${timeStr}:00Z`);
  if (Number.isNaN(scheduledFor.getTime())) {
    return res.status(400).json({ error: 'Invalid scheduledDate' });
  }

  // Normalise 'x' → 'twitter' for DB storage (chk_platform constraint only allows 'twitter')
  const platformNorm = String(platform).toLowerCase().trim() === 'x' ? 'twitter' : String(platform).toLowerCase().trim();
  const executionIdStr = String(executionId || '').trim();

  // Try to resolve a connected social account for this platform.
  // Falls back to any active social account for the user when no platform-specific one exists.
  let socialAccountId: string | null = null;
  try {
    const platformAlias = platformNorm === 'x' ? 'twitter' : platformNorm;
    const isValidUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    // 1a. Platform + company_id scoped lookup (only when companyId is a valid UUID)
    if (!socialAccountId && companyId && isValidUuid(companyId)) {
      const { data, error } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .eq('company_id', companyId)
        .in('platform', [platformNorm, platformAlias])
        .limit(1)
        .maybeSingle();
      if (error) console.warn('[schedule] company-scoped account lookup error:', error.message);
      socialAccountId = data?.id ?? null;
    }

    // 1b. Platform lookup without company scope
    if (!socialAccountId) {
      const { data, error } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .in('platform', [platformNorm, platformAlias])
        .limit(1)
        .maybeSingle();
      if (error) console.warn('[schedule] platform account lookup error:', error.message);
      socialAccountId = data?.id ?? null;
    }

    console.log('[schedule] resolved socialAccountId:', socialAccountId);
  } catch (err) {
    console.warn('[schedule] social account resolution error:', err);
  }

  // socialAccountId may be null — social_account_id is nullable (patch-scheduled-posts-social-account-optional.sql).
  // Publishing workers check for a valid account before posting; UI shows a "Connect" warning badge.
  console.log('[schedule] inserting row with socialAccountId:', socialAccountId, 'campaignId:', campaignId);

  // campaign_id in scheduled_posts is UUID — only include if it looks like a valid UUID
  const isValidUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const campaignIdUuid = isValidUuid(campaignId) ? campaignId : null;
  if (!campaignIdUuid) console.warn('[schedule] campaignId is not a valid UUID, skipping campaign_id column:', campaignId);

  // Base row — columns guaranteed to exist in the initial schema
  const baseRow: Record<string, unknown> = {
    user_id: userId,
    campaign_id: campaignIdUuid,
    platform: platformNorm,
    content_type: (() => {
      const ct = String(contentType || 'post').toLowerCase().trim();
      // Normalise aliases to values accepted by chk_content_type constraint
      if (ct === 'feed_post') return 'post';
      if (ct === 'tweet') return 'tweet';
      return ct;
    })(),
    title: String(title || '').trim() || null,
    content: String(content).trim(),
    scheduled_for: scheduledFor.toISOString(),
    status: 'scheduled',
    social_account_id: socialAccountId,
  };

  // Repurpose lineage columns — added by scheduled_posts_repurpose_lineage.sql migration.
  // Only include them when the migration has been applied (detected by insert error on first attempt).
  const repurposeExtras: Record<string, unknown> = {
    repurpose_parent_execution_id: executionIdStr || null,
    repurpose_index: Number.isFinite(Number(repurposeIndex)) ? Number(repurposeIndex) : 1,
    repurpose_total: Number.isFinite(Number(repurposeTotal)) ? Number(repurposeTotal) : 1,
  };

  const tryInsert = async (row: Record<string, unknown>) => {
    return supabase.from('scheduled_posts').insert(row).select('id').single();
  };

  const tryUpdate = async (id: string, row: Record<string, unknown>) => {
    return supabase
      .from('scheduled_posts')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', id);
  };

  try {
    let scheduledPostId: string | null = null;
    const fullRow = { ...baseRow, ...repurposeExtras };

    // --- Deduplication strategy 1: campaign_id + platform + title ---
    // This catches re-scheduling the same topic on the same platform (columns always exist).
    const titleNorm = String(title || '').trim();
    if (campaignIdUuid && titleNorm) {
      try {
        const { data: existing } = await supabase
          .from('scheduled_posts')
          .select('id')
          .eq('campaign_id', campaignIdUuid)
          .eq('platform', platformNorm)
          .eq('title', titleNorm)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existing?.id) {
          console.log('[schedule] dedup match (campaign+platform+title), updating:', existing.id);
          const { error: updateErr } = await tryUpdate(existing.id, fullRow);
          if (updateErr) {
            const isSchemaErr = updateErr.message?.includes('column') || updateErr.code === '42703'
              || updateErr.message?.includes('operator does not exist') || updateErr.code === '42883';
            if (isSchemaErr) {
              console.warn('[schedule] schema mismatch on update, retrying without repurpose extras:', updateErr.message);
              const { error: retryErr } = await tryUpdate(existing.id, baseRow);
              if (retryErr) {
                console.error('[activity-workspace/schedule] update retry error:', retryErr);
                return res.status(500).json({ error: retryErr.message });
              }
            } else {
              console.error('[activity-workspace/schedule] update error:', updateErr);
              return res.status(500).json({ error: updateErr.message });
            }
          }
          scheduledPostId = existing.id;
        }
      } catch (lookupErr: any) {
        console.warn('[schedule] campaign+platform+title lookup failed:', lookupErr?.message);
      }
    }

    // --- Deduplication strategy 2: repurpose_parent_execution_id + platform (legacy fallback) ---
    if (!scheduledPostId && executionIdStr) {
      try {
        const { data: existing } = await supabase
          .from('scheduled_posts')
          .select('id')
          .eq('repurpose_parent_execution_id', executionIdStr)
          .eq('platform', platformNorm)
          .maybeSingle();

        if (existing?.id) {
          console.log('[schedule] dedup match (repurpose_id+platform), updating:', existing.id);
          const { error: updateErr } = await tryUpdate(existing.id, fullRow);
          if (updateErr) {
            // Retry without repurpose extras for: missing column (42703), type operator errors (42883)
            const isSchemaErr = updateErr.message?.includes('column') || updateErr.code === '42703'
              || updateErr.message?.includes('operator does not exist') || updateErr.code === '42883';
            if (isSchemaErr) {
              console.warn('[schedule] schema mismatch on update, retrying without repurpose extras:', updateErr.message);
              const { error: retryErr } = await tryUpdate(existing.id, baseRow);
              if (retryErr) {
                console.error('[activity-workspace/schedule] update retry error:', retryErr);
                return res.status(500).json({ error: retryErr.message });
              }
            } else {
              console.error('[activity-workspace/schedule] update error:', updateErr);
              return res.status(500).json({ error: updateErr.message });
            }
          }
          scheduledPostId = existing.id;
        }
      } catch (lookupErr: any) {
        // repurpose_parent_execution_id column doesn't exist — skip idempotency check
        console.warn('[schedule] repurpose lookup failed (column may not exist):', lookupErr?.message);
      }
    }

    if (!scheduledPostId) {
      let { data: inserted, error: insertErr } = await tryInsert(fullRow);

      // Retry without repurpose extras for: missing column (42703), type operator errors (42883)
      if (insertErr && (insertErr.message?.includes('column') || insertErr.code === '42703'
        || insertErr.message?.includes('operator does not exist') || insertErr.code === '42883')) {
        console.warn('[schedule] schema mismatch on insert, retrying without repurpose extras:', insertErr.message);
        const retry = await tryInsert(baseRow);
        inserted = retry.data;
        insertErr = retry.error;
      }

      if (insertErr) {
        console.error('[activity-workspace/schedule] insert error:', {
          code: insertErr.code,
          message: insertErr.message,
          details: (insertErr as any).details,
          hint: (insertErr as any).hint,
        });
        return res.status(500).json({ error: insertErr.message });
      }
      scheduledPostId = inserted?.id ?? null;
    }

    // Enqueue the job to fire at the exact scheduled_for time.
    // Falls back gracefully: duplicate → already queued, past → safety-net cron handles it.
    if (scheduledPostId) {
      try {
        await enqueueScheduledPostAt(
          scheduledPostId,
          userId,
          String(socialAccountId ?? ''),
          scheduledFor.toISOString(),
        );
      } catch (enqErr: any) {
        // Non-fatal: the 4-hour safety-net cron will recover missed posts
        console.warn('[schedule] enqueueScheduledPostAt failed (non-fatal):', enqErr?.message);
      }
    }

    // ── First campaign published → +200 credits (fire-and-forget) ────────────
    if (scheduledPostId && companyId) {
      grantEarnCredit({
        orgId:       companyId,
        userId,
        actionType:  'first_campaign_published',
        referenceId: companyId,   // one grant per org, referenceId = orgId
      }).catch(e => console.warn('[schedule] earn-credit grant failed (non-fatal):', e?.message));
    }

    return res.status(200).json({ success: true, scheduled_post_id: scheduledPostId });
  } catch (err: any) {
    console.error('[activity-workspace/schedule]', err);
    return res.status(500).json({ error: err?.message || 'Failed to schedule post' });
  }
}
