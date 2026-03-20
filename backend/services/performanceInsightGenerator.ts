/**
 * Performance Insight Generator — closes the performance → planning feedback loop.
 *
 * Aggregates performance_feedback rows for a campaign and returns structured
 * insights (strengths, weaknesses, recommendations) that are injected into the
 * next campaign planning prompt via `previous_performance_insights`.
 */

import { supabase } from '../db/supabaseClient';

export type PerformanceInsights = {
  campaign_id: string;
  /** Content types / platforms that over-performed (engagement_rate above average). */
  strengths: string[];
  /** Content types / platforms that under-performed. */
  weaknesses: string[];
  /** Carry-forward recommendations for the next campaign. */
  recommendations: string[];
  /** Platform with the highest average engagement rate. */
  platform_bias: string | null;
  /** Content type with the highest average engagement rate. */
  content_type_bias: string | null;
  /** Overall average engagement rate across all posts. */
  avg_engagement_rate: number;
  /** Issues list (alias for weaknesses — matches PlanningGenerationInput shape). */
  issues: string[];
  /** Opportunities list (alias for strengths — matches PlanningGenerationInput shape). */
  opportunities: string[];
};

type FeedbackRow = {
  platform: string;
  content_type?: string | null;
  engagement_rate: number;
  impressions: number;
  likes: number;
  shares: number;
  comments: number;
  clicks: number;
};

const ENGAGEMENT_WEAK_THRESHOLD = 0.01;  // < 1% = under-performing
const ENGAGEMENT_STRONG_THRESHOLD = 0.05; // > 5% = over-performing

export async function generatePerformanceInsights(
  campaignId: string
): Promise<PerformanceInsights | null> {
  try {
    const { data: rows, error } = await supabase
      .from('performance_feedback')
      .select('platform, content_type, engagement_rate, impressions, likes, shares, comments, clicks')
      .eq('campaign_id', campaignId);

    if (error || !rows || rows.length === 0) return null;

    const feedback = rows as FeedbackRow[];

    // ── Per-platform aggregation ─────────────────────────────────────────────
    const byPlatform: Record<string, { total: number; count: number }> = {};
    for (const row of feedback) {
      const p = String(row.platform || 'unknown').toLowerCase();
      if (!byPlatform[p]) byPlatform[p] = { total: 0, count: 0 };
      byPlatform[p].total += row.engagement_rate ?? 0;
      byPlatform[p].count += 1;
    }
    const platformAvg: Record<string, number> = {};
    for (const [p, agg] of Object.entries(byPlatform)) {
      platformAvg[p] = agg.count > 0 ? agg.total / agg.count : 0;
    }

    // ── Per-content-type aggregation ─────────────────────────────────────────
    const byType: Record<string, { total: number; count: number }> = {};
    for (const row of feedback) {
      const ct = String(row.content_type || 'post').toLowerCase();
      if (!byType[ct]) byType[ct] = { total: 0, count: 0 };
      byType[ct].total += row.engagement_rate ?? 0;
      byType[ct].count += 1;
    }
    const typeAvg: Record<string, number> = {};
    for (const [ct, agg] of Object.entries(byType)) {
      typeAvg[ct] = agg.count > 0 ? agg.total / agg.count : 0;
    }

    // ── Overall average ──────────────────────────────────────────────────────
    const avgEngagementRate = feedback.reduce((s, r) => s + (r.engagement_rate ?? 0), 0) / feedback.length;

    // ── Bias detection (top performer) ──────────────────────────────────────
    const platformBias = Object.entries(platformAvg).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
    const contentTypeBias = Object.entries(typeAvg).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

    // ── Strengths / weaknesses ───────────────────────────────────────────────
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    for (const [p, avg] of Object.entries(platformAvg)) {
      const pct = (avg * 100).toFixed(1);
      if (avg >= ENGAGEMENT_STRONG_THRESHOLD) {
        strengths.push(`${p} posts averaged ${pct}% engagement — high-performing channel`);
      } else if (avg < ENGAGEMENT_WEAK_THRESHOLD) {
        weaknesses.push(`${p} posts averaged ${pct}% engagement — under-performing, reduce frequency or change content type`);
      }
    }

    for (const [ct, avg] of Object.entries(typeAvg)) {
      const pct = (avg * 100).toFixed(1);
      if (avg >= ENGAGEMENT_STRONG_THRESHOLD) {
        strengths.push(`${ct} content averaged ${pct}% engagement — increase allocation`);
      } else if (avg < ENGAGEMENT_WEAK_THRESHOLD) {
        weaknesses.push(`${ct} content averaged ${pct}% engagement — reduce or reformulate`);
      }
    }

    // ── Recommendations ──────────────────────────────────────────────────────
    const recommendations: string[] = [];

    if (platformBias) {
      recommendations.push(`Increase posting frequency on ${platformBias} — highest average engagement`);
    }
    if (contentTypeBias) {
      recommendations.push(`Prioritise ${contentTypeBias} format — best engagement-per-post`);
    }

    const weakPlatforms = Object.entries(platformAvg)
      .filter(([, avg]) => avg < ENGAGEMENT_WEAK_THRESHOLD)
      .map(([p]) => p);
    if (weakPlatforms.length > 0) {
      recommendations.push(`Consider pausing or reducing ${weakPlatforms.join(', ')} — consistently low engagement`);
    }

    if (avgEngagementRate < ENGAGEMENT_WEAK_THRESHOLD) {
      recommendations.push('Overall engagement is low — review hook quality, posting times, and CTA strength across all posts');
    } else if (avgEngagementRate >= ENGAGEMENT_STRONG_THRESHOLD) {
      recommendations.push('Strong overall engagement — maintain current content strategy and consider scaling spend');
    }

    return {
      campaign_id: campaignId,
      strengths,
      weaknesses,
      recommendations,
      platform_bias: platformBias,
      content_type_bias: contentTypeBias,
      avg_engagement_rate: Number(avgEngagementRate.toFixed(4)),
      issues: weaknesses,
      opportunities: strengths,
    };
  } catch (err) {
    console.warn('[performanceInsightGenerator] Failed to generate insights', err);
    return null;
  }
}
