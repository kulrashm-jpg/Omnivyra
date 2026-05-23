import { ownedDbTable } from '../db/writeOwner';
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
 * Get encryption key from config module — strict hex-only.
 *
 * The previous accept-either-format heuristic ("looks like 64 hex chars? hex.
 * otherwise base64.") was a silent foot-gun: rotating between hex and base64
 * representations of the same 32 bytes produced different key buffers and
 * silently broke decryption of all existing tokens. The Zod schema already
 * enforces `/^[a-f0-9]{64}$/` at boot; this function aligns with that
 * single canonical format and refuses anything else with a clear migration
 * hint instead of attempting a guess.
 */
function getEncryptionKey(): Buffer {
  const keyEnv = config.ENCRYPTION_KEY;
  if (!keyEnv) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }

  if (!/^[0-9a-fA-F]{64}$/.test(keyEnv)) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ' +
      'Base64 keys are no longer accepted — if rotating from base64, convert via ' +
      '`node -e "process.stdout.write(Buffer.from(process.argv[1], \\\'base64\\\').toString(\\\'hex\\\'))" "<base64-key>"` ' +
      'and re-encrypt existing tokens, since the two formats are NOT byte-identical interpretations.'
    );
  }

  const keyBuffer = Buffer.from(keyEnv, 'hex');
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
  const { data, error } = await ownedDbTable('social_accounts')
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
 * Store encrypted token for a social account.
 *
 * social_accounts is the SINGLE source of truth for OAuth tokens since the
 * community_ai_platform_tokens consolidation. There is no longer any
 * mirror write — connector reads route through this same function via
 * tokenStore.getToken(socialAccountId).
 *
 * @param socialAccountId - UUID of social_account record
 * @param token - Token object to encrypt and store
 */
export async function setToken(socialAccountId: string, token: TokenObject): Promise<void> {
  const encryptedAccessToken = encrypt(token.access_token);
  const encryptedRefreshToken = token.refresh_token ? encrypt(token.refresh_token) : null;

  const updateData: any = {
    access_token: encryptedAccessToken,
    updated_at: new Date().toISOString(),
  };
  if (encryptedRefreshToken) updateData.refresh_token = encryptedRefreshToken;
  if (token.expires_at) updateData.token_expires_at = token.expires_at;

  const { error } = await ownedDbTable('social_accounts')
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
  permissions?: string[];
}): Promise<void> {
  const { userId, companyId, platform, platformUserId, accountName, token, permissions } = opts;
  // Persist scopes when caller supplies them. Without this, the row's
  // permissions column ends up null and verify-config / publish-time scope
  // checks have nothing to compare against.
  const scopeList = permissions && permissions.length > 0
    ? permissions
    : (token.scope ? token.scope.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) : null);
  try {
    // Strict find: match the platform_user_id the OAuth callback observed.
    // First-time connects + reconnects with the same provider user-id hit this.
    let existing: { id: string } | null = null;
    {
      const strict = ownedDbTable('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('platform', platform);
      if (platformUserId) strict.eq('platform_user_id', platformUserId);
      const { data } = await strict.maybeSingle();
      existing = data ? { id: data.id } : null;
    }

    // Relaxed fallback: same tenant + platform but DIFFERENT platform_user_id.
    // Meta in particular returns different fb_user_id values across OAuth
    // sessions (Page-scoped vs User-scoped id, business-portfolio impersonation,
    // re-grants under a different identity). Without this fallback, a
    // reconnect would silently fail at INSERT time (unique index
    // social_accounts_company_platform_user_unique covers (company_id,
    // platform, platform_user_id), so a new row IS possible — but two rows
    // for the same tenant/platform is worse than one, and the original
    // is_active=false row would still show "Not connected" in the UI).
    // Treating one (user, company, platform) as the canonical asset and
    // updating its platform_user_id keeps a single source of truth and
    // re-activates the row on every reconnect.
    if (!existing && platformUserId) {
      const relaxed = await ownedDbTable('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('platform', platform)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (relaxed.data?.id) {
        existing = { id: relaxed.data.id };
      }
    }

    if (existing?.id) {
      const updatePayload: Record<string, unknown> = {
        is_active: true,
        account_name: accountName || undefined,
        token_expires_at: token.expires_at || undefined,
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      // Keep platform_user_id in sync when Meta hands us a fresh value on
      // reconnect. Without this the row's platform_user_id stays at the
      // stale value, and downstream services that look up assets by that
      // id (Page sync, IG discovery hop) miss the new account.
      if (platformUserId) updatePayload.platform_user_id = platformUserId;
      // `permissions` was a stale write target — the column does not exist
      // on social_accounts (schema drift: column dropped without cleaning up
      // writers). Caller's scope list is still threaded through via
      // setToken/token storage; granted scopes for Meta-family are
      // separately recorded in meta_oauth_connections.granted_scopes.
      // `scopeList` retained as a parameter for backward compat / future
      // use, but no longer written here. Removing the write unblocks the
      // entire OAuth callback chain (LinkedIn / X / YouTube / etc.) that
      // was failing the insert.
      void scopeList;
      await ownedDbTable('social_accounts').update(updatePayload).eq('id', existing.id);
      await setToken(existing.id, token);
    } else {
      const encrypted = encryptTokenColumns(token);
      const insertPayload: Record<string, unknown> = {
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
      };
      // See comment above — permissions column doesn't exist on
      // social_accounts. Do not include scopeList in the insert.
      const { data: inserted } = await ownedDbTable('social_accounts').insert(insertPayload).select('id').single();
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
    await ownedDbTable('social_accounts').update({
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

