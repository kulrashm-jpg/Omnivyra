/**
 * Integration tests for Preemption Cooldown Window (Stage 9C-B).
 * Prevents governance thrashing. CRITICAL initiator can override.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(null),
}));

import { supabase } from '../../db/supabaseClient';
import { executeCampaignPreemption, PreemptionValidationError } from '../../services/CampaignPreemptionService';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

function chainArray(result: ChainResult) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

const VALID_JUSTIFICATION = 'Revenue-critical board commitment for Q4 launch.';
const initiatorId = 'campaign-high-uuid';
const targetId = 'campaign-low-uuid';

describe('Campaign Preemption Cooldown (Stage 9C-B)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Test 1 — Preempt campaign → immediate second attempt → rejected', () => {
    it('rejects when target was recently preempted (within 7 days)', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chainArray({
            data: [
              { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
              { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: oneHourAgo },
            ],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      await expect(
        executeCampaignPreemption({
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: targetId,
          justification: VALID_JUSTIFICATION,
        })
      ).rejects.toThrow(PreemptionValidationError);

      await expect(
        executeCampaignPreemption({
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: targetId,
          justification: VALID_JUSTIFICATION,
        })
      ).rejects.toThrow('Preemption cooldown active');
    });
  });

  describe('Test 2 — After cooldown window → allowed', () => {
    it('allows preemption when last_preempted_at is older than 7 days', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      let campaignsCallCount = 0;

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          campaignsCallCount++;
          return chainArray({
            data:
              campaignsCallCount <= 2
                ? [
                    { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
                    { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: eightDaysAgo },
                  ]
                : [],
            error: null,
          });
        }
        if (table === 'campaign_preemption_log') {
          return chainArray({ data: { id: 'log-id', justification: VALID_JUSTIFICATION }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const result = await executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: targetId,
        justification: VALID_JUSTIFICATION,
      });

      expect('success' in result && result.success).toBe(true);
    });
  });

  describe('Test 3 — CRITICAL initiator overrides cooldown', () => {
    it('allows preemption when initiator is CRITICAL and target is lower', async () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const criticalInitiatorId = 'campaign-critical-uuid';
      let campaignsCallCount = 0;

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          campaignsCallCount++;
          return chainArray({
            data:
              campaignsCallCount <= 2
                ? [
                    { id: criticalInitiatorId, priority_level: 'CRITICAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
                    { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: oneDayAgo },
                  ]
                : [],
            error: null,
          });
        }
        if (table === 'campaign_preemption_log') {
          return chainArray({ data: { id: 'log-id', justification: VALID_JUSTIFICATION }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const result = await executeCampaignPreemption({
        initiatorCampaignId: criticalInitiatorId,
        preemptedCampaignId: targetId,
        justification: VALID_JUSTIFICATION,
      });

      expect('success' in result && result.success).toBe(true);
    });
  });

  describe('Test 4 — Non-CRITICAL cannot override', () => {
    it('rejects when initiator is HIGH and target was recently preempted', async () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chainArray({
            data: [
              { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
              { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: oneDayAgo },
            ],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      await expect(
        executeCampaignPreemption({
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: targetId,
          justification: VALID_JUSTIFICATION,
        })
      ).rejects.toThrow('Preemption cooldown active');
    });
  });
});
