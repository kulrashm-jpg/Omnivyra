import { supabase } from '../db/supabaseClient';
import {
  getGoogleAnalyticsStatus,
  getGoogleSearchConsoleStatus,
  listSearchConsoleProperties,
} from './analyticsIntegrationService';
import { getAnalyticsReadiness } from './analyticsDataReadinessService';
import { getLatestCompletedRun } from './ingestionRunService';
import { getSearchConsoleDataReadiness } from './searchConsoleReadinessService';
import { buildOmnivyraGscReportContext } from './omnivyraGscAnalyticsService';

export type GoogleCapabilityKey = 'google_analytics' | 'google_search_console';

export type GoogleCapabilityReadinessStatus =
  | 'ready'
  | 'provider_not_connected'
  | 'missing_scope'
  | 'property_required'
  | 'property_unverified'
  | 'domain_mapping_required'
  | 'failed'
  | 'ingestion_pending'
  | 'limited_coverage'
  | 'setup_required';

export type GoogleCapabilityReadiness = {
  provider: 'google';
  capability: GoogleCapabilityKey;
  provider_authenticated: boolean;
  capability_ready: boolean;
  connected: boolean;
  status: GoogleCapabilityReadinessStatus;
  message: string;
  action_label: string;
  details?: Record<string, unknown>;
};

type CompanyDomainRow = {
  input_domain?: string | null;
  final_domain?: string | null;
  verification_status?: string | null;
};

const SEARCH_CONSOLE_SCOPE_MARKERS = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/webmasters',
  'webmasters.readonly',
  'webmasters',
  'searchconsole',
];

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDomain(value: unknown): string | null {
  const raw = normalizeString(value);
  if (!raw) return null;
  if (/^sc-domain:/i.test(raw)) {
    return raw.replace(/^sc-domain:/i, '').replace(/^www\./i, '').toLowerCase();
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
  }
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => asStringList(entry));
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hasSearchConsoleScope(scopeValue: string | null | undefined): boolean {
  const scopes = asStringList(scopeValue).map((scope) => scope.toLowerCase());
  return scopes.some((scope) => SEARCH_CONSOLE_SCOPE_MARKERS.some((marker) => scope.includes(marker)));
}

async function getVerifiedCompanyDomains(companyId: string): Promise<string[]> {
  const [domainResult, companyResult] = await Promise.all([
    supabase
      .from('company_domains')
      .select('input_domain, final_domain, verification_status')
      .eq('company_id', companyId),
    supabase
      .from('companies')
      .select('website_domain, website')
      .eq('id', companyId)
      .maybeSingle(),
  ]);

  if (domainResult.error) {
    console.warn('[googleProviderReadiness] failed to load company domains', {
      company_id: companyId,
      error: domainResult.error.message,
    });
  }

  const verifiedDomains = ((domainResult.data ?? []) as CompanyDomainRow[])
    .filter((row) => row.verification_status === 'verified' || row.verification_status === 'admin_override')
    .flatMap((row) => [normalizeDomain(row.final_domain), normalizeDomain(row.input_domain)])
    .filter((domain): domain is string => Boolean(domain));

  const company = (companyResult as { data?: Record<string, unknown> | null }).data ?? null;
  const profileDomains = [normalizeDomain(company?.website_domain), normalizeDomain(company?.website)]
    .filter((domain): domain is string => Boolean(domain));

  return Array.from(new Set([...verifiedDomains, ...profileDomains]));
}

function propertyMatchesCompanyDomain(property: string | null, domains: string[]): boolean {
  const propertyDomain = normalizeDomain(property);
  if (!propertyDomain) return false;
  return domains.some((domain) => propertyDomain === domain || propertyDomain.endsWith(`.${domain}`));
}

export async function getGoogleAnalyticsCapabilityReadiness(companyId: string): Promise<GoogleCapabilityReadiness> {
  const [status, analyticsReadiness] = await Promise.all([
    getGoogleAnalyticsStatus(companyId),
    getAnalyticsReadiness(companyId).catch(() => null),
  ]);
  const providerAuthenticated = status.integration?.status === 'connected' && status.tokenValid;

  if (status.ready && analyticsReadiness?.ready) {
    return {
      provider: 'google',
      capability: 'google_analytics',
      provider_authenticated: providerAuthenticated,
      capability_ready: true,
      connected: true,
      status: 'ready',
      message: 'Google Analytics is report-ready.',
      action_label: 'Connected',
      details: {
        active_property_id: status.activeProperty?.property_id ?? null,
        active_property_name: status.activeProperty?.property_name ?? null,
        properties_count: status.propertiesCount,
        last_successful_ingestion_at: analyticsReadiness.last_successful_ingestion_at,
        events_last_30_days: analyticsReadiness.events_last_30_days,
      },
    };
  }

  if (!providerAuthenticated) {
    return {
      provider: 'google',
      capability: 'google_analytics',
      provider_authenticated: false,
      capability_ready: false,
      connected: false,
      status: 'provider_not_connected',
      message: 'Connect Google Analytics to use live analytics data.',
      action_label: 'Connect Google Analytics',
    };
  }

  if (status.ready && analyticsReadiness && !analyticsReadiness.ready) {
    const readinessStatus: GoogleCapabilityReadinessStatus =
      analyticsReadiness.status === 'failed' ? 'failed' : 'ingestion_pending';
    return {
      provider: 'google',
      capability: 'google_analytics',
      provider_authenticated: true,
      capability_ready: false,
      connected: false,
      status: readinessStatus,
      message: analyticsReadiness.reason || 'Google Analytics is connected. Sync analytics data to make it report-ready.',
      action_label: 'Sync Google Analytics',
      details: {
        active_property_id: status.activeProperty?.property_id ?? null,
        active_property_name: status.activeProperty?.property_name ?? null,
        properties_count: status.propertiesCount,
        last_successful_ingestion_at: analyticsReadiness.last_successful_ingestion_at,
        events_last_30_days: analyticsReadiness.events_last_30_days,
      },
    };
  }

  return {
    provider: 'google',
    capability: 'google_analytics',
    provider_authenticated: true,
    capability_ready: false,
    connected: false,
    status: 'property_required',
    message: 'Select an active Google Analytics property before generating analytics reports.',
    action_label: 'Select GA property',
    details: {
      properties_count: status.propertiesCount,
    },
  };
}

export async function getGoogleSearchConsoleReadiness(companyId: string): Promise<GoogleCapabilityReadiness> {
  const status = await getGoogleSearchConsoleStatus(companyId);
  const providerAuthenticated = status.integration?.status === 'connected' && status.tokenValid;

  if (!status.integration) {
    return {
      provider: 'google',
      capability: 'google_search_console',
      provider_authenticated: false,
      capability_ready: false,
      connected: false,
      status: 'setup_required',
      message: 'Search Console setup is required before it can be used for reports.',
      action_label: 'Connect Search Console',
    };
  }

  if (!providerAuthenticated) {
    if (status.integration?.status === 'disconnected') {
      return {
        provider: 'google',
        capability: 'google_search_console',
        provider_authenticated: false,
        capability_ready: false,
        connected: false,
        status: 'setup_required',
        message: 'Search Console setup is required before it can be used for reports.',
        action_label: 'Connect Search Console',
      };
    }
    const statusCode: GoogleCapabilityReadinessStatus = hasSearchConsoleScope(status.tokenScope)
      ? 'provider_not_connected'
      : 'missing_scope';
    return {
      provider: 'google',
      capability: 'google_search_console',
      provider_authenticated: false,
      capability_ready: false,
      connected: false,
      status: statusCode,
      message: statusCode === 'missing_scope'
        ? 'Search Console OAuth scope is missing.'
        : 'Reconnect Search Console to refresh access.',
      action_label: 'Reconnect Search Console',
    };
  }

  if (!hasSearchConsoleScope(status.tokenScope)) {
    return {
      provider: 'google',
      capability: 'google_search_console',
      provider_authenticated: true,
      capability_ready: false,
      connected: false,
      status: 'missing_scope',
      message: 'Search Console OAuth scope is missing.',
      action_label: 'Reconnect Search Console',
    };
  }

  const property = status.activeProperty?.property_id ?? null;
  if (!property) {
    return {
      provider: 'google',
      capability: 'google_search_console',
      provider_authenticated: true,
      capability_ready: false,
      connected: false,
      status: 'property_required',
      message: 'Select a Search Console property before it can be used for reports.',
      action_label: 'Select Search Console property',
    };
  }

  const properties = await listSearchConsoleProperties(companyId, { syncRemote: false }).catch(() => []);
  const selectedProperty = properties.find((entry) => entry.property_id === property);
  if (selectedProperty?.account_id === 'siteUnverifiedUser') {
    return {
      provider: 'google',
      capability: 'google_search_console',
      provider_authenticated: true,
      capability_ready: false,
      connected: false,
      status: 'property_unverified',
      message: 'The selected Search Console property must be verified before it can be used for reports.',
      action_label: 'Verify Search Console property',
      details: { property },
    };
  }

  const verifiedDomains = await getVerifiedCompanyDomains(companyId);
  if (!propertyMatchesCompanyDomain(property, verifiedDomains)) {
    return {
      provider: 'google',
      capability: 'google_search_console',
      provider_authenticated: true,
      capability_ready: false,
      connected: false,
      status: 'domain_mapping_required',
      message: 'The Search Console property must match this organization domain.',
      action_label: 'Map Search Console domain',
      details: {
        property,
        verified_domains: verifiedDomains,
      },
    };
  }

  const platformGscContext = await buildOmnivyraGscReportContext(companyId).catch(() => null);
  if (
    platformGscContext?.provenance.source === 'gsc_canonical_ingestion' &&
    platformGscContext.provenance.property_url === property &&
    (platformGscContext.status.status === 'live' ||
      platformGscContext.status.status === 'stale' ||
      platformGscContext.status.status === 'partial')
  ) {
    return {
      provider: 'google',
      capability: 'google_search_console',
      provider_authenticated: true,
      capability_ready: platformGscContext.status.status === 'live',
      connected: true,
      status: platformGscContext.status.status === 'live' ? 'ready' : 'limited_coverage',
      message: platformGscContext.status.message,
      action_label: 'Connected',
      details: {
        property,
        last_successful_ingestion_at: platformGscContext.status.last_sync,
        search_data_status: platformGscContext.status.status,
        rows_ingested: platformGscContext.status.rows_ingested,
        latest_metric_date: platformGscContext.status.last_successful_data_date,
        provenance: platformGscContext.provenance.source,
      },
    };
  }

  const [latestRun, dataReadiness] = await Promise.all([
    getLatestCompletedRun(companyId, 'gsc').catch(() => null),
    getSearchConsoleDataReadiness(companyId).catch(() => null),
  ]);
  if (!latestRun?.completed_at) {
    return {
      provider: 'google',
      capability: 'google_search_console',
      provider_authenticated: true,
      capability_ready: false,
      connected: false,
      status: 'ingestion_pending',
      message: 'Search Console is connected. Sync search data to make it report-ready.',
      action_label: 'Sync Search Console',
      details: { property },
    };
  }

  if (dataReadiness && !dataReadiness.ready) {
    const status: GoogleCapabilityReadinessStatus =
      dataReadiness.status === 'insufficient_coverage' ? 'limited_coverage' : 'ingestion_pending';
    return {
      provider: 'google',
      capability: 'google_search_console',
      provider_authenticated: true,
      capability_ready: false,
      connected: false,
      status,
      message: dataReadiness.reason,
      action_label: 'Sync Search Console',
      details: {
        property,
        last_successful_ingestion_at: latestRun.completed_at,
        search_data_status: dataReadiness.status,
        metrics_last_90_days: dataReadiness.metrics_last_90_days,
        keywords_last_90_days: dataReadiness.keywords_last_90_days,
        pages_last_90_days: dataReadiness.pages_last_90_days,
        history_days: dataReadiness.history_days,
        latest_metric_date: dataReadiness.latest_metric_date,
      },
    };
  }

  return {
    provider: 'google',
    capability: 'google_search_console',
    provider_authenticated: true,
    capability_ready: true,
    connected: true,
    status: 'ready',
    message: 'Search Console is report-ready.',
    action_label: 'Connected',
    details: {
      property,
      last_successful_ingestion_at: latestRun.completed_at,
      search_data_status: dataReadiness?.status ?? 'ready',
      metrics_last_90_days: dataReadiness?.metrics_last_90_days ?? null,
      keywords_last_90_days: dataReadiness?.keywords_last_90_days ?? null,
      pages_last_90_days: dataReadiness?.pages_last_90_days ?? null,
      history_days: dataReadiness?.history_days ?? null,
      latest_metric_date: dataReadiness?.latest_metric_date ?? null,
    },
  };
}

export async function getGoogleProviderReadiness(companyId: string): Promise<Record<GoogleCapabilityKey, GoogleCapabilityReadiness>> {
  const [googleAnalytics, googleSearchConsole] = await Promise.all([
    getGoogleAnalyticsCapabilityReadiness(companyId),
    getGoogleSearchConsoleReadiness(companyId),
  ]);

  return {
    google_analytics: googleAnalytics,
    google_search_console: googleSearchConsole,
  };
}
