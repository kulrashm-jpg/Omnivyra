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

interface AnalyticsTabProps {
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

function formatPercent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatLastSync(value: string | null): string {
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

function isGaSyncStale(lastSync: string | null | undefined): boolean {
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

function formatGscPosition(value: number): string {
  return value > 0 ? value.toFixed(1) : '0.0';
}

function formatDuration(value: number | null): string {
  if (value == null) return '-';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function describeGaStatusDetail(status: GoogleAnalyticsCompanySummary['ga_status'] | undefined | null): string {
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

export default function AnalyticsTab({
  isLoadingAnalytics,
  analyticsSummary,
  campaignHealth,
  isLoadingCampaignHealth,
  canShowExternalApisTab,
  externalApisHealth,
  companies,
  onNavigateToApis,
}: AnalyticsTabProps) {
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

  return (
    <div className="space-y-6">
      <div className="flex gap-2 bg-white rounded-lg p-2 w-fit border border-slate-200 shadow-sm">
        {([
          { id: 'overview', label: 'Overview' },
          { id: 'ga-analytics', label: 'GA Analytics' },
          { id: 'campaign-health', label: 'Campaign Health' },
        ] as const).map((sub) => (
          <button
            key={sub.id}
            onClick={() => setAnalyticsSubTab(sub.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              analyticsSubTab === sub.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {analyticsSubTab === 'overview' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg"><BarChart3 className="h-6 w-6 text-blue-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Total Posts</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingAnalytics ? '—' : (analyticsSummary?.total_posts ?? 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-100 rounded-lg"><Activity className="h-6 w-6 text-emerald-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Total Engagement</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingAnalytics ? '—' : (analyticsSummary?.total_engagement ?? 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-100 rounded-lg"><Eye className="h-6 w-6 text-amber-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Total Reach</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingAnalytics ? '—' : (analyticsSummary?.total_reach ?? 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 rounded-lg"><TrendingUp className="h-6 w-6 text-purple-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Avg Engagement Rate</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingAnalytics ? '—' : `${(analyticsSummary?.avg_engagement_rate ?? 0).toFixed(2)}%`}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {canShowExternalApisTab && (
            <button
              onClick={onNavigateToApis}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                externalApisHealth?.status === 'healthy'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                  : externalApisHealth != null
                  ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                  : 'bg-slate-100 border-slate-200 text-slate-800 hover:bg-slate-200'
              }`}
            >
              <Key className="h-4 w-4" />
              {externalApisHealth != null
                ? `External APIs: ${externalApisHealth.status === 'healthy' ? 'HEALTHY' : 'ATTENTION REQUIRED'}`
                : 'API Configuration'}
            </button>
          )}

          <div className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg">
              <h3 className="text-lg font-bold text-slate-900">Platform Performance</h3>
              <p className="text-sm text-slate-600 mt-1">Aggregated engagement and reach across all published posts.</p>
            </div>
            <div className="overflow-x-auto">
              {isLoadingAnalytics ? (
                <div className="px-6 py-8 text-sm text-slate-600">Loading analytics…</div>
              ) : analyticsSummary?.platforms?.length ? (
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Platform</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Posts</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Engagement</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Reach</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Avg Rate</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-200">
                    {analyticsSummary.platforms.map((row) => (
                      <tr key={row.platform} className="hover:bg-slate-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 capitalize">{row.platform}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{row.total_posts.toLocaleString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{row.total_engagement.toLocaleString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{row.total_reach.toLocaleString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{row.avg_engagement_rate.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="px-6 py-8 text-sm text-slate-600">No analytics data available yet.</div>
              )}
            </div>
          </div>
        </>
      )}

      {analyticsSubTab === 'ga-analytics' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Google Analytics Website View</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Canonical GA4 website analytics for `omnivyra.com` over the last 30 days.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Website: <span className="font-semibold text-slate-900">{gaSummary?.website || 'omnivyra.com'}</span>
              </div>
            </div>
          </div>

          <div className={`rounded-lg border px-5 py-4 ${
            gaSummary?.ga_status.connected
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-amber-200 bg-amber-50'
          }`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  {gaSummary?.ga_status.connected ? (
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                  )}
                  <span>{gaSummary?.ga_status.message || 'Google Analytics status unavailable'}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {describeGaStatusDetail(gaSummary?.ga_status)}
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 lg:items-end">
                <div className="text-sm text-slate-600">
                  Last sync: <span className="font-medium text-slate-900">{formatLastSync(gaSummary?.ga_status.last_sync ?? null)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (gaCanRefresh) void handleRefreshGoogleAnalytics();
                    else void handleConnectGoogleAnalytics();
                  }}
                  disabled={gaConnecting || gaRefreshing}
                  className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {gaRefreshing
                    ? 'Refreshing...'
                    : gaConnecting
                    ? 'Connecting...'
                    : gaCanRefresh
                    ? 'Refresh Google Analytics'
                    : gaSummary?.ga_status.reconnect_required
                    ? 'Reconnect Google Analytics'
                    : 'Connect Google Analytics'}
                </button>
              </div>
            </div>
          </div>

          <div className={`rounded-lg border px-5 py-4 ${
            gscStatus?.capability_ready
              ? 'border-sky-200 bg-sky-50'
              : 'border-amber-200 bg-amber-50'
          }`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  {gscStatus?.capability_ready ? (
                    <CheckCircle className="h-4 w-4 text-sky-600" />
                  ) : (
                    <Search className="h-4 w-4 text-amber-600" />
                  )}
                  <span>{gscStatus?.message || 'Search Console setup required'}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {gscStatus?.property
                    ? `${gscStatus.property.name} - Search Console`
                    : gscStatus?.properties?.length
                      ? 'Select a verified Search Console property for the Omnivyra website.'
                      : 'Connect Search Console for organic query, page, click, impression, CTR, and position data.'}
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 lg:items-end">
                <div className="text-sm text-slate-600">
                  Last sync: <span className="font-medium text-slate-900">{formatLastSync(gscSummary?.status.last_sync ?? gscStatus?.last_sync ?? null)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (gscCanRefresh) void handleRefreshSearchConsole();
                    else void handleConnectSearchConsole();
                  }}
                  disabled={gscConnecting || gscRefreshing}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${gscRefreshing || gscConnecting ? 'animate-spin' : ''}`} />
                  {gscRefreshing
                    ? 'Refreshing...'
                    : gscConnecting
                    ? 'Connecting...'
                    : gscCanRefresh
                    ? 'Refresh Search Console'
                    : gscStatus?.reconnect_required
                    ? 'Reconnect Search Console'
                    : 'Connect Search Console'}
                </button>
              </div>
            </div>
          </div>

          {gscStatus?.properties?.length && !gscStatus?.property && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-5 py-4">
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-slate-900">Choose the Omnivyra Search Console property</h4>
                <p className="mt-1 text-sm text-slate-600">
                  Search Console is connected, but no active property has been selected for the Omnivyra website yet.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <select
                  value={selectedGscPropertyId}
                  onChange={(event) => setSelectedGscPropertyId(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  <option value="">Select a Search Console property</option>
                  {gscStatus.properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}{property.account_id ? ` - ${property.account_id}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleSelectSearchConsoleProperty()}
                  disabled={!selectedGscPropertyId || gscSelectingProperty}
                  className="inline-flex items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {gscSelectingProperty ? 'Saving...' : 'Use this property'}
                </button>
              </div>
            </div>
          )}

          {gaNotice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
              {gaNotice}
            </div>
          )}

          {gaAnalyticsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
              {gaAnalyticsError}
            </div>
          )}

          {gaSummary?.ga_status.degraded && gaSummary.ga_status.status_error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
              Google Analytics status is degraded: {gaSummary.ga_status.status_error}
            </div>
          )}

          {gaSummary?.ga_status.connected && isGaSyncStale(gaSummary.ga_status.last_sync) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <div>
                <div className="font-semibold">Analytics may be outdated</div>
                <div className="mt-1">
                  Last successful GA4 sync was {formatLastSync(gaSummary.ga_status.last_sync)}.
                  Numbers below may not reflect the most recent traffic. Use Refresh Google Analytics
                  to request the newest canonical data.
                </div>
              </div>
            </div>
          )}

          {analyticsHealth && (
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Analytics Health Panel</h3>
                  <p className="mt-1 text-sm text-slate-600">{analyticsHealth.health.message}</p>
                </div>
                <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  analyticsHealth.health.status === 'healthy'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : analyticsHealth.health.status === 'failed'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}>
                  {analyticsHealth.health.status} | {analyticsHealth.health.confidence} confidence
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  { label: 'GA Freshness', value: analyticsHealth.freshness.ga.classification, detail: analyticsHealth.freshness.ga.reason },
                  { label: 'GSC Freshness', value: analyticsHealth.freshness.gsc.classification, detail: analyticsHealth.freshness.gsc.reason },
                  { label: 'Retry Count', value: analyticsHealth.operational_metrics.total_retries_last_10_runs.toLocaleString(), detail: 'Last 10 ingestion runs' },
                  {
                    label: 'Avg Sync Duration',
                    value: analyticsHealth.operational_metrics.avg_duration_ms_last_10_runs == null
                      ? 'n/a'
                      : `${Math.round(analyticsHealth.operational_metrics.avg_duration_ms_last_10_runs / 1000)}s`,
                    detail: 'Completed ingestion runs',
                  },
                  {
                    label: 'Trust Score',
                    value: analyticsHealth.enterprise ? `${analyticsHealth.enterprise.trust_score}/100` : 'n/a',
                    detail: `Snapshot: ${analyticsHealth.enterprise?.cache_status ?? 'not cached'}`,
                  },
                  {
                    label: 'Opportunities',
                    value: analyticsHealth.enterprise?.opportunity_count?.toLocaleString() ?? '0',
                    detail: 'Evidence-backed signals',
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{item.label}</p>
                    <p className="mt-2 text-xl font-bold capitalize text-slate-900">{item.value}</p>
                    <p className="mt-1 text-xs text-slate-600">{item.detail}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
                    Recent Ingestion History
                  </div>
                  <div className="divide-y divide-slate-200">
                    {analyticsHealth.ingestion_history.slice(0, 5).length ? (
                      analyticsHealth.ingestion_history.slice(0, 5).map((run, index) => (
                        <div key={`${run.source}-${run.completed_at ?? index}`} className="grid grid-cols-4 gap-3 px-4 py-3 text-sm">
                          <span className="font-medium uppercase text-slate-700">{run.source}</span>
                          <span className="text-slate-600">{run.status}</span>
                          <span className="text-slate-600">{(run.records_inserted + run.records_updated).toLocaleString()} rows</span>
                          <span className="text-right text-slate-500">{formatLastSync(run.completed_at)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="px-4 py-6 text-sm text-slate-600">No ingestion history recorded yet.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
                    Strategic Correlation Signals
                  </div>
                  <div className="divide-y divide-slate-200">
                    {analyticsHealth.correlation.insights.slice(0, 4).length ? (
                      analyticsHealth.correlation.insights.slice(0, 4).map((insight) => (
                        <div key={`${insight.type}-${insight.page_url}`} className="px-4 py-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-slate-900">{insight.title}</span>
                            <span className="text-xs font-semibold text-slate-500">{insight.confidence}</span>
                          </div>
                          <div className="mt-1 truncate text-slate-600" title={insight.page_url}>
                            {insight.page_url}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="px-4 py-6 text-sm text-slate-600">No GA/GSC correlation signal has crossed the evidence threshold yet.</div>
                    )}
                  </div>
                </div>
              </div>

              {analyticsHealth.gsc_intelligence?.top_queries?.length ? (
                <div className="mt-5 rounded-lg border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
                    Search Intelligence Highlights
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
                    {analyticsHealth.gsc_intelligence.top_queries.slice(0, 3).map((query) => (
                      <div key={query.query} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <div className="font-medium text-slate-900">{query.query}</div>
                        <div className="mt-1 text-slate-600">
                          {query.classification} | {query.movement} | opportunity {query.opportunity_score}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {gaSummary?.ga_status.properties?.length && !gaSummary?.ga_status.property && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-slate-900">Choose the Omnivyra GA4 property</h4>
                <p className="mt-1 text-sm text-slate-600">
                  Google Analytics is connected, but no active property has been selected for the Omnivyra website yet.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <select
                  value={selectedPropertyId}
                  onChange={(event) => setSelectedPropertyId(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-300"
                >
                  <option value="">Select a property</option>
                  {gaSummary.ga_status.properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}{property.account_id ? ` • Account ${property.account_id}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleSelectProperty()}
                  disabled={!selectedPropertyId || gaSelectingProperty}
                  className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {gaSelectingProperty ? 'Saving...' : 'Use this property'}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg"><Globe className="h-6 w-6 text-blue-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Sessions</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingGaAnalytics ? '—' : (gaSummary?.overview.total_sessions ?? 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-100 rounded-lg"><Activity className="h-6 w-6 text-emerald-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Engaged Sessions</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingGaAnalytics ? '—' : (gaSummary?.overview.engaged_sessions ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500">
                    {isLoadingGaAnalytics ? ' ' : formatPercent(gaSummary?.overview.engagement_rate ?? 0)}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-100 rounded-lg"><Eye className="h-6 w-6 text-amber-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Page Views</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingGaAnalytics ? '—' : (gaSummary?.overview.total_page_views ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500">
                    {isLoadingGaAnalytics ? ' ' : `${(gaSummary?.overview.avg_events_per_session ?? 0).toFixed(2)} avg events/session`}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 rounded-lg"><MousePointerClick className="h-6 w-6 text-purple-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Conversions</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingGaAnalytics ? '—' : (gaSummary?.overview.total_conversions ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500">
                    {isLoadingGaAnalytics ? ' ' : formatPercent(gaSummary?.overview.conversion_rate ?? 0)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg">
                <h3 className="text-lg font-bold text-slate-900">Traffic Sources</h3>
                <p className="text-sm text-slate-600 mt-1">Sessions, events, and conversions by source/medium.</p>
              </div>
              <div className="overflow-x-auto">
                {isLoadingGaAnalytics ? (
                  <div className="px-6 py-8 text-sm text-slate-600">Loading GA traffic sources…</div>
                ) : gaSummary?.traffic_sources?.length ? (
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Source</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Sessions</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Events</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Conversions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {gaSummary.traffic_sources.map((row) => (
                        <tr key={`${row.traffic_source}-${row.source_medium}`}>
                          <td className="px-6 py-4 text-sm text-slate-900">
                            <div className="font-medium">{row.traffic_source}</div>
                            <div className="text-slate-500">{row.source_medium}</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.sessions.toLocaleString()}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.events.toLocaleString()}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.conversions.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="px-6 py-8 text-sm text-slate-600">No GA traffic-source data available yet.</div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg">
                <h3 className="text-lg font-bold text-slate-900">Top Pages</h3>
                <p className="text-sm text-slate-600 mt-1">Most visited pages with event and conversion context.</p>
              </div>
              <div className="overflow-x-auto">
                {isLoadingGaAnalytics ? (
                  <div className="px-6 py-8 text-sm text-slate-600">Loading GA top pages…</div>
                ) : gaSummary?.top_pages?.length ? (
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Page</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Visits</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Events</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Conversions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {gaSummary.top_pages.slice(0, 8).map((row) => (
                        <tr key={row.page_url}>
                          <td className="px-6 py-4 text-sm text-slate-900 max-w-[28rem] truncate" title={row.page_url}>
                            {row.page_url}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.visits.toLocaleString()}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.events.toLocaleString()}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.conversions.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="px-6 py-8 text-sm text-slate-600">No GA page data available yet.</div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg">
              <h3 className="text-lg font-bold text-slate-900">Conversion Types</h3>
              <p className="text-sm text-slate-600 mt-1">
                Last 30 days • average engagement time {isLoadingGaAnalytics ? '—' : `${(gaSummary?.overview.avg_engagement_time_seconds ?? 0).toFixed(1)}s`}
              </p>
            </div>
            <div className="overflow-x-auto">
              {isLoadingGaAnalytics ? (
                <div className="px-6 py-8 text-sm text-slate-600">Loading conversion breakdown…</div>
              ) : gaSummary?.conversions?.length ? (
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Conversion</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {gaSummary.conversions.map((row) => (
                      <tr key={row.conversion_name}>
                        <td className="px-6 py-4 text-sm text-slate-900">{row.conversion_name}</td>
                        <td className="px-6 py-4 text-sm text-slate-600">{row.count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="px-6 py-8 text-sm text-slate-600">No GA conversion data available yet.</div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Search Console SEO View</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Canonical Search Console analytics for omnivyra.com over the last 30 days.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Property: <span className="font-semibold text-slate-900">{gscSummary?.status.selected_property || 'Not selected'}</span>
              </div>
            </div>
          </div>

          <div className={`rounded-lg border px-5 py-4 ${
            gscSummary?.status.status === 'live'
              ? 'border-emerald-200 bg-emerald-50'
              : gscSummary?.status.status === 'failed'
                ? 'border-red-200 bg-red-50'
                : 'border-amber-200 bg-amber-50'
          }`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  {gscSummary?.status.status === 'live' ? (
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                  )}
                  <span>{gscSummary?.status.message || 'Search Console analytics status unavailable'}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  Last sync: <span className="font-medium">{formatLastSync(gscSummary?.status.last_sync ?? null)}</span>
                  {' '}| Rows ingested: <span className="font-medium">{(gscSummary?.status.rows_ingested ?? 0).toLocaleString()}</span>
                  {' '}| Provenance: <span className="font-medium">{gscSummary?.provenance.source || 'fallback_no_gsc'}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRefreshSearchConsole()}
                disabled={!gscCanRefresh || gscRefreshing}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${gscRefreshing ? 'animate-spin' : ''}`} />
                {gscRefreshing ? 'Refreshing...' : 'Refresh Search Console'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
              <p className="text-sm text-slate-600">Total Clicks</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {isLoadingGaAnalytics ? '-' : (gscSummary?.summary.clicks ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
              <p className="text-sm text-slate-600">Total Impressions</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {isLoadingGaAnalytics ? '-' : (gscSummary?.summary.impressions ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
              <p className="text-sm text-slate-600">Average CTR</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {isLoadingGaAnalytics ? '-' : formatPercent(gscSummary?.summary.ctr ?? 0)}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200">
              <p className="text-sm text-slate-600">Average Position</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {isLoadingGaAnalytics ? '-' : formatGscPosition(gscSummary?.summary.avg_position ?? 0)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg">
                <h3 className="text-lg font-bold text-slate-900">Top Search Queries</h3>
              </div>
              <div className="overflow-x-auto">
                {gscSummary?.top_queries?.length ? (
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Query</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Clicks</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Impressions</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">CTR</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Avg Position</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {gscSummary.top_queries.map((row) => (
                        <tr key={row.label}>
                          <td className="px-6 py-4 text-sm text-slate-900 max-w-[22rem] truncate" title={row.label}>{row.label}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.clicks.toLocaleString()}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.impressions.toLocaleString()}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{formatPercent(row.ctr)}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{formatGscPosition(row.avg_position)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="px-6 py-8 text-sm text-slate-600">No canonical GSC query data available yet.</div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg">
                <h3 className="text-lg font-bold text-slate-900">Top SEO Landing Pages</h3>
              </div>
              <div className="overflow-x-auto">
                {gscSummary?.top_pages?.length ? (
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Page</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Clicks</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Impressions</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">CTR</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Avg Position</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {gscSummary.top_pages.map((row) => (
                        <tr key={row.label}>
                          <td className="px-6 py-4 text-sm text-slate-900 max-w-[22rem] truncate" title={row.label}>{row.label}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.clicks.toLocaleString()}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.impressions.toLocaleString()}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{formatPercent(row.ctr)}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{formatGscPosition(row.avg_position)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="px-6 py-8 text-sm text-slate-600">No canonical GSC landing-page data available yet.</div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {[
              { title: 'Device Breakdown', rows: gscSummary?.devices ?? [] },
              { title: 'Country Breakdown', rows: gscSummary?.countries ?? [] },
            ].map((section) => (
              <div key={section.title} className="bg-white rounded-lg shadow-sm border border-slate-200">
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg">
                  <h3 className="text-lg font-bold text-slate-900">{section.title}</h3>
                </div>
                <div className="overflow-x-auto">
                  {section.rows.length ? (
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Segment</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Clicks</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Impressions</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">CTR</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {section.rows.map((row) => (
                          <tr key={`${section.title}-${row.label}`}>
                            <td className="px-6 py-4 text-sm text-slate-900">{row.label}</td>
                            <td className="px-6 py-4 text-sm text-slate-600">{row.clicks.toLocaleString()}</td>
                            <td className="px-6 py-4 text-sm text-slate-600">{row.impressions.toLocaleString()}</td>
                            <td className="px-6 py-4 text-sm text-slate-600">{formatPercent(row.ctr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="px-6 py-8 text-sm text-slate-600">No canonical GSC segment data available yet.</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {analyticsSubTab === 'campaign-health' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg"><BarChart3 className="h-6 w-6 text-blue-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Total Campaigns</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingCampaignHealth ? '—' : (campaignHealth?.total_campaigns ?? 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-100 rounded-lg"><Activity className="h-6 w-6 text-emerald-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Active Campaigns</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingCampaignHealth ? '—' : (campaignHealth?.active_campaigns ?? 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 rounded-lg"><CheckCircle className="h-6 w-6 text-purple-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Approved Strategies</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingCampaignHealth ? '—' : (campaignHealth?.approved_strategies ?? 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-slate-200 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-100 rounded-lg"><AlertCircle className="h-6 w-6 text-amber-600" /></div>
                <div>
                  <p className="text-sm text-slate-600">Pending Re-Approval</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {isLoadingCampaignHealth ? '—' : (campaignHealth?.reapproval_required_count ?? 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg">
              <h3 className="text-lg font-bold text-slate-900">Campaigns by Company</h3>
              <p className="text-sm text-slate-600 mt-1">Strategy approval health across tenants.</p>
            </div>
            <div className="overflow-x-auto">
              {isLoadingCampaignHealth ? (
                <div className="px-6 py-8 text-sm text-slate-600">Loading campaign health…</div>
              ) : campaignHealth?.campaigns_by_company?.length ? (
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Company</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Campaign Count</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Active</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Re-Approval Required</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {campaignHealth.campaigns_by_company.map((row) => {
                      const companyName = companies.find((company) => company.id === row.company_id)?.name || row.company_id;
                      return (
                        <tr key={row.company_id}>
                          <td className="px-6 py-4 text-sm text-slate-900">{companyName}</td>
                          <td className="px-6 py-4 text-sm text-slate-900">{row.total_campaigns}</td>
                          <td className="px-6 py-4 text-sm text-slate-900">{row.active_campaigns}</td>
                          <td className="px-6 py-4 text-sm text-slate-900">{row.reapproval_required}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="px-6 py-8 text-sm text-slate-600">No campaign health data available yet.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
