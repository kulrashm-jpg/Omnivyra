/**
 * Stage 20 — Campaign Finalization & Archival Guard Integration Tests.
 * Tests: COMPLETED/PREEMPTED → 409 CAMPAIGN_FINALIZED on mutation APIs,
 * CAMPAIGN_MUTATION_BLOCKED_FINALIZED emitted, CAMPAIGN_COMPLETED, CAMPAIGN_ARCHIVED.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn().mockResolvedValue({ userId: 'user-1' }),
}));
const mockRecordGovernanceEvent = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/GovernanceEventService', () => {
  const actual = jest.requireActual('../../services/GovernanceEventService');
  return {
    recordGovernanceEvent: mockRecordGovernanceEvent,
    recordCampaignCompletedEvent: async (params: any) => {
      const completedAt = params.completedAt ?? new Date().toISOString();
      await mockRecordGovernanceEvent({
        companyId: params.companyId,
        campaignId: params.campaignId,
        eventType: 'CAMPAIGN_COMPLETED',
        eventStatus: 'COMPLETED',
        metadata: {
          campaignId: params.campaignId,
          completedAt,
          ...(params.totalScheduledPosts != null && { totalScheduledPosts: params.totalScheduledPosts }),
        },
      });
    },
  };
});
jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(),
}));
jest.mock('../../services/CampaignNegotiationService', () => ({
  runDurationNegotiation: jest.fn(),
}));
jest.mock('../../services/campaignAiOrchestrator', () => ({
  runCampaignAiPlan: jest.fn().mockResolvedValue({ plan: { weeks: [] } }),
}));
jest.mock('../../db/campaignPlanStore', () => ({
  saveCampaignBlueprintFromLegacy: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/campaignBlueprintAdapter', () => ({
  fromStructuredPlan: jest.fn((x: any) => ({ ...x, duration_weeks: 12 })),
}));
jest.mock('../../services/aiGateway', () => ({
  generatePrePlanningExplanation: jest.fn().mockResolvedValue('AI summary'),
}));
jest.mock('../../services/structuredPlanScheduler', () => ({
  scheduleStructuredPlan: jest.fn().mockResolvedValue({ scheduled_count: 2, skipped_count: 0, skipped_platforms: [] }),
}));
jest.mock('../../services/SchedulerLockService', () => ({
  acquireSchedulerLock: jest.fn().mockResolvedValue('lock-uuid'),
  releaseSchedulerLock: jest.fn().mockResolvedValue(undefined),
  SchedulerLockError: class SchedulerLockError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));
import { createApiRequestMock } from '../utils/createApiRequestMock';
import { createMockRes } from '../utils/setupApiTest';
import updateDurationHandler from '../../../pages/api/campaigns/update-duration';
import regenerateBlueprintHandler from '../../../pages/api/campaigns/regenerate-blueprint';
import negotiateDurationHandler from '../../../pages/api/campaigns/negotiate-duration';
import scheduleStructuredPlanHandler from '../../../pages/api/campaigns/[id]/schedule-structured-plan';
import { recordGovernanceEvent, recordCampaignCompletedEvent } from '../../services/GovernanceEventService';
import { supabase } from '../../db/supabaseClient';

const COMPANY_ID = 'company-final-123';
const CAMPAIGN_ID = 'campaign-final-456';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const updateChain = { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
  const insertChain = { select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue(result) }) };
  const q: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    update: jest.fn().mockReturnValue(updateChain),
    insert: jest.fn().mockReturnValue(insertChain),
  };
  return q;
}

function setupCampaign(executionStatus: 'COMPLETED' | 'PREEMPTED') {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'campaigns') {
      return chain({
        data: {
          id: CAMPAIGN_ID,
          duration_locked: false,
          duration_weeks: 12,
          blueprint_status: 'ACTIVE',
          execution_status: executionStatus,
        },
        error: null,
      });
    }
    if (table === 'campaign_versions') {
      return chain({ data: { company_id: COMPANY_ID }, error: null });
    }
    return chain({ data: null, error: null });
  });
}

describe('Campaign Finalization Guard (Stage 20)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecordGovernanceEvent.mockResolvedValue(undefined);
  });

  describe('COMPLETED campaign blocks mutations', () => {
    it('COMPLETED → update-duration → 409 CAMPAIGN_FINALIZED', async () => {
      setupCampaign('COMPLETED');
      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, requested_weeks: 8 },
      });
      const res = createMockRes();

      await updateDurationHandler(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({
        code: 'CAMPAIGN_FINALIZED',
        message: 'Campaign is finalized and cannot be modified',
      });
    });

    it('COMPLETED → regenerate-blueprint → 409', async () => {
      setupCampaign('COMPLETED');
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chain({
            data: {
              id: CAMPAIGN_ID,
              blueprint_status: 'INVALIDATED',
              duration_weeks: 12,
              execution_status: 'COMPLETED',
            },
            error: null,
          });
        }
        if (table === 'campaign_versions') return chain({ data: { company_id: COMPANY_ID }, error: null });
        return chain({ data: null, error: null });
      });
      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID },
      });
      const res = createMockRes();

      await regenerateBlueprintHandler(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({
        code: 'CAMPAIGN_FINALIZED',
        message: 'Campaign is finalized and cannot be modified',
      });
    });

    it('COMPLETED → schedule → 409', async () => {
      setupCampaign('COMPLETED');
      const req = createApiRequestMock({
        method: 'POST',
        query: { id: CAMPAIGN_ID },
        body: {
          plan: {
            weeks: [{ week: 1, theme: 'W1', daily: [{ day: 'Monday', platforms: { linkedin: 'Post' } }] }],
          },
        },
      });
      const res = createMockRes();

      await scheduleStructuredPlanHandler(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({
        code: 'CAMPAIGN_FINALIZED',
        message: 'Campaign is finalized and cannot be modified',
      });
    });
  });

  describe('PREEMPTED campaign blocks mutations', () => {
    it('PREEMPTED → update-duration → 409 CAMPAIGN_FINALIZED', async () => {
      setupCampaign('PREEMPTED');
      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, requested_weeks: 8 },
      });
      const res = createMockRes();

      await updateDurationHandler(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({
        code: 'CAMPAIGN_FINALIZED',
        message: 'Campaign is finalized and cannot be modified',
      });
    });

    it('PREEMPTED → negotiate-duration → 409 CAMPAIGN_FINALIZED', async () => {
      setupCampaign('PREEMPTED');
      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, message: 'Negotiate' },
      });
      const res = createMockRes();

      await negotiateDurationHandler(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({
        code: 'CAMPAIGN_FINALIZED',
        message: 'Campaign is finalized and cannot be modified',
      });
    });
  });

  describe('CAMPAIGN_MUTATION_BLOCKED_FINALIZED emitted', () => {
    it('emitted when COMPLETED campaign mutation attempted', async () => {
      setupCampaign('COMPLETED');
      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, requested_weeks: 8 },
      });
      const res = createMockRes();

      await updateDurationHandler(req, res);

      const calls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'CAMPAIGN_MUTATION_BLOCKED_FINALIZED'
      );
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0].metadata).toMatchObject({
        campaignId: CAMPAIGN_ID,
        execution_status: 'COMPLETED',
      });
    });
  });

  describe('Completion events', () => {
    it('recordCampaignCompletedEvent emits CAMPAIGN_COMPLETED', async () => {
      await recordCampaignCompletedEvent({
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
        completedAt: '2026-02-16T12:00:00Z',
        totalScheduledPosts: 24,
      });

      expect(recordGovernanceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_ID,
          campaignId: CAMPAIGN_ID,
          eventType: 'CAMPAIGN_COMPLETED',
          eventStatus: 'COMPLETED',
          metadata: expect.objectContaining({
            campaignId: CAMPAIGN_ID,
            completedAt: '2026-02-16T12:00:00Z',
            totalScheduledPosts: 24,
          }),
        })
      );
    });

    it('PREEMPTED emits CAMPAIGN_ARCHIVED', async () => {
      const { executeCampaignPreemption } = await import('../../services/CampaignPreemptionService');
      const initiatorId = 'initiator-final-1';
      const preemptedId = 'preempted-final-2';

      const campaignsData = [
        { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
        { id: preemptedId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
      ];
      const selectRes = { data: campaignsData, error: null };
      let campaignsCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          campaignsCallCount++;
          if (campaignsCallCount <= 2) {
            const m: any = {
              select: jest.fn().mockReturnThis(),
              in: jest.fn().mockReturnThis(),
              then: (resolve: any) => Promise.resolve(selectRes).then(resolve),
            };
            return m;
          }
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'campaign_preemption_log') {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { id: 'log-1', justification: 'Justification text here' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return chain({ data: null, error: null });
      });

      await executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: preemptedId,
        justification: 'Justification text for preemption flow',
        companyId: COMPANY_ID,
      });

      const archivedCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'CAMPAIGN_ARCHIVED'
      );
      expect(archivedCalls.length).toBeGreaterThan(0);
      expect(archivedCalls[0][0].metadata).toMatchObject({
        campaignId: preemptedId,
        archivedReason: 'PREEMPTED',
      });
    });
  });
});
