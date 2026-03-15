/**
 * Credential Encryption
 *
 * AES-256-GCM encryption for platform OAuth credentials (client_id, client_secret).
 * Uses same algorithm as tokenStore. Requires ENCRYPTION_KEY env var.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function getEncryptionKey(): Buffer {
  const keyEnv = process.env.ENCRYPTION_KEY;
  if (!keyEnv) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  let keyBuffer: Buffer;
  if (keyEnv.length === 64 && /^[0-9a-fA-F]+$/.test(keyEnv)) {
    keyBuffer = Buffer.from(keyEnv, 'hex');
  } else {
    keyBuffer = Buffer.from(keyEnv, 'base64');
  }
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (got ${keyBuffer.length})`);
  }
  return keyBuffer;
}

export function encryptCredential(plaintext: string): string {
  if (!plaintext || !plaintext.trim()) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext.trim(), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

export function decryptCredential(encryptedData: string): string {
  if (!encryptedData || !encryptedData.trim()) return '';
  const key = getEncryptionKey();
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted credential format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
