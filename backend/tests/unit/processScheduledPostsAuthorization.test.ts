/**
 * G-1: /api/cron/process-scheduled-posts applies the shared publish
 * authorization. Everything else on the path is a recording fake (Supabase,
 * publishNow, the job runner); authorizePostPublish is the real predicate.
 * This is not a database or provider test.
 */
export {};

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

const mockPublishNow = jest.fn();
const mockUpdatePostPublishStatus = jest.fn(async (_p: Record<string, unknown>) => undefined);

type Row = Record<string, unknown>;
let duePosts: Row[] = [];
let campaigns: Row[] = [];
let campaignsError: { message: string } | null = null;
/** Every write to any table through the fake client. */
let writes: Array<{ table: string; payload: Row }> = [];
let scheduledPostsLimit: number | null = null;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      let updatePayload: Row | null = null;
      const finish = () => {
        if (updatePayload) {
          writes.push({ table, payload: updatePayload });
          return Promise.resolve({ data: [], error: null });
        }
        if (table === 'campaigns') return Promise.resolve({ data: campaignsError ? null : campaigns, error: campaignsError });
        return Promise.resolve({ data: table === 'scheduled_posts' ? duePosts : [], error: null });
      };
      builder.select = () => builder;
      builder.update = (p: Row) => { updatePayload = p; return builder; };
      for (const op of ['eq', 'lte', 'in', 'order']) builder[op] = () => builder;
      builder.limit = (n: number) => { if (table === 'scheduled_posts') scheduledPostsLimit = n; return builder; };
      builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
      builder.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => finish().then(ok, ko);
      return builder;
    },
  },
}));
jest.mock('../../db/scheduledPostsStore', () => ({
  updatePostPublishStatus: (...a: unknown[]) => (mockUpdatePostPublishStatus as any)(...a),
}));
jest.mock('../../services/publishNowService', () => ({ publishNow: (...a: unknown[]) => mockPublishNow(...a) }));
jest.mock('../../services/jobRunner', () => ({
  runJob: async (_spec: unknown, fn: () => Promise<unknown>) => ({ status: 'succeeded', result: await fn() }),
}));

import processScheduledPosts from '../../../pages/api/cron/process-scheduled-posts';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  return res;
}
const cronReq = () => ({ method: 'POST', headers: { authorization: 'Bearer cron-test-secret' }, body: {} }) as never;
const run = async () => { const res = mockRes(); await processScheduledPosts(cronReq(), res); return res; };

const due = (id: string, over: Row = {}): Row => ({
  id, user_id: 'u-1', social_account_id: 'acct-1', platform: 'linkedin',
  campaign_id: null, status: 'scheduled', content: 'body', social_accounts: { company_id: 'org-1' },
  ...over,
});
const published = (): string[] => mockPublishNow.mock.calls.map(([arg]) => (arg as { scheduled_post_id: string }).scheduled_post_id);

const ORIGINAL_SECRET = process.env.CRON_SECRET;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = 'cron-test-secret';
  duePosts = [];
  campaigns = [];
  campaignsError = null;
  writes = [];
  scheduledPostsLimit = null;
  mockPublishNow.mockResolvedValue({ status: 'PUBLISHED', external_post_id: 'ext', timestamp: 't' });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe('G-1: process-scheduled-posts authorizes before publishing', () => {
  it.each(['paused', 'completed', 'planning'])('a post on a %s campaign is not published', async (status) => {
    duePosts = [due('sp-1', { campaign_id: 'c-1' })];
    campaigns = [{ id: 'c-1', status }];
    const res = await run();

    expect(mockPublishNow).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ processed: 0, skipped_unauthorized: 1, published: 0, failed: 0 });
  });

  it('a refusal writes nothing: the row stays scheduled, with no error and no account patch', async () => {
    // The missing account would otherwise be patched or the post marked FAILED.
    duePosts = [due('sp-1', { campaign_id: 'c-1', social_account_id: null, social_accounts: null })];
    campaigns = [{ id: 'c-1', status: 'paused' }];
    await run();

    expect(writes).toEqual([]);
    expect(mockUpdatePostPublishStatus).not.toHaveBeenCalled();
  });

  it('a refused post is not lost: when the campaign is active again, the next run publishes it', async () => {
    duePosts = [due('sp-1', { campaign_id: 'c-1' })];
    campaigns = [{ id: 'c-1', status: 'paused' }];
    await run();
    await run();
    expect(mockPublishNow).not.toHaveBeenCalled();

    campaigns = [{ id: 'c-1', status: 'active' }];
    const res = await run();
    expect(published()).toEqual(['sp-1']);
    expect(res.body).toMatchObject({ published: 1, skipped_unauthorized: 0 });
  });

  it('a missing campaign row is denied (fail closed)', async () => {
    duePosts = [due('sp-1', { campaign_id: 'c-gone' })];
    await run();
    expect(mockPublishNow).not.toHaveBeenCalled();
  });

  it('a failed campaign lookup fails the run before any publish or write', async () => {
    duePosts = [due('sp-1', { campaign_id: 'c-1' }), due('sp-2')];
    campaignsError = { message: 'boom' };
    const res = await run();

    expect(res.statusCode).toBe(500);
    expect(mockPublishNow).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(mockUpdatePostPublishStatus).not.toHaveBeenCalled();
  });

  it('an empty body is refused, as the worker refuses it', async () => {
    duePosts = [due('sp-1', { content: '   ' })];
    const res = await run();
    expect(mockPublishNow).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ skipped_unauthorized: 1 });
  });

  it('standalone posts and posts on an active campaign still publish', async () => {
    duePosts = [due('sp-1'), due('sp-2', { campaign_id: 'c-1' })];
    campaigns = [{ id: 'c-1', status: 'ACTIVE' }];
    const res = await run();
    expect(published()).toEqual(['sp-1', 'sp-2']);
    expect(res.body).toMatchObject({ processed: 2, published: 2, skipped_unauthorized: 0 });
  });

  it('refused rows do not hold the batch: a later due post still publishes, and at most 20 go per run', async () => {
    const refused = Array.from({ length: 25 }, (_, i) => due(`paused-${i}`, { campaign_id: 'c-1' }));
    const allowed = Array.from({ length: 23 }, (_, i) => due(`ok-${i}`));
    duePosts = [...refused, ...allowed];
    campaigns = [{ id: 'c-1', status: 'paused' }];
    const res = await run();

    expect(scheduledPostsLimit).toBeGreaterThan(20);
    expect(published()).toEqual(allowed.slice(0, 20).map((p) => p.id));
    expect(res.body).toMatchObject({ processed: 20, published: 20, skipped_unauthorized: 25 });
  });
});
