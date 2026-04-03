import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { clamp, normalizeText, roundNumber } from './intelligenceEngineUtils';

type SessionGeoRow = {
  id: string;
  geo_country: string | null;
  source: string;
  is_engaged: boolean;
  page_view_count: number | null;
};

type KeywordMetricRow = {
  impressions: number;
  clicks: number;
  page_url: string;
};

function recentSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function generateGeoStrategyIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('geoStrategyIntelligenceService');

  const [{ data: sessions, error: sessionError }, { data: metrics, error: metricError }] = await Promise.all([
    supabase
      .from('canonical_sessions')
      .select('id, geo_country, source, is_engaged, page_view_count')
      .eq('company_id', companyId)
      .gte('started_at', recentSince(60))
      .order('started_at', { ascending: false })
      .limit(1500),
    supabase
      .from('keyword_metrics')
      .select('impressions, clicks, page_url')
      .eq('company_id', companyId)
      .gte('metric_date', recentSince(45).slice(0, 10))
      .order('metric_date', { ascending: false })
      .limit(1200),
  ]);

  if (sessionError) {
    throw new Error(`Failed to load geo sessions: ${sessionError.message}`);
  }
  if (metricError) {
    throw new Error(`Failed to load geo keyword metrics: ${metricError.message}`);
  }

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'geoStrategyIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const sessionRows = (sessions ?? []) as SessionGeoRow[];
  const keywordRows = (metrics ?? []) as KeywordMetricRow[];
  if (sessionRows.length === 0) return [];

  const geoTraffic = new Map<string, { sessions: number; engaged: number; pageViews: number }>();
  for (const row of sessionRows) {
    const country = normalizeText(row.geo_country || 'unknown');
    const current = geoTraffic.get(country) ?? { sessions: 0, engaged: 0, pageViews: 0 };
    current.sessions += 1;
    if (row.is_engaged) current.engaged += 1;
    current.pageViews += Number(row.page_view_count ?? 0);
    geoTraffic.set(country, current);
  }

  const totalSessions = sessionRows.length;
  const orderedGeos = [...geoTraffic.entries()].sort((a, b) => b[1].sessions - a[1].sessions);
  const topGeo = orderedGeos[0];
  const secondGeo = orderedGeos[1];

  const totalImpressions = keywordRows.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
  const totalClicks = keywordRows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
  const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

  const decisions = [];

  if (topGeo && secondGeo) {
    const topShare = topGeo[1].sessions / totalSessions;
    const secondShare = secondGeo[1].sessions / totalSessions;
    const topEngagement = topGeo[1].sessions > 0 ? topGeo[1].engaged / topGeo[1].sessions : 0;
    const secondEngagement = secondGeo[1].sessions > 0 ? secondGeo[1].engaged / secondGeo[1].sessions : 0;

    if (secondShare >= 0.2 && secondEngagement > topEngagement * 1.15) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'geoStrategyIntelligenceService',
        entity_type: 'global' as const,
        entity_id: null,
        issue_type: 'geo_expansion_opportunity',
        title: 'Secondary geo shows stronger engagement efficiency',
        description: 'A non-primary region is converting engagement better than the dominant traffic geo and merits expansion.',
        evidence: {
          primary_geo: topGeo[0],
          secondary_geo: secondGeo[0],
          primary_share: roundNumber(topShare, 4),
          secondary_share: roundNumber(secondShare, 4),
          primary_engagement_rate: roundNumber(topEngagement, 4),
          secondary_engagement_rate: roundNumber(secondEngagement, 4),
        },
        impact_traffic: clamp(32 + Math.round(secondShare * 120), 0, 100),
        impact_conversion: clamp(38 + Math.round(secondEngagement * 90), 0, 100),
        impact_revenue: clamp(40 + Math.round(secondEngagement * 88), 0, 100),
        priority_score: clamp(58 + Math.round(secondShare * 50), 0, 100),
        effort_score: 28,
        confidence_score: 0.8,
        recommendation: 'Expand localized acquisition and tailored landing content in the high-efficiency secondary geo.',
        action_type: 'fix_distribution',
        action_payload: {
          optimization_focus: 'geo_expansion',
          target_geo: secondGeo[0],
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (topShare >= 0.6 && topEngagement < 0.25) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'geoStrategyIntelligenceService',
        entity_type: 'global' as const,
        entity_id: null,
        issue_type: 'geo_mismatch',
        title: 'Traffic concentration is misaligned with engagement quality',
        description: 'Most traffic is concentrated in a geography with weak engagement, reducing conversion efficiency.',
        evidence: {
          primary_geo: topGeo[0],
          primary_geo_share: roundNumber(topShare, 4),
          primary_geo_engagement_rate: roundNumber(topEngagement, 4),
        },
        impact_traffic: 24,
        impact_conversion: clamp(46 + Math.round((0.3 - topEngagement) * 120), 0, 100),
        impact_revenue: clamp(48 + Math.round((0.3 - topEngagement) * 110), 0, 100),
        priority_score: clamp(62 + Math.round((topShare - 0.6) * 80), 0, 100),
        effort_score: 22,
        confidence_score: 0.82,
        recommendation: 'Rebalance targeting and adapt messaging/localization in the dominant low-engagement geo.',
        action_type: 'adjust_strategy',
        action_payload: {
          optimization_focus: 'geo_mismatch',
          dominant_geo: topGeo[0],
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }
  }

  if (totalImpressions > 250 && ctr < 0.025) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'geoStrategyIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'localized_content_gap',
      title: 'Localized content coverage is insufficient for demand capture',
      description: 'Search demand exists but click-through remains weak, indicating localized relevance/content mismatch.',
      evidence: {
        keyword_impressions: totalImpressions,
        keyword_clicks: totalClicks,
        ctr: roundNumber(ctr, 4),
        observed_geo_count: orderedGeos.length,
      },
      impact_traffic: 44,
      impact_conversion: 28,
      impact_revenue: 34,
      priority_score: clamp(56 + Math.round((0.03 - ctr) * 600), 0, 100),
      effort_score: 26,
      confidence_score: 0.74,
      recommendation: 'Create geo-specific content variants and localized SERP assets for high-demand regions.',
      action_type: 'improve_content',
      action_payload: {
        optimization_focus: 'localized_content_gap',
        observed_ctr: roundNumber(ctr, 4),
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
