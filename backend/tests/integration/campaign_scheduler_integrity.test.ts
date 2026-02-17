/**
 * Stage 18 — Deterministic Scheduler Integrity Layer Integration Tests.
 * Tests: SCHEDULER_NOT_ACTIVE, SCHEDULER_BLUEPRINT_INACTIVE, SCHEDULER_DURATION_UNLOCKED,
 * SCHEDULER_PREEMPTED, valid success, SCHEDULE_STARTED, SCHEDULE_COMPLETED, SCHEDULE_ABORTED.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/structuredPlanScheduler', () => ({
  scheduleStructuredPlan: jest.fn(),
}));
jest.mock('../../services/campaignBlueprintService', () => {
  const actual = jest.requireActual('../../services/campaignBlueprintService');
  return {
    ...actual,
    assertBlueprintMutable: jest.fn().mockResolvedValue(undefined),
    assertBlueprintActive: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('../../services/SchedulerLockService', () => ({
  acquireSchedulerLock: jest.fn().mockResolvedValue('lock-uuid-123'),
  releaseSchedulerLock: jest.fn().mockResolvedValue(undefined),
  SchedulerLockError: class SchedulerLockError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.name = 'SchedulerLockError';
      this.code = code;
    }
  },
}));

import handler from '../../../pages/api/campaigns/[id]/schedule-structured-plan';
import { scheduleStructuredPlan } from '../../services/structuredPlanScheduler';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import { supabase } from '../../db/supabaseClient';

const CAMPAIGN_ID = 'campaign-123';
const COMPANY_ID = 'company-456';

function chain(result: { data: any; error: any }) {
  const q: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
  (q as any).then = (resolve: any) => Promise.resolve(result).then(resolve);
  return q;
}

function createReq(overrides: Partial<{ query: any; body: any; method: string }> = {}) {
  return {
    method: 'POST',
    query: { id: CAMPAIGN_ID },
    body: {
      plan: {
        weeks: [{ week: 1, theme: 'Week 1', daily: [{ day: 'Monday', platforms: { linkedin: 'Post' } }] }],
      },
    },
    ...overrides,
  } as any;
}

function createRes() {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  res.statusCode = null;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  return res;
}

describe('Scheduler Integrity Guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (recordGovernanceEvent as jest.Mock).mockResolvedValue(undefined);
    (scheduleStructuredPlan as jest.Mock).mockResolvedValue({
      scheduled_count: 2,
      skipped_count: 0,
      skipped_platforms: [],
    });
  });

  function setupCampaign(campaign: {
    execution_status: string | null;
    blueprint_status: string | null;
    duration_locked: boolean | null;
  }) {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return chain({ data: campaign, error: null });
      }
      if (table === 'campaign_versions') {
        return chain({ data: { company_id: COMPANY_ID }, error: null });
      }
      return chain({ data: null, error: null });
    });
  }

  it('execution_status !== ACTIVE → 409 SCHEDULER_NOT_ACTIVE', async () => {
    setupCampaign({
      execution_status: 'PAUSED',
      blueprint_status: 'ACTIVE',
      duration_locked: true,
    });

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SCHEDULER_NOT_ACTIVE',
        message: 'Scheduler integrity check failed',
      })
    );
    expect(scheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('blueprint_status !== ACTIVE → 409 SCHEDULER_BLUEPRINT_INACTIVE', async () => {
    setupCampaign({
      execution_status: 'ACTIVE',
      blueprint_status: 'INVALIDATED',
      duration_locked: true,
    });

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SCHEDULER_BLUEPRINT_INACTIVE',
        message: 'Scheduler integrity check failed',
      })
    );
    expect(scheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('duration_locked = false → 409 SCHEDULER_DURATION_UNLOCKED', async () => {
    setupCampaign({
      execution_status: 'ACTIVE',
      blueprint_status: 'ACTIVE',
      duration_locked: false,
    });

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SCHEDULER_DURATION_UNLOCKED',
        message: 'Scheduler integrity check failed',
      })
    );
    expect(scheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('PREEMPTED → 409 CAMPAIGN_FINALIZED (terminal state blocks schedule)', async () => {
    setupCampaign({
      execution_status: 'PREEMPTED',
      blueprint_status: 'ACTIVE',
      duration_locked: true,
    });

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CAMPAIGN_FINALIZED',
        message: 'Campaign is finalized and cannot be modified',
      })
    );
    expect(scheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('Valid ACTIVE + ACTIVE + locked → success', async () => {
    setupCampaign({
      execution_status: 'ACTIVE',
      blueprint_status: 'ACTIVE',
      duration_locked: true,
    });

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(scheduleStructuredPlan).toHaveBeenCalledWith(req.body.plan, CAMPAIGN_ID);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.scheduled_count).toBe(2);
  });

  it('SCHEDULE_STARTED emitted on valid schedule', async () => {
    setupCampaign({
      execution_status: 'ACTIVE',
      blueprint_status: 'ACTIVE',
      duration_locked: true,
    });

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    const startedCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
      (c: any[]) => c[0]?.eventType === 'SCHEDULE_STARTED'
    );
    expect(startedCalls.length).toBeGreaterThan(0);
    expect(startedCalls[0][0].metadata).toMatchObject({
      campaignId: CAMPAIGN_ID,
      execution_status: 'ACTIVE',
      blueprint_status: 'ACTIVE',
      duration_locked: true,
    });
  });

  it('SCHEDULE_COMPLETED emitted on success', async () => {
    setupCampaign({
      execution_status: 'ACTIVE',
      blueprint_status: 'ACTIVE',
      duration_locked: true,
    });

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    const completedCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
      (c: any[]) => c[0]?.eventType === 'SCHEDULE_COMPLETED'
    );
    expect(completedCalls.length).toBeGreaterThan(0);
    expect(completedCalls[0][0].metadata).toMatchObject({
      campaignId: CAMPAIGN_ID,
      execution_status: 'ACTIVE',
      blueprint_status: 'ACTIVE',
      duration_locked: true,
      scheduled_count: 2,
    });
  });

  it('SCHEDULE_ABORTED emitted when scheduler integrity fails', async () => {
    setupCampaign({
      execution_status: 'PAUSED',
      blueprint_status: 'ACTIVE',
      duration_locked: true,
    });

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    const abortedCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
      (c: any[]) => c[0]?.eventType === 'SCHEDULE_ABORTED'
    );
    expect(abortedCalls.length).toBeGreaterThan(0);
    expect(abortedCalls[0][0].metadata.reason).toBe('SCHEDULER_NOT_ACTIVE');
  });

  it('SCHEDULE_ABORTED emitted when scheduleStructuredPlan throws', async () => {
    setupCampaign({
      execution_status: 'ACTIVE',
      blueprint_status: 'ACTIVE',
      duration_locked: true,
    });
    (scheduleStructuredPlan as jest.Mock).mockRejectedValue(new Error('Insert failed'));

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(500);
    const abortedCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
      (c: any[]) => c[0]?.eventType === 'SCHEDULE_ABORTED'
    );
    expect(abortedCalls.length).toBeGreaterThan(0);
  });
});
