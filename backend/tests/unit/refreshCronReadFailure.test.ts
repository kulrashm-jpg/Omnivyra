/**
 * A database error must never be able to masquerade as "no work to do".
 *
 * WHAT THE DEFECT WAS
 * -------------------
 * refreshExpiringSocialAccountsForCompany is built on two reads, and both
 * destructured `{ data }` and discarded `error`:
 *
 *     const { data: roleRows } = await ownedDbTable('user_company_roles')...
 *     const userIds = (roleRows ?? []).map(...);
 *     if (userIds.length === 0) return summary;      // summary is all zeros
 *
 *     const { data: rows } = await ownedDbTable('social_accounts')...
 *     const accounts = rows ?? [];
 *
 * On failure PostgREST returns `data: null`, `?? []` turned that into zero rows,
 * and the function returned {checked:0, refreshed:0, skipped:0, errors:0} — the
 * exact shape of a healthy idle tick. The cron caller only logs when
 * refreshed>0 || errors>0, so an outage produced a completely silent run: no
 * token refreshed, and no trace that none had been.
 *
 * These tests pin the three states apart:
 *
 *   A. success with rows      -> the refresh work happens (unchanged)
 *   B. success with zero rows -> the zero-work summary, no error (unchanged)
 *   C. a read failed          -> an explicit throw, never a zero summary
 *
 * and pin that C takes no destructive fallback — an outage must not park an
 * account or mutate a token.
 */

export {};

const mockGetToken = jest.fn();
const mockSetToken = jest.fn();
const mockRefreshTwitterIfNeeded = jest.fn();
const mockMarkNeedsReauth = jest.fn();

type Result = { data: unknown; error?: unknown };

// Each read's result is set per-test so a failure can be injected into exactly
// one of them, proving each call site is guarded independently.
let roleResult: Result = { data: [{ user_id: 'u-1' }] };
let accountResult: Result = { data: [] };
let companyResult: Result = { data: [{ id: 'co-1' }] };

jest.mock('@/config', () => ({ config: {} }));
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));
jest.mock('../../auth/oauthCredentialResolver', () => ({
  getOAuthCredentialsForPlatform: async () => ({ client_id: 'id', client_secret: 'sec' }),
}));
jest.mock('../../auth/refreshLock', () => ({ withRefreshLock: async (_k: string, fn: any) => fn() }));
jest.mock('../../auth/refreshAccountResolver', () => ({ buildXRefreshLockKey: () => 'k' }));
jest.mock('../../auth/tokenRefreshCore', () => ({
  refreshLinkedInToken: jest.fn(),
  refreshTwitterTokenIfNeeded: (...a: any[]) => mockRefreshTwitterIfNeeded(...a),
  refreshTwitterToken: jest.fn(),
  refreshFacebookToken: jest.fn(),
  refreshInstagramToken: jest.fn(),
  refreshYouTubeToken: jest.fn(),
  recordRefreshOutcome: jest.fn(async () => undefined),
  redactCredentials: (t: string) => t,
}));
jest.mock('../../auth/tokenStore', () => ({
  getToken: (...a: any[]) => mockGetToken(...a),
  setToken: (...a: any[]) => mockSetToken(...a),
  markSocialAccountNeedsReauth: (...a: any[]) => mockMarkNeedsReauth(...a),
}));

// Mirrors the real builder shape: the terminal filter of each chain resolves to
// the PostgREST envelope, so an injected `error` reaches production code by the
// same route a live failure would.
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    if (table === 'user_company_roles') {
      return { select: () => ({ eq: () => ({ eq: () => Promise.resolve(roleResult) }) }) };
    }
    if (table === 'companies') {
      return { select: () => ({ eq: () => Promise.resolve(companyResult) }) };
    }
    const chain: any = {
      select: () => chain,
      in: () => chain,
      eq: () => chain,
      or: () => chain,
      lt: () => Promise.resolve(accountResult),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    };
    return chain;
  },
}));

let flows: typeof import('../../auth/tokenRefreshFlows');

beforeAll(async () => {
  flows = await import('../../auth/tokenRefreshFlows');
});

beforeEach(() => {
  jest.clearAllMocks();
  roleResult = { data: [{ user_id: 'u-1' }] };
  accountResult = { data: [] };
  companyResult = { data: [{ id: 'co-1' }] };
  mockGetToken.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
});

const run = () => flows.refreshExpiringSocialAccountsForCompany('co-1');

const ZERO_WORK = { checked: 0, refreshed: 0, skipped: 0, errors: 0 };

describe('A — a legitimate empty result keeps its existing behaviour', () => {
  it('a company with no active members returns the zero-work summary and does not throw', async () => {
    roleResult = { data: [] };

    await expect(run()).resolves.toEqual(ZERO_WORK);
    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
  });

  it('a company whose members have no near-expiry accounts returns the zero-work summary', async () => {
    roleResult = { data: [{ user_id: 'u-1' }] };
    accountResult = { data: [] };

    await expect(run()).resolves.toEqual(ZERO_WORK);
    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
  });

  it('an explicit error:null alongside real rows is still a success', async () => {
    // Supabase sets error:null on success; a guard that keyed on the presence of
    // the property rather than its truthiness would fail every healthy read.
    roleResult = { data: [{ user_id: 'u-1' }], error: null };
    accountResult = { data: [{ id: 'acct-x', platform: 'x' }], error: null };
    mockRefreshTwitterIfNeeded.mockResolvedValue({ status: 'still_valid' });

    const s = await run();

    expect(s).toEqual({ checked: 1, refreshed: 0, skipped: 1, errors: 0 });
  });
});

describe('B — a read failure is an explicit failure, never a silent zero', () => {
  it('CRITICAL: a user_company_roles error throws instead of returning zeros', async () => {
    roleResult = { data: null, error: { message: 'connection terminated unexpectedly' } };

    await expect(run()).rejects.toThrow(flows.TokenRefreshQueryError);
    await expect(run()).rejects.toThrow(/user_company_roles/);
  });

  it('CRITICAL: a social_accounts error throws instead of returning zeros', async () => {
    roleResult = { data: [{ user_id: 'u-1' }] };
    accountResult = { data: null, error: { message: 'statement timeout' } };

    await expect(run()).rejects.toThrow(flows.TokenRefreshQueryError);
    await expect(run()).rejects.toThrow(/social_accounts/);
  });

  it('CRITICAL: neither failure can resolve to a summary at all', async () => {
    // The whole defect was that failure RESOLVED. Assert resolution is
    // impossible, independently of what is thrown.
    for (const inject of [
      () => { roleResult = { data: null, error: { message: 'down' } }; },
      () => { accountResult = { data: null, error: { message: 'down' } }; },
    ]) {
      jest.clearAllMocks();
      roleResult = { data: [{ user_id: 'u-1' }] };
      accountResult = { data: [] };
      inject();

      const outcome = await run().then(
        (value) => ({ settled: 'resolved' as const, value }),
        () => ({ settled: 'rejected' as const, value: undefined }),
      );

      expect(outcome.settled).toBe('rejected');
    }
  });

  it('a null data with no error is treated as failure, not as an empty read', async () => {
    // A successful PostgREST select always carries an array. An absent array is
    // an unknown state, and the unknown state must not be guessed as "empty".
    roleResult = { data: null };

    await expect(run()).rejects.toThrow(flows.TokenRefreshQueryError);
  });

  it('the thrown error names the table and carries no credential material', async () => {
    accountResult = { data: null, error: { message: 'permission denied' } };

    const err = await run().catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('social_accounts');
    for (const secret of ['Bearer', 'access_token=', 'refresh_token=']) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});

describe('C — a read failure takes no destructive fallback', () => {
  it('CRITICAL: a roles read failure parks nothing and mutates no token', async () => {
    roleResult = { data: null, error: { message: 'down' } };

    await run().catch(() => undefined);

    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
    expect(mockSetToken).not.toHaveBeenCalled();
    expect(mockRefreshTwitterIfNeeded).not.toHaveBeenCalled();
  });

  it('CRITICAL: an accounts read failure parks nothing and mutates no token', async () => {
    roleResult = { data: [{ user_id: 'u-1' }] };
    accountResult = { data: null, error: { message: 'down' } };

    await run().catch(() => undefined);

    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
    expect(mockSetToken).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
  });
});

describe('D — successful refresh behaviour is unchanged', () => {
  it('a refreshable X account is still refreshed and counted', async () => {
    accountResult = { data: [{ id: 'acct-x', platform: 'x' }] };
    mockRefreshTwitterIfNeeded.mockResolvedValue({ status: 'refreshed', access_token: 'new' });

    const s = await run();

    expect(s).toEqual({ checked: 1, refreshed: 1, skipped: 0, errors: 0 });
    expect(mockMarkNeedsReauth).not.toHaveBeenCalled();
  });

  it('terminal rejection still parks the account and counts an error', async () => {
    accountResult = { data: [{ id: 'acct-x', platform: 'x' }] };
    mockRefreshTwitterIfNeeded.mockResolvedValue({ status: 'requires_reconnect' });

    const s = await run();

    expect(s.errors).toBe(1);
    expect(mockMarkNeedsReauth).toHaveBeenCalledWith('acct-x', expect.stringContaining('x'));
  });

  it('a per-account throw is still absorbed into the summary, not rethrown', async () => {
    // The read guard must not have widened into "any failure aborts the run":
    // one bad account must never stop the others from being refreshed.
    accountResult = { data: [{ id: 'acct-x', platform: 'x' }, { id: 'acct-y', platform: 'x' }] };
    mockRefreshTwitterIfNeeded
      .mockRejectedValueOnce(new Error('provider blew up'))
      .mockResolvedValueOnce({ status: 'refreshed', access_token: 'new' });

    const s = await run();

    expect(s.checked).toBe(2);
    expect(s.errors).toBe(1);
    expect(s.refreshed).toBe(1);
  });
});

describe('E — the all-companies sweep inherits the same contract', () => {
  it('no active companies is a zero summary, not a failure', async () => {
    companyResult = { data: [] };

    await expect(flows.refreshAllExpiringSocialAccounts()).resolves.toEqual({
      companies: 0, checked: 0, refreshed: 0, skipped: 0, errors: 0,
    });
  });

  it('CRITICAL: a companies read failure throws instead of reporting zero companies', async () => {
    companyResult = { data: null, error: { message: 'down' } };

    await expect(flows.refreshAllExpiringSocialAccounts()).rejects.toThrow(/companies/);
  });

  it('a per-company failure is still counted, not rethrown', async () => {
    // The sweep must survive one company's outage; only its own read failing is
    // fatal to the sweep.
    companyResult = { data: [{ id: 'co-1' }, { id: 'co-2' }] };
    roleResult = { data: null, error: { message: 'down' } };

    const t = await flows.refreshAllExpiringSocialAccounts();

    expect(t.companies).toBe(2);
    expect(t.errors).toBe(2);
  });
});
