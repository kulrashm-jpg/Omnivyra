/**
 * Token Store
 * 
 * Secure storage and retrieval of OAuth tokens with encryption at rest.
 * 
 * Uses AES-256-GCM encryption to store tokens in social_accounts table.
 * 
 * Environment Variables:
 * - ENCRYPTION_KEY (required, 32-byte hex string or base64)
 * - SUPABASE_URL (required)
 * - SUPABASE_SERVICE_ROLE_KEY (required)
 * 
 * Security Notes:
 * - Never commit ENCRYPTION_KEY to version control
 * - Use secrets manager (AWS Secrets Manager, HashiCorp Vault) in production
 * - Rotate encryption key periodically
 * - Enable Supabase RLS for social_accounts table (backend uses service role)
 */

import crypto from 'crypto';
import { supabase } from '../db/supabaseClient';
import { config } from '@/config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM requires 12 bytes IV (not 16)
const TAG_LENGTH = 16; // GCM tag is always 16 bytes
const KEY_LENGTH = 32; // AES-256 requires 32 bytes key

/**
 * Get encryption key from config module
 * Converts hex string or base64 to Buffer
 */
function getEncryptionKey(): Buffer {
  const keyEnv = config.ENCRYPTION_KEY;
  if (!keyEnv) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }

  // Try to parse as hex first, then base64
  let keyBuffer: Buffer;
  if (keyEnv.length === 64 && /^[0-9a-fA-F]+$/.test(keyEnv)) {
    // Hex string (64 chars = 32 bytes)
    keyBuffer = Buffer.from(keyEnv, 'hex');
  } else {
    // Base64
    keyBuffer = Buffer.from(keyEnv, 'base64');
  }

  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (got ${keyBuffer.length})`);
  }

  return keyBuffer;
}

/**
 * Encrypt a string value
 */
function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  // Combine iv + tag + encrypted data
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt an encrypted string
 */
function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const parts = encryptedData.split(':');
  
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export interface TokenObject {
  access_token: string;
  refresh_token?: string;
  expires_at?: string; // ISO timestamp
  token_type?: string;
  scope?: string;
}

/**
 * Get encrypted token for a social account
 * 
 * @param socialAccountId - UUID of social_account record
 * @returns Decrypted token object or null if not found
 */
export async function getToken(socialAccountId: string): Promise<TokenObject | null> {
  const { data, error } = await supabase
    .from('social_accounts')
    .select('access_token, refresh_token, token_expires_at')
    .eq('id', socialAccountId)
    .single();

  if (error || !data) {
    console.error(`Failed to get token for account ${socialAccountId}:`, error?.message);
    return null;
  }

  if (!data.access_token) {
    return null;
  }

  try {
    // Decrypt access token
    const accessToken = decrypt(data.access_token);
    
    // Decrypt refresh token if exists
    let refreshToken: string | undefined;
    if (data.refresh_token) {
      refreshToken = decrypt(data.refresh_token);
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: data.token_expires_at || undefined,
      token_type: 'Bearer',
    };
  } catch (error: any) {
    console.error(`Failed to decrypt token for account ${socialAccountId}:`, error.message);
    return null;
  }
}

/**
 * Encrypt a TokenObject into DB-ready column values.
 * Use this when inserting a new social_accounts row so access_token NOT NULL is satisfied.
 */
export function encryptTokenColumns(token: TokenObject): {
  access_token: string;
  refresh_token: string | null;
} {
  return {
    access_token: encrypt(token.access_token),
    refresh_token: token.refresh_token ? encrypt(token.refresh_token) : null,
  };
}

/**
 * Store encrypted token for a social account
 *
 * @param socialAccountId - UUID of social_account record
 * @param token - Token object to encrypt and store
 */
export async function setToken(socialAccountId: string, token: TokenObject): Promise<void> {
  // Encrypt tokens
  const encryptedAccessToken = encrypt(token.access_token);
  const encryptedRefreshToken = token.refresh_token ? encrypt(token.refresh_token) : null;

  // Update social_accounts table
  const updateData: any = {
    access_token: encryptedAccessToken,
    updated_at: new Date().toISOString(),
  };

  if (encryptedRefreshToken) {
    updateData.refresh_token = encryptedRefreshToken;
  }

  if (token.expires_at) {
    updateData.token_expires_at = token.expires_at;
  }

  const { error } = await supabase
    .from('social_accounts')
    .update(updateData)
    .eq('id', socialAccountId);

  if (error) {
    throw new Error(`Failed to store token: ${error.message}`);
  }

  console.log(`✅ Token stored for account ${socialAccountId}`);
}

/**
 * Dual-write: upsert a social_accounts row from the community-ai connector flow.
 * Call this after saveToken() so connecting once covers both publishing and engagement.
 * Non-fatal — errors are logged but do not throw.
 */
export async function dualWriteSocialAccount(opts: {
  userId: string;
  companyId: string;
  platform: string;
  platformUserId: string | null;
  accountName: string | null;
  token: TokenObject;
}): Promise<void> {
  const { userId, companyId, platform, platformUserId, accountName, token } = opts;
  try {
    // Find existing row
    const query = supabase
      .from('social_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .eq('platform', platform);
    if (platformUserId) query.eq('platform_user_id', platformUserId);
    const { data: existing } = await query.maybeSingle();

    if (existing?.id) {
      await supabase.from('social_accounts').update({
        is_active: true,
        account_name: accountName || undefined,
        token_expires_at: token.expires_at || undefined,
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
      await setToken(existing.id, token);
    } else {
      const encrypted = encryptTokenColumns(token);
      const { data: inserted } = await supabase.from('social_accounts').insert({
        user_id: userId,
        company_id: companyId,
        platform,
        platform_user_id: platformUserId || `${platform}_${userId}`,
        account_name: accountName || platform,
        is_active: true,
        token_expires_at: token.expires_at || null,
        last_sync_at: new Date().toISOString(),
        access_token: encrypted.access_token,
        refresh_token: encrypted.refresh_token,
      }).select('id').single();
      if (inserted?.id) await setToken(inserted.id, token);
    }
  } catch (err: any) {
    console.warn('[dualWriteSocialAccount] non-fatal error:', platform, err?.message);
  }
}

/**
 * Deactivate social_accounts row on disconnect (companion to revokeToken).
 * Non-fatal — errors are logged but do not throw.
 */
export async function deactivateSocialAccount(opts: {
  userId: string;
  companyId: string;
  platform: string;
}): Promise<void> {
  try {
    await supabase.from('social_accounts').update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
      .eq('user_id', opts.userId)
      .eq('company_id', opts.companyId)
      .eq('platform', opts.platform);
  } catch (err: any) {
    console.warn('[deactivateSocialAccount] non-fatal error:', opts.platform, err?.message);
  }
}

/**
 * Check if token is expired or expiring soon
 */
export function isTokenExpiringSoon(token: TokenObject, bufferMinutes: number = 5): boolean {
  if (!token.expires_at) {
    return false; // No expiration info, assume valid
  }

  const expiresAt = new Date(token.expires_at);
  const now = new Date();
  const bufferMs = bufferMinutes * 60 * 1000;

  return expiresAt.getTime() - now.getTime() < bufferMs;
}

