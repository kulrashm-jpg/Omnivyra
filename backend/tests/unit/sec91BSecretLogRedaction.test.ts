/**
 * SEC91-B6 — secrets in logs.
 *
 * THE DEFECT: OAuth callbacks and token-refresh flows passed whole AxiosError objects and
 * raw provider response bodies to console.error. An AxiosError carries the request config:
 * `Authorization: Basic base64(client_id:client_secret)` (X, Spotify, Reddit), the
 * `client_secret` + `fb_exchange_token` query params (Facebook refresh) or form body. Raw
 * provider bodies can echo request parameters back, and LinkedIn's was re-thrown into the
 * user-visible `?error=` redirect.
 *
 * NOW: backend/auth/safeErrorLog.ts (`describeProviderError`, `summarizeProviderBody`)
 * produces a flat, redacted, truncated description, and every listed call site uses it.
 * All values below are fake fixtures.
 */
import { inspect } from 'util';
import { seed, invoke, USER_A } from '../helpers/routeAuthHarness';

const CLIENT_SECRET = 'FAKE-CLIENT-SECRET-sec91b6-0001';
const USER_TOKEN = 'FAKE-USER-ACCESS-TOKEN-sec91b6-0002';
const REFRESH = 'FAKE-REFRESH-TOKEN-sec91b6-0003';
const BASIC = Buffer.from(`fake-client-id:${CLIENT_SECRET}`).toString('base64');

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production', OAUTH_STATE_HMAC_KEY: 'sec91-b6-test-hmac-key' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
jest.mock('../../../lib/supabase/publishableKey', () => ({ requireSupabasePublishableKey: () => 'fake-publishable' }));
jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: jest.fn(async () => ({ client_id: 'fake-client-id', client_secret: 'FAKE-CLIENT-SECRET-sec91b6-0001', source: 'test' })),
}));
jest.mock('../../auth/getBaseUrl', () => ({ getBaseUrl: () => 'http://localhost:3000' }));
jest.mock('../../auth/getCanonicalOAuthRedirectUri', () => ({
  getCanonicalOAuthRedirectUri: (p: string) => `http://localhost:3000/api/auth/${p}/callback`,
}));
jest.mock('../../auth/oauthTelemetry', () => ({ logOAuthEvent: jest.fn(), safeHost: () => 'localhost' }));
jest.mock('../../auth/tokenStore', () => ({
  getToken: jest.fn(async () => null),
  setToken: jest.fn(async () => undefined),
  markSocialAccountNeedsReauth: jest.fn(async () => undefined),
  encryptTokenColumns: () => ({ access_token: 'enc', refresh_token: null }),
  dualWriteSocialAccount: jest.fn(async () => undefined),
}));
jest.mock('../../auth/refreshLock', () => ({ withRefreshLock: async (_k: string, fn: () => unknown) => fn() }));
jest.mock('../../auth/oauthScopePersistence', () => ({
  normaliseScopes: () => [], persistGrantedScopes: jest.fn(async () => undefined), persistGrantedScopesByPlatformUser: jest.fn(async () => undefined),
}));
jest.mock('../../services/earnCreditsService', () => ({ checkAndGrantSetupCredits: jest.fn(async () => undefined) }));
jest.mock('../../services/platformTokenService', () => ({ saveToken: jest.fn(async () => undefined) }));
jest.mock('../../services/metaDerivedAccountsService', () => ({
  syncInstagramAndThreadsFromMeta: jest.fn(async () => ({ instagramAccounts: [], threadsAccounts: [] })),
}));

/** An AxiosError-shaped rejection carrying credentials in config, as axios really does. */
function axiosLikeError(url: string) {
  const e: any = new Error('Request failed with status code 400');
  e.isAxiosError = true;
  e.code = 'ERR_BAD_REQUEST';
  e.config = {
    url,
    method: 'post',
    headers: { Authorization: `Basic ${BASIC}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    params: { client_id: 'fake-client-id', client_secret: CLIENT_SECRET, fb_exchange_token: USER_TOKEN },
    data: `grant_type=refresh_token&refresh_token=${REFRESH}&client_secret=${CLIENT_SECRET}`,
  };
  e.request = { _header: `POST /token HTTP/1.1\r\nAuthorization: Basic ${BASIC}\r\n` };
  e.response = { status: 400, data: { error: 'invalid_grant', error_description: 'Refresh token expired' } };
  return e;
}

const mockAxiosPost = jest.fn();
const mockAxiosGet = jest.fn();
jest.mock('axios', () => {
  const m = { post: (...a: unknown[]) => mockAxiosPost(...a), get: (...a: unknown[]) => mockAxiosGet(...a) };
  return { __esModule: true, default: m, ...m };
});

let logged: string[] = [];
const spies: jest.SpyInstance[] = [];
beforeEach(() => {
  logged = [];
  for (const m of ['error', 'warn', 'log', 'info'] as const) {
    spies.push(jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 10 }))).join(' '));
    }));
  }
  mockAxiosPost.mockReset();
  mockAxiosGet.mockReset();
});
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

const leaked = () => logged.filter((l) => l.includes(CLIENT_SECRET) || l.includes(USER_TOKEN) || l.includes(REFRESH) || l.includes(BASIC));

// ─────────────────────────────────────────────────────────── helper ──
describe('safeErrorLog helper', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const h = () => require('../../auth/safeErrorLog');

  it('describeProviderError drops request config / headers / request and keeps the diagnosis', () => {
    const d = h().describeProviderError(axiosLikeError('https://graph.facebook.com/v22.0/oauth/access_token'));
    const s = JSON.stringify(d);
    expect(s).not.toContain(CLIENT_SECRET);
    expect(s).not.toContain(USER_TOKEN);
    expect(s).not.toContain(BASIC);
    expect(d.status).toBe(400);
    expect(d.provider_error).toBe('invalid_grant');
    expect(d.provider_error_description).toBe('Refresh token expired');
  });

  it('summarizeProviderBody redacts echoed parameters, JSON fields and auth schemes', () => {
    const body = `{"error":"x","client_secret":"${CLIENT_SECRET}","access_token":"${USER_TOKEN}"} url?code=abc123456&client_secret=${CLIENT_SECRET} Authorization: Bearer ${USER_TOKEN}`;
    const out = h().summarizeProviderBody(body, { max: 2000 });
    expect(out).not.toContain(CLIENT_SECRET);
    expect(out).not.toContain(USER_TOKEN);
    expect(out).not.toContain('abc123456');
    expect(out).toContain('"error":"x"');
  });

  it('removes caller-known secrets anywhere and truncates', () => {
    const out = h().redactSecrets(`prefix ${REFRESH} suffix ${'z'.repeat(1000)}`, { secrets: [REFRESH] });
    expect(out).not.toContain(REFRESH);
    expect(out.length).toBeLessThanOrEqual(301);
  });
});

// ─────────────────────────────────────────────── token refresh flows ──
describe('token refresh flows never log request credentials', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const core = () => require('../../auth/tokenRefreshCore');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const flows = () => require('../../auth/tokenRefreshFlows');
  const tok = { access_token: USER_TOKEN, refresh_token: REFRESH, expires_at: new Date(Date.now() - 1000).toISOString() };

  it('Facebook (fb_exchange_token + client_secret query params, then the refresh_token retry)', async () => {
    mockAxiosGet.mockRejectedValue(axiosLikeError('https://graph.facebook.com/v22.0/oauth/access_token'));
    expect(await core().refreshFacebookToken('sa-1', tok)).toBeNull();
    expect(logged.length).toBeGreaterThan(0);
    expect(leaked()).toEqual([]);
  });

  it.each([
    ['refreshLinkedInToken', 'core'],
    ['refreshYouTubeToken', 'core'],
    ['refreshSpotifyToken', 'flows'],
    ['refreshTikTokToken', 'flows'],
    ['refreshRedditToken', 'flows'],
    ['refreshPinterestToken', 'flows'],
  ])('%s', async (fn, mod) => {
    const bodyEcho = axiosLikeError('https://provider.example/token');
    // A provider body that echoes the request back.
    bodyEcho.response.data = { error: 'invalid_request', error_description: `bad client_secret=${CLIENT_SECRET}`, echo: `refresh_token=${REFRESH}` };
    mockAxiosPost.mockRejectedValue(bodyEcho);
    const m = mod === 'core' ? core() : flows();
    expect(await m[fn]('sa-1', tok)).toBeNull();
    expect(leaked()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────── callbacks ──
describe('OAuth callbacks never log (or redirect with) provider credentials', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { encodeOAuthState } = require('../../auth/oauthState');
  const ORG = '11111111-1111-4111-8111-11111111111a';
  beforeEach(() => {
    seed({
      companies: [{ id: ORG, status: 'active', name: 'Org' }],
      user_company_roles: [{ user_id: USER_A, company_id: ORG, role: 'COMPANY_ADMIN', status: 'active' }],
    });
  });
  const echoingFetch = (status: number) => jest.fn(async () => ({
    ok: false, status, statusText: 'Bad Request',
    text: async () => `{"error":"invalid_client","detail":"client_secret=${CLIENT_SECRET}&code=auth-code-123456"}`,
    json: async () => ({ error: 'invalid_client', client_secret: CLIENT_SECRET }),
  }));

  it('X: a failed token exchange (AxiosError with Basic client credentials) is logged redacted', async () => {
    mockAxiosPost.mockRejectedValue(axiosLikeError('https://api.twitter.com/2/oauth2/token'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const handler = require('../../../pages/api/auth/x/callback').default;
    const state = encodeOAuthState({ companyId: ORG, userId: USER_A, codeVerifier: 'fake-verifier-000000', returnTo: '/social-platforms' });
    const r = await invoke(handler, { method: 'GET', as: 'A', query: { code: 'auth-code', state } });
    expect(r.redirect).toMatch(/error=/);
    expect(logged.some((l) => l.includes('X OAuth callback error'))).toBe(true);
    expect(leaked()).toEqual([]);
  });

  it.each(['linkedin', 'pinterest', 'spotify', 'tiktok'])('%s: an echoing token-exchange error body is redacted in logs and in the redirect', async (p) => {
    (global as any).fetch = echoingFetch(400);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const handler = require(`../../../pages/api/auth/${p}/callback`).default;
    const state = encodeOAuthState({ companyId: ORG, userId: USER_A, returnTo: '/social-platforms' });
    const r = await invoke(handler, { method: 'GET', as: 'A', query: { code: 'auth-code', state } });
    expect(leaked()).toEqual([]);
    expect(decodeURIComponent(String(r.redirect))).not.toContain(CLIENT_SECRET);
  });

  it('community-AI meta connector: an echoing token-exchange error body is redacted', async () => {
    (global as any).fetch = echoingFetch(400);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const handler = require('../../../pages/api/community-ai/connectors/meta/callback').default;
    const state = encodeOAuthState({ companyId: ORG, tenantId: ORG, userId: USER_A, flow: 'community-ai' });
    const r = await invoke(handler, { method: 'GET', as: 'A', query: { code: 'auth-code', state } });
    expect(r.redirect).toMatch(/error=/);
    expect(leaked()).toEqual([]);
  });

  it('metaDerivedAccountsService no longer dumps the raw Graph response body', () => {
    const src = require('fs').readFileSync('backend/services/metaDerivedAccountsService.ts', 'utf8') as string;
    expect(src).not.toMatch(/console\.log\('THREADS_ACCOUNT_RESPONSE',\s*body\)/);
  });
});
