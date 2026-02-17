/**
 * Stage 19 — Idempotent Execution & Concurrency Guard Integration Tests.
 * Tests: lock acquire, concurrent 409, stale override, release on success/failure,
 * SCHEDULER_LOCK_ACQUIRED, SCHEDULER_LOCK_RELEASED, SCHEDULER_LOCK_BLOCKED.
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
jest.mock('../../services/SchedulerIntegrityGuard', () => {
  const actual = jest.requireActual('../../services/SchedulerIntegrityGuard');
  return {
    ...actual,
    assertSchedulerExecutable: jest.fn(),
  };
});
jest.mock('../../services/SchedulerLockService', () => ({
  acquireSchedulerLock: jest.fn(),
  releaseSchedulerLock: jest.fn(),
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
import {
  acquireSchedulerLock,
  releaseSchedulerLock,
  SchedulerLockError,
} from '../../services/SchedulerLockService';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import { scheduleStructuredPlan } from '../../services/structuredPlanScheduler';
import { supabase } from '../../db/supabaseClient';

const CAMPAIGN_ID = 'campaign-lock-123';
const COMPANY_ID = 'company-lock-456';

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

describe('Scheduler Lock (Stage 19)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (acquireSchedulerLock as jest.Mock).mockResolvedValue('lock-uuid-' + Date.now());
    (releaseSchedulerLock as jest.Mock).mockResolvedValue(undefined);
    (recordGovernanceEvent as jest.Mock).mockResolvedValue(undefined);
    (scheduleStructuredPlan as jest.Mock).mockResolvedValue({
      scheduled_count: 2,
      skipped_count: 0,
      skipped_platforms: [],
    });
    setupCampaign({
      execution_status: 'ACTIVE',
      blueprint_status: 'ACTIVE',
      duration_locked: true,
    });
  });

  it('first execution acquires lock', async () => {
    const req = createReq();
    const res = createRes();
    await handler(req, res);

    expect(acquireSchedulerLock).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(res.statusCode).toBe(200);
  });

  it('second concurrent call → 409 SCHEDULER_ALREADY_RUNNING', async () => {
    (acquireSchedulerLock as jest.Mock).mockRejectedValue(
      new SchedulerLockError('SCHEDULER_ALREADY_RUNNING')
    );

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.json).toHaveBeenCalledWith({
      code: 'SCHEDULER_ALREADY_RUNNING',
      message: 'Scheduler execution already in progress',
    });
    expect(scheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('stale lock (>5 min) allows override', async () => {
    (acquireSchedulerLock as jest.Mock).mockResolvedValue('new-lock-after-stale');

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    expect(acquireSchedulerLock).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(res.statusCode).toBe(200);
    expect(scheduleStructuredPlan).toHaveBeenCalled();
  });

  it('lock released after success', async () => {
    const lockId = 'lock-success-uuid';
    (acquireSchedulerLock as jest.Mock).mockResolvedValue(lockId);

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    expect(releaseSchedulerLock).toHaveBeenCalledWith(CAMPAIGN_ID, lockId);
    expect(res.statusCode).toBe(200);
  });

  it('lock released after failure', async () => {
    const lockId = 'lock-fail-uuid';
    (acquireSchedulerLock as jest.Mock).mockResolvedValue(lockId);
    (scheduleStructuredPlan as jest.Mock).mockRejectedValue(new Error('Insert failed'));

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    expect(releaseSchedulerLock).toHaveBeenCalledWith(CAMPAIGN_ID, lockId);
    expect(res.statusCode).toBe(500);
  });

  it('SCHEDULER_LOCK_ACQUIRED emitted', async () => {
    const lockId = 'lock-acquired-uuid';
    (acquireSchedulerLock as jest.Mock).mockResolvedValue(lockId);

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    const calls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
      (c: any[]) => c[0]?.eventType === 'SCHEDULER_LOCK_ACQUIRED'
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0].metadata).toMatchObject({
      campaignId: CAMPAIGN_ID,
      lockId,
    });
  });

  it('SCHEDULER_LOCK_RELEASED emitted', async () => {
    const lockId = 'lock-released-uuid';
    (acquireSchedulerLock as jest.Mock).mockResolvedValue(lockId);

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    const calls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
      (c: any[]) => c[0]?.eventType === 'SCHEDULER_LOCK_RELEASED'
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0].metadata).toMatchObject({
      campaignId: CAMPAIGN_ID,
      lockId,
    });
  });

  it('SCHEDULER_LOCK_BLOCKED emitted when lock fails', async () => {
    (acquireSchedulerLock as jest.Mock).mockRejectedValue(
      new SchedulerLockError('SCHEDULER_ALREADY_RUNNING')
    );

    const req = createReq();
    const res = createRes();
    await handler(req, res);

    const calls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
      (c: any[]) => c[0]?.eventType === 'SCHEDULER_LOCK_BLOCKED'
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0].metadata).toMatchObject({
      campaignId: CAMPAIGN_ID,
      code: 'SCHEDULER_ALREADY_RUNNING',
    });
  });
});
