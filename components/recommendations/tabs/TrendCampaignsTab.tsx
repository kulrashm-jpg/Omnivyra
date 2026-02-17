import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useOpportunities } from './useOpportunities';
import type { OpportunityTabProps, OpportunityWithPayload } from './types';
import { payloadHelpers } from './types';
import EngineContextPanel from '../EngineContextPanel';
import UnifiedContextModeSelector, { type ContextMode, type FocusModule } from '../engine-framework/UnifiedContextModeSelector';
import StrategicAspectSelector from '../engine-framework/StrategicAspectSelector';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';
import { useEngineJobPolling } from '../../../hooks/useEngineJobPolling';
import OfferingFacetSelector from '../engine-framework/OfferingFacetSelector';
import StrategicConsole from '../engine-framework/StrategicConsole';

const TYPE = 'TREND';

export type ClusterInput = {
  problem_domain: string;
  signal_count: number;
  avg_intent_score: number;
  avg_urgency_score: number;
  priority_score: number;
};

const TREND_CLUSTER_PAYLOAD_BRIDGE = 'trend_cluster_payload_bridge';
const PULSE_TOPIC_BRIDGE = 'pulse_topic_bridge';

export type PulseTopicBridge = {
  topic: string;
  regions: string[];
  narrative_phase: string | null;
  momentum_score: number | null;
};

function safeParseClusterPayload(raw: string): { cluster_inputs?: ClusterInput[]; context_mode?: string } | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { cluster_inputs?: unknown }).cluster_inputs)) {
      return parsed as { cluster_inputs: ClusterInput[]; context_mode?: string };
    }
    return null;
  } catch {
    return null;
  }
}

/** Payload sent to backend and stored for attribution (matches API shape). */
export type StrategicPayload = {
  context_mode: string;
  company_context: Record<string, unknown>;
  selected_offerings: string[];
  selected_aspect: string | null;
  strategic_text: string;
  regions?: string[];
  cluster_inputs?: ClusterInput[];
  focused_modules?: string[];
  additional_direction?: string;
};

const ISO_COUNTRIES = [
  { name: 'India', code: 'IN' },
  { name: 'United States', code: 'US' },
  { name: 'United Kingdom', code: 'GB' },
  { name: 'Germany', code: 'DE' },
  { name: 'France', code: 'FR' },
  { name: 'Canada', code: 'CA' },
  { name: 'Australia', code: 'AU' },
  { name: 'Singapore', code: 'SG' },
  { name: 'UAE', code: 'AE' },
  { name: 'Japan', code: 'JP' },
];

/** Derive placeholder sub-angles from summary text (comma/semicolon split or single line). */
function deriveSubAngles(summary: string | null): string[] {
  if (!summary || !summary.trim()) return ['Strategic angle 1', 'Strategic angle 2'];
  const parts = summary.split(/[,;]|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 4);
  return [summary, 'Related angle', 'Supporting angle'];
}

/** Mock personas for expansion (no backend). */
const MOCK_PERSONAS = ['Decision makers', 'Influencers', 'Primary segment'];

/** Mock messaging hooks for expansion (no backend). */
function deriveMessagingHooks(title: string, summary: string | null): string[] {
  const base = title || 'Theme';
  return [
    `Why ${base} matters now`,
    `Key benefit for your audience`,
    summary ? `Tie-in: ${summary.slice(0, 60)}${summary.length > 60 ? '…' : ''}` : 'Clear call-to-action',
  ];
}

type ThemeCardOpportunity = OpportunityWithPayload & { isCustom?: boolean; suggestedAudience?: string; messagingHooks?: string };

function ThemeCard({
  opportunity,
  onPromote,
  onArchive,
  onMarkPossibility,
  onActionComplete,
  lastStrategicPayload,
  isSelected,
  onToggleSelect,
}: {
  opportunity: ThemeCardOpportunity;
  onPromote: (id: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onMarkPossibility: (id: string) => Promise<void>;
  onActionComplete?: () => void;
  lastStrategicPayload: StrategicPayload | null;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const isCustom = !!(opportunity as ThemeCardOpportunity).isCustom;
  const customAudience = (opportunity as ThemeCardOpportunity).suggestedAudience;
  const customHooks = (opportunity as ThemeCardOpportunity).messagingHooks;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onActionComplete?.();
    } finally {
      setBusy(false);
    }
  };

  const themeTitle = opportunity.title || 'Strategic theme';
  const strategicAngle = opportunity.summary || '—';
  const reachEstimate = payloadHelpers.reachEstimate(opportunity.payload);
  const formats = payloadHelpers.formats(opportunity.payload);
  const suggestedFormats = formats.length ? formats.join(', ') : '—';

  const subAngles = deriveSubAngles(opportunity.summary);
  const personas = customAudience ? customAudience.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : MOCK_PERSONAS;
  const messagingHooksList = customHooks ? customHooks.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : deriveMessagingHooks(opportunity.title || '', opportunity.summary);

  const contextModeLabel =
    lastStrategicPayload?.context_mode === 'FULL'
      ? 'Full Context'
      : lastStrategicPayload?.context_mode === 'FOCUSED'
        ? 'Focused Context'
        : lastStrategicPayload?.context_mode === 'NONE'
          ? 'No Context'
          : lastStrategicPayload?.context_mode ?? null;
  const modeBadge = contextModeLabel ? (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-800">
      {contextModeLabel}
    </span>
  ) : null;

  return (
    <div
      className={`rounded-xl p-6 shadow-sm transition-all ${
        isSelected
          ? 'border-2 border-indigo-600 bg-indigo-50/80 ring-2 ring-indigo-200'
          : 'border border-gray-200 bg-white hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onToggleSelect}
          className="text-left flex-1 min-w-0"
        >
          <h3 className="text-lg font-semibold text-gray-900">{themeTitle}</h3>
        </button>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {lastStrategicPayload?.cluster_inputs && lastStrategicPayload.cluster_inputs.length > 0 && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800">
              Cluster-Driven Theme
            </span>
          )}
          {isCustom && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-700">
              Custom Pillar
            </span>
          )}
          {modeBadge}
        </div>
      </div>
      <p className="mt-2 text-sm text-gray-700 leading-relaxed">{strategicAngle}</p>
      <dl className="mt-4 space-y-2 text-sm text-gray-600">
        <div>
          <span className="text-gray-500 font-medium">Estimated reach:</span>{' '}
          <span className="text-gray-800">{reachEstimate}</span>
        </div>
        <div>
          <span className="text-gray-500 font-medium">Suggested formats:</span>{' '}
          <span className="text-gray-800">{suggestedFormats}</span>
        </div>
      </dl>
      <div className="mt-5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded((e) => !e); }}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-indigo-600 text-indigo-600 hover:bg-indigo-50"
        >
          {expanded ? 'Collapse' : 'Expand Theme Strategy'}
        </button>
      </div>

      {expanded && (
        <div className="mt-6 pt-6 border-t border-gray-200 space-y-6">
          {lastStrategicPayload && (
            <div className="mt-4 p-3 rounded-lg bg-gray-100 border border-gray-200 text-xs text-gray-600">
              <div className="font-medium text-gray-700 mb-1">Generated Based On</div>
              <div>Context: {lastStrategicPayload.context_mode}</div>
              <div>Aspect: {lastStrategicPayload.selected_aspect || '—'}</div>
              <div>Facets: {lastStrategicPayload.selected_offerings?.length ? lastStrategicPayload.selected_offerings.map((f: string) => f.split(':').slice(1).join(':') || f).join(', ') : '—'}</div>
              <div>Strategic Input: {lastStrategicPayload.strategic_text ? (lastStrategicPayload.strategic_text.slice(0, 120) + (lastStrategicPayload.strategic_text.length > 120 ? '…' : '')) : 'None'}</div>
              {lastStrategicPayload.regions?.length ? <div>Regions: {lastStrategicPayload.regions.join(', ')}</div> : null}
            </div>
          )}
          {isCustom && !lastStrategicPayload && (
            <div className="mt-4 p-3 rounded-lg bg-gray-100 border border-gray-200 text-xs text-gray-600">
              Custom pillar — not generated from engine.
            </div>
          )}
          <div>
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Sub-angles</h4>
            <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
              {subAngles.map((angle, i) => (
                <li key={i}>{angle}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Suggested audience personas</h4>
            <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
              {personas.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-800 mb-2">Suggested messaging hooks</h4>
            <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
              {messagingHooksList.map((hook, i) => (
                <li key={i}>{hook}</li>
              ))}
            </ul>
          </div>
          {!isCustom && (
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => run(() => onPromote(opportunity.id))}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white disabled:opacity-50"
              >
                Build Campaign Blueprint
              </button>
              <button
                type="button"
                onClick={() => run(() => onMarkPossibility(opportunity.id))}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50"
              >
                Mark as Long-Term Possibility
              </button>
              <button
                type="button"
                onClick={() => run(() => onArchive(opportunity.id))}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 disabled:opacity-50"
              >
                Archive Theme
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TrendCampaignsTab(props: OpportunityTabProps) {
  const { companyId, regions, onPromote, onAction, fetchWithAuth } = props;
  const router = useRouter();
  const { opportunities, loading, error, hasRun, refetchGetOnly } = useOpportunities(
    companyId,
    TYPE,
    fetchWithAuth,
    { getRegions: () => regions ?? null }
  );
  const [contextMode, setContextMode] = useState<ContextMode>('FULL');
  const [focusedModules, setFocusedModules] = useState<FocusModule[]>([]);
  const [additionalDirection, setAdditionalDirection] = useState('');
  const [clusterInputs, setClusterInputs] = useState<ClusterInput[] | undefined>(undefined);
  const [selectedAspect, setSelectedAspect] = useState<string | null>(null);
  const [selectedFacets, setSelectedFacets] = useState<string[]>([]);
  const [strategicText, setStrategicText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [lastStrategicPayload, setLastStrategicPayload] = useState<StrategicPayload | null>(null);
  const [selectedThemeIds, setSelectedThemeIds] = useState<string[]>([]);
  const [customPillars, setCustomPillars] = useState<ThemeCardOpportunity[]>([]);
  const [showAddCustomForm, setShowAddCustomForm] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customAngle, setCustomAngle] = useState('');
  const [customAudience, setCustomAudience] = useState('');
  const [customHooks, setCustomHooks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [regionInput, setRegionInput] = useState('');
  const [regionWarning, setRegionWarning] = useState<string | null>(null);
  const [countrySearch, setCountrySearch] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<'idle' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED'>('idle');
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobRegionCount, setJobRegionCount] = useState(0);
  const [consolidatedResult, setConsolidatedResult] = useState<{
    global_opportunities: { title: string; summary?: string; rationale?: string; regions?: string[] }[];
    region_specific_insights: Record<string, { cultural_considerations: string; competitive_pressure: string }>;
    execution_priority_order: string[];
    consolidated_risks: string[];
    strategic_summary: string;
    confidence_index?: number;
  } | null>(null);
  // Job history (strategic memory): last 5 runs. Future: diffing when same pillars+regions re-run; optional per-company daily call budget at scale.
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [jobHistory, setJobHistory] = useState<{ jobId: string; status: string; regions: string[]; confidence_index: number | null; created_at: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const clusterBridgeConsumedRef = useRef(false);
  const pulseBridgeConsumedRef = useRef(false);

  const { job: polledJob } = useEngineJobPolling<{
    status?: string;
    progress_stage?: string | null;
    confidence_index?: number;
    consolidated_result?: {
      global_opportunities?: { title: string; summary?: string; rationale?: string; regions?: string[] }[];
      region_specific_insights?: Record<string, { cultural_considerations: string; competitive_pressure: string }>;
      execution_priority_order?: string[];
      consolidated_risks?: string[];
      strategic_summary?: string;
      confidence_index?: number;
    } | null;
    error?: string | null;
  }>(
    jobId,
    jobId ? `/api/recommendations/job/${jobId}` : null,
    fetchWithAuth,
    { enabled: !!jobId }
  );

  useEffect(() => {
    if (!polledJob) return;
    if (polledJob.status) setJobStatus(polledJob.status as typeof jobStatus);
    if (polledJob.status === 'COMPLETED' || polledJob.status === 'COMPLETED_WITH_WARNINGS') {
      const cr = polledJob.consolidated_result;
      setConsolidatedResult(
        cr
          ? {
              global_opportunities: cr.global_opportunities ?? [],
              region_specific_insights: cr.region_specific_insights ?? {},
              execution_priority_order: cr.execution_priority_order ?? [],
              consolidated_risks: cr.consolidated_risks ?? [],
              strategic_summary: cr.strategic_summary ?? '',
              confidence_index: cr.confidence_index,
            }
          : null
      );
    }
    if (polledJob.status === 'FAILED' && polledJob.error) {
      setJobError(polledJob.error);
    }
  }, [polledJob]);

  useEffect(() => {
    setValidationError(null);
  }, [contextMode, selectedAspect, selectedFacets, strategicText]);

  useEffect(() => {
    if (typeof window === 'undefined' || pulseBridgeConsumedRef.current) return;
    const raw = localStorage.getItem(PULSE_TOPIC_BRIDGE);
    if (!raw) return;
    pulseBridgeConsumedRef.current = true;
    try {
      const parsed = JSON.parse(raw) as PulseTopicBridge;
      if (!parsed?.topic) return;
      try {
        localStorage.removeItem(PULSE_TOPIC_BRIDGE);
      } catch {
        /* ignore */
      }
      const template = `Topic from Market Pulse: ${parsed.topic}
Narrative phase: ${parsed.narrative_phase ?? '—'}
Momentum score: ${parsed.momentum_score != null ? (parsed.momentum_score * 100).toFixed(0) + '%' : '—'}
Generate strategic campaign pillars to capture this opportunity.`;
      setStrategicText(template);
      if (Array.isArray(parsed.regions) && parsed.regions.length > 0) {
        setRegionInput(parsed.regions.join(', '));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || clusterBridgeConsumedRef.current) return;
    const queryRaw = typeof router.query?.cluster_payload === 'string' ? router.query.cluster_payload : null;
    const storageRaw = localStorage.getItem(TREND_CLUSTER_PAYLOAD_BRIDGE);
    const raw = queryRaw ?? storageRaw;
    if (!raw) return;
    clusterBridgeConsumedRef.current = true;
    const decoded = queryRaw ? (() => { try { return decodeURIComponent(queryRaw); } catch { return raw; } })() : raw;
    const parsed = safeParseClusterPayload(decoded);
    try { localStorage.removeItem(TREND_CLUSTER_PAYLOAD_BRIDGE); } catch { /* ignore */ }
    if (queryRaw && router.isReady) {
      const q = { ...router.query };
      delete q.cluster_payload;
      router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true });
    }
    if (!parsed || !Array.isArray(parsed.cluster_inputs) || parsed.cluster_inputs.length === 0) return;
    const inputs = parsed.cluster_inputs;
    setClusterInputs(inputs);
    setContextMode('NONE');
    const first = inputs[0];
    const template = `Emerging demand detected in: ${first.problem_domain}
Intent intensity: ${first.avg_intent_score}
Urgency level: ${first.avg_urgency_score}
Signal count: ${first.signal_count}
Priority index: ${first.priority_score}

Generate strategic campaign pillars to capture this demand.`;
    setStrategicText(template);
  }, [router.query?.cluster_payload, router.isReady]);

  useEffect(() => {
    if (!historyDrawerOpen || !companyId) return;
    setHistoryLoading(true);
    fetchWithAuth(`/api/recommendations/job/history?companyId=${encodeURIComponent(companyId)}&limit=5`)
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((data) => setJobHistory(Array.isArray(data?.jobs) ? data.jobs : []))
      .catch(() => setJobHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [historyDrawerOpen, companyId, fetchWithAuth]);

  const handleViewIntelligence = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/recommendations/job/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setConsolidatedResult(data.consolidated_result ?? null);
      setHistoryDrawerOpen(false);
    } catch {
      // ignore
    }
  };

  const fetchProfile = async (): Promise<Record<string, unknown> | null> => {
    if (!companyId) return null;
    const res = await fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(companyId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.profile ?? null;
  };

  const buildStrategicPayload = async (): Promise<StrategicPayload> => {
    const profile = await fetchProfile();
    const companyContext: Record<string, unknown> = {};

    if (contextMode === 'FULL' && profile) {
      companyContext.brand_voice = profile.brand_voice;
      companyContext.icp = profile.ideal_customer_profile;
      companyContext.positioning = profile.brand_positioning;
      companyContext.themes = profile.content_themes;
      companyContext.geography = profile.geography;
    }

    const regions = regionInput
      .split(',')
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);

    return {
      context_mode: contextMode,
      company_context: companyContext,
      selected_offerings: selectedFacets,
      selected_aspect: selectedAspect,
      strategic_text: strategicText,
      regions: regions.length > 0 ? regions : undefined,
      cluster_inputs: clusterInputs?.length ? clusterInputs : undefined,
      focused_modules: contextMode === 'FOCUSED' && focusedModules.length > 0 ? focusedModules : undefined,
      additional_direction: additionalDirection.trim() || undefined,
    };
  };

  const isValid = (): boolean => {
    if (contextMode !== 'NONE') return !!companyId;
    return !!(additionalDirection.trim() || selectedAspect || selectedFacets.length >= 1 || strategicText.trim() || (clusterInputs && clusterInputs.length > 0));
  };

  const handleRun = async () => {
    setValidationError(null);
    if (!companyId) {
      setValidationError('Select a company first.');
      return;
    }
    if (contextMode === 'NONE' && !additionalDirection.trim()) {
      setValidationError('Please provide research direction when using No Company Context.');
      return;
    }
    setIsSubmitting(true);
    setValidationError(null);
    try {
      const payload = await buildStrategicPayload();
      const postRes = await fetchWithAuth('/api/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, type: TYPE, strategicPayload: payload }),
      });
      if (!postRes.ok) {
        const err = await postRes.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to generate themes');
      }
      setLastStrategicPayload(payload);
      await refetchGetOnly();
    } catch (e) {
      setValidationError(e instanceof Error ? e.message : 'Failed to generate themes');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleThemeSelection = (id: string) => {
    setSelectedThemeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleAddCustomPillar = () => {
    if (!customTitle.trim()) return;
    const id = `custom-${Date.now()}`;
    setCustomPillars((prev) => [
      ...prev,
      {
        id,
        title: customTitle.trim(),
        summary: customAngle.trim() || null,
        problem_domain: null,
        region_tags: null,
        conversion_score: null,
        status: 'ACTIVE',
        scheduled_for: null,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        payload: {},
        isCustom: true,
        suggestedAudience: customAudience.trim() || undefined,
        messagingHooks: customHooks.trim() || undefined,
      },
    ]);
    setCustomTitle('');
    setCustomAngle('');
    setCustomAudience('');
    setCustomHooks('');
    setShowAddCustomForm(false);
  };

  const handleGenerateFromSelected = async () => {
    if (!companyId || selectedThemeIds.length === 0) return;
    setJobError(null);
    setConsolidatedResult(null);
    const payload = lastStrategicPayload ?? await buildStrategicPayload();
    const regions = regionInput
      .split(',')
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);
    const regionCount = regions.length > 0 ? regions.length : 1;
    const estimatedCalls = regionCount + 1;
    if (estimatedCalls > 8) {
      const confirmed = window.confirm(
        `This execution will run ${estimatedCalls} model calls. Continue?`
      );
      if (!confirmed) return;
    }
    try {
      const res = await fetchWithAuth('/api/recommendations/job/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          selectedPillars: selectedThemeIds,
          strategicPayload: payload,
          regions: regions.length > 0 ? regions : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to start recommendation job');
      }
      const data = await res.json();
      setJobId(data.jobId);
      setJobStatus(data.status ?? 'PENDING');
      setJobRegionCount(regions.length > 0 ? regions.length : 1);
    } catch (e) {
      setJobError(e instanceof Error ? e.message : 'Failed to start job');
    }
  };

  const modeIndicatorLabel =
    contextMode === 'FULL'
      ? 'Themes aligned to full company context (brand, ICP, positioning, themes, geography).'
      : contextMode === 'FOCUSED'
        ? `Themes aligned to selected modules: ${focusedModules.length > 0 ? focusedModules.join(', ') : 'none selected'}.`
        : 'No company context; use research direction only.';

  const intentSummaryContent = (): { type: 'summary' | 'warning'; text: React.ReactNode } => {
    if (contextMode === 'NONE') {
      if (!additionalDirection.trim())
        return { type: 'warning', text: 'Please provide research direction when using No Company Context.' };
      const parts: React.ReactNode[] = [];
      if (additionalDirection.trim()) parts.push(<>• Research direction: &quot;{additionalDirection.slice(0, 80)}{additionalDirection.length > 80 ? '…' : ''}&quot;</>);
      if (selectedAspect) parts.push(<>• Aspect: {selectedAspect}</>);
      if (selectedFacets.length > 0) parts.push(<>• Offerings: {selectedFacets.map((id) => id.split(':').slice(1).join(':') || id).join(', ')}</>);
      if (strategicText.trim()) parts.push(<>• Strategic text: &quot;{strategicText.slice(0, 60)}…&quot;</>);
      const regionList = regionInput.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
      if (regionList.length) parts.push(<>• Regions: {regionList.join(', ')}</>);
      return { type: 'summary', text: <>No company context:<div className="mt-1 space-y-0.5">{parts}</div></> };
    }
    const list = selectedFacets.length ? selectedFacets.map((id) => id.split(':').slice(1).join(':') || id).slice(0, 5) : [];
    const lines: React.ReactNode[] = [<>Context: {contextMode}</>];
    if (list.length) lines.push(<>• Offerings: {list.join(', ')}</>);
    if (selectedAspect) lines.push(<>• Aspect: {selectedAspect}</>);
    if (strategicText.trim()) lines.push(<>• Direction: &quot;{strategicText.slice(0, 80)}…&quot;</>);
    const regionList = regionInput.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
    if (regionList.length) lines.push(<>• Regions: {regionList.join(', ')}</>);
    return { type: 'summary', text: <div className="space-y-0.5">{lines}</div> };
  };

  const intentSummary = intentSummaryContent();

  const handleArchive = async (id: string) => {
    await onAction(id, 'DISMISSED');
  };
  const handleMarkPossibility = async (id: string) => {
    await onAction(id, 'REVIEWED');
  };

  const wrappedOnPromote = async (id: string) => {
    try {
      await onPromote(id);
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      if (err?.status === 404) {
        await refetchGetOnly(); // clear stale opportunity from list
      }
      throw e;
    }
  };

  if (!companyId) {
    return (
      <div className="text-sm text-gray-500 py-4">Select a company to view strategic themes.</div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Strategic Theme Builder</h2>
          <p className="mt-1 text-sm text-gray-600">
            Build scalable campaign pillars around high-impact themes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setHistoryDrawerOpen(true)}
          className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Job History
        </button>
      </header>
      <div className="rounded-lg border border-gray-200 p-4">
        <EngineContextPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
      </div>
      <UnifiedContextModeSelector
        mode={contextMode}
        modules={focusedModules}
        additionalDirection={additionalDirection}
        onModeChange={setContextMode}
        onModulesChange={setFocusedModules}
        onAdditionalDirectionChange={setAdditionalDirection}
        requireDirectionWhenNone={true}
      />
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-700">
        {modeIndicatorLabel}
      </div>
      <StrategicAspectSelector selectedAspect={selectedAspect} onChange={setSelectedAspect} />
      <OfferingFacetSelector
        companyId={companyId}
        fetchWithAuth={fetchWithAuth}
        selectedFacets={selectedFacets}
        onChange={setSelectedFacets}
        mode={contextMode}
      />
      <StrategicConsole
        value={strategicText}
        onChange={setStrategicText}
        mode={contextMode}
      />
      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Geographic Targeting (Optional)</h3>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Target Regions (ISO country codes, comma separated)</label>
          <input
            type="text"
            value={regionInput}
            onChange={(e) => {
              setRegionInput(e.target.value);
              const parts = e.target.value.split(',').map((r) => r.trim()).filter(Boolean);
              const invalid = parts.filter((p) => p.length !== 2);
              setRegionWarning(invalid.length > 0 ? 'Some codes are not 2-letter ISO codes; generation will still run.' : null);
            }}
            placeholder="IN,US,GB"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Use 2-letter ISO country codes. Example: IN (India), US (United States), GB (United Kingdom).
            Leave empty to use company default geography.
          </p>
          {regionWarning && <p className="mt-1 text-xs text-red-600">{regionWarning}</p>}
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Find Country Code</label>
          <input
            type="text"
            value={countrySearch}
            onChange={(e) => setCountrySearch(e.target.value)}
            placeholder="Type country name..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
          />
          {countrySearch.trim() && (
            <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-auto">
              {ISO_COUNTRIES.filter(
                (c) => c.name.toLowerCase().includes(countrySearch.trim().toLowerCase())
              ).map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => {
                      const current = regionInput.split(',').map((r) => r.trim()).filter(Boolean);
                      const next = current.includes(c.code) ? current : [...current, c.code];
                      setRegionInput(next.join(', '));
                      setCountrySearch('');
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    {c.name} ({c.code})
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Strategic Intent Summary</h3>
        {intentSummary.type === 'warning' ? (
          <p className="text-sm text-amber-700">{intentSummary.text}</p>
        ) : (
          <div className="text-sm text-gray-700">{intentSummary.text}</div>
        )}
      </div>
      <div>
        <button
          type="button"
          onClick={handleRun}
          disabled={loading || isSubmitting}
          className="px-6 py-3 text-base font-medium rounded-lg bg-indigo-600 text-white disabled:opacity-50"
        >
          {loading || isSubmitting ? 'Generating…' : 'Generate Strategic Themes'}
        </button>
      </div>
      {validationError && <div className="text-sm text-red-600">{validationError}</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!hasRun && !loading && (
        <div className="flex justify-center py-12">
          <div className="max-w-md rounded-lg border border-gray-200 bg-gray-50/80 p-6 text-center text-sm text-gray-700">
            No strategic themes generated yet. Click &quot;Generate Strategic Themes&quot; to build campaign pillars aligned with your company direction.
          </div>
        </div>
      )}
      {hasRun && !loading && (
        <>
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setShowAddCustomForm((v) => !v)}
              className="self-start px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              + Add Custom Pillar
            </button>
            {showAddCustomForm && (
              <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-4 space-y-3">
                <h4 className="text-sm font-semibold text-gray-800">New custom pillar</h4>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Pillar Title</label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="e.g. Sustainability Leadership"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Strategic Angle</label>
                  <textarea
                    value={customAngle}
                    onChange={(e) => setCustomAngle(e.target.value)}
                    placeholder="Brief angle or narrative"
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Suggested Audience (optional)</label>
                  <input
                    type="text"
                    value={customAudience}
                    onChange={(e) => setCustomAudience(e.target.value)}
                    placeholder="e.g. Decision makers, Influencers"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Messaging Hooks (optional)</label>
                  <input
                    type="text"
                    value={customHooks}
                    onChange={(e) => setCustomHooks(e.target.value)}
                    placeholder="Comma-separated hooks"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddCustomPillar}
                    disabled={!customTitle.trim()}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddCustomForm(false)}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(() => {
              const combined = [...opportunities, ...customPillars];
              const clusterInputs = lastStrategicPayload?.cluster_inputs;
              if (!clusterInputs || clusterInputs.length === 0) {
                return combined.map((opp) => (
                  <ThemeCard
                    key={opp.id}
                    opportunity={opp}
                    onPromote={wrappedOnPromote}
                    onArchive={handleArchive}
                    onMarkPossibility={handleMarkPossibility}
                    onActionComplete={refetchGetOnly}
                    lastStrategicPayload={lastStrategicPayload}
                    isSelected={selectedThemeIds.includes(opp.id)}
                    onToggleSelect={() => toggleThemeSelection(opp.id)}
                  />
                ));
              }
              const keywords = clusterInputs.flatMap((c) =>
                (c.problem_domain || '').split(/\s+/).filter((w) => w.length >= 3).map((w) => w.toLowerCase())
              );
              const score = (opp: ThemeCardOpportunity) => {
                const text = `${opp.title || ''} ${opp.summary || ''}`.toLowerCase();
                return keywords.filter((kw) => text.includes(kw)).length;
              };
              const sorted = [...combined].sort((a, b) => score(b) - score(a));
              return sorted.map((opp) => (
                <ThemeCard
                  key={opp.id}
                  opportunity={opp}
                  onPromote={wrappedOnPromote}
                  onArchive={handleArchive}
                  onMarkPossibility={handleMarkPossibility}
                  onActionComplete={refetchGetOnly}
                  lastStrategicPayload={lastStrategicPayload}
                  isSelected={selectedThemeIds.includes(opp.id)}
                  onToggleSelect={() => toggleThemeSelection(opp.id)}
                />
              ));
            })()}
          </div>
          {opportunities.length === 0 && customPillars.length === 0 && (
            <div className="text-sm text-gray-500 py-6 text-center">
              No strategic themes generated. Try adjusting your direction and generate again.
            </div>
          )}
          {selectedThemeIds.length > 0 && (
            <div className="sticky bottom-4 left-0 right-0 flex items-center justify-between gap-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 shadow-md">
              <span className="text-sm font-medium text-indigo-900">
                {jobStatus === 'PENDING' || jobStatus === 'RUNNING'
                  ? (jobRegionCount > 5 ? `Processing ${jobRegionCount} regions. This may take a moment.` : 'Processing…')
                  : `${selectedThemeIds.length} Strategic Pillar${selectedThemeIds.length !== 1 ? 's' : ''} Selected`}
              </span>
              <button
                type="button"
                onClick={handleGenerateFromSelected}
                disabled={jobStatus === 'PENDING' || jobStatus === 'RUNNING'}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Generate Recommendations from Selected Pillars
              </button>
            </div>
          )}
          {jobId && (
            <EngineJobStatusPanel
              status={jobStatus}
              progressStage={polledJob?.progress_stage}
              confidenceIndex={polledJob?.consolidated_result?.confidence_index ?? polledJob?.confidence_index}
              error={polledJob?.error ?? jobError}
            />
          )}
          {consolidatedResult && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <h3 className="text-lg font-semibold text-gray-900 px-6 py-4 border-b border-gray-100 bg-gray-50">
                Global Strategic Intelligence
              </h3>
              <div className="p-6 space-y-6">
                {typeof consolidatedResult.confidence_index === 'number' && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-1">Global Confidence</h4>
                    <p
                      className={`text-lg font-medium ${
                        consolidatedResult.confidence_index > 75
                          ? 'text-green-600'
                          : consolidatedResult.confidence_index >= 50
                            ? 'text-yellow-600'
                            : 'text-red-600'
                      }`}
                    >
                      {consolidatedResult.confidence_index}%
                    </p>
                  </section>
                )}
                <section>
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">Executive Summary</h4>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{consolidatedResult.strategic_summary}</p>
                </section>
                <section>
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">Global Opportunities</h4>
                  <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                    {consolidatedResult.global_opportunities?.length
                      ? consolidatedResult.global_opportunities.map((o, i) => (
                          <li key={i}>
                            <strong>{o.title}</strong>
                            {o.regions?.length ? ` (${o.regions.join(', ')})` : ''}
                            {o.summary ? ` — ${o.summary}` : ''}
                          </li>
                        ))
                      : <li>None identified</li>}
                  </ul>
                </section>
                {Object.keys(consolidatedResult.region_specific_insights ?? {}).length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">Region Comparison</h4>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm text-gray-700">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-2 pr-4 font-medium">Region</th>
                            <th className="text-left py-2 pr-4 font-medium">Cultural considerations</th>
                            <th className="text-left py-2 font-medium">Competitive pressure</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(consolidatedResult.region_specific_insights).map(([region, insight]) => (
                            <tr key={region} className="border-b border-gray-100">
                              <td className="py-2 pr-4 font-medium">{region}</td>
                              <td className="py-2 pr-4">{insight.cultural_considerations || '—'}</td>
                              <td className="py-2">{insight.competitive_pressure || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                {consolidatedResult.consolidated_risks?.length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">Risk Alerts</h4>
                    <ul className="list-disc list-inside text-sm text-amber-800 space-y-0.5">
                      {consolidatedResult.consolidated_risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {consolidatedResult.execution_priority_order?.length > 0 && (
                  <section>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">Execution Priority Ranking</h4>
                    <p className="text-sm text-gray-700">
                      {consolidatedResult.execution_priority_order.join(' → ')}
                    </p>
                  </section>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {loading && (
        <div className="text-sm text-gray-500 py-6 text-center">Generating strategic themes…</div>
      )}

      {historyDrawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            aria-hidden
            onClick={() => setHistoryDrawerOpen(false)}
          />
          <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Strategic Memory — Last 5 runs</h3>
              <button
                type="button"
                onClick={() => setHistoryDrawerOpen(false)}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {historyLoading ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : jobHistory.length === 0 ? (
                <p className="text-sm text-gray-500">No past runs yet. Generate recommendations to build history.</p>
              ) : (
                <ul className="space-y-3">
                  {jobHistory.map((job) => (
                    <li
                      key={job.jobId}
                      className="rounded-lg border border-gray-200 p-3 bg-gray-50/50"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${
                            job.status === 'COMPLETED' || job.status === 'COMPLETED_WITH_WARNINGS'
                              ? 'bg-green-100 text-green-800'
                              : job.status === 'FAILED'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-200 text-gray-700'
                          }`}
                        >
                          {job.status}
                        </span>
                        {typeof job.confidence_index === 'number' && (
                          <span className="text-xs text-gray-600">
                            Confidence: {job.confidence_index}%
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mb-1">
                        {new Date(job.created_at).toLocaleString()}
                      </p>
                      {job.regions?.length > 0 && (
                        <p className="text-xs text-gray-600 mb-2">
                          Regions: {job.regions.join(', ')}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => handleViewIntelligence(job.jobId)}
                        disabled={job.status === 'PENDING' || job.status === 'RUNNING'}
                        className="w-full mt-1 px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        View Intelligence
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
