/**
 * SOCIAL-ACCOUNTS-SEC-001 — GET /api/social-accounts/verify-config.
 *
 * This route is unusual among the AUTH-CTX-001 blast-radius set: its ONLY input
 * is `platform`. There is no caller-supplied account id, user_id or company_id,
 * so the bug classes that produced findings in EXTERNAL-API-SEC-001,
 * ACTIVITY-SEC-001 and EXTERNAL-API-REQUEST-SEC-001 have no entry point. The
 * account is selected strictly within the caller's own `companyIds`, which are
 * server-derived.
 *
 * What WAS wrong: the route required no principal at all. An anonymous GET
 * reached `getOAuthCredentialsForPlatform` and returned 200 with
 * `credentials_ok` and `credentials_source` — disclosing which platforms have
 * OAuth credentials configured and where they come from. Verified live against
 * production before the fix.
 *
 * The route's reach is exactly `userContext.companyIds`. That makes
 * AUTH-CTX-001 load-bearing here: before it, an unauthenticated request was
 * answered with a SYNTHETIC identity holding a REAL company, and this route
 * would have selected that tenant's account, read its token and live-tested it
 * against the provider. Ownership of that guarantee sits in
 * userContextService (authContextIdentity.test.ts); what is pinned below is
 * the consequence — an identity carrying no company reaches no account, no
 * token and no provider call, and a context flagged unauthenticated is refused
 * whatever companies it claims.
 */

type Row = Record<string, unknown>;

const MEMBER_A = 'user-member-a';
const MEMBER_B = 'user-member-b';
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

/**
 * One connected LinkedIn account per company. B is the MORE RECENTLY updated
 * row deliberately: the route orders by updated_at desc and takes one, so if
 * the tenant predicate were ever widened, B — not A — is what a Company A
 * caller would get back. That makes the cross-tenant assertions bite instead
 * of passing on row order.
 */
const ACCOUNTS = [
  { id: 'acct-a', company_id: COMPANY_A, platform: 'linkedin', account_name: 'Company A Page', username: 'a', is_active: true, platform_user_id: 'li-a', updated_at: '2026-01-01T00:00:00Z' },
  { id: 'acct-b', company_id: COMPANY_B, platform: 'linkedin', account_name: 'Company B Page', username: 'b', is_active: true, platform_user_id: 'li-b', updated_at: '2026-08-01T00:00:00Z' },
];
const MEMBERSHIP: Record<string, string[]> = {
  [MEMBER_A]: [COMPANY_A],
  [MEMBER_B]: [COMPANY_B],
};

/** null = unauthenticated; 'forged' = flagged unauthenticated yet claiming a company. */
let principal: string | null | 'forged' = MEMBER_A;

/** Sensitive sinks — asserted directly, never inferred from status codes. */
const credentialReads: string[] = [];
const tokenReads: string[] = [];
const providerCalls: string[] = [];
const accountQueries: Array<{ companyIds: unknown }> = [];

jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(async () => {
    if (principal === null) {
      return { userId: '', role: 'user', companyIds: [], defaultCompanyId: '', authenticated: false, authError: 'MISSING_AUTH' };
    }
    if (principal === 'forged') {
      // A failed resolve that nonetheless carries a real company and an admin
      // role — the shape resolveFromLib() produced before AUTH-CTX-001.
      return { userId: 'dev-user', role: 'admin', companyIds: [COMPANY_B], defaultCompanyId: COMPANY_B, authenticated: false, authError: 'INVALID_AUTH' };
    }
    return {
      userId: principal, role: 'user',
      companyIds: MEMBERSHIP[principal] ?? [],
      defaultCompanyId: (MEMBERSHIP[principal] ?? [])[0] ?? '',
      authenticated: true, authError: null,
    };
  }),
}));

jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: jest.fn(async (p: string) => {
    credentialReads.push(p);
    return { client_id: 'id', client_secret: 'secret', source: 'platform_config' };
  }),
}));

jest.mock('../../auth/tokenStore', () => ({
  getToken: jest.fn(async (accountId: string) => {
    tokenReads.push(accountId);
    return { access_token: `token-for-${accountId}`, refresh_token: null, expires_at: null };
  }),
}));

jest.mock('../../auth/tokenRefresh', () => ({ refreshTwitterTokenIfNeeded: jest.fn(async () => ({ status: 'ok', access_token: null })) }));
jest.mock('../../services/platformAdapters', () => ({ getPlatformAdapter: jest.fn(() => null) }));
jest.mock('../../../lib/httpAuthHeaders', () => ({ bearerAuthorization: (t: string) => `Bearer ${t}` }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const f: Record<string, unknown> = {};
      const b: any = {};
      b.select = () => b;
      b.in = (c: string, v: unknown[]) => { f[c] = v; return b; };
      b.eq = (c: string, v: unknown) => { f[c] = v; return b; };
      b.not = () => b;
      b.order = () => b;
      b.limit = () => b;
      const resolve = () => {
        if (table !== 'social_accounts') return { data: null, error: null };
        if (f.company_id) {
          accountQueries.push({ companyIds: f.company_id });
          const ids = f.company_id as string[];
          const platforms = (f.platform as string[]) ?? [];
          // Mirrors .order('updated_at', { ascending: false }).limit(1).
          const row = ACCOUNTS
            .filter(a => ids.includes(a.company_id) && platforms.includes(a.platform) && a.is_active)
            .sort((x, y) => y.updated_at.localeCompare(x.updated_at))[0];
          return { data: row ?? null, error: null };
        }
        return { data: null, error: null };
      };
      b.maybeSingle = () => Promise.resolve(resolve());
      b.single = () => Promise.resolve(resolve());
      b.then = (r: any) => Promise.resolve(resolve()).then(r);
      return b;
    },
  },
}));

// Any outbound provider call is recorded and never actually made.
const realFetch = global.fetch;
beforeAll(() => {
  (global as any).fetch = jest.fn(async (u: string) => {
    providerCalls.push(String(u));
    return { ok: true, status: 200, json: async () => ({ name: 'Leaked Account' }) } as never;
  });
});
afterAll(() => { (global as any).fetch = realFetch; });

import handler from '../../../pages/api/social-accounts/verify-config';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
async function verify(as: string | null | 'forged', platform = 'linkedin', method = 'GET') {
  principal = as;
  const res = mockRes();
  await handler({ method, url: '/api/social-accounts/verify-config', query: { platform }, body: {} } as never, res);
  return res;
}
const noSensitiveAccess = () => {
  expect(credentialReads).toEqual([]);
  expect(tokenReads).toEqual([]);
  expect(providerCalls).toEqual([]);
  expect(accountQueries).toEqual([]);
};

beforeEach(() => {
  principal = MEMBER_A;
  credentialReads.length = 0; tokenReads.length = 0;
  providerCalls.length = 0; accountQueries.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/* ── A — unauthenticated ──────────────────────────────────────────────── */

describe('A — unauthenticated', () => {
  it('CRITICAL: 401, and no credential, token, account or provider access', async () => {
    const res = await verify(null);
    expect(res.statusCode).toBe(401);
    expect(res.body?.code).toBe('UNAUTHENTICATED');
    noSensitiveAccess();
  });

  it('discloses no configuration posture', async () => {
    const res = await verify(null);
    expect(res.body?.credentials_ok).toBeUndefined();
    expect(res.body?.credentials_source).toBeUndefined();
    expect(res.body?.account_name).toBeUndefined();
  });
});

/* ── The pre-AUTH-CTX-001 fabricated identity ─────────────────────────── */

describe('a context flagged unauthenticated is refused whatever it claims', () => {
  it('CRITICAL: companies carried by a failed resolve grant nothing', async () => {
    // The gate keys on the AUTHENTICATION verdict, not on whether the context
    // happens to carry companies. So the pre-AUTH-CTX-001 shape — admin role,
    // a real company, no valid session — is refused before the account lookup
    // rather than being allowed to reach Company B.
    const res = await verify('forged');
    expect(res.statusCode).toBe(401);
    expect(res.body?.code).toBe('UNAUTHENTICATED');
    noSensitiveAccess();
    expect(res.body?.account_name).toBeUndefined();
  });

  it('the reach of an ALLOWED caller is exactly the resolver’s companyIds', async () => {
    // Pins why AUTH-CTX-001 is load-bearing for this route: nothing downstream
    // re-derives the tenant. Whatever companyIds the resolver returns is what
    // gets read. userContextService owns the guarantee that an unauthenticated
    // caller carries none (authContextIdentity.test.ts).
    await verify(MEMBER_B);
    expect(accountQueries).toEqual([{ companyIds: [COMPANY_B] }]);
  });
});

/* ── B / C — legitimate members ───────────────────────────────────────── */

describe('B/C — an authenticated member', () => {
  it('verifies their OWN company’s account', async () => {
    const res = await verify(MEMBER_A);
    expect(res.statusCode).toBe(200);
    expect(res.body?.account_name).toBe('Company A Page');
    expect(tokenReads).toEqual(['acct-a']);
  });

  it('a member of the other company sees only their own', async () => {
    const res = await verify(MEMBER_B);
    expect(res.statusCode).toBe(200);
    expect(res.body?.account_name).toBe('Company B Page');
    expect(tokenReads).toEqual(['acct-b']);
  });

  it('the account query is scoped to the caller’s server-derived companies', async () => {
    await verify(MEMBER_A);
    expect(accountQueries).toHaveLength(1);
    expect(accountQueries[0].companyIds).toEqual([COMPANY_A]);
  });
});

/* ── D / E — cross-tenant reach ───────────────────────────────────────── */

describe('D/E — no cross-tenant reach exists', () => {
  it('A never sees B’s account name, token or provider call', async () => {
    const res = await verify(MEMBER_A);
    expect(res.body?.account_name).not.toBe('Company B Page');
    expect(tokenReads).not.toContain('acct-b');
    expect(providerCalls.join(' ')).not.toContain('acct-b');
  });

  it('a caller with no company memberships reaches no account or token', async () => {
    MEMBERSHIP['user-no-company'] = [];
    const res = await verify('user-no-company');
    expect(res.statusCode).toBe(200);
    expect(res.body?.account_name).toBeNull();
    expect(tokenReads).toEqual([]);
    expect(providerCalls).toEqual([]);
  });
});

/* ── F / G — spoofing surface ─────────────────────────────────────────── */

describe('F/G — there is no identity input to spoof', () => {
  it('user_id and company_id in the query are ignored entirely', async () => {
    principal = MEMBER_A;
    const res = mockRes();
    await handler({
      method: 'GET', url: '/x',
      query: { platform: 'linkedin', user_id: MEMBER_B, company_id: COMPANY_B, companyId: COMPANY_B, accountId: 'acct-b' },
      body: {},
    } as never, res);

    expect(res.body?.account_name).toBe('Company A Page');
    expect(accountQueries[0].companyIds).toEqual([COMPANY_A]);
    expect(tokenReads).toEqual(['acct-a']);
  });

  it('the route accepts no scope flag that widens selection', async () => {
    principal = MEMBER_A;
    const res = mockRes();
    await handler({ method: 'GET', url: '/x', query: { platform: 'linkedin', scope: 'platform' }, body: {} } as never, res);
    expect(accountQueries[0].companyIds).toEqual([COMPANY_A]);
  });
});

/* ── I — input and method handling ────────────────────────────────────── */

describe('I — input handling', () => {
  it('a non-GET verb is 405 before any identity or credential work', async () => {
    const res = await verify(MEMBER_A, 'linkedin', 'POST');
    expect(res.statusCode).toBe(405);
    noSensitiveAccess();
  });

  it('a missing platform is 400 before any credential read', async () => {
    principal = MEMBER_A;
    const res = mockRes();
    await handler({ method: 'GET', url: '/x', query: {}, body: {} } as never, res);
    expect(res.statusCode).toBe(400);
    noSensitiveAccess();
  });

  it('an unknown platform reaches no account and makes no provider call', async () => {
    const res = await verify(MEMBER_A, 'myspace');
    expect(res.statusCode).toBe(200);
    expect(res.body?.account_name).toBeNull();
    expect(tokenReads).toEqual([]);
    expect(providerCalls).toEqual([]);
  });
});
