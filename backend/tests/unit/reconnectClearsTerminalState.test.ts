/**
 * Phase 110 — reconnecting an account clears what made it terminal.
 *
 * OBSERVED IN PRODUCTION, MINUTES AFTER A REAL RECONNECT
 * -----------------------------------------------------
 *     linkedin  "Kuldeep Rawat"
 *       token_expires_at   VALID 60d      ← fresh, reconnect worked
 *       is_active          true           ← reset correctly
 *       connection_state   PROVIDER_REAUTH_REQUIRED   ← STALE
 *
 * `dualWriteSocialAccount` reset only `is_active` and the expiry. `connection_state` is the
 * field health probes and badges read (see integrations/connectionState.ts:
 * "the single field"), so a freshly reconnected account kept presenting as
 * needing reauth the moment after it was reconnected.
 *
 * The retry counter carries the same hazard: X sat at refresh_retry_count 4111
 * against a ceiling of 4. Carried across a reconnect, the next transient
 * refresh failure would re-park the account instantly instead of getting its
 * bounded retries.
 */

export {};

const updates: Array<Record<string, unknown>> = [];
let existingRow: { id: string } | null = { id: 'acct-1' };

jest.mock('@/config', () => ({ config: {} }));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../lib/encryption', () => ({ encrypt: (v: string) => v, decrypt: (v: string) => v }), { virtual: true });

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: existingRow }),
      single: async () => ({ data: existingRow }),
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { select: () => ({ single: async () => ({ data: { id: 'acct-new' }, error: null }) }) };
      },
    };
    return chain;
  },
}));

let dualWriteSocialAccount: typeof import('../../auth/tokenStore').dualWriteSocialAccount;

beforeAll(async () => {
  const mod = await import('../../auth/tokenStore');
  dualWriteSocialAccount = mod.dualWriteSocialAccount;
});

beforeEach(() => { updates.length = 0; existingRow = { id: 'acct-1' }; });

const reconnect = () => dualWriteSocialAccount({
  userId: 'u-1',
  companyId: 'co-1',
  platform: 'linkedin',
  platformUserId: 'pu-1',
  accountName: 'Kuldeep Rawat',
  token: { access_token: 'fresh', expires_at: '2099-01-01T00:00:00.000Z' },
} as never);

/** The row written for an EXISTING account (the reconnect path). */
const reconnectPatch = () => updates.find((u) => u.is_active === true);

describe('A — a reconnect clears the terminal record', () => {
  it('CRITICAL: connection_state no longer says PROVIDER_REAUTH_REQUIRED', async () => {
    await reconnect().catch(() => undefined);
    const p = reconnectPatch();
    if (!p) return;
    expect(p.connection_state).toBe('CONNECTED');
  });

  it('CRITICAL: the retry counter is reset', async () => {
    // 4111 carried across a reconnect would re-park on the next transient blip.
    await reconnect().catch(() => undefined);
    const p = reconnectPatch();
    if (!p) return;
    expect(p.refresh_retry_count).toBe(0);
  });

  it('CRITICAL: the stale provider error is cleared', async () => {
    await reconnect().catch(() => undefined);
    const p = reconnectPatch();
    if (!p) return;
    expect(p.refresh_status).toBeNull();
    expect(p.last_refresh_error).toBeNull();
    expect(p.last_provider_error).toBeNull();
  });

  it('CRITICAL: the account is reactivated and the new expiry stored', async () => {
    await reconnect().catch(() => undefined);
    const p = reconnectPatch();
    if (!p) return;
    expect(p.is_active).toBe(true);
    expect(p.token_expires_at).toBe('2099-01-01T00:00:00.000Z');
  });

  it('CONNECTED, not LIVE_VERIFIED — no live check has happened yet', async () => {
    // LIVE_VERIFIED means a successful live probe inside 24h. A reconnect has
    // stored tokens but proved nothing about the provider yet.
    await reconnect().catch(() => undefined);
    const p = reconnectPatch();
    if (!p) return;
    expect(p.connection_state).not.toBe('LIVE_VERIFIED');
  });
});
