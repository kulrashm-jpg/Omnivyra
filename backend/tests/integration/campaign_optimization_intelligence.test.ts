/**
 * Integration tests for Campaign Optimization Intelligence (Stage 35).
 * Advisory only. No mutation. No governance events. Read-only.
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

import { supabase } from '../../db/supabaseClient';
import { getCampaignRoiIntelligence } from '../../services/CampaignRoiIntelligenceService';
import { getCampaignGovernanceAnalytics } from '../../services/GovernanceAnalyticsService';
import {
  generateCampaignOptimizationInsights,
  type CampaignOptimizationInsight,
} from '../../services/CampaignOptimizationIntelligenceService';

import campaignOptimizationHandler from '../../../pages/api/analytics/campaign-optimization';

jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: any) => h }));

const campaignId = 'opt-campaign-1';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

function mockSupabase(events: any[] = [], posts: any[] = []) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'campaign_governance_events') return chain({ data: events, error: null });
    if (table === 'scheduled_posts') return chain({ data: posts, error: null });
    return chain({ data: [], error: null });
  });
}

describe('Campaign Optimization Intelligence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase([], []);
  });

  describe('Low ROI → PERFORMANCE insight', () => {
    it('returns HIGH priority PERFORMANCE insight when roiScore < 50', async () => {
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

      const insights = await generateCampaignOptimizationInsights(campaignId);

      expect(insights).toContainEqual(
        expect.objectContaining({
          priority: 'HIGH',
          category: 'PERFORMANCE',
          headline: 'Campaign performance under target',
        })
      );
    });
  });

  describe('Drift → GOVERNANCE insight', () => {
    it('returns MEDIUM priority GOVERNANCE insight when driftCount > 0', async () => {
      (getCampaignRoiIntelligence as jest.Mock).mockResolvedValue({
        campaignId,
        roiScore: 70,
        performanceScore: 60,
        governanceStabilityScore: 60,
        executionReliabilityScore: 90,
        optimizationSignal: 'STABLE',
      });
      (getCampaignGovernanceAnalytics as jest.Mock).mockResolvedValue({
        driftCount: 1,
        replayCoverageRatio: 1,
        freezeBlocks: 0,
      });

      const insights = await generateCampaignOptimizationInsights(campaignId);

      expect(insights).toContainEqual(
        expect.objectContaining({
          priority: 'MEDIUM',
          category: 'GOVERNANCE',
          headline: 'Governance stability risk detected',
        })
      );
    });

    it('returns MEDIUM priority GOVERNANCE insight when replayCoverageRatio < 0.8', async () => {
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
        replayCoverageRatio: 0.5,
        freezeBlocks: 0,
      });

      const insights = await generateCampaignOptimizationInsights(campaignId);

      expect(insights).toContainEqual(
        expect.objectContaining({
          priority: 'MEDIUM',
          category: 'GOVERNANCE',
          headline: 'Governance stability risk detected',
        })
      );
    });
  });

  describe('Freeze blocks → EXECUTION insight', () => {
    it('returns HIGH priority EXECUTION insight when freezeBlocks > 0', async () => {
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

      const insights = await generateCampaignOptimizationInsights(campaignId);

      expect(insights).toContainEqual(
        expect.objectContaining({
          priority: 'HIGH',
          category: 'EXECUTION',
          headline: 'Execution reliability risk',
        })
      );
    });

    it('returns HIGH priority EXECUTION insight when scheduler failures exist', async () => {
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
      mockSupabase([], [{ status: 'failed' }, { status: 'published' }]);

      const insights = await generateCampaignOptimizationInsights(campaignId);

      expect(insights).toContainEqual(
        expect.objectContaining({
          priority: 'HIGH',
          category: 'EXECUTION',
          headline: 'Execution reliability risk',
        })
      );
    });
  });

  describe('Content collision → CONTENT_STRATEGY insight', () => {
    it('returns MEDIUM priority CONTENT_STRATEGY insight when collision events exist', async () => {
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
      mockSupabase(
        [{ event_type: 'CONTENT_COLLISION_DETECTED' }],
        []
      );

      const insights = await generateCampaignOptimizationInsights(campaignId);

      expect(insights).toContainEqual(
        expect.objectContaining({
          priority: 'MEDIUM',
          category: 'CONTENT_STRATEGY',
          headline: 'Content overlap reducing differentiation',
        })
      );
    });
  });

  describe('Stable campaign → LOW insight', () => {
    it('returns single LOW priority insight when no issues', async () => {
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

      const insights = await generateCampaignOptimizationInsights(campaignId);

      expect(insights).toHaveLength(1);
      expect(insights[0]).toMatchObject({
        priority: 'LOW',
        headline: 'Campaign operating within optimal range',
      });
    });
  });

  describe('Validation', () => {
    it('returns empty array for empty campaignId', async () => {
      const insights = await generateCampaignOptimizationInsights('');
      expect(insights).toEqual([]);
    });

    it('returns fallback LOW insight on service error', async () => {
      (getCampaignRoiIntelligence as jest.Mock).mockRejectedValue(new Error('roi failed'));

      const insights = await generateCampaignOptimizationInsights(campaignId);

      expect(insights).toHaveLength(1);
      expect(insights[0].priority).toBe('LOW');
      expect(insights[0].headline).toContain('optimal');
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

      await generateCampaignOptimizationInsights(campaignId);

      const fromCalls = (supabase.from as jest.Mock).mock.results;
      const chain = fromCalls?.[0]?.value;
      expect(chain?.insert).toBeUndefined();
      expect(chain?.update).toBeUndefined();
      expect(chain?.upsert).toBeUndefined();
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

      await campaignOptimizationHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('returns insights when campaignId is provided', async () => {
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

      await campaignOptimizationHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          insights: expect.any(Array),
        })
      );
      expect((res.json as jest.Mock).mock.calls[0][0].insights.length).toBeGreaterThan(0);
    });
  });
});
