/**
 * OPT-004 — getAuthToken module-level memoization.
 *
 * Runs under the default node environment; the browser path is exercised by
 * installing a `window` global, the SSR path by removing it. Each test loads
 * a FRESH module instance (jest.isolateModules) because the memo, in-flight
 * dedupe, and subscription flag are module state.
 */

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();

jest.mock('../../../lib/supabaseBrowser', () => ({
  getSupabaseBrowser: () => ({
    auth: { getSession: mockGetSession, onAuthStateChange: mockOnAuthStateChange },
  }),
}));

type GetAuthToken = () => Promise<string | null>;

function loadFreshModule(): GetAuthToken {
  let fn: GetAuthToken | undefined;
  jest.isolateModules(() => {
    fn = require('../../../utils/getAuthToken').getAuthToken;
  });
  return fn!;
}

const sessionOf = (token: string, expiresInSec: number) => ({
  data: {
    session: {
      access_token: token,
      expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
    },
  },
});

/** The auth-event callback registered by the module's single subscription. */
const registeredAuthCallback = (): ((event: string, session: unknown) => void) => {
  expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
  return mockOnAuthStateChange.mock.calls[0][0];
};

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as any).window = {}; // browser by default; SSR tests delete it
});

afterEach(() => {
  delete (globalThis as any).window;
});

describe('cache miss → getSession fallback (existing behavior)', () => {
  test('first call resolves via getSession and returns the token', async () => {
    const getAuthToken = loadFreshModule();
    mockGetSession.mockResolvedValue(sessionOf('tok-1', 3600));
    await expect(getAuthToken()).resolves.toBe('tok-1');
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  test('null session returns null and caches nothing', async () => {
    const getAuthToken = loadFreshModule();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(getAuthToken()).resolves.toBeNull();
    await expect(getAuthToken()).resolves.toBeNull();
    expect(mockGetSession).toHaveBeenCalledTimes(2); // no cache from null
  });

  test('getSession throwing is suppressed and returns null (existing semantics)', async () => {
    const getAuthToken = loadFreshModule();
    mockGetSession.mockRejectedValue(new Error('NavigatorLockAcquireTimeoutError: x'));
    await expect(getAuthToken()).resolves.toBeNull();
  });
});

describe('cache hit', () => {
  test('second call within expiry is served from cache with NO getSession call', async () => {
    const getAuthToken = loadFreshModule();
    mockGetSession.mockResolvedValue(sessionOf('tok-1', 3600));
    await getAuthToken();
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    await expect(getAuthToken()).resolves.toBe('tok-1');
    await expect(getAuthToken()).resolves.toBe('tok-1');
    expect(mockGetSession).toHaveBeenCalledTimes(1); // still exactly one
  });
});

describe('expiry safety margin (60 s)', () => {
  test('a token with < 60 s of life is NOT served from cache', async () => {
    const getAuthToken = loadFreshModule();
    mockGetSession.mockResolvedValue(sessionOf('tok-short', 30)); // 30 s left
    await expect(getAuthToken()).resolves.toBe('tok-short');
    mockGetSession.mockResolvedValue(sessionOf('tok-new', 3600));
    await expect(getAuthToken()).resolves.toBe('tok-new'); // margin forced re-resolve
    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });
});

describe('concurrent callers', () => {
  test('N parallel cache-miss calls perform exactly ONE getSession()', async () => {
    const getAuthToken = loadFreshModule();
    let release!: (v: unknown) => void;
    mockGetSession.mockReturnValue(new Promise((r) => { release = r; }));
    const calls = [getAuthToken(), getAuthToken(), getAuthToken()];
    release(sessionOf('tok-1', 3600));
    await expect(Promise.all(calls)).resolves.toEqual(['tok-1', 'tok-1', 'tok-1']);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });
});

describe('auth state subscription', () => {
  test('exactly one subscription across many calls', async () => {
    const getAuthToken = loadFreshModule();
    mockGetSession.mockResolvedValue(sessionOf('tok-1', 3600));
    await getAuthToken();
    await getAuthToken();
    await getAuthToken();
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
  });

  test('SIGNED_IN updates the cache', async () => {
    const getAuthToken = loadFreshModule();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await getAuthToken(); // registers subscription, caches nothing
    registeredAuthCallback()('SIGNED_IN', {
      access_token: 'tok-signed-in',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    mockGetSession.mockClear();
    await expect(getAuthToken()).resolves.toBe('tok-signed-in');
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  test('TOKEN_REFRESHED replaces the cached token', async () => {
    const getAuthToken = loadFreshModule();
    mockGetSession.mockResolvedValue(sessionOf('tok-old', 3600));
    await getAuthToken();
    registeredAuthCallback()('TOKEN_REFRESHED', {
      access_token: 'tok-rotated',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    mockGetSession.mockClear();
    await expect(getAuthToken()).resolves.toBe('tok-rotated');
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  test('SIGNED_OUT clears the cache; next call re-resolves', async () => {
    const getAuthToken = loadFreshModule();
    mockGetSession.mockResolvedValue(sessionOf('tok-1', 3600));
    await getAuthToken();
    registeredAuthCallback()('SIGNED_OUT', null);
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(getAuthToken()).resolves.toBeNull();
    expect(mockGetSession).toHaveBeenCalledTimes(2); // cache was cleared
  });
});

describe('SSR safety', () => {
  test('without window: legacy path, no subscription, no cross-call caching', async () => {
    delete (globalThis as any).window;
    const getAuthToken = loadFreshModule();
    mockGetSession.mockResolvedValue(sessionOf('tok-ssr', 3600));
    await expect(getAuthToken()).resolves.toBe('tok-ssr');
    await expect(getAuthToken()).resolves.toBe('tok-ssr');
    expect(mockGetSession).toHaveBeenCalledTimes(2); // never cached on server
    expect(mockOnAuthStateChange).not.toHaveBeenCalled();
  });

  test('a server-populated value can never be served to the browser path', async () => {
    delete (globalThis as any).window;
    const getAuthToken = loadFreshModule();
    mockGetSession.mockResolvedValue(sessionOf('tok-server-user', 3600));
    await getAuthToken(); // SSR resolve — must not write the memo
    (globalThis as any).window = {};
    mockGetSession.mockResolvedValue(sessionOf('tok-browser-user', 3600));
    await expect(getAuthToken()).resolves.toBe('tok-browser-user');
    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });
});
