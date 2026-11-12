import {
  idempotencyHeaders,
  makeAssertable,
  resetIdempotency,
  withIdempotencyTable,
} from '../utils/idempotency';

// WS1-E6-T006: this endpoint adopted the caller-scoped withIdempotency
// middleware. AUTHENTICATION only — the endpoint's own authorization still
// runs inside the handler and is still asserted below.
jest.mock('../../security/IdentityResolver', () =>
  require('../utils/idempotency').identityResolverMock());

const requireCampaignAccessMock = jest.fn();
// Canonical repository pattern (see backend/tests/unit/creatorScheduleEarlyRejection.test.ts
// and opt010Wave2.test.ts): mock campaignAccessService and resolve the real
// CampaignAccessResult shape. Authorization still RUNS in the handler — this
// supplies an authorized caller, exactly as those suites do. No capability
// structure is invented and no authorization primitive is modified.
jest.mock('../../services/campaignAccessService', () => ({
  requireCampaignAccess: (...args: unknown[]) => requireCampaignAccessMock(...args),
}));


jest.mock('../../db/writeOwner', () => {
  const actual = jest.requireActual('../../db/writeOwner');
  return {
    ...actual,
    ownedDbTable: jest.fn(require('../utils/idempotency').withIdempotencyTable(actual.ownedDbTable)),
  };
});

import handler from '../../../pages/api/campaigns/[id]/schedule-structured-plan';
import { scheduleStructuredPlan } from '../../services/structuredPlanScheduler';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../db/supabaseClient';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/structuredPlanScheduler', () => ({
  scheduleStructuredPlan: jest.fn(),
}));
jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: jest.fn().mockResolvedValue(undefined),
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

function chain(result: { data: any; error: any }) {
  return {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Structured plan scheduling API', () => {
  beforeEach(() => {
    // Echo back the campaignId the handler passed, mirroring the real
    // requireCampaignAccess contract.
    requireCampaignAccessMock.mockImplementation(async (_req: any, _res: any, campaignId: string) => ({
      userId: 'test-caller-1',
      companyId: 'company-456',
      campaignId,
      campaignAuth: { role: 'COMPANY_ADMIN' },
    }));
    resetIdempotency();
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return chain({
          data: {
            execution_status: 'ACTIVE',
            blueprint_status: 'ACTIVE',
            duration_locked: true,
          },
          error: null,
        });
      }
      if (table === 'campaign_versions') {
        return chain({ data: { company_id: 'company-123' }, error: null });
      }
      return chain({ data: null, error: null });
    });
  });

  it('schedules posts from structured plan', async () => {
    (scheduleStructuredPlan as jest.Mock).mockResolvedValue({
      scheduled_count: 2,
      skipped_count: 1,
      skipped_platforms: ['tiktok'],
    });

    const req = {
      method: 'POST', headers: idempotencyHeaders(),
      query: { id: 'campaign-123' },
      body: {
        plan: {
          weeks: [
            {
              week: 1,
              theme: 'Week 1 Theme',
              daily: [
                {
                  day: 'Monday',
                  objective: 'Awareness',
                  content: 'Post content',
                  platforms: { linkedin: 'LinkedIn post' },
                },
              ],
            },
          ],
        },
      },
    } as unknown as NextApiRequest;

    const res = makeAssertable(createMockRes());

    await handler(req, res);

    expect(scheduleStructuredPlan).toHaveBeenCalledWith(req.body.plan, 'campaign-123');
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.scheduled_count).toBe(2);
    expect(payload.skipped_count).toBe(1);
  });
});

// ── Unread errors (unread-error pkg 2, e9 2026-11-12) ─────────────────────────
// PostgREST reports a failure in `error` and never throws. ONE fault per case; reverting a site's
// check fails exactly its own case.
describe('Structured plan scheduling API — unread errors', () => {
  type Ans = { data: any; error: any };
  let versionContextAns: Ans;
  let companyAns: Ans;
  let activationAnswers: Ans[];
  const activationCalls: unknown[] = [];

  /** Per-chain double: records the chain so the two campaign_versions reads are distinguishable. */
  function table(name: string) {
    const ops: string[] = [];
    const b: any = {};
    for (const op of ['select', 'eq', 'in', 'limit', 'range', 'insert', 'upsert', 'delete']) b[op] = () => { ops.push(op); return b; };
    b.order = () => { ops.push('order'); return b; };
    b.update = (payload: unknown) => {
      ops.push('update');
      if (name === 'campaigns') activationCalls.push(payload);
      return b;
    };
    b.maybeSingle = async () => {
      if (name === 'campaigns') return { data: { execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', duration_locked: true }, error: null };
      if (name === 'campaign_versions') return ops.includes('order') ? versionContextAns : companyAns;
      return { data: null, error: null };
    };
    b.then = (res: any, rej: any) => {
      const out = name === 'campaigns' && ops.includes('update')
        ? (activationAnswers.shift() ?? { data: null, error: null })
        : { data: [], error: null };
      return Promise.resolve(out).then(res, rej);
    };
    return b;
  }

  const req = () => ({
    method: 'POST', headers: idempotencyHeaders(),
    query: { id: 'campaign-123' },
    body: { plan: { weeks: [{ week: 1, theme: 'T', daily: [{ day: 'Monday', objective: 'A', content: 'C', platforms: { linkedin: 'L' } }] }] } },
  }) as unknown as NextApiRequest;
  const fail = { data: null, error: { message: 'boom', code: '08006' } };

  beforeEach(() => {
    requireCampaignAccessMock.mockImplementation(async (_r: any, _s: any, campaignId: string) => ({
      userId: 'test-caller-1', companyId: 'company-456', campaignId, campaignAuth: { role: 'COMPANY_ADMIN' },
    }));
    resetIdempotency();
    versionContextAns = { data: { company_id: 'company-123', campaign_snapshot: {} }, error: null };
    companyAns = { data: { company_id: 'company-123' }, error: null };
    activationAnswers = [];
    activationCalls.length = 0;
    (supabase.from as jest.Mock).mockImplementation((name: string) => table(name));
    (scheduleStructuredPlan as jest.Mock).mockReset().mockResolvedValue({ scheduled_count: 2, skipped_count: 0, skipped_platforms: [] });
    const lock = jest.requireMock('../../services/SchedulerLockService');
    (lock.acquireSchedulerLock as jest.Mock).mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('version-context read fails: 503 CAMPAIGN_VERSION_READ_FAILED, nothing scheduled (no "text" default skipping the creator gate)', async () => {
    versionContextAns = fail;
    const res = makeAssertable(createMockRes());
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({ code: 'CAMPAIGN_VERSION_READ_FAILED' });
    expect(scheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('company read fails: 503 CAMPAIGN_COMPANY_READ_FAILED BEFORE the lock, nothing scheduled', async () => {
    companyAns = fail;
    const res = makeAssertable(createMockRes());
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({ code: 'CAMPAIGN_COMPANY_READ_FAILED' });
    expect(jest.requireMock('../../services/SchedulerLockService').acquireSchedulerLock).not.toHaveBeenCalled();
    expect(scheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('activation fails twice: 200 (posts ARE scheduled) with activation.ok false, after one retry', async () => {
    activationAnswers = [fail, fail];
    const res = makeAssertable(createMockRes());
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({ scheduled_count: 2, activation: { ok: false, code: 'CAMPAIGN_ACTIVATION_FAILED' } });
    expect(activationCalls).toHaveLength(2);
  });

  it('activation fails once: the retry succeeds and activation.ok is true', async () => {
    activationAnswers = [fail, { data: null, error: null }];
    const res = makeAssertable(createMockRes());
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({ activation: { ok: true } });
    expect(activationCalls).toHaveLength(2);
  });
});
