/**
 * Credential Encryption
 *
 * AES-256-GCM encryption for platform OAuth credentials (client_id, client_secret).
 * Uses same algorithm as tokenStore. Requires ENCRYPTION_KEY env var.
 *
 * Key handling and the ciphertext format live in ./encryptionKeyRing: new values are
 * written in the legacy `iv:tag:data` format under the current ENCRYPTION_KEY (readers
 * first — the keyed writer is not enabled); legacy values, keyed `k1:<keyId>:iv:tag:data`
 * values and values written under a key listed in ENCRYPTION_KEY_PREVIOUS all decrypt.
 */

import { decryptWithKeyRing, encryptWithKeyRing, loadEncryptionKeyRing } from './encryptionKeyRing';

/**
 * SEC91-B12: strict hex, exactly like tokenStore and the Zod schema (`/^[a-f0-9]{64}$/`).
 * The old "64 hex chars → hex, otherwise → base64" guess meant the two modules could
 * derive DIFFERENT key bytes from the same variable. Production already runs a hex key
 * (tokenStore would refuse anything else), so the derived key is unchanged.
 *
 * Returns the CURRENT key only. Kept for AES-GCM users that still build ciphertexts
 * themselves (whatsappBroadcastService); they should move to encryptWithKeyRing /
 * decryptWithKeyRing, which also read values written under a previous key.
 */
export function requireEncryptionKey(): Buffer {
  return loadEncryptionKeyRing().current.key;
}

export function encryptCredential(plaintext: string): string {
  if (!plaintext || !plaintext.trim()) return '';
  return encryptWithKeyRing(plaintext.trim());
}

export function decryptCredential(encryptedData: string): string {
  if (!encryptedData || !encryptedData.trim()) return '';
  return decryptWithKeyRing(encryptedData);
}
