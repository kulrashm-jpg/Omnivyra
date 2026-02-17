/**
 * Stage 37 — Auto-Optimization Eligibility Guard.
 * Deterministic. All criteria must pass. Never throws.
 */

import { supabase } from '../db/supabaseClient';
import { getLatestCampaignVersionByCampaignId } from '../db/campaignVersionStore';
import { getCampaignGovernanceAnalytics } from './GovernanceAnalyticsService';
import { getCompanyGovernanceAnalytics } from './GovernanceAnalyticsService';
import { generateOptimizationProposal } from './CampaignOptimizationProposalService';
import { isGovernanceLocked } from './GovernanceLockdownService';
import { normalizeExecutionState } from '../governance/ExecutionStateMachine';

export interface AutoOptimizationEligibility {
  eligible: boolean;
  reason?: string;
}

const TERMINAL_STATES = new Set(['COMPLETED', 'PREEMPTED']);

/**
 * Evaluate whether a campaign is eligible for auto-optimization.
 * All criteria must pass. Never throws.
 */
export async function evaluateAutoOptimizationEligibility(
  campaignId: string
): Promise<AutoOptimizationEligibility> {
  try {
    if (!campaignId || typeof campaignId !== 'string') {
      return { eligible: false, reason: 'Invalid campaignId' };
    }

    if (await isGovernanceLocked()) {
      return { eligible: false, reason: 'Governance locked' };
    }

    const [campaignRow, version, govAnalytics, companyAnalytics, proposal] = await Promise.all([
      supabase
        .from('campaigns')
        .select('id, execution_status, blueprint_status, duration_locked')
        .eq('id', campaignId)
        .maybeSingle()
        .then((r) => (r.error ? null : r.data)),
      getLatestCampaignVersionByCampaignId(campaignId),
      getCampaignGovernanceAnalytics(campaignId),
      (async () => {
        const v = await getLatestCampaignVersionByCampaignId(campaignId);
        if (!v?.company_id) return null;
        try {
          return await getCompanyGovernanceAnalytics(v.company_id);
        } catch {
          return null;
        }
      })(),
      generateOptimizationProposal(campaignId),
    ]);

    const campaign = campaignRow as { execution_status?: string; blueprint_status?: string; duration_locked?: boolean } | null;
    if (!campaign) {
      return { eligible: false, reason: 'Campaign not found' };
    }

    const execStatus = normalizeExecutionState(campaign.execution_status);
    if (TERMINAL_STATES.has(execStatus)) {
      return { eligible: false, reason: 'Terminal state' };
    }

    if (execStatus !== 'ACTIVE') {
      return { eligible: false, reason: 'execution_status must be ACTIVE' };
    }

    const bpStatus = String(campaign.blueprint_status || 'ACTIVE').toUpperCase();
    if (bpStatus !== 'ACTIVE') {
      return { eligible: false, reason: 'blueprint_status must be ACTIVE' };
    }

    if (!campaign.duration_locked) {
      return { eligible: false, reason: 'duration_locked must be true' };
    }

    if (!govAnalytics) {
      return { eligible: false, reason: 'Governance analytics unavailable' };
    }

    if (govAnalytics.replayIntegrity !== 'VERIFIED') {
      return { eligible: false, reason: 'replayIntegrity must be VERIFIED' };
    }

    const replayCoverageRatio = govAnalytics.replayCoverageRatio ?? 0;
    if (replayCoverageRatio < 0.9) {
      return { eligible: false, reason: 'replayCoverageRatio must be >= 0.9' };
    }

    const driftCount = govAnalytics.driftCount ?? 0;
    if (driftCount > 0) {
      return { eligible: false, reason: 'driftCount must be 0' };
    }

    const integrityRiskScore = companyAnalytics?.integrityRiskScore ?? 100;
    if (integrityRiskScore >= 50) {
      return { eligible: false, reason: 'integrityRiskScore must be < 50' };
    }

    const freezeBlocks = govAnalytics.freezeBlocks ?? 0;
    if (freezeBlocks > 0) {
      return { eligible: false, reason: 'freezeBlocks must be 0' };
    }

    const preemptionCount = govAnalytics.preemptionCount ?? 0;
    if (preemptionCount > 0) {
      return { eligible: false, reason: 'preemptions must be 0' };
    }

    if (!proposal) {
      return { eligible: false, reason: 'No optimization proposal' };
    }

    const confidence = proposal.confidenceScore ?? 0;
    if (confidence < 75) {
      return { eligible: false, reason: 'confidenceScore must be >= 75' };
    }

    if (govAnalytics.policyUpgradeAvailable) {
      return { eligible: false, reason: 'policyUpgradeAvailable must be false' };
    }

    return { eligible: true };
  } catch {
    return { eligible: false, reason: 'Evaluation failed' };
  }
}
