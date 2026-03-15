import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { CheckCircle, XCircle } from 'lucide-react';
import type { OpportunityTabProps } from './types';
import EngineContextPanel from '../EngineContextPanel';
import EngineOverridePanel from '../EngineOverridePanel';
import UnifiedContextModeSelector, { type ContextMode, type FocusModule } from '../engine-framework/UnifiedContextModeSelector';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';
import { useEngineJobPolling } from '../../../hooks/useEngineJobPolling';

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'twitter', label: 'X' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'linkedin', label: 'LinkedIn' },
] as const;

type JobStatus = 'idle' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED';

type LeadStatus =
  | 'ACTIVE'
  | 'WATCHLIST'
  | 'OUTREACH_PLANNED'
  | 'OUTREACH_SENT'
  | 'ENGAGED'
  | 'CONVERTED'
  | 'DISMISSED'
  | 'ARCHIVED';

type FunnelTab = 'Active' | 'Watchlist' | 'Outreach' | 'Engaged' | 'Converted';

type LeadResult = {
  id: string;
  platform: string;
  region: string | null;
  snippet: string;
  source_url: string;
  author_handle: string | null;
  icp_score: number;
  urgency_score: number;
  intent_score: number;
  total_score: number;
  effective_score?: number;
  engagement_potential?: number;
  risk_flag: boolean;
  signal_type?: string | null;
  trend_velocity?: number | null;
  conversion_window_days?: number | null;
  status?: string | null;
  converted_at?: string | null;
  problem_domain?: string | null;
  created_at: string;
};

type LeadCluster = {
  id: string;
  problem_domain: string;
  signal_count: number;
  regions: string[];
  platforms: string[];
  priority_score: number;
  avg_intent_score: number;
  avg_urgency_score: number;
  avg_trend_velocity?: number;
  created_at?: string | null;
  latest_post_at?: string | null;
};

/** Cluster confidence: weighted composite of intent, urgency, signal_count, trend_velocity. Returns 0-100. */
function clusterConfidence(c: LeadCluster): number {
  const intent = (c.avg_intent_score ?? 0) * 100;
  const urgency = (c.avg_urgency_score ?? 0) * 100;
  const trend = Math.min(100, (c.avg_trend_velocity ?? 0) * 100);
  const signalNorm = Math.min(100, (c.signal_count ?? 0) * 8);
  return Math.round(0.35 * intent + 0.3 * urgency + 0.2 * trend + 0.15 * signalNorm);
}

/** Days since cluster's most recent signal (latest_post_at) or creation. */
function clusterAgeDays(c: LeadCluster): number | null {
  const ts = c.latest_post_at ?? c.created_at;
  if (!ts) return null;
  return (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24);
}

const TREND_CLUSTER_PAYLOAD_BRIDGE = 'trend_cluster_payload_bridge';

export default function ActiveLeadsTab(props: OpportunityTabProps) {
  const { companyId, onPromote, onSwitchTab, fetchWithAuth, overrideText = '', onOverrideChange } = props;
  const router = useRouter();
  const [contextMode, setContextMode] = useState<ContextMode>('FULL');
  const [focusedModules, setFocusedModules] = useState<FocusModule[]>([]);
  const [additionalDirection, setAdditionalDirection] = useState('');
  const [contextError, setContextError] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [regionInput, setRegionInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus>('idle');
  const [totalFound, setTotalFound] = useState(0);
  const [totalQualified, setTotalQualified] = useState(0);
  const [results, setResults] = useState<LeadResult[]>([]);
  const [confidenceIndex, setConfidenceIndex] = useState<number | null>(null);
  const [jobMode, setJobMode] = useState<string>('REACTIVE');
  const [listeningMode, setListeningMode] = useState<'REACTIVE' | 'PREDICTIVE'>('REACTIVE');
  const [funnelTab, setFunnelTab] = useState<FunnelTab>('Active');
  const [clusters, setClusters] = useState<LeadCluster[]>([]);
  const [clusterDomainFilter, setClusterDomainFilter] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  /** Set of platform ids that have a connected connector (API returns e.g. 'twitter'; we match by PLATFORMS[].id). null = not loaded or no permission. */
  const [connectedPlatforms, setConnectedPlatforms] = useState<Set<string> | null>(null);

  const fetchConnectorStatus = useCallback(async () => {
    if (!companyId || !fetchWithAuth) {
      setConnectedPlatforms(null);
      return;
    }
    try {
      const res = await fetchWithAuth(
        `/api/community-ai/connectors/status?tenant_id=${encodeURIComponent(companyId)}&organization_id=${encodeURIComponent(companyId)}`
      );
      if (!res.ok) {
        setConnectedPlatforms(null);
        return;
      }
      const data = (await res.json()) as
        | { connections?: { platform: string; connected?: boolean }[] }
        | { platform: string; connected?: boolean }[];
      const list = Array.isArray(data) ? data : data?.connections ?? [];
      const set = new Set<string>();
      for (const r of list || []) {
        if (r.connected !== false && r.platform) {
          const key = String(r.platform).toLowerCase().trim();
          set.add(key);
          if (key === 'twitter') set.add('x');
          if (key === 'x') set.add('twitter');
        }
      }
      setConnectedPlatforms(set);
    } catch {
      setConnectedPlatforms(null);
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    fetchConnectorStatus();
  }, [fetchConnectorStatus]);

  const { job: polledJob, error: pollError } = useEngineJobPolling<{
    status?: string;
    progress_stage?: string | null;
    total_found?: number;
    total_qualified?: number;
    confidence_index?: number;
    mode?: string;
    results?: LeadResult[];
    clusters?: LeadCluster[];
    error?: string | null;
  }>(
    jobId,
    jobId ? `/api/leads/job/${jobId}` : null,
    fetchWithAuth,
    { enabled: !!jobId }
  );

  useEffect(() => {
    if (pollError) setJobError(pollError);
  }, [pollError]);

  useEffect(() => {
    if (!polledJob) return;
    setJobStatus((polledJob.status as JobStatus) ?? jobStatus);
    setTotalFound(polledJob.total_found ?? 0);
    setTotalQualified(polledJob.total_qualified ?? 0);
    setConfidenceIndex(typeof polledJob.confidence_index === 'number' ? polledJob.confidence_index : null);
    setJobMode(polledJob.mode ?? 'REACTIVE');
    setResults(Array.isArray(polledJob.results) ? polledJob.results : []);
    setClusters(Array.isArray(polledJob.clusters) ? polledJob.clusters : []);
    if (polledJob.error) setJobError(polledJob.error);
  }, [polledJob]);

  const togglePlatform = (id: string) => {
    setPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const runListening = async () => {
    if (!companyId || platforms.length === 0) return;
    if (contextMode === 'NONE' && !additionalDirection.trim()) {
      setContextError('Please provide research direction when using No Company Context.');
      return;
    }
    const regions = regionInput
      .split(',')
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);
    if (regions.length === 0) {
      setRunError('Enter at least one region (e.g. US, GB)');
      return;
    }
    setContextError(null);
    setRunError(null);
    setJobError(null);
    setConfidenceIndex(null);
    setClusterDomainFilter(null);
    try {
      const res = await fetchWithAuth('/api/leads/job/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          platforms,
          regions,
          keywords: keywordInput.trim() ? keywordInput.trim().split(/\s*,\s*/).filter(Boolean) : [],
          mode: listeningMode,
          context_mode: contextMode,
          focused_modules: contextMode === 'FOCUSED' && focusedModules.length > 0 ? focusedModules : undefined,
          additional_direction: additionalDirection.trim() || overrideText.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to start job');
      }
      const data = await res.json();
      setJobId(data.jobId);
      setJobStatus(data.status ?? 'PENDING');
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Failed to start');
    }
  };

  const handlePatchStatus = async (leadId: string, newStatus: LeadStatus) => {
    try {
      const res = await fetchWithAuth(`/api/leads/signal/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const updated = await res.json();
        if (newStatus === 'DISMISSED' || newStatus === 'ARCHIVED') {
          setResults((prev) => prev.filter((r) => r.id !== leadId));
        } else {
          setResults((prev) =>
            prev.map((r) => (r.id === leadId ? { ...r, ...updated } : r))
          );
        }
      }
    } catch {
      // ignore
    }
  };

  const handleDismiss = (leadId: string) => handlePatchStatus(leadId, 'DISMISSED');

  const filteredResults = (() => {
    let list = results;
    if (clusterDomainFilter) {
      list = list.filter(
        (r) => (r.problem_domain ?? 'General').trim().toLowerCase() === clusterDomainFilter.toLowerCase()
      );
    }
    switch (funnelTab) {
      case 'Active':
        return list.filter((r) => (r.status ?? 'ACTIVE') === 'ACTIVE');
      case 'Watchlist':
        return list.filter((r) => r.status === 'WATCHLIST');
      case 'Outreach':
        return list.filter((r) =>
          r.status === 'OUTREACH_PLANNED' || r.status === 'OUTREACH_SENT'
        );
      case 'Engaged':
        return list.filter((r) => r.status === 'ENGAGED');
      case 'Converted':
        return list.filter((r) => r.status === 'CONVERTED');
      default:
        return list;
    }
  })();

  if (!companyId) {
    return <div className="text-sm text-gray-500 py-4">Select a company to view active leads.</div>;
  }

  const isRunning = jobStatus === 'PENDING' || jobStatus === 'RUNNING';
  const regionCount = regionInput.split(',').map((r) => r.trim()).filter(Boolean).length || 1;

  return (
    <div className="space-y-6">
      <EngineContextPanel
        companyId={companyId}
        fetchWithAuth={fetchWithAuth}
        contextMode={contextMode}
        focusedModules={focusedModules}
        additionalDirection={additionalDirection}
      />
      <UnifiedContextModeSelector
        mode={contextMode}
        modules={focusedModules}
        additionalDirection={additionalDirection}
        onModeChange={setContextMode}
        onModulesChange={setFocusedModules}
        onAdditionalDirectionChange={setAdditionalDirection}
        requireDirectionWhenNone={true}
      />
      <EngineOverridePanel value={overrideText} onChange={onOverrideChange ?? (() => {})} />

      <section className="rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Listening Configuration</h3>
        <div className="space-y-4">
          <div>
            <span className="block text-xs text-gray-500 mb-2">Listening Mode</span>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="listeningMode"
                  checked={listeningMode === 'REACTIVE'}
                  onChange={() => setListeningMode('REACTIVE')}
                  className="text-indigo-600"
                />
                <span className="text-sm text-gray-700">Reactive Listening</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="listeningMode"
                  checked={listeningMode === 'PREDICTIVE'}
                  onChange={() => setListeningMode('PREDICTIVE')}
                  className="text-indigo-600"
                />
                <span className="text-sm text-gray-700">Predictive Listening</span>
              </label>
            </div>
          </div>
          <div>
            <span className="block text-xs text-gray-500 mb-2">Platforms</span>
            <div className="flex flex-wrap gap-3">
              {PLATFORMS.map((p) => {
                const isConnected = connectedPlatforms === null ? null : connectedPlatforms.has(p.id);
                return (
                  <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={platforms.includes(p.id)}
                      onChange={() => togglePlatform(p.id)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">{p.label}</span>
                    {connectedPlatforms !== null && (
                      isConnected ? (
                        <span title="Connected" aria-hidden>
                          <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                        </span>
                      ) : (
                        <span title="Not connected — connect in Community AI to use this platform" aria-hidden>
                          <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                        </span>
                      )
                    )}
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Regions (comma-separated ISO, e.g. US, GB)</label>
            <input
              type="text"
              value={regionInput}
              onChange={(e) => setRegionInput(e.target.value)}
              placeholder="US, GB, IN"
              className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Keyword override (optional, comma-separated)</label>
            <textarea
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              placeholder="e.g. product, solution"
              rows={2}
              className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={runListening}
            disabled={isRunning || platforms.length === 0}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {listeningMode === 'REACTIVE' ? 'Run Social Listening' : 'Run Predictive Listening'}
          </button>
        </div>
      </section>

      {contextError && <div className="text-sm text-red-600">{contextError}</div>}
      {runError && <div className="text-sm text-red-600">{runError}</div>}
      {jobId && (
        <EngineJobStatusPanel
          status={jobStatus}
          progressStage={polledJob?.progress_stage}
          confidenceIndex={polledJob?.confidence_index}
          error={polledJob?.error ?? jobError}
          createdAt={(polledJob as { created_at?: string } | null)?.created_at}
          durationHint="Typically 2–5 min depending on platforms and regions"
        />
      )}
      {(jobStatus === 'COMPLETED' || jobStatus === 'COMPLETED_WITH_WARNINGS') && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-700 space-y-2">
          <div className="flex flex-wrap gap-6">
            <span><strong>Listening Mode:</strong> {jobMode}</span>
            <span><strong>Total Signals Found:</strong> {totalFound}</span>
            <span><strong>Qualified Leads:</strong> {totalQualified}</span>
          </div>
          {typeof confidenceIndex === 'number' && (
            <div className="flex items-center gap-2">
              <span className="font-medium">Lead Intelligence Confidence:</span>
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  confidenceIndex > 75 ? 'text-green-600' : confidenceIndex >= 50 ? 'text-yellow-600' : 'text-red-600'
                }`}
              >
                {confidenceIndex > 75 ? '🟢' : confidenceIndex >= 50 ? '🟡' : '🔴'}
                {confidenceIndex}%
              </span>
            </div>
          )}
        </div>
      )}

      {clusters.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Emerging Opportunity Clusters</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clusters.map((cluster) => {
              const confidence = clusterConfidence(cluster);
              const ageDays = clusterAgeDays(cluster);
              const isStale = ageDays != null && ageDays > 14;
              return (
              <div
                key={cluster.id}
                className="rounded-xl border border-purple-300 bg-purple-50/50 p-4 shadow-sm"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                      confidence >= 65 ? 'bg-green-500' : confidence >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    title={`Cluster Confidence: ${confidence}%`}
                  />
                  <span className="font-semibold text-gray-800">{cluster.problem_domain}</span>
                </div>
                {ageDays != null && (
                  <div className={`text-xs mb-2 ${isStale ? 'text-amber-700 font-medium' : 'text-gray-600'}`}>
                    Cluster freshness: {Math.floor(ageDays)} day{Math.floor(ageDays) !== 1 ? 's' : ''} old
                    {isStale && ' — Demand momentum slowing.'}
                  </div>
                )}
                <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-gray-600 mb-3">
                  <span>Signals: {cluster.signal_count}</span>
                  <span>Priority: {(cluster.priority_score * 100).toFixed(0)}%</span>
                  <span>Regions: {cluster.regions.length > 0 ? cluster.regions.join(', ') : '—'}</span>
                  <span>Platforms: {cluster.platforms.length > 0 ? cluster.platforms.join(', ') : '—'}</span>
                  <span>Avg Intent: {(cluster.avg_intent_score * 100).toFixed(0)}%</span>
                  <span>Avg Urgency: {(cluster.avg_urgency_score * 100).toFixed(0)}%</span>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setClusterDomainFilter(clusterDomainFilter === cluster.problem_domain ? null : cluster.problem_domain)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                      clusterDomainFilter === cluster.problem_domain
                        ? 'bg-purple-600 border-purple-600 text-white'
                        : 'border-purple-600 text-purple-600 hover:bg-purple-100'
                    }`}
                  >
                    View Signals
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window === 'undefined' || !onSwitchTab) return;
                      const payload = {
                        cluster_inputs: [
                          {
                            problem_domain: cluster.problem_domain,
                            signal_count: cluster.signal_count,
                            avg_intent_score: cluster.avg_intent_score,
                            avg_urgency_score: cluster.avg_urgency_score,
                            priority_score: cluster.priority_score,
                          },
                        ],
                        context_mode: 'NONE',
                      };
                      try {
                        const encoded = encodeURIComponent(JSON.stringify(payload));
                        localStorage.setItem(TREND_CLUSTER_PAYLOAD_BRIDGE, JSON.stringify(payload));
                        router.replace({ pathname: router.pathname, query: { ...router.query, cluster_payload: encoded } }, undefined, { shallow: true });
                        onSwitchTab('TREND');
                      } catch {
                        window.alert('Could not save cluster payload.');
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
                  >
                    Generate Strategic Themes from Cluster
                  </button>
                  <button
                    type="button"
                    onClick={() => typeof window !== 'undefined' && window.alert('Convert to Campaign: coming soon')}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
                  >
                    Convert to Campaign
                  </button>
                </div>
              </div>
            );
            })}
          </div>
        </section>
      )}

      {results.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-4 mb-3">
            <h3 className="text-sm font-semibold text-gray-800">Lead Intelligence</h3>
            <div className="flex flex-wrap gap-1">
              {(['Active', 'Watchlist', 'Outreach', 'Engaged', 'Converted'] as FunnelTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFunnelTab(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                    funnelTab === tab
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
          {filteredResults.length === 0 ? (
            <div className="text-sm text-gray-500 py-4">No leads in {funnelTab} stage.</div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredResults.map((lead) => {
              const isLatent = lead.signal_type === 'LATENT';
              const leadStatus = (lead.status ?? 'ACTIVE') as LeadStatus;
              return (
                <div
                  key={lead.id}
                  className={`rounded-xl border bg-white p-4 shadow-sm ${
                    isLatent ? 'border-purple-300' : 'border-indigo-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-800 capitalize">
                      {lead.platform}
                    </span>
                    {lead.region && (
                      <span className="text-xs text-gray-500">{lead.region}</span>
                    )}
                    {isLatent && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800">
                        Predictive Lead
                      </span>
                    )}
                    {lead.risk_flag && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">
                        Risk
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 mb-3 line-clamp-2">{lead.snippet}</p>
                  {isLatent ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 mb-3">
                      <span>ICP: {Math.round((lead.icp_score ?? 0) * 100)}%</span>
                      <span>Urgency: {Math.round((lead.urgency_score ?? 0) * 100)}%</span>
                      <span>Intent: {Math.round((lead.intent_score ?? 0) * 100)}%</span>
                      {typeof lead.conversion_window_days === 'number' && (
                        <span>Conversion Window: {lead.conversion_window_days} days</span>
                      )}
                      {typeof lead.trend_velocity === 'number' && (
                        <span>Trend Velocity: {(lead.trend_velocity * 100).toFixed(0)}%</span>
                      )}
                      <span className="font-medium text-gray-800 col-span-2">
                        Score: {((lead.effective_score ?? lead.total_score ?? 0) * 100).toFixed(0)}%
                        {(typeof lead.effective_score === 'number' && lead.effective_score !== lead.total_score) && (
                          <span className="text-gray-400 ml-1">(raw {((lead.total_score ?? 0) * 100).toFixed(0)}%)</span>
                        )}
                      </span>
                    </dl>
                  ) : (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 mb-3">
                      <span>ICP Match: {Math.round((lead.icp_score ?? 0) * 100)}%</span>
                      <span>Urgency: {Math.round((lead.urgency_score ?? 0) * 100)}%</span>
                      <span>Intent: {Math.round((lead.intent_score ?? 0) * 100)}%</span>
                      <span className="font-medium text-gray-800 col-span-2">
                        Score: {((lead.effective_score ?? lead.total_score ?? 0) * 100).toFixed(0)}%
                        {(typeof lead.effective_score === 'number' && lead.effective_score !== lead.total_score) && (
                          <span className="text-gray-400 ml-1">(raw {((lead.total_score ?? 0) * 100).toFixed(0)}%)</span>
                        )}
                      </span>
                      {typeof lead.engagement_potential === 'number' && (
                        <span>Engagement potential: {Math.round(lead.engagement_potential * 100)}%</span>
                      )}
                    </dl>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {leadStatus === 'ACTIVE' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handlePatchStatus(lead.id, 'WATCHLIST')}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
                        >
                          Add to Watchlist
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePatchStatus(lead.id, 'OUTREACH_PLANNED')}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-600 text-indigo-600 hover:bg-indigo-50"
                        >
                          Plan Outreach
                        </button>
                        <button type="button" onClick={() => handleDismiss(lead.id)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                          Dismiss
                        </button>
                      </>
                    )}
                    {leadStatus === 'WATCHLIST' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handlePatchStatus(lead.id, 'OUTREACH_PLANNED')}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-600 text-indigo-600 hover:bg-indigo-50"
                        >
                          Plan Outreach
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePatchStatus(lead.id, 'ACTIVE')}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
                        >
                          Remove from Watchlist
                        </button>
                        <button type="button" onClick={() => handleDismiss(lead.id)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                          Dismiss
                        </button>
                      </>
                    )}
                    {leadStatus === 'OUTREACH_PLANNED' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handlePatchStatus(lead.id, 'OUTREACH_SENT')}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-600 text-indigo-600 hover:bg-indigo-50"
                        >
                          Mark Sent
                        </button>
                        <button type="button" onClick={() => handleDismiss(lead.id)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                          Dismiss
                        </button>
                      </>
                    )}
                    {leadStatus === 'OUTREACH_SENT' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handlePatchStatus(lead.id, 'ENGAGED')}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-600 text-indigo-600 hover:bg-indigo-50"
                        >
                          Mark Engaged
                        </button>
                        <button type="button" onClick={() => handleDismiss(lead.id)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                          Dismiss
                        </button>
                      </>
                    )}
                    {leadStatus === 'ENGAGED' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handlePatchStatus(lead.id, 'CONVERTED')}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                          Mark Converted
                        </button>
                        <button type="button" onClick={() => handleDismiss(lead.id)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                          Dismiss
                        </button>
                      </>
                    )}
                    {leadStatus === 'CONVERTED' && (
                      <button
                        type="button"
                        onClick={() => handlePatchStatus(lead.id, 'ARCHIVED')}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </section>
      )}

      {!jobId && !isRunning && (
        <div className="text-sm text-gray-500 py-6">Configure platforms and regions, then run social listening to see qualified leads.</div>
      )}
      {(jobStatus === 'COMPLETED' || jobStatus === 'COMPLETED_WITH_WARNINGS') && results.length === 0 && totalFound >= 0 && (
        <div className="text-sm text-gray-500 py-4">No qualified leads in this run. Try different keywords or regions.</div>
      )}
    </div>
  );
}
