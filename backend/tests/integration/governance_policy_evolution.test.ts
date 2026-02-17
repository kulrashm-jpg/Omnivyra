/**
 * Integration tests for Governance Policy Evolution (Stage 26).
 * Policy registry, simulate-policy, upgrade detection, replay uses stored version.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersionByCampaignId: jest.fn(),
}));
jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(),
}));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: any) => h }));

import { supabase } from '../../db/supabaseClient';
import { getLatestCampaignVersionByCampaignId } from '../../db/campaignVersionStore';
import { runPrePlanning } from '../../services/CampaignPrePlanningService';
import {
  getGovernancePolicy,
  getCurrentPolicyVersion,
  PolicyVersionNotFoundError,
} from '../../governance/GovernancePolicyRegistry';
import { getGovernancePolicyHash } from '../../governance/GovernancePolicy';
import { getCampaignGovernanceAnalytics } from '../../services/GovernanceAnalyticsService';
import { replayGovernanceEvent } from '../../services/GovernanceReplayService';
import simulatePolicyHandler from '../../../pages/api/governance/simulate-policy';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
}

const campaignId = 'campaign-uuid-123';
const companyId = 'company-uuid-456';

describe('Governance Policy Evolution', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GovernancePolicyRegistry', () => {
    it('getGovernancePolicy("1.0.0") returns correct hash matching legacy', () => {
      const policy = getGovernancePolicy('1.0.0');
      expect(policy.version).toBe('1.0.0');
      expect(policy.freezeWindowHours).toBe(24);
      expect(policy.evaluationOrder).toBeDefined();
      expect(policy.tradeOffRanking).toBeDefined();
      expect(policy.hash).toBe(getGovernancePolicyHash());
    });

    it('getGovernancePolicy() with no arg returns current policy', () => {
      const policy = getGovernancePolicy();
      expect(policy.version).toBe('1.0.0');
      expect(policy.hash).toBe(getGovernancePolicyHash());
    });

    it('unknown version throws PolicyVersionNotFoundError', () => {
      expect(() => getGovernancePolicy('2.0.0')).toThrow(PolicyVersionNotFoundError);
      expect(() => getGovernancePolicy('99.99.99')).toThrow(PolicyVersionNotFoundError);
    });

    it('getCurrentPolicyVersion returns 1.0.0', () => {
      expect(getCurrentPolicyVersion()).toBe('1.0.0');
    });
  });

  describe('simulate-policy API', () => {
    it('returns deterministic result', async () => {
      (getLatestCampaignVersionByCampaignId as jest.Mock).mockResolvedValue({
        company_id: companyId,
      });
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns')
          return chain({ data: { id: campaignId, duration_weeks: 12 }, error: null });
        if (table === 'campaign_governance_events')
          return chain({ data: null, error: null });
        return chain({ data: null, error: null });
      });
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'APPROVED',
        requested_weeks: 12,
        max_weeks_allowed: 12,
        tradeOffOptions: [],
      });

      const req: any = {
        method: 'GET',
        query: { campaignId, companyId, policyVersion: '1.0.0' },
      };
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

      await simulatePolicyHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.policyVersion).toBe('1.0.0');
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.explanation).toBeDefined();
      expect(res.body.policyHash).toBe(getGovernancePolicyHash());
      expect(runPrePlanning).toHaveBeenCalledWith(
        expect.objectContaining({
          suppressEvents: true,
          policyVersion: '1.0.0',
        })
      );
    });

    it('does not emit governance events (suppressEvents)', async () => {
      (getLatestCampaignVersionByCampaignId as jest.Mock).mockResolvedValue({
        company_id: companyId,
      });
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns')
          return chain({ data: { id: campaignId, duration_weeks: 8 }, error: null });
        if (table === 'campaign_governance_events')
          return chain({ data: null, error: null });
        return chain({ data: null, error: null });
      });
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'NEGOTIATE',
        requested_weeks: 8,
        max_weeks_allowed: 6,
        tradeOffOptions: [{ type: 'REDUCE_FREQUENCY', reasoning: 'Test' }],
      });

      const req: any = {
        method: 'GET',
        query: { campaignId, companyId, policyVersion: '1.0.0' },
      };
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

      await simulatePolicyHandler(req, res);

      expect(runPrePlanning).toHaveBeenCalledWith(
        expect.objectContaining({ suppressEvents: true })
      );
    });

    it('returns 404 for unknown policy version', async () => {
      const req: any = {
        method: 'GET',
        query: { campaignId, companyId, policyVersion: '9.9.9' },
      };
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

      await simulatePolicyHandler(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.code).toBe('POLICY_VERSION_NOT_FOUND');
    });
  });

  describe('upgradeAvailable detection', () => {
    it('policyUpgradeAvailable false when event version equals current', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns')
          return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events')
          return chain({
            data: [
              {
                id: 'ev1',
                event_type: 'DURATION_APPROVED',
                metadata: { evaluation_context: {} },
                policy_version: '1.0.0',
                policy_hash: getGovernancePolicyHash(),
              },
            ],
            error: null,
          });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);
      expect(analytics).not.toBeNull();
      expect(analytics!.evaluatedUnderPolicyVersion).toBe('1.0.0');
      expect(analytics!.currentPolicyVersion).toBe('1.0.0');
      expect(analytics!.policyUpgradeAvailable).toBe(false);
    });
  });

  describe('replay uses original version', () => {
    it('replay passes stored policyVersion to runPrePlanning', async () => {
      const eventId = 'event-uuid-789';
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

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') {
          return chain({ data: mockEvent, error: null });
        }
        return chain({ data: null, error: null });
      });
      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'APPROVED' });

      await replayGovernanceEvent(eventId);

      expect(runPrePlanning).toHaveBeenCalledWith(
        expect.objectContaining({
          suppressEvents: true,
          policyVersion: '1.0.0',
        })
      );
    });
  });

  describe('analytics includes policy version fields', () => {
    it('returns currentPolicyVersion, evaluatedUnderPolicyVersion, policyUpgradeAvailable', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns')
          return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events')
          return chain({
            data: [
              {
                id: 'ev1',
                event_type: 'SCHEDULE_STARTED',
                metadata: {},
                policy_version: '1.0.0',
                policy_hash: getGovernancePolicyHash(),
              },
            ],
            error: null,
          });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);
      expect(analytics).not.toBeNull();
      expect(analytics!.currentPolicyVersion).toBe('1.0.0');
      expect(analytics!.evaluatedUnderPolicyVersion).toBe('1.0.0');
      expect(typeof analytics!.policyUpgradeAvailable).toBe('boolean');
    });
  });
});
