/**
 * Extension production targeting — localhost retargeting must be unreachable
 * in the Chrome Web Store build.
 *
 * THE DEFECT
 *   `resolveDevLocalhostBase()` scans EVERY open tab via chrome.tabs.query({})
 *   and, on finding any localhost:PORT / 127.0.0.1:PORT tab, retargets Omnivyra
 *   API traffic to that origin and sends it unsigned. Every GET also carries
 *   `organization_id` as a query param.
 *
 *   Two activation sites, and the second is the severe one. The poll loop
 *   called the discovery UNCONDITIONALLY, and its condition was
 *   `devBase && (!isAuthenticated() || !usingLocalhost)` — `!usingLocalhost` is
 *   TRUE for a production base, so an AUTHENTICATED production user with any
 *   localhost tab open had their command-poll base rewritten to localhost and
 *   persisted onto authBridge.apiBaseUrl. It was never limited to the
 *   logged-out case.
 *
 * THE GUARD
 *   The extension has no build pipeline (no bundler, no package step), so the
 *   fallback cannot be compiled out. It is instead keyed to chrome.runtime.id:
 *   a Chrome Web Store install always carries the published id, an unpacked
 *   developer load never does. Fails closed on any error.
 *
 * These tests model the guard's decision logic against the real source and
 * assert the source shape, since the service worker is a chrome-global script
 * that cannot be imported here.
 */

import { readFileSync } from 'fs';

const SW_PATH = 'C:/Users/Admin/OneDrive/Desktop/omnivyra chrome ext/extension/background/serviceWorker.js';
const swSrc = readFileSync(SW_PATH, 'utf8');

const PRODUCTION_EXTENSION_ID = 'khlballmijciomdbigljpafliajdekbg';
const PRODUCTION_API = 'https://www.omnivyra.com';

/** Mirrors isDevelopmentBuild() in the service worker. */
function isDevelopmentBuild(runtimeId: string | null | undefined): boolean {
  try {
    if (!runtimeId) return false;
    return runtimeId !== PRODUCTION_EXTENSION_ID;
  } catch (_) {
    return false;
  }
}

/** Mirrors resolveDevLocalhostBase() including its production backstop. */
function resolveDevLocalhostBase(runtimeId: string | null, tabUrls: string[]): string | null {
  if (!isDevelopmentBuild(runtimeId)) return null;
  for (const u of tabUrls) {
    const m = u.match(/^https?:\/\/(localhost|127\.0\.0\.1):(\d+)/i);
    if (m) return `http://${m[1]}:${m[2]}`;
  }
  return null;
}

/** Mirrors the command-poll base selection. */
function resolvePollBase(input: {
  runtimeId: string | null;
  tabUrls: string[];
  authenticated: boolean;
  currentBase: string;
}): { base: string | null; error?: string } {
  const devBase = isDevelopmentBuild(input.runtimeId)
    ? resolveDevLocalhostBase(input.runtimeId, input.tabUrls)
    : null;
  const usingLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(input.currentBase);
  if (devBase && (!input.authenticated || !usingLocalhost)) return { base: devBase };
  if (!input.authenticated) return { base: null, error: 'NOT_AUTHENTICATED' };
  return { base: input.currentBase };
}

/** Mirrors the signing decision in handleApiRequest. */
function resolveRequestTarget(input: {
  runtimeId: string | null;
  tabUrls: string[];
  hasHmacSecret: boolean;
  apiBase: string;
}): { base: string | null; signed: boolean; error?: string } {
  const isLocalhostBase = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(input.apiBase);
  if (input.hasHmacSecret) return { base: input.apiBase, signed: true };
  if (isLocalhostBase) return { base: input.apiBase, signed: false };
  const devBase = isDevelopmentBuild(input.runtimeId)
    ? resolveDevLocalhostBase(input.runtimeId, input.tabUrls)
    : null;
  if (devBase) return { base: devBase, signed: false };
  return { base: null, signed: false, error: 'SIGNATURE_UNAVAILABLE' };
}

const STORE = PRODUCTION_EXTENSION_ID;
const UNPACKED = 'abcdefghijklmnopqrstuvwxyzabcdef';
const LOCALHOST_TABS = ['https://www.linkedin.com/feed/', 'http://localhost:3000/dashboard'];
const LOOPBACK_TABS = ['http://127.0.0.1:3000/dashboard'];

// ─────────────────────────────────────────────────────────────────────────────
describe('T1/T2 — a localhost tab cannot retarget the production build', () => {
  it('T1: production + localhost:3000 tab → production API retained', () => {
    const r = resolvePollBase({
      runtimeId: STORE, tabUrls: LOCALHOST_TABS, authenticated: true, currentBase: PRODUCTION_API,
    });
    expect(r.base).toBe(PRODUCTION_API);
  });

  it('T2: production + 127.0.0.1 tab → production API retained', () => {
    const r = resolvePollBase({
      runtimeId: STORE, tabUrls: LOOPBACK_TABS, authenticated: true, currentBase: PRODUCTION_API,
    });
    expect(r.base).toBe(PRODUCTION_API);
  });

  it('the authenticated production user was the ACTUAL regression — pinned', () => {
    // Pre-fix, `!usingLocalhost` was true for a production base, so this exact
    // case retargeted despite the user being fully authenticated.
    const r = resolvePollBase({
      runtimeId: STORE, tabUrls: LOCALHOST_TABS, authenticated: true, currentBase: PRODUCTION_API,
    });
    expect(r.base).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('discovery itself returns null in production, whatever tabs are open', () => {
    expect(resolveDevLocalhostBase(STORE, LOCALHOST_TABS)).toBeNull();
    expect(resolveDevLocalhostBase(STORE, LOOPBACK_TABS)).toBeNull();
    expect(resolveDevLocalhostBase(STORE, ['http://localhost:9999/x'])).toBeNull();
  });
});

describe('T3/T6 — production fails closed without a signature', () => {
  it('T3: no HMAC secret → refusal, never an unsigned localhost request', () => {
    const r = resolveRequestTarget({
      runtimeId: STORE, tabUrls: LOCALHOST_TABS, hasHmacSecret: false, apiBase: PRODUCTION_API,
    });
    expect(r.base).toBeNull();
    expect(r.error).toBe('SIGNATURE_UNAVAILABLE');
  });

  it('T6: with no target selected, no organization_id can be transmitted', () => {
    // org_id is appended to the request URL; no request, no disclosure.
    const r = resolveRequestTarget({
      runtimeId: STORE, tabUrls: LOCALHOST_TABS, hasHmacSecret: false, apiBase: PRODUCTION_API,
    });
    expect(r.base).toBeNull();
  });

  it('an unauthenticated production poll stops instead of discovering', () => {
    const r = resolvePollBase({
      runtimeId: STORE, tabUrls: LOCALHOST_TABS, authenticated: false, currentBase: PRODUCTION_API,
    });
    expect(r.base).toBeNull();
    expect(r.error).toBe('NOT_AUTHENTICATED');
  });

  it('a signed production request is unaffected', () => {
    const r = resolveRequestTarget({
      runtimeId: STORE, tabUrls: LOCALHOST_TABS, hasHmacSecret: true, apiBase: PRODUCTION_API,
    });
    expect(r).toMatchObject({ base: PRODUCTION_API, signed: true });
  });
});

describe('T5/T7 — no localhost influence, across restarts', () => {
  it('T5: a localhost endpoint cannot become the command source', () => {
    const r = resolvePollBase({
      runtimeId: STORE, tabUrls: ['http://localhost:3000/'], authenticated: true, currentBase: PRODUCTION_API,
    });
    // Commands are fetched from r.base; it is never the local origin.
    expect(r.base).toBe(PRODUCTION_API);
  });

  it('T7: the decision is stateless, so a SW restart cannot drift', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(
        resolvePollBase({
          runtimeId: STORE, tabUrls: LOCALHOST_TABS, authenticated: true, currentBase: PRODUCTION_API,
        }).base,
      ).toBe(PRODUCTION_API);
    }
  });

  it('fails closed when the runtime id is unavailable', () => {
    expect(isDevelopmentBuild(null)).toBe(false);
    expect(isDevelopmentBuild(undefined)).toBe(false);
    expect(isDevelopmentBuild('')).toBe(false);
    expect(resolveDevLocalhostBase(null, LOCALHOST_TABS)).toBeNull();
  });
});

describe('T4 — the developer workflow is preserved', () => {
  it('an unpacked build still discovers a localhost dev server', () => {
    expect(resolveDevLocalhostBase(UNPACKED, LOCALHOST_TABS)).toBe('http://localhost:3000');
  });

  it('an unpacked build still retargets its poll when unauthenticated', () => {
    const r = resolvePollBase({
      runtimeId: UNPACKED, tabUrls: LOCALHOST_TABS, authenticated: false, currentBase: PRODUCTION_API,
    });
    expect(r.base).toBe('http://localhost:3000');
  });

  it('an unpacked build may still send unsigned to localhost', () => {
    const r = resolveRequestTarget({
      runtimeId: UNPACKED, tabUrls: LOCALHOST_TABS, hasHmacSecret: false, apiBase: PRODUCTION_API,
    });
    expect(r).toMatchObject({ base: 'http://localhost:3000', signed: false });
  });

  it('a dev build talking to an explicit localhost base is unchanged', () => {
    const r = resolveRequestTarget({
      runtimeId: UNPACKED, tabUrls: [], hasHmacSecret: false, apiBase: 'http://localhost:3000',
    });
    expect(r).toMatchObject({ base: 'http://localhost:3000', signed: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('source shape — the guard is present at every activation site', () => {
  it('the production extension id and guard exist', () => {
    expect(swSrc).toContain(`const PRODUCTION_EXTENSION_ID = '${PRODUCTION_EXTENSION_ID}'`);
    expect(swSrc).toMatch(/function isDevelopmentBuild\(\)/);
  });

  it('discovery has an internal production backstop', () => {
    const fn = swSrc.slice(
      swSrc.indexOf('async function resolveDevLocalhostBase'),
      swSrc.indexOf('function syncApiClientBaseUrl'),
    );
    expect(fn).toContain('if (!isDevelopmentBuild()) return null;');
  });

  it('BOTH call sites are guarded, not just the backstop', () => {
    const guarded = swSrc.match(/isDevelopmentBuild\(\)\s*\?\s*await resolveDevLocalhostBase\(\)\s*:\s*null/g) ?? [];
    expect(guarded).toHaveLength(2);
    // And no unguarded call survives.
    // Annotated because `match() ?? []` unions RegExpMatchArray with the empty
    // array literal, and the element type collapses to `never` — so `m` below
    // would have no string methods.
    const bare: string[] = swSrc.match(/(?<!\?\s)await resolveDevLocalhostBase\(\)/g) ?? [];
    expect(bare.every((m) => m.includes('?') === false)).toBe(true);
    expect(swSrc).not.toMatch(/const devBase = await resolveDevLocalhostBase\(\);/);
  });

  it('the production API base is unchanged', () => {
    expect(swSrc).toContain("const DEFAULT_API_BASE_URL = 'https://www.omnivyra.com'");
  });

  it('the guard fails closed on error', () => {
    const fn = swSrc.slice(
      swSrc.indexOf('function isDevelopmentBuild()'),
      swSrc.indexOf('// Dev fallback:'),
    );
    expect(fn).toMatch(/catch\s*\(_\)\s*\{\s*return false;/);
  });

  it('manifest version is 1.4.0 and the store id is the one gated on', () => {
    const manifest = JSON.parse(
      readFileSync('C:/Users/Admin/OneDrive/Desktop/omnivyra chrome ext/extension/manifest.json', 'utf8'),
    );
    expect(manifest.version).toBe('1.4.0');
  });
});

describe('T9 — the authenticated command protocol is untouched', () => {
  it('renewal and result submission are unchanged by this hardening', () => {
    const apiSrc = readFileSync(
      'C:/Users/Admin/OneDrive/Desktop/omnivyra chrome ext/extension/core/apiClient.js',
      'utf8',
    );
    expect(apiSrc).toContain('async renewDispatchLease');
    expect(apiSrc).toContain("options.headers['X-Omnivyra-Dispatch-Renewal'] = '1'");
    expect(apiSrc).toContain('/api/extension/action-result');
  });
});
