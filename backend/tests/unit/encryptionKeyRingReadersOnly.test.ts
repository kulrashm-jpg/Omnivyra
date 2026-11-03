/**
 * ENCRYPTION_KEY key ring — READERS FIRST (backend/auth/encryptionKeyRing.ts).
 *
 * This build reads the legacy `iv:tag:data` format AND the keyed `k1:<keyId>:iv:tag:data`
 * format, under ENCRYPTION_KEY or any key listed in ENCRYPTION_KEY_PREVIOUS — but every
 * WRITER still emits the legacy format under the current key, so a rollback to a
 * pre-key-ring build stays two-way. The keyed fixtures below are built by the test itself
 * (there is deliberately no keyed writer in production code on this build).
 *
 * All keys are synthetic. LEGACY_* fixtures were produced by the pre-key-ring
 * implementation (5025f51d) under LEGACY_KEY — same fixtures as 88b9378b's
 * encryptionKeyRotation.test.ts.
 */
import crypto from 'crypto';

const mockConfig: Record<string, string | undefined> = {};
jest.mock('@/config', () => ({ config: mockConfig }));

const mockSingle = jest.fn();
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn(() => ({ select: () => ({ eq: () => ({ single: mockSingle }) }) })),
}));

import {
  EncryptionKeyRingError,
  decryptWithKeyRing,
  encryptWithKeyRing,
  encryptionKeyId,
  parseEncryptionKeyRing,
  readCiphertextKeyId,
} from '../../auth/encryptionKeyRing';
import { decryptCredential, encryptCredential, requireEncryptionKey } from '../../auth/credentialEncryption';
import { encryptTokenColumns, getToken } from '../../auth/tokenStore';
import { isEncryptedCredential } from '../../security/credentialSafety';
import { maybeDecrypt } from '../../services/analyticsIntegrationServiceProviders';
import { envSchema } from '../../../config/env.schema';

const LEGACY_KEY = 'd4086904dd4125e84990451c0626b7bfe94b28523bda09c34db8ce9548eebaea';
const LEGACY_CREDENTIAL =
  '3f4c67033ba114743dafddd4:034b993064d5c5a8eac808d92bd3ed3d:487df5a08594bfc9cd0f831444e043df7f0826ee2e1e1a083c98ea';
const LEGACY_ACCESS = 'd4f7ef8bd24144b674e24fec:8db498cded662ce21f5e1f7a7d00b7a1:6a8b028bde442d215eb2ba89c1f2ff64b894a3';
const LEGACY_REFRESH =
  '0d7c24e79beba2689384c789:54c54a065f4fd23f26ff7546d4c742bf:b558fed7f9a4467a4605937f7f290c679f28549985e71c3e7412';

/** The legacy shape, exactly: no prefix, iv(24 hex):tag(32 hex):data. */
const LEGACY_SHAPE = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;

const newKey = (): string => crypto.randomBytes(32).toString('hex');
const KEY_A = newKey();
const KEY_B = newKey();
const KEY_C = newKey();

function setKeys(current: string | undefined, previous?: string): void {
  mockConfig.ENCRYPTION_KEY = current;
  mockConfig.ENCRYPTION_KEY_PREVIOUS = previous;
}

function gcm(keyHex: string, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = c.update(plaintext, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${body}`;
}

/** A keyed `k1:` ciphertext as a future keyed writer would produce it (test-only). */
function keyedUnder(keyHex: string, plaintext: string): string {
  return `k1:${encryptionKeyId(Buffer.from(keyHex, 'hex'))}:${gcm(keyHex, plaintext)}`;
}

/** The PRE-key-ring reader (5025f51d credentialEncryption.decryptCredential), verbatim logic. */
function preKeyRingDecrypt(keyHex: string, data: string): string {
  const parts = data.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted credential format');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(parts[0], 'hex'));
  d.setAuthTag(Buffer.from(parts[1], 'hex'));
  return d.update(parts[2], 'hex', 'utf8') + d.final('utf8');
}

function thrown(fn: () => unknown): EncryptionKeyRingError {
  try {
    fn();
  } catch (err) {
    return err as EncryptionKeyRingError;
  }
  throw new Error('expected a throw');
}

let warn: jest.SpyInstance;
let error: jest.SpyInstance;
beforeEach(() => {
  setKeys(KEY_A);
  mockSingle.mockReset();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe('legacy ciphertext decrypts exactly as before', () => {
  it('credentialEncryption, tokenStore and maybeDecrypt read pre-key-ring fixtures (previous unset)', async () => {
    setKeys(LEGACY_KEY);
    expect(decryptCredential(LEGACY_CREDENTIAL)).toBe('legacy-credential-plaintext');
    expect(readCiphertextKeyId(LEGACY_CREDENTIAL)).toBeNull();
    expect(maybeDecrypt(LEGACY_ACCESS)).toBe('legacy-access-token');
    mockSingle.mockResolvedValue({
      data: { access_token: LEGACY_ACCESS, refresh_token: LEGACY_REFRESH, token_expires_at: null, is_active: true },
      error: null,
    });
    const token = await getToken('acct-legacy');
    expect(token?.access_token).toBe('legacy-access-token');
    expect(token?.refresh_token).toBe('legacy-refresh-token-é✓');
  });

  it('legacy written under a key now in ENCRYPTION_KEY_PREVIOUS still decrypts', () => {
    setKeys(KEY_B, LEGACY_KEY);
    expect(decryptCredential(LEGACY_CREDENTIAL)).toBe('legacy-credential-plaintext');
    expect(maybeDecrypt(LEGACY_ACCESS)).toBe('legacy-access-token');
  });

  it('legacy under a key that is not configured fails closed (throws; maybeDecrypt → null)', () => {
    setKeys(KEY_A);
    expect(thrown(() => decryptCredential(LEGACY_CREDENTIAL)).code).toBe('decrypt_failed');
    expect(maybeDecrypt(LEGACY_ACCESS)).toBeNull();
  });
});

describe('keyed k1 ciphertext is READ', () => {
  it('k1 under the current key decrypts (credentialEncryption, tokenStore, maybeDecrypt)', async () => {
    setKeys(KEY_A);
    const ct = keyedUnder(KEY_A, 'k1-current');
    expect(decryptCredential(ct)).toBe('k1-current');
    expect(readCiphertextKeyId(ct)).toBe(encryptionKeyId(Buffer.from(KEY_A, 'hex')));
    expect(maybeDecrypt(ct)).toBe('k1-current');
    mockSingle.mockResolvedValue({
      data: { access_token: keyedUnder(KEY_A, 'acc'), refresh_token: keyedUnder(KEY_A, 'ref'), token_expires_at: null, is_active: true },
      error: null,
    });
    const token = await getToken('acct-k1');
    expect(token?.access_token).toBe('acc');
    expect(token?.refresh_token).toBe('ref');
  });

  it('k1 under a key listed in ENCRYPTION_KEY_PREVIOUS decrypts (second entry too)', () => {
    const underA = keyedUnder(KEY_A, 'k1-previous');
    const underC = keyedUnder(KEY_C, 'k1-previous-2');
    setKeys(KEY_B, `${KEY_A}, ${KEY_C}`);
    expect(decryptCredential(underA)).toBe('k1-previous');
    expect(decryptCredential(underC)).toBe('k1-previous-2');
    expect(maybeDecrypt(underA)).toBe('k1-previous');
  });

  it('k1 naming an unknown key id fails closed: typed error, tokenStore null, maybeDecrypt null', async () => {
    const ct = keyedUnder(KEY_C, 'k1-unknown');
    setKeys(KEY_A, KEY_B);
    const err = thrown(() => decryptCredential(ct));
    expect(err).toBeInstanceOf(EncryptionKeyRingError);
    expect(err.code).toBe('unknown_key_id');
    for (const k of [KEY_A, KEY_B, KEY_C]) expect(err.message).not.toContain(k);
    expect(err.message).not.toContain(ct.split(':')[4]);
    expect(maybeDecrypt(ct)).toBeNull();
    mockSingle.mockResolvedValue({ data: { access_token: ct, refresh_token: null, token_expires_at: null, is_active: true }, error: null });
    expect(await getToken('acct-unknown')).toBeNull();
    const logged = JSON.stringify([warn.mock.calls, error.mock.calls]);
    expect(logged).not.toContain(ct);
    expect(logged).not.toContain('k1-unknown');
  });

  it('k1 with a valid key id but the wrong key bytes / tampered body fails closed', () => {
    setKeys(KEY_A);
    const idA = encryptionKeyId(Buffer.from(KEY_A, 'hex'));
    const forged = `k1:${idA}:${gcm(KEY_B, 'forged')}`;
    expect(thrown(() => decryptCredential(forged)).code).toBe('decrypt_failed');
    expect(maybeDecrypt(forged)).toBeNull();
    expect(thrown(() => decryptCredential('k1:ZZZZZZZZ:aa:bb:cc')).code).toBe('malformed_ciphertext');
    expect(maybeDecrypt('k1:zzzzzzzz:aa:bb:cc')).toBeNull();
  });

  it('isEncryptedCredential recognises both shapes (a k1 value is never treated as plaintext)', () => {
    expect(isEncryptedCredential(LEGACY_CREDENTIAL)).toBe(true);
    expect(isEncryptedCredential(keyedUnder(KEY_A, 'x'))).toBe(true);
    expect(isEncryptedCredential('k1:zzzzzzzz:aa:bb:cc')).toBe(false);
  });

  it('plaintext GA4/GSC tokens are still returned as stored', () => {
    expect(maybeDecrypt('ya29.plaintext-token')).toBe('ya29.plaintext-token');
    expect(maybeDecrypt('1//refresh-plaintext')).toBe('1//refresh-plaintext');
  });
});

describe('WRITERS still emit the legacy format (no k1 write on this build)', () => {
  it('encryptCredential output is legacy-shaped, has no k1 prefix, and opens with the PRE-key-ring reader', () => {
    setKeys(KEY_B, KEY_A);
    const enc = encryptCredential('  writer-check  ');
    expect(enc).toMatch(LEGACY_SHAPE);
    expect(enc.startsWith('k1:')).toBe(false);
    expect(enc.split(':')).toHaveLength(3);
    expect(readCiphertextKeyId(enc)).toBeNull();
    // Written under the CURRENT key (B), never a previous one, and readable by old code.
    expect(preKeyRingDecrypt(KEY_B, enc)).toBe('writer-check');
    expect(() => preKeyRingDecrypt(KEY_A, enc)).toThrow();
    expect(decryptCredential(enc)).toBe('writer-check');
  });

  it('encryptWithKeyRing (the shared writer) is legacy-shaped too', () => {
    const ring = parseEncryptionKeyRing(KEY_A, KEY_B);
    const enc = encryptWithKeyRing('ring-writer', ring);
    expect(enc).toMatch(LEGACY_SHAPE);
    expect(preKeyRingDecrypt(KEY_A, enc)).toBe('ring-writer');
    expect(decryptWithKeyRing(enc, ring)).toBe('ring-writer');
  });

  it('tokenStore.encryptTokenColumns writes legacy-shaped access/refresh tokens', () => {
    setKeys(KEY_A, KEY_B);
    const cols = encryptTokenColumns({ access_token: 'acc', refresh_token: 'ref' });
    expect(cols.access_token).toMatch(LEGACY_SHAPE);
    expect(cols.refresh_token).toMatch(LEGACY_SHAPE);
    expect(preKeyRingDecrypt(KEY_A, cols.access_token as string)).toBe('acc');
    expect(preKeyRingDecrypt(KEY_A, cols.refresh_token as string)).toBe('ref');
  });

  it('requireEncryptionKey (whatsapp) still returns the current key bytes', () => {
    setKeys(KEY_A, KEY_B);
    expect(requireEncryptionKey().equals(Buffer.from(KEY_A, 'hex'))).toBe(true);
  });
});

describe('ring configuration fails closed without echoing key material', () => {
  it('malformed / duplicate ENCRYPTION_KEY_PREVIOUS is refused', () => {
    const bad = crypto.randomBytes(32).toString('base64');
    const e1 = thrown(() => parseEncryptionKeyRing(KEY_A, bad));
    expect(e1.code).toBe('previous_invalid');
    expect(e1.message).not.toContain(bad);
    expect(thrown(() => parseEncryptionKeyRing(KEY_A, `${KEY_B},`)).code).toBe('previous_invalid');
    expect(thrown(() => parseEncryptionKeyRing(KEY_A, KEY_A)).code).toBe('previous_duplicate');
    expect(thrown(() => parseEncryptionKeyRing(KEY_A, `${KEY_B},${KEY_B}`)).code).toBe('previous_duplicate');
    expect(parseEncryptionKeyRing(KEY_A, '').previous).toHaveLength(0);
  });

  it('env schema accepts an unset or well-formed ENCRYPTION_KEY_PREVIOUS and refuses a malformed one', () => {
    const prev = envSchema.shape.ENCRYPTION_KEY_PREVIOUS;
    expect(prev.safeParse(undefined).success).toBe(true);
    expect(prev.safeParse(`${KEY_A},${KEY_B}`).success).toBe(true);
    expect(prev.safeParse('not-a-key').success).toBe(false);
  });
});
