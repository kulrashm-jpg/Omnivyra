/**
 * Credential readers that returned an unusable or forbidden value instead of failing
 * closed (agentE 2026-11-03 review of the candidate):
 *   - analyticsIntegrationServiceProviders.maybeDecrypt returned a stored GA4/GSC token
 *     in the encrypted iv:tag:data shape unchanged when it could not be decrypted, so the
 *     ciphertext went to Google as a bearer / refresh token;
 *   - metaAuthService.resolveClientRef resolved ANY uppercase env-var name stored in
 *     social_accounts.auth_client_*_ref, including platform infrastructure secrets, and
 *     sent the value to Meta as the OAuth client id/secret.
 * Plaintext legacy values and decryptable values behave exactly as before. Keys are synthetic.
 */
import crypto from 'crypto';

const mockConfig: Record<string, string | undefined> = {};
jest.mock('@/config', () => ({ config: mockConfig }));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn() }));

import { maybeDecrypt } from '../../services/analyticsIntegrationServiceProviders';
import { resolveClientRef } from '../../auth/metaAuthService';
import { encryptCredential } from '../../auth/credentialEncryption';

const KEY_A = crypto.randomBytes(32).toString('hex');
const KEY_B = crypto.randomBytes(32).toString('hex');

describe('maybeDecrypt fails closed on undecryptable encrypted-shape tokens', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => warn.mockRestore());

  it('decryptable iv:tag:data decrypts (unchanged)', () => {
    mockConfig.ENCRYPTION_KEY = KEY_A;
    expect(maybeDecrypt(encryptCredential('ya29.synthetic'))).toBe('ya29.synthetic');
  });

  it('plaintext and empty values are unchanged', () => {
    mockConfig.ENCRYPTION_KEY = KEY_A;
    expect(maybeDecrypt('ya29.plaintext-token')).toBe('ya29.plaintext-token');
    expect(maybeDecrypt('1//refresh-plaintext')).toBe('1//refresh-plaintext');
    expect(maybeDecrypt('')).toBeNull();
    expect(maybeDecrypt(null)).toBeNull();
  });

  it('iv:tag:data under another key is null, never the ciphertext, and the log names no value', () => {
    mockConfig.ENCRYPTION_KEY = KEY_A;
    const ct = encryptCredential('ya29.other-key');
    mockConfig.ENCRYPTION_KEY = KEY_B;
    expect(maybeDecrypt(ct)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(ct.split(':')[2]);
  });

  it('a malformed encrypted-shape value is null', () => {
    mockConfig.ENCRYPTION_KEY = KEY_A;
    expect(maybeDecrypt('abcd:ef01:zz')).toBeNull();
  });
});

describe('resolveClientRef never resolves a platform infrastructure secret', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  let warn: jest.SpyInstance;
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => warn.mockRestore());

  it('a Meta app env name still resolves (unchanged)', () => {
    process.env.META_APP_SECRET = 'synthetic-meta-secret';
    expect(resolveClientRef('META_APP_SECRET', ['META_APP_SECRET'])).toBe('synthetic-meta-secret');
  });

  it('no ref falls back to the Meta env names (unchanged)', () => {
    process.env.META_APP_ID = 'synthetic-app-id';
    expect(resolveClientRef(null, ['META_APP_ID', 'META_CLIENT_ID'])).toBe('synthetic-app-id');
  });

  it('a direct (non env-name) value is returned as stored (unchanged)', () => {
    expect(resolveClientRef('1234567890', 'META_APP_ID')).toBe('1234567890');
  });

  it.each(['SUPABASE_SECRET_KEY', 'ENCRYPTION_KEY', 'DATABASE_URL', 'REDIS_URL', 'CRON_SECRET', 'STRIPE_SECRET_KEY'])(
    '%s is refused (null) even when set',
    (name) => {
      process.env[name] = 'synthetic-infra-secret';
      expect(resolveClientRef(name, 'META_APP_SECRET')).toBeNull();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-infra-secret');
    },
  );
});
