/** useMarketPulseTabController — ALL state/effects/handlers of MarketPulseTabV2, verbatim. */
/** Part 3/3 of MarketPulseTabV2.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OpportunityTabProps } from './types';
import { RefreshCw, Radar, ShieldAlert, Sparkles } from 'lucide-react';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';

import { MARKET_PULSE_CATEGORIES, type ContextResponse, type AutomationResponse, SOURCE_STRATEGIES, type MarketPulseFinding, type RunResponse, type HistoryItem, type PendingRunState, type MarketDimension, type AttentionFilter, MARKET_DIMENSIONS, ATTENTION_FILTERS, findingMatchesDimension, findingMatchesAttention, sortBySignalAttention, SignalExplainability } from './MarketPulseTabV2Model';
import { SignificanceBadge, SignalMovement, ExecutiveScanStrip, SinceLastPulseStrip, filterDeltaSummary, DimensionFilters, AttentionFilters, MarketNarrativesSection, type MarketPulseLoadError, OBJECTIVES, toTitle, buildResolvedRegionPreview, buildFocusedCategoryDefaults, buildExpandedCategoryDefaults, wait, FeedSection, ExecutivePanels } from './MarketPulseTabV2Widgets';

export function useMarketPulseTabController(props: OpportunityTabProps) {
  const { companyId, fetchWithAuth } = props;
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [mode, setMode] = useState<'one_time' | 'automated'>('one_time');
  const [objective, setObjective] = useState<'growth' | 'expansion' | 'hiring' | 'partnerships' | 'product' | 'risk'>('product');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [regionScope, setRegionScope] = useState<'profile_markets' | 'expansion_markets' | 'all_defaults' | 'custom'>('profile_markets');
  const [customRegions, setCustomRegions] = useState('');
  const [competitorScope, setCompetitorScope] = useState<'profile_only' | 'auto_discover' | 'combined'>('combined');
  const [sourceStrategy, setSourceStrategy] = useState<'ai' | 'api' | 'hybrid'>('ai');
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
  // Phase 1B: feed-first UX state.
  // Default: setup collapsed UNLESS the user has never run a scan yet (no
  // history rows present after initial load — see the auto-expand effect below).
  const [scanSetupOpen, setScanSetupOpen] = useState(false);
  const [scanSetupAutoOpened, setScanSetupAutoOpened] = useState(false);
  const [actioningFindingId, setActioningFindingId] = useState<string | null>(null);
  const [activeDimension, setActiveDimension] = useState<MarketDimension>('all');
  const [activeAttentionFilter, setActiveAttentionFilter] = useState<AttentionFilter>('all');
  // Track local action overrides so the UI updates instantly without
  // re-polling the run after a user mutation.
  const [findingStateOverrides, setFindingStateOverrides] = useState<Record<string, MarketPulseFinding['user_action_state']>>({});

  useEffect(() => {
    if (!companyId) return;
    let active = true;

    const load = async () => {
      setLoadingContext(true);
      try {
        const res = await fetchWithAuth(`/api/market-pulse/context?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to load Market Pulse context');
        }
        const data = (await res.json()) as ContextResponse;
        if (!active) return;
        setContext(data);
        setSelectedCategories(buildFocusedCategoryDefaults(data));
      } catch (error) {
        if (!active) return;
        setErrorMessage((error as Error).message || 'Failed to load Market Pulse context');
      } finally {
        if (active) setLoadingContext(false);
      }
    };

    const loadAutomation = async () => {
      try {
        const res = await fetchWithAuth(`/api/market-pulse/automation?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as AutomationResponse;
        if (!active) return;
        if (data?.settings) {
          setAutomationEnabled(Boolean(data.settings.is_active));
          setCreditAcknowledged(Boolean(data.settings.credit_acknowledged));
        }
      } catch {
        // ignore
      }
    };

    const loadHistory = async () => {
      try {
        const res = await fetchWithAuth(`/api/market-pulse/history?companyId=${encodeURIComponent(companyId)}`);
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
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!runId || !companyId) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetchWithAuth(`/api/market-pulse/runs/${encodeURIComponent(runId)}?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            setRunning(false);
            setPendingRun(null);
            setErrorMessage('Market Pulse finished or changed state, but this browser session is no longer authorized to refresh it. Refresh the page or sign in again.');
            window.clearInterval(timer);
          }
          if (res.status === 404 || res.status === 409) {
            const err = await res.json().catch(() => ({}));
            setRunning(false);
            setRunId(null);
            setPendingRun(null);
            setErrorMessage(err?.error || 'Market Pulse completed, but this run is not available in the current company context.');
            window.clearInterval(timer);
          }
          return;
        }
        const data = (await res.json()) as RunResponse;
        setRunResult(data);
        setPendingRun(null);
        setErrorMessage(null);
        if (!['pending', 'running'].includes(String(data.run?.status ?? ''))) {
          const historyRes = await fetchWithAuth(`/api/market-pulse/history?companyId=${encodeURIComponent(companyId)}`);
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
        // Keep transient network failures from tearing down a legitimate scan.
      }
    }, 4000);

    return () => window.clearInterval(timer);
  }, [companyId, fetchWithAuth, runId]);

  const allVisibleRankedFindings = useMemo(() => {
    return sortBySignalAttention(runResult?.findings ?? []).filter((f) => {
      const state = findingStateOverrides[f.id] ?? f.user_action_state ?? 'open';
      return state === 'open' || state === 'escalated';
    });
  }, [runResult, findingStateOverrides]);

  const dimensionCounts = useMemo(() => {
    return MARKET_DIMENSIONS.reduce((acc, dimension) => {
      acc[dimension.id] = allVisibleRankedFindings.filter((finding) => findingMatchesDimension(finding, dimension.id)).length;
      return acc;
    }, {} as Record<MarketDimension, number>);
  }, [allVisibleRankedFindings]);

  const dimensionRankedFindings = useMemo(() => {
    return allVisibleRankedFindings.filter((finding) => findingMatchesDimension(finding, activeDimension));
  }, [activeDimension, allVisibleRankedFindings]);

  const attentionCounts = useMemo(() => {
    return ATTENTION_FILTERS.reduce((acc, filter) => {
      acc[filter.id] = dimensionRankedFindings.filter((finding) => findingMatchesAttention(finding, filter.id)).length;
      return acc;
    }, {} as Record<AttentionFilter, number>);
  }, [dimensionRankedFindings]);

  const visibleRankedFindings = useMemo(() => {
    return dimensionRankedFindings.filter((finding) => findingMatchesAttention(finding, activeAttentionFilter));
  }, [activeAttentionFilter, dimensionRankedFindings]);

  const filteredMarketDeltaSummary = useMemo(() => {
    return filterDeltaSummary(runResult?.run.market_delta_summary, activeDimension);
  }, [activeDimension, runResult]);

  const groupedFindings = useMemo(() => {
    const findings = visibleRankedFindings;
    return {
      top: findings.filter((item) => item.change_status === 'new' || item.change_status === 'updated').slice(0, 6),
      risks: findings.filter((item) => item.impact_type === 'risk'),
      watch: findings.filter((item) => item.impact_type === 'watch'),
      opportunities: findings.filter((item) => item.impact_type === 'opportunity'),
    };
  }, [visibleRankedFindings]);

  // First-time visitor → auto-open Scan Setup so the form is discoverable.
  // Once history loads with at least one row, the disclosure stays whatever
  // the user last toggled it to.
  useEffect(() => {
    if (scanSetupAutoOpened) return;
    if (history.length === 0 && !runResult && !pendingRun) {
      setScanSetupOpen(true);
      setScanSetupAutoOpened(true);
    } else if (history.length > 0) {
      setScanSetupAutoOpened(true);
    }
  }, [history, runResult, pendingRun, scanSetupAutoOpened]);

  // Phase 1A: change-diff strip — counts of new / updated / unchanged / resolved
  // and priority-tier counts. Renders above results when the run has findings.
  const changeDiff = useMemo(() => {
    const findings = runResult?.findings ?? [];
    const out = { new: 0, updated: 0, unchanged: 0, resolved: 0, p0: 0, p1: 0, p2: 0 };
    for (const f of findings) {
      if (f.change_status === 'new') out.new++;
      else if (f.change_status === 'updated') out.updated++;
      else if (f.change_status === 'unchanged') out.unchanged++;
      else if (f.change_status === 'resolved') out.resolved++;
      if (f.priority_tier === 'P0') out.p0++;
      else if (f.priority_tier === 'P1') out.p1++;
      else out.p2++;
    }
    return out;
  }, [runResult]);

  // Phase 1B: tier-grouped feed (P0 dominant, P1 visible, P2 compact).
  // Filters out resolved/snoozed by default so the feed only shows actionable items.
  const tieredFindings = useMemo(() => {
    const visible = visibleRankedFindings;
    return {
      P0: visible.filter((f) => f.priority_tier === 'P0'),
      P1: visible.filter((f) => f.priority_tier === 'P1'),
      P2: visible.filter((f) => !f.priority_tier || f.priority_tier === 'P2'),
      hidden: dimensionRankedFindings.length - visible.length,
    };
  }, [dimensionRankedFindings, visibleRankedFindings]);
  const hasPrioritizedFeed = Boolean(
    runResult && tieredFindings.P0.length + tieredFindings.P1.length + tieredFindings.P2.length > 0
  );

  // Phase 1B + 2: per-finding action handler. Optimistic local update, then
  // POST. `promote` and `generate` route to dedicated Phase 2 endpoints;
  // others use the standard /action endpoint.
  const performFindingAction = async (
    finding: MarketPulseFinding,
    actionType: 'resolve' | 'reopen' | 'snooze' | 'escalate' | 'promote' | 'share' | 'generate',
    payload?: Record<string, unknown>,
  ) => {
    if (!companyId) return;
    setActioningFindingId(finding.id);
    setErrorMessage(null);

    // Optimistic local state.
    const nextState: MarketPulseFinding['user_action_state'] =
      actionType === 'resolve' ? 'resolved'
      : actionType === 'reopen' ? 'open'
      : actionType === 'snooze' ? 'snoozed'
      : actionType === 'escalate' ? 'escalated'
      : actionType === 'promote' ? 'promoted'
      : finding.user_action_state ?? 'open';
    if (actionType !== 'share' && actionType !== 'generate') {
      setFindingStateOverrides((prev) => ({ ...prev, [finding.id]: nextState }));
    }

    if (actionType === 'share' && typeof navigator !== 'undefined' && navigator.clipboard) {
      const text = `[Market Pulse · ${finding.priority_tier ?? 'P?'} ${finding.impact_type}] ${finding.title}\n\n${finding.interpretation_text ?? finding.summary}\n\nWhy it matters: ${finding.why_it_matters}\nRecommended action: ${finding.recommended_action}`;
      try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    }

    try {
      // Phase 2: dedicated /promote endpoint that creates an opportunity_items
      // row + builds the campaign payload. Then we stash it in sessionStorage
      // and navigate to the recommendations planner.
      if (actionType === 'promote') {
        const res = await fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(finding.id)}/promote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to promote finding');
        }
        const data = await res.json();
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem('market_pulse_promote_bridge', JSON.stringify({
              finding_id: finding.id,
              opportunity_id: data.opportunity_id,
              campaign_payload: data.campaign_payload,
              issued_at: new Date().toISOString(),
            }));
          } catch { /* ignore quota */ }
          // Navigate to recommendations hub — campaign builder consumes the bridge.
          window.location.assign('/recommendations?from=market_pulse');
        }
        return;
      }

      // Phase 2: dedicated /generate-response endpoint that returns a handoff
      // payload + suggested target URLs. We stash + navigate.
      if (actionType === 'generate') {
        const res = await fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(finding.id)}/generate-response`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to prepare generation context');
        }
        const data = await res.json();
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(data.handoff_token, JSON.stringify(data.handoff_payload));
          } catch { /* ignore quota */ }
          // Default target = post creator. The bridge payload survives a
          // navigate so the user can change destination via the content menu.
          const target = (payload?.target as string | undefined) ?? data.suggested_targets.post_creator;
          window.location.assign(target);
        }
        return;
      }

      // Default: legacy /action endpoint (resolve / snooze / escalate / share / reopen).
      const res = await fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(finding.id)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          action: actionType,
          payload: payload ?? {},
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Failed to ${actionType} finding`);
      }
    } catch (error) {
      // Roll back the optimistic override.
      setFindingStateOverrides((prev) => {
        const next = { ...prev };
        delete next[finding.id];
        return next;
      });
      setErrorMessage((error as Error).message || `Failed to ${actionType} finding`);
    } finally {
      setActioningFindingId(null);
    }
  };

  // Phase 2: record "shown" for each visible finding once per session per
  // finding. The endpoint is idempotent per UTC day, so even multiple
  // remounts are safe — but we de-dupe client-side to avoid the network
  // calls.
  const shownRecordedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!companyId || !runResult || runResult.findings.length === 0) return;
    const toRecord = runResult.findings
      .filter((f) => !shownRecordedRef.current.has(f.id))
      .slice(0, 50);
    if (toRecord.length === 0) return;
    for (const f of toRecord) shownRecordedRef.current.add(f.id);
    void Promise.allSettled(
      toRecord.map((f) =>
        fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(f.id)}/shown`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        }),
      ),
    );
  }, [companyId, fetchWithAuth, runResult]);

  const resolvedRegionPreview = useMemo(
    () => buildResolvedRegionPreview(context, regionScope, customRegions),
    [context, regionScope, customRegions]
  );

  const loadRunResult = async (targetRunId: string, attempts = 1): Promise<RunResponse> => {
    let lastError: MarketPulseLoadError | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await wait(1200 * attempt);
      const resultRes = await fetchWithAuth(`/api/market-pulse/runs/${encodeURIComponent(targetRunId)}?companyId=${encodeURIComponent(companyId)}`);
      if (resultRes.ok) {
        return (await resultRes.json()) as RunResponse;
      }

      const err = await resultRes.json().catch(() => ({}));
      lastError = new Error(err?.error || `Failed to load Market Pulse run (${resultRes.status})`) as MarketPulseLoadError;
      lastError.status = resultRes.status;

      if (resultRes.status === 401 || resultRes.status === 403 || resultRes.status === 404 || resultRes.status === 409) {
        break;
      }
    }

    throw lastError ?? new Error('Failed to load Market Pulse run');
  };

  const loadMostRecentRunResult = async (): Promise<RunResponse | null> => {
    const historyRes = await fetchWithAuth(`/api/market-pulse/history?companyId=${encodeURIComponent(companyId)}`);
    if (!historyRes.ok) return null;

    const historyData = await historyRes.json();
    const nextHistory = Array.isArray(historyData?.history) ? historyData.history as HistoryItem[] : [];
    setHistory(nextHistory);

    const latestLoadableRun = nextHistory.find((item) =>
      ['completed', 'completed_with_warnings', 'failed'].includes(String(item.status ?? '').toLowerCase())
    ) ?? nextHistory[0];
    if (!latestLoadableRun?.id) return null;

    return loadRunResult(latestLoadableRun.id, 1);
  };

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
      const res = await fetchWithAuth('/api/market-pulse/run', {
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
      const nextRunId = String(data.runId);
      if (!nextRunId || nextRunId === 'undefined' || nextRunId === 'null') {
        throw new Error('Market Pulse started, but the server did not return a valid run id');
      }
      setRunId(nextRunId);
      setPendingRun((current) => current ? { ...current, status: 'running', progress_stage: 'INITIALIZING' } : current);

      if (!['pending', 'running'].includes(String(data.status ?? '').toLowerCase())) {
        try {
          const result = await loadRunResult(nextRunId, 3);
          setRunResult(result);
          setPendingRun(null);
          setRunning(false);
          setErrorMessage(null);
        } catch (resultError) {
          const status = (resultError as MarketPulseLoadError).status;
          if (status === 404 || status === 409) {
            const fallbackResult = await loadMostRecentRunResult().catch(() => null);
            if (fallbackResult) {
              setRunResult(fallbackResult);
              setPendingRun(null);
              setRunning(false);
              setErrorMessage(null);
              return;
            }

            setRunning(false);
            setRunId(null);
            setPendingRun(null);
            setErrorMessage((resultError as Error).message || 'Market Pulse completed, but the run could not be found for this company.');
            return;
          }

          setPendingRun({
            created_at: new Date().toISOString(),
            status: 'running',
            progress_stage: 'FINALIZING',
          });
          setErrorMessage(
            `${(resultError as Error).message || 'Market Pulse completed, but results could not be loaded'}. Retrying result load...`
          );
        }
      }
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
      const res = await fetchWithAuth('/api/market-pulse/automation', {
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
      const res = await fetchWithAuth(`/api/market-pulse/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const alreadyFinished = typeof err?.error === 'string' && err.error.toLowerCase().includes('already finished');
        if (!alreadyFinished) {
          throw new Error(err?.error || 'Failed to stop Market Pulse run');
        }
      }
      const data = await res.json().catch(() => ({}));

      const cancelledAt = new Date().toISOString();
      setRunning(false);
      setRunId(null);
      setPendingRun(null);
      setRunResult((current) => current ? {
        ...current,
        run: {
          ...current.run,
          status: data?.alreadyFinished ? String(data.status ?? current.run.status) : 'failed',
          completed_at: current.run.completed_at ?? cancelledAt,
          legacy_error: data?.alreadyFinished ? current.run.legacy_error : 'Cancelled by user',
        },
      } : null);
      if (!data?.alreadyFinished) {
        setErrorMessage(null);
      }
    } catch (error) {
      setErrorMessage((error as Error).message || 'Failed to stop Market Pulse run');
    } finally {
      setCancelLoading(false);
    }
  };

  const activeScanStatusPanel = running ? (
    <div className="mt-3 w-full max-w-3xl">
      <EngineJobStatusPanel
        status={String(runResult?.run?.status ?? pendingRun?.status ?? 'pending').toUpperCase()}
        progressStage={runResult?.run?.progress_stage ?? pendingRun?.progress_stage}
        confidenceIndex={runResult?.run?.confidence_index}
        error={runResult?.run?.legacy_error}
        createdAt={runResult?.run?.created_at ?? pendingRun?.created_at}
        durationHint="Scan in progress. You can keep this page open while Market Pulse collects and consolidates signals."
      />
    </div>
  ) : null;

  // Guard moved to the render layer (a hook must not return JSX — it poisoned the inferred type).
  const noCompanySelected = !companyId;

  return {
    noCompanySelected,
    actioningFindingId, activeAttentionFilter, activeDimension, activeScanStatusPanel,
    allVisibleRankedFindings, attentionCounts, automationEnabled, automationLoading, cancelLoading, changeDiff,
    companyId, competitorScope, context, creditAcknowledged, customDirection, customRegions, dimensionCounts,
    dimensionRankedFindings, errorMessage, fetchWithAuth, filteredMarketDeltaSummary, findingStateOverrides,
    groupedFindings, hasPrioritizedFeed, history, loadMostRecentRunResult, loadRunResult, loadingContext, mode,
    objective, pendingRun, performFindingAction, regionScope, resolvedRegionPreview, runId, runResult, runScan,
    running, saveAutomation, scanSetupAutoOpened, scanSetupOpen, selectedCategories, setActioningFindingId,
    setActiveAttentionFilter, setActiveDimension, setAutomationEnabled, setAutomationLoading, setCancelLoading,
    setCompetitorScope, setContext, setCreditAcknowledged, setCustomDirection, setCustomRegions,
    setErrorMessage, setFindingStateOverrides, setHistory, setLoadingContext, setMode, setObjective,
    setPendingRun, setRegionScope, setRunId, setRunResult, setRunning, setScanSetupAutoOpened,
    setScanSetupOpen, setSelectedCategories, setSourceStrategy, shownRecordedRef, sourceStrategy, stopScan,
    tieredFindings, toggleCategory, visibleRankedFindings
  };
}
