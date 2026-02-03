import React, { useState, useEffect } from 'react';
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
  ChevronRight
} from 'lucide-react';
import ComprehensivePlanEditor from '../../components/ComprehensivePlanEditor';
import { useCompanyContext } from '../../components/CompanyContext';

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
  const { id } = router.query;
  const { selectedCompanyId, isLoading: isCompanyLoading } = useCompanyContext();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>([]);
  const [dailyPlans, setDailyPlans] = useState<DailyPlan[]>([]);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [viralityGate, setViralityGate] = useState<GateResponse | null>(null);
  const [viralityDiagnostics, setViralityDiagnostics] = useState<ViralityAssessmentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [isGeneratingWeek, setIsGeneratingWeek] = useState<number | null>(null);
  const [showComprehensiveEditor, setShowComprehensiveEditor] = useState(false);
  const [isViralityExpanded, setIsViralityExpanded] = useState(false);
  const [expandedDiagnostics, setExpandedDiagnostics] = useState<Set<string>>(new Set());
  const [recommendationSummary, setRecommendationSummary] = useState<RecommendationSummary | null>(null);
  const [recommendationId, setRecommendationId] = useState<string | null>(null);
  const [performanceSummary, setPerformanceSummary] = useState<PerformanceSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'performance'>('overview');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (id && selectedCompanyId) {
      loadCampaignDetails(id as string);
    }
  }, [id, selectedCompanyId]);

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
    const loadAdminStatus = async () => {
      try {
        if (!selectedCompanyId) return;
        const response = await fetch(
          `/api/admin/check-super-admin?companyId=${encodeURIComponent(selectedCompanyId)}`
        );
        if (!response.ok) return;
        const data = await response.json();
        setIsAdmin(!!data?.isSuperAdmin);
      } catch (error) {
        console.warn('Unable to load admin status');
      }
    };
    loadAdminStatus();
  }, [selectedCompanyId]);

  const loadCampaignDetails = async (campaignId: string) => {
    setIsLoading(true);
    try {
      // Load campaign data
      if (!selectedCompanyId) {
        setIsLoading(false);
        return;
      }
      const campaignResponse = await fetch(
        `/api/campaigns?type=campaign&campaignId=${campaignId}&companyId=${encodeURIComponent(
          selectedCompanyId
        )}`
      );
      if (campaignResponse.ok) {
        const campaignData = await campaignResponse.json();
        setCampaign(campaignData.campaign);
      }

      // Load weekly plans
      const weeklyResponse = await fetch(
        `/api/campaigns/get-weekly-plans?campaignId=${campaignId}&companyId=${encodeURIComponent(
          selectedCompanyId
        )}`
      );
      if (weeklyResponse.ok) {
        const weeklyData = await weeklyResponse.json();
        setWeeklyPlans(weeklyData);
      }

      // Load daily plans
      const dailyResponse = await fetch(
        `/api/campaigns/daily-plans?campaignId=${campaignId}&companyId=${encodeURIComponent(
          selectedCompanyId
        )}`
      );
      if (dailyResponse.ok) {
        const dailyData = await dailyResponse.json();
        setDailyPlans(dailyData);
      }

      const readinessResponse = await fetch(
        `/api/campaigns/${campaignId}/readiness?companyId=${encodeURIComponent(selectedCompanyId)}`
      );
      if (readinessResponse.ok) {
        const readinessData = await readinessResponse.json();
        setReadiness(readinessData);
      }

      const gateResponse = await fetch(`/api/campaigns/${campaignId}/virality/gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompanyId, campaignId }),
      });
      if (gateResponse.ok) {
        const gateData = await gateResponse.json();
        setViralityGate(gateData);
      }

      const diagnosticsResponse = await fetch(`/api/campaigns/${campaignId}/virality/assess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompanyId, campaignId }),
      });
      if (diagnosticsResponse.ok) {
        const diagnosticsData = await diagnosticsResponse.json();
        setViralityDiagnostics(diagnosticsData);
      }

      const performanceResponse = await fetch(
        `/api/performance/campaign/${campaignId}?companyId=${encodeURIComponent(selectedCompanyId)}`
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
      const response = await fetch('/api/campaigns/generate-weekly-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompanyId,
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
      case 'warn': return 'bg-yellow-100 text-yellow-800';
      case 'block': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-700';
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

  if (!selectedCompanyId) {
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
                <p className="text-gray-600 mt-1">12-Week Content Marketing Plan</p>
                <div className="flex items-center gap-4 mt-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(campaign.status)}`}>
                    {campaign.status}
                  </span>
                  <span className="text-sm text-gray-700">
                    Readiness: <span className="font-semibold">{readiness?.readiness_percentage ?? '--'}%</span>
                  </span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getGateBadgeColor(viralityGate?.gate_decision)}`}>
                    Gate: {viralityGate?.gate_decision || 'unknown'}
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
                onClick={() => setShowComprehensiveEditor(true)}
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
                  Gate: {viralityGate?.gate_decision || 'unknown'}
                </span>
                <span className="text-sm text-gray-700">
                  Readiness: <span className="font-semibold">{readiness?.readiness_percentage ?? '--'}%</span>
                </span>
              </div>

              {viralityGate?.gate_decision === 'block' && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
                  <div className="flex items-center gap-2 text-red-700 font-medium mb-2">
                    <AlertCircle className="h-4 w-4" />
                    Blocking reasons
                  </div>
                  <ul className="text-sm text-red-700 space-y-1">
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

            {/* 12-Week Plan */}
            <div className="bg-white rounded-xl p-6 shadow-sm border">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">12-Week Content Plan</h2>
                <button 
                  onClick={() => router.push(`/ai-chat?campaignId=${campaign.id}&context=12week-plan`)}
                  className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all flex items-center gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  AI Enhance All Weeks
                </button>
              </div>

              <div className="space-y-4">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(weekNumber => {
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
                              disabled={isGeneratingWeek === weekNumber}
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
                                  className="mt-2 px-3 py-1 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
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

      {/* Comprehensive Plan Editor Modal */}
      {campaign && (
        <ComprehensivePlanEditor
          isOpen={showComprehensiveEditor}
          onClose={() => setShowComprehensiveEditor(false)}
          campaignId={campaign.id}
          campaignData={campaign}
          onSave={(result) => {
            // Reload campaign data after saving
            if (id) {
              loadCampaignDetails(id as string);
            }
            setShowComprehensiveEditor(false);
          }}
        />
      )}
    </div>
  );
}



