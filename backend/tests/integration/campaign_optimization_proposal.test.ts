/**
 * Integration tests for Campaign Optimization Proposal.
 * Advisory only. Read-only.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../services/CampaignRoiIntelligenceService', () => ({
  getCampaignRoiIntelligence: jest.fn(),
}));

jest.mock('../../services/CampaignOptimizationIntelligenceService', () => ({
  generateCampaignOptimizationInsights: jest.fn(),
}));

jest.mock('../../services/decisionObjectService', () => ({
  listDecisionObjects: jest.fn(),
}));

jest.mock('../../services/intelligenceExecutionContext', () => ({
  runInApiReadContext: jest.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
}));

jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: any) => h }));

import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getCampaignRoiIntelligence } from '../../services/CampaignRoiIntelligenceService';
import { generateCampaignOptimizationInsights } from '../../services/CampaignOptimizationIntelligenceService';
import { listDecisionObjects } from '../../services/decisionObjectService';
import { generateOptimizationProposal } from '../../services/CampaignOptimizationProposalService';

import proposalHandler from '../../../pages/api/analytics/campaign-optimization-proposal';

const campaignId = 'proposal-campaign-1';

function mockSupabase(campaign: any = { company_id: 'company-1', duration_weeks: 12, start_date: '2026-01-01' }) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'campaigns') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: campaign, error: null }),
        then: (resolve: any) => Promise.resolve({ data: campaign, error: null }).then(resolve),
      };
    }

    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
    };
  });
}

function setInsights(insights: Array<{
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  category: 'PERFORMANCE' | 'GOVERNANCE' | 'EXECUTION' | 'CONTENT_STRATEGY';
  headline: string;
}>) {
  (generateCampaignOptimizationInsights as jest.Mock).mockResolvedValue(
    insights.map((insight) => ({
      campaignId,
      explanation: 'Test explanation',
      recommendedAction: 'Test action',
      ...insight,
    }))
  );
}

describe('Campaign Optimization Proposal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase();
  });

  it('uses proposedPostsPerWeek when roiScore < 50', async () => {
    (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
      campaignId,
      roiScore: 35,
      governanceStabilityScore: 80,
      executionReliabilityScore: 90,
    });
    setInsights([
      { priority: 'HIGH', category: 'PERFORMANCE', headline: 'Campaign performance under target' },
    ]);

    const result = await generateOptimizationProposal(campaignId);

    expect(result).not.toBeNull();
    expect(result!.proposedPostsPerWeek).toBeDefined();
    expect(result!.proposedPostsPerWeek).toBeLessThanOrEqual(5);
    expect(result!.reasoning.some((r) => r.includes('Performance under target'))).toBe(true);
  });

  it('does not propose duration when governance instability exists', async () => {
    (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
      campaignId,
      roiScore: 35,
      governanceStabilityScore: 50,
      executionReliabilityScore: 90,
    });
    setInsights([
      { priority: 'MEDIUM', category: 'GOVERNANCE', headline: 'Governance stability risk detected' },
    ]);

    const result = await generateOptimizationProposal(campaignId);

    expect(result).not.toBeNull();
    expect(result!.proposedDurationWeeks).toBeUndefined();
    expect(result!.proposedStartDateShift).toBe('+7');
    expect(result!.reasoning.some((r) => r.includes('Governance instability'))).toBe(true);
  });

  it('reduces posts when execution risk exists', async () => {
    (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
      campaignId,
      roiScore: 70,
      governanceStabilityScore: 80,
      executionReliabilityScore: 90,
    });
    setInsights([
      { priority: 'HIGH', category: 'EXECUTION', headline: 'Execution reliability risk' },
    ]);

    const result = await generateOptimizationProposal(campaignId);

    expect(result).not.toBeNull();
    expect(result!.proposedPostsPerWeek).toBeDefined();
    expect(result!.reasoning.some((r) => r.includes('Execution reliability'))).toBe(true);
  });

  it('proposes content mix when content strategy risk exists', async () => {
    (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
      campaignId,
      roiScore: 70,
      governanceStabilityScore: 80,
      executionReliabilityScore: 90,
    });
    setInsights([
      { priority: 'MEDIUM', category: 'CONTENT_STRATEGY', headline: 'Content overlap reducing differentiation' },
    ]);

    const result = await generateOptimizationProposal(campaignId);

    expect(result).not.toBeNull();
    expect(result!.proposedContentMixAdjustment).toBeDefined();
    expect(Object.keys(result!.proposedContentMixAdjustment!).length).toBeGreaterThan(0);
    expect(result!.reasoning.some((r) => r.includes('Content overlap'))).toBe(true);
  });

  it('proposes duration extension when roi is high and signals are strong', async () => {
    (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
      campaignId,
      roiScore: 85,
      governanceStabilityScore: 85,
      executionReliabilityScore: 80,
    });
    setInsights([]);

    const result = await generateOptimizationProposal(campaignId);

    expect(result).not.toBeNull();
    expect(result!.proposedDurationWeeks).toBeGreaterThanOrEqual(12);
    expect(result!.reasoning.some((r) => r.toLowerCase().includes('scaling'))).toBe(true);
    expect(result!.confidenceScore).toBeGreaterThanOrEqual(85);
  });

  it('returns null when no optimization signals exist', async () => {
    (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
      campaignId,
      roiScore: 75,
      governanceStabilityScore: 85,
      executionReliabilityScore: 90,
    });
    setInsights([]);

    const result = await generateOptimizationProposal(campaignId);

    expect(result).toBeNull();
  });

  it('API returns 400 when campaignId is missing', async () => {
    const req: any = { method: 'GET', query: {} };
    const res: any = {
      statusCode: 200,
      setHeader: jest.fn(),
      status(code: number) {
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

  it('API returns proposal when campaignId is provided', async () => {
    (listDecisionObjects as jest.Mock).mockResolvedValue([
      {
        priority_score: 72,
        impact_revenue: 68,
        title: 'Campaign performance under target',
        recommendation: 'Reduce weekly volume',
      },
    ]);

    const req: any = { method: 'GET', query: { campaignId } };
    const res: any = {
      statusCode: 200,
      setHeader: jest.fn(),
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json: jest.fn(),
    };

    await proposalHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal: expect.objectContaining({
          campaignId,
          proposedPostsPerWeek: expect.any(Number),
        }),
      })
    );
  });

  it('does not call insert/update/upsert', async () => {
    (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
      campaignId,
      roiScore: 75,
      governanceStabilityScore: 85,
      executionReliabilityScore: 90,
    });
    setInsights([]);

    await generateOptimizationProposal(campaignId);

    const fromCalls = (supabase.from as jest.Mock).mock.results;
    const chain = fromCalls?.[0]?.value;
    expect(chain?.insert).toBeUndefined();
    expect(chain?.update).toBeUndefined();
    expect(chain?.upsert).toBeUndefined();
  });

  it('returns same proposal for same inputs', async () => {
    (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
      campaignId,
      roiScore: 40,
      governanceStabilityScore: 80,
      executionReliabilityScore: 90,
    });
    setInsights([
      { priority: 'HIGH', category: 'PERFORMANCE', headline: 'Campaign performance under target' },
    ]);

    const first = await generateOptimizationProposal(campaignId);
    const second = await generateOptimizationProposal(campaignId);

    expect(first).toEqual(second);
  });
});
