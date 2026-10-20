/**
 * WP3 / L3 — the outreach unsubscribe token: authenticity, confidentiality,
 * key rotation and fail-closed behaviour. Pure; no database, no network.
 */
import {
  MAX_TOKEN_LENGTH,
  UNSUBSCRIBE_TOKEN_KEYS_ENV,
  UnsubscribeTokenError,
  buildOutreachUnsubscribeUrl,
  issueOutreachUnsubscribeToken,
  verifyOutreachUnsubscribeToken,
} from '../../security/outreachUnsubscribeToken';

const KEY_A = 'a'.repeat(40);
const KEY_B = 'b'.repeat(40);
const ORG = '00000000-0000-4000-8000-00000000000a';
const ATTEMPT = '00000000-0000-4000-8000-0000000000f1';
const RECIPIENT = 'Jane.Doe+news@Example.Test';

const withKeys = (value: string | undefined) => {
  if (value === undefined) delete process.env[UNSUBSCRIBE_TOKEN_KEYS_ENV];
  else process.env[UNSUBSCRIBE_TOKEN_KEYS_ENV] = value;
};

const issue = (over: Record<string, unknown> = {}) =>
  issueOutreachUnsubscribeToken({ organizationId: ORG, attemptId: ATTEMPT, recipient: RECIPIENT, ...over } as never);

/** Flip one base64url character inside a segment, keeping it well-formed. */
const flip = (token: string, segment: number): string => {
  const parts = token.split('.');
  const s = parts[segment];
  const i = Math.floor(s.length / 2);
  parts[segment] = s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  return parts.join('.');
};

const prior = process.env[UNSUBSCRIBE_TOKEN_KEYS_ENV];
beforeEach(() => withKeys(`k2:${KEY_A}`));
afterAll(() => withKeys(prior));

describe('WP3/L3 — round trip', () => {
  it('issues and verifies, returning exactly what was bound', () => {
    const v = verifyOutreachUnsubscribeToken(issue());
    expect(v.ok).toBe(true);
    expect(v.payload).toMatchObject({
      organizationId: ORG, attemptId: ATTEMPT, scope: '*', recipient: RECIPIENT, keyId: 'k2',
    });
  });

  it('two tokens for the same input differ (random IV) and both verify', () => {
    const a = issue();
    const b = issue();
    expect(a).not.toBe(b);
    expect(verifyOutreachUnsubscribeToken(a).ok).toBe(true);
    expect(verifyOutreachUnsubscribeToken(b).ok).toBe(true);
  });

  it('is DURABLE: a token issued ten years ago still verifies (unsubscribes are not time-limited)', () => {
    const tenYearsAgo = Date.now() - 10 * 365 * 24 * 3600 * 1000;
    expect(verifyOutreachUnsubscribeToken(issue({ now: tenYearsAgo })).ok).toBe(true);
  });

  it('refuses a token claiming to be issued in the future', () => {
    const later = Date.now() + 3600 * 1000;
    expect(verifyOutreachUnsubscribeToken(issue({ now: later })).failure).toBe('issued_in_future');
  });
});

describe('WP3/L3 — the recipient never appears in the token or URL', () => {
  it('neither the token nor the URL contains the address, its local part or its domain', () => {
    const token = issue();
    const url = buildOutreachUnsubscribeUrl(token, 'https://app.example.test/some/path');
    for (const needle of [RECIPIENT, RECIPIENT.toLowerCase(), 'jane.doe', 'Jane.Doe', 'example.test', '%40']) {
      expect(token).not.toContain(needle);
      expect(url.replace('https://app.example.test', '')).not.toContain(needle);
    }
    expect(url.startsWith('https://app.example.test/api/outreach/unsubscribe?t=')).toBe(true);
  });

  it('stays short enough for the List-Unsubscribe header (SES limit 995)', () => {
    const longest = `${'x'.repeat(64)}@${'y'.repeat(180)}.test`;
    const token = issue({ recipient: longest, organizationId: 'o'.repeat(64), attemptId: 'a'.repeat(64) });
    expect(token.length).toBeLessThanOrEqual(MAX_TOKEN_LENGTH);
    const header = `<${buildOutreachUnsubscribeUrl(token, 'https://app.omnivyra.com')}>`;
    expect(header.length).toBeLessThan(995);
  });
});

describe('WP3/L3 — tampering fails authentication', () => {
  it.each([[2, 'IV'], [3, 'ciphertext/tag']])('a changed %s segment (%s) is refused', (segment) => {
    const v = verifyOutreachUnsubscribeToken(flip(issue(), segment as number));
    expect(v.ok).toBe(false);
    expect(['authentication_failed', 'malformed']).toContain(v.failure);
  });

  it('re-labelling the key id is refused even when that key exists (key id is bound as AAD)', () => {
    withKeys(`k2:${KEY_A},k9:${KEY_A}`);
    const relabelled = issue().replace(/^u1\.k2\./, 'u1.k9.');
    expect(verifyOutreachUnsubscribeToken(relabelled).failure).toBe('authentication_failed');
  });

  it.each([
    ['empty', ''],
    ['not a token', 'hello'],
    ['wrong format version', 'u2.k2.AAAA.BBBB'],
    ['bad characters', 'u1.k2.AA$A.BBBB'],
    ['wrong part count', 'u1.k2.AAAA'],
    ['too long', `u1.k2.${'A'.repeat(900)}.B`],
  ])('a malformed token (%s) is refused without throwing', (_label, token) => {
    expect(() => verifyOutreachUnsubscribeToken(token)).not.toThrow();
    expect(verifyOutreachUnsubscribeToken(token).ok).toBe(false);
  });

  it('a non-string is refused', () => {
    expect(verifyOutreachUnsubscribeToken(undefined).ok).toBe(false);
    expect(verifyOutreachUnsubscribeToken({}).ok).toBe(false);
  });
});

describe('WP3/L3 — keys, rotation and configuration', () => {
  it('rotation: a token under the previous key still verifies while that key is listed', () => {
    withKeys(`k1:${KEY_B}`);
    const old = issue();
    withKeys(`k2:${KEY_A},k1:${KEY_B}`);
    expect(verifyOutreachUnsubscribeToken(old)).toMatchObject({ ok: true, payload: { keyId: 'k1' } });
    // New tokens use the FIRST (active) key.
    expect(verifyOutreachUnsubscribeToken(issue()).payload?.keyId).toBe('k2');
  });

  it('retirement: once the old key is removed its tokens fail as unknown_key', () => {
    withKeys(`k1:${KEY_B}`);
    const old = issue();
    withKeys(`k2:${KEY_A}`);
    expect(verifyOutreachUnsubscribeToken(old).failure).toBe('unknown_key');
  });

  it('a different secret under the same key id fails authentication', () => {
    const token = issue();
    withKeys(`k2:${KEY_B}`);
    expect(verifyOutreachUnsubscribeToken(token).failure).toBe('authentication_failed');
  });

  it('a missing key list: issuing THROWS (no send), verifying fails closed', () => {
    const token = issue();
    withKeys(undefined);
    expect(() => issue()).toThrow(UnsubscribeTokenError);
    expect(verifyOutreachUnsubscribeToken(token).failure).toBe('key_config_missing');
  });

  it.each([
    ['short secret', `k2:${'x'.repeat(31)}`],
    ['no separator', `k2${KEY_A}`],
    ['bad key id', `K-2:${KEY_A}`],
    ['duplicate key id', `k2:${KEY_A},k2:${KEY_B}`],
  ])('an invalid key list (%s) refuses to issue and fails verification closed', (_label, value) => {
    const token = issue();
    withKeys(value);
    expect(() => issue()).toThrow(UnsubscribeTokenError);
    expect(verifyOutreachUnsubscribeToken(token).ok).toBe(false);
  });

  it('does not reuse SESSION_COOKIE_SECRET', () => {
    withKeys(undefined);
    process.env.SESSION_COOKIE_SECRET = 'c'.repeat(64);
    expect(() => issue()).toThrow(UnsubscribeTokenError);
  });
});

describe('WP3/L3 — input and URL validation', () => {
  it.each([
    ['bad recipient', { recipient: 'not-an-address' }],
    ['blank tenant', { organizationId: ' ' }],
    ['blank attempt', { attemptId: '' }],
    ['unapproved scope', { scope: 'email' }],
  ])('refuses to issue for %s', (_label, over) => {
    expect(() => issue(over)).toThrow(UnsubscribeTokenError);
  });

  it.each([['http', 'http://app.example.test'], ['relative', '/x'], ['missing', undefined]])(
    'refuses a non-https base URL (%s)', (_label, base) => {
      expect(() => buildOutreachUnsubscribeUrl(issue(), base as string)).toThrow(UnsubscribeTokenError);
    },
  );
});
