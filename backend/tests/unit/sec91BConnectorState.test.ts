/**
 * SEC91-B5 (unsigned community-AI connector OAuth state) + SEC91-B4 (connector redirect).
 *
 * THE DEFECT: /api/community-ai/connectors/{meta,reddit}/auth put the tenant, organization
 * and post-connect `redirect` into a plain base64-JSON `state` (no HMAC, no user binding,
 * no expiry), and the {meta,reddit,linkedin} callbacks trusted whatever state came back.
 * Anyone could therefore finish a connect flow with THEIR provider authorization code and
 * a hand-written state naming the victim's organization (login/account-linking CSRF — the
 * victim admin's session authorises the write), and `redirect` sent the victim to any site.
 *
 * NOW: the auth routes mint the state with the existing oauthState HMAC (company, tenant,
 * SESSION user, flow, provider, 10-minute TTL, validated returnTo); the callbacks require a
 * valid signed community-ai state whose user is the finishing session user, keep
 * requireManageConnectors, and redirect only to a validated same-origin path.
 */
import { seed, invoke, writeCalls, USER_A, USER_B } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production', OAUTH_STATE_HMAC_KEY: 'sec91-b5-test-hmac-key' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
// requireManageConnectors' SSR-cookie fallback: no cookie session in these tests.
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
jest.mock('../../../lib/supabase/publishableKey', () => ({ requireSupabasePublishableKey: () => 'fake-publishable' }));
jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: jest.fn(async () => ({ client_id: 'test-client-id', client_secret: 'test-client-secret', source: 'test' })),
}));
jest.mock('../../auth/oauthTelemetry', () => ({ logOAuthEvent: jest.fn(), safeHost: () => 'localhost' }));
const mockSaveToken = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/platformTokenService', () => ({ saveToken: (...a: unknown[]) => mockSaveToken(...a) }));
const mockDualWrite = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../auth/tokenStore', () => ({ dualWriteSocialAccount: (...a: unknown[]) => mockDualWrite(...a) }));
jest.mock('../../auth/oauthScopePersistence', () => ({
  normaliseScopes: () => [], persistGrantedScopesByPlatformUser: jest.fn(async () => undefined),
}));
jest.mock('../../services/metaDerivedAccountsService', () => ({
  syncInstagramAndThreadsFromMeta: jest.fn(async () => ({ instagramAccounts: [], threadsAccounts: [] })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encodeOAuthState, decodeOAuthState } = require('../../auth/oauthState');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = (p: string) => require(`../../../pages/api/community-ai/connectors/${p}`).default;

const ORG_A = '11111111-1111-4111-8111-11111111111a';
const ORG_B = '22222222-2222-4222-8222-22222222222b';
const EVIL = '//evil.example/phish';

const fetchMock = jest.fn(async (..._a: unknown[]) => ({
  ok: true, status: 200, statusText: 'OK',
  json: async () => ({ access_token: 'provider-at', expires_in: 3600, id: 'plat-user', name: 'Acct', sub: 'plat-user', scope: '' }),
  text: async () => '{}',
}));
beforeAll(() => { (global as any).fetch = fetchMock; });
beforeEach(() => {
  seed({
    companies: [{ id: ORG_A, status: 'active', name: 'Org A' }, { id: ORG_B, status: 'active', name: 'Org B' }],
    user_company_roles: [
      { user_id: USER_A, company_id: ORG_A, role: 'COMPANY_ADMIN', status: 'active' },
      { user_id: USER_B, company_id: ORG_B, role: 'COMPANY_ADMIN', status: 'active' },
    ],
  });
  fetchMock.mockClear();
  mockSaveToken.mockClear();
  mockDualWrite.mockClear();
});

const unsignedState = (v: Record<string, string>) =>
  Buffer.from(JSON.stringify(v), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const nothingWritten = () => {
  expect(mockSaveToken).not.toHaveBeenCalled();
  expect(mockDualWrite).not.toHaveBeenCalled();
  expect(writeCalls(['social_accounts', 'community_ai_platform_tokens'])).toHaveLength(0);
};

describe.each(['meta', 'reddit'])('/api/community-ai/connectors/%s/auth', (p) => {
  it('mints a SIGNED community-ai state bound to the session user, org and tenant', async () => {
    const r = await invoke(route(`${p}/auth`), { method: 'GET', as: 'A', query: { tenant_id: ORG_A, organization_id: ORG_A, provider: 'instagram' } });
    expect(r.redirect).toMatch(/^https:\/\//);
    const st = decodeOAuthState(new URL(String(r.redirect)).searchParams.get('state') ?? undefined);
    expect(st.valid).toBe(true);
    expect(st.flow).toBe('community-ai');
    expect(st.userId).toBe(USER_A);
    expect(st.companyId).toBe(ORG_A);
    expect(st.tenantId).toBe(ORG_A);
  });

  it('never signs an off-site redirect into the state', async () => {
    const r = await invoke(route(`${p}/auth`), { method: 'GET', as: 'A', query: { tenant_id: ORG_A, organization_id: ORG_A, redirect: EVIL } });
    const st = decodeOAuthState(new URL(String(r.redirect)).searchParams.get('state') ?? undefined);
    expect(st.valid).toBe(true);
    // The unsafe value is replaced by the connector default, never signed.
    expect(st.returnTo).toBe('/community-ai/connectors');
    expect(String(new URL(String(r.redirect)).searchParams.get('state'))).not.toContain('evil.example');
  });

  it('still requires MANAGE_CONNECTORS on the organization', async () => {
    const r = await invoke(route(`${p}/auth`), { method: 'GET', as: 'A', query: { tenant_id: ORG_B, organization_id: ORG_B } });
    expect(r.status).toBe(403);
    expect(r.redirect).toBeNull();
  });
});

describe.each(['meta', 'reddit', 'linkedin'])('/api/community-ai/connectors/%s/callback', (p) => {
  const cb = (as: 'A' | 'B' | null, state: string) =>
    invoke(route(`${p}/callback`), { method: 'GET', as, query: { code: 'attacker-auth-code', state } });

  it('an UNSIGNED hand-written state is rejected before any token exchange (CSRF)', async () => {
    const r = await cb('A', unsignedState({ tenant_id: ORG_A, organization_id: ORG_A, redirect: '/community-ai/connectors' }));
    expect(r.redirect).toMatch(/error=/);
    expect(fetchMock).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('an unsigned state can no longer redirect off-site', async () => {
    const r = await cb('A', unsignedState({ tenant_id: ORG_A, organization_id: ORG_A, redirect: EVIL }));
    expect(String(r.redirect)).not.toContain('evil.example');
    expect(String(r.redirect).startsWith('/')).toBe(true);
    expect(String(r.redirect).startsWith('//')).toBe(false);
  });

  it('a signed state started by another user is rejected (no token exchange, nothing written)', async () => {
    const st = encodeOAuthState({ companyId: ORG_A, tenantId: ORG_A, userId: USER_B, flow: 'community-ai', returnTo: '/community-ai/connectors' });
    const r = await cb('A', st);
    expect(r.redirect).toMatch(/error=/);
    expect(fetchMock).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('a signed state for a non-community flow is rejected', async () => {
    const st = encodeOAuthState({ companyId: ORG_A, tenantId: ORG_A, userId: USER_A, returnTo: '/community-ai/connectors' });
    const r = await cb('A', st);
    expect(r.redirect).toMatch(/error=/);
    nothingWritten();
  });

  it('a valid signed state for a foreign org is still refused by requireManageConnectors', async () => {
    const st = encodeOAuthState({ companyId: ORG_B, tenantId: ORG_B, userId: USER_A, flow: 'community-ai' });
    const r = await cb('A', st);
    expect(r.status).toBe(403);
    nothingWritten();
  });

  it('LEGITIMATE: a signed state for the session user connects and returns to the signed path', async () => {
    const st = encodeOAuthState({ companyId: ORG_A, tenantId: ORG_A, userId: USER_A, flow: 'community-ai', returnTo: '/community-ai/connectors' });
    const r = await cb('A', st);
    expect(r.redirect).toMatch(/^\/community-ai\/connectors\?connected=/);
    expect(mockDualWrite).toHaveBeenCalled();
    const arg = mockDualWrite.mock.calls[0][0] as { userId: string; companyId: string };
    expect(arg.userId).toBe(USER_A);
    expect(arg.companyId).toBe(ORG_A);
  });
});
