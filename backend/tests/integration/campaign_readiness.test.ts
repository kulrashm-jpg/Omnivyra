import { Job } from 'bullmq';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../queue/bullmqClient', () => ({
  getQueue: jest.fn(),
}));
jest.mock('../../db/queries', () => ({
  createQueueJob: jest.fn(),
  getQueueJob: jest.fn(),
  updateQueueJobStatus: jest.fn(),
  createQueueJobLog: jest.fn(),
  getScheduledPost: jest.fn(),
  updateScheduledPostOnPublish: jest.fn(),
  updateScheduledPostOnFailure: jest.fn(),
}));
jest.mock('../../adapters/platformAdapter', () => ({
  publishToPlatform: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { getQueue } from '../../queue/bullmqClient';
import {
  createQueueJob,
  getQueueJob,
  updateQueueJobStatus,
  createQueueJobLog,
  getScheduledPost,
} from '../../db/queries';
import { evaluateCampaignReadiness } from '../../services/campaignReadinessService';
import * as readinessService from '../../services/campaignReadinessService';
import { findDuePostsAndEnqueue } from '../../scheduler/schedulerService';
import { processPublishJob } from '../../queue/jobProcessors/publishProcessor';

type SupabaseResult = { data: any; error: any };

const buildQuery = (result: SupabaseResult) => {
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    upsert: jest.fn().mockResolvedValue(result),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };

  return query;
};

describe('Campaign readiness gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns readiness below 100 when daily plans are missing', async () => {
    const campaignId = 'campaign-1';

    const queryMap: Record<string, any> = {
      campaigns: buildQuery({ data: { id: campaignId }, error: null }),
      weekly_content_plans: buildQuery({ data: [{ week_number: 1 }], error: null }),
      daily_content_plans: buildQuery({ data: [], error: null }),
      campaign_readiness: buildQuery({ data: null, error: null }),
    };

    (supabase.from as jest.Mock).mockImplementation((table: string) => queryMap[table]);

    const readiness = await evaluateCampaignReadiness(campaignId);

    expect(readiness.readiness_percentage).toBeLessThan(100);
    expect(readiness.blocking_issues.some((issue) => issue.code === 'MISSING_DAILY_PLANS')).toBe(
      true
    );
  });

  it('scheduler skips enqueue when campaign is not ready', async () => {
    const readinessSpy = jest
      .spyOn(readinessService, 'getCampaignReadiness')
      .mockResolvedValue({
        campaign_id: 'campaign-1',
        readiness_percentage: 20,
        readiness_state: 'not_ready',
        blocking_issues: [{ code: 'MISSING_DAILY_PLANS', message: 'Missing daily plans' }],
        last_evaluated_at: new Date().toISOString(),
      });

    const duePostsQuery = buildQuery({
      data: [
        {
          id: 'scheduled-1',
          user_id: 'user-1',
          social_account_id: 'account-1',
          platform: 'linkedin',
          scheduled_for: new Date().toISOString(),
          status: 'scheduled',
          priority: 0,
          campaign_id: 'campaign-1',
        },
      ],
      error: null,
    });
    const existingJobsQuery = buildQuery({ data: [], error: null });
    const campaignsQuery = buildQuery({ data: { status: 'active' }, error: null });

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'scheduled_posts') return duePostsQuery;
      if (table === 'queue_jobs') return existingJobsQuery;
      if (table === 'campaigns') return campaignsQuery;
      return buildQuery({ data: [], error: null });
    });

    (getQueue as jest.Mock).mockReturnValue({ add: jest.fn() });
    (createQueueJob as jest.Mock).mockResolvedValue('job-1');

    const result = await findDuePostsAndEnqueue();

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(createQueueJob).not.toHaveBeenCalled();
    expect((getQueue as jest.Mock).mock.results[0].value.add).not.toHaveBeenCalled();

    readinessSpy.mockRestore();
  });

  it('publisher blocks execution when campaign readiness fails', async () => {
    const readinessSpy = jest
      .spyOn(readinessService, 'getCampaignReadiness')
      .mockResolvedValue({
        campaign_id: 'campaign-1',
        readiness_percentage: 40,
        readiness_state: 'partial',
        blocking_issues: [{ code: 'MISSING_MEDIA', message: 'Missing media' }],
        last_evaluated_at: new Date().toISOString(),
      });

    (getQueueJob as jest.Mock).mockResolvedValue({
      id: 'job-1',
      status: 'pending',
      attempts: 0,
    });
    (getScheduledPost as jest.Mock).mockResolvedValue({
      id: 'scheduled-1',
      platform: 'linkedin',
      campaign_id: 'campaign-1',
      platform_post_id: null,
    });

    const campaignsQuery = buildQuery({ data: { status: 'active' }, error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') return campaignsQuery;
      return buildQuery({ data: [], error: null });
    });

    const job = {
      id: 'job-1',
      data: {
        scheduled_post_id: 'scheduled-1',
        social_account_id: 'account-1',
        user_id: 'user-1',
      },
    } as Job;

    await expect(processPublishJob(job)).rejects.toThrow('PUBLISH_BLOCKED_CAMPAIGN_NOT_READY');

    expect(updateQueueJobStatus).toHaveBeenCalledWith(
      'job-1',
      'failed',
      expect.objectContaining({
        error_code: 'PUBLISH_BLOCKED_CAMPAIGN_NOT_READY',
      })
    );
    expect(createQueueJobLog).toHaveBeenCalledWith(
      'job-1',
      'warn',
      'Publish blocked: campaign not ready',
      { campaign_id: 'campaign-1' }
    );

    readinessSpy.mockRestore();
  });

  it('scheduler enqueues when campaign is ready', async () => {
    const readinessSpy = jest
      .spyOn(readinessService, 'getCampaignReadiness')
      .mockResolvedValue({
        campaign_id: 'campaign-1',
        readiness_percentage: 100,
        readiness_state: 'ready',
        blocking_issues: [],
        last_evaluated_at: new Date().toISOString(),
      });

    const duePostsQuery = buildQuery({
      data: [
        {
          id: 'scheduled-2',
          user_id: 'user-1',
          social_account_id: 'account-1',
          platform: 'linkedin',
          scheduled_for: new Date().toISOString(),
          status: 'scheduled',
          priority: 0,
          campaign_id: 'campaign-1',
        },
      ],
      error: null,
    });
    const existingJobsQuery = buildQuery({ data: [], error: null });
    const campaignsQuery = buildQuery({ data: { status: 'active' }, error: null });

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'scheduled_posts') return duePostsQuery;
      if (table === 'queue_jobs') return existingJobsQuery;
      if (table === 'campaigns') return campaignsQuery;
      return buildQuery({ data: [], error: null });
    });

    const add = jest.fn();
    (getQueue as jest.Mock).mockReturnValue({ add });
    (createQueueJob as jest.Mock).mockResolvedValue('job-2');

    const result = await findDuePostsAndEnqueue();

    expect(result.created).toBe(1);
    expect(createQueueJob).toHaveBeenCalled();
    expect(add).toHaveBeenCalled();

    readinessSpy.mockRestore();
  });
});
