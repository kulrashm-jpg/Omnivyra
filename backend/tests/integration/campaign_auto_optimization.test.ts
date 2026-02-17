/**
 * Stage 37 — Campaign Auto-Optimization Integration Tests.
 * Covers guard, executor, and API. Advisory + controlled execution.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/CampaignRoiIntelligenceService', () => ({
  getCampaignRoiIntelligence: jest.fn(),
}));
jest.mock('../../services/GovernanceAnalyticsService', () => ({
  getCampaignGovernanceAnalytics: jest.fn(),
  getCompanyGovernanceAnalytics: jest.fn(),
}));
jest.mock('../../services/CampaignOptimizationIntelligenceService', () => ({
  generateCampaignOptimizationInsights: jest.fn(),
}));
jest.mock('../../services/CampaignOptimizationProposalService', () => ({
  generateOptimizationProposal: jest.fn(),
}));
jest.mock('../../services/GovernanceLockdownService', () => ({
  isGovernanceLocked: jest.fn(),
}));
jest.mock('../../services/GovernanceSnapshotService', () => ({
  createGovernanceSnapshot: jest.fn().mockResolvedValue({ snapshotId: 'snap-1' }),
}));
jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(),
}));
jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersionByCampaignId: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { getCampaignRoiIntelligence } from '../../services/CampaignRoiIntelligenceService';
import { getCampaignGovernanceAnalytics } from '../../services/GovernanceAnalyticsService';
import { getCompanyGovernanceAnalytics } from '../../services/GovernanceAnalyticsService';
import { generateOptimizationProposal } from '../../services/CampaignOptimizationProposalService';
import { isGovernanceLocked } from '../../services/GovernanceLockdownService';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import { runPrePlanning } from '../../services/CampaignPrePlanningService';
import { getLatestCampaignVersionByCampaignId } from '../../db/campaignVersionStore';
import { evaluateAutoOptimizationEligibility } from '../../services/CampaignAutoOptimizationGuard';
import { runAutoOptimization } from '../../services/CampaignAutoOptimizationService';

const campaignId = 'auto-opt-campaign-1';
const companyId = 'company-auto-1';

function chain(res: { data: any; error: any }) {
  const m: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(res),
    update: jest.fn().mockReturnThis(),
    then: (resolve: (r: any) => void) => Promise.resolve({ error: null }).then(resolve),
  };
  m.update.mockReturnValue(m);
  return m;
}

describe('Campaign Auto-Optimization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isGovernanceLocked as jest.Mock).mockResolvedValue(false);
    (getLatestCampaignVersionByCampaignId as jest.Mock).mockResolvedValue({ company_id: companyId });
    (getCompanyGovernanceAnalytics as jest.Mock).mockResolvedValue({
      integrityRiskScore: 20,
    });
    (supabase.from as jest.Mock).mockImplementation((t: string) => {
      if (t === 'campaigns')
        return chain({
          data: {
            id: campaignId,
            execution_status: 'ACTIVE',
            blueprint_status: 'ACTIVE',
            duration_locked: true,
          },
          error: null,
        });
      return chain({ data: null, error: null });
    });
  });

  describe('evaluateAutoOptimizationEligibility', () => {
    it('returns not eligible when governance locked', async () => {
      (isGovernanceLocked as jest.Mock).mockResolvedValue(true);

      const result = await evaluateAutoOptimizationEligibility(campaignId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('locked');
    });

    it('returns not eligible when terminal state', async () => {
      (supabase.from as jest.Mock).mockImplementation((t: string) => {
        if (t === 'campaigns')
          return chain({ data: { id: campaignId, execution_status: 'COMPLETED', blueprint_status: 'ACTIVE', duration_locked: true }, error: null });
        return chain({ data: null, error: null });
      });

      const result = await evaluateAutoOptimizationEligibility(campaignId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Terminal');
    });

    it('returns not eligible when drift', async () => {
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 1,
        replayIntegrity: 'VERIFIED',
        replayCoverageRatio: 1,
        freezeBlocks: 0,
        preemptionCount: 0,
        policyUpgradeAvailable: false,
      });
      (generateOptimizationProposal as jest.Mock).mockResolvedValue({
        campaignId,
        confidenceScore: 80,
        summary: 'Test',
        reasoning: [],
      });

      const result = await evaluateAutoOptimizationEligibility(campaignId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('drift');
    });

    it('returns not eligible when freeze blocks', async () => {
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayIntegrity: 'VERIFIED',
        replayCoverageRatio: 0.95,
        freezeBlocks: 1,
        preemptionCount: 0,
        policyUpgradeAvailable: false,
      });
      (generateOptimizationProposal as jest.Mock).mockResolvedValue({
        campaignId,
        confidenceScore: 80,
        summary: 'Test',
        reasoning: [],
      });

      const result = await evaluateAutoOptimizationEligibility(campaignId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('freeze');
    });

    it('returns not eligible when low confidence', async () => {
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayIntegrity: 'VERIFIED',
        replayCoverageRatio: 0.95,
        freezeBlocks: 0,
        preemptionCount: 0,
        policyUpgradeAvailable: false,
      });
      (generateOptimizationProposal as jest.Mock).mockResolvedValue({
        campaignId,
        confidenceScore: 60,
        summary: 'Test',
        reasoning: [],
      });

      const result = await evaluateAutoOptimizationEligibility(campaignId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('confidence');
    });

    it('returns eligible when all criteria pass', async () => {
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayIntegrity: 'VERIFIED',
        replayCoverageRatio: 0.95,
        freezeBlocks: 0,
        preemptionCount: 0,
        policyUpgradeAvailable: false,
      });
      (generateOptimizationProposal as jest.Mock).mockResolvedValue({
        campaignId,
        confidenceScore: 85,
        summary: 'Test',
        reasoning: [],
        proposedDurationWeeks: 15,
      });

      const result = await evaluateAutoOptimizationEligibility(campaignId);

      expect(result.eligible).toBe(true);
    });
  });

  describe('runAutoOptimization', () => {
    it('returns not applied when not eligible', async () => {
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 1,
        replayIntegrity: 'VERIFIED',
        replayCoverageRatio: 0.95,
        freezeBlocks: 0,
        preemptionCount: 0,
        policyUpgradeAvailable: false,
      });
      (generateOptimizationProposal as jest.Mock).mockResolvedValue({
        campaignId,
        confidenceScore: 85,
        summary: 'Test',
        reasoning: [],
        proposedDurationWeeks: 15,
      });

      const result = await runAutoOptimization(campaignId);

      expect(result.applied).toBe(false);
    });

    it('returns applied when eligible and preplanning approves', async () => {
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayIntegrity: 'VERIFIED',
        replayCoverageRatio: 0.95,
        freezeBlocks: 0,
        preemptionCount: 0,
        policyUpgradeAvailable: false,
      });
      (generateOptimizationProposal as jest.Mock).mockResolvedValue({
        campaignId,
        confidenceScore: 85,
        summary: 'Test',
        reasoning: [],
        proposedDurationWeeks: 15,
      });
      (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
        campaignId,
        roiScore: 80,
      });
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'APPROVED',
        max_weeks_allowed: 15,
        limiting_constraints: [],
        blocking_constraints: [],
      });

      const result = await runAutoOptimization(campaignId);

      expect(result.applied).toBe(true);
      expect(recordGovernanceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'GOVERNANCE_AUTO_OPTIMIZED',
          eventStatus: 'APPLIED',
        })
      );
    });

    it('returns not applied when proposal has no duration', async () => {
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayIntegrity: 'VERIFIED',
        replayCoverageRatio: 0.95,
        freezeBlocks: 0,
        preemptionCount: 0,
        policyUpgradeAvailable: false,
      });
      (generateOptimizationProposal as jest.Mock).mockResolvedValue({
        campaignId,
        confidenceScore: 85,
        summary: 'Test',
        reasoning: [],
        proposedDurationWeeks: undefined,
      });

      const result = await runAutoOptimization(campaignId);

      expect(result.applied).toBe(false);
      expect(result.reason).toContain('no applicable');
    });

    it('returns not applied when preplanning rejects', async () => {
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayIntegrity: 'VERIFIED',
        replayCoverageRatio: 0.95,
        freezeBlocks: 0,
        preemptionCount: 0,
        policyUpgradeAvailable: false,
      });
      (generateOptimizationProposal as jest.Mock).mockResolvedValue({
        campaignId,
        confidenceScore: 85,
        summary: 'Test',
        reasoning: [],
        proposedDurationWeeks: 15,
      });
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'REJECTED',
        max_weeks_allowed: 0,
        limiting_constraints: [],
        blocking_constraints: [],
      });

      const result = await runAutoOptimization(campaignId);

      expect(result.applied).toBe(false);
      expect(result.reason).toContain('blocked');
    });
  });
});
