/**
 * D2b through the real cycle runner and ingestComments:
 *  - a fetch that times out (AbortSignal.timeout -> DOMException 'TimeoutError') is the
 *    failure kind 'timeout';
 *  - linkedin timing out on every post for 3 cycles, while x succeeds, logs
 *    "provider FAILING" at console.error on the 3rd cycle (not before);
 *  - after a refresh that ended as a timeout (persisted last_refresh_error =
 *    'refresh_timeout'), the account's next refresh within the backoff is not attempted;
 *    any other refresh failure is not backed off.
 */
let lastRefreshError: string | null = null;
const mockRefresh = jest.fn();
const mockAdapterFetch = jest.fn();
const mockGetToken = jest.fn();
const POSTS = [
  { id: 'li-1', platform: 'linkedin' }, { id: 'li-2', platform: 'linkedin' }, { id: 'x-1', platform: 'x' },
];
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../auth/tokenStore', () => ({
  getToken: (...a: any[]) => mockGetToken(...a),
  isTokenExpiringSoon: (t: any) => Boolean(t?.__expiringSoon),
  markSocialAccountNeedsReauth: jest.fn(),
}));
jest.mock('../../auth/tokenRefresh', () => ({ refreshPlatformToken: (...a: any[]) => mockRefresh(...a) }));
jest.mock('../../db/queries', () => ({
  getScheduledPost: async (id: string) => {
    const p = POSTS.find((x) => x.id === id) ?? { id, platform: 'linkedin' };
    return { ...p, platform_post_id: `pp-${id}`, social_account_id: `acc-${id}`, campaign_id: null, user_id: null };
  },
}));
jest.mock('../../services/platformAdapters', () => ({
  getPlatformAdapter: () => ({ fetchComments: (...a: any[]) => mockAdapterFetch(...a) }),
}));
jest.mock('../../services/platformRegistryService', () => ({ getPlatformCategory: () => 'social' }));
jest.mock('../../services/engagementNormalizationService', () => ({ syncFromPostComments: jest.fn() }));
jest.mock('../../db/campaignVersionStore', () => ({ getLatestCampaignVersionByCampaignId: jest.fn() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../scheduler/schedulerBatching', () => ({
  getSchedulerConcurrency: () => 1,
  mapWithConcurrency: async (list: any[], _c: number, fn: (x: any) => Promise<any>) => {
    const out = [];
    for (const x of list) {
      try { out.push({ ok: true, value: await fn(x) }); } catch (e) { out.push({ ok: false, error: e }); }
    }
    return out;
  },
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => {
    if (t === 'scheduled_posts') {
      const q: any = {};
      for (const m of ['select', 'eq', 'not']) q[m] = () => q;
      q.gte = async () => ({ data: POSTS.map((p) => ({ id: p.id, platform: p.platform })), error: null });
      return q;
    }
    if (t === 'social_accounts') {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { last_refresh_error: lastRefreshError }, error: null }) };
      return q;
    }
    return {
      select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
      upsert: () => ({ select: async () => ({ data: [], error: null }) }),
    };
  },
}));

import { ingestRecentPublishedPosts, ingestComments, createRefreshBudget, __resetRefreshBackoff } from '../../services/engagementIngestionService';

// No test here may reach a real provider.
const realGlobalFetch = global.fetch;
beforeAll(() => { (global as any).fetch = async () => { throw new Error('network disabled in this test'); }; });
afterAll(() => { (global as any).fetch = realGlobalFetch; });

const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

beforeEach(() => {
  jest.clearAllMocks();
  __resetRefreshBackoff();
  lastRefreshError = null;
  mockGetToken.mockResolvedValue({ access_token: 'old', refresh_token: 'r', is_active: true });
});

it('a fetch timeout is the failure kind "timeout", and the timed-out request is NOT re-issued through the legacy fetcher', async () => {
  mockAdapterFetch.mockRejectedValue(timeoutError());
  const realFetch = global.fetch;
  const legacy = jest.fn(async () => { throw new Error('legacy fetcher must not run'); });
  (global as any).fetch = legacy;
  try {
    const r = await ingestComments('li-1');
    expect(r).toMatchObject({ success: false, failure: 'timeout' });
    expect(legacy).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled(); // a timeout is not an auth failure
  } finally {
    (global as any).fetch = realFetch;
  }
});

it('linkedin failing every post for 3 cycles (x fine) logs "provider FAILING" at ERROR on the 3rd cycle only', async () => {
  mockAdapterFetch.mockImplementation(async (p: any) => {
    if (String(p.platformPostId).startsWith('pp-li')) throw timeoutError();
    return { data: [] };
  });
  const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const failingCalls = () => errors.mock.calls.filter((c) => c[0] === '[engagementIngestion] provider FAILING');
  const r1 = await ingestRecentPublishedPosts();
  await ingestRecentPublishedPosts();
  expect(failingCalls()).toHaveLength(0);
  expect(r1.summary.health).toBe('degraded'); // the old summary never escalated this
  const r3 = await ingestRecentPublishedPosts();
  expect(failingCalls()).toEqual([[
    '[engagementIngestion] provider FAILING',
    { provider: 'linkedin', consecutive_cycles: 3, attempted: 2, by_failure_kind: { timeout: 2 } },
  ]]);
  expect(r3.summary.failingProviders).toEqual([
    { provider: 'linkedin', consecutiveCycles: 3, attempted: 2, byFailureKind: { timeout: 2 } }]);
  errors.mockRestore();
});

describe('per-account refresh backoff after a refresh TIMEOUT', () => {
  beforeEach(() => {
    mockGetToken.mockResolvedValue({ access_token: 'old', refresh_token: 'r', is_active: true, __expiringSoon: true });
    mockAdapterFetch.mockResolvedValue({ data: [] });
    mockRefresh.mockResolvedValue(null);
  });

  it('a refresh that ended as refresh_timeout is not attempted again within the backoff (and the fetch still runs)', async () => {
    lastRefreshError = 'refresh_timeout';
    const budget = createRefreshBudget(120_000, 15_000);
    await ingestComments('li-1', { refreshBudget: budget });
    const r = await ingestComments('li-1', { refreshBudget: budget });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(budget.backedOff).toBe(1);
    expect(r.success).toBe(true); // proactive refresh deferred: fetched with the existing token
  });

  it('any other refresh failure (e.g. a counted 5xx) is NOT backed off', async () => {
    lastRefreshError = 'refresh_returned_no_token';
    const budget = createRefreshBudget(120_000, 15_000);
    await ingestComments('li-1', { refreshBudget: budget });
    await ingestComments('li-1', { refreshBudget: budget });
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    expect(budget.backedOff).toBe(0);
  });

  it('the backoff is per account: another account still refreshes', async () => {
    lastRefreshError = 'refresh_timeout';
    const budget = createRefreshBudget(120_000, 15_000);
    await ingestComments('li-1', { refreshBudget: budget });
    await ingestComments('li-2', { refreshBudget: budget });
    expect(mockRefresh.mock.calls.map((c) => c[1])).toEqual(['acc-li-1', 'acc-li-2']);
  });

  it('without a budget (API route) there is no backoff: unchanged behaviour', async () => {
    lastRefreshError = 'refresh_timeout';
    await ingestComments('li-1');
    await ingestComments('li-1');
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});
