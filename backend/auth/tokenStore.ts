import { ownedDbTable } from '../db/writeOwner';
/**
 * Token Store
 * 
 * Secure storage and retrieval of OAuth tokens with encryption at rest.
 * 
 * Uses AES-256-GCM encryption to store tokens in social_accounts table.
 * 
 * Environment Variables:
 * - ENCRYPTION_KEY (required, 64 hex characters = 32 bytes; hex only)
 * - ENCRYPTION_KEY_PREVIOUS (optional, comma-separated 64-hex keys accepted for decryption
 *   only — set during a key rotation, removed once re-encryption is complete)
 * - SUPABASE_URL (required)
 * - SUPABASE_SECRET_KEY (required)
 * 
 * Security Notes:
 * - Never commit ENCRYPTION_KEY to version control
 * - Use secrets manager (AWS Secrets Manager, HashiCorp Vault) in production
 * - Rotate encryption key periodically (see backend/auth/encryptionKeyRing.ts and
 *   scripts/ops/reencryptWithCurrentKey.ts)
 * - Enable Supabase RLS for social_accounts table (backend uses service role)
 */

import { supabase } from '../db/supabaseClient';
import { decryptWithKeyRing, encryptWithKeyRing } from './encryptionKeyRing';

/**
 * Encryption key handling is shared with credentialEncryption via ./encryptionKeyRing:
 * strict hex only (the old hex-or-base64 heuristic silently broke decryption when a key
 * was re-expressed in the other encoding), the Zod schema enforces `/^[a-f0-9]{64}$/` at
 * boot, and rotation is ENCRYPTION_KEY (current, encrypts) + ENCRYPTION_KEY_PREVIOUS
 * (comma-separated, decrypt-only).
 */

/**
 * Encrypt a string value (AES-256-GCM, current key, legacy `iv:tag:data` — readers first).
 */
function encrypt(text: string): string {
  return encryptWithKeyRing(text);
}

/**
 * Decrypt an encrypted string — keyed or legacy `iv:tag:data`, current or previous key.
 */
function decrypt(encryptedData: string): string {
  return decryptWithKeyRing(encryptedData);
}

export interface TokenObject {
  access_token: string;
  refresh_token?: string;
  expires_at?: string; // ISO timestamp
  token_type?: string;
  scope?: string;
  /**
   * Connection state of the owning social account. Absent on tokens built by
   * refresh flows (which carry credentials, not account state) — treat only an
   * explicit `false` as "parked for reconnection".
   */
  is_active?: boolean;
}

/**
 * Get encrypted token for a social account
 * 
 * @param socialAccountId - UUID of social_account record
 * @returns Decrypted token object or null if not found
 */
export async function getToken(socialAccountId: string): Promise<TokenObject | null> {
  const { data, error } = await ownedDbTable('social_accounts')
    .select('access_token, refresh_token, token_expires_at, is_active')
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
      // Callers that poll on a schedule need to know the connection has been
      // parked for reconnection, so they can skip it instead of retrying a
      // credential the provider has already rejected permanently.
      is_active: data.is_active !== false,
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

  // D4 — a newly issued token SUPERSEDES any earlier "this credential is dead"
  // verdict, so the stale lifecycle columns are cleared here, at the ONE seam
  // every OAuth callback and every successful refresh already passes through.
  //
  // Without this the platform had no quick way back from
  // PROVIDER_REAUTH_REQUIRED: none of the ten OAuth callbacks reset
  // `connection_state`, and healthProbeService deliberately SKIPS rows already
  // in PROVIDER_REAUTH_REQUIRED / TOKEN_EXPIRED ("already have an actionable
  // state"). Reconnecting therefore stored a fresh, valid token and left the row
  // reading "session expired", so publishing kept telling the owner to reconnect
  // an account they had just reconnected. The daily lifecycle sweep does
  // eventually reconcile it, so this closes a window of up to ~24h rather than a
  // permanent state.
  //
  // CONNECTED, not LIVE_VERIFIED: holding a fresh token is not proof the provider
  // accepts it. The health probe re-verifies and promotes, which it can now do
  // because the row is no longer skipped.
  //
  // Applied as a SEPARATE, best-effort write: storing the token is the job that
  // must not fail. This repo has already lost an entire OAuth callback to one
  // column dropped from social_accounts (see the `permissions` note in
  // pages/api/auth/linkedin/callback.ts), so schema drift here degrades to
  // "state not cleared" rather than "the user cannot connect".
  const lifecycleReset = {
    connection_state: 'CONNECTED',
    refresh_status: null,
    refresh_retry_count: 0,
    last_provider_error: null,
    last_refresh_error: null,
    last_live_check_status: null,
  };

  const { error } = await ownedDbTable('social_accounts')
    .update(updateData)
    .eq('id', socialAccountId);

  if (error) {
    throw new Error(`Failed to store token: ${error.message}`);
  }

  try {
    const { error: resetError } = await ownedDbTable('social_accounts')
      .update(lifecycleReset)
      .eq('id', socialAccountId);
    if (resetError) {
      console.warn(`[tokenStore] connection lifecycle not reset for ${socialAccountId}: ${resetError.message}`);
    }
  } catch (resetErr) {
    console.warn(`[tokenStore] connection lifecycle reset threw for ${socialAccountId}:`, resetErr);
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
      const { data, error } = await strict.maybeSingle();
      // `existing = null` used to mean two different things: "no such row yet"
      // (INSERT is correct) and "the lookup failed" (INSERT is NOT correct --
      // the row may well exist). Only the first may reach the INSERT below.
      if (error) {
        console.error(
          '[dualWriteSocialAccount] account lookup failed — aborting rather than risking a duplicate row:',
          platform,
          error.message,
        );
        return;
      }
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
      // Same three-state rule as the strict lookup above. This one matters more,
      // not less: it exists precisely because Meta returns a different
      // platform_user_id across sessions, and that is the case the unique index
      // (company_id, platform, platform_user_id) does NOT catch — so a failed
      // read here is exactly how a second row for one tenant/platform gets born.
      if (relaxed.error) {
        console.error(
          '[dualWriteSocialAccount] relaxed account lookup failed — aborting rather than risking a duplicate row:',
          platform,
          relaxed.error.message,
        );
        return;
      }
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
        // A reconnect RESOLVES whatever made the connection terminal, so the
        // terminal record must be cleared with it. Previously only is_active
        // and the expiry were reset: a freshly reconnected LinkedIn came back
        // with a valid 60-day token, is_active true, and
        // connection_state still PROVIDER_REAUTH_REQUIRED — and
        // connection_state is the field health badges and probes read, so the
        // account kept presenting as needing reauth immediately after being
        // reconnected.
        //
        // The retry counter matters too: X sat at refresh_retry_count 4111,
        // far past the ceiling of 4. Carried across a reconnect, the very next
        // refresh failure — however transient — would re-park the account
        // instantly instead of getting its bounded retries.
        connection_state: 'CONNECTED',
        refresh_status: null,
        refresh_retry_count: 0,
        last_refresh_error: null,
        last_provider_error: null,
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
/**
 * Park a social account for reconnection after a confirmed, unrecoverable
 * authentication failure.
 *
 * Deliberately reuses `is_active` rather than introducing a `needs_reauth`
 * column: that flag ALREADY means exactly this everywhere it is read —
 * `refreshAccountResolver` and the refresh cron both filter on
 * `is_active = true`, the UI renders a false row as "Not connected", and
 * `storeToken` sets it back to true on every reconnect. So one write stops the
 * retry loop, surfaces a reconnect prompt, and self-clears on re-auth, with no
 * migration and no second source of truth.
 *
 * Only call this when a credential has been proven dead — a provider 401 that
 * survived one refresh-and-retry. A transient network failure must not park a
 * working account.
 *
 * Non-fatal: parking is an operational courtesy, not part of the ingest result.
 */
export async function markSocialAccountNeedsReauth(
  socialAccountId: string,
  reason: string,
): Promise<void> {
  try {
    await ownedDbTable('social_accounts').update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
      .eq('id', socialAccountId);
    console.warn('[tokenStore] social account parked for reconnection', {
      social_account_id: socialAccountId,
      reason,
    });
  } catch (err: any) {
    console.warn('[markSocialAccountNeedsReauth] non-fatal error:', socialAccountId, err?.message);
  }
}

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

