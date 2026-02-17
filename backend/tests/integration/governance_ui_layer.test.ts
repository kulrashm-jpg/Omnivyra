/**
 * Governance Intelligence UI Layer — Integration Tests. Stage 10 Phase 4.
 * Read-only. No constraint logic. Pure observability.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersionByCampaignId: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { getLatestCampaignVersionByCampaignId } from '../../db/campaignVersionStore';
import campaignStatusHandler from '../../../pages/api/governance/campaign-status';
import eventsHandler from '../../../pages/api/governance/events';
import { normalizeGovernanceDecision } from '../../services/GovernanceExplanationService';
import type { DurationEvaluationResult } from '../../types/CampaignDuration';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

function chainArray(result: ChainResult) {
  const data = result?.data;
  const arr = Array.isArray(data) ? data : (data ? [data] : []);
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: arr[0] ?? null, error: null }),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

const createMockRes = () => {
  const res: any = {
    statusCode: 200,
    body: null,
    setHeader: jest.fn(),
    status: function (code: number) {
      this.statusCode = code;
      return this;
    },
    json: function (obj: any) {
      this.body = obj;
      return this;
    },
  };
  return res;
};

const COMPANY_ID = 'company-uuid-123';
const CAMPAIGN_ID = 'campaign-uuid-456';

describe('Governance UI Layer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getLatestCampaignVersionByCampaignId as jest.Mock).mockResolvedValue({
      company_id: COMPANY_ID,
    });
  });

  describe('Campaign Status API', () => {
    it('returns 400 when campaignId is missing', async () => {
      const req: any = { method: 'GET', query: {} };
      const res = createMockRes();

      await campaignStatusHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('campaignId');
    });

    it('returns 404 when campaign not found', async () => {
      (supabase.from as jest.Mock).mockReturnValue(
        chain({ data: null, error: null })
      );

      const req: any = { method: 'GET', query: { campaignId: 'nonexistent' } };
      const res = createMockRes();

      await campaignStatusHandler(req, res);

      expect(res.statusCode).toBe(404);
    });

    it('returns cooldownActive correctly when recently preempted', async () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chain({
            data: {
              id: CAMPAIGN_ID,
              priority_level: 'HIGH',
              is_protected: false,
              blueprint_status: 'ACTIVE',
              duration_weeks: 12,
              duration_locked: true,
              last_preempted_at: oneDayAgo,
            },
            error: null,
          });
        }
        if (table === 'campaign_governance_events') {
          return chainArray({
            data: [{
              id: 'evt-1',
              event_type: 'PREEMPTION_EXECUTED',
              event_status: 'EXECUTED',
              metadata: { targetCampaignId: 'target-1' },
              created_at: oneDayAgo,
            }],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const req: any = { method: 'GET', query: { campaignId: CAMPAIGN_ID } };
      const res = createMockRes();

      await campaignStatusHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.governance.cooldownActive).toBe(true);
      expect(res.body.governance.lastPreemptedAt).toBe(oneDayAgo);
    });

    it('returns cooldownActive false when preempted > 7 days ago', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chain({
            data: {
              id: CAMPAIGN_ID,
              priority_level: 'NORMAL',
              is_protected: false,
              blueprint_status: 'ACTIVE',
              duration_weeks: 8,
              duration_locked: false,
              last_preempted_at: eightDaysAgo,
            },
            error: null,
          });
        }
        if (table === 'campaign_governance_events') {
          return chainArray({ data: [], error: null });
        }
        return chain({ data: null, error: null });
      });

      const req: any = { method: 'GET', query: { campaignId: CAMPAIGN_ID } };
      const res = createMockRes();

      await campaignStatusHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.governance.cooldownActive).toBe(false);
    });

    it('returns latest governance event', async () => {
      const eventTime = new Date().toISOString();
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chain({
            data: {
              id: CAMPAIGN_ID,
              priority_level: 'HIGH',
              is_protected: false,
              blueprint_status: 'ACTIVE',
              duration_weeks: 12,
              duration_locked: true,
              last_preempted_at: null,
            },
            error: null,
          });
        }
        if (table === 'campaign_governance_events') {
          return chainArray({
            data: [{
              id: 'evt-123',
              event_type: 'PREEMPTION_EXECUTED',
              event_status: 'EXECUTED',
              metadata: { targetCampaignId: 'uuid-789', justification: 'Revenue-critical.' },
              created_at: eventTime,
            }],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const req: any = { method: 'GET', query: { campaignId: CAMPAIGN_ID } };
      const res = createMockRes();

      await campaignStatusHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.latestGovernanceEvent).not.toBeNull();
      expect(res.body.latestGovernanceEvent.eventType).toBe('PREEMPTION_EXECUTED');
      expect(res.body.latestGovernanceEvent.eventStatus).toBe('EXECUTED');
      expect(res.body.latestGovernanceEvent.createdAt).toBe(eventTime);
      expect(res.body.latestGovernanceEvent.metadata.targetCampaignId).toBe('uuid-789');
    });
  });

  describe('Governance Events API', () => {
    it('returns 400 when companyId is missing', async () => {
      const req: any = { method: 'GET', query: {} };
      const res = createMockRes();

      await eventsHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('companyId');
    });

    it('returns events filtered by companyId', async () => {
      const evts = [
        { id: 'e1', campaign_id: 'c1', event_type: 'DURATION_NEGOTIATE', event_status: 'NEGOTIATE', metadata: {}, created_at: new Date().toISOString() },
      ];
      (supabase.from as jest.Mock).mockReturnValue(
        chainArray({ data: evts, error: null })
      );

      const req: any = { method: 'GET', query: { companyId: COMPANY_ID } };
      const res = createMockRes();

      await eventsHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].id).toBe('e1');
      expect(res.body.events[0].eventType).toBe('DURATION_NEGOTIATE');
    });

    it('applies campaignId and eventType filters', async () => {
      const evts = [{ id: 'e2', campaign_id: CAMPAIGN_ID, event_type: 'PREEMPTION_EXECUTED', event_status: 'EXECUTED', metadata: {}, created_at: new Date().toISOString() }];
      (supabase.from as jest.Mock).mockReturnValue(
        chainArray({ data: evts, error: null })
      );

      const req: any = {
        method: 'GET',
        query: { companyId: COMPANY_ID, campaignId: CAMPAIGN_ID, eventType: 'PREEMPTION_EXECUTED' },
      };
      const res = createMockRes();

      await eventsHandler(req, res);

      expect(res.statusCode).toBe(200);
      const fromCalls = (supabase.from as jest.Mock).mock.calls;
      const eventsCall = fromCalls.find((c: string[]) => c[0] === 'campaign_governance_events');
      expect(eventsCall).toBeDefined();
    });
  });

  describe('normalizeGovernanceDecision', () => {
    it('returns correct shape for APPROVED', () => {
      const result: DurationEvaluationResult = {
        requested_weeks: 12,
        max_weeks_allowed: 12,
        limiting_constraints: [],
        blocking_constraints: [],
        status: 'APPROVED',
      };

      const normalized = normalizeGovernanceDecision(result);

      expect(normalized.blocked).toBe(false);
      expect(normalized.primaryReason).toBeNull();
      expect(normalized.explanation).toBe('Approved under current governance rules.');
      expect(normalized.recommendedAction).toBeNull();
    });

    it('returns correct shape for NEGOTIATE', () => {
      const result: DurationEvaluationResult = {
        requested_weeks: 20,
        max_weeks_allowed: 6,
        limiting_constraints: [
          { name: 'inventory', status: 'LIMITING', max_weeks_allowed: 6, reasoning: 'Insufficient content.' },
        ],
        blocking_constraints: [],
        status: 'NEGOTIATE',
        tradeOffOptions: [
          { type: 'EXTEND_DURATION', newDurationWeeks: 6, reasoning: 'Reduce duration.' },
        ],
      };

      const normalized = normalizeGovernanceDecision(result);

      expect(normalized.blocked).toBe(false);
      expect(normalized.primaryReason).toBe('inventory');
      expect(normalized.explanation).toBe('Insufficient content.');
      expect(normalized.recommendedAction).toBe('EXTEND_DURATION');
    });

    it('returns correct shape for REJECTED', () => {
      const result: DurationEvaluationResult = {
        requested_weeks: 12,
        max_weeks_allowed: 0,
        limiting_constraints: [],
        blocking_constraints: [
          { name: 'inventory', status: 'BLOCKING', max_weeks_allowed: 0, reasoning: 'No content inventory available.' },
        ],
        status: 'REJECTED',
        tradeOffOptions: [
          { type: 'INCREASE_CAPACITY', requiredAdditionalCapacity: 5, reasoning: 'Increase team capacity.' },
        ],
      };

      const normalized = normalizeGovernanceDecision(result);

      expect(normalized.blocked).toBe(true);
      expect(normalized.primaryReason).toBe('inventory');
      expect(normalized.explanation).toBe('No content inventory available.');
      expect(normalized.recommendedAction).toBe('INCREASE_CAPACITY');
    });
  });
});
