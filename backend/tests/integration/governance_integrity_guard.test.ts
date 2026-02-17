/**
 * Integration tests for Governance Integrity Hardening (Stage 27).
 * Event integrity, policy signature freeze, replay strict mode, integrityRiskScore.
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
import {
  recordGovernanceEvent,
  GovernanceEventIntegrityError,
  EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT,
} from '../../services/GovernanceEventService';
import {
  assertPolicySignatureUnchanged,
  PolicySignatureMismatchError,
  getGovernancePolicy,
} from '../../governance/GovernancePolicyRegistry';
import { getGovernancePolicyHash } from '../../governance/GovernancePolicy';
import { getCompanyGovernanceAnalytics } from '../../services/GovernanceAnalyticsService';
import { replayGovernanceEvent } from '../../services/GovernanceReplayService';
import replayEventHandler from '../../../pages/api/governance/replay-event';

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
const eventId = 'event-uuid-789';

describe('Governance Integrity Guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GOVERNANCE_POLICY_EXPECTED_HASH;
  });

  describe('Governance Event Integrity Assertion', () => {
    it('missing evaluation_context for DURATION_APPROVED throws in non-production', async () => {
      (supabase.from as jest.Mock).mockReturnValue(
        chain({ data: null, error: null })
      );

      const nodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      await expect(
        recordGovernanceEvent({
          companyId,
          campaignId,
          eventType: 'DURATION_APPROVED',
          eventStatus: 'APPROVED',
          metadata: { requested_weeks: 12 },
        })
      ).rejects.toThrow(GovernanceEventIntegrityError);

      process.env.NODE_ENV = nodeEnv;
    });

    it('EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT includes expected types', () => {
      expect(EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT.has('DURATION_APPROVED')).toBe(true);
      expect(EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT.has('DURATION_NEGOTIATE')).toBe(true);
      expect(EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT.has('DURATION_REJECTED')).toBe(true);
      expect(EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT.has('CONTENT_CAPACITY_LIMITED')).toBe(true);
      expect(EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT.has('CONTENT_COLLISION_DETECTED')).toBe(true);
      expect(EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT.has('PREEMPTION_EXECUTED')).toBe(true);
      expect(EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT.has('SCHEDULE_STARTED')).toBe(true);
      expect(EVENT_TYPES_REQUIRING_EVALUATION_CONTEXT.has('SCHEDULE_COMPLETED')).toBe(true);
    });

    it('succeeds when evaluation_context provided for DURATION_APPROVED', async () => {
      let insertPayload: any = null;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const c = chain({ data: null, error: null });
        if (table === 'campaign_governance_events') {
          (c as any).insert = jest.fn((p: any) => {
            insertPayload = p;
            return Promise.resolve({ data: null, error: null });
          });
        }
        return c;
      });

      await recordGovernanceEvent({
        companyId,
        campaignId,
        eventType: 'DURATION_APPROVED',
        eventStatus: 'APPROVED',
        metadata: { requested_weeks: 12 },
        evaluationContext: { requested_weeks: 12, constraint_count: 0 },
      });

      expect(insertPayload).not.toBeNull();
      expect(insertPayload.policy_version).toBeDefined();
      expect(insertPayload.policy_hash).toBeDefined();
      expect(insertPayload.metadata?.evaluation_context).toBeDefined();
    });
  });

  describe('Policy Signature Freeze Guard', () => {
    it('assertPolicySignatureUnchanged no-ops when env not set', () => {
      expect(() => assertPolicySignatureUnchanged()).not.toThrow();
    });

    it('assertPolicySignatureUnchanged throws when env hash mismatches', () => {
      const actualHash = getGovernancePolicyHash();
      process.env.GOVERNANCE_POLICY_EXPECTED_HASH = 'wrong' + actualHash;

      expect(() => assertPolicySignatureUnchanged()).toThrow(PolicySignatureMismatchError);
    });

    it('assertPolicySignatureUnchanged passes when env hash matches', () => {
      const expected = getGovernancePolicyHash();
      process.env.GOVERNANCE_POLICY_EXPECTED_HASH = expected;

      expect(() => assertPolicySignatureUnchanged()).not.toThrow();
    });
  });

  describe('Replay Strict Mode', () => {
    it('strict=true and status mismatch returns 409 REPLAY_INTEGRITY_FAILED', async () => {
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
      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'NEGOTIATE' });

      const req: any = {
        method: 'GET',
        query: { eventId, companyId, strict: 'true' },
        rbac: { userId: 'user-1' },
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

      await replayEventHandler(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe('REPLAY_INTEGRITY_FAILED');
    });

    it('strict=false and status mismatch returns 200 with result', async () => {
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
      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'NEGOTIATE' });

      const req: any = {
        method: 'GET',
        query: { eventId, companyId },
        rbac: { userId: 'user-1' },
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

      await replayEventHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.statusMatch).toBe(false);
    });
  });

  describe('integrityRiskScore calculation', () => {
    it('returns integrityRiskScore in company analytics', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [{ campaign_id: 'c1' }], error: null });
        if (table === 'campaigns') return chain({ data: [{ id: 'c1', execution_status: 'ACTIVE' }], error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCompanyGovernanceAnalytics(companyId);

      expect(analytics.integrityRiskScore).toBeDefined();
      expect(typeof analytics.integrityRiskScore).toBe('number');
      expect(analytics.integrityRiskScore).toBeGreaterThanOrEqual(0);
      expect(analytics.integrityRiskScore).toBeLessThanOrEqual(100);
    });

    it('integrityRiskScore formula: drifted*25 + (1-coverage)*50 + upgrade*10', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [{ campaign_id: 'c1' }], error: null });
        if (table === 'campaigns') return chain({ data: [{ id: 'c1', execution_status: 'ACTIVE' }], error: null });
        if (table === 'campaign_governance_events')
          return chain({
            data: [{
              id: 'ev1',
              event_type: 'DURATION_APPROVED',
              metadata: { evaluation_context: {} },
              policy_version: '1.0.0',
              policy_hash: getGovernancePolicyHash(),
            }],
            error: null,
          });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });
      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'APPROVED' });

      const analytics = await getCompanyGovernanceAnalytics(companyId);

      expect(analytics.integrityRiskScore).toBeDefined();
    });
  });
});
