import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { supabase } from '../utils/supabaseClient';
import { 
  ArrowLeft, 
  Calendar, 
  Target, 
  BarChart3, 
  Plus,
  CheckCircle,
  Clock,
  TrendingUp,
  FileText,
  Video,
  Image,
  Mic,
  Users,
  Share2,
  Eye,
  Heart,
  MessageCircle,
  Download,
  Filter,
  Search,
  MoreVertical,
  ChevronRight,
  Sparkles,
  X,
  Edit,
  Trash2,
  MoreHorizontal
} from 'lucide-react';
import dynamic from 'next/dynamic';

const CampaignAIChat = dynamic(() => import('../components/CampaignAIChat'), { ssr: false });

interface Campaign {
  id: string;
  name: string;
  status: string;
  userId: string;
  createdAt: string;
  progress: number;
  company_id?: string;
}

interface WeekPlan {
  id: string;
  week: number;
  status: string;
  theme: string;
  contentFocus: string;
  targetAudience: string;
  keyMessaging: string;
  contentTypes: string[];
  platformStrategy: string;
  callToAction: string;
  successMetrics: any;
  createdAt: string;
  aiContent?: any;
  dailyContent?: any;
  platforms?: string[];
  aiSuggestions?: string[];
}

interface CampaignOverview {
  totalWeeks: number;
  completedWeeks: number;
  progressPercentage?: number;
  campaigns: Campaign[];
  plans: WeekPlan[];
}

export default function CampaignPlanningHierarchical() {
  const [overview, setOverview] = useState<CampaignOverview | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<WeekPlan | null>(null);
  const [selectedDay, setSelectedDay] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showWeekDetail, setShowWeekDetail] = useState(false);
  const [showDayDetail, setShowDayDetail] = useState(false);
  const [weeklyPlans, setWeeklyPlans] = useState<any[]>([]);
  const [showAIEnhancement, setShowAIEnhancement] = useState(false);
  const [selectedWeekForAI, setSelectedWeekForAI] = useState<number | null>(null);
  const [showDailyPlanCreation, setShowDailyPlanCreation] = useState(false);
  const [selectedWeekForDaily, setSelectedWeekForDaily] = useState<number | null>(null);
  const [isExpanding, setIsExpanding] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);

  // Prefer overview.plans (committed blueprint) — it has full platform_content_breakdown, topics_to_cover.
  // Fall back to weeklyPlans only when overview has no plans.
  const displayPlans = React.useMemo(() => {
    const fromOverview = overview?.plans ?? [];
    const fromWeekly = weeklyPlans ?? [];
    const source = fromOverview.length > 0 ? fromOverview : fromWeekly;
    return source.map((p: any) => {
      const weekNum = p.week ?? p.weekNumber ?? 0;
      return {
        ...p,
        week: weekNum,
        weekNumber: weekNum,
        id: p.id ?? `week-${weekNum}`,
        theme: p.theme ?? `Week ${weekNum}`,
        focusArea: p.contentFocus ?? p.focusArea ?? '',
        contentFocus: p.contentFocus ?? p.focusArea ?? '',
        status: p.status ?? 'pending',
        aiContent: p.aiContent,
        aiSuggestions: p.aiSuggestions ?? p.topics_to_cover ?? [],
        dailyContent: p.dailyContent,
        keyMessaging: p.keyMessaging,
        contentTypes: p.contentTypes ?? p.content_type_mix ?? [],
        platforms: p.platforms ?? (p.platform_allocation ? Object.keys(p.platform_allocation) : []) ?? [],
        refinementData: p.refinementData ?? p,
        platform_content_breakdown: p.platform_content_breakdown ?? {},
        platform_allocation: p.platform_allocation ?? {},
        topics_to_cover: p.topics_to_cover ?? p.aiSuggestions ?? [],
        targetAudience: p.targetAudience,
        week_extras: p.week_extras ?? {},
      };
    });
  }, [weeklyPlans, overview?.plans]);

  const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('campaignId');
    setCampaignId(id);
    
    if (id) {
      fetchCampaignOverview(id);
      fetchWeeklyPlans(id);
    }
  }, []);

  const fetchCampaignOverview = async (id: string) => {
    setIsLoading(true);
    try {
      const response = await fetchWithAuth(`/api/campaigns/hierarchical-navigation?campaignId=${id}&action=get-overview`);
      if (response.ok) {
        const data = await response.json();
        setOverview(data.overview);
      } else {
        // Fallback: committed plan may exist in blueprint even if campaign metadata lookup failed
        const plansRes = await fetchWithAuth(`/api/campaigns/get-weekly-plans?campaignId=${id}`);
        if (plansRes.ok) {
          const weeks = await plansRes.json();
          if (Array.isArray(weeks) && weeks.length > 0) {
            const SCORE_SKELETON = 15;
            const SCORE_CONTENT_PLAN = 50;
            const getWeekScore = (p: any): number => {
              const hasTopics = Array.isArray(p.topics_to_cover) && p.topics_to_cover.length > 0;
              const hasBreakdown = p.platform_content_breakdown && typeof p.platform_content_breakdown === 'object'
                && Object.values(p.platform_content_breakdown).some((arr: any) => Array.isArray(arr) && arr.length > 0);
              const hasPlatforms = p.platform_allocation && typeof p.platform_allocation === 'object'
                && Object.keys(p.platform_allocation).length > 0;
              return ((hasTopics || hasBreakdown) && hasPlatforms) ? SCORE_CONTENT_PLAN : SCORE_SKELETON;
            };
            const plans = weeks.map((w: any) => ({
              id: `week-${w.weekNumber}`,
              week: w.weekNumber,
              weekNumber: w.weekNumber,
              status: 'ai-enhanced',
              theme: w.theme || `Week ${w.weekNumber}`,
              contentFocus: w.focusArea || w.theme,
              platform_allocation: w.platform_allocation ?? {},
              platform_content_breakdown: w.platform_content_breakdown ?? {},
              topics_to_cover: w.topics_to_cover ?? [],
              contentTypes: w.contentTypes ?? [],
              aiSuggestions: w.topics_to_cover ?? [],
            }));
            const totalScore = plans.reduce((sum: number, p: any) => sum + getWeekScore(p), 0);
            const progressPercentage = Math.min(100, Math.round((totalScore / (plans.length * 100)) * 100));
            const completedWeeks = plans.filter((p: any) => getWeekScore(p) >= SCORE_CONTENT_PLAN).length;
            setOverview({
              totalWeeks: plans.length,
              completedWeeks,
              progressPercentage,
              campaigns: [{ id, name: 'Your Campaign', status: 'planning', progress: progressPercentage, userId: '', createdAt: '', description: '' }],
              plans,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error fetching campaign overview:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchWeeklyPlans = async (campaignId: string) => {
    try {
      const response = await fetchWithAuth(`/api/campaigns/get-weekly-plans?campaignId=${campaignId}`);
      if (response.ok) {
        const data = await response.json();
        console.log('Weekly plans loaded:', data);
        setWeeklyPlans(data);
      } else {
        console.error('Failed to fetch weekly plans');
      }
    } catch (error) {
      console.error('Error fetching weekly plans:', error);
    }
  };

  const handleAIEnhancement = (weekNumber: number) => {
    setSelectedWeekForAI(weekNumber);
    setShowAIEnhancement(true);
  };

  const handleDailyPlanCreation = (weekNumber: number) => {
    setSelectedWeekForDaily(weekNumber);
    setShowDailyPlanCreation(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 border-green-200';
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'in-progress': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
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
  const getStageLabel = (stage: string) => {
    const labels: Record<string, string> = {
      planning: 'Planning',
      twelve_week_plan: '12 Week Plan',
      daily_plan: 'Daily Plan',
      charting: 'Charting',
      schedule: 'Schedule',
    };
    return labels[stage] ?? (stage?.charAt(0)?.toUpperCase() + (stage ?? '').slice(1)) ?? 'Planning';
  };

  const getWeekIcon = (week: number) => {
    const icons = [
      Plus, Target, Users, TrendingUp, Share2, Eye, Heart, MessageCircle,
      Download, Filter, Search, MoreVertical
    ];
    const Icon = icons[(week - 1) % icons.length];
    return <Icon className="w-4 h-4" />;
  };

  const handleWeekClick = (plan: WeekPlan) => {
    setSelectedWeek(plan);
  };

  const handleCreateNewPlan = () => {
    if (campaignId) {
      window.location.href = `/campaign-planning?campaignId=${campaignId}&openAI=true`;
    }
  };

  const handleExpandToWeekPlans = async () => {
    if (!campaignId) return;
    setIsExpanding(true);
    try {
      const res = await fetchWithAuth(`/api/campaigns/${campaignId}/expand-to-week-plans`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchWeeklyPlans(campaignId);
        fetchCampaignOverview(campaignId);
      } else {
        alert(data.hint || data.error || 'Could not expand. Create a 12-week plan first.');
      }
    } catch {
      alert('Failed to expand to week plans.');
    } finally {
      setIsExpanding(false);
    }
  };

  const handleAIEnhanceWeek = async (weekPlan: WeekPlan) => {
    try {
      // Generate detailed daily structure for this week
      const requestBody = {
        week: weekPlan.week,
        theme: weekPlan.theme,
        contentFocus: weekPlan.contentFocus,
        targetAudience: weekPlan.targetAudience,
        campaignId: campaignId
      };

      const response = await fetchWithAuth('/api/campaigns/generate-weekly-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        const result = await response.json();
        // Update the week with generated structure
        console.log('Generated weekly structure:', result);
        
        // Show success and refresh
        alert(`✅ Generated 7-day content structure for Week ${weekPlan.week}!`);
        fetchCampaignOverview(campaignId!);
        setShowWeekDetail(false);
      } else {
        throw new Error('Failed to generate structures');
      }
    } catch (error) {
      console.error('Error generating weekly structure:', error);
      alert('❌ Failed to generate daily content structure. Please try again.');
    }
  };

  const handleDailyPlanning = (weekPlan: WeekPlan) => {
    // Open daily planning interface for this specific week
    const dailyPlanningUrl = `/daily-planning?campaignId=${campaignId}&week=${weekPlan.week}`;
    
    // Check if daily planning page exists, if not navigate to campaign planning with parameters
    window.open(dailyPlanningUrl, '_blank') || (window.location.href = `/campaign-planning?campaignId=${campaignId}&week=${weekPlan.week}&tab=daily`);
    
    setShowWeekDetail(false);
  };

  const getAllPlatforms = () => {
    return ['LinkedIn', 'Facebook', 'Instagram', 'Twitter', 'YouTube', 'TikTok'];
  };

  const getRecommendedPlatforms = (contentType: string) => {
    const recommendations: { [key: string]: string[] } = {
      'Educational Content': ['LinkedIn', 'Facebook', 'YouTube'],
      'Visual Content': ['Instagram', 'Facebook', 'TikTok'],
      'Quick Tips': ['Twitter', 'LinkedIn'],
      'Long-form': ['LinkedIn', 'YouTube', 'Facebook'],
      'Behind-the-scenes': ['Instagram', 'TikTok', 'Facebook']
    };
    return recommendations[contentType] || ['LinkedIn', 'Facebook'];
  };

  const addPlatform = (platform: string) => {
    // This would be implemented to add platform to selected day content
    console.log('Adding platform:', platform);
  };

  const removePlatform = (platform: string) => {
    // This would be implemented to remove platform from selected day content
    console.log('Removing platform:', platform);
  };


  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading campaign plan...</p>
        </div>
      </div>
    );
  }

  if (!overview || !campaignId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Campaign Not Found</h1>
          <p className="text-gray-600 mb-6">The requested campaign could not be found.</p>
          <button 
            onClick={() => window.location.href = '/campaigns'}
            className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200"
          >
            ← Back to Campaigns
          </button>
        </div>
      </div>
    );
  }

  const campaign = overview.campaigns[0];

  return (
    <>
      <Head>
        <title>{overview.totalWeeks}-Week Campaign Plan{campaign?.name ? ` – ${campaign.name}` : ''}</title>
      </Head>
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => window.location.href = `/campaign-details/${campaignId}`}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Campaign
            </button>
            
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{overview.totalWeeks}-Week Campaign Plan</h1>
              <p className="text-gray-600">Campaign: {campaign?.name}</p>
              {campaign?.id && <p className="text-xs text-gray-500 font-mono">ID: {campaign.id}</p>}
              <div className="flex items-center gap-4 mt-2">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStageColor(campaign?.current_stage || campaign?.status || 'planning')}`}>
                  {getStageLabel(campaign?.current_stage || campaign?.status || 'planning')}
                </span>
                <span className="text-sm text-gray-500">
                  {overview.completedWeeks} of {overview.totalWeeks} weeks with content plan
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex gap-4 flex-wrap">
            {(weeklyPlans?.length ?? 0) === 0 && (
              <button 
                onClick={handleExpandToWeekPlans}
                disabled={isExpanding}
                className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {isExpanding ? 'Expanding…' : 'Expand to Week Plans'}
              </button>
            )}
            <button 
              onClick={handleCreateNewPlan}
              className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Week Plan
            </button>
            
            <button
              onClick={() => setShowAIChat(true)}
              className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              AI Assistant (refine plan)
            </button>
          </div>
        </div>

        {/* Progress Overview */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Campaign Progress</h2>
            <div className="text-sm text-gray-600">
              {overview.progressPercentage ?? Math.round((overview.completedWeeks / overview.totalWeeks) * 100)}% Complete
            </div>
          </div>
          
          <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
            <div 
              className="bg-gradient-to-r from-purple-500 to-violet-600 h-3 rounded-full transition-all duration-300"
              style={{ width: `${overview.progressPercentage ?? (overview.completedWeeks / overview.totalWeeks) * 100}%` }}
            />
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{overview.totalWeeks}</div>
              <div className="text-sm text-gray-600">Total Weeks</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{overview.completedWeeks}</div>
              <div className="text-sm text-gray-600">Content Plan Ready</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{overview.plans.length - overview.completedWeeks}</div>
              <div className="text-sm text-gray-600">Skeleton Only</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{overview.plans.length}</div>
              <div className="text-sm text-gray-600">Weeks Planned</div>
            </div>
          </div>
        </div>

        {/* 12-Week Grid */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900">{overview.totalWeeks}-Week Content Plan</h2>
            
            <div className="flex gap-2">
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="all">All Weeks</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="in-progress">In Progress</option>
              </select>
            </div>
          </div>

          {displayPlans.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Weekly Plans Created</h3>
              <p className="text-gray-600 mb-6">Start building your campaign content strategy</p>
              <button 
                onClick={handleCreateNewPlan}
                className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 mx-auto"
              >
                <Plus className="w-5 h-5" />
                Create Week Plan
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from({ length: (overview?.totalWeeks ?? displayPlans.length) || 12 }, (_, index) => {
                const weekNumber = index + 1;
                const plan = displayPlans.find((p: any) => (p.weekNumber ?? p.week) === weekNumber);
                const isSelected = selectedWeek?.week === weekNumber;
                
                return (
                  <div
                    key={weekNumber}
                    className={`bg-white rounded-lg shadow-sm border transition-all duration-200 ${
                      isSelected ? 'border-purple-300 shadow-md' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {/* Week Header */}
                    <div 
                      className="p-4 cursor-pointer"
                      onClick={() => {
                        if (plan) {
                          setSelectedWeek(plan);
                          setShowWeekDetail(true);
                        }
                      }}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          {getWeekIcon(weekNumber)}
                          <div>
                            <span className="font-semibold text-gray-900">Week {weekNumber}</span>
                            {plan ? (
                              <>
                                <div className="text-sm font-medium text-gray-700 mt-1">
                                  {plan.theme || `Week ${weekNumber} Theme`}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  {plan.focusArea || plan.contentFocus || 'Setup weekly content focus...'}
                                </div>
                                {plan.aiContent && (Array.isArray(plan.aiContent) ? plan.aiContent.length > 0 : Object.keys(plan.aiContent).length > 0) && (
                                  <div className="text-xs text-blue-600 mt-1">
                                    ✓ AI Content Generated
                                  </div>
                                )}
                                {plan.aiSuggestions && plan.aiSuggestions.length > 0 && (
                                  <div className="text-xs text-purple-600 mt-1">
                                    ✓ {plan.aiSuggestions.length} AI Suggestions
                                  </div>
                                )}
                                {plan.dailyContent && Object.keys(plan.dailyContent).length > 0 && (
                                  <div className="text-xs text-green-600 mt-1">
                                    ✓ Daily Structure Ready
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="text-sm font-medium text-gray-700 mt-1">
                                  Week {weekNumber} Theme
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  To be planned
                                </div>
                                <div className="text-xs text-orange-600 mt-1">
                                  Click "Plan Week" to get started
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {plan ? (
                            <>
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(plan.status)}`}>
                                {plan.status}
                              </span>
                              
                              {/* AI Enhancement Button */}
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAIEnhancement(weekNumber);
                                }}
                                className="flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors text-xs"
                                title="AI Enhance Week"
                              >
                                <Sparkles className="w-3 h-3" />
                                [+]
                              </button>
                              
                              {/* Daily Plan Creation Button */}
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDailyPlanCreation(weekNumber);
                                }}
                                className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors text-xs"
                                title="Create Daily Plan"
                              >
                                <Calendar className="w-3 h-3" />
                                Daily
                              </button>
                              
                              {/* View Days Button */}
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowWeekDetail(true);
                                  setSelectedWeek(plan);
                                }}
                                className="flex items-center gap-1 text-sm text-gray-600 hover:text-purple-700"
                              >
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            </>
                          ) : (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                if (campaignId) {
                                  window.location.href = `/campaign-planning?campaignId=${campaignId}&week=${weekNumber}&openAI=true`;
                                }
                              }}
                              className="flex items-center gap-1 text-sm text-gray-500 hover:text-purple-600"
                            >
                              <Plus className="w-4 h-4" />
                              Plan Week
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Week Days (shows when expanded) */}
                    {isSelected && selectedWeek && (
                      <div className="border-t border-gray-100">
                        <div className="p-4">
                          {/* Week context from committed plan: platforms, content types, topics */}
                          {(selectedWeek.platform_allocation && Object.keys(selectedWeek.platform_allocation).length > 0) ||
                           (selectedWeek.platform_content_breakdown && Object.keys(selectedWeek.platform_content_breakdown).length > 0) ||
                           (selectedWeek.topics_to_cover && selectedWeek.topics_to_cover.length > 0) ? (
                            <div className="mb-4 p-4 rounded-lg bg-indigo-50/80 border border-indigo-100">
                              <h4 className="text-sm font-semibold text-indigo-900 mb-3">Week context (from committed plan)</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                {selectedWeek.platform_allocation && Object.keys(selectedWeek.platform_allocation).length > 0 && (
                                  <div>
                                    <span className="font-medium text-gray-700">Platforms & volume:</span>
                                    <div className="flex flex-wrap gap-2 mt-1">
                                      {Object.entries(selectedWeek.platform_allocation).map(([platform, count]) => (
                                        <span key={platform} className="px-2 py-0.5 bg-white rounded text-gray-800 border">
                                          {platform}: {count} posts
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {selectedWeek.platform_content_breakdown && Object.keys(selectedWeek.platform_content_breakdown).length > 0 && (
                                  <div>
                                    <span className="font-medium text-gray-700">Per-platform content:</span>
                                    <div className="mt-1 space-y-1">
                                      {Object.entries(selectedWeek.platform_content_breakdown).map(([platform, items]: [string, any]) => (
                                        <div key={platform} className="text-xs">
                                          <span className="font-medium capitalize">{platform}:</span>{' '}
                                          {(Array.isArray(items) ? items : []).map((it: any) =>
                                            `${it.type || 'post'}${it.count > 1 ? ` ×${it.count}` : ''}${it.topic ? ` (${it.topic})` : ''}`
                                          ).join(', ')}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {selectedWeek.contentTypes && selectedWeek.contentTypes.length > 0 && (
                                  <div>
                                    <span className="font-medium text-gray-700">Content types:</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {selectedWeek.contentTypes.map((ct: string) => (
                                        <span key={ct} className="px-2 py-0.5 bg-white rounded text-gray-700 border text-xs">
                                          {ct}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {selectedWeek.topics_to_cover && selectedWeek.topics_to_cover.length > 0 && (
                                  <div>
                                    <span className="font-medium text-gray-700">Topics to cover:</span>
                                    <ul className="mt-1 list-disc list-inside text-gray-600 text-xs">
                                      {selectedWeek.topics_to_cover.slice(0, 6).map((t: string, i: number) => (
                                        <li key={i}>{t}</li>
                                      ))}
                                      {selectedWeek.topics_to_cover.length > 6 && (
                                        <li className="text-gray-500">+{selectedWeek.topics_to_cover.length - 6} more</li>
                                      )}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : null}
                          {/* Dynamic week extras: summary, objectives, days_to_post, etc. */}
                          {selectedWeek.week_extras && typeof selectedWeek.week_extras === 'object' && Object.keys(selectedWeek.week_extras).length > 0 && (
                            <div className="mb-4 p-4 rounded-lg bg-amber-50/80 border border-amber-100">
                              <h4 className="text-sm font-semibold text-amber-900 mb-3">Week extras (AI-enriched)</h4>
                              <div className="space-y-3 text-sm">
                                {Object.entries(selectedWeek.week_extras).map(([key, val]) => {
                                  const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                                  const display = Array.isArray(val)
                                    ? val.map((v: any) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')
                                    : typeof val === 'object' && val !== null
                                      ? JSON.stringify(val)
                                      : String(val ?? '');
                                  return (
                                    <div key={key}>
                                      <span className="font-medium text-gray-700">{label}:</span>
                                      <p className="mt-0.5 text-gray-600 text-xs whitespace-pre-wrap">{display}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {/* Refine this week with AI chat */}
                          <div className="mb-4 flex items-center gap-2">
                            <button
                              onClick={() => setShowAIChat(true)}
                              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors"
                            >
                              <MessageCircle className="w-4 h-4" />
                              Refine Week {weekNumber} with AI Chat
                            </button>
                          </div>
                          <h4 className="text-sm font-medium text-gray-700 mb-3">7-Day Content Plan</h4>
                          <div className="grid grid-cols-7 gap-2">
                            {Array.from({ length: 7 }, (_, dayIndex) => {
                              const dayNumber = dayIndex + 1;
                              const dayData = selectedWeek.contentTypes || [];
                              const hasContent = dayNumber <= dayData.length;
                              
                              return (
                                <button
                                  key={dayNumber}
                                  onClick={() => {
                                    setSelectedDay({
                                      week: weekNumber,
                                      day: dayNumber,
                                      content: dayData[dayIndex - 1] || null,
                                      theme: selectedWeek.theme
                                    });
                                    setShowDayDetail(true);
                                  }}
                                  className={`p-3 rounded-lg border text-center transition-all ${
                                    hasContent 
                                      ? 'bg-purple-50 border-purple-200 hover:bg-purple-100' 
                                      : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                                  }`}
                                >
                                  <div className="text-xs font-medium text-gray-600">Day {dayNumber}</div>
                                  <div className="text-xs mt-1 text-gray-500">
                                    {hasContent ? (
                                      <span className="text-purple-600">●</span>
                                    ) : (
                                      <span className="text-gray-400">○</span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          
                          <div className="flex justify-end mt-3">
                            <button className="text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1">
                              <Sparkles className="w-3 h-3" />
                              AI Enhance Week
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button 
              onClick={() => window.open(`/analytics?campaignId=${campaignId}`, '_blank')}
              className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="p-2 bg-green-100 rounded-lg">
                <BarChart3 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <div className="font-medium text-gray-900">View Analytics</div>
                <div className="text-sm text-gray-600">Performance metrics</div>
              </div>
            </button>
            
            <button 
              onClick={() => window.open(`/audience-insights?campaignId=${campaignId}`, '_blank')}
              className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="p-2 bg-blue-100 rounded-lg">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="font-medium text-gray-900">Target Audience</div>
                <div className="text-sm text-gray-600">Audience insights</div>
              </div>
            </button>
            
            <button 
              onClick={() => window.open(`/content-calendar?campaignId=${campaignId}`, '_blank')}
              className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="p-2 bg-purple-100 rounded-lg">
                <FileText className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <div className="font-medium text-gray-900">Content Calendar</div>
                <div className="text-sm text-gray-600">Schedule content</div>
              </div>
            </button>
          </div>
        </div>

        {/* Week Detail Modal */}
        {showWeekDetail && selectedWeek && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Week {selectedWeek.week}</h2>
                    <p className="text-gray-600 mt-1">{selectedWeek.theme}</p>
                  </div>
                  <button 
                    onClick={() => setShowWeekDetail(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-900">Week Overview</h3>
                    <div>
                      <label className="text-sm font-medium text-gray-700">Content Focus</label>
                      <p className="text-gray-600">{selectedWeek.contentFocus || selectedWeek.theme}</p>
                    </div>
                    {selectedWeek.targetAudience && (
                      <div>
                        <label className="text-sm font-medium text-gray-700">Target Audience</label>
                        <p className="text-gray-600">{selectedWeek.targetAudience}</p>
                      </div>
                    )}
                    {selectedWeek.keyMessaging && selectedWeek.keyMessaging !== 'AI-generated messaging' && (
                      <div>
                        <label className="text-sm font-medium text-gray-700">Key Messaging</label>
                        <p className="text-gray-600">{selectedWeek.keyMessaging}</p>
                      </div>
                    )}
                    {selectedWeek.topics_to_cover && selectedWeek.topics_to_cover.length > 0 && (
                      <div>
                        <label className="text-sm font-medium text-gray-700 mb-2 block">Topics to cover</label>
                        <ul className="list-disc list-inside space-y-1 text-gray-700 text-sm">
                          {selectedWeek.topics_to_cover.map((t: string, i: number) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedWeek.platform_allocation && Object.keys(selectedWeek.platform_allocation).length > 0 && (
                      <div>
                        <label className="text-sm font-medium text-gray-700 mb-2 block">Platforms (items per week)</label>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(selectedWeek.platform_allocation).map(([platform, count]) => (
                            <span key={platform} className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded font-medium">
                              {platform}: {count}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {(!selectedWeek.platform_allocation || Object.keys(selectedWeek.platform_allocation).length === 0) && selectedWeek.platforms && selectedWeek.platforms.length > 0 && (
                      <div>
                        <label className="text-sm font-medium text-gray-700 mb-2 block">Platforms</label>
                        <div className="flex flex-wrap gap-2">
                          {selectedWeek.platforms.map((p: string, i: number) => (
                            <span key={i} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">{p}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-900">Content Plan</h3>
                    {selectedWeek.platform_content_breakdown && Object.keys(selectedWeek.platform_content_breakdown).length > 0 ? (
                      <div className="space-y-3">
                        <label className="text-sm font-medium text-gray-700 block">Content to create</label>
                        {Object.entries(selectedWeek.platform_content_breakdown).map(([platform, items]: [string, any]) => (
                          <div key={platform} className="p-3 bg-gray-50 rounded-lg">
                            <span className="font-medium text-gray-800 capitalize">{platform}:</span>
                            <ul className="mt-2 space-y-1 text-sm text-gray-700">
                              {(Array.isArray(items) ? items : []).map((it: any, idx: number) => (
                                <li key={idx} className="flex items-center gap-2">
                                  <span className="w-2 h-2 bg-purple-500 rounded-full flex-shrink-0" />
                                  {it.count} {it.type || 'post'}
                                  {it.topic ? ` — ${it.topic}` : ''}
                                  {it.topics?.length ? ` (${it.topics.join(', ')})` : ''}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {selectedWeek.contentTypes?.map((ct: string, i: number) => (
                          <div key={i} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                            <span className="w-2 h-2 bg-purple-500 rounded-full" />
                            <span className="text-sm text-gray-700">{ct}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedWeek.aiSuggestions && selectedWeek.aiSuggestions.length > 0 && (
                      <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                        <h4 className="text-sm font-medium text-purple-900 mb-2">Topics / suggestions</h4>
                        <ul className="space-y-1 text-xs text-purple-800">
                          {selectedWeek.aiSuggestions.map((s: string, i: number) => (
                            <li key={i} className="flex items-center gap-2">
                              <span className="w-1 h-1 bg-purple-500 rounded-full" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    <div className="space-y-3 mt-4">
                      <button 
                        onClick={() => handleAIEnhanceWeek(selectedWeek)}
                        className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        AI Generate Daily Content Structure
                      </button>
                      
                      <button 
                        onClick={() => handleDailyPlanning(selectedWeek)}
                        className="w-full border border-purple-300 text-purple-600 hover:bg-purple-50 px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2"
                      >
                        <Calendar className="w-4 h-4" />
                        Plan Daily Content Calendar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Day Detail Modal */}
        {showDayDetail && selectedDay && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full mx-4">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Week {selectedDay.week}, Day {selectedDay.day}</h2>
                    <p className="text-gray-600 mt-1">{selectedDay.theme}</p>
                  </div>
                  <button 
                    onClick={() => setShowDayDetail(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="mb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-800 font-medium">{selectedDay.content?.contentType || 'Educational Content'}</p>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Platforms</label>
                      <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                        <div className="flex gap-2 flex-wrap">
                          {['LinkedIn', 'Twitter', 'Facebook', 'Instagram'].map((platform, index) => (
                            <span key={index} className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                              {platform}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-gray-500 mt-2">Platforms will be configured in daily planning</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Content Plan</label>
                    {selectedDay.content ? (
                      <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                        <h4 className="font-medium text-purple-900 mb-2">{selectedDay.content.title}</h4>
                        <p className="text-sm text-purple-800 mb-2">{selectedDay.content.description}</p>
                        <div className="flex gap-2 mt-2">
                          {selectedDay.content.keywords?.map((keyword: string, index: number) => (
                            <span key={index} className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                              #{keyword}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center">
                        <p className="text-gray-500">No detailed plan for this day</p>
                        <p className="text-xs text-gray-400 mt-1">Use "AI Generate Content" to create a plan</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button className="flex-1 bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    AI Generate Content
                  </button>
                  <button className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg font-semibold transition-all duration-200">
                    Schedule Post
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI Enhancement Modal */}
        {showAIEnhancement && selectedWeekForAI && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-2xl mx-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">AI Enhance Week {selectedWeekForAI}</h3>
                <button 
                  onClick={() => setShowAIEnhancement(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Current Week Plan</label>
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    {displayPlans.find((p: any) => (p.weekNumber ?? p.week) === selectedWeekForAI) ? (
                      <>
                        <p><strong>Theme:</strong> {displayPlans.find((p: any) => (p.weekNumber ?? p.week) === selectedWeekForAI)?.theme}</p>
                        <p><strong>Focus:</strong> {displayPlans.find((p: any) => (p.weekNumber ?? p.week) === selectedWeekForAI)?.focusArea}</p>
                        <p><strong>Key Messaging:</strong> {displayPlans.find((p: any) => (p.weekNumber ?? p.week) === selectedWeekForAI)?.keyMessaging}</p>
                      </>
                    ) : (
                      <p className="text-gray-500">No plan data available</p>
                    )}
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">AI Enhancement Request</label>
                  <textarea
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    rows={4}
                    placeholder="Describe how you'd like to enhance this week's plan..."
                  />
                </div>
                
                <div className="flex justify-end gap-3">
                  <button 
                    onClick={() => setShowAIEnhancement(false)}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Enhance with AI
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Daily Plan Creation Modal */}
        {showDailyPlanCreation && selectedWeekForDaily && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Create Daily Plan for Week {selectedWeekForDaily}</h3>
                <button 
                  onClick={() => setShowDailyPlanCreation(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-6">
                {/* Week Overview — from committed plan */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-medium mb-2">Week {selectedWeekForDaily} Overview (from committed plan)</h4>
                  {(() => {
                    const plan = displayPlans.find((p: any) => (p.weekNumber ?? p.week) === selectedWeekForDaily);
                    if (!plan) return <p className="text-gray-500">No plan data available</p>;
                    return (
                      <div className="space-y-2 text-sm">
                        <p><strong>Theme:</strong> {plan.theme}</p>
                        <p><strong>Focus:</strong> {plan.focusArea}</p>
                        {plan.contentTypes?.length > 0 && (
                          <p><strong>Content types:</strong> {plan.contentTypes.join(', ')}</p>
                        )}
                        {plan.platform_allocation && Object.keys(plan.platform_allocation).length > 0 && (
                          <div>
                            <strong>Platforms & volume:</strong>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Object.entries(plan.platform_allocation).map(([p, c]) => (
                                <span key={p} className="px-2 py-0.5 bg-indigo-100 rounded text-xs">{p}: {c} posts</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {plan.platform_content_breakdown && Object.keys(plan.platform_content_breakdown).length > 0 && (
                          <div>
                            <strong>Per-platform content:</strong>
                            <div className="mt-1 space-y-1 text-xs">
                              {Object.entries(plan.platform_content_breakdown).map(([platform, items]: [string, any]) => (
                                <div key={platform}><span className="font-medium capitalize">{platform}:</span>{' '}
                                  {(Array.isArray(items) ? items : []).map((it: any) =>
                                    `${it.type || 'post'}${it.count > 1 ? ` ×${it.count}` : ''}${it.topic ? ` (${it.topic})` : ''}`
                                  ).join(', ')}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {plan.topics_to_cover?.length > 0 && (
                          <div>
                            <strong>Topics to cover:</strong>
                            <ul className="mt-1 list-disc list-inside text-xs">{plan.topics_to_cover.slice(0, 6).map((t: string, i: number) => (
                              <li key={i}>{t}</li>
                            ))}</ul>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Daily Planning Form */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Content Types */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Content Types</label>
                    <div className="space-y-2">
                      {['Post', 'Story', 'Video', 'Article', 'Live Stream', 'Reel', 'Carousel'].map(type => (
                        <label key={type} className="flex items-center">
                          <input type="checkbox" className="mr-2" />
                          <span className="text-sm">{type}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Social Platforms */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Social Platforms</label>
                    <div className="space-y-2">
                      {['LinkedIn', 'Twitter', 'Facebook', 'Instagram', 'YouTube', 'TikTok'].map(platform => (
                        <label key={platform} className="flex items-center">
                          <input type="checkbox" className="mr-2" />
                          <span className="text-sm">{platform}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Frequency Settings */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Posting Frequency</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Posts per day</label>
                      <input type="number" min="1" max="10" defaultValue="2" className="w-full p-2 border border-gray-300 rounded" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Stories per day</label>
                      <input type="number" min="0" max="20" defaultValue="3" className="w-full p-2 border border-gray-300 rounded" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Videos per week</label>
                      <input type="number" min="0" max="7" defaultValue="2" className="w-full p-2 border border-gray-300 rounded" />
                    </div>
                  </div>
                </div>

                {/* Daily Schedule Preview */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Daily Schedule Preview</label>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="grid grid-cols-7 gap-2 text-xs">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                        <div key={day} className="text-center">
                          <div className="font-medium mb-1">{day}</div>
                          <div className="space-y-1">
                            <div className="bg-blue-100 text-blue-800 px-1 py-0.5 rounded">Post</div>
                            <div className="bg-purple-100 text-purple-800 px-1 py-0.5 rounded">Story</div>
                            <div className="bg-green-100 text-green-800 px-1 py-0.5 rounded">Video</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3">
                  <button 
                    onClick={() => setShowDailyPlanCreation(false)}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                  >
                    <Calendar className="w-4 h-4" />
                    Generate Daily Plan
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI Chat for refining plan / week content */}
        {campaignId && campaign && (
          <CampaignAIChat
            isOpen={showAIChat}
            onClose={() => setShowAIChat(false)}
            onMinimize={() => setShowAIChat(false)}
            context="12week-plan"
            companyId={campaign.company_id}
            campaignId={campaignId}
            campaignData={{
              id: campaignId,
              name: campaign.name,
              status: campaign.status,
              company_id: campaign.company_id,
              created_at: campaign.createdAt,
              description: (campaign as { description?: string }).description,
              duration_weeks: overview.totalWeeks,
            }}
            prefilledPlanning={{
              campaign_duration: overview.totalWeeks,
              ...(overview.plans?.length ? { existing_plan_weeks: overview.plans.length } : {}),
            }}
            initialPlan={overview.plans?.length ? { weeks: displayPlans.map((p: any) => {
              const ref = p.refinementData ?? p;
              return { week_number: p.week ?? ref.week_number, phase_label: p.theme ?? ref.phase_label, topics_to_cover: p.topics_to_cover ?? ref.topics_to_cover ?? [], platform_allocation: p.platform_allocation ?? ref.platform_allocation ?? {}, platform_content_breakdown: p.platform_content_breakdown ?? ref.platform_content_breakdown ?? {}, primary_objective: p.contentFocus ?? ref.primary_objective };
            }) } : undefined}
          />
        )}
      </div>
    </div>
    </>
  );
}
