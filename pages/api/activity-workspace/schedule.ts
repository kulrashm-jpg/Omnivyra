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
import { resolveUserContext } from '@/backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Resolve current user — required for user_id field on scheduled_posts
  let userId: string;
  try {
    const ctx = await resolveUserContext(req);
    userId = ctx.userId;
    if (!userId || userId === 'anon') {
      return res.status(401).json({ error: 'Authentication required' });
    }
  } catch {
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

  if (!campaignId || !platform || !content || !scheduledDate) {
    return res.status(400).json({ error: 'campaignId, platform, content, and scheduledDate are required' });
  }

  // Resolve companyId from campaign_versions when the workspace payload didn't supply it
  if (!companyId) {
    const { data: cv } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    companyId = cv?.company_id || '';
  }

  const timeStr =
    typeof scheduledTime === 'string' && /^\d{2}:\d{2}/.test(scheduledTime) ? scheduledTime : '09:00';
  // Build UTC timestamp so calendar date-range queries (which use UTC bounds) match correctly
  const scheduledFor = new Date(`${scheduledDate}T${timeStr}:00Z`);
  if (Number.isNaN(scheduledFor.getTime())) {
    return res.status(400).json({ error: 'Invalid scheduledDate' });
  }

  const platformNorm = String(platform).toLowerCase().trim();
  const executionIdStr = String(executionId || '').trim();

  // Try to resolve a connected social account for this platform.
  // Falls back to any active social account for the user when no platform-specific one exists.
  // This ensures social_account_id is populated even before the DDL migration makes it nullable.
  let socialAccountId: string | null = null;
  try {
    // 1. Platform-specific lookup
    const platformAlias = platformNorm === 'x' ? 'twitter' : platformNorm;
    let accountQ = supabase
      .from('social_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .in('platform', [platformNorm, platformAlias]);
    if (companyId) {
      accountQ = (accountQ as any).or(`company_id.eq.${companyId},company_id.is.null`);
    }
    const { data: acct } = await accountQ.limit(1).maybeSingle();
    socialAccountId = acct?.id ?? null;

    // 2. Fallback: any active social account for this user (satisfies NOT NULL until migration applied)
    if (!socialAccountId) {
      const { data: fallback } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      socialAccountId = fallback?.id ?? null;
    }
  } catch {
    // Non-fatal
  }

  // If no real social account exists yet, upsert a planning placeholder so the NOT NULL
  // constraint on scheduled_posts.social_account_id is satisfied without requiring a migration.
  // Planning placeholders are marked is_active=false so they are ignored by publishing workers.
  if (!socialAccountId) {
    try {
      const placeholderPlatformUserId = `planning_${userId}_${platformNorm}`;
      const { data: existing } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('platform', platformNorm)
        .eq('platform_user_id', placeholderPlatformUserId)
        .maybeSingle();

      if (existing?.id) {
        socialAccountId = existing.id;
      } else {
        const { data: created } = await supabase
          .from('social_accounts')
          .insert({
            user_id: userId,
            platform: platformNorm,
            platform_user_id: placeholderPlatformUserId,
            account_name: `[Planning] ${platformNorm}`,
            is_active: false,
          })
          .select('id')
          .single();
        socialAccountId = created?.id ?? null;
      }
    } catch {
      // Ignore — if placeholder creation fails we'll hit the DB constraint below
    }
  }

  if (!socialAccountId) {
    return res.status(422).json({
      error: 'Could not resolve a social account. Run: ALTER TABLE scheduled_posts ALTER COLUMN social_account_id DROP NOT NULL;',
    });
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    campaign_id: campaignId,
    platform: platformNorm,
    content_type: String(contentType || 'post').toLowerCase().trim(),
    title: String(title || '').trim() || null,
    content: String(content).trim(),
    scheduled_for: scheduledFor.toISOString(),
    status: 'scheduled',
    repurpose_parent_execution_id: executionIdStr || null,
    repurpose_index: Number.isFinite(Number(repurposeIndex)) ? Number(repurposeIndex) : 1,
    repurpose_total: Number.isFinite(Number(repurposeTotal)) ? Number(repurposeTotal) : 1,
    social_account_id: socialAccountId,
  };

  try {
    let scheduledPostId: string | null = null;

    // Idempotent: update existing post if same execution_id + platform already exists
    if (executionIdStr) {
      const { data: existing } = await supabase
        .from('scheduled_posts')
        .select('id')
        .eq('repurpose_parent_execution_id', executionIdStr)
        .eq('platform', platformNorm)
        .maybeSingle();

      if (existing?.id) {
        const { error: updateErr } = await supabase
          .from('scheduled_posts')
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (updateErr) {
          console.error('[activity-workspace/schedule] update error:', updateErr);
          return res.status(500).json({ error: updateErr.message });
        }
        scheduledPostId = existing.id;
      }
    }

    if (!scheduledPostId) {
      const { data: inserted, error: insertErr } = await supabase
        .from('scheduled_posts')
        .insert(row)
        .select('id')
        .single();
      if (insertErr) {
        console.error('[activity-workspace/schedule] insert error:', insertErr);
        return res.status(500).json({ error: insertErr.message });
      }
      scheduledPostId = inserted?.id ?? null;
    }

    return res.status(200).json({ success: true, scheduled_post_id: scheduledPostId });
  } catch (err: any) {
    console.error('[activity-workspace/schedule]', err);
    return res.status(500).json({ error: err?.message || 'Failed to schedule post' });
  }
}
