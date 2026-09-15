/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — "Social OAuth" family.
 *
 * THE DEFECTS:
 *   START    — /api/auth/{facebook,instagram,linkedin,pinterest,tiktok,x,youtube}
 *              answered anonymous requests and HMAC-signed whatever companyId and
 *              userId the query string named into the OAuth state.
 *   CALLBACK — the callbacks wrote social_accounts for
 *              `session user || state.userId || DEFAULT_USER_ID` into
 *              state.companyId with no membership check, so a signed state for
 *              company B (minted by anyone) planted a social account (and, for
 *              the community-ai flow, a connector token) inside company B.
 *
 * NOW: start requires a session, binds a supplied companyId with
 * enforceCompanyAccess, and signs the SESSION user into the state. Callbacks
 * require a session, require state.userId === session user, and verify active
 * membership of state.companyId (and state.tenantId) BEFORE the provider token
 * exchange — nothing is exchanged or written on denial.
 *
 * The real guard chain runs; only the database, the identity provider and the
 * provider HTTP calls are fake.
 */
import {
  seed, invoke, writeCalls, rows, leaksB, CO_A, CO_B, CANARY_B, UNKNOWN_ID, USER_A, USER_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production', OAUTH_STATE_HMAC_KEY: 'route-auth-001-test-hmac-key' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: jest.fn(async () => ({ client_id: 'test-client-id', client_secret: 'test-client-secret', source: 'test' })),
}));
jest.mock('../../auth/getBaseUrl', () => ({ getBaseUrl: () => 'http://localhost:3000' }));
jest.mock('../../auth/getCanonicalOAuthRedirectUri', () => ({
  getCanonicalOAuthRedirectUri: (p: string) => `http://localhost:3000/api/auth/${p}/callback`,
}));
jest.mock('../../auth/oauthTelemetry', () => ({ logOAuthEvent: jest.fn(), safeHost: () => 'localhost' }));
jest.mock('../../auth/tokenStore', () => ({
  setToken: jest.fn(async () => undefined),
  encryptTokenColumns: () => ({ access_token: 'enc-access', refresh_token: null }),
}));
jest.mock('../../auth/oauthScopePersistence', () => ({
  normaliseScopes: () => [],
  persistGrantedScopes: jest.fn(async () => undefined),
  persistGrantedScopesByPlatformUser: jest.fn(async () => undefined),
}));
jest.mock('../../services/earnCreditsService', () => ({ checkAndGrantSetupCredits: jest.fn(async () => undefined) }));
const mockSaveCommunityAiToken = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/platformTokenService', () => ({ saveToken: (...a: unknown[]) => mockSaveCommunityAiToken(...a) }));
jest.mock('../../services/metaDerivedAccountsService', () => ({
  syncInstagramAndThreadsFromMeta: jest.fn(async () => ({ instagramAccounts: [{ id: 'ig-1', username: 'ig' }], threadsAccounts: [] })),
}));
const mockIngestComments = jest.fn(async (..._a: unknown[]) => ({ success: true, ingested: 1 }));
const mockGetComments = jest.fn(async (id: unknown) => [{ id: `c-${String(id)}`, text: 'comment' }]);
jest.mock('../../services/engagementIngestionService', () => ({
  ingestComments: (...a: unknown[]) => mockIngestComments(...a),
  getCommentsForScheduledPost: (id: unknown) => mockGetComments(id),
}));
const mockAxiosPost = jest.fn(async (..._a: unknown[]) => ({ data: { access_token: 'provider-at', expires_in: 7200 } }));
const mockAxiosGet = jest.fn(async (..._a: unknown[]) => ({ data: { data: { id: 'plat-user-1', username: 'acct' } } }));
jest.mock('axios', () => {
  const m = { post: (...a: unknown[]) => mockAxiosPost(...a), get: (...a: unknown[]) => mockAxiosGet(...a) };
  return { __esModule: true, default: m, ...m };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encodeOAuthState, decodeOAuthState } = require('../../auth/oauthState');

/* eslint-disable @typescript-eslint/no-var-requires */
const api = (p: string) => require(`../../../pages/api/auth/${p}`).default;
/* eslint-enable @typescript-eslint/no-var-requires */

// UUID-shaped tenants so the callbacks' companyIdUuid path (the one that
// writes social_accounts.company_id) is exercised.
const UCO_A = '11111111-1111-4111-8111-11111111111a';
const UCO_B = '22222222-2222-4222-8222-22222222222b';

/** One provider-agnostic fetch fake: every provider call succeeds. */
function providerBody(url: string): unknown {
  if (url.includes('/me/accounts')) return { data: [{ id: 'page-1', name: 'Page' }] };
  if (url.includes('/page-1?')) return { name: 'Page', instagram_business_account: { id: 'ig-1' } };
  if (url.includes('/ig-1?')) return { id: 'ig-1', username: 'ig' };
  return {
    access_token: 'provider-at',
    expires_in: 3600,
    id: 'plat-user-1',
    sub: 'plat-user-1',
    name: 'Provider Account',
    username: 'acct',
    data: { access_token: 'provider-at', user: { open_id: 'plat-user-1', username: 'acct' } },
    items: [{ id: 'plat-user-1', snippet: { title: 'Provider Channel' } }],
  };
}
const fetchMock = jest.fn(async (input: unknown) => {
  const body = providerBody(String(input));
  return { ok: true, status: 200, statusText: 'OK', json: async () => body, text: async () => JSON.stringify(body) };
});

beforeAll(() => { (global as any).fetch = fetchMock; });
beforeEach(() => {
  seed({
    companies: [
      { id: UCO_A, status: 'active', name: 'UUID Company A' },
      { id: UCO_B, status: 'active', name: 'UUID Company B' },
    ],
    user_company_roles: [
      { user_id: USER_A, company_id: UCO_A, role: 'COMPANY_ADMIN', status: 'active' },
      { user_id: USER_B, company_id: UCO_B, role: 'COMPANY_ADMIN', status: 'active' },
    ],
  });
  fetchMock.mockClear();
  mockAxiosPost.mockClear();
  mockAxiosGet.mockClear();
  mockSaveCommunityAiToken.mockClear();
  mockIngestComments.mockClear();
  mockGetComments.mockClear();
});

// ─────────────────────────────────────────────────────────────── START ──

const START_ROUTES: Array<[string, RegExp]> = [
  ['facebook', /^https:\/\/www\.facebook\.com\//],
  ['instagram', /^https:\/\/www\.facebook\.com\//],
  ['linkedin', /^https:\/\/www\.linkedin\.com\//],
  ['pinterest/index', /^https:\/\/www\.pinterest\.com\//],
  ['tiktok/index', /^https:\/\/www\.tiktok\.com\//],
  ['x', /^https:\/\/twitter\.com\//],
  ['youtube', /^https:\/\/accounts\.google\.com\//],
];

function stateFromRedirect(url: string | null) {
  const state = new URL(String(url)).searchParams.get('state');
  return decodeOAuthState(state ?? undefined);
}

describe.each(START_ROUTES)('OAuth start /api/auth/%s', (route, providerUrl) => {
  const handler = api(route);

  it('no session → 401, no provider redirect, no state minted', async () => {
    const r = await invoke(handler, { method: 'GET', as: null, query: { companyId: UCO_A, userId: USER_A } });
    expect(r.status).toBe(401);
    expect(r.redirect).toBeNull();
  });

  it('session of A naming company B → 403, no provider redirect', async () => {
    const r = await invoke(handler, { method: 'GET', as: 'A', query: { companyId: UCO_B } });
    expect(r.status).toBe(403);
    expect(r.redirect).toBeNull();
  });

  it('session of A naming the harness company B (CO_B) → 403', async () => {
    const r = await invoke(handler, { method: 'GET', as: 'A', query: { companyId: CO_B } });
    expect(r.status).toBe(403);
    expect(r.redirect).toBeNull();
  });

  it('own company → provider redirect whose signed state names the SESSION user, not ?userId=', async () => {
    const r = await invoke(handler, { method: 'GET', as: 'A', query: { companyId: UCO_A, userId: USER_B, returnTo: '/social-platforms' } });
    expect(r.redirect).toMatch(providerUrl);
    const st = stateFromRedirect(r.redirect);
    expect(st.valid).toBe(true);
    expect(st.userId).toBe(USER_A);
    expect(st.companyId).toBe(UCO_A);
  });

  it('no companyId → provider redirect for the session user only (user-scoped connection)', async () => {
    const r = await invoke(handler, { method: 'GET', as: 'A', query: { userId: USER_B } });
    expect(r.redirect).toMatch(providerUrl);
    const st = stateFromRedirect(r.redirect);
    expect(st.userId).toBe(USER_A);
    expect(st.companyId).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────── CALLBACK ──

const CALLBACKS = ['facebook', 'instagram', 'linkedin', 'pinterest', 'tiktok', 'x', 'youtube', 'spotify'];
const cbHandler = (p: string) => api(`${p}/callback`);
const socialWrites = () => writeCalls(['social_accounts']);
const providerCalls = () => fetchMock.mock.calls.length + mockAxiosPost.mock.calls.length + mockAxiosGet.mock.calls.length;
const cb = (p: string, as: 'A' | 'B' | null, st: Record<string, unknown>) =>
  invoke(cbHandler(p), { method: 'GET', as, query: { code: 'auth-code', state: encodeOAuthState(st) } });

describe.each(CALLBACKS)('OAuth callback /api/auth/%s/callback', (p) => {
  it('state for company B + session user A → denied redirect, no token exchange, nothing written', async () => {
    const r = await cb(p, 'A', { companyId: UCO_B, userId: USER_A, returnTo: '/social-platforms' });
    expect(r.redirect).toMatch(/error=/);
    expect(r.redirect).not.toMatch(/success=true/);
    expect(socialWrites()).toHaveLength(0);
    expect(providerCalls()).toBe(0);
    expect(mockSaveCommunityAiToken).not.toHaveBeenCalled();
  });

  it('state user B finished by session user A → denied, nothing written', async () => {
    const r = await cb(p, 'A', { companyId: UCO_A, userId: USER_B, returnTo: '/social-platforms' });
    expect(r.redirect).toMatch(/error=/);
    expect(socialWrites()).toHaveLength(0);
    expect(providerCalls()).toBe(0);
  });

  it('no session → denied even with a valid state user (no state.userId / DEFAULT_USER_ID fallback)', async () => {
    const r = await cb(p, null, { companyId: UCO_A, userId: USER_A, returnTo: '/social-platforms' });
    expect(r.redirect).toMatch(/error=/);
    expect(socialWrites()).toHaveLength(0);
    expect(providerCalls()).toBe(0);
  });

  it('matching session + member company → social account written for the SESSION user in that company', async () => {
    const r = await cb(p, 'A', { companyId: UCO_A, userId: USER_A, returnTo: '/social-platforms' });
    expect(r.redirect).toMatch(/success=true/);
    const written = rows('social_accounts');
    expect(written.length).toBeGreaterThan(0);
    for (const row of written) {
      expect(row.user_id).toBe(USER_A);
      expect(row.company_id).toBe(UCO_A);
    }
  });
});

describe('community-ai flow: the connector tenant is bound too', () => {
  it.each(['linkedin', 'x', 'youtube'])('%s: own companyId but foreign tenantId → denied, no connector token saved', async (p) => {
    const r = await cb(p, 'A', { companyId: UCO_A, tenantId: UCO_B, flow: 'community-ai', userId: USER_A, returnTo: '/community-ai/connectors' });
    expect(r.redirect).toMatch(/error=/);
    expect(mockSaveCommunityAiToken).not.toHaveBeenCalled();
    expect(socialWrites()).toHaveLength(0);
  });

  it.each(['linkedin', 'x', 'youtube'])('%s: member tenant → connector token saved for the session user', async (p) => {
    const r = await cb(p, 'A', { companyId: UCO_A, tenantId: UCO_A, flow: 'community-ai', userId: USER_A, returnTo: '/community-ai/connectors' });
    expect(r.redirect).toMatch(/status=success/);
    expect(mockSaveCommunityAiToken).toHaveBeenCalledTimes(1);
    const [tenantArg, , , tokenArg] = mockSaveCommunityAiToken.mock.calls[0] as unknown as [string, string, string, { connected_by_user_id: string }];
    expect(tenantArg).toBe(UCO_A);
    expect(tokenArg.connected_by_user_id).toBe(USER_A);
  });
});

// ────────────────────────────────────────────────────── social/comments ──
//
// THE DEFECT: no authentication; action "fetch" with ANY scheduled_post_id (or
// postId + accountId) spent the owning tenant's platform token through
// ingestComments and returned that post's comments.

describe('/api/social/comments', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const handler = require('../../../pages/api/social/comments').default;

  beforeEach(() => {
    seed({
      social_accounts: [
        { id: 'sa-a', user_id: USER_A, company_id: CO_A, platform: 'linkedin' },
        { id: 'sa-a-teammate', user_id: 'user-teammate', company_id: CO_A, platform: 'linkedin' },
        { id: 'sa-b', user_id: USER_B, company_id: CO_B, platform: 'linkedin', account_name: CANARY_B },
        { id: 'sa-orphan', user_id: 'user-nobody', company_id: null, platform: 'linkedin' },
      ],
      scheduled_posts: [
        { id: 'sp-a', social_account_id: 'sa-a', platform_post_id: 'pp-a' },
        { id: 'sp-a-teammate', social_account_id: 'sa-a-teammate', platform_post_id: 'pp-at' },
        { id: 'sp-b', social_account_id: 'sa-b', platform_post_id: 'pp-b' },
        { id: 'sp-orphan', social_account_id: 'sa-orphan', platform_post_id: 'pp-o' },
      ],
    });
  });

  it('unauthenticated → 401, no lookup, no ingestion', async () => {
    const r = await invoke(handler, { method: 'POST', as: null, body: { action: 'fetch', scheduled_post_id: 'sp-a' } });
    expect(r.status).toBe(401);
    expect(mockIngestComments).not.toHaveBeenCalled();
    expect(mockGetComments).not.toHaveBeenCalled();
  });

  it('member of A cannot ingest/read B\'s post by scheduled_post_id → 403, B\'s token never used', async () => {
    const r = await invoke(handler, { method: 'POST', as: 'A', body: { action: 'fetch', scheduled_post_id: 'sp-b' } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(mockIngestComments).not.toHaveBeenCalled();
    expect(mockGetComments).not.toHaveBeenCalled();
  });

  it('member of A cannot reach B\'s post via (platform, postId, accountId)', async () => {
    const r = await invoke(handler, { method: 'POST', as: 'A', body: { action: 'fetch', platform: 'linkedin', postId: 'pp-b', accountId: 'sa-b' } });
    expect([403, 404]).toContain(r.status);
    expect(mockIngestComments).not.toHaveBeenCalled();
  });

  it('a post on an account with no company and another owner → 404', async () => {
    const r = await invoke(handler, { method: 'POST', as: 'A', body: { action: 'fetch', scheduled_post_id: 'sp-orphan' } });
    expect(r.status).toBe(404);
    expect(mockIngestComments).not.toHaveBeenCalled();
  });

  it('unknown scheduled post → 404', async () => {
    const r = await invoke(handler, { method: 'POST', as: 'A', body: { action: 'fetch', scheduled_post_id: UNKNOWN_ID } });
    expect(r.status).toBe(404);
    expect(mockIngestComments).not.toHaveBeenCalled();
  });

  it('owner of the account → 200 and ingestion runs for that post', async () => {
    const r = await invoke(handler, { method: 'POST', as: 'A', body: { action: 'fetch', scheduled_post_id: 'sp-a' } });
    expect(r.status).toBe(200);
    expect(mockIngestComments).toHaveBeenCalledWith('sp-a');
  });

  it('member of the account\'s company (teammate\'s account) → 200', async () => {
    const r = await invoke(handler, { method: 'POST', as: 'A', body: { action: 'fetch', platform: 'linkedin', postId: 'pp-at', accountId: 'sa-a-teammate' } });
    expect(r.status).toBe(200);
    expect(mockIngestComments).toHaveBeenCalledWith('sp-a-teammate');
  });

  it('reply: another tenant\'s accountId → denied, no platform call', async () => {
    const r = await invoke(handler, { method: 'POST', as: 'A', body: { action: 'reply', platform: 'twitter', postId: 'pp-b', accountId: 'sa-b', replyText: 'hi' } });
    expect([403, 404]).toContain(r.status);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reply: unauthenticated → 401, no platform call', async () => {
    const r = await invoke(handler, { method: 'POST', as: null, body: { action: 'reply', platform: 'twitter', postId: 'pp-a', accountId: 'sa-a', replyText: 'hi' } });
    expect(r.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
