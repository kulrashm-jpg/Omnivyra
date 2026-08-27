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

  /**
   * R2-IMPL B1 — RETARGETED (was: "scheduler skips enqueue when campaign is
   * not ready"). Campaign-global readiness no longer gates enqueue; the
   * approved contract authorizes per post. The safety this test guarded —
   * "don't enqueue something that isn't legitimately released" — is now
   * asserted directly against the post's own state, which is STRICTER because
   * it is scoped to the post rather than to the campaign's planning progress.
   */
  it('scheduler enqueues a released post even when campaign readiness is NOT ready', async () => {
    const duePostsQuery = buildQuery({
      data: [
        {
          id: 'scheduled-1',
          user_id: 'user-1',
          social_account_id: 'account-1',
          platform: 'linkedin',
          scheduled_for: new Date().toISOString(),
          status: 'scheduled', // released
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
          ? { data: [{ id: 'job-1', scheduled_post_id: 'scheduled-1' }], error: null }
          : { data: [], error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    const campaignsQuery = buildQuery({ data: [{ id: 'campaign-1', status: 'active' }], error: null });
    // Deliberately not_ready — the old gate would have skipped this post.
    const readinessQuery = buildQuery({
      data: [{ campaign_id: 'campaign-1', readiness_state: 'not_ready' }],
      error: null,
    });

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'scheduled_posts') return duePostsQuery;
      if (table === 'queue_jobs') return queueJobsQuery;
      if (table === 'campaigns') return campaignsQuery;
      if (table === 'campaign_readiness') return readinessQuery;
      return buildQuery({ data: [], error: null });
    });

    (getQueue as jest.Mock).mockReturnValue({ add: jest.fn(), addBulk: jest.fn(async (j: unknown[]) => j) });
    (createQueueJob as jest.Mock).mockResolvedValue('job-1');

    const result = await findDuePostsAndEnqueue();

    expect(result.skipped).toBe(0);
    expect(result.created).toBe(1);
  });

  it('scheduler still skips when the CAMPAIGN is not active (gate retained)', async () => {
    const duePostsQuery = buildQuery({
      data: [
        {
          id: 'scheduled-1', user_id: 'user-1', social_account_id: 'account-1',
          platform: 'linkedin', scheduled_for: new Date().toISOString(),
          status: 'scheduled', priority: 0, campaign_id: 'campaign-1',
        },
      ],
      error: null,
    });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'scheduled_posts') return duePostsQuery;
      if (table === 'queue_jobs') return buildQuery({ data: [], error: null });
      if (table === 'campaigns') return buildQuery({ data: [{ id: 'campaign-1', status: 'planning' }], error: null });
      return buildQuery({ data: [], error: null });
    });
    (getQueue as jest.Mock).mockReturnValue({ add: jest.fn(), addBulk: jest.fn() });
    (createQueueJob as jest.Mock).mockResolvedValue('job-1');

    const result = await findDuePostsAndEnqueue();

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(createQueueJob).not.toHaveBeenCalled();
  });

  it('scheduler never sees an UNRELEASED sibling week — the due query filters status=scheduled', async () => {
    // Partial release: weeks 3-6 are draft, so they are not due candidates.
    const duePostsQuery = buildQuery({ data: [], error: null });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'scheduled_posts') return duePostsQuery;
      return buildQuery({ data: [], error: null });
    });
    (getQueue as jest.Mock).mockReturnValue({ add: jest.fn(), addBulk: jest.fn() });

    const result = await findDuePostsAndEnqueue();

    expect(result.found).toBe(0);
    expect(result.created).toBe(0);
    // The filter is structural, not incidental.
    expect(duePostsQuery.eq).toHaveBeenCalledWith('status', 'scheduled');
  });

  /**
   * R2-IMPL B1 — RETARGETED (was: "publisher blocks execution when campaign
   * readiness fails"). The approved contract removes campaign-global readiness
   * as a publish authorization input. These two replacements assert BOTH halves
   * of that change: readiness no longer blocks, and per-post release state does.
   */
  const publishJob = () => ({
    id: 'job-1',
    data: { scheduled_post_id: 'scheduled-1', social_account_id: 'account-1', user_id: 'user-1' },
  } as Job);

  const wirePublish = (post: Record<string, unknown>, campaignStatus = 'active') => {
    (getQueueJob as jest.Mock).mockResolvedValue({ id: 'job-1', status: 'pending', attempts: 0 });
    (getScheduledPost as jest.Mock).mockResolvedValue(post);
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') return buildQuery({ data: { status: campaignStatus }, error: null });
      return buildQuery({ data: [], error: null });
    });
  };

  it('publisher does NOT block a released post when campaign readiness is only partial', async () => {
    // The old gate rejected here. Readiness is now informational — a released
    // post on an active campaign must get past authorization.
    const readinessSpy = jest.spyOn(readinessService, 'getCampaignReadiness').mockResolvedValue({
      campaign_id: 'campaign-1',
      readiness_percentage: 40,
      readiness_state: 'partial',
      blocking_issues: [{ code: 'MISSING_MEDIA', message: 'Missing media' }],
      last_evaluated_at: new Date().toISOString(),
    });

    wirePublish({
      id: 'scheduled-1', platform: 'linkedin', campaign_id: 'campaign-1',
      platform_post_id: null, status: 'scheduled', content: 'Ready to publish.',
    });

    // It proceeds past authorization (it may still fail further down the
    // pipeline in this harness — what matters is WHICH error, and that no
    // readiness rejection was recorded).
    await processPublishJob(publishJob()).catch(() => { /* downstream, not authorization */ });

    expect(updateQueueJobStatus).not.toHaveBeenCalledWith(
      'job-1', 'failed',
      expect.objectContaining({ error_code: 'PUBLISH_BLOCKED_CAMPAIGN_NOT_READY' }),
    );
    // Readiness is no longer consulted for authorization at all.
    expect(readinessSpy).not.toHaveBeenCalled();
    readinessSpy.mockRestore();
  });

  it('publisher BLOCKS a post that was never released (draft) — the replacement safety', async () => {
    wirePublish({
      id: 'scheduled-1', platform: 'linkedin', campaign_id: 'campaign-1',
      platform_post_id: null, status: 'draft', content: 'Half-written.',
    });

    await expect(processPublishJob(publishJob())).rejects.toThrow('PUBLISH_BLOCKED_POST_NOT_RELEASED');

    expect(updateQueueJobStatus).toHaveBeenCalledWith(
      'job-1', 'failed',
      expect.objectContaining({ error_code: 'PUBLISH_BLOCKED_POST_NOT_RELEASED' }),
    );
  });

  it('publisher still BLOCKS when the campaign is not active (gate retained)', async () => {
    wirePublish({
      id: 'scheduled-1', platform: 'linkedin', campaign_id: 'campaign-1',
      platform_post_id: null, status: 'scheduled', content: 'Ready.',
    }, 'planning');

    await expect(processPublishJob(publishJob())).rejects.toThrow('PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE');
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
