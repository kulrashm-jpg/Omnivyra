/**
 * Phase 109 — a terminal refresh state actually STOPS the retry loop.
 *
 * WHY PHASE 108 WAS NOT ENOUGH
 * ----------------------------
 * Phase 108 parked accounts whose refresh returned `requires_reconnect`. That
 * status is only returned when NO refresh token exists in the DB. A provider
 * that REJECTS a stored refresh token returns `refresh_failed`, which Phase 108
 * deliberately does not park — one failed attempt is not proof.
 *
 * So @omnivyra kept looping. Verified live AFTER Phase 108 deployed:
 *
 *     retry=4104 (was 4097)   last_attempt 2 minutes ago
 *     connection_state PROVIDER_REAUTH_REQUIRED
 *     is_active TRUE
 *
 * Bounded retry was working — at retry >= RETRY_CEILING (4) it sets
 * PROVIDER_REAUTH_REQUIRED. But that set a LABEL, not a STOP: the resolver
 * selects on `is_active`, so a terminal account was re-selected every ten
 * minutes forever. X's error ("invalid_request: Value passed for the token was
 * invalid") matches neither invalid_grant nor invalid_client, so it took the
 * transient branch on all 4,104 attempts.
 *
 * These tests drive the real public entry point with a rejecting provider, and
 * assert on the row actually written.
 */

export {};

const updates: Array<Record<string, unknown>> = [];
let priorRetryCount = 0;
let postImpl: () => Promise<unknown> = async () => ({ data: {} });

jest.mock('@/config', () => ({ config: { X_CLIENT_ID: 'id', X_CLIENT_SECRET: 'sec' } }));
jest.mock('axios', () => ({ __esModule: true, default: { post: (...a: any[]) => postImpl(), get: jest.fn() }, post: (...a: any[]) => postImpl(), get: jest.fn() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));
jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: async () => ({ client_id: 'id', client_secret: 'sec' }),
}));
jest.mock('../../auth/tokenStore', () => ({ getToken: jest.fn(), setToken: jest.fn() }));
jest.mock('../../auth/refreshLock', () => ({ withRefreshLock: async (_k: string, fn: any) => fn() }));
jest.mock('../../auth/refreshAccountResolver', () => ({ buildXRefreshLockKey: () => 'k' }));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { refresh_retry_count: priorRetryCount } }) }) }),
    update: (payload: Record<string, unknown>) => ({
      eq: () => { updates.push(payload); return Promise.resolve({ error: null }); },
    }),
  }),
}));

let refreshTwitterTokenIfNeeded:
  typeof import('../../auth/tokenRefreshCore').refreshTwitterTokenIfNeeded;

beforeAll(async () => {
  ({ refreshTwitterTokenIfNeeded } = await import('../../auth/tokenRefreshCore'));
});

beforeEach(() => {
  updates.length = 0;
  priorRetryCount = 0;
});

/** An expired X account that DOES hold a refresh token — the production shape. */
const expiredWithRefresh = {
  account_id: 'acct-x',
  access_token: 'a',
  refresh_token: 'r',
  token_expires_at: '2020-01-01T00:00:00.000Z',
};

const rejectWith = (msg: string) => {
  postImpl = async () => { throw { response: { data: { error: msg.split(':')[0], error_description: msg } }, message: msg }; };
};

const lastPatch = () => updates[updates.length - 1];

describe('A — terminal states park the account', () => {
  it('CRITICAL: retries exhausted parks the account (the 4104 case)', async () => {
    priorRetryCount = 10;                       // far past RETRY_CEILING (4)
    rejectWith('invalid_request: Value passed for the token was invalid.');

    const r = await refreshTwitterTokenIfNeeded(expiredWithRefresh);

    expect(r.status).toBe('refresh_failed');    // provider rejection, as in production
    expect(lastPatch().connection_state).toBe('PROVIDER_REAUTH_REQUIRED');
    // The half that was missing: terminal must STOP, not merely label.
    expect(lastPatch().is_active).toBe(false);
  });

  it('CRITICAL: an explicit invalid_grant parks immediately, without waiting for the ceiling', async () => {
    priorRetryCount = 0;
    rejectWith('invalid_grant: token revoked');

    await refreshTwitterTokenIfNeeded(expiredWithRefresh);

    expect(lastPatch().connection_state).toBe('PROVIDER_REAUTH_REQUIRED');
    expect(lastPatch().is_active).toBe(false);
  });
});

describe('B — non-terminal states never park', () => {
  it('CRITICAL: a first transient failure does NOT park', async () => {
    priorRetryCount = 0;
    rejectWith('ETIMEDOUT upstream');

    await refreshTwitterTokenIfNeeded(expiredWithRefresh);

    expect(lastPatch().connection_state).toBe('TOKEN_EXPIRED');
    expect(lastPatch().is_active).toBeUndefined();   // untouched — stays active
  });

  it('CRITICAL: invalid_client is an operator problem, not a dead user credential', async () => {
    // Wrong APP credentials must never disconnect every user's account.
    priorRetryCount = 0;
    rejectWith('invalid_client: bad app secret');

    await refreshTwitterTokenIfNeeded(expiredWithRefresh);

    expect(lastPatch().refresh_status).toBe('REFRESH_FAILED_FATAL');
    expect(lastPatch().is_active).toBeUndefined();
  });

  it('CRITICAL: a successful refresh never parks', async () => {
    postImpl = async () => ({ data: { access_token: 'new', refresh_token: 'r2', expires_in: 7200 } });

    const r = await refreshTwitterTokenIfNeeded(expiredWithRefresh);

    expect(r.status).toBe('refreshed');
    const parked = updates.some((u) => u.is_active === false);
    expect(parked).toBe(false);
  });
});
