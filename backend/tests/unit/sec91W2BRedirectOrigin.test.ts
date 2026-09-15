/**
 * SEC91-W2B-2 (P2/P3) — OAuth redirect_uri builders trusted Host / X-Forwarded-Host.
 *
 * THE DEFECT:
 *   - backend/auth/getBaseUrl.ts returned the REQUEST origin whenever the (forwarded) host
 *     merely claimed to be localhost / 127.0.0.1 — ahead of NEXT_PUBLIC_APP_URL — and fell
 *     back to the request host when no URL was configured;
 *   - pages/api/community-ai/connectors/utils.ts getCommunityAiConnectorCallbackUrl,
 *     connectors/{x,linkedin}/auth.ts, pages/api/auth/x.ts and pages/api/auth/x/callback.ts
 *     built redirect_uri from X-Forwarded-Host / Host unconditionally.
 * Both headers are client-controlled unless the platform overwrites them.
 *
 * NOW (backend/auth/oauthRedirectBase.ts): in production the configured canonical app URL
 * is the only origin; the request origin is honoured only in development/test. Production
 * strings for requests on the canonical host are unchanged (COMPAT tests).
 */
import { seed, invoke, USER_A, CO_A } from '../helpers/routeAuthHarness';

const mockConfig: Record<string, unknown> = {};
jest.mock('@/config', () => ({ config: mockConfig }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: jest.fn(async () => ({ client_id: 'fake-client-id', client_secret: 'fake-client-secret', source: 'test' })),
}));
jest.mock('../../auth/oauthTelemetry', () => ({ logOAuthEvent: jest.fn(), safeHost: () => 'host' }));
const mockAxiosPost = jest.fn();
jest.mock('axios', () => {
  const m = { post: (...a: unknown[]) => mockAxiosPost(...a), get: jest.fn() };
  return { __esModule: true, default: m, ...m };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const { getBaseUrl } = require('../../auth/getBaseUrl');
const { getCanonicalOAuthRedirectUri } = require('../../auth/getCanonicalOAuthRedirectUri');
const { getCommunityAiConnectorCallbackUrl } = require('../../../pages/api/community-ai/connectors/utils');
const { encodeOAuthState } = require('../../auth/oauthState');
const route = (p: string) => require(`../../../pages/api/${p}`).default;
/* eslint-enable @typescript-eslint/no-var-requires */

const CANONICAL = 'https://www.omnivyra.com';
const EVIL = { 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https', host: 'attacker.example' };
const LOCAL_CLAIM = { 'x-forwarded-host': 'localhost:3000', 'x-forwarded-proto': 'http', host: 'localhost:3000' };
const LOOPBACK_CLAIM = { host: '127.0.0.1:3000' };
const ON_CANONICAL = { 'x-forwarded-host': 'www.omnivyra.com', 'x-forwarded-proto': 'https', host: 'www.omnivyra.com' };

function setEnv(env: 'production' | 'development', appUrl: string | null = CANONICAL) {
  for (const k of Object.keys(mockConfig)) delete mockConfig[k];
  Object.assign(mockConfig, { DEV_USER_ID: '', NODE_ENV: env, OAUTH_STATE_HMAC_KEY: 'sec91-w2b-2-test-hmac-key' });
  if (appUrl !== null) mockConfig.NEXT_PUBLIC_APP_URL = appUrl;
}
const req = (headers: Record<string, string>): any => ({ method: 'GET', query: {}, headers, cookies: {}, socket: { remoteAddress: '127.0.0.1' } });
const redirectParam = (location: string | null) => new URL(String(location)).searchParams.get('redirect_uri');

beforeEach(() => {
  setEnv('production');
  seed();
  mockAxiosPost.mockReset();
});

describe('getBaseUrl (every /api/auth/<provider> start + callback)', () => {
  it.each([
    ['X-Forwarded-Host claims localhost', LOCAL_CLAIM],
    ['Host claims 127.0.0.1', LOOPBACK_CLAIM],
    ['attacker host', EVIL],
  ])('production: %s → the configured canonical URL', (_l, headers) => {
    expect(getBaseUrl(req(headers))).toBe(CANONICAL);
    expect(getCanonicalOAuthRedirectUri('linkedin', req(headers))).toBe(`${CANONICAL}/api/auth/linkedin/callback`);
  });

  it('production with no configured URL: the schema default, never the request host', () => {
    setEnv('production', null);
    expect(getBaseUrl(req(EVIL))).toBe(CANONICAL);
  });

  it('COMPAT production: a request on the canonical host yields the identical string', () => {
    expect(getBaseUrl(req(ON_CANONICAL))).toBe('https://www.omnivyra.com');
    expect(getCanonicalOAuthRedirectUri('facebook', req(ON_CANONICAL))).toBe('https://www.omnivyra.com/api/auth/facebook/callback');
  });

  it('COMPAT production: the configured URL is normalised exactly as before (lower-case, no trailing slash)', () => {
    setEnv('production', 'https://WWW.Omnivyra.com/');
    expect(getBaseUrl(req(ON_CANONICAL))).toBe('https://www.omnivyra.com');
  });

  it('development: a localhost request still gets a localhost callback (unchanged)', () => {
    setEnv('development');
    expect(getBaseUrl(req(LOCAL_CLAIM))).toBe('http://localhost:3000');
    expect(getBaseUrl(req(LOOPBACK_CLAIM))).toBe('http://localhost:3000');
    expect(getBaseUrl(req(EVIL))).toBe(CANONICAL);
  });
});

describe('getCommunityAiConnectorCallbackUrl (meta/reddit connector start + callback)', () => {
  it('production: X-Forwarded-Host is ignored', () => {
    expect(getCommunityAiConnectorCallbackUrl('meta', req(EVIL))).toBe(`${CANONICAL}/api/community-ai/connectors/meta/callback`);
    expect(getCommunityAiConnectorCallbackUrl('reddit', req(LOCAL_CLAIM))).toBe(`${CANONICAL}/api/community-ai/connectors/reddit/callback`);
  });

  it('COMPAT production: canonical-host request and request-less callers are unchanged', () => {
    expect(getCommunityAiConnectorCallbackUrl('meta', req(ON_CANONICAL))).toBe('https://www.omnivyra.com/api/community-ai/connectors/meta/callback');
    expect(getCommunityAiConnectorCallbackUrl('linkedin')).toBe('https://www.omnivyra.com/api/community-ai/connectors/linkedin/callback');
  });

  it('development: request origin, 127.0.0.1 spelled localhost (unchanged)', () => {
    setEnv('development');
    expect(getCommunityAiConnectorCallbackUrl('meta', req(LOOPBACK_CLAIM))).toBe('http://localhost:3000/api/community-ai/connectors/meta/callback');
  });
});

describe('route redirect_uri values', () => {
  const connectorQuery = { tenant_id: CO_A, organization_id: CO_A };

  it('production: /api/auth/x ignores X-Forwarded-Host', async () => {
    const r = await invoke(route('auth/x'), { as: 'A', headers: EVIL });
    expect(redirectParam(r.redirect)).toBe(`${CANONICAL}/auth/x/callback`);
  });

  it('production: /api/community-ai/connectors/x/auth ignores X-Forwarded-Host', async () => {
    const r = await invoke(route('community-ai/connectors/x/auth'), { as: 'A', headers: EVIL, query: connectorQuery });
    expect(redirectParam(r.redirect)).toBe(`${CANONICAL}/auth/x/callback`);
  });

  it('production: /api/community-ai/connectors/linkedin/auth ignores X-Forwarded-Host', async () => {
    const r = await invoke(route('community-ai/connectors/linkedin/auth'), { as: 'A', headers: EVIL, query: connectorQuery });
    expect(redirectParam(r.redirect)).toBe(`${CANONICAL}/api/auth/linkedin/callback`);
  });

  it.each(['meta', 'reddit'])('production: /api/community-ai/connectors/%s/auth ignores X-Forwarded-Host', async (p) => {
    const r = await invoke(route(`community-ai/connectors/${p}/auth`), { as: 'A', headers: EVIL, query: connectorQuery });
    expect(redirectParam(r.redirect)).toBe(`${CANONICAL}/api/community-ai/connectors/${p}/callback`);
  });

  it('production: /api/auth/x/callback exchanges the code with the canonical redirect_uri', async () => {
    mockAxiosPost.mockRejectedValue(new Error('stop after the token request'));
    const state = encodeOAuthState({ companyId: CO_A, userId: USER_A, codeVerifier: 'fake-verifier-000000', returnTo: '/social-platforms' });
    await invoke(route('auth/x/callback'), { as: 'A', headers: EVIL, query: { code: 'auth-code', state } });
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    const body = mockAxiosPost.mock.calls[0][1] as URLSearchParams;
    expect(body.get('redirect_uri')).toBe(`${CANONICAL}/auth/x/callback`);
  });

  it('COMPAT production: start and callback agree for a request on the canonical host', async () => {
    const start = await invoke(route('auth/x'), { as: 'A', headers: ON_CANONICAL });
    expect(redirectParam(start.redirect)).toBe('https://www.omnivyra.com/auth/x/callback');
    const li = await invoke(route('community-ai/connectors/linkedin/auth'), { as: 'A', headers: ON_CANONICAL, query: connectorQuery });
    expect(redirectParam(li.redirect)).toBe('https://www.omnivyra.com/api/auth/linkedin/callback');
  });

  it('development: the X flows keep the localhost → 127.0.0.1 spelling X requires (unchanged)', async () => {
    setEnv('development');
    const r = await invoke(route('auth/x'), { as: 'A', headers: LOCAL_CLAIM });
    expect(redirectParam(r.redirect)).toBe('http://127.0.0.1:3000/auth/x/callback');
    const c = await invoke(route('community-ai/connectors/x/auth'), { as: 'A', headers: LOCAL_CLAIM, query: connectorQuery });
    expect(redirectParam(c.redirect)).toBe('http://127.0.0.1:3000/auth/x/callback');
  });
});

describe('no redirect_uri builder reads forwarded host headers directly', () => {
  it.each([
    'pages/api/community-ai/connectors/utils.ts',
    'pages/api/community-ai/connectors/x/auth.ts',
    'pages/api/community-ai/connectors/linkedin/auth.ts',
    'pages/api/auth/x.ts',
  ])('%s', (file) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync(file, 'utf8') as string;
    expect(src).not.toMatch(/x-forwarded-host/);
  });
});
