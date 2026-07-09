/** useAnalyticsTabController — state/handlers of AnalyticsTab, verbatim (full module prelude retained). */
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  type AnalyticsSummary,
  type CampaignHealthSummary,
  type CompanyData,
  type GoogleAnalyticsCompanySummary,
} from '@/pages/super-admin.types';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle,
  Eye,
  Globe,
  Key,
  MousePointerClick,
  RefreshCw,
  Search,
  TrendingUp,
} from 'lucide-react';
import { trackWebsiteEvent } from '@/lib/websiteAnalytics';

export interface AnalyticsTabProps {
  isLoadingAnalytics: boolean;
  analyticsSummary: AnalyticsSummary | null;
  campaignHealth: CampaignHealthSummary | null;
  isLoadingCampaignHealth: boolean;
  canShowExternalApisTab: boolean;
  externalApisHealth: { healthy: number; warning: number; failed: number; status: string } | null;
  companies: CompanyData[];
  onNavigateToApis: () => void;
}

type GscMetricRow = {
  label: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
};

type GscAnalyticsSummary = {
  status: {
    connected: boolean;
    status: 'no_property' | 'not_synced' | 'live' | 'stale' | 'partial' | 'failed';
    degraded_state: 'live' | 'stale' | 'partial' | 'failed' | 'no_analytics';
    message: string;
    selected_property: string | null;
    last_sync: string | null;
    last_successful_data_date: string | null;
    rows_ingested: number;
    error_message: string | null;
  };
  summary: {
    clicks: number;
    impressions: number;
    ctr: number;
    avg_position: number;
  };
  top_queries: GscMetricRow[];
  top_pages: GscMetricRow[];
  devices: GscMetricRow[];
  countries: GscMetricRow[];
  provenance: {
    source: 'gsc_canonical_ingestion' | 'fallback_no_gsc';
    company_id: string | null;
    website: string;
    property_url: string | null;
  };
};

type AnalyticsHealthSummary = {
  health: {
    status: 'healthy' | 'degraded' | 'failed' | 'unavailable';
    message: string;
    confidence: 'high' | 'medium' | 'low' | 'none';
  };
  freshness: {
    ga: { classification: string; freshness_score: number; trust_level: string; age_hours: number | null; reason: string };
    gsc: { classification: string; freshness_score: number; trust_level: string; age_hours: number | null; reason: string };
  };
  ingestion_history: Array<{
    source: 'ga4' | 'gsc';
    status: string;
    completed_at: string | null;
    duration_ms: number | null;
    records_inserted: number;
    records_updated: number;
    retry_count: number;
    error_message: string | null;
  }>;
  degraded_history: Array<{
    source: 'ga4' | 'gsc';
    status: string;
    occurred_at: string | null;
    error_message: string | null;
  }>;
  operational_metrics: {
    ga_events_last_30_days: number;
    gsc_rows_ingested: number;
    total_retries_last_10_runs: number;
    avg_duration_ms_last_10_runs: number | null;
    quota_or_api_errors: string[];
  };
  correlation: {
    insights: Array<{
      type: string;
      page_url: string;
      title: string;
      confidence: string;
      opportunity_score: number;
    }>;
  };
  gsc_intelligence: {
    top_queries: Array<{ query: string; classification: string; movement: string; opportunity_score: number; confidence: string }>;
    top_pages: Array<{ page_url: string; issue: string; movement: string; opportunity_score: number; confidence: string }>;
  } | null;
  enterprise?: {
    cache_status: string;
    trust_score: number;
    completeness_score: number;
    opportunity_count: number;
    provider_uptime: {
      ga_success_rate: number;
      gsc_success_rate: number;
    };
    quota_warnings: string[];
  };
};

export function formatPercent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatLastSync(value: string | null): string {
  if (!value) return 'Not synced yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

// Mirrors backend/scheduler/cron.ts GA4_INGESTION_INTERVAL_MS (6h). The
// /api/cron/analytics-ingestion Vercel cron also runs ga4 ingestion daily
// (24h). Anything older than 24h means scheduled ingestion has stopped or
// the GA token has been revoked — surface that to the operator.
const GA_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function isGaSyncStale(lastSync: string | null | undefined): boolean {
  if (!lastSync) return false; // never-synced is rendered separately
  const parsed = new Date(lastSync).getTime();
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed > GA_STALE_THRESHOLD_MS;
}

function readErrorMessage(data: any, fallback: string): string {
  if (!data) return fallback;
  const message = typeof data.message === 'string' ? data.message.trim() : '';
  const error = typeof data.error === 'string' ? data.error.trim() : '';
  const code = typeof data.code === 'string' ? data.code.trim() : '';
  if (message && code) return `${message} (${code})`;
  if (message) return message;
  if (error && code && error !== code) return `${error} (${code})`;
  if (error) return error;
  if (code) return code;
  return fallback;
}

export function formatGscPosition(value: number): string {
  return value > 0 ? value.toFixed(1) : '0.0';
}

function formatDuration(value: number | null): string {
  if (value == null) return '-';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

export function describeGaStatusDetail(status: GoogleAnalyticsCompanySummary['ga_status'] | undefined | null): string {
  if (status?.property) {
    return `${status.property.name} • GA account ${status.property.account_id || 'n/a'}`;
  }
  if (status?.status === 'property_selection') {
    return 'Omnivyra website does not have an active GA property selected yet.';
  }
  if (status?.reconnect_required) {
    return 'Google Analytics must be reconnected before Omnivyra website data can sync.';
  }
  if (status?.status === 'not_connected') {
    return 'Google Analytics is not connected for the Omnivyra website.';
  }
  if (status?.properties?.length) {
    return 'Select an active GA property for the Omnivyra website.';
  }
  return 'No Google Analytics data is available for the Omnivyra website yet.';
}

export function useAnalyticsTabController(props: AnalyticsTabProps) {
  const {
    isLoadingAnalytics, analyticsSummary, campaignHealth, isLoadingCampaignHealth, canShowExternalApisTab, externalApisHealth, companies, onNavigateToApis,
  } = props;
  const router = useRouter();
  const [analyticsSubTab, setAnalyticsSubTab] = useState<'overview' | 'ga-analytics' | 'campaign-health'>('overview');
  const [gaSummary, setGaSummary] = useState<GoogleAnalyticsCompanySummary | null>(null);
  const [gscSummary, setGscSummary] = useState<GscAnalyticsSummary | null>(null);
  const [analyticsHealth, setAnalyticsHealth] = useState<AnalyticsHealthSummary | null>(null);
  const [isLoadingGaAnalytics, setIsLoadingGaAnalytics] = useState(false);
  const [gaAnalyticsError, setGaAnalyticsError] = useState<string | null>(null);
  const [gaNotice, setGaNotice] = useState<string | null>(null);
  const [gaConnecting, setGaConnecting] = useState(false);
  const [gaRefreshing, setGaRefreshing] = useState(false);
  const [autoGaRefreshAttempted, setAutoGaRefreshAttempted] = useState(false);
  const [gaSelectingProperty, setGaSelectingProperty] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [gscConnecting, setGscConnecting] = useState(false);
  const [gscRefreshing, setGscRefreshing] = useState(false);
  const [gscSelectingProperty, setGscSelectingProperty] = useState(false);
  const [selectedGscPropertyId, setSelectedGscPropertyId] = useState('');

  const loadGaAnalytics = useCallback(async (signal?: { cancelled: boolean }) => {
    setIsLoadingGaAnalytics(true);
    setGaAnalyticsError(null);
    try {
      const [response, gscResponse, healthResponse] = await Promise.all([
        fetchWithAuth('/api/super-admin/ga-analytics-summary'),
        fetchWithAuth('/api/super-admin/gsc-analytics-summary'),
        fetchWithAuth('/api/super-admin/analytics-health'),
      ]);
      const data = await response.json().catch(() => null);
      const gscData = await gscResponse.json().catch(() => null);
      const healthData = await healthResponse.json().catch(() => null);
      if (signal?.cancelled) return;
      if (!response.ok) {
        setGaSummary(null);
        setAnalyticsHealth(null);
        setGaAnalyticsError(readErrorMessage(data, 'Failed to load Google Analytics summary'));
        return;
      }
      setGaSummary(data as GoogleAnalyticsCompanySummary);
      setGscSummary(gscResponse.ok ? (gscData as GscAnalyticsSummary) : null);
      setAnalyticsHealth(healthResponse.ok ? (healthData as AnalyticsHealthSummary) : null);
      const activeProperty = data?.ga_status?.property?.id;
      setSelectedPropertyId(activeProperty || '');
      const activeGscProperty = data?.ga_status?.search_console?.property?.id;
      setSelectedGscPropertyId(activeGscProperty || '');
    } catch (error: any) {
      if (signal?.cancelled) return;
      setGaSummary(null);
      setGscSummary(null);
      setAnalyticsHealth(null);
      setGaAnalyticsError(error?.message || 'Failed to load Google Analytics summary');
    } finally {
      if (!signal?.cancelled) setIsLoadingGaAnalytics(false);
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void loadGaAnalytics(signal);

    return () => {
      signal.cancelled = true;
    };
  }, [loadGaAnalytics]);

  useEffect(() => {
    if (!router.isReady) return;

    const callbackError = typeof router.query.error === 'string' ? router.query.error : '';
    const gaConnected = typeof router.query.ga4 === 'string' ? router.query.ga4 : '';
    const gscConnected = typeof router.query.gsc === 'string' ? router.query.gsc : '';
    const analyticsTarget = typeof router.query.analytics === 'string' ? router.query.analytics : '';

    if (analyticsTarget === 'ga' || callbackError || gaConnected || gscConnected) {
      setAnalyticsSubTab('ga-analytics');
    }

    if (callbackError === 'oauth_failed') {
      setGaNotice(null);
      setGaAnalyticsError('Failed to connect Google Analytics');
    } else if (callbackError === 'no_properties_found') {
      setGaNotice(null);
      setGaAnalyticsError('Google Analytics connected, but no GA4 properties were found for this Google account.');
    } else if (callbackError === 'unauthorized' || callbackError === 'invalid_oauth_state') {
      setGaNotice(null);
      setGaAnalyticsError('Google Analytics connect session expired. Please start the connection again from Super Admin.');
    } else if (gaConnected === 'connected') {
      setGaAnalyticsError(null);
      setGaNotice('Google Analytics connected. Select a property if prompted below.');
      void loadGaAnalytics();
    } else if (gscConnected === 'connected') {
      setGaAnalyticsError(null);
      setGaNotice('Search Console connected. Select a property if prompted below.');
      void loadGaAnalytics();
    }
  }, [router.isReady, router.query.analytics, router.query.error, router.query.ga4, router.query.gsc, loadGaAnalytics]);

  const handleConnectGoogleAnalytics = async () => {
    setGaConnecting(true);
    setGaAnalyticsError(null);
    setGaNotice(null);
    trackWebsiteEvent('analytics_connection_started', {
      analytics_provider: 'google_analytics',
      analytics_surface: 'super_admin',
    });
    try {
      const response = await fetchWithAuth('/api/super-admin/ga-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.authorizationUrl) {
        throw new Error(readErrorMessage(data, 'Failed to connect Google Analytics'));
      }
      window.location.href = data.authorizationUrl;
    } catch (error: any) {
      setGaAnalyticsError(error?.message || 'Failed to connect Google Analytics');
      setGaConnecting(false);
    }
  };

  const handleSelectProperty = async () => {
    if (!selectedPropertyId) return;
    setGaSelectingProperty(true);
    setGaAnalyticsError(null);
    setGaNotice(null);
    try {
      const response = await fetchWithAuth('/api/super-admin/ga-select-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: selectedPropertyId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readErrorMessage(data, 'Failed to select Google Analytics property'));
      }
      setGaNotice('Google Analytics property selected.');
      await loadGaAnalytics();
    } catch (error: any) {
      setGaAnalyticsError(error?.message || 'Failed to select Google Analytics property');
    } finally {
      setGaSelectingProperty(false);
    }
  };

  const handleConnectSearchConsole = async () => {
    setGscConnecting(true);
    setGaAnalyticsError(null);
    setGaNotice(null);
    trackWebsiteEvent('analytics_connection_started', {
      analytics_provider: 'google_search_console',
      analytics_surface: 'super_admin',
    });
    try {
      const response = await fetchWithAuth('/api/super-admin/gsc-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.authorizationUrl) {
        throw new Error(readErrorMessage(data, 'Failed to connect Search Console'));
      }
      window.location.href = data.authorizationUrl;
    } catch (error: any) {
      setGaAnalyticsError(error?.message || 'Failed to connect Search Console');
      setGscConnecting(false);
    }
  };

  const handleSelectSearchConsoleProperty = async () => {
    if (!selectedGscPropertyId) return;
    setGscSelectingProperty(true);
    setGaAnalyticsError(null);
    setGaNotice(null);
    try {
      const response = await fetchWithAuth('/api/super-admin/gsc-select-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: selectedGscPropertyId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readErrorMessage(data, 'Failed to select Search Console property'));
      }
      setGaNotice('Search Console property selected.');
      await loadGaAnalytics();
    } catch (error: any) {
      setGaAnalyticsError(error?.message || 'Failed to select Search Console property');
    } finally {
      setGscSelectingProperty(false);
    }
  };

  const handleRefreshGoogleAnalytics = useCallback(async (options?: { automatic?: boolean }) => {
    setGaRefreshing(true);
    setGaAnalyticsError(null);
    if (!options?.automatic) {
      setGaNotice(null);
    }
    trackWebsiteEvent('analytics_refresh_started', {
      analytics_provider: 'google_analytics',
      analytics_surface: 'super_admin',
      automatic: Boolean(options?.automatic),
    });
    try {
      const response = await fetchWithAuth('/api/super-admin/ga-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readErrorMessage(data, 'Failed to refresh Google Analytics'));
      }
      setGaNotice(
        data?.status === 'synced'
          ? 'Google Analytics refreshed.'
          : 'Google Analytics refresh started. Latest numbers will update when sync completes.',
      );
      await loadGaAnalytics();
      if (data?.status !== 'synced' && typeof window !== 'undefined') {
        [10_000, 30_000, 60_000].forEach((delay) => {
          window.setTimeout(() => {
            void loadGaAnalytics();
          }, delay);
        });
      }
    } catch (error: any) {
      setGaAnalyticsError(error?.message || 'Failed to refresh Google Analytics');
    } finally {
      setGaRefreshing(false);
    }
  }, [loadGaAnalytics]);

  const handleRefreshSearchConsole = useCallback(async () => {
    setGscRefreshing(true);
    setGaAnalyticsError(null);
    setGaNotice(null);
    trackWebsiteEvent('analytics_refresh_started', {
      analytics_provider: 'google_search_console',
      analytics_surface: 'super_admin',
      automatic: false,
    });
    try {
      const response = await fetchWithAuth('/api/super-admin/gsc-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readErrorMessage(data, 'Failed to refresh Search Console'));
      }
      const written = typeof data?.records_written === 'number' ? ` (${data.records_written} records)` : '';
      setGaNotice(
        data?.status === 'synced'
          ? `Search Console refreshed${written}.`
          : 'Search Console refresh started. Latest search data will update when sync completes.',
      );
      await loadGaAnalytics();
      if (data?.status !== 'synced' && typeof window !== 'undefined') {
        [10_000, 30_000, 60_000].forEach((delay) => {
          window.setTimeout(() => {
            void loadGaAnalytics();
          }, delay);
        });
      }
    } catch (error: any) {
      setGaAnalyticsError(error?.message || 'Failed to refresh Search Console');
    } finally {
      setGscRefreshing(false);
    }
  }, [loadGaAnalytics]);

  useEffect(() => {
    const status = gaSummary?.ga_status;
    if (!status?.connected || !status.property || status.reconnect_required) return;
    if (!isGaSyncStale(status.last_sync)) return;
    if (autoGaRefreshAttempted || gaRefreshing) return;
    setAutoGaRefreshAttempted(true);
    void handleRefreshGoogleAnalytics({ automatic: true });
  }, [autoGaRefreshAttempted, gaRefreshing, gaSummary?.ga_status, handleRefreshGoogleAnalytics]);

  const gaCanRefresh =
    Boolean(gaSummary?.ga_status.connected && gaSummary.ga_status.property && !gaSummary.ga_status.reconnect_required);
  const gscStatus = gaSummary?.ga_status.search_console ?? null;
  const gscCanRefresh =
    Boolean(gscStatus?.provider_authenticated && gscStatus.property && !gscStatus.reconnect_required);

  return {
    isLoadingAnalytics, analyticsSummary, campaignHealth, isLoadingCampaignHealth, canShowExternalApisTab, externalApisHealth, companies, onNavigateToApis,
    analyticsHealth, analyticsSubTab, autoGaRefreshAttempted, gaAnalyticsError, gaCanRefresh, gaConnecting, gaNotice, gaRefreshing,
    gaSelectingProperty, gaSummary, gscCanRefresh, gscConnecting, gscRefreshing, gscSelectingProperty, gscStatus, gscSummary,
    handleConnectGoogleAnalytics, handleConnectSearchConsole, handleRefreshGoogleAnalytics, handleRefreshSearchConsole,
    handleSelectProperty, handleSelectSearchConsoleProperty, isLoadingGaAnalytics, loadGaAnalytics, router, selectedGscPropertyId,
    selectedPropertyId, setAnalyticsHealth, setAnalyticsSubTab, setAutoGaRefreshAttempted, setGaAnalyticsError, setGaConnecting,
    setGaNotice, setGaRefreshing, setGaSelectingProperty, setGaSummary, setGscConnecting, setGscRefreshing, setGscSelectingProperty,
    setGscSummary, setIsLoadingGaAnalytics, setSelectedGscPropertyId, setSelectedPropertyId
  };
}
