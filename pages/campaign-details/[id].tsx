import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { 
  ArrowLeft, 
  Calendar, 
  Target, 
  Plus, 
  Edit3, 
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
} from 'lucide-react';
import CampaignAIChat from '../../components/CampaignAIChat';
import { useCompanyContext } from '../../components/CompanyContext';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import { GovernanceStatusCard } from '../../components/governance/GovernanceStatusCard';
import { GovernanceAnalyticsCard } from '../../components/governance/GovernanceAnalyticsCard';
import { GovernanceExplanationPanel, deriveFromEvent } from '../../components/governance/GovernanceExplanationPanel';
import { GovernanceTimeline } from '../../components/governance/GovernanceTimeline';
import { PreemptionHistory } from '../../components/governance/PreemptionHistory';
import { TradeOffSuggestionList } from '../../components/governance/TradeOffSuggestionList';

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
}

interface DailyPlan {
  id: string;
  weekNumber: number;
  dayOfWeek: string;
  platform: string;
  contentType: string;
  title: string;
  content: string;
  hashtags: string[];
  status: string;
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
  const { selectedCompanyId, isLoading: isCompanyLoading, setSelectedCompanyId } = useCompanyContext();
  const effectiveCompanyId = selectedCompanyId || (typeof companyIdFromUrl === 'string' ? companyIdFromUrl : '');
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>([]);
  const [dailyPlans, setDailyPlans] = useState<DailyPlan[]>([]);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [viralityGate, setViralityGate] = useState<GateResponse | null>(null);
  const [viralityDiagnostics, setViralityDiagnostics] = useState<ViralityAssessmentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [isGeneratingWeek, setIsGeneratingWeek] = useState<number | null>(null);
  const [isViralityExpanded, setIsViralityExpanded] = useState(false);
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
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<{
    availableVideo: number;
    availablePost: number;
    contentSuited: boolean | null;
    videoPerWeek: number;
    postPerWeek: number;
    inHouseNotes: string;
  }>({
    availableVideo: 0,
    availablePost: 0,
    contentSuited: null,
    videoPerWeek: 2,
    postPerWeek: 3,
    inHouseNotes: '',
  });

  useEffect(() => {
    if (id && effectiveCompanyId) {
      loadCampaignDetails(id as string);
    }
  }, [id, effectiveCompanyId]);

  useEffect(() => {
    if (typeof companyIdFromUrl === 'string' && companyIdFromUrl && !selectedCompanyId && setSelectedCompanyId) {
      setSelectedCompanyId(companyIdFromUrl);
    }
  }, [companyIdFromUrl, selectedCompanyId, setSelectedCompanyId]);

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
        setWeeklyPlans(weeklyData);
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
    
    setIsGeneratingWeek(weekNumber);
    try {
      const response = await fetchWithAuth('/api/campaigns/generate-weekly-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: effectiveCompanyId,
          campaignId: id,
          week: weekNumber,
          theme: `Week ${weekNumber} Theme`,
          contentFocus: `Week ${weekNumber} Content Focus`,
          targetAudience: 'General Audience'
        })
      });

      if (response.ok) {
        // Reload the data to show enhanced content
        await loadCampaignDetails(id as string);
        alert(`Week ${weekNumber} has been enhanced with AI!`);
      }
    } catch (error) {
      console.error('Error enhancing week:', error);
      alert('Error enhancing week. Please try again.');
    } finally {
      setIsGeneratingWeek(null);
    }
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

  if (isCompanyLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading company context...</p>
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
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading campaign details...</p>
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
          loadCampaignDetails(campaign.id);
        }
      }
    } catch (err) {
      console.error('Update duration failed', err);
    } finally {
      setPrePlanningLoading(false);
    }
  };

  if (needsPrePlanning) {
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
              This campaign requires pre-planning before generating a campaign blueprint.
              Fix start date and tentative duration first, then plan daily content per week.
            </p>
            <p className="text-sm text-indigo-600 mb-4">
              Use the AI Assistant (bottom-right) to answer planning questions in chat instead of filling the form manually.
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
                      <button
                        onClick={() => setPrePlanningWizardStep(1)}
                        disabled={blueprintImmutable || blueprintFrozen || governanceLocked}
                        className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50 flex items-center gap-2"
                      >
                        <Calendar className="h-5 w-5" />
                        Start Pre-Planning
                      </button>
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
                            <div className="grid grid-cols-2 gap-4">
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
                                  questionnaireAnswers.availableVideo > 0 || questionnaireAnswers.availablePost > 0;
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
                              Based on in-house capability: videos and posts your team can produce weekly.
                            </p>
                            <div className="grid grid-cols-2 gap-4">
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
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const hasContent =
                                  questionnaireAnswers.availableVideo > 0 || questionnaireAnswers.availablePost > 0;
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
                                      },
                                      contentSuited: questionnaireAnswers.contentSuited ?? undefined,
                                      creationCapacity: {
                                        video_per_week: questionnaireAnswers.videoPerWeek,
                                        post_per_week: questionnaireAnswers.postPerWeek,
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
                    <div className="mb-4">
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
                    <button
                      onClick={runPrePlanningFlow}
                      disabled={prePlanningLoading || blueprintImmutable || blueprintFrozen || governanceLocked}
                      className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50 flex items-center gap-2"
                    >
                      {prePlanningLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Calendar className="h-5 w-5" />}
                      Start Pre-Planning
                    </button>
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
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Accept recommended ({prePlanningResult.recommended_duration} weeks)
                    </button>
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
        {/* AI Assistant during pre-planning - ask questions instead of filling manually */}
        {campaign && effectiveCompanyId && (
          <>
            <button
              onClick={() => setShowAIChat(true)}
              className="fixed bottom-6 right-6 px-4 py-3 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 flex items-center gap-2"
            >
              <Sparkles className="h-5 w-5" />
              Ask AI (planning questions)
            </button>
            <CampaignAIChat
              isOpen={showAIChat}
              onClose={() => setShowAIChat(false)}
              onMinimize={() => setShowAIChat(false)}
              context="campaign-planning"
              companyId={effectiveCompanyId}
              campaignId={campaign.id}
              campaignData={campaign}
              recommendationContext={recommendationContext}
              prefilledPlanning={prefilledPlanning}
              governanceLocked={governanceLocked}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      {router.query.fromRecommendation && recommendationId && (
        <div className="bg-indigo-50 border-b border-indigo-100">
          <div className="max-w-7xl mx-auto px-6 py-3 text-sm text-indigo-800">
            Created from Recommendation {recommendationId}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => router.push('/campaigns')}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Campaigns
              </button>
              
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                  {campaign.name}
                </h1>
                <p className="text-gray-600 mt-1">Content Marketing Plan</p>
                <div className="flex items-center gap-4 mt-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(campaign.status)}`}>
                    {campaign.status}
                  </span>
                  <span className="text-sm text-gray-700">
                    Readiness: <span className="font-semibold">{readiness?.readiness_percentage ?? '--'}%</span>
                  </span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getGateBadgeColor(viralityGate?.gate_decision)}`}>
                    {getGateLabel(viralityGate?.gate_decision)}
                  </span>
                  <span className="text-sm text-gray-500">
                    {campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : 'Not scheduled'} - 
                    {campaign.end_date ? new Date(campaign.end_date).toLocaleDateString() : 'Not scheduled'}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push(`/recommendations?campaignId=${campaign.id}`)}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2"
              >
                <TrendingUp className="h-4 w-4" />
                Get Recommendations
              </button>
              {isAdmin && (
                <button
                  onClick={() => router.push(`/recommendations/policy?campaignId=${campaign.id}`)}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2"
                >
                  <Settings className="h-4 w-4" />
                  View Policy &amp; Simulation
                </button>
              )}
              <button 
                onClick={() => router.push(`/campaign-planning?mode=edit&campaignId=${campaign.id}`)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <Edit3 className="h-4 w-4" />
                Edit Campaign
              </button>
              
              <button 
                onClick={() => setShowAIChat(true)}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-colors flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                AI Assistant
              </button>
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
            {/* Stage 11: Generate blueprint when duration set and blueprint invalidated */}
            {(campaign as Campaign & { blueprint_status?: string | null }).blueprint_status === 'INVALIDATED' && !blueprintImmutable && !blueprintFrozen && !governanceLocked && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-8">
                <h2 className="text-xl font-semibold text-amber-900 mb-2">Blueprint required</h2>
                <p className="text-amber-800 mb-4">
                  Duration is set. Generate a campaign blueprint to continue.
                </p>
                <button
                  onClick={async () => {
                    if (!campaign || !effectiveCompanyId) return;
                    setIsRegeneratingBlueprint(true);
                    try {
                      const res = await fetchWithAuth('/api/campaigns/regenerate-blueprint', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ campaignId: campaign.id, companyId: effectiveCompanyId }),
                      });
                      if (res.ok) loadCampaignDetails(campaign.id);
                    } catch (err) {
                      console.error('Regenerate blueprint failed', err);
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
              </div>
            )}
            {/* Virality Review */}
            <div className="bg-white rounded-xl p-6 shadow-sm border mb-8">
              <div className="flex items-center justify-between mb-4">
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

              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Required actions</h3>
                {viralityGate?.required_actions?.length ? (
                  <div className="space-y-3">
                    {viralityGate.required_actions.map((action, index) => (
                      <div key={`action-${index}`} className="rounded-lg border p-3">
                        <div className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-gray-400 mt-0.5" />
                          <div>
                            <div className="font-medium text-gray-900">{action.title}</div>
                            <div className="text-sm text-gray-600 mt-1">{action.why}</div>
                            <div className="text-sm text-gray-600 mt-2">{action.action}</div>
                            {action.applies_to_platforms?.length ? (
                              <div className="text-xs text-gray-500 mt-2">
                                Platforms: {action.applies_to_platforms.join(', ')}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No required actions at this time.</p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Advisory notes</h3>
                {viralityGate?.advisory_notes?.length ? (
                  <ul className="text-sm text-gray-600 space-y-2">
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
                          <ChevronRight className="h-4 w-4 text-gray-500" />
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

            {/* Campaign Overview */}
            <div className="bg-white rounded-xl p-6 shadow-sm border mb-8">
              <h2 className="text-xl font-semibold mb-4">Campaign Overview</h2>
              <p className="text-gray-600 mb-4">{campaign.description}</p>
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600 mb-1">12</div>
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

            {/* Campaign Plan */}
            <div className="bg-white rounded-xl p-6 shadow-sm border">
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
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Content Plan</h2>
                <button 
                  onClick={() => router.push(`/ai-chat?campaignId=${campaign.id}&context=12week-plan`)}
                  disabled={!campaign?.start_date || !(campaign as any).duration_weeks}
                  className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Sparkles className="h-4 w-4" />
                  AI Enhance All Weeks
                </button>
              </div>

              <div className="space-y-4">
                {Array.from({ length: weeklyPlans.length > 0 ? weeklyPlans.length : 12 }, (_, i) => i + 1).map(weekNumber => {
                  const weekPlan = weeklyPlans.find(w => w.weekNumber === weekNumber);
                  const isExpanded = expandedWeeks.has(weekNumber);
                  const weekDailyPlans = dailyPlans.filter(d => d.weekNumber === weekNumber);
                  
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
                              <p className="text-gray-600">{weekPlan?.theme || `Week ${weekNumber} Theme`}</p>
                              <p className="text-sm text-gray-500">{weekPlan?.focusArea || `Week ${weekNumber} Focus Area`}</p>
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

                      {/* Week Details (Expanded) */}
                      {isExpanded && (
                        <div className="border-t bg-gray-50 p-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Week Overview */}
                            <div>
                              <h4 className="font-semibold mb-3">Week Overview</h4>
                              <div className="space-y-2">
                                <div>
                                  <span className="text-sm font-medium text-gray-600">Phase:</span>
                                  <span className="ml-2 text-sm">{weekPlan?.phase || 'Foundation'}</span>
                                </div>
                                <div>
                                  <span className="text-sm font-medium text-gray-600">Focus:</span>
                                  <span className="ml-2 text-sm">{weekPlan?.focusArea || `Week ${weekNumber} Focus`}</span>
                                </div>
                                <div>
                                  <span className="text-sm font-medium text-gray-600">Key Messaging:</span>
                                  <span className="ml-2 text-sm">{weekPlan?.keyMessaging || 'Key messaging for this week'}</span>
                                </div>
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

                          {/* Daily Plans */}
                          <div className="mt-6">
                            <h4 className="font-semibold mb-3">Daily Content Plan</h4>
                            {weekDailyPlans.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => {
                                  const dayPlan = weekDailyPlans.find(d => d.dayOfWeek === day);
                                  return (
                                    <div key={day} className="border rounded p-2 text-center">
                                      <div className="text-xs font-medium text-gray-600 mb-1">{day}</div>
                                      {dayPlan ? (
                                        <div className="space-y-1">
                                          <div className="text-xs text-gray-800">{dayPlan.platform}</div>
                                          <div className="text-xs text-gray-600">{dayPlan.contentType}</div>
                                          <div className={`w-2 h-2 rounded-full mx-auto ${
                                            dayPlan.status === 'completed' ? 'bg-green-500' :
                                            dayPlan.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-300'
                                          }`}></div>
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
      {campaign && (
        <CampaignAIChat
          isOpen={showAIChat}
          onClose={() => setShowAIChat(false)}
          onMinimize={() => setShowAIChat(false)}
          context="campaign-planning"
          companyId={effectiveCompanyId || undefined}
          campaignId={campaign.id}
          campaignData={campaign}
          recommendationContext={recommendationContext}
          prefilledPlanning={prefilledPlanning}
          governanceLocked={governanceLocked}
          optimizationContext={
            governanceAnalytics
              ? {
                  roiScore: governanceAnalytics.roiIntelligence?.roiScore ?? 50,
                  headlines: (governanceAnalytics.optimizationInsights ?? []).map((i: { headline: string }) => i.headline),
                }
              : undefined
          }
          onProgramGenerated={async (program) => {
            if (!campaign?.id || !effectiveCompanyId || !program?.weeks) return;
            const campaignSummary = {
              objective: campaign.description || campaign.name,
              targetAudience: '',
              keyMessages: [],
              successMetrics: [],
            };
            const weeklyPlans = program.weeks.map((w: any) => ({
              weekNumber: w.weekNumber || 0,
              theme: w.theme || `Week ${w.weekNumber} Theme`,
              focusArea: w.theme || '',
              marketingChannels: [...new Set((w.content || []).map((c: any) => (c.platform || 'linkedin').charAt(0).toUpperCase() + (c.platform || 'linkedin').slice(1)))],
              existingContent: '',
              contentNotes: (w.content || []).map((c: any) => c.description).filter(Boolean).join('\n') || '',
            }));
            const res = await fetchWithAuth('/api/campaigns/save-comprehensive-plan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ campaignId: campaign.id, campaignSummary, weeklyPlans }),
            });
            if (res.ok) {
              loadCampaignDetails(campaign.id);
              setShowAIChat(false);
            }
          }}
        />
      )}
    </div>
  );
}



