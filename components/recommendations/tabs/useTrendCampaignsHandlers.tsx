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



import type { useTrendCampaignsCore } from './useTrendCampaignsCore';
type CoreState = ReturnType<typeof useTrendCampaignsCore>;
type IntelligentMixContextWithFocus = import('@/pages/command-center/intelligent-mix-strategy').IntelligentMixState & { communicationStyle?: string[]; primaryCampaignType?: import('../../../lib/campaignTypeHierarchy').PrimaryCampaignTypeId; secondaryCampaignTypes?: import('../../../lib/campaignTypeHierarchy').SecondaryOptionId[]; };

export function useTrendCampaignsHandlers(core: CoreState) {
  const {
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
  } = core;

  const openAssistPanel = (topic: string): Promise<AssistContext> => {
    if (pendingAssistContextRef.current) {
      const ctx = pendingAssistContextRef.current;
      pendingAssistContextRef.current = null;
      return Promise.resolve(ctx);
    }
    return new Promise((resolve) => {
      assistResolverRef.current = resolve;
      setAssistTopic(topic);
      setAssistPanelOpen(true);
    });
  };
  const handleAssistConfirm = (ctx: AssistContext) => {
    if (assistResolverRef.current) {
      // Normal flow — resume the awaiting campaign action
      assistResolverRef.current(ctx);
      assistResolverRef.current = null;
    } else {
      // Standalone (blog-flow) mode — stash context for the next campaign action
      pendingAssistContextRef.current = ctx;
    }
    setAssistPanelOpen(false);
  };
  const handleAssistSkip = () => {
    assistResolverRef.current?.(EMPTY_ASSIST_CONTEXT);
    assistResolverRef.current = null;
    pendingAssistContextRef.current = null;
    setAssistPanelOpen(false);
  };
  const selectPrimary = (id: PrimaryCampaignTypeId) => {
    setPrimaryCampaignType(id);
    setSecondaryCampaignTypes([]);
  };
  const toggleSecondary = (id: SecondaryOptionId) => {
    if (primaryCampaignType === 'third_party') return;
    setSecondaryCampaignTypes((prev) => {
      const has = prev.includes(id);
      return has ? prev.filter((t) => t !== id) : [...prev, id];
    });
  };
  const setStrategyModeWithHint = (mode: 'balanced' | 'continue' | 'expand') => {
    setStrategyGuidanceMode(mode);
    const hints: Record<string, string> = {
      balanced: 'Showing both continuation and expansion options.',
      continue: 'Prioritizing themes aligned with your current strategy.',
      expand: 'Prioritizing expansion themes.',
    };
    setModeHint(hints[mode]);
    setTimeout(() => setModeHint(null), 1500);
  };
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

    const base: StrategicPayload = {
      context_mode: contextMode,
      company_context: companyContext,
      selected_offerings: selectedFacets,
      selected_aspect: selectedAspects[0] ?? null,
      selected_aspects: selectedAspects.length > 0 ? selectedAspects : undefined,
      strategic_text: strategicText,
      strategic_intents: campaignFocusLabels.length > 0 ? campaignFocusLabels : undefined,
      regions: regions.length > 0 ? regions : undefined,
      cluster_inputs: clusterInputs?.length ? clusterInputs : undefined,
      focused_modules: contextMode === 'FOCUSED' && focusedModules.length > 0 ? focusedModules : undefined,
      additional_direction: additionalDirection.trim() || undefined,
      primary_campaign_type: hierarchicalPayload.primary_campaign_type,
      secondary_campaign_types: hierarchicalPayload.secondary_campaign_types,
      context: hierarchicalPayload.context,
      mapped_core_types: hierarchicalPayload.mapped_core_types,
    };
    if (
      targetAudience &&
      communicationStyle.length > 0 &&
      contentDepth &&
      frequencyPerWeek &&
      tentativeStartDate &&
      campaignGoal
    ) {
      base.execution_config = {
        target_audience: targetAudience,
        professional_segment: professionalSegments[0] ?? null,
        professional_segments: professionalSegments,
        communication_style: communicationStyle,
        content_depth: contentDepth,
        frequency_per_week: frequencyPerWeek,
        tentative_start: tentativeStartDate.toISOString(),
        campaign_goal: campaignGoal,
      };
    }
    return base;
  };
  const isValid = (): boolean => {
    if (contextMode !== 'NONE') return !!companyId;
    return !!(additionalDirection.trim() || selectedAspects.length >= 1 || selectedFacets.length >= 1 || strategicText.trim() || (clusterInputs && clusterInputs.length > 0));
  };
  const buildAiChatExecutionConfig = (options?: { keyMessages?: string | null; campaignDuration?: number }) => {
    if (!isExecutionFormComplete || !targetAudience || !frequencyPerWeek || !tentativeStartDate || !campaignGoal) {
      return null;
    }

    const resolvedDuration =
      options?.campaignDuration ??
      ((intelligentMixContext as { duration?: number } | null)?.duration ?? 4);
    const trimmedKeyMessage = typeof options?.keyMessages === 'string' ? options.keyMessages.trim() : '';

    // Carry Intelligent Mix format/frequency data so BOLT pipeline knows
    // exactly which content types and how many per week to generate.
    const mix = intelligentMixContext as {
      textFormats?: string[]; creatorFormats?: string[];
      textFrequency?: Record<string, number>; creatorFrequency?: Record<string, number>;
    } | null;
    const formatFrequency: Record<string, number> = {};
    const contentFormats: string[] = [];
    if (mix) {
      for (const f of mix.textFormats ?? []) {
        const count = mix.textFrequency?.[f] ?? 1;
        formatFrequency[f] = count;
        contentFormats.push(f);
      }
      for (const f of mix.creatorFormats ?? []) {
        const count = mix.creatorFrequency?.[f] ?? 1;
        formatFrequency[f] = count;
        contentFormats.push(f);
      }
    }

    return {
      target_audience: targetAudience,
      professional_segment: professionalSegments[0] ?? null,
      professional_segments: professionalSegments,
      communication_style: communicationStyle,
      content_depth: contentDepth ?? null,
      frequency_per_week: frequencyPerWeek,
      tentative_start: tentativeStartDate.toISOString(),
      campaign_goal: campaignGoal,
      available_content: 'none',
      content_capacity: `${frequencyPerWeek} posts per week`,
      action_expectation: campaignGoal,
      exclusive_campaigns: 'none',
      campaign_duration: resolvedDuration,
      intelligent_mix_prefill: true,
      ...(trimmedKeyMessage ? { key_messages: trimmedKeyMessage.slice(0, 200) } : {}),
      ...(contentFormats.length > 0 ? { content_formats: contentFormats } : {}),
      ...(Object.keys(formatFrequency).length > 0 ? { format_frequency: formatFrequency } : {}),
    };
  };
  const focusFirstMissingExecutionField = () => {
    const order = ['targetAudience', 'campaignGoal', 'frequencyPerWeek', 'startDate', 'communicationStyle'] as const;
    for (const key of order) {
      if (requiredExecutionFields.missing.includes(executionFieldKeyToLabel[key])) {
        const el = executionSectionRefs.current[key];
        if (el) {
          setShowMissingFieldsMessage(true);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
    }
  };
  const handleRunClick = () => {
    if (!isExecutionFormComplete && !isSubmitting) {
      setShowMissingFieldsMessage(true);
      if (!mixPreFilled) focusFirstMissingExecutionField();
      return;
    }
    handleRun();
  };
  const handleRun = async () => {
    setValidationError(null);
    setShowMissingFieldsMessage(false);
    if (!companyId) {
      setValidationError('Select a company first.');
      return;
    }
    if (!isExecutionValid) {
      setValidationError('Complete Execution Configuration (audience, style, depth, frequency, start date, goal) before generating themes.');
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
        (payload.mapped_core_types?.length
          ? payload.mapped_core_types[0]
          : primaryCampaignType === 'third_party'
            ? 'third_party'
            : primaryCampaignType) ?? 'brand_awareness';
      const durationFromExec =
        payload.execution_config &&
        typeof payload.execution_config === 'object' &&
        typeof (payload.execution_config as { campaign_duration?: number }).campaign_duration === 'number' &&
        (payload.execution_config as { campaign_duration: number }).campaign_duration >= 4 &&
        (payload.execution_config as { campaign_duration: number }).campaign_duration <= 12
          ? (payload.execution_config as { campaign_duration: number }).campaign_duration
          : 12;
      const recRes = await fetchWithAuth('/api/recommendations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          objective,
          durationWeeks: durationFromExec,
          ...(regionList.length > 0 ? { regions: regionList } : {}),
          strategicPayload: payload,
          insight_source: insightSource,
        }),
      });
      if (!recRes.ok) {
        const recErr = await recRes.json().catch(() => ({}));
        const code = recErr?.error;
        const friendlyMessage =
          code === 'FORBIDDEN_ROLE'
            ? 'You don’t have permission to generate themes. Company Admin or Content Creator role is required for this company.'
            : code === 'COMPANY_SCOPE_VIOLATION' || code === 'Access denied to company'
            ? 'You don’t have access to this company. Select a company you belong to.'
            : code === 'CAMPAIGN_NOT_IN_COMPANY'
            ? 'The selected campaign doesn’t belong to this company.'
            : null;
        const base = friendlyMessage ?? code ?? 'Recommendation engine request failed';
        const detail = recErr?.detail && !friendlyMessage ? ` (${recErr.detail})` : '';
        throw new Error(`${base}${detail}`);
      }
      const recData = await recRes.json().catch(() => null);
      const trends = Array.isArray(recData?.trends_used) ? recData.trends_used : [];
      setGeneratedEngineRecommendations(trends as Array<Record<string, unknown>>);
      setRecommendationRefinements({});
      if (trends.length === 0) {
        setValidationError('Engine returned no recommendations for this input. Adjust context/objective and try again.');
      } else {
        setExecutionCollapsed(true);
        // Create a campaign when themes are generated so "Build Campaign Blueprint" saves the card to this campaign.
        try {
          const newCampaignId = crypto.randomUUID();
          const createRes = await fetchWithAuth('/api/campaigns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: newCampaignId,
              companyId,
              name: 'Campaign from themes',
              description: 'Select a card and click Build Campaign Blueprint to set the strategic theme.',
              status: 'planning',
              current_stage: 'planning',
              build_mode: 'no_context',
            }),
          });
          if (createRes.ok) {
            const createData = await createRes.json().catch(() => ({}));
            const id = createData?.campaign?.id ?? newCampaignId;
            setGeneratedCampaignId(id);
          }
        } catch (_) {
          // If draft campaign creation fails, Build Campaign Blueprint will create a new campaign as before.
          setGeneratedCampaignId(null);
        }
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
  const intentSummaryContent = (): { type: 'summary' | 'warning'; text: React.ReactNode } => {
    if (contextMode === 'NONE') {
      if (!additionalDirection.trim())
        return { type: 'warning', text: 'Please provide research direction when using No Company Context.' };
      const parts: React.ReactNode[] = [];
      if (additionalDirection.trim()) parts.push(<span key="dir">• Research direction: &quot;{additionalDirection.slice(0, 80)}{additionalDirection.length > 80 ? '…' : ''}&quot;</span>);
      if (selectedAspects.length > 0) parts.push(<span key="aspect">• Aspects (OR): {selectedAspects.join(', ')}</span>);
      if (selectedFacets.length > 0) parts.push(<span key="offerings">• Offerings: {selectedFacets.map((id) => id.split(':').slice(1).join(':') || id).join(', ')}</span>);
      if (campaignFocusLabels.length > 0) parts.push(<span key="focus">• Campaign focus: {campaignFocusLabels.join(', ')}</span>);
      if (strategicText.trim()) parts.push(<span key="strategic">• Strategic text: &quot;{strategicText.slice(0, 60)}…&quot;</span>);
      const regionList = regionInputToIsoCodes(regionInput);
      if (regionList.length) parts.push(<span key="regions">• Regions: {regionList.join(', ')}</span>);
      return { type: 'summary', text: <>No company context:<div className="mt-1 space-y-0.5">{parts}</div></> };
    }
    const list = selectedFacets.length ? selectedFacets.map((id) => id.split(':').slice(1).join(':') || id).slice(0, 5) : [];
    const lines: React.ReactNode[] = [<span key="ctx">Context: {contextMode}</span>];
    if (list.length) lines.push(<span key="offerings">• Offerings: {list.join(', ')}</span>);
    if (selectedAspects.length > 0) lines.push(<span key="aspect">• Aspects (OR): {selectedAspects.join(', ')}</span>);
    if (campaignFocusLabels.length > 0) lines.push(<span key="focus">• Campaign focus: {campaignFocusLabels.join(', ')}</span>);
    if (strategicText.trim()) lines.push(<span key="direction">• Direction: &quot;{strategicText.slice(0, 80)}…&quot;</span>);
    const regionList = regionInputToIsoCodes(regionInput);
    if (regionList.length) lines.push(<span key="regions">• Regions: {regionList.join(', ')}</span>);
    return { type: 'summary', text: <div className="space-y-0.5">{lines}</div> };
  };


  useEffect(() => {
    const ctx = intelligentMixContext as IntelligentMixContextWithFocus | null;
    if (!ctx?.autoGenerateThemes || autoRunIntelligentMixRef.current) return;
    if (!companyId || hasRun || isSubmitting || !isExecutionValid) return;
    if (contextMode === 'NONE' && !additionalDirection.trim()) return;
    autoRunIntelligentMixRef.current = true;
    handleRun();
  }, [intelligentMixContext, companyId, hasRun, isSubmitting, isExecutionValid, contextMode, additionalDirection]);

  const intentSummary = intentSummaryContent();

  return {
    buildAiChatExecutionConfig,
    buildStrategicPayload,
    fetchProfile,
    focusFirstMissingExecutionField,
    handleAddCustomPillar,
    handleAssistConfirm,
    handleAssistSkip,
    handleRun,
    handleRunClick,
    handleViewIntelligence,
    intentSummary, intentSummaryContent,
    isValid,
    openAssistPanel,
    selectPrimary,
    setStrategyModeWithHint,
    toggleSecondary,
  };
}
