/** useTrendCampaignsCore — composition: state hook + engine logic + the ORIGINAL return (public API unchanged). */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import TrendCampaignsHistoryDrawer from './TrendCampaignsHistoryDrawer';
import TrendCampaignsRecommendationCards from './TrendCampaignsRecommendationCards';
import {
  CampaignAssistPanel,
  EMPTY_ASSIST_CONTEXT,
  type AssistContext,
} from '../../campaigns/CampaignAssistPanel';
import { useRouter } from 'next/router';

import type { OpportunityTabProps } from './types';
import EngineContextPanel from '../EngineContextPanel';
import UnifiedContextModeSelector, { type ContextMode, type FocusModule } from '../engine-framework/UnifiedContextModeSelector';
import StrategicAspectSelector from '../engine-framework/StrategicAspectSelector';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';
import { useEngineJobPolling } from '../../../hooks/useEngineJobPolling';
import OfferingFacetSelector from '../engine-framework/OfferingFacetSelector';
import StrategicConsole from '../engine-framework/StrategicConsole';
import RecommendationBlueprintCard, {
  getConfidenceTierForRecommendation,
  getJourneyState,
  getDecisionMomentumState,
  type BoltOutcomeView,
} from '../cards/RecommendationBlueprintCard';
import StrategicWorkspacePanel from '../StrategicWorkspacePanel';
import AIGenerationProgress from '../../AIGenerationProgress';
import BOLTProgressModal, { type BOLTProgress } from '../../BOLTProgressModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PRIMARY_OPTIONS,
  PERSONAL_BRAND_SECONDARY_GROUPS,
  getSecondaryOptionsForPrimary,
  isPersonalBrandPrimary,
  buildHierarchicalPayload,
  getDilutionSeverity,
  type PrimaryCampaignTypeId,
  type SecondaryOptionId,
} from '../../../lib/campaignTypeHierarchy';
import { TARGET_AUDIENCE_CATEGORIES, PROFESSIONAL_SEGMENTS } from '../../../lib/audienceCategories';
import { buildSourceStrategicTheme } from '../../../lib/recommendationStrategicCard';


import {
  TYPE,
  TREND_CLUSTER_PAYLOAD_BRIDGE,
  PULSE_TOPIC_BRIDGE,
  type ClusterInput,
  type PulseTopicBridge,
  type ExecutionConfig,
  type StrategicPayload,
  type StrategyStatusForProgress,
  type StrategicFlowState,
  type CardSignals,
  ISO_COUNTRIES,
  safeParseClusterPayload,
  matchCountry,
  tokenToIsoCode,
  regionInputToIsoCodes,
  getRecommendationPriorityScore,
  getProgressAdjustment,
  getStrategicFlowState,
  FLOW_SUMMARY_MESSAGES,
  StrategicFlowSummary,
} from './TrendCampaignsTabHelpers';
import type { StrategyStatusPayload } from '../../strategy/StrategyIntelligencePanel';




import { useTrendCampaignsCoreState } from './useTrendCampaignsCoreState';

export function useTrendCampaignsCore(cprops: OpportunityTabProps) {
  const core = useTrendCampaignsCoreState(cprops);
  const {
    props,
    additionalDirection, appliedMixSignatureRef, archivedEngineCards, assistPanelOpen, assistResolverRef, assistTopic,
    autoRunIntelligentMixRef, blogPrefillFiredRef, boltProgress, boltTextPreset, campaignGoal, campaignId, cardBuildError,
    clusterBridgeConsumedRef, clusterInputs, communicationStyle, companyId, consolidatedResult, contentDepth, contextMode,
    customAngle, customPillars, customTitle, engineRecommendationCards, engineRecommendationSource, engineRecommendations,
    executionCalendarOpen, executionCollapsed, executionSectionRefs, fastLoadingCardId, fetchWithAuth, firstCardRef, focusedModules,
    frequencyPerWeek, generatedCampaignId, generatedEngineRecommendations, hasRun, highlightedState, historyDrawerOpen,
    historyLoading, initialBlogId, insightSource, intelligentMixContext, intelligentMixProp, intelligentMixSignature, isMountedRef,
    isSubmitting, jobError, jobHistory, jobId, jobRegionCount, jobStatus, lastStrategicPayload, longTermEngineCards, meterReveal,
    mixPreFilled, modeHint, onStrategicIntentsChange, pendingAssistContextRef, prevConcentrationRef, prevSubmittingRef,
    primaryCampaignType, professionalDropdownOpen, professionalDropdownRect, professionalDropdownRef, professionalPortalRef,
    professionalSegments, professionalTriggerRef, pulseBridgeConsumedRef, rankedEngineCardsWithStatus, recommendationRefinements,
    recommendationSignals, recommendationUserStateMap, regionDropdownOpen, regionInput, regionInputRef, regionWarning, regions,
    router, secondaryCampaignTypes, selectedAspects, selectedFacets, setAdditionalDirection, setAssistPanelOpen, setAssistTopic,
    setBoltProgress, setCampaignGoal, setCardBuildError, setClusterInputs, setCommunicationStyle, setConsolidatedResult,
    setContentDepth, setContextMode, setCustomAngle, setCustomPillars, setCustomTitle, setExecutionCalendarOpen,
    setExecutionCollapsed, setFastLoadingCardId, setFocusedModules, setFrequencyPerWeek, setGeneratedCampaignId,
    setGeneratedEngineRecommendations, setHasRun, setHistoryDrawerOpen, setHistoryLoading, setInsightSource, setIsSubmitting,
    setJobError, setJobHistory, setJobId, setJobRegionCount, setJobStatus, setLastStrategicPayload, setMeterReveal, setMixPreFilled,
    setModeHint, setPrimaryCampaignType, setProfessionalDropdownOpen, setProfessionalDropdownRect, setProfessionalSegments,
    setRecommendationRefinements, setRecommendationSignals, setRecommendationUserStateMap, setRegionDropdownOpen, setRegionInput,
    setRegionWarning, setSecondaryCampaignTypes, setSelectedAspects, setSelectedFacets, setShowAddCustomForm,
    setShowMissingFieldsMessage, setShowStrategicSetupEditor, setShowStrategyDetails, setStrategicConfig, setStrategicText,
    setStrategyGuidanceMode, setStrategyHistory, setStrategyStatusPayload, setTargetAudience, setTentativeStartDate,
    setUsedRecommendationIds, setValidationError, showAddCustomForm, showMissingFieldsMessage, showStrategicSetupEditor,
    showStrategyDetails, stabilizationRecommendation, strategicConfig, strategicFlowState, strategicIntents, strategicText,
    strategyDrift, strategyFocusLabel, strategyGuidanceMode, strategyHistory, strategyStatusPayload, suggestedStrategyExplanation,
    suggestedStrategyMode, targetAudience, tentativeStartDate, themesSectionRef, usedRecommendationIds, validationError, viewMode,
    visibleEngineCards, visibleEngineCardsWithStatus, workspaceSummaryData
  } = core;

  // Duplicated fn-scoped type alias (declared in the State half too — structural, safe).
  type IntelligentMixContextWithFocus = import('@/pages/command-center/intelligent-mix-strategy').IntelligentMixState & {
    communicationStyle?: string[];
    primaryCampaignType?: PrimaryCampaignTypeId;
    secondaryCampaignTypes?: SecondaryOptionId[];
  };
  const hierarchicalPayload = useMemo(
    () => buildHierarchicalPayload(primaryCampaignType, secondaryCampaignTypes),
    [primaryCampaignType, secondaryCampaignTypes]
  );
  const dilutionSeverity = useMemo(
    () =>
      primaryCampaignType && secondaryCampaignTypes.length > 0
        ? getDilutionSeverity(primaryCampaignType, secondaryCampaignTypes)
        : 'none',
    [primaryCampaignType, secondaryCampaignTypes]
  );


  /** Set strategy mode and show transient micro-confirmation (no toast). */

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
  }, [contextMode, selectedAspects, selectedFacets, strategicText, primaryCampaignType, secondaryCampaignTypes]);

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

  // After generation: scroll to top two cards (or results section when empty)
  useEffect(() => {
    const wasSubmitting = prevSubmittingRef.current;
    prevSubmittingRef.current = isSubmitting;
    if (!wasSubmitting || isSubmitting || !hasRun) return;
    requestAnimationFrame(() => {
      if (visibleEngineCards.length > 0) {
        // Hop to first card so top two are visible
        firstCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        // Empty result: scroll to cards section so user sees the empty state
        (cardsSectionRef.current ?? document.getElementById('recommendation-cards'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }, [isSubmitting, hasRun, visibleEngineCards.length]);

  // When opening with #cards (e.g. from Content Architect hub), scroll to recommendation cards section
  const cardsSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (hash !== '#cards') return;
    const el = cardsSectionRef.current ?? document.getElementById('recommendation-cards');
    if (el) {
      const t = setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [companyId]);

  useEffect(() => {
    if (!historyDrawerOpen || !companyId) return;
    setHistoryLoading(true);
    fetchWithAuth(`/api/recommendations/job/history?companyId=${encodeURIComponent(companyId)}&limit=5`)
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((data) => setJobHistory(Array.isArray(data?.jobs) ? data.jobs : []))
      .catch(() => setJobHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [historyDrawerOpen, companyId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId || !fetchWithAuth) {
      setRecommendationUserStateMap({});
      return;
    }
    fetchWithAuth(`/api/recommendations/user-state-map?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => (typeof data === 'object' && data !== null ? data : {}))
      .then(setRecommendationUserStateMap)
      .catch(() => setRecommendationUserStateMap({}));
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId) {
      setUsedRecommendationIds(new Set());
      return;
    }
    fetchWithAuth(`/api/recommendations/used-by-company?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : { usedRecommendationIds: [] }))
      .then((data) =>
        setUsedRecommendationIds(
          new Set(Array.isArray(data?.usedRecommendationIds) ? data.usedRecommendationIds : [])
        )
      )
      .catch(() => setUsedRecommendationIds(new Set()));
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId) {
      setStrategyHistory(null);
      return;
    }
    fetchWithAuth(`/api/recommendations/strategy-history?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.campaigns_count === 'number' && data.campaigns_count > 0) {
          const sm = data.strategy_momentum && typeof data.strategy_momentum === 'object';
          const aspect_counts = data.aspect_counts && typeof data.aspect_counts === 'object' ? data.aspect_counts : {};
          setStrategyHistory({
            campaigns_count: data.campaigns_count,
            aspect_counts,
            dominant_aspects: Array.isArray(data.dominant_aspects) ? data.dominant_aspects : [],
            underused_aspects: Array.isArray(data.underused_aspects) ? data.underused_aspects : [],
            strategy_momentum: sm
              ? {
                  dominant_streak_aspect: data.strategy_momentum.dominant_streak_aspect ?? null,
                  dominant_streak_count: typeof data.strategy_momentum.dominant_streak_count === 'number' ? data.strategy_momentum.dominant_streak_count : 0,
                  diversification_score: typeof data.strategy_momentum.diversification_score === 'number' ? data.strategy_momentum.diversification_score : 0,
                }
              : null,
          });
        } else {
          setStrategyHistory(null);
        }
      })
      .catch(() => setStrategyHistory(null));
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!campaignId?.trim() || !fetchWithAuth) {
      setStrategyStatusPayload(null);
      return;
    }
    fetchWithAuth(`/api/campaigns/${encodeURIComponent(campaignId)}/strategy-status`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStrategyStatusPayload(data ?? null))
      .catch(() => setStrategyStatusPayload(null));
  }, [campaignId, fetchWithAuth]);

  useEffect(() => {
    if (!companyId || !fetchWithAuth) {
      setRecommendationUserStateMap({});
      setRecommendationSignals(null);
      return;
    }
    let cancelled = false;
    fetchWithAuth(`/api/recommendations/user-state-map?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        if (cancelled) return;
        setRecommendationUserStateMap(data && typeof data === 'object' ? data as Record<string, string> : {});
      })
      .catch(() => {
        if (!cancelled) setRecommendationUserStateMap({});
      });
    fetchWithAuth(`/api/recommendations/strategy-signals?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setRecommendationSignals(data && typeof data === 'object'
          ? {
              archived: Number((data as any).archived) || 0,
              longTerm: Number((data as any).longTerm) || 0,
              adopted: Number((data as any).adopted) || 0,
              totalRecommendations: Number((data as any).totalRecommendations) || 0,
              adoptionRate: Number((data as any).adoptionRate) || 0,
            }
          : null);
      })
      .catch(() => {
        if (!cancelled) setRecommendationSignals(null);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, fetchWithAuth]);



  // Load company-specific strategic config from backend (aspects + offerings_by_aspect). No frontend derivation.
  useEffect(() => {
    if (!companyId) {
      setStrategicConfig(null);
      return;
    }
    let cancelled = false;
    fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const config = data?.recommendation_strategic_config;
        const map = config?.offerings_by_aspect ?? config?.aspect_offerings_map;
        if (config && Array.isArray(config.strategic_aspects) && typeof map === 'object') {
          const sortAz = (a: string, b: string) => a.trim().toLowerCase().localeCompare(b.trim().toLowerCase(), undefined, { sensitivity: 'base' });
          const sortedAspects = [...config.strategic_aspects].sort(sortAz);
          const sortedMap: Record<string, string[]> = {};
          for (const [k, v] of Object.entries(map ?? {})) {
            sortedMap[k] = Array.isArray(v) ? [...v].sort(sortAz) : [];
          }
          setStrategicConfig({
            strategic_aspects: sortedAspects,
            aspect_offerings_map: sortedMap,
            offerings_by_aspect: sortedMap,
            strategic_objectives: Array.isArray(config.strategic_objectives) ? [...config.strategic_objectives].sort(sortAz) : undefined,
          });
        } else {
          setStrategicConfig(null);
        }
      })
      .catch(() => {
        if (!cancelled) setStrategicConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, fetchWithAuth]);

  const aspects = strategicConfig?.strategic_aspects ?? [];
  const aspectOfferingsMap = strategicConfig?.aspect_offerings_map ?? strategicConfig?.offerings_by_aspect ?? {};

  // Offerings from all selected aspects (OR: union of offerings).
  const offeringsForSelectedAspect = useMemo(() => {
    if (selectedAspects.length === 0) return [];
    const seen = new Set<string>();
    for (const aspect of selectedAspects) {
      const ids = aspectOfferingsMap[aspect];
      if (Array.isArray(ids)) ids.forEach((id) => seen.add(id));
    }
    return Array.from(seen);
  }, [selectedAspects, aspectOfferingsMap]);

  const offeringFacetCards = useMemo(() => {
    return offeringsForSelectedAspect.map((id: string) => {
      const title = id.includes(':') ? id.split(':').slice(1).join(':').trim() || id : id;
      return { id, title, description: title };
    });
  }, [offeringsForSelectedAspect]);

  // When aspects change, keep only facets that belong to any selected aspect.
  useEffect(() => {
    if (selectedAspects.length === 0 || selectedFacets.length === 0) return;
    const allowed = new Set<string>();
    for (const aspect of selectedAspects) {
      const ids = aspectOfferingsMap[aspect];
      if (Array.isArray(ids)) ids.forEach((id) => allowed.add(id));
    }
    const next = selectedFacets.filter((id) => allowed.has(id));
    if (next.length !== selectedFacets.length) setSelectedFacets(next);
  }, [selectedAspects, aspectOfferingsMap]);



  const requiredExecutionFields = useMemo(() => {
    const hasAudience = !!targetAudience;
    const hasGoal = !!campaignGoal;
    const hasFrequency = !!frequencyPerWeek;
    const hasStartDate = !!tentativeStartDate;
    const hasStyle = communicationStyle.length > 0;
    const missing: string[] = [];
    if (!hasAudience) missing.push('Target Audience');
    if (!hasGoal) missing.push('Campaign Goal');
    if (!hasFrequency) missing.push('Frequency per week');
    if (!hasStartDate) missing.push('Start Date');
    if (!hasStyle) missing.push('Communication Style');
    return {
      completed: hasAudience && hasGoal && hasFrequency && hasStartDate && hasStyle,
      completedCount: [hasAudience, hasGoal, hasFrequency, hasStartDate, hasStyle].filter(Boolean).length,
      missing,
    };
  }, [targetAudience, campaignGoal, frequencyPerWeek, tentativeStartDate, communicationStyle]);

  useEffect(() => {
    if (requiredExecutionFields.completed) {
      setShowMissingFieldsMessage(false);
    } else if (mixPreFilled) {
      // Fields are missing even though Intelligent Mix pre-filled — show the config so user can complete them
      setExecutionCollapsed(false);
    }
  }, [requiredExecutionFields.completed, mixPreFilled]);

  const isExecutionFormComplete = requiredExecutionFields.completed;
  const isExecutionValid = isExecutionFormComplete;
  const hasStrategicMixPrefill = Boolean(
    intelligentMixContext &&
    (
      (intelligentMixContext as IntelligentMixContextWithFocus).contextMode ||
      (intelligentMixContext as IntelligentMixContextWithFocus).strategicText ||
      (intelligentMixContext as IntelligentMixContextWithFocus).selectedAspects?.length ||
      (intelligentMixContext as IntelligentMixContextWithFocus).selectedFacets?.length ||
      (intelligentMixContext as IntelligentMixContextWithFocus).regionsInput
    )
  );


  const executionFieldKeyToLabel: Record<string, string> = {
    targetAudience: 'Target Audience',
    campaignGoal: 'Campaign Goal',
    frequencyPerWeek: 'Frequency per week',
    startDate: 'Start Date',
    communicationStyle: 'Communication Style',
  };



  const campaignFocusLabels = useMemo(() => {
    const primaryLabel = PRIMARY_OPTIONS.find((o) => o.id === primaryCampaignType)?.label ?? '';
    const secondaryLabels = isPersonalBrandPrimary(primaryCampaignType)
      ? secondaryCampaignTypes
          .map((id) => PERSONAL_BRAND_SECONDARY_GROUPS.flatMap((g) => g.options).find((o) => o.id === id)?.label)
          .filter(Boolean) as string[]
      : secondaryCampaignTypes
          .map((id) => getSecondaryOptionsForPrimary(primaryCampaignType).find((o) => o.id === id)?.label)
          .filter(Boolean) as string[];
    return [primaryLabel, ...secondaryLabels].filter(Boolean);
  }, [primaryCampaignType, secondaryCampaignTypes]);

  useEffect(() => {
    if (onStrategicIntentsChange && campaignFocusLabels.length > 0) {
      onStrategicIntentsChange(campaignFocusLabels);
    }
  }, [campaignFocusLabels, onStrategicIntentsChange]);



  const modeIndicatorLabel =
    contextMode === 'FULL'
      ? 'Using full company context for recommendations.'
      : contextMode === 'FOCUSED' && focusedModules.length > 0
        ? `Focused on: ${focusedModules.join(', ')}.`
        : contextMode === 'NONE'
          ? 'No company context; use research direction below.'
          : 'Context: ' + contextMode;

  const showNoCompanyMessage = !companyId;


  return {
    showNoCompanyMessage,
    additionalDirection,
    appliedMixSignatureRef,
    archivedEngineCards,
    aspectOfferingsMap,
    aspects,
    assistPanelOpen,
    assistResolverRef,
    assistTopic,
    autoRunIntelligentMixRef,
    blogPrefillFiredRef,
    boltProgress,
    boltTextPreset,
    campaignFocusLabels,
    campaignGoal,
    campaignId,
    cardBuildError,
    cardsSectionRef,
    clusterBridgeConsumedRef,
    clusterInputs,
    communicationStyle,
    companyId,
    consolidatedResult,
    contentDepth,
    contextMode,
    customAngle,
    customPillars,
    customTitle,
    dilutionSeverity,
    engineRecommendationCards,
    engineRecommendationSource,
    engineRecommendations,
    executionCalendarOpen,
    executionCollapsed,
    executionSectionRefs,
    fastLoadingCardId,
    fetchWithAuth,
    firstCardRef,
    focusedModules,
    frequencyPerWeek,
    generatedCampaignId,
    generatedEngineRecommendations,
    hasRun,
    hasStrategicMixPrefill,
    hierarchicalPayload,
    highlightedState,
    historyDrawerOpen,
    historyLoading,
    initialBlogId,
    insightSource,
    intelligentMixContext,
    intelligentMixSignature,
    isExecutionFormComplete,
    isExecutionValid,
    isMountedRef,
    isSubmitting,
    jobError,
    jobHistory,
    jobId,
    jobRegionCount,
    jobStatus,
    lastStrategicPayload,
    longTermEngineCards,
    meterReveal,
    mixPreFilled,
    modeHint,
    modeIndicatorLabel,
    offeringFacetCards,
    offeringsForSelectedAspect,
    onStrategicIntentsChange,
    pendingAssistContextRef,
    prevConcentrationRef,
    prevSubmittingRef,
    primaryCampaignType,
    professionalDropdownOpen,
    professionalDropdownRect,
    professionalDropdownRef,
    professionalPortalRef,
    professionalSegments,
    professionalTriggerRef,
    pulseBridgeConsumedRef,
    rankedEngineCardsWithStatus,
    recommendationRefinements,
    recommendationSignals,
    recommendationUserStateMap,
    regionDropdownOpen,
    regionInput,
    regionInputRef,
    regionWarning,
    regions,
    requiredExecutionFields,
    router,
    secondaryCampaignTypes,
    selectedAspects,
    selectedFacets,
    setAdditionalDirection,
    setAssistPanelOpen,
    setAssistTopic,
    setBoltProgress,
    setCampaignGoal,
    setCardBuildError,
    setClusterInputs,
    setCommunicationStyle,
    setConsolidatedResult,
    setContentDepth,
    setContextMode,
    setCustomAngle,
    setCustomPillars,
    setCustomTitle,
    setExecutionCalendarOpen,
    setExecutionCollapsed,
    setFastLoadingCardId,
    setFocusedModules,
    setFrequencyPerWeek,
    setGeneratedCampaignId,
    setGeneratedEngineRecommendations,
    setHasRun,
    setHistoryDrawerOpen,
    setHistoryLoading,
    setInsightSource,
    setIsSubmitting,
    setJobError,
    setJobHistory,
    setJobId,
    setJobRegionCount,
    setJobStatus,
    setLastStrategicPayload,
    setMeterReveal,
    setMixPreFilled,
    setModeHint,
    setPrimaryCampaignType,
    setProfessionalDropdownOpen,
    setProfessionalDropdownRect,
    setProfessionalSegments,
    setRecommendationRefinements,
    setRecommendationSignals,
    setRecommendationUserStateMap,
    setRegionDropdownOpen,
    setRegionInput,
    setRegionWarning,
    setSecondaryCampaignTypes,
    setSelectedAspects,
    setSelectedFacets,
    setShowAddCustomForm,
    setShowMissingFieldsMessage,
    setShowStrategicSetupEditor,
    setShowStrategyDetails,
    setStrategicConfig,
    setStrategicText,
    setStrategyGuidanceMode,
    setStrategyHistory,
    setStrategyStatusPayload,
    setTargetAudience,
    setTentativeStartDate,
    setUsedRecommendationIds,
    setValidationError,
    showAddCustomForm,
    showMissingFieldsMessage,
    showStrategicSetupEditor,
    showStrategyDetails,
    stabilizationRecommendation,
    strategicConfig,
    strategicFlowState,
    strategicIntents,
    strategicText,
    strategyDrift,
    strategyFocusLabel,
    strategyGuidanceMode,
    strategyHistory,
    strategyStatusPayload,
    suggestedStrategyExplanation,
    suggestedStrategyMode,
    targetAudience,
    tentativeStartDate,
    themesSectionRef,
    usedRecommendationIds,
    validationError,
    viewMode,
    visibleEngineCards,
    visibleEngineCardsWithStatus,
    workspaceSummaryData,
  };

  return {
    polledJob,
    additionalDirection,
    appliedMixSignatureRef,
    archivedEngineCards,
    aspectOfferingsMap,
    aspects,
    assistPanelOpen,
    assistResolverRef,
    assistTopic,
    autoRunIntelligentMixRef,
    blogPrefillFiredRef,
    boltProgress,
    boltTextPreset,
    campaignFocusLabels,
    campaignGoal,
    campaignId,
    cardBuildError,
    cardsSectionRef,
    clusterBridgeConsumedRef,
    clusterInputs,
    communicationStyle,
    companyId,
    consolidatedResult,
    contentDepth,
    contextMode,
    customAngle,
    customPillars,
    customTitle,
    dilutionSeverity,
    engineRecommendationCards,
    engineRecommendationSource,
    engineRecommendations,
    executionCalendarOpen,
    executionCollapsed,
    executionFieldKeyToLabel,
    executionSectionRefs,
    fastLoadingCardId,
    fetchWithAuth,
    firstCardRef,
    focusedModules,
    frequencyPerWeek,
    generatedCampaignId,
    generatedEngineRecommendations,
    hasRun,
    hasStrategicMixPrefill,
    hierarchicalPayload,
    highlightedState,
    historyDrawerOpen,
    historyLoading,
    initialBlogId,
    insightSource,
    intelligentMixContext,
    intelligentMixSignature,
    isExecutionFormComplete,
    isExecutionValid,
    isMountedRef,
    isSubmitting,
    jobError,
    jobHistory,
    jobId,
    jobRegionCount,
    jobStatus,
    lastStrategicPayload,
    longTermEngineCards,
    meterReveal,
    mixPreFilled,
    modeHint,
    modeIndicatorLabel,
    offeringFacetCards,
    offeringsForSelectedAspect,
    onStrategicIntentsChange,
    pendingAssistContextRef,
    prevConcentrationRef,
    prevSubmittingRef,
    primaryCampaignType,
    professionalDropdownOpen,
    professionalDropdownRect,
    professionalDropdownRef,
    professionalPortalRef,
    professionalSegments,
    professionalTriggerRef,
    pulseBridgeConsumedRef,
    rankedEngineCardsWithStatus,
    recommendationRefinements,
    recommendationSignals,
    recommendationUserStateMap,
    regionDropdownOpen,
    regionInput,
    regionInputRef,
    regionWarning,
    regions,
    requiredExecutionFields,
    router,
    secondaryCampaignTypes,
    selectedAspects,
    selectedFacets,
    setAdditionalDirection,
    setAssistPanelOpen,
    setAssistTopic,
    setBoltProgress,
    setCampaignGoal,
    setCardBuildError,
    setClusterInputs,
    setCommunicationStyle,
    setConsolidatedResult,
    setContentDepth,
    setContextMode,
    setCustomAngle,
    setCustomPillars,
    setCustomTitle,
    setExecutionCalendarOpen,
    setExecutionCollapsed,
    setFastLoadingCardId,
    setFocusedModules,
    setFrequencyPerWeek,
    setGeneratedCampaignId,
    setGeneratedEngineRecommendations,
    setHasRun,
    setHistoryDrawerOpen,
    setHistoryLoading,
    setInsightSource,
    setIsSubmitting,
    setJobError,
    setJobHistory,
    setJobId,
    setJobRegionCount,
    setJobStatus,
    setLastStrategicPayload,
    setMeterReveal,
    setMixPreFilled,
    setModeHint,
    setPrimaryCampaignType,
    setProfessionalDropdownOpen,
    setProfessionalDropdownRect,
    setProfessionalSegments,
    setRecommendationRefinements,
    setRecommendationSignals,
    setRecommendationUserStateMap,
    setRegionDropdownOpen,
    setRegionInput,
    setRegionWarning,
    setSecondaryCampaignTypes,
    setSelectedAspects,
    setSelectedFacets,
    setShowAddCustomForm,
    setShowMissingFieldsMessage,
    setShowStrategicSetupEditor,
    setShowStrategyDetails,
    setStrategicConfig,
    setStrategicText,
    setStrategyGuidanceMode,
    setStrategyHistory,
    setStrategyStatusPayload,
    setTargetAudience,
    setTentativeStartDate,
    setUsedRecommendationIds,
    setValidationError,
    showAddCustomForm,
    showMissingFieldsMessage,
    showNoCompanyMessage,
    showStrategicSetupEditor,
    showStrategyDetails,
    stabilizationRecommendation,
    strategicConfig,
    strategicFlowState,
    strategicIntents,
    strategicText,
    strategyDrift,
    strategyFocusLabel,
    strategyGuidanceMode,
    strategyHistory,
    strategyStatusPayload,
    suggestedStrategyExplanation,
    suggestedStrategyMode,
    targetAudience,
    tentativeStartDate,
    themesSectionRef,
    usedRecommendationIds,
    validationError,
    viewMode,
    visibleEngineCards,
    visibleEngineCardsWithStatus,
    workspaceSummaryData,
  };
}
