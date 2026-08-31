/**
 * Phase 156 (D) — a failed account lookup must not become an INSERT.
 *
 * `dualWriteSocialAccount` decided between UPDATE and INSERT from a single
 * nullable value:
 *
 *     const { data } = await strict.maybeSingle();
 *     existing = data ? { id: data.id } : null;
 *
 * `error` was discarded, so `existing = null` meant either "no such row yet"
 * (INSERT is correct) or "the lookup failed" (INSERT is NOT correct — the row
 * may well exist). The relaxed fallback below it had the same shape.
 *
 * That second one is the dangerous one. It exists because Meta returns a
 * different platform_user_id across OAuth sessions, which is exactly the case
 * the unique index (company_id, platform, platform_user_id) does NOT catch. So
 * a transient read failure during a Meta reconnect could mint a SECOND
 * social_accounts row for one tenant and platform — the precise outcome the
 * fallback was written to prevent.
 *
 * The function swallows its own exceptions ("non-fatal") and returns void, so
 * throwing would be invisible to the OAuth callback. Aborting the write is the
 * safe failure: state is left untouched and the user can retry the connect.
 */

export {};

type Row = Record<string, unknown>;

const updates: Array<Row> = [];
const inserts: Array<Row> = [];

/** Per-test control over what each lookup returns. */
let strictResult: { data: Row | null; error: { message: string } | null } = { data: null, error: null };
let relaxedResult: { data: Row | null; error: { message: string } | null } = { data: null, error: null };
let lookupCall = 0;

// A real 64-hex-char key: the INSERT path encrypts the token BEFORE writing, so
// without a usable key it throws and never reaches the insert at all — which
// would make the "genuinely absent row" case pass for the wrong reason.
jest.mock('@/config', () => ({
  config: { ENCRYPTION_KEY: '0'.repeat(64) },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../lib/encryption', () => ({ encrypt: (v: string) => v, decrypt: (v: string) => v }), { virtual: true });

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        lookupCall += 1;
        return lookupCall === 1 ? strictResult : relaxedResult;
      },
      single: async () => ({ data: { id: 'acct-new' }, error: null }),
      update: (payload: Row) => { updates.push(payload); return { eq: () => Promise.resolve({ error: null }) }; },
      insert: (payload: Row) => {
        inserts.push(payload);
        return { select: () => ({ single: async () => ({ data: { id: 'acct-new' }, error: null }) }) };
      },
    };
    return chain;
  },
}));

let dualWriteSocialAccount: typeof import('../../auth/tokenStore').dualWriteSocialAccount;
beforeAll(async () => {
  ({ dualWriteSocialAccount } = await import('../../auth/tokenStore'));
});

beforeEach(() => {
  updates.length = 0;
  inserts.length = 0;
  lookupCall = 0;
  strictResult = { data: null, error: null };
  relaxedResult = { data: null, error: null };
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); });

const connect = () => dualWriteSocialAccount({
  userId: 'u-1',
  companyId: 'co-1',
  platform: 'facebook',
  platformUserId: 'pu-1',
  accountName: 'Kuldeep Rawat',
  token: { access_token: 'fresh', expires_at: '2099-01-01T00:00:00.000Z' },
} as never);

describe('A — the two legitimate outcomes are unchanged', () => {
  it('CRITICAL: an existing row is UPDATED, never inserted', async () => {
    strictResult = { data: { id: 'acct-1' }, error: null };
    await connect();
    expect(updates.length).toBeGreaterThan(0);
    expect(inserts).toHaveLength(0);
  });

  it('CRITICAL: a genuinely absent row is INSERTED', async () => {
    // Both lookups succeed and match nothing — the row really does not exist.
    strictResult = { data: null, error: null };
    relaxedResult = { data: null, error: null };
    await connect();
    expect(inserts).toHaveLength(1);
  });

  it('a reconnect still resets the terminal state fields', async () => {
    strictResult = { data: { id: 'acct-1' }, error: null };
    await connect();
    const patch = updates.find((u) => u.is_active === true);
    expect(patch).toBeDefined();
    expect(patch!.connection_state).toBe('CONNECTED');
    expect(patch!.refresh_retry_count).toBe(0);
  });
});

describe('B — a lookup FAILURE is not an absent row', () => {
  it('CRITICAL: a strict lookup error inserts nothing', async () => {
    strictResult = { data: null, error: { message: 'timeout' } };
    await connect();
    expect(inserts).toHaveLength(0);
  });

  it('CRITICAL: a strict lookup error updates nothing either — state is left untouched', async () => {
    strictResult = { data: null, error: { message: 'timeout' } };
    await connect();
    expect(updates).toHaveLength(0);
  });

  it('CRITICAL: a RELAXED lookup error inserts nothing (the Meta duplicate case)', async () => {
    // The unique index does not cover a differing platform_user_id, so this is
    // the path that could actually mint a second row.
    strictResult = { data: null, error: null };
    relaxedResult = { data: null, error: { message: 'connection reset' } };
    await connect();
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('the failure is reported rather than swallowed', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    strictResult = { data: null, error: { message: 'timeout' } };
    await connect();
    expect(err.mock.calls.some((c) => String(c[0]).includes('lookup failed'))).toBe(true);
  });

  it('no credential material appears in the failure log', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    strictResult = { data: null, error: { message: 'timeout' } };
    await connect();
    const line = err.mock.calls.map((c) => c.map(String).join(' ')).join(' | ');
    for (const s of ['fresh', 'access_token', 'Bearer']) expect(line).not.toContain(s);
  });
});
