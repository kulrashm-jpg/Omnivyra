/**
 * analyticsProviderConfigService.decryptIfNeeded must never return ciphertext.
 *
 * Regression: a value in the encrypted format that failed to decrypt (wrong or
 * rotated ENCRYPTION_KEY, corrupted row) was returned as-is, so the ciphertext
 * became the Google OAuth client id/secret and its first characters were shown in
 * the admin summary. Legacy plaintext values must keep working.
 */
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const mockConfig: { ENCRYPTION_KEY: string } = { ENCRYPTION_KEY: KEY_A };

jest.mock('@/config', () => ({ config: mockConfig }));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('no database in this test'); } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { decryptIfNeeded } = require('../../services/analyticsProviderConfigService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encryptCredential } = require('../../auth/credentialEncryption');

describe('analytics provider config — decryptIfNeeded fails closed on undecryptable ciphertext', () => {
  afterEach(() => { mockConfig.ENCRYPTION_KEY = KEY_A; jest.restoreAllMocks(); });

  it('decrypts a value encrypted under the current key', () => {
    const enc = encryptCredential('client-id-123.apps.googleusercontent.com');
    expect(decryptIfNeeded(enc)).toBe('client-id-123.apps.googleusercontent.com');
  });

  it('returns a legacy plaintext value unchanged (not in the encrypted format)', () => {
    expect(decryptIfNeeded('legacy-plaintext-client-id')).toBe('legacy-plaintext-client-id');
  });

  it('THE REGRESSION: ciphertext under another key is treated as not configured, never returned', () => {
    const enc = encryptCredential('secret-under-key-a');
    mockConfig.ENCRYPTION_KEY = KEY_B;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(decryptIfNeeded(enc)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(enc);
  });

  it('a corrupted encrypted-format value is treated as not configured', () => {
    const enc: string = encryptCredential('x');
    const tampered = `${enc.slice(0, -2)}${enc.endsWith('00') ? '11' : '00'}`;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(decryptIfNeeded(tampered)).toBeNull();
  });

  it('empty and missing values are null', () => {
    expect(decryptIfNeeded(null)).toBeNull();
    expect(decryptIfNeeded(undefined)).toBeNull();
    expect(decryptIfNeeded('')).toBeNull();
  });
});
