/**
 * STEP 3AH-91 SEC-E4 — bounded outbound timeouts (GA4 / Search Console /
 * Razorpay) and no raw provider error bodies in logs or thrown messages.
 *
 * Deterministic: global `fetch` is a stub that never settles on its own and
 * rejects only when its signal aborts; `AbortSignal.timeout` is spied so the
 * test both observes the requested bound and fires it by hand (Node's
 * AbortSignal.timeout timer is not driven by jest fake timers).
 */
jest.mock('../../auth/oauthState', () => ({ decodeOAuthState: jest.fn(), encodeOAuthState: jest.fn() }));
jest.mock('../../auth/credentialEncryption', () => ({ decryptCredential: (v: string) => v, encryptCredential: (v: string) => v }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({}) }));
jest.mock('../../services/analyticsProviderConfigService', () => ({
  getAnalyticsProviderConfig: async () => ({
    enabled: true,
    oauth_client_id: 'client-id.apps.googleusercontent.test',
    oauth_client_secret: 'CLIENT-SECRET-DO-NOT-LOG',
    scopes: [],
    redirect_uri: 'https://app.test/api/analytics/connect/google/callback',
    capability_redirect_uris: { google_analytics: null, google_search_console: null },
  }),
}));
jest.mock('../../services/payments/orchestrator/providerConfig', () => ({
  getProviderCredentials: () => ({ keyId: 'rzp_test_key', keySecret: 'rzp-secret', webhookSecret: 'wh' }),
  isProviderConfigured: () => true,
  getActiveMode: () => 'test',
}));

import {
  exchangeAuthorizationCode,
  fetchGAAccountsAndProperties,
  fetchSearchConsoleSites,
} from '../../services/analyticsIntegrationServiceProviders';
import { RazorpayAdapter } from '../../services/payments/orchestrator/razorpayAdapter';

type Init = { signal?: AbortSignal };
const realFetch = global.fetch;
let requestedTimeouts: number[] = [];
let controllers: AbortController[] = [];
let timeoutSpy: jest.SpyInstance;

/** A request that only ever settles when its signal aborts. */
function hangingFetch(_url: string, init?: Init): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // unbounded — the test's own timeout would catch it
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

beforeEach(() => {
  requestedTimeouts = [];
  controllers = [];
  timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    requestedTimeouts.push(ms);
    const c = new AbortController();
    controllers.push(c);
    return c.signal;
  });
});
afterEach(() => {
  timeoutSpy.mockRestore();
  (global as any).fetch = realFetch;
});

const fireTimeouts = () => {
  for (const c of controllers) {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    c.abort(err);
  }
};
const settleSoon = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

describe('Google APIs are time-bounded', () => {
  it.each([
    ['token exchange', () => exchangeAuthorizationCode('auth-code')],
    ['admin API', () => fetchGAAccountsAndProperties('access-token')],
    ['search console sites', () => fetchSearchConsoleSites('access-token')],
  ])('%s requests a bounded timeout and rejects when it fires', async (_n, run) => {
    (global as any).fetch = jest.fn(hangingFetch);
    const pending = run();
    await settleSoon();
    expect(requestedTimeouts.length).toBe(1);
    expect(requestedTimeouts[0]).toBeGreaterThan(0);
    expect(requestedTimeouts[0]).toBeLessThanOrEqual(30_000);
    fireTimeouts();
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('Google error bodies are summarised and redacted, never logged raw', () => {
  const secretEcho = 'ECHOED-SECRET-abc123';
  let errSpy: jest.SpyInstance;
  beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => errSpy.mockRestore());

  const respond = (status: number, body: string) => (global as any).fetch = jest.fn(async () => ({
    ok: false, status, text: async () => body, json: async () => JSON.parse(body),
  }));

  it('token exchange: keeps the OAuth error code, drops everything else', async () => {
    respond(400, JSON.stringify({
      error: 'invalid_grant',
      error_description: `Bad Request client_secret=${secretEcho}`,
      debug_echo: { client_secret: secretEcho, code: 'auth-code-value' },
    }));
    let message = '';
    try { await exchangeAuthorizationCode('auth-code-value'); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('GA4 token exchange failed (400)');
    expect(message).toContain('invalid_grant');
    expect(message).not.toContain(secretEcho);
    expect(message).not.toContain('auth-code-value');
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).not.toContain(secretEcho);
    expect(logged).not.toContain('auth-code-value');
    expect(logged).toContain('invalid_grant');
  });

  it('token exchange: a non-JSON body is not echoed', async () => {
    respond(502, `<html>upstream said client_secret: ${secretEcho}</html>`);
    let message = '';
    try { await exchangeAuthorizationCode('auth-code-value'); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('(502)');
    expect(message).not.toContain(secretEcho);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(secretEcho);
  });

  it('admin API / search console: Google error status + message kept, secrets redacted', async () => {
    respond(403, JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: `denied for access_token=${secretEcho}` } }));
    let m1 = '';
    try { await fetchGAAccountsAndProperties('access-token'); } catch (e) { m1 = (e as Error).message; }
    expect(m1).toContain('PERMISSION_DENIED');
    expect(m1).not.toContain(secretEcho);
    let m2 = '';
    try { await fetchSearchConsoleSites('access-token'); } catch (e) { m2 = (e as Error).message; }
    expect(m2).toContain('PERMISSION_DENIED');
    expect(m2).not.toContain(secretEcho);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(secretEcho);
  });
});

describe('Razorpay calls are time-bounded with unchanged failure semantics', () => {
  const adapter = new RazorpayAdapter();

  it('createOrder requests a bounded timeout and throws when it fires (as a network error did)', async () => {
    (global as any).fetch = jest.fn(hangingFetch);
    const pending = adapter.createOrder({ amount: 10, currency: 'INR', reference_id: 'r1', organization_id: 'o1' } as any);
    await settleSoon();
    expect(requestedTimeouts).toHaveLength(1);
    expect(requestedTimeouts[0]).toBeLessThanOrEqual(30_000);
    fireTimeouts();
    await expect(pending).rejects.toBeDefined();
  });

  it('fetchOrderOutcome: a timed-out order lookup is `unknown`, never "unpaid"', async () => {
    (global as any).fetch = jest.fn(hangingFetch);
    const pending = adapter.fetchOrderOutcome('order_1');
    await settleSoon();
    expect(requestedTimeouts).toHaveLength(1);
    fireTimeouts();
    const out = await pending;
    expect(out.outcome).toBe('unknown');
  });

  it('fetchOrderOutcome: a timed-out payments lookup still reports paid with no financials', async () => {
    let call = 0;
    (global as any).fetch = jest.fn((url: string, init?: Init) => {
      call++;
      if (call === 1) return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'paid' }) });
      return hangingFetch(url, init);
    });
    const pending = adapter.fetchOrderOutcome('order_2');
    await settleSoon();
    expect(requestedTimeouts).toHaveLength(2);
    fireTimeouts();
    const out = await pending;
    expect(out).toMatchObject({ outcome: 'paid', providerPaymentId: undefined, providerAmountSubunits: undefined });
  });
});
