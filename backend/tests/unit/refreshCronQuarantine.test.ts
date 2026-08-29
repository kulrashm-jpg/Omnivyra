/**
 * Phase 108 — a credential the provider has permanently rejected stops being retried.
 *
 * WHAT PRODUCTION LOOKED LIKE
 * ---------------------------
 * @omnivyra (X), read live:
 *
 *     refresh_status          PROVIDER_REAUTH_REQUIRED
 *     connection_state        PROVIDER_REAUTH_REQUIRED
 *     last_refresh_error      invalid_request: Value passed for the token was invalid.
 *     refresh_retry_count     4097
 *     is_active               true
 *
 * The cron was running, was resolving the account, and was attempting the
 * refresh — every ten minutes, four thousand times. X rejected it every time.
 * The system diagnosed the terminal state correctly and then did nothing with
 * the diagnosis:
 *
 *   - `requires_reconnect` was bucketed as `skipped`, alongside `still_valid`;
 *   - the caller only logs when refreshed>0 || errors>0, so every run was
 *     completely silent;
 *   - `is_active` stayed true, so platform health kept reporting the account as
 *     connected and campaigns kept allocating slots to it.
 *
 * These tests pin the missing half: terminal rejection parks the account and is
 * counted as an error so the run is visible. They also pin the cases that must
 * NOT park, because parking a healthy or merely non-refreshable account would
 * disconnect working integrations.
 */

export {};

const mockGetToken = jest.fn();
const mockRefreshTwitterIfNeeded = jest.fn();
const mockRefreshPlatformToken = jest.fn();
const mockMarkNeedsReauth = jest.fn();

let roleRows: Array<{ user_id: string }> = [{ user_id: 'u-1' }];
let accountRows: Array<{ id: string; platform: string }> = [];

jest.mock('@/config', () => ({ config: {} }));
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));
jest.mock('../../auth/oauthCredentialResolver', () => ({ getOAuthCredentialsForPlatform: async () => ({ client_id: 'id', client_secret: 'sec' }) }));
jest.mock('../../auth/refreshLock', () => ({ withRefreshLock: async (_k: string, fn: any) => fn() }));
jest.mock('../../auth/refreshAccountResolver', () => ({ buildXRefreshLockKey: () => 'k' }));
jest.mock('../../auth/tokenRefreshCore', () => ({
  refreshLinkedInToken: jest.fn(),
  refreshTwitterTokenIfNeeded: (...a: any[]) => mockRefreshTwitterIfNeeded(...a),
  refreshTwitterToken: jest.fn(),
  refreshFacebookToken: jest.fn(),
  refreshInstagramToken: jest.fn(),
  refreshYouTubeToken: jest.fn(),
  // Phase 114 — the shared refresh boundary now records lifecycle telemetry
  // through these. Present so this suite exercises the real code path rather
  // than a boundary that silently degrades on a missing dependency.
  recordRefreshOutcome: jest.fn(async () => undefined),
  redactCredentials: (t: string) => t,
}));
jest.mock('../../auth/tokenStore', () => ({
  getToken: (...a: any[]) => mockGetToken(...a),
  setToken: jest.fn(),
  markSocialAccountNeedsReauth: (...a: any[]) => mockMarkNeedsReauth(...a),
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    if (table === 'user_company_roles') {
      return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: roleRows }) }) }) };
    }
    // social_accounts: .select().in().eq().or().lt()
    const chain: any = {
      select: () => chain, in: () => chain, eq: () => chain, or: () => chain,
      lt: () => Promise.resolve({ data: accountRows }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    };
    return chain;
  },
}));

let refreshExpiringSocialAccountsForCompany:
  typeof import('../../auth/tokenRefreshFlows').refreshExpiringSocialAccountsForCompany;

beforeAll(async () => {
  ({ refreshExpiringSocialAccountsForCompany } = await import('../../auth/tokenRefreshFlows'));
});

beforeEach(() => {
  jest.clearAllMocks();
  roleRows = [{ user_id: 'u-1' }];
  mockGetToken.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  // The generic path is only reached by non-X platforms.
  mockRefreshPlatformToken.mockResolvedValue({ access_token: 'new' });
});

const run = () => refreshExpiringSocialAccountsForCompany('co-1');

describe('A — X: provider rejection is terminal', () => {
  beforeEach(() => { accountRows = [{ id: 'acct-x', platform: 'x' }]; });

  it('CRITICAL: requires_reconnect parks the account', async () => {
    mockRefreshTwitterIfNeeded.mockResolvedValue({ status: 'requires_reconnect' });

    await run();

    expect(mockMarkNeedsReauth).toHaveBeenCalledTimes(1);
    expect(mockMarkNeedsReauth.mock.calls[0][0]).toBe('acct-x');
  });

  it('CRITICAL: requires_reconnect is counted as an error, not skipped', async () => {
    // Bucketed as `skipped` the run was silent, because the caller only logs
    // when refreshed>0 || errors>0. That silence is what hid 4097 retries.
    mockRefreshTwitterIfNeeded.mockResolvedValue({ status: 'requires_reconnect' });

    const s = await run();

    expect(s.errors).toBe(1);
    expect(s.skipped).toBe(0);
  });

  it('CRITICAL: a still_valid account is neither parked nor counted as an error', async () => {
    mockRefreshTwitterIfNeeded.mockResolvedValue({ status: 'still_valid' });

    const s = await run();

    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
    expect(s.errors).toBe(0);
    expect(s.skipped).toBe(1);
  });

  it('CRITICAL: a successful refresh is never parked', async () => {
    mockRefreshTwitterIfNeeded.mockResolvedValue({ status: 'refreshed', access_token: 'new' });

    const s = await run();

    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
    expect(s.refreshed).toBe(1);
  });

  it('CRITICAL: a transient refresh_failed does NOT park the account', async () => {
    // A single failed attempt is not proof the credential is dead; parking here
    // would disconnect working accounts on any provider blip.
    mockRefreshTwitterIfNeeded.mockResolvedValue({ status: 'refresh_failed' });

    const s = await run();

    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
    expect(s.errors).toBe(1);
  });

  it('the parking reason carries the platform and no credential material', async () => {
    mockRefreshTwitterIfNeeded.mockResolvedValue({ status: 'requires_reconnect' });
    await run();
    const reason = String(mockMarkNeedsReauth.mock.calls[0][1]);
    expect(reason).toContain('x');
    for (const s of ['Bearer', 'access_token', 'refresh_token']) expect(reason).not.toContain(s);
  });
});

describe('B — non-X platforms use the same contract', () => {
  it('CRITICAL: a stored refresh credential that yields nothing parks the account', async () => {
    accountRows = [{ id: 'acct-yt', platform: 'youtube' }];
    mockGetToken.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
    const flows = await import('../../auth/tokenRefreshFlows');
    jest.spyOn(flows, 'refreshPlatformToken' as never).mockResolvedValue(null as never);

    const s = await refreshExpiringSocialAccountsForCompany('co-1');

    expect(s.errors).toBeGreaterThanOrEqual(1);
    expect(mockMarkNeedsReauth).toHaveBeenCalledWith('acct-yt', expect.stringContaining('youtube'));
  });

  it('CRITICAL: NO refresh credential is skipped, never parked', async () => {
    // LinkedIn and Facebook issue long-lived tokens and no refresh token. Their
    // access token may be perfectly valid — parking them would be wrong.
    accountRows = [{ id: 'acct-li', platform: 'linkedin' }];
    mockGetToken.mockResolvedValue({ access_token: 'a', refresh_token: undefined });

    const s = await run();

    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
    expect(s.skipped).toBe(1);
    expect(s.errors).toBe(0);
  });

  it('an account with no access token at all is skipped, not parked', async () => {
    accountRows = [{ id: 'acct-none', platform: 'pinterest' }];
    mockGetToken.mockResolvedValue(null);

    const s = await run();

    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
    expect(s.skipped).toBe(1);
  });
});
