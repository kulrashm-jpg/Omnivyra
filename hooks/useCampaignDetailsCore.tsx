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
import CampaignAIChat from '../components/CampaignAIChat';
import AIGenerationProgress from '../components/AIGenerationProgress';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
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
import { PLATFORM_LABELS } from '../lib/shared/platforms';

import type { Campaign, WeeklyPlan, DailyPlan, ReadinessResponse, GateResponse, GateRequiredAction, DiagnosticSummary, ViralityAssessmentResponse, RecommendationSummary, PerformanceSummary } from '../pages/campaign-details/types';
import type { PlannerDiagnosticsPayload } from '../components/campaign/CampaignPlannerDiagnostics';

export function useCampaignDetailsCore() {
  const router = useRouter();
  const { id, companyId: companyIdFromUrl } = router.query;
  const focusQueryValue = Array.isArray(router.query.focus)
    ? router.query.focus[0]
    : router.query.focus;
  const isWeeklyBlueprintFocus =
    focusQueryValue === 'weekly-blueprint' ||
    router.asPath.includes('focus=weekly-blueprint');
  const shouldForceWeeklyBlueprintView = isWeeklyBlueprintFocus;
  const { selectedCompanyId, isLoading: isCompanyLoading, setSelectedCompanyId } = useCompanyContext();
  // Prefer URL companyId for deep links (prevents "Campaign not found" when a different company is currently selected).
  const effectiveCompanyId = (typeof companyIdFromUrl === 'string' ? companyIdFromUrl : '') || selectedCompanyId || '';
  const session = undefined as { role?: string } | undefined;
  const viewMode = getViewMode(session?.role);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignMode, setCampaignMode] = useState<string | null>(null);
  const [executionPressure, setExecutionPressure] = useState<{
    pressureLevel?: string;
    aiAssistAdded?: number;
    formatsAdjusted?: number;
    postsRedistributed?: number;
    platformStaggeringSuggested?: boolean;
    manualReviewRecommended?: boolean;
  } | null>(null);
  const [executionMomentum, setExecutionMomentum] = useState<{
    state?: string;
    signals?: { continuity?: number; escalation?: number; rhythm?: number };
    momentumScore?: number;
    warnings?: string[];
  } | null>(null);
  const [executionMomentumRecovery, setExecutionMomentumRecovery] = useState<{
    suggestions?: string[];
    recommendedActions?: { adjustWeeks?: number[]; addBridgeContent?: boolean; increaseNarrativeDepth?: boolean };
  } | null>(null);
  const [executionDrift, setExecutionDrift] = useState<{
    state?: string;
    signals?: { schedule?: number; topic?: number; format?: number };
    driftScore?: number;
    warnings?: string[];
    recoverySuggestions?: string[];
  } | null>(null);
  const [executionHealth, setExecutionHealth] = useState<{
    score?: number;
    state?: string;
    signals?: { pressure?: string; momentum?: string; drift?: string };
    warnings?: string[];
  } | null>(null);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>([]);
  const [dailyPlans, setDailyPlans] = useState<DailyPlan[]>([]);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [viralityGate, setViralityGate] = useState<GateResponse | null>(null);
  const [viralityDiagnostics, setViralityDiagnostics] = useState<ViralityAssessmentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [expandedSystemWeek, setExpandedSystemWeek] = useState<number | null>(null);
  const [plannerQueryConsumed, setPlannerQueryConsumed] = useState(false);
  const [isGeneratingWeek, setIsGeneratingWeek] = useState<number | null>(null);
  const [isEnhancingAllWeeks, setIsEnhancingAllWeeks] = useState(false);
  // CAMPAIGN-IMPL-003A: last weekly-generation planner diagnostics (Requested /
  // Generated / Dropped / reasons / integrity), surfaced in the weekly section.
  const [plannerDiagnostics, setPlannerDiagnostics] = useState<PlannerDiagnosticsPayload | null>(null);
  const [editedWeekDailyPlans, setEditedWeekDailyPlans] = useState<Record<number, DailyPlan[]>>({});
  const [isSavingWeekPlan, setIsSavingWeekPlan] = useState<number | null>(null);
  const [selectedWeekDay, setSelectedWeekDay] = useState<{ weekNumber: number; day: string } | null>(null);
  const [distributionMode, setDistributionMode] = useState<'staggered' | 'same_day_per_topic'>('staggered');
  const [isViralityExpanded, setIsViralityExpanded] = useState(false);
  const [showRequiredActions, setShowRequiredActions] = useState(false);
  const [showAdvisoryNotes, setShowAdvisoryNotes] = useState(false);
  const [expandedDiagnostics, setExpandedDiagnostics] = useState<Set<string>>(new Set());
  const [recommendationSummary, setRecommendationSummary] = useState<RecommendationSummary | null>(null);
  const [recommendationId, setRecommendationId] = useState<string | null>(null);
  const [performanceSummary, setPerformanceSummary] = useState<PerformanceSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'governance'>('overview');

  useCampaignResume({
    campaignId: typeof id === 'string' ? id : undefined,
    page: 'campaign-details',
    extraParams: activeTab !== 'overview' ? { tab: activeTab } : undefined,
  });
  const [governanceStatus, setGovernanceStatus] = useState<{
    governance: { durationWeeks: number | null; priorityLevel: string; blueprintStatus: string; durationLocked: boolean; lastPreemptedAt: string | null; cooldownActive: boolean; blueprintImmutable?: boolean; blueprintFrozen?: boolean };
    latestGovernanceEvent: { eventType: string; eventStatus: string; createdAt: string; metadata: Record<string, unknown> } | null;
    trade_off_options?: Array<{ type: string; [key: string]: unknown }>;
  } | null>(null);
  const [governanceEvents, setGovernanceEvents] = useState<Array<{
    id: string; campaignId: string; eventType: string; eventStatus: string; metadata: Record<string, unknown>; createdAt: string;
  }>>([]);
  const [governanceAnalytics, setGovernanceAnalytics] = useState<{
    campaignId: string; executionState: string; totalEvents: number; negotiationCount: number; rejectionCount: number;
    preemptionCount: number; freezeBlocks: number; schedulerRuns: number; completionTimestamp?: string;
    totalScheduledPosts?: number; totalPublishedPosts?: number;
    projectionStatus?: 'ACTIVE' | 'REBUILDING' | 'MISSING';
    roiIntelligence?: {
      roiScore: number;
      performanceScore: number;
      governanceStabilityScore: number;
      executionReliabilityScore: number;
      optimizationSignal: 'STABLE' | 'AT_RISK' | 'HIGH_POTENTIAL';
      recommendation?: string;
    } | null;
    optimizationInsights?: Array<{
      campaignId: string;
      priority: 'LOW' | 'MEDIUM' | 'HIGH';
      category: string;
      headline: string;
      explanation: string;
      recommendedAction: string;
    }> | null;
    optimizationProposal?: {
      campaignId: string;
      summary: string;
      proposedDurationWeeks?: number;
      proposedPostsPerWeek?: number;
      proposedContentMixAdjustment?: Record<string, number>;
      proposedStartDateShift?: string;
      reasoning: string[];
      confidenceScore: number;
    } | null;
    autoOptimizeEnabled?: boolean;
    autoOptimizationEligibility?: { eligible: boolean; reason?: string } | null;
  } | null>(null);
  const [governanceLoading, setGovernanceLoading] = useState(false);
  const [governanceAuditStatus, setGovernanceAuditStatus] = useState<'OK' | 'WARNING' | 'CRITICAL' | null>(null);
  const [governanceLocked, setGovernanceLocked] = useState(false);
  const [governanceSnapshotAt, setGovernanceSnapshotAt] = useState<string | null>(null);
  const [governanceSnapshotCount, setGovernanceSnapshotCount] = useState(0);
  const [governanceLatestSnapshotId, setGovernanceLatestSnapshotId] = useState<string | null>(null);
  const [governanceLedgerIntegrity, setGovernanceLedgerIntegrity] = useState<'VALID' | 'CORRUPTED' | null>(null);
  const [governanceLoadGuardCounts, setGovernanceLoadGuardCounts] = useState({
    replayRateLimitedCount: 0,
    snapshotRestoreBlockedCount: 0,
    projectionRebuildBlockedCount: 0,
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [recommendationContext, setRecommendationContext] = useState<{
    target_regions?: string[] | null;
    context_payload?: Record<string, unknown> | null;
    source_opportunity_id?: string | null;
  } | null>(null);
  const [prefilledPlanning, setPrefilledPlanning] = useState<Record<string, unknown> | null>(null);
  const [showAIChat, setShowAIChat] = useState(false);
  const didAutoOpenChatRef = useRef(false);
  const hasRestoredWizardStateRef = useRef(false);
  const wizardStateDbSaveTimeoutRef = useRef<number | null>(null);
  const [planDurationLimit, setPlanDurationLimit] = useState<{ max_campaign_duration_weeks?: number } | null>(null);
  const [prePlanningLoading, setPrePlanningLoading] = useState(false);
  const [requestedWeeksForPreplan, setRequestedWeeksForPreplan] = useState(12);
  const [isRegeneratingBlueprint, setIsRegeneratingBlueprint] = useState(false);
  const [blueprintRegenerateFailedMsg, setBlueprintRegenerateFailedMsg] = useState<string | null>(null);
  const [blueprintGeneratedSuccess, setBlueprintGeneratedSuccess] = useState(false);
  const [negotiationMessage, setNegotiationMessage] = useState('');
  const [negotiationResult, setNegotiationResult] = useState<{
    status: string;
    explanation: string;
    trade_off_options: Array<{ type: string; newDurationWeeks?: number; reasoning: string; [k: string]: unknown }>;
    evaluation?: { requested_weeks?: number; max_weeks_allowed?: number; min_weeks_required?: number };
  } | null>(null);
  const [negotiationLoading, setNegotiationLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ suggested_weeks: number; rationale: string } | null>(null);
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);


  /** Redirect to campaign details (weekly/daily views live there); hierarchical planning screen removed. */






  useEffect(() => {
    if (!setSelectedCompanyId) return;
    if (typeof companyIdFromUrl !== 'string') return;
    const fromUrl = companyIdFromUrl.trim();
    if (!fromUrl) return;
    if (selectedCompanyId !== fromUrl) {
      setSelectedCompanyId(fromUrl);
    }
  }, [companyIdFromUrl, selectedCompanyId, setSelectedCompanyId]);

  // Restore tab from URL (set by campaign resume)
  useEffect(() => {
    if (!router.isReady) return;
    const tabParam = Array.isArray(router.query.tab) ? router.query.tab[0] : router.query.tab;
    if (tabParam === 'performance' || tabParam === 'governance') {
      setActiveTab(tabParam);
    }
  }, [router.isReady, router.query.tab]);

  useEffect(() => {
    if (!router.isReady || plannerQueryConsumed) return;
    const rawWeek = Array.isArray(router.query.plannerWeek) ? router.query.plannerWeek[0] : router.query.plannerWeek;
    const weekNumber = Number(rawWeek);
    if (!Number.isFinite(weekNumber) || weekNumber < 1) {
      setPlannerQueryConsumed(true);
      return;
    }
    setExpandedWeeks((prev) => new Set([...Array.from(prev), weekNumber]));
    setActiveTab('overview');
    setPlannerQueryConsumed(true);
    setTimeout(() => document.getElementById('content-blueprint')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  }, [router.isReady, router.query.plannerWeek, router.query.plannerDay, plannerQueryConsumed]);

  useEffect(() => {
    const recId =
      typeof router.query.recommendationId === 'string' ? router.query.recommendationId : null;
    setRecommendationId(recId);
    if (!recId || typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(`recommendation_summary_${recId}`);
    if (stored) {
      try {
        setRecommendationSummary(JSON.parse(stored));
      } catch (error) {
        console.warn('Failed to parse recommendation summary');
      }
    }
  }, [router.query.recommendationId]);

  useEffect(() => {
    if (!shouldForceWeeklyBlueprintView) return;

    setShowAIChat(false);
    setActiveTab('overview');
    if (weeklyPlans.length > 0) {
      setExpandedWeeks(new Set([1]));
    }

    if (typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      document.getElementById('weekly-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [shouldForceWeeklyBlueprintView, weeklyPlans.length]);

  const [blueprintImmutable, setBlueprintImmutable] = useState(false);
  const [blueprintFrozen, setBlueprintFrozen] = useState(false);
  useEffect(() => {
    if (!id || !effectiveCompanyId) return;
    fetchWithAuth(`/api/governance/campaign-status?campaignId=${encodeURIComponent(id as string)}&companyId=${encodeURIComponent(effectiveCompanyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.governance) {
          setBlueprintImmutable(data.governance.blueprintImmutable ?? false);
          setBlueprintFrozen(data.governance.blueprintFrozen ?? false);
        }
      })
      .catch(() => {});
  }, [id, effectiveCompanyId]);

  useEffect(() => {
    if (id && typeof window !== 'undefined') {
      const key = `campaign_blueprint_failed_${id}`;
      const msg = sessionStorage.getItem(key);
      if (msg) {
        setBlueprintRegenerateFailedMsg(msg);
        sessionStorage.removeItem(key);
      }
    }
  }, [id]);

  const loadGovernance = useCallback(async () => {
    if (!id || !effectiveCompanyId) return;
    setGovernanceLoading(true);
    try {
      const [statusRes, eventsRes, analyticsRes, driftRes] = await Promise.all([
        fetchWithAuth(`/api/governance/campaign-status?campaignId=${encodeURIComponent(id as string)}&companyId=${encodeURIComponent(effectiveCompanyId)}`),
        fetchWithAuth(`/api/governance/events?companyId=${encodeURIComponent(effectiveCompanyId)}&campaignId=${encodeURIComponent(id as string)}`),
        fetchWithAuth(`/api/governance/campaign-analytics?campaignId=${encodeURIComponent(id as string)}`),
        fetchWithAuth(`/api/governance/company-drift?companyId=${encodeURIComponent(effectiveCompanyId)}`),
      ]);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setBlueprintImmutable(statusData.governance?.blueprintImmutable ?? false);
        setBlueprintFrozen(statusData.governance?.blueprintFrozen ?? false);
        setGovernanceStatus({
          governance: statusData.governance,
          latestGovernanceEvent: statusData.latestGovernanceEvent,
          trade_off_options: statusData.trade_off_options,
        });
      }
      if (eventsRes.ok) {
        const eventsData = await eventsRes.json();
        setGovernanceEvents(eventsData.events ?? []);
      }
      if (analyticsRes.ok) {
        const analyticsData = await analyticsRes.json();
        setGovernanceAnalytics(analyticsData);
      } else {
        setGovernanceAnalytics(null);
      }
      if (driftRes.ok) {
        const driftData = await driftRes.json();
        setGovernanceAuditStatus(driftData.auditStatus ?? null);
        setGovernanceLocked(driftData.locked ?? false);
        setGovernanceSnapshotAt(driftData.lastSnapshotAt ?? null);
        setGovernanceSnapshotCount(driftData.snapshotCount ?? 0);
        setGovernanceLatestSnapshotId(driftData.lastSnapshotId ?? null);
        setGovernanceLedgerIntegrity(driftData.ledgerIntegrity ?? null);
        setGovernanceLoadGuardCounts({
          replayRateLimitedCount: driftData.replayRateLimitedCount ?? 0,
          snapshotRestoreBlockedCount: driftData.snapshotRestoreBlockedCount ?? 0,
          projectionRebuildBlockedCount: driftData.projectionRebuildBlockedCount ?? 0,
        });
      } else {
        setGovernanceAuditStatus(null);
        setGovernanceLocked(false);
        setGovernanceSnapshotAt(null);
        setGovernanceSnapshotCount(0);
        setGovernanceLatestSnapshotId(null);
        setGovernanceLedgerIntegrity(null);
        setGovernanceLoadGuardCounts({ replayRateLimitedCount: 0, snapshotRestoreBlockedCount: 0, projectionRebuildBlockedCount: 0 });
      }
    } catch (err) {
      console.error('Error loading governance:', err);
    } finally {
      setGovernanceLoading(false);
    }
  }, [id, effectiveCompanyId]);

  useEffect(() => {
    if (activeTab !== 'governance' || !id || !effectiveCompanyId) return;
    loadGovernance();
  }, [activeTab, id, effectiveCompanyId, loadGovernance]);

  // Stage 35: Preload campaign-analytics for AI chat optimization context (roi + insights)
  useEffect(() => {
    if (!id || !effectiveCompanyId) return;
    fetchWithAuth(`/api/governance/campaign-analytics?campaignId=${encodeURIComponent(id as string)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setGovernanceAnalytics(data);
      })
      .catch(() => {});
  }, [id, effectiveCompanyId]);

  useEffect(() => {
    if (!id || !effectiveCompanyId) return;
    fetchWithAuth(`/api/governance/company-drift?companyId=${encodeURIComponent(effectiveCompanyId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setGovernanceLocked(d.locked ?? false);
          setGovernanceSnapshotAt(d.lastSnapshotAt ?? null);
          setGovernanceSnapshotCount(d.snapshotCount ?? 0);
          setGovernanceLatestSnapshotId(d.lastSnapshotId ?? null);
          setGovernanceLedgerIntegrity(d.ledgerIntegrity ?? null);
          setGovernanceLoadGuardCounts({
            replayRateLimitedCount: d.replayRateLimitedCount ?? 0,
            snapshotRestoreBlockedCount: d.snapshotRestoreBlockedCount ?? 0,
            projectionRebuildBlockedCount: d.projectionRebuildBlockedCount ?? 0,
          });
        }
      })
      .catch(() => {});
  }, [id, effectiveCompanyId]);

  useEffect(() => {
    const loadAdminStatus = async () => {
      try {
        if (!effectiveCompanyId) return;
        const response = await fetchWithAuth(
          `/api/admin/check-super-admin?companyId=${encodeURIComponent(effectiveCompanyId)}`
        );
        if (!response.ok) return;
        const data = await response.json();
        setIsAdmin(!!data?.isSuperAdmin);
      } catch (error) {
        console.warn('Unable to load admin status');
      }
    };
    loadAdminStatus();
  }, [effectiveCompanyId]);















  /** Use shared Format line logic for all content types (video, image, carousel, post, etc.). */





  const needsPrePlanning = campaign
    ? (campaign as Campaign & { duration_weeks?: number | null }).duration_weeks == null
    : false;
  const fromOpportunity = !!(recommendationContext as { source_opportunity_id?: string | null })?.source_opportunity_id;

  const fetchAiDurationSuggestion = useCallback(async () => {
    if (!campaign || !effectiveCompanyId) return;
    setAiSuggestionLoading(true);
    setAiSuggestion(null);
    try {
      const res = await fetchWithAuth('/api/campaigns/suggest-duration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          companyId: effectiveCompanyId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiSuggestion({ suggested_weeks: data.suggested_weeks, rationale: data.rationale });
        setRequestedWeeksForPreplan(data.suggested_weeks);
      }
    } catch (err) {
      console.error('AI suggestion failed', err);
    } finally {
      setAiSuggestionLoading(false);
    }
  }, [campaign, effectiveCompanyId, fetchWithAuth]);

  useEffect(() => {
    if (shouldForceWeeklyBlueprintView) return;
    if (!needsPrePlanning || didAutoOpenChatRef.current) return;
    didAutoOpenChatRef.current = true;
    setShowAIChat(true);
  }, [needsPrePlanning, shouldForceWeeklyBlueprintView]);

  useEffect(() => {
    if (shouldForceWeeklyBlueprintView) return;
    const fromRecommendation = Boolean(router.query.fromRecommendation);
    if (!fromRecommendation || didAutoOpenChatRef.current) return;
    didAutoOpenChatRef.current = true;
    setShowAIChat(true);
  }, [router.query.fromRecommendation, shouldForceWeeklyBlueprintView]);

  const _ef1 = isCompanyLoading;

  const _ef2 = !effectiveCompanyId;

  const _ef3 = isLoading && !campaign;

  const _ef4 = !campaign;



  // AI-first flow: keep users in chat instead of manual pre-planning screen.
  const _ef5 = false && needsPrePlanning;

  const durationWeeks = (campaign?.duration_weeks ?? weeklyPlans.length) || 12;

  return {
    router, id,
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
    plannerDiagnostics,
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
    setPlannerDiagnostics,
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
  };

  return {
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
    plannerDiagnostics,
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
    setPlannerDiagnostics,
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
  };
}

