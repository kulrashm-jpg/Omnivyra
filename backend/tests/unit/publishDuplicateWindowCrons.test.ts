/**
 * Duplicate-publication windows in the two Vercel publish crons.
 *
 * D2 — /api/cron/process-scheduled-posts: when publishNow reports a suppressed
 * duplicate (another execution holds the post-level claim), the cron used to
 * call updatePostPublishStatus(FAILED) anyway. That write is unconditional, so
 * it flipped the holder's live 'publishing' row to 'failed' — claimable again
 * mid-flight — or overwrote its 'published'. A suppressed result writes nothing.
 *
 * Workstream C — /api/cron/sweep-stuck-publishing: a row stuck in 'publishing'
 * had a claim held by an execution that never recorded a result, so whether
 * the platform accepted the post is unknown. The sweep labels it
 * PUBLISH_OUTCOME_UNCERTAIN (compare-and-set on 'publishing'), which the queue
 * worker, the blueprint guard and operators read as "possibly live".
 */
export {};

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

const mockPublishNow = jest.fn();
const mockUpdatePostPublishStatus = jest.fn(async (_p: Record<string, unknown>) => undefined);

type Row = Record<string, unknown>;
let duePosts: Row[] = [];
let stuckPosts: Row[] = [];
/** Every scheduled_posts update: its payload and the filters it was chained with. */
let postUpdates: Array<{ payload: Row; filters: Array<[string, string, unknown]> }> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      let filters: Array<[string, string, unknown]> = [];
      let updatePayload: Row | null = null;
      const finish = () => {
        if (updatePayload) {
          postUpdates.push({ payload: updatePayload, filters });
          return Promise.resolve({ data: [{ id: 'x' }], error: null });
        }
        const statusFilter = filters.find(([op, col]) => op === 'eq' && col === 'status');
        const rows = statusFilter?.[2] === 'publishing' ? stuckPosts : duePosts;
        return Promise.resolve({ data: table === 'scheduled_posts' ? rows : [], error: null });
      };
      builder.select = () => builder;
      builder.update = (p: Row) => { updatePayload = p; return builder; };
      for (const op of ['eq', 'lt', 'lte', 'in']) {
        builder[op] = (col: string, val: unknown) => { filters = [...filters, [op, col, val]]; return builder; };
      }
      builder.order = () => builder;
      builder.limit = () => builder;
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
import sweepStuckPublishing from '../../../pages/api/cron/sweep-stuck-publishing';
import { PUBLISH_OUTCOME_UNCERTAIN } from '../../queue/publishRetryState';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  return res;
}
const cronReq = () => ({ method: 'POST', headers: { authorization: 'Bearer cron-test-secret' }, body: {} }) as never;

const due = (id: string): Row => ({
  id, user_id: 'u-1', social_account_id: 'acct-1', platform: 'linkedin',
  campaign_id: null, status: 'scheduled', social_accounts: { company_id: 'org-1' },
});

const ORIGINAL_SECRET = process.env.CRON_SECRET;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = 'cron-test-secret';
  duePosts = [];
  stuckPosts = [];
  postUpdates = [];
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe('D2 — process-scheduled-posts never writes over a claim holder', () => {
  it('a suppressed duplicate is skipped: no status write, counted as skipped', async () => {
    duePosts = [due('sp-1')];
    mockPublishNow.mockResolvedValue({
      status: 'FAILED', suppressed: true,
      message: 'Duplicate publish suppressed', timestamp: '2026-09-01T09:00:00Z',
    });
    const res = mockRes();
    await processScheduledPosts(cronReq(), res);

    expect(mockPublishNow).toHaveBeenCalledTimes(1);
    expect(mockUpdatePostPublishStatus).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ processed: 1, skipped: 1, failed: 0, published: 0 });
  });

  it('an ordinary FAILED result and a PUBLISHED result are still recorded', async () => {
    duePosts = [due('sp-1'), due('sp-2')];
    mockPublishNow
      .mockResolvedValueOnce({ status: 'FAILED', message: 'token expired', timestamp: 't' })
      .mockResolvedValueOnce({ status: 'PUBLISHED', external_post_id: 'ext-2', timestamp: 't' });
    const res = mockRes();
    await processScheduledPosts(cronReq(), res);

    expect(mockUpdatePostPublishStatus).toHaveBeenCalledWith(
      expect.objectContaining({ post_id: 'sp-1', status: 'FAILED', last_error: 'token expired' }));
    expect(mockUpdatePostPublishStatus).toHaveBeenCalledWith(
      expect.objectContaining({ post_id: 'sp-2', status: 'PUBLISHED', external_post_id: 'ext-2' }));
    expect(res.body).toMatchObject({ failed: 1, published: 1, skipped: 0 });
  });
});

describe('Workstream C — sweep-stuck-publishing labels the outcome uncertain', () => {
  it('a stuck publishing row is failed WITH PUBLISH_OUTCOME_UNCERTAIN, compare-and-set on publishing', async () => {
    stuckPosts = [{ id: 'sp-9', is_thread_start: null, parent_post_id: null, updated_at: '2026-01-01T00:00:00Z' }];
    const res = mockRes();
    await sweepStuckPublishing(cronReq(), res);

    expect(res.statusCode).toBe(200);
    expect(postUpdates).toHaveLength(1);
    const [{ payload, filters }] = postUpdates;
    expect(payload).toMatchObject({ status: 'failed', error_code: PUBLISH_OUTCOME_UNCERTAIN });
    expect(String(payload.error_message)).toMatch(/swept/);
    expect(filters).toEqual(expect.arrayContaining([['eq', 'id', 'sp-9'], ['eq', 'status', 'publishing']]));
    expect(res.body).toMatchObject({ scanned: 1, swept: 1 });
  });
});
