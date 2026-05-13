import { decryptCredential, encryptCredential } from '../auth/credentialEncryption';
import { config } from '@/config';
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
  capability_redirect_uris: {
    google_analytics: string | null;
    google_search_console: string | null;
  };
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
  capability_redirect_uris: {
    google_analytics: string | null;
    google_search_console: string | null;
  };
  status: string;
  updated_at: string | null;
};

const DEFAULT_GA_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
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

function isMissingMetadataColumn(error: unknown): boolean {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : String(error || '');
  return /analytics_provider_config\.metadata|column .*metadata .*does not exist|schema cache.*metadata/i.test(message);
}

export function getDefaultAnalyticsProviderScopes(provider: AnalyticsProviderKey): string[] {
  if (provider === 'google_analytics') return [...DEFAULT_GA_SCOPES];
  return [];
}

export function getDefaultAnalyticsRedirectUri(provider: AnalyticsProviderKey): string {
  return getDefaultAnalyticsCapabilityRedirectUri(provider, 'google_analytics');
}

export function getDefaultAnalyticsCapabilityRedirectUri(
  provider: AnalyticsProviderKey,
  capability: 'google_analytics' | 'google_search_console',
): string {
  const appBaseUrl = (config.NEXT_PUBLIC_APP_URL || config.APP_URL || '').replace(/\/$/, '');
  const callbackPath = '/api/analytics/connect/google/callback';
  if (provider === 'google_analytics' && appBaseUrl) {
    return `${appBaseUrl}${callbackPath}`;
  }
  return callbackPath;
}

export async function getAnalyticsProviderConfig(
  provider: AnalyticsProviderKey,
): Promise<AnalyticsProviderConfig | null> {
  let { data, error } = await ownedDbTable('analytics_provider_config')
    .select('provider, enabled, oauth_client_id_encrypted, oauth_client_secret_encrypted, scopes, redirect_uri, status, updated_at, metadata')
    .eq('provider', provider)
    .maybeSingle();

  if (error) {
    if (isMissingMetadataColumn(error)) {
      const fallback = await ownedDbTable('analytics_provider_config')
        .select('provider, enabled, oauth_client_id_encrypted, oauth_client_secret_encrypted, scopes, redirect_uri, status, updated_at')
        .eq('provider', provider)
        .maybeSingle();
      data = fallback.data ? { ...fallback.data, metadata: null } : null;
      error = fallback.error;
    }
    if (error) {
      throw new Error(`Failed to load analytics provider config: ${error.message}`);
    }
  }

  if (!data) return null;

  const metadata = data.metadata && typeof data.metadata === 'object'
    ? data.metadata as Record<string, unknown>
    : {};
  const capabilityRedirects = metadata.capability_redirect_uris && typeof metadata.capability_redirect_uris === 'object'
    ? metadata.capability_redirect_uris as Record<string, unknown>
    : {};
  const defaultRedirectUri = getDefaultAnalyticsRedirectUri(provider);
  const gaRedirectUri = typeof capabilityRedirects.google_analytics === 'string' && capabilityRedirects.google_analytics.trim()
    ? capabilityRedirects.google_analytics.trim()
    : data.redirect_uri || defaultRedirectUri;
  const gscRedirectUri = typeof capabilityRedirects.google_search_console === 'string' && capabilityRedirects.google_search_console.trim()
    ? capabilityRedirects.google_search_console.trim()
    : data.redirect_uri || getDefaultAnalyticsCapabilityRedirectUri(provider, 'google_search_console');

  return {
    provider,
    enabled: data.enabled !== false,
    oauth_client_id: decryptIfNeeded(data.oauth_client_id_encrypted) ?? null,
    oauth_client_secret: decryptIfNeeded(data.oauth_client_secret_encrypted) ?? null,
    scopes: Array.isArray(data.scopes) && data.scopes.length > 0 ? data.scopes : getDefaultAnalyticsProviderScopes(provider),
    redirect_uri: data.redirect_uri || defaultRedirectUri,
    capability_redirect_uris: {
      google_analytics: gaRedirectUri,
      google_search_console: gscRedirectUri,
    },
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
    capability_redirect_uris: config?.capability_redirect_uris ?? {
      google_analytics: getDefaultAnalyticsCapabilityRedirectUri(provider, 'google_analytics'),
      google_search_console: getDefaultAnalyticsCapabilityRedirectUri(provider, 'google_search_console'),
    },
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
  capability_redirect_uris?: {
    google_analytics?: string | null;
    google_search_console?: string | null;
  };
  status?: string;
}): Promise<void> {
  const existing = await getAnalyticsProviderConfig(input.provider);
  const hasExistingCredentials = Boolean(existing?.oauth_client_id && existing?.oauth_client_secret);
  const nextClientId = input.oauth_client_id?.trim() || existing?.oauth_client_id || null;
  const nextClientSecret = input.oauth_client_secret?.trim() || existing?.oauth_client_secret || null;

  if (!hasExistingCredentials && (!nextClientId || !nextClientSecret)) {
    throw new Error('OAuth client ID and secret are required');
  }

  const gaRedirectUri = (
    input.capability_redirect_uris?.google_analytics ||
    input.redirect_uri ||
    existing?.capability_redirect_uris.google_analytics ||
    existing?.redirect_uri ||
    getDefaultAnalyticsCapabilityRedirectUri(input.provider, 'google_analytics')
  ).trim();
  const gscRedirectUri = (
    input.capability_redirect_uris?.google_search_console ||
    existing?.capability_redirect_uris.google_search_console ||
    input.redirect_uri ||
    existing?.redirect_uri ||
    getDefaultAnalyticsCapabilityRedirectUri(input.provider, 'google_search_console')
  ).trim();

  const payload = {
    provider: input.provider,
    enabled: Boolean(input.enabled),
    oauth_client_id_encrypted: encryptIfPresent(nextClientId),
    oauth_client_secret_encrypted: encryptIfPresent(nextClientSecret),
    scopes: input.scopes && input.scopes.length > 0 ? input.scopes : existing?.scopes ?? getDefaultAnalyticsProviderScopes(input.provider),
    redirect_uri: gaRedirectUri,
    metadata: {
      capability_redirect_uris: {
        google_analytics: gaRedirectUri,
        google_search_console: gscRedirectUri,
      },
    },
    status: input.status || (input.enabled ? 'active' : 'disabled'),
    updated_at: new Date().toISOString(),
  };

  let { error } = await ownedDbTable('analytics_provider_config')
    .upsert(payload, { onConflict: 'provider' });

  if (error && isMissingMetadataColumn(error)) {
    const { metadata: _metadata, ...legacyPayload } = payload;
    const fallback = await ownedDbTable('analytics_provider_config')
      .upsert(legacyPayload, { onConflict: 'provider' });
    error = fallback.error;
  }

  if (error) {
    throw new Error(`Failed to save analytics provider config: ${error.message}`);
  }
}
