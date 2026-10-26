/** Analytics integration — sync jobs, aggregation, entrypoints — split from analyticsIntegrationService.ts (barrel preserved; importers unchanged). */
import { decodeOAuthState, encodeOAuthState } from '../auth/oauthState';
import { decryptCredential, encryptCredential } from '../auth/credentialEncryption';
import { getAnalyticsProviderConfig } from './analyticsProviderConfigService';
import { ownedDbTable } from '../db/writeOwner';

import { type AnalyticsIntegrationRecord, type AnalyticsPropertyRecord, type AnalyticsTokenRecord, type GoogleAnalyticsConnectionStatus, type OAuthCallbackInput, type TokenExchangeResult, GA4_PROVIDER, GSC_PROVIDER, getGoogleAnalyticsOauthConfig, isExpiringSoon, getAnalyticsIntegration, getAnalyticsIntegrationForProvider, ensureAnalyticsIntegrationExists, markAnalyticsIntegrationConnected, saveAnalyticsTokens, getAnalyticsTokenRecord, syncAnalyticsProperties, exchangeAuthorizationCode, fetchGAAccountsAndProperties, fetchSearchConsoleSites, mapGscSitesToProperties } from './analyticsIntegrationServiceProviders';

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

  // Order matters: the row is marked connected (and any stale reauth state cleared) only after the new
  // tokens are persisted, so a failed save never leaves a "connected" row holding old tokens.
  const existing = await ensureAnalyticsIntegrationExists(state.companyId, GA4_PROVIDER);
  await saveAnalyticsTokens(existing.id, token);
  console.log('[GA-OAUTH][handleOAuthCallback] tokens saved');
  const integration = await markAnalyticsIntegrationConnected(existing.id);
  console.log('[GA-OAUTH][handleOAuthCallback] integration connected', {
    integration_id: integration.id,
    status: integration.status,
  });

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

  // Connected (and stale reauth state cleared) only after the new tokens are persisted.
  const existing = await ensureAnalyticsIntegrationExists(state.companyId, GSC_PROVIDER);
  await saveAnalyticsTokens(existing.id, token);
  const integration = await markAnalyticsIntegrationConnected(existing.id);

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
 * Start the first import after the connection is usable (token saved + property activated). The work is
 * queued for the worker (analyticsPostConnectImport) so a serverless function ending cannot cut it short;
 * the HTTP response never waits on it, and errors are logged, never thrown.
 */
export function triggerImmediateGa4Ingestion(companyId: string): void {
  void import('./analyticsPostConnectImport').then((m) => m.schedulePostConnectImport(companyId, 'ga4')).catch((err) => {
    console.error('[GA-OAUTH][INITIAL_GA_INGESTION_SCHEDULE_FAILED]', { company_id: companyId, message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) });
  });
}

export function triggerImmediateGscIngestion(companyId: string): void {
  void import('./analyticsPostConnectImport').then((m) => m.schedulePostConnectImport(companyId, 'gsc')).catch((err) => {
    console.error('[GSC-OAUTH][INITIAL_GSC_INGESTION_SCHEDULE_FAILED]', { company_id: companyId, message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) });
  });
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

export type TokenRefreshOutcome = 'revoked' | 'transient' | 'client_misconfigured' | 'failed';

/**
 * Classify a failed Google token refresh. Pure.
 *   revoked              invalid_grant: consent withdrawn, password change, token expired by policy —
 *                        only the tenant reconnecting fixes it.
 *   transient            429 / 5xx / network / timeout — retry later; the connection is NOT broken.
 *   client_misconfigured invalid_client / unauthorized_client: the PLATFORM OAuth client is wrong;
 *                        not this tenant's fault, so the tenant connection is left as it is.
 *   failed               anything else.
 */
export function classifyTokenRefreshFailure(httpStatus: number | null, googleError: string | null): TokenRefreshOutcome {
  if (googleError === 'invalid_grant') return 'revoked';
  if (googleError === 'invalid_client' || googleError === 'unauthorized_client') return 'client_misconfigured';
  if (httpStatus == null || httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) return 'transient';
  return 'failed';
}

export class TokenRefreshError extends Error {
  constructor(readonly outcome: TokenRefreshOutcome, readonly httpStatus: number | null, message: string) {
    super(message);
    this.name = 'TokenRefreshError';
  }
}

/** Best-effort write of the canonical connection-state columns (20260625); never fails the caller. */
async function writeConnectionState(integrationId: string, fields: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await ownedDbTable('analytics_integrations').update(fields).eq('id', integrationId);
    if (error) console.warn('[analytics-token-refresh] connection-state write failed', { integration_id: integrationId, message: error.message });
  } catch (err) {
    console.warn('[analytics-token-refresh] connection-state write failed', { integration_id: integrationId, message: err instanceof Error ? err.message : String(err) });
  }
}

const providerLabel = (provider: unknown) => (provider === GSC_PROVIDER ? 'Search Console' : 'Google Analytics');

export async function refreshAccessToken(
  integrationId: string,
  deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AnalyticsTokenRecord> {
  const { data: integrationRow } = await ownedDbTable('analytics_integrations')
    .select('provider')
    .eq('id', integrationId)
    .maybeSingle();
  const label = providerLabel((integrationRow as { provider?: unknown } | null)?.provider);

  const token = await getAnalyticsTokenRecord(integrationId);
  if (!token?.refresh_token) {
    throw new TokenRefreshError('revoked', null, `${label} refresh token is missing — reconnect required (invalid_grant)`);
  }

  const credentials = await getGoogleAnalyticsOauthConfig();

  let response: Response | null = null;
  let googleError: string | null = null;
  let googleDescription = '';
  try {
    response = await (deps.fetchImpl ?? fetch)('https://oauth2.googleapis.com/token', {
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
      signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
    });
  } catch (err) {
    googleDescription = err instanceof Error && err.name === 'TimeoutError' ? 'request timed out' : 'network error';
  }

  if (!response || !response.ok) {
    if (response) {
      // Only Google's error code and description — never the raw body (it can echo request fields).
      const parsed = await response.json().catch(() => null) as { error?: unknown; error_description?: unknown } | null;
      googleError = typeof parsed?.error === 'string' ? parsed.error.slice(0, 60) : null;
      googleDescription = typeof parsed?.error_description === 'string' ? parsed.error_description.slice(0, 160) : response.statusText;
    }
    const httpStatus = response?.status ?? null;
    const outcome = classifyTokenRefreshFailure(httpStatus, googleError);
    const message = `${label} token refresh failed (${httpStatus ?? 'no response'}${googleError ? `, ${googleError}` : ''}): ${googleDescription || 'unknown error'}`;
    const now = new Date().toISOString();
    // Only a revoked grant breaks the tenant connection; transient and platform-client failures keep it
    // usable for the next attempt (the daily OAuth sweep and the next sync retry).
    if (outcome === 'revoked') {
      await ownedDbTable('analytics_integrations').update({ status: 'error', updated_at: now }).eq('id', integrationId);
    }
    await writeConnectionState(integrationId, outcome === 'revoked'
      ? { connection_state: 'PROVIDER_REAUTH_REQUIRED', last_provider_error: message.slice(0, 200), last_live_check_at: now, last_live_check_status: 'unauthorised' }
      : { last_provider_error: message.slice(0, 200), last_live_check_at: now, last_live_check_status: outcome === 'transient' ? 'server_error' : 'error' });
    throw new TokenRefreshError(outcome, httpStatus, message);
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
  await writeConnectionState(integrationId, { connection_state: 'CONNECTED', last_provider_error: null });

  const updated = await getAnalyticsTokenRecord(integrationId);
  if (!updated) {
    throw new Error(`Refreshed ${label} token could not be reloaded`);
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

