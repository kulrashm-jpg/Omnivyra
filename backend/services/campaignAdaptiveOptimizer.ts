/**
 * Campaign Adaptive Optimizer
 *
 * Analyzes campaign_performance_signals for completed weeks and returns distribution
 * adjustments for remaining weeks. Increases allocation to high-performing platforms,
 * content types, and themes; reduces low performers. Adjustments are capped at ±20%
 * of original distribution to maintain strategic consistency.
 *
 * Trigger: After each week-level batch completes in BOLT pipeline.
 * Used when extending campaigns or regenerating remaining weeks with performance data.
 */

import { supabase } from '../db/supabaseClient';

const MAX_ADJUSTMENT_PCT = 0.2; // ±20% of original distribution
const MIN_SIGNALS_FOR_ADJUSTMENT = 2;
const TOP_PERFORMERS_LIMIT = 3;
const LOW_PERFORMERS_LIMIT = 2;

export type AdaptivePerformanceInsights = {
  high_performing_platforms: Array<{ value: string; avgEngagement: number; signalCount: number }>;
  high_performing_content_types: Array<{ value: string; avgEngagement: number; signalCount: number }>;
  low_performing_patterns: Array<{ platform?: string; content_type?: string; theme?: string; reason: string }>;
};

export type CampaignAdaptiveOptimizerInput = {
  campaignId: string;
  companyId: string;
  /** Weeks already completed (with performance signals). */
  completedWeeks: number[];
  /** Optional pre-fetched signals; otherwise queried. */
  performanceSignals?: Array<{
    platform?: string | null;
    content_type?: string | null;
    theme?: string | null;
    engagement?: number;
    impressions?: number;
    week_number?: number | null;
  }>;
};

/**
 * Analyze campaign performance signals and return distribution adjustments
 * for remaining weeks. Adjustments respect ±20% constraint.
 */
export async function getAdaptiveDistributionAdjustments(
  input: CampaignAdaptiveOptimizerInput
): Promise<AdaptivePerformanceInsights> {
  const { campaignId, companyId, completedWeeks, performanceSignals: providedSignals } = input;

  if (completedWeeks.length === 0) {
    return {
      high_performing_platforms: [],
      high_performing_content_types: [],
      low_performing_patterns: [],
    };
  }

  let signals = providedSignals;

  if (!signals || signals.length === 0) {
    const { data, error } = await supabase
      .from('campaign_performance_signals')
      .select('platform, content_type, theme, engagement, impressions, week_number')
      .eq('company_id', companyId)
      .eq('campaign_id', campaignId)
      .in('week_number', completedWeeks)
      .not('engagement', 'is', null);

    if (error || !data?.length) {
      return {
        high_performing_platforms: [],
        high_performing_content_types: [],
        low_performing_patterns: [],
      };
    }

    signals = data as typeof signals;
  }

  const byPlatform = new Map<string, number[]>();
  const byContentType = new Map<string, number[]>();
  const byTheme = new Map<string, number[]>();

  for (const row of signals) {
    const eng = Number(row.engagement ?? 0) || 0;
    if (row.platform && String(row.platform).trim()) {
      const arr = byPlatform.get(String(row.platform).trim().toLowerCase()) ?? [];
      arr.push(eng);
      byPlatform.set(String(row.platform).trim().toLowerCase(), arr);
    }
    if (row.content_type && String(row.content_type).trim()) {
      const arr = byContentType.get(String(row.content_type).trim().toLowerCase()) ?? [];
      arr.push(eng);
      byContentType.set(String(row.content_type).trim().toLowerCase(), arr);
    }
    if (row.theme && String(row.theme).trim()) {
      const arr = byTheme.get(String(row.theme).trim()) ?? [];
      arr.push(eng);
      byTheme.set(String(row.theme).trim(), arr);
    }
  }

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const platformInsights = Array.from(byPlatform.entries())
    .filter(([, arr]) => arr.length >= MIN_SIGNALS_FOR_ADJUSTMENT)
    .map(([value, arr]) => ({ value, avgEngagement: avg(arr), signalCount: arr.length }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
    .slice(0, TOP_PERFORMERS_LIMIT)
    .map((p) => ({
      value: p.value,
      avgEngagement: Math.min(p.avgEngagement * (1 + MAX_ADJUSTMENT_PCT), p.avgEngagement * 1.2),
      signalCount: p.signalCount,
    }));

  const contentTypeInsights = Array.from(byContentType.entries())
    .filter(([, arr]) => arr.length >= MIN_SIGNALS_FOR_ADJUSTMENT)
    .map(([value, arr]) => ({ value, avgEngagement: avg(arr), signalCount: arr.length }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
    .slice(0, TOP_PERFORMERS_LIMIT)
    .map((p) => ({
      value: p.value,
      avgEngagement: Math.min(p.avgEngagement * (1 + MAX_ADJUSTMENT_PCT), p.avgEngagement * 1.2),
      signalCount: p.signalCount,
    }));

  const globalAvg =
    signals.length > 0
      ? signals.reduce((s, r) => s + (Number(r.engagement ?? 0) || 0), 0) / signals.length
      : 0;

  const lowPatterns: AdaptivePerformanceInsights['low_performing_patterns'] = [];

  for (const [platform, arr] of byPlatform) {
    if (arr.length < MIN_SIGNALS_FOR_ADJUSTMENT) continue;
    const a = avg(arr);
    if (a < globalAvg * (1 - MAX_ADJUSTMENT_PCT)) {
      lowPatterns.push({
        platform,
        reason: `Below-average engagement on ${platform} in completed weeks`,
      });
    }
  }
  for (const [content_type, arr] of byContentType) {
    if (arr.length < MIN_SIGNALS_FOR_ADJUSTMENT) continue;
    const a = avg(arr);
    if (a < globalAvg * (1 - MAX_ADJUSTMENT_PCT)) {
      lowPatterns.push({
        content_type,
        reason: `Below-average engagement on ${content_type} in completed weeks`,
      });
    }
  }

  return {
    high_performing_platforms: platformInsights.slice(0, TOP_PERFORMERS_LIMIT),
    high_performing_content_types: contentTypeInsights.slice(0, TOP_PERFORMERS_LIMIT),
    low_performing_patterns: lowPatterns.slice(0, LOW_PERFORMERS_LIMIT),
  };
}
