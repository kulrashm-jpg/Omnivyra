/**
 * TRACK F — a freshly issued token must clear the stale reauth verdict.
 *
 * The platform had no way back from PROVIDER_REAUTH_REQUIRED: none of the ten
 * OAuth callbacks reset `connection_state`, and healthProbeService deliberately
 * SKIPS rows already in that state. Reconnecting therefore stored a valid token
 * and left the row reading "session expired" for ever — the owner reconnects,
 * publishing still fails with "Please reconnect your account", for ever.
 *
 * `setToken` is the ONE seam every OAuth callback and every successful refresh
 * passes through, so the reset is asserted there.
 */

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn() }));
jest.mock('../../lib/encryption', () => ({
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => String(v).replace(/^enc\(|\)$/g, ''),
}), { virtual: true });

import { ownedDbTable } from '../../db/writeOwner';

const mockedTable = ownedDbTable as jest.MockedFunction<typeof ownedDbTable>;

/** Every UPDATE issued against social_accounts, in order. */
let updates: Array<{ payload: Record<string, unknown>; id: string }>;
let failReset: boolean;
let failTokenWrite: boolean;

function installTable(): void {
  updates = [];
  mockedTable.mockImplementation(((table: string) => {
    if (table !== 'social_accounts') throw new Error(`unexpected table ${table}`);
    return {
      update: (payload: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          const isReset = 'connection_state' in payload;
          if (isReset && failReset) return { error: { message: "column 'refresh_status' does not exist" } };
          if (!isReset && failTokenWrite) return { error: { message: 'token write failed' } };
          updates.push({ payload, id });
          return { error: null };
        },
      }),
    } as never;
  }) as unknown as typeof ownedDbTable);
}

beforeEach(() => {
  jest.clearAllMocks();
  failReset = false;
  failTokenWrite = false;
  installTable();
});

const TOKEN = { access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_at: '2026-10-27T15:17:27.000Z', token_type: 'Bearer' };

const tokenWrite = () => updates.find((u) => 'access_token' in u.payload);
const resetWrite = () => updates.find((u) => 'connection_state' in u.payload);

describe('Track F — setToken clears the stale reauth verdict', () => {
  test('a freshly stored token resets connection_state to CONNECTED', async () => {
    const { setToken } = await import('../../auth/tokenStore');
    await setToken('acct-1', TOKEN as never);

    const reset = resetWrite();
    expect(reset).toBeDefined();
    expect(reset!.id).toBe('acct-1');
    expect(reset!.payload.connection_state).toBe('CONNECTED');
  });

  test('it clears the failure bookkeeping that kept the row parked', async () => {
    const { setToken } = await import('../../auth/tokenStore');
    await setToken('acct-1', TOKEN as never);

    expect(resetWrite()!.payload).toMatchObject({
      refresh_status: null,
      refresh_retry_count: 0,
      last_provider_error: null,
      last_refresh_error: null,
      last_live_check_status: null,
    });
  });

  test('it does NOT claim LIVE_VERIFIED — possession is not provider acceptance', async () => {
    const { setToken } = await import('../../auth/tokenStore');
    await setToken('acct-1', TOKEN as never);

    // CONNECTED makes the row eligible for the health probe again (the probe
    // skips PROVIDER_REAUTH_REQUIRED), which is what promotes it.
    expect(resetWrite()!.payload.connection_state).not.toBe('LIVE_VERIFIED');
  });

  test('the token itself is still stored, encrypted, with its expiry', async () => {
    const { setToken } = await import('../../auth/tokenStore');
    await setToken('acct-1', TOKEN as never);

    const write = tokenWrite();
    // Stored ciphertext, never the bearer token in the clear.
    expect(String(write!.payload.access_token)).not.toContain(TOKEN.access_token);
    expect(String(write!.payload.access_token).length).toBeGreaterThan(0);
    expect(write!.payload.token_expires_at).toBe(TOKEN.expires_at);
    // The lifecycle reset is a separate write, so it can never corrupt this one.
    expect(write!.payload).not.toHaveProperty('connection_state');
  });

  test('schema drift on the reset degrades to a warning — connecting still works', async () => {
    failReset = true;
    const { setToken } = await import('../../auth/tokenStore');

    await expect(setToken('acct-1', TOKEN as never)).resolves.toBeUndefined();
    expect(tokenWrite()).toBeDefined();   // the token was still stored
    expect(resetWrite()).toBeUndefined(); // the reset simply did not apply
  });

  test('a real token-write failure still throws — it is not masked', async () => {
    failTokenWrite = true;
    const { setToken } = await import('../../auth/tokenStore');

    await expect(setToken('acct-1', TOKEN as never)).rejects.toThrow(/Failed to store token/);
  });
});
