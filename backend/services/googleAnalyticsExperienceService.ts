import { getAnalyticsReadiness } from './analyticsDataReadinessService';
import {
  getGoogleAnalyticsStatus,
  getGoogleSearchConsoleStatus,
  listGoogleAnalyticsProperties,
  listSearchConsoleProperties,
  type AnalyticsPropertyRecord,
} from './analyticsIntegrationService';
import { getLatestCompletedRun } from './ingestionRunService';
import { getGoogleProviderReadiness, type GoogleCapabilityReadiness } from './googleProviderReadinessService';

export type GoogleAnalyticsUiStatus =
  | 'not_connected'
  | 'property_selection'
  | 'connected'
  | 'waiting_for_data'
  | 'ready'
  | 'low_data'
  | 'limited_coverage'
  | 'property_unverified'
  | 'domain_mapping_required'
  | 'error';

export type GoogleAnalyticsStatusPayload = {
  connected: boolean;
  property: {
    id: string;
    name: string;
    account_id: string | null;
  } | null;
  status: GoogleAnalyticsUiStatus;
  message: string;
  last_sync: string | null;
  events_last_30_days: number;
  properties: Array<{
    id: string;
    name: string;
    account_id: string | null;
    active: boolean;
  }>;
  reconnect_required: boolean;
  provider_readiness?: Record<string, GoogleCapabilityReadiness>;
  search_console?: GoogleSearchConsoleStatusPayload;
};

export type GoogleSearchConsoleStatusPayload = {
  connected: boolean;
  provider_authenticated: boolean;
  capability_ready: boolean;
  readiness_status: string;
  property: {
    id: string;
    name: string;
    account_id: string | null;
  } | null;
  status: GoogleAnalyticsUiStatus | 'setup_required';
  message: string;
  last_sync: string | null;
  properties: Array<{
    id: string;
    name: string;
    account_id: string | null;
    active: boolean;
  }>;
  reconnect_required: boolean;
};

function mapProperty(property: AnalyticsPropertyRecord | null) {
  if (!property) return null;
  return {
    id: property.property_id,
    name: property.property_name,
    account_id: property.account_id,
  };
}

function describeSearchConsolePropertyLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/SERVICE_DISABLED|accessNotConfigured|Search Console API has not been used|searchconsole\.googleapis\.com/i.test(message)) {
    const project = message.match(/project\s+(\d+)/i)?.[1] || message.match(/projects\/(\d+)/i)?.[1] || null;
    const projectText = project ? ` in Google Cloud project ${project}` : '';
    return `Google Search Console API is disabled${projectText}. Enable the Search Console API in the Google Cloud project used by this OAuth client, then reconnect or refresh Search Console.`;
  }
  return message;
}

export async function getGoogleAnalyticsStatusPayload(
  companyId: string,
): Promise<GoogleAnalyticsStatusPayload> {
  const [connectionStatus, readiness, lastCompletedRun, properties, providerReadiness] = await Promise.all([
    getGoogleAnalyticsStatus(companyId),
    getAnalyticsReadiness(companyId),
    getLatestCompletedRun(companyId, 'ga4'),
    listGoogleAnalyticsProperties(companyId, { syncRemote: false }).catch(() => []),
    getGoogleProviderReadiness(companyId),
  ]);
  const searchConsole = await getGoogleSearchConsoleStatusPayload(companyId, providerReadiness.google_search_console);

  const mappedProperties = properties.map((property) => ({
    id: property.property_id,
    name: property.property_name,
    account_id: property.account_id,
    active: property.is_active,
  }));

  if (!connectionStatus.integration) {
    return {
      connected: false,
      property: null,
      status: 'not_connected',
      message: 'Connect Google Analytics',
      last_sync: null,
      events_last_30_days: 0,
      properties: mappedProperties,
      reconnect_required: false,
      provider_readiness: providerReadiness,
      search_console: searchConsole,
    };
  }

  if (connectionStatus.integration.status === 'disconnected') {
    return {
      connected: false,
      property: mapProperty(connectionStatus.activeProperty),
      status: 'not_connected',
      message: 'Connect Google Analytics',
      last_sync: lastCompletedRun?.completed_at ?? null,
      events_last_30_days: readiness.events_last_30_days,
      properties: mappedProperties,
      reconnect_required: true,
      provider_readiness: providerReadiness,
      search_console: searchConsole,
    };
  }

  if (connectionStatus.integration.status === 'error' || !connectionStatus.tokenValid) {
    return {
      connected: false,
      property: mapProperty(connectionStatus.activeProperty),
      status: 'error',
      message: 'Failed to sync analytics data',
      last_sync: lastCompletedRun?.completed_at ?? null,
      events_last_30_days: readiness.events_last_30_days,
      properties: mappedProperties,
      reconnect_required: true,
      provider_readiness: providerReadiness,
      search_console: searchConsole,
    };
  }

  if (!connectionStatus.activeProperty) {
    return {
      connected: true,
      property: null,
      status: mappedProperties.length > 0 ? 'property_selection' : 'error',
      message: mappedProperties.length > 0 ? 'Select a Google Analytics property' : 'No GA properties found',
      last_sync: lastCompletedRun?.completed_at ?? null,
      events_last_30_days: readiness.events_last_30_days,
      properties: mappedProperties,
      reconnect_required: false,
      provider_readiness: providerReadiness,
      search_console: searchConsole,
    };
  }

  if (!readiness.last_successful_ingestion_at) {
    return {
      connected: true,
      property: mapProperty(connectionStatus.activeProperty),
      status: 'waiting_for_data',
      message: 'Syncing analytics data...',
      last_sync: null,
      events_last_30_days: readiness.events_last_30_days,
      properties: mappedProperties,
      reconnect_required: false,
      provider_readiness: providerReadiness,
      search_console: searchConsole,
    };
  }

  if (!readiness.ready) {
    const status: GoogleAnalyticsUiStatus =
      readiness.status === 'failed'
        ? 'error'
        : readiness.status === 'stale'
          ? 'limited_coverage'
          : readiness.events_last_30_days > 0
            ? 'low_data'
            : 'waiting_for_data';
    const message =
      readiness.status === 'failed' || readiness.status === 'stale'
        ? readiness.reason
        : status === 'low_data'
          ? 'Analytics data is still below the reliable reporting threshold'
          : 'Syncing analytics data...';

    return {
      connected: true,
      property: mapProperty(connectionStatus.activeProperty),
      status,
      message,
      last_sync: readiness.last_successful_ingestion_at,
      events_last_30_days: readiness.events_last_30_days,
      properties: mappedProperties,
      reconnect_required: false,
      provider_readiness: providerReadiness,
      search_console: searchConsole,
    };
  }

  return {
    connected: true,
    property: mapProperty(connectionStatus.activeProperty),
    status: 'ready',
    message: 'Google Analytics connected',
    last_sync: readiness.last_successful_ingestion_at,
    events_last_30_days: readiness.events_last_30_days,
    properties: mappedProperties,
    reconnect_required: false,
    provider_readiness: providerReadiness,
    search_console: searchConsole,
  };
}

export async function getGoogleSearchConsoleStatusPayload(
  companyId: string,
  readiness?: GoogleCapabilityReadiness,
): Promise<GoogleSearchConsoleStatusPayload> {
  const [connectionStatus, storedProperties, lastCompletedRun] = await Promise.all([
    getGoogleSearchConsoleStatus(companyId),
    listSearchConsoleProperties(companyId, { syncRemote: false }).catch(() => []),
    getLatestCompletedRun(companyId, 'gsc').catch(() => null),
  ]);
  const capabilityReadiness = readiness ?? (await getGoogleProviderReadiness(companyId)).google_search_console;
  const providerAuthenticated = capabilityReadiness.provider_authenticated;
  const baseReadiness = {
    provider_authenticated: providerAuthenticated,
    capability_ready: capabilityReadiness.capability_ready,
    readiness_status: capabilityReadiness.status,
  };
  let properties = storedProperties;
  let propertyLoadError: string | null = null;

  if (connectionStatus.integration && connectionStatus.tokenValid && properties.length === 0) {
    try {
      properties = await listSearchConsoleProperties(companyId, { syncRemote: true });
    } catch (error) {
      propertyLoadError = describeSearchConsolePropertyLoadError(error);
    }
  }

  const mappedProperties = properties.map((property) => ({
    id: property.property_id,
    name: property.property_name,
    account_id: property.account_id,
    active: property.is_active,
  }));

  if (!connectionStatus.integration) {
    return {
      connected: false,
      ...baseReadiness,
      property: null,
      status: 'setup_required',
      message: 'Search Console setup required',
      last_sync: null,
      properties: mappedProperties,
      reconnect_required: false,
    };
  }

  if (connectionStatus.integration.status === 'error' || !connectionStatus.tokenValid) {
    return {
      connected: false,
      ...baseReadiness,
      property: mapProperty(connectionStatus.activeProperty),
      status: 'error',
      message: propertyLoadError || capabilityReadiness.message || 'Reconnect Search Console',
      last_sync: lastCompletedRun?.completed_at ?? null,
      properties: mappedProperties,
      reconnect_required: true,
    };
  }

  if (!connectionStatus.activeProperty) {
    return {
      connected: false,
      ...baseReadiness,
      property: null,
      status: propertyLoadError ? 'error' : mappedProperties.length > 0 ? 'property_selection' : 'setup_required',
      message: propertyLoadError || (mappedProperties.length > 0 ? 'Select Search Console property' : 'No verified Search Console properties found'),
      last_sync: lastCompletedRun?.completed_at ?? null,
      properties: mappedProperties,
      reconnect_required: false,
    };
  }

  const nonReadyStatus: GoogleSearchConsoleStatusPayload['status'] =
    capabilityReadiness.status === 'limited_coverage'
      ? 'limited_coverage'
      : capabilityReadiness.status === 'property_unverified'
        ? 'property_unverified'
        : capabilityReadiness.status === 'domain_mapping_required'
          ? 'domain_mapping_required'
          : capabilityReadiness.status === 'ingestion_pending'
            ? 'waiting_for_data'
            : 'error';

  if (!capabilityReadiness.capability_ready) {
    return {
      connected: false,
      ...baseReadiness,
      property: mapProperty(connectionStatus.activeProperty),
      status: nonReadyStatus,
      message: capabilityReadiness.message,
      last_sync: lastCompletedRun?.completed_at ?? null,
      properties: mappedProperties,
      reconnect_required: capabilityReadiness.status === 'missing_scope',
    };
  }

  return {
    connected: true,
    ...baseReadiness,
    property: mapProperty(connectionStatus.activeProperty),
    status: 'ready',
    message: 'Ready for Reports',
    last_sync: lastCompletedRun?.completed_at ?? null,
    properties: mappedProperties,
    reconnect_required: false,
  };
}

export type TrackingAssistRequest = {
  website_url: string;
  platform: string;
};

export function buildTrackingAssistResponse(input: TrackingAssistRequest): {
  status: 'ok';
  script: string;
  placement_instructions: string[];
  validation_steps: string[];
} {
  const platform = input.platform.trim() || 'custom';
  const websiteUrl = input.website_url.trim();
  const domain = websiteUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'your-site.com';

  return {
    status: 'ok',
    script: [
      '<!-- Google tag (gtag.js) -->',
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>',
      '<script>',
      '  window.dataLayer = window.dataLayer || [];',
      '  function gtag(){dataLayer.push(arguments);}',
      "  gtag('js', new Date());",
      "  gtag('config', 'G-XXXXXXXXXX');",
      '</script>',
    ].join('\n'),
    placement_instructions: [
      `Platform detected: ${platform}.`,
      `Place the Google tag inside the global <head> template for ${domain}.`,
      platform.toLowerCase().includes('wordpress')
        ? 'For WordPress, add it in the theme header or a header-injection plugin.'
        : platform.toLowerCase().includes('shopify')
          ? 'For Shopify, add it to theme.liquid before </head>.'
          : 'For custom sites, add it to the shared layout so every page includes it.',
    ],
    validation_steps: [
      'Publish the change and open the site in a new browser tab.',
      'Use Google Analytics Realtime to confirm an active page view appears.',
      'Wait for the next Omnivyra sync and then confirm the integration moves from waiting to ready.',
    ],
  };
}
