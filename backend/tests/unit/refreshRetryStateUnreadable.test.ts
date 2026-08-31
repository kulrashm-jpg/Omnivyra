/**
 * A DATABASE FAILURE READING THE RETRY COUNTER IS NOT "prior = 0".
 *
 * WHAT WAS WRONG
 * --------------
 * The transient branch of the refresh recorder read the durable counter and
 * discarded the error:
 *
 *     const { data: cur } = await ownedDbTable('social_accounts')
 *       .select('refresh_retry_count').eq('id', accountId).maybeSingle();
 *     const prior = Number((cur as any)?.refresh_retry_count ?? 0);
 *
 * PostgREST reports failures in `error`, not by throwing, so a failed read
 * arrives as `data: null` — identical to a row that has never failed. `prior`
 * collapsed to 0, `nextRetryCount` became 1, and 1 is never >= RETRY_CEILING.
 * A persistently failing read therefore meant the account could never
 * quarantine and would retry forever — precisely the loop Phase 109 shipped to
 * stop after production found @omnivyra at refresh_retry_count 4111 against a
 * ceiling of 4. Worse, the fabricated 1 was WRITTEN, erasing the real history
 * that both the ceiling and deriveConnectionState's consecutiveRefreshFailures
 * depend on.
 *
 * These tests drive the real exported refresh entry point with a rejecting
 * provider and assert on the row actually written.
 */

export {};

const updates: Array<Record<string, unknown>> = [];
let postImpl: () => Promise<unknown> = async () => ({ data: {} });

/** What the retry-count read returns — swapped per test. */
let retryReadImpl: () => Promise<{ data?: unknown; error?: unknown }> = async () => ({
  data: { refresh_retry_count: 0 },
  error: null,
});

jest.mock('@/config', () => ({ config: { X_CLIENT_ID: 'id', X_CLIENT_SECRET: 'sec' } }));
jest.mock('axios', () => ({ __esModule: true, default: { post: () => postImpl(), get: jest.fn() }, post: () => postImpl(), get: jest.fn() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));
jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: async () => ({ client_id: 'id', client_secret: 'sec' }),
}));
jest.mock('../../auth/tokenStore', () => ({ getToken: jest.fn(), setToken: jest.fn() }));
jest.mock('../../auth/refreshLock', () => ({ withRefreshLock: async (_k: string, fn: any) => fn() }));
jest.mock('../../auth/refreshAccountResolver', () => ({ buildXRefreshLockKey: () => 'k' }));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    select: () => ({ eq: () => ({ maybeSingle: () => retryReadImpl() }) }),
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
  retryReadImpl = async () => ({ data: { refresh_retry_count: 0 }, error: null });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

/**
 * The recorder keeps a per-account fallback streak for unreadable reads, so
 * every test uses its OWN account id — no test can inherit another's streak.
 */
const expiredWithRefresh = (accountId: string) => ({
  account_id: accountId,
  access_token: 'a',
  refresh_token: 'r',
  token_expires_at: '2020-01-01T00:00:00.000Z',
});

/** A transient provider failure: matches neither invalid_grant nor invalid_client. */
const rejectTransiently = () => {
  postImpl = async () => {
    throw { response: { data: { error: 'ETIMEDOUT', error_description: 'socket hang up' } }, message: 'ETIMEDOUT' };
  };
};

const readSucceedsWith = (prior: number | null) => {
  retryReadImpl = async () => ({
    data: prior === null ? null : { refresh_retry_count: prior },
    error: null,
  });
};

/** PostgREST style: no throw, the failure is in `error`. */
const readFailsWithError = () => {
  retryReadImpl = async () => ({ data: null, error: { message: 'connection reset by peer' } });
};

const readThrows = () => {
  retryReadImpl = async () => { throw new Error('socket closed mid-query'); };
};

const lastPatch = () => updates[updates.length - 1] ?? {};

describe('1 — the normal path is unchanged', () => {
  it('increments the prior count read from the row', async () => {
    readSucceedsWith(1);
    rejectTransiently();

    await refreshTwitterTokenIfNeeded(expiredWithRefresh('acct-normal'));

    expect(lastPatch().refresh_retry_count).toBe(2);
    expect(lastPatch().refresh_status).toBe('REFRESH_FAILED_RETRYABLE');
    expect(lastPatch().connection_state).toBe('TOKEN_EXPIRED');
    expect(lastPatch().is_active).toBeUndefined();
  });

  it('a row that has genuinely never failed still counts as prior 0', async () => {
    // success + no row is the third state: prior 0 is CORRECT here.
    readSucceedsWith(null);
    rejectTransiently();

    await refreshTwitterTokenIfNeeded(expiredWithRefresh('acct-new'));

    expect(lastPatch().refresh_retry_count).toBe(1);
    expect(lastPatch().refresh_status).toBe('REFRESH_FAILED_RETRYABLE');
  });
});

describe('2 — a DB failure is distinguishable from a genuine prior of 0', () => {
  it('CRITICAL: an unreadable counter writes NO count, where a real 0 writes 1', async () => {
    readSucceedsWith(null);
    rejectTransiently();
    await refreshTwitterTokenIfNeeded(expiredWithRefresh('acct-real-zero'));
    const genuineZero = lastPatch();

    updates.length = 0;
    readFailsWithError();
    await refreshTwitterTokenIfNeeded(expiredWithRefresh('acct-db-error'));
    const dbError = lastPatch();

    expect(genuineZero.refresh_retry_count).toBe(1);
    // The two outcomes must not be the same row.
    expect('refresh_retry_count' in dbError).toBe(false);
    expect(dbError.refresh_retry_count).not.toBe(genuineZero.refresh_retry_count);
    // The failure is still recorded — only the fabricated number is withheld.
    expect(dbError.last_refresh_attempt_at).toBeTruthy();
    expect(dbError.refresh_status).toBe('REFRESH_FAILED_RETRYABLE');
  });

  it('a read that THROWS is treated the same as one that reports an error', async () => {
    readThrows();
    rejectTransiently();

    await refreshTwitterTokenIfNeeded(expiredWithRefresh('acct-throws'));

    expect('refresh_retry_count' in lastPatch()).toBe(false);
    expect(lastPatch().refresh_status).toBe('REFRESH_FAILED_RETRYABLE');
  });

  it('the unreadable read is surfaced, not swallowed', async () => {
    readFailsWithError();
    rejectTransiently();

    await refreshTwitterTokenIfNeeded(expiredWithRefresh('acct-logged'));

    const logged = (console.error as jest.Mock).mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('retry state unreadable');
    expect(logged).toContain('connection reset by peer');
  });
});

describe('3 — a DB failure cannot reset retry history', () => {
  it('CRITICAL: a 4111-deep history is never overwritten with 1', async () => {
    // The production row. The read fails; the stored count must survive.
    readFailsWithError();
    rejectTransiently();

    await refreshTwitterTokenIfNeeded(expiredWithRefresh('acct-4111'));

    expect(lastPatch().refresh_retry_count).toBeUndefined();
    expect(lastPatch().refresh_retry_count).not.toBe(1);
    expect(Object.keys(lastPatch())).not.toContain('refresh_retry_count');
  });

  it('CRITICAL: the ceiling still binds while the counter stays unreadable', async () => {
    // Otherwise a permanently failing read buys unlimited retries — the exact
    // hole the fabricated `prior = 0` opened.
    readFailsWithError();
    rejectTransiently();
    const account = expiredWithRefresh('acct-persistently-unreadable');

    await refreshTwitterTokenIfNeeded(account);
    expect(lastPatch().connection_state).toBe('TOKEN_EXPIRED');   // 1
    await refreshTwitterTokenIfNeeded(account);
    expect(lastPatch().connection_state).toBe('TOKEN_EXPIRED');   // 2
    await refreshTwitterTokenIfNeeded(account);
    expect(lastPatch().connection_state).toBe('TOKEN_EXPIRED');   // 3
    await refreshTwitterTokenIfNeeded(account);                    // 4 == RETRY_CEILING

    expect(lastPatch().connection_state).toBe('PROVIDER_REAUTH_REQUIRED');
    expect(lastPatch().is_active).toBe(false);
    // Even when quarantining, no fabricated count is written.
    expect(lastPatch().refresh_retry_count).toBeUndefined();
  });

  it('a recovered read resumes from the TRUE stored count, not from the fallback', async () => {
    const account = expiredWithRefresh('acct-recovers');
    readFailsWithError();
    rejectTransiently();
    await refreshTwitterTokenIfNeeded(account);
    expect('refresh_retry_count' in lastPatch()).toBe(false);

    readSucceedsWith(9);   // what the row held all along
    await refreshTwitterTokenIfNeeded(account);

    expect(lastPatch().refresh_retry_count).toBe(10);
  });
});

describe('4 — Phase 109 quarantine is intact', () => {
  it('CRITICAL: reaching RETRY_CEILING parks the account', async () => {
    readSucceedsWith(3);          // ceiling is 4
    rejectTransiently();

    const r = await refreshTwitterTokenIfNeeded(expiredWithRefresh('acct-ceiling'));

    expect(r.status).toBe('refresh_failed');
    expect(lastPatch().refresh_retry_count).toBe(4);
    expect(lastPatch().refresh_status).toBe('PROVIDER_REAUTH_REQUIRED');
    expect(lastPatch().connection_state).toBe('PROVIDER_REAUTH_REQUIRED');
    expect(lastPatch().is_active).toBe(false);
  });

  it('CRITICAL: one below the ceiling does NOT park', async () => {
    readSucceedsWith(2);
    rejectTransiently();

    await refreshTwitterTokenIfNeeded(expiredWithRefresh('acct-under-ceiling'));

    expect(lastPatch().refresh_retry_count).toBe(3);
    expect(lastPatch().connection_state).toBe('TOKEN_EXPIRED');
    expect(lastPatch().is_active).toBeUndefined();
  });
});

describe('5 — existing successful behaviour is unchanged', () => {
  it('a successful refresh resets the counter to 0 and never parks', async () => {
    postImpl = async () => ({ data: { access_token: 'new', refresh_token: 'r2', expires_in: 7200 } });

    const r = await refreshTwitterTokenIfNeeded(expiredWithRefresh('acct-success'));

    expect(r.status).toBe('refreshed');
    expect(lastPatch().refresh_status).toBe('CONNECTED');
    expect(lastPatch().connection_state).toBe('CONNECTED');
    expect(lastPatch().refresh_retry_count).toBe(0);
    expect(lastPatch().last_successful_refresh_at).toBeTruthy();
    expect(updates.some((u) => u.is_active === false)).toBe(false);
  });

  it('a still-valid token is not touched at all', async () => {
    const r = await refreshTwitterTokenIfNeeded({
      account_id: 'acct-valid',
      access_token: 'a',
      refresh_token: 'r',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    expect(r.status).toBe('still_valid');
    expect(updates).toHaveLength(0);
  });

  it('a success after an unreadable streak clears the fallback', async () => {
    const account = expiredWithRefresh('acct-clears');
    readFailsWithError();
    rejectTransiently();
    await refreshTwitterTokenIfNeeded(account);
    await refreshTwitterTokenIfNeeded(account);
    await refreshTwitterTokenIfNeeded(account);

    postImpl = async () => ({ data: { access_token: 'new', refresh_token: 'r2', expires_in: 7200 } });
    await refreshTwitterTokenIfNeeded(account);
    expect(lastPatch().refresh_status).toBe('CONNECTED');

    // The streak is gone: the next unreadable failure starts from 1, not 4.
    rejectTransiently();
    await refreshTwitterTokenIfNeeded(account);
    expect(lastPatch().connection_state).toBe('TOKEN_EXPIRED');
    expect(lastPatch().is_active).toBeUndefined();
  });
});
