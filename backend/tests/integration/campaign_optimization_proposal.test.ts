/**
 * Integration tests for Campaign Optimization Proposal (Stage 36).
 * Advisory only. No mutation. Read-only.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/CampaignRoiIntelligenceService', () => ({
  getCampaignRoiIntelligence: jest.fn(),
}));
jest.mock('../../services/GovernanceAnalyticsService', () => ({
  getCampaignGovernanceAnalytics: jest.fn(),
}));
jest.mock('../../services/CampaignOptimizationIntelligenceService', () => ({
  generateCampaignOptimizationInsights: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { getCampaignRoiIntelligence } from '../../services/CampaignRoiIntelligenceService';
import { getCampaignGovernanceAnalytics } from '../../services/GovernanceAnalyticsService';
import { generateOptimizationProposal } from '../../services/CampaignOptimizationProposalService';

import proposalHandler from '../../../pages/api/analytics/campaign-optimization-proposal';

jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: any) => h }));

const campaignId = 'proposal-campaign-1';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

function mockSupabase(
  campaigns: any = { duration_weeks: 12, start_date: '2026-01-01' },
  events: any[] = [],
  posts: any[] = []
) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'campaigns') return chain({ data: campaigns, error: null });
    if (table === 'campaign_governance_events') return chain({ data: events, error: null });
    if (table === 'scheduled_posts') return chain({ data: posts, error: null });
    return chain({ data: null, error: null });
  });
}

describe('Campaign Optimization Proposal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase();
  });

  describe('Low ROI → proposal reduces frequency', () => {
    it('uses proposedPostsPerWeek when roiScore < 50', async () => {
      (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
        campaignId,
        roiScore: 35,
        performanceScore: 40,
        governanceStabilityScore: 80,
        executionReliabilityScore: 90,
        optimizationSignal: 'AT_RISK',
      });
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayCoverageRatio: 1,
        freezeBlocks: 0,
      });

      const result = await generateOptimizationProposal(campaignId);

      expect(result).not.toBeNull();
      expect(result!.proposedPostsPerWeek).toBeDefined();
      expect(result!.proposedPostsPerWeek).toBeLessThanOrEqual(5);
      expect(result!.reasoning.some((r) => r.includes('Performance under target'))).toBe(true);
    });
  });

  describe('Governance instability → no duration change', () => {
    it('does not propose duration when driftCount > 0', async () => {
      (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
        campaignId,
        roiScore: 35,
        performanceScore: 40,
        governanceStabilityScore: 50,
        executionReliabilityScore: 90,
        optimizationSignal: 'AT_RISK',
      });
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 1,
        replayCoverageRatio: 1,
        freezeBlocks: 0,
      });

      const result = await generateOptimizationProposal(campaignId);

      expect(result).not.toBeNull();
      expect(result!.proposedDurationWeeks).toBeUndefined();
      expect(result!.reasoning.some((r) => r.includes('Governance instability'))).toBe(true);
    });
  });

  describe('Freeze risk → lower frequency', () => {
    it('reduces posts when freezeBlocks > 0', async () => {
      (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
        campaignId,
        roiScore: 70,
        performanceScore: 60,
        governanceStabilityScore: 80,
        executionReliabilityScore: 90,
        optimizationSignal: 'STABLE',
      });
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayCoverageRatio: 1,
        freezeBlocks: 2,
      });

      const result = await generateOptimizationProposal(campaignId);

      expect(result).not.toBeNull();
      expect(result!.proposedPostsPerWeek).toBeDefined();
      expect(result!.reasoning.some((r) => r.includes('Execution reliability'))).toBe(true);
    });
  });

  describe('Content collision → mix adjustment', () => {
    it('proposes content mix when collision detected', async () => {
      (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
        campaignId,
        roiScore: 70,
        performanceScore: 60,
        governanceStabilityScore: 80,
        executionReliabilityScore: 90,
        optimizationSignal: 'STABLE',
      });
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayCoverageRatio: 1,
        freezeBlocks: 0,
      });
      mockSupabase({ duration_weeks: 12, start_date: '2026-01-01' }, [
        { event_type: 'CONTENT_COLLISION_DETECTED' },
      ], []);

      const result = await generateOptimizationProposal(campaignId);

      expect(result).not.toBeNull();
      expect(result!.proposedContentMixAdjustment).toBeDefined();
      expect(Object.keys(result!.proposedContentMixAdjustment!).length).toBeGreaterThan(0);
      expect(result!.reasoning.some((r) => r.includes('Content overlap'))).toBe(true);
    });
  });

  describe('High potential → duration extension', () => {
    it('proposes duration extension when roi >= 80 and gov/exec high', async () => {
      (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
        campaignId,
        roiScore: 85,
        performanceScore: 80,
        governanceStabilityScore: 85,
        executionReliabilityScore: 80,
        optimizationSignal: 'HIGH_POTENTIAL',
      });
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayCoverageRatio: 1,
        freezeBlocks: 0,
      });

      const result = await generateOptimizationProposal(campaignId);

      expect(result).not.toBeNull();
      expect(result!.proposedDurationWeeks).toBeDefined();
      expect(result!.proposedDurationWeeks).toBeGreaterThanOrEqual(12);
      expect(result!.reasoning.some((r) => r.toLowerCase().includes('scaling'))).toBe(true);
      expect(result!.confidenceScore).toBeGreaterThanOrEqual(85);
    });
  });

  describe('Stable campaign → null proposal', () => {
    it('returns null when no optimization signals', async () => {
      (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
        campaignId,
        roiScore: 75,
        performanceScore: 70,
        governanceStabilityScore: 85,
        executionReliabilityScore: 90,
        optimizationSignal: 'STABLE',
      });
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayCoverageRatio: 1,
        freezeBlocks: 0,
      });

      const result = await generateOptimizationProposal(campaignId);

      expect(result).toBeNull();
    });
  });

  describe('API', () => {
    it('returns 400 when campaignId is missing', async () => {
      const req: any = { method: 'GET', query: {} };
      const res: any = {
        statusCode: 200,
        setHeader: jest.fn(),
        status: function (code: number) {
          this.statusCode = code;
          return this;
        },
        json: jest.fn(),
      };

      await proposalHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('returns proposal or null when campaignId provided', async () => {
      (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
        campaignId,
        roiScore: 40,
        performanceScore: 45,
        governanceStabilityScore: 80,
        executionReliabilityScore: 90,
        optimizationSignal: 'AT_RISK',
      });
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayCoverageRatio: 1,
        freezeBlocks: 0,
      });

      const req: any = { method: 'GET', query: { campaignId } };
      const res: any = {
        statusCode: 200,
        setHeader: jest.fn(),
        status: function (code: number) {
          this.statusCode = code;
          return this;
        },
        json: jest.fn(),
      };

      await proposalHandler(req, res);

      expect(res.statusCode).toBe(200);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body).toHaveProperty('proposal');
    });
  });

  describe('No DB writes', () => {
    it('does not call insert/update/upsert', async () => {
      (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
        campaignId,
        roiScore: 75,
        performanceScore: 70,
        governanceStabilityScore: 85,
        executionReliabilityScore: 90,
        optimizationSignal: 'STABLE',
      });
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayCoverageRatio: 1,
        freezeBlocks: 0,
      });

      await generateOptimizationProposal(campaignId);

      const fromCalls = (supabase.from as jest.Mock).mock.results;
      const chain = fromCalls?.[0]?.value;
      expect(chain?.insert).toBeUndefined();
      expect(chain?.update).toBeUndefined();
      expect(chain?.upsert).toBeUndefined();
    });
  });

  describe('Deterministic outputs', () => {
    it('returns same proposal for same inputs', async () => {
      (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
        campaignId,
        roiScore: 40,
        performanceScore: 45,
        governanceStabilityScore: 80,
        executionReliabilityScore: 90,
        optimizationSignal: 'AT_RISK',
      });
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 0,
        replayCoverageRatio: 1,
        freezeBlocks: 0,
      });

      const r1 = await generateOptimizationProposal(campaignId);
      const r2 = await generateOptimizationProposal(campaignId);

      expect(r1).toEqual(r2);
    });
  });
});
