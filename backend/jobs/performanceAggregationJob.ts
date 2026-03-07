/**
 * Performance Aggregation Job
 * Campaign Learning Layer: aggregates campaign_performance_signals into company-level tables.
 * Runs daily. Idempotent.
 */

import { supabase } from '../db/supabaseClient';

const LOOKBACK_DAYS = 90;

type SignalRow = {
  company_id?: string;
  theme?: string;
  platform?: string;
  content_type?: string;
  engagement?: number;
  impressions?: number;
};

export type PerformanceAggregationResult = {
  themesUpdated: number;
  platformsUpdated: number;
  contentTypesUpdated: number;
  companiesProcessed: number;
  errors: string[];
};

function aggregateByField(
  rows: Array<{ engagement?: number; impressions?: number }>,
  _field: string,
  _fieldValue: string,
  _companyId: string
): { signal_count: number; avg_engagement: number; avg_impressions: number; score: number } {
  const count = rows.length;
  if (count === 0) {
    return { signal_count: 0, avg_engagement: 0, avg_impressions: 0, score: 0 };
  }
  const totalEng = rows.reduce((s, r) => s + (Number(r.engagement ?? 0) || 0), 0);
  const totalImp = rows.reduce((s, r) => s + (Number(r.impressions ?? 0) || 0), 0);
  const avgEng = totalEng / count;
  const avgImp = totalImp / count;
  const score = avgEng * 0.6 + Math.min(avgImp / 100, 100) * 0.4;
  return {
    signal_count: count,
    avg_engagement: Math.round(avgEng * 100) / 100,
    avg_impressions: Math.round(avgImp * 100) / 100,
    score: Math.round(score * 10000) / 10000,
  };
}

export async function runPerformanceAggregation(): Promise<PerformanceAggregationResult> {
  const errors: string[] = [];
  let themesUpdated = 0;
  let platformsUpdated = 0;
  let contentTypesUpdated = 0;
  let companiesProcessed = 0;

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  const sinceStr = since.toISOString();

  try {
    const { data: signals, error: signalsError } = await supabase
      .from('campaign_performance_signals')
      .select('company_id, theme, platform, content_type, engagement, impressions')
      .gte('created_at', sinceStr);

    if (signalsError) {
      errors.push(`campaign_performance_signals query failed: ${signalsError.message}`);
      return {
        themesUpdated: 0,
        platformsUpdated: 0,
        contentTypesUpdated: 0,
        companiesProcessed: 0,
        errors,
      };
    }

    if (!signals?.length) {
      return {
        themesUpdated: 0,
        platformsUpdated: 0,
        contentTypesUpdated: 0,
        companiesProcessed: 0,
        errors: [],
      };
    }

    const byCompanyTheme = new Map<string, SignalRow[]>();
    const byCompanyPlatform = new Map<string, SignalRow[]>();
    const byCompanyContentType = new Map<string, SignalRow[]>();

    for (const row of signals as SignalRow[]) {
      const cid = String(row.company_id ?? '').trim();
      if (!cid) continue;

      const theme = String(row.theme ?? '').trim().toLowerCase();
      if (theme) {
        const key = `${cid}::${theme}`;
        const arr = byCompanyTheme.get(key) ?? [];
        arr.push(row);
        byCompanyTheme.set(key, arr);
      }

      const platform = String(row.platform ?? '').trim().toLowerCase();
      if (platform) {
        const key = `${cid}::${platform}`;
        const arr = byCompanyPlatform.get(key) ?? [];
        arr.push(row);
        byCompanyPlatform.set(key, arr);
      }

      const ct = String(row.content_type ?? '').trim().toLowerCase();
      if (ct) {
        const key = `${cid}::${ct}`;
        const arr = byCompanyContentType.get(key) ?? [];
        arr.push(row);
        byCompanyContentType.set(key, arr);
      }
    }

    const companyIds = new Set<string>();
    for (const [key] of byCompanyTheme) companyIds.add(key.split('::')[0] ?? '');
    for (const [key] of byCompanyPlatform) companyIds.add(key.split('::')[0] ?? '');
    for (const [key] of byCompanyContentType) companyIds.add(key.split('::')[0] ?? '');
    companiesProcessed = companyIds.size;

    const themeUpserts: Array<Record<string, unknown>> = [];
    for (const [key, rows] of byCompanyTheme) {
      const [companyId, theme] = key.split('::');
      const agg = aggregateByField(rows, 'theme', theme, companyId);
      if (agg.signal_count < 2) continue;
      themeUpserts.push({
        company_id: companyId,
        theme,
        signal_count: agg.signal_count,
        avg_engagement: agg.avg_engagement,
        avg_impressions: agg.avg_impressions,
        score: agg.score,
        computed_at: new Date().toISOString(),
      });
    }

    const platformUpserts: Array<Record<string, unknown>> = [];
    for (const [key, rows] of byCompanyPlatform) {
      const [companyId, platform] = key.split('::');
      const agg = aggregateByField(rows, 'platform', platform, companyId);
      if (agg.signal_count < 2) continue;
      platformUpserts.push({
        company_id: companyId,
        platform,
        signal_count: agg.signal_count,
        avg_engagement: agg.avg_engagement,
        avg_impressions: agg.avg_impressions,
        score: agg.score,
        computed_at: new Date().toISOString(),
      });
    }

    const contentTypeUpserts: Array<Record<string, unknown>> = [];
    for (const [key, rows] of byCompanyContentType) {
      const [companyId, content_type] = key.split('::');
      const agg = aggregateByField(rows, 'content_type', content_type, companyId);
      if (agg.signal_count < 2) continue;
      contentTypeUpserts.push({
        company_id: companyId,
        content_type: content_type,
        signal_count: agg.signal_count,
        avg_engagement: agg.avg_engagement,
        avg_impressions: agg.avg_impressions,
        score: agg.score,
        computed_at: new Date().toISOString(),
      });
    }

    if (themeUpserts.length > 0) {
      const { error: e1 } = await supabase
        .from('company_theme_performance')
        .upsert(themeUpserts, { onConflict: 'company_id,theme' });
      if (e1) errors.push(`company_theme_performance: ${e1.message}`);
      else themesUpdated = themeUpserts.length;
    }

    if (platformUpserts.length > 0) {
      const { error: e2 } = await supabase
        .from('company_platform_performance')
        .upsert(platformUpserts, { onConflict: 'company_id,platform' });
      if (e2) errors.push(`company_platform_performance: ${e2.message}`);
      else platformsUpdated = platformUpserts.length;
    }

    if (contentTypeUpserts.length > 0) {
      const { error: e3 } = await supabase
        .from('company_content_type_performance')
        .upsert(contentTypeUpserts, { onConflict: 'company_id,content_type' });
      if (e3) errors.push(`company_content_type_performance: ${e3.message}`);
      else contentTypesUpdated = contentTypeUpserts.length;
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return {
    themesUpdated,
    platformsUpdated,
    contentTypesUpdated,
    companiesProcessed,
    errors,
  };
}
