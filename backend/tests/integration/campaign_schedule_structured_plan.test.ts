import handler from '../../../pages/api/campaigns/[id]/schedule-structured-plan';
import { scheduleStructuredPlan } from '../../services/structuredPlanScheduler';
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../services/structuredPlanScheduler', () => ({
  scheduleStructuredPlan: jest.fn(),
}));

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Structured plan scheduling API', () => {
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
