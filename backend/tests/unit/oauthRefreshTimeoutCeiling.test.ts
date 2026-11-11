/**
 * D2 policy (virality-e9, option B): an OAuth refresh TIMEOUT never consumes the reauth
 * ceiling (RETRY_CEILING = 4 -> PROVIDER_REAUTH_REQUIRED -> is_active=false). A timeout
 * says nothing about the token; a 5xx still counts, and 4 x 5xx still parks the account.
 * Covered at the recorder (recordRefreshOutcome) and end to end through
 * refreshPlatformToken, whose refreshers swallow their error and return null.
 */
type Row = Record<string, any>;
let account: Row;
function table(name: string) {
  if (name !== 'social_accounts') throw new Error(`unexpected table ${name}`);
  let patch: Row | null = null;
  const api: any = {
    select: () => api,
    eq: () => api,
    update: (p: Row) => { patch = p; return api; },
    maybeSingle: async () => ({ data: { refresh_retry_count: account.refresh_retry_count }, error: null }),
    then: (res: any, rej: any) => {
      if (patch) Object.assign(account, patch);
      return Promise.resolve({ data: null, error: null }).then(res, rej);
    },
  };
  return api;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => table(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('@/config', () => ({ config: {} }), { virtual: true });
jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: async () => ({ client_id: 'id', client_secret: 'secret' }),
}));
jest.mock('../../auth/tokenStore', () => ({
  getToken: async () => null, setToken: jest.fn(), markSocialAccountNeedsReauth: jest.fn(),
}));
let axiosMode: 'timeout' | '503' = 'timeout';
jest.mock('axios', () => {
  const fail = () => {
    const e: any = axiosMode === 'timeout'
      ? Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' })
      : Object.assign(new Error('Request failed with status code 503'), { response: { status: 503, data: {} } });
    return Promise.reject(e);
  };
  return { __esModule: true, default: { post: fail, get: fail }, post: fail, get: fail };
});

import { recordRefreshOutcome } from '../../auth/tokenRefreshCore';
import { refreshPlatformToken } from '../../auth/tokenRefreshFlows';
import { REFRESH_TIMEOUT_ERROR, isRefreshTimeoutError, takeRefreshTimedOut } from '../../auth/oauthRefreshTimeout';

beforeEach(() => { account = { id: 'acc-1', refresh_retry_count: 3, is_active: true }; });

describe('the recorder', () => {
  it.each([
    ['the wrapper\'s timeout marker', REFRESH_TIMEOUT_ERROR],
    ['X\'s persisted axios message', 'timeout of 15000ms exceeded'],
    ['an ECONNABORTED text', 'ECONNABORTED: socket hang'],
  ])('a timeout (%s) leaves retry_count unchanged and never parks, even at count 3 of 4', async (_n, err) => {
    await recordRefreshOutcome('acc-1', 'failed', err);
    expect(account.refresh_retry_count).toBe(3);
    expect(account.refresh_status).toBe('REFRESH_FAILED_RETRYABLE');
    expect(account.is_active).toBe(true);
  });

  it('a 5xx still increments the count, and at the ceiling still parks (PROVIDER_REAUTH_REQUIRED, is_active=false)', async () => {
    await recordRefreshOutcome('acc-1', 'failed', 'Request failed with status code 503');
    expect(account.refresh_retry_count).toBe(4);
    expect(account.refresh_status).toBe('PROVIDER_REAUTH_REQUIRED');
    expect(account.is_active).toBe(false);
  });

  it('4 x 5xx from a clean account still ends in PROVIDER_REAUTH_REQUIRED; 10 timeouts never do', async () => {
    account.refresh_retry_count = 0;
    for (let i = 0; i < 10; i += 1) await recordRefreshOutcome('acc-1', 'failed', REFRESH_TIMEOUT_ERROR);
    expect(account).toMatchObject({ refresh_retry_count: 0, is_active: true });
    for (let i = 0; i < 4; i += 1) await recordRefreshOutcome('acc-1', 'failed', 'Request failed with status code 502');
    expect(account).toMatchObject({ refresh_retry_count: 4, refresh_status: 'PROVIDER_REAUTH_REQUIRED', is_active: false });
  });

  it('invalid_grant is still terminal at once (unchanged)', async () => {
    account.refresh_retry_count = 0;
    await recordRefreshOutcome('acc-1', 'failed', 'invalid_grant: token revoked');
    expect(account).toMatchObject({ refresh_status: 'PROVIDER_REAUTH_REQUIRED', is_active: false });
  });
});

describe('end to end through refreshPlatformToken (refreshers return null)', () => {
  const TOKEN = { access_token: 'a', refresh_token: 'r' } as any;

  it('a refresh that times out is recorded as a timeout: retry_count unchanged', async () => {
    axiosMode = 'timeout';
    expect(await refreshPlatformToken('linkedin', 'acc-1', TOKEN)).toBeNull();
    expect(account).toMatchObject({ refresh_retry_count: 3, last_refresh_error: REFRESH_TIMEOUT_ERROR, is_active: true });
    expect(takeRefreshTimedOut('acc-1')).toBe(false); // the note was taken, nothing leaks
  });

  it('a refresh that fails with 503 still counts (and at 3 of 4, parks)', async () => {
    axiosMode = '503';
    expect(await refreshPlatformToken('youtube', 'acc-1', TOKEN)).toBeNull();
    expect(account).toMatchObject({ refresh_retry_count: 4, is_active: false });
  });
});

it('timeout classification: axios ECONNABORTED and TCP ETIMEDOUT yes; a 5xx no', () => {
  expect(isRefreshTimeoutError({ code: 'ECONNABORTED' })).toBe(true);
  expect(isRefreshTimeoutError({ code: 'ETIMEDOUT' })).toBe(true);
  expect(isRefreshTimeoutError({ message: 'timeout of 15000ms exceeded' })).toBe(true);
  expect(isRefreshTimeoutError({ message: 'Request failed with status code 503', response: { status: 503 } })).toBe(false);
});
