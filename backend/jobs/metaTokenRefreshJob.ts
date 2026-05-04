import crypto from 'crypto';
import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { encryptTokenColumns } from '../auth/tokenStore';
import {
  META_GRAPH_VERSION,
  exchangeShortToLongLivedToken,
  refreshLongLivedToken,
  type MetaPlatform,
} from '../auth/metaAuthService';
import { getOAuthCredentialsForPlatform } from '../auth/oauthCredentialResolver';

const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const REFRESH_BUFFER_DAYS = 7;
const COOLDOWN_HOURS = 6;

type ConnectionRow = {
  id: string;
  user_id: string;
  company_id: string;
  fb_user_id: string;
  user_access_token: string;
  token_expires_at: string;
  granted_scopes: string[] | null;
  last_refreshed_at: string | null;
};

type DerivedRow = {
  id: string;
  platform: MetaPlatform;
  platform_user_id: string;
  page_access_token: string | null;
  ig_user_token: string | null;
  threads_token: string | null;
};

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function getKey(): Buffer {
  const env = process.env.ENCRYPTION_KEY || '';
  if (!env) throw new Error('ENCRYPTION_KEY missing');
  if (env.length === 64 && /^[0-9a-fA-F]+$/.test(env)) {
    return Buffer.from(env, 'hex');
  }
  const buf = Buffer.from(env, 'base64');
  if (buf.length !== KEY_LENGTH) throw new Error('ENCRYPTION_KEY wrong length');
  return buf;
}

function decryptCipherEnvelope(encrypted: string): string {
  const key = getKey();
  const [ivHex, tagHex, dataHex] = encrypted.split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Invalid token envelope');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let out = decipher.update(dataHex, 'hex', 'utf8');
  out += decipher.final('utf8');
  return out;
}

async function refreshOneConnection(row: ConnectionRow): Promise<void> {
  const creds = await getOAuthCredentialsForPlatform('facebook');
  if (!creds?.client_id || !creds?.client_secret) {
    throw new Error('Facebook OAuth credentials unavailable');
  }

  const currentUserToken = decryptCipherEnvelope(row.user_access_token);

  // Refresh user access token (long-lived → long-lived re-exchange).
  const refreshed = await exchangeShortToLongLivedToken(
    currentUserToken,
    creds.client_id,
    creds.client_secret,
  );
  const newUserToken = refreshed.access_token;

  // Re-fetch /debug_token for accurate expiry + scopes.
  const debugRes = await fetch(
    `${META_GRAPH}/debug_token?` +
      new URLSearchParams({
        input_token: newUserToken,
        access_token: `${creds.client_id}|${creds.client_secret}`,
      })
  );
  const debugBody = (await debugRes.json().catch(() => null)) as
    | { data?: { expires_at?: number; scopes?: string[] } }
    | null;
  const debugExpiresAt = debugBody?.data?.expires_at ?? 0;
  const newExpiresAtIso =
    debugExpiresAt > 0
      ? new Date(debugExpiresAt * 1000).toISOString()
      : new Date(Date.now() + (refreshed.expires_in || 5184000) * 1000).toISOString();
  const newScopes = Array.isArray(debugBody?.data?.scopes) ? (debugBody!.data!.scopes as string[]) : (row.granted_scopes ?? []);

  // Re-fetch /me/accounts for current Page access tokens.
  const pagesRes = await fetch(
    `${META_GRAPH}/me/accounts?` +
      new URLSearchParams({
        fields: 'id,access_token,instagram_business_account{id}',
        access_token: newUserToken,
        limit: '100',
      })
  );
  if (!pagesRes.ok) {
    throw new Error(`/me/accounts failed (${pagesRes.status})`);
  }
  const pagesBody = (await pagesRes.json()) as {
    data?: Array<{ id: string; access_token?: string; instagram_business_account?: { id?: string } }>;
  };
  const freshPages = pagesBody.data ?? [];

  // Update connection.
  const encConnToken = encryptTokenColumns({ access_token: newUserToken }).access_token;
  const { error: updateConnErr } = await supabase
    .from('meta_oauth_connections')
    .update({
      user_access_token: encConnToken,
      token_expires_at: newExpiresAtIso,
      granted_scopes: newScopes,
      last_refreshed_at: new Date().toISOString(),
      refresh_failed_at: null,
      refresh_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  if (updateConnErr) throw new Error(updateConnErr.message);

  // Update each derived row's per-platform token.
  const { data: derived } = await supabase
    .from('social_accounts')
    .select('id, platform, platform_user_id, page_access_token, ig_user_token, threads_token, linked_page_id, linked_ig_business_id')
    .eq('meta_connection_id', row.id);

  for (const d of (derived ?? []) as Array<DerivedRow & { linked_page_id: string | null; linked_ig_business_id: string | null }>) {
    if (d.platform === 'facebook') {
      const fresh = freshPages.find((p) => p.id === d.platform_user_id);
      if (!fresh?.access_token) continue;
      const encPage = encryptTokenColumns({ access_token: fresh.access_token }).access_token;
      await supabase
        .from('social_accounts')
        .update({
          page_access_token: encPage,
          access_token: encPage,
          token_expires_at: newExpiresAtIso,
          is_active: true,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', d.id);
    } else if (d.platform === 'instagram') {
      const fresh = freshPages.find(
        (p) => p.instagram_business_account?.id === d.platform_user_id || p.id === d.linked_page_id,
      );
      if (!fresh?.access_token) continue;
      const encIg = encryptTokenColumns({ access_token: fresh.access_token }).access_token;
      await supabase
        .from('social_accounts')
        .update({
          ig_user_token: encIg,
          access_token: encIg,
          token_expires_at: newExpiresAtIso,
          is_active: true,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', d.id);
    } else if (d.platform === 'threads') {
      // Threads tokens use th_refresh_token grant (no client_secret).
      try {
        const currentThreadsToken = d.threads_token ? decryptCipherEnvelope(d.threads_token) : '';
        if (!currentThreadsToken) continue;
        const refreshedThreads = await refreshLongLivedToken('threads', currentThreadsToken, false, null, null);
        const enc = encryptTokenColumns({ access_token: refreshedThreads.access_token }).access_token;
        const expIso =
          refreshedThreads.expires_in > 0
            ? new Date(Date.now() + refreshedThreads.expires_in * 1000).toISOString()
            : newExpiresAtIso;
        await supabase
          .from('social_accounts')
          .update({
            threads_token: enc,
            access_token: enc,
            token_expires_at: expIso,
            is_active: true,
            last_sync_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', d.id);
      } catch (e) {
        console.warn(`[metaTokenRefresh] threads refresh failed for ${d.id}:`, (e as Error).message);
      }
    }
  }
}

export async function runMetaTokenRefreshJob(): Promise<{
  scanned: number;
  refreshed: number;
  failed: number;
}> {
  const refreshHorizon = new Date(Date.now() + REFRESH_BUFFER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from('meta_oauth_connections')
    .select('id, user_id, company_id, fb_user_id, user_access_token, token_expires_at, granted_scopes, last_refreshed_at')
    .is('refresh_failed_at', null)
    .lt('token_expires_at', refreshHorizon)
    .or(`last_refreshed_at.is.null,last_refreshed_at.lt.${cooldownCutoff}`);

  if (error) {
    console.error('[metaTokenRefresh] selector failed:', error.message);
    return { scanned: 0, refreshed: 0, failed: 1 };
  }

  const scanned = rows?.length ?? 0;
  let refreshed = 0;
  let failed = 0;

  for (const row of (rows ?? []) as ConnectionRow[]) {
    try {
      await refreshOneConnection(row);
      refreshed++;
    } catch (e) {
      failed++;
      const msg = (e as Error).message;
      console.error(`[metaTokenRefresh] connection ${row.id} failed:`, msg);
      await supabase
        .from('meta_oauth_connections')
        .update({
          refresh_failed_at: new Date().toISOString(),
          refresh_error: msg.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      await supabase
        .from('social_accounts')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('meta_connection_id', row.id);
    }
  }

  console.log(`[metaTokenRefresh] scanned=${scanned} refreshed=${refreshed} failed=${failed}`);
  return { scanned, refreshed, failed };
}
