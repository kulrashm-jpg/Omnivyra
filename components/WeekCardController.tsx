/** useWeekCardController — state/effects/handlers of WeekCard, verbatim. */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { 
  ArrowLeft, 
  Calendar, 
  Target, 
  Plus, 
  Save, 
  CheckCircle,
  AlertCircle,
  Clock,
  TrendingUp,
  FileText,
  Image,
  Video,
  Mic,
  Loader2,
  X,
  Sparkles,
  Eye,
  BarChart3,
  Users,
  Hash,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Settings,
  GripVertical,
  RotateCcw,
  Activity,
} from 'lucide-react';
import CampaignAIChat from './CampaignAIChat';
import AIGenerationProgress from './AIGenerationProgress';
import { useCompanyContext } from './CompanyContext';
import { fetchWithAuth } from './community-ai/fetchWithAuth';
import { GovernanceStatusCard } from './governance/GovernanceStatusCard';
import { GovernanceAnalyticsCard } from './governance/GovernanceAnalyticsCard';
import { GovernanceExplanationPanel, deriveFromEvent } from './governance/GovernanceExplanationPanel';
import { GovernanceTimeline } from './governance/GovernanceTimeline';
import { PreemptionHistory } from './governance/PreemptionHistory';
import { TradeOffSuggestionList } from './governance/TradeOffSuggestionList';
import { truncateMeaningfulTitle } from '../lib/ui/truncateMeaningfulTitle';
import { getExecutionIntelligence } from '../utils/getExecutionIntelligence';
import { isCreatorDependentContentType } from '../utils/contentTaxonomy';
import { getFormatLineForContentType, getIntentLabelForContentType, toneForUserDisplay } from '../utils/formatLineForContentType';
import PlatformIcon from './ui/PlatformIcon';
import { getViewMode } from '../utils/getViewMode';
import { VIEW_RULES } from '../utils/viewVisibilityMatrix';
import {
  saveWizardState,
  loadWizardState,
  clearWizardState,
  defaultQuestionnaireAnswers,
  type QuestionnaireAnswers,
  type PrePlanningResult,
} from '../utils/campaignWizardStorage';
import { ENABLE_UNIFIED_CAMPAIGN_WIZARD } from '../config/featureFlags';
import { useCampaignWizard, createCampaignWizardStore } from '../store/campaignWizardStore';
import { hydrateWizardFromSnapshot, exportWizardToSaveWizardStatePayload, exportWizardToPlanningContext } from '../lib/wizard/campaignWizardAdapter';
import { useCampaignResume } from '../hooks/useCampaignResume';
import { PLATFORM_LABELS } from '../lib/shared/platforms';

import type { useCampaignDetailsState } from '../hooks/useCampaignDetailsState';
type S = ReturnType<typeof useCampaignDetailsState>;
import type { Campaign, WeeklyPlan, DailyPlan, ReadinessResponse, GateResponse, GateRequiredAction, DiagnosticSummary, ViralityAssessmentResponse, RecommendationSummary, PerformanceSummary } from '../pages/campaign-details/types';

export function useWeekCardController({ weekNumber, d }: { weekNumber: number; d: S }) {
  const {
    _ef1,
    _ef2,
    _ef3,
    _ef4,
    _ef5,
    acceptDuration,
    activeTab,
    aiSuggestion,
    aiSuggestionLoading,
    blueprintFrozen,
    blueprintGeneratedSuccess,
    blueprintImmutable,
    blueprintRegenerateFailedMsg,
    buildCampaignCalendarUrl,
    buildCampaignDetailsUrl,
    buildDailyPlanPageUrl,
    buildPlanningWorkspaceUrl,
    campaign,
    campaignMode,
    createWeekPlanFromStoredContext,
    crossPlatformSharingEnabled,
    crossPlatformSharingEnabledLegacy,
    dailyPlans,
    didAutoOpenChatRef,
    displayWeeklyTitle,
    distributionMode,
    durationWeeks,
    editedWeekDailyPlans,
    effectiveCompanyId,
    enhanceAllWeeksWithAI,
    enhanceWeekWithAI,
    executionDrift,
    executionHealth,
    executionMomentum,
    executionMomentumRecovery,
    executionPressure,
    expandedDiagnostics,
    expandedSystemWeek,
    expandedWeeks,
    fetchAiDurationSuggestion,
    focusQueryValue,
    frequencyValidation,
    frequencyValidationTimeoutRef,
    fromOpportunity,
    getActivityColorClasses,
    getConfidenceBadgeColor,
    getGateBadgeColor,
    getGateLabel,
    getPhaseColor,
    getStageColor,
    getStageLabel,
    getStatusColor,
    getWeekDatesFromCampaignStart,
    governanceAnalytics,
    governanceAuditStatus,
    governanceEvents,
    governanceLatestSnapshotId,
    governanceLedgerIntegrity,
    governanceLoadGuardCounts,
    governanceLoading,
    governanceLocked,
    governanceSnapshotAt,
    governanceSnapshotCount,
    governanceStatus,
    handleDailyPlanDragOver,
    handleDailyPlanDragStart,
    handleDailyPlanDrop,
    hasRestoredWizardStateRef,
    isAdmin,
    isEnhancingAllWeeks,
    isGeneratingWeek,
    isLoading,
    isRegeneratingBlueprint,
    isSavingWeekPlan,
    isViralityExpanded,
    isVisualContentType,
    isWeeklyBlueprintFocus,
    loadCampaignDetails,
    loadGovernance,
    needsPrePlanning,
    negotiationLoading,
    negotiationMessage,
    negotiationResult,
    normalizeComparableText,
    notice,
    notify,
    openCampaignCalendar,
    openTopicWorkspaceFromWeeklyCard,
    performanceSummary,
    planDurationLimit,
    plannedStartDate,
    plannedStartDateLegacy,
    plannerQueryConsumed,
    prePlanningLoading,
    prePlanningResult,
    prePlanningResultLegacy,
    prePlanningWizardStep,
    prePlanningWizardStepLegacy,
    prefilledPlanning,
    questionnaireAnswers,
    questionnaireAnswersLegacy,
    readiness,
    recommendationContext,
    recommendationId,
    recommendationSummary,
    regenerateWeekDailyPlan,
    requestedWeeksForPreplan,
    router,
    runPrePlanningFlow,
    saveWeekDailyPlan,
    selectedCompanyId,
    selectedWeekDay,
    session,
    setActiveTab,
    setAiSuggestion,
    setAiSuggestionLoading,
    setBlueprintFrozen,
    setBlueprintGeneratedSuccess,
    setBlueprintImmutable,
    setBlueprintRegenerateFailedMsg,
    setCampaign,
    setCampaignMode,
    setCrossPlatformSharingEnabled,
    setCrossPlatformSharingEnabledLegacy,
    setDailyPlans,
    setDistributionMode,
    setEditedWeekDailyPlans,
    setExecutionDrift,
    setExecutionHealth,
    setExecutionMomentum,
    setExecutionMomentumRecovery,
    setExecutionPressure,
    setExpandedDiagnostics,
    setExpandedSystemWeek,
    setExpandedWeeks,
    setFrequencyValidation,
    setGovernanceAnalytics,
    setGovernanceAuditStatus,
    setGovernanceEvents,
    setGovernanceLatestSnapshotId,
    setGovernanceLedgerIntegrity,
    setGovernanceLoadGuardCounts,
    setGovernanceLoading,
    setGovernanceLocked,
    setGovernanceSnapshotAt,
    setGovernanceSnapshotCount,
    setGovernanceStatus,
    setIsAdmin,
    setIsEnhancingAllWeeks,
    setIsGeneratingWeek,
    setIsLoading,
    setIsRegeneratingBlueprint,
    setIsSavingWeekPlan,
    setIsViralityExpanded,
    setNegotiationLoading,
    setNegotiationMessage,
    setNegotiationResult,
    setNotice,
    setPerformanceSummary,
    setPlanDurationLimit,
    setPlannedStartDate,
    setPlannedStartDateLegacy,
    setPlannerQueryConsumed,
    setPrePlanningLoading,
    setPrePlanningResult,
    setPrePlanningResultLegacy,
    setPrePlanningWizardStep,
    setPrePlanningWizardStepLegacy,
    setPrefilledPlanning,
    setQuestionnaireAnswers,
    setQuestionnaireAnswersLegacy,
    setReadiness,
    setRecommendationContext,
    setRecommendationId,
    setRecommendationSummary,
    setRequestedWeeksForPreplan,
    setSelectedCompanyId,
    setSelectedWeekDay,
    setShowAIChat,
    setShowAdvisoryNotes,
    setShowRequiredActions,
    setViralityDiagnostics,
    setViralityGate,
    setWeeklyPlans,
    shouldForceWeeklyBlueprintView,
    showAIChat,
    showAdvisoryNotes,
    showRequiredActions,
    toggleDiagnostic,
    toggleWeekExpansion,
    viewMode,
    viralityDiagnostics,
    viralityGate,
    weeklyPlans,
    wizardStateDbSaveTimeoutRef,
    wizardStore,
    id,
  } = d;
                  const weekPlan = weeklyPlans.find(w => w.weekNumber === weekNumber);
                  const isExpanded = expandedWeeks.has(weekNumber);
                  const weekDailyPlans = dailyPlans.filter(d => d.weekNumber === weekNumber);
                  const hasEnrichedTopics =
                    Array.isArray((weekPlan as any)?.topics) && (weekPlan as any).topics.length > 0;
                  const platformTargets = Object.entries((weekPlan as any)?.platform_allocation || {})
                    .map(([platform, count]) => `${platform}: ${count}`)
                    .filter(Boolean);
                  const contentTypes = Array.isArray((weekPlan as any)?.contentTypes)
                    ? (weekPlan as any).contentTypes
                    : (Array.isArray((weekPlan as any)?.content_type_mix) ? (weekPlan as any).content_type_mix : []);
                  const executionItems = Array.isArray((weekPlan as any)?.execution_items) ? (weekPlan as any).execution_items : [];
                  const flatSlots = executionItems.flatMap((e: any) => Array.isArray(e?.topic_slots) ? e.topic_slots : []);
                  let slotIndexGlobal = 0;
                  const contentTypesBySlotIndex = executionItems.flatMap((e: any) =>
                    (Array.isArray(e?.topic_slots) ? e.topic_slots : []).map(() => {
                      const fromExec = String((e as any)?.content_type ?? (e as any)?.contentType ?? '').trim();
                      const fallback = contentTypes[slotIndexGlobal % Math.max(contentTypes.length, 1)] || '—';
                      slotIndexGlobal += 1;
                      return fromExec || fallback;
                    })
                  );
                  const ownershipCounts = (() => {
                    let ai = 0, creator = 0, conditional = 0;
                    flatSlots.forEach((s: any) => {
                      const m = s?.execution_mode;
                      if (m === 'AI_AUTOMATED') ai += 1;
                      else if (m === 'CREATOR_REQUIRED') creator += 1;
                      else if (m === 'CONDITIONAL_AI') conditional += 1;
                    });
                    return { ai, creator, conditional, total: ai + creator + conditional };
                  })();
                  const creatorShare = ownershipCounts.total > 0
                    ? (ownershipCounts.creator + ownershipCounts.conditional) / ownershipCounts.total
                    : 0;
                  const showHighCreatorWorkload = creatorShare > 0.6;

                  // CMO: Execution Risk — creatorRatio = (creator + conditional*0.7) / total
                  const creatorRatio = ownershipCounts.total > 0
                    ? (ownershipCounts.creator + ownershipCounts.conditional * 0.7) / ownershipCounts.total
                    : 0;
                  const executionRiskLabel = creatorRatio <= 0.35 ? 'LOW' : creatorRatio <= 0.65 ? 'MEDIUM' : 'HIGH';
                  const executionRiskClass = creatorRatio <= 0.35 ? 'bg-emerald-100 text-emerald-800' : creatorRatio <= 0.65 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800';

                  // CMO/SYSTEM: Execution Pressure (system-only) — same chip size as Execution Risk
                  const weekIntelligence = getExecutionIntelligence(undefined, ownershipCounts);
                  const pressureLabel = weekIntelligence.pressureLabel;
                  const pressureColorClass = weekIntelligence.pressureColorClass;

                  // AUTO EXECUTION BALANCER: read-only recommendations when pressure is HIGH (no DB/API changes)
                  const executionBalancerRecommendations = (() => {
                    if (pressureLabel !== 'HIGH' || ownershipCounts.total <= 0) return [];
                    const creatorRatio = ownershipCounts.creator / ownershipCounts.total;
                    const conditionalRatio = ownershipCounts.conditional / ownershipCounts.total;
                    const recs: string[] = [];
                    if (creatorRatio > 0.5) recs.push('Reduce creator-dependent content or stagger execution.');
                    if (conditionalRatio > 0.2) recs.push('Templates could unlock more AI execution.');
                    if (ownershipCounts.creator + ownershipCounts.conditional > ownershipCounts.ai) {
                      recs.push('Consider shifting some ideas toward AI-executable formats.');
                    }
                    return recs.slice(0, 3);
                  })();

                  // CMO: Capacity Fit — only if weekly capacity value exists
                  const weeklyCapacity = typeof (weekPlan as any)?.capacity === 'number' && Number.isFinite((weekPlan as any).capacity)
                    ? (weekPlan as any).capacity
                    : typeof (weekPlan as any)?.weekly_capacity === 'number' && Number.isFinite((weekPlan as any).weekly_capacity)
                      ? (weekPlan as any).weekly_capacity
                      : null;
                  const creatorLoad = ownershipCounts.creator + ownershipCounts.conditional;
                  const capacityRatio = weeklyCapacity != null && weeklyCapacity > 0 ? creatorLoad / weeklyCapacity : null;
                  const capacityFitLabel = capacityRatio == null ? null : capacityRatio <= 0.8 ? 'Strong' : capacityRatio <= 1 ? 'Tight' : 'Overloaded';
                  const capacityFitClass = capacityRatio != null ? (capacityRatio <= 0.8 ? 'bg-gray-100 text-gray-700' : capacityRatio <= 1 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700') : '';

                  // CMO: Momentum — current vs previous week creator share
                  const prevWeekPlan = weekNumber > 1 ? weeklyPlans.find((w: any) => w.weekNumber === weekNumber - 1) : null;
                  const prevFlatSlots = prevWeekPlan && Array.isArray((prevWeekPlan as any)?.execution_items)
                    ? (prevWeekPlan as any).execution_items.flatMap((e: any) => Array.isArray(e?.topic_slots) ? e.topic_slots : [])
                    : [];
                  const prevCounts = (() => {
                    let ai = 0, creator = 0, conditional = 0;
                    prevFlatSlots.forEach((s: any) => {
                      const m = s?.execution_mode;
                      if (m === 'AI_AUTOMATED') ai += 1;
                      else if (m === 'CREATOR_REQUIRED') creator += 1;
                      else if (m === 'CONDITIONAL_AI') conditional += 1;
                    });
                    const total = ai + creator + conditional;
                    return { creator, conditional, total };
                  })();
                  const prevCreatorShare = prevCounts.total > 0 ? (prevCounts.creator + prevCounts.conditional) / prevCounts.total : null;
                  const momentumLabel = prevCreatorShare == null ? null
                    : creatorShare < prevCreatorShare - 0.1 ? 'Building ↑'
                    : Math.abs(creatorShare - prevCreatorShare) <= 0.1 ? 'Balanced →'
                    : creatorShare > prevCreatorShare + 0.1 ? 'Heavy Load ↓'
                    : 'Balanced →';
                  // --- Activity card derivation for BOLT / legacy campaigns (no topics[] in blueprint) ---
                  //
                  // Card count = unique CONTENT PIECES (not DB rows).
                  // Distribution mode determines uniqueness:
                  //   SHARED  (default): same piece goes to all platforms → 1 card per (topic + contentType)
                  //   STAGGERED        : each platform gets UNIQUE content → 1 card per (topic + contentType + platform)
                  //
                  // Card count formula with sharing ON, N platforms, M content types, K pieces per type:
                  //   total = sum over each type: ceil(K / N)
                  // e.g. 3 posts + 3 articles on 1 platform → 6 cards
                  //      3 posts + 3 articles on 2 platforms (sharing) → ceil(3/2)×2 = 4 cards
                  //      3 posts + 3 articles on 3 platforms (sharing) → ceil(3/3)×2 = 2 cards

                  // Detect distribution mode from daily plan rows (populated by generate-weekly-structure)
                  const weekIsStaggered = weekDailyPlans.length > 0
                    ? (weekDailyPlans as any[]).some((p) => p.distribution_strategy === 'STAGGERED')
                    : (weekPlan as any)?.distribution_strategy === 'STAGGERED';

                  const formatPlatformLabel = (platform: unknown) => {
                    const key = String(platform ?? '').trim().toLowerCase();
                    if (!key) return '';
                    return PLATFORM_LABELS[key as keyof typeof PLATFORM_LABELS] || key.charAt(0).toUpperCase() + key.slice(1);
                  };

                  // Source 1: execution_items.topic_slots (unique content pieces from blueprint)
                  const topicBriefs = Array.isArray((weekPlan as any)?.topics) ? ((weekPlan as any).topics as any[]) : [];
                  const derivedTopicsFromSlots = executionItems.flatMap((exec: any, execIdx: number) => {
                    const slots = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
                    const selectedPlatforms = Array.isArray(exec?.selected_platforms)
                      ? exec.selected_platforms.map((p: unknown) => String(p ?? '').trim().toLowerCase()).filter(Boolean)
                      : [];
                    const fallbackPlatforms = Array.isArray(exec?.platform_options)
                      ? exec.platform_options.map((p: unknown) => String(p ?? '').trim().toLowerCase()).filter(Boolean)
                      : [];
                    const slotPlatforms = Array.isArray(exec?.slot_platforms) ? exec.slot_platforms : [];
                    const contentType = String(exec?.content_type ?? exec?.contentType ?? 'post').trim() || 'post';
                    const isCreator = isCreatorDependentContentType(contentType);
                    return slots.map((slot: any, slotIdx: number) => {
                      const intent = slot?.intent && typeof slot.intent === 'object' ? slot.intent : {};
                      const matchedTopic = topicBriefs.find((topic) => {
                        const meta = (topic as any)?.execution_meta;
                        if (meta && Number(meta.exec_index) === execIdx && Number(meta.slot_index) === slotIdx) return true;
                        return String(topic?.topicTitle ?? '').trim() === String(slot?.topic ?? '').trim();
                      });
                      const creatorCard =
                        slot?.creator_card && typeof slot.creator_card === 'object'
                          ? slot.creator_card
                          : slot?.intent
                            ? {
                                ...(!isCreator ? {
                                  hook: slot.intent?.hook || undefined,
                                  key_points: Array.isArray(slot.intent?.key_points) ? slot.intent.key_points : undefined,
                                  seo_focus: slot.intent?.seo_focus || undefined,
                                  keywords: Array.isArray(slot.intent?.keywords) ? slot.intent.keywords : undefined,
                                  hashtags: Array.isArray(slot.intent?.hashtags) ? slot.intent.hashtags : undefined,
                                  repurpose_angles: Array.isArray(slot.intent?.repurpose_angles) ? slot.intent.repurpose_angles : undefined,
                                } : {}),
                                ...(isCreator ? {
                                  visual_hook: slot.intent?.visual_hook || undefined,
                                  image_prompt: slot.intent?.image_prompt || undefined,
                                  video_prompt: slot.intent?.video_prompt || undefined,
                                  scene_direction: slot.intent?.scene_direction || undefined,
                                  keywords: Array.isArray(slot.intent?.keywords) ? slot.intent.keywords : undefined,
                                  hashtags: Array.isArray(slot.intent?.hashtags) ? slot.intent.hashtags : undefined,
                                } : {}),
                                summary: slot.intent?.brief_summary || undefined,
                                objective: slot.intent?.objective || undefined,
                                target_audience: slot.intent?.target_audience || undefined,
                                intent: slot.intent,
                              }
                            : undefined;
                      const platformsForSlot = (
                        Array.isArray(slotPlatforms[slotIdx]) && slotPlatforms[slotIdx].length > 0
                          ? slotPlatforms[slotIdx]
                          : (selectedPlatforms.length > 0 ? selectedPlatforms : fallbackPlatforms)
                      )
                        .map((p: unknown) => String(p ?? '').trim().toLowerCase())
                        .filter(Boolean);
                      return {
                        ...(matchedTopic && typeof matchedTopic === 'object' ? matchedTopic : {}),
                        topicTitle: matchedTopic?.topicTitle || String(slot?.topic ?? '').trim() || `Activity ${execIdx + 1}.${slotIdx + 1}`,
                        whoAreWeWritingFor:
                          matchedTopic?.whoAreWeWritingFor ||
                          String((intent as any)?.target_audience ?? '').trim() ||
                          undefined,
                        whatProblemAreWeAddressing:
                          matchedTopic?.whatProblemAreWeAddressing ||
                          String((intent as any)?.pain_point ?? '').trim() ||
                          undefined,
                        whatShouldReaderLearn:
                          matchedTopic?.whatShouldReaderLearn ||
                          String((intent as any)?.outcome_promise ?? '').trim() ||
                          undefined,
                        desiredAction:
                          matchedTopic?.desiredAction ||
                          String((intent as any)?.cta_type ?? (weekPlan as any)?.cta_type ?? '').trim() ||
                          undefined,
                        narrativeStyle:
                          matchedTopic?.narrativeStyle ||
                          String((weekPlan as any)?.weeklyContextCapsule?.toneGuidance ?? (intent as any)?.writing_angle ?? slot?.writer_content_brief?.tone ?? '').trim() ||
                          undefined,
                        topicContext: {
                          ...(matchedTopic?.topicContext && typeof matchedTopic.topicContext === 'object' ? matchedTopic.topicContext : {}),
                          writingIntent:
                            matchedTopic?.topicContext?.writingIntent ||
                            String((intent as any)?.brief_summary ?? (intent as any)?.writing_intent ?? '').trim() ||
                            undefined,
                        },
                        _contentType: contentType,
                        _platforms: platformsForSlot.map(formatPlatformLabel).filter(Boolean),
                        _execMode: String(slot?.execution_mode ?? (isCreator ? 'CREATOR_REQUIRED' : 'AI_AUTOMATED')).trim() || undefined,
                        _creatorInstruction: (slot?.creator_instruction && typeof slot.creator_instruction === 'object') ? slot.creator_instruction : undefined,
                        _isCreator: isCreator,
                        _creatorCard: creatorCard,
                      };
                    });
                  });

                  // Source 2: resolved/daily execution items when blueprint topics are still collapsed
                  const postingSource = Array.isArray((weekPlan as any)?.resolved_postings) && (weekPlan as any).resolved_postings.length > 0
                    ? ((weekPlan as any).resolved_postings as any[])
                    : (Array.isArray((weekPlan as any)?.daily_execution_items) ? ((weekPlan as any).daily_execution_items as any[]) : []);
                  const derivedTopicsFromResolvedPostings = postingSource.length > 0
                    ? (() => {
                        const seen = new Set<string>();
                        const cards: any[] = [];
                        postingSource.forEach((posting: any, idx: number) => {
                          const contentType = String(posting?.content_type ?? posting?.contentType ?? 'post').trim().toLowerCase() || 'post';
                          const platform = String(posting?.platform ?? '').trim().toLowerCase();
                          const uniqueKey = String(posting?.master_content_id ?? posting?.posting_id ?? posting?.execution_id ?? '').trim()
                            || `${String(posting?.topic ?? '').trim().toLowerCase()}::${contentType}::${weekIsStaggered ? platform : 'shared'}::${idx}`;
                          if (seen.has(uniqueKey)) return;
                          seen.add(uniqueKey);
                          const isCreator = isCreatorDependentContentType(contentType);
                          const intent = posting?.intent && typeof posting.intent === 'object'
                            ? posting.intent
                            : posting?.writer_content_brief && typeof posting.writer_content_brief === 'object'
                              ? posting.writer_content_brief
                              : {};
                          cards.push({
                            topicTitle: String(posting?.topic ?? posting?.title ?? '').trim() || `Activity ${idx + 1}`,
                            whoAreWeWritingFor: String((intent as any)?.target_audience ?? '').trim() || undefined,
                            whatProblemAreWeAddressing: String((intent as any)?.pain_point ?? posting?.summary ?? '').trim() || undefined,
                            whatShouldReaderLearn: String((intent as any)?.outcome_promise ?? posting?.introObjective ?? '').trim() || undefined,
                            desiredAction: String((intent as any)?.cta_type ?? posting?.cta ?? '').trim() || undefined,
                            narrativeStyle: String((weekPlan as any)?.weeklyContextCapsule?.toneGuidance ?? posting?.brandVoice ?? '').trim() || undefined,
                            topicContext: {
                              writingIntent: String((intent as any)?.brief_summary ?? posting?.description ?? posting?.objective ?? '').trim() || undefined,
                            },
                            _contentType: contentType,
                            _platforms: platform ? [formatPlatformLabel(platform)] : [],
                            _execMode: String(posting?.execution_mode ?? (isCreator ? 'CREATOR_REQUIRED' : 'AI_AUTOMATED')).trim() || undefined,
                            _creatorInstruction: posting?.creator_instruction && typeof posting.creator_instruction === 'object' ? posting.creator_instruction : undefined,
                            _isCreator: isCreator,
                            _creatorCard: posting?.creator_card && typeof posting.creator_card === 'object' ? posting.creator_card : undefined,
                          });
                        });
                        return cards;
                      })()
                    : [];

                  // Source 2: daily_content_plans rows (populated by generate-weekly-structure, most up-to-date).
                  // Deduplication key depends on distribution mode:
                  //   Shared    → (topicTitle, contentType)           : same piece on multiple platforms = 1 card
                  //   Staggered → (topicTitle, contentType, platform) : each platform's piece = separate card
                  const derivedTopicsFromDailyPlans = weekDailyPlans.length > 0
                    ? (() => {
                        const seen = new Set<string>();
                        const cards: any[] = [];
                        for (const p of weekDailyPlans as any[]) {
                          const daily = p.dailyObject as any;
                          const topicTitle = String(p.title || p.topic || daily?.topicTitle || '').trim();
                          const contentType = String(p.contentType || daily?.contentType || 'post').toLowerCase();
                          const platform = String(p.platform || '').toLowerCase();
                          // Dedup key: include platform only when staggered (unique content per platform)
                          const dedupeKey = weekIsStaggered
                            ? `${topicTitle.toLowerCase()}::${contentType}::${platform}`
                            : `${topicTitle.toLowerCase()}::${contentType}`;
                          if (seen.has(dedupeKey)) continue;
                          seen.add(dedupeKey);
                          // For shared mode: collect all platforms this (topic+contentType) appears on
                          // For staggered mode: this card is already platform-specific
                          const allPlatforms = weekIsStaggered
                            ? (platform ? [platform] : [])
                            : (() => {
                                const ps = (weekDailyPlans as any[])
                                  .filter((q: any) => {
                                    const qt = String(q.title || q.topic || q.dailyObject?.topicTitle || '').trim().toLowerCase();
                                    const qc = String(q.contentType || q.dailyObject?.contentType || 'post').toLowerCase();
                                    return qt === topicTitle.toLowerCase() && qc === contentType;
                                  })
                                  .map((q: any) => String(q.platform || '').toLowerCase())
                                  .filter(Boolean);
                                return [...new Set(ps)];
                              })();
                          const isCreator = isCreatorDependentContentType(contentType);
                          // creator_card from the daily-plans API (built by buildCreatorCard — contains all rich fields)
                          const creatorCard = (p.creator_card && typeof p.creator_card === 'object') ? p.creator_card : undefined;
                          // For text cards: pull enrichment fields from writerBrief/intent stored in daily object
                          // The content column JSON contains the full enriched item including intent.hook, intent.key_points, etc.
                          const writerBrief = daily?.writer_brief ?? daily?.writerBrief;
                          const intentData = daily?.intent ?? writerBrief ?? null;
                          // Synthesised creator_card also carries text enrichment for non-creator types
                          // Merge: prefer creator_card fields (most complete), fall back to intent fields
                          const enrichedCreatorCard = !isCreator && !creatorCard && intentData ? {
                            hook: intentData?.hook || undefined,
                            key_points: Array.isArray(intentData?.key_points) ? intentData.key_points : undefined,
                            seo_focus: intentData?.seo_focus || undefined,
                            keywords: Array.isArray(intentData?.keywords) ? intentData.keywords : undefined,
                            hashtags: Array.isArray(intentData?.hashtags) ? intentData.hashtags : undefined,
                            repurpose_angles: Array.isArray(intentData?.repurpose_angles) ? intentData.repurpose_angles : undefined,
                            intent: intentData,
                          } : creatorCard;
                          cards.push({
                            topicTitle: topicTitle || undefined,
                            whoAreWeWritingFor: daily?.whoAreWeWritingFor || undefined,
                            whatProblemAreWeAddressing: p.summary || daily?.whatProblemAreWeAddressing || undefined,
                            whatShouldReaderLearn: p.introObjective || daily?.whatShouldReaderLearn || undefined,
                            desiredAction: p.cta || daily?.desiredAction || undefined,
                            narrativeStyle: p.brandVoice || daily?.narrativeStyle || undefined,
                            topicContext: (p.description || p.objective)
                              ? { writingIntent: p.description || p.objective }
                              : undefined,
                            _contentType: contentType,
                            _platforms: allPlatforms.length > 0 ? allPlatforms : (platform ? [platform] : []),
                            _execMode: daily?.execution_mode || (isCreator ? 'CREATOR_REQUIRED' : 'AI_AUTOMATED'),
                            _day: p.dayOfWeek || undefined,
                            _isCreator: isCreator,
                            _creatorCard: enrichedCreatorCard,
                          });
                        }
                        return cards;
                      })()
                    : [];

                  const bestDerivedTopics = [derivedTopicsFromSlots, derivedTopicsFromResolvedPostings, derivedTopicsFromDailyPlans]
                    .filter((items) => Array.isArray(items) && items.length > 0)
                    .sort((a, b) => b.length - a.length)[0] ?? [];
                  const effectiveHasTopics = bestDerivedTopics.length > 0 || hasEnrichedTopics;

                  const topicsWithExecution = bestDerivedTopics.length > 0
                    ? bestDerivedTopics.map((topic: any, idx: number) => ({
                        ...topic,
                        topicExecution: {
                          platformTargets: topic._platforms && topic._platforms.length > 0
                            ? topic._platforms
                            : (platformTargets.length > 0 ? [platformTargets[idx % Math.max(platformTargets.length, 1)].split(':')[0].trim()] : ['—']),
                          contentType: topic._contentType || contentTypes[idx % Math.max(contentTypes.length, 1)] || '—',
                          ctaType: (weekPlan as any)?.cta_type || topic.desiredAction || '—',
                          kpiFocus: (weekPlan as any)?.weekly_kpi_focus || '—',
                          ...(topic._execMode ? { execution_mode: topic._execMode } : {}),
                          ...(topic._creatorInstruction ? { creator_instruction: topic._creatorInstruction } : {}),
                        },
                      }))
                    : hasEnrichedTopics
                    ? (((weekPlan as any).topics as any[]).map((topic, idx) => {
                        const slot = flatSlots[idx];
                        const ct = (contentTypesBySlotIndex[idx] ?? contentTypes[idx % Math.max(contentTypes.length, 1)] ?? '—') || '—';
                        const execution_mode = typeof (slot as any)?.execution_mode === 'string' ? (slot as any).execution_mode : undefined;
                        const creator_instruction = (slot as any)?.creator_instruction && typeof (slot as any).creator_instruction === 'object' ? (slot as any).creator_instruction : undefined;
                        const creator_card = (slot as any)?.creator_card && typeof (slot as any).creator_card === 'object' ? (slot as any).creator_card : undefined;
                        const isCreator = isCreatorDependentContentType(ct);
                        return {
                          ...topic,
                          _isCreator: isCreator,
                          _creatorCard: creator_card,
                          topicExecution: {
                            platformTargets: platformTargets.length > 0
                              ? [platformTargets[idx % platformTargets.length]]
                              : ['—'],
                            contentType: ct,
                            ctaType: (weekPlan as any)?.cta_type || '—',
                            kpiFocus: (weekPlan as any)?.weekly_kpi_focus || '—',
                            ...(execution_mode ? { execution_mode } : {}),
                            ...(creator_instruction ? { creator_instruction } : {}),
                          },
                        };
                      }))
                    : [];

                  const topicsCount = effectiveHasTopics
                    ? topicsWithExecution.length
                    : (((weekPlan as any)?.topics_to_cover as string[] | undefined)?.length ?? 0);
                  
  return {
    weekNumber, d,
    _ef1, _ef2, _ef3, _ef4, _ef5, acceptDuration, activeTab, aiSuggestion, aiSuggestionLoading,
    bestDerivedTopics, blueprintFrozen, blueprintGeneratedSuccess, blueprintImmutable,
    blueprintRegenerateFailedMsg, buildCampaignCalendarUrl, buildCampaignDetailsUrl, buildDailyPlanPageUrl,
    buildPlanningWorkspaceUrl, campaign, campaignMode, capacityFitClass, capacityFitLabel, capacityRatio,
    contentTypes, contentTypesBySlotIndex, createWeekPlanFromStoredContext, creatorLoad, creatorRatio,
    creatorShare, crossPlatformSharingEnabled, crossPlatformSharingEnabledLegacy, dailyPlans,
    derivedTopicsFromDailyPlans, derivedTopicsFromResolvedPostings, derivedTopicsFromSlots, didAutoOpenChatRef,
    displayWeeklyTitle, distributionMode, durationWeeks, editedWeekDailyPlans, effectiveCompanyId,
    effectiveHasTopics, enhanceAllWeeksWithAI, enhanceWeekWithAI, executionBalancerRecommendations,
    executionDrift, executionHealth, executionItems, executionMomentum, executionMomentumRecovery,
    executionPressure, executionRiskClass, executionRiskLabel, expandedDiagnostics, expandedSystemWeek,
    expandedWeeks, fetchAiDurationSuggestion, flatSlots, focusQueryValue, formatPlatformLabel,
    frequencyValidation, frequencyValidationTimeoutRef, fromOpportunity, getActivityColorClasses,
    getConfidenceBadgeColor, getGateBadgeColor, getGateLabel, getPhaseColor, getStageColor, getStageLabel,
    getStatusColor, getWeekDatesFromCampaignStart, governanceAnalytics, governanceAuditStatus,
    governanceEvents, governanceLatestSnapshotId, governanceLedgerIntegrity, governanceLoadGuardCounts,
    governanceLoading, governanceLocked, governanceSnapshotAt, governanceSnapshotCount, governanceStatus,
    handleDailyPlanDragOver, handleDailyPlanDragStart, handleDailyPlanDrop, hasEnrichedTopics,
    hasRestoredWizardStateRef, id, isAdmin, isEnhancingAllWeeks, isExpanded, isGeneratingWeek, isLoading,
    isRegeneratingBlueprint, isSavingWeekPlan, isViralityExpanded, isVisualContentType, isWeeklyBlueprintFocus,
    loadCampaignDetails, loadGovernance, momentumLabel, needsPrePlanning, negotiationLoading,
    negotiationMessage, negotiationResult, normalizeComparableText, notice, notify, openCampaignCalendar,
    openTopicWorkspaceFromWeeklyCard, ownershipCounts, performanceSummary, planDurationLimit, plannedStartDate,
    plannedStartDateLegacy, plannerQueryConsumed, platformTargets, postingSource, prePlanningLoading,
    prePlanningResult, prePlanningResultLegacy, prePlanningWizardStep, prePlanningWizardStepLegacy,
    prefilledPlanning, pressureColorClass, pressureLabel, prevCounts, prevCreatorShare, prevFlatSlots,
    prevWeekPlan, questionnaireAnswers, questionnaireAnswersLegacy, readiness, recommendationContext,
    recommendationId, recommendationSummary, regenerateWeekDailyPlan, requestedWeeksForPreplan, router,
    runPrePlanningFlow, saveWeekDailyPlan, selectedCompanyId, selectedWeekDay, session, setActiveTab,
    setAiSuggestion, setAiSuggestionLoading, setBlueprintFrozen, setBlueprintGeneratedSuccess,
    setBlueprintImmutable, setBlueprintRegenerateFailedMsg, setCampaign, setCampaignMode,
    setCrossPlatformSharingEnabled, setCrossPlatformSharingEnabledLegacy, setDailyPlans, setDistributionMode,
    setEditedWeekDailyPlans, setExecutionDrift, setExecutionHealth, setExecutionMomentum,
    setExecutionMomentumRecovery, setExecutionPressure, setExpandedDiagnostics, setExpandedSystemWeek,
    setExpandedWeeks, setFrequencyValidation, setGovernanceAnalytics, setGovernanceAuditStatus,
    setGovernanceEvents, setGovernanceLatestSnapshotId, setGovernanceLedgerIntegrity,
    setGovernanceLoadGuardCounts, setGovernanceLoading, setGovernanceLocked, setGovernanceSnapshotAt,
    setGovernanceSnapshotCount, setGovernanceStatus, setIsAdmin, setIsEnhancingAllWeeks, setIsGeneratingWeek,
    setIsLoading, setIsRegeneratingBlueprint, setIsSavingWeekPlan, setIsViralityExpanded,
    setNegotiationLoading, setNegotiationMessage, setNegotiationResult, setNotice, setPerformanceSummary,
    setPlanDurationLimit, setPlannedStartDate, setPlannedStartDateLegacy, setPlannerQueryConsumed,
    setPrePlanningLoading, setPrePlanningResult, setPrePlanningResultLegacy, setPrePlanningWizardStep,
    setPrePlanningWizardStepLegacy, setPrefilledPlanning, setQuestionnaireAnswers,
    setQuestionnaireAnswersLegacy, setReadiness, setRecommendationContext, setRecommendationId,
    setRecommendationSummary, setRequestedWeeksForPreplan, setSelectedCompanyId, setSelectedWeekDay,
    setShowAIChat, setShowAdvisoryNotes, setShowRequiredActions, setViralityDiagnostics, setViralityGate,
    setWeeklyPlans, shouldForceWeeklyBlueprintView, showAIChat, showAdvisoryNotes, showHighCreatorWorkload,
    showRequiredActions, slotIndexGlobal, toggleDiagnostic, toggleWeekExpansion, topicBriefs, topicsCount,
    topicsWithExecution, viewMode, viralityDiagnostics, viralityGate, weekDailyPlans, weekIntelligence,
    weekIsStaggered, weekPlan, weeklyCapacity, weeklyPlans, wizardStateDbSaveTimeoutRef, wizardStore
  };
}
