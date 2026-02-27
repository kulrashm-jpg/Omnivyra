/**
 * Stage 37 — Controlled Auto-Optimization Execution.
 * Orchestrates existing APIs only. No direct DB mutation. Never throws.
 */

import { supabase } from '../db/supabaseClient';
import { getLatestCampaignVersionByCampaignId } from '../db/campaignVersionStore';
import { evaluateAutoOptimizationEligibility } from './CampaignAutoOptimizationGuard';
import { generateOptimizationProposal } from './CampaignOptimizationProposalService';
import { getCampaignRoiIntelligence } from './CampaignRoiIntelligenceService';
import { runPrePlanning } from './CampaignPrePlanningService';
import { createGovernanceSnapshot } from './GovernanceSnapshotService';
import { recordGovernanceEvent } from './GovernanceEventService';
import { GOVERNANCE_POLICY_VERSION, getGovernancePolicyHash } from '../governance/GovernancePolicy';

export interface AutoOptimizationResult {
  applied: boolean;
  reason?: string;
}

/**
 * Run auto-optimization for a campaign. Uses existing APIs only.
 * Never throws. Non-blocking safe.
 */
export async function runAutoOptimization(campaignId: string): Promise<AutoOptimizationResult> {
  try {
    const eligibility = await evaluateAutoOptimizationEligibility(campaignId);
    if (!eligibility.eligible) {
      return { applied: false, reason: eligibility.reason ?? 'Not eligible' };
    }

    const [proposal, version] = await Promise.all([
      generateOptimizationProposal(campaignId),
      getLatestCampaignVersionByCampaignId(campaignId),
    ]);

    if (!proposal) {
      return { applied: false, reason: 'No optimization proposal' };
    }

    const companyId = version?.company_id;
    if (!companyId) {
      return { applied: false, reason: 'Company not found' };
    }

    const roi = await getCampaignRoiIntelligence(campaignId);
    const policyVersion = GOVERNANCE_POLICY_VERSION;
    const policyHash = getGovernancePolicyHash();

    await createGovernanceSnapshot({
      companyId,
      campaignId,
      snapshotType: 'CAMPAIGN',
    });

    const weeksToApply = proposal.proposedDurationWeeks;
    if (weeksToApply == null || weeksToApply < 1 || weeksToApply > 52) {
      return { applied: false, reason: 'Proposal has no applicable duration change' };
    }

    const evaluation = await runPrePlanning({
      companyId,
      campaignId,
      requested_weeks: weeksToApply,
      suppressEvents: true,
    });

    if (evaluation.status === 'REJECTED') {
      return {
        applied: false,
        reason: 'Proposal blocked by constraints',
      };
    }

    if (evaluation.status === 'NEGOTIATE') {
      return {
        applied: false,
        reason: `Proposal requires negotiation: max ${evaluation.max_weeks_allowed} weeks`,
      };
    }

    const { error: updateError } = await supabase
      .from('campaigns')
      .update({
        duration_weeks: weeksToApply,
        blueprint_status: 'INVALIDATED',
        duration_locked: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    if (updateError) {
      return {
        applied: false,
        reason: `Failed to update duration: ${updateError.message}`,
      };
    }

    await recordGovernanceEvent({
      companyId,
      campaignId,
      eventType: 'GOVERNANCE_AUTO_OPTIMIZED',
      eventStatus: 'APPLIED',
      metadata: {
        campaignId,
        proposalSnapshot: proposal,
        confidenceScore: proposal.confidenceScore,
        roiScore: roi.roiScore,
        policy_version: policyVersion,
        policy_hash: policyHash,
        appliedChanges: [{ type: 'duration', proposedDurationWeeks: weeksToApply }],
      },
      evaluationContext: {
        requested_weeks: weeksToApply,
      },
    });

    return { applied: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { applied: false, reason: msg };
  }
}
