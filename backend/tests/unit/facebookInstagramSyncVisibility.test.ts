/**
 * Phase 111 (Half B) — a Facebook connect that derives NO Instagram account says so.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Facebook consent scope list is Page-only ON PURPOSE: Meta rejects the whole
 * dialog with "Invalid Scopes" when Instagram products are not fully provisioned.
 * A token without `instagram_basic` therefore can NEVER derive an Instagram
 * account, so `syncInstagramAndThreadsFromMeta` returning zero of them is the
 * normal outcome.
 *
 * It used to be logged as nothing at all. That made "the sync ran and correctly
 * found none" byte-identical, from the outside, to "the sync never ran" — the
 * exact ambiguity that makes a healthy Facebook connect look like a broken
 * Instagram one, which is how this surfaced.
 *
 * The three states must stay distinguishable:
 *   derived some  -> the pre-existing success log
 *   derived none  -> the new explanatory log   (this change)
 *   sync threw    -> the pre-existing warn
 */

export {};

const logs: string[] = [];
const warns: string[] = [];

let syncImpl: () => Promise<unknown> = async () => ({ instagramAccounts: [], threadsAccounts: [] });

jest.mock('@/config', () => ({ config: {} }));
jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}), { virtual: true });

const chain: any = new Proxy({}, {
  get: (_t, prop) => {
    if (prop === 'then') return undefined;
    if (prop === 'maybeSingle' || prop === 'single') {
      return async () => ({ data: { id: 'acct-1' }, error: null });
    }
    return () => chain;
  },
});
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => chain } }));

jest.mock('../../auth/tokenStore', () => ({
  setToken: jest.fn(async () => undefined),
  encryptTokenColumns: (t: unknown) => t,
}));
jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: async () => ({ client_id: 'id', client_secret: 'sec' }),
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: 'user-1' } }),
}));
jest.mock('../../auth/getBaseUrl', () => ({ getBaseUrl: () => 'https://www.omnivyra.com' }));
jest.mock('../../auth/oauthState', () => ({
  decodeOAuthState: () => ({ companyId: 'co-1', userId: 'user-1', returnTo: '', valid: true }),
}));
jest.mock('../../services/earnCreditsService', () => ({
  checkAndGrantSetupCredits: jest.fn(async () => undefined),
}));
jest.mock('../../auth/oauthScopePersistence', () => ({
  persistGrantedScopes: jest.fn(async () => undefined),
  normaliseScopes: (s: unknown) => s,
}));
jest.mock('../../auth/oauthTelemetry', () => ({
  logOAuthEvent: jest.fn(),
  safeHost: () => 'www.omnivyra.com',
}));
jest.mock('../../services/metaDerivedAccountsService', () => ({
  syncInstagramAndThreadsFromMeta: (...a: unknown[]) => syncImpl(),
}));

/** The three Graph calls the handler makes before reaching the sync block. */
const okJson = (body: unknown) => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
beforeAll(() => {
  (global as any).fetch = jest.fn(async (url: string) => {
    if (String(url).includes('oauth/access_token') && !String(url).includes('fb_exchange_token')) {
      return okJson({ access_token: 'short', scope: 'pages_show_list,public_profile' });
    }
    if (String(url).includes('fb_exchange_token') || String(url).includes('oauth/access_token')) {
      return okJson({ access_token: 'long', expires_in: 5184000, scope: 'pages_show_list,public_profile' });
    }
    return okJson({ id: 'fb-1', name: 'Kuldeep Rawat' });
  });
});

let handler: any;
beforeAll(async () => {
  handler = (await import('../../../pages/api/auth/facebook/callback')).default;
});

const run = async () => {
  const req: any = { method: 'GET', query: { code: 'c', state: 's' }, headers: { host: 'www.omnivyra.com' }, cookies: {} };
  const res: any = {
    statusCode: 200,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
    redirect(u: string) { this.redirectedTo = u; return this; },
    setHeader() { return this; },
  };
  await handler(req, res);
  return res;
};

beforeEach(() => {
  logs.length = 0; warns.length = 0;
  syncImpl = async () => ({ instagramAccounts: [], threadsAccounts: [] });
  jest.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  jest.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warns.push(a.map(String).join(' ')); });
});
afterEach(() => { jest.restoreAllMocks(); });

/** The new explanatory line, identified by its stable substring. */
const NONE_LOG = 'no Instagram business account derived';
const derivedNoneLogged = () => logs.filter((l) => l.includes(NONE_LOG));

describe('A — deriving no Instagram account is stated, not silent', () => {
  it('CRITICAL: zero derived accounts emits the explanatory log', async () => {
    await run();
    expect(derivedNoneLogged()).toHaveLength(1);
  });

  it('CRITICAL: the log names where Instagram actually comes from', async () => {
    // Without the route, the message tells an operator nothing actionable.
    await run();
    expect(derivedNoneLogged()[0]).toContain('/api/auth/instagram');
  });

  it('the log is emitted exactly once — no duplicate for a single connect', async () => {
    await run();
    expect(derivedNoneLogged()).toHaveLength(1);
  });
});

describe('B — the other two outcomes stay distinguishable', () => {
  it('CRITICAL: when accounts ARE derived, the none-log is NOT emitted', async () => {
    syncImpl = async () => ({
      instagramAccounts: [{ id: 'ig-1', username: 'omnivyra' }],
      threadsAccounts: [],
    });
    await run();
    expect(derivedNoneLogged()).toHaveLength(0);
    expect(logs.some((l) => l.includes('derived accounts synced'))).toBe(true);
  });

  it('CRITICAL: a sync FAILURE is a warn, and never the none-log', async () => {
    // "Threw" must not be reported as "correctly found none" — that would
    // reintroduce the ambiguity in the opposite direction.
    syncImpl = async () => { throw new Error('Meta 500'); };
    await run();
    expect(derivedNoneLogged()).toHaveLength(0);
    expect(warns.some((w) => w.includes('derivation skipped'))).toBe(true);
  });
});

describe('C — the log carries no sensitive material', () => {
  it('CRITICAL: no token, secret, or credential appears in the new log', async () => {
    await run();
    const line = derivedNoneLogged()[0] ?? '';
    for (const secret of ['short', 'long', 'sec', 'client_secret', 'access_token', 'Bearer']) {
      expect(line).not.toContain(secret);
    }
  });

  it('the new log carries no tenant or user identifiers', async () => {
    await run();
    const line = derivedNoneLogged()[0] ?? '';
    for (const id of ['co-1', 'user-1', 'fb-1', 'acct-1']) {
      expect(line).not.toContain(id);
    }
  });
});
