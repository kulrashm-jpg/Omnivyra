/**
 * Integration tests for Mandatory Preemption Justification (Stage 9C-A).
 * Tests: rejection without/short justification, valid justification stored, approval flow requires justification.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(null),
}));

import { supabase } from '../../db/supabaseClient';
import { executeCampaignPreemption, executePreemptionFromRequest, PreemptionValidationError } from '../../services/CampaignPreemptionService';

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

describe('Campaign Preemption Justification (Stage 9C-A)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Test 1 — Direct preemption without justification', () => {
    it('rejected when justification is missing', async () => {
      (supabase.from as jest.Mock).mockImplementation(() =>
        chainArray({
          data: [
            { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
            { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
          ],
          error: null,
        })
      );

      await expect(
        executeCampaignPreemption({
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: targetId,
          justification: '',
        })
      ).rejects.toThrow(PreemptionValidationError);

      await expect(
        executeCampaignPreemption({
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: targetId,
          justification: '   ',
        })
      ).rejects.toThrow('Preemption justification is required (minimum 15 characters).');
    });
  });

  describe('Test 2 — Direct preemption with short justification (<15 chars)', () => {
    it('rejected when justification is too short', async () => {
      (supabase.from as jest.Mock).mockImplementation(() =>
        chainArray({
          data: [
            { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
            { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
          ],
          error: null,
        })
      );

      await expect(
        executeCampaignPreemption({
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: targetId,
          justification: 'Too short',
        })
      ).rejects.toThrow(PreemptionValidationError);

      await expect(
        executeCampaignPreemption({
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: targetId,
          justification: '12345678901234',
        })
      ).rejects.toThrow('Preemption justification is required (minimum 15 characters).');
    });
  });

  describe('Test 3 — Valid justification', () => {
    it('succeeds and justification is stored in result', async () => {
      const logId = 'log-uuid-justification';
      let campaignsCallCount = 0;

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          campaignsCallCount++;
          return chainArray({
            data:
              campaignsCallCount <= 2
                ? [
                    { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
                    { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
                  ]
                : [],
            error: null,
          });
        }
        if (table === 'campaign_preemption_log') {
          return chainArray({ data: { id: logId, justification: VALID_JUSTIFICATION }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const result = await executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: targetId,
        justification: VALID_JUSTIFICATION,
      });

      expect('success' in result && result.success).toBe(true);
      expect('justification' in result && result.justification).toBe(VALID_JUSTIFICATION);
      expect('preemptedCampaignId' in result && result.preemptedCampaignId).toBe(targetId);

      const insertCalls = (supabase.from as jest.Mock).mock.calls.filter((c: string[]) => c[0] === 'campaign_preemption_log');
      expect(insertCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Test 4 — Approval flow requires justification', () => {
    it('executePreemptionFromRequest throws when justification is missing or too short', async () => {
      const requestId = 'request-uuid';

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_preemption_requests') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({
            data: { id: requestId, initiator_campaign_id: initiatorId, target_campaign_id: targetId, status: 'PENDING' },
            error: null,
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await expect(executePreemptionFromRequest(requestId, '')).rejects.toThrow('Preemption justification is required');
      await expect(executePreemptionFromRequest(requestId, 'Short')).rejects.toThrow('Preemption justification is required');
    });
  });

  describe('Test 5 — Justification stored in campaign_preemption_log', () => {
    it('insert includes justification when preemption executes', async () => {
      const logId = 'log-uuid-stored';
      const justificationText = 'Board-mandated Q4 launch takes priority over lower campaigns.';
      let campaignsCallCount = 0;
      const logInsertPayloads: any[] = [];

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          campaignsCallCount++;
          return chainArray({
            data:
              campaignsCallCount <= 2
                ? [
                    { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
                    { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
                  ]
                : [],
            error: null,
          });
        }
        if (table === 'campaign_preemption_log') {
          const arr = chainArray({ data: { id: logId, justification: justificationText }, error: null });
          arr.insert = jest.fn(function (this: any, payload: any) {
            logInsertPayloads.push(payload);
            return this;
          });
          return arr;
        }
        return chain({ data: null, error: null });
      });

      await executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: targetId,
        justification: justificationText,
      });

      expect(logInsertPayloads.length).toBeGreaterThan(0);
      expect(logInsertPayloads.some((p) => p.justification === justificationText)).toBe(true);
    });
  });
});
