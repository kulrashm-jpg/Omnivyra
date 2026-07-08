/** Analytics integration — provider contracts, auth, fetchers — split from analyticsIntegrationService.ts (barrel preserved; importers unchanged). */
import { decodeOAuthState, encodeOAuthState } from '../auth/oauthState';
import { decryptCredential, encryptCredential } from '../auth/credentialEncryption';
import { getAnalyticsProviderConfig } from './analyticsProviderConfigService';
import { ownedDbTable } from '../db/writeOwner';


export type AnalyticsProvider = 'GA4' | 'GSC';
export type AnalyticsIntegrationStatus = 'connected' | 'disconnected' | 'error';

export type AnalyticsIntegrationRecord = {
  id: string;
  company_id: string;
  provider: AnalyticsProvider;
  status: AnalyticsIntegrationStatus;
  created_at: string;
  updated_at: string;
};

export type AnalyticsPropertyRecord = {
  id: string;
  integration_id: string;
  property_id: string;
  property_name: string;
  account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AnalyticsTokenRecord = {
  id: string;
  integration_id: string;
  access_token: string;
  refresh_token: string | null;
  expiry_date: string | null;
  scope: string | null;
  created_at: string;
  updated_at: string;
};

export type GoogleAnalyticsPropertySummary = {
  propertyId: string;
  propertyName: string;
  accountId: string | null;
  accountName: string | null;
};

export type GoogleSearchConsoleSiteSummary = {
  siteUrl: string;
  permissionLevel: string | null;
  verified: boolean;
};

type GoogleAdminApiAccountSummary = {
  account?: string | null;
  displayName?: string | null;
  propertySummaries?: Array<{
    property?: string | null;
    displayName?: string | null;
  }> | null;
};

type GoogleAdminApiAccount = {
  name?: string | null;
  displayName?: string | null;
};

type GoogleAdminApiProperty = {
  name?: string | null;
  displayName?: string | null;
  parent?: string | null;
};

export type GoogleAnalyticsConnectionStatus = {
  integration: AnalyticsIntegrationRecord | null;
  activeProperty: AnalyticsPropertyRecord | null;
  ready: boolean;
  tokenValid: boolean;
  tokenExpiresAt: string | null;
  propertiesCount: number;
  tokenScope: string | null;
};

type ConnectGoogleAnalyticsOptions = {
  userId?: string;
  returnTo?: string;
  requestBaseUrl?: string;
};

export type OAuthCallbackInput = {
  code: string;
  state?: string;
  requestBaseUrl?: string;
};

export type TokenExchangeResult = {
  access_token: string;
  refresh_token?: string;
  expiry_date: string | null;
  scope: string | null;
};

export const GA4_PROVIDER: AnalyticsProvider = 'GA4';
export const GSC_PROVIDER: AnalyticsProvider = 'GSC';
const GA4_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
].join(' ');
const REQUIRED_GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function isMissingGscProviderEnum(error: unknown): boolean {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : String(error || '');
  return /invalid input value for enum analytics_provider:\s*"?GSC"?|analytics_provider.*GSC/i.test(message);
}

function gscProviderMigrationError(): Error {
  return new Error('Search Console database support is not installed. Apply migration 20260632_google_search_console_analytics_provider.sql, then retry.');
}

export async function getGoogleAnalyticsOauthConfig(): Promise<{
  client_id: string;
  client_secret: string;
  scopes: string[];
  redirect_uri: string | null;
  capability_redirect_uris: {
    google_analytics: string | null;
    google_search_console: string | null;
  };
}> {
  const config = await getAnalyticsProviderConfig('google_analytics');
  if (!config?.enabled) {
    throw new Error('Google Analytics is not enabled');
  }
  if (!config.oauth_client_id || !config.oauth_client_secret) {
    throw new Error('Google Analytics OAuth credentials are not configured');
  }

  return {
    client_id: config.oauth_client_id,
    client_secret: config.oauth_client_secret,
    scopes: config.scopes,
    redirect_uri: config.redirect_uri,
    capability_redirect_uris: config.capability_redirect_uris,
  };
}

type GoogleOauthConfig = Awaited<ReturnType<typeof getGoogleAnalyticsOauthConfig>>;

function isLocalRequestBaseUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  } catch {
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(value);
  }
}

function buildGoogleCallbackUrl(requestBaseUrl: string | null | undefined): string | null {
  const baseUrl = (requestBaseUrl || '').replace(/\/$/, '');
  return baseUrl ? `${baseUrl}/api/analytics/connect/google/callback` : null;
}

function resolveGoogleRedirectUri(
  credentials: GoogleOauthConfig,
  capability: 'google_analytics' | 'google_search_console',
  requestBaseUrl?: string,
): string {
  const requestCallback = buildGoogleCallbackUrl(requestBaseUrl);
  if (requestCallback && isLocalRequestBaseUrl(requestBaseUrl)) {
    return requestCallback;
  }

  return (
    credentials.capability_redirect_uris[capability] ||
    credentials.redirect_uri ||
    requestCallback ||
    ''
  );
}

function maybeDecrypt(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  try {
    const parts = value.split(':');
    if (parts.length === 3 && /^[0-9a-f]+$/i.test(parts[0]) && /^[0-9a-f]+$/i.test(parts[1])) {
      return decryptCredential(value);
    }
    return value;
  } catch {
    return value;
  }
}

function encryptValue(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  return encryptCredential(value);
}

export function isExpiringSoon(expiryDate: string | null | undefined, windowMinutes = 5): boolean {
  if (!expiryDate) return true;
  const expiresAt = new Date(expiryDate).getTime();
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= Date.now() + windowMinutes * 60 * 1000;
}

function parseGoogleResourceId(resourceName: string | null | undefined): string | null {
  if (!resourceName) return null;
  const parts = String(resourceName).split('/');
  const value = parts[parts.length - 1]?.trim();
  return value || null;
}

export async function getAnalyticsIntegration(companyId: string): Promise<AnalyticsIntegrationRecord | null> {
  return getAnalyticsIntegrationForProvider(companyId, GA4_PROVIDER);
}

export async function getAnalyticsIntegrationForProvider(
  companyId: string,
  provider: AnalyticsProvider,
): Promise<AnalyticsIntegrationRecord | null> {
  const { data, error } = await ownedDbTable('analytics_integrations')
    .select('*')
    .eq('company_id', companyId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) {
    if (provider === GSC_PROVIDER && isMissingGscProviderEnum(error)) {
      console.warn('[GSC-OAUTH][provider-enum-missing]', {
        company_id: companyId,
        message: error.message,
      });
      return null;
    }
    throw new Error(`Failed to load analytics integration: ${error.message}`);
  }

  return (data as AnalyticsIntegrationRecord | null) ?? null;
}

export async function ensureAnalyticsIntegration(
  companyId: string,
  status: AnalyticsIntegrationStatus,
  provider: AnalyticsProvider = GA4_PROVIDER,
): Promise<AnalyticsIntegrationRecord> {
  const existing = await getAnalyticsIntegrationForProvider(companyId, provider);
  const timestamp = new Date().toISOString();

  if (existing) {
    const { data, error } = await ownedDbTable('analytics_integrations')
      .update({
        status,
        updated_at: timestamp,
      })
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to update analytics integration: ${error.message}`);
    }

    return data as AnalyticsIntegrationRecord;
  }

  const { data, error } = await ownedDbTable('analytics_integrations')
    .insert({
      company_id: companyId,
      provider,
      status,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select('*')
    .single();

  if (error) {
    if (provider === GSC_PROVIDER && isMissingGscProviderEnum(error)) {
      throw gscProviderMigrationError();
    }
    throw new Error(`Failed to create analytics integration: ${error.message}`);
  }

  return data as AnalyticsIntegrationRecord;
}

export async function saveAnalyticsTokens(integrationId: string, token: TokenExchangeResult): Promise<void> {
  const timestamp = new Date().toISOString();
  const payload = {
    integration_id: integrationId,
    access_token: encryptValue(token.access_token),
    refresh_token: encryptValue(token.refresh_token ?? null),
    expiry_date: token.expiry_date,
    scope: token.scope,
    updated_at: timestamp,
  };

  const { data: existing, error: lookupError } = await ownedDbTable('analytics_tokens')
    .select('id')
    .eq('integration_id', integrationId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Failed to lookup analytics token: ${lookupError.message}`);
  }

  if (existing?.id) {
    const { error } = await ownedDbTable('analytics_tokens')
      .update(payload)
      .eq('id', existing.id);

    if (error) {
      throw new Error(`Failed to update analytics token: ${error.message}`);
    }
    return;
  }

  const { error } = await ownedDbTable('analytics_tokens').insert({
    ...payload,
    created_at: timestamp,
  });

  if (error) {
    throw new Error(`Failed to insert analytics token: ${error.message}`);
  }
}

export async function getAnalyticsTokenRecord(integrationId: string): Promise<AnalyticsTokenRecord | null> {
  const { data, error } = await ownedDbTable('analytics_tokens')
    .select('*')
    .eq('integration_id', integrationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load analytics token: ${error.message}`);
  }

  if (!data) return null;

  const row = data as AnalyticsTokenRecord;
  return {
    ...row,
    access_token: maybeDecrypt(row.access_token) ?? '',
    refresh_token: maybeDecrypt(row.refresh_token) ?? null,
  };
}

export async function syncAnalyticsProperties(
  integrationId: string,
  properties: GoogleAnalyticsPropertySummary[],
): Promise<AnalyticsPropertyRecord[]> {
  const timestamp = new Date().toISOString();

  if (properties.length > 0) {
    const { error } = await ownedDbTable('analytics_properties').upsert(
      properties.map((property) => ({
        integration_id: integrationId,
        property_id: property.propertyId,
        property_name: property.propertyName,
        account_id: property.accountId,
        updated_at: timestamp,
      })),
      { onConflict: 'integration_id,property_id' },
    );

    if (error) {
      throw new Error(`Failed to sync analytics properties: ${error.message}`);
    }
  }

  const { data, error } = await ownedDbTable('analytics_properties')
    .select('*')
    .eq('integration_id', integrationId)
    .order('property_name', { ascending: true });

  if (error) {
    throw new Error(`Failed to load analytics properties: ${error.message}`);
  }

  return (data ?? []) as AnalyticsPropertyRecord[];
}

function withRequiredScopes(scopes: string[], required: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const scope of [...scopes, ...required]) {
    const normalized = String(scope || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

export async function exchangeAuthorizationCode(
  code: string,
  requestBaseUrl?: string,
  capability: 'google_analytics' | 'google_search_console' = 'google_analytics',
): Promise<TokenExchangeResult> {
  const credentials = await getGoogleAnalyticsOauthConfig();
  const redirectUri = resolveGoogleRedirectUri(credentials, capability, requestBaseUrl);

  console.log('[GA-OAUTH][token-exchange] attempt', {
    redirect_uri: redirectUri,
    client_id_present: Boolean(credentials.client_id),
    client_id_suffix: credentials.client_id ? credentials.client_id.slice(-12) : null,
    client_secret_present: Boolean(credentials.client_secret),
    code_length: code.length,
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('[GA-OAUTH][token-exchange] failed', {
      status: response.status,
      body,
    });
    throw new Error(`GA4 token exchange failed (${response.status}): ${body || 'unknown error'}`);
  }

  const tokenData = await response.json();
  console.log('[GA-OAUTH][token-exchange] success', {
    access_token_present: Boolean(tokenData.access_token),
    refresh_token_present: Boolean(tokenData.refresh_token),
    expires_in: tokenData.expires_in ?? null,
    scope: tokenData.scope ?? null,
  });
  return {
    access_token: String(tokenData.access_token || ''),
    refresh_token: tokenData.refresh_token ? String(tokenData.refresh_token) : undefined,
    expiry_date: tokenData.expires_in
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : null,
    scope: typeof tokenData.scope === 'string' ? tokenData.scope : null,
  };
}

async function fetchGoogleAdminJson(
  accessToken: string,
  url: string,
): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('[GA-OAUTH][admin-api] request failed', {
      url,
      status: response.status,
      body,
    });
    throw new Error(`Google Analytics Admin API request failed (${response.status}) for ${url}: ${body || 'unknown error'}`);
  }

  return response.json();
}

async function paginateGoogleAdminCollection<T>(
  accessToken: string,
  buildUrl: (pageToken?: string) => string,
  collectionKey: string,
): Promise<T[]> {
  const rows: T[] = [];
  let pageToken: string | undefined;

  do {
    const payload = await fetchGoogleAdminJson(accessToken, buildUrl(pageToken));
    const nextRows = Array.isArray(payload?.[collectionKey]) ? payload[collectionKey] : [];
    rows.push(...nextRows);
    pageToken = typeof payload?.nextPageToken === 'string' && payload.nextPageToken.trim()
      ? payload.nextPageToken.trim()
      : undefined;
  } while (pageToken);

  return rows;
}

export async function fetchGAAccountsAndProperties(
  accessToken: string,
): Promise<GoogleAnalyticsPropertySummary[]> {
  const dedupedProperties = new Map<string, GoogleAnalyticsPropertySummary>();
  const accountNameById = new Map<string, string | null>();

  const summaries = await paginateGoogleAdminCollection<GoogleAdminApiAccountSummary>(
    accessToken,
    (pageToken) => {
      const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accountSummaries');
      url.searchParams.set('pageSize', '200');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      return url.toString();
    },
    'accountSummaries',
  );

  for (const summary of summaries) {
    const accountId = parseGoogleResourceId(summary?.account);
    const accountName = typeof summary?.displayName === 'string' ? summary.displayName : null;
    if (accountId) {
      accountNameById.set(accountId, accountName);
    }
    const propertySummaries = Array.isArray(summary?.propertySummaries) ? summary.propertySummaries : [];

    for (const property of propertySummaries) {
      const propertyId = parseGoogleResourceId(property?.property);
      const propertyName = typeof property?.displayName === 'string' ? property.displayName : '';
      if (!propertyId || !propertyName) continue;

      dedupedProperties.set(propertyId, {
        propertyId,
        propertyName,
        accountId,
        accountName,
      });
    }
  }

  if (dedupedProperties.size > 0) {
    return Array.from(dedupedProperties.values()).sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }

  const accounts = await paginateGoogleAdminCollection<GoogleAdminApiAccount>(
    accessToken,
    (pageToken) => {
      const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accounts');
      url.searchParams.set('pageSize', '200');
      url.searchParams.set('showDeleted', 'false');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      return url.toString();
    },
    'accounts',
  );

  for (const account of accounts) {
    const accountId = parseGoogleResourceId(account?.name);
    const accountName = typeof account?.displayName === 'string' ? account.displayName : null;
    if (!accountId) continue;
    accountNameById.set(accountId, accountName);

    const properties = await paginateGoogleAdminCollection<GoogleAdminApiProperty>(
      accessToken,
      (pageToken) => {
        const url = new URL('https://analyticsadmin.googleapis.com/v1beta/properties');
        url.searchParams.set('pageSize', '200');
        url.searchParams.set('showDeleted', 'false');
        url.searchParams.set('filter', `parent:accounts/${accountId}`);
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        return url.toString();
      },
      'properties',
    );

    for (const property of properties) {
      const propertyId = parseGoogleResourceId(property?.name);
      const propertyName = typeof property?.displayName === 'string' ? property.displayName : '';
      if (!propertyId || !propertyName) continue;

      dedupedProperties.set(propertyId, {
        propertyId,
        propertyName,
        accountId,
        accountName: accountNameById.get(accountId) ?? accountName,
      });
    }
  }

  return Array.from(dedupedProperties.values()).sort((a, b) => a.propertyName.localeCompare(b.propertyName));
}

export async function fetchSearchConsoleSites(accessToken: string): Promise<GoogleSearchConsoleSiteSummary[]> {
  const response = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('[GSC-OAUTH][sites-api] request failed', {
      status: response.status,
      body,
    });
    throw new Error(`Google Search Console sites request failed (${response.status}): ${body || 'unknown error'}`);
  }

  const payload = await response.json();
  const entries = Array.isArray(payload?.siteEntry) ? payload.siteEntry : [];
  return entries
    .map((entry: any): GoogleSearchConsoleSiteSummary | null => {
      const siteUrl = typeof entry?.siteUrl === 'string' ? entry.siteUrl.trim() : '';
      if (!siteUrl) return null;
      const permissionLevel = typeof entry?.permissionLevel === 'string' ? entry.permissionLevel : null;
      return {
        siteUrl,
        permissionLevel,
        verified: permissionLevel !== 'siteUnverifiedUser',
      };
    })
    .filter((entry: GoogleSearchConsoleSiteSummary | null): entry is GoogleSearchConsoleSiteSummary => Boolean(entry))
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export function mapGscSitesToProperties(sites: GoogleSearchConsoleSiteSummary[]): GoogleAnalyticsPropertySummary[] {
  return sites.map((site) => ({
    propertyId: site.siteUrl,
    propertyName: site.siteUrl,
    accountId: site.permissionLevel,
    accountName: site.verified ? 'verified' : 'unverified',
  }));
}

export async function connectGoogleAnalytics(
  companyId: string,
  options: ConnectGoogleAnalyticsOptions = {},
): Promise<{ authorizationUrl: string }> {
  const credentials = await getGoogleAnalyticsOauthConfig();

  const baseUrl = (options.requestBaseUrl || '').replace(/\/$/, '');
  if (!baseUrl && !credentials.redirect_uri) {
    throw new Error('Request base URL is required to start GA4 OAuth');
  }

  await ensureAnalyticsIntegration(companyId, 'disconnected');

  const state = encodeOAuthState({
    companyId,
    userId: options.userId,
    returnTo: options.returnTo,
    flow: 'ga4',
  });

  const params = new URLSearchParams({
    client_id: credentials.client_id,
    redirect_uri: resolveGoogleRedirectUri(credentials, 'google_analytics', options.requestBaseUrl),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: withRequiredScopes(credentials.scopes.length > 0 ? credentials.scopes : GA4_SCOPES.split(' '), []).join(' '),
    state,
  });

  return {
    authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  };
}

export async function connectGoogleSearchConsole(
  companyId: string,
  options: ConnectGoogleAnalyticsOptions = {},
): Promise<{ authorizationUrl: string }> {
  const credentials = await getGoogleAnalyticsOauthConfig();

  const baseUrl = (options.requestBaseUrl || '').replace(/\/$/, '');
  if (!baseUrl && !credentials.redirect_uri) {
    throw new Error('Request base URL is required to start Search Console OAuth');
  }

  await ensureAnalyticsIntegration(companyId, 'disconnected', GSC_PROVIDER);

  const state = encodeOAuthState({
    companyId,
    userId: options.userId,
    returnTo: options.returnTo,
    flow: 'gsc',
  });

  const params = new URLSearchParams({
    client_id: credentials.client_id,
    redirect_uri: resolveGoogleRedirectUri(credentials, 'google_search_console', options.requestBaseUrl),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: withRequiredScopes(credentials.scopes.length > 0 ? credentials.scopes : GA4_SCOPES.split(' '), [REQUIRED_GSC_SCOPE]).join(' '),
    state,
  });

  return {
    authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  };
}

