/**
 * Platform OAuth Config Service
 *
 * Resolves global OAuth credentials from platform_oauth_configs table.
 * Super Admin configures once; all tenant OAuth flows use this.
 *
 * Resolution order: platform_oauth_configs → .env fallback
 * No company_id — global config only (SaaS Layer 1).
 */

import { supabase } from '../db/supabaseClient';
import { decryptCredential } from '../auth/credentialEncryption';

export type PlatformOAuthConfig = {
  platform: string;
  client_id: string;
  client_secret: string;
  auth_url: string | null;
  token_url: string | null;
  scopes: string[];
  enabled: boolean;
};

/**
 * Get OAuth credentials for a platform from platform_oauth_configs.
 * Returns null if platform not configured or disabled.
 */
export async function getPlatformOAuthConfig(
  platform: string
): Promise<PlatformOAuthConfig | null> {
  const raw = platform.toLowerCase();
  // DB stores "twitter" for Twitter/X; both "twitter" and "x" resolve to same config
  const dbPlatform = raw === 'x' || raw === 'twitter' ? 'twitter' : raw;

  const { data, error } = await supabase
    .from('platform_oauth_configs')
    .select('platform, oauth_client_id_encrypted, oauth_client_secret_encrypted, oauth_authorize_url, oauth_token_url, oauth_scopes, enabled')
    .eq('platform', dbPlatform)
    .maybeSingle();

  if (error || !data) return null;

  const encId = (data as { oauth_client_id_encrypted?: string }).oauth_client_id_encrypted;
  const encSecret = (data as { oauth_client_secret_encrypted?: string }).oauth_client_secret_encrypted;

  if (!encId || !encSecret) return null;

  try {
    const client_id = decryptCredential(encId);
    const client_secret = decryptCredential(encSecret);
    if (!client_id || !client_secret) return null;

    const scopes = (data as { oauth_scopes?: string[] }).oauth_scopes ?? [];
    return {
      platform: (data as { platform: string }).platform,
      client_id,
      client_secret,
      auth_url: (data as { oauth_authorize_url?: string | null }).oauth_authorize_url ?? null,
      token_url: (data as { oauth_token_url?: string | null }).oauth_token_url ?? null,
      scopes: Array.isArray(scopes) ? scopes : [],
      enabled: (data as { enabled?: boolean }).enabled !== false,
    };
  } catch (e) {
    console.warn('[platformOauthConfigService] Decrypt failed:', (e as Error)?.message);
    return null;
  }
}

/**
 * Get list of platforms with valid OAuth config (enabled + has credentials).
 * Used by Connect Accounts page to show available platforms.
 */
export async function getEnabledPlatformsWithOAuth(): Promise<string[]> {
  const { data, error } = await supabase
    .from('platform_oauth_configs')
    .select('platform')
    .eq('enabled', true)
    .not('oauth_client_id_encrypted', 'is', null)
    .not('oauth_client_secret_encrypted', 'is', null);

  if (error) return [];
  return (data ?? []).map((r: { platform: string }) => r.platform);
}
