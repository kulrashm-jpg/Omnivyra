import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { CheckCircle } from 'lucide-react';
import type { OpportunityTabProps } from './types';
import EngineContextPanel from '../EngineContextPanel';
import EngineOverridePanel from '../EngineOverridePanel';
import UnifiedContextModeSelector, { type ContextMode, type FocusModule } from '../engine-framework/UnifiedContextModeSelector';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';
import { useEngineJobPolling } from '../../../hooks/useEngineJobPolling';
import EmptyState from '../../shared/EmptyState';
import ExamplePreview from '../../shared/ExamplePreview';
import { trackActivationEvent } from '../../../lib/analytics/activationEvents';

const PLATFORM_LABELS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'twitter', label: 'X' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'linkedin', label: 'LinkedIn' },
] as const;

const PLATFORM_LABEL_MAP = new Map<string, string>(PLATFORM_LABELS.map((item) => [item.id, item.label]));

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

type ActiveLeadsContextResponse = {
  companyId: string;
  platforms: Array<{
    id: string;
    label: string;
    availability?: 'connected' | 'public';
    recommended?: boolean;
    recommendation_reason?: string | null;
  }>;
  publicSourceGroups?: Array<{
    id: string;
    label: string;
    description: string;
    source_ids: string[];
    recommended: boolean;
  }>;
  recommendationSummary?: {
    headline: string;
    body: string;
    highlights: string[];
  } | null;
  integrationReadiness?: {
    headline: string;
    body: string;
    status: 'strong' | 'partial' | 'limited';
    highlights: string[];
  } | null;
  communities: Array<{ id: string; label: string }>;
  externalApis: Array<{ id: string; label: string; provider_key: string; category: string; is_paid: boolean }>;
};

type ListeningSourceOption = {
  id: string;
  label: string;
  availability?: 'connected' | 'public';
  recommended?: boolean;
  recommendation_reason?: string | null;
};

type PublicSourceGroup = {
  id: string;
  label: string;
  description: string;
  sources: ListeningSourceOption[];
  recommended: boolean;
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
  const [availablePlatforms, setAvailablePlatforms] = useState<Array<{
    id: string;
    label: string;
    availability?: 'connected' | 'public';
    recommended?: boolean;
    recommendation_reason?: string | null;
  }>>([]);
  const [availableCommunities, setAvailableCommunities] = useState<Array<{ id: string; label: string }>>([]);
  const [availableExternalApis, setAvailableExternalApis] = useState<ActiveLeadsContextResponse['externalApis']>([]);
  const [selectedExternalApis, setSelectedExternalApis] = useState<string[]>([]);
  const [selectedCommunities, setSelectedCommunities] = useState<string[]>([]);
  const [activePublicGroup, setActivePublicGroup] = useState<string | null>(null);
  const [publicSourceGroups, setPublicSourceGroups] = useState<PublicSourceGroup[]>([]);
  const [recommendationSummary, setRecommendationSummary] = useState<ActiveLeadsContextResponse['recommendationSummary']>(null);
  const [integrationReadiness, setIntegrationReadiness] = useState<ActiveLeadsContextResponse['integrationReadiness']>(null);

  const fetchActiveLeadsContext = useCallback(async () => {
    if (!companyId || !fetchWithAuth) {
      setAvailablePlatforms([]);
      setAvailableCommunities([]);
      setAvailableExternalApis([]);
      return;
    }
    try {
      const res = await fetchWithAuth(`/api/active-leads/context?companyId=${encodeURIComponent(companyId)}`);
      if (!res.ok) {
        setAvailablePlatforms([]);
        setAvailableCommunities([]);
        setAvailableExternalApis([]);
        return;
      }
      const data = (await res.json()) as ActiveLeadsContextResponse;
      const normalizedPlatforms = Array.isArray(data.platforms) ? data.platforms : [];
      setAvailablePlatforms(normalizedPlatforms);
      setAvailableCommunities(Array.isArray(data.communities) ? data.communities : []);
      setAvailableExternalApis(Array.isArray(data.externalApis) ? data.externalApis : []);
      setRecommendationSummary(data.recommendationSummary ?? null);
      setIntegrationReadiness(data.integrationReadiness ?? null);
      const byId = new Map(normalizedPlatforms.map((platform) => [platform.id, platform]));
      const nextPublicGroups = Array.isArray(data.publicSourceGroups)
        ? data.publicSourceGroups
            .map((group) => ({
              id: group.id,
              label: group.label,
              description: group.description,
              recommended: group.recommended,
              sources: (Array.isArray(group.source_ids) ? group.source_ids : [])
                .map((id) => byId.get(id))
                .filter(Boolean) as ListeningSourceOption[],
            }))
            .filter((group) => group.sources.length > 0)
        : [];
      setPublicSourceGroups(nextPublicGroups);
    } catch {
      setAvailablePlatforms([]);
      setAvailableCommunities([]);
      setAvailableExternalApis([]);
      setPublicSourceGroups([]);
      setRecommendationSummary(null);
      setIntegrationReadiness(null);
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    fetchActiveLeadsContext();
  }, [fetchActiveLeadsContext]);

  useEffect(() => {
    if (platforms.length > 0 || availablePlatforms.length === 0) return;
    const recommendedPlatforms = availablePlatforms
      .filter((platform) => platform.recommended)
      .map((platform) => platform.id);
    if (recommendedPlatforms.length > 0) {
      setPlatforms(recommendedPlatforms);
    }
  }, [availablePlatforms, platforms.length]);

  const connectedPlatformOptions = availablePlatforms.filter((platform) => platform.availability === 'connected');
  const visiblePublicGroup =
    publicSourceGroups.find((group) => group.id === activePublicGroup) ??
    publicSourceGroups[0] ??
    null;

  useEffect(() => {
    if (publicSourceGroups.length === 0) {
      setActivePublicGroup(null);
      return;
    }
    if (activePublicGroup && publicSourceGroups.some((group) => group.id === activePublicGroup)) {
      return;
    }
    const nextGroup = publicSourceGroups.find((group) => group.recommended) ?? publicSourceGroups[0];
    setActivePublicGroup(nextGroup.id);
  }, [activePublicGroup, publicSourceGroups]);

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

  const toggleExternalApi = (id: string) => {
    setSelectedExternalApis((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleCommunity = (id: string) => {
    setSelectedCommunities((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
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
          external_api_connection_ids: selectedExternalApis,
          communities: selectedCommunities,
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
            <span className="block text-xs text-gray-500 mb-2">Listening sources</span>
            {availablePlatforms.some((platform) => platform.recommended) && (
              <div className="mb-3 text-xs text-gray-500">
                Recommended sources are prioritized from the company profile so the scan starts closer to the right buyer conversations.
              </div>
            )}
            {recommendationSummary && (
              <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
                <div className="text-sm font-medium text-emerald-800">{recommendationSummary.headline}</div>
                <div className="mt-1 text-xs leading-5 text-emerald-900/80">{recommendationSummary.body}</div>
                {Array.isArray(recommendationSummary.highlights) && recommendationSummary.highlights.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {recommendationSummary.highlights.map((highlight) => (
                      <span
                        key={highlight}
                        className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                      >
                        {highlight}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {integrationReadiness && (
              <div
                className={`mb-3 rounded-lg border p-3 ${
                  integrationReadiness.status === 'strong'
                    ? 'border-sky-100 bg-sky-50/50'
                    : integrationReadiness.status === 'partial'
                      ? 'border-amber-100 bg-amber-50/50'
                      : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="text-sm font-medium text-gray-800">{integrationReadiness.headline}</div>
                <div className="mt-1 text-xs leading-5 text-gray-600">{integrationReadiness.body}</div>
                {Array.isArray(integrationReadiness.highlights) && integrationReadiness.highlights.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {integrationReadiness.highlights.map((highlight) => (
                      <span
                        key={highlight}
                        className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600"
                      >
                        {highlight}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {publicSourceGroups.length > 0 && (
              <div className="space-y-3 rounded-lg border border-sky-100 bg-sky-50/40 p-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Public listening paths</div>
                  <div className="mt-1 text-xs leading-5 text-sky-800/80">
                    Pick the public discovery category that matches the business, then select the recommended sources under it. Access details stay handled in the background.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {publicSourceGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => setActivePublicGroup(group.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                        visiblePublicGroup?.id === group.id
                          ? 'border-sky-600 bg-sky-600 text-white'
                          : group.recommended
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-sky-200 bg-white text-sky-700'
                      }`}
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
                {visiblePublicGroup && (
                  <div className="space-y-3 rounded-lg border border-sky-100 bg-white p-3">
                    <div className="text-sm font-medium text-gray-800">{visiblePublicGroup.label}</div>
                    <div className="text-xs leading-5 text-gray-500">{visiblePublicGroup.description}</div>
                    <div className="flex flex-wrap gap-2">
                      {visiblePublicGroup.sources.map((source) => (
                        <button
                          key={source.id}
                          type="button"
                          onClick={() => togglePlatform(source.id)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                            platforms.includes(source.id)
                              ? 'border-sky-600 bg-sky-600 text-white'
                              : 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
                          }`}
                        >
                          {source.label || PLATFORM_LABEL_MAP.get(source.id) || source.id}
                        </button>
                      ))}
                    </div>
                    {visiblePublicGroup.sources.map((source) => (
                      source.recommendation_reason ? (
                        <div key={`${source.id}-reason`} className="text-xs leading-5 text-gray-500">
                          <span className="font-medium text-gray-700">{source.label}:</span> {source.recommendation_reason}
                        </div>
                      ) : null
                    ))}
                  </div>
                )}
              </div>
            )}
            {connectedPlatformOptions.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Connected sources</div>
                <div className="flex flex-wrap gap-3">
                  {connectedPlatformOptions.map((p) => (
                    <label key={p.id} className="flex max-w-sm items-start gap-2 cursor-pointer rounded-lg border border-gray-200 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={platforms.includes(p.id)}
                        onChange={() => togglePlatform(p.id)}
                        className="mt-1 rounded border-gray-300"
                      />
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-700">{p.label || PLATFORM_LABEL_MAP.get(p.id) || p.id}</span>
                          {p.recommended && (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                              Recommended
                            </span>
                          )}
                          <span title="Connected" aria-hidden>
                            <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                          </span>
                        </div>
                        {p.recommendation_reason && (
                          <div className="text-xs leading-5 text-gray-500">{p.recommendation_reason}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {availablePlatforms.length === 0 && (
              <div className="text-sm text-gray-500">No listening sources are available for Active Leads yet.</div>
            )}
          </div>
          <div>
            <span className="block text-xs text-gray-500 mb-2">Communities</span>
            <div className="flex flex-wrap gap-3">
              {availableCommunities.length === 0 ? (
                <div className="text-sm text-gray-500">No configured communities assigned to Active Leads yet.</div>
              ) : availableCommunities.map((community) => (
                <label key={community.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCommunities.includes(community.id)}
                    onChange={() => toggleCommunity(community.id)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">{community.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="block text-xs text-gray-500 mb-2">Assigned external APIs</span>
            <div className="flex flex-wrap gap-3">
              {availableExternalApis.length === 0 ? (
                <div className="text-sm text-gray-500">No external APIs assigned to Active Leads yet.</div>
              ) : availableExternalApis.map((api) => (
                <label key={api.id} className="flex items-center gap-2 cursor-pointer rounded-full border border-gray-200 px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={selectedExternalApis.includes(api.id)}
                    onChange={() => toggleExternalApi(api.id)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">{api.label}</span>
                  <span className="text-xs text-gray-400">{api.is_paid ? 'Paid' : 'Included'}</span>
                </label>
              ))}
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
            <EmptyState
              tone={results.length === 0 ? 'first-time' : 'no-results'}
              title={results.length === 0 ? 'Track your first interaction' : 'No results found'}
              description={
                results.length === 0
                  ? 'Run one listening pass to surface the first real conversations worth turning into leads.'
                  : `There are no leads in the ${funnelTab} stage right now. Switch stages or run another listening pass.`
              }
              primaryAction={{
                label: results.length === 0 ? 'Run social listening' : 'Show active leads',
                onClick: () => {
                  trackActivationEvent('empty_state_primary_clicked', {
                    accountId: companyId,
                    context: 'active_leads_tab',
                    meta: { funnelTab, listeningMode },
                  });
                  if (results.length === 0) {
                    runListening();
                    return;
                  }
                  setFunnelTab('Active');
                },
              }}
              secondaryAction={{
                label: 'Try with sample data',
                onClick: () => {
                  trackActivationEvent('sample_used', {
                    accountId: companyId,
                    context: 'active_leads_tab',
                  });
                  router.push('/engagement/leads?sample=1');
                },
              }}
              examplePreview={<ExamplePreview variant="engagement" />}
            />
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
