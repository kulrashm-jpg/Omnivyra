import { getAnalyticsReadiness } from './analyticsDataReadinessService';
import {
  getGoogleAnalyticsStatus,
  listGoogleAnalyticsProperties,
  type AnalyticsPropertyRecord,
} from './analyticsIntegrationService';
import { getLatestCompletedRun } from './ingestionRunService';

export type GoogleAnalyticsUiStatus =
  | 'not_connected'
  | 'property_selection'
  | 'connected'
  | 'waiting_for_data'
  | 'ready'
  | 'low_data'
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
};

function mapProperty(property: AnalyticsPropertyRecord | null) {
  if (!property) return null;
  return {
    id: property.property_id,
    name: property.property_name,
    account_id: property.account_id,
  };
}

export async function getGoogleAnalyticsStatusPayload(
  companyId: string,
): Promise<GoogleAnalyticsStatusPayload> {
  const [connectionStatus, readiness, lastCompletedRun, properties] = await Promise.all([
    getGoogleAnalyticsStatus(companyId),
    getAnalyticsReadiness(companyId),
    getLatestCompletedRun(companyId, 'ga4'),
    listGoogleAnalyticsProperties(companyId, { syncRemote: false }).catch(() => []),
  ]);

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
    };
  }

  if (!readiness.ready) {
    const status = readiness.events_last_30_days > 0 ? 'low_data' : 'waiting_for_data';
    const message = status === 'low_data'
      ? 'No analytics data available yet'
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
