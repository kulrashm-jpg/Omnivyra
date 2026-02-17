/**
 * Integration tests for Governance Drift Monitoring (Stage 25).
 * Replay coverage, drift detection, company aggregation.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(),
}));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: any) => h }));

import { supabase } from '../../db/supabaseClient';
import { runPrePlanning } from '../../services/CampaignPrePlanningService';
import { getGovernancePolicyHash } from '../../governance/GovernancePolicy';
import {
  getCampaignGovernanceAnalytics,
  getCompanyGovernanceAnalytics,
} from '../../services/GovernanceAnalyticsService';
import companyDriftHandler from '../../../pages/api/governance/company-drift';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
}

const campaignId = 'campaign-uuid-123';
const companyId = 'company-uuid-456';
const eventId = 'event-uuid-789';

describe('Governance Drift Monitoring', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('Campaign with full replay coverage → 1.0', () => {
    it('replayCoverageRatio is 1 when all events have evaluation_context', async () => {
      const mockEvent = {
        id: eventId,
        company_id: companyId,
        campaign_id: campaignId,
        event_type: 'DURATION_APPROVED',
        event_status: 'APPROVED',
        metadata: {
          requested_weeks: 12,
          evaluation_context: { requested_weeks: 12 },
        },
        policy_version: '1.0.0',
        policy_hash: getGovernancePolicyHash(),
      };

      let govCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events') {
          govCallCount++;
          return chain({
            data: govCallCount > 1 ? mockEvent : [mockEvent],
            error: null,
          });
        }
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });
      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'APPROVED' });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).not.toBeNull();
      expect(analytics!.replayCoverageRatio).toBe(1);
      expect(analytics!.driftCount).toBe(0);
    });
  });

  describe('Campaign with partial replayable events', () => {
    it('replayCoverageRatio is ratio when only some events have evaluation_context', async () => {
      const evts = [
        { id: 'e1', event_type: 'DURATION_APPROVED', metadata: { evaluation_context: {} }, policy_version: '1.0.0', policy_hash: getGovernancePolicyHash() },
        { id: 'e2', event_type: 'SCHEDULE_STARTED', metadata: {}, policy_version: '1.0.0', policy_hash: '' },
      ];

      let govCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events') {
          govCallCount++;
          const singleEvt = evts[0];
          (singleEvt as any).company_id = companyId;
          (singleEvt as any).campaign_id = campaignId;
          return chain({ data: govCallCount > 1 ? singleEvt : evts, error: null });
        }
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });
      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'APPROVED' });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).not.toBeNull();
      expect(analytics!.totalEvents).toBe(2);
      expect(analytics!.replayCoverageRatio).toBe(0.5);
    });
  });

  describe('Campaign with drift', () => {
    it('driftCount is 1 when replay returns status mismatch', async () => {
      const mockEvent = {
        id: eventId,
        company_id: companyId,
        campaign_id: campaignId,
        event_type: 'DURATION_APPROVED',
        event_status: 'APPROVED',
        metadata: {
          requested_weeks: 12,
          evaluation_context: { requested_weeks: 12 },
        },
        policy_version: '1.0.0',
        policy_hash: getGovernancePolicyHash(),
      };

      let govCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events') {
          govCallCount++;
          return chain({ data: govCallCount > 1 ? mockEvent : [mockEvent], error: null });
        }
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });
      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'NEGOTIATE' });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).not.toBeNull();
      expect(analytics!.replayIntegrity).toBe('DRIFT_DETECTED');
      expect(analytics!.driftCount).toBe(1);
    });
  });

  describe('Company aggregation across mixed campaigns', () => {
    it('returns driftedCampaigns, verifiedCampaigns, averageReplayCoverage', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [{ campaign_id: 'c1' }], error: null });
        if (table === 'campaigns') return chain({ data: [{ id: 'c1', execution_status: 'ACTIVE' }], error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCompanyGovernanceAnalytics(companyId);

      expect(analytics.totalCampaigns).toBe(1);
      expect(analytics.verifiedCampaigns).toBeDefined();
      expect(analytics.driftedCampaigns).toBeDefined();
      expect(typeof analytics.averageReplayCoverage).toBe('number');
      expect(analytics.averageReplayCoverage).toBeGreaterThanOrEqual(0);
      expect(analytics.averageReplayCoverage).toBeLessThanOrEqual(1);
    });
  });

  describe('Company Drift API', () => {
    it('returns 400 when companyId is missing', async () => {
      const req: any = { method: 'GET', query: {} };
      const res: any = {
        statusCode: 200,
        setHeader: jest.fn(),
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(obj: any) {
          this.body = obj;
          return this;
        },
      };

      await companyDriftHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('companyId');
    });
  });

  describe('No events → coverage 0, no drift', () => {
    it('replayCoverageRatio 0 and driftCount 0 when no events', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).not.toBeNull();
      expect(analytics!.replayCoverageRatio).toBe(0);
      expect(analytics!.driftCount).toBe(0);
    });
  });
});
