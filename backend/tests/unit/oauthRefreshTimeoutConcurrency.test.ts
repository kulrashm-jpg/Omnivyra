/**
 * D2 (Orchestration review): the timeout note is scoped to ONE refreshPlatformToken
 * call (AsyncLocalStorage), not shared per account. Non-X refreshes take no lock, so two
 * refreshes of one account can overlap; each must be classified by its OWN outcome.
 *
 * Inputs: account acc-1 at refresh_retry_count 0.
 *  A = facebook: its token exchange TIMES OUT (noted), then it awaits its fallback
 *      request, which fails 503 after 60 ms -> A is a timeout call.
 *  B = youtube: fails 503 after 20 ms, i.e. WHILE A's note is set -> B is a 5xx call.
 * With a shared per-account note, B would read A's timeout (recorded as a timeout, not
 * counted) and A would be recorded as a counted failure: the reverse of the truth.
 */
const patches: Array<Record<string, any>> = [];
let retryCount = 0;
function table() {
  let patch: Record<string, any> | null = null;
  const api: any = {
    select: () => api, eq: () => api,
    update: (p: Record<string, any>) => { patch = p; return api; },
    maybeSingle: async () => ({ data: { refresh_retry_count: retryCount }, error: null }),
    then: (res: any, rej: any) => {
      if (patch) {
        patches.push(patch);
        if (typeof patch.refresh_retry_count === 'number') retryCount = patch.refresh_retry_count;
      }
      return Promise.resolve({ data: null, error: null }).then(res, rej);
    },
  };
  return api;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => table() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('@/config', () => ({ config: {} }), { virtual: true });
jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: async () => ({ client_id: 'id', client_secret: 'secret' }),
}));
jest.mock('../../auth/tokenStore', () => ({ getToken: async () => null, setToken: jest.fn(), markSocialAccountNeedsReauth: jest.fn() }));
const later = (ms: number, e: unknown) => new Promise((_r, rej) => setTimeout(() => rej(e), ms));
const http503 = () => Object.assign(new Error('Request failed with status code 503'), { response: { status: 503, data: {} } });
let fbCalls = 0;
jest.mock('axios', () => {
  const get = () => {
    fbCalls += 1;
    return fbCalls === 1
      ? Promise.reject(Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }))
      : later(60, http503());
  };
  const post = () => later(20, http503());
  return { __esModule: true, default: { get, post }, get, post };
});

import { refreshPlatformToken } from '../../auth/tokenRefreshFlows';
import { REFRESH_TIMEOUT_ERROR } from '../../auth/oauthRefreshTimeout';

it('two overlapping refreshes of one account are each classified by their own outcome', async () => {
  const TOKEN = { access_token: 'a', refresh_token: 'r' } as any;
  await Promise.all([
    refreshPlatformToken('facebook', 'acc-1', TOKEN), // A: timeout (then fallback 503)
    refreshPlatformToken('youtube', 'acc-1', TOKEN),  // B: 503 while A's note is set
  ]);
  // B finishes first (20 ms), A second (60 ms).
  expect(patches.map((p) => p.last_refresh_error)).toEqual(['refresh_returned_no_token', REFRESH_TIMEOUT_ERROR]);
  // B's 5xx consumed one retry; A's timeout consumed none.
  expect(retryCount).toBe(1);
});
