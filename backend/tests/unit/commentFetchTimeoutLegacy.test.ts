/**
 * Hotfix (companion to commentFetchTimeoutAdapters): the legacy direct fetchers in
 * engagementIngestionService (Facebook and Instagram have no adapter, and LinkedIn / X
 * fall back to these) carry an abort signal, and an aborted request ends
 * ingestComments as an ordinary failure for that post instead of hanging the timer.
 */
const mockGetScheduledPost = jest.fn();
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../auth/tokenStore', () => ({
  getToken: async () => ({ access_token: 'tok', refresh_token: 'r', is_active: true }),
  isTokenExpiringSoon: () => false,
  markSocialAccountNeedsReauth: jest.fn(),
}));
jest.mock('../../auth/tokenRefresh', () => ({ refreshPlatformToken: jest.fn() }));
jest.mock('../../db/queries', () => ({ getScheduledPost: (...a: any[]) => mockGetScheduledPost(...a) }));
// No adapter: the legacy direct fetchers are used.
jest.mock('../../services/platformAdapters', () => ({ getPlatformAdapter: () => null }));
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

it.each(['facebook', 'instagram', 'linkedin', 'x'])('%s: the legacy fetch carries an abort signal', async (platform) => {
  mockGetScheduledPost.mockResolvedValue({ id: 'sp', platform, platform_post_id: 'pp', social_account_id: 'a', campaign_id: null, user_id: null });
  const inits: any[] = [];
  (global as any).fetch = jest.fn(async (_u: string, init?: any) => {
    inits.push(init);
    return { ok: true, status: 200, json: async () => ({ data: [], elements: [] }), headers: { get: () => null } };
  });
  const r = await ingestComments('sp');
  expect(r.success).toBe(true);
  expect(inits).toHaveLength(1);
  expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
});

it('an aborted request (TimeoutError) ends ingestComments as a failure for that post, never a hang', async () => {
  mockGetScheduledPost.mockResolvedValue({ id: 'sp', platform: 'facebook', platform_post_id: 'pp', social_account_id: 'a', campaign_id: null, user_id: null });
  (global as any).fetch = jest.fn(async () => {
    const e = new Error('The operation was aborted due to timeout');
    e.name = 'TimeoutError';
    throw e;
  });
  const r = await ingestComments('sp');
  expect(r).toMatchObject({ success: false, ingested: 0, failure: 'provider' });
});
