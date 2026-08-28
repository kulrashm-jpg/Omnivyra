/**
 * Phase 106 — publishing parks a credential it has proven dead.
 *
 * THE PRODUCTION FAILURE THIS ENCODES
 * -----------------------------------
 * Campaign 4ead230b scheduled a LinkedIn activity. Publishing correctly
 * detected the expired session, correctly attempted a refresh, correctly
 * refused to reuse the stale token, and correctly surfaced
 *
 *     "Your linkedin session has expired. Please reconnect your account…"
 *
 * on that one post. Then nothing else happened. `social_accounts.is_active`
 * stayed `true`, so:
 *
 *   - platform health kept reporting LinkedIn as connected;
 *   - every later campaign kept allocating slots to it;
 *   - each one failed the same way;
 *   - the only trace was inside an individual post's error_message.
 *
 * Ingestion already parks a connection on exactly this evidence (Phase 87).
 * Publishing did not — `markSocialAccountNeedsReauth` was called 0 times in
 * every publish path. This is that missing adoption, at the shared publish
 * chokepoint rather than in any one platform's adapter.
 *
 * WHAT IS NOT ASSERTED HERE
 * -------------------------
 * That LinkedIn's credential is repairable in code. It is not: LinkedIn issues
 * a 60-day access token and no refresh token unless the app is approved for
 * programmatic refresh, so `refreshLinkedInToken` returns null by construction.
 * The fix makes that fact VISIBLE; it cannot make it false.
 */

export {};

const mockGetToken = jest.fn();
const mockIsExpiring = jest.fn();
const mockRefresh = jest.fn();
const mockMarkNeedsReauth = jest.fn();
const mockRefreshTwitter = jest.fn();
const mockGetScheduledPost = jest.fn();
const mockGetSocialAccount = jest.fn();
const mockPublishLinkedIn = jest.fn();
const mockPublishFacebook = jest.fn();

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

jest.mock('../../auth/tokenStore', () => ({
  getToken: (...a: any[]) => mockGetToken(...a),
  isTokenExpiringSoon: (...a: any[]) => mockIsExpiring(...a),
  markSocialAccountNeedsReauth: (...a: any[]) => mockMarkNeedsReauth(...a),
}));
jest.mock('../../auth/tokenRefresh', () => ({
  refreshPlatformToken: (...a: any[]) => mockRefresh(...a),
  refreshTwitterTokenIfNeeded: (...a: any[]) => mockRefreshTwitter(...a),
}));
jest.mock('../../db/queries', () => ({
  getScheduledPost: (...a: any[]) => mockGetScheduledPost(...a),
  getSocialAccount: (...a: any[]) => mockGetSocialAccount(...a),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
// Capability validation gates at Step 1.5 and is a separate concern with its own
// coverage; stub it OK so these tests exercise the auth lifecycle they are about.
jest.mock('../../services/platformContentValidator', () => ({
  validatePlatformContentCompatibility: () => ({ ok: true, capability: 'text' }),
}));
jest.mock('../../adapters/linkedinAdapter', () => ({ publishToLinkedIn: (...a: any[]) => mockPublishLinkedIn(...a) }));
jest.mock('../../adapters/facebookAdapter', () => ({ publishToFacebook: (...a: any[]) => mockPublishFacebook(...a) }));
jest.mock('../../adapters/xAdapter', () => ({ publishToX: jest.fn() }));
jest.mock('../../adapters/instagramAdapter', () => ({ publishToInstagram: jest.fn() }));
jest.mock('../../adapters/youtubeAdapter', () => ({ publishToYouTube: jest.fn() }));
jest.mock('../../adapters/tiktokAdapter', () => ({ publishToTikTok: jest.fn() }));
jest.mock('../../adapters/spotifyAdapter', () => ({ publishToSpotify: jest.fn() }));

let publishToPlatform: typeof import('../../adapters/platformAdapter').publishToPlatform;

beforeAll(async () => {
  ({ publishToPlatform } = await import('../../adapters/platformAdapter'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetScheduledPost.mockResolvedValue({
    id: 'sp-1', platform: 'linkedin', content: 'body', social_account_id: 'acct-1', status: 'scheduled',
  });
  mockGetSocialAccount.mockResolvedValue({ id: 'acct-1', platform: 'linkedin', is_active: true });
  mockGetToken.mockResolvedValue({ access_token: 'stale', refresh_token: undefined, expires_at: '2020-01-01T00:00:00Z' });
  mockIsExpiring.mockReturnValue(true);          // expired
  mockRefresh.mockResolvedValue(null);            // unrefreshable — LinkedIn's real shape
});

const attempt = () => publishToPlatform('sp-1', 'acct-1') as Promise<any>;

describe('A — an unrefreshable credential is parked, not just reported', () => {
  it('CRITICAL: the account is marked needs-reauth when refresh cannot produce a credential', async () => {
    const r = await attempt();
    expect(r.success).toBe(false);
    expect(r.error.message).toMatch(/session has expired/i);

    expect(mockMarkNeedsReauth).toHaveBeenCalledTimes(1);
    expect(mockMarkNeedsReauth.mock.calls[0][0]).toBe('acct-1');
  });

  it('CRITICAL: refresh is ATTEMPTED before the account is parked', async () => {
    await attempt();
    // Parking without trying to refresh would disconnect healthy accounts.
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('CRITICAL: the stale token is never handed to a publisher', async () => {
    await attempt();
    expect(mockPublishLinkedIn).not.toHaveBeenCalled();
  });

  it('CRITICAL: the user-facing message still names the reconnect path', async () => {
    const r = await attempt();
    expect(r.success).toBe(false);
    expect(r.error.message).toMatch(/reconnect your account/i);
  });

  it('the reason recorded carries the platform, and no credential material', async () => {
    await attempt();
    const reason = String(mockMarkNeedsReauth.mock.calls[0][1]);
    expect(reason).toContain('linkedin');
    for (const secret of ['stale', 'Bearer', 'access_token', 'refresh_token']) {
      expect(reason).not.toContain(secret);
    }
  });
});

describe('B — a healthy credential is never parked', () => {
  it('CRITICAL: a successful refresh publishes and parks nothing', async () => {
    mockRefresh.mockResolvedValue({ access_token: 'fresh', expires_at: '2099-01-01T00:00:00Z' });
    mockPublishLinkedIn.mockResolvedValue({ success: true, platform_post_id: 'urn:li:share:1' });

    await attempt();

    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
    expect(mockPublishLinkedIn).toHaveBeenCalledTimes(1);
  });

  it('CRITICAL: the publisher receives the REFRESHED token, not the stale one', async () => {
    mockRefresh.mockResolvedValue({ access_token: 'fresh', expires_at: '2099-01-01T00:00:00Z' });
    mockPublishLinkedIn.mockResolvedValue({ success: true, platform_post_id: 'x' });

    await attempt();

    const handed = JSON.stringify(mockPublishLinkedIn.mock.calls[0]);
    expect(handed).toContain('fresh');
    expect(handed).not.toContain('stale');
  });

  it('CRITICAL: a token that is NOT expiring is never refreshed and never parked', async () => {
    mockIsExpiring.mockReturnValue(false);
    mockPublishLinkedIn.mockResolvedValue({ success: true, platform_post_id: 'x' });

    await attempt();

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
  });

  it('CRITICAL: a provider publish failure does NOT park the account', async () => {
    // A failed post is not evidence of a dead credential. Parking here would
    // disconnect a working account on any transient provider error.
    mockRefresh.mockResolvedValue({ access_token: 'fresh', expires_at: '2099-01-01T00:00:00Z' });
    mockPublishLinkedIn.mockRejectedValue(new Error('LinkedIn 500 upstream'));

    const r = await attempt();
    expect(r.success).toBe(false);
    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
  });
});

describe('C — the fix is platform-agnostic', () => {
  it('CRITICAL: the same path parks a Facebook account on the same evidence', async () => {
    mockGetScheduledPost.mockResolvedValue({
      id: 'sp-2', platform: 'facebook', content: 'body', social_account_id: 'acct-fb', status: 'scheduled',
    });
    mockGetSocialAccount.mockResolvedValue({ id: 'acct-fb', platform: 'facebook', is_active: true });

    const r = await (publishToPlatform('sp-2', 'acct-fb') as Promise<any>);
    expect(r.success).toBe(false);
    expect(r.error.message).toMatch(/session has expired/i);

    expect(mockMarkNeedsReauth).toHaveBeenCalledTimes(1);
    expect(mockMarkNeedsReauth.mock.calls[0][0]).toBe('acct-fb');
    expect(String(mockMarkNeedsReauth.mock.calls[0][1])).toContain('facebook');
  });

  it('no platform name is hard-coded into the quarantine decision', async () => {
    for (const platform of ['linkedin', 'facebook', 'instagram', 'youtube', 'tiktok', 'pinterest']) {
      jest.clearAllMocks();
      mockGetScheduledPost.mockResolvedValue({ id: 'sp', platform, content: 'b', social_account_id: `acct-${platform}`, status: 'scheduled' });
      mockGetSocialAccount.mockResolvedValue({ id: `acct-${platform}`, platform, is_active: true });
      mockGetToken.mockResolvedValue({ access_token: 'stale', expires_at: '2020-01-01T00:00:00Z' });
      mockIsExpiring.mockReturnValue(true);
      mockRefresh.mockResolvedValue(null);

      await publishToPlatform('sp', `acct-${platform}`);
      expect(mockMarkNeedsReauth).toHaveBeenCalledTimes(1);
    }
  });
});
