import { supabase } from '../db/supabaseClient';
import { getSearchConsoleDataReadiness, type SearchConsoleDataReadiness } from './searchConsoleReadinessService';
import { buildOmnivyraGscReportContext } from './omnivyraGscAnalyticsService';
import type { BehaviorReportData } from './performanceReportService';

export type PerformanceSearchSeverity = 'high' | 'medium' | 'low';
export type PerformanceSearchConfidence = 'none' | 'low' | 'medium' | 'high';

export type JoinedLandingPageIntelligence = {
  page_url: string;
  page_key: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_position: number;
  previous_impressions: number;
  previous_clicks: number;
  impression_delta_pct: number;
  click_delta_pct: number;
  sessions: number;
  events: number;
  conversions: number;
  engagement_rate: number;
  conversion_rate: number;
  organic_visibility_score: number;
  visibility_to_engagement_score: number;
  visibility_to_conversion_score: number;
  landing_page_opportunity_score: number;
  trend_direction: 'rising' | 'declining' | 'stable' | 'new';
  confidence: PerformanceSearchConfidence;
};

export type SearchOpportunityType =
  | 'ctr_opportunity'
  | 'ranking_opportunity'
  | 'visibility_engagement_gap'
  | 'traffic_conversion_gap'
  | 'organic_decline'
  | 'organic_rise'
  | 'landing_page_experience_gap';

export type SearchOpportunity = {
  type: SearchOpportunityType;
  severity: PerformanceSearchSeverity;
  confidence: PerformanceSearchConfidence;
  page_url: string;
  title: string;
  recommendation: string;
  confidence_label: 'observed' | 'likely' | 'directional';
  evidence: Record<string, number | string>;
};

export type KeywordOpportunity = {
  keyword: string;
  page_url: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_position: number;
  opportunity_type: 'ctr' | 'ranking';
  branded: boolean;
  intent_group: 'informational' | 'commercial' | 'navigational' | 'transactional' | 'unknown';
  cluster_key: string;
  trend_direction: 'rising' | 'declining' | 'stable' | 'new';
  severity: PerformanceSearchSeverity;
  confidence: PerformanceSearchConfidence;
};

export type PerformanceSearchIntelligence = {
  readiness: SearchConsoleDataReadiness;
  provenance?: {
    source: 'gsc_canonical_ingestion' | 'fallback_no_gsc';
    property_url: string | null;
    status: string;
    degraded_state: string;
  };
  data_confidence: PerformanceSearchConfidence;
  insight_confidence: PerformanceSearchConfidence;
  recommendation_confidence: PerformanceSearchConfidence;
  joined_pages: JoinedLandingPageIntelligence[];
  opportunities: SearchOpportunity[];
  keyword_opportunities: KeywordOpportunity[];
  query_clusters: Array<{
    cluster_key: string;
    intent_group: KeywordOpportunity['intent_group'];
    branded: boolean;
    keywords: string[];
    impressions: number;
    clicks: number;
    ctr: number;
    avg_position: number;
    opportunity_score: number;
  }>;
  summaries: {
    organic_visibility: string;
    search_demand_vs_conversion_quality: string;
    landing_page_weakness: string;
  };
};

type KeywordMetricRow = {
  keyword_id: string | null;
  metric_date: string | null;
  page_url: string | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  avg_position: number | null;
};

type KeywordRow = {
  id: string;
  keyword: string | null;
  landing_page_url: string | null;
};

async function loadPlatformGscMetrics(params: {
  companyId: string;
  previousStart: string;
}): Promise<{
  readiness: SearchConsoleDataReadiness;
  provenance: NonNullable<PerformanceSearchIntelligence['provenance']>;
  metrics: KeywordMetricRow[];
  keywords: Map<string, KeywordRow>;
} | null> {
  const context = await buildOmnivyraGscReportContext(params.companyId);
  if (!context || context.provenance.source !== 'gsc_canonical_ingestion' || !context.provenance.property_url) {
    return null;
  }

  const { data, error } = await supabase
    .from('platform_gsc_query_metrics')
    .select('metric_date, query, page_url, clicks, impressions, ctr, avg_position')
    .eq('scope', 'omnivyra_website')
    .eq('property_url', context.provenance.property_url)
    .gte('metric_date', params.previousStart)
    .order('metric_date', { ascending: false })
    .limit(20000);

  if (error) {
    throw new Error(`Failed to load Omnivyra platform GSC metrics: ${error.message}`);
  }

  const keywords = new Map<string, KeywordRow>();
  const metrics = ((data ?? []) as Array<{
    metric_date: string | null;
    query: string | null;
    page_url: string | null;
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    avg_position: number | null;
  }>).map((row) => {
    const keyword = String(row.query ?? '').trim() || '(not provided)';
    const pageUrl = String(row.page_url ?? '').trim();
    const keywordId = `${keyword}|${pageUrl}`;
    if (!keywords.has(keywordId)) {
      keywords.set(keywordId, { id: keywordId, keyword, landing_page_url: pageUrl });
    }
    return {
      keyword_id: keywordId,
      metric_date: row.metric_date,
      page_url: pageUrl,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      avg_position: row.avg_position,
    };
  });

  const dates = metrics.map((row) => row.metric_date).filter(Boolean) as string[];
  const latestMetricDate = dates.sort().at(-1) ?? null;
  const earliestMetricDate = dates.sort()[0] ?? null;
  const pages = new Set(metrics.map((row) => row.page_url).filter(Boolean) as string[]);
  const impressions = metrics.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
  const clicks = metrics.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);

  return {
    readiness: {
      ready: context.status.status === 'live' || context.status.status === 'stale' || context.status.status === 'partial',
      status: context.status.status === 'stale' ? 'stale' : metrics.length > 0 ? 'ready' : 'no_keyword_data',
      reason: context.status.message,
      confidence: metrics.length >= 10 ? 'high' : metrics.length > 0 ? 'medium' : 'none',
      metrics_last_90_days: metrics.length,
      keywords_last_90_days: keywords.size,
      pages_last_90_days: pages.size,
      total_impressions_last_90_days: impressions,
      total_clicks_last_90_days: clicks,
      earliest_metric_date: earliestMetricDate,
      latest_metric_date: latestMetricDate,
      history_days: earliestMetricDate && latestMetricDate
        ? Math.max(1, Math.round((new Date(`${latestMetricDate}T00:00:00.000Z`).getTime() - new Date(`${earliestMetricDate}T00:00:00.000Z`).getTime()) / 86400000) + 1)
        : 0,
    },
    provenance: {
      source: context.provenance.source,
      property_url: context.provenance.property_url,
      status: context.status.status,
      degraded_state: context.status.degraded_state,
    },
    metrics,
    keywords,
  };
}

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function pctChange(previous: number, current: number): number {
  if (previous <= 0 && current <= 0) return 0;
  if (previous <= 0 && current > 0) return 1;
  return (current - previous) / previous;
}

function normalizePageKey(input: string | null | undefined): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '/';
  try {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(raw, 'https://example.com');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return path.toLowerCase();
  } catch {
    const withoutDomain = raw.replace(/^https?:\/\/[^/]+/i, '');
    return (withoutDomain.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/').toLowerCase();
  }
}

function weightedAveragePosition(rows: KeywordMetricRow[]): number {
  const weighted = rows.reduce((sum, row) => sum + Number(row.avg_position ?? 0) * Math.max(1, Number(row.impressions ?? 0)), 0);
  const weight = rows.reduce((sum, row) => sum + Math.max(1, Number(row.impressions ?? 0)), 0);
  return Number(safeDiv(weighted, weight).toFixed(2));
}

function classifySeverity(score: number): PerformanceSearchSeverity {
  if (score >= 0.75) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

function confidenceForPage(row: JoinedLandingPageIntelligence): PerformanceSearchConfidence {
  if (row.impressions >= 500 && row.sessions >= 50) return 'high';
  if (row.impressions >= 100 && row.sessions >= 10) return 'medium';
  if (row.impressions > 0 || row.sessions > 0) return 'low';
  return 'none';
}

function confidenceLabel(confidence: PerformanceSearchConfidence): SearchOpportunity['confidence_label'] {
  if (confidence === 'high') return 'observed';
  if (confidence === 'medium') return 'likely';
  return 'directional';
}

function opportunityFamily(type: SearchOpportunityType): 'serp' | 'page_experience' | 'trend' {
  if (type === 'ctr_opportunity' || type === 'ranking_opportunity') return 'serp';
  if (type === 'organic_decline' || type === 'organic_rise') return 'trend';
  return 'page_experience';
}

function classifyTrend(previous: number, current: number): 'rising' | 'declining' | 'stable' | 'new' {
  if (previous <= 0 && current > 0) return 'new';
  const delta = pctChange(previous, current);
  if (previous >= 20 && delta <= -0.25) return 'declining';
  if (previous >= 20 && delta >= 0.25) return 'rising';
  return 'stable';
}

function scorePage(row: Pick<JoinedLandingPageIntelligence, 'impressions' | 'clicks' | 'ctr' | 'avg_position' | 'sessions' | 'engagement_rate' | 'conversion_rate'>): {
  organic_visibility_score: number;
  visibility_to_engagement_score: number;
  visibility_to_conversion_score: number;
  landing_page_opportunity_score: number;
} {
  const visibility = Math.min(100, Math.round(Math.log10(row.impressions + 1) * 25 + Math.max(0, 20 - row.avg_position) * 1.5));
  const engagement = Math.min(100, Math.round(row.engagement_rate * 35));
  const conversion = Math.min(100, Math.round(row.conversion_rate * 2000));
  const demandWaste = row.impressions > 0 ? Math.max(0, 1 - row.ctr / 0.03) * 35 : 0;
  const behaviorWaste = row.sessions > 0 ? Math.max(0, 1 - row.engagement_rate) * 25 + Math.max(0, 0.02 - row.conversion_rate) * 900 : 0;
  return {
    organic_visibility_score: visibility,
    visibility_to_engagement_score: engagement,
    visibility_to_conversion_score: conversion,
    landing_page_opportunity_score: Math.min(100, Math.round(visibility * 0.35 + demandWaste + behaviorWaste)),
  };
}

function classifyQueryIntent(keyword: string): KeywordOpportunity['intent_group'] {
  const value = keyword.toLowerCase();
  if (/\b(price|pricing|cost|buy|trial|demo|quote|near me|software|tool|platform|service)\b/.test(value)) return 'commercial';
  if (/\b(how|what|why|guide|template|example|examples|ideas|tips|best practices)\b/.test(value)) return 'informational';
  if (/\b(login|support|contact|website|official|app)\b/.test(value)) return 'navigational';
  if (/\b(download|purchase|subscribe|book|hire|order)\b/.test(value)) return 'transactional';
  return 'unknown';
}

function isLikelyBranded(keyword: string): boolean {
  const value = keyword.toLowerCase().trim();
  if (!value) return false;
  return /\b(omnivyra|omni vyra|brand|company|official|login|support)\b/.test(value) || value.split(/\s+/).length === 1 && value.length > 9;
}

function clusterKeyword(keyword: string): string {
  const stop = new Set(['the', 'a', 'an', 'for', 'to', 'of', 'and', 'or', 'in', 'with', 'best', 'how', 'what', 'why']);
  const tokens = keyword.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((token) => token && !stop.has(token));
  return tokens.slice(0, 3).join(' ') || keyword.toLowerCase().slice(0, 40);
}

function summarizeVisibility(pages: JoinedLandingPageIntelligence[]): string {
  const totalImpressions = pages.reduce((sum, row) => sum + row.impressions, 0);
  const totalClicks = pages.reduce((sum, row) => sum + row.clicks, 0);
  const ctr = safeDiv(totalClicks, totalImpressions);
  if (totalImpressions === 0) return 'Organic search visibility is not measurable yet.';
  return `Organic search produced ${totalImpressions.toLocaleString('en-US')} impressions and ${totalClicks.toLocaleString('en-US')} clicks at ${(ctr * 100).toFixed(1)}% CTR.`;
}

function summarizeDemandQuality(pages: JoinedLandingPageIntelligence[]): string {
  const visibleWeak = pages.find((row) => row.impressions >= 100 && row.sessions > 0 && row.conversion_rate < 0.01);
  if (visibleWeak) {
    return `${visibleWeak.page_url} has search visibility but weak conversion efficiency, so demand capture should be improved before scaling traffic.`;
  }
  const strong = pages.find((row) => row.impressions >= 100 && row.conversion_rate >= 0.03);
  if (strong) {
    return `${strong.page_url} is converting measurable organic demand and should inform similar landing-page patterns.`;
  }
  return 'Search demand exists, but conversion-quality signal is still developing.';
}

function summarizeLandingWeakness(opportunities: SearchOpportunity[]): string {
  const weak = opportunities.find((item) => item.type === 'visibility_engagement_gap' || item.type === 'landing_page_experience_gap');
  return weak?.title ?? 'No major organic landing-page weakness stands out yet.';
}

function buildPageOpportunities(pages: JoinedLandingPageIntelligence[]): SearchOpportunity[] {
  const opportunities: SearchOpportunity[] = [];

  for (const page of pages) {
    if (page.impressions >= 150 && page.ctr < 0.02 && page.avg_position <= 20) {
      opportunities.push({
        type: 'ctr_opportunity',
        severity: classifySeverity(Math.min(1, page.impressions / 1000 + (0.02 - page.ctr) * 20)),
        confidence: page.confidence,
        page_url: page.page_url,
        title: `High search visibility is not turning into clicks on ${page.page_url}`,
        recommendation: 'Rewrite the SERP promise, title, and meta description to convert impressions into qualified visits.',
        confidence_label: confidenceLabel(page.confidence),
        evidence: { impressions: page.impressions, clicks: page.clicks, ctr: page.ctr, avg_position: page.avg_position },
      });
    }

    if (page.impressions >= 100 && page.avg_position >= 5 && page.avg_position <= 20) {
      opportunities.push({
        type: 'ranking_opportunity',
        severity: classifySeverity(Math.min(1, page.impressions / 800 + (20 - page.avg_position) / 30)),
        confidence: page.confidence,
        page_url: page.page_url,
        title: `${page.page_url} is close enough to improve organic rank`,
        recommendation: 'Strengthen content depth, internal links, and query alignment for terms already within reach.',
        confidence_label: confidenceLabel(page.confidence),
        evidence: { impressions: page.impressions, avg_position: page.avg_position, ctr: page.ctr },
      });
    }

    if (page.impressions >= 100 && page.sessions >= 10 && page.engagement_rate < 1) {
      opportunities.push({
        type: 'visibility_engagement_gap',
        severity: classifySeverity(Math.min(1, page.impressions / 1000 + (1 - page.engagement_rate) / 2)),
        confidence: page.confidence,
        page_url: page.page_url,
        title: `${page.page_url} attracts search demand but does not earn enough engagement`,
        recommendation: 'Align the above-the-fold message with search intent and add clearer paths to the next step.',
        confidence_label: confidenceLabel(page.confidence),
        evidence: { impressions: page.impressions, sessions: page.sessions, engagement_rate: page.engagement_rate },
      });
    }

    if (page.sessions >= 15 && page.conversion_rate < 0.01) {
      opportunities.push({
        type: 'traffic_conversion_gap',
        severity: classifySeverity(Math.min(1, page.sessions / 200 + (0.01 - page.conversion_rate) * 40)),
        confidence: page.confidence,
        page_url: page.page_url,
        title: `${page.page_url} has traffic but weak conversion yield`,
        recommendation: 'Improve CTA clarity, form friction, and offer relevance before sending more demand to this page.',
        confidence_label: confidenceLabel(page.confidence),
        evidence: { sessions: page.sessions, conversions: page.conversions, conversion_rate: page.conversion_rate },
      });
    }

    if (page.previous_clicks >= 15 && page.click_delta_pct <= -0.35) {
      opportunities.push({
        type: 'organic_decline',
        severity: classifySeverity(Math.min(1, Math.abs(page.click_delta_pct))),
        confidence: page.confidence,
        page_url: page.page_url,
        title: `${page.page_url} is losing organic clicks`,
        recommendation: 'Inspect ranking, snippet, and content freshness changes before the decline compounds.',
        confidence_label: confidenceLabel(page.confidence),
        evidence: { previous_clicks: page.previous_clicks, clicks: page.clicks, click_delta_pct: page.click_delta_pct },
      });
    }

    if (page.previous_impressions >= 100 && page.impression_delta_pct >= 0.35) {
      opportunities.push({
        type: 'organic_rise',
        severity: classifySeverity(Math.min(1, page.impression_delta_pct)),
        confidence: page.confidence,
        page_url: page.page_url,
        title: `${page.page_url} is gaining organic visibility`,
        recommendation: 'Use this rising visibility to improve CTR, conversion prompts, and internal links while momentum is active.',
        confidence_label: confidenceLabel(page.confidence),
        evidence: { previous_impressions: page.previous_impressions, impressions: page.impressions, impression_delta_pct: page.impression_delta_pct },
      });
    }

    if (page.impressions >= 100 && page.sessions >= 10 && page.engagement_rate < 1 && page.conversion_rate < 0.01) {
      opportunities.push({
        type: 'landing_page_experience_gap',
        severity: 'high',
        confidence: page.confidence,
        page_url: page.page_url,
        title: `${page.page_url} has both organic demand and landing-page experience weakness`,
        recommendation: 'Treat this as a priority page: tighten intent match, add proof, clarify the CTA, and reduce friction.',
        confidence_label: confidenceLabel(page.confidence),
        evidence: { impressions: page.impressions, sessions: page.sessions, engagement_rate: page.engagement_rate, conversion_rate: page.conversion_rate },
      });
    }
  }

  const severityRank = { high: 3, medium: 2, low: 1 };
  const confidenceRank = { high: 4, medium: 3, low: 2, none: 1 };
  const seen = new Set<string>();
  const seenFamilies = new Set<string>();
  return opportunities
    .sort((a, b) =>
      severityRank[b.severity] - severityRank[a.severity] ||
      confidenceRank[b.confidence] - confidenceRank[a.confidence] ||
      Number(b.evidence.impressions ?? b.evidence.sessions ?? 0) - Number(a.evidence.impressions ?? a.evidence.sessions ?? 0),
    )
    .filter((item) => {
      if (item.confidence === 'none') return false;
      if (item.confidence === 'low' && item.severity !== 'high') return false;
      const pageAlreadyHasExperienceGap = opportunities.some((other) =>
        other !== item &&
        other.page_url === item.page_url &&
        other.type === 'landing_page_experience_gap' &&
        other.confidence !== 'none',
      );
      if (pageAlreadyHasExperienceGap && (item.type === 'visibility_engagement_gap' || item.type === 'traffic_conversion_gap')) return false;
      const key = `${item.type}|${item.page_url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      const familyKey = `${opportunityFamily(item.type)}|${item.page_url}`;
      if (seenFamilies.has(familyKey)) return false;
      seenFamilies.add(familyKey);
      return true;
    })
    .slice(0, 12);
}

function buildKeywordOpportunities(rows: KeywordMetricRow[], previousRows: KeywordMetricRow[], keywords: Map<string, KeywordRow>): KeywordOpportunity[] {
  const byKeyword = new Map<string, KeywordMetricRow[]>();
  const previousByKeyword = new Map<string, KeywordMetricRow[]>();
  for (const row of rows) {
    if (!row.keyword_id) continue;
    const current = byKeyword.get(row.keyword_id) ?? [];
    current.push(row);
    byKeyword.set(row.keyword_id, current);
  }
  for (const row of previousRows) {
    if (!row.keyword_id) continue;
    const current = previousByKeyword.get(row.keyword_id) ?? [];
    current.push(row);
    previousByKeyword.set(row.keyword_id, current);
  }

  const opportunities: KeywordOpportunity[] = [];
  for (const [keywordId, keywordRows] of byKeyword.entries()) {
    const keyword = keywords.get(keywordId);
    if (!keyword?.keyword) continue;
    const impressions = keywordRows.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
    const clicks = keywordRows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
    const ctr = Number(safeDiv(clicks, impressions).toFixed(4));
    const avgPosition = weightedAveragePosition(keywordRows);
    const pageUrl = keyword.landing_page_url || keywordRows.find((row) => row.page_url)?.page_url || '';
    const previousImpressions = (previousByKeyword.get(keywordId) ?? []).reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
    const intentGroup = classifyQueryIntent(keyword.keyword);
    const branded = isLikelyBranded(keyword.keyword);
    const clusterKey = clusterKeyword(keyword.keyword);
    const trendDirection = classifyTrend(previousImpressions, impressions);

    if (impressions >= 75 && ctr < 0.02 && avgPosition <= 20) {
      opportunities.push({
        keyword: keyword.keyword,
        page_url: pageUrl,
        impressions,
        clicks,
        ctr,
        avg_position: avgPosition,
        opportunity_type: 'ctr',
        branded,
        intent_group: intentGroup,
        cluster_key: clusterKey,
        trend_direction: trendDirection,
        severity: classifySeverity(Math.min(1, impressions / 1000 + (0.02 - ctr) * 20)),
        confidence: impressions >= 200 ? 'high' : 'medium',
      });
    } else if (impressions >= 50 && avgPosition >= 5 && avgPosition <= 20) {
      opportunities.push({
        keyword: keyword.keyword,
        page_url: pageUrl,
        impressions,
        clicks,
        ctr,
        avg_position: avgPosition,
        opportunity_type: 'ranking',
        branded,
        intent_group: intentGroup,
        cluster_key: clusterKey,
        trend_direction: trendDirection,
        severity: classifySeverity(Math.min(1, impressions / 700 + (20 - avgPosition) / 30)),
        confidence: impressions >= 100 ? 'high' : 'medium',
      });
    }
  }

  const severityRank = { high: 3, medium: 2, low: 1 };
  const seenClusters = new Set<string>();
  return opportunities
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.impressions - a.impressions)
    .filter((item) => {
      const key = `${item.cluster_key}|${item.opportunity_type}|${item.branded ? 'branded' : 'nonbranded'}`;
      if (seenClusters.has(key)) return false;
      seenClusters.add(key);
      return true;
    })
    .slice(0, 10);
}

function buildQueryClusters(opportunities: KeywordOpportunity[]): PerformanceSearchIntelligence['query_clusters'] {
  const groups = new Map<string, KeywordOpportunity[]>();
  for (const item of opportunities) {
    groups.set(item.cluster_key, [...(groups.get(item.cluster_key) ?? []), item]);
  }
  return Array.from(groups.entries()).map(([clusterKey, rows]) => {
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const weightedPosition = rows.reduce((sum, row) => sum + row.avg_position * Math.max(1, row.impressions), 0);
    const weight = rows.reduce((sum, row) => sum + Math.max(1, row.impressions), 0);
    return {
      cluster_key: clusterKey,
      intent_group: rows[0]?.intent_group ?? 'unknown',
      branded: rows.some((row) => row.branded),
      keywords: rows.map((row) => row.keyword).slice(0, 8),
      impressions,
      clicks,
      ctr: Number(safeDiv(clicks, impressions).toFixed(4)),
      avg_position: Number(safeDiv(weightedPosition, weight).toFixed(2)),
      opportunity_score: Math.min(100, Math.round(impressions / 20 + Math.max(0, 0.03 - safeDiv(clicks, impressions)) * 700)),
    };
  }).sort((a, b) => b.opportunity_score - a.opportunity_score).slice(0, 8);
}

export async function buildPerformanceSearchIntelligence(params: {
  companyId: string;
  behaviorData: BehaviorReportData;
  windowDays?: number;
}): Promise<PerformanceSearchIntelligence> {
  const windowDays = params.windowDays ?? 28;
  const currentStart = isoDateDaysAgo(windowDays);
  const previousStart = isoDateDaysAgo(windowDays * 2);
  const platformGsc = await loadPlatformGscMetrics({
    companyId: params.companyId,
    previousStart,
  }).catch((error) => {
    console.warn('[performance-search][platform-gsc-load-failed]', {
      company_id: params.companyId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  const readiness = platformGsc?.readiness ?? await getSearchConsoleDataReadiness(params.companyId);

  let metrics: KeywordMetricRow[] = platformGsc?.metrics ?? [];
  const keywords = platformGsc?.keywords ?? new Map<string, KeywordRow>();
  if (!platformGsc) {
    const { data: metricData, error: metricError } = await supabase
      .from('keyword_metrics')
      .select('keyword_id, metric_date, page_url, impressions, clicks, ctr, avg_position')
      .eq('company_id', params.companyId)
      .gte('metric_date', previousStart)
      .order('metric_date', { ascending: false })
      .limit(20000);

    if (metricError) {
      throw new Error(`Failed to load Performance Search Intelligence metrics: ${metricError.message}`);
    }

    metrics = (metricData ?? []) as KeywordMetricRow[];
  }

  const keywordIds = platformGsc ? [] : [...new Set(metrics.map((row) => row.keyword_id).filter(Boolean) as string[])];
  if (!platformGsc && keywordIds.length > 0) {
    const { data: keywordData, error: keywordError } = await supabase
      .from('canonical_keywords')
      .select('id, keyword, landing_page_url')
      .eq('company_id', params.companyId)
      .in('id', keywordIds);
    if (keywordError) {
      throw new Error(`Failed to load Performance Search Intelligence keywords: ${keywordError.message}`);
    }
    for (const row of (keywordData ?? []) as KeywordRow[]) {
      keywords.set(row.id, row);
    }
  }

  const currentRows = metrics.filter((row) => String(row.metric_date ?? '') >= currentStart);
  const previousRows = metrics.filter((row) => String(row.metric_date ?? '') < currentStart && String(row.metric_date ?? '') >= previousStart);
  const byPage = new Map<string, { current: KeywordMetricRow[]; previous: KeywordMetricRow[]; display: string }>();

  for (const row of currentRows) {
    const key = normalizePageKey(row.page_url);
    const entry = byPage.get(key) ?? { current: [], previous: [], display: row.page_url || key };
    entry.current.push(row);
    if (row.page_url) entry.display = row.page_url;
    byPage.set(key, entry);
  }
  for (const row of previousRows) {
    const key = normalizePageKey(row.page_url);
    const entry = byPage.get(key) ?? { current: [], previous: [], display: row.page_url || key };
    entry.previous.push(row);
    byPage.set(key, entry);
  }

  const behaviorByPage = new Map(params.behaviorData.top_pages.map((page) => [normalizePageKey(page.page_url), page]));
  for (const page of params.behaviorData.top_pages) {
    const key = normalizePageKey(page.page_url);
    if (!byPage.has(key)) {
      byPage.set(key, { current: [], previous: [], display: page.page_url });
    }
  }

  const joinedPages = Array.from(byPage.entries()).map(([pageKey, entry]): JoinedLandingPageIntelligence => {
    const behavior = behaviorByPage.get(pageKey);
    const impressions = entry.current.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
    const clicks = entry.current.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
    const previousImpressions = entry.previous.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
    const previousClicks = entry.previous.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
    const sessions = Number(behavior?.visits ?? 0);
    const events = Number(behavior?.events ?? 0);
    const conversions = Number(behavior?.conversions ?? 0);
    const row = {
      page_url: behavior?.page_url ?? entry.display,
      page_key: pageKey,
      impressions,
      clicks,
      ctr: Number(safeDiv(clicks, impressions).toFixed(4)),
      avg_position: weightedAveragePosition(entry.current),
      previous_impressions: previousImpressions,
      previous_clicks: previousClicks,
      impression_delta_pct: Number(pctChange(previousImpressions, impressions).toFixed(4)),
      click_delta_pct: Number(pctChange(previousClicks, clicks).toFixed(4)),
      sessions,
      events,
      conversions,
      engagement_rate: Number(safeDiv(events, sessions).toFixed(2)),
      conversion_rate: Number(safeDiv(conversions, sessions).toFixed(4)),
      organic_visibility_score: 0,
      visibility_to_engagement_score: 0,
      visibility_to_conversion_score: 0,
      landing_page_opportunity_score: 0,
      trend_direction: classifyTrend(previousClicks || previousImpressions, clicks || impressions),
      confidence: 'none' as PerformanceSearchConfidence,
    };
    return { ...row, ...scorePage(row), confidence: confidenceForPage(row) };
  }).sort((a, b) => b.impressions - a.impressions || b.sessions - a.sessions).slice(0, 30);

  const opportunities = buildPageOpportunities(joinedPages);
  const keywordOpportunities = buildKeywordOpportunities(currentRows, previousRows, keywords);
  const queryClusters = buildQueryClusters(keywordOpportunities);
  const dataConfidence = readiness.ready ? readiness.confidence : readiness.confidence === 'medium' ? 'medium' : 'low';
  const insightConfidence: PerformanceSearchConfidence = joinedPages.some((row) => row.confidence === 'high')
    ? 'high'
    : joinedPages.some((row) => row.confidence === 'medium')
      ? 'medium'
      : opportunities.length > 0 ? 'low' : 'none';
  const recommendationConfidence: PerformanceSearchConfidence = opportunities.some((item) => item.confidence === 'high')
    ? 'high'
    : opportunities.some((item) => item.confidence === 'medium')
      ? 'medium'
      : opportunities.length > 0 ? 'low' : 'none';

  return {
    readiness,
    provenance: platformGsc?.provenance ?? {
      source: 'fallback_no_gsc',
      property_url: null,
      status: readiness.status,
      degraded_state: readiness.ready ? 'live' : 'no_analytics',
    },
    data_confidence: dataConfidence,
    insight_confidence: insightConfidence,
    recommendation_confidence: recommendationConfidence,
    joined_pages: joinedPages,
    opportunities,
    keyword_opportunities: keywordOpportunities,
    query_clusters: queryClusters,
    summaries: {
      organic_visibility: summarizeVisibility(joinedPages),
      search_demand_vs_conversion_quality: summarizeDemandQuality(joinedPages),
      landing_page_weakness: summarizeLandingWeakness(opportunities),
    },
  };
}
