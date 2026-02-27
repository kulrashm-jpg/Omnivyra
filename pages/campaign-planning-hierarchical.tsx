import React, { useState, useEffect, useCallback } from 'react';
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
  MoreHorizontal,
  GripVertical,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import dynamic from 'next/dynamic';

const CALENDAR_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type GridActivity = {
  id: string;
  execution_id: string;
  week_number: number;
  day: string;
  title: string;
  platform: string;
  content_type: string;
  raw_item: Record<string, unknown>;
  planId?: string;
};

function nonEmptyGrid(v: unknown): string {
  return String(v ?? '').trim();
}

const CampaignAIChat = dynamic(() => import('../components/CampaignAIChat'), { ssr: false });

interface Campaign {
  id: string;
  name: string;
  status: string;
  userId: string;
  createdAt: string;
  progress: number;
  company_id?: string;
  current_stage?: string;
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
  /** Blueprint-derived (committed) execution context */
  weekNumber?: number;
  platform_allocation?: Record<string, number>;
  platform_content_breakdown?: Record<string, any>;
  topics_to_cover?: string[];
  week_extras?: Record<string, unknown>;
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
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showWeekDetail, setShowWeekDetail] = useState(false);
  const [weeklyPlans, setWeeklyPlans] = useState<any[]>([]);
  const [showAIEnhancement, setShowAIEnhancement] = useState(false);
  const [selectedWeekForAI, setSelectedWeekForAI] = useState<number | null>(null);
  const [isExpanding, setIsExpanding] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [dailyActivities, setDailyActivities] = useState<GridActivity[]>([]);
  const [regeneratingWeek, setRegeneratingWeek] = useState<number | null>(null);
  const [draggedActivity, setDraggedActivity] = useState<GridActivity | null>(null);
  const [dropTarget, setDropTarget] = useState<{ week: number; day: string } | null>(null);

  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });

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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const fetchCampaignOverview = async (id: string) => {
    setIsLoading(true);
    try {
      const response = await fetchWithAuth(`/api/campaigns/hierarchical-navigation?campaignId=${id}&action=get-overview`);
      if (response.ok) {
        const data = await response.json();
        setOverview(data.overview);
      } else {
        // Fallback: submitted plan may exist in blueprint even if campaign metadata lookup failed
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
              targetAudience: w.targetAudience || 'General Audience',
              keyMessaging: w.keyMessaging || '',
              platform_allocation: w.platform_allocation ?? {},
              platform_content_breakdown: w.platform_content_breakdown ?? {},
              topics_to_cover: w.topics_to_cover ?? [],
              contentTypes: w.contentTypes ?? [],
              platformStrategy: w.platformStrategy || 'Multi-platform',
              callToAction: w.callToAction || 'Engage with content',
              successMetrics: w.successMetrics || {},
              createdAt: w.createdAt || new Date().toISOString(),
              aiSuggestions: w.topics_to_cover ?? [],
            }));
            const totalScore = plans.reduce((sum: number, p: any) => sum + getWeekScore(p), 0);
            const progressPercentage = Math.min(100, Math.round((totalScore / (plans.length * 100)) * 100));
            const completedWeeks = plans.filter((p: any) => getWeekScore(p) >= SCORE_CONTENT_PLAN).length;
            setOverview({
              totalWeeks: plans.length,
              completedWeeks,
              progressPercentage,
              campaigns: [{ id, name: 'Your Campaign', status: 'planning', progress: progressPercentage, userId: '', createdAt: '' }],
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
        setWeeklyPlans(data);
      }
    } catch (error) {
      console.error('Error fetching weekly plans:', error);
    }
  };

  const loadDailyActivities = useCallback(async () => {
    if (!campaignId) return;
    const companyId = (overview?.campaigns?.[0] as any)?.company_id ?? (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('companyId') : null) ?? '';
    try {
      const planRes = await fetchWithAuth(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(campaignId)}`);
      const payload = planRes.ok ? await planRes.json().catch(() => ({})) : {};
      const planWeeks = (Array.isArray(payload?.draftPlan?.weeks) && payload.draftPlan.weeks.length > 0 ? payload.draftPlan.weeks : (Array.isArray(payload?.committedPlan?.weeks) ? payload.committedPlan.weeks : [])) || [];
      const mapped: GridActivity[] = [];
      for (const week of planWeeks) {
        const weekNumber = Number((week as any)?.week ?? (week as any)?.week_number ?? 0) || 0;
        const items = Array.isArray((week as any)?.daily_execution_items) ? (week as any).daily_execution_items : [];
        items.forEach((item: any, itemIndex: number) => {
          const execution_id = nonEmptyGrid(item?.execution_id) || `execution-${weekNumber}-${itemIndex}`;
          const dayRaw = nonEmptyGrid((item as any)?.day);
          const day = dayRaw || CALENDAR_DAYS[itemIndex % 7];
          const title = nonEmptyGrid(item?.title ?? item?.topic ?? item?.writer_content_brief?.topicTitle) || 'Untitled';
          mapped.push({
            id: execution_id,
            execution_id,
            week_number: weekNumber,
            day,
            title,
            platform: nonEmptyGrid(item?.platform).toLowerCase() || 'linkedin',
            content_type: nonEmptyGrid(item?.content_type).toLowerCase() || 'post',
            raw_item: item && typeof item === 'object' ? item : {},
          });
        });
      }
      if (mapped.length === 0) {
        const dailyRes = await fetchWithAuth(`/api/campaigns/daily-plans?campaignId=${encodeURIComponent(campaignId)}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ''}`);
        if (dailyRes.ok) {
          const dailyPlans: any[] = await dailyRes.json().catch(() => []);
          dailyPlans.forEach((plan: any, idx: number) => {
            const weekNumber = Number(plan.weekNumber ?? plan.week_number ?? 1) || 1;
            const dayOfWeek = nonEmptyGrid(plan.dayOfWeek ?? plan.day_of_week) || 'Monday';
            const title = nonEmptyGrid(plan.title ?? plan.topic ?? (plan.dailyObject as any)?.topicTitle) || 'Untitled';
            const raw = (plan.dailyObject && typeof plan.dailyObject === 'object') ? plan.dailyObject : plan;
            mapped.push({
              id: String(plan.id ?? `daily-${weekNumber}-${idx}`),
              execution_id: String(plan.id ?? `daily-${weekNumber}-${idx}`),
              week_number: weekNumber,
              day: dayOfWeek,
              title,
              platform: nonEmptyGrid(plan.platform).toLowerCase() || 'linkedin',
              content_type: String(plan.content_type ?? (plan.dailyObject as any)?.contentType ?? 'post').toLowerCase(),
              raw_item: raw,
              planId: plan.id,
            });
          });
        }
      }
      setDailyActivities(mapped);
    } catch {
      setDailyActivities([]);
    }
  }, [campaignId, overview?.campaigns]);

  useEffect(() => {
    if (campaignId && (overview || weeklyPlans.length > 0)) loadDailyActivities();
  }, [campaignId, overview, weeklyPlans.length, loadDailyActivities]);

  const openActivityWorkspace = (activity: GridActivity) => {
    const raw = activity.raw_item;
    const hasNested = (raw as any)?.writer_content_brief != null || (raw as any)?.intent != null;
    const dailyExecutionItem = hasNested
      ? { ...raw }
      : {
          ...raw,
          topic: activity.title,
          title: activity.title,
          platform: activity.platform,
          content_type: activity.content_type,
          intent: {
            objective: (raw as any)?.dailyObjective ?? (raw as any)?.objective,
            pain_point: (raw as any)?.whatProblemAreWeAddressing ?? (raw as any)?.summary,
            outcome_promise: (raw as any)?.whatShouldReaderLearn ?? (raw as any)?.introObjective,
            cta_type: (raw as any)?.desiredAction ?? (raw as any)?.cta,
          },
          writer_content_brief: {
            topicTitle: (raw as any)?.topicTitle ?? (raw as any)?.topic ?? activity.title,
            writingIntent: (raw as any)?.writingIntent ?? (raw as any)?.description,
            whatShouldReaderLearn: (raw as any)?.whatShouldReaderLearn ?? (raw as any)?.introObjective,
            whatProblemAreWeAddressing: (raw as any)?.whatProblemAreWeAddressing ?? (raw as any)?.summary,
            desiredAction: (raw as any)?.desiredAction ?? (raw as any)?.cta,
            narrativeStyle: (raw as any)?.narrativeStyle ?? (raw as any)?.brandVoice,
            topicGoal: (raw as any)?.dailyObjective ?? (raw as any)?.objective,
          },
        };
    const workspaceKey = `activity-workspace-${campaignId}-${activity.execution_id}`;
    const payload = {
      campaignId,
      weekNumber: activity.week_number,
      day: activity.day,
      activityId: activity.execution_id,
      title: activity.title,
      topic: activity.title,
      description: String((raw as any)?.writingIntent ?? (raw as any)?.description ?? ''),
      dailyExecutionItem,
      schedules: [],
    };
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(workspaceKey, JSON.stringify(payload));
        window.open(`/activity-workspace?workspaceKey=${encodeURIComponent(workspaceKey)}`, '_blank');
      }
    } catch (e) {
      console.error('Failed to open Activity Content Workspace', e);
    }
  };

  const handleRegenerateWeek = async (weekNumber: number) => {
    setRegeneratingWeek(weekNumber);
    try {
      const plan = displayPlans.find((p: any) => (p.weekNumber ?? p.week) === weekNumber);
      const res = await fetchWithAuth('/api/campaigns/generate-weekly-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          companyId: (overview?.campaigns?.[0] as any)?.company_id ?? undefined,
          week: weekNumber,
          theme: plan?.theme || `Week ${weekNumber} Theme`,
          contentFocus: plan?.contentFocus ?? '',
          targetAudience: 'General Audience',
          distribution_mode: 'staggered',
        }),
      });
      if (res.ok) {
        await fetchCampaignOverview(campaignId!);
        await fetchWeeklyPlans(campaignId!);
        await loadDailyActivities();
        notify('success', `Week ${weekNumber} daily plan updated.`);
      } else throw new Error('Regenerate failed');
    } catch {
      notify('error', 'Failed to regenerate week. Try again.');
    } finally {
      setRegeneratingWeek(null);
    }
  };

  const handleActivityDrop = async (targetWeek: number, targetDay: string) => {
    if (!draggedActivity || !campaignId) return;
    setDropTarget(null);
    setDraggedActivity(null);
    if (draggedActivity.week_number === targetWeek && draggedActivity.day === targetDay) return;
    if (draggedActivity.week_number !== targetWeek) return;
    if (!draggedActivity.planId) return;
    const res = await fetchWithAuth('/api/campaigns/save-week-daily-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId,
        weekNumber: targetWeek,
        items: [{ id: draggedActivity.planId, dayOfWeek: targetDay }],
      }),
    });
    if (res.ok) {
      setDailyActivities((prev) =>
        prev.map((a) => (a.id === draggedActivity.id ? { ...a, day: targetDay } : a))
      );
      notify('success', 'Activity moved.');
    }
  };

  const getActivitiesForDay = (weekNumber: number, day: string) =>
    dailyActivities.filter((a) => a.week_number === weekNumber && a.day === day);

  const handleAIEnhancement = (weekNumber: number) => {
    setSelectedWeekForAI(weekNumber);
    setShowAIEnhancement(true);
  };

  const buildDailyPlanGridUrl = () => {
    const params = new URLSearchParams();
    if (campaign?.company_id) params.set('companyId', String(campaign.company_id));
    return `/campaign-daily-plan/${campaignId}${params.toString() ? `?${params.toString()}` : ''}`;
  };

  const openDailyPlanGrid = () => {
    window.location.href = buildDailyPlanGridUrl();
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
    const known = labels[stage];
    if (known) return known;
    const s = String(stage || '').trim();
    if (!s) return 'Planning';
    return s.charAt(0).toUpperCase() + s.slice(1);
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
        notify('error', data.hint || data.error || 'Could not expand. Create a 12-week plan first.');
      }
    } catch {
      notify('error', 'Failed to expand to week plans.');
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
        notify('success', `Generated 7-day content structure for Week ${weekPlan.week}.`);
        fetchCampaignOverview(campaignId!);
        setShowWeekDetail(false);
      } else {
        throw new Error('Failed to generate structures');
      }
    } catch (error) {
      console.error('Error generating weekly structure:', error);
      notify('error', 'Failed to generate daily content structure. Please try again.');
    }
  };

  const handleDailyPlanning = (weekPlan: WeekPlan) => {
    openDailyPlanGrid();
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
        {notice && (
          <div
            className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
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
        )}
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

        {/* Calendar view: week × day grid with daily activities */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900">{overview.totalWeeks}-Week Content Plan</h2>
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
          <p className="text-sm text-gray-600 mb-4">
            Drag activities between days to reorder (same week). Click an activity to open the Activity Content Workspace.
          </p>

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
            <div className="space-y-6">
              {Array.from({ length: (overview?.totalWeeks ?? displayPlans.length) || 12 }, (_, index) => {
                const weekNumber = index + 1;
                const plan = displayPlans.find((p: any) => (p.weekNumber ?? p.week) === weekNumber);
                const theme = plan?.theme || `Week ${weekNumber} Theme`;
                const isRegenerating = regeneratingWeek === weekNumber;
                return (
                  <div key={weekNumber} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="font-semibold text-gray-900">Week {weekNumber}: {theme}</h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleAIEnhancement(weekNumber)}
                          className="flex items-center gap-1 px-2 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-xs font-medium"
                        >
                          <Sparkles className="w-3 h-3" />
                          [+]
                        </button>
                        <button
                          onClick={() => handleRegenerateWeek(weekNumber)}
                          disabled={isRegenerating}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 text-sm font-medium disabled:opacity-50"
                        >
                          <RefreshCw className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
                          Regenerate
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-7 gap-px bg-gray-200">
                      {CALENDAR_DAYS.map((day) => {
                        const cellActivities = getActivitiesForDay(weekNumber, day);
                        const isDropTarget = dropTarget?.week === weekNumber && dropTarget?.day === day;
                        return (
                          <div
                            key={day}
                            onDragOver={(e) => { e.preventDefault(); setDropTarget({ week: weekNumber, day }); }}
                            onDragLeave={() => setDropTarget((t) => (t?.week === weekNumber && t?.day === day ? null : t))}
                            onDrop={(e) => { e.preventDefault(); handleActivityDrop(weekNumber, day); }}
                            className={`min-h-[100px] bg-white p-2 ${isDropTarget ? 'ring-2 ring-indigo-400 bg-indigo-50/50' : ''}`}
                          >
                            <div className="text-xs font-medium text-gray-500 mb-1">{day.slice(0, 3)}</div>
                            <div className="space-y-1">
                              {cellActivities.map((act) => (
                                <div
                                  key={act.id}
                                  draggable
                                  onDragStart={() => setDraggedActivity(act)}
                                  onDragEnd={() => setDraggedActivity(null)}
                                  onClick={() => openActivityWorkspace(act)}
                                  className="flex items-center gap-1 rounded border border-gray-200 bg-gray-50 hover:bg-indigo-50 hover:border-indigo-200 p-1.5 cursor-pointer group"
                                >
                                  <GripVertical className="w-3 h-3 text-gray-400 shrink-0 opacity-0 group-hover:opacity-100" />
                                  <span className="text-xs text-gray-800 truncate flex-1" title={act.title}>
                                    {act.title.slice(0, 24)}{act.title.length > 24 ? '…' : ''}
                                  </span>
                                  <span className="text-[10px] text-gray-500 capitalize">{act.platform}</span>
                                  <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {displayPlans.length > 0 && (
            <p className="text-xs text-gray-500 mt-4">And so on… Add more weeks from the main plan.</p>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              onClick={() => window.location.href = `/campaign-daily-plan/${campaignId}${campaign?.company_id ? `?companyId=${encodeURIComponent(String(campaign.company_id))}` : ''}`}
              className="flex items-center gap-3 p-4 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors bg-indigo-50/50"
            >
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Calendar className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <div className="font-medium text-gray-900">View plan & Work on Daily</div>
                <div className="text-sm text-gray-600">Open daily plan page — all weeks (including unworked) shown there</div>
              </div>
            </button>
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
