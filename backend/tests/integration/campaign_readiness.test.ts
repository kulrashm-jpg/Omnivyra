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
    // `dlqHasKey` (jobRunner.ts:277-282) closes its chain with
    // `.contains('job_payload', …).limit(1).maybeSingle()`. Both links were absent
    // from this double, so the publish path died on
    // `…eq(...).contains is not a function` BEFORE reaching the readiness gate —
    // masking the PUBLISH_BLOCKED_CAMPAIGN_NOT_READY rejection this test asserts.
    // `contains` is a real PostgREST filter; the sibling doubles repaired in
    // WS-2L/WS-4A (publish_flow, omnivyra_fallback_reasons, omnivyra_learning_bridge)
    // all provide it. Added chainable, matching this file's existing style.
    contains: jest.fn().mockReturnThis(),
    // Resolves to NO ROW deliberately. `maybeSingle` is reached only by the
    // dead-letter lookup on this path, and these scenarios have no DLQ entry for
    // the idempotency key — returning the generic table fixture instead made
    // `dlqHasKey` truthy and short-circuited publish with
    // PUBLISH_DEAD_LETTER_SKIP, still masking the readiness gate.
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
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
    // HARDEN-004: the scheduler reads campaign_readiness in ONE batched query
    // (same decision rule) — mock the table rather than getCampaignReadiness.
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
    const campaignsQuery = buildQuery({ data: [{ id: 'campaign-1', status: 'active' }], error: null });
    const readinessQuery = buildQuery({
      data: [{ campaign_id: 'campaign-1', readiness_state: 'not_ready' }],
      error: null,
    });

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'scheduled_posts') return duePostsQuery;
      if (table === 'queue_jobs') return existingJobsQuery;
      if (table === 'campaigns') return campaignsQuery;
      if (table === 'campaign_readiness') return readinessQuery;
      return buildQuery({ data: [], error: null });
    });

    (getQueue as jest.Mock).mockReturnValue({ add: jest.fn(), addBulk: jest.fn() });
    (createQueueJob as jest.Mock).mockResolvedValue('job-1');

    const result = await findDuePostsAndEnqueue();

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(createQueueJob).not.toHaveBeenCalled();
    expect((getQueue as jest.Mock).mock.results[0].value.add).not.toHaveBeenCalled();
    expect((getQueue as jest.Mock).mock.results[0].value.addBulk).not.toHaveBeenCalled();
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
    // queue_jobs serves BOTH the dup-check select ([]) and the HARDEN-004 bulk
    // insert (returning the created row ids) — differentiate on .insert().
    const queueJobsQuery: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      insert: jest.fn(() => { queueJobsQuery._inserted = true; return queueJobsQuery; }),
      then: (resolve: any, reject: any) => {
        const result = queueJobsQuery._inserted
          ? { data: [{ id: 'job-2', scheduled_post_id: 'scheduled-2' }], error: null }
          : { data: [], error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    const campaignsQuery = buildQuery({ data: [{ id: 'campaign-1', status: 'active' }], error: null });
    const readinessQuery = buildQuery({
      data: [{ campaign_id: 'campaign-1', readiness_state: 'ready' }],
      error: null,
    });

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'scheduled_posts') return duePostsQuery;
      if (table === 'queue_jobs') return queueJobsQuery;
      if (table === 'campaigns') return campaignsQuery;
      if (table === 'campaign_readiness') return readinessQuery;
      return buildQuery({ data: [], error: null });
    });

    const add = jest.fn();
    const addBulk = jest.fn(async (jobs: unknown[]) => jobs);
    (getQueue as jest.Mock).mockReturnValue({ add, addBulk });
    (createQueueJob as jest.Mock).mockResolvedValue('job-2');

    const result = await findDuePostsAndEnqueue();

    expect(result.created).toBe(1);
    // HARDEN-004: one pipelined enqueue with the identical payload + DB-id jobId.
    expect(addBulk).toHaveBeenCalledTimes(1);
    expect(addBulk.mock.calls[0][0]).toEqual([
      {
        name: 'publish',
        data: { scheduled_post_id: 'scheduled-2', social_account_id: 'account-1', user_id: 'user-1' },
        opts: { jobId: 'job-2', removeOnComplete: true, removeOnFail: false },
      },
    ]);
  });
});
