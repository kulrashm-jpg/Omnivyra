import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import { v4 as uuidv4 } from 'uuid';
import type { OpportunityTabProps } from './types';
import EngineContextPanel from '../EngineContextPanel';
import UnifiedContextModeSelector, { type ContextMode, type FocusModule } from '../engine-framework/UnifiedContextModeSelector';
import StrategicAspectSelector from '../engine-framework/StrategicAspectSelector';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';
import { useEngineJobPolling } from '../../../hooks/useEngineJobPolling';
import OfferingFacetSelector from '../engine-framework/OfferingFacetSelector';
import StrategicConsole from '../engine-framework/StrategicConsole';
import RecommendationBlueprintCard from '../cards/RecommendationBlueprintCard';
import AIGenerationProgress from '../../AIGenerationProgress';

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
  strategic_intents?: string[];
  regions?: string[];
  cluster_inputs?: ClusterInput[];
  focused_modules?: string[];
  additional_direction?: string;
};

const STRATEGIC_INTENT_OPTIONS = [
  'Brand awareness',
  'Network expansion',
  'Lead generation',
  'Authority positioning',
  'Engagement growth',
  'Product promotion',
] as const;

/** Country name → ISO 2-letter code for autocomplete and resolution. */
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
  { name: 'Indonesia', code: 'ID' },
  { name: 'Italy', code: 'IT' },
  { name: 'Spain', code: 'ES' },
  { name: 'Brazil', code: 'BR' },
  { name: 'Mexico', code: 'MX' },
  { name: 'Netherlands', code: 'NL' },
  { name: 'South Korea', code: 'KR' },
  { name: 'China', code: 'CN' },
  { name: 'Hong Kong', code: 'HK' },
  { name: 'Ireland', code: 'IE' },
  { name: 'New Zealand', code: 'NZ' },
  { name: 'South Africa', code: 'ZA' },
  { name: 'Sweden', code: 'SE' },
  { name: 'Norway', code: 'NO' },
  { name: 'Denmark', code: 'DK' },
  { name: 'Finland', code: 'FI' },
  { name: 'Poland', code: 'PL' },
  { name: 'Belgium', code: 'BE' },
  { name: 'Switzerland', code: 'CH' },
  { name: 'Austria', code: 'AT' },
  { name: 'Portugal', code: 'PT' },
  { name: 'Greece', code: 'GR' },
  { name: 'Turkey', code: 'TR' },
  { name: 'Israel', code: 'IL' },
  { name: 'Saudi Arabia', code: 'SA' },
  { name: 'Malaysia', code: 'MY' },
  { name: 'Thailand', code: 'TH' },
  { name: 'Philippines', code: 'PH' },
  { name: 'Vietnam', code: 'VN' },
  { name: 'Argentina', code: 'AR' },
  { name: 'Chile', code: 'CL' },
  { name: 'Colombia', code: 'CO' },
  { name: 'Egypt', code: 'EG' },
  { name: 'Nigeria', code: 'NG' },
  { name: 'Kenya', code: 'KE' },
  { name: 'Pakistan', code: 'PK' },
  { name: 'Bangladesh', code: 'BD' },
  { name: 'Sri Lanka', code: 'LK' },
  { name: 'Russia', code: 'RU' },
  { name: 'Ukraine', code: 'UA' },
  { name: 'Czech Republic', code: 'CZ' },
  { name: 'Romania', code: 'RO' },
  { name: 'Hungary', code: 'HU' },
];

function matchCountry(query: string, country: { name: string; code: string }): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    country.name.toLowerCase().includes(q) ||
    country.code.toLowerCase() === q
  );
}

/** Resolve a single token (code or country name) to ISO code. */
function tokenToIsoCode(token: string): string {
  const t = token.trim();
  if (t.length === 2) {
    const byCode = ISO_COUNTRIES.find((c) => c.code.toLowerCase() === t.toLowerCase());
    if (byCode) return byCode.code.toUpperCase();
  }
  const byName = ISO_COUNTRIES.find((c) => c.name.toLowerCase() === t.toLowerCase());
  if (byName) return byName.code.toUpperCase();
  const startsWith = ISO_COUNTRIES.find((c) => c.name.toLowerCase().startsWith(t.toLowerCase()));
  if (startsWith) return startsWith.code.toUpperCase();
  return t.toUpperCase();
}

/** Parse region input and return list of ISO codes (resolve country names to codes). */
function regionInputToIsoCodes(regionInput: string): string[] {
  const parts = regionInput.split(',').map((r) => r.trim()).filter(Boolean);
  return parts.map(tokenToIsoCode);
}

export default function TrendCampaignsTab(props: OpportunityTabProps) {
  const { companyId, regions, engineRecommendations, fetchWithAuth } = props;
  const router = useRouter();
  const [hasRun, setHasRun] = useState(false);
  const [contextMode, setContextMode] = useState<ContextMode>('FULL');
  const [focusedModules, setFocusedModules] = useState<FocusModule[]>([]);
  const [additionalDirection, setAdditionalDirection] = useState('');
  const [clusterInputs, setClusterInputs] = useState<ClusterInput[] | undefined>(undefined);
  const [selectedAspect, setSelectedAspect] = useState<string | null>(null);
  const [selectedFacets, setSelectedFacets] = useState<string[]>([]);
  const [strategicText, setStrategicText] = useState('');
  const [selectedStrategicIntents, setSelectedStrategicIntents] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [lastStrategicPayload, setLastStrategicPayload] = useState<StrategicPayload | null>(null);
  const [customPillars, setCustomPillars] = useState<Array<{ id: string; title: string; summary: string | null }>>([]);
  const [showAddCustomForm, setShowAddCustomForm] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customAngle, setCustomAngle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [regionInput, setRegionInput] = useState('');
  const [regionWarning, setRegionWarning] = useState<string | null>(null);
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
  const regionInputRef = useRef<HTMLInputElement>(null);
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const [generatedEngineRecommendations, setGeneratedEngineRecommendations] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [archivedEngineIds, setArchivedEngineIds] = useState<Set<string>>(new Set());
  const [longTermEngineIds, setLongTermEngineIds] = useState<Set<string>>(new Set());
  const engineRecommendationSource =
    generatedEngineRecommendations.length > 0 ? generatedEngineRecommendations : (engineRecommendations ?? []);
  const engineRecommendationCards = useMemo<Array<{ id: string; recommendation: Record<string, unknown> }>>(() => {
    if (!Array.isArray(engineRecommendationSource) || engineRecommendationSource.length === 0) return [];
    return engineRecommendationSource.map((raw, index) => {
      const rec = (raw ?? {}) as Record<string, unknown>;
      const topic = typeof rec.topic === 'string' ? rec.topic : '';
      const polishedTitle = typeof rec.polished_title === 'string' ? rec.polished_title : '';
      const idBase =
        (typeof rec.snapshot_hash === 'string' && rec.snapshot_hash) ||
        (typeof rec.id === 'string' && rec.id) ||
        `${topic || polishedTitle || 'rec'}-${index}`;
      return { id: `engine-${idBase}`, recommendation: rec };
    });
  }, [engineRecommendationSource]);
  const visibleEngineCards = useMemo(
    () => engineRecommendationCards.filter((c) => !archivedEngineIds.has(c.id)),
    [engineRecommendationCards, archivedEngineIds]
  );

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
  }, [contextMode, selectedAspect, selectedFacets, strategicText, selectedStrategicIntents]);

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

    const regions = regionInputToIsoCodes(regionInput);

    return {
      context_mode: contextMode,
      company_context: companyContext,
      selected_offerings: selectedFacets,
      selected_aspect: selectedAspect,
      strategic_text: strategicText,
      strategic_intents: selectedStrategicIntents.length > 0 ? selectedStrategicIntents : undefined,
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
      setLastStrategicPayload(payload);
      const regionList = regionInputToIsoCodes(regionInput);
      const objective =
        selectedStrategicIntents[0]?.toLowerCase().replace(/\s+/g, '_') || 'awareness';
      const recRes = await fetchWithAuth('/api/recommendations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          objective,
          durationWeeks: 12,
          ...(regionList.length > 0 ? { regions: regionList } : {}),
        }),
      });
      if (!recRes.ok) {
        const recErr = await recRes.json().catch(() => ({}));
        const base = recErr?.error || 'Recommendation engine request failed';
        const detail = recErr?.detail ? ` (${recErr.detail})` : '';
        throw new Error(`${base}${detail}`);
      }
      const recData = await recRes.json().catch(() => null);
      const trends = Array.isArray(recData?.trends_used) ? recData.trends_used : [];
      setGeneratedEngineRecommendations(trends as Array<Record<string, unknown>>);
      if (trends.length === 0) {
        setValidationError('Engine returned no recommendations for this input. Adjust context/objective and try again.');
      }
    } catch (e) {
      setValidationError(e instanceof Error ? e.message : 'Failed to generate themes');
    } finally {
      setHasRun(true);
      setIsSubmitting(false);
    }
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
      },
    ]);
    setCustomTitle('');
    setCustomAngle('');
    setShowAddCustomForm(false);
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
      if (selectedStrategicIntents.length > 0) parts.push(<>• Objectives: {selectedStrategicIntents.join(', ')}</>);
      if (strategicText.trim()) parts.push(<>• Strategic text: &quot;{strategicText.slice(0, 60)}…&quot;</>);
      const regionList = regionInputToIsoCodes(regionInput);
      if (regionList.length) parts.push(<>• Regions: {regionList.join(', ')}</>);
      return { type: 'summary', text: <>No company context:<div className="mt-1 space-y-0.5">{parts}</div></> };
    }
    const list = selectedFacets.length ? selectedFacets.map((id) => id.split(':').slice(1).join(':') || id).slice(0, 5) : [];
    const lines: React.ReactNode[] = [<>Context: {contextMode}</>];
    if (list.length) lines.push(<>• Offerings: {list.join(', ')}</>);
    if (selectedAspect) lines.push(<>• Aspect: {selectedAspect}</>);
    if (selectedStrategicIntents.length > 0) lines.push(<>• Objectives: {selectedStrategicIntents.join(', ')}</>);
    if (strategicText.trim()) lines.push(<>• Direction: &quot;{strategicText.slice(0, 80)}…&quot;</>);
    const regionList = regionInputToIsoCodes(regionInput);
    if (regionList.length) lines.push(<>• Regions: {regionList.join(', ')}</>);
    return { type: 'summary', text: <div className="space-y-0.5">{lines}</div> };
  };

  const intentSummary = intentSummaryContent();


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
        <EngineContextPanel
          companyId={companyId}
          fetchWithAuth={fetchWithAuth}
          contextMode={contextMode}
          focusedModules={focusedModules}
          additionalDirection={additionalDirection}
        />
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
      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Strategic Objectives</h3>
        <p className="text-xs text-gray-500">
          Select what this recommendation run should optimize for.
        </p>
        <div className="flex flex-wrap gap-2">
          {STRATEGIC_INTENT_OPTIONS.map((intent) => {
            const selected = selectedStrategicIntents.includes(intent);
            return (
              <button
                key={intent}
                type="button"
                onClick={() =>
                  setSelectedStrategicIntents((prev) =>
                    prev.includes(intent)
                      ? prev.filter((x) => x !== intent)
                      : [...prev, intent]
                  )
                }
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selected
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
                aria-pressed={selected}
              >
                {intent}
              </button>
            );
          })}
        </div>
      </div>
      <StrategicConsole
        value={strategicText}
        onChange={setStrategicText}
        mode={contextMode}
      />
      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Geographic Targeting (Optional)</h3>
        <div className="relative">
          <label className="block text-xs text-gray-500 mb-1">Target Regions (type country name or ISO code, comma separated)</label>
          <input
            ref={regionInputRef}
            type="text"
            value={regionInput}
            onChange={(e) => {
              setRegionInput(e.target.value);
              setRegionDropdownOpen(true);
              const parts = e.target.value.split(',').map((r) => r.trim()).filter(Boolean);
              const invalid = parts.filter((p) => p.length !== 2 && !ISO_COUNTRIES.some((c) => matchCountry(p, c)));
              setRegionWarning(invalid.length > 0 ? 'Some codes are not 2-letter ISO codes; generation will still run.' : null);
            }}
            onFocus={() => {
              const parts = regionInput.split(',').map((r) => r.trim()).filter(Boolean);
              const last = parts[parts.length - 1] ?? '';
              if (last.length >= 2 && ISO_COUNTRIES.some((c) => matchCountry(last, c))) setRegionDropdownOpen(true);
            }}
            onBlur={() => {
              setTimeout(() => setRegionDropdownOpen(false), 150);
            }}
            placeholder="e.g. India, US, Germany or IN, US, DE"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            autoComplete="off"
          />
          {regionDropdownOpen && (() => {
            const parts = regionInput.split(',').map((r) => r.trim()).filter(Boolean);
            const lastToken = (parts[parts.length - 1] ?? '').trim();
            const isAlreadyCode = lastToken.length === 2 && ISO_COUNTRIES.some((c) => c.code.toLowerCase() === lastToken.toLowerCase());
            const matches = lastToken.length >= 2 && !isAlreadyCode
              ? ISO_COUNTRIES.filter((c) => matchCountry(lastToken, c)).slice(0, 8)
              : [];
            if (matches.length === 0) return null;
            return (
              <ul
                className="absolute z-10 mt-1 w-full border border-gray-200 rounded-lg bg-white shadow-lg divide-y divide-gray-100 max-h-48 overflow-auto"
                role="listbox"
              >
                {matches.map((c) => (
                  <li key={c.code}>
                    <button
                      type="button"
                      role="option"
                      onClick={() => {
                        const prev = parts.slice(0, -1);
                        const next = [...prev, c.code];
                        setRegionInput(next.join(', '));
                        setRegionDropdownOpen(false);
                        setRegionWarning(null);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 text-gray-800"
                    >
                      {c.name} → <span className="font-medium text-indigo-600">{c.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
          <p className="mt-1 text-xs text-gray-500">
            Type a country name (e.g. India, United States) and pick from the list to get the ISO code, or enter codes directly (IN, US, GB). Leave empty to use company default geography.
          </p>
          {regionWarning && <p className="mt-1 text-xs text-red-600">{regionWarning}</p>}
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
          disabled={isSubmitting}
          className="px-6 py-3 text-base font-medium rounded-lg bg-indigo-600 text-white disabled:opacity-50"
        >
          {isSubmitting ? 'Generating…' : 'Generate Strategic Themes'}
        </button>
      </div>
      {validationError && <div className="text-sm text-red-600">{validationError}</div>}
      {!hasRun && !isSubmitting && (
        <div className="flex justify-center py-12">
          <div className="max-w-md rounded-lg border border-gray-200 bg-gray-50/80 p-6 text-center text-sm text-gray-700">
            No strategic themes generated yet. Click &quot;Generate Strategic Themes&quot; to build campaign pillars aligned with your company direction.
          </div>
        </div>
      )}
      {(hasRun || visibleEngineCards.length > 0) && !isSubmitting && (
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
            {visibleEngineCards.length > 0
              ? visibleEngineCards.map((card) => (
                  <RecommendationBlueprintCard
                    key={card.id}
                    recommendation={card.recommendation}
                    onBuildCampaignBlueprint={async () => {
                      if (!companyId) {
                        setValidationError('Select a company first.');
                        return;
                      }
                      setValidationError(null);
                      const recommendation = card.recommendation ?? {};
                      const title =
                        (typeof recommendation.polished_title === 'string'
                          ? recommendation.polished_title
                          : null) ??
                        (typeof recommendation.topic === 'string'
                          ? recommendation.topic
                          : 'Campaign');
                      const description =
                        (typeof recommendation.summary === 'string' && recommendation.summary.trim()
                          ? recommendation.summary
                          : null) ??
                        (typeof recommendation.narrative_direction === 'string' &&
                        recommendation.narrative_direction.trim()
                          ? recommendation.narrative_direction
                          : null) ??
                        undefined;

                      const contextPayload: Record<string, unknown> = {};
                      if (Array.isArray(recommendation.formats)) {
                        contextPayload.formats = recommendation.formats;
                      }
                      if (typeof recommendation.estimated_reach === 'number') {
                        contextPayload.reach_estimate = recommendation.estimated_reach;
                      } else if (typeof recommendation.volume === 'number') {
                        contextPayload.reach_estimate = recommendation.volume;
                      }

                      const regionsFromCard = Array.isArray(recommendation.regions)
                        ? recommendation.regions
                            .map((value) => String(value || '').trim().toUpperCase())
                            .filter(Boolean)
                        : [];
                      const sourceOpportunityId =
                        (typeof recommendation.id === 'string' && recommendation.id.trim()
                          ? recommendation.id
                          : null) ??
                        (typeof recommendation.snapshot_hash === 'string' &&
                        recommendation.snapshot_hash.trim()
                          ? recommendation.snapshot_hash
                          : null) ??
                        `recommendation:${card.id}`;
                      try {
                        const campaignId = uuidv4();
                        const response = await fetchWithAuth('/api/campaigns', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            id: campaignId,
                            companyId,
                            name: title,
                            description,
                            status: 'planning',
                            current_stage: 'planning',
                            build_mode: 'no_context',
                            source_opportunity_id: sourceOpportunityId,
                            recommendation_id:
                              typeof recommendation.id === 'string' ? recommendation.id : null,
                            target_regions: regionsFromCard.length > 0 ? regionsFromCard : undefined,
                            context_payload:
                              Object.keys(contextPayload).length > 0 ? contextPayload : undefined,
                            planning_context: {
                              context_mode: contextMode,
                              focused_modules:
                                contextMode === 'FOCUSED' && focusedModules.length > 0
                                  ? focusedModules
                                  : undefined,
                              additional_direction: additionalDirection.trim() || undefined,
                            },
                          }),
                        });
                        if (!response.ok) {
                          const err = await response.json().catch(() => ({}));
                          throw new Error(err?.error || 'Failed to create campaign');
                        }
                        const data = await response.json().catch(() => ({}));
                        const createdCampaignId =
                          data?.campaign?.id && typeof data.campaign.id === 'string'
                            ? data.campaign.id
                            : campaignId;
                        const qs = new URLSearchParams({
                          companyId,
                          fromRecommendation: '1',
                        });
                        if (typeof recommendation.id === 'string' && recommendation.id.trim()) {
                          qs.set('recommendationId', recommendation.id);
                        }
                        router.push(`/campaign-details/${createdCampaignId}?${qs.toString()}`);
                      } catch (error) {
                        setValidationError(
                          error instanceof Error
                            ? error.message
                            : 'Failed to open campaign pre-planning flow'
                        );
                      }
                    }}
                    onMarkLongTerm={() =>
                      setLongTermEngineIds((prev) => {
                        const next = new Set(prev);
                        next.add(card.id);
                        return next;
                      })
                    }
                    onArchive={() =>
                      setArchivedEngineIds((prev) => {
                        const next = new Set(prev);
                        next.add(card.id);
                        return next;
                      })
                    }
                  />
                ))
              : null}
          </div>
          {visibleEngineCards.length === 0 && (
            <div className="text-sm text-gray-500 py-6 text-center">
              No enriched recommendation cards available yet. Run the engine to load blueprint-ready cards.
            </div>
          )}
          {longTermEngineIds.size > 0 && (
            <div className="text-xs text-gray-500">
              Marked long-term: {longTermEngineIds.size}
            </div>
          )}
          {jobId && (
            <EngineJobStatusPanel
              createdAt={(polledJob as { created_at?: string } | null)?.created_at}
              durationHint="Typically 2–6 min depending on regions"
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
      {isSubmitting && (
        <div className="py-6">
          <AIGenerationProgress
            isActive={true}
            message="Generating strategic themes…"
            expectedSeconds={50}
          />
        </div>
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
