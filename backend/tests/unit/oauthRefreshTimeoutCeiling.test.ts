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
let axiosMode: 'timeout' | '503' | 'x400-timeout-text' = 'timeout';
jest.mock('../../auth/refreshLock', () => ({ withRefreshLock: (_k: string, fn: () => unknown) => fn() }));
jest.mock('../../auth/refreshAccountResolver', () => ({ buildXRefreshLockKey: (id: string) => `x:${id}` }));
jest.mock('axios', () => {
  const fail = () => {
    const e: any = axiosMode === 'timeout'
      ? Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' })
      : axiosMode === 'x400-timeout-text'
        ? Object.assign(new Error('Request failed with status code 400'), { response: { status: 400,
            data: { error: 'invalid_request', error_description: 'upstream timeout of 30ms exceeded' } } })
        : Object.assign(new Error('Request failed with status code 503'), { response: { status: 503, data: {} } });
    return Promise.reject(e);
  };
  return { __esModule: true, default: { post: fail, get: fail }, post: fail, get: fail };
});

import { recordRefreshOutcome, xPersistedRefreshError, refreshTwitterTokenIfNeeded } from '../../auth/tokenRefreshCore';
import { refreshPlatformToken } from '../../auth/tokenRefreshFlows';
import { REFRESH_TIMEOUT_ERROR, isRefreshTimeoutError, noteRefreshFailure } from '../../auth/oauthRefreshTimeout';

beforeEach(() => { account = { id: 'acc-1', refresh_retry_count: 3, is_active: true }; });

describe('the recorder', () => {
  it('a timeout (the exact constant, written only after a STRUCTURAL check) leaves retry_count unchanged and never parks, even at 3 of 4', async () => {
    await recordRefreshOutcome('acc-1', 'failed', REFRESH_TIMEOUT_ERROR);
    expect(account.refresh_retry_count).toBe(3);
    expect(account.refresh_status).toBe('REFRESH_FAILED_RETRYABLE');
    expect(account.is_active).toBe(true);
  });

  it.each([
    ['an X provider description that merely mentions a timeout (GOV-SECURITY input)', 'invalid_request: upstream timeout of 30ms exceeded'],
    ['provider text containing ECONNABORTED', 'invalid_request: ECONNABORTED upstream'],
    ['axios-style text that is not the constant', 'timeout of 15000ms exceeded'],
    ['the constant with a provider suffix', `${REFRESH_TIMEOUT_ERROR}: but from a provider`],
  ])('NOT a timeout: %s consumes the ceiling and parks at 4', async (_n, err) => {
    await recordRefreshOutcome('acc-1', 'failed', err);
    expect(account).toMatchObject({ refresh_retry_count: 4, refresh_status: 'PROVIDER_REAUTH_REQUIRED', is_active: false });
  });

  it('invalid_client outranks a timeout-looking text: fatal-config, not retried as a timeout', async () => {
    await recordRefreshOutcome('acc-1', 'failed', 'invalid_client: request timeout of 1ms exceeded');
    expect(account.refresh_status).toBe('REFRESH_FAILED_FATAL');
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
    // A note outside any wrapper call is a no-op (no store): it can never leak into a later refresh.
    noteRefreshFailure('acc-1', { code: 'ECONNABORTED' });
  });

  it('a refresh that fails with 503 still counts (and at 3 of 4, parks)', async () => {
    axiosMode = '503';
    expect(await refreshPlatformToken('youtube', 'acc-1', TOKEN)).toBeNull();
    expect(account).toMatchObject({ refresh_retry_count: 4, is_active: false });
  });
});

it('timeout classification is STRUCTURAL: axios ECONNABORTED / TCP ETIMEDOUT codes only, never message or body text', () => {
  expect(isRefreshTimeoutError({ code: 'ECONNABORTED' })).toBe(true);
  expect(isRefreshTimeoutError({ code: 'ETIMEDOUT' })).toBe(true);
  expect(isRefreshTimeoutError({ message: 'timeout of 15000ms exceeded' })).toBe(false);
  expect(isRefreshTimeoutError({ message: 'x', response: { data: { error_description: 'timeout of 30ms exceeded' } } })).toBe(false);
  expect(isRefreshTimeoutError({ message: 'Request failed with status code 503', response: { status: 503 } })).toBe(false);
});

describe('X persisted error (xPersistedRefreshError)', () => {
  it('a real axios timeout persists exactly the constant', () => {
    expect(xPersistedRefreshError({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' })).toBe(REFRESH_TIMEOUT_ERROR);
  });
  it('GOV-SECURITY input: {error:invalid_request, error_description:"upstream timeout of 30ms exceeded"} (no axios timeout) persists the provider text and, from 3, parks at 4', async () => {
    const persisted = xPersistedRefreshError({ message: 'Request failed with status code 400',
      response: { status: 400, data: { error: 'invalid_request', error_description: 'upstream timeout of 30ms exceeded' } } });
    expect(persisted).toBe('invalid_request: upstream timeout of 30ms exceeded');
    await recordRefreshOutcome('acc-1', 'failed', persisted);
    expect(account).toMatchObject({ refresh_retry_count: 4, refresh_status: 'PROVIDER_REAUTH_REQUIRED', is_active: false });
  });
  it('a real X timeout, recorded, does NOT consume the ceiling', async () => {
    await recordRefreshOutcome('acc-1', 'failed', xPersistedRefreshError({ code: 'ECONNABORTED' }));
    expect(account).toMatchObject({ refresh_retry_count: 3, is_active: true });
  });
});

describe('end to end through the X refresh (refreshTwitterTokenIfNeeded, its real catch)', () => {
  const X = { account_id: 'acc-1', access_token: 'a', refresh_token: 'r', token_expires_at: '2000-01-01T00:00:00Z' } as any;
  it('a real axios timeout is recorded as the constant: retry_count unchanged, not parked', async () => {
    axiosMode = 'timeout';
    await refreshTwitterTokenIfNeeded(X);
    expect(account).toMatchObject({ refresh_retry_count: 3, last_refresh_error: REFRESH_TIMEOUT_ERROR, is_active: true });
  });
  it('GOV-SECURITY input through the real X catch: provider text mentioning a timeout counts and parks at 4', async () => {
    axiosMode = 'x400-timeout-text';
    await refreshTwitterTokenIfNeeded(X);
    expect(account).toMatchObject({ refresh_retry_count: 4, refresh_status: 'PROVIDER_REAUTH_REQUIRED', is_active: false,
      last_refresh_error: 'invalid_request: upstream timeout of 30ms exceeded' });
  });
});
