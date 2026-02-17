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
    eq: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
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
      method: 'POST',
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

    const res = createMockRes();

    await handler(req, res);

    expect(scheduleStructuredPlan).toHaveBeenCalledWith(req.body.plan, 'campaign-123');
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.scheduled_count).toBe(2);
    expect(payload.skipped_count).toBe(1);
  });
});
