import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { getStageColor, getStageLabel } from '../pages/campaign-details/helpers';
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
import CampaignAIChat from '../components/CampaignAIChat';
import AIGenerationProgress from '../components/AIGenerationProgress';
import { useCompanyContext } from '../components/CompanyContext';
import { apiFetch } from '@/lib/apiFetch';
import { GovernanceStatusCard } from '../components/governance/GovernanceStatusCard';
import { GovernanceAnalyticsCard } from '../components/governance/GovernanceAnalyticsCard';
import { GovernanceExplanationPanel, deriveFromEvent } from '../components/governance/GovernanceExplanationPanel';
import { GovernanceTimeline } from '../components/governance/GovernanceTimeline';
import { PreemptionHistory } from '../components/governance/PreemptionHistory';
import { TradeOffSuggestionList } from '../components/governance/TradeOffSuggestionList';
import { truncateMeaningfulTitle } from '../lib/ui/truncateMeaningfulTitle';
import { getExecutionIntelligence } from '../utils/getExecutionIntelligence';
import { isCreatorDependentContentType } from '../utils/contentTaxonomy';
import { getFormatLineForContentType, getIntentLabelForContentType, toneForUserDisplay } from '../utils/formatLineForContentType';
import PlatformIcon from '../components/ui/PlatformIcon';
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
import { useCampaignResume } from './useCampaignResume';
import { PLATFORM_LABELS } from '../backend/constants/platforms';

import type { Campaign, WeeklyPlan, DailyPlan, ReadinessResponse, GateResponse, GateRequiredAction, DiagnosticSummary, ViralityAssessmentResponse, RecommendationSummary, PerformanceSummary } from '../pages/campaign-details/types';
import type { useCampaignDetailsCore } from './useCampaignDetailsCore';
type CoreState = ReturnType<typeof useCampaignDetailsCore>;

export function useCampaignDetailsHandlers(core: CoreState) {
  const {
    id,
    _ef1,
    _ef2,
    _ef3,
    _ef4,
    _ef5,
    activeTab,
    aiSuggestion,
    aiSuggestionLoading,
    blueprintFrozen,
    blueprintGeneratedSuccess,
    blueprintImmutable,
    blueprintRegenerateFailedMsg,
    campaign,
    campaignMode,
    dailyPlans,
    didAutoOpenChatRef,
    distributionMode,
    durationWeeks,
    editedWeekDailyPlans,
    effectiveCompanyId,
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
    fromOpportunity,
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
    hasRestoredWizardStateRef,
    isAdmin,
    isEnhancingAllWeeks,
    isGeneratingWeek,
    isLoading,
    isRegeneratingBlueprint,
    isSavingWeekPlan,
    isViralityExpanded,
    isWeeklyBlueprintFocus,
    loadGovernance,
    needsPrePlanning,
    negotiationLoading,
    negotiationMessage,
    negotiationResult,
    notice,
    performanceSummary,
    planDurationLimit,
    plannerQueryConsumed,
    prePlanningLoading,
    prefilledPlanning,
    readiness,
    recommendationContext,
    recommendationId,
    recommendationSummary,
    requestedWeeksForPreplan,
    router,
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
    setPlannerQueryConsumed,
    setPrePlanningLoading,
    setPrefilledPlanning,
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
    viewMode,
    viralityDiagnostics,
    viralityGate,
    weeklyPlans,
    wizardStateDbSaveTimeoutRef,
  } = core;

  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });
  const [frequencyValidation, setFrequencyValidation] = useState<{
    frequency_summary?: { weekly_unique_content_required: number; total_content_required: number };
    validation?: { valid: boolean; warnings: Array<{ code: string; message: string }>; errors: Array<{ code: string; message: string }> };
  } | null>(null);
  const frequencyValidationTimeoutRef = useRef<number | null>(null);
  const [questionnaireAnswersLegacy, setQuestionnaireAnswersLegacy] = useState<{
    availableVideo: number;
    availablePost: number;
    availableBlog: number;
    availableSong: number;
    contentSuited: boolean | null;
    videoPerWeek: number;
    postPerWeek: number;
    blogPerWeek: number;
    songPerWeek: number;
    inHouseNotes: string;
  }>({
    availableVideo: 0,
    availablePost: 0,
    availableBlog: 0,
    availableSong: 0,
    contentSuited: null,
    videoPerWeek: 2,
    postPerWeek: 3,
    blogPerWeek: 0,
    songPerWeek: 0,
    inHouseNotes: '',
  });

  const [prePlanningWizardStepLegacy, setPrePlanningWizardStepLegacy] = useState(0);
  const [crossPlatformSharingEnabledLegacy, setCrossPlatformSharingEnabledLegacy] = useState(true);
  const [plannedStartDateLegacy, setPlannedStartDateLegacy] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [prePlanningResultLegacy, setPrePlanningResultLegacy] = useState<{
    status: string;
    requested_weeks: number;
    recommended_duration: number;
    max_weeks_allowed: number;
    min_weeks_required?: number;
    limiting_constraints: Array<{ name: string; reasoning: string }>;
    blocking_constraints: Array<{ name: string; reasoning: string }>;
    trade_off_options: Array<{ type: string; newDurationWeeks?: number; reasoning: string; [k: string]: unknown }>;
    explanation_summary: string;
  } | null>(null);

  const wizardStore = useCampaignWizard(ENABLE_UNIFIED_CAMPAIGN_WIZARD ? (id as string) : null);

  const prePlanningWizardStep = ENABLE_UNIFIED_CAMPAIGN_WIZARD ? wizardStore.step : prePlanningWizardStepLegacy;
  const setPrePlanningWizardStep = ENABLE_UNIFIED_CAMPAIGN_WIZARD ? wizardStore.setStep : setPrePlanningWizardStepLegacy;
  const crossPlatformSharingEnabled = ENABLE_UNIFIED_CAMPAIGN_WIZARD ? wizardStore.crossPlatformSharingEnabled : crossPlatformSharingEnabledLegacy;
  const setCrossPlatformSharingEnabled = ENABLE_UNIFIED_CAMPAIGN_WIZARD ? wizardStore.setDistributionMode : setCrossPlatformSharingEnabledLegacy;
  const plannedStartDate = ENABLE_UNIFIED_CAMPAIGN_WIZARD ? wizardStore.plannedStartDate : plannedStartDateLegacy;
  const setPlannedStartDate = ENABLE_UNIFIED_CAMPAIGN_WIZARD ? wizardStore.setPlannedStartDate : setPlannedStartDateLegacy;
  const prePlanningResult = ENABLE_UNIFIED_CAMPAIGN_WIZARD ? wizardStore.prePlanningResult : prePlanningResultLegacy;
  const setPrePlanningResult = ENABLE_UNIFIED_CAMPAIGN_WIZARD ? wizardStore.setPrePlanningResult : setPrePlanningResultLegacy;
  const questionnaireAnswers = ENABLE_UNIFIED_CAMPAIGN_WIZARD ? wizardStore.questionnaireAnswers : questionnaireAnswersLegacy;
  const setQuestionnaireAnswers = ENABLE_UNIFIED_CAMPAIGN_WIZARD ? wizardStore.setQuestionnaireAnswers : setQuestionnaireAnswersLegacy;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!effectiveCompanyId) return;
    apiFetch(`/api/company-plan-duration-limit?companyId=${encodeURIComponent(effectiveCompanyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPlanDurationLimit(d ? { max_campaign_duration_weeks: d.max_campaign_duration_weeks } : null))
      .catch(() => setPlanDurationLimit(null));
  }, [effectiveCompanyId]);

  // Frequency validation (700ms debounce)
  useEffect(() => {
    if (!effectiveCompanyId || typeof id !== 'string') return;
    if (frequencyValidationTimeoutRef.current) {
      window.clearTimeout(frequencyValidationTimeoutRef.current);
      frequencyValidationTimeoutRef.current = null;
    }
    frequencyValidationTimeoutRef.current = window.setTimeout(() => {
      frequencyValidationTimeoutRef.current = null;
      const platforms = (prefilledPlanning as any)?.platforms
        ? String((prefilledPlanning as any).platforms).split(',').map((p: string) => p.trim()).filter(Boolean)
        : ['linkedin'];
      const duration = requestedWeeksForPreplan || 12;
      apiFetch('/api/campaigns/validate-frequency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: effectiveCompanyId,
          duration_weeks: duration,
          platforms,
          cross_platform_sharing_enabled: crossPlatformSharingEnabled,
          content_mix: {
            post_per_week: questionnaireAnswers.postPerWeek,
            video_per_week: questionnaireAnswers.videoPerWeek,
            blog_per_week: questionnaireAnswers.blogPerWeek,
            reel_per_week: 0,
            article_per_week: 0,
            song_per_week: questionnaireAnswers.songPerWeek,
          },
          available_content: {
            post: questionnaireAnswers.availablePost,
            video: questionnaireAnswers.availableVideo,
            blog: questionnaireAnswers.availableBlog,
          },
          weekly_capacity: {
            post: questionnaireAnswers.postPerWeek,
            video: questionnaireAnswers.videoPerWeek,
            blog: questionnaireAnswers.blogPerWeek,
          },
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          setFrequencyValidation(d || null);
          if (ENABLE_UNIFIED_CAMPAIGN_WIZARD && id && d) {
            const store = createCampaignWizardStore(id);
            store.setState({
              frequencySummary: d.frequency_summary,
              validation: d.validation,
            });
          }
        })
        .catch(() => setFrequencyValidation(null));
    }, 700);
    return () => {
      if (frequencyValidationTimeoutRef.current) {
        window.clearTimeout(frequencyValidationTimeoutRef.current);
        frequencyValidationTimeoutRef.current = null;
      }
    };
  }, [
    effectiveCompanyId,
    id,
    crossPlatformSharingEnabled,
    questionnaireAnswers.postPerWeek,
    questionnaireAnswers.videoPerWeek,
    questionnaireAnswers.blogPerWeek,
    questionnaireAnswers.songPerWeek,
    questionnaireAnswers.availablePost,
    questionnaireAnswers.availableVideo,
    questionnaireAnswers.availableBlog,
    requestedWeeksForPreplan,
    prefilledPlanning,
  ]);

  // Autosave wizard state to localStorage (500ms debounce) — skip when using unified store (Zustand persist)
  useEffect(() => {
    if (ENABLE_UNIFIED_CAMPAIGN_WIZARD || typeof id !== 'string' || !id) return;
    const t = window.setTimeout(() => {
      saveWizardState(id, {
        step: prePlanningWizardStep,
        questionnaireAnswers,
        plannedStartDate,
        prePlanningResult: prePlanningResult as any,
        crossPlatformSharingEnabled,
      });
    }, 500);
    return () => window.clearTimeout(t);
  }, [id, prePlanningWizardStep, questionnaireAnswers, plannedStartDate, prePlanningResult, crossPlatformSharingEnabled]);

  // Autosave wizard state to DB (5s debounce)
  useEffect(() => {
    if (typeof id !== 'string' || !id || !effectiveCompanyId) return;
    if (wizardStateDbSaveTimeoutRef.current) {
      window.clearTimeout(wizardStateDbSaveTimeoutRef.current);
      wizardStateDbSaveTimeoutRef.current = null;
    }
    wizardStateDbSaveTimeoutRef.current = window.setTimeout(() => {
      wizardStateDbSaveTimeoutRef.current = null;
      const payload = ENABLE_UNIFIED_CAMPAIGN_WIZARD
        ? exportWizardToSaveWizardStatePayload(createCampaignWizardStore(id).getState())
        : {
            step: prePlanningWizardStep,
            questionnaire_answers: questionnaireAnswers,
            planned_start_date: plannedStartDate,
            pre_planning_result: prePlanningResult,
            cross_platform_sharing_enabled: crossPlatformSharingEnabled,
            updated_at: new Date().toISOString(),
          };
      apiFetch(`/api/campaigns/${encodeURIComponent(id)}/save-wizard-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }, 5000);
    return () => {
      if (wizardStateDbSaveTimeoutRef.current) {
        window.clearTimeout(wizardStateDbSaveTimeoutRef.current);
        wizardStateDbSaveTimeoutRef.current = null;
      }
    };
  }, [id, effectiveCompanyId, prePlanningWizardStep, questionnaireAnswers, plannedStartDate, prePlanningResult, crossPlatformSharingEnabled]);

  const displayWeeklyTitle = (value: string | undefined | null, fallback = 'Untitled Topic') => {
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    return truncateMeaningfulTitle(raw);
  };
  const buildCampaignDetailsUrl = (campaignId: string, focus?: string) => {
    const params = new URLSearchParams();
    if (effectiveCompanyId) params.set('companyId', effectiveCompanyId);
    if (focus) params.set('focus', focus);
    return `/campaign-details/${campaignId}${params.toString() ? `?${params.toString()}` : ''}`;
  };
  const buildPlanningWorkspaceUrl = (campaignId: string) => {
    return buildCampaignDetailsUrl(campaignId);
  };
  const buildCampaignCalendarUrl = (campaignId: string, weekNumber?: number, day?: string) => {
    const params = new URLSearchParams();
    if (effectiveCompanyId) params.set('companyId', effectiveCompanyId);
    if (Number.isFinite(weekNumber) && Number(weekNumber) > 0) params.set('week', String(weekNumber));
    if (day) params.set('day', day);
    return `/campaign-calendar/${campaignId}${params.toString() ? `?${params.toString()}` : ''}`;
  };
  const openCampaignCalendar = (weekNumber?: number, day?: string) => {
    if (typeof id !== 'string') return;
    router.push(buildCampaignCalendarUrl(id, weekNumber, day));
  };
  const getWeekDatesFromCampaignStart = (weekNumber: number) => {
    const startDateRaw = String(campaign?.start_date || '').trim();
    const baseDate = startDateRaw ? new Date(startDateRaw) : new Date();
    const safeBase = Number.isFinite(baseDate.getTime()) ? baseDate : new Date();
    const weekStart = new Date(safeBase);
    weekStart.setDate(safeBase.getDate() + (Math.max(1, weekNumber) - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return {
      start: weekStart.toISOString().split('T')[0],
      end: weekEnd.toISOString().split('T')[0],
      startFormatted: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      endFormatted: weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    };
  };
  const normalizeComparableText = (value: unknown): string =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  const openTopicWorkspaceFromWeeklyCard = (weekNumber: number, topic: any) => {
    const topicTitle = String(topic?.topicTitle || '').trim();
    if (!topicTitle) return;

    const topicPlatforms = Array.isArray(topic?.topicExecution?.platformTargets)
      ? topic.topicExecution.platformTargets.map((p: unknown) => String(p || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const topicContentType = String(topic?.topicExecution?.contentType || 'post').trim().toLowerCase();
    const normalizedTopicTitle = normalizeComparableText(topicTitle);

    const matchedDailyRows = dailyPlans.filter((d) => {
      if (Number(d.weekNumber) !== Number(weekNumber)) return false;
      const dailyTopic =
        normalizeComparableText(d.topic) ||
        normalizeComparableText(d.title) ||
        normalizeComparableText((d.dailyObject as any)?.topicTitle) ||
        normalizeComparableText((d.dailyObject as any)?.topic);
      return dailyTopic === normalizedTopicTitle;
    });

    const weekDates = getWeekDatesFromCampaignStart(weekNumber);
    const schedulesFromDaily = matchedDailyRows.map((d) => ({
      id: String(d.id),
      platform: String(d.platform || '').trim().toLowerCase() || 'linkedin',
      contentType: String(d.contentType || topicContentType || 'post').trim().toLowerCase(),
      date: String((d as any).date || weekDates.start),
      time: String(d.scheduledTime || '09:00'),
      status: String(d.status || 'planned'),
      description: String(d.description || d.summary || ''),
      title: String(d.title || topicTitle),
    }));

    const schedulesFallback = topicPlatforms.map((platform, idx) => ({
      id: `wk${weekNumber}-${platform}-${idx}-${Date.now()}`,
      platform,
      contentType: topicContentType || 'post',
      date: weekDates.start,
      time: '09:00',
      status: 'planned',
      description: String(topic?.topicContext?.writingIntent || ''),
      title: topicTitle,
    }));

    const schedules = schedulesFromDaily.length > 0
      ? schedulesFromDaily
      : (schedulesFallback.length > 0 ? schedulesFallback : [{
          id: `wk${weekNumber}-topic-${Date.now()}`,
          platform: 'linkedin',
          contentType: topicContentType || 'post',
          date: weekDates.start,
          time: '09:00',
          status: 'planned',
          description: String(topic?.topicContext?.writingIntent || ''),
          title: topicTitle,
        }]);

    const firstDailyObject =
      (matchedDailyRows[0]?.dailyObject && typeof matchedDailyRows[0].dailyObject === 'object')
        ? (matchedDailyRows[0].dailyObject as Record<string, unknown>)
        : {};
    const dailyExecutionItem = {
      ...firstDailyObject,
      topic: topicTitle,
      title: topicTitle,
      platform: String(schedules[0]?.platform || 'linkedin'),
      content_type: String(schedules[0]?.contentType || topicContentType || 'post'),
      intent: {
        ...(typeof (firstDailyObject as any)?.intent === 'object' ? ((firstDailyObject as any).intent as Record<string, unknown>) : {}),
        objective: topic?.topicContext?.topicGoal || undefined,
        cta_type: topic?.topicExecution?.ctaType || undefined,
        pain_point: topic?.whatProblemAreWeAddressing || undefined,
        outcome_promise: topic?.whatShouldReaderLearn || undefined,
      },
      writer_content_brief: {
        ...(typeof (firstDailyObject as any)?.writer_content_brief === 'object'
          ? ((firstDailyObject as any).writer_content_brief as Record<string, unknown>)
          : {}),
        topicTitle,
        writingIntent: topic?.topicContext?.writingIntent || undefined,
        whoAreWeWritingFor: topic?.whoAreWeWritingFor || undefined,
        whatProblemAreWeAddressing: topic?.whatProblemAreWeAddressing || undefined,
        whatShouldReaderLearn: topic?.whatShouldReaderLearn || undefined,
        desiredAction: topic?.desiredAction || undefined,
        narrativeStyle: topic?.narrativeStyle || undefined,
        contentTypeGuidance: topic?.contentTypeGuidance || undefined,
      },
    };

    const dayLabel = String((matchedDailyRows[0] as any)?.dayOfWeek || 'Monday');
    const stableActivityId =
      matchedDailyRows[0]?.id != null
        ? String(matchedDailyRows[0].id)
        : `w${weekNumber}-${dayLabel.toLowerCase()}-${topicTitle.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)}`;
    const payload = {
      campaignId: typeof id === 'string' ? id : null,
      weekNumber,
      day: dayLabel,
      activityId: stableActivityId,
      title: topicTitle,
      topic: topicTitle,
      description: String(topic?.topicContext?.writingIntent || ''),
      dailyExecutionItem,
      schedules,
    };

    const workspaceKey = `activity-workspace-${payload.campaignId ?? 'campaign'}-${stableActivityId}`;
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(workspaceKey, JSON.stringify(payload));
        window.open(`/activity-workspace?workspaceKey=${encodeURIComponent(workspaceKey)}`, '_blank');
      }
    } catch (error) {
      console.error('Failed to open topic workspace from weekly card:', error);
    }
  };
  const loadCampaignDetails = async (campaignId: string) => {
    setIsLoading(true);
    try {
      if (!effectiveCompanyId) {
        setIsLoading(false);
        return;
      }
      const campaignResponse = await apiFetch(
        `/api/campaigns?type=campaign&campaignId=${campaignId}&companyId=${encodeURIComponent(
          effectiveCompanyId
        )}`
      );
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json();
        const c = campaignData.campaign;
        setCampaign(c);
        setCampaignMode(campaignData.mode ?? null);
        setRecommendationContext(campaignData.recommendationContext ?? null);
        setPrefilledPlanning(campaignData.prefilledPlanning ?? null);
        const defaultStart = (() => {
          const d = new Date();
          d.setDate(d.getDate() + 7);
          return d.toISOString().split('T')[0];
        })();
        setPlannedStartDate(c?.start_date || defaultStart);

        // Restore wizard state: DB snapshot vs localStorage (use newer)
        if (!hasRestoredWizardStateRef.current && campaignId) {
          hasRestoredWizardStateRef.current = true;
          const dbWs = campaignData.wizardState as { step?: number; questionnaire_answers?: Record<string, unknown>; planned_start_date?: string; pre_planning_result?: Record<string, unknown> | null; updated_at?: string } | undefined;
          const localWs = loadWizardState(campaignId);
          const dbUpdatedAt = dbWs?.updated_at ? new Date(dbWs.updated_at).getTime() : 0;
          const localUpdatedAt = localWs?.updatedAt ? new Date(localWs.updatedAt).getTime() : 0;
          const useDb = dbUpdatedAt > 0 && dbUpdatedAt >= localUpdatedAt;
          const useLocal = localUpdatedAt > 0 && localUpdatedAt > dbUpdatedAt;
          if (ENABLE_UNIFIED_CAMPAIGN_WIZARD) {
            const store = createCampaignWizardStore(campaignId);
            if (useDb && dbWs) {
              const snapshot = {
                wizard_state: { ...dbWs, cross_platform_sharing_enabled: (dbWs as any).cross_platform_sharing_enabled },
                cross_platform_sharing: campaignData.prefilledPlanning?.cross_platform_sharing,
                context_payload: campaignData.prefilledPlanning?.platforms ? { platforms: String((campaignData.prefilledPlanning as any).platforms).split(',').map((p: string) => p.trim()).filter(Boolean) } : undefined,
              };
              const hydrated = hydrateWizardFromSnapshot(snapshot);
              if (Object.keys(hydrated).length > 0) store.setState(hydrated);
            } else if (useLocal && localWs) {
              store.setState({
                step: localWs.step,
                questionnaireAnswers: localWs.questionnaireAnswers,
                plannedStartDate: localWs.plannedStartDate,
                prePlanningResult: localWs.prePlanningResult as any,
                crossPlatformSharingEnabled: localWs.crossPlatformSharingEnabled ?? true,
              });
            }
          } else if (useDb && dbWs) {
            setPrePlanningWizardStep(typeof dbWs.step === 'number' ? dbWs.step : 0);
            if ((dbWs as { cross_platform_sharing_enabled?: boolean }).cross_platform_sharing_enabled !== undefined) {
              setCrossPlatformSharingEnabled((dbWs as { cross_platform_sharing_enabled?: boolean }).cross_platform_sharing_enabled !== false);
            }
            const qa = dbWs.questionnaire_answers;
            if (qa && typeof qa === 'object') {
              setQuestionnaireAnswers((prev) => ({ ...defaultQuestionnaireAnswers, ...prev, ...qa } as QuestionnaireAnswers));
            }
            if (typeof dbWs.planned_start_date === 'string' && dbWs.planned_start_date.trim()) {
              setPlannedStartDate(dbWs.planned_start_date.trim());
            }
            if (dbWs.pre_planning_result && typeof dbWs.pre_planning_result === 'object') {
              setPrePlanningResult(dbWs.pre_planning_result as any);
            }
          } else if (useLocal && localWs) {
            setPrePlanningWizardStep(localWs.step);
            setQuestionnaireAnswers(localWs.questionnaireAnswers);
            setPlannedStartDate(localWs.plannedStartDate);
            if (localWs.prePlanningResult) setPrePlanningResult(localWs.prePlanningResult as any);
            if (localWs.crossPlatformSharingEnabled !== undefined) setCrossPlatformSharingEnabled(localWs.crossPlatformSharingEnabled);
          }
        }
      }

      // Load weekly plans
      const weeklyResponse = await apiFetch(
        `/api/campaigns/get-weekly-plans?campaignId=${campaignId}&companyId=${encodeURIComponent(
          effectiveCompanyId
        )}`
      );
      if (weeklyResponse.ok) {
        const weeklyData = await weeklyResponse.json();
        const rawPlans = Array.isArray(weeklyData)
          ? weeklyData
          : (weeklyData?.plans ?? []);
        const executionPressurePayload =
          !Array.isArray(weeklyData) && weeklyData?.executionPressure != null
            ? weeklyData.executionPressure
            : null;
        const executionMomentumPayload =
          !Array.isArray(weeklyData) && weeklyData?.executionMomentum != null
            ? weeklyData.executionMomentum
            : null;
        const executionMomentumRecoveryPayload =
          !Array.isArray(weeklyData) && weeklyData?.executionMomentumRecovery != null
            ? weeklyData.executionMomentumRecovery
            : null;
        setExecutionPressure(executionPressurePayload);
        setExecutionMomentum(executionMomentumPayload);
        setExecutionMomentumRecovery(executionMomentumRecoveryPayload);
        const executionDriftPayload =
          !Array.isArray(weeklyData) && weeklyData?.executionDrift != null
            ? weeklyData.executionDrift
            : null;
        setExecutionDrift(executionDriftPayload);
        const executionHealthPayload =
          !Array.isArray(weeklyData) && weeklyData?.executionHealth != null
            ? weeklyData.executionHealth
            : null;
        setExecutionHealth(executionHealthPayload);
        const normalizedWeeklyData = Array.isArray(rawPlans)
          ? rawPlans.map((week: any) => ({
              ...week,
              topics: Array.isArray(week?.topics)
                ? week.topics
                : (Array.isArray(week?.week_extras?.topics) ? week.week_extras.topics : []),
              weeklyContextCapsule:
                week?.weeklyContextCapsule ??
                week?.week_extras?.weeklyContextCapsule ??
                null,
            }))
          : [];
        setWeeklyPlans((prev) =>
          normalizedWeeklyData.length > 0 ? normalizedWeeklyData : prev
        );
      }

      // Load daily plans
      const dailyResponse = await apiFetch(
        `/api/campaigns/daily-plans?campaignId=${campaignId}&companyId=${encodeURIComponent(
          effectiveCompanyId
        )}`
      );
      if (dailyResponse.ok) {
        const dailyData = await dailyResponse.json();
        setDailyPlans(dailyData);
      }

      const readinessResponse = await apiFetch(
        `/api/campaigns/${campaignId}/readiness?companyId=${encodeURIComponent(effectiveCompanyId)}`
      );
      if (readinessResponse.ok) {
        const readinessData = await readinessResponse.json();
        setReadiness(readinessData);
      }

      const gateResponse = await apiFetch(`/api/campaigns/${campaignId}/virality/gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: effectiveCompanyId, campaignId }),
      });
      if (gateResponse.ok) {
        const gateData = await gateResponse.json();
        setViralityGate(gateData);
      }

      const diagnosticsResponse = await apiFetch(`/api/campaigns/${campaignId}/virality/assess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: effectiveCompanyId, campaignId }),
      });
      if (diagnosticsResponse.ok) {
        const diagnosticsData = await diagnosticsResponse.json();
        setViralityDiagnostics(diagnosticsData);
      }

      const performanceResponse = await apiFetch(
        `/api/performance/campaign/${campaignId}?companyId=${encodeURIComponent(effectiveCompanyId)}`
      );
      if (performanceResponse.ok) {
        const performanceData = await performanceResponse.json();
        setPerformanceSummary(performanceData);
      }
    } catch (error) {
      console.error('Error loading campaign details:', error);
    } finally {
      setIsLoading(false);
    }
  };
  const toggleWeekExpansion = (weekNumber: number) => {
    const newExpanded = new Set(expandedWeeks);
    if (newExpanded.has(weekNumber)) {
      newExpanded.delete(weekNumber);
    } else {
      newExpanded.add(weekNumber);
    }
    setExpandedWeeks(newExpanded);
  };
  const enhanceWeekWithAI = async (weekNumber: number) => {
    if (!id) return;
    const weekPlan = weeklyPlans.find(w => w.weekNumber === weekNumber);
    setIsGeneratingWeek(weekNumber);
    try {
      const response = await apiFetch('/api/campaigns/generate-weekly-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: effectiveCompanyId,
          campaignId: id,
          week: weekNumber,
          theme: weekPlan?.theme || `Week ${weekNumber} Theme`,
          contentFocus: weekPlan?.focusArea || `Week ${weekNumber} Content Focus`,
          targetAudience: 'General Audience',
          distribution_mode: distributionMode,
        })
      });

      if (response.ok) {
        await loadCampaignDetails(id as string);
        setEditedWeekDailyPlans((prev) => {
          const next = { ...prev };
          delete next[weekNumber];
          return next;
        });
        notify('success', `Week ${weekNumber} has been enhanced with AI.`);
      } else {
        // Blueprint-based generation failed (no blueprint, no execution items, etc.)
        // Always fall back to AI generation regardless of error type.
        const fallbackRes = await apiFetch('/api/campaigns/generate-ai-daily-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId: id,
            weekNumber,
            companyId: effectiveCompanyId,
            provider: 'demo',
          }),
        });
        if (fallbackRes.ok) {
          await loadCampaignDetails(id as string);
          setEditedWeekDailyPlans((prev) => { const next = { ...prev }; delete next[weekNumber]; return next; });
          notify('success', `Generated 7 daily plans for week ${weekNumber}.`);
        } else {
          const fbErr = await fallbackRes.json().catch(() => ({}));
          notify('error', fbErr?.error || 'Failed to generate daily plans.');
        }
      }
    } catch (error) {
      console.error('Error enhancing week:', error);
      notify('error', 'Error enhancing week. Please try again.');
    } finally {
      setIsGeneratingWeek(null);
    }
  };
  const regenerateWeekDailyPlan = async (weekNumber: number) => {
    await enhanceWeekWithAI(weekNumber);
  };
  const createWeekPlanFromStoredContext = async () => {
    if (!id || !campaign || !effectiveCompanyId || isRegeneratingBlueprint || blueprintImmutable || governanceLocked) return;
    if ((campaign as { duration_weeks?: number }).duration_weeks == null) {
      notify('error', 'Set campaign duration first (pre-planning).');
      setTimeout(() => {
        const el = document.getElementById('pre-planning') || document.querySelector('[data-preplanning]');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return;
    }
    setIsRegeneratingBlueprint(true);
    setBlueprintRegenerateFailedMsg(null);
    try {
      let planningContext: Record<string, unknown> | undefined;
      if (typeof window !== 'undefined') {
        const stored = sessionStorage.getItem(`campaign_planning_context_${campaign.id}`);
        if (stored) {
          try {
            planningContext = JSON.parse(stored) as Record<string, unknown>;
          } catch {
            /* ignore */
          }
        }
      }
      const res = await apiFetch('/api/campaigns/regenerate-blueprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          companyId: effectiveCompanyId,
          ...(planningContext && Object.keys(planningContext).length > 0 ? { planningContext } : {}),
        }),
      });
      if (res.ok) {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem(`campaign_planning_context_${campaign.id}`);
        }
        notify('success', 'Week plan created from stored strategic theme and context.');
        loadCampaignDetails(id as string);
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = errData?.message || errData?.error || 'Failed to create plan from stored context';
        setBlueprintRegenerateFailedMsg(msg);
        notify('error', msg);
      }
    } catch (err) {
      console.error('Create week plan from stored context failed', err);
      const msg = err instanceof Error ? err.message : 'Failed to create plan from stored context';
      setBlueprintRegenerateFailedMsg(msg);
      notify('error', msg);
    } finally {
      setIsRegeneratingBlueprint(false);
    }
  };
  const buildDailyPlanPageUrl = (campaignId: string) => {
    const params = new URLSearchParams();
    if (effectiveCompanyId) params.set('companyId', effectiveCompanyId);
    return `/campaign-daily-plan/${campaignId}${params.toString() ? `?${params.toString()}` : ''}`;
  };
  const enhanceAllWeeksWithAI = async () => {
    if (!id || !campaign?.start_date || !(campaign as any).duration_weeks || !effectiveCompanyId) return;
    const total = (campaign as any).duration_weeks as number;
    // Generate for ALL weeks in the campaign (not just pending), so this always produces a full plan.
    const allWeeks = Array.from({ length: total }, (_, i) => i + 1);
    setIsEnhancingAllWeeks(true);
    let generatedCount = 0;
    try {
      for (const weekNumber of allWeeks) {
        const weekPlan = weeklyPlans.find((w) => w.weekNumber === weekNumber);
        const response = await apiFetch('/api/campaigns/generate-weekly-structure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: effectiveCompanyId,
            campaignId: id,
            week: weekNumber,
            theme: (weekPlan as any)?.theme || `Week ${weekNumber} Theme`,
            contentFocus: (weekPlan as any)?.focusArea || `Week ${weekNumber} Content Focus`,
            targetAudience: 'General Audience',
            distribution_mode: distributionMode,
          }),
        });
        if (!response.ok) {
          // Blueprint-based generation failed — always fall back to AI for this week.
          const fallbackRes = await apiFetch('/api/campaigns/generate-ai-daily-plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campaignId: id, weekNumber, companyId: effectiveCompanyId, provider: 'demo' }),
          });
          if (!fallbackRes.ok) {
            const fbErr = await fallbackRes.json().catch(() => ({}));
            notify('error', fbErr?.error || `Failed to generate plans for week ${weekNumber}.`);
            break;
          }
        }
        generatedCount += 1;
      }
      notify('success', `Daily plans generated for ${generatedCount} of ${total} week(s). Opening daily plan page.`);
      router.push(buildDailyPlanPageUrl(id as string));
    } catch (error) {
      console.error('Error enhancing all weeks:', error);
      notify('error', 'Error generating daily plans. Please try again.');
    } finally {
      setIsEnhancingAllWeeks(false);
    }
  };
  const saveWeekDailyPlan = async (weekNumber: number) => {
    if (!id) return;
    const weekList = editedWeekDailyPlans[weekNumber] ?? dailyPlans.filter((d) => d.weekNumber === weekNumber);
    if (weekList.length === 0) {
      notify('info', 'No daily plan items to save.');
      return;
    }
    setIsSavingWeekPlan(weekNumber);
    try {
      const response = await apiFetch('/api/campaigns/save-week-daily-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: id,
          weekNumber,
          items: weekList.map((p) => ({ id: p.id, dayOfWeek: p.dayOfWeek })),
        }),
      });
      const data = response.ok ? await response.json() : null;
      if (data?.success) {
        await loadCampaignDetails(id as string);
        setEditedWeekDailyPlans((prev) => {
          const next = { ...prev };
          delete next[weekNumber];
          return next;
        });
        notify('success', 'Plan saved and set for the next stage.');
      } else {
        notify('error', data?.error || 'Failed to save plan.');
      }
    } catch (error) {
      console.error('Error saving week daily plan:', error);
      notify('error', 'Error saving plan. Please try again.');
    } finally {
      setIsSavingWeekPlan(null);
    }
  };
  const handleDailyPlanDragStart = (e: React.DragEvent, planId: string, dayOfWeek: string) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ planId, dayOfWeek }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDailyPlanDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDailyPlanDrop = (weekNumber: number, targetDay: string, e: React.DragEvent) => {
    e.preventDefault();
    let payload: { planId: string; dayOfWeek: string };
    try {
      payload = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
    } catch {
      return;
    }
    const { planId, dayOfWeek: sourceDay } = payload;
    if (!planId || sourceDay === targetDay) return;
    const weekList = editedWeekDailyPlans[weekNumber] ?? dailyPlans.filter((d) => d.weekNumber === weekNumber);
    const newList = weekList.map((p) => (p.id === planId ? { ...p, dayOfWeek: targetDay } : p));
    setEditedWeekDailyPlans((prev) => ({ ...prev, [weekNumber]: newList }));
  };
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      case 'planned': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };
  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case 'Foundation': return 'from-blue-500 to-cyan-600';
      case 'Growth': return 'from-green-500 to-emerald-600';
      case 'Consolidation': return 'from-purple-500 to-violet-600';
      case 'Sustain': return 'from-orange-500 to-red-600';
      default: return 'from-gray-500 to-slate-600';
    }
  };
  const getActivityColorClasses = (contentType?: string) => {
    const t = String(contentType || '').toLowerCase();
    if (t.includes('video') || t.includes('reel') || t.includes('short')) {
      return {
        card: 'border-red-200 bg-red-50/60',
        badge: 'bg-red-100 text-red-700 border-red-200',
      };
    }
    if (t.includes('image') || t.includes('photo')) {
      return {
        card: 'border-sky-200 bg-sky-50/60',
        badge: 'bg-sky-100 text-sky-700 border-sky-200',
      };
    }
    if (t.includes('carousel')) {
      return {
        card: 'border-fuchsia-200 bg-fuchsia-50/60',
        badge: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
      };
    }
    if (t.includes('blog') || t.includes('article')) {
      return {
        card: 'border-blue-200 bg-blue-50/60',
        badge: 'bg-blue-100 text-blue-700 border-blue-200',
      };
    }
    if (t.includes('story') || t.includes('thread')) {
      return {
        card: 'border-amber-200 bg-amber-50/60',
        badge: 'bg-amber-100 text-amber-700 border-amber-200',
      };
    }
    return {
      card: 'border-emerald-200 bg-emerald-50/60',
      badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    };
  };
  const isVisualContentType = (contentType?: string) => {
    const t = String(contentType || '').toLowerCase();
    return t.includes('video') || t.includes('reel') || t.includes('short') || t.includes('image') || t.includes('photo') || t.includes('carousel');
  };
  const getGateBadgeColor = (decision?: GateResponse['gate_decision']) => {
    switch (decision) {
      case 'pass': return 'bg-green-100 text-green-800';
      case 'warn': return 'bg-amber-100 text-amber-800';
      case 'block': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-700';
    }
  };
  const getGateLabel = (decision?: GateResponse['gate_decision']) => {
    switch (decision) {
      case 'warn': return 'Gate: setup needed';
      case 'block': return 'Gate: block';
      case 'pass': return 'Gate: pass';
      default: return 'Gate: ' + (decision || 'unknown');
    }
  };
  const getConfidenceBadgeColor = (confidence?: DiagnosticSummary['diagnostic_confidence']) => {
    switch (confidence) {
      case 'normal': return 'bg-green-100 text-green-800';
      case 'low': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-700';
    }
  };
  const toggleDiagnostic = (key: string) => {
    const next = new Set(expandedDiagnostics);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setExpandedDiagnostics(next);
  };
  const runPrePlanningFlow = async (weeksOverride?: number) => {
    if (!campaign || !effectiveCompanyId) return;
    const weeks = weeksOverride ?? requestedWeeksForPreplan;
    setPrePlanningLoading(true);
    setPrePlanningResult(null);
    try {
      const res = await apiFetch('/api/campaigns/run-preplanning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          companyId: effectiveCompanyId,
          requested_weeks: weeks,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPrePlanningResult(data);
      }
    } catch (err) {
      console.error('Pre-planning failed', err);
    } finally {
      setPrePlanningLoading(false);
    }
  };
  const acceptDuration = async (weeks: number) => {
    if (!campaign || !effectiveCompanyId) return;
    setPrePlanningLoading(true);
    try {
      const res = await apiFetch('/api/campaigns/update-duration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          companyId: effectiveCompanyId,
          requested_weeks: weeks,
          start_date: plannedStartDate || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'REGENERATION_REQUIRED' || data.status === 'APPROVED') {
          setPrePlanningResult(null);
          try {
            const q = questionnaireAnswers;
            const planningContext: Record<string, unknown> = {
              campaign_duration: weeks,
              tentative_start: plannedStartDate || campaign?.start_date,
              preplanning_form_completed: true,
              cross_platform_sharing: { enabled: crossPlatformSharingEnabled },
            };
            const hasAvailable =
              q.availableVideo > 0 || q.availablePost > 0 || q.availableBlog > 0 || q.availableSong > 0;
            if (hasAvailable) {
              const parts: string[] = [];
              if (q.availableVideo > 0) parts.push(`${q.availableVideo} videos`);
              if (q.availablePost > 0) parts.push(`${q.availablePost} posts`);
              if (q.availableBlog > 0) parts.push(`${q.availableBlog} blogs`);
              if (q.availableSong > 0) parts.push(`${q.availableSong} songs/audio`);
              planningContext.available_content = parts.join(', ');
            } else {
              planningContext.available_content = 'No existing content';
            }
            const hasCapacity =
              q.videoPerWeek > 0 || q.postPerWeek > 0 || q.blogPerWeek > 0 || q.songPerWeek > 0;
            if (hasCapacity) {
              const parts: string[] = [];
              if (q.videoPerWeek > 0) parts.push(`${q.videoPerWeek} videos/week`);
              if (q.postPerWeek > 0) parts.push(`${q.postPerWeek} posts/week`);
              if (q.blogPerWeek > 0) parts.push(`${q.blogPerWeek} blogs/week`);
              if (q.songPerWeek > 0) parts.push(`${q.songPerWeek} songs/audio per week`);
              planningContext.content_capacity = parts.join(', ');
            }
            if (typeof window !== 'undefined') {
              sessionStorage.setItem(`campaign_planning_context_${campaign.id}`, JSON.stringify(planningContext));
            }
            const regRes = await apiFetch('/api/campaigns/regenerate-blueprint', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                campaignId: campaign.id,
                companyId: effectiveCompanyId,
                planningContext,
              }),
            });
            if (!regRes.ok) {
              const errData = await regRes.json().catch(() => ({}));
              const msg = errData?.message || errData?.error || regRes.statusText || 'Blueprint generation failed';
              setBlueprintRegenerateFailedMsg(msg);
              if (typeof window !== 'undefined') {
                sessionStorage.setItem(`campaign_blueprint_failed_${campaign.id}`, msg);
              }
              // Fallback to AI chat so user can add missing context immediately.
              setShowAIChat(true);
            } else {
              setBlueprintRegenerateFailedMsg(null);
              setBlueprintGeneratedSuccess(true);
              setTimeout(() => setBlueprintGeneratedSuccess(false), 6000);
              clearWizardState(campaign.id);
              // Keep behavior aligned with "Ask AI": open chat after generation.
              setShowAIChat(true);
            }
          } catch (regErr: unknown) {
            console.error('Auto-regenerate blueprint failed', regErr);
            const msg = regErr instanceof Error ? regErr.message : 'Blueprint generation failed';
            setBlueprintRegenerateFailedMsg(msg);
            if (typeof window !== 'undefined') {
              sessionStorage.setItem(`campaign_blueprint_failed_${campaign.id}`, msg);
            }
            setShowAIChat(true);
          }
          await loadCampaignDetails(campaign.id);
        } else if (data?.status === 'NEGOTIATE' || data?.status === 'REJECTED') {
          setPrePlanningResult(
            (prePlanningResult
              ? {
                  ...prePlanningResult,
                  status: data.status,
                  explanation_summary: data.message || prePlanningResult.explanation_summary,
                  recommended_duration:
                    data.min_weeks_required ?? data.max_weeks_allowed ?? prePlanningResult.recommended_duration,
                  blocking_constraints: data.blocking_constraints ?? prePlanningResult.blocking_constraints ?? [],
                  limiting_constraints: data.limiting_constraints ?? prePlanningResult.limiting_constraints ?? [],
                  trade_off_options: data.trade_off_options ?? prePlanningResult.trade_off_options ?? [],
                }
              : null) as any
          );
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = errData?.message || errData?.error || 'Failed to update duration';
        setBlueprintRegenerateFailedMsg(msg);
        notify('error', msg);
      }
    } catch (err) {
      console.error('Update duration failed', err);
      setBlueprintRegenerateFailedMsg(err instanceof Error ? err.message : 'Update duration failed');
      notify('error', err instanceof Error ? err.message : 'Update duration failed');
    } finally {
      setPrePlanningLoading(false);
    }
  };


  useEffect(() => {
    if (id && effectiveCompanyId) {
      loadCampaignDetails(id as string);
    }
  }, [id, effectiveCompanyId]);

  return {
    acceptDuration,
    buildCampaignCalendarUrl,
    buildCampaignDetailsUrl,
    buildDailyPlanPageUrl,
    buildPlanningWorkspaceUrl,
    createWeekPlanFromStoredContext,
    crossPlatformSharingEnabled,
    crossPlatformSharingEnabledLegacy,
    displayWeeklyTitle,
    enhanceAllWeeksWithAI,
    enhanceWeekWithAI,
    frequencyValidation,
    frequencyValidationTimeoutRef,
    getActivityColorClasses,
    getConfidenceBadgeColor,
    getGateBadgeColor,
    getGateLabel,
    getPhaseColor,
    getStageColor,
    getStageLabel,
    getStatusColor,
    getWeekDatesFromCampaignStart,
    handleDailyPlanDragOver,
    handleDailyPlanDragStart,
    handleDailyPlanDrop,
    isVisualContentType,
    loadCampaignDetails,
    normalizeComparableText,
    notify,
    openCampaignCalendar,
    openTopicWorkspaceFromWeeklyCard,
    plannedStartDate,
    plannedStartDateLegacy,
    prePlanningResult,
    prePlanningResultLegacy,
    prePlanningWizardStep,
    prePlanningWizardStepLegacy,
    questionnaireAnswers,
    questionnaireAnswersLegacy,
    regenerateWeekDailyPlan,
    runPrePlanningFlow,
    saveWeekDailyPlan,
    setCrossPlatformSharingEnabled,
    setCrossPlatformSharingEnabledLegacy,
    setFrequencyValidation,
    setPlannedStartDate,
    setPlannedStartDateLegacy,
    setPrePlanningResult,
    setPrePlanningResultLegacy,
    setPrePlanningWizardStep,
    setPrePlanningWizardStepLegacy,
    setQuestionnaireAnswers,
    setQuestionnaireAnswersLegacy,
    toggleDiagnostic,
    toggleWeekExpansion,
    wizardStore,
  };
}
