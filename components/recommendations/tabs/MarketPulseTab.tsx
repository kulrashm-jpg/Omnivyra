import React, { useState, useEffect } from 'react';
import type { OpportunityTabProps } from './types';
import EngineContextPanel from '../EngineContextPanel';
import EngineOverridePanel from '../EngineOverridePanel';
import UnifiedContextModeSelector, { type ContextMode, type FocusModule } from '../engine-framework/UnifiedContextModeSelector';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';
import { useEngineJobPolling } from '../../../hooks/useEngineJobPolling';

const ENGINE_LABEL = 'Market Pulse';

const NARRATIVE_PHASE_STYLES: Record<string, string> = {
  EMERGING: 'bg-purple-100 text-purple-800',
  ACCELERATING: 'bg-blue-100 text-blue-800',
  PEAKING: 'bg-amber-100 text-amber-800',
  DECLINING: 'bg-gray-200 text-gray-700',
  STRUCTURAL: 'bg-teal-100 text-teal-800',
};

type TopicWithDecay = {
  topic: string;
  spike_reason: string;
  shelf_life_days: number;
  risk_level: string;
  priority_score: number;
  regions: string[];
  age_days?: number;
  expired?: boolean;
  decay_multiplier?: number;
  effective_priority?: number;
  narrative_phase?: string;
  momentum_score?: number;
  early_advantage?: boolean;
};

type ArbitrageItem = { topic: string; high_region: string; low_region: string; explanation: string };
type LocalizedRiskItem = { topic: string; region: string; risk_level: string; spike_reason: string };

type ConsolidatedResult = {
  global_topics?: TopicWithDecay[];
  region_specific_insights?: Array<{ region: string; insight: string }>;
  risk_alerts?: string[];
  execution_priority_order?: string[];
  strategic_summary?: string;
  arbitrage_opportunities?: ArbitrageItem[];
  localized_risk_pockets?: LocalizedRiskItem[];
};

export default function MarketPulseTab(props: OpportunityTabProps) {
  const { companyId, regions, onPromote, onAction, fetchWithAuth, onSwitchTab, overrideText = '', onOverrideChange } = props;

  const [contextMode, setContextMode] = useState<ContextMode>('FULL');
  const [focusedModules, setFocusedModules] = useState<FocusModule[]>([]);
  const [additionalDirection, setAdditionalDirection] = useState('');
  const [contextError, setContextError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<'idle' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED'>('idle');
  const [consolidatedResult, setConsolidatedResult] = useState<ConsolidatedResult | null>(null);
  const [confidenceIndex, setConfidenceIndex] = useState<number | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [regionInput, setRegionInput] = useState('');
  const [archivedTopics, setArchivedTopics] = useState<Set<string>>(new Set());

  const { job: polledJob } = useEngineJobPolling<{
    status?: string;
    progress_stage?: string | null;
    confidence_index?: number;
    consolidated_result?: ConsolidatedResult;
    arbitrage_opportunities?: unknown[];
    localized_risk_pockets?: unknown[];
    error?: string | null;
  }>(
    jobId,
    jobId ? `/api/market-pulse/job/${jobId}` : null,
    fetchWithAuth,
    { enabled: !!jobId }
  );

  useEffect(() => {
    if (!polledJob) return;
    setJobStatus((polledJob.status as 'idle' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED') ?? jobStatus);
    if (polledJob.consolidated_result) {
      const cr = polledJob.consolidated_result;
      setConsolidatedResult({
        ...cr,
        arbitrage_opportunities: (polledJob.arbitrage_opportunities ?? cr.arbitrage_opportunities ?? []) as ArbitrageItem[],
        localized_risk_pockets: (polledJob.localized_risk_pockets ?? cr.localized_risk_pockets ?? []) as LocalizedRiskItem[],
      });
    }
    if (typeof polledJob.confidence_index === 'number') setConfidenceIndex(polledJob.confidence_index);
    if (polledJob.error) setJobError(polledJob.error);
  }, [polledJob]);

  const runMarketPulse = async () => {
    if (!companyId) return;
    setContextError(null);
    if (contextMode === 'NONE' && !additionalDirection.trim()) {
      setContextError('Please provide research direction when using No Company Context.');
      return;
    }
    setJobError(null);
    setConsolidatedResult(null);
    setConfidenceIndex(null);
    setArchivedTopics(new Set());
    const regionList =
      regionInput.trim()
        ? regionInput.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean)
        : Array.isArray(regions) && regions.length > 0
          ? regions
          : ['GLOBAL'];

    try {
      const res = await fetchWithAuth('/api/market-pulse/job/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          regions: regionList,
          context_mode: contextMode,
          focused_modules: contextMode === 'FOCUSED' && focusedModules.length > 0 ? focusedModules : undefined,
          additional_direction: additionalDirection.trim() || overrideText.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to start market pulse');
      }
      const data = await res.json();
      setJobId(data.jobId);
      setJobStatus(data.status ?? 'PENDING');
    } catch (e) {
      setJobError(e instanceof Error ? e.message : 'Failed to start market pulse');
    }
  };

  const handleQuickDraft = (_topic: string) => {
    if (typeof window !== 'undefined') {
      window.alert('Quick content draft generation will open here. Not yet implemented.');
    }
  };

  const handlePromote = (topic: string) => {
    if (typeof window !== 'undefined') {
      window.alert('Create campaign from topic - coming soon.');
    }
  };

  const handleArchiveTopic = (topic: string) => {
    setArchivedTopics((prev) => new Set(prev).add(topic));
  };

  if (!companyId) {
    return <div className="text-sm text-gray-500 py-4">Select a company to view market pulse.</div>;
  }

  const allTopics = consolidatedResult?.global_topics ?? [];
  const globalTopics = allTopics.filter((t) => !archivedTopics.has(t.topic));
  const riskAlerts = consolidatedResult?.risk_alerts ?? [];
  const strategicSummary = consolidatedResult?.strategic_summary ?? '';
  const arbitrageOpportunities = consolidatedResult?.arbitrage_opportunities ?? [];
  const localizedRiskPockets = consolidatedResult?.localized_risk_pockets ?? [];
  const isRunning = jobStatus === 'PENDING' || jobStatus === 'RUNNING';

  const PULSE_TOPIC_BRIDGE = 'pulse_topic_bridge';
  const handleActivateTopic = (t: TopicWithDecay) => {
    if (typeof window !== 'undefined') {
      const payload = {
        topic: t.topic,
        regions: t.regions ?? [],
        narrative_phase: t.narrative_phase ?? null,
        momentum_score: t.momentum_score ?? null,
      };
      try {
        localStorage.setItem(PULSE_TOPIC_BRIDGE, JSON.stringify(payload));
      } catch {
        // ignore
      }
      onSwitchTab?.('TREND');
    }
  };

  return (
    <div className="space-y-6">
      <EngineContextPanel companyId={companyId} fetchWithAuth={fetchWithAuth} />
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

      <section>
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Run Market Pulse</h3>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={regionInput}
            onChange={(e) => setRegionInput(e.target.value)}
            placeholder="Regions (e.g. US, GB) or leave empty for GLOBAL"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64"
          />
          <button
            type="button"
            onClick={runMarketPulse}
            disabled={isRunning}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {isRunning ? 'Running…' : `Run ${ENGINE_LABEL}`}
          </button>
        </div>
      </section>

      {jobId && (
        <EngineJobStatusPanel
          status={jobStatus}
          progressStage={polledJob?.progress_stage}
          confidenceIndex={polledJob?.confidence_index}
          error={polledJob?.error ?? jobError}
        />
      )}
      {contextError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {contextError}
        </div>
      )}

      {jobStatus === 'COMPLETED_WITH_WARNINGS' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some regions failed. Results may be partial.
        </div>
      )}

      {jobError && jobStatus === 'FAILED' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {jobError}
        </div>
      )}

      {(jobStatus === 'COMPLETED' || jobStatus === 'COMPLETED_WITH_WARNINGS') && consolidatedResult && (
        <section className="rounded-lg border border-gray-200 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800">Global Strategic Pulse</h3>

          {typeof confidenceIndex === 'number' && (
            <div className="flex items-center gap-2">
              <span className="font-medium">Confidence:</span>
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  confidenceIndex >= 70 ? 'text-green-600' : confidenceIndex >= 50 ? 'text-yellow-600' : 'text-red-600'
                }`}
              >
                {confidenceIndex >= 70 ? '🟢' : confidenceIndex >= 50 ? '🟡' : '🔴'}
                {confidenceIndex}%
              </span>
            </div>
          )}

          {strategicSummary && (
            <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
              {strategicSummary}
            </div>
          )}

          {(arbitrageOpportunities.length > 0 || localizedRiskPockets.length > 0) && (
            <details className="rounded-lg border border-gray-200 overflow-hidden">
              <summary className="cursor-pointer px-3 py-2 bg-gray-50 text-sm font-medium text-gray-800 hover:bg-gray-100">
                Regional Intelligence
              </summary>
              <div className="p-3 space-y-3 border-t border-gray-100">
                {arbitrageOpportunities.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-1">Arbitrage opportunities</h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      {arbitrageOpportunities.map((a, i) => (
                        <li key={i}>
                          <strong>{a.topic}</strong>: {a.explanation}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {localizedRiskPockets.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-1">Localized risk pockets</h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      {localizedRiskPockets.map((r, i) => (
                        <li key={i}>
                          <strong>{r.topic}</strong> ({r.region}): {r.spike_reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          )}

          {riskAlerts.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <h4 className="text-xs font-semibold text-amber-800 mb-2">Risk alerts</h4>
              <ul className="text-sm text-amber-900 space-y-1">
                {riskAlerts.slice(0, 5).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-0 rounded-lg border border-gray-200 overflow-hidden">
            {globalTopics.map((t, i) => (
              <div
                key={`${t.topic}-${i}`}
                className="flex items-start gap-3 py-3 px-3 border-b border-gray-100 last:border-0 hover:bg-gray-50"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-sm font-semibold">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{t.topic}</span>
                    {t.narrative_phase && NARRATIVE_PHASE_STYLES[t.narrative_phase] && (
                      <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${NARRATIVE_PHASE_STYLES[t.narrative_phase]}`}>
                        {t.narrative_phase}
                      </span>
                    )}
                    {t.early_advantage && (
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800">
                        Early Advantage
                      </span>
                    )}
                    {t.expired && (
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-700">
                        EXPIRED
                      </span>
                    )}
                    {(t.risk_level ?? 'LOW') === 'HIGH' && (
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">
                        HIGH RISK
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600 mt-0.5">
                    <span className="text-amber-600 font-medium">Spike:</span> {t.spike_reason}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Shelf life: {t.shelf_life_days} days
                    {t.momentum_score != null && ` · Momentum: ${(t.momentum_score * 100).toFixed(0)}%`}
                    {t.age_days != null && ` · Age: ${t.age_days.toFixed(1)} days`}
                    {t.effective_priority != null && ` · Effective: ${(t.effective_priority * 100).toFixed(0)}%`}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleActivateTopic(t)}
                    className="px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700 font-medium"
                  >
                    Activate Topic
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickDraft(t.topic)}
                    className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Generate Quick Content Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePromote(t.topic)}
                    className="px-2 py-1 text-xs rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  >
                    Promote to Campaign
                  </button>
                  <button
                    type="button"
                    onClick={() => handleArchiveTopic(t.topic)}
                    className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                  >
                    Archive
                  </button>
                </div>
              </div>
            ))}
          </div>

          {globalTopics.length === 0 && (
            <div className="text-sm text-gray-500 py-4">No market pulse topics captured.</div>
          )}
        </section>
      )}

      {jobStatus === 'idle' && !consolidatedResult && (
        <div className="text-sm text-gray-500 py-6">
          Run the Market Pulse engine to see trending topics and execution-ready signals.
        </div>
      )}
    </div>
  );
}
