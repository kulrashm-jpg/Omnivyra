/**
 * D2 — per-cycle refresh TIME budget (virality-e9). Because a refresh timeout no longer
 * consumes the reauth ceiling, an always-timing-out provider is refreshed every cycle;
 * the budget bounds the total refresh time one cycle can spend.
 *
 * Inputs: 5 posts whose tokens are expiring; each refresh takes 60 ms and returns null
 * (a timed-out refresh); budget 100 ms with a 50 ms reservation per refresh.
 * Expected: 2 refreshes start (100 -> 40 -> -20), the other 3 are DEFERRED - not
 * attempted, nothing recorded or parked - and a deferred proactive refresh still fetches
 * with the existing token; the next cycle (fresh budget) attempts them.
 */
const mockGetToken = jest.fn();
const mockRefresh = jest.fn();
const mockMarkNeedsReauth = jest.fn();
const mockGetScheduledPost = jest.fn();
const mockAdapterFetch = jest.fn();
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../auth/tokenStore', () => ({
  getToken: (...a: any[]) => mockGetToken(...a),
  isTokenExpiringSoon: (t: any) => Boolean(t?.__expiringSoon),
  markSocialAccountNeedsReauth: (...a: any[]) => mockMarkNeedsReauth(...a),
}));
jest.mock('../../auth/tokenRefresh', () => ({ refreshPlatformToken: (...a: any[]) => mockRefresh(...a) }));
jest.mock('../../db/queries', () => ({ getScheduledPost: (...a: any[]) => mockGetScheduledPost(...a) }));
jest.mock('../../services/platformAdapters', () => ({
  getPlatformAdapter: () => ({ fetchComments: (...a: any[]) => mockAdapterFetch(...a) }),
}));
jest.mock('../../services/platformRegistryService', () => ({ getPlatformCategory: () => 'social' }));
jest.mock('../../services/engagementNormalizationService', () => ({ syncFromPostComments: jest.fn() }));
jest.mock('../../db/campaignVersionStore', () => ({ getLatestCampaignVersionByCampaignId: jest.fn() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
    upsert: () => ({ select: async () => ({ data: [], error: null }) }),
  }),
}));
import { ProviderRequestError } from '../../services/engagement/providerRequestError';
import { ingestComments, createRefreshBudget, ingestRefreshBudgetMs, DEFAULT_INGEST_REFRESH_BUDGET_MS } from '../../services/engagementIngestionService';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
beforeEach(() => {
  jest.clearAllMocks();
  mockGetScheduledPost.mockImplementation(async (id: string) => ({ id, platform: 'linkedin', platform_post_id: `pp-${id}`, social_account_id: `acc-${id}`, campaign_id: null, user_id: null }));
  mockGetToken.mockResolvedValue({ access_token: 'old', refresh_token: 'r', is_active: true, __expiringSoon: true });
  mockRefresh.mockImplementation(async () => { await sleep(60); return null; }); // a refresh that timed out
  mockAdapterFetch.mockResolvedValue({ elements: [] });
});

it('the default budget is 120 s and INGEST_REFRESH_BUDGET_MS overrides it', () => {
  expect(ingestRefreshBudgetMs({})).toBe(DEFAULT_INGEST_REFRESH_BUDGET_MS);
  expect(DEFAULT_INGEST_REFRESH_BUDGET_MS).toBe(120_000);
  expect(ingestRefreshBudgetMs({ INGEST_REFRESH_BUDGET_MS: '30000' })).toBe(30_000);
  expect(ingestRefreshBudgetMs({ INGEST_REFRESH_BUDGET_MS: 'nonsense' })).toBe(DEFAULT_INGEST_REFRESH_BUDGET_MS);
});

it('N timing-out refreshes cannot push a cycle past its budget: the rest are deferred, not attempted', async () => {
  const budget = createRefreshBudget(100, 50);
  const results = [];
  for (const id of ['1', '2', '3', '4', '5']) results.push(await ingestComments(id, { refreshBudget: budget }));
  expect(mockRefresh).toHaveBeenCalledTimes(2);
  expect(budget.deferred).toBe(3);
  expect(budget.remainingMs).toBeLessThanOrEqual(0);
  // Refresh time spent (each refresh takes 60 ms) is bounded by the budget plus the
  // one refresh that started before it ran out: 2 x 60 = 120 <= 100 + 60.
  expect(mockRefresh.mock.calls.length * 60).toBeLessThanOrEqual(100 + 60);
  // A refresh that ran and failed reports refresh_failed (as before); deferred proactive
  // refreshes still fetch with the EXISTING token, so those posts succeed.
  expect(results.slice(0, 2).map((r) => r.failure)).toEqual(['refresh_failed', 'refresh_failed']);
  expect(results.slice(2).every((r) => r.success)).toBe(true);
  expect(mockAdapterFetch.mock.calls.every((c: any[]) => c[0].accessToken === 'old')).toBe(true);
  expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
});

it('a deferred AUTH-failure refresh is not attempted and parks nothing: failure refresh_deferred', async () => {
  mockGetToken.mockResolvedValue({ access_token: 'old', refresh_token: 'r', is_active: true }); // not expiring
  mockAdapterFetch.mockRejectedValue(new ProviderRequestError({ provider: 'linkedin', status: 401, endpointCategory: 'comments' }));
  const spent = createRefreshBudget(0, 50);
  const r = await ingestComments('9', { refreshBudget: spent });
  expect(r).toMatchObject({ success: false, failure: 'refresh_deferred' });
  expect(mockRefresh).not.toHaveBeenCalled();
  expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
  expect(spent.deferred).toBe(1);
});

it('a deferred account is retried on the next cycle (a fresh budget)', async () => {
  const cycle1 = createRefreshBudget(0, 50);
  await ingestComments('7', { refreshBudget: cycle1 });
  expect(mockRefresh).not.toHaveBeenCalled();
  const cycle2 = createRefreshBudget(100, 50);
  await ingestComments('7', { refreshBudget: cycle2 });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockRefresh.mock.calls[0][1]).toBe('acc-7');
});

it('without a budget (other callers: API route, polling job) behaviour is unchanged: always refreshes', async () => {
  for (const id of ['1', '2', '3']) await ingestComments(id);
  expect(mockRefresh).toHaveBeenCalledTimes(3);
});
