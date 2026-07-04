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

type OAuthCallbackInput = {
  code: string;
  state?: string;
  requestBaseUrl?: string;
};

type TokenExchangeResult = {
  access_token: string;
  refresh_token?: string;
  expiry_date: string | null;
  scope: string | null;
};

const GA4_PROVIDER: AnalyticsProvider = 'GA4';
const GSC_PROVIDER: AnalyticsProvider = 'GSC';
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

async function getGoogleAnalyticsOauthConfig(): Promise<{
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

function isExpiringSoon(expiryDate: string | null | undefined, windowMinutes = 5): boolean {
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

async function getAnalyticsIntegration(companyId: string): Promise<AnalyticsIntegrationRecord | null> {
  return getAnalyticsIntegrationForProvider(companyId, GA4_PROVIDER);
}

async function getAnalyticsIntegrationForProvider(
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

async function ensureAnalyticsIntegration(
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

async function saveAnalyticsTokens(integrationId: string, token: TokenExchangeResult): Promise<void> {
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

async function getAnalyticsTokenRecord(integrationId: string): Promise<AnalyticsTokenRecord | null> {
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

async function syncAnalyticsProperties(
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

async function exchangeAuthorizationCode(
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

function mapGscSitesToProperties(sites: GoogleSearchConsoleSiteSummary[]): GoogleAnalyticsPropertySummary[] {
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

export async function handleGoogleOAuthCallback(
  input: OAuthCallbackInput,
): Promise<{
  companyId: string;
  integration: AnalyticsIntegrationRecord;
  properties: AnalyticsPropertyRecord[];
  returnTo: string | null;
  flow: 'ga4' | 'gsc';
}> {
  const state = decodeOAuthState(input.state);
  if (state.flow === 'gsc') {
    const result = await handleSearchConsoleOAuthCallback(input);
    return { ...result, flow: 'gsc' };
  }
  const result = await handleOAuthCallback(input);
  return { ...result, flow: 'ga4' };
}

export async function handleOAuthCallback(
  input: OAuthCallbackInput,
): Promise<{
  companyId: string;
  integration: AnalyticsIntegrationRecord;
  properties: AnalyticsPropertyRecord[];
  returnTo: string | null;
}> {
  const state = decodeOAuthState(input.state);
  console.log('[GA-OAUTH][handleOAuthCallback] start', {
    state_valid: state.valid,
    state_company_id: state.companyId ?? null,
    has_request_base_url: Boolean(input.requestBaseUrl),
  });
  if (state.valid !== true) {
    throw new Error('Invalid OAuth state');
  }
  if (!state.companyId) {
    throw new Error('OAuth state is missing company context');
  }
  if (!input.requestBaseUrl) {
    throw new Error('Request base URL is required for GA4 OAuth callback');
  }

  const token = await exchangeAuthorizationCode(input.code, input.requestBaseUrl, 'google_analytics');
  if (!token.access_token) {
    throw new Error('OAuth callback did not return an access token');
  }

  const integration = await ensureAnalyticsIntegration(state.companyId, 'connected');
  console.log('[GA-OAUTH][handleOAuthCallback] integration upserted', {
    integration_id: integration.id,
    status: integration.status,
  });
  await saveAnalyticsTokens(integration.id, token);
  console.log('[GA-OAUTH][handleOAuthCallback] tokens saved');

  console.log('[GA-OAUTH][ga-api] fetching accounts/properties');
  const properties = await fetchGAAccountsAndProperties(token.access_token);
  console.log('[GA-OAUTH][ga-api] properties fetched', {
    count: properties.length,
    sample: properties.slice(0, 3).map((p) => ({ id: p.propertyId, name: p.propertyName })),
  });
  const syncedProperties = await syncAnalyticsProperties(integration.id, properties);
  console.log('[GA-OAUTH][handleOAuthCallback] properties synced', {
    synced_count: syncedProperties.length,
  });

  // Fire-and-forget initial ingestion ONLY when a property is already active
  // (typical reconnect path). For first-time connections, the property hasn't
  // been chosen yet — saveSelectedProperty() will fire ingestion instead.
  if (syncedProperties.some((p) => p.is_active)) {
    triggerImmediateGa4Ingestion(state.companyId);
  }

  return {
    companyId: state.companyId,
    integration,
    properties: syncedProperties,
    returnTo: state.returnTo ?? null,
  };
}

export async function handleSearchConsoleOAuthCallback(
  input: OAuthCallbackInput,
): Promise<{
  companyId: string;
  integration: AnalyticsIntegrationRecord;
  properties: AnalyticsPropertyRecord[];
  returnTo: string | null;
}> {
  const state = decodeOAuthState(input.state);
  console.log('[GSC-OAUTH][handleOAuthCallback] start', {
    state_valid: state.valid,
    state_company_id: state.companyId ?? null,
    has_request_base_url: Boolean(input.requestBaseUrl),
  });
  if (state.valid !== true) {
    throw new Error('Invalid OAuth state');
  }
  if (!state.companyId) {
    throw new Error('OAuth state is missing company context');
  }
  if (!input.requestBaseUrl) {
    throw new Error('Request base URL is required for Search Console OAuth callback');
  }

  const token = await exchangeAuthorizationCode(input.code, input.requestBaseUrl, 'google_search_console');
  if (!token.access_token) {
    throw new Error('OAuth callback did not return an access token');
  }

  const integration = await ensureAnalyticsIntegration(state.companyId, 'connected', GSC_PROVIDER);
  await saveAnalyticsTokens(integration.id, token);

  const sites = await fetchSearchConsoleSites(token.access_token);
  const syncedProperties = await syncAnalyticsProperties(integration.id, mapGscSitesToProperties(sites));

  if (syncedProperties.some((p) => p.is_active)) {
    triggerImmediateGscIngestion(state.companyId);
  }

  return {
    companyId: state.companyId,
    integration,
    properties: syncedProperties,
    returnTo: state.returnTo ?? null,
  };
}

/**
 * Kick off an initial GA4 ingestion immediately after the connection is usable
 * (token saved + property activated). Fire-and-forget: the caller's HTTP
 * response must not wait on this. Errors are logged, never thrown.
 *
 * Uses a deferred dynamic import to avoid the cycle between this module and
 * ingestionScheduler (the scheduler imports getGoogleAnalyticsStatus from
 * here).
 */
export function triggerImmediateGa4Ingestion(companyId: string): void {
  void (async () => {
    try {
      const { runIngestionForCompany } = await import('./ingestionScheduler');
      const summary = await runIngestionForCompany({
        companyId,
        sources: ['ga4'],
      });
      console.log('[GA-OAUTH][initial-ingestion] completed', {
        company_id: companyId,
        sources: summary.sources.map((s) => ({
          source: s.source,
          success: s.success,
          skipped: s.skipped ?? false,
          error: s.error ?? null,
        })),
        ready: summary.ready,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error('[GA-OAUTH][INITIAL_GA_INGESTION_FAILED]', {
        company_id: companyId,
        message,
        stack,
      });
    }
  })();
}

export function triggerImmediateGscIngestion(companyId: string): void {
  void (async () => {
    try {
      const { resolveOmnivyraWebsiteCompany } = await import('./omnivyraWebsiteCompanyService');
      const omnivyraCompany = await resolveOmnivyraWebsiteCompany().catch(() => null);
      if (omnivyraCompany?.id === companyId) {
        const { runOmnivyraGscIngestion } = await import('./omnivyraGscAnalyticsService');
        const result = await runOmnivyraGscIngestion({ forceBackfill: true });
        console.log('[GSC-OAUTH][initial-platform-ingestion] completed', {
          company_id: companyId,
          property_url: result.property_url,
          status: result.status,
          rows_ingested: result.rows_ingested,
          retries: result.retries,
        });
        return;
      }

      const { runIngestionForCompany } = await import('./ingestionScheduler');
      const { buildGscHistoricalBackfillOverride } = await import('./gscIngestionService');
      const summary = await runIngestionForCompany({
        companyId,
        sources: ['gsc'],
        overrides: {
          gsc: buildGscHistoricalBackfillOverride(),
        },
        force: true,
        reason: 'initial_gsc_90_day_backfill',
      });
      console.log('[GSC-OAUTH][initial-ingestion] completed', {
        company_id: companyId,
        sources: summary.sources.map((s) => ({
          source: s.source,
          success: s.success,
          skipped: s.skipped ?? false,
          error: s.error ?? null,
        })),
        ready: summary.ready,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error('[GSC-OAUTH][INITIAL_GSC_INGESTION_FAILED]', {
        company_id: companyId,
        message,
        stack,
      });
    }
  })();
}

export async function saveSelectedProperty(
  companyId: string,
  propertyId: string,
): Promise<AnalyticsPropertyRecord> {
  const integration = await getAnalyticsIntegration(companyId);
  if (!integration) {
    throw new Error('GA4 integration not found for company');
  }

  const { data: property, error: propertyError } = await ownedDbTable('analytics_properties')
    .select('*')
    .eq('integration_id', integration.id)
    .eq('property_id', propertyId)
    .maybeSingle();

  if (propertyError) {
    throw new Error(`Failed to load analytics property: ${propertyError.message}`);
  }
  if (!property) {
    throw new Error('Selected GA4 property does not belong to this company integration');
  }

  const timestamp = new Date().toISOString();

  const { error: resetError } = await ownedDbTable('analytics_properties')
    .update({ is_active: false, updated_at: timestamp })
    .eq('integration_id', integration.id)
    .eq('is_active', true);

  if (resetError) {
    throw new Error(`Failed to deactivate current GA4 property: ${resetError.message}`);
  }

  const { data, error } = await ownedDbTable('analytics_properties')
    .update({ is_active: true, updated_at: timestamp })
    .eq('id', (property as AnalyticsPropertyRecord).id)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to activate GA4 property: ${error.message}`);
  }

  triggerImmediateGa4Ingestion(companyId);

  return data as AnalyticsPropertyRecord;
}

export async function saveSelectedSearchConsoleProperty(
  companyId: string,
  propertyId: string,
): Promise<AnalyticsPropertyRecord> {
  const integration = await getAnalyticsIntegrationForProvider(companyId, GSC_PROVIDER);
  if (!integration) {
    throw new Error('Search Console integration not found for company');
  }

  const { data: property, error: propertyError } = await ownedDbTable('analytics_properties')
    .select('*')
    .eq('integration_id', integration.id)
    .eq('property_id', propertyId)
    .maybeSingle();

  if (propertyError) {
    throw new Error(`Failed to load Search Console property: ${propertyError.message}`);
  }
  if (!property) {
    throw new Error('Selected Search Console property does not belong to this company integration');
  }

  const timestamp = new Date().toISOString();

  const { error: resetError } = await ownedDbTable('analytics_properties')
    .update({ is_active: false, updated_at: timestamp })
    .eq('integration_id', integration.id)
    .eq('is_active', true);

  if (resetError) {
    throw new Error(`Failed to deactivate current Search Console property: ${resetError.message}`);
  }

  const { data, error } = await ownedDbTable('analytics_properties')
    .update({ is_active: true, updated_at: timestamp })
    .eq('id', (property as AnalyticsPropertyRecord).id)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to activate Search Console property: ${error.message}`);
  }

  triggerImmediateGscIngestion(companyId);

  return data as AnalyticsPropertyRecord;
}

export async function disconnectSearchConsole(companyId: string): Promise<{ disconnected: boolean }> {
  const integration = await getAnalyticsIntegrationForProvider(companyId, GSC_PROVIDER);
  if (!integration) {
    return { disconnected: false };
  }

  const timestamp = new Date().toISOString();

  const { error: propertyError } = await ownedDbTable('analytics_properties')
    .update({ is_active: false, updated_at: timestamp })
    .eq('integration_id', integration.id)
    .eq('is_active', true);

  if (propertyError) {
    throw new Error(`Failed to deactivate Search Console properties: ${propertyError.message}`);
  }

  const { error: tokenError } = await ownedDbTable('analytics_tokens')
    .delete()
    .eq('integration_id', integration.id);

  if (tokenError) {
    throw new Error(`Failed to remove Search Console token: ${tokenError.message}`);
  }

  const { error: integrationError } = await ownedDbTable('analytics_integrations')
    .update({ status: 'disconnected', updated_at: timestamp })
    .eq('id', integration.id);

  if (integrationError) {
    throw new Error(`Failed to disconnect Search Console integration: ${integrationError.message}`);
  }

  return { disconnected: true };
}

/**
 * Disconnect GA4 for a tenant — canonical mirror of disconnectSearchConsole
 * (deactivate properties, remove tokens, mark integration disconnected). Tokens
 * are removed; reconnect re-runs the OAuth flow. Idempotent when not connected.
 */
export async function disconnectGoogleAnalytics(companyId: string): Promise<{ disconnected: boolean }> {
  const integration = await getAnalyticsIntegrationForProvider(companyId, GA4_PROVIDER);
  if (!integration) {
    return { disconnected: false };
  }

  const timestamp = new Date().toISOString();

  const { error: propertyError } = await ownedDbTable('analytics_properties')
    .update({ is_active: false, updated_at: timestamp })
    .eq('integration_id', integration.id)
    .eq('is_active', true);

  if (propertyError) {
    throw new Error(`Failed to deactivate Analytics properties: ${propertyError.message}`);
  }

  const { error: tokenError } = await ownedDbTable('analytics_tokens')
    .delete()
    .eq('integration_id', integration.id);

  if (tokenError) {
    throw new Error(`Failed to remove Analytics token: ${tokenError.message}`);
  }

  const { error: integrationError } = await ownedDbTable('analytics_integrations')
    .update({ status: 'disconnected', updated_at: timestamp })
    .eq('id', integration.id);

  if (integrationError) {
    throw new Error(`Failed to disconnect Analytics integration: ${integrationError.message}`);
  }

  return { disconnected: true };
}

export async function getActiveProperty(companyId: string): Promise<AnalyticsPropertyRecord | null> {
  const integration = await getAnalyticsIntegration(companyId);
  if (!integration) return null;

  const { data, error } = await ownedDbTable('analytics_properties')
    .select('*')
    .eq('integration_id', integration.id)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load active GA4 property: ${error.message}`);
  }

  return (data as AnalyticsPropertyRecord | null) ?? null;
}

export async function getActiveSearchConsoleProperty(companyId: string): Promise<AnalyticsPropertyRecord | null> {
  const integration = await getAnalyticsIntegrationForProvider(companyId, GSC_PROVIDER);
  if (!integration) return null;

  const { data, error } = await ownedDbTable('analytics_properties')
    .select('*')
    .eq('integration_id', integration.id)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load active Search Console property: ${error.message}`);
  }

  return (data as AnalyticsPropertyRecord | null) ?? null;
}

export async function refreshAccessToken(integrationId: string): Promise<AnalyticsTokenRecord> {
  const token = await getAnalyticsTokenRecord(integrationId);
  if (!token?.refresh_token) {
    throw new Error('GA4 refresh token is missing');
  }

  const credentials = await getGoogleAnalyticsOauthConfig();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    await ownedDbTable('analytics_integrations')
      .update({ status: 'error', updated_at: new Date().toISOString() })
      .eq('id', integrationId);
    throw new Error(`GA4 token refresh failed (${response.status}): ${body || 'unknown error'}`);
  }

  const refreshed = await response.json();
  const nextToken: TokenExchangeResult = {
    access_token: String(refreshed.access_token || ''),
    refresh_token: typeof refreshed.refresh_token === 'string' ? refreshed.refresh_token : token.refresh_token,
    expiry_date: refreshed.expires_in
      ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString()
      : token.expiry_date,
    scope: typeof refreshed.scope === 'string' ? refreshed.scope : token.scope,
  };

  await saveAnalyticsTokens(integrationId, nextToken);
  await ownedDbTable('analytics_integrations')
    .update({ status: 'connected', updated_at: new Date().toISOString() })
    .eq('id', integrationId);

  const updated = await getAnalyticsTokenRecord(integrationId);
  if (!updated) {
    throw new Error('Refreshed GA4 token could not be reloaded');
  }
  return updated;
}

export async function getValidAccessTokenForIntegration(integrationId: string): Promise<string | null> {
  const token = await getAnalyticsTokenRecord(integrationId);
  if (!token?.access_token) return null;

  if (isExpiringSoon(token.expiry_date)) {
    const refreshed = await refreshAccessToken(integrationId);
    return refreshed.access_token || null;
  }

  return token.access_token;
}

export async function getValidAccessTokenForCompany(companyId: string): Promise<string | null> {
  const integration = await getAnalyticsIntegration(companyId);
  if (!integration || integration.status !== 'connected') return null;
  return getValidAccessTokenForIntegration(integration.id);
}

export async function getValidSearchConsoleAccessTokenForCompany(companyId: string): Promise<string | null> {
  const integration = await getAnalyticsIntegrationForProvider(companyId, GSC_PROVIDER);
  if (!integration || integration.status !== 'connected') return null;
  return getValidAccessTokenForIntegration(integration.id);
}

export async function listGoogleAnalyticsProperties(
  companyId: string,
  options: { syncRemote?: boolean } = {},
): Promise<AnalyticsPropertyRecord[]> {
  const integration = await getAnalyticsIntegration(companyId);
  if (!integration) return [];

  if (options.syncRemote !== false) {
    const accessToken = await getValidAccessTokenForIntegration(integration.id);
    if (accessToken) {
      const remoteProperties = await fetchGAAccountsAndProperties(accessToken);
      await syncAnalyticsProperties(integration.id, remoteProperties);
    }
  }

  const { data, error } = await ownedDbTable('analytics_properties')
    .select('*')
    .eq('integration_id', integration.id)
    .order('property_name', { ascending: true });

  if (error) {
    throw new Error(`Failed to list GA4 properties: ${error.message}`);
  }

  return (data ?? []) as AnalyticsPropertyRecord[];
}

export async function listSearchConsoleProperties(
  companyId: string,
  options: { syncRemote?: boolean } = {},
): Promise<AnalyticsPropertyRecord[]> {
  const integration = await getAnalyticsIntegrationForProvider(companyId, GSC_PROVIDER);
  if (!integration) return [];

  if (options.syncRemote !== false) {
    const accessToken = await getValidAccessTokenForIntegration(integration.id);
    if (accessToken) {
      const remoteSites = await fetchSearchConsoleSites(accessToken);
      await syncAnalyticsProperties(integration.id, mapGscSitesToProperties(remoteSites));
    }
  }

  const { data, error } = await ownedDbTable('analytics_properties')
    .select('*')
    .eq('integration_id', integration.id)
    .order('property_name', { ascending: true });

  if (error) {
    throw new Error(`Failed to list Search Console properties: ${error.message}`);
  }

  return (data ?? []) as AnalyticsPropertyRecord[];
}

export async function getGoogleAnalyticsStatus(companyId: string): Promise<GoogleAnalyticsConnectionStatus> {
  const integration = await getAnalyticsIntegration(companyId);
  if (!integration) {
    return {
      integration: null,
      activeProperty: null,
      ready: false,
      tokenValid: false,
      tokenExpiresAt: null,
      propertiesCount: 0,
      tokenScope: null,
    };
  }

  const [activeProperty, properties, token] = await Promise.all([
    getActiveProperty(companyId),
    listGoogleAnalyticsProperties(companyId, { syncRemote: false }),
    getAnalyticsTokenRecord(integration.id),
  ]);

  let tokenValid = false;
  let tokenExpiresAt = token?.expiry_date ?? null;

  if (token?.access_token) {
    try {
      const validToken = await getValidAccessTokenForIntegration(integration.id);
      tokenValid = Boolean(validToken);
      const latestToken = await getAnalyticsTokenRecord(integration.id);
      tokenExpiresAt = latestToken?.expiry_date ?? tokenExpiresAt;
    } catch {
      tokenValid = false;
    }
  }

  return {
    integration,
    activeProperty,
    ready: integration.status === 'connected' && Boolean(activeProperty) && tokenValid,
    tokenValid,
    tokenExpiresAt,
    propertiesCount: properties.length,
    tokenScope: token?.scope ?? null,
  };
}

export async function getGoogleSearchConsoleStatus(companyId: string): Promise<GoogleAnalyticsConnectionStatus> {
  const integration = await getAnalyticsIntegrationForProvider(companyId, GSC_PROVIDER);
  if (!integration) {
    return {
      integration: null,
      activeProperty: null,
      ready: false,
      tokenValid: false,
      tokenExpiresAt: null,
      propertiesCount: 0,
      tokenScope: null,
    };
  }

  const [activeProperty, properties, token] = await Promise.all([
    getActiveSearchConsoleProperty(companyId),
    listSearchConsoleProperties(companyId, { syncRemote: false }),
    getAnalyticsTokenRecord(integration.id),
  ]);

  let tokenValid = false;
  let tokenExpiresAt = token?.expiry_date ?? null;

  if (token?.access_token) {
    try {
      const validToken = await getValidAccessTokenForIntegration(integration.id);
      tokenValid = Boolean(validToken);
      const latestToken = await getAnalyticsTokenRecord(integration.id);
      tokenExpiresAt = latestToken?.expiry_date ?? tokenExpiresAt;
    } catch {
      tokenValid = false;
    }
  }

  return {
    integration,
    activeProperty,
    ready: integration.status === 'connected' && Boolean(activeProperty) && tokenValid,
    tokenValid,
    tokenExpiresAt,
    propertiesCount: properties.length,
    tokenScope: token?.scope ?? null,
  };
}

export async function resolveGa4IngestionContext(companyId: string): Promise<{
  integration: AnalyticsIntegrationRecord;
  property: AnalyticsPropertyRecord;
  accessToken: string;
}> {
  const status = await getGoogleAnalyticsStatus(companyId);
  if (!status.integration || status.integration.status !== 'connected') {
    throw new Error(`No connected GA4 integration for company ${companyId}`);
  }
  if (!status.activeProperty) {
    throw new Error(`No active GA4 property selected for company ${companyId}`);
  }

  const accessToken = await getValidAccessTokenForIntegration(status.integration.id);
  if (!accessToken) {
    throw new Error(`No valid GA4 token available for company ${companyId}`);
  }

  return {
    integration: status.integration,
    property: status.activeProperty,
    accessToken,
  };
}

export async function resolveGscIngestionContext(companyId: string): Promise<{
  integration: AnalyticsIntegrationRecord;
  property: AnalyticsPropertyRecord;
  accessToken: string;
}> {
  const status = await getGoogleSearchConsoleStatus(companyId);
  if (!status.integration || status.integration.status !== 'connected') {
    throw new Error(`No connected Search Console integration for company ${companyId}`);
  }
  if (!status.activeProperty) {
    throw new Error(`No active Search Console property selected for company ${companyId}`);
  }

  const accessToken = await getValidAccessTokenForIntegration(status.integration.id);
  if (!accessToken) {
    throw new Error(`No valid Search Console token available for company ${companyId}`);
  }

  return {
    integration: status.integration,
    property: status.activeProperty,
    accessToken,
  };
}
