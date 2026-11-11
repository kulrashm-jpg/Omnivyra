/**
 * D2: a hung post costs ONE request timeout, never two. A timed-out ADAPTER fetch
 * (AbortSignal.timeout -> 'TimeoutError') is not a ProviderRequestError, and
 * fetchCommentsWithAdapterFallback used to treat it as "the adapter could not attempt the
 * call" and re-issue the same request through the legacy fetcher (2 x 15 s per post).
 */
const mockAdapterFetch = jest.fn();
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../auth/tokenStore', () => ({
  getToken: async () => ({ access_token: 'tok', refresh_token: 'r', is_active: true }),
  isTokenExpiringSoon: () => false,
  markSocialAccountNeedsReauth: jest.fn(),
}));
const mockRefresh = jest.fn();
jest.mock('../../auth/tokenRefresh', () => ({ refreshPlatformToken: (...a: unknown[]) => mockRefresh(...a) }));
jest.mock('../../db/queries', () => ({
  getScheduledPost: async () => ({ id: 'sp', platform: 'linkedin', platform_post_id: 'pp', social_account_id: 'a', campaign_id: null, user_id: null }),
}));
jest.mock('../../services/platformAdapters', () => ({
  getPlatformAdapter: () => ({ fetchComments: (...a: unknown[]) => mockAdapterFetch(...a) }),
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

import { ingestComments } from '../../services/engagementIngestionService';

const realFetch = global.fetch;
afterEach(() => { (global as any).fetch = realFetch; });

it.each(['TimeoutError', 'AbortError'])('an adapter fetch that ends with %s is ONE request: never re-issued through the legacy fetcher', async (name) => {
  mockAdapterFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name }));
  const legacy = jest.fn(async () => { throw new Error('the legacy fetcher must not run'); });
  (global as any).fetch = legacy;
  const r = await ingestComments('sp');
  expect(r).toMatchObject({ success: false, ingested: 0 });
  expect(mockAdapterFetch).toHaveBeenCalledTimes(1);
  expect(legacy).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled(); // a timeout is not an auth failure
  mockAdapterFetch.mockReset();
});

it('control: an adapter that could not attempt the call (a plain Error) still falls back to the legacy fetcher', async () => {
  mockAdapterFetch.mockRejectedValue(new Error('unsupported operation'));
  const legacy = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ elements: [] }), headers: { get: () => null } }));
  (global as any).fetch = legacy;
  const r = await ingestComments('sp');
  expect(r.success).toBe(true);
  expect(legacy).toHaveBeenCalledTimes(1);
});
