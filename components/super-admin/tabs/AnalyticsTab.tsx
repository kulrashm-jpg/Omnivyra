import React, { useCallback, useEffect, useState } from 'react';
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
  TrendingUp,
} from 'lucide-react';

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

function formatPercent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatLastSync(value: string | null): string {
  if (!value) return 'Not synced yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
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
  const [analyticsSubTab, setAnalyticsSubTab] = useState<'overview' | 'ga-analytics' | 'campaign-health'>('overview');
  const [gaSummary, setGaSummary] = useState<GoogleAnalyticsCompanySummary | null>(null);
  const [isLoadingGaAnalytics, setIsLoadingGaAnalytics] = useState(false);
  const [gaAnalyticsError, setGaAnalyticsError] = useState<string | null>(null);
  const [gaNotice, setGaNotice] = useState<string | null>(null);
  const [gaConnecting, setGaConnecting] = useState(false);
  const [gaSelectingProperty, setGaSelectingProperty] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');

  const loadGaAnalytics = useCallback(async (signal?: { cancelled: boolean }) => {
    setIsLoadingGaAnalytics(true);
    setGaAnalyticsError(null);
    try {
      const response = await fetchWithAuth('/api/super-admin/ga-analytics-summary');
      const data = await response.json().catch(() => null);
      if (signal?.cancelled) return;
      if (!response.ok) {
        setGaSummary(null);
        setGaAnalyticsError(data?.error || 'Failed to load Google Analytics summary');
        return;
      }
      setGaSummary(data as GoogleAnalyticsCompanySummary);
      const activeProperty = data?.ga_status?.property?.id;
      setSelectedPropertyId(activeProperty || '');
    } catch (error: any) {
      if (signal?.cancelled) return;
      setGaSummary(null);
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

  const handleConnectGoogleAnalytics = async () => {
    setGaConnecting(true);
    setGaAnalyticsError(null);
    setGaNotice(null);
    try {
      const response = await fetchWithAuth('/api/super-admin/ga-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.authorizationUrl) {
        throw new Error(data?.message || 'Failed to connect Google Analytics');
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
        throw new Error(data?.message || 'Failed to select Google Analytics property');
      }
      setGaNotice('Google Analytics property selected.');
      await loadGaAnalytics();
    } catch (error: any) {
      setGaAnalyticsError(error?.message || 'Failed to select Google Analytics property');
    } finally {
      setGaSelectingProperty(false);
    }
  };

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
                  {gaSummary?.ga_status.property
                    ? `${gaSummary.ga_status.property.name} • account ${gaSummary.ga_status.property.account_id || 'n/a'}`
                    : 'Omnivyra website does not have an active GA property selected yet.'}
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 lg:items-end">
                <div className="text-sm text-slate-600">
                  Last sync: <span className="font-medium text-slate-900">{formatLastSync(gaSummary?.ga_status.last_sync ?? null)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleConnectGoogleAnalytics()}
                  disabled={gaConnecting}
                  className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {gaConnecting
                    ? 'Connecting...'
                    : gaSummary?.ga_status.reconnect_required
                    ? 'Reconnect Google Analytics'
                    : 'Connect Google Analytics'}
                </button>
              </div>
            </div>
          </div>

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
