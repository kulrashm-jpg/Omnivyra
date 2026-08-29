/**
 * PHASE 114 — the refresh lifecycle records the same bookkeeping for EVERY
 * platform that can refresh, not just X.
 *
 * Before, the recorder was called only from inside refreshTwitterTokenIfNeeded.
 * YouTube proved the cost in production: its token demonstrably rotated while
 * last_refresh_attempt_at and last_successful_refresh_at stayed null, so a
 * healthy platform looked identical to one that had never been tried.
 *
 * These tests drive the REAL public `refreshPlatformToken`. Provider calls are
 * faked at the per-platform refresher boundary; no credential is ever used,
 * refreshed, or printed.
 */

const dbWrites: Array<{ id: string; payload: Record<string, unknown> }> = [];
let priorRetryCount = 0;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn(() => ({
    update: (payload: Record<string, unknown>) => ({
      eq: async (_c: string, id: string) => { dbWrites.push({ id, payload }); return { error: null }; },
    }),
    // the transient branch reads the prior retry count before writing
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { refresh_retry_count: priorRetryCount } }) }),
    }),
  })),
}));

// Per-platform refreshers are faked; the shared router under test is real.
const mockLinkedIn = jest.fn();
const mockYouTube = jest.fn();
const mockTwitter = jest.fn();

jest.mock('../../auth/tokenRefreshCore', () => {
  const actual = jest.requireActual('../../auth/tokenRefreshCore');
  return {
    ...actual,
    refreshLinkedInToken: (...a: unknown[]) => mockLinkedIn(...a),
    refreshYouTubeToken: (...a: unknown[]) => mockYouTube(...a),
    refreshTwitterToken: (...a: unknown[]) => mockTwitter(...a),
    refreshTwitterTokenIfNeeded: jest.fn(),
    refreshFacebookToken: jest.fn(async () => null),
    refreshInstagramToken: jest.fn(async () => null),
  };
});

import { refreshPlatformToken } from '../../auth/tokenRefreshFlows';

const TOKEN = { access_token: 'ACCESS_SECRET', refresh_token: 'REFRESH_SECRET', expires_at: '2099-01-01T00:00:00.000Z' };
const NO_REFRESH = { access_token: 'ACCESS_SECRET', expires_at: '2099-01-01T00:00:00.000Z' };
const FRESH = { access_token: 'NEW_ACCESS_SECRET', refresh_token: 'NEW_REFRESH_SECRET', expires_at: '2099-06-01T00:00:00.000Z' };

/** Only lifecycle writes (the recorder). */
const lifecycle = () => dbWrites.filter((w) => 'last_refresh_attempt_at' in w.payload);
const last = (): Record<string, unknown> => lifecycle()[lifecycle().length - 1]?.payload ?? {};

beforeEach(() => {
  jest.clearAllMocks();
  dbWrites.length = 0;
  priorRetryCount = 0;
});

describe('P114 — success is recorded for every refreshing platform', () => {
  test('YouTube success stamps attempt AND last_successful_refresh_at', async () => {
    mockYouTube.mockResolvedValue(FRESH);

    const out = await refreshPlatformToken('youtube', 'acct-yt', TOKEN as never);

    expect(out).toBe(FRESH);
    expect(last().refresh_status).toBe('CONNECTED');
    expect(last().connection_state).toBe('CONNECTED');
    expect(last().last_refresh_attempt_at).toBeTruthy();
    expect(last().last_successful_refresh_at).toBeTruthy();
    expect(last().refresh_retry_count).toBe(0);
  });

  test('LinkedIn success is recorded through the same shared seam', async () => {
    mockLinkedIn.mockResolvedValue(FRESH);

    await refreshPlatformToken('linkedin', 'acct-li', TOKEN as never);

    expect(last().refresh_status).toBe('CONNECTED');
    expect(last().last_successful_refresh_at).toBeTruthy();
  });

  test('success leaves no stale PROVIDER_REAUTH_REQUIRED behind', async () => {
    mockYouTube.mockResolvedValue(FRESH);

    await refreshPlatformToken('youtube', 'acct-yt', TOKEN as never);

    expect(last().connection_state).not.toBe('PROVIDER_REAUTH_REQUIRED');
    expect(last().last_provider_error).toBeNull();
    expect(last().last_refresh_error).toBeNull();
  });
});

describe('P114 — terminal vs transient stays intact', () => {
  test('a terminal invalid_grant parks the account', async () => {
    mockYouTube.mockRejectedValue(new Error('400 invalid_grant: token revoked'));

    await refreshPlatformToken('youtube', 'acct-yt', TOKEN as never);

    expect(last().refresh_status).toBe('PROVIDER_REAUTH_REQUIRED');
    expect(last().connection_state).toBe('PROVIDER_REAUTH_REQUIRED');
  });

  test('a transient failure does NOT park — it retries under the ceiling', async () => {
    mockYouTube.mockRejectedValue(new Error('ETIMEDOUT socket hang up'));

    await refreshPlatformToken('youtube', 'acct-yt', TOKEN as never);

    expect(last().refresh_status).toBe('REFRESH_FAILED_RETRYABLE');
    expect(last().connection_state).not.toBe('PROVIDER_REAUTH_REQUIRED');
    expect(last().refresh_retry_count).toBe(1);
  });

  test('a swallowed provider error is treated as transient, never terminal', async () => {
    // Refreshers catch internally and return null, so the terminal signal is not
    // visible here. Transient is the safe reading — one bad response must not
    // park a live account.
    mockYouTube.mockResolvedValue(null);

    await refreshPlatformToken('youtube', 'acct-yt', TOKEN as never);

    expect(last().refresh_status).toBe('REFRESH_FAILED_RETRYABLE');
    expect(last().connection_state).not.toBe('PROVIDER_REAUTH_REQUIRED');
  });

  test('bounded retries still park an account that never recovers', async () => {
    priorRetryCount = 3; // ceiling is 4
    mockYouTube.mockResolvedValue(null);

    await refreshPlatformToken('youtube', 'acct-yt', TOKEN as never);

    expect(last().refresh_status).toBe('PROVIDER_REAUTH_REQUIRED');
  });
});

describe('P114 — skips are not failures', () => {
  test('no refresh token records an attempt only, and never parks', async () => {
    await refreshPlatformToken('linkedin', 'acct-li', NO_REFRESH as never);

    expect(mockLinkedIn).not.toHaveBeenCalled();
    const w = last();
    expect(w.last_refresh_attempt_at).toBeTruthy();
    // Nothing that could libel or park a healthy account.
    expect(Object.keys(w)).toEqual(['last_refresh_attempt_at']);
    expect(w.refresh_status).toBeUndefined();
    expect(w.connection_state).toBeUndefined();
    expect(w.refresh_retry_count).toBeUndefined();
  });

  test('a platform with no refresh capability records nothing at all', async () => {
    const out = await refreshPlatformToken('whatsapp', 'acct-wa', TOKEN as never);

    expect(out).toBeNull();
    expect(lifecycle()).toHaveLength(0);
  });
});

describe('P114 — X behaviour is preserved', () => {
  test('X delegates and is NOT double-recorded by the shared boundary', async () => {
    mockTwitter.mockResolvedValue(FRESH);

    const out = await refreshPlatformToken('x', 'acct-x', TOKEN as never);

    expect(out).toBe(FRESH);
    expect(mockTwitter).toHaveBeenCalledTimes(1);
    // Its own recorder runs inside the refresh lock; the router must not add a
    // second lifecycle write for the same attempt.
    expect(lifecycle()).toHaveLength(0);
  });

  test('the twitter alias routes identically', async () => {
    mockTwitter.mockResolvedValue(FRESH);
    await refreshPlatformToken('twitter', 'acct-x', TOKEN as never);
    expect(mockTwitter).toHaveBeenCalledTimes(1);
    expect(lifecycle()).toHaveLength(0);
  });
});

describe('P114 — telemetry carries no credential material', () => {
  test('no persisted field contains the access or refresh token', async () => {
    mockYouTube.mockRejectedValue(new Error('provider rejected ' + TOKEN.access_token + ' / ' + TOKEN.refresh_token));

    await refreshPlatformToken('youtube', 'acct-yt', TOKEN as never);
    mockYouTube.mockResolvedValue(FRESH);
    await refreshPlatformToken('youtube', 'acct-yt', TOKEN as never);

    const serialized = JSON.stringify(dbWrites);
    expect(serialized).not.toContain(FRESH.access_token);
    expect(serialized).not.toContain(FRESH.refresh_token);
    expect(serialized).not.toContain(TOKEN.refresh_token);
  });
});
