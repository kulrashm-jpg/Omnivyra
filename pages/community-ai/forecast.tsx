import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';

type ForecastItem = {
  date: string;
  platform: string;
  content_type: string;
  predicted_likes: number;
  predicted_comments: number;
  predicted_shares: number;
  predicted_views: number;
  confidence_level: number;
};

type ForecastRisk = {
  platform: string;
  content_type: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
};

type ForecastInsights = {
  explanation_summary: string;
  key_drivers: any[];
  risks: any[];
  recommended_actions: any[];
  confidence_level: number;
};

type SimulationResult = {
  baseline_forecast: ForecastItem[];
  simulated_forecast: ForecastItem[];
  delta: Array<{ metric: string; change_percent: number }>;
  risk_flags: Array<{ platform: string; content_type: string; reason: string; severity: string }>;
};

const PLATFORM_OPTIONS = ['All', 'LinkedIn', 'Instagram', 'X', 'YouTube', 'Reddit'];
const CONTENT_OPTIONS = ['All', 'Text', 'Image', 'Video', 'Banner', 'Threads'];

const normalizeValue = (value: string) => (value === 'All' ? '' : value.toLowerCase());

export default function CommunityAiForecast() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const tenantId = selectedCompanyId || '';
  const [platformFilter, setPlatformFilter] = useState('All');
  const [contentFilter, setContentFilter] = useState('All');
  const [forecast, setForecast] = useState<ForecastItem[]>([]);
  const [risks, setRisks] = useState<ForecastRisk[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showExportToast, setShowExportToast] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsData, setInsightsData] = useState<ForecastInsights | null>(null);
  const [insightsCache, setInsightsCache] = useState<Record<string, ForecastInsights>>({});
  const [insightsStatus, setInsightsStatus] = useState<Record<string, 'loading' | 'cached'>>({});
  const [insightsKey, setInsightsKey] = useState<string>('');
  const [simulationPlatform, setSimulationPlatform] = useState('All');
  const [simulationContent, setSimulationContent] = useState('All');
  const [postingChange, setPostingChange] = useState(0);
  const [engagementBoost, setEngagementBoost] = useState(0);
  const [contentMix, setContentMix] = useState({
    text: 0,
    image: 0,
    video: 0,
    banner: 0,
    threads: 0,
  });
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulationCache, setSimulationCache] = useState<Record<string, SimulationResult>>({});
  const [simulationStatus, setSimulationStatus] = useState<Record<string, 'loading' | 'cached'>>({});
  const [simulationKey, setSimulationKey] = useState<string>('');

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const platformParam = typeof router.query?.platform === 'string' ? router.query.platform : '';
    const contentParam = typeof router.query?.content_type === 'string' ? router.query.content_type : '';
    if (platformParam) {
      setPlatformFilter(platformParam.charAt(0).toUpperCase() + platformParam.slice(1));
    }
    if (contentParam) {
      setContentFilter(contentParam.charAt(0).toUpperCase() + contentParam.slice(1));
    }
  }, [router.isReady, router.query]);

  useEffect(() => {
    const loadForecast = async () => {
      if (!tenantId) {
        setForecast([]);
        setRisks([]);
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      const platform = normalizeValue(platformFilter);
      const contentType = normalizeValue(contentFilter);
      const query = new URLSearchParams({
        tenant_id: tenantId,
        organization_id: tenantId,
      });
      if (platform) query.set('platform', platform);
      if (contentType) query.set('content_type', contentType);
      router.replace(
        {
          pathname: '/community-ai/forecast',
          query: {
            ...(platform ? { platform } : {}),
            ...(contentType ? { content_type: contentType } : {}),
          },
        },
        undefined,
        { shallow: true }
      );
      try {
        const response = await fetchWithAuth(`/api/community-ai/forecast?${query.toString()}`);
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load forecast');
        }
        const data = await response.json();
        setForecast(data?.forecast || []);
        setRisks(data?.risk_flags || []);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load forecast');
      } finally {
        setIsLoading(false);
      }
    };
    loadForecast();
  }, [tenantId, platformFilter, contentFilter, router]);

  const riskMap = useMemo(() => {
    const severityRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const map = new Map<string, ForecastRisk>();
    risks.forEach((risk) => {
      const key = `${risk.platform}::${risk.content_type}`;
      const existing = map.get(key);
      if (!existing || severityRank[risk.severity] > severityRank[existing.severity]) {
        map.set(key, risk);
      }
    });
    return map;
  }, [risks]);

  const rows = useMemo(
    () =>
      forecast
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((entry) => ({
          ...entry,
          risk: riskMap.get(`${entry.platform}::${entry.content_type}`) || null,
        })),
    [forecast, riskMap]
  );

  const showFilterChips = platformFilter !== 'All' || contentFilter !== 'All';

  const handleClearFilters = () => {
    setPlatformFilter('All');
    setContentFilter('All');
    router.push('/community-ai/forecast');
  };

  const handleExportCsv = async () => {
    if (!tenantId || rows.length === 0 || isExporting) return;
    setIsExporting(true);
    const platform = normalizeValue(platformFilter);
    const contentType = normalizeValue(contentFilter);
    const query = new URLSearchParams({
      tenant_id: tenantId,
      organization_id: tenantId,
    });
    if (platform) query.set('platform', platform);
    if (contentType) query.set('content_type', contentType);
    try {
      const response = await fetchWithAuth(`/api/community-ai/forecast?${query.toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setToastMessage(data?.error || 'Export failed. Please try again.');
        setShowExportToast(true);
        return;
      }
      const data = await response.json();
      const riskLookup = new Map<string, ForecastRisk>();
      (data?.risk_flags || []).forEach((risk: ForecastRisk) => {
        riskLookup.set(`${risk.platform}::${risk.content_type}`, risk);
      });
      const lines = [
        'Date,Platform,Content Type,Predicted Likes,Predicted Comments,Predicted Shares,Predicted Views,Confidence Level,Risk Flag,Risk Reason',
      ];
      (data?.forecast || []).forEach((item: ForecastItem) => {
        const risk = riskLookup.get(`${item.platform}::${item.content_type}`);
        const riskLabel = risk ? risk.severity : '';
        const riskReason = risk?.reason || '';
        lines.push(
          [
            item.date,
            item.platform,
            item.content_type,
            item.predicted_likes,
            item.predicted_comments,
            item.predicted_shares,
            item.predicted_views,
            item.confidence_level,
            JSON.stringify(riskLabel),
            JSON.stringify(riskReason),
          ].join(',')
        );
      });
      const csv = lines.join('\n');
      const dateStamp = new Date().toISOString().slice(0, 10);
      const filename = `community-ai-forecast-${dateStamp}.csv`;
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.URL.revokeObjectURL(url);
      setShowExportToast(true);
      setToastMessage('Forecast exported successfully');
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => setShowExportToast(false), 2500);
    } catch {
      setToastMessage('Export failed. Please try again.');
      setShowExportToast(true);
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenInsights = async () => {
    if (!tenantId) return;
    const platform = normalizeValue(platformFilter);
    const contentType = normalizeValue(contentFilter);
    const cacheKey = `${platform || 'all'}::${contentType || 'all'}`;
    setInsightsKey(cacheKey);
    const cached = insightsCache[cacheKey];
    if (cached) {
      setInsightsData(cached);
      setInsightsStatus((prev) => ({ ...prev, [cacheKey]: 'cached' }));
      setShowInsights(true);
      return;
    }
    setInsightsLoading(true);
    setInsightsError(null);
    setInsightsStatus((prev) => ({ ...prev, [cacheKey]: 'loading' }));
    try {
      const query = new URLSearchParams({
        tenant_id: tenantId,
        organization_id: tenantId,
      });
      if (platform) query.set('platform', platform);
      if (contentType) query.set('content_type', contentType);
      const response = await fetchWithAuth(`/api/community-ai/forecast-insights?${query.toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load forecast insights');
      }
      const data = await response.json();
      const payload: ForecastInsights = {
        explanation_summary: data.explanation_summary || '',
        key_drivers: data.key_drivers || [],
        risks: data.risks || [],
        recommended_actions: data.recommended_actions || [],
        confidence_level: data.confidence_level ?? 0,
      };
      setInsightsCache((prev) => ({ ...prev, [cacheKey]: payload }));
      setInsightsData(payload);
      setInsightsStatus((prev) => ({ ...prev, [cacheKey]: 'cached' }));
      setShowInsights(true);
    } catch (error: any) {
      setInsightsError(error?.message || 'Failed to load forecast insights');
      setShowInsights(true);
    } finally {
      setInsightsLoading(false);
    }
  };

  const buildScenarioKey = (
    platform: string,
    contentType: string,
    change: number,
    boost: number,
    mix: Record<string, number>
  ) =>
    `${platform || 'all'}::${contentType || 'all'}::${change}::${boost}::${Object.values(mix).join(',')}`;

  const handleRunSimulation = async () => {
    if (!tenantId) return;
    const platform = normalizeValue(simulationPlatform);
    const contentType = normalizeValue(simulationContent);
    const key = buildScenarioKey(platform, contentType, postingChange, engagementBoost, contentMix);
    setSimulationKey(key);
    const cached = simulationCache[key];
    if (cached) {
      setSimulationResult(cached);
      setSimulationError(null);
      setSimulationStatus((prev) => ({ ...prev, [key]: 'cached' }));
      return;
    }
    setSimulationLoading(true);
    setSimulationError(null);
    setSimulationStatus((prev) => ({ ...prev, [key]: 'loading' }));
    try {
      const response = await fetchWithAuth('/api/community-ai/forecast-simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          ...(platform ? { platform } : {}),
          ...(contentType ? { content_type: contentType } : {}),
          scenario: {
            posting_frequency_change: postingChange,
            engagement_boost_factor: engagementBoost,
            content_type_mix: contentMix,
          },
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to run simulation');
      }
      const data = (await response.json()) as SimulationResult;
      setSimulationCache((prev) => ({ ...prev, [key]: data }));
      setSimulationResult(data);
      setSimulationStatus((prev) => ({ ...prev, [key]: 'cached' }));
    } catch (error: any) {
      setSimulationError(error?.message || 'Failed to run simulation');
    } finally {
      setSimulationLoading(false);
    }
  };

  const handleResetSimulation = () => {
    setSimulationPlatform('All');
    setSimulationContent('All');
    setPostingChange(0);
    setEngagementBoost(0);
    setContentMix({ text: 0, image: 0, video: 0, banner: 0, threads: 0 });
    setSimulationResult(null);
    setSimulationError(null);
    setSimulationStatus({});
    setSimulationKey('');
  };

  const mixTotal = Object.values(contentMix).reduce((sum, value) => sum + Number(value || 0), 0);
  const mixInvalid = mixTotal < -100 || mixTotal > 100;

  useEffect(() => {
    const platform = normalizeValue(simulationPlatform);
    const contentType = normalizeValue(simulationContent);
    const key = buildScenarioKey(platform, contentType, postingChange, engagementBoost, contentMix);
    setSimulationKey(key);
    if (simulationCache[key]) {
      setSimulationStatus((prev) => ({ ...prev, [key]: 'cached' }));
    }
  }, [simulationPlatform, simulationContent, postingChange, engagementBoost, contentMix, simulationCache]);

  return (
    <CommunityAiLayout title="Engagement Forecast">
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {errorMessage}
        </div>
      )}
      {showExportToast && (
        <div
          className={`fixed right-6 top-20 text-sm px-4 py-2 rounded-lg shadow flex items-center gap-2 ${
            toastMessage?.startsWith('Export failed')
              ? 'bg-red-50 border border-red-200 text-red-800'
              : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
          }`}
        >
          <span>{toastMessage}</span>
          <button
            className="text-xs text-gray-500"
            onClick={() => {
              setShowExportToast(false);
              if (toastTimerRef.current) {
                window.clearTimeout(toastTimerRef.current);
                toastTimerRef.current = null;
              }
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <SectionCard title="Filters">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">Platform</label>
            <select
              className="border rounded px-3 py-2 text-sm"
              value={platformFilter}
              onChange={(event) => setPlatformFilter(event.target.value)}
            >
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">Content Type</label>
            <select
              className="border rounded px-3 py-2 text-sm"
              value={contentFilter}
              onChange={(event) => setContentFilter(event.target.value)}
            >
              {CONTENT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Forecast Table">
        <div className="flex flex-wrap items-center gap-2 text-xs mb-3">
          {showFilterChips && (
            <>
              {platformFilter !== 'All' && (
                <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                  Platform: {platformFilter}
                </span>
              )}
              {contentFilter !== 'All' && (
                <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                  Content Type: {contentFilter}
                </span>
              )}
              <button className="ml-auto text-xs text-indigo-600" onClick={handleClearFilters}>
                Clear Filters ✕
              </button>
            </>
          )}
          <button
            className="w-full sm:w-auto px-3 py-1 text-xs rounded border border-gray-300 text-gray-600"
            onClick={handleOpenInsights}
            disabled={insightsLoading}
          >
            {insightsLoading ? 'Loading…' : 'Why this forecast?'}
          </button>
          <button
            className="w-full sm:w-auto sm:ml-auto px-3 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
            onClick={handleExportCsv}
            disabled={rows.length === 0 || isLoading || isExporting}
          >
            {isExporting ? 'Exporting…' : 'Export Forecast CSV'}
          </button>
        </div>
        {isLoading && <div className="text-sm text-gray-500">Loading...</div>}
        {!isLoading && rows.length === 0 && (
          <div className="text-sm text-gray-400">No forecast data yet.</div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left text-gray-700">
            <thead className="text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Platform</th>
                <th className="px-3 py-2">Content Type</th>
                <th className="px-3 py-2">Predicted Likes</th>
                <th className="px-3 py-2">Predicted Comments</th>
                <th className="px-3 py-2">Predicted Shares</th>
                <th className="px-3 py-2">Predicted Views</th>
                <th className="px-3 py-2">Confidence</th>
                <th className="px-3 py-2">Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry, index) => (
                <tr key={`${entry.date}-${entry.platform}-${entry.content_type}-${index}`} className="border-b">
                  <td className="px-3 py-2">{entry.date}</td>
                  <td className="px-3 py-2">{entry.platform}</td>
                  <td className="px-3 py-2">{entry.content_type}</td>
                  <td className="px-3 py-2">{entry.predicted_likes}</td>
                  <td className="px-3 py-2">{entry.predicted_comments}</td>
                  <td className="px-3 py-2">{entry.predicted_shares}</td>
                  <td className="px-3 py-2">{entry.predicted_views}</td>
                  <td className="px-3 py-2">{entry.confidence_level}</td>
                  <td className="px-3 py-2">
                    {entry.risk ? (
                      <span
                        className={`px-2 py-0.5 rounded-full border text-xs ${
                          entry.risk.severity === 'high'
                            ? 'border-red-200 text-red-600 bg-red-50'
                            : entry.risk.severity === 'medium'
                              ? 'border-amber-200 text-amber-600 bg-amber-50'
                              : 'border-emerald-200 text-emerald-600 bg-emerald-50'
                        }`}
                        title={entry.risk.reason}
                      >
                        {entry.risk.severity}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="What-If Simulation">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 mb-3">
          <div>Scenario controls</div>
          {simulationKey && simulationStatus[simulationKey] && (
            <div>
              {simulationStatus[simulationKey] === 'loading'
                ? '🔄 Running simulation…'
                : '🟢 Scenario cached'}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">Platform</label>
            <select
              className="border rounded px-3 py-2 text-sm"
              value={simulationPlatform}
              onChange={(event) => setSimulationPlatform(event.target.value)}
            >
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">Content Type</label>
            <select
              className="border rounded px-3 py-2 text-sm"
              value={simulationContent}
              onChange={(event) => setSimulationContent(event.target.value)}
            >
              {CONTENT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">Posting Frequency Change</label>
            <div className="flex items-center gap-2">
              <button
                className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600"
                onClick={() => setPostingChange((prev) => Math.max(-5, prev - 1))}
              >
                –
              </button>
              <div className="text-sm">{postingChange}</div>
              <button
                className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600"
                onClick={() => setPostingChange((prev) => Math.min(5, prev + 1))}
              >
                +
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-500">Engagement Boost (%)</label>
            <input
              type="range"
              min={0}
              max={50}
              value={engagementBoost}
              onChange={(event) => setEngagementBoost(Number(event.target.value))}
            />
            <div className="text-xs text-gray-500">{engagementBoost}%</div>
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className={`text-xs ${mixInvalid ? 'text-red-600' : 'text-emerald-600'}`}>
                Content Mix (Total: {mixTotal > 0 ? `+${mixTotal}` : mixTotal}%)
              </label>
              {mixTotal !== 0 && (
                <button
                  className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600"
                  onClick={() => {
                    setContentMix({ text: 0, image: 0, video: 0, banner: 0, threads: 0 });
                    if (simulationKey) {
                      setSimulationCache((prev) => {
                        const next = { ...prev };
                        delete next[simulationKey];
                        return next;
                      });
                      setSimulationStatus((prev) => {
                        const next = { ...prev };
                        delete next[simulationKey];
                        return next;
                      });
                    }
                    setSimulationResult(null);
                    setSimulationError(null);
                  }}
                >
                  Normalize to 0%
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 text-xs">
              {(['text', 'image', 'video', 'banner', 'threads'] as const).map((key) => (
                <div key={key} className="flex flex-col gap-1">
                  <span className="text-gray-500">{key}</span>
                  <input
                    type="number"
                    className="border rounded px-2 py-1 text-xs"
                    value={contentMix[key]}
                    onChange={(event) =>
                      setContentMix((prev) => ({
                        ...prev,
                        [key]: Number(event.target.value),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
            <div className={`text-xs ${mixInvalid ? 'text-red-600' : 'text-emerald-600'}`}>
              Total mix change must be between -100% and +100%.
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="w-full sm:w-auto px-3 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
            onClick={handleRunSimulation}
            disabled={simulationLoading || mixInvalid}
          >
            {simulationLoading ? 'Running…' : 'Run Simulation'}
          </button>
          <button
            className="w-full sm:w-auto px-3 py-1 text-xs rounded border border-gray-300 text-gray-600"
            onClick={handleResetSimulation}
            disabled={simulationLoading}
          >
            Reset
          </button>
        </div>
        {simulationError && <div className="text-xs text-red-600 mt-2">{simulationError}</div>}
        {simulationResult && (
          <div className="mt-4">
            <div className="text-xs text-gray-500 mb-2">Simulation Results</div>
            <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left text-gray-700">
              <thead className="text-xs uppercase text-gray-500 border-b">
                <tr>
                  <th className="px-3 py-2">Metric</th>
                  <th className="px-3 py-2">Baseline</th>
                  <th className="px-3 py-2">Simulated</th>
                  <th className="px-3 py-2">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const metrics = ['likes', 'comments', 'shares', 'views'];
                  const contentTypes =
                    simulationContent === 'All'
                      ? Array.from(
                          new Set(simulationResult.baseline_forecast.map((item) => item.content_type))
                        )
                      : [normalizeValue(simulationContent)];
                  const rows = [];
                  for (const contentType of contentTypes) {
                    for (const metric of metrics) {
                      const baseline = simulationResult.baseline_forecast
                        .filter((item) => item.content_type === contentType)
                        .reduce((sum, item) => sum + Number((item as any)[`predicted_${metric}`] || 0), 0);
                      const simulated = simulationResult.simulated_forecast
                        .filter((item) => item.content_type === contentType)
                        .reduce((sum, item) => sum + Number((item as any)[`predicted_${metric}`] || 0), 0);
                      const changePercent = baseline
                        ? Number((((simulated - baseline) / baseline) * 100).toFixed(2))
                        : 0;
                      rows.push({
                        key: `${contentType}-${metric}`,
                        label:
                          simulationContent === 'All'
                            ? `${contentType} • ${metric}`
                            : metric,
                        baseline,
                        simulated,
                        changePercent,
                      });
                    }
                  }
                  return rows.map((row) => (
                    <tr key={row.key} className="border-b">
                      <td className="px-3 py-2">{row.label}</td>
                      <td className="px-3 py-2">{Math.round(row.baseline)}</td>
                      <td className="px-3 py-2">{Math.round(row.simulated)}</td>
                      <td className={`px-3 py-2 ${row.changePercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {row.changePercent}%
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </SectionCard>
      {showInsights && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-4 sm:p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold">Forecast Insights</h3>
                {insightsKey && insightsStatus[insightsKey] && (
                  <div className="text-xs text-gray-500 mt-1">
                    {insightsStatus[insightsKey] === 'loading' ? '🔄 Generating insights…' : '🟢 Insights cached'}
                  </div>
                )}
              </div>
              <button
                className="text-sm text-gray-500"
                onClick={() => {
                  setShowInsights(false);
                  setInsightsError(null);
                }}
              >
                Close
              </button>
            </div>
            {insightsError && <div className="text-sm text-red-600">{insightsError}</div>}
            {!insightsError && !insightsData && (
              <div className="text-sm text-gray-500">Loading insights...</div>
            )}
            {insightsData && (
              <div className="space-y-4 text-sm">
                <div>
                  <div className="text-xs text-gray-500">Explanation Summary</div>
                  <div className="text-gray-700">{insightsData.explanation_summary || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Key Drivers</div>
                  <ul className="list-disc list-inside text-gray-700">
                    {(insightsData.key_drivers || []).map((item, index) => (
                      <li key={`driver-${index}`}>
                        {typeof item === 'string' ? item : JSON.stringify(item)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Risks</div>
                  <ul className="list-disc list-inside text-gray-700">
                    {(insightsData.risks || []).map((item, index) => (
                      <li key={`risk-${index}`}>
                        {typeof item === 'string' ? item : JSON.stringify(item)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Recommended Actions</div>
                  <ul className="list-disc list-inside text-gray-700">
                    {(insightsData.recommended_actions || []).map((item, index) => (
                      <li key={`action-${index}`}>
                        {typeof item === 'string' ? item : JSON.stringify(item)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="text-xs text-gray-500">
                  Confidence Level: {insightsData.confidence_level ?? 0}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </CommunityAiLayout>
  );
}
