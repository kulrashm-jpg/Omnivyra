import { decryptCredential, encryptCredential } from '../auth/credentialEncryption';
import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';

export type AnalyticsProviderKey = 'google_analytics';

export type AnalyticsProviderConfig = {
  provider: AnalyticsProviderKey;
  enabled: boolean;
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
  scopes: string[];
  redirect_uri: string | null;
  status: string;
  updated_at: string | null;
};

export type AnalyticsProviderConfigSummary = {
  provider: AnalyticsProviderKey;
  enabled: boolean;
  configured: boolean;
  client_id_preview: string;
  has_client_secret: boolean;
  scopes: string[];
  redirect_uri: string | null;
  status: string;
  updated_at: string | null;
};

const DEFAULT_GA_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/analytics.readonly',
];

function decryptIfNeeded(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decryptCredential(value);
  } catch {
    return value;
  }
}

function encryptIfPresent(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  return encryptCredential(value.trim());
}

export function getDefaultAnalyticsProviderScopes(provider: AnalyticsProviderKey): string[] {
  if (provider === 'google_analytics') return [...DEFAULT_GA_SCOPES];
  return [];
}

export function getDefaultAnalyticsRedirectUri(provider: AnalyticsProviderKey): string {
  const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  const callbackPath = '/api/analytics/connect/google/callback';
  if (provider === 'google_analytics' && appBaseUrl) {
    return `${appBaseUrl}${callbackPath}`;
  }
  return callbackPath;
}

export async function getAnalyticsProviderConfig(
  provider: AnalyticsProviderKey,
): Promise<AnalyticsProviderConfig | null> {
  const { data, error } = await ownedDbTable('analytics_provider_config')
    .select('provider, enabled, oauth_client_id_encrypted, oauth_client_secret_encrypted, scopes, redirect_uri, status, updated_at')
    .eq('provider', provider)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load analytics provider config: ${error.message}`);
  }

  if (!data) return null;

  return {
    provider,
    enabled: data.enabled !== false,
    oauth_client_id: decryptIfNeeded(data.oauth_client_id_encrypted) ?? null,
    oauth_client_secret: decryptIfNeeded(data.oauth_client_secret_encrypted) ?? null,
    scopes: Array.isArray(data.scopes) && data.scopes.length > 0 ? data.scopes : getDefaultAnalyticsProviderScopes(provider),
    redirect_uri: data.redirect_uri || getDefaultAnalyticsRedirectUri(provider),
    status: typeof data.status === 'string' ? data.status : 'inactive',
    updated_at: data.updated_at ?? null,
  };
}

export async function getAnalyticsProviderConfigSummary(
  provider: AnalyticsProviderKey,
): Promise<AnalyticsProviderConfigSummary> {
  const config = await getAnalyticsProviderConfig(provider);
  const clientId = config?.oauth_client_id || '';

  return {
    provider,
    enabled: config?.enabled ?? false,
    configured: Boolean(config?.oauth_client_id && config?.oauth_client_secret),
    client_id_preview: clientId ? `${clientId.slice(0, 6)}...` : '',
    has_client_secret: Boolean(config?.oauth_client_secret),
    scopes: config?.scopes ?? getDefaultAnalyticsProviderScopes(provider),
    redirect_uri: config?.redirect_uri ?? getDefaultAnalyticsRedirectUri(provider),
    status: config?.status ?? 'inactive',
    updated_at: config?.updated_at ?? null,
  };
}

export async function upsertAnalyticsProviderConfig(input: {
  provider: AnalyticsProviderKey;
  enabled: boolean;
  oauth_client_id?: string | null;
  oauth_client_secret?: string | null;
  scopes?: string[];
  redirect_uri?: string | null;
  status?: string;
}): Promise<void> {
  const existing = await getAnalyticsProviderConfig(input.provider);
  const hasExistingCredentials = Boolean(existing?.oauth_client_id && existing?.oauth_client_secret);
  const nextClientId = input.oauth_client_id?.trim() || existing?.oauth_client_id || null;
  const nextClientSecret = input.oauth_client_secret?.trim() || existing?.oauth_client_secret || null;

  if (!hasExistingCredentials && (!nextClientId || !nextClientSecret)) {
    throw new Error('OAuth client ID and secret are required');
  }

  const payload = {
    provider: input.provider,
    enabled: Boolean(input.enabled),
    oauth_client_id_encrypted: encryptIfPresent(nextClientId),
    oauth_client_secret_encrypted: encryptIfPresent(nextClientSecret),
    scopes: input.scopes && input.scopes.length > 0 ? input.scopes : existing?.scopes ?? getDefaultAnalyticsProviderScopes(input.provider),
    redirect_uri: (input.redirect_uri || existing?.redirect_uri || getDefaultAnalyticsRedirectUri(input.provider)).trim(),
    status: input.status || (input.enabled ? 'active' : 'disabled'),
    updated_at: new Date().toISOString(),
  };

  const { error } = await ownedDbTable('analytics_provider_config')
    .upsert(payload, { onConflict: 'provider' });

  if (error) {
    throw new Error(`Failed to save analytics provider config: ${error.message}`);
  }
}
