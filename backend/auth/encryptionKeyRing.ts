/**
 * Encryption key ring — ENCRYPTION_KEY rotation (dual-key) support.
 *
 * ONE place that turns the at-rest AES-256-GCM key configuration into key bytes, encrypts
 * with the current key and decrypts with whichever configured key a ciphertext was written
 * under. tokenStore and credentialEncryption delegate here, so every reader agrees on the
 * key bytes and on the ciphertext format.
 *
 * ─── KEYS ─────────────────────────────────────────────────────────────────
 *   ENCRYPTION_KEY           the CURRENT key: 64 hex characters (32 bytes). Encrypts
 *                            everything new; decrypts too.
 *   ENCRYPTION_KEY_PREVIOUS  OPTIONAL, comma-separated 64-hex keys that are still accepted
 *                            for DECRYPTION only. Never used to encrypt.
 * Both are strict hex (SEC91-B12: no base64 guessing). A malformed previous entry, or one
 * that repeats the current key or another entry, refuses the whole ring — a half-parsed
 * key list would turn into "some rows silently stop decrypting".
 *
 * ─── CIPHERTEXT FORMAT ────────────────────────────────────────────────────
 *   legacy (WRITTEN and read):          ivHex(24):tagHex(32):cipherHex
 *   keyed  (READ ONLY on this build):   k1:keyId(8):ivHex(24):tagHex(32):cipherHex
 * READERS FIRST: this build only learns to READ the keyed form (and keys listed in
 * ENCRYPTION_KEY_PREVIOUS). encryptWithKeyRing still writes the legacy form under the
 * current key, so every value written here stays readable by pre-key-ring builds and a
 * rollback stays two-way. Switching the writer to the keyed form is a separate, separately
 * approved change that must ship only after this reader is deployed everywhere.
 * The keyed form is the legacy form with a `k1:<keyId>:` prefix; the AES-GCM part is
 * byte-for-byte the same construction. keyId = first 8 hex of
 * SHA-256('omnivyra/encryption-key-id/v1' || keyBytes): a 32-bit, domain-separated
 * fingerprint of a 256-bit random key — it names the key without revealing it.
 *
 * Decryption: a keyed ciphertext is opened ONLY with the key whose id it carries (an id
 * that is not configured fails as `unknown_key_id`). A legacy ciphertext carries no id, so
 * the current key is tried first and then each previous key; the GCM tag makes a
 * wrong-key attempt fail authentication instead of returning garbage. With
 * ENCRYPTION_KEY_PREVIOUS unset, legacy data decrypts exactly as it did before.
 *
 * Nothing here logs key material, plaintext or ciphertext. Errors carry a code and, at
 * most, a key id.
 */

import crypto from 'crypto';
import { config } from '@/config';

export const ENCRYPTION_KEY_ENV = 'ENCRYPTION_KEY';
export const ENCRYPTION_KEY_PREVIOUS_ENV = 'ENCRYPTION_KEY_PREVIOUS';

/** Version tag of the keyed ciphertext format. */
export const KEYED_CIPHERTEXT_VERSION = 'k1';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM requires 12 bytes IV (not 16)
const TAG_LENGTH = 16; // GCM tag is always 16 bytes
const KEY_LENGTH = 32; // AES-256 requires 32 bytes key
const KEY_HEX_RE = /^[0-9a-fA-F]{64}$/;
const KEY_ID_RE = /^[0-9a-f]{8}$/;
const KEY_ID_LABEL = 'omnivyra/encryption-key-id/v1';
const IV_HEX_RE = new RegExp(`^[0-9a-fA-F]{${IV_LENGTH * 2}}$`);
const TAG_HEX_RE = new RegExp(`^[0-9a-fA-F]{${TAG_LENGTH * 2}}$`);
const BODY_HEX_RE = /^(?:[0-9a-fA-F]{2})*$/;

export type EncryptionKeyRingErrorCode =
  | 'key_missing'
  | 'key_invalid'
  | 'previous_invalid'
  | 'previous_duplicate'
  | 'malformed_ciphertext'
  | 'unknown_key_id'
  | 'decrypt_failed';

/** Typed failure. The message names the variable or a key id — never key bytes or data. */
export class EncryptionKeyRingError extends Error {
  constructor(readonly code: EncryptionKeyRingErrorCode, message: string) {
    super(message);
    this.name = 'EncryptionKeyRingError';
  }
}

export interface EncryptionKeyEntry {
  /** Non-reversible key fingerprint carried by keyed ciphertexts. */
  readonly id: string;
  readonly key: Buffer;
}

export interface EncryptionKeyRing {
  readonly current: EncryptionKeyEntry;
  /** Decrypt-only keys, in the order configured. */
  readonly previous: readonly EncryptionKeyEntry[];
}

export function encryptionKeyId(key: Buffer): string {
  return crypto.createHash('sha256').update(KEY_ID_LABEL).update(key).digest('hex').slice(0, 8);
}

function toEntry(key: Buffer): EncryptionKeyEntry {
  return { id: encryptionKeyId(key), key };
}

/**
 * Strict hex parse of the CURRENT key. Throws `key_missing` / `key_invalid`; the messages
 * keep the wording the two previous parsers used so existing operator runbooks still match.
 */
function parseCurrentKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new EncryptionKeyRingError('key_missing', 'ENCRYPTION_KEY environment variable is required');
  }
  if (!KEY_HEX_RE.test(raw)) {
    throw new EncryptionKeyRingError(
      'key_invalid',
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes); base64 keys are not accepted. ' +
        'Base64 and hex are NOT byte-identical interpretations — converting a key means re-encrypting existing data.',
    );
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new EncryptionKeyRingError('key_invalid', `ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (got ${key.length})`);
  }
  return key;
}

/**
 * Parse ENCRYPTION_KEY_PREVIOUS. Unset / blank → no previous keys. Entries are trimmed;
 * an empty entry (e.g. a trailing comma) is malformed, not ignored.
 */
export function parsePreviousEncryptionKeys(raw: string | undefined): Buffer[] {
  if (raw === undefined || raw === null || raw.trim() === '') return [];
  return raw.split(',').map((part, index) => {
    const hex = part.trim();
    if (!KEY_HEX_RE.test(hex)) {
      throw new EncryptionKeyRingError(
        'previous_invalid',
        `ENCRYPTION_KEY_PREVIOUS entry #${index + 1} must be exactly 64 hex characters (32 bytes); ` +
          'entries are comma-separated.',
      );
    }
    return Buffer.from(hex, 'hex');
  });
}

/** Pure: build a ring from raw values. Refuses duplicates (and, defensively, key-id collisions). */
export function parseEncryptionKeyRing(currentRaw: string | undefined, previousRaw: string | undefined): EncryptionKeyRing {
  const current = toEntry(parseCurrentKey(currentRaw));
  const previous: EncryptionKeyEntry[] = [];
  const seen: EncryptionKeyEntry[] = [current];
  parsePreviousEncryptionKeys(previousRaw).forEach((key, index) => {
    const entry = toEntry(key);
    for (const other of seen) {
      if (other.key.equals(entry.key)) {
        throw new EncryptionKeyRingError(
          'previous_duplicate',
          `ENCRYPTION_KEY_PREVIOUS entry #${index + 1} repeats ${other === current ? 'ENCRYPTION_KEY' : 'an earlier entry'}.`,
        );
      }
      if (other.id === entry.id) {
        // 2^-32 per pair — generate a different key rather than ship ambiguous ids.
        throw new EncryptionKeyRingError(
          'previous_duplicate',
          `ENCRYPTION_KEY_PREVIOUS entry #${index + 1} has the same key id as another configured key; generate a different key.`,
        );
      }
    }
    seen.push(entry);
    previous.push(entry);
  });
  return { current, previous };
}

// Memoised on the raw configuration so a hot decrypt loop does not re-hash keys, while a
// config change (tests, hot reload) is still picked up on the next call.
let cached: { currentRaw: string | undefined; previousRaw: string | undefined; ring: EncryptionKeyRing } | null = null;

/** The ring from validated config. Throws `EncryptionKeyRingError` on any misconfiguration. */
export function loadEncryptionKeyRing(): EncryptionKeyRing {
  const currentRaw = config.ENCRYPTION_KEY;
  const previousRaw = config.ENCRYPTION_KEY_PREVIOUS;
  // ct-ok: memo-cache check between two server-held config reads; neither operand is request input.
  if (cached && cached.currentRaw === currentRaw && cached.previousRaw === previousRaw) return cached.ring;
  const ring = parseEncryptionKeyRing(currentRaw, previousRaw);
  cached = { currentRaw, previousRaw, ring };
  return ring;
}

/** Key ids only — safe to print in ops output. */
export function describeEncryptionKeyRing(ring: EncryptionKeyRing): { currentKeyId: string; previousKeyIds: string[] } {
  return { currentKeyId: ring.current.id, previousKeyIds: ring.previous.map((e) => e.id) };
}

interface ParsedCiphertext {
  format: 'keyed' | 'legacy';
  keyId: string | null;
  iv: Buffer;
  tag: Buffer;
  body: string;
}

function malformed(): EncryptionKeyRingError {
  return new EncryptionKeyRingError('malformed_ciphertext', 'Invalid encrypted data format');
}

function parseCiphertext(data: string): ParsedCiphertext {
  const parts = data.split(':');
  let format: ParsedCiphertext['format'];
  let keyId: string | null = null;
  let ivHex: string;
  let tagHex: string;
  let body: string;
  if (parts.length === 5 && parts[0] === KEYED_CIPHERTEXT_VERSION) {
    format = 'keyed';
    [, keyId, ivHex, tagHex, body] = parts;
    if (!KEY_ID_RE.test(keyId)) throw malformed();
  } else if (parts.length === 3) {
    format = 'legacy';
    [ivHex, tagHex, body] = parts;
  } else {
    throw malformed();
  }
  if (!IV_HEX_RE.test(ivHex) || !TAG_HEX_RE.test(tagHex) || !BODY_HEX_RE.test(body)) throw malformed();
  return { format, keyId, iv: Buffer.from(ivHex, 'hex'), tag: Buffer.from(tagHex, 'hex'), body };
}

/**
 * The key id a ciphertext names, `null` for the legacy (unlabelled) format. Throws
 * `malformed_ciphertext` for anything that is neither.
 */
export function readCiphertextKeyId(data: string): string | null {
  return parseCiphertext(data).keyId;
}

function openWith(key: Buffer, parsed: ParsedCiphertext): string | null {
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, parsed.iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(parsed.tag);
    let decrypted = decipher.update(parsed.body, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // Wrong key or tampered data — GCM authentication failed. Swallowed deliberately: the
    // underlying error carries no key material, but the caller decides what to report.
    return null;
  }
}

/**
 * Encrypt with the CURRENT key into the LEGACY `iv:tag:data` format (readers-first: the
 * keyed writer is not enabled on this build — see the header). Byte-for-byte the
 * construction the pre-key-ring credentialEncryption / tokenStore used.
 */
export function encryptWithKeyRing(plaintext: string, ring: EncryptionKeyRing = loadEncryptionKeyRing()): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ring.current.key, iv, { authTagLength: TAG_LENGTH });
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), encrypted].join(':');
}

export interface KeyRingDecryption {
  plaintext: string;
  /** The id of the key that opened it (for legacy data: the key that authenticated). */
  keyId: string;
  format: 'keyed' | 'legacy';
}

/** Decrypt and report which key opened the value (used by the re-encryption utility). */
export function decryptWithKeyRingDetailed(data: string, ring: EncryptionKeyRing = loadEncryptionKeyRing()): KeyRingDecryption {
  const parsed = parseCiphertext(data);
  if (parsed.format === 'keyed') {
    const entry = [ring.current, ...ring.previous].find((e) => e.id === parsed.keyId);
    if (!entry) {
      throw new EncryptionKeyRingError(
        'unknown_key_id',
        `Encrypted value names key id ${parsed.keyId}, which is neither ENCRYPTION_KEY nor listed in ENCRYPTION_KEY_PREVIOUS`,
      );
    }
    const plaintext = openWith(entry.key, parsed);
    if (plaintext === null) {
      throw new EncryptionKeyRingError('decrypt_failed', `Encrypted value failed authentication under key id ${entry.id}`);
    }
    return { plaintext, keyId: entry.id, format: 'keyed' };
  }
  for (const entry of [ring.current, ...ring.previous]) {
    const plaintext = openWith(entry.key, parsed);
    if (plaintext !== null) return { plaintext, keyId: entry.id, format: 'legacy' };
  }
  throw new EncryptionKeyRingError(
    'decrypt_failed',
    'Encrypted value (legacy format) could not be decrypted with ENCRYPTION_KEY or any ENCRYPTION_KEY_PREVIOUS key',
  );
}

export function decryptWithKeyRing(data: string, ring: EncryptionKeyRing = loadEncryptionKeyRing()): string {
  return decryptWithKeyRingDetailed(data, ring).plaintext;
}
