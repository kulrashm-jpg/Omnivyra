/**
 * Governance Observability Layer (Stage 10).
 * Aggregates governance metrics per company. Read-only, no constraint changes.
 */

import { supabase } from '../db/supabaseClient';
import { getCampaignsByIds } from '../db/campaignStore';
import { getCompanyCampaignIds } from '../db/campaignVersionStore';

const COOLDOWN_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = () => new Date().toISOString();
const thirtyDaysAgo = () => new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
const sevenDaysAgo = () => new Date(Date.now() - 7 * MS_PER_DAY).toISOString();

export interface GovernancePreemptionMetrics {
  total_preemptions: number;
  preemptions_last_30_days: number;
  preemptions_last_7_days: number;
  preempted_campaigns_currently_invalidated: number;
  campaigns_under_cooldown: number;
}

export interface GovernanceApprovalMetrics {
  pending_preemption_requests: number;
  approved_preemption_requests: number;
  rejected_preemption_requests: number;
}

export interface GovernanceConstraintMetrics {
  total_negotiations_last_30_days: number;
  average_duration_delta: number;
  rejected_duration_changes_last_30_days: number;
  portfolio_conflict_count_last_30_days: number;
}

export interface GovernancePriorityMetrics {
  critical_campaigns_count: number;
  high_priority_campaigns_count: number;
  preemptions_by_priority_breakdown: Record<string, number>;
}

export interface GovernanceSummary {
  companyId: string;
  generatedAt: string;
  metrics: {
    preemption: GovernancePreemptionMetrics;
    approvals: GovernanceApprovalMetrics;
    constraints: GovernanceConstraintMetrics;
    priority: GovernancePriorityMetrics;
  };
}

/**
 * Check if company exists. Returns true if found.
 */
async function companyExists(companyId: string): Promise<boolean> {
  const { data } = await supabase.from('companies').select('id').eq('id', companyId).maybeSingle();
  if (data) return true;
  const { data: cv } = await supabase.from('campaign_versions').select('company_id').eq('company_id', companyId).limit(1).maybeSingle();
  return !!cv;
}

export async function getGovernanceSummary(companyId: string): Promise<GovernanceSummary | null> {
  const exists = await companyExists(companyId);
  if (!exists) return null;

  const campaignIds = await getCompanyCampaignIds(companyId);
  if (!campaignIds || campaignIds.length === 0) {
    return {
      companyId,
      generatedAt: NOW(),
      metrics: {
        preemption: {
          total_preemptions: 0,
          preemptions_last_30_days: 0,
          preemptions_last_7_days: 0,
          preempted_campaigns_currently_invalidated: 0,
          campaigns_under_cooldown: 0,
        },
        approvals: {
          pending_preemption_requests: 0,
          approved_preemption_requests: 0,
          rejected_preemption_requests: 0,
        },
        constraints: {
          total_negotiations_last_30_days: 0,
          average_duration_delta: 0,
          rejected_duration_changes_last_30_days: 0,
          portfolio_conflict_count_last_30_days: 0,
        },
        priority: {
          critical_campaigns_count: 0,
          high_priority_campaigns_count: 0,
          preemptions_by_priority_breakdown: {},
        },
      },
    };
  }

  const t30 = thirtyDaysAgo();
  const t7 = sevenDaysAgo();
  const cooldownThreshold = Date.now() - COOLDOWN_DAYS * MS_PER_DAY;

  const [logByInitiator, logByPreempted, campaignsRows, pendingRequests, approvedRequests, rejectedRequests] = await Promise.all([
    supabase.from('campaign_preemption_log').select('id, preempted_campaign_id, executed_at, initiator_campaign_id').in('initiator_campaign_id', campaignIds),
    supabase.from('campaign_preemption_log').select('id, preempted_campaign_id, executed_at, initiator_campaign_id').in('preempted_campaign_id', campaignIds),
    getCampaignsByIds(campaignIds, 'id, execution_status, blueprint_status, last_preempted_at, priority_level'),
    supabase.from('campaign_preemption_requests').select('id').in('initiator_campaign_id', campaignIds).eq('status', 'PENDING'),
    supabase.from('campaign_preemption_requests').select('id').in('initiator_campaign_id', campaignIds).eq('status', 'EXECUTED').gte('approved_at', t30),
    supabase.from('campaign_preemption_requests').select('id').in('initiator_campaign_id', campaignIds).eq('status', 'REJECTED').gte('rejected_at', t30),
  ]);

  const seenIds = new Set<string>();
  const logs: any[] = [];
  for (const row of [...(logByInitiator.data || []), ...(logByPreempted.data || [])]) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    logs.push(row);
  }
  const totalPreemptions = logs.length;
  const preemptionsLast30 = logs.filter((l: any) => l.executed_at >= t30).length;
  const preemptionsLast7 = logs.filter((l: any) => l.executed_at >= t7).length;

  const campaigns = campaignsRows || [];
  const preemptedInvalidated = campaigns.filter(
    (c: any) => String(c.execution_status || '').toUpperCase() === 'PREEMPTED'
  ).length;
  const underCooldown = campaigns.filter((c: any) => {
    const at = c.last_preempted_at ? new Date(c.last_preempted_at).getTime() : 0;
    return at > 0 && at > cooldownThreshold;
  }).length;

  const pendingCount = (pendingRequests.data || []).length;
  const approvedCount = (approvedRequests.data || []).length;
  const rejectedCount = (rejectedRequests.data || []).length;

  const criticalCount = campaigns.filter((c: any) => String(c.priority_level || '').toUpperCase() === 'CRITICAL').length;
  const highCount = campaigns.filter((c: any) => String(c.priority_level || '').toUpperCase() === 'HIGH').length;

  const preemptionsByPriority: Record<string, number> = { LOW: 0, NORMAL: 0, HIGH: 0, CRITICAL: 0 };
  for (const log of logs) {
    const preemptedId = log.preempted_campaign_id;
    const camp = campaigns.find((c: any) => c.id === preemptedId);
    const priority = String(camp?.priority_level || 'NORMAL').toUpperCase();
    const key = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(priority) ? priority : 'NORMAL';
    preemptionsByPriority[key] = (preemptionsByPriority[key] || 0) + 1;
  }

  return {
    companyId,
    generatedAt: NOW(),
    metrics: {
      preemption: {
        total_preemptions: totalPreemptions,
        preemptions_last_30_days: preemptionsLast30,
        preemptions_last_7_days: preemptionsLast7,
        preempted_campaigns_currently_invalidated: preemptedInvalidated,
        campaigns_under_cooldown: underCooldown,
      },
      approvals: {
        pending_preemption_requests: pendingCount,
        approved_preemption_requests: approvedCount,
        rejected_preemption_requests: rejectedCount,
      },
      constraints: {
        total_negotiations_last_30_days: preemptionsLast30,
        average_duration_delta: 0,
        rejected_duration_changes_last_30_days: 0,
        portfolio_conflict_count_last_30_days: preemptionsLast30,
      },
      priority: {
        critical_campaigns_count: criticalCount,
        high_priority_campaigns_count: highCount,
        preemptions_by_priority_breakdown: preemptionsByPriority,
      },
    },
  };
}
