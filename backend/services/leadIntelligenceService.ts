import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { clamp, normalizeText, roundNumber } from './intelligenceEngineUtils';

type CanonicalLeadRow = {
  id: string;
  source: string;
  qualification_score: number | null;
  created_at: string;
};

type RevenueEventRow = {
  id: string;
  lead_id: string;
  revenue_amount: number | null;
  created_at: string;
};

function inferLeadQuality(lead: CanonicalLeadRow): number {
  const score = Number(lead.qualification_score ?? 35);
  return clamp(Math.round(score), 0, 100);
}

function ageInDays(createdAt: string): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
}

async function loadCanonicalLeadRevenueContext(companyId: string): Promise<{
  canonicalLeads: CanonicalLeadRow[];
  revenueEvents: RevenueEventRow[];
}> {
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const { data: canonicalLeads, error: leadsError } = await supabase
    .from('canonical_leads')
    .select('id, source, qualification_score, created_at')
    .eq('company_id', companyId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);

  if (leadsError) {
    throw new Error(`Failed to load canonical leads for ${companyId}: ${leadsError.message}`);
  }

  const leadIds = ((canonicalLeads ?? []) as CanonicalLeadRow[]).map((lead) => lead.id);
  if (leadIds.length === 0) {
    return { canonicalLeads: [], revenueEvents: [] };
  }

  const { data: revenueEvents, error: revenueError } = await supabase
    .from('canonical_revenue_events')
    .select('id, lead_id, revenue_amount, created_at')
    .eq('company_id', companyId)
    .in('lead_id', leadIds)
    .order('created_at', { ascending: false });

  if (revenueError) {
    throw new Error(`Failed to load canonical revenue events for ${companyId}: ${revenueError.message}`);
  }

  return {
    canonicalLeads: (canonicalLeads ?? []) as CanonicalLeadRow[],
    revenueEvents: (revenueEvents ?? []) as RevenueEventRow[],
  };
}

export async function generateLeadIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('leadIntelligenceService');

  const { canonicalLeads, revenueEvents } = await loadCanonicalLeadRevenueContext(companyId);

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'deep',
    source_service: 'leadIntelligenceService',
    entity_type: 'lead',
    changed_by: 'system',
  });

  if (canonicalLeads.length === 0) {
    return [];
  }

  const qualityBySource = new Map<string, { total: number; count: number }>();
  for (const lead of canonicalLeads) {
    const source = normalizeText(lead.source) || 'unknown';
    const score = inferLeadQuality(lead);
    const current = qualityBySource.get(source) ?? { total: 0, count: 0 };
    current.total += score;
    current.count += 1;
    qualityBySource.set(source, current);
  }

  const lowQualitySources = new Set(
    [...qualityBySource.entries()]
      .filter(([, item]) => item.count >= 3 && (item.total / item.count) < 45)
      .map(([source]) => source)
  );

  const decisions = [];
  for (const lead of canonicalLeads) {
    const quality = inferLeadQuality(lead);
    const leadAgeDays = ageInDays(lead.created_at);
    const source = normalizeText(lead.source) || 'unknown';

    if (quality < 45) {
      decisions.push({
        company_id: companyId,
        report_tier: 'deep' as const,
        source_service: 'leadIntelligenceService',
        entity_type: 'lead' as const,
        entity_id: lead.id,
        issue_type: 'low_quality_lead',
        title: 'Lead quality is below operating threshold',
        description: `Lead from ${source} scored ${quality}/100 on qualification readiness.`,
        evidence: {
          lead_id: lead.id,
          source,
          inferred_quality_score: quality,
          qualification_score: Number(lead.qualification_score ?? 0),
        },
        impact_traffic: 10,
        impact_conversion: clamp(55 - Math.round(quality / 2), 0, 100),
        impact_revenue: clamp(60 - Math.round(quality / 2), 0, 100),
        priority_score: clamp(65 - Math.round(quality / 3), 0, 100),
        effort_score: 18,
        confidence_score: 0.84,
        recommendation: 'Tighten qualification rules and route weak leads into a lower-intent nurture path.',
        action_type: 'capture_leads',
        action_payload: {
          opportunity_type: 'lead_qualification',
          lead_id: lead.id,
          source,
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (leadAgeDays >= 14 && quality < 60) {
      decisions.push({
        company_id: companyId,
        report_tier: 'deep' as const,
        source_service: 'leadIntelligenceService',
        entity_type: 'lead' as const,
        entity_id: lead.id,
        issue_type: 'high_dropoff_lead',
        title: 'Lead is aging without strong qualification',
        description: `Lead from ${source} is ${leadAgeDays} days old and still shows weak qualification signals.`,
        evidence: {
          lead_id: lead.id,
          source,
          inferred_quality_score: quality,
          age_days: leadAgeDays,
        },
        impact_traffic: 5,
        impact_conversion: clamp(40 + Math.round(leadAgeDays / 2), 0, 100),
        impact_revenue: clamp(45 + Math.round(leadAgeDays / 2), 0, 100),
        priority_score: clamp(42 + Math.round(leadAgeDays / 2), 0, 100),
        effort_score: 22,
        confidence_score: 0.79,
        recommendation: 'Escalate or recycle aging leads before they decay into pipeline noise.',
        action_type: 'capture_leads',
        action_payload: {
          opportunity_type: 'lead_reactivation',
          lead_id: lead.id,
          age_days: leadAgeDays,
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (lowQualitySources.has(source)) {
      const sourceStats = qualityBySource.get(source)!;
      decisions.push({
        company_id: companyId,
        report_tier: 'deep' as const,
        source_service: 'leadIntelligenceService',
        entity_type: 'lead' as const,
        entity_id: lead.id,
        issue_type: 'unqualified_lead_source',
        title: 'Lead source is producing weak-fit contacts',
        description: `Lead source ${source} is producing low-quality leads on average.`,
        evidence: {
          lead_id: lead.id,
          source,
          source_lead_count: sourceStats.count,
          source_avg_quality: Math.round(sourceStats.total / sourceStats.count),
        },
        impact_traffic: 0,
        impact_conversion: 58,
        impact_revenue: 63,
        priority_score: 61,
        effort_score: 26,
        confidence_score: 0.82,
        recommendation: 'Refine targeting or form qualification for this source before adding more volume.',
        action_type: 'capture_leads',
        action_payload: {
          opportunity_type: 'source_qualification',
          lead_id: lead.id,
          source,
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }
  }

  const revenueByLeadId = new Map<string, RevenueEventRow[]>();
  for (const revenueEvent of revenueEvents) {
    const current = revenueByLeadId.get(revenueEvent.lead_id) ?? [];
    current.push(revenueEvent);
    revenueByLeadId.set(revenueEvent.lead_id, current);
  }

  const sourceAggregate = new Map<string, {
    leadCount: number;
    convertingLeadCount: number;
    totalRevenue: number;
    totalQualification: number;
    representativeLeadId: string;
  }>();

  for (const lead of canonicalLeads) {
    const source = normalizeText(lead.source) || 'unknown';
    const current = sourceAggregate.get(source) ?? {
      leadCount: 0,
      convertingLeadCount: 0,
      totalRevenue: 0,
      totalQualification: 0,
      representativeLeadId: lead.id,
    };
    const leadRevenue = (revenueByLeadId.get(lead.id) ?? []).reduce(
      (sum, event) => sum + Number(event.revenue_amount ?? 0),
      0
    );

    current.leadCount += 1;
    current.totalQualification += Number(lead.qualification_score ?? 0);
    current.totalRevenue += leadRevenue;
    if (leadRevenue > 0) {
      current.convertingLeadCount += 1;
      current.representativeLeadId = lead.id;
    }
    sourceAggregate.set(source, current);
  }

  for (const [source, stats] of sourceAggregate.entries()) {
    const conversionRate = stats.leadCount > 0 ? stats.convertingLeadCount / stats.leadCount : 0;
    const revenuePerLead = stats.leadCount > 0 ? stats.totalRevenue / stats.leadCount : 0;
    const avgQualification = stats.leadCount > 0 ? stats.totalQualification / stats.leadCount : 0;

    if (stats.totalRevenue > 0 && conversionRate >= 0.25) {
      decisions.push({
        company_id: companyId,
        report_tier: 'deep' as const,
        source_service: 'leadIntelligenceService',
        entity_type: 'lead' as const,
        entity_id: stats.representativeLeadId,
        issue_type: 'high_value_source',
        title: 'Lead source is producing high-value pipeline',
        description: `Source ${source} is converting into revenue at a healthy rate and deserves more attention.`,
        evidence: {
          source,
          source_lead_count: stats.leadCount,
          converting_lead_count: stats.convertingLeadCount,
          conversion_rate: roundNumber(conversionRate),
          revenue_per_lead: roundNumber(revenuePerLead, 2),
          total_revenue: roundNumber(stats.totalRevenue, 2),
        },
        impact_traffic: 12,
        impact_conversion: 58,
        impact_revenue: clamp(58 + Math.round(revenuePerLead / 25), 0, 100),
        priority_score: clamp(54 + Math.round(revenuePerLead / 30), 0, 100),
        effort_score: 14,
        confidence_score: 0.81,
        recommendation: 'Scale this source deliberately while preserving the qualification signals that are producing revenue.',
        action_type: 'capture_leads',
        action_payload: {
          opportunity_type: 'high_value_source',
          lead_id: stats.representativeLeadId,
          source,
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (stats.leadCount >= 3 && conversionRate < 0.15) {
      decisions.push({
        company_id: companyId,
        report_tier: 'deep' as const,
        source_service: 'leadIntelligenceService',
        entity_type: 'lead' as const,
        entity_id: stats.representativeLeadId,
        issue_type: 'low_conversion_source',
        title: 'Lead source volume is not converting into revenue',
        description: `Source ${source} is bringing in leads, but very few are progressing into revenue events.`,
        evidence: {
          source,
          source_lead_count: stats.leadCount,
          converting_lead_count: stats.convertingLeadCount,
          conversion_rate: roundNumber(conversionRate),
          avg_qualification_score: roundNumber(avgQualification, 2),
        },
        impact_traffic: 0,
        impact_conversion: 62,
        impact_revenue: 66,
        priority_score: 64,
        effort_score: 20,
        confidence_score: 0.83,
        recommendation: 'Reduce low-fit volume from this source until conversion quality is back under control.',
        action_type: 'capture_leads',
        action_payload: {
          opportunity_type: 'low_conversion_source',
          lead_id: stats.representativeLeadId,
          source,
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (stats.leadCount >= 2 && avgQualification >= 55 && stats.totalRevenue === 0) {
      decisions.push({
        company_id: companyId,
        report_tier: 'deep' as const,
        source_service: 'leadIntelligenceService',
        entity_type: 'lead' as const,
        entity_id: stats.representativeLeadId,
        issue_type: 'revenue_leak',
        title: 'Qualified leads are leaking before revenue capture',
        description: `Source ${source} is generating qualified leads, but none of them are materializing into recorded revenue.`,
        evidence: {
          source,
          source_lead_count: stats.leadCount,
          avg_qualification_score: roundNumber(avgQualification, 2),
          total_revenue: roundNumber(stats.totalRevenue, 2),
          conversion_rate: roundNumber(conversionRate),
        },
        impact_traffic: 0,
        impact_conversion: 52,
        impact_revenue: 72,
        priority_score: 69,
        effort_score: 24,
        confidence_score: 0.78,
        recommendation: 'Audit the handoff from lead to deal so qualified demand is not disappearing between capture and revenue.',
        action_type: 'capture_leads',
        action_payload: {
          opportunity_type: 'revenue_leak',
          lead_id: stats.representativeLeadId,
          source,
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }
  }

  if (decisions.length === 0) {
    return [];
  }

  return createDecisionObjects(decisions);
}
