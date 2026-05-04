import React, { useEffect, useMemo, useState } from 'react';
import type { OpportunityTabProps } from './types';
import { RefreshCw, Radar, ShieldAlert, Sparkles } from 'lucide-react';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';

const MARKET_PULSE_CATEGORIES = [
  'competitor_moves',
  'product_positioning',
  'partnerships_alliances',
  'growth_expansion',
  'hiring_talent',
  'regulatory_policy',
  'capital_business_health',
  'demand_category_momentum',
  'technology_platform_shifts',
];

type ContextResponse = {
  companyId: string;
  profile: {
    name?: string | null;
    industry?: string | null;
    geography?: string | null;
    geography_list?: string[];
  };
  marketPulseProfile: {
    primary_operating_markets?: string[];
    target_expansion_markets?: string[];
    named_competitors?: string[];
    effective_market_focus?: string[];
    effective_competitors?: string[];
    business_model?: string;
    provider_type?: string;
    domain_role?: string;
    operating_model?: string;
    solution_domains?: string[];
    competitor_details?: Array<{
      name: string;
      category?: string | null;
      tier?: string | null;
      score?: number | null;
      confidence?: number | null;
      rationale?: string | null;
    }>;
    competitor_quality?: {
      highest_score?: number | null;
      threshold?: number | null;
      threshold_met?: boolean | null;
      detail_mode?: 'high_confidence' | 'expanded_context' | null;
    };
    market_alternatives?: Array<{
      name: string;
      category?: string | null;
      tier?: string | null;
      score?: number | null;
      confidence?: number | null;
      rationale?: string | null;
      use_case?: string | null;
      business_model?: string | null;
    }>;
    core_offerings?: string[];
    growth_priorities?: string[];
    partnership_priorities?: string[];
    critical_hiring_functions?: string[];
    regulatory_policy_sensitivity?: string[];
    default_categories?: string[];
    exclusions?: string[];
    preferred_regions?: string[];
  };
};

type AutomationResponse = {
  settings?: {
    is_active?: boolean;
    objective?: string;
    categories?: string[];
    region_scope?: 'profile_markets' | 'expansion_markets' | 'all_defaults' | 'custom';
    custom_regions?: string[];
    competitor_scope?: 'profile_only' | 'auto_discover' | 'combined';
    custom_direction?: string | null;
    credit_acknowledged?: boolean;
  } | null;
};

const SOURCE_STRATEGIES = [
  { value: 'hybrid', label: 'AI + API' },
  { value: 'ai', label: 'AI only' },
  { value: 'api', label: 'API only' },
] as const;

type MarketPulseFinding = {
  id: string;
  category: string;
  title: string;
  summary: string;
  impact_type: 'opportunity' | 'risk' | 'watch';
  why_it_matters: string;
  recommended_action: string;
  change_status: 'new' | 'updated' | 'unchanged' | 'resolved';
  confidence_score: number;
  relevance_score: number;
  regions: string[];
};

type RunResponse = {
  run: {
    id: string;
    status: string;
    objective: string;
    categories: string[];
    created_at: string;
    completed_at?: string | null;
    progress_stage?: string | null;
    confidence_index?: number | null;
    legacy_status?: string | null;
    legacy_error?: string | null;
  };
  findings: MarketPulseFinding[];
};

type HistoryItem = {
  id: string;
  mode: string;
  objective: string;
  categories: string[];
  status: string;
  credits_consumed: number;
  created_at: string;
  completed_at?: string | null;
};

type PendingRunState = {
  created_at: string;
  status: 'pending' | 'running';
  progress_stage?: string | null;
};

const OBJECTIVES = [
  { value: 'growth', label: 'Growth' },
  { value: 'expansion', label: 'Expansion' },
  { value: 'hiring', label: 'Hiring' },
  { value: 'partnerships', label: 'Partnerships' },
  { value: 'product', label: 'Product' },
  { value: 'risk', label: 'Risk' },
] as const;

function toTitle(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildResolvedRegionPreview(
  context: ContextResponse | null,
  scope: 'profile_markets' | 'expansion_markets' | 'all_defaults' | 'custom',
  customRegions: string,
) {
  if (!context) return [];
  const trimmedCustomRegions = customRegions.split(',').map((item) => item.trim()).filter(Boolean);
  const profileMarkets = context.marketPulseProfile.primary_operating_markets ?? [];
  const expansionMarkets = context.marketPulseProfile.target_expansion_markets ?? [];
  const preferredRegions = context.marketPulseProfile.preferred_regions ?? [];
  const geographyList = context.profile.geography_list ?? [];
  const geography = context.profile.geography ? [context.profile.geography] : [];

  const resolved = scope === 'custom'
    ? trimmedCustomRegions
    : scope === 'expansion_markets'
      ? (expansionMarkets.length ? expansionMarkets : preferredRegions)
      : scope === 'all_defaults'
        ? [...profileMarkets, ...expansionMarkets, ...preferredRegions]
        : profileMarkets.length
          ? profileMarkets
          : preferredRegions.length
            ? preferredRegions
            : geographyList.length
              ? geographyList
              : geography;

  return Array.from(new Set(resolved)).filter(Boolean);
}

export default function MarketPulseTabV2(props: OpportunityTabProps) {
  const { companyId, apiFetch } = props;
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [mode, setMode] = useState<'one_time' | 'automated'>('one_time');
  const [objective, setObjective] = useState<'growth' | 'expansion' | 'hiring' | 'partnerships' | 'product' | 'risk'>('growth');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [regionScope, setRegionScope] = useState<'profile_markets' | 'expansion_markets' | 'all_defaults' | 'custom'>('profile_markets');
  const [customRegions, setCustomRegions] = useState('');
  const [competitorScope, setCompetitorScope] = useState<'profile_only' | 'auto_discover' | 'combined'>('combined');
  const [sourceStrategy, setSourceStrategy] = useState<'ai' | 'api' | 'hybrid'>('hybrid');
  const [customDirection, setCustomDirection] = useState('');
  const [creditAcknowledged, setCreditAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [pendingRun, setPendingRun] = useState<PendingRunState | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    if (!companyId) return;
    let active = true;

    const load = async () => {
      setLoadingContext(true);
      try {
        const res = await apiFetch(`/api/market-pulse/context?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to load Market Pulse context');
        }
        const data = (await res.json()) as ContextResponse;
        if (!active) return;
        setContext(data);
        setSelectedCategories(data.marketPulseProfile.default_categories?.length ? data.marketPulseProfile.default_categories : ['competitor_moves', 'growth_expansion', 'regulatory_policy']);
      } catch (error) {
        if (!active) return;
        setErrorMessage((error as Error).message || 'Failed to load Market Pulse context');
      } finally {
        if (active) setLoadingContext(false);
      }
    };

    const loadAutomation = async () => {
      try {
        const res = await apiFetch(`/api/market-pulse/automation?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as AutomationResponse;
        if (!active) return;
        if (data?.settings) {
          setAutomationEnabled(Boolean(data.settings.is_active));
          if (data.settings.objective && OBJECTIVES.some((item) => item.value === data.settings?.objective)) {
            setObjective(data.settings.objective as typeof objective);
          }
          if (Array.isArray(data.settings.categories) && data.settings.categories.length > 0) {
            setSelectedCategories(data.settings.categories.filter((item) => MARKET_PULSE_CATEGORIES.includes(item)));
          }
          if (data.settings.region_scope) {
            setRegionScope(data.settings.region_scope);
          }
          if (data.settings.competitor_scope) {
            setCompetitorScope(data.settings.competitor_scope);
          }
          if (Array.isArray(data.settings.custom_regions) && data.settings.custom_regions.length > 0) {
            setCustomRegions(data.settings.custom_regions.join(', '));
          }
          if (typeof data.settings.custom_direction === 'string') {
            setCustomDirection(data.settings.custom_direction);
          }
          setCreditAcknowledged(Boolean(data.settings.credit_acknowledged));
        }
      } catch {
        // ignore
      }
    };

    const loadHistory = async () => {
      try {
        const res = await apiFetch(`/api/market-pulse/history?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setHistory(Array.isArray(data?.history) ? data.history : []);
      } catch {
        // ignore
      }
    };

    void load();
    void loadAutomation();
    void loadHistory();
    return () => {
      active = false;
    };
  }, [companyId, apiFetch]);

  useEffect(() => {
    if (!runId || !companyId) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await apiFetch(`/api/market-pulse/runs/${encodeURIComponent(runId)}?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as RunResponse;
        setRunResult(data);
        setPendingRun(null);
        if (!['pending', 'running'].includes(String(data.run?.status ?? ''))) {
          const historyRes = await apiFetch(`/api/market-pulse/history?companyId=${encodeURIComponent(companyId)}`);
          if (historyRes.ok) {
            const historyData = await historyRes.json();
            setHistory(Array.isArray(historyData?.history) ? historyData.history : []);
          }
        }
        if (!['pending', 'running'].includes(String(data.run?.status ?? ''))) {
          setRunning(false);
          window.clearInterval(timer);
        }
      } catch {
        // ignore poll errors
      }
    }, 4000);

    return () => window.clearInterval(timer);
  }, [companyId, apiFetch, runId]);

  const groupedFindings = useMemo(() => {
    const findings = runResult?.findings ?? [];
    return {
      top: findings.filter((item) => item.change_status === 'new' || item.change_status === 'updated').slice(0, 6),
      risks: findings.filter((item) => item.impact_type === 'risk'),
      watch: findings.filter((item) => item.impact_type === 'watch'),
      opportunities: findings.filter((item) => item.impact_type === 'opportunity'),
    };
  }, [runResult]);

  const resolvedRegionPreview = useMemo(
    () => buildResolvedRegionPreview(context, regionScope, customRegions),
    [context, regionScope, customRegions]
  );

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]
    );
  };

  const runScan = async () => {
    if (!companyId) return;
    setRunning(true);
    setErrorMessage(null);
    setRunResult(null);
    setPendingRun({
      created_at: new Date().toISOString(),
      status: 'pending',
      progress_stage: 'INITIALIZING',
    });
    try {
      const res = await apiFetch('/api/market-pulse/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          mode,
          objective,
          categories: selectedCategories,
          region_scope: regionScope,
          custom_regions: customRegions.split(',').map((item) => item.trim()).filter(Boolean),
          competitor_scope: competitorScope,
          source_strategy: sourceStrategy,
          custom_direction: customDirection.trim() || null,
          delivery_mode: mode === 'automated' ? 'daily_digest' : 'page_only',
          credit_acknowledged: creditAcknowledged,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to start Market Pulse run');
      }
      const data = await res.json();
      setRunId(String(data.runId));
      setPendingRun((current) => current ? { ...current, status: 'running', progress_stage: 'INITIALIZING' } : current);
    } catch (error) {
      setRunning(false);
      setPendingRun(null);
      setErrorMessage((error as Error).message || 'Failed to start Market Pulse run');
    }
  };

  const saveAutomation = async () => {
    if (!companyId) return;
    setAutomationLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiFetch('/api/market-pulse/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          is_active: automationEnabled,
          cadence: 'daily',
          objective,
          categories: selectedCategories,
          region_scope: regionScope,
          custom_regions: customRegions.split(',').map((item) => item.trim()).filter(Boolean),
          competitor_scope: competitorScope,
          custom_direction: customDirection.trim() || null,
          credit_acknowledged: creditAcknowledged,
          warning_copy_version: 'v1',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to save automation');
      }
    } catch (error) {
      setErrorMessage((error as Error).message || 'Failed to save automation');
    } finally {
      setAutomationLoading(false);
    }
  };

  const stopScan = async () => {
    if (!companyId || !runId) return;
    setCancelLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiFetch(`/api/market-pulse/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to stop Market Pulse run');
      }

      const cancelledAt = new Date().toISOString();
      setRunning(false);
      setPendingRun(null);
      setRunResult((current) => current ? {
        ...current,
        run: {
          ...current.run,
          status: 'failed',
          completed_at: cancelledAt,
          legacy_error: 'Cancelled by user',
        },
      } : null);
    } catch (error) {
      setErrorMessage((error as Error).message || 'Failed to stop Market Pulse run');
    } finally {
      setCancelLoading(false);
    }
  };

  if (!companyId) {
    return <div className="py-4 text-sm text-gray-500">Select a company to view Market Pulse.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Market Pulse</p>
            <h3 className="mt-2 text-2xl font-bold text-gray-900">Monitor the market with company-aware filters</h3>
            <p className="mt-2 text-sm text-gray-600">
              Use company profile context, category selection, and geography scope to surface only the external developments that matter.
            </p>
          </div>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <span className="font-semibold">{context?.profile?.name || 'Company context'}</span>
            <span className="ml-2 text-indigo-700">{context?.profile?.industry || 'Industry pending'}</span>
          </div>
        </div>
      </div>

      {errorMessage && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMessage}</div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Radar className="h-4 w-4 text-indigo-600" />
              <h4 className="text-sm font-semibold text-gray-900">Scan Setup</h4>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-gray-700">Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as 'one_time' | 'automated')} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="one_time">One-time scan</option>
                  <option value="automated">Automated monitoring</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Objective</label>
                <select value={objective} onChange={(e) => setObjective(e.target.value as typeof objective)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {OBJECTIVES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Region scope</label>
                <select value={regionScope} onChange={(e) => setRegionScope(e.target.value as typeof regionScope)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="profile_markets">Market focus</option>
                  <option value="expansion_markets">Expansion markets</option>
                  <option value="all_defaults">All defaults</option>
                  <option value="custom">Custom regions</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Competitor scope</label>
                <select value={competitorScope} onChange={(e) => setCompetitorScope(e.target.value as typeof competitorScope)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="profile_only">Profile competitors</option>
                  <option value="auto_discover">Auto-discover</option>
                  <option value="combined">Combine both</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Research mode</label>
                <select value={sourceStrategy} onChange={(e) => setSourceStrategy(e.target.value as typeof sourceStrategy)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {SOURCE_STRATEGIES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Custom regions</label>
                <input value={customRegions} onChange={(e) => setCustomRegions(e.target.value)} disabled={regionScope !== 'custom'} placeholder="Comma-separated: US, Canada, UK" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100" />
                <p className="mt-2 text-xs text-gray-500">
                  Active regions: {resolvedRegionPreview.length ? resolvedRegionPreview.join(', ') : 'Global fallback'}
                </p>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Custom direction</label>
                <textarea value={customDirection} onChange={(e) => setCustomDirection(e.target.value)} rows={3} placeholder="Example: Track North America expansion, visa friction, and partnership signals for IT services." className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="mt-5">
              <label className="text-sm font-medium text-gray-700">Signal categories</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {MARKET_PULSE_CATEGORIES.map((category) => {
                  const active = selectedCategories.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                        active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {toTitle(category)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={runScan}
                disabled={running || loadingContext || selectedCategories.length === 0}
                className="inline-flex min-h-[56px] items-center gap-3 rounded-2xl bg-gray-900 px-7 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-50"
              >
                <Sparkles className="h-5 w-5" />
                {running ? 'Running scan...' : 'Run Market Pulse'}
              </button>
              {running && runId && (
                <button
                  type="button"
                  onClick={stopScan}
                  disabled={cancelLoading}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                >
                  {cancelLoading ? 'Stopping...' : 'Stop scan'}
                </button>
              )}
              {runResult?.run?.created_at && (
                <span className="text-sm text-gray-500">Last run: {new Date(runResult.run.created_at).toLocaleString()}</span>
              )}
            </div>
            {context && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Market Focus</div>
                  <div className="mt-1">{context.marketPulseProfile.effective_market_focus?.join(', ') || 'Not set'}</div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Domain Role</div>
                  <div className="mt-1">{context.marketPulseProfile.domain_role || context.marketPulseProfile.provider_type || 'Not set'}</div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Policy Sensitivity</div>
                  <div className="mt-1">{context.marketPulseProfile.regulatory_policy_sensitivity?.join(', ') || 'Not set'}</div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-indigo-600" />
              <h4 className="text-sm font-semibold text-gray-900">Results</h4>
            </div>

            {!runResult && pendingRun && (
              <div className="mb-4">
                <EngineJobStatusPanel
                  status={String(pendingRun.status).toUpperCase()}
                  progressStage={pendingRun.progress_stage}
                  createdAt={pendingRun.created_at}
                  durationHint="Typically 1-5 min depending on regions and research mode"
                />
              </div>
            )}

            {runResult?.run?.status && ['pending', 'running', 'completed', 'completed_with_warnings', 'failed'].includes(String(runResult.run.status).toLowerCase()) && (
              <div className="mb-4">
                <EngineJobStatusPanel
                  status={String(runResult.run.status).toUpperCase()}
                  progressStage={runResult.run.progress_stage}
                  confidenceIndex={runResult.run.confidence_index}
                  error={runResult.run.legacy_error}
                  createdAt={runResult.run.created_at}
                  durationHint="Typically 1-5 min depending on regions and research mode"
                />
              </div>
            )}

            {!runResult && <div className="text-sm text-gray-500">Run a scan to see structured Market Pulse findings here.</div>}

            {runResult && (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Status</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{toTitle(runResult.run.status)}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Findings</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{runResult.findings.length}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">New / Updated</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{groupedFindings.top.length}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Risks</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{groupedFindings.risks.length}</div>
                  </div>
                </div>

                {[
                  { title: 'Top Strategic Findings', items: groupedFindings.top },
                  { title: 'Risk Signals', items: groupedFindings.risks },
                  { title: 'Watch List', items: groupedFindings.watch },
                  { title: 'Opportunity Signals', items: groupedFindings.opportunities },
                ].map((section) => (
                  <div key={section.title}>
                    <h5 className="mb-3 text-sm font-semibold text-gray-900">{section.title}</h5>
                    {section.items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">No items in this section yet.</div>
                    ) : (
                      <div className="space-y-3">
                        {section.items.map((item) => (
                          <div key={item.id} className="rounded-xl border border-gray-200 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900">{item.title}</span>
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{toTitle(item.category)}</span>
                              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{toTitle(item.change_status)}</span>
                            </div>
                            <p className="mt-2 text-sm text-gray-600">{item.summary}</p>
                            <p className="mt-2 text-sm text-gray-800"><strong>Why it matters:</strong> {item.why_it_matters}</p>
                            <p className="mt-1 text-sm text-gray-800"><strong>Recommended action:</strong> {item.recommended_action}</p>
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                              <span>Confidence: {Math.round(item.confidence_score)}</span>
                              <span>Relevance: {Math.round(item.relevance_score)}</span>
                              <span>Regions: {item.regions?.length ? item.regions.join(', ') : 'Global'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-900">Recent runs</h4>
            <div className="mt-4 space-y-3">
              {history.length === 0 ? (
                <div className="text-sm text-gray-500">No Market Pulse history yet.</div>
              ) : (
                history.map((item) => (
                  <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{toTitle(item.status)}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">{toTitle(item.objective)}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">{item.mode === 'automated' ? 'Automated' : 'One-time'}</span>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      {new Date(item.created_at).toLocaleString()} · Credits: {item.credits_consumed ?? 0}
                    </div>
                    <div className="mt-2 text-sm text-gray-600">
                      {(item.categories || []).map(toTitle).join(', ') || 'No categories'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <h4 className="text-sm font-semibold text-gray-900">Automation</h4>
            </div>
            <p className="text-sm text-gray-600">
              Enable daily monitoring only if you want automated market scans. Each successful automated scan will consume credits.
            </p>
            <label className="mt-4 flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" checked={automationEnabled} onChange={(e) => setAutomationEnabled(e.target.checked)} className="mt-1" />
              <span>Enable daily Market Pulse monitoring</span>
            </label>
            <label className="mt-3 flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" checked={creditAcknowledged} onChange={(e) => setCreditAcknowledged(e.target.checked)} className="mt-1" />
              <span>I understand automated scans will consume credits on each completed run.</span>
            </label>
            <button type="button" onClick={saveAutomation} disabled={automationLoading || (automationEnabled && !creditAcknowledged)} className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50">
              {automationLoading ? 'Saving...' : 'Save automation'}
            </button>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-900">Profile-backed defaults</h4>
            <div className="mt-3 space-y-2 text-sm text-gray-600">
              <div><strong>Market focus:</strong> {context?.marketPulseProfile.effective_market_focus?.join(', ') || 'Not set'}</div>
              <div><strong>Domain role:</strong> {context?.marketPulseProfile.domain_role || context?.marketPulseProfile.provider_type || 'Not set'}</div>
              <div><strong>Solution domains:</strong> {context?.marketPulseProfile.solution_domains?.join(', ') || 'Not set'}</div>
              <div><strong>Policy sensitivity:</strong> {context?.marketPulseProfile.regulatory_policy_sensitivity?.join(', ') || 'Not set'}</div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
