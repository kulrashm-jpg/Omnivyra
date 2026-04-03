import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { clamp, roundNumber, safeAverage } from './intelligenceEngineUtils';

type KeywordRow = {
  id: string;
  keyword: string;
  landing_page_url: string;
};

type KeywordMetricRow = {
  keyword_id: string;
  metric_date: string;
  page_url: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_position: number | null;
};

async function loadSeoContext(companyId: string): Promise<{
  keywords: KeywordRow[];
  metrics: KeywordMetricRow[];
}> {
  const { data: keywords, error: keywordsError } = await supabase
    .from('canonical_keywords')
    .select('id, keyword, landing_page_url')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (keywordsError) {
    throw new Error(`Failed to load canonical keywords for ${companyId}: ${keywordsError.message}`);
  }

  const keywordIds = ((keywords ?? []) as KeywordRow[]).map((row) => row.id);
  if (keywordIds.length === 0) {
    return { keywords: [], metrics: [] };
  }

  const { data: metrics, error: metricsError } = await supabase
    .from('keyword_metrics')
    .select('keyword_id, metric_date, page_url, impressions, clicks, ctr, avg_position')
    .eq('company_id', companyId)
    .in('keyword_id', keywordIds)
    .order('metric_date', { ascending: false });

  if (metricsError) {
    throw new Error(`Failed to load keyword metrics for ${companyId}: ${metricsError.message}`);
  }

  return {
    keywords: (keywords ?? []) as KeywordRow[],
    metrics: (metrics ?? []) as KeywordMetricRow[],
  };
}

function sumMetrics(rows: KeywordMetricRow[]): {
  impressions: number;
  clicks: number;
  weightedCtr: number;
  avgPosition: number;
} {
  const impressions = rows.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
  const clicks = rows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
  const weightedCtr = impressions > 0 ? clicks / impressions : safeAverage(rows.reduce((sum, row) => sum + Number(row.ctr ?? 0), 0), rows.length);
  const positionRows = rows.filter((row) => typeof row.avg_position === 'number');
  const avgPosition = safeAverage(
    positionRows.reduce((sum, row) => sum + Number(row.avg_position ?? 0), 0),
    positionRows.length
  );
  return { impressions, clicks, weightedCtr, avgPosition };
}

export async function generateSeoIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('seoIntelligenceService');

  const { keywords, metrics } = await loadSeoContext(companyId);
  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'snapshot',
    source_service: 'seoIntelligenceService',
    entity_type: 'keyword',
    changed_by: 'system',
  });

  if (keywords.length === 0 || metrics.length === 0) return [];

  const metricsByKeywordId = new Map<string, KeywordMetricRow[]>();
  for (const row of metrics) {
    const current = metricsByKeywordId.get(row.keyword_id) ?? [];
    current.push(row);
    metricsByKeywordId.set(row.keyword_id, current);
  }

  const decisions = [];
  for (const keyword of keywords) {
    const keywordMetrics = metricsByKeywordId.get(keyword.id) ?? [];
    if (keywordMetrics.length === 0) continue;

    const sorted = [...keywordMetrics].sort((a, b) => String(b.metric_date).localeCompare(String(a.metric_date)));
    const recent = sorted.slice(0, Math.min(14, sorted.length));
    const previous = sorted.slice(Math.min(14, sorted.length), Math.min(28, sorted.length));
    const recentSummary = sumMetrics(recent);
    const previousSummary = sumMetrics(previous);

    if (recentSummary.impressions >= 1 && recentSummary.weightedCtr < 0.03) {
      decisions.push({
        company_id: companyId,
        report_tier: 'snapshot' as const,
        source_service: 'seoIntelligenceService',
        entity_type: 'keyword' as const,
        entity_id: keyword.id,
        issue_type: 'impression_click_gap',
        title: 'Keyword impressions are not turning into clicks',
        description: `Keyword "${keyword.keyword}" is appearing in search but underperforming on click-through.`,
        evidence: {
          keyword: keyword.keyword,
          landing_page_url: keyword.landing_page_url || recent[0]?.page_url || null,
          impressions: recentSummary.impressions,
          clicks: recentSummary.clicks,
          ctr: roundNumber(recentSummary.weightedCtr, 4),
          avg_position: roundNumber(recentSummary.avgPosition, 2),
        },
        impact_traffic: clamp(48 + Math.round(recentSummary.impressions / 5), 0, 100),
        impact_conversion: 34,
        impact_revenue: 30,
        priority_score: clamp(52 + Math.round(recentSummary.impressions / 8), 0, 100),
        effort_score: 16,
        confidence_score: 0.85,
        recommendation: 'Rewrite title, meta description, and SERP promise so search visibility turns into visits.',
        action_type: 'improve_content',
        action_payload: {
          keyword: keyword.keyword,
          keyword_id: keyword.id,
          optimization_focus: 'ctr_gap',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (recentSummary.impressions >= 1 && recentSummary.avgPosition >= 5 && recentSummary.avgPosition <= 20) {
      decisions.push({
        company_id: companyId,
        report_tier: 'snapshot' as const,
        source_service: 'seoIntelligenceService',
        entity_type: 'keyword' as const,
        entity_id: keyword.id,
        issue_type: 'ranking_opportunity',
        title: 'Keyword is close enough to climb into a traffic-driving position',
        description: `Keyword "${keyword.keyword}" is ranking within striking distance but is not yet capturing enough demand.`,
        evidence: {
          keyword: keyword.keyword,
          landing_page_url: keyword.landing_page_url || recent[0]?.page_url || null,
          impressions: recentSummary.impressions,
          clicks: recentSummary.clicks,
          ctr: roundNumber(recentSummary.weightedCtr, 4),
          avg_position: roundNumber(recentSummary.avgPosition, 2),
        },
        impact_traffic: clamp(42 + Math.round((21 - recentSummary.avgPosition) * 2), 0, 100),
        impact_conversion: 28,
        impact_revenue: 24,
        priority_score: clamp(50 + Math.round((21 - recentSummary.avgPosition) * 1.8), 0, 100),
        effort_score: 22,
        confidence_score: 0.8,
        recommendation: 'Improve topical relevance and supporting depth so this keyword can move from visibility into material traffic.',
        action_type: 'improve_content',
        action_payload: {
          keyword: keyword.keyword,
          keyword_id: keyword.id,
          optimization_focus: 'ranking_opportunity',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (
      previous.length > 0 &&
      previousSummary.impressions > 0 &&
      recentSummary.impressions < previousSummary.impressions * 0.7
    ) {
      const decayRatio = 1 - recentSummary.impressions / Math.max(previousSummary.impressions, 1);
      decisions.push({
        company_id: companyId,
        report_tier: 'snapshot' as const,
        source_service: 'seoIntelligenceService',
        entity_type: 'keyword' as const,
        entity_id: keyword.id,
        issue_type: 'keyword_decay',
        title: 'Keyword demand or ranking is decaying',
        description: `Keyword "${keyword.keyword}" is losing search visibility compared with the earlier measurement window.`,
        evidence: {
          keyword: keyword.keyword,
          recent_impressions: recentSummary.impressions,
          previous_impressions: previousSummary.impressions,
          recent_clicks: recentSummary.clicks,
          previous_clicks: previousSummary.clicks,
          decay_ratio: roundNumber(decayRatio),
        },
        impact_traffic: clamp(36 + Math.round(decayRatio * 50), 0, 100),
        impact_conversion: 26,
        impact_revenue: 24,
        priority_score: clamp(40 + Math.round(decayRatio * 55), 0, 100),
        effort_score: 24,
        confidence_score: 0.77,
        recommendation: 'Refresh the target page and supporting content before the keyword slips out of the reachable set.',
        action_type: 'improve_content',
        action_payload: {
          keyword: keyword.keyword,
          keyword_id: keyword.id,
          optimization_focus: 'keyword_decay',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    // NEW: ranking_gap — position > 20 with impressions (unreachable zone)
    if (recentSummary.impressions >= 1 && recentSummary.avgPosition > 20 && recentSummary.avgPosition <= 100) {
      decisions.push({
        company_id: companyId,
        report_tier: 'snapshot' as const,
        source_service: 'seoIntelligenceService',
        entity_type: 'keyword' as const,
        entity_id: keyword.id,
        issue_type: 'ranking_gap',
        title: 'Keyword is appearing but has minimal ranking strength',
        description: `Keyword "${keyword.keyword}" shows impressions but ranks beyond position 20, in the unreachable zone for organic traffic.`,
        evidence: {
          keyword: keyword.keyword,
          landing_page_url: keyword.landing_page_url || recent[0]?.page_url || null,
          impressions: recentSummary.impressions,
          avg_position: roundNumber(recentSummary.avgPosition, 2),
          clicks: recentSummary.clicks,
        },
        impact_traffic: clamp(44 + Math.round((100 - recentSummary.avgPosition) / 4), 0, 100),
        impact_conversion: 22,
        impact_revenue: 18,
        priority_score: clamp(48 + Math.round((100 - recentSummary.avgPosition) / 3), 0, 100),
        effort_score: 28,
        confidence_score: 0.79,
        recommendation: 'Create comprehensive supporting content and strengthen topical relevance to move this keyword into the top-20 search zone.',
        action_type: 'improve_content',
        action_payload: {
          keyword: keyword.keyword,
          keyword_id: keyword.id,
          optimization_focus: 'ranking_gap',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    // NEW: keyword_opportunity — rising trend or improving position
    if (
      previous.length > 0 &&
      previousSummary.impressions > 0 &&
      recentSummary.impressions > previousSummary.impressions
    ) {
      const trendGain = recentSummary.impressions / Math.max(previousSummary.impressions, 1);
      if (trendGain >= 1.2) {
        // 20%+ growth in impressions
        decisions.push({
          company_id: companyId,
          report_tier: 'snapshot' as const,
          source_service: 'seoIntelligenceService',
          entity_type: 'keyword' as const,
          entity_id: keyword.id,
          issue_type: 'keyword_opportunity',
          title: 'Keyword shows rising search volume or demand momentum',
          description: `Keyword "${keyword.keyword}" has grown impressions by ${Math.round((trendGain - 1) * 100)}% — early window for capture.`,
          evidence: {
            keyword: keyword.keyword,
            previous_impressions: previousSummary.impressions,
            recent_impressions: recentSummary.impressions,
            trend_gain_ratio: roundNumber(trendGain, 2),
            avg_position: roundNumber(recentSummary.avgPosition, 2),
          },
          impact_traffic: clamp(38 + Math.round(Math.min(trendGain - 1, 1) * 50), 0, 100),
          impact_conversion: 26,
          impact_revenue: 22,
          priority_score: clamp(54 + Math.round(Math.min(trendGain - 1, 1) * 30), 0, 100),
          effort_score: 18,
          confidence_score: 0.81,
          recommendation: 'Invest in ranking improvement now while this keyword is gaining traction — early movers capture the volume spike.',
          action_type: 'improve_content',
          action_payload: {
            keyword: keyword.keyword,
            keyword_id: keyword.id,
            optimization_focus: 'keyword_opportunity',
          },
          status: 'open' as const,
          last_changed_by: 'system' as const,
        });
      }
    }
  }

  // NEW: seo_gap — detect keyword theme clusters and identify missing high-value clusters
  if (keywords.length > 0 && metrics.length > 0) {
    const keywordsByRoot = new Map<string, { keyword: KeywordRow; metrics: KeywordMetricRow[] }[]>();

    // Cluster keywords by root (first word) for gap analysis
    for (const keyword of keywords) {
      const rootWord = keyword.keyword.split(/\s+/)[0].toLowerCase();
      const current = keywordsByRoot.get(rootWord) ?? [];
      const keywordMetrics = metricsByKeywordId.get(keyword.id) ?? [];
      current.push({ keyword, metrics: keywordMetrics });
      keywordsByRoot.set(rootWord, current);
    }

    // Find high-volume root keywords with poor coverage
    for (const [rootWord, items] of keywordsByRoot.entries()) {
      if (items.length < 2) continue; // Need at least 2 keywords in a cluster

      const aggregatedMetrics = items.flatMap((item) => item.metrics);
      if (aggregatedMetrics.length === 0) continue;

      const stats = sumMetrics(aggregatedMetrics);
      if (stats.impressions < 50) continue; // Only care about themes with real volume

      // Check if cluster has insufficient depth/breadth
      const uniquePages = new Set(aggregatedMetrics.map((m) => m.page_url)).size;
      const coverageCount = items.length;

      if (uniquePages <= 1 && stats.impressions >= 100) {
        // High-volume keyword cluster but only one landing page
        decisions.push({
          company_id: companyId,
          report_tier: 'growth' as const,
          source_service: 'seoIntelligenceService',
          entity_type: 'keyword' as const,
          entity_id: items[0].keyword.id,
          issue_type: 'seo_gap',
          title: `Keyword theme "${rootWord}" needs broader content coverage`,
          description: `Keyword cluster around "${rootWord}" has ${stats.impressions} impressions but only ${uniquePages} landing page(s). Related keywords suggest a content gap.`,
          evidence: {
            keyword_theme: rootWord,
            theme_impression_volume: stats.impressions,
            theme_keyword_count: coverageCount,
            theme_landing_pages: uniquePages,
            theme_avg_position: roundNumber(stats.avgPosition, 2),
          },
          impact_traffic: clamp(52 + Math.round(Math.min(stats.impressions / 100, 30)), 0, 100),
          impact_conversion: 28,
          impact_revenue: 24,
          priority_score: clamp(58 + Math.round(Math.min(stats.impressions / 150, 30)), 0, 100),
          effort_score: 26,
          confidence_score: 0.78,
          recommendation: `Build dedicated landing pages and supporting content for the "${rootWord}" topic cluster to capture the full search demand.`,
          action_type: 'improve_content',
          action_payload: {
            keyword_theme: rootWord,
            optimization_focus: 'seo_gap',
            related_keyword_count: coverageCount,
          },
          status: 'open' as const,
          last_changed_by: 'system' as const,
        });
      }
    }
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
