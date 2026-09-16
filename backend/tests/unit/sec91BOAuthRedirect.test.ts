/**
 * SEC91-B4 (OAuth open redirect) + SEC91-B7 (OAuth-state HMAC key reuse, timing).
 *
 * B4 DEFECT: `decodeOAuthState` accepted any returnTo that merely STARTED with '/', so
 * `//evil.example` and `/\evil.example` (both protocol-relative to a browser) passed, and
 * it returned returnTo even when the signature was INVALID — so a hand-crafted callback
 * URL (`state=garbage|//evil.example`) redirected the victim off-site from the error path.
 * The start routes also signed whatever `?returnTo=` they were given.
 *
 * B7 DEFECT: without OAUTH_STATE_HMAC_KEY the state was signed with the raw ENCRYPTION_KEY
 * (the at-rest token-encryption key reused as an HMAC key) and compared with `===`.
 *
 * NOW: one same-origin relative-path validator (`backend/auth/safeRedirect.ts`) is applied
 * at encode AND decode; returnTo is only returned from a correctly signed state; the
 * fallback key is domain-separated HMAC(ENCRYPTION_KEY, 'omnivyra/oauth-state/v1'); the
 * signature compare is constant-time.
 */
import { createHmac } from 'crypto';

const HEX_KEY = 'a'.repeat(64); // fake ENCRYPTION_KEY-shaped fixture
const mockConfig: Record<string, string | undefined> = { ENCRYPTION_KEY: HEX_KEY, OAUTH_STATE_HMAC_KEY: undefined };
jest.mock('@/config', () => ({ config: new Proxy({}, { get: (_t, k: string) => mockConfig[k] }) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encodeOAuthState, decodeOAuthState } = require('../../auth/oauthState');
// Required lazily so the oauthState assertions also run (and fail) on a base without the helper.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const safeRelativeRedirectPath = (v: unknown, fb?: string) => require('../../auth/safeRedirect').safeRelativeRedirectPath(v, fb);

const savedEnv = { k: process.env.OAUTH_STATE_HMAC_KEY, e: process.env.ENCRYPTION_KEY };
beforeEach(() => {
  mockConfig.ENCRYPTION_KEY = HEX_KEY;
  mockConfig.OAUTH_STATE_HMAC_KEY = undefined;
  delete process.env.OAUTH_STATE_HMAC_KEY;
  process.env.ENCRYPTION_KEY = HEX_KEY;
});
afterAll(() => {
  if (savedEnv.k === undefined) delete process.env.OAUTH_STATE_HMAC_KEY; else process.env.OAUTH_STATE_HMAC_KEY = savedEnv.k;
  if (savedEnv.e === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = savedEnv.e;
});

const UNSAFE = [
  '//evil.example',
  '//evil.example/path',
  '/\\evil.example',
  '/\\/evil.example',
  '\\\\evil.example',
  'https://evil.example',
  'javascript:alert(1)',
  '/\t/evil.example',
  '/\n/evil.example',
  ' //evil.example',
  'evil.example',
];
const SAFE = ['/social-platforms', '/community-ai/connectors', '/super-admin/dashboard?tab=a&b=c', '/x#frag', '/a/b/../c'];

describe('safeRelativeRedirectPath', () => {
  it.each(UNSAFE)('rejects %j', (v) => {
    expect(safeRelativeRedirectPath(v)).toBeUndefined();
    expect(safeRelativeRedirectPath(v, '/fallback')).toBe('/fallback');
  });
  it.each(SAFE)('accepts %j unchanged', (v) => {
    expect(safeRelativeRedirectPath(v)).toBe(v);
  });
  it('rejects non-strings and absurd lengths', () => {
    expect(safeRelativeRedirectPath(undefined)).toBeUndefined();
    expect(safeRelativeRedirectPath(['/a'])).toBeUndefined();
    expect(safeRelativeRedirectPath('/' + 'a'.repeat(5000))).toBeUndefined();
  });
});

describe('B4 — decodeOAuthState never yields an off-site returnTo', () => {
  it.each(UNSAFE.filter((u) => !u.includes('\n')))('forged state with returnTo %j (invalid signature) → no returnTo', (u) => {
    const d = decodeOAuthState(`Zm9v.bogus-signature|${u}`);
    expect(d.valid).toBe(false);
    expect(d.returnTo).toBeUndefined();
  });

  it('an invalid signature yields NO returnTo even when the path is same-origin', () => {
    const d = decodeOAuthState('Zm9v.bogus-signature|/settings');
    expect(d.valid).toBe(false);
    expect(d.returnTo).toBeUndefined();
  });

  it.each(UNSAFE.filter((u) => !u.includes('\n')))('the start side refuses to sign returnTo %j', (u) => {
    const state = encodeOAuthState({ companyId: 'c', userId: 'u', returnTo: u });
    expect(state.includes('|')).toBe(false);
    const d = decodeOAuthState(state);
    expect(d.valid).toBe(true);
    expect(d.returnTo).toBeUndefined();
  });

  it('a signed, same-origin returnTo round-trips', () => {
    const d = decodeOAuthState(encodeOAuthState({ companyId: 'c', userId: 'u', returnTo: '/social-platforms?x=1' }));
    expect(d.valid).toBe(true);
    expect(d.returnTo).toBe('/social-platforms?x=1');
    expect(d.companyId).toBe('c');
  });
});

describe('B7 — domain-separated fallback key + constant-time compare', () => {
  const baseOf = (state: string) => state.split('|')[0].slice(0, state.split('|')[0].lastIndexOf('.'));

  it('without OAUTH_STATE_HMAC_KEY the state is NOT signed with the raw ENCRYPTION_KEY', () => {
    const state = encodeOAuthState({ companyId: 'c', userId: 'u' });
    const base = baseOf(state);
    const rawKeySig = createHmac('sha256', HEX_KEY).update(`${base}|`).digest('base64url');
    expect(state.endsWith(`.${rawKeySig}`)).toBe(false);
    // …and a state forged with the raw ENCRYPTION_KEY does not verify.
    expect(decodeOAuthState(`${base}.${rawKeySig}`).valid).toBe(false);
  });

  it('the fallback key is HMAC(ENCRYPTION_KEY, "omnivyra/oauth-state/v1")', () => {
    const state = encodeOAuthState({ companyId: 'c', userId: 'u' });
    const base = baseOf(state);
    const derived = createHmac('sha256', HEX_KEY).update('omnivyra/oauth-state/v1').digest();
    const sig = createHmac('sha256', derived).update(`${base}|`).digest('base64url');
    expect(state).toBe(`${base}.${sig}`);
  });

  it('COMPAT: a dedicated OAUTH_STATE_HMAC_KEY is used verbatim, exactly as before', () => {
    mockConfig.OAUTH_STATE_HMAC_KEY = 'b'.repeat(64);
    const state = encodeOAuthState({ companyId: 'c', userId: 'u', returnTo: '/p' });
    const base = baseOf(state);
    const sig = createHmac('sha256', 'b'.repeat(64)).update(`${base}|/p`).digest('base64url');
    expect(state).toBe(`${base}.${sig}|/p`);
    expect(decodeOAuthState(state).valid).toBe(true);
  });

  it('signature comparison is constant-time (timingSafeEqual), not string ===', () => {
    const src = require('fs').readFileSync('backend/auth/oauthState.ts', 'utf8') as string;
    expect(src).toMatch(/timingSafeEqual/);
    expect(src).not.toMatch(/signature === expected/);
  });

  it('no key at all → encode throws, decode reports invalid (fail closed)', () => {
    mockConfig.ENCRYPTION_KEY = undefined;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encodeOAuthState({ companyId: 'c' })).toThrow(/OAUTH_STATE_KEY_MISSING/);
    expect(decodeOAuthState('Zm9v.x').valid).toBe(false);
  });
});
