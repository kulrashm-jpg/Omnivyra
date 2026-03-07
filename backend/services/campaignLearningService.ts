/**
 * Campaign Learning Service
 *
 * Aggregates performance signals to identify high/low performing themes,
 * platforms, and content types. Used to influence future campaign strategy
 * without overriding trend intelligence.
 */

import { supabase } from '../db/supabaseClient';

const DEFAULT_LOOKBACK_DAYS = 90;
const MIN_SIGNALS_FOR_INSIGHT = 3;

export type PerformanceInsight = {
  value: string;
  avgEngagement: number;
  avgImpressions: number;
  signalCount: number;
  score: number;
};

export type LowPerformingPattern = {
  theme?: string;
  platform?: string;
  content_type?: string;
  avgEngagement: number;
  signalCount: number;
  reason: string;
};

/**
 * Get themes that perform well for the company (by engagement + impressions).
 */
export async function getHighPerformingThemes(
  companyId: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  limit = 10
): Promise<PerformanceInsight[]> {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const sinceStr = since.toISOString();

  const { data, error } = await supabase
    .from('campaign_performance_signals')
    .select('theme, engagement, impressions')
    .eq('company_id', companyId)
    .not('theme', 'is', null)
    .neq('theme', '')
    .gte('created_at', sinceStr);

  if (error) {
    console.warn('[campaignLearning] getHighPerformingThemes failed:', error.message);
    return [];
  }

  return aggregateByField(data ?? [], 'theme', limit);
}

/**
 * Get platforms that perform well for the company.
 */
export async function getHighPerformingPlatforms(
  companyId: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  limit = 10
): Promise<PerformanceInsight[]> {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const sinceStr = since.toISOString();

  const { data, error } = await supabase
    .from('campaign_performance_signals')
    .select('platform, engagement, impressions')
    .eq('company_id', companyId)
    .not('platform', 'is', null)
    .neq('platform', '')
    .gte('created_at', sinceStr);

  if (error) {
    console.warn('[campaignLearning] getHighPerformingPlatforms failed:', error.message);
    return [];
  }

  return aggregateByField(data ?? [], 'platform', limit);
}

/**
 * Get content types that perform well for the company.
 */
export async function getHighPerformingContentTypes(
  companyId: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  limit = 10
): Promise<PerformanceInsight[]> {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const sinceStr = since.toISOString();

  const { data, error } = await supabase
    .from('campaign_performance_signals')
    .select('content_type, engagement, impressions')
    .eq('company_id', companyId)
    .not('content_type', 'is', null)
    .neq('content_type', '')
    .gte('created_at', sinceStr);

  if (error) {
    console.warn('[campaignLearning] getHighPerformingContentTypes failed:', error.message);
    return [];
  }

  return aggregateByField(data ?? [], 'content_type', limit);
}

/**
 * Get patterns that underperform (low engagement relative to volume).
 */
export async function getLowPerformingPatterns(
  companyId: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  limit = 5
): Promise<LowPerformingPattern[]> {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const sinceStr = since.toISOString();

  const { data, error } = await supabase
    .from('campaign_performance_signals')
    .select('theme, platform, content_type, engagement, impressions')
    .eq('company_id', companyId)
    .gte('created_at', sinceStr);

  if (error || !data?.length) return [];

  const byTheme = new Map<string, { engagement: number[]; impressions: number[] }>();
  const byPlatform = new Map<string, { engagement: number[]; impressions: number[] }>();
  const byContentType = new Map<string, { engagement: number[]; impressions: number[] }>();

  for (const row of data as Array<{ theme?: string; platform?: string; content_type?: string; engagement?: number; impressions?: number }>) {
    const eng = Number(row.engagement ?? 0) || 0;
    const imp = Number(row.impressions ?? 0) || 0;
    if (row.theme) {
      const c = byTheme.get(row.theme) ?? { engagement: [], impressions: [] };
      c.engagement.push(eng);
      c.impressions.push(imp);
      byTheme.set(row.theme, c);
    }
    if (row.platform) {
      const c = byPlatform.get(row.platform) ?? { engagement: [], impressions: [] };
      c.engagement.push(eng);
      c.impressions.push(imp);
      byPlatform.set(row.platform, c);
    }
    if (row.content_type) {
      const c = byContentType.get(row.content_type) ?? { engagement: [], impressions: [] };
      c.engagement.push(eng);
      c.impressions.push(imp);
      byContentType.set(row.content_type, c);
    }
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const low: LowPerformingPattern[] = [];

  for (const [theme, { engagement: eng, impressions: imp }] of byTheme) {
    if (eng.length < MIN_SIGNALS_FOR_INSIGHT) continue;
    const avgEng = avg(eng);
    low.push({
      theme,
      avgEngagement: avgEng,
      signalCount: eng.length,
      reason: avgEng < 5 ? 'Very low engagement on theme' : 'Below-average engagement on theme',
    });
  }
  for (const [platform, { engagement: eng }] of byPlatform) {
    if (eng.length < MIN_SIGNALS_FOR_INSIGHT) continue;
    const avgEng = avg(eng);
    low.push({
      platform,
      avgEngagement: avgEng,
      signalCount: eng.length,
      reason: avgEng < 5 ? 'Very low engagement on platform' : 'Below-average engagement on platform',
    });
  }
  for (const [content_type, { engagement: eng }] of byContentType) {
    if (eng.length < MIN_SIGNALS_FOR_INSIGHT) continue;
    const avgEng = avg(eng);
    low.push({
      content_type,
      avgEngagement: avgEng,
      signalCount: eng.length,
      reason: avgEng < 5 ? 'Very low engagement on content type' : 'Below-average engagement on content type',
    });
  }

  const globalAvg = data.length
    ? data.reduce((s, r: { engagement?: number }) => s + (Number((r as any).engagement ?? 0) || 0), 0) / data.length
    : 0;
  return low
    .filter((p) => p.avgEngagement < globalAvg * 0.5)
    .sort((a, b) => a.avgEngagement - b.avgEngagement)
    .slice(0, limit);
}

/**
 * Load all company performance insights for recommendation context.
 */
export async function getCompanyPerformanceInsights(companyId: string): Promise<{
  company_high_performing_themes: PerformanceInsight[];
  company_high_performing_platforms: PerformanceInsight[];
  company_high_performing_content_types: PerformanceInsight[];
  company_low_performing_patterns: LowPerformingPattern[];
}> {
  const [themes, platforms, contentTypes, lowPatterns] = await Promise.all([
    getHighPerformingThemes(companyId),
    getHighPerformingPlatforms(companyId),
    getHighPerformingContentTypes(companyId),
    getLowPerformingPatterns(companyId),
  ]);

  return {
    company_high_performing_themes: themes,
    company_high_performing_platforms: platforms,
    company_high_performing_content_types: contentTypes,
    company_low_performing_patterns: lowPatterns,
  };
}

function aggregateByField(
  rows: Array<Record<string, unknown>>,
  field: string,
  limit: number
): PerformanceInsight[] {
  const byValue = new Map<string, { engagement: number[]; impressions: number[] }>();

  for (const row of rows) {
    const v = String(row[field] ?? '').trim().toLowerCase();
    if (!v) continue;
    const c = byValue.get(v) ?? { engagement: [], impressions: [] };
    c.engagement.push(Number(row.engagement ?? 0) || 0);
    c.impressions.push(Number(row.impressions ?? 0) || 0);
    byValue.set(v, c);
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const result: PerformanceInsight[] = [];

  for (const [value, { engagement: eng, impressions: imp }] of byValue) {
    if (eng.length < MIN_SIGNALS_FOR_INSIGHT) continue;
    const avgEng = avg(eng);
    const avgImp = avg(imp);
    const score = avgEng * 0.6 + Math.min(avgImp / 100, 100) * 0.4;
    result.push({
      value,
      avgEngagement: avgEng,
      avgImpressions: avgImp,
      signalCount: eng.length,
      score,
    });
  }

  return result
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
