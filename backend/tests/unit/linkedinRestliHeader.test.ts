/**
 * Phase 88 — LinkedIn Rest.li protocol header, on BOTH comment paths.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 87 added `X-Restli-Protocol-Version: 2.0.0` to the LinkedIn comments
 * request after discovering it was missing from the exact call that had been
 * failing in production — while every OTHER call in that adapter sent it. The
 * Phase 88 audit then found the fix had no regression guard at all: removing
 * the header again passed the entire suite.
 *
 * A header that is required by the provider and absent from one call site of
 * two is precisely the kind of thing that reappears, so both paths are asserted
 * here against a stubbed `fetch` — the ADAPTER path, and the LEGACY path that
 * runs when no adapter is available.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const mockGetToken = jest.fn();
const mockGetScheduledPost = jest.fn();

jest.mock('../../auth/tokenStore', () => ({
  getToken: (...a: any[]) => mockGetToken(...a),
  isTokenExpiringSoon: () => false,
  markSocialAccountNeedsReauth: jest.fn(),
}));
jest.mock('../../auth/tokenRefresh', () => ({ refreshPlatformToken: jest.fn() }));
jest.mock('../../db/queries', () => ({ getScheduledPost: (...a: any[]) => mockGetScheduledPost(...a) }));
// No adapter for this platform → the LEGACY fetcher is what runs.
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

const RESTLI = 'X-Restli-Protocol-Version';

/** Capture the headers of whatever URL the code fetches. */
function stubFetch() {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  (global as any).fetch = jest.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return { ok: true, status: 200, json: async () => ({ elements: [] }), text: async () => '{}' };
  });
  return calls;
}

describe('A — the adapter path sends the Rest.li header', () => {
  it('CRITICAL: fetchComments includes X-Restli-Protocol-Version: 2.0.0', async () => {
    const calls = stubFetch();
    const { linkedinAdapter } = await import('../../services/platformAdapters/linkedinAdapter');

    await linkedinAdapter.fetchComments({ platformPostId: 'urn:li:share:123', accessToken: 't' } as any);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/socialActions/');
    expect(calls[0].headers[RESTLI]).toBe('2.0.0');
  });
});

describe('B — the legacy path sends it too', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetScheduledPost.mockResolvedValue({
      id: 'p1', platform: 'linkedin', platform_post_id: 'urn:li:share:123',
      social_account_id: 'acct-1', campaign_id: null, user_id: null,
    });
    mockGetToken.mockResolvedValue({ access_token: 'tok', refresh_token: 'r', is_active: true });
  });

  it('CRITICAL: the legacy fetcher includes the header when no adapter exists', async () => {
    const calls = stubFetch();
    const { ingestComments } = await import('../../services/engagementIngestionService');

    const r = await ingestComments('p1');

    expect(r.success).toBe(true);
    // Exactly one provider call — the legacy path, and it carried the header.
    const li = calls.filter((c) => c.url.includes('/socialActions/'));
    expect(li).toHaveLength(1);
    expect(li[0].headers[RESTLI]).toBe('2.0.0');
  });

  it('still sends Authorization alongside it', async () => {
    const calls = stubFetch();
    const { ingestComments } = await import('../../services/engagementIngestionService');
    await ingestComments('p1');
    const li = calls.find((c) => c.url.includes('/socialActions/'))!;
    // Header presence only — the value is never asserted or logged.
    expect(Object.keys(li.headers)).toContain('Authorization');
  });
});
