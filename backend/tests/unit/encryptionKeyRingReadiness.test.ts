/**
 * ENCRYPTION_KEY key ring — readiness pins for rotation (S-2), on the readers-only build.
 *
 * 1. Malformed ciphertext shapes fail closed: a typed error, never the input echoed back.
 * 2. The memoised ring follows a config change (rotation is picked up without a restart).
 * 3. PRECONDITION, not a target: whatsappBroadcastService.decryptPhone reads ENCRYPTION_KEY
 *    directly, outside the ring, so after a rotation (current B, previous A) a phone encrypted
 *    under A no longer decrypts. ENCRYPTION_KEY must not be rotated until the key-ring reader
 *    for decryptPhone (7097594e, outreach lineage) has shipped. When that lands this case must
 *    flip to "decrypts" — update it then, do not delete it.
 *
 * All keys are synthetic.
 */
import crypto from 'crypto';

const mockConfig: Record<string, string | undefined> = {};
jest.mock('@/config', () => ({ config: mockConfig }));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn() }));

import {
  EncryptionKeyRingError,
  decryptWithKeyRing,
  encryptWithKeyRing,
  encryptionKeyId,
} from '../../auth/encryptionKeyRing';
import { decryptCredential, encryptCredential } from '../../auth/credentialEncryption';
import { decryptPhone } from '../../services/whatsappBroadcastService';

const newKey = (): string => crypto.randomBytes(32).toString('hex');
// KEY_A's id must contain a hex LETTER: the "uppercase key id" case relies on toUpperCase() changing the id, and an
// all-digit id (~2.3% of random keys) left it unchanged, so that case passed vacuously or failed at random
// (FLAKY-KEYRING-001, S1 CI-198 run 43226420375). Draw until the id has a letter - deterministic in effect.
const keyWithLetteredId = (): string => {
  for (let i = 0; i < 1000; i++) {
    const k = newKey();
    if (/[a-f]/.test(encryptionKeyId(Buffer.from(k, 'hex')))) return k;
  }
  throw new Error('no key with a lettered id in 1000 draws');
};
const KEY_A = keyWithLetteredId();
const KEY_B = newKey();

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

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

beforeEach(() => setKeys(KEY_A));

describe('malformed ciphertext fails closed', () => {
  const valid = (): string => gcm(KEY_A, 'secret-value');
  const idA = (): string => encryptionKeyId(Buffer.from(KEY_A, 'hex'));
  const cases: Array<[string, () => string]> = [
    ['empty string', () => ''],
    ['no separators', () => 'abcdef'],
    ['two parts', () => valid().split(':').slice(0, 2).join(':')],
    ['four parts, unknown version', () => `k2:${valid()}`],
    ['k1 with six parts', () => `k1:${idA()}:${valid()}:00`],
    ['uppercase K1 prefix', () => `K1:${idA()}:${valid()}`],
    ['uppercase key id', () => `k1:${idA().toUpperCase()}:${valid()}`],
    ['seven-char key id', () => `k1:${idA().slice(0, 7)}:${valid()}`],
    ['short iv', () => valid().slice(2)],
    ['non-hex iv', () => `zz${valid().slice(2)}`],
    ['odd-length body', () => `${valid()}a`],
  ];
  it('precondition: the uppercase-key-id case really changes the id (never vacuous)', () => {
    expect(idA().toUpperCase()).not.toBe(idA());
  });
  it.each(cases)('%s → typed malformed/unknown error, input never returned', (_name, make) => {
    const data = make();
    const err = thrown(() => decryptWithKeyRing(data));
    expect(err).toBeInstanceOf(EncryptionKeyRingError);
    expect(['malformed_ciphertext', 'unknown_key_id']).toContain((err as EncryptionKeyRingError).code);
    let returned: unknown = null;
    try {
      returned = decryptCredential(data);
    } catch {
      /* fail closed */
    }
    // Existing contract: empty in → empty out (nothing stored). Anything else throws.
    expect(returned).toBe(data === '' ? '' : null);
  });
});

describe('the memoised ring follows a configuration change', () => {
  it('rotation (current B, previous A) is picked up on the next call; writes move to B', () => {
    const underA = encryptCredential('value-a');
    setKeys(KEY_B, KEY_A);
    expect(decryptCredential(underA)).toBe('value-a');
    const underB = encryptWithKeyRing('value-b');
    setKeys(KEY_A);
    expect(() => decryptWithKeyRing(underB)).toThrow(EncryptionKeyRingError);
  });
});

describe('PRECONDITION for rotating ENCRYPTION_KEY: decryptPhone is outside the ring', () => {
  it('before rotation a legacy phone decrypts', () => {
    expect(decryptPhone(gcm(KEY_A, '+15550000001'))).toBe('+15550000001');
  });

  it('after rotation (current B, previous A) a phone encrypted under A does NOT decrypt on this build', () => {
    const phone = gcm(KEY_A, '+15550000001');
    setKeys(KEY_B, KEY_A);
    expect(() => decryptPhone(phone)).toThrow();
    // The ring itself can read it — only decryptPhone bypasses the ring.
    expect(decryptWithKeyRing(phone)).toBe('+15550000001');
  });
});
