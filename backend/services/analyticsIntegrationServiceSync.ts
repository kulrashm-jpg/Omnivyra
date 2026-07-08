/** Analytics integration — sync jobs, aggregation, entrypoints — split from analyticsIntegrationService.ts (barrel preserved; importers unchanged). */
import { decodeOAuthState, encodeOAuthState } from '../auth/oauthState';
import { decryptCredential, encryptCredential } from '../auth/credentialEncryption';
import { getAnalyticsProviderConfig } from './analyticsProviderConfigService';
import { ownedDbTable } from '../db/writeOwner';

import { type AnalyticsIntegrationRecord, type AnalyticsPropertyRecord, type AnalyticsTokenRecord, type GoogleAnalyticsConnectionStatus, type OAuthCallbackInput, type TokenExchangeResult, GA4_PROVIDER, GSC_PROVIDER, getGoogleAnalyticsOauthConfig, isExpiringSoon, getAnalyticsIntegration, getAnalyticsIntegrationForProvider, ensureAnalyticsIntegration, saveAnalyticsTokens, getAnalyticsTokenRecord, syncAnalyticsProperties, exchangeAuthorizationCode, fetchGAAccountsAndProperties, fetchSearchConsoleSites, mapGscSitesToProperties } from './analyticsIntegrationServiceProviders';

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

