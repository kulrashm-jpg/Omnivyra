/**
 * Stage 22 — Governance Analytics & Observability.
 * Stage 24: Replay integrity verification.
 * Deterministic aggregation from campaign_governance_events, campaigns, scheduled_posts.
 * Read-only. No behavioral changes.
 */

import { supabase } from '../db/supabaseClient';
import { replayGovernanceEvent } from './GovernanceReplayService';
import { getCurrentPolicyVersion } from '../governance/GovernancePolicyRegistry';
import { verifyCompanyLedger } from './GovernanceLedgerVerificationService';
import { getProjectionStatus, ProjectionStatus } from './GovernanceProjectionService';
import {
  getReplayLimitedCount,
  getSnapshotRestoreBlockedCount,
  getProjectionRebuildBlockedCount,
} from './GovernanceRateLimiter';
import { getCampaignRoiIntelligence } from './CampaignRoiIntelligenceService';

const REPLAYABLE_EVENT_TYPES = new Set(['DURATION_APPROVED', 'DURATION_NEGOTIATE', 'DURATION_REJECTED']);

export interface GovernanceCampaignAnalytics {
  campaignId: string;
  executionState: string;
  totalEvents: number;
  negotiationCount: number;
  rejectionCount: number;
  preemptionCount: number;
  freezeBlocks: number;
  schedulerRuns: number;
  completionTimestamp?: string;
  totalScheduledPosts?: number;
  totalPublishedPosts?: number;
  /** Stage 23: From latest governance event */
  policyVersion: string;
  policyHash: string;
  /** Stage 24: Replay verification result */
  replayIntegrity?: 'VERIFIED' | 'DRIFT_DETECTED' | 'NOT_REPLAYABLE';
  /** Stage 25: (replayable events) / (total governance events). Replayable = has evaluation_context. */
  replayCoverageRatio: number;
  /** Stage 25: Count of replayed events that resulted in DRIFT_DETECTED (0 or 1 at campaign level). */
  driftCount: number;
  /** Stage 26: Current/latest governance policy version. */
  currentPolicyVersion: string;
  /** Stage 26: Version under which campaign was last evaluated (from latest event). */
  evaluatedUnderPolicyVersion: string;
  /** Stage 26: True if latest event.policy_version !== current policy version. */
  policyUpgradeAvailable: boolean;
  /** Stage 32: Read model projection status */
  projectionStatus?: ProjectionStatus;
}

export interface GovernanceCompanyAnalytics {
  companyId: string;
  totalCampaigns: number;
  activeCampaigns: number;
  completedCampaigns: number;
  preemptedCampaigns: number;
  averageNegotiationsPerCampaign: number;
  constraintFrequency: Record<string, number>;
  /** Stage 25 */
  driftedCampaigns: number;
  verifiedCampaigns: number;
  averageReplayCoverage: number;
  /** Stage 27: 0–100 risk score. driftedCampaigns*25 + (1-coverage)*50 + policyUpgradeCampaigns*10 */
  integrityRiskScore: number;
  /** Stage 28: Campaigns with policy upgrade available */
  policyUpgradeCampaigns: number;
  /** Stage 30: Latest snapshot timestamp for company */
  lastSnapshotAt?: string;
  /** Stage 30: Latest snapshot id for company */
  lastSnapshotId?: string;
  /** Stage 30: Total snapshot count for company */
  snapshotCount: number;
  /** Stage 31: Ledger hash chain integrity */
  ledgerIntegrity: 'VALID' | 'CORRUPTED';
  /** Stage 32: Projection status for company (aggregate of campaign projections) */
  projectionStatus?: ProjectionStatus;
  /** Stage 33: Rate limit / backpressure counters */
  replayRateLimitedCount?: number;
  snapshotRestoreBlockedCount?: number;
  projectionRebuildBlockedCount?: number;
  /** Stage 34: ROI intelligence aggregation */
  averageRoiScore?: number;
  highRiskCampaignsCount?: number;
  highPotentialCampaignsCount?: number;
}

const NEGOTIATION_TYPES = new Set([
  'DURATION_NEGOTIATED',
  'DURATION_NEGOTIATE',
]);

const REJECTION_TYPES = new Set([
  'DURATION_REJECTED',
  'PREEMPTION_REJECTED',
  'BLUEPRINT_MUTATION_BLOCKED',
]);

const PREEMPTION_TYPES = new Set(['PREEMPTION_EXECUTED']);

const FREEZE_TYPES = new Set([
  'BLUEPRINT_FREEZE_BLOCKED',
  'EXECUTION_WINDOW_FROZEN',
  'CAMPAIGN_MUTATION_BLOCKED_FINALIZED',
]);

const SCHEDULER_TYPES = new Set([
  'SCHEDULE_STARTED',
  'SCHEDULE_COMPLETED',
]);

function normalizeEventType(t: string): string {
  return String(t || '').toUpperCase().trim();
}

/**
 * Get campaign-level governance analytics. Never throws.
 * Stage 32: Read from governance_projections first, fallback to live event scan.
 */
export async function getCampaignGovernanceAnalytics(campaignId: string): Promise<GovernanceCampaignAnalytics | null> {
  try {
    const { data: campaign, error: campError } = await supabase
      .from('campaigns')
      .select('id, execution_status')
      .eq('id', campaignId)
      .maybeSingle();

    if (campError || !campaign) return null;

    const projectionStatus = await getProjectionStatus(campaignId);
    const { data: projection } = await supabase
      .from('governance_projections')
      .select('*')
      .eq('campaign_id', campaignId)
      .maybeSingle();

    let executionState = String((campaign as any).execution_status ?? 'DRAFT');
    let totalEvents = 0;
    let negotiationCount = 0;
    let rejectionCount = 0;
    let preemptionCount = 0;
    let freezeBlocks = 0;
    let schedulerRuns = 0;
    let latestPolicyVersion = '1.0.0';
    let latestPolicyHash = '';
    let replayCoverageRatio = 0;
    let driftCount = 0;

    if (projection) {
      executionState = (projection as any).execution_status ?? executionState;
      totalEvents = (projection as any).total_events ?? 0;
      negotiationCount = (projection as any).negotiation_count ?? 0;
      rejectionCount = (projection as any).rejection_count ?? 0;
      preemptionCount = (projection as any).preemption_count ?? 0;
      freezeBlocks = (projection as any).freeze_blocks ?? 0;
      schedulerRuns = (projection as any).scheduler_runs ?? 0;
      latestPolicyVersion = (projection as any).policy_version ?? '1.0.0';
      latestPolicyHash = (projection as any).policy_hash ?? '';
      replayCoverageRatio = Number((projection as any).replay_coverage_ratio ?? 0);
      driftCount = (projection as any).drift_detected ? 1 : 0;
    }

    const { data: events, error: eventsError } = await supabase
      .from('campaign_governance_events')
      .select('id, event_type, event_status, metadata, created_at, policy_version, policy_hash')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(projection ? 200 : 10000);

    const evts = eventsError ? [] : (events || []);
    let completionTimestamp: string | undefined;

    if (!projection) {
      for (const e of evts) {
        const t = normalizeEventType((e as any).event_type);
        if (NEGOTIATION_TYPES.has(t)) negotiationCount++;
        if (REJECTION_TYPES.has(t)) rejectionCount++;
        if (PREEMPTION_TYPES.has(t)) preemptionCount++;
        if (FREEZE_TYPES.has(t)) freezeBlocks++;
        if (SCHEDULER_TYPES.has(t)) schedulerRuns++;
        if (t === 'CAMPAIGN_COMPLETED') {
          const meta = (e as any).metadata || {};
          completionTimestamp = meta.completedAt ?? (e as any).created_at ?? completionTimestamp;
        }
      }
      totalEvents = evts.length;
      const firstEvent = evts[0] as any;
      latestPolicyVersion = (typeof firstEvent?.policy_version === 'string' && firstEvent.policy_version) ? firstEvent.policy_version : '1.0.0';
      latestPolicyHash = (typeof firstEvent?.policy_hash === 'string' && firstEvent.policy_hash) ? firstEvent.policy_hash : '';
      const replayableCount = evts.filter((e: any) => e.metadata?.evaluation_context != null).length;
      replayCoverageRatio = evts.length > 0 ? replayableCount / evts.length : 0;
    }

    for (const e of evts) {
      if (normalizeEventType((e as any).event_type) === 'CAMPAIGN_COMPLETED') {
        const meta = (e as any).metadata || {};
        completionTimestamp = meta.completedAt ?? (e as any).created_at ?? completionTimestamp;
        break;
      }
    }

    const { data: posts, error: postsError } = await supabase
      .from('scheduled_posts')
      .select('id, status')
      .eq('campaign_id', campaignId);

    const postList = postsError ? [] : (posts || []);
    const totalScheduledPosts = postList.length;
    const totalPublishedPosts = postList.filter((p: any) => String(p.status || '').toUpperCase() === 'PUBLISHED').length;

    let replayIntegrity: 'VERIFIED' | 'DRIFT_DETECTED' | 'NOT_REPLAYABLE' | undefined;
    const latestReplayable = evts.find(
      (e: any) =>
        REPLAYABLE_EVENT_TYPES.has(normalizeEventType(e.event_type)) &&
        e.metadata?.evaluation_context != null
    );
    if (latestReplayable && (latestReplayable as any).id) {
      try {
        const replayResult = await replayGovernanceEvent((latestReplayable as any).id);
        replayIntegrity = replayResult.statusMatch ? 'VERIFIED' : 'DRIFT_DETECTED';
        driftCount = replayIntegrity === 'DRIFT_DETECTED' ? 1 : 0;
      } catch {
        replayIntegrity = 'NOT_REPLAYABLE';
      }
    } else {
      replayIntegrity = 'NOT_REPLAYABLE';
    }
    if (!projection) {
      const replayableCount = evts.filter((e: any) => e.metadata?.evaluation_context != null).length;
      replayCoverageRatio = evts.length > 0 ? replayableCount / evts.length : 0;
    }
    const currentPolicyVersion = getCurrentPolicyVersion();
    const evaluatedUnderPolicyVersion = latestPolicyVersion || currentPolicyVersion;
    const policyUpgradeAvailable =
      latestPolicyVersion
        ? latestPolicyVersion !== currentPolicyVersion
        : false;

    return {
      campaignId,
      executionState,
      totalEvents,
      negotiationCount,
      rejectionCount,
      preemptionCount,
      freezeBlocks,
      schedulerRuns,
      ...(completionTimestamp && { completionTimestamp }),
      totalScheduledPosts,
      totalPublishedPosts,
      policyVersion: latestPolicyVersion,
      policyHash: latestPolicyHash,
      replayIntegrity,
      replayCoverageRatio,
      driftCount,
      currentPolicyVersion,
      evaluatedUnderPolicyVersion,
      policyUpgradeAvailable,
      projectionStatus,
    };
  } catch {
    return null;
  }
}

async function getCompanyCampaignIds(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('campaign_id')
    .eq('company_id', companyId);
  if (error) return [];
  return Array.from(new Set((data || []).map((r: any) => r.campaign_id).filter(Boolean)));
}

/**
 * Get company-level governance analytics. Never throws.
 */
export async function getCompanyGovernanceAnalytics(companyId: string): Promise<GovernanceCompanyAnalytics> {
  try {
    const campaignIds = await getCompanyCampaignIds(companyId);
    if (!campaignIds.length) {
      const { data: snapshotRow } = await supabase
        .from('governance_snapshots')
        .select('id, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { count } = await supabase
        .from('governance_snapshots')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);
      return {
        companyId,
        totalCampaigns: 0,
        activeCampaigns: 0,
        completedCampaigns: 0,
        preemptedCampaigns: 0,
        averageNegotiationsPerCampaign: 0,
        constraintFrequency: {},
        driftedCampaigns: 0,
        verifiedCampaigns: 0,
        averageReplayCoverage: 0,
        integrityRiskScore: 0,
        policyUpgradeCampaigns: 0,
        lastSnapshotAt: (snapshotRow as any)?.created_at ?? undefined,
        lastSnapshotId: (snapshotRow as any)?.id ?? undefined,
        snapshotCount: count ?? 0,
        ledgerIntegrity: 'VALID',
        replayRateLimitedCount: getReplayLimitedCount(companyId),
        snapshotRestoreBlockedCount: getSnapshotRestoreBlockedCount(companyId),
        projectionRebuildBlockedCount: getProjectionRebuildBlockedCount(companyId),
        averageRoiScore: undefined,
        highRiskCampaignsCount: 0,
        highPotentialCampaignsCount: 0,
      };
    }

    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id, execution_status')
      .in('id', campaignIds);

    const campList = campaigns || [];
    const totalCampaigns = campList.length;
    const execMap = new Map<string, number>();
    for (const c of campList) {
      const s = String((c as any).execution_status ?? 'DRAFT').toUpperCase();
      execMap.set(s, (execMap.get(s) ?? 0) + 1);
    }
    const activeCampaigns = execMap.get('ACTIVE') ?? 0;
    const completedCampaigns = execMap.get('COMPLETED') ?? 0;
    const preemptedCampaigns = execMap.get('PREEMPTED') ?? 0;

    const { data: projections } = await supabase
      .from('governance_projections')
      .select('negotiation_count, rebuilding_since')
      .eq('company_id', companyId);

    const projList = projections || [];
    let totalNegotiations = projList.reduce((sum: number, p: any) => sum + (p.negotiation_count ?? 0), 0);

    const { data: events } = await supabase
      .from('campaign_governance_events')
      .select('event_type')
      .in('campaign_id', campaignIds);

    const evts = events || [];
    const constraintFreq: Record<string, number> = {};
    if (projList.length === 0) {
      for (const e of evts) {
        const t = normalizeEventType((e as any).event_type);
        constraintFreq[t] = (constraintFreq[t] ?? 0) + 1;
        if (NEGOTIATION_TYPES.has(t)) totalNegotiations++;
      }
    } else {
      for (const e of evts) {
        const t = normalizeEventType((e as any).event_type);
        constraintFreq[t] = (constraintFreq[t] ?? 0) + 1;
      }
    }

    const averageNegotiationsPerCampaign = totalCampaigns > 0 ? totalNegotiations / totalCampaigns : 0;

    let driftedCampaigns = 0;
    let verifiedCampaigns = 0;
    let policyUpgradeAvailableCampaigns = 0;
    let totalReplayCoverage = 0;
    let campaignsWithCoverage = 0;
    let totalRoiScore = 0;
    let roiCampaignCount = 0;
    let highRiskCampaignsCount = 0;
    let highPotentialCampaignsCount = 0;
    for (const cid of campaignIds) {
      try {
        const campAnalytics = await getCampaignGovernanceAnalytics(cid);
        if (!campAnalytics) continue;
        if (campAnalytics.replayIntegrity === 'DRIFT_DETECTED') driftedCampaigns++;
        if (campAnalytics.replayIntegrity === 'VERIFIED') verifiedCampaigns++;
        if (campAnalytics.policyUpgradeAvailable) policyUpgradeAvailableCampaigns++;
        totalReplayCoverage += campAnalytics.replayCoverageRatio ?? 0;
        campaignsWithCoverage++;
        const roi = await getCampaignRoiIntelligence(cid, campAnalytics);
        totalRoiScore += roi.roiScore;
        roiCampaignCount++;
        if (roi.optimizationSignal === 'AT_RISK') highRiskCampaignsCount++;
        if (roi.optimizationSignal === 'HIGH_POTENTIAL') highPotentialCampaignsCount++;
      } catch {
        /* skip */
      }
    }
    const averageReplayCoverage = campaignsWithCoverage > 0 ? totalReplayCoverage / campaignsWithCoverage : 0;
    const averageRoiScore = roiCampaignCount > 0 ? Math.round((totalRoiScore / roiCampaignCount) * 100) / 100 : undefined;

    const integrityRiskScore = Math.max(
      0,
      Math.min(
        100,
        driftedCampaigns * 25 +
          (1 - averageReplayCoverage) * 50 +
          policyUpgradeAvailableCampaigns * 10
      )
    );

    let lastSnapshotAt: string | undefined;
    let lastSnapshotId: string | undefined;
    let snapshotCount = 0;
    let ledgerIntegrity: 'VALID' | 'CORRUPTED' = 'VALID';
    try {
      const { data: snapshotRow } = await supabase
        .from('governance_snapshots')
        .select('id, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { count } = await supabase
        .from('governance_snapshots')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);
      lastSnapshotAt = (snapshotRow as any)?.created_at ?? undefined;
      lastSnapshotId = (snapshotRow as any)?.id ?? undefined;
      snapshotCount = count ?? 0;
    } catch {
      /* ignore */
    }

    try {
      const ledgerResult = await verifyCompanyLedger(companyId);
      ledgerIntegrity = ledgerResult.valid ? 'VALID' : 'CORRUPTED';
    } catch {
      ledgerIntegrity = 'CORRUPTED';
    }

    let projectionStatus: ProjectionStatus = 'MISSING';
    if (projList.length > 0) {
      const anyRebuilding = projList.some((r: any) => r.rebuilding_since != null);
      projectionStatus = anyRebuilding ? 'REBUILDING' : (projList.length >= campaignIds.length ? 'ACTIVE' : 'MISSING');
    }

    return {
      companyId,
      totalCampaigns,
      activeCampaigns,
      completedCampaigns,
      preemptedCampaigns,
      averageNegotiationsPerCampaign: Math.round(averageNegotiationsPerCampaign * 100) / 100,
      constraintFrequency: constraintFreq,
      driftedCampaigns,
      verifiedCampaigns,
      averageReplayCoverage: Math.round(averageReplayCoverage * 100) / 100,
      integrityRiskScore: Math.round(integrityRiskScore * 100) / 100,
      policyUpgradeCampaigns: policyUpgradeAvailableCampaigns,
      lastSnapshotAt,
      lastSnapshotId,
      snapshotCount,
      ledgerIntegrity,
      projectionStatus,
      replayRateLimitedCount: getReplayLimitedCount(companyId),
      snapshotRestoreBlockedCount: getSnapshotRestoreBlockedCount(companyId),
      projectionRebuildBlockedCount: getProjectionRebuildBlockedCount(companyId),
      averageRoiScore,
      highRiskCampaignsCount,
      highPotentialCampaignsCount,
    };
  } catch {
    return {
      companyId,
      totalCampaigns: 0,
      activeCampaigns: 0,
      completedCampaigns: 0,
      preemptedCampaigns: 0,
      averageNegotiationsPerCampaign: 0,
      constraintFrequency: {},
      driftedCampaigns: 0,
      verifiedCampaigns: 0,
      averageReplayCoverage: 0,
      integrityRiskScore: 0,
      policyUpgradeCampaigns: 0,
      lastSnapshotAt: undefined,
      lastSnapshotId: undefined,
      snapshotCount: 0,
      ledgerIntegrity: 'VALID',
      projectionStatus: 'MISSING' as ProjectionStatus,
      replayRateLimitedCount: 0,
      snapshotRestoreBlockedCount: 0,
      projectionRebuildBlockedCount: 0,
      averageRoiScore: undefined,
      highRiskCampaignsCount: 0,
      highPotentialCampaignsCount: 0,
    };
  }
}
