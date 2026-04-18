/**
 * Analytics Normalization Service
 *
 * Translates raw platform ingestion results into canonical DB rows:
 *  - content_analytics (per-post engagement snapshot)
 *  - platform_metrics_snapshots (per-account daily growth snapshot)
 *
 * All writes use upsert to be idempotent — safe to re-run.
 */

import { supabase } from '../db/supabaseClient';
import type { RawPostMetrics, AccountGrowthMetrics } from './platformAnalyticsIngester';

// ─────────────────────────────────────────────────────────────────────────────
// Post analytics upsert
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedPostAnalytics {
  scheduled_post_id: string;
  user_id?:          string;
  platform:          string;
  analytics_date:    string;       // YYYY-MM-DD
  metrics:           RawPostMetrics;
}

export async function upsertPostAnalytics(row: NormalizedPostAnalytics): Promise<void> {
  const m = row.metrics;
  const totalEngagement =
    m.likes + m.comments + m.shares + (m.saves ?? 0) + (m.reactions ?? 0);
  const engagementRate =
    m.reach > 0 ? parseFloat(((totalEngagement / m.reach) * 100).toFixed(4)) : 0;

  const { error } = await supabase
    .from('content_analytics')
    .upsert(
      {
        scheduled_post_id: row.scheduled_post_id,
        user_id:           row.user_id ?? null,
        platform:          row.platform,
        analytics_date:    row.analytics_date,
        // legacy 'date' column kept in sync
        date:              row.analytics_date,
        content_type:      'post',
        views:             m.views,
        likes:             m.likes,
        shares:            m.shares,
        comments:          m.comments,
        saves:             m.saves,
        reactions:         m.reactions,
        engagement_rate:   engagementRate,
        reach:             m.reach,
        impressions:       m.impressions,
        platform_metrics:  m.raw,
        updated_at:        new Date().toISOString(),
      },
      { onConflict: 'scheduled_post_id,analytics_date' },
    );

  if (error) {
    console.error('[analyticsNormalization] upsertPostAnalytics failed:', error.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Growth snapshot upsert
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedGrowthSnapshot {
  company_id:        string;
  social_account_id?: string;
  platform:          string;
  growth:            Partial<AccountGrowthMetrics>;
  captured_at?:      string; // ISO; defaults to now()
}

export async function upsertGrowthSnapshot(row: NormalizedGrowthSnapshot): Promise<void> {
  const capturedAt   = row.captured_at ?? new Date().toISOString();
  const capturedDate = capturedAt.split('T')[0]; // YYYY-MM-DD — matches captured_date column

  const { error } = await supabase
    .from('platform_metrics_snapshots')
    .upsert(
      {
        company_id:        row.company_id,
        social_account_id: row.social_account_id ?? null,
        platform:          row.platform,
        followers:         row.growth.followers ?? 0,
        follower_gain:     row.growth.follower_gain ?? 0,
        engagement_rate:   null,
        impressions:       row.growth.impressions ?? 0,
        reach:             row.growth.reach ?? 0,
        raw_metrics:       row.growth.raw ?? {},
        captured_at:       capturedAt,
        captured_date:     capturedDate,
      },
      // Unique index is on (company_id, platform, captured_date)
      { onConflict: 'company_id,platform,captured_date', ignoreDuplicates: false },
    );

  if (error) {
    // Duplicate-key on the partial unique index is acceptable (same-day re-run)
    if (!error.message?.includes('duplicate') && !error.message?.includes('unique')) {
      console.error('[analyticsNormalization] upsertGrowthSnapshot failed:', error.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mark poll as done / failed
// ─────────────────────────────────────────────────────────────────────────────

export async function markPollDone(pollId: string): Promise<void> {
  await supabase
    .from('post_analytics_polls')
    .update({ status: 'done', last_polled_at: new Date().toISOString() })
    .eq('id', pollId);
}

export async function markPollFailed(pollId: string, attempts: number): Promise<void> {
  const newStatus = attempts >= 3 ? 'failed' : 'pending';
  await supabase
    .from('post_analytics_polls')
    .update({
      status:         newStatus,
      last_polled_at: new Date().toISOString(),
      attempts,
    })
    .eq('id', pollId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule polls after publish
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert two post_analytics_polls rows after a successful publish:
 *  - 15 min  after publish  (fast feedback)
 *  - 24 h    after publish  (stable daily metrics)
 */
export async function schedulePostPolls(opts: {
  scheduledPostId:  string;
  socialAccountId?: string;
  platform:         string;
  platformPostId:   string;
  companyId:        string;
  userId?:          string;
}): Promise<void> {
  const now = Date.now();
  const rows = [
    { ...opts, poll_after: new Date(now + 15 * 60 * 1000).toISOString() },
    { ...opts, poll_after: new Date(now + 24 * 60 * 60 * 1000).toISOString() },
  ].map((r) => ({
    scheduled_post_id: r.scheduledPostId,
    social_account_id: r.socialAccountId ?? null,
    platform:          r.platform,
    platform_post_id:  r.platformPostId,
    company_id:        r.companyId,
    user_id:           r.userId ?? null,
    poll_after:        r.poll_after,
    status:            'pending',
  }));

  const { error } = await supabase.from('post_analytics_polls').insert(rows);
  if (error) {
    console.warn('[schedulePostPolls] insert failed:', error.message);
  }
}
