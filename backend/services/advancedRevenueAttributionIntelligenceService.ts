import { supabase } from '../db/supabaseClient';
import {
  archiveDecisionSourceEntityType,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { clamp, normalizeText, roundNumber } from './intelligenceEngineUtils';

type RevenueEventRow = {
  id: string;
  campaign_id: string | null;
  lead_id: string;
  revenue_amount: number;
  conversion_type: string;
};

type LeadRow = {
  id: string;
  source: string;
  qualification_score: number | null;
};

type CampaignRow = {
  id: string;
  budget: number | null;
  channel: string | null;
};

type PageViewRow = {
  session_id: string;
  page_id: string;
};

type SessionRow = {
  id: string;
  source_campaign: string | null;
  source: string;
};

type PageRow = {
  id: string;
  url: string;
  page_type: string;
};

function recentSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function generateAdvancedRevenueAttributionDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('advancedRevenueAttributionIntelligenceService');

  const since = recentSince(180);
  const [revenueRes, leadsRes, campaignsRes, sessionRes] = await Promise.all([
    supabase
      .from('canonical_revenue_events')
      .select('id, campaign_id, lead_id, revenue_amount, conversion_type')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('canonical_leads')
      .select('id, source, qualification_score')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(1000),
    supabase
      .from('campaigns')
      .select('id, budget, channel')
      .eq('company_id', companyId)
      .limit(500),
    supabase
      .from('canonical_sessions')
      .select('id, source_campaign, source')
      .eq('company_id', companyId)
      .gte('started_at', since)
      .limit(1200),
  ]);

  if (revenueRes.error) throw new Error(`Failed to load revenue events: ${revenueRes.error.message}`);
  if (leadsRes.error) throw new Error(`Failed to load leads for revenue attribution: ${leadsRes.error.message}`);
  if (campaignsRes.error) throw new Error(`Failed to load campaigns for revenue attribution: ${campaignsRes.error.message}`);
  if (sessionRes.error) throw new Error(`Failed to load sessions for revenue attribution: ${sessionRes.error.message}`);

  const revenueEvents = (revenueRes.data ?? []) as RevenueEventRow[];
  const leads = (leadsRes.data ?? []) as LeadRow[];
  const campaigns = (campaignsRes.data ?? []) as CampaignRow[];
  const sessions = (sessionRes.data ?? []) as SessionRow[];

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'deep',
    source_service: 'advancedRevenueAttributionIntelligenceService',
    entity_type: 'campaign',
    changed_by: 'system',
  });
  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'deep',
    source_service: 'advancedRevenueAttributionIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  if (revenueEvents.length === 0 || leads.length === 0) return [];

  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const campaignsById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

  const revenueByCampaign = new Map<string, { totalRevenue: number; conversions: number; leadCount: number }>();
  const revenueBySource = new Map<string, { revenue: number; leadCount: number; avgQuality: number; qualityCount: number }>();

  for (const event of revenueEvents) {
    const lead = leadsById.get(event.lead_id);
    const source = normalizeText(lead?.source) || 'unknown';
    const campaignKey = event.campaign_id ?? 'global';

    const campaignAgg = revenueByCampaign.get(campaignKey) ?? { totalRevenue: 0, conversions: 0, leadCount: 0 };
    campaignAgg.totalRevenue += Number(event.revenue_amount ?? 0);
    campaignAgg.conversions += 1;
    campaignAgg.leadCount += lead ? 1 : 0;
    revenueByCampaign.set(campaignKey, campaignAgg);

    const sourceAgg = revenueBySource.get(source) ?? { revenue: 0, leadCount: 0, avgQuality: 0, qualityCount: 0 };
    sourceAgg.revenue += Number(event.revenue_amount ?? 0);
    sourceAgg.leadCount += 1;
    if (typeof lead?.qualification_score === 'number') {
      sourceAgg.avgQuality += Number(lead.qualification_score);
      sourceAgg.qualityCount += 1;
    }
    revenueBySource.set(source, sourceAgg);
  }

  const decisions = [];

  for (const [campaignId, agg] of revenueByCampaign.entries()) {
    if (campaignId === 'global') continue;
    const campaign = campaignsById.get(campaignId);
    const budget = Number(campaign?.budget ?? 0);
    const roiProxy = budget > 0 ? (agg.totalRevenue - budget) / budget : null;

    if (agg.totalRevenue >= 5000 && agg.conversions >= 3) {
      decisions.push({
        company_id: companyId,
        report_tier: 'deep' as const,
        source_service: 'advancedRevenueAttributionIntelligenceService',
        entity_type: 'campaign' as const,
        entity_id: campaignId,
        issue_type: 'high_revenue_driver',
        title: 'Campaign is a high revenue driver',
        description: 'Attribution path indicates this campaign is generating strong revenue and should be protected/scaled.',
        evidence: {
          campaign_id: campaignId,
          channel: campaign?.channel ?? null,
          attributed_revenue: roundNumber(agg.totalRevenue, 2),
          attributed_conversions: agg.conversions,
          roi_proxy: roiProxy != null ? roundNumber(roiProxy, 3) : null,
        },
        impact_traffic: 18,
        impact_conversion: 54,
        impact_revenue: clamp(64 + Math.round(agg.totalRevenue / 1000), 0, 100),
        priority_score: clamp(62 + Math.round(agg.totalRevenue / 1200), 0, 100),
        effort_score: 16,
        confidence_score: 0.84,
        recommendation: 'Scale this campaign carefully and replicate its path characteristics across adjacent campaigns.',
        action_type: 'reallocate_budget',
        action_payload: {
          campaign_id: campaignId,
          optimization_focus: 'high_revenue_driver',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }

    if (budget > 0 && agg.totalRevenue < budget * 0.6 && agg.conversions >= 1) {
      decisions.push({
        company_id: companyId,
        report_tier: 'deep' as const,
        source_service: 'advancedRevenueAttributionIntelligenceService',
        entity_type: 'campaign' as const,
        entity_id: campaignId,
        issue_type: 'low_roi_channel',
        title: 'Campaign channel has low ROI proxy',
        description: 'Attributed revenue remains below cost envelope, indicating low return efficiency for this channel/campaign path.',
        evidence: {
          campaign_id: campaignId,
          channel: campaign?.channel ?? null,
          budget: roundNumber(budget, 2),
          attributed_revenue: roundNumber(agg.totalRevenue, 2),
          roi_proxy: roiProxy != null ? roundNumber(roiProxy, 3) : null,
        },
        impact_traffic: 16,
        impact_conversion: 48,
        impact_revenue: clamp(50 + Math.round(((budget - agg.totalRevenue) / Math.max(1, budget)) * 40), 0, 100),
        priority_score: clamp(58 + Math.round(((budget - agg.totalRevenue) / Math.max(1, budget)) * 35), 0, 100),
        effort_score: 20,
        confidence_score: 0.79,
        recommendation: 'Rebalance spend from low-return channel paths and tighten qualification for this campaign.',
        action_type: 'reallocate_budget',
        action_payload: {
          campaign_id: campaignId,
          optimization_focus: 'low_roi_channel',
        },
        status: 'open' as const,
        last_changed_by: 'system' as const,
      });
    }
  }

  const lowQualityHighRevenueSources = [...revenueBySource.entries()].filter(([, agg]) => {
    const avgQuality = agg.qualityCount > 0 ? agg.avgQuality / agg.qualityCount : 0;
    return agg.revenue >= 1500 && avgQuality < 45;
  });

  if (lowQualityHighRevenueSources.length > 0 || sessions.length > leads.length * 4) {
    decisions.push({
      company_id: companyId,
      report_tier: 'deep' as const,
      source_service: 'advancedRevenueAttributionIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'revenue_leak_path',
      title: 'Revenue leak path detected in attribution chain',
      description: 'Content-to-campaign-to-lead path shows leakage between high-intent activity and retained revenue capture.',
      evidence: {
        sessions_count: sessions.length,
        leads_count: leads.length,
        revenue_events_count: revenueEvents.length,
        leak_ratio_proxy: roundNumber(sessions.length / Math.max(1, leads.length), 2),
        low_quality_high_revenue_sources: lowQualityHighRevenueSources.map(([source]) => source),
      },
      impact_traffic: 12,
      impact_conversion: 56,
      impact_revenue: 68,
      priority_score: clamp(62 + Math.round((sessions.length / Math.max(1, leads.length)) * 2), 0, 100),
      effort_score: 28,
      confidence_score: 0.76,
      recommendation: 'Audit handoffs from engagement to qualified lead and tighten attribution breakpoints to stop revenue leakage.',
      action_type: 'improve_tracking',
      action_payload: {
        optimization_focus: 'revenue_leak_path',
        sessions_to_leads_ratio: roundNumber(sessions.length / Math.max(1, leads.length), 2),
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
