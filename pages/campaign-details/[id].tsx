import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import CampaignAIChat from '../../components/CampaignAIChat';
import AIGenerationProgress from '../../components/AIGenerationProgress';
import { useCompanyContext } from '../../components/CompanyContext';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import { GovernanceStatusCard } from '../../components/governance/GovernanceStatusCard';
import { GovernanceAnalyticsCard } from '../../components/governance/GovernanceAnalyticsCard';
import { GovernanceExplanationPanel, deriveFromEvent } from '../../components/governance/GovernanceExplanationPanel';
import { GovernanceTimeline } from '../../components/governance/GovernanceTimeline';
import { PreemptionHistory } from '../../components/governance/PreemptionHistory';
import { TradeOffSuggestionList } from '../../components/governance/TradeOffSuggestionList';
import { truncateMeaningfulTitle } from '../../lib/ui/truncateMeaningfulTitle';

interface Campaign {
  id: string;
  name: string;
  description: string;
  status: string;
  current_stage: string;
  start_date: string;
  end_date: string;
  created_at: string;
  weekly_themes: any[];
  duration_weeks?: number | null;
  blueprint_status?: string | null;
}

interface WeeklyPlan {
  weekNumber: number;
  phase: string;
  theme: string;
  focusArea: string;
  keyMessaging: string;
  contentTypes: string[];
  targetMetrics: {
    impressions: number;
    engagements: number;
    conversions: number;
    ugcSubmissions: number;
  };
  status: string;
  completionPercentage: number;
  weeklyContextCapsule?: {
    campaignTheme?: string;
    primaryPainPoint?: string;
    desiredTransformation?: string;
    campaignStage?: string;
    psychologicalGoal?: string;
    momentum?: string;
    audienceProfile?: string;
    weeklyIntent?: string;
    toneGuidance?: string;
    successOutcome?: string;
  } | null;
  topics?: Array<{
    topicTitle?: string;
    topicContext?: {
      writingIntent?: string;
      topicTitle?: string;
    };
    contentTypeGuidance?: {
      primaryFormat?: string;
      maxWordTarget?: number;
      platformWithHighestLimit?: string;
      adaptationRequired?: boolean;
    };
    whoAreWeWritingFor?: string;
    whatProblemAreWeAddressing?: string;
    whatShouldReaderLearn?: string;
    desiredAction?: string;
    narrativeStyle?: string;
    topicExecution?: {
      platformTargets?: string[];
      contentType?: string;
      ctaType?: string;
      kpiFocus?: string;
    };
  }>;
}

interface DailyPlan {
  id: string;
  weekNumber: number;
  dayOfWeek: string;
  platform: string;
  contentType: string;
  title: string;
  content: string;
  description?: string;
  topic?: string;
  introObjective?: string;
  summary?: string;
  objective?: string;
  keyPoints?: string[];
  cta?: string;
  brandVoice?: string;
  themeLinkage?: string;
  formatNotes?: string;
  hashtags: string[];
  scheduledTime?: string;
  status: string;
  dailyObject?: Record<string, unknown>;
}

interface ReadinessResponse {
  campaign_id: string;
  readiness_percentage: number;
  readiness_state: 'not_ready' | 'partial' | 'ready';
  blocking_issues?: Array<{ code: string; message: string }>;
}

interface GateRequiredAction {
  title: string;
  why: string;
  action: string;
  applies_to_platforms?: string[];
}

interface GateResponse {
  campaign_id: string;
  gate_decision: 'pass' | 'warn' | 'block';
  reasons: string[];
  required_actions: GateRequiredAction[];
  advisory_notes: string[];
  evaluated_at: string;
}

interface DiagnosticSummary {
  diagnostic_summary: string;
  diagnostic_confidence: 'low' | 'normal';
}

interface ViralityAssessmentResponse {
  diagnostics: {
    asset_coverage: DiagnosticSummary;
    platform_opportunity: DiagnosticSummary;
    engagement_readiness: DiagnosticSummary;
  };
}

interface RecommendationSummary {
  recommendation_id: string;
  trend?: string;
  category?: string;
  audience?: any;
  geo?: any;
  platforms?: any;
  promotion_mode?: string;
}

interface PerformanceSummary {
  campaign_id: string;
  impressions: number;
  likes: number;
  shares: number;
  comments: number;
  clicks: number;
  engagement_rate: number;
  expected_reach?: number | null;
  accuracy_score: number;
  recommendation_confidence?: number | null;
  last_collected_at?: string | null;
}


export default function CampaignDetails() {
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
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>([]);
  const [dailyPlans, setDailyPlans] = useState<DailyPlan[]>([]);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [viralityGate, setViralityGate] = useState<GateResponse | null>(null);
  const [viralityDiagnostics, setViralityDiagnostics] = useState<ViralityAssessmentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [plannerQueryConsumed, setPlannerQueryConsumed] = useState(false);
  const [isGeneratingWeek, setIsGeneratingWeek] = useState<number | null>(null);
  const [editedWeekDailyPlans, setEditedWeekDailyPlans] = useState<Record<number, DailyPlan[]>>({});
  const [isSavingWeekPlan, setIsSavingWeekPlan] = useState<number | null>(null);
  const [distributionMode, setDistributionMode] = useState<'staggered' | 'same_day_per_topic'>('staggered');
  const [isViralityExpanded, setIsViralityExpanded] = useState(false);
  const [showRequiredActions, setShowRequiredActions] = useState(false);
  const [showAdvisoryNotes, setShowAdvisoryNotes] = useState(false);
  const [expandedDiagnostics, setExpandedDiagnostics] = useState<Set<string>>(new Set());
  const [recommendationSummary, setRecommendationSummary] = useState<RecommendationSummary | null>(null);
  const [recommendationId, setRecommendationId] = useState<string | null>(null);
  const [performanceSummary, setPerformanceSummary] = useState<PerformanceSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'governance'>('overview');
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
  const [prePlanningResult, setPrePlanningResult] = useState<{
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
  const [prePlanningWizardStep, setPrePlanningWizardStep] = useState(0);
  const [plannedStartDate, setPlannedStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<{
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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    const params = new URLSearchParams();
    params.set('campaignId', campaignId);
    if (effectiveCompanyId) params.set('companyId', effectiveCompanyId);
    return `/campaign-planning-hierarchical?${params.toString()}`;
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

  useEffect(() => {
    if (id && effectiveCompanyId) {
      loadCampaignDetails(id as string);
    }
  }, [id, effectiveCompanyId]);

  useEffect(() => {
    if (!setSelectedCompanyId) return;
    if (typeof companyIdFromUrl !== 'string') return;
    const fromUrl = companyIdFromUrl.trim();
    if (!fromUrl) return;
    if (selectedCompanyId !== fromUrl) {
      setSelectedCompanyId(fromUrl);
    }
  }, [companyIdFromUrl, selectedCompanyId, setSelectedCompanyId]);

  useEffect(() => {
    if (!router.isReady || plannerQueryConsumed) return;
    const rawWeek = Array.isArray(router.query.plannerWeek) ? router.query.plannerWeek[0] : router.query.plannerWeek;
    const rawDay = Array.isArray(router.query.plannerDay) ? router.query.plannerDay[0] : router.query.plannerDay;
    const weekNumber = Number(rawWeek);
    if (!Number.isFinite(weekNumber) || weekNumber < 1) {
      setPlannerQueryConsumed(true);
      return;
    }
    const normalizedDay = String(rawDay || 'Monday').trim();
    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const selectedDay = validDays.includes(normalizedDay) ? normalizedDay : 'Monday';
    setExpandedWeeks((prev) => new Set([...Array.from(prev), weekNumber]));
    setActiveTab('overview');
    setPlannerQueryConsumed(true);
    if (typeof id === 'string') {
      router.replace(buildCampaignCalendarUrl(id, weekNumber, selectedDay));
    }
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
    fetchWithAuth(`/api/governance/campaign-status?campaignId=${encodeURIComponent(id as string)}`)
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
        fetchWithAuth(`/api/governance/campaign-status?campaignId=${encodeURIComponent(id as string)}`),
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

  const loadCampaignDetails = async (campaignId: string) => {
    setIsLoading(true);
    try {
      if (!effectiveCompanyId) {
        setIsLoading(false);
        return;
      }
      const campaignResponse = await fetchWithAuth(
        `/api/campaigns?type=campaign&campaignId=${campaignId}&companyId=${encodeURIComponent(
          effectiveCompanyId
        )}`
      );
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json();
        const c = campaignData.campaign;
        setCampaign(c);
        setRecommendationContext(campaignData.recommendationContext ?? null);
        setPrefilledPlanning(campaignData.prefilledPlanning ?? null);
        const defaultStart = (() => {
          const d = new Date();
          d.setDate(d.getDate() + 7);
          return d.toISOString().split('T')[0];
        })();
        setPlannedStartDate(c?.start_date || defaultStart);
      }

      // Load weekly plans
      const weeklyResponse = await fetchWithAuth(
        `/api/campaigns/get-weekly-plans?campaignId=${campaignId}&companyId=${encodeURIComponent(
          effectiveCompanyId
        )}`
      );
      if (weeklyResponse.ok) {
        const weeklyData = await weeklyResponse.json();
        const normalizedWeeklyData = Array.isArray(weeklyData)
          ? weeklyData.map((week: any) => ({
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
        setWeeklyPlans(normalizedWeeklyData);
      }

      // Load daily plans
      const dailyResponse = await fetchWithAuth(
        `/api/campaigns/daily-plans?campaignId=${campaignId}&companyId=${encodeURIComponent(
          effectiveCompanyId
        )}`
      );
      if (dailyResponse.ok) {
        const dailyData = await dailyResponse.json();
        setDailyPlans(dailyData);
      }

      const readinessResponse = await fetchWithAuth(
        `/api/campaigns/${campaignId}/readiness?companyId=${encodeURIComponent(effectiveCompanyId)}`
      );
      if (readinessResponse.ok) {
        const readinessData = await readinessResponse.json();
        setReadiness(readinessData);
      }

      const gateResponse = await fetchWithAuth(`/api/campaigns/${campaignId}/virality/gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: effectiveCompanyId, campaignId }),
      });
      if (gateResponse.ok) {
        const gateData = await gateResponse.json();
        setViralityGate(gateData);
      }

      const diagnosticsResponse = await fetchWithAuth(`/api/campaigns/${campaignId}/virality/assess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: effectiveCompanyId, campaignId }),
      });
      if (diagnosticsResponse.ok) {
        const diagnosticsData = await diagnosticsResponse.json();
        setViralityDiagnostics(diagnosticsData);
      }

      const performanceResponse = await fetchWithAuth(
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
      const response = await fetchWithAuth('/api/campaigns/generate-weekly-structure', {
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

  const saveWeekDailyPlan = async (weekNumber: number) => {
    if (!id) return;
    const weekList = editedWeekDailyPlans[weekNumber] ?? dailyPlans.filter((d) => d.weekNumber === weekNumber);
    if (weekList.length === 0) {
      notify('info', 'No daily plan items to save.');
      return;
    }
    setIsSavingWeekPlan(weekNumber);
    try {
      const response = await fetchWithAuth('/api/campaigns/save-week-daily-plan', {
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
  const getStageColor = (stage: string) => {
    const m: Record<string, string> = {
      planning: 'bg-blue-100 text-blue-800',
      twelve_week_plan: 'bg-indigo-100 text-indigo-800',
      daily_plan: 'bg-amber-100 text-amber-800',
      charting: 'bg-teal-100 text-teal-800',
      schedule: 'bg-green-100 text-green-800',
    };
    return m[stage] ?? 'bg-gray-100 text-gray-800';
  };
  const getStageLabel = (stage: string, durationWeeks?: number | null) => {
    const { getStageLabelWithDuration } = require('../../backend/types/CampaignStage');
    return getStageLabelWithDuration(stage, durationWeeks);
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
    if (needsPrePlanning && !showAIChat) {
      setShowAIChat(true);
    }
  }, [needsPrePlanning, showAIChat, shouldForceWeeklyBlueprintView]);

  useEffect(() => {
    if (shouldForceWeeklyBlueprintView) return;
    const fromRecommendation = Boolean(router.query.fromRecommendation);
    if (!fromRecommendation) return;
    // Recommendation-driven production flow must open in AI Chat first.
    if (!showAIChat) setShowAIChat(true);
  }, [router.query.fromRecommendation, showAIChat, shouldForceWeeklyBlueprintView]);

  if (isCompanyLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <AIGenerationProgress
            isActive={true}
            message="Loading company context…"
            expectedSeconds={8}
          />
        </div>
      </div>
    );
  }

  if (!effectiveCompanyId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600">Select a company to view campaign details.</p>
          <button
            onClick={() => router.push('/campaigns')}
            className="mt-4 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
          >
            Back to Campaigns
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <AIGenerationProgress
            isActive={true}
            message="Creating weekly content…"
            expectedSeconds={18}
          />
        </div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600">Campaign not found</p>
          <button 
            onClick={() => router.push('/campaigns')}
            className="mt-4 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
          >
            Back to Campaigns
          </button>
        </div>
      </div>
    );
  }

  const runPrePlanningFlow = async (weeksOverride?: number) => {
    if (!campaign || !effectiveCompanyId) return;
    const weeks = weeksOverride ?? requestedWeeksForPreplan;
    setPrePlanningLoading(true);
    setPrePlanningResult(null);
    try {
      const res = await fetchWithAuth('/api/campaigns/run-preplanning', {
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
      const res = await fetchWithAuth('/api/campaigns/update-duration', {
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
            const regRes = await fetchWithAuth('/api/campaigns/regenerate-blueprint', {
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
            prePlanningResult
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
              : null
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

  // AI-first flow: keep users in chat instead of manual pre-planning screen.
  if (false && needsPrePlanning) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-8"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Campaign Not Initialized</h1>
            <p className="text-gray-600 mb-6">
              This campaign starts with AI-guided planning before generating a campaign blueprint.
              Share details in chat and AI will build the weekly plan flow.
            </p>
            {blueprintFrozen && (
              <div className="mb-6 rounded-lg border-2 border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 font-semibold text-amber-800">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  Execution Window Frozen — Changes Locked (&lt;24h to first scheduled post)
                </div>
                <p className="mt-1 text-sm text-amber-700">
                  Duration edit, regenerate blueprint, and negotiation are disabled until after the first scheduled post.
                </p>
              </div>
            )}
            {blueprintImmutable && !blueprintFrozen && (
              <div className="mb-6 rounded-lg border-2 border-red-200 bg-red-50 p-4">
                <div className="flex items-center gap-2 font-semibold text-red-800">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  Blueprint Locked — Campaign In Execution
                </div>
                <p className="mt-1 text-sm text-red-700">
                  Duration changes are disabled while the campaign has scheduled or published posts.
                </p>
              </div>
            )}
            {!prePlanningResult ? (
              <>
                {fromOpportunity ? (
                  prePlanningWizardStep === 0 ? (
                    <>
                      <div className="mb-6 p-4 rounded-lg border border-indigo-200 bg-indigo-50/80">
                        <h3 className="text-sm font-semibold text-indigo-900 mb-3">From your recommendation</h3>
                        <p className="text-sm text-indigo-800 mb-2">
                          <strong>Topic:</strong> {campaign?.name ?? '—'}
                        </p>
                        {campaign?.description && (
                          <p className="text-sm text-indigo-800 mb-2">
                            <strong>Brief:</strong> {String(campaign.description).slice(0, 300)}
                            {String(campaign.description).length > 300 ? '…' : ''}
                          </p>
                        )}
                        {(recommendationContext as { context_payload?: Record<string, unknown> })?.context_payload && (
                          <>
                            {Array.isArray((recommendationContext as any).context_payload?.formats) &&
                              (recommendationContext as any).context_payload.formats.length > 0 && (
                                <p className="text-sm text-indigo-800 mb-2">
                                  <strong>Formats:</strong>{' '}
                                  {(recommendationContext as any).context_payload.formats.join(', ')}
                                </p>
                              )}
                            {(recommendationContext as any).context_payload?.reach_estimate != null && (
                              <p className="text-sm text-indigo-800 mb-2">
                                <strong>Reach:</strong>{' '}
                                {String((recommendationContext as any).context_payload.reach_estimate)}
                              </p>
                            )}
                          </>
                        )}
                        {(recommendationContext as { target_regions?: string[] })?.target_regions?.length ? (
                          <p className="text-sm text-indigo-800">
                            <strong>Regions:</strong>{' '}
                            {(recommendationContext as any).target_regions.join(', ')}
                          </p>
                        ) : null}
                      </div>
                      <p className="text-sm font-medium text-gray-700 mb-3">Choose how to plan</p>
                      <div className="flex flex-col sm:flex-row gap-4">
                        <button
                          onClick={() => setPrePlanningWizardStep(1)}
                          disabled={blueprintImmutable || blueprintFrozen || governanceLocked}
                          className="flex-1 px-6 py-4 rounded-xl border-2 border-gray-200 hover:border-indigo-300 bg-white text-left disabled:opacity-50 transition-colors"
                        >
                          <Calendar className="h-6 w-6 text-indigo-600 mb-2" />
                          <span className="font-semibold text-gray-900 block">Fill the form</span>
                          <span className="text-sm text-gray-600">Step-by-step wizard: start date, duration, content capacity.</span>
                        </button>
                        <button
                          onClick={() => setShowAIChat(true)}
                          className="flex-1 px-6 py-4 rounded-xl border-2 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 text-left transition-colors"
                        >
                          <Sparkles className="h-6 w-6 text-indigo-600 mb-2" />
                          <span className="font-semibold text-gray-900 block">Use AI</span>
                          <span className="text-sm text-gray-600">Answer planning questions in chat; AI skips what you&apos;ve already provided.</span>
                        </button>
                      </div>
                    </>
                  ) : prePlanningWizardStep >= 1 && prePlanningWizardStep <= 6 ? (
                    <div className="space-y-6">
                      {prePlanningWizardStep === 1 && (
                        <>
                          <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                            <h3 className="font-medium text-gray-900 mb-2">Campaign start date</h3>
                            <p className="text-sm text-gray-600 mb-4">
                              When will this campaign begin? Daily plans will be generated for weeks from this date.
                            </p>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
                              <input
                                type="date"
                                value={plannedStartDate}
                                onChange={(e) => setPlannedStartDate(e.target.value)}
                                min={new Date().toISOString().split('T')[0]}
                                className="w-full max-w-xs px-3 py-2 border rounded-lg"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setPrePlanningWizardStep(0)}
                              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                            >
                              Back
                            </button>
                            <button
                              onClick={() => setPrePlanningWizardStep(2)}
                              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                            >
                              Next
                            </button>
                          </div>
                        </>
                      )}
                      {prePlanningWizardStep === 2 && (
                        <>
                          <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                            <h3 className="font-medium text-gray-900 mb-2">How much related content do you have?</h3>
                            <p className="text-sm text-gray-600 mb-4">
                              Content that fits this campaign topic. We&apos;ll use these as placeholders; the rest will be planned for creation.
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Video (pieces)</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={questionnaireAnswers.availableVideo}
                                  onChange={(e) =>
                                    setQuestionnaireAnswers((q) => ({
                                      ...q,
                                      availableVideo: Math.max(0, Number(e.target.value) || 0),
                                    }))
                                  }
                                  className="w-full px-3 py-2 border rounded-lg"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Post / Carousel (pieces)</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={questionnaireAnswers.availablePost}
                                  onChange={(e) =>
                                    setQuestionnaireAnswers((q) => ({
                                      ...q,
                                      availablePost: Math.max(0, Number(e.target.value) || 0),
                                    }))
                                  }
                                  className="w-full px-3 py-2 border rounded-lg"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Blog (pieces)</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={questionnaireAnswers.availableBlog}
                                  onChange={(e) =>
                                    setQuestionnaireAnswers((q) => ({
                                      ...q,
                                      availableBlog: Math.max(0, Number(e.target.value) || 0),
                                    }))
                                  }
                                  className="w-full px-3 py-2 border rounded-lg"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Song / Audio (pieces)</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={questionnaireAnswers.availableSong}
                                  onChange={(e) =>
                                    setQuestionnaireAnswers((q) => ({
                                      ...q,
                                      availableSong: Math.max(0, Number(e.target.value) || 0),
                                    }))
                                  }
                                  className="w-full px-3 py-2 border rounded-lg"
                                />
                              </div>
                            </div>
                          </div>
                            <div className="flex gap-2">
                            <button
                              onClick={() => setPrePlanningWizardStep(1)}
                              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                            >
                              Back
                            </button>
                            <button
                              onClick={() => {
                                const hasContent =
                                  questionnaireAnswers.availableVideo > 0 ||
                                  questionnaireAnswers.availablePost > 0 ||
                                  questionnaireAnswers.availableBlog > 0 ||
                                  questionnaireAnswers.availableSong > 0;
                                setPrePlanningWizardStep(hasContent ? 3 : 4);
                              }}
                              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                            >
                              Next
                            </button>
                          </div>
                        </>
                      )}
                      {prePlanningWizardStep === 3 && (
                        <>
                          <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                            <h3 className="font-medium text-gray-900 mb-2">Is this content suited for this campaign?</h3>
                            <p className="text-sm text-gray-600 mb-4">
                              Does the available content align with the campaign topic and formats?
                            </p>
                            <div className="flex gap-4">
                              <button
                                onClick={() => setQuestionnaireAnswers((q) => ({ ...q, contentSuited: true }))}
                                className={`px-4 py-2 rounded-lg border-2 ${
                                  questionnaireAnswers.contentSuited === true
                                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                                    : 'border-gray-200 hover:border-gray-300'
                                }`}
                              >
                                Yes, it fits
                              </button>
                              <button
                                onClick={() => setQuestionnaireAnswers((q) => ({ ...q, contentSuited: false }))}
                                className={`px-4 py-2 rounded-lg border-2 ${
                                  questionnaireAnswers.contentSuited === false
                                    ? 'border-amber-600 bg-amber-50 text-amber-800'
                                    : 'border-gray-200 hover:border-gray-300'
                                }`}
                              >
                                No / Partial
                              </button>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setPrePlanningWizardStep(2)}
                              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                            >
                              Back
                            </button>
                            <button
                              onClick={() => setPrePlanningWizardStep(4)}
                              disabled={questionnaireAnswers.contentSuited === null}
                              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                            >
                              Next
                            </button>
                          </div>
                        </>
                      )}
                      {prePlanningWizardStep === 4 && (
                        <>
                          <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                            <h3 className="font-medium text-gray-900 mb-2">How much more content can you create per week?</h3>
                            <p className="text-sm text-gray-600 mb-4">
                              Based on in-house capability: videos, posts, blogs, songs and other content your team can produce weekly.
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Videos per week</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={questionnaireAnswers.videoPerWeek}
                                  onChange={(e) =>
                                    setQuestionnaireAnswers((q) => ({
                                      ...q,
                                      videoPerWeek: Math.max(0, Number(e.target.value) || 0),
                                    }))
                                  }
                                  className="w-full px-3 py-2 border rounded-lg"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Posts / Carousels per week</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={questionnaireAnswers.postPerWeek}
                                  onChange={(e) =>
                                    setQuestionnaireAnswers((q) => ({
                                      ...q,
                                      postPerWeek: Math.max(0, Number(e.target.value) || 0),
                                    }))
                                  }
                                  className="w-full px-3 py-2 border rounded-lg"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Blogs per week</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={questionnaireAnswers.blogPerWeek}
                                  onChange={(e) =>
                                    setQuestionnaireAnswers((q) => ({
                                      ...q,
                                      blogPerWeek: Math.max(0, Number(e.target.value) || 0),
                                    }))
                                  }
                                  className="w-full px-3 py-2 border rounded-lg"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Songs / Audio per week</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={questionnaireAnswers.songPerWeek}
                                  onChange={(e) =>
                                    setQuestionnaireAnswers((q) => ({
                                      ...q,
                                      songPerWeek: Math.max(0, Number(e.target.value) || 0),
                                    }))
                                  }
                                  className="w-full px-3 py-2 border rounded-lg"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const hasContent =
                                  questionnaireAnswers.availableVideo > 0 ||
                                  questionnaireAnswers.availablePost > 0 ||
                                  questionnaireAnswers.availableBlog > 0 ||
                                  questionnaireAnswers.availableSong > 0;
                                setPrePlanningWizardStep(hasContent ? 3 : 2);
                              }}
                              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                            >
                              Back
                            </button>
                            <button
                              onClick={() => setPrePlanningWizardStep(5)}
                              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                            >
                              Next
                            </button>
                          </div>
                        </>
                      )}
                      {prePlanningWizardStep === 5 && (
                        <>
                          <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                            <h3 className="font-medium text-gray-900 mb-2">In-house capacity (optional)</h3>
                            <p className="text-sm text-gray-600 mb-2">
                              Any constraints or notes about your team&apos;s content creation capability?
                            </p>
                            <textarea
                              value={questionnaireAnswers.inHouseNotes}
                              onChange={(e) =>
                                setQuestionnaireAnswers((q) => ({ ...q, inHouseNotes: e.target.value }))
                              }
                              placeholder="e.g. Video production takes 2 days per piece; we have 1 designer..."
                              rows={3}
                              className="w-full px-3 py-2 border rounded-lg"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setPrePlanningWizardStep(4)}
                              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                            >
                              Back
                            </button>
                            <button
                              onClick={async () => {
                                setPrePlanningWizardStep(6);
                                setAiSuggestionLoading(true);
                                setAiSuggestion(null);
                                try {
                                  const res = await fetchWithAuth('/api/campaigns/suggest-duration', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      campaignId: campaign?.id,
                                      companyId: effectiveCompanyId,
                                      availableContent: {
                                        video: questionnaireAnswers.availableVideo,
                                        post: questionnaireAnswers.availablePost,
                                        blog: questionnaireAnswers.availableBlog,
                                        song: questionnaireAnswers.availableSong,
                                      },
                                      contentSuited: questionnaireAnswers.contentSuited ?? undefined,
                                      creationCapacity: {
                                        video_per_week: questionnaireAnswers.videoPerWeek,
                                        post_per_week: questionnaireAnswers.postPerWeek,
                                        blog_per_week: questionnaireAnswers.blogPerWeek,
                                        song_per_week: questionnaireAnswers.songPerWeek,
                                      },
                                      inHouseNotes: questionnaireAnswers.inHouseNotes.trim() || undefined,
                                    }),
                                  });
                                  if (res.ok) {
                                    const data = await res.json();
                                    setAiSuggestion({
                                      suggested_weeks: data.suggested_weeks,
                                      rationale: data.rationale,
                                    });
                                    setRequestedWeeksForPreplan(data.suggested_weeks);
                                  }
                                } catch (err) {
                                  console.error('AI suggestion failed', err);
                                } finally {
                                  setAiSuggestionLoading(false);
                                }
                              }}
                              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                            >
                              Get AI duration suggestion
                            </button>
                          </div>
                        </>
                      )}
                      {prePlanningWizardStep === 6 && (
                        <>
                          <div className="p-4 rounded-lg border border-indigo-200 bg-indigo-50/80">
                            <h3 className="font-medium text-indigo-900 mb-2">Suggested campaign duration</h3>
                            {aiSuggestionLoading ? (
                              <p className="text-sm text-indigo-700">Getting suggestion…</p>
                            ) : aiSuggestion ? (
                              <>
                                <p className="text-sm text-indigo-800 mb-2">
                                  AI suggests <strong>{aiSuggestion.suggested_weeks} weeks</strong>
                                </p>
                                <p className="text-sm text-indigo-700 mb-4">{aiSuggestion.rationale}</p>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    onClick={async () => {
                                      setRequestedWeeksForPreplan(aiSuggestion!.suggested_weeks);
                                      await runPrePlanningFlow(aiSuggestion!.suggested_weeks);
                                    }}
                                    disabled={prePlanningLoading || blueprintImmutable || blueprintFrozen || governanceLocked}
                                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    Proceed with {aiSuggestion.suggested_weeks} weeks
                                  </button>
                                  <button
                                    onClick={() => {
                                      setPrePlanningWizardStep(5);
                                      setAiSuggestion(null);
                                    }}
                                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                                  >
                                    Adjust inputs
                                  </button>
                                </div>
                              </>
                            ) : (
                              <p className="text-sm text-indigo-600">Review your answers and click &quot;Get AI duration suggestion&quot; on the previous step.</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setPrePlanningWizardStep(5)}
                              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                            >
                              Back
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : null
                ) : (
                  <>
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Requested duration (weeks)</label>
                      <input
                        type="number"
                        min={1}
                        max={52}
                        value={requestedWeeksForPreplan}
                        onChange={(e) => setRequestedWeeksForPreplan(Number(e.target.value) || 12)}
                        className="w-32 px-3 py-2 border rounded-lg"
                      />
                    </div>
                    <p className="text-sm font-medium text-gray-700 mb-3">Start with AI planning</p>
                    <div className="flex flex-col gap-4">
                      <button
                        onClick={() => setShowAIChat(true)}
                        disabled={prePlanningLoading || blueprintImmutable || blueprintFrozen || governanceLocked}
                        className="w-full px-6 py-4 rounded-xl border-2 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 text-left transition-colors disabled:opacity-50"
                      >
                        <Sparkles className="h-6 w-6 text-indigo-600 mb-2" />
                        <span className="font-semibold text-gray-900 block">Start with AI</span>
                        <span className="text-sm text-gray-600">AI asks planning questions, gathers missing context, and generates your blueprint-ready weekly plan.</span>
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{prePlanningResult.explanation_summary}</p>
                </div>
                {prePlanningResult.limiting_constraints?.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-1">Limiting constraints</h3>
                    <ul className="text-sm text-gray-600 list-disc pl-5">
                      {prePlanningResult.limiting_constraints.map((c, i) => (
                        <li key={i}>{c.reasoning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {prePlanningResult.blocking_constraints?.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-1">Blocking constraints</h3>
                    <ul className="text-sm text-gray-600 list-disc pl-5">
                      {prePlanningResult.blocking_constraints.map((c, i) => (
                        <li key={i}>{c.reasoning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap gap-3 pt-4">
                  {(prePlanningResult.status === 'APPROVED' || prePlanningResult.status === 'NEGOTIATE') && (
                    <button
                      onClick={() => acceptDuration(prePlanningResult.recommended_duration)}
                      disabled={prePlanningLoading || blueprintImmutable || blueprintFrozen || governanceLocked}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {prePlanningLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      {prePlanningLoading ? 'Accepting & generating blueprint…' : `Accept & generate blueprint (${prePlanningResult.recommended_duration} weeks)`}
                    </button>
                  )}
                  {prePlanningLoading && (
                    <div className="w-full mt-4">
                      <AIGenerationProgress
                        isActive={true}
                        message="Generating blueprint… Opening AI chat when ready."
                        expectedSeconds={55}
                      />
                    </div>
                  )}
                  {prePlanningResult.trade_off_options?.map((opt, i) =>
                    opt.newDurationWeeks != null ? (
                      <button
                        key={i}
                        onClick={() => acceptDuration(opt.newDurationWeeks!)}
                        disabled={prePlanningLoading || blueprintImmutable || blueprintFrozen || governanceLocked}
                        className="px-4 py-2 bg-blue-100 text-blue-800 rounded-lg hover:bg-blue-200 disabled:opacity-50"
                      >
                        {opt.type}: {opt.newDurationWeeks} weeks
                      </button>
                    ) : null
                  )}
                  <button
                    onClick={() => setShowAIChat(true)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    Ask AI
                  </button>
                  <button
                    onClick={() => setPrePlanningResult(null)}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* AI Assistant during pre-planning is handled by the main chat below (single instance). */}
      </div>
    );
  }

  const durationWeeks = (campaign?.duration_weeks ?? weeklyPlans.length) || 12;
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <Head>
        <title>{campaign?.name ? `${durationWeeks}-Week Campaign Plan – ${campaign.name}` : 'Campaign Plan'}</title>
      </Head>
      {router.query.fromRecommendation && recommendationId && (
        <div className="bg-indigo-50 border-b border-indigo-100">
          <div className="max-w-7xl mx-auto px-6 py-3 text-sm text-indigo-800">
            Created from Recommendation {recommendationId}
          </div>
        </div>
      )}
      {notice && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              notice.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : notice.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-800'
            }`}
            role="status"
            aria-live="polite"
          >
            {notice.message}
          </div>
        </div>
      )}
      {/* Header — compact nav, title, status, actions */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4 mb-3">
            <button
              onClick={() => router.push('/campaigns')}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Campaigns
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push(`/campaigns/${campaign.id}/recommendations`)}
                className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1.5"
              >
                <TrendingUp className="h-3.5 w-3.5" />
                Expert Recommendations
              </button>
              {isAdmin && (
                <button
                  onClick={() => router.push(`/recommendations/policy?campaignId=${campaign.id}`)}
                  className="px-3 py-1.5 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-1.5"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Policy
                </button>
              )}
              <button
                onClick={() => setShowAIChat(true)}
                className="px-3 py-1.5 text-sm bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-colors flex items-center gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI Assistant
              </button>
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight max-w-4xl" title={campaign.name}>
              {(() => {
                const words = (campaign.name || '').trim().split(/\s+/).filter(Boolean);
                return words.length > 8 ? words.slice(0, 8).join(' ') + '…' : campaign.name;
              })()}
            </h1>
            <p className="text-xs text-gray-500 mt-1">Content Marketing Plan · ID: {campaign.id}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStageColor(campaign.current_stage || campaign.status)}`}>
                {getStageLabel(campaign.current_stage || campaign.status, campaign.duration_weeks)}
              </span>
              <span className="text-xs text-gray-600">
                Readiness: <span className="font-semibold">{readiness?.readiness_percentage ?? '--'}%</span>
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getGateBadgeColor(viralityGate?.gate_decision)}`}>
                {getGateLabel(viralityGate?.gate_decision)}
              </span>
              <span className="text-xs text-gray-500">
                {campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : 'Not scheduled'}
                {campaign.end_date ? ` – ${new Date(campaign.end_date).toLocaleDateString()}` : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              activeTab === 'overview'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 border'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('performance')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              activeTab === 'performance'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 border'
            }`}
          >
            Performance
          </button>
          <button
            onClick={() => setActiveTab('governance')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              activeTab === 'governance'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 border'
            }`}
          >
            Governance
          </button>
        </div>
        {router.query.fromRecommendation && recommendationId && (
          <div className="bg-white rounded-xl p-6 shadow-sm border mb-8">
            <h2 className="text-xl font-semibold mb-4">Recommendation Summary</h2>
            {recommendationSummary ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-700">
                <div>
                  <div className="font-medium text-gray-900">Trend</div>
                  <div>{recommendationSummary.trend || '—'}</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">Category</div>
                  <div>{recommendationSummary.category || '—'}</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">Promotion</div>
                  <div>{recommendationSummary.promotion_mode || '—'}</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">Audience</div>
                  <div>
                    {typeof recommendationSummary.audience === 'string'
                      ? recommendationSummary.audience
                      : JSON.stringify(recommendationSummary.audience)}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">Geo</div>
                  <div>
                    {typeof recommendationSummary.geo === 'string'
                      ? recommendationSummary.geo
                      : JSON.stringify(recommendationSummary.geo)}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">Platforms</div>
                  <div>
                    {Array.isArray(recommendationSummary.platforms)
                      ? recommendationSummary.platforms.map((p: any) => p.platform || p).join(', ')
                      : JSON.stringify(recommendationSummary.platforms)}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Recommendation details unavailable.</p>
            )}
          </div>
        )}
        {activeTab === 'overview' && (
          <>
            {blueprintGeneratedSuccess && (
              <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3">
                <p className="text-emerald-800 text-sm flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 flex-shrink-0" />
                  Blueprint generated! Use the <strong>AI Assistant</strong> below to refine it.
                </p>
                <button
                  type="button"
                  onClick={() => setBlueprintGeneratedSuccess(false)}
                  className="flex-shrink-0 p-1 text-emerald-700 hover:text-emerald-900"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {/* Stage 11: Generate blueprint when duration set and blueprint invalidated */}
            {(campaign as Campaign & { blueprint_status?: string | null }).blueprint_status === 'INVALIDATED' && !blueprintImmutable && !blueprintFrozen && !governanceLocked && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-8">
                <h2 className="text-xl font-semibold text-amber-900 mb-2">Blueprint required</h2>
                {blueprintRegenerateFailedMsg && (
                  <div className="mb-4 p-3 bg-amber-100 border border-amber-300 rounded-lg flex items-center justify-between gap-2">
                    <p className="text-amber-900 text-sm">
                      Blueprint generation could not be completed automatically: {blueprintRegenerateFailedMsg}
                    </p>
                    <button
                      type="button"
                      onClick={() => setBlueprintRegenerateFailedMsg(null)}
                      className="flex-shrink-0 p-1 text-amber-700 hover:text-amber-900"
                      aria-label="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <p className="text-amber-800 mb-4">
                  Duration is set. Generate a campaign blueprint to continue.
                </p>
                <button
                  onClick={async () => {
                    if (!campaign || !effectiveCompanyId) return;
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
                      const res = await fetchWithAuth('/api/campaigns/regenerate-blueprint', {
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
                        loadCampaignDetails(campaign.id);
                      } else {
                        const errData = await res.json().catch(() => ({}));
                        setBlueprintRegenerateFailedMsg(errData?.message || errData?.error || 'Generation failed');
                      }
                    } catch (err) {
                      console.error('Regenerate blueprint failed', err);
                      setBlueprintRegenerateFailedMsg(err instanceof Error ? err.message : 'Generation failed');
                    } finally {
                      setIsRegeneratingBlueprint(false);
                    }
                  }}
                  disabled={isRegeneratingBlueprint || governanceLocked}
                  className="px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {isRegeneratingBlueprint ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
                  Generate Campaign Blueprint
                </button>
                {isRegeneratingBlueprint && (
                  <div className="mt-4">
                    <AIGenerationProgress
                      isActive={true}
                      message="Generating campaign blueprint…"
                      expectedSeconds={50}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Content Blueprint — your created plan; weekly content in weeks below */}
            <div className="bg-white rounded-xl p-6 shadow-sm border mb-8" id="content-blueprint">
              <h2 className="text-xl font-semibold mb-1">Content Blueprint</h2>
              <p className="text-sm text-gray-500 mb-4">
                Your submitted plan; weekly content is listed in the weeks below.
                <button
                  type="button"
                  onClick={() => document.getElementById('weekly-content')?.scrollIntoView({ behavior: 'smooth' })}
                  className="ml-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium underline"
                >
                  Jump to Weekly Content ↓
                </button>
              </p>
              {campaign?.description && <p className="text-gray-600 mb-4">{campaign.description}</p>}
              {weeklyPlans.length > 0 ? (
                <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <span className="text-sm font-medium text-gray-700">Blueprint summary: </span>
                  <span className="text-sm text-gray-600">
                    {weeklyPlans
                      .sort((a, b) => a.weekNumber - b.weekNumber)
                      .map((w) => `Week ${w.weekNumber}: ${displayWeeklyTitle(w.theme || w.phase || w.focusArea, 'Untitled Topic')}`)
                      .join(' • ')}
                  </span>
                </div>
              ) : (
                <div className="mb-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-sm text-amber-800">
                    No content blueprint yet. Use <strong>AI Assistant</strong> to generate a campaign plan, or go to campaign planning to create one.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600 mb-1">{durationWeeks}</div>
                  <div className="text-sm text-gray-600">Total Weeks</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600 mb-1">
                    {weeklyPlans.filter(w => w.status === 'completed').length}
                  </div>
                  <div className="text-sm text-gray-600">Completed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600 mb-1">
                    {weeklyPlans.filter(w => w.status === 'in_progress').length}
                  </div>
                  <div className="text-sm text-gray-600">In Progress</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600 mb-1">
                    {weeklyPlans.filter(w => w.status === 'planned').length}
                  </div>
                  <div className="text-sm text-gray-600">Planned</div>
                </div>
              </div>
            </div>

            {/* Weekly Content — blueprint per week, placed in weeks below */}
            <div className="bg-white rounded-xl p-6 shadow-sm border mb-8" id="weekly-content">
              {(() => {
                const hasStartDate = !!(campaign as { start_date?: string }).start_date;
                const hasDuration = !!(campaign as { duration_weeks?: number }).duration_weeks;
                const canPlanDaily = hasStartDate && hasDuration;
                return canPlanDaily ? null : (
                  <div className="mb-6 p-4 rounded-lg border-2 border-amber-200 bg-amber-50">
                    <div className="flex items-center gap-2 font-semibold text-amber-800">
                      <AlertCircle className="h-5 w-5 flex-shrink-0" />
                      Fix start date and tentative duration before planning daily content
                    </div>
                    <p className="mt-1 text-sm text-amber-700">
                      Complete pre-planning to set campaign start date and duration. Daily plans will be available once these are confirmed.
                    </p>
                  </div>
                );
              })()}
              <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Weekly Content</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Blueprint per week; expand each week for details.
                    <button
                      type="button"
                      onClick={() => document.getElementById('content-blueprint')?.scrollIntoView({ behavior: 'smooth' })}
                      className="ml-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium underline"
                    >
                      ↑ Back to Content Blueprint
                    </button>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push(buildPlanningWorkspaceUrl(campaign.id))}
                    disabled={!campaign?.start_date || !(campaign as any).duration_weeks}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="View plan and work on daily content for each week"
                  >
                    <Calendar className="h-4 w-4" />
                    View Plan & Work on Daily
                  </button>
                  <button 
                    onClick={() => router.push(`/ai-chat?campaignId=${campaign.id}&context=12week-plan`)}
                    disabled={!campaign?.start_date || !(campaign as any).duration_weeks}
                    className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="h-4 w-4" />
                    AI Enhance All Weeks
                  </button>
                </div>
              </div>
              <div className="space-y-4">
                {Array.from({ length: durationWeeks }, (_, i) => i + 1).map(weekNumber => {
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
                  const topicsWithExecution = hasEnrichedTopics
                    ? (((weekPlan as any).topics as any[]).map((topic, idx) => ({
                        ...topic,
                        topicExecution: {
                          platformTargets: platformTargets.length > 0
                            ? [platformTargets[idx % platformTargets.length]]
                            : ['—'],
                          contentType: contentTypes[idx % Math.max(contentTypes.length, 1)] || '—',
                          ctaType: (weekPlan as any)?.cta_type || '—',
                          kpiFocus: (weekPlan as any)?.weekly_kpi_focus || '—',
                        },
                      })))
                    : [];
                  const topicsCount = hasEnrichedTopics
                    ? ((weekPlan as any).topics as any[]).length
                    : (((weekPlan as any)?.topics_to_cover as string[] | undefined)?.length ?? 0);
                  
                  return (
                    <div key={weekNumber} className="border rounded-lg overflow-hidden">
                      {/* Week Header */}
                      <div 
                        className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => toggleWeekExpansion(weekNumber)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className={`p-2 rounded-lg bg-gradient-to-r ${getPhaseColor(weekPlan?.phase || 'Foundation')}`}>
                              <Calendar className="h-5 w-5 text-white" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-lg">Week {weekNumber}</h3>
                              <p className="text-gray-600">{displayWeeklyTitle(weekPlan?.theme || `Week ${weekNumber} Theme`)}</p>
                              <p className="text-sm text-gray-500">{displayWeeklyTitle(weekPlan?.focusArea || `Week ${weekNumber} Focus Area`)}</p>
                              {(weekPlan as any)?.platform_allocation && Object.keys((weekPlan as any).platform_allocation).length > 0 && (
                                <p className="text-xs text-indigo-600 mt-1">
                                  {Object.entries((weekPlan as any).platform_allocation).map(([p, c]) => `${p}: ${c}`).join(' · ')}
                                </p>
                              )}
                              {topicsCount > 0 && (
                                <p className="text-xs text-gray-500 mt-0.5">{topicsCount} topics</p>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4">
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
                              className="px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all flex items-center gap-1 disabled:opacity-50"
                            >
                              {isGeneratingWeek === weekNumber ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Sparkles className="h-3 w-3" />
                              )}
                              [+]
                            </button>
                            
                            {isExpanded ? (
                              <ChevronDown className="h-5 w-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-gray-400" />
                            )}
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
                                {!hasEnrichedTopics && (weekPlan as any)?.topics_to_cover?.length > 0 && (
                                  <div>
                                    <span className="text-sm font-medium text-gray-600">Topics to cover:</span>
                                    <ul className="mt-1 list-disc list-inside text-sm text-gray-700">
                                      {((weekPlan as any).topics_to_cover as string[]).map((t, i) => (
                                        <li key={i}>{displayWeeklyTitle(t)}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {(((weekPlan as any)?.weeklyContextCapsule && typeof (weekPlan as any).weeklyContextCapsule === 'object') || hasEnrichedTopics) && (
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
                                          <div><span className="font-medium">Tone:</span> {(weekPlan as any).weeklyContextCapsule.toneGuidance}</div>
                                        )}
                                        {(weekPlan as any).weeklyContextCapsule.campaignStage && (
                                          <div><span className="font-medium">Campaign stage:</span> {(weekPlan as any).weeklyContextCapsule.campaignStage}</div>
                                        )}
                                        {(weekPlan as any).weeklyContextCapsule.psychologicalGoal && (
                                          <div><span className="font-medium">Psychological goal:</span> {(weekPlan as any).weeklyContextCapsule.psychologicalGoal}</div>
                                        )}
                                      </div>
                                    )}
                                    {hasEnrichedTopics && (
                                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                        {topicsWithExecution.map((topic, idx) => (
                                          <button
                                            key={`${topic?.topicTitle || 'topic'}-${idx}`}
                                            type="button"
                                            onClick={() => openTopicWorkspaceFromWeeklyCard(weekNumber, topic)}
                                            className={`text-xs text-gray-700 rounded border p-2 text-left hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors cursor-pointer ${getActivityColorClasses(topic?.topicExecution?.contentType).card}`}
                                          >
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="font-medium">{displayWeeklyTitle(topic?.topicTitle, 'Untitled Topic')}</div>
                                              <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${getActivityColorClasses(topic?.topicExecution?.contentType).badge}`}>
                                                {topic?.topicExecution?.contentType || 'activity'}
                                              </span>
                                            </div>
                                            {topic?.topicContext?.writingIntent && (
                                              <div className="mt-0.5"><span className="font-medium">Writing intent:</span> {topic.topicContext.writingIntent}</div>
                                            )}
                                            <div className="mt-1 pt-1 border-t border-gray-100">
                                              <div className="font-medium text-gray-800">Execution details</div>
                                              <div className="mt-0.5"><span className="font-medium">Platform(s):</span> {(topic?.topicExecution?.platformTargets || ['—']).join(', ')}</div>
                                              <div className="mt-0.5"><span className="font-medium">Content type:</span> {topic?.topicExecution?.contentType || '—'}</div>
                                              <div className="mt-0.5"><span className="font-medium">CTA:</span> {topic?.topicExecution?.ctaType || '—'}</div>
                                              <div className="mt-0.5"><span className="font-medium">KPI target:</span> {topic?.topicExecution?.kpiFocus || '—'}</div>
                                            </div>
                                            {topic?.whoAreWeWritingFor && (
                                              <div className="mt-0.5"><span className="font-medium">Who we write for:</span> {topic.whoAreWeWritingFor}</div>
                                            )}
                                            {topic?.whatProblemAreWeAddressing && (
                                              <div className="mt-0.5"><span className="font-medium">Problem:</span> {topic.whatProblemAreWeAddressing}</div>
                                            )}
                                            {topic?.whatShouldReaderLearn && (
                                              <div className="mt-0.5"><span className="font-medium">Reader learns:</span> {topic.whatShouldReaderLearn}</div>
                                            )}
                                            {topic?.desiredAction && (
                                              <div className="mt-0.5"><span className="font-medium">Desired action:</span> {topic.desiredAction}</div>
                                            )}
                                            {topic?.narrativeStyle && (
                                              <div className="mt-0.5"><span className="font-medium">Narrative style:</span> {topic.narrativeStyle}</div>
                                            )}
                                            {(topic?.contentTypeGuidance?.primaryFormat || topic?.contentTypeGuidance?.maxWordTarget || topic?.contentTypeGuidance?.platformWithHighestLimit) && (
                                              <div className="mt-0.5">
                                                <span className="font-medium">Format:</span> {topic?.contentTypeGuidance?.primaryFormat || '—'}
                                                {topic?.contentTypeGuidance?.maxWordTarget ? ` · Max words: ${topic.contentTypeGuidance.maxWordTarget}` : ''}
                                                {topic?.contentTypeGuidance?.platformWithHighestLimit ? ` · Highest-limit platform: ${topic.contentTypeGuidance.platformWithHighestLimit}` : ''}
                                              </div>
                                            )}
                                            <div className="mt-1 text-[10px] text-indigo-600">Click to open topic workspace</div>
                                          </button>
                                        ))}
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

                          {/* Daily Plans — drag-and-drop by day; regenerate or save & freeze */}
                          <div className="mt-6">
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
                              <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => {
                                  const dayItems = (editedWeekDailyPlans[weekNumber] ?? weekDailyPlans).filter(d => d.dayOfWeek === day);
                                  const hasPlans = dayItems.length > 0;
                                  return (
                                    <div
                                      key={day}
                                      onDragOver={handleDailyPlanDragOver}
                                      onDrop={(e) => handleDailyPlanDrop(weekNumber, day, e)}
                                      className="border rounded p-2 min-h-[80px] hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors text-left"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => openCampaignCalendar(weekNumber, day)}
                                        className="w-full text-left"
                                      >
                                        <div className="text-xs font-medium text-gray-600 mb-1">{day}</div>
                                      </button>
                                      {hasPlans ? (
                                        <div className="space-y-1">
                                          <div className="flex flex-wrap gap-1">
                                            {dayItems.map((p) => {
                                              const colors = getActivityColorClasses(p.contentType);
                                              const topicLabel = (p.title || p.topic || '').trim().slice(0, 32);
                                              return (
                                                <div
                                                  key={p.id}
                                                  draggable
                                                  onDragStart={(e) => handleDailyPlanDragStart(e, p.id, p.dayOfWeek)}
                                                  className="flex items-start gap-1 cursor-grab active:cursor-grabbing group rounded border border-transparent hover:border-gray-300 p-0.5 -m-0.5"
                                                >
                                                  <GripVertical className="h-3 w-3 text-gray-400 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100" aria-hidden />
                                                  <div className="min-w-0 flex-1">
                                                    {topicLabel ? (
                                                      <div className="text-[10px] text-gray-700 truncate" title={p.title || p.topic}>{topicLabel}{topicLabel.length >= 32 ? '…' : ''}</div>
                                                    ) : null}
                                                    <span
                                                      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium capitalize ${colors.badge}`}
                                                    >
                                                      {p.platform} • {p.contentType}
                                                    </span>
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                          <div className={`w-2 h-2 rounded-full mt-1 ${
                                            dayItems.some(d => d.status === 'completed') ? 'bg-green-500' :
                                            dayItems.some(d => d.status === 'scheduled') ? 'bg-blue-500' : 'bg-gray-300'
                                          }`} />
                                          {dayItems.length > 1 && (
                                            <div className="text-[10px] text-indigo-600 mt-0.5">{dayItems.length} items</div>
                                          )}
                                        </div>
                                      ) : (
                                        <div className="text-xs text-gray-400">No plan</div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-center py-4 text-gray-500">
                                <Calendar className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                                <p>No daily plans generated yet</p>
                                <button 
                                  onClick={() => enhanceWeekWithAI(weekNumber)}
                                  disabled={!campaign?.start_date || !(campaign as any).duration_weeks}
                                  className="mt-2 px-3 py-1 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Generate Daily Plans
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Virality Review — readiness check (assets, platforms, engagement); fix blocking issues before scheduling */}
            <div className="bg-white rounded-xl p-6 shadow-sm border mb-8">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-semibold">Virality Review</h2>
                <button
                  onClick={() => setIsViralityExpanded(!isViralityExpanded)}
                  className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-2"
                >
                  {isViralityExpanded ? 'Hide details' : 'Show details'}
                  {isViralityExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Checks readiness to run this campaign (assets, platforms, engagement). Fix any blocking issues before scheduling.
              </p>

              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getGateBadgeColor(viralityGate?.gate_decision)}`}>
                  {getGateLabel(viralityGate?.gate_decision)}
                </span>
                <span className="text-sm text-gray-700">
                  Readiness: <span className="font-semibold">{readiness?.readiness_percentage ?? '--'}%</span>
                </span>
              </div>

              {(viralityGate?.gate_decision === 'block' || viralityGate?.gate_decision === 'warn') && (viralityGate?.reasons?.length ?? 0) > 0 && (
                <div className={`mb-4 rounded-lg border p-3 ${
                  viralityGate.gate_decision === 'block'
                    ? 'border-red-200 bg-red-50'
                    : 'border-amber-200 bg-amber-50'
                }`}>
                  <div className={`flex items-center gap-2 font-medium mb-2 ${
                    viralityGate.gate_decision === 'block' ? 'text-red-700' : 'text-amber-800'
                  }`}>
                    <AlertCircle className="h-4 w-4" />
                    {viralityGate.gate_decision === 'block' ? 'Blocking reasons' : 'Next steps'}
                  </div>
                  <ul className={`text-sm space-y-1 ${
                    viralityGate.gate_decision === 'block' ? 'text-red-700' : 'text-amber-800'
                  }`}>
                    {(viralityGate?.reasons || []).map((reason, index) => (
                      <li key={`reason-${index}`} className="flex items-start gap-2">
                        <span className="mt-0.5">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mb-3">
                <button
                  onClick={() => setShowRequiredActions(!showRequiredActions)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  {showRequiredActions ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Required actions
                  {viralityGate?.required_actions?.length ? (
                    <span className="text-gray-500 font-normal">({viralityGate.required_actions.length})</span>
                  ) : null}
                </button>
                {showRequiredActions && (
                  <div className="mt-2 pl-4 border-l-2 border-gray-200">
                    {viralityGate?.required_actions?.length ? (
                      <div className="space-y-2">
                        {viralityGate.required_actions.map((action, index) => (
                          <div key={`action-${index}`} className="rounded-lg border p-2.5 text-sm">
                            <div className="font-medium text-gray-900">{action.title}</div>
                            {action.why && <div className="text-gray-600 mt-0.5">{action.why}</div>}
                            <div className="text-gray-600 mt-1">{action.action}</div>
                            {action.applies_to_platforms?.length ? (
                              <div className="text-xs text-gray-500 mt-1">
                                Platforms: {action.applies_to_platforms.join(', ')}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No required actions at this time.</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <button
                  onClick={() => setShowAdvisoryNotes(!showAdvisoryNotes)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  {showAdvisoryNotes ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Advisory notes
                  {viralityGate?.advisory_notes?.length ? (
                    <span className="text-gray-500 font-normal">({viralityGate.advisory_notes.length})</span>
                  ) : null}
                </button>
                {showAdvisoryNotes && (
                  <div className="mt-2 pl-4 border-l-2 border-gray-200">
                    {viralityGate?.advisory_notes?.length ? (
                      <ul className="text-sm text-gray-600 space-y-1">
                        {viralityGate.advisory_notes.map((note, index) => (
                          <li key={`note-${index}`} className="flex items-start gap-2">
                            <span className="mt-0.5">•</span>
                            <span>{note}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-500">No advisory notes available.</p>
                    )}
                  </div>
                )}
              </div>

              {isViralityExpanded && (
                <div className="mt-6 border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Diagnostics</h3>
                  {[
                    { key: 'asset_coverage', title: 'Asset Coverage', data: viralityDiagnostics?.diagnostics.asset_coverage },
                    { key: 'platform_opportunity', title: 'Platform Opportunity', data: viralityDiagnostics?.diagnostics.platform_opportunity },
                    { key: 'engagement_readiness', title: 'Engagement Readiness', data: viralityDiagnostics?.diagnostics.engagement_readiness },
                  ].map((item) => (
                    <div key={item.key} className="border rounded-lg mb-3">
                      <button
                        className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50"
                        onClick={() => toggleDiagnostic(item.key)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium">{item.title}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceBadgeColor(item.data?.diagnostic_confidence)}`}>
                            {item.data?.diagnostic_confidence || 'unknown'}
                          </span>
                        </div>
                        {expandedDiagnostics.has(item.key) ? (
                          <ChevronDown className="h-4 w-4 text-gray-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                      </button>
                      {expandedDiagnostics.has(item.key) && (
                        <div className="px-4 pb-4 text-sm text-gray-600">
                          {item.data?.diagnostic_summary || 'No diagnostic summary available.'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'governance' && (
          <div className="space-y-6">
            {governanceLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              </div>
            ) : !governanceStatus ? (
              <div className="bg-white rounded-xl p-6 shadow-sm border">
                <p className="text-sm text-gray-500">Unable to load governance data. Try again later.</p>
              </div>
            ) : (
              <>
                {governanceLocked && (
                  <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 font-medium">
                    Governance Lockdown Active — Mutations Disabled
                  </div>
                )}
                {governanceStatus.governance?.blueprintFrozen && !governanceLocked && (
                  <div className="mb-6 rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-center gap-2 font-semibold text-amber-800">
                      <AlertCircle className="h-5 w-5 flex-shrink-0" />
                      Execution Window Frozen — Changes Locked (&lt;24h to first scheduled post)
                    </div>
                    <p className="mt-1 text-sm text-amber-700">
                      Duration edit, regenerate blueprint, and negotiation are disabled until after the first scheduled post.
                    </p>
                  </div>
                )}
                {governanceStatus.governance?.blueprintImmutable && !governanceStatus.governance?.blueprintFrozen && !governanceLocked && (
                  <div className="mb-6 rounded-xl border-2 border-red-200 bg-red-50 p-4">
                    <div className="flex items-center gap-2 font-semibold text-red-800">
                      <AlertCircle className="h-5 w-5 flex-shrink-0" />
                      Blueprint Locked — Campaign In Execution
                    </div>
                    <p className="mt-1 text-sm text-red-700">
                      Duration edit, regenerate blueprint, and negotiation are disabled while the campaign has scheduled or published posts.
                    </p>
                  </div>
                )}
                <GovernanceStatusCard
                  governance={governanceStatus.governance}
                  latestEvent={governanceStatus.latestGovernanceEvent}
                />
                <GovernanceAnalyticsCard
                  analytics={governanceAnalytics}
                  loading={governanceLoading}
                  campaignId={id as string}
                  companyId={effectiveCompanyId ?? undefined}
                  onRefresh={loadGovernance}
                  auditStatus={governanceAuditStatus ?? undefined}
                  governanceLocked={governanceLocked}
                  lastSnapshotAt={governanceSnapshotAt}
                  snapshotCount={governanceSnapshotCount}
                  latestSnapshotId={governanceLatestSnapshotId}
                  isSuperAdmin={isAdmin}
                  ledgerIntegrity={governanceLedgerIntegrity ?? undefined}
                  projectionStatus={governanceAnalytics?.projectionStatus ?? undefined}
                  replayRateLimitedCount={governanceLoadGuardCounts.replayRateLimitedCount}
                  snapshotRestoreBlockedCount={governanceLoadGuardCounts.snapshotRestoreBlockedCount}
                  projectionRebuildBlockedCount={governanceLoadGuardCounts.projectionRebuildBlockedCount}
                  roiIntelligence={governanceAnalytics?.roiIntelligence}
                  optimizationInsights={governanceAnalytics?.optimizationInsights}
                  optimizationProposal={governanceAnalytics?.optimizationProposal ?? null}
                  onApplyProposal={(proposal) => {
                    const parts: string[] = [];
                    if (proposal.proposedDurationWeeks != null) {
                      parts.push(`${proposal.proposedDurationWeeks} weeks`);
                    }
                    if (proposal.proposedPostsPerWeek != null) {
                      parts.push(`${proposal.proposedPostsPerWeek} posts per week`);
                    }
                    setNegotiationMessage(parts.length > 0 ? parts.join(', ') : proposal.summary);
                  }}
                  autoOptimizeEnabled={governanceAnalytics?.autoOptimizeEnabled}
                  autoOptimizationEligibility={governanceAnalytics?.autoOptimizationEligibility}
                  onToggleAutoOptimize={async (enabled) => {
                    if (!id || !effectiveCompanyId) return;
                    const res = await fetchWithAuth('/api/analytics/toggle-auto-optimize', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ campaignId: id, companyId: effectiveCompanyId, enabled }),
                    });
                    if (res.ok) loadGovernance();
                  }}
                />
                {governanceStatus.latestGovernanceEvent ? (
                  <GovernanceExplanationPanel
                    derived={deriveFromEvent(
                      governanceStatus.latestGovernanceEvent.eventType,
                      governanceStatus.latestGovernanceEvent.metadata
                    )}
                  />
                ) : (
                  <GovernanceExplanationPanel />
                )}
                {governanceStatus.trade_off_options && governanceStatus.trade_off_options.length > 0 && (
                  <TradeOffSuggestionList options={governanceStatus.trade_off_options} />
                )}
                {governanceStatus.governance?.durationWeeks != null &&
                  !governanceStatus.governance?.blueprintImmutable &&
                  !governanceStatus.governance?.blueprintFrozen &&
                  !governanceLocked &&
                  ((governanceStatus.latestGovernanceEvent?.eventType === 'PRE_PLANNING_EVALUATED' ||
                    governanceStatus.latestGovernanceEvent?.eventType === 'DURATION_NEGOTIATED') &&
                    governanceStatus.latestGovernanceEvent?.eventStatus === 'NEGOTIATE') && (
                  <div className="bg-white rounded-xl p-6 shadow-sm border">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Refine your duration</h3>
                    <p className="text-sm text-gray-600 mb-3">
                      Try a different duration (e.g. &quot;14 weeks&quot;, &quot;extend&quot;, &quot;reduce&quot;) and re-evaluate.
                    </p>
                    <div className="flex gap-3 flex-wrap">
                      <input
                        type="text"
                        placeholder="Refine your duration…"
                        value={negotiationMessage}
                        onChange={(e) => setNegotiationMessage(e.target.value)}
                        className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                      <button
                        onClick={async () => {
                          if (!id || !effectiveCompanyId) return;
                          setNegotiationLoading(true);
                          setNegotiationResult(null);
                          try {
                            const res = await fetchWithAuth('/api/campaigns/negotiate-duration', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                campaignId: id,
                                companyId: effectiveCompanyId,
                                message: negotiationMessage,
                              }),
                            });
                            if (res.ok) {
                              const data = await res.json();
                              setNegotiationResult({
                                status: data.status,
                                explanation: data.explanation,
                                trade_off_options: data.trade_off_options ?? [],
                                evaluation: data.evaluation,
                              });
                              const [statusRes, eventsRes, analyticsRes] = await Promise.all([
                                fetchWithAuth(`/api/governance/campaign-status?campaignId=${encodeURIComponent(id as string)}`),
                                fetchWithAuth(`/api/governance/events?companyId=${encodeURIComponent(effectiveCompanyId)}&campaignId=${encodeURIComponent(id as string)}`),
                                fetchWithAuth(`/api/governance/campaign-analytics?campaignId=${encodeURIComponent(id as string)}`),
                              ]);
                              if (statusRes.ok) {
                                const statusData = await statusRes.json();
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
                              }
                            }
                          } catch (err) {
                            console.error('Negotiation failed', err);
                          } finally {
                            setNegotiationLoading(false);
                          }
                        }}
                        disabled={negotiationLoading || governanceLocked}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50 flex items-center gap-2"
                      >
                        {negotiationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Re-evaluate
                      </button>
                    </div>
                    {negotiationResult && (
                      <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-2">
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{negotiationResult.explanation}</p>
                        {negotiationResult.trade_off_options && negotiationResult.trade_off_options.length > 0 && (
                          <TradeOffSuggestionList options={negotiationResult.trade_off_options} />
                        )}
                      </div>
                    )}
                  </div>
                )}
                <PreemptionHistory events={governanceEvents} />
                <GovernanceTimeline events={governanceEvents} />
              </>
            )}
          </div>
        )}

        {activeTab === 'performance' && (
          <div className="bg-white rounded-xl p-6 shadow-sm border">
            <h2 className="text-xl font-semibold mb-4">Performance</h2>
            {performanceSummary ? (
              <div className="space-y-6 text-sm text-gray-700">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="font-medium text-gray-900">Expected reach</div>
                    <div>{performanceSummary.expected_reach ?? '—'}</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">Actual impressions</div>
                    <div>{performanceSummary.impressions}</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">Accuracy</div>
                    <div>{Math.round(performanceSummary.accuracy_score * 100)}%</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-gray-500">Likes</div>
                    <div className="font-medium">{performanceSummary.likes}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Shares</div>
                    <div className="font-medium">{performanceSummary.shares}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Comments</div>
                    <div className="font-medium">{performanceSummary.comments}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Clicks</div>
                    <div className="font-medium">{performanceSummary.clicks}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="font-medium text-gray-900">Engagement rate</div>
                    <div>{(performanceSummary.engagement_rate * 100).toFixed(2)}%</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">Recommendation confidence</div>
                    <div>{performanceSummary.recommendation_confidence ?? '—'}</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">Last collected</div>
                    <div>
                      {performanceSummary.last_collected_at
                        ? new Date(performanceSummary.last_collected_at).toLocaleString()
                        : '—'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No performance data available yet.</p>
            )}
          </div>
        )}
      </div>

      {/* AI Assistant - Campaign Chat with recommendation context, linked to campaign plan */}
      {campaign && !shouldForceWeeklyBlueprintView && (
        <CampaignAIChat
          isOpen={showAIChat}
          onClose={() => setShowAIChat(false)}
          onMinimize={() => setShowAIChat(false)}
          context="campaign-planning"
          forceFreshPlanningThread={false}
          companyId={effectiveCompanyId || undefined}
          campaignId={campaign.id}
          campaignData={campaign}
          recommendationContext={recommendationContext}
          prefilledPlanning={prefilledPlanning}
          governanceLocked={governanceLocked}
          collectedPlanningContext={(() => {
            const ctx: Record<string, unknown> = {};
            if (campaign?.start_date) ctx.tentative_start = campaign.start_date;
            if (campaign?.duration_weeks != null) ctx.campaign_duration = campaign.duration_weeks;
            if (campaign?.duration_weeks != null) ctx.preplanning_form_completed = true;
            if (typeof window !== 'undefined' && campaign?.id) {
              try {
                const stored = sessionStorage.getItem(`campaign_planning_context_${campaign.id}`);
                if (stored) {
                  const parsed = JSON.parse(stored) as Record<string, unknown>;
                  if (parsed?.available_content) ctx.available_content = parsed.available_content;
                  if (parsed?.content_capacity) ctx.content_capacity = parsed.content_capacity;
                }
              } catch {
                /* ignore */
              }
            }
            return Object.keys(ctx).length > 0 ? ctx : undefined;
          })()}
          optimizationContext={
            governanceAnalytics
              ? {
                  roiScore: governanceAnalytics.roiIntelligence?.roiScore ?? 50,
                  headlines: (governanceAnalytics.optimizationInsights ?? []).map((i: { headline: string }) => i.headline),
                }
              : undefined
          }
        />
      )}
    </div>
  );
}



