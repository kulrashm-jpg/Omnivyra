import { ownedDbTable } from '../db/writeOwner';
import { buildOmnivyraGscReportContext, type OmnivyraGscDashboardSummary } from './omnivyraGscAnalyticsService';

export type QueryIntent = 'branded' | 'navigational' | 'informational' | 'commercial' | 'unknown';
export type MovementDirection = 'rising' | 'declining' | 'stable' | 'new';

export type GscSeoQueryInsight = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
  classification: QueryIntent;
  movement: MovementDirection;
  volatility_score: number;
  opportunity_score: number;
  confidence: 'high' | 'medium' | 'low';
};

export type GscSeoPageInsight = {
  page_url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
  movement: MovementDirection;
  opportunity_score: number;
  issue: 'high_impression_low_ctr' | 'ranking_threshold' | 'visibility_gain' | 'visibility_loss' | 'developing';
  confidence: 'high' | 'medium' | 'low';
};

export type GscSeoIntelligence = {
  provenance: OmnivyraGscDashboardSummary['provenance'];
  readiness_status: string;
  top_queries: GscSeoQueryInsight[];
  top_pages: GscSeoPageInsight[];
  rising_keywords: GscSeoQueryInsight[];
  declining_keywords: GscSeoQueryInsight[];
  ctr_opportunities: GscSeoPageInsight[];
  visibility_gainers: GscSeoPageInsight[];
  visibility_losers: GscSeoPageInsight[];
};

type RawGscRow = {
  metric_date: string | null;
  query: string | null;
  page_url: string | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  avg_position: number | null;
};

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function classifyQuery(query: string): QueryIntent {
  const value = query.toLowerCase();
  if (/\b(omnivyra|omni vyra|omnivira|omnyvyra)\b/.test(value)) return 'branded';
  if (/\b(login|sign in|support|contact|official|website)\b/.test(value)) return 'navigational';
  if (/\b(price|pricing|cost|demo|trial|software|platform|service|tool|alternative|competitor)\b/.test(value)) return 'commercial';
  if (/\b(how|what|why|guide|ideas|examples|template|best practices)\b/.test(value)) return 'informational';
  return 'unknown';
}

function classifyMovement(previous: number, current: number): MovementDirection {
  if (previous <= 0 && current > 0) return 'new';
  if (previous <= 0 && current <= 0) return 'stable';
  const delta = (current - previous) / previous;
  if (delta >= 0.25) return 'rising';
  if (delta <= -0.25) return 'declining';
  return 'stable';
}

function confidence(impressions: number): 'high' | 'medium' | 'low' {
  if (impressions >= 500) return 'high';
  if (impressions >= 50) return 'medium';
  return 'low';
}

function weightedPosition(rows: RawGscRow[]): number {
  const weight = rows.reduce((sum, row) => sum + Math.max(1, Number(row.impressions ?? 0)), 0);
  const total = rows.reduce((sum, row) => sum + Number(row.avg_position ?? 0) * Math.max(1, Number(row.impressions ?? 0)), 0);
  return Number(safeDiv(total, weight).toFixed(2));
}

function opportunityScore(params: { impressions: number; ctr: number; avgPosition: number; movement: MovementDirection }): number {
  const demand = Math.min(50, Math.log10(params.impressions + 1) * 18);
  const ctrGap = params.impressions > 0 ? Math.max(0, 0.03 - params.ctr) * 900 : 0;
  const rankOpportunity = params.avgPosition >= 4 && params.avgPosition <= 20 ? (20 - params.avgPosition) * 2 : 0;
  const momentum = params.movement === 'rising' || params.movement === 'new' ? 10 : params.movement === 'declining' ? 6 : 0;
  return Math.max(0, Math.min(100, Math.round(demand + ctrGap + rankOpportunity + momentum)));
}

function aggregateRows<T extends GscSeoQueryInsight | GscSeoPageInsight>(
  rows: RawGscRow[],
  currentStart: string,
  keyFor: (row: RawGscRow) => string,
  map: (label: string, bucket: RawGscRow[], movement: MovementDirection) => T,
): T[] {
  const buckets = new Map<string, RawGscRow[]>();
  for (const row of rows) {
    const key = keyFor(row).trim();
    if (!key) continue;
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }

  return Array.from(buckets.entries()).map(([label, bucket]) => {
    const current = bucket.filter((row) => String(row.metric_date ?? '') >= currentStart);
    const previous = bucket.filter((row) => String(row.metric_date ?? '') < currentStart);
    const currentImpressions = current.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
    const previousImpressions = previous.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
    return map(label, current.length ? current : bucket, classifyMovement(previousImpressions, currentImpressions));
  });
}

export async function buildGscSeoIntelligence(companyId: string, days = 30): Promise<GscSeoIntelligence | null> {
  const context = await buildOmnivyraGscReportContext(companyId);
  if (!context?.provenance.property_url || context.provenance.source !== 'gsc_canonical_ingestion') return null;

  const since = isoDateDaysAgo(days * 2 + 3);
  const currentStart = isoDateDaysAgo(days + 3);
  const { data, error } = await ownedDbTable('platform_gsc_query_metrics')
    .select('metric_date, query, page_url, clicks, impressions, ctr, avg_position')
    .eq('scope', 'omnivyra_website')
    .eq('property_url', context.provenance.property_url)
    .gte('metric_date', since)
    .limit(20000);

  if (error) throw new Error(`Failed to load GSC SEO intelligence rows: ${error.message}`);
  const rows = (data ?? []) as RawGscRow[];

  const queries = aggregateRows(rows, currentStart, (row) => row.query ?? '', (query, bucket, movement) => {
    const clicks = bucket.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
    const impressions = bucket.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
    const ctr = safeDiv(clicks, impressions);
    const avgPosition = weightedPosition(bucket);
    return {
      query,
      clicks,
      impressions,
      ctr: Number(ctr.toFixed(6)),
      avg_position: avgPosition,
      classification: classifyQuery(query),
      movement,
      volatility_score: movement === 'stable' ? 10 : movement === 'new' ? 45 : 65,
      opportunity_score: opportunityScore({ impressions, ctr, avgPosition, movement }),
      confidence: confidence(impressions),
    };
  }).sort((a, b) => b.opportunity_score - a.opportunity_score || b.impressions - a.impressions);

  const pages = aggregateRows(rows, currentStart, (row) => row.page_url ?? '', (pageUrl, bucket, movement) => {
    const clicks = bucket.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
    const impressions = bucket.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
    const ctr = safeDiv(clicks, impressions);
    const avgPosition = weightedPosition(bucket);
    const issue =
      impressions >= 100 && ctr < 0.02
        ? 'high_impression_low_ctr'
        : avgPosition >= 4 && avgPosition <= 20
          ? 'ranking_threshold'
          : movement === 'rising'
            ? 'visibility_gain'
            : movement === 'declining'
              ? 'visibility_loss'
              : 'developing';
    return {
      page_url: pageUrl,
      clicks,
      impressions,
      ctr: Number(ctr.toFixed(6)),
      avg_position: avgPosition,
      movement,
      opportunity_score: opportunityScore({ impressions, ctr, avgPosition, movement }),
      issue,
      confidence: confidence(impressions),
    };
  }).sort((a, b) => b.opportunity_score - a.opportunity_score || b.impressions - a.impressions);

  return {
    provenance: context.provenance,
    readiness_status: context.status.status,
    top_queries: queries.slice(0, 10),
    top_pages: pages.slice(0, 10),
    rising_keywords: queries.filter((query) => query.movement === 'rising' || query.movement === 'new').slice(0, 5),
    declining_keywords: queries.filter((query) => query.movement === 'declining').slice(0, 5),
    ctr_opportunities: pages.filter((page) => page.issue === 'high_impression_low_ctr' || page.issue === 'ranking_threshold').slice(0, 5),
    visibility_gainers: pages.filter((page) => page.movement === 'rising' || page.movement === 'new').slice(0, 5),
    visibility_losers: pages.filter((page) => page.movement === 'declining').slice(0, 5),
  };
}
