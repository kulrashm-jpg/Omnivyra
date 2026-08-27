/**
 * Phase 87 — credential lifecycle in `ingestComments`.
 *
 * These are the behavioural guards for the part of the incident that made a
 * dead credential permanent and silent:
 *
 *   - refresh only ever ran PROACTIVELY (expiring within 5 min), so a token
 *     revoked while its stored expiry still looked healthy was never refreshed;
 *   - a FAILED refresh fell through and called the provider with the stale
 *     token anyway, guaranteeing a 401 reported as a generic fetch failure;
 *   - nothing marked the connection, so the 10-minute cron retried forever.
 *
 * The tests drive the real `ingestComments` with the module boundary mocked,
 * and assert on CALL COUNTS as much as on results — "refresh exactly once" and
 * "never a second provider call on the same token" are the properties that
 * actually went wrong, and a result-only assertion would not catch their return.
 */

const mockGetToken = jest.fn();
const mockRefresh = jest.fn();
const mockMarkNeedsReauth = jest.fn();
const mockGetScheduledPost = jest.fn();
const mockAdapterFetch = jest.fn();
const mockPersist = jest.fn();

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

jest.mock('../../auth/tokenStore', () => ({
  getToken: (...a: any[]) => mockGetToken(...a),
  isTokenExpiringSoon: (t: any) => Boolean(t?.__expiringSoon),
  markSocialAccountNeedsReauth: (...a: any[]) => mockMarkNeedsReauth(...a),
}));
jest.mock('../../auth/tokenRefresh', () => ({
  refreshPlatformToken: (...a: any[]) => mockRefresh(...a),
}));
jest.mock('../../db/queries', () => ({
  getScheduledPost: (...a: any[]) => mockGetScheduledPost(...a),
}));
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
    upsert: (...a: any[]) => { mockPersist(...a); return { select: async () => ({ data: [], error: null }) }; },
  }),
}));

import { ProviderRequestError } from '../../services/engagement/providerRequestError';

const authError = () => new ProviderRequestError({ provider: 'x', status: 401, endpointCategory: 'replies' });
const notFoundError = () => new ProviderRequestError({ provider: 'x', status: 404, endpointCategory: 'replies' });

const POST = { id: 'post-1', platform: 'x', platform_post_id: 'tweet-1', social_account_id: 'acct-1', campaign_id: null, user_id: null };

let ingestComments: typeof import('../../services/engagementIngestionService').ingestComments;

beforeAll(async () => {
  ({ ingestComments } = await import('../../services/engagementIngestionService'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetScheduledPost.mockResolvedValue(POST);
  mockGetToken.mockResolvedValue({ access_token: 'good-token', refresh_token: 'r', is_active: true });
});

describe('A — the happy path still works', () => {
  it('fetches once, refreshes never, and reports success', async () => {
    mockAdapterFetch.mockResolvedValue({ data: [] });
    const r = await ingestComments('post-1');
    expect(r.success).toBe(true);
    expect(mockAdapterFetch).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
  });
});

describe('B — refresh-on-401', () => {
  it('CRITICAL: a 401 triggers exactly ONE refresh and ONE retry', async () => {
    mockAdapterFetch.mockRejectedValueOnce(authError()).mockResolvedValueOnce({ data: [] });
    mockRefresh.mockResolvedValue({ access_token: 'fresh-token' });

    const r = await ingestComments('post-1');

    expect(r.success).toBe(true);
    expect(mockRefresh).toHaveBeenCalledTimes(1);       // never a refresh loop
    expect(mockAdapterFetch).toHaveBeenCalledTimes(2);  // never more than one retry
  });

  it('CRITICAL: the retry uses the REFRESHED token, not the rejected one', async () => {
    mockAdapterFetch.mockRejectedValueOnce(authError()).mockResolvedValueOnce({ data: [] });
    mockRefresh.mockResolvedValue({ access_token: 'fresh-token' });

    await ingestComments('post-1');

    // The adapter receives one params object: { platformPostId, accessToken }.
    // Retrying with the same credential is the bug this guards.
    expect(mockAdapterFetch.mock.calls[1][0].accessToken).toBe('fresh-token');
    expect(mockAdapterFetch.mock.calls[1][0].accessToken)
      .not.toBe(mockAdapterFetch.mock.calls[0][0].accessToken);
  });

  it('CRITICAL: a 404 never triggers a refresh — no credential fixes a wrong endpoint', async () => {
    mockAdapterFetch.mockRejectedValue(notFoundError());

    const r = await ingestComments('post-1');

    expect(r.success).toBe(false);
    expect(r.failure).toBe('not_found');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();  // not a credential problem
    expect(mockAdapterFetch).toHaveBeenCalledTimes(1);
  });
});

describe('C — a failed refresh must fail loudly, never fall through', () => {
  it('CRITICAL: proactive refresh failure does NOT call the provider with the stale token', async () => {
    mockGetToken.mockResolvedValue({ access_token: 'stale', refresh_token: 'r', is_active: true, __expiringSoon: true });
    mockRefresh.mockResolvedValue(null);

    const r = await ingestComments('post-1');

    expect(r.success).toBe(false);
    expect(r.failure).toBe('refresh_failed');
    // The exact regression: the old code proceeded and produced a guaranteed 401.
    expect(mockAdapterFetch).not.toHaveBeenCalled();
  });

  it('CRITICAL: 401 + failed refresh parks the account and stops', async () => {
    mockAdapterFetch.mockRejectedValueOnce(authError());
    mockRefresh.mockResolvedValue(null);

    const r = await ingestComments('post-1');

    expect(r.failure).toBe('needs_reauth');
    expect(mockMarkNeedsReauth).toHaveBeenCalledTimes(1);
    expect(mockMarkNeedsReauth.mock.calls[0][0]).toBe('acct-1');
    expect(mockAdapterFetch).toHaveBeenCalledTimes(1);   // no retry without a new token
  });

  it('CRITICAL: a refreshed credential that is STILL rejected parks the account', async () => {
    mockAdapterFetch.mockRejectedValueOnce(authError()).mockRejectedValueOnce(authError());
    mockRefresh.mockResolvedValue({ access_token: 'fresh-but-also-dead' });

    const r = await ingestComments('post-1');

    expect(r.failure).toBe('needs_reauth');
    expect(mockMarkNeedsReauth).toHaveBeenCalledTimes(1);
    expect(mockAdapterFetch).toHaveBeenCalledTimes(2);   // and no third attempt
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('D — quarantine stops the retry loop', () => {
  it('CRITICAL: a parked account is skipped without touching the provider', async () => {
    mockGetToken.mockResolvedValue({ access_token: 'dead', refresh_token: 'r', is_active: false });

    const r = await ingestComments('post-1');

    expect(r.success).toBe(false);
    expect(r.failure).toBe('needs_reauth');
    // The point of parking: no provider call, no refresh, every cycle.
    expect(mockAdapterFetch).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('an account whose state is unknown is still attempted', async () => {
    // Refresh flows build tokens without account state; absent must not mean parked.
    mockGetToken.mockResolvedValue({ access_token: 'ok', refresh_token: 'r' });
    mockAdapterFetch.mockResolvedValue({ data: [] });

    expect((await ingestComments('post-1')).success).toBe(true);
    expect(mockAdapterFetch).toHaveBeenCalledTimes(1);
  });

  it('a missing credential is reported as config, not as a dead credential', async () => {
    mockGetToken.mockResolvedValue(null);
    const r = await ingestComments('post-1');
    expect(r.failure).toBe('config');
    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
  });
});
