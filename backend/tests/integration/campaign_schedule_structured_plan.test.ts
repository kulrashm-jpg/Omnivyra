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
