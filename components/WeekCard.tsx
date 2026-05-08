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

export default function WeekCard({ weekNumber, d }: { weekNumber: number; d: S }) {
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
                  
                  return (
                    <div key={weekNumber} className="border rounded-lg overflow-hidden">
                      {/* Ownership summary strip */}
                      {ownershipCounts.total > 0 && (
                        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>AI Ready: {ownershipCounts.ai}</span>
                          <span className="text-gray-400">•</span>
                          <span>Creator Required: {ownershipCounts.creator}</span>
                          <span className="text-gray-400">•</span>
                          <span>Conditional AI: {ownershipCounts.conditional}</span>
                          {showHighCreatorWorkload && (
                            <>
                              <span className="text-gray-400">•</span>
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">⚠ High creator workload</span>
                            </>
                          )}
                          {VIEW_RULES[viewMode].showCMOLayer && (
                            <>
                              <span className="text-gray-400">•</span>
                              <span className={`px-1.5 py-0.5 rounded font-medium ${executionRiskClass}`}>Execution Risk: {executionRiskLabel}</span>
                              {pressureLabel != null && pressureColorClass != null && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span className={`px-1.5 py-0.5 rounded font-medium ${pressureColorClass}`}>Execution Pressure: {pressureLabel}</span>
                                </>
                              )}
                              {capacityFitLabel != null && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span className={`px-1.5 py-0.5 rounded ${capacityFitClass}`}>Capacity Fit: {capacityFitLabel}</span>
                                </>
                              )}
                              {momentumLabel != null && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span className="text-gray-500">Momentum: {momentumLabel}</span>
                                </>
                              )}
                            </>
                          )}
                          {VIEW_RULES[viewMode].showSystemFields && (
                            <>
                              <span className="text-gray-400">•</span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setExpandedSystemWeek(expandedSystemWeek === weekNumber ? null : weekNumber); }}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 text-xs"
                                title="Execution intelligence"
                              >
                                <Settings className="h-3 w-3" /> Execution Intelligence
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {ownershipCounts.total > 0 && creatorShare > 0.6 && (
                        <div className="px-4 py-1 bg-gray-50 border-b border-gray-100 text-[10px] text-amber-600">
                          ⚠ Creator-heavy week — consider reducing manual load.
                        </div>
                      )}
                      {VIEW_RULES[viewMode].showCMOLayer && executionBalancerRecommendations.length > 0 && (
                        <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] text-gray-600">
                          <ul className="list-none space-y-0.5">
                            {executionBalancerRecommendations.map((text, i) => (
                              <li key={i} className="flex gap-1.5">
                                <span className="shrink-0">•</span>
                                <span>{text}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {expandedSystemWeek === weekNumber && VIEW_RULES[viewMode].showSystemFields && ownershipCounts.total > 0 && (
                        <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 text-xs text-gray-600 space-y-0.5">
                          <div>Execution items: {Array.isArray((weekPlan as any)?.execution_items) ? (weekPlan as any).execution_items.length : 0}</div>
                          <div>Slots (topic_slots): {flatSlots.length}</div>
                          <div>Ownership: AI {Math.round((ownershipCounts.ai / ownershipCounts.total) * 100)}% · Creator {Math.round((ownershipCounts.creator / ownershipCounts.total) * 100)}% · Conditional {Math.round((ownershipCounts.conditional / ownershipCounts.total) * 100)}%</div>
                        </div>
                      )}
                      {/* Week Header */}
                      <div 
                        className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => toggleWeekExpansion(weekNumber)}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-4">
                            <div className={`p-2 rounded-lg bg-gradient-to-r ${getPhaseColor(weekPlan?.phase || 'Foundation')}`}>
                              <Calendar className="h-5 w-5 text-white" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-lg">Week {weekNumber}</h3>
                              <p className="text-gray-600">{displayWeeklyTitle(weekPlan?.theme || `Week ${weekNumber} Theme`)}</p>
                              <p className="text-sm text-gray-500">{displayWeeklyTitle(weekPlan?.focusArea || `Week ${weekNumber} Focus Area`)}</p>
                              {(weekPlan as any)?.platform_allocation && Object.keys((weekPlan as any).platform_allocation).length > 0 && (
                                <p className="text-xs text-indigo-600 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  {Object.entries((weekPlan as any).platform_allocation).map(([p, c]) => (
                                    <span key={p} className="inline-flex items-center gap-1">
                                      <PlatformIcon platform={p} size={12} showLabel />
                                      <span>{String(c ?? '')}</span>
                                    </span>
                                  ))}
                                </p>
                              )}
                              {topicsCount > 0 && (
                                <p className="text-xs text-gray-500 mt-0.5">{topicsCount} topic{topicsCount !== 1 ? 's' : ''}</p>
                              )}
                              {/* Content type + platform summary chips + AI/creator split */}
                              {weekDailyPlans.length > 0 && (() => {
                                const typeMap: Record<string, number> = {};
                                const platformSet = new Set<string>();
                                let aiCount = 0, creatorCount = 0, conditionalCount = 0;
                                weekDailyPlans.forEach((p) => {
                                  const ct = (p.contentType || 'post').toLowerCase();
                                  typeMap[ct] = (typeMap[ct] || 0) + 1;
                                  if (p.platform) platformSet.add(p.platform);
                                  const storedEM = (p.dailyObject as any)?.execution_mode as string | undefined;
                                  const em = isCreatorDependentContentType(p.contentType) ? 'CREATOR_REQUIRED'
                                    : storedEM === 'CREATOR_REQUIRED' ? 'CREATOR_REQUIRED'
                                    : storedEM === 'CONDITIONAL_AI' ? 'CONDITIONAL_AI'
                                    : 'AI_AUTOMATED';
                                  if (em === 'AI_AUTOMATED') aiCount++;
                                  else if (em === 'CREATOR_REQUIRED') creatorCount++;
                                  else conditionalCount++;
                                });
                                return (
                                  <div className="mt-1 space-y-1">
                                    {/* Platform + content type chips */}
                                    <div className="flex flex-wrap gap-1">
                                      {[...platformSet].map((pl) => (
                                        <span key={pl} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                                          <PlatformIcon platform={pl} size={10} />
                                        </span>
                                      ))}
                                      {Object.entries(typeMap).slice(0, 4).map(([ct, n]) => {
                                        const colors = getActivityColorClasses(ct);
                                        return (
                                          <span key={ct} className={`text-[10px] px-1.5 py-0.5 rounded border font-medium capitalize ${colors.badge}`}>
                                            {n > 1 ? `${n}×` : ''}{ct.replace(/_/g, ' ')}
                                          </span>
                                        );
                                      })}
                                    </div>
                                    {/* AI vs creator execution split */}
                                    <div className="flex items-center gap-2">
                                      {aiCount > 0 && (
                                        <span className="inline-flex items-center gap-1 text-[10px] text-gray-600">
                                          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                                          {aiCount} AI-driven
                                        </span>
                                      )}
                                      {conditionalCount > 0 && (
                                        <span className="inline-flex items-center gap-1 text-[10px] text-gray-600">
                                          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                                          {conditionalCount} conditional
                                        </span>
                                      )}
                                      {creatorCount > 0 && (
                                        <span className="inline-flex items-center gap-1 text-[10px] text-gray-600">
                                          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                                          {creatorCount} creator
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="text-right">
                              <div className="text-sm font-medium text-gray-900">
                                {weekPlan?.completionPercentage || 0}% Complete
                              </div>
                              <div className="w-24 bg-gray-200 rounded-full h-2 mt-1">
                                <div 
                                  className="bg-blue-500 h-2 rounded-full transition-all"
                                  style={{ width: `${weekPlan?.completionPercentage || 0}%` }}
                                ></div>
                              </div>
                            </div>
                            
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                enhanceWeekWithAI(weekNumber);
                              }}
                              disabled={isGeneratingWeek === weekNumber || !campaign?.start_date || !(campaign as any).duration_weeks}
                              title="Enhance this week's content plan with AI — generates topics, content briefs and execution slots"
                              className="px-3 py-1 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                              {isGeneratingWeek === weekNumber ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Sparkles className="h-3 w-3" />
                              )}
                              {isGeneratingWeek === weekNumber ? 'Enhancing…' : 'Enhance with AI'}
                            </button>

                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleWeekExpansion(weekNumber); }}
                              title={isExpanded ? 'Collapse week details' : 'Expand week details'}
                              className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                              aria-label={isExpanded ? 'Collapse' : 'Expand'}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-5 w-5" />
                              ) : (
                                <ChevronRight className="h-5 w-5" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Week Details (Expanded) — committed plan content */}
                      {isExpanded && (
                        <div className="border-t bg-gray-50 p-4">
                          <div className="grid grid-cols-1 gap-6">
                            {/* Week Overview — from committed plan */}
                            <div>
                              <h4 className="font-semibold mb-3">Week Overview</h4>
                              <div className="space-y-2">
                                <div>
                                  <span className="text-sm font-medium text-gray-600">Phase:</span>
                                  <span className="ml-2 text-sm">{weekPlan?.phase || 'Foundation'}</span>
                                </div>
                                <div>
                                  <span className="text-sm font-medium text-gray-600">Focus:</span>
                                  <span className="ml-2 text-sm">{displayWeeklyTitle(weekPlan?.focusArea || `Week ${weekNumber} Focus`)}</span>
                                </div>
                                {(weekPlan as any)?.platform_content_breakdown &&
                                  typeof (weekPlan as any).platform_content_breakdown === 'object' &&
                                  Object.keys((weekPlan as any).platform_content_breakdown).length > 0 && (
                                    <div>
                                      <span className="text-sm font-medium text-gray-600">Content types by platform:</span>
                                      <div className="mt-1 text-sm text-gray-700 space-y-1">
                                        {Object.entries((weekPlan as any).platform_content_breakdown as Record<string, any[]>).map(([platform, items]) => {
                                          const safeItems = Array.isArray(items) ? items : [];
                                          if (safeItems.length === 0) return null;
                                          const label = safeItems
                                            .map((it) => {
                                              const c = Number((it as any)?.count ?? 0);
                                              const t = String((it as any)?.type ?? '').trim();
                                              if (!t) return '';
                                              return Number.isFinite(c) && c > 0 ? `${c} ${t}` : t;
                                            })
                                            .filter(Boolean)
                                            .join(', ');
                                          if (!label) return null;
                                          return (
                                            <div key={platform} className="text-xs">
                                              <span className="font-medium capitalize">{platform}:</span> {label}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                {(weekPlan as any)?.keyMessaging && (weekPlan as any).keyMessaging !== 'AI-generated messaging' && (
                                  <div>
                                    <span className="text-sm font-medium text-gray-600">Key Messaging:</span>
                                    <span className="ml-2 text-sm">{(weekPlan as any).keyMessaging}</span>
                                  </div>
                                )}
                                {!effectiveHasTopics && (weekPlan as any)?.topics_to_cover?.length > 0 && (
                                  <div>
                                    <span className="text-sm font-medium text-gray-600">Topics to cover:</span>
                                    <ul className="mt-1 list-disc list-inside text-sm text-gray-700">
                                      {((weekPlan as any).topics_to_cover as string[]).map((t, i) => (
                                        <li key={i}>{displayWeeklyTitle(t)}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {(((weekPlan as any)?.weeklyContextCapsule && typeof (weekPlan as any).weeklyContextCapsule === 'object') || effectiveHasTopics) && (
                                  <div>
                                    <span className="text-sm font-medium text-gray-600">Writing Context:</span>
                                    {(weekPlan as any)?.weeklyContextCapsule && (
                                      <div className="mt-1 space-y-1 text-xs text-gray-700 bg-white rounded border p-2">
                                        {(weekPlan as any).weeklyContextCapsule.audienceProfile && (
                                          <div><span className="font-medium">Audience:</span> {(weekPlan as any).weeklyContextCapsule.audienceProfile}</div>
                                        )}
                                        {(weekPlan as any).weeklyContextCapsule.weeklyIntent && (
                                          <div><span className="font-medium">Weekly intent:</span> {(weekPlan as any).weeklyContextCapsule.weeklyIntent}</div>
                                        )}
                                        {(weekPlan as any).weeklyContextCapsule.toneGuidance && (
                                          <div><span className="font-medium">Tone:</span> {toneForUserDisplay((weekPlan as any).weeklyContextCapsule.toneGuidance)}</div>
                                        )}
                                        {(weekPlan as any).weeklyContextCapsule.campaignStage && (
                                          <div><span className="font-medium">Campaign stage:</span> {(weekPlan as any).weeklyContextCapsule.campaignStage}</div>
                                        )}
                                        {(weekPlan as any).weeklyContextCapsule.psychologicalGoal && (
                                          <div><span className="font-medium">Psychological goal:</span> {(weekPlan as any).weeklyContextCapsule.psychologicalGoal}</div>
                                        )}
                                      </div>
                                    )}
                                    {effectiveHasTopics && (
                                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                        {topicsWithExecution.map((topic, idx) => {
                                          const contentType = topic?.topicExecution?.contentType ?? (topic as any)?.contentType ?? (topic as any)?.content_type;
                                          const storedExecMode = (topic?.topicExecution?.execution_mode ?? (topic as any)?.execution_mode ?? 'AI_AUTOMATED') as 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';
                                          const execMode = isCreatorDependentContentType(contentType) ? 'CREATOR_REQUIRED' : storedExecMode;
                                          const intel = getExecutionIntelligence(execMode);
                                          const modeColors = intel.colorClasses;
                                          const cardClass = modeColors ? modeColors.card : getActivityColorClasses(topic?.topicExecution?.contentType).card;
                                          const badgeClass = modeColors ? modeColors.badge : getActivityColorClasses(topic?.topicExecution?.contentType).badge;
                                          const modeLabel = intel.label;
                                          const modeExplanation = intel.explanation;
                                          const execDot = execMode === 'AI_AUTOMATED' ? '🟢' : execMode === 'CONDITIONAL_AI' ? '🟡' : '🔴';
                                          // Is this a creator content card? (video, carousel, reel, story, etc.)
                                          const isCreatorCard = isCreatorDependentContentType(contentType) || (topic as any)?._isCreator === true;
                                          // Creator card data: prefer _creatorCard (from daily plans or slot), fall back to creator_instruction
                                          const creatorCardData = (topic as any)?._creatorCard ?? (topic?.topicExecution?.creator_instruction && typeof topic.topicExecution.creator_instruction === 'object' ? topic.topicExecution.creator_instruction : null);
                                          return (
                                          <button
                                            key={`${topic?.topicTitle || 'topic'}-${idx}-${(topic as any)?._platforms?.[0] || ''}`}
                                            type="button"
                                            onClick={() => openTopicWorkspaceFromWeeklyCard(weekNumber, topic)}
                                            className={`text-xs text-gray-700 rounded border p-2 text-left hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors cursor-pointer ${cardClass}`}
                                          >
                                            {/* Mode label row */}
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-[10px] leading-none">{execDot}</span>
                                              <span className="font-medium text-gray-900 text-[10px]">{modeLabel ?? (isCreatorCard ? 'Creator Required' : 'AI Ready')}</span>
                                            </div>
                                            {modeExplanation && <div className="text-[10px] text-gray-400 mt-0.5">{modeExplanation}</div>}
                                            {execMode === 'CONDITIONAL_AI' && (
                                              <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">Template Required</span>
                                            )}

                                            {/* Title + content type badge */}
                                            <div className="flex items-start justify-between gap-2 mt-1.5">
                                              <div className="font-semibold text-gray-900 leading-snug">{displayWeeklyTitle(topic?.topicTitle, 'Untitled Topic')}</div>
                                              <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-medium ${badgeClass}`}>
                                                {topic?.topicExecution?.contentType || 'activity'}
                                              </span>
                                            </div>

                                            {/* --- CREATOR content fields --- */}
                                            {isCreatorCard ? (
                                              <div className="mt-1.5 space-y-0.5">
                                                {/* Brief / objective */}
                                                {(creatorCardData?.summary || creatorCardData?.objective) && (
                                                  <div><span className="font-medium">Brief:</span> {String(creatorCardData.summary || creatorCardData.objective)}</div>
                                                )}
                                                {creatorCardData?.target_audience && (
                                                  <div><span className="font-medium">Audience:</span> {String(creatorCardData.target_audience)}</div>
                                                )}
                                                {(creatorCardData?.intent?.pain_point || creatorCardData?.intent?.outcome_promise) && (
                                                  <div>
                                                    {creatorCardData.intent.pain_point && <div><span className="font-medium">Pain point:</span> {String(creatorCardData.intent.pain_point)}</div>}
                                                    {creatorCardData.intent.outcome_promise && <div><span className="font-medium">Viewer learns:</span> {String(creatorCardData.intent.outcome_promise)}</div>}
                                                  </div>
                                                )}
                                                {/* Visual hook */}
                                                {(creatorCardData?.visual_hook || creatorCardData?.intent?.visual_hook) && (
                                                  <div><span className="font-medium">Visual hook (0–3s):</span> {String(creatorCardData.visual_hook || creatorCardData.intent.visual_hook)}</div>
                                                )}
                                                {/* Scene direction */}
                                                {(creatorCardData?.scene_direction || creatorCardData?.intent?.scene_direction) && (
                                                  <div className="mt-0.5">
                                                    <div className="font-medium text-gray-700 mb-0.5">Scene direction:</div>
                                                    <div className="text-[10px] text-gray-600 whitespace-pre-line bg-gray-50 rounded p-1.5 border border-gray-100">{String(creatorCardData.scene_direction || creatorCardData.intent.scene_direction)}</div>
                                                  </div>
                                                )}
                                                {/* Image prompt */}
                                                {(creatorCardData?.image_prompt || creatorCardData?.intent?.image_prompt) && (
                                                  <div className="mt-0.5">
                                                    <div className="font-medium text-gray-700 mb-0.5">Image prompt:</div>
                                                    <div className="text-[10px] text-gray-500 italic">{String(creatorCardData.image_prompt || creatorCardData.intent.image_prompt)}</div>
                                                  </div>
                                                )}
                                                {/* Video direction */}
                                                {(creatorCardData?.video_prompt || creatorCardData?.intent?.video_prompt) && (
                                                  <div className="mt-0.5">
                                                    <div className="font-medium text-gray-700 mb-0.5">Video direction:</div>
                                                    <div className="text-[10px] text-gray-500 italic">{String(creatorCardData.video_prompt || creatorCardData.intent.video_prompt)}</div>
                                                  </div>
                                                )}
                                                {/* Platform notes */}
                                                {Array.isArray(creatorCardData?.platform_notes) && creatorCardData.platform_notes.length > 0 && (
                                                  <div><span className="font-medium">Platform notes:</span> {(creatorCardData.platform_notes as string[]).join(' · ')}</div>
                                                )}
                                                {/* Keywords + hashtags — same as text */}
                                                {Array.isArray(creatorCardData?.keywords) && creatorCardData.keywords.length > 0 && (
                                                  <div className="mt-0.5"><span className="font-medium">Keywords:</span> <span className="text-gray-500">{(creatorCardData.keywords as string[]).join(', ')}</span></div>
                                                )}
                                                {Array.isArray(creatorCardData?.hashtags) && creatorCardData.hashtags.length > 0 && (
                                                  <div className="text-[10px] text-indigo-500 mt-0.5">{(creatorCardData.hashtags as string[]).slice(0, 6).map((h: string) => h.startsWith('#') ? h : `#${h}`).join(' ')}</div>
                                                )}
                                              </div>
                                            ) : (
                                              /* --- TEXT content fields --- */
                                              <div className="mt-1.5 space-y-0.5">
                                                {/* Hook */}
                                                {(creatorCardData?.hook || creatorCardData?.intent?.hook || topic?.topicContext?.writingIntent) && (
                                                  <div><span className="font-medium">Hook:</span> <span className="italic text-gray-700">{String(creatorCardData?.hook || creatorCardData?.intent?.hook || topic.topicContext?.writingIntent)}</span></div>
                                                )}
                                                {/* Audience + problem + reader learns */}
                                                {topic?.whoAreWeWritingFor && (
                                                  <div><span className="font-medium">Audience:</span> {topic.whoAreWeWritingFor}</div>
                                                )}
                                                {topic?.whatProblemAreWeAddressing && (
                                                  <div><span className="font-medium">Problem:</span> {topic.whatProblemAreWeAddressing}</div>
                                                )}
                                                {topic?.whatShouldReaderLearn && (
                                                  <div><span className="font-medium">Reader learns:</span> {topic.whatShouldReaderLearn}</div>
                                                )}
                                                {/* Key points */}
                                                {(() => {
                                                  const kp: string[] | undefined = creatorCardData?.key_points || creatorCardData?.intent?.key_points;
                                                  return Array.isArray(kp) && kp.length > 0 ? (
                                                    <div className="mt-0.5">
                                                      <div className="font-medium text-gray-700 mb-0.5">Key points:</div>
                                                      <ul className="list-none space-y-0.5 text-[10px] text-gray-600">
                                                        {(kp as string[]).map((pt, i) => <li key={i}>{"  "}{i + 1}. {pt}</li>)}
                                                      </ul>
                                                    </div>
                                                  ) : null;
                                                })()}
                                                {/* SEO focus */}
                                                {(creatorCardData?.seo_focus || creatorCardData?.intent?.seo_focus) && (
                                                  <div><span className="font-medium">SEO focus:</span> {String(creatorCardData?.seo_focus || creatorCardData?.intent?.seo_focus)}</div>
                                                )}
                                                {/* Keywords */}
                                                {(() => {
                                                  const kw: string[] | undefined = creatorCardData?.keywords || creatorCardData?.intent?.keywords;
                                                  return Array.isArray(kw) && kw.length > 0
                                                    ? <div><span className="font-medium">Keywords:</span> <span className="text-gray-500">{(kw as string[]).join(', ')}</span></div>
                                                    : null;
                                                })()}
                                                {/* Hashtags */}
                                                {(() => {
                                                  const ht: string[] | undefined = creatorCardData?.hashtags || creatorCardData?.intent?.hashtags;
                                                  return Array.isArray(ht) && ht.length > 0
                                                    ? <div className="text-[10px] text-indigo-500 mt-0.5">{(ht as string[]).slice(0, 6).map((h: string) => h.startsWith('#') ? h : `#${h}`).join(' ')}</div>
                                                    : null;
                                                })()}
                                                {/* Repurpose angles */}
                                                {(() => {
                                                  const ra: string[] | undefined = creatorCardData?.repurpose_angles || creatorCardData?.intent?.repurpose_angles;
                                                  return Array.isArray(ra) && ra.length > 0 ? (
                                                    <div className="mt-0.5">
                                                      <div className="font-medium text-gray-700 mb-0.5">Repurpose as:</div>
                                                      <ul className="list-none text-[10px] text-gray-500 space-y-0.5">
                                                        {(ra as string[]).map((a, i) => <li key={i}>• {a}</li>)}
                                                      </ul>
                                                    </div>
                                                  ) : null;
                                                })()}
                                                {/* Tone + format */}
                                                {topic?.desiredAction && (
                                                  <div><span className="font-medium">CTA:</span> {topic.desiredAction}</div>
                                                )}
                                                {topic?.narrativeStyle && (
                                                  <div><span className="font-medium">Tone:</span> {toneForUserDisplay(topic.narrativeStyle)}</div>
                                                )}
                                                {(() => {
                                                  const line = getFormatLineForContentType(contentType, topic?.contentTypeGuidance, topic?.topicExecution?.platformTargets);
                                                  return line ? <div><span className="font-medium">Format:</span> {line.replace(/^Format:\s*/i, '')}</div> : null;
                                                })()}
                                              </div>
                                            )}

                                            {/* Execution details — shared for both creator and text */}
                                            <div className="mt-1.5 pt-1 border-t border-gray-100 space-y-0.5">
                                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                <span className="font-medium">Platform(s):</span>
                                                {(topic?.topicExecution?.platformTargets || ['—']).map((plat: string) => (
                                                  plat === '—' ? <span key="—">—</span> : <PlatformIcon key={plat} platform={plat} size={12} showLabel />
                                                ))}
                                              </div>
                                              <div><span className="font-medium">CTA:</span> {topic?.topicExecution?.ctaType || '—'}</div>
                                              <div><span className="font-medium">KPI:</span> {topic?.topicExecution?.kpiFocus || '—'}</div>
                                            </div>
                                            <div className="mt-1 text-[10px] text-indigo-600">Click to open workspace</div>
                                          </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Target Metrics */}
                            <div>
                              <h4 className="font-semibold mb-3">Target Metrics</h4>
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                  <span className="text-gray-600">Impressions:</span>
                                  <span className="ml-2 font-medium">{weekPlan?.targetMetrics?.impressions?.toLocaleString() || '0'}</span>
                                </div>
                                <div>
                                  <span className="text-gray-600">Engagements:</span>
                                  <span className="ml-2 font-medium">{weekPlan?.targetMetrics?.engagements?.toLocaleString() || '0'}</span>
                                </div>
                                <div>
                                  <span className="text-gray-600">Conversions:</span>
                                  <span className="ml-2 font-medium">{weekPlan?.targetMetrics?.conversions?.toLocaleString() || '0'}</span>
                                </div>
                                <div>
                                  <span className="text-gray-600">UGC:</span>
                                  <span className="ml-2 font-medium">{weekPlan?.targetMetrics?.ugcSubmissions?.toLocaleString() || '0'}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Week Plan view: show activity cards directly from blueprint execution_items */}
                          {(campaign?.current_stage === 'week_plan' || campaign?.current_stage === 'campaign_week_plan') && bestDerivedTopics.length > 0 && (
                            <div className="mt-6">
                              <h4 className="font-semibold mb-3">Activity Cards <span className="text-xs font-normal text-gray-500 ml-1">({bestDerivedTopics.length} planned)</span></h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {(topicsWithExecution.length > 0 ? topicsWithExecution : bestDerivedTopics).map((topic: any, idx: number) => {
                                  const ct = String(topic?.topicExecution?.contentType ?? topic?._contentType ?? 'post').toLowerCase();
                                  const platform = topic?.topicExecution?.platformTargets?.[0] ?? topic?._platforms?.[0] ?? 'linkedin';
                                  const colors = getActivityColorClasses(ct);
                                  const ctIcon = ct.includes('video') || ct.includes('reel') ? '🎥'
                                    : ct.includes('carousel') ? '🖼'
                                    : ct.includes('blog') || ct.includes('article') ? '📝'
                                    : ct.includes('newsletter') ? '📧'
                                    : ct.includes('story') ? '⚡'
                                    : '✍️';
                                  return (
                                    <div key={idx} className={`rounded-xl border p-3 bg-white shadow-sm ${colors.card}`}>
                                      <div className="flex items-center gap-2 mb-2">
                                        <PlatformIcon platform={platform} size={16} />
                                        <span className="text-xs font-semibold capitalize text-gray-700">{platform === 'x' ? 'X (Twitter)' : platform}</span>
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${colors.badge}`}>{ctIcon} {ct.replace(/_/g, ' ')}</span>
                                      </div>
                                      <p className="text-sm font-semibold text-gray-900 mb-1 leading-snug">
                                        {topic?.topicTitle || `Activity ${idx + 1}`}
                                      </p>
                                      {(topic?.briefSummary || topic?.intent?.brief_summary) && (
                                        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
                                          {topic?.briefSummary || topic?.intent?.brief_summary}
                                        </p>
                                      )}
                                      {topic?.topicExecution?.ctaType && (
                                        <p className="text-[10px] text-gray-400 mt-1">CTA: {topic.topicExecution.ctaType}</p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Daily Plans — drag-and-drop by day; regenerate or save & freeze */}
                          {campaign?.current_stage !== 'week_plan' && campaign?.current_stage !== 'campaign_week_plan' && <div className="mt-6">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <h4 className="font-semibold">Daily Content Plan</h4>
                              <div className="flex flex-wrap items-center gap-2">
                                {weekDailyPlans.length > 0 && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => regenerateWeekDailyPlan(weekNumber)}
                                      disabled={isGeneratingWeek === weekNumber}
                                      className="text-xs px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors flex items-center gap-1 disabled:opacity-50"
                                      title="Regenerate daily plan with AI"
                                    >
                                      {isGeneratingWeek === weekNumber ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                                      Regenerate
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => saveWeekDailyPlan(weekNumber)}
                                      disabled={isSavingWeekPlan === weekNumber}
                                      className="text-xs px-3 py-1.5 rounded-lg border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 transition-colors flex items-center gap-1 disabled:opacity-50"
                                      title="Save order and set plan for next stage"
                                    >
                                      {isSavingWeekPlan === weekNumber ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                      Save & freeze
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openCampaignCalendar(weekNumber)}
                                  className="text-xs px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                                >
                                  ➡ Open Campaign Calendar
                                </button>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 mb-2">
                              <span className="text-xs font-medium text-gray-600">Distribution:</span>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`distribution-${weekNumber}`}
                                  checked={distributionMode === 'staggered'}
                                  onChange={() => setDistributionMode('staggered')}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-xs text-gray-700">Staggered</span>
                                <span className="text-[10px] text-gray-500">(topic spread across days)</span>
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`distribution-${weekNumber}`}
                                  checked={distributionMode === 'same_day_per_topic'}
                                  onChange={() => setDistributionMode('same_day_per_topic')}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-xs text-gray-700">Same day per topic</span>
                                <span className="text-[10px] text-gray-500">(all content for that topic on one day)</span>
                              </label>
                            </div>
                            <p className="text-xs text-gray-500 mb-2">Distribution controls how the weekly plan is turned into the daily plan. Applied when you Regenerate or first generate. Drag items between days to reorder. Save & freeze to lock the plan for the next stage.</p>
                            {weekDailyPlans.length > 0 ? (
                              <div className="overflow-x-auto">
                              <div className="grid grid-cols-7 gap-2 min-w-[700px]">
                                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => {
                                  const dayItems = (editedWeekDailyPlans[weekNumber] ?? weekDailyPlans).filter(d => d.dayOfWeek === day);
                                  const hasPlans = dayItems.length > 0;
                                  return (
                                    <div
                                      key={day}
                                      onDragOver={handleDailyPlanDragOver}
                                      onDrop={(e) => handleDailyPlanDrop(weekNumber, day, e)}
                                      className="border rounded-lg bg-white min-h-[120px] hover:border-indigo-300 hover:shadow-sm transition-all"
                                    >
                                      {/* Day header */}
                                      <button
                                        type="button"
                                        onClick={() => setSelectedWeekDay(
                                          selectedWeekDay?.weekNumber === weekNumber && selectedWeekDay?.day === day
                                            ? null
                                            : { weekNumber, day }
                                        )}
                                        className={`w-full text-left px-2 py-1.5 border-b transition-colors rounded-t-lg flex items-center justify-between ${
                                          selectedWeekDay?.weekNumber === weekNumber && selectedWeekDay?.day === day
                                            ? 'bg-indigo-100 border-indigo-200'
                                            : 'border-gray-100 hover:bg-indigo-50'
                                        }`}
                                      >
                                        <div className={`text-xs font-semibold ${selectedWeekDay?.weekNumber === weekNumber && selectedWeekDay?.day === day ? 'text-indigo-700' : 'text-gray-700'}`}>{day.slice(0, 3)}</div>
                                        {hasPlans && <span className="text-[9px] text-indigo-500 font-medium">{dayItems.length}</span>}
                                      </button>

                                      {/* Activity cards */}
                                      <div className="p-1.5 space-y-1.5">
                                        {hasPlans ? dayItems.map((p) => {
                                          const colors = getActivityColorClasses(p.contentType);
                                          const topicLabel = (p.title || p.topic || '').trim();
                                          const ct = (p.contentType || 'post').toLowerCase();
                                          const ctIcon = ct.includes('video') || ct.includes('reel') ? '🎥'
                                            : ct.includes('carousel') ? '🖼'
                                            : ct.includes('story') ? '⚡'
                                            : ct.includes('blog') || ct.includes('article') ? '📝'
                                            : ct.includes('newsletter') ? '📧'
                                            : ct.includes('image') || ct.includes('photo') ? '📸'
                                            : '✉';
                                          // Execution mode dot: green = AI-driven text, red = creator-dependent
                                          const storedExecMode = (p.dailyObject as any)?.execution_mode as string | undefined;
                                          const execMode = isCreatorDependentContentType(p.contentType)
                                            ? 'CREATOR_REQUIRED'
                                            : storedExecMode === 'CREATOR_REQUIRED' ? 'CREATOR_REQUIRED'
                                            : storedExecMode === 'CONDITIONAL_AI' ? 'CONDITIONAL_AI'
                                            : 'AI_AUTOMATED';
                                          const execDotColor = execMode === 'AI_AUTOMATED'
                                            ? 'bg-emerald-500' // 🟢 green = AI text-based
                                            : execMode === 'CONDITIONAL_AI'
                                            ? 'bg-amber-400'  // 🟡 amber = conditional
                                            : 'bg-red-500';   // 🔴 red = creator required
                                          const execDotTitle = execMode === 'AI_AUTOMATED' ? 'AI-driven (text-based)'
                                            : execMode === 'CONDITIONAL_AI' ? 'Conditional AI (template needed)'
                                            : 'Creator required';
                                          return (
                                            <div
                                              key={p.id}
                                              draggable
                                              onDragStart={(e) => handleDailyPlanDragStart(e, p.id, p.dayOfWeek)}
                                              className={`group relative rounded-lg border p-2 cursor-grab active:cursor-grabbing hover:shadow-sm transition-all ${colors.card}`}
                                              title={topicLabel || ct}
                                            >
                                              {/* Grip */}
                                              <GripVertical className="absolute right-1 top-1 h-3 w-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />

                                              {/* Platform + content type + exec dot row */}
                                              <div className="flex items-center gap-1 mb-1">
                                                <span className={`w-2 h-2 rounded-full shrink-0 ${execDotColor}`} title={execDotTitle} />
                                                <PlatformIcon platform={p.platform} size={12} />
                                                <span className={`text-[10px] font-semibold px-1 py-0.5 rounded capitalize ${colors.badge}`}>
                                                  {ctIcon} {ct.replace(/_/g, ' ')}
                                                </span>
                                              </div>

                                              {/* Topic title */}
                                              {topicLabel && (
                                                <p className="text-[11px] font-medium text-gray-800 leading-tight line-clamp-2">
                                                  {topicLabel}
                                                </p>
                                              )}
                                            </div>
                                          );
                                        }) : (
                                          <div className="py-4 text-center text-[10px] text-gray-400">No plan</div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* ── Day detail panel — shown below grid when a day is selected ── */}
                              {selectedWeekDay?.weekNumber === weekNumber && (() => {
                                const selDay = selectedWeekDay.day;
                                const selItems = (editedWeekDailyPlans[weekNumber] ?? weekDailyPlans).filter(d => d.dayOfWeek === selDay);
                                if (selItems.length === 0) return (
                                  <div className="mt-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">
                                    No activities planned for {selDay}
                                  </div>
                                );
                                return (
                                  <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/40 overflow-hidden">
                                    {/* Panel header */}
                                    <div className="flex items-center justify-between px-4 py-2 bg-indigo-600">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-white">{selDay}</span>
                                        <span className="text-xs text-indigo-200">{selItems.length} activit{selItems.length !== 1 ? 'ies' : 'y'}</span>
                                      </div>
                                      <button onClick={() => setSelectedWeekDay(null)} className="text-indigo-200 hover:text-white text-sm leading-none">✕</button>
                                    </div>

                                    {/* Legend */}
                                    <div className="flex items-center gap-4 px-4 py-2 bg-white border-b border-indigo-100 text-[10px] text-gray-500">
                                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> AI-driven (text)</span>
                                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Conditional AI</span>
                                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Creator required</span>
                                    </div>

                                    {/* Activity cards */}
                                    <div className="p-3 space-y-3">
                                      {selItems.map((p) => {
                                        const colors = getActivityColorClasses(p.contentType);
                                        const ct = (p.contentType || 'post').toLowerCase();
                                        const ctIcon = ct.includes('video') || ct.includes('reel') ? '🎥'
                                          : ct.includes('carousel') ? '🖼'
                                          : ct.includes('story') ? '⚡'
                                          : ct.includes('blog') || ct.includes('article') ? '📝'
                                          : ct.includes('newsletter') ? '📧'
                                          : ct.includes('image') || ct.includes('photo') ? '📸'
                                          : '✉';
                                        const topicTitle = (p.title || p.topic || '').trim();
                                        const kps = Array.isArray(p.keyPoints) && p.keyPoints.length > 0 ? p.keyPoints : null;
                                        // Execution mode
                                        const storedExecModeD = (p.dailyObject as any)?.execution_mode as string | undefined;
                                        const execModeD = isCreatorDependentContentType(p.contentType)
                                          ? 'CREATOR_REQUIRED'
                                          : storedExecModeD === 'CREATOR_REQUIRED' ? 'CREATOR_REQUIRED'
                                          : storedExecModeD === 'CONDITIONAL_AI' ? 'CONDITIONAL_AI'
                                          : 'AI_AUTOMATED';
                                        const execDotColorD = execModeD === 'AI_AUTOMATED' ? 'bg-emerald-500'
                                          : execModeD === 'CONDITIONAL_AI' ? 'bg-amber-400'
                                          : 'bg-red-500';
                                        const execLabelD = execModeD === 'AI_AUTOMATED' ? 'AI-driven (text-based)'
                                          : execModeD === 'CONDITIONAL_AI' ? 'Conditional AI'
                                          : 'Creator required';
                                        return (
                                          <div key={p.id} className={`rounded-xl border p-3 bg-white shadow-sm ${colors.card}`}>
                                            {/* Row 1: exec dot + platform + content type + status */}
                                            <div className="flex items-center gap-2 mb-2">
                                              <span className={`w-3 h-3 rounded-full shrink-0 ${execDotColorD}`} title={execLabelD} />
                                              <PlatformIcon platform={p.platform} size={16} />
                                              <span className="text-xs font-semibold capitalize text-gray-700">
                                                {p.platform === 'x' ? 'X (Twitter)' : p.platform}
                                              </span>
                                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${colors.badge}`}>
                                                {ctIcon} {ct.replace(/_/g, ' ')}
                                              </span>
                                              <span className="text-[10px] text-gray-400 italic">{execLabelD}</span>
                                              <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full capitalize font-medium ${
                                                p.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
                                                  : p.status === 'scheduled' ? 'bg-blue-100 text-blue-700'
                                                  : 'bg-gray-100 text-gray-500'
                                              }`}>{p.status || 'draft'}</span>
                                            </div>

                                            {/* Topic title */}
                                            {topicTitle && (
                                              <p className="text-sm font-semibold text-gray-900 mb-1 leading-snug">{topicTitle}</p>
                                            )}

                                            {/* Description / summary / intro */}
                                            {(p.description || p.summary || p.introObjective || p.objective) && (
                                              <p className="text-xs text-gray-600 mb-2 leading-relaxed">
                                                {p.description || p.summary || p.introObjective || p.objective}
                                              </p>
                                            )}

                                            {/* Key points */}
                                            {kps && (
                                              <div className="mb-2">
                                                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Key Points</p>
                                                <ul className="space-y-0.5">
                                                  {kps.slice(0, 4).map((kp, i) => (
                                                    <li key={i} className="flex gap-1.5 text-xs text-gray-700">
                                                      <span className="text-indigo-400 shrink-0 mt-0.5">•</span>
                                                      <span>{kp}</span>
                                                    </li>
                                                  ))}
                                                </ul>
                                              </div>
                                            )}

                                            {/* Meta row: CTA, brand voice, hashtags */}
                                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-500 border-t border-gray-100 pt-2 mt-1">
                                              {p.cta && (
                                                <span><span className="font-semibold text-gray-600">CTA:</span> {p.cta}</span>
                                              )}
                                              {p.brandVoice && (
                                                <span><span className="font-semibold text-gray-600">Tone:</span> {p.brandVoice}</span>
                                              )}
                                              {p.themeLinkage && (
                                                <span><span className="font-semibold text-gray-600">Theme:</span> {p.themeLinkage}</span>
                                              )}
                                              {p.formatNotes && (
                                                <span><span className="font-semibold text-gray-600">Format:</span> {p.formatNotes}</span>
                                              )}
                                              {p.scheduledTime && (
                                                <span><span className="font-semibold text-gray-600">Time:</span> {p.scheduledTime}</span>
                                              )}
                                            </div>

                                            {/* Hashtags */}
                                            {Array.isArray(p.hashtags) && p.hashtags.length > 0 && (
                                              <div className="flex flex-wrap gap-1 mt-2">
                                                {p.hashtags.slice(0, 6).map((h, i) => (
                                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
                                                    #{h.replace(/^#/, '')}
                                                  </span>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}

                              </div>
                            ) : (
                              <div className="text-center py-4 text-gray-500">
                                <Calendar className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                                <p>No daily plans generated yet</p>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    enhanceWeekWithAI(weekNumber);
                                  }}
                                  disabled={!campaign?.start_date || !(campaign as any).duration_weeks}
                                  title={!campaign?.start_date || !(campaign as any).duration_weeks
                                    ? 'Set campaign start date and duration in Pre-planning first'
                                    : 'Generate daily plans for this week'}
                                  className="mt-2 px-3 py-1 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Generate Daily Plans
                                </button>
                              </div>
                            )}
                          </div>}
                        </div>
                      )}
                    </div>
                  );
}

