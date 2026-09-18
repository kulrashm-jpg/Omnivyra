/**
 * LinkedIn sunset-version detection — the diagnosis must survive the status code.
 *
 * WHY THIS EXISTS
 * ---------------
 * A sunset `LinkedIn-Version` is the one LinkedIn failure that stops every call
 * at once and has exactly one fix: bump the pin. Both LinkedIn call sites used
 * to detect it by HTTP 426 alone.
 *
 * The recorded 2026-09-16 outage did not present as 426. The signal was the body
 * message "Requested version 20250701 is not active" (see the incident note in
 * linkedinApiVersionFreshness.test.ts and the LINKEDIN_API_VERSION comments in
 * the adapter). With a status-only check that message fell through:
 *   - publishing  reported LINKEDIN_API_ERROR, retryable — the actionable
 *                 diagnosis was lost and the row was retried forever;
 *   - reconciliation reported it as an AUTH failure, because its 401/403 branch
 *                 ran first — sending the operator to reconnect accounts whose
 *                 credentials were perfectly healthy.
 *
 * Nothing here talks to LinkedIn: `fetch` is stubbed. These tests fail on the
 * unmodified base.
 */

export {};

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));

const mockGetToken = jest.fn();
jest.mock('../../auth/tokenStore', () => ({
  getToken: (...a: any[]) => mockGetToken(...a),
}));

const SUNSET_BODY = JSON.stringify({
  message: 'Requested version 20250701 is not active',
  status: 400,
});

const POST = {
  id: 'p1',
  platform: 'linkedin',
  content: 'Hello',
  scheduled_for: new Date().toISOString(),
};
const ACCOUNT = { id: 'a1', platform: 'linkedin', platform_user_id: 'member-123' };
const TOKEN = { access_token: 'tok' };

/** Stub global fetch with one canned non-OK response. */
function stubFetch(status: number, body: string) {
  (global as any).fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
    json: async () => JSON.parse(body),
  }));
}

/* ──────────────────────────────────────────────────────────────────────────
 * 1. The predicate itself — narrow on purpose.
 * ────────────────────────────────────────────────────────────────────────── */
describe('isLinkedInVersionSunsetSignal', () => {
  const load = () => require('../../adapters/linkedin/linkedinVersionSignal').isLinkedInVersionSunsetSignal;

  it('matches the exact message recorded in the 2026-09-16 outage', () => {
    expect(load()('Requested version 20250701 is not active')).toBe(true);
  });

  it('matches it inside a JSON error body', () => {
    expect(load()(SUNSET_BODY)).toBe(true);
  });

  it('matches the short "version 202507 is not active" form', () => {
    expect(load()('API version 202507 is not active')).toBe(true);
  });

  it('does NOT match unrelated LinkedIn errors', () => {
    const f = load();
    for (const other of [
      'Invalid access token',
      'Not enough permissions to access: POST /posts',
      'The account is not active',            // an ACCOUNT, not a version
      'Your subscription is not active',
      '',
      null,
      undefined,
    ]) {
      expect(f(other)).toBe(false);
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 2. Publishing — the diagnosis must not degrade to LINKEDIN_API_ERROR.
 * ────────────────────────────────────────────────────────────────────────── */
describe('publishToLinkedIn — sunset version', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.LINKEDIN_MEDIA_UPLOAD_ENABLED;
  });

  it('CRITICAL: a 400 whose body says the version is not active → LINKEDIN_VERSION_EXPIRED', async () => {
    stubFetch(400, SUNSET_BODY);
    const { publishToLinkedIn } = await import('../../adapters/linkedinAdapter');

    const r = await publishToLinkedIn(POST as any, ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('LINKEDIN_VERSION_EXPIRED');
    // Never retryable: retrying cannot un-sunset a version.
    expect(r.error?.retryable).toBe(false);
  });

  it('CRITICAL: the same signal on a 403 is NOT reported as a credential problem', async () => {
    stubFetch(403, SUNSET_BODY);
    const { publishToLinkedIn } = await import('../../adapters/linkedinAdapter');

    const r = await publishToLinkedIn(POST as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe('LINKEDIN_VERSION_EXPIRED');
    expect(r.error?.code).not.toBe('LINKEDIN_FORBIDDEN');
  });

  it('HTTP 426 still maps to LINKEDIN_VERSION_EXPIRED (existing behaviour preserved)', async () => {
    stubFetch(426, JSON.stringify({ message: 'upgrade required' }));
    const { publishToLinkedIn } = await import('../../adapters/linkedinAdapter');

    const r = await publishToLinkedIn(POST as any, ACCOUNT as any, TOKEN as any);
    expect(r.error?.code).toBe('LINKEDIN_VERSION_EXPIRED');
  });

  it('a genuine 401 is STILL an auth failure — the version check did not widen', async () => {
    stubFetch(401, JSON.stringify({ message: 'Invalid access token' }));
    const { publishToLinkedIn } = await import('../../adapters/linkedinAdapter');

    const r = await publishToLinkedIn(POST as any, ACCOUNT as any, TOKEN as any);
    expect(r.error?.code).toBe('LINKEDIN_UNAUTHORIZED');
  });

  it('a genuine 403 is STILL a permission failure', async () => {
    stubFetch(403, JSON.stringify({ message: 'Not enough permissions to access: POST /posts' }));
    const { publishToLinkedIn } = await import('../../adapters/linkedinAdapter');

    const r = await publishToLinkedIn(POST as any, ACCOUNT as any, TOKEN as any);
    expect(r.error?.code).toBe('LINKEDIN_FORBIDDEN');
  });

  it('a 429 is still the retryable rate-limit failure', async () => {
    stubFetch(429, JSON.stringify({ message: 'Too many requests' }));
    const { publishToLinkedIn } = await import('../../adapters/linkedinAdapter');

    const r = await publishToLinkedIn(POST as any, ACCOUNT as any, TOKEN as any);
    expect(r.error?.code).toBe('LINKEDIN_RATE_LIMIT');
    expect(r.error?.retryable).toBe(true);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 3. Reconciliation — the same signal must not be reported as auth.
 * ────────────────────────────────────────────────────────────────────────── */
describe('linkedinReconciliation — sunset version', () => {
  const loadLookup = async () => {
    jest.resetModules();
    const registered: any[] = [];
    jest.doMock('../../services/providerReconciliation/types', () => ({
      registerProviderReconciliationLookup: (l: any) => registered.push(l),
    }));
    jest.doMock('../../auth/tokenStore', () => ({
      getToken: async () => ({ access_token: 'tok' }),
    }));
    await import('../../services/providerReconciliation/providers/linkedinReconciliation');
    return registered[0];
  };

  const ROW = { platform_post_id: 'urn:li:share:123' };

  it('CRITICAL: a 403 whose body says the version is not active is a VERSION diagnosis, not auth', async () => {
    stubFetch(403, SUNSET_BODY);
    const lookup = await loadLookup();

    const r = await lookup.lookup({ row: ROW, socialAccountId: 'acct-1' });

    expect(r.confidence).toBe('unverifiable');
    expect(r.diagnostic).toMatch(/not active/i);
    expect(r.diagnostic).toMatch(/bump LINKEDIN_API_VERSION/);
    expect(r.diagnostic).not.toMatch(/re-authorize/);
  });

  it('426 still reports the version diagnosis (existing behaviour preserved)', async () => {
    stubFetch(426, 'upgrade required');
    const lookup = await loadLookup();

    const r = await lookup.lookup({ row: ROW, socialAccountId: 'acct-1' });
    expect(r.diagnostic).toMatch(/bump LINKEDIN_API_VERSION/);
  });

  it('a genuine 401 is STILL reported as auth', async () => {
    stubFetch(401, JSON.stringify({ message: 'Invalid access token' }));
    const lookup = await loadLookup();

    const r = await lookup.lookup({ row: ROW, socialAccountId: 'acct-1' });
    expect(r.confidence).toBe('unverifiable');
    expect(r.diagnostic).toMatch(/re-authorize/);
  });

  it('404 still classifies as no_match (the body read did not disturb it)', async () => {
    stubFetch(404, '');
    const lookup = await loadLookup();

    const r = await lookup.lookup({ row: ROW, socialAccountId: 'acct-1' });
    expect(r.confidence).toBe('no_match');
  });

  it('a generic 500 still falls through to the catch-all diagnostic', async () => {
    stubFetch(500, 'upstream exploded');
    const lookup = await loadLookup();

    const r = await lookup.lookup({ row: ROW, socialAccountId: 'acct-1' });
    expect(r.confidence).toBe('unverifiable');
    expect(r.diagnostic).toContain('LinkedIn 500');
  });
});
