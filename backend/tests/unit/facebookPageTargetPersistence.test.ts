/**
 * Facebook OAuth → the Page target is discovered, bound and PERSISTED — or it
 * is explicitly not.
 *
 * WHY THIS EXISTS
 * ---------------
 * The callback stored `profile.id` from `GET /me` — the Facebook USER id — and
 * the USER token, and stored nothing else. Graph only accepts feed publishing
 * at a PAGE node with that Page's own token, so the connection it produced
 * could never publish: there was no Page anywhere in it.
 *
 * The Page and its token now come from the call this repo already makes for the
 * Instagram/Threads derivation — `GET /v22.0/me/accounts?fields=id,name,
 * access_token` — and are written to the columns the schema already reserves
 * for them (`social_accounts.linked_page_id` / `page_access_token`, which the
 * live CHECK `social_accounts_facebook_token_chk` requires on any ACTIVE
 * facebook row).
 *
 * What this suite pins down:
 *   - a single manageable Page is bound to THIS connection, in THIS company;
 *   - no manageable Page, or several, persists NOTHING and says why — a Page
 *     is never guessed;
 *   - a user id can never arrive as a Page id, whatever Graph returns;
 *   - another tenant's connection and its Page are untouched throughout.
 *
 * The real guard chain runs. Only the database, the identity provider and the
 * Graph HTTP calls are fake; nothing here contacts Facebook.
 */
import {
  seed, invoke, rows, USER_A, USER_B,
} from '../helpers/routeAuthHarness';

export {};

jest.mock('@/config', () => ({
  config: { DEV_USER_ID: '', NODE_ENV: 'production', OAUTH_STATE_HMAC_KEY: 'facebook-page-target-test-key' },
}));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: jest.fn(async () => ({ client_id: 'cid', client_secret: 'csec', source: 'test' })),
}));
jest.mock('../../auth/getBaseUrl', () => ({ getBaseUrl: () => 'http://localhost:3000' }));
jest.mock('../../auth/oauthTelemetry', () => ({ logOAuthEvent: jest.fn(), safeHost: () => 'localhost' }));
jest.mock('../../auth/oauthScopePersistence', () => ({
  normaliseScopes: () => [],
  persistGrantedScopes: jest.fn(async () => undefined),
}));
jest.mock('../../services/earnCreditsService', () => ({ checkAndGrantSetupCredits: jest.fn(async () => undefined) }));

/** Tokens are encrypted at rest; the fake makes the ciphertext readable. */
const mockSetToken = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../auth/tokenStore', () => ({
  setToken: (...a: unknown[]) => mockSetToken(...a),
  encryptTokenColumns: (t: { access_token: string }) => ({ access_token: `enc(${t.access_token})`, refresh_token: null }),
}));

/**
 * The Page RESOLVER is the real one — it is the subject here. Only the
 * Instagram/Threads derivation, a different feature, is stubbed out.
 */
jest.mock('../../services/metaDerivedAccountsService', () => {
  const actual = jest.requireActual('../../services/metaDerivedAccountsService');
  return {
    ...actual,
    syncInstagramAndThreadsFromMeta: jest.fn(async () => ({ instagramAccounts: [], threadsAccounts: [] })),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encodeOAuthState } = require('../../auth/oauthState');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require('../../../pages/api/auth/facebook/callback').default;

const UCO_A = '11111111-1111-4111-8111-11111111111a';
const UCO_B = '22222222-2222-4222-8222-22222222222b';

const FB_USER_ID = 'fb-user-7788';
const PAGE_A = { id: 'page-aaa-111', name: 'Acme Page', access_token: 'page-token-a' };
const PAGE_B = { id: 'page-bbb-222', name: 'Beta Page', access_token: 'page-token-b' };

/** Whatever `GET /me/accounts` should answer for the next callback run. */
let pagesResponse: unknown[] = [PAGE_A];
/** When set, the Pages lookup fails instead of answering. */
let pagesLookupFails = false;

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

const fetchMock = jest.fn(async (input: unknown) => {
  const url = String(input);
  if (url.includes('/me/accounts')) {
    if (pagesLookupFails) {
      return { ok: false, status: 500, json: async () => ({ error: { message: 'graph down' } }), text: async () => '' } as any;
    }
    return okJson({ data: pagesResponse }) as any;
  }
  if (url.includes('oauth/access_token')) {
    return okJson({ access_token: 'user-token', expires_in: 5184000, scope: 'pages_show_list,pages_manage_posts' }) as any;
  }
  return okJson({ id: FB_USER_ID, name: 'Facebook Person' }) as any;
});

beforeAll(() => { (global as any).fetch = fetchMock; });

const TENANTS = {
  companies: [
    { id: UCO_A, status: 'active', name: 'UUID Company A' },
    { id: UCO_B, status: 'active', name: 'UUID Company B' },
  ],
  user_company_roles: [
    { user_id: USER_A, company_id: UCO_A, role: 'COMPANY_ADMIN', status: 'active' },
    { user_id: USER_B, company_id: UCO_B, role: 'COMPANY_ADMIN', status: 'active' },
  ],
};

/** Company A already has a Facebook connection bound to its own Page. */
const COMPANY_A_CONNECTION = {
  id: 'sa-company-a',
  user_id: USER_A,
  company_id: UCO_A,
  platform: 'facebook',
  platform_user_id: FB_USER_ID,
  linked_page_id: PAGE_A.id,
  page_access_token: `enc(${PAGE_A.access_token})`,
  is_active: true,
};

beforeEach(() => {
  seed({ ...TENANTS });
  pagesResponse = [PAGE_A];
  pagesLookupFails = false;
  fetchMock.mockClear();
  mockSetToken.mockClear();
});

const connect = (as: 'A' | 'B', companyId: string, userId: string) =>
  invoke(handler, {
    method: 'GET',
    as,
    query: { code: 'auth-code', state: encodeOAuthState({ companyId, userId, returnTo: '/social-platforms' }) },
  });

const facebookRows = () => rows('social_accounts').filter((r) => r.platform === 'facebook');

/* ────────────────────────────────────────────────────────────── 1. bound ── */

describe('a manageable Page is bound to the connection', () => {
  it('CRITICAL: the Page id and the PAGE token are persisted on the connection', async () => {
    const r = await connect('A', UCO_A, USER_A);

    expect(r.redirect).toMatch(/success=true/);
    const written = facebookRows();
    expect(written).toHaveLength(1);
    expect(written[0].linked_page_id).toBe(PAGE_A.id);
    expect(written[0].page_access_token).toBe(`enc(${PAGE_A.access_token})`);
    expect(written[0].is_active).toBe(true);
  });

  it('CRITICAL: the bound row belongs to the session user and the asserted company', async () => {
    await connect('A', UCO_A, USER_A);

    const row = facebookRows()[0];
    expect(row.user_id).toBe(USER_A);
    expect(row.company_id).toBe(UCO_A);
  });

  it('CRITICAL: the stored credential is the PAGE token, not the user token', async () => {
    await connect('A', UCO_A, USER_A);

    const row = facebookRows()[0];
    expect(row.access_token).toBe(`enc(${PAGE_A.access_token})`);
    expect(row.access_token).not.toBe('enc(user-token)');
    expect((mockSetToken.mock.calls[0] as unknown[])[1]).toMatchObject({ access_token: PAGE_A.access_token });
  });

  it('the identity column still holds the FACEBOOK USER, never the Page', async () => {
    await connect('A', UCO_A, USER_A);

    const row = facebookRows()[0];
    expect(row.platform_user_id).toBe(FB_USER_ID);
    expect(row.platform_user_id).not.toBe(PAGE_A.id);
    expect(row.linked_page_id).not.toBe(row.platform_user_id);
  });

  it('the redirect names the Page that was bound', async () => {
    const r = await connect('A', UCO_A, USER_A);
    expect(r.redirect).toContain(`pageTarget=${encodeURIComponent(PAGE_A.id)}`);
  });

  it('the Pages are read from the endpoint and field set the repo already uses', async () => {
    await connect('A', UCO_A, USER_A);

    const call = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/me/accounts'));
    expect(call).toContain('https://graph.facebook.com/v22.0/me/accounts?');
    expect(call).toContain('fields=id%2Cname%2Caccess_token');
  });
});

/* ──────────────────────────────────────────────────── 2. nothing guessed ── */

describe('no Page is ever guessed', () => {
  it('CRITICAL: no manageable Page → nothing bound, connection not publishable, reason recorded', async () => {
    pagesResponse = [];

    const r = await connect('A', UCO_A, USER_A);

    const row = facebookRows()[0];
    expect(row.linked_page_id).toBeUndefined();
    expect(row.page_access_token).toBeUndefined();
    expect(row.is_active).toBe(false);
    expect(String(row.last_provider_error)).toMatch(/does not administer any Facebook Page/);
    expect(r.redirect).toContain('pageTarget=none');
  });

  it('CRITICAL: several manageable Pages → NOTHING is auto-picked', async () => {
    pagesResponse = [PAGE_A, PAGE_B];

    await connect('A', UCO_A, USER_A);

    const row = facebookRows()[0];
    expect(row.linked_page_id).toBeUndefined();
    expect(row.is_active).toBe(false);
    expect(String(row.last_provider_error)).toMatch(/NOT chosen automatically/);
    // Neither candidate's credential leaked into the connection.
    expect(JSON.stringify(row)).not.toContain(PAGE_A.access_token);
    expect(JSON.stringify(row)).not.toContain(PAGE_B.access_token);
  });

  it('a Page that grants no Page token is not a target', async () => {
    pagesResponse = [{ id: PAGE_A.id, name: PAGE_A.name }];

    await connect('A', UCO_A, USER_A);

    const row = facebookRows()[0];
    expect(row.linked_page_id).toBeUndefined();
    expect(row.is_active).toBe(false);
  });

  it('a Pages lookup that fails is explicit, and never loses the connection', async () => {
    pagesLookupFails = true;

    const r = await connect('A', UCO_A, USER_A);

    expect(r.redirect).toMatch(/success=true/);
    const row = facebookRows()[0];
    expect(row.linked_page_id).toBeUndefined();
    expect(row.is_active).toBe(false);
    expect(String(row.last_provider_error)).toMatch(/did not return the list of Pages/);
  });
});

/* ───────────────────────────────────────── 3. identity is not a Page id ── */

describe('a user id can never become a Page id', () => {
  it('CRITICAL (negative): a "Page" whose id IS the Facebook user is discarded', async () => {
    // Graph returning the user node in a Pages list must not make the user node
    // a publishable destination.
    pagesResponse = [{ id: FB_USER_ID, name: 'Facebook Person', access_token: 'user-token' }];

    await connect('A', UCO_A, USER_A);

    const row = facebookRows()[0];
    expect(row.linked_page_id).toBeUndefined();
    expect(row.is_active).toBe(false);
    expect(String(row.last_provider_error)).toMatch(/does not administer any Facebook Page/);
  });

  it('CRITICAL (negative): the user node is discarded even when a real Page is present', async () => {
    pagesResponse = [{ id: FB_USER_ID, name: 'Facebook Person', access_token: 'user-token' }, PAGE_A];

    await connect('A', UCO_A, USER_A);

    const row = facebookRows()[0];
    // Exactly one real candidate remains, so it binds — and it is the Page.
    expect(row.linked_page_id).toBe(PAGE_A.id);
    expect(row.linked_page_id).not.toBe(FB_USER_ID);
  });
});

/* ─────────────────────────────────────────────── 4. tenant isolation ───── */

describe("another tenant's Page is unreachable", () => {
  beforeEach(() => {
    seed({ ...TENANTS, social_accounts: [{ ...COMPANY_A_CONNECTION }] });
    pagesResponse = [PAGE_B];
    pagesLookupFails = false;
    fetchMock.mockClear();
    mockSetToken.mockClear();
  });

  it('CRITICAL (negative): company B binds only the Page ITS OWN login returns', async () => {
    await connect('B', UCO_B, USER_B);

    const bRow = facebookRows().find((r) => r.company_id === UCO_B);
    expect(bRow).toBeDefined();
    expect(bRow?.user_id).toBe(USER_B);
    expect(bRow?.linked_page_id).toBe(PAGE_B.id);
    // Company A's Page never becomes reachable from company B, even though it
    // exists in the same table under the same Facebook user id.
    expect(bRow?.linked_page_id).not.toBe(PAGE_A.id);
    expect(JSON.stringify(bRow)).not.toContain(PAGE_A.access_token);
  });

  it("CRITICAL (negative): company A's existing binding is not touched by company B connecting", async () => {
    await connect('B', UCO_B, USER_B);

    const aRow = rows('social_accounts').find((r) => r.id === 'sa-company-a');
    expect(aRow?.linked_page_id).toBe(PAGE_A.id);
    expect(aRow?.page_access_token).toBe(`enc(${PAGE_A.access_token})`);
    expect(aRow?.is_active).toBe(true);
  });
});
