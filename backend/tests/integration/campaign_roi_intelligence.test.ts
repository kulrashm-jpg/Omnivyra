/**
 * Integration tests for Campaign ROI Intelligence (Stage 34).
 * Analytical + advisory only. No writes, no governance events.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../governance/GovernancePolicyRegistry', () => ({
  getCurrentPolicyVersion: jest.fn().mockReturnValue('1.0.0'),
}));
jest.mock('../../services/GovernanceReplayService', () => ({
  replayGovernanceEvent: jest.fn().mockResolvedValue({ statusMatch: true }),
}));

import { supabase } from '../../db/supabaseClient';
import { getCampaignRoiIntelligence } from '../../services/CampaignRoiIntelligenceService';
import { getCompanyGovernanceAnalytics } from '../../services/GovernanceAnalyticsService';
import campaignRoiHandler from '../../../pages/api/analytics/campaign-roi';
import companyRoiHandler from '../../../pages/api/analytics/company-roi';

jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: any) => h }));

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

const campaignId = 'campaign-roi-1';
const companyId = 'company-roi-1';

describe('Campaign ROI Intelligence', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('No performance data', () => {
    it('returns safe defaults when no metrics', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_performance_metrics') return chain({ data: [], error: null });
        if (table === 'governance_projections') return chain({ data: null, error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const result = await getCampaignRoiIntelligence(campaignId);

      expect(result.campaignId).toBe(campaignId);
      expect(result.roiScore).toBeGreaterThanOrEqual(0);
      expect(result.roiScore).toBeLessThanOrEqual(100);
      expect(result.performanceScore).toBeGreaterThanOrEqual(0);
      expect(result.governanceStabilityScore).toBeGreaterThanOrEqual(0);
      expect(result.executionReliabilityScore).toBeGreaterThanOrEqual(0);
      expect(['STABLE', 'AT_RISK', 'HIGH_POTENTIAL']).toContain(result.optimizationSignal);
    });
  });

  describe('High governance friction', () => {
    it('reduces ROI when drift, negotiations, freeze blocks high', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_performance_metrics') return chain({ data: [], error: null });
        if (table === 'governance_projections') {
          return chain({
            data: {
              drift_detected: true,
              negotiation_count: 3,
              freeze_blocks: 2,
              preemption_count: 0,
              total_events: 10,
              execution_status: 'ACTIVE',
            },
            error: null,
          });
        }
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const result = await getCampaignRoiIntelligence(campaignId);

      expect(result.governanceStabilityScore).toBeLessThan(80);
      expect(result.roiScore).toBeLessThan(result.performanceScore + 30);
    });
  });

  describe('Stable campaign', () => {
    it('returns high ROI when governance stable and performance present', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'COMPLETED' }, error: null });
        if (table === 'campaign_performance_metrics') {
          return chain({
            data: [
              { engagement_rate: 0.08, click_through_rate: 0.05, impressions: 1000, likes: 50, comments: 5, shares: 2 },
            ],
            error: null,
          });
        }
        if (table === 'governance_projections') {
          return chain({
            data: { drift_detected: false, negotiation_count: 0, freeze_blocks: 0, execution_status: 'COMPLETED' },
            error: null,
          });
        }
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'scheduled_posts') {
          return chain({ data: [{ status: 'published' }, { status: 'published' }], error: null });
        }
        return chain({ data: null, error: null });
      });

      const result = await getCampaignRoiIntelligence(campaignId);

      expect(result.roiScore).toBeGreaterThanOrEqual(50);
      expect(result.optimizationSignal).toMatch(/STABLE|HIGH_POTENTIAL/);
    });
  });

  describe('Never throws', () => {
    it('returns defaults on invalid campaignId', async () => {
      const result = await getCampaignRoiIntelligence('');
      expect(result.campaignId).toBe('');
      expect(result.roiScore).toBe(50);
    });

    it('handles supabase errors gracefully', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = await getCampaignRoiIntelligence(campaignId);
      expect(result).toBeDefined();
      expect(result.roiScore).toBe(50);
    });
  });

  describe('API', () => {
    it('campaign-roi returns 400 on missing campaignId', async () => {
      const req: any = { method: 'GET', query: {} };
      const res: any = {
        statusCode: 200,
        status(c: number) {
          this.statusCode = c;
          return this;
        },
        json(o: any) {
          this.body = o;
        },
      };
      await campaignRoiHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('campaignId');
    });

    it('company-roi returns 400 on missing companyId', async () => {
      const req: any = { method: 'GET', query: {} };
      const res: any = {
        statusCode: 200,
        status(c: number) {
          this.statusCode = c;
          return this;
        },
        json(o: any) {
          this.body = o;
        },
      };
      await companyRoiHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('companyId');
    });
  });

  describe('Company aggregation', () => {
    it('getCompanyGovernanceAnalytics includes averageRoiScore and counts', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [{ campaign_id: campaignId }], error: null });
        if (table === 'campaigns') return chain({ data: [{ id: campaignId, execution_status: 'ACTIVE' }], error: null });
        if (table === 'governance_projections') return chain({ data: [{ negotiation_count: 0, rebuilding_since: null }], error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'governance_snapshots') return chain({ data: null, error: null });
        if (table === 'campaign_performance_metrics') return chain({ data: [], error: null });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCompanyGovernanceAnalytics(companyId);

      expect(analytics).toHaveProperty('averageRoiScore');
      expect(analytics).toHaveProperty('highRiskCampaignsCount');
      expect(analytics).toHaveProperty('highPotentialCampaignsCount');
      expect(typeof analytics.highRiskCampaignsCount).toBe('number');
      expect(typeof analytics.highPotentialCampaignsCount).toBe('number');
    });
  });
});
