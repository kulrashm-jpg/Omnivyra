/**
 * Integration tests for Governance Policy Versioning (Stage 23).
 * Policy version, hash, evaluation_context, analytics.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import {
  GOVERNANCE_POLICY_VERSION,
  getGovernancePolicySignature,
  getGovernancePolicyHash,
} from '../../governance/GovernancePolicy';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import { getCampaignGovernanceAnalytics } from '../../services/GovernanceAnalyticsService';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const insert = jest.fn().mockResolvedValue({ data: null, error: null });
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    insert,
    maybeSingle: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
}

describe('Governance Policy Versioning', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('policy_version stored in events', () => {
    it('insert includes policy_version when recording event', async () => {
      let insertPayload: any = null;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const c = chain({ data: null, error: null });
        if (table === 'campaign_governance_events') {
          const origInsert = c.insert;
          c.insert = jest.fn((payload: any) => {
            insertPayload = payload;
            return Promise.resolve({ data: null, error: null });
          });
        }
        return c;
      });

      await recordGovernanceEvent({
        companyId: 'company-1',
        campaignId: 'campaign-1',
        eventType: 'DURATION_APPROVED',
        eventStatus: 'APPROVED',
        metadata: {},
        evaluationContext: {},
      });

      expect(insertPayload).not.toBeNull();
      expect(insertPayload.policy_version).toBe(GOVERNANCE_POLICY_VERSION);
    });
  });

  describe('policy_hash stored', () => {
    it('insert includes policy_hash when recording event', async () => {
      let insertPayload: any = null;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const c = chain({ data: null, error: null });
        if (table === 'campaign_governance_events') {
          c.insert = jest.fn((payload: any) => {
            insertPayload = payload;
            return Promise.resolve({ data: null, error: null });
          });
        }
        return c;
      });

      await recordGovernanceEvent({
        companyId: 'company-1',
        campaignId: 'campaign-1',
        eventType: 'SCHEDULE_STARTED',
        eventStatus: 'STARTED',
        metadata: {},
        evaluationContext: {},
      });

      expect(insertPayload).not.toBeNull();
      expect(typeof insertPayload.policy_hash).toBe('string');
      expect(insertPayload.policy_hash.length).toBe(64);
      expect(insertPayload.policy_hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('hash deterministic', () => {
    it('getGovernancePolicyHash returns same value on repeated calls', () => {
      const h1 = getGovernancePolicyHash();
      const h2 = getGovernancePolicyHash();
      expect(h1).toBe(h2);
      expect(h1.length).toBe(64);
    });
  });

  describe('analytics returns policyVersion', () => {
    it('getCampaignGovernanceAnalytics includes policyVersion from events', async () => {
      const hash = getGovernancePolicyHash();
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: 'c1', execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events') return chain({
          data: [{
            event_type: 'DURATION_APPROVED',
            metadata: {},
            policy_version: '1.0.0',
            policy_hash: hash,
          }],
          error: null,
        });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCampaignGovernanceAnalytics('c1');

      expect(analytics).not.toBeNull();
      expect(analytics!.policyVersion).toBe('1.0.0');
      expect(analytics!.policyHash).toBe(hash);
    });
  });

  describe('evaluation_context exists in event metadata', () => {
    it('recordGovernanceEvent merges evaluationContext into metadata', async () => {
      let insertPayload: any = null;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const c = chain({ data: null, error: null });
        if (table === 'campaign_governance_events') {
          c.insert = jest.fn((payload: any) => {
            insertPayload = payload;
            return Promise.resolve({ data: null, error: null });
          });
        }
        return c;
      });

      await recordGovernanceEvent({
        companyId: 'company-1',
        campaignId: 'campaign-1',
        eventType: 'DURATION_APPROVED',
        eventStatus: 'APPROVED',
        metadata: { requested_weeks: 12 },
        evaluationContext: {
          execution_status: 'ACTIVE',
          blueprint_status: 'ACTIVE',
          duration_locked: true,
          constraint_count: 3,
          requested_weeks: 12,
        },
      });

      expect(insertPayload).not.toBeNull();
      expect(insertPayload.metadata).toBeDefined();
      expect(insertPayload.metadata.evaluation_context).toEqual({
        execution_status: 'ACTIVE',
        blueprint_status: 'ACTIVE',
        duration_locked: true,
        constraint_count: 3,
        requested_weeks: 12,
      });
      expect(insertPayload.metadata.requested_weeks).toBe(12);
    });
  });

  describe('snapshot test for getGovernancePolicySignature', () => {
    it('signature includes version, freezeWindowHours, evaluationOrder, tradeOffRanking', () => {
      const sig = getGovernancePolicySignature();
      expect(sig.version).toBe('1.0.0');
      expect(sig.freezeWindowHours).toBe(24);
      expect(Array.isArray(sig.evaluationOrder)).toBe(true);
      expect(sig.evaluationOrder).toContain('INVENTORY');
      expect(sig.evaluationOrder).toContain('CONTENT_COLLISION');
      expect(sig.evaluationOrder).toContain('FINAL_STATUS');
      expect(typeof sig.tradeOffRanking).toBe('object');
      expect(Array.isArray(sig.tradeOffRanking.NORMAL)).toBe(true);
      expect(Array.isArray(sig.tradeOffRanking.HIGH_OR_CRITICAL)).toBe(true);
      expect(sig.tradeOffRanking.NORMAL).toContain('SHIFT_START_DATE');
      expect(sig.tradeOffRanking.HIGH_OR_CRITICAL).toContain('PREEMPT_LOWER_PRIORITY_CAMPAIGN');
    });

    it('signature JSON stringify is deterministic for hash', () => {
      const sig1 = getGovernancePolicySignature();
      const sig2 = getGovernancePolicySignature();
      expect(JSON.stringify(sig1)).toBe(JSON.stringify(sig2));
    });
  });
});
