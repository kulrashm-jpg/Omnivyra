import { supabase } from '../db/supabaseClient';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { archiveDecisionSourceEntityType, createDecisionObjects, type PersistedDecisionObject } from './decisionObjectService';

type SessionRow = {
  geo_country: string | null;
  is_engaged: boolean;
  page_view_count: number | null;
};

function sinceDays(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function generateGeoIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('geoIntelligenceService');

  const { data, error } = await supabase
    .from('canonical_sessions')
    .select('geo_country, is_engaged, page_view_count')
    .eq('company_id', companyId)
    .gte('started_at', sinceDays(60))
    .limit(2200);

  if (error) throw new Error(`Failed to load sessions for geo intelligence: ${error.message}`);

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'geoIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const rows = (data ?? []) as SessionRow[];
  if (rows.length === 0) return [];

  const byGeo = new Map<string, { sessions: number; engaged: number; deep: number }>();
  for (const row of rows) {
    const geo = String(row.geo_country || 'unknown').trim().toLowerCase();
    const current = byGeo.get(geo) ?? { sessions: 0, engaged: 0, deep: 0 };
    current.sessions += 1;
    if (row.is_engaged) current.engaged += 1;
    if (Number(row.page_view_count ?? 0) >= 3) current.deep += 1;
    byGeo.set(geo, current);
  }

  const ranked = [...byGeo.entries()].sort((a, b) => b[1].sessions - a[1].sessions);
  const primary = ranked[0];
  const secondary = ranked[1];
  const totalSessions = rows.length;

  const decisions = [];
  if (primary && secondary) {
    const primaryShare = primary[1].sessions / totalSessions;
    const secondaryShare = secondary[1].sessions / totalSessions;
    const primaryEng = primary[1].engaged / Math.max(1, primary[1].sessions);
    const secondaryEng = secondary[1].engaged / Math.max(1, secondary[1].sessions);

    if (secondaryShare >= 0.18 && secondaryEng > primaryEng * 1.2) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'geoIntelligenceService',
        entity_type: 'global' as const,
        entity_id: null,
        issue_type: 'geo_opportunity',
        title: 'Secondary region shows stronger intent efficiency',
        description: 'A secondary geography is outperforming engagement efficiency relative to current traffic share.',
        evidence: {
          primary_geo: primary[0],
          secondary_geo: secondary[0],
          primary_share: primaryShare,
          secondary_share: secondaryShare,
          primary_engagement_rate: primaryEng,
          secondary_engagement_rate: secondaryEng,
        },
        impact_traffic: 34,
        impact_conversion: 46,
        impact_revenue: 44,
        priority_score: 65,
        effort_score: 26,
        confidence_score: 0.8,
        recommendation: 'Expand localized distribution in the high-efficiency secondary geography.',
        action_type: 'fix_distribution',
        action_payload: { target_geo: secondary[0], optimization_focus: 'geo_opportunity' },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (primaryShare >= 0.6 && primaryEng < 0.24) {
      decisions.push({
        company_id: companyId,
        report_tier: 'growth' as const,
        source_service: 'geoIntelligenceService',
        entity_type: 'global' as const,
        entity_id: null,
        issue_type: 'geo_gap',
        title: 'Primary geography is underperforming engagement quality',
        description: 'Most traffic is concentrated in a geography with weak behavioral quality.',
        evidence: {
          primary_geo: primary[0],
          primary_share: primaryShare,
          primary_engagement_rate: primaryEng,
        },
        impact_traffic: 24,
        impact_conversion: 56,
        impact_revenue: 54,
        priority_score: 68,
        effort_score: 22,
        confidence_score: 0.82,
        recommendation: 'Adjust geo targeting and localization for the dominant underperforming region.',
        action_type: 'adjust_strategy',
        action_payload: { optimization_focus: 'geo_gap', geo: primary[0] },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }
  }

  const lowDepthGeos = ranked
    .filter((entry) => entry[1].sessions >= 40)
    .filter((entry) => (entry[1].deep / Math.max(1, entry[1].sessions)) < 0.18);
  if (lowDepthGeos.length >= 1) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'geoIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'regional_mismatch',
      title: 'Regional experience is mismatched with user intent depth',
      description: 'At least one active region is producing shallow engagement depth despite sustained traffic.',
      evidence: {
        low_depth_regions: lowDepthGeos.slice(0, 3).map((entry) => ({
          geo: entry[0],
          sessions: entry[1].sessions,
          deep_rate: entry[1].deep / Math.max(1, entry[1].sessions),
        })),
      },
      impact_traffic: 20,
      impact_conversion: 48,
      impact_revenue: 46,
      priority_score: 62,
      effort_score: 24,
      confidence_score: 0.77,
      recommendation: 'Tune regional landing and message variants to improve depth and downstream intent.',
      action_type: 'improve_content',
      action_payload: { optimization_focus: 'regional_fit' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
