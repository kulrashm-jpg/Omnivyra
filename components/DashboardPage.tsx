import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Plus, BarChart3, Calendar, Target, TrendingUp, Play, Edit3, CheckCircle, Eye, MoreHorizontal, Users, Settings, UserPlus, Heart, ExternalLink, Share, Loader2, Trash2, ExternalLink as ExternalLinkIcon, Link2, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCompanyContext } from './CompanyContext';
import Header from './Header';
import { supabase } from '../utils/supabaseClient';
import { getStageLabelWithDuration } from '../backend/types/CampaignStage';

interface Campaign {
  id: string;
  name: string;
  description: string;
  status: string;
  current_stage: string;
  start_date: string;
  end_date: string;
  created_at: string;
  platforms: string[];
  duration_weeks?: number | null;
}

interface CampaignProgress {
  percentage: number;
  contentCount: number;
  scheduledCount: number;
  publishedCount: number;
}

interface DashboardStats {
  totalCampaigns: number;
  activeCampaigns: number;
  totalContent: number;
  publishedContent: number;
}

type CalendarExecutionStage =
  | 'weekly_planning'
  | 'daily_cards'
  | 'content_created'
  | 'content_scheduled'
  | 'content_shared'
  | 'overdue';

type CalendarActivity = {
  campaign: Campaign;
  stage: CalendarExecutionStage;
  label: string;
  weekNumber?: number;
};


export default function DashboardPage() {
  const router = useRouter();
  const { selectedCompanyId, isAdmin, isLoading, hasPermission, userRole } = useCompanyContext();
  const canCreateCampaign = hasPermission('CREATE_CAMPAIGN');
  const canScheduleContent = hasPermission('SCHEDULE_CONTENT');
  const [activeTab, setActiveTab] = useState('overview');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalCampaigns: 0,
    activeCampaigns: 0,
    totalContent: 0,
    publishedContent: 0
  });
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaignProgress, setCampaignProgress] = useState<{[key: string]: CampaignProgress}>({});
  const [leadCaptureModalOpen, setLeadCaptureModalOpen] = useState(false);
  const [leadCaptureToast, setLeadCaptureToast] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [stageAvailability, setStageAvailability] = useState<Record<string, { stages: Record<string, boolean>; counts: Record<string, number> }>>({});
  const [calendarCurrentDate, setCalendarCurrentDate] = useState(new Date());
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<'month' | 'week'>('month');
  const [calendarActivityMode, setCalendarActivityMode] = useState<'daily' | 'weekly'>('daily');
  const [calendarCampaignFilter, setCalendarCampaignFilter] = useState<string>('all');
  const [calendarStatusFilter, setCalendarStatusFilter] = useState<string>('all');
  const [calendarWeekFilter, setCalendarWeekFilter] = useState<string>('all');
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [pendingDeleteCampaignId, setPendingDeleteCampaignId] = useState<string | null>(null);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });
  const isCompanyAdmin = (userRole || '').toString() === 'COMPANY_ADMIN';

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);

  const CAMPAIGN_STAGES = [
    { id: 'all', label: 'All' },
    { id: 'planning', label: 'Planning' },
    { id: 'twelve_week_plan', label: 'Week Plan' },
    { id: 'daily_plan', label: 'Daily Plan' },
    { id: 'charting', label: 'Charting' },
    { id: 'schedule', label: 'Schedule' },
  ] as const;
  const filteredCampaigns = stageFilter === 'all'
    ? campaigns
    : campaigns.filter((c) => (c.current_stage || c.status) === stageFilter);

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
    console.log('Dashboard component mounted, starting to load data...');
    loadDashboardData();
  }, [selectedCompanyId]);

  useEffect(() => {
    console.log('DASHBOARD_SELECTED_COMPANY', selectedCompanyId, { isAdmin });
  }, [selectedCompanyId, isAdmin]);

  useEffect(() => {
    if (activeTab !== 'calendar') return;
    if (calendarSelectedDate) return;
    setCalendarSelectedDate(formatDateKey(new Date()));
  }, [activeTab, calendarSelectedDate]);
  useEffect(() => {
    setCalendarWeekFilter('all');
  }, [calendarCampaignFilter, calendarActivityMode]);

  const campaignIds = campaigns.map((c) => c.id).filter(Boolean).join(',');
  const [expandingCampaignId, setExpandingCampaignId] = useState<string | null>(null);

  const formatDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const parseDateKey = (key: string): Date => {
    const [y, m, d] = key.split('-').map((value) => Number(value));
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const parseCalendarDate = (rawInput: unknown): Date | null => {
    const raw = String(rawInput || '').trim();
    if (!raw) return null;
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (dateOnly) {
      const year = Number(dateOnly[1]);
      const month = Number(dateOnly[2]);
      const day = Number(dateOnly[3]);
      const localDate = new Date(year, month - 1, day);
      return Number.isFinite(localDate.getTime()) ? localDate : null;
    }
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };
  const getCampaignStatusCategory = (campaign: Campaign): 'active' | 'completed' | 'on_hold' | 'planned' | 'other' => {
    const raw = String(campaign.status || campaign.current_stage || '').toLowerCase();
    if (raw.includes('complete') || raw.includes('done') || raw.includes('closed')) return 'completed';
    if (raw.includes('hold') || raw.includes('pause')) return 'on_hold';
    if (raw.includes('active') || raw.includes('running')) return 'active';
    if (raw.includes('draft') || raw.includes('plan') || raw.includes('pending')) return 'planned';
    return 'other';
  };
  const getCalendarStageAppearance = (stage: CalendarExecutionStage): { badge: string; dot: string; label: string } => {
    switch (stage) {
      case 'daily_cards':
        return {
          badge: 'bg-green-100 text-green-800 border border-green-200',
          dot: 'bg-green-300',
          label: 'Daily Cards',
        };
      case 'content_created':
        return {
          badge: 'bg-sky-100 text-sky-800 border border-sky-200',
          dot: 'bg-sky-300',
          label: 'Content Created',
        };
      case 'content_scheduled':
        return {
          badge: 'bg-emerald-600 text-white border border-emerald-700',
          dot: 'bg-emerald-600',
          label: 'Content Scheduled',
        };
      case 'content_shared':
        return {
          badge: 'bg-blue-700 text-white border border-blue-800',
          dot: 'bg-blue-700',
          label: 'Content Shared',
        };
      case 'overdue':
        return {
          badge: 'bg-red-600 text-white border border-red-700',
          dot: 'bg-red-500',
          label: 'Overdue',
        };
      case 'weekly_planning':
      default:
        return {
          badge: 'bg-white text-gray-800 border border-gray-300',
          dot: 'bg-gray-300',
          label: 'Weekly Planning',
        };
    }
  };
  const getCampaignTotalWeeks = (campaign: Campaign): number => {
    if (typeof campaign.duration_weeks === 'number' && campaign.duration_weeks > 0) {
      return Math.max(1, Math.floor(campaign.duration_weeks));
    }
    const start = parseCalendarDate(campaign.start_date);
    const end = parseCalendarDate(campaign.end_date);
    if (!start || !end) return 1;
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const diff = Math.max(0, end.getTime() - start.getTime());
    return Math.max(1, Math.ceil((diff + 1) / (1000 * 60 * 60 * 24 * 7)));
  };
  const getCampaignExecutionStage = (campaign: Campaign): CalendarExecutionStage => {
    const counts = stageAvailability[campaign.id]?.counts || {};
    const dailyPlans = Number(counts.dailyPlans || 0);
    const contentReadyDailyPlans = Number(counts.contentReadyDailyPlans || 0);
    const scheduledPosts = Number(counts.scheduledPosts || 0);
    const publishedPosts = Number(counts.publishedPosts || 0);
    const end = parseCalendarDate(campaign.end_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (end) {
      end.setHours(0, 0, 0, 0);
      const incompleteAfterEnd = end < today && (dailyPlans === 0 || scheduledPosts === 0 || publishedPosts === 0);
      if (incompleteAfterEnd) return 'overdue';
    }
    if (publishedPosts > 0) return 'content_shared';
    if (scheduledPosts > 0) return 'content_scheduled';
    if (contentReadyDailyPlans > 0) return 'content_created';
    if (dailyPlans > 0) return 'daily_cards';
    return 'weekly_planning';
  };
  const getDaysInMonth = (date: Date): Array<Date | null> => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leading = firstDay.getDay();
    const cells: Array<Date | null> = [];
    for (let i = 0; i < leading; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
    return cells;
  };
  const getWeekDays = (anchorDate: Date): Date[] => {
    const start = new Date(anchorDate);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, idx) => {
      const day = new Date(start);
      day.setDate(start.getDate() + idx);
      return day;
    });
  };
  const getWeekLabel = (anchorDate: Date) => {
    const weekDays = getWeekDays(anchorDate);
    const first = weekDays[0];
    const last = weekDays[6];
    const firstLabel = first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const lastLabel = last.toLocaleDateString('en-US', {
      month: first.getMonth() === last.getMonth() ? undefined : 'short',
      day: 'numeric',
      year: first.getFullYear() === last.getFullYear() ? undefined : 'numeric',
    });
    const yearLabel = last.getFullYear();
    return `${firstLabel} - ${lastLabel}, ${yearLabel}`;
  };
  const calendarFilteredCampaigns = campaigns.filter((campaign) => {
    const campaignMatch = calendarCampaignFilter === 'all' || campaign.id === calendarCampaignFilter;
    const statusCategory = getCampaignStatusCategory(campaign);
    const statusMatch = calendarStatusFilter === 'all' || statusCategory === calendarStatusFilter;
    return campaignMatch && statusMatch;
  });
  const getCalendarActivitiesForDate = (date: Date): CalendarActivity[] => {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const activities: CalendarActivity[] = [];
    calendarFilteredCampaigns.forEach((campaign) => {
      const start = parseCalendarDate(campaign.start_date);
      if (!start) return;
      start.setHours(0, 0, 0, 0);
      const rawEnd = parseCalendarDate(campaign.end_date);
      const end = rawEnd ? new Date(rawEnd) : new Date(start);
      end.setHours(0, 0, 0, 0);
      if (dayStart < start || dayStart > end) return;
      const stage = getCampaignExecutionStage(campaign);
      if (calendarActivityMode === 'weekly') {
        const elapsedDays = Math.floor((dayStart.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        const weekNumber = Math.floor(elapsedDays / 7) + 1;
        const totalWeeks = getCampaignTotalWeeks(campaign);
        if (weekNumber < 1 || weekNumber > totalWeeks) return;
        if (calendarWeekFilter !== 'all' && Number(calendarWeekFilter) !== weekNumber) return;
        activities.push({
          campaign,
          stage,
          weekNumber,
          label: `Week ${weekNumber} - ${campaign.name}`,
        });
        return;
      }
      activities.push({
        campaign,
        stage,
        label: campaign.name,
      });
    });
    return activities;
  };
  const selectedCalendarCampaign = campaigns.find((campaign) => campaign.id === calendarCampaignFilter) || null;

  useEffect(() => {
    if (!campaignIds) {
      setStageAvailability({});
      return;
    }
    fetchWithAuth(
      `/api/campaigns/stage-availability-batch?campaignIds=${encodeURIComponent(campaignIds)}`
    )
      .then((r) => r.ok ? r.json() : { availability: {} })
      .then((data) => setStageAvailability(data.availability || {}))
      .catch(() => setStageAvailability({}));
  }, [campaignIds]);

  const handleExpandToWeekPlans = async (campaignId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandingCampaignId(campaignId);
    try {
      const res = await fetchWithAuth(`/api/campaigns/${campaignId}/expand-to-week-plans`, {
        method: 'POST',
      });
      if (res.ok) {
        const ids = campaignIds.split(',').filter(Boolean);
        const r = await fetchWithAuth(`/api/campaigns/stage-availability-batch?campaignIds=${ids.join(',')}`);
        if (r.ok) {
          const data = await r.json();
          setStageAvailability(data.availability || {});
        }
      }
    } catch {
      /* ignore */
    } finally {
      setExpandingCampaignId(null);
    }
  };


  const loadDashboardData = async () => {
    console.log('loadDashboardData called, isLoading:', isLoadingData);
    // Remove the isLoading check to prevent blocking
    if (!selectedCompanyId) {
      console.warn('No company selected yet, skipping dashboard load');
      return;
    }
    console.log('Starting API call...');
    try {
      setIsLoadingData(true);
      setError(null); // Clear any previous errors
      console.log('Set isLoading to true');
      
      // Simple fetch without timeout/abort controller
      const campaignsUrl = `/api/campaigns?companyId=${selectedCompanyId}`;
      console.log('DASHBOARD_API_CALL', campaignsUrl);
      const campaignsResponse = await fetchWithAuth(campaignsUrl);
      console.log('Received response:', campaignsResponse.status, campaignsResponse.statusText);
      
      if (!campaignsResponse.ok) {
        if (campaignsResponse.status === 403) {
          setCampaigns([]);
          setStats({
            totalCampaigns: 0,
            activeCampaigns: 0,
            totalContent: 0,
            publishedContent: 0
          });
          setError(null);
          return;
        }
        // Try to get error details from response body
        let errorMessage = `HTTP ${campaignsResponse.status}: ${campaignsResponse.statusText}`;
        let errorDetails = '';
        
        try {
          const errorData = await campaignsResponse.json();
          console.error('API Error Response:', errorData);
          
          if (errorData.error) {
            errorMessage = errorData.error;
          }
          if (errorData.details) {
            errorDetails = errorData.details;
          }
        } catch (parseError) {
          console.error('Could not parse error response:', parseError);
          // Use default error message
        }
        
        const fullError = errorDetails ? `${errorMessage}: ${errorDetails}` : errorMessage;
        console.error('DASHBOARD_API_ERROR', fullError);
        setError(fullError);
        return;
      }
      
      console.log('About to parse JSON response...');
      const campaignsData = await campaignsResponse.json();
      console.log('Successfully parsed JSON response');

        console.log('Dashboard API Response:', campaignsData);
      
      if (campaignsData.success && Array.isArray(campaignsData.campaigns)) {
        console.log('Updating campaigns state with', campaignsData.campaigns.length, 'campaigns');
        setCampaigns(campaignsData.campaigns);
        
        // Calculate stats
        const totalCampaigns = campaignsData.campaigns.length;
        const activeCampaigns = campaignsData.campaigns.filter((c: Campaign) => 
          c.status === 'active' || c.status === 'running'
        ).length;
        
        console.log(`Dashboard Stats - Total: ${totalCampaigns}, Active: ${activeCampaigns}`);
        
        console.log('Updating stats state...');
        setStats({
          totalCampaigns,
          activeCampaigns,
          totalContent: 0, // Will implement content counting later
          publishedContent: 0 // Will implement content counting later
        });
        console.log('Stats state updated');
        setError(null); // Clear any previous errors on success
      } else {
        // Fallback for unexpected response format
        console.warn('Unexpected campaigns data format:', campaignsData);
        setCampaigns([]);
        setStats({
          totalCampaigns: 0,
          activeCampaigns: 0,
          totalContent: 0,
          publishedContent: 0
        });
      }
    } catch (error) {
      console.error('DASHBOARD_API_ERROR', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load dashboard data';
      if (!error) {
        setError(errorMessage);
      }
      setCampaigns([]);
      setStats({
        totalCampaigns: 0,
        activeCampaigns: 0,
        totalContent: 0,
        publishedContent: 0
      });
    } finally {
      console.log('Setting isLoading to false');
      setIsLoadingData(false);
    }
  };

  // Handler functions
  const handleDeleteCampaign = async (campaignId: string) => {
    if (!selectedCompanyId) {
      notify('error', 'Please select a company before deleting campaigns.');
      return;
    }
    try {
      const { data } = await supabase.auth.getSession();
      if (!data?.session?.access_token) {
        notify('error', 'Your session may have expired. Please refresh the page and try again.');
        return;
      }
      setPendingDeleteCampaignId(campaignId);
    } catch {
      notify('error', 'Unable to verify session. Please sign in again.');
    }
  };

  const confirmDeleteCampaign = async () => {
    if (!selectedCompanyId || !pendingDeleteCampaignId) return;
    try {
      const deleteUrl = `/api/admin/delete-campaign?companyId=${encodeURIComponent(selectedCompanyId)}`;
      const deleteResponse = await fetchWithAuth(deleteUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: pendingDeleteCampaignId,
          companyId: selectedCompanyId,
          ipAddress: '127.0.0.1',
          userAgent: navigator.userAgent
        })
      });
      const result = await deleteResponse.json();
      if (deleteResponse.ok && result.success) {
        loadDashboardData();
        notify('success', 'Campaign deleted successfully.');
      } else {
        notify('error', `Failed to delete campaign: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting campaign:', error);
      notify('error', `Error deleting campaign: ${error.message}`);
    } finally {
      setPendingDeleteCampaignId(null);
    }
  };

  const handleViewCampaign = (campaignId: string) => {
    const params = new URLSearchParams();
    if (selectedCompanyId) params.set('companyId', selectedCompanyId);
    window.location.href = `/campaign-details/${campaignId}${params.toString() ? `?${params.toString()}` : ''}`;
  };

  const buildPlanningWorkspaceUrl = (campaignId: string) => {
    const params = new URLSearchParams();
    if (selectedCompanyId) params.set('companyId', selectedCompanyId);
    params.set('campaignId', campaignId);
    return `/campaign-planning-hierarchical?${params.toString()}`;
  };

  const getStageColor = (stage: string) => {
    const stageMap: Record<string, string> = {
      planning: 'from-blue-500 to-cyan-600',
      twelve_week_plan: 'from-indigo-500 to-purple-600',
      daily_plan: 'from-amber-500 to-orange-600',
      charting: 'from-teal-500 to-emerald-600',
      schedule: 'from-green-500 to-emerald-600',
      active: 'from-green-500 to-emerald-600',
      completed: 'from-purple-500 to-violet-600',
    };
    return stageMap[stage] ?? 'from-gray-500 to-slate-600';
  };

  const getStageLabel = (stage: string, durationWeeks?: number | null) =>
    getStageLabelWithDuration(stage, durationWeeks);

  if (isLoading) {
    return (
      <div className="p-6 text-gray-500">
        Loading company context...
      </div>
    );
  }

  if (!selectedCompanyId) {
    return (
      <div className="p-6 text-gray-500">
        Please select a company to view dashboard data.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <Header />
      {notice && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-indigo-200 bg-indigo-50 text-indigo-800'
            }`}
            role="status"
            aria-live="polite"
          >
            {notice.message}
          </div>
        </div>
      )}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                Content Manager
              </h1>
              <p className="text-gray-600 mt-1">Plan, create, and execute your content campaigns</p>
            </div>
            <div className="flex items-center gap-2">
              {canCreateCampaign && (
                <button
                  onClick={() => router.push('/team-management')}
                  className="bg-gray-100 text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
                >
                  Manage Users
                </button>
              )}
              <button
                onClick={() => window.location.href = '/create-campaign'}
                disabled={!canCreateCampaign}
                title={
                  canCreateCampaign ? 'Start a new campaign from scratch (no recommendation)' : 'You do not have permission to create campaigns.'
                }
                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
              >
                <Plus className="h-5 w-5" />
                Create Campaign
              </button>
            </div>
          </div>
        </div>
      </div>
            
      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex space-x-1 bg-white/60 backdrop-blur-sm rounded-xl p-1 shadow-sm border border-gray-200/50">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'campaigns', label: 'Campaigns', icon: Target },
            { id: 'team', label: 'Team', icon: Users },
            { id: 'analytics', label: 'Analytics', icon: TrendingUp },
            { id: 'calendar', label: 'Calendar', icon: Calendar },
            { id: 'integrations', label: 'Integrations', icon: Link2 }
          ].map((tab) => {
            const Icon = tab.icon;
            if (tab.id === 'team') {
              return (
                <button
                  key={tab.id}
                  onClick={() => router.push('/team-management')}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 text-gray-600 hover:text-gray-900 hover:bg-white/50"
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            }
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
                  </div>
                </div>

      {/* Error Message Display */}
      {error && (
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg shadow-sm">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-red-800">Error loading dashboard data</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
                <div className="mt-4">
                  <button
                    onClick={() => {
                      setError(null);
                      loadDashboardData();
                    }}
                    className="text-sm font-medium text-red-800 hover:text-red-900 underline"
                  >
                    Try again
                  </button>
                </div>
              </div>
              <div className="ml-auto pl-3">
                <button
                  onClick={() => setError(null)}
                  className="text-red-500 hover:text-red-700"
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 pb-8">
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { 
                  label: 'Total Campaigns', 
                  value: stats.totalCampaigns, 
                  icon: Target, 
                  color: 'from-blue-500 to-cyan-600',
                  onClick: () => setActiveTab('campaigns')
                },
                { 
                  label: 'Active Campaigns', 
                  value: stats.activeCampaigns, 
                  icon: Play, 
                  color: 'from-green-500 to-emerald-600',
                  onClick: () => setActiveTab('campaigns')
                },
                { 
                  label: 'Total Content', 
                  value: stats.totalContent, 
                  icon: Edit3, 
                  color: 'from-purple-500 to-violet-600',
                  onClick: () => window.location.href = '/content-creation'
                },
                { 
                  label: 'Published', 
                  value: stats.publishedContent, 
                  icon: CheckCircle, 
                  color: 'from-orange-500 to-red-600',
                  onClick: () => window.location.href = '/analytics'
                }
              ].map((stat, index) => {
                const Icon = stat.icon;
                return (
                  <button 
                    key={index} 
                    onClick={stat.onClick}
                    className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50 hover:shadow-xl transition-all duration-300 text-left w-full cursor-pointer hover:scale-105"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-gray-600 text-sm font-medium">{stat.label}</p>
                        {isLoadingData ? (
                          <div className="mt-2">
                            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                          </div>
                        ) : (
                          <p className="text-3xl font-bold text-gray-900 mt-2">{stat.value}</p>
                        )}
                      </div>
                      <div className={`p-3 rounded-xl bg-gradient-to-r ${stat.color}`}>
                        <Icon className="h-6 w-6 text-white" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            
            {/* Campaigns List Section */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
              <div className="p-6 border-b border-gray-200/50">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-gray-900">Recent Campaigns</h2>
                  <button 
                    onClick={() => setActiveTab('campaigns')}
                    className="text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-2"
                  >
                    View All
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                {isLoadingData ? (
                  <div className="flex justify-center items-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-600">Loading campaigns...</span>
                  </div>
                ) : campaigns.length === 0 ? (
                  <div className="text-center py-12">
                    <Target className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No campaigns yet</h3>
                    <p className="text-gray-600 mb-6">Create your first campaign to get started</p>
                    <button 
                      onClick={() => window.location.href = '/create-campaign'}
                      disabled={!canCreateCampaign}
                      title={
                        canCreateCampaign ? 'Start from scratch (no recommendation)' : 'You do not have permission to create campaigns.'
                      }
                      className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 mx-auto disabled:opacity-50"
                    >
                      <Plus className="h-5 w-5" />
                      Create Campaign
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {campaigns.slice(0, 3).map((campaign) => (
                      <div
                        key={campaign.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleViewCampaign(campaign.id)}
                        onKeyDown={(e) => e.key === 'Enter' && handleViewCampaign(campaign.id)}
                        className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-6 border border-gray-200/50 hover:shadow-md transition-all duration-200 cursor-pointer"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg bg-gradient-to-r ${getStageColor(campaign.current_stage || campaign.status)}`}>
                              <Play className="h-4 w-4 text-white" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-gray-900">{campaign.name}</h3>
                              <p className="text-xs text-gray-500 font-mono">ID: {campaign.id}</p>
                              <p className="text-sm text-gray-600">
                                {campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : 'Not scheduled'} - {campaign.end_date ? new Date(campaign.end_date).toLocaleDateString() : 'Not scheduled'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewCampaign(campaign.id);
                              }}
                              className={`px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r ${getStageColor(campaign.current_stage || campaign.status)} text-white hover:opacity-80 transition-opacity`}
                            >
                              {getStageLabel(campaign.current_stage || campaign.status, campaign.duration_weeks)}
                            </button>
                            <a
                              href={`/campaign-details/${campaign.id}${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`}
                              onClick={(e) => e.stopPropagation()}
                              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Week plan"
                            >
                              <Calendar className="h-4 w-4 text-slate-600" />
                            </a>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.location.href = buildPlanningWorkspaceUrl(campaign.id);
                              }}
                              className="p-2 hover:bg-indigo-100 rounded-lg transition-colors"
                              title="View submitted plan"
                            >
                              <FileText className="h-4 w-4 text-indigo-600" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCampaign(campaign.id);
                              }}
                              className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                              title="Delete Campaign"
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </button>
                          </div>
                        </div>
                        {pendingDeleteCampaignId === campaign.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-center justify-between gap-3 mb-4"
                          >
                            <span>Delete this campaign? This cannot be undone.</span>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => setPendingDeleteCampaignId(null)} className="px-3 py-1.5 rounded border border-amber-300 bg-white hover:bg-amber-100">Cancel</button>
                              <button type="button" onClick={confirmDeleteCampaign} className="px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">Platforms:</span>
                            <span className="text-sm font-medium">Multiple</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">Stage:</span>
                            <span className="text-sm font-medium">{getStageLabel(campaign.current_stage || campaign.status, campaign.duration_weeks)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">Created:</span>
                            <span className="text-sm font-medium">{campaign.created_at ? new Date(campaign.created_at).toLocaleDateString() : 'Recently'}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5 mb-4">
                          <a
                            href={`/campaign-details/${campaign.id}${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                          >
                            Week plan
                          </a>
                        {(stageAvailability[campaign.id]?.stages && Object.values(stageAvailability[campaign.id].stages).some(Boolean)) && (
                            <>
                            {stageAvailability[campaign.id].stages.twelveWeekPlan && (
                              <a
                                href={buildPlanningWorkspaceUrl(campaign.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-1 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                              >
                                {campaign.duration_weeks ?? 12} Week
                              </a>
                            )}
                            {stageAvailability[campaign.id].stages.twelveWeekPlan && !stageAvailability[campaign.id].stages.detailedWeekPlans && (
                              <button
                                onClick={(e) => handleExpandToWeekPlans(campaign.id, e)}
                                disabled={expandingCampaignId === campaign.id}
                                className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50"
                              >
                                {expandingCampaignId === campaign.id ? 'Expanding…' : 'Expand to Week Plans'}
                              </button>
                            )}
                            {(stageAvailability[campaign.id].stages.detailedWeekPlans || stageAvailability[campaign.id].stages.dailyPlans) && (
                              <a
                                href={buildPlanningWorkspaceUrl(campaign.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 hover:bg-purple-200"
                              >
                                Weekly & Daily
                              </a>
                            )}
                            {stageAvailability[campaign.id].stages.aiEnrichedWeeks && (
                              <span className="text-xs px-2 py-1 rounded bg-violet-100 text-violet-700">AI Enriched</span>
                            )}
                            {stageAvailability[campaign.id].stages.charting && (
                              <a
                                href={`/campaign-details/${campaign.id}${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-1 rounded bg-teal-100 text-teal-700 hover:bg-teal-200"
                              >
                                Charting
                              </a>
                            )}
                            {stageAvailability[campaign.id].stages.schedule && (
                              <a
                                href={`/campaign-details/${campaign.id}${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200"
                              >
                                Scheduled
                              </a>
                            )}
                            </>
                        )}
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Progress</span>
                            <CampaignProgress campaignId={campaign.id} companyId={selectedCompanyId} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
                
            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-6">
              <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <Users className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">Company Profile</h3>
                </div>
                <p className="text-indigo-100 mb-4">
                  Start here to define your company intelligence profile
                </p>
                <button
                  onClick={() => window.location.href = '/company-profile'}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Open Profile
                </button>
              </div>
              <div className="bg-gradient-to-br from-slate-500 to-gray-700 rounded-2xl p-6 text-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <Settings className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">External APIs</h3>
                </div>
                <p className="text-gray-100 mb-4">
                  Configure external sources for trend signals
                </p>
                <button
                  onClick={() => window.location.href = '/external-apis'}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Manage APIs
                </button>
              </div>
              <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-6 text-white lg:min-w-[calc(100%+16px)] lg:-ml-2 lg:-mr-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <TrendingUp className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">Recommendations</h3>
                </div>
                <p className="text-emerald-100 mb-4">
                  Generate trend-based campaign recommendations
                </p>
                <button
                  onClick={() => window.location.href = '/recommendations'}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  View Recommendations
                </button>
              </div>
              <div className="bg-gradient-to-br from-slate-600 to-slate-800 rounded-2xl p-6 text-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <Settings className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">Social Platform Settings</h3>
                </div>
                <p className="text-slate-100 mb-4">
                  Define publishing rules per platform
                </p>
                <button
                  onClick={() => window.location.href = '/social-platforms'}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Configure Platforms
                </button>
              </div>
              <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-6 text-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <Calendar className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">Schedule Content</h3>
                </div>
                <p className="text-green-100 mb-4">Plan and schedule your content calendar</p>
                <button
                  onClick={() => setActiveTab('calendar')}
                  disabled={!canScheduleContent}
                  title={
                    canScheduleContent ? '' : 'You do not have permission to schedule content.'
                  }
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  Schedule Now
                </button>
                  </div>
                </div>
              </div>
            )}

        {/* Campaigns Tab */}
        {activeTab === 'campaigns' && (
          <div className="space-y-8">
            {/* Campaigns Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold text-gray-900">All Campaigns</h2>
                <p className="text-gray-600 mt-1">Manage and track all your content campaigns</p>
              </div>
              <button
                onClick={() => window.location.href = '/create-campaign'}
                disabled={!canCreateCampaign}
                title={
                  canCreateCampaign ? '' : 'You do not have permission to create campaigns.'
                }
                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
              >
                <Plus className="h-5 w-5" />
                Create Campaign
              </button>
            </div>

            {/* Stage Filter */}
            <div className="flex flex-wrap gap-2">
              {CAMPAIGN_STAGES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStageFilter(s.id)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    stageFilter === s.id
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md'
                      : 'bg-white/80 text-gray-600 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Campaigns List */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
              {isLoadingData ? (
                <div className="flex justify-center items-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-600">Loading campaigns...</span>
                </div>
              ) : filteredCampaigns.length === 0 ? (
                <div className="text-center py-16">
                  <Target className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-medium text-gray-900 mb-2">
                    {campaigns.length === 0 ? 'No campaigns found' : `No campaigns in ${CAMPAIGN_STAGES.find((s) => s.id === stageFilter)?.label ?? stageFilter}`}
                  </h3>
                  <p className="text-gray-600 mb-8">Create your first campaign to get started with content management</p>
                  <button 
                    onClick={() => window.location.href = '/create-campaign'}
                    disabled={!canCreateCampaign}
                    title={
                      canCreateCampaign ? 'Start from scratch (no recommendation)' : 'You do not have permission to create campaigns.'
                    }
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-8 py-4 rounded-xl font-medium transition-all duration-200 flex items-center gap-2 mx-auto shadow-lg hover:shadow-xl transform hover:scale-105 disabled:opacity-50"
                  >
                    <Plus className="h-5 w-5" />
                    Create Your First Campaign
                  </button>
                </div>
              ) : (
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {filteredCampaigns.map((campaign) => (
                      <div
                        key={campaign.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleViewCampaign(campaign.id)}
                        onKeyDown={(e) => e.key === 'Enter' && handleViewCampaign(campaign.id)}
                        className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-6 border border-gray-200/50 hover:shadow-lg transition-all duration-200 cursor-pointer"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className={`p-3 rounded-lg bg-gradient-to-r ${getStageColor(campaign.current_stage || campaign.status)}`}>
                              <Target className="h-6 w-6 text-white" />
                            </div>
                            <div>
                              <h3 className="text-lg font-semibold text-gray-900">{campaign.name}</h3>
                              <p className="text-xs text-gray-500 font-mono mt-0.5">ID: {campaign.id}</p>
                              <p className="text-gray-600 mt-1">{campaign.description || 'No description available'}</p>
                              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                                <span>Created: {campaign.created_at ? new Date(campaign.created_at).toLocaleDateString() : 'Recently'}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between mb-4">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewCampaign(campaign.id);
                              }}
                              className={`px-4 py-2 rounded-full text-sm font-medium bg-gradient-to-r ${getStageColor(campaign.current_stage || campaign.status)} text-white hover:opacity-80 transition-opacity`}
                            >
                              {getStageLabel(campaign.current_stage || campaign.status, campaign.duration_weeks)}
                            </button>
                          <div className="flex items-center gap-2">
                            <a
                              href={`/campaign-details/${campaign.id}${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`}
                              onClick={(e) => e.stopPropagation()}
                              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Week plan"
                            >
                              <Calendar className="h-4 w-4 text-slate-600" />
                            </a>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.location.href = buildPlanningWorkspaceUrl(campaign.id);
                              }}
                              className="p-2 hover:bg-indigo-100 rounded-lg transition-colors"
                              title="View submitted plan"
                            >
                              <FileText className="h-4 w-4 text-indigo-600" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCampaign(campaign.id);
                              }}
                              className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                              title="Delete Campaign"
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </button>
                          </div>
                        </div>
                        {pendingDeleteCampaignId === campaign.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-center justify-between gap-3 mb-4"
                          >
                            <span>Delete this campaign? This cannot be undone.</span>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => setPendingDeleteCampaignId(null)} className="px-3 py-1.5 rounded border border-amber-300 bg-white hover:bg-amber-100">Cancel</button>
                              <button type="button" onClick={confirmDeleteCampaign} className="px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 gap-4 mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">Start Date:</span>
                            <span className="text-sm font-medium">{campaign.start_date ? new Date(campaign.start_date).toLocaleDateString() : 'Not set'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">End Date:</span>
                            <span className="text-sm font-medium">{campaign.end_date ? new Date(campaign.end_date).toLocaleDateString() : 'Not set'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                            <span className="text-sm text-gray-600">Stage:</span>
                            <span className="text-sm font-medium">{getStageLabel(campaign.current_stage || campaign.status, campaign.duration_weeks)}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5 mb-4">
                          <a
                            href={`/campaign-details/${campaign.id}${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                          >
                            Week plan
                          </a>
                        {(stageAvailability[campaign.id]?.stages && Object.values(stageAvailability[campaign.id].stages).some(Boolean)) && (
                            <>
                            {stageAvailability[campaign.id].stages.twelveWeekPlan && (
                              <a
                                href={buildPlanningWorkspaceUrl(campaign.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-1 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                              >
                                {campaign.duration_weeks ?? 12} Week
                              </a>
                            )}
                            {stageAvailability[campaign.id].stages.twelveWeekPlan && !stageAvailability[campaign.id].stages.detailedWeekPlans && (
                              <button
                                onClick={(e) => handleExpandToWeekPlans(campaign.id, e)}
                                disabled={expandingCampaignId === campaign.id}
                                className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50"
                              >
                                {expandingCampaignId === campaign.id ? 'Expanding…' : 'Expand to Week Plans'}
                              </button>
                            )}
                            {(stageAvailability[campaign.id].stages.detailedWeekPlans || stageAvailability[campaign.id].stages.dailyPlans) && (
                              <a
                                href={buildPlanningWorkspaceUrl(campaign.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 hover:bg-purple-200"
                              >
                                Weekly & Daily
                              </a>
                            )}
                            {stageAvailability[campaign.id].stages.aiEnrichedWeeks && (
                              <span className="text-xs px-2 py-1 rounded bg-violet-100 text-violet-700">AI Enriched</span>
                            )}
                            {stageAvailability[campaign.id].stages.charting && (
                              <a
                                href={`/campaign-details/${campaign.id}${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-1 rounded bg-teal-100 text-teal-700 hover:bg-teal-200"
                              >
                                Charting
                              </a>
                            )}
                            {stageAvailability[campaign.id].stages.schedule && (
                              <a
                                href={`/campaign-details/${campaign.id}${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ''}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200"
                              >
                                Scheduled
                              </a>
                            )}
                            </>
                        )}
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Progress</span>
                          </div>
                          <CampaignProgress campaignId={campaign.id} companyId={selectedCompanyId} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="space-y-8">
            {/* Analytics Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-600 text-sm font-medium">Total Reach</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">0</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-600">
                    <Eye className="h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
              
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-600 text-sm font-medium">Total Engagement</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">0</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gradient-to-r from-red-500 to-pink-600">
                    <Heart className="h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
              
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-600 text-sm font-medium">Total Clicks</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">0</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600">
                    <ExternalLink className="h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
              
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-600 text-sm font-medium">Total Shares</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">0</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gradient-to-r from-purple-500 to-violet-600">
                    <Share className="h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-6 text-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <BarChart3 className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold">View Analytics</h3>
                </div>
                <p className="text-blue-100 mb-4">Detailed performance metrics and insights</p>
                <button 
                  onClick={() => window.location.href = '/analytics'}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Open Analytics
                </button>
              </div>
              
              <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-6 text-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <TrendingUp className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold">Performance Report</h3>
                </div>
                <p className="text-green-100 mb-4">Generate comprehensive performance reports</p>
                <button 
                  onClick={() => window.location.href = '/analytics'}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Generate Report
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Calendar Tab */}
        {activeTab === 'calendar' && (
          <div className="space-y-6">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Execution Calendar</h2>
                  <p className="text-sm text-gray-600">Switch between daily and weekly campaign activity views.</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-gray-200 p-1 bg-white">
                    <button
                      onClick={() => setCalendarActivityMode('daily')}
                      className={`px-3 py-1 text-xs rounded ${
                        calendarActivityMode === 'daily' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      Daily Activities
                    </button>
                    <button
                      onClick={() => setCalendarActivityMode('weekly')}
                      className={`px-3 py-1 text-xs rounded ${
                        calendarActivityMode === 'weekly' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      Weekly Activities
                    </button>
                  </div>
                  <select
                    value={calendarCampaignFilter}
                    onChange={(e) => setCalendarCampaignFilter(e.target.value)}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700"
                  >
                    <option value="all">All Campaigns</option>
                    {campaigns.map((campaign) => (
                      <option key={`calendar-campaign-${campaign.id}`} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                  {calendarActivityMode === 'weekly' && calendarCampaignFilter !== 'all' && (
                    <select
                      value={calendarWeekFilter}
                      onChange={(e) => setCalendarWeekFilter(e.target.value)}
                      className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700"
                    >
                      <option value="all">All Weeks</option>
                      {Array.from(
                        {
                          length: selectedCalendarCampaign ? getCampaignTotalWeeks(selectedCalendarCampaign) : 1,
                        },
                        (_, idx) => idx + 1
                      ).map((week) => (
                        <option key={`calendar-week-${week}`} value={String(week)}>
                          Week {week}
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    value={calendarStatusFilter}
                    onChange={(e) => setCalendarStatusFilter(e.target.value)}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700"
                  >
                    <option value="all">All Categories</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="on_hold">On Hold</option>
                    <option value="planned">Planned</option>
                    <option value="other">Other</option>
                  </select>
                  <button
                    onClick={() =>
                      setCalendarCurrentDate((prev) => {
                        const next = new Date(prev);
                        if (calendarView === 'week') {
                          next.setDate(prev.getDate() - 7);
                        } else {
                          next.setMonth(prev.getMonth() - 1);
                        }
                        return next;
                      })
                    }
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4 text-gray-600" />
                  </button>
                  <span className="text-sm font-semibold text-gray-800 min-w-[170px] text-center">
                    {calendarView === 'week'
                      ? getWeekLabel(calendarCurrentDate)
                      : calendarCurrentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </span>
                  <button
                    onClick={() =>
                      setCalendarCurrentDate((prev) => {
                        const next = new Date(prev);
                        if (calendarView === 'week') {
                          next.setDate(prev.getDate() + 7);
                        } else {
                          next.setMonth(prev.getMonth() + 1);
                        }
                        return next;
                      })
                    }
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-4 w-4 text-gray-600" />
                  </button>
                  <button
                    onClick={() => {
                      const today = new Date();
                      setCalendarCurrentDate(today);
                      setCalendarSelectedDate(formatDateKey(today));
                    }}
                    className="ml-2 px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
                  >
                    Today
                  </button>
                  <button
                    onClick={() => window.location.href = '/content-calendar'}
                    className="ml-1 px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                  >
                    Open Full Calendar
                  </button>
                  <div className="ml-1 flex items-center rounded-lg border border-gray-200 p-1">
                    <button
                      onClick={() => setCalendarView('month')}
                      className={`px-2 py-1 text-xs rounded ${
                        calendarView === 'month' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      Month
                    </button>
                    <button
                      onClick={() => setCalendarView('week')}
                      className={`px-2 py-1 text-xs rounded ${
                        calendarView === 'week' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      Week
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-2 text-xs font-medium text-gray-500 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="px-2 py-1 text-center">{day}</div>
                ))}
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-2">
                {([
                  'weekly_planning',
                  'daily_cards',
                  'content_created',
                  'content_scheduled',
                  'content_shared',
                  'overdue',
                ] as CalendarExecutionStage[]).map((stage) => {
                  const appearance = getCalendarStageAppearance(stage);
                  return (
                    <span key={`calendar-stage-${stage}`} className={`px-2 py-1 text-xs rounded-full ${appearance.badge}`}>
                      {appearance.label}
                    </span>
                  );
                })}
              </div>

              {calendarView === 'month' ? (
                <div className="grid grid-cols-7 gap-2">
                  {getDaysInMonth(calendarCurrentDate).map((day, idx) => {
                    if (!day) return <div key={`empty-${idx}`} className="h-28 rounded-lg bg-gray-50 border border-gray-100" />;
                    const dateKey = formatDateKey(day);
                    const dayActivities = getCalendarActivitiesForDate(day);
                    const isToday = dateKey === formatDateKey(new Date());
                    const isSelected = calendarSelectedDate === dateKey;
                    return (
                      <button
                        key={dateKey}
                        onClick={() => setCalendarSelectedDate(dateKey)}
                        className={`h-28 text-left p-2 rounded-lg border transition-colors ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                            : isToday
                              ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200'
                              : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="text-xs font-semibold text-gray-800">{day.getDate()}</div>
                        <div className="mt-1 space-y-1">
                          {dayActivities.slice(0, 2).map((activity, index) => {
                            const appearance = getCalendarStageAppearance(activity.stage);
                            return (
                              <div key={`${dateKey}-${activity.campaign.id}-${index}`} className={`text-[11px] px-1.5 py-0.5 rounded truncate ${appearance.badge}`}>
                                {activity.label}
                              </div>
                            );
                          })}
                          {dayActivities.length > 2 && (
                            <div className="text-[11px] text-gray-500">+{dayActivities.length - 2} more</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-2">
                  {getWeekDays(calendarCurrentDate).map((day) => {
                    const dateKey = formatDateKey(day);
                    const dayActivities = getCalendarActivitiesForDate(day);
                    const isToday = dateKey === formatDateKey(new Date());
                    const isSelected = calendarSelectedDate === dateKey;
                    return (
                      <button
                        key={`week-${dateKey}`}
                        onClick={() => setCalendarSelectedDate(dateKey)}
                        className={`h-36 text-left p-2 rounded-lg border transition-colors ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                            : isToday
                              ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200'
                              : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="text-xs font-semibold text-gray-800">
                          {day.toLocaleDateString('en-US', { weekday: 'short' })} {day.getDate()}
                        </div>
                        <div className="mt-1 space-y-1">
                          {dayActivities.slice(0, 4).map((activity, index) => {
                            const appearance = getCalendarStageAppearance(activity.stage);
                            return (
                              <div key={`week-item-${dateKey}-${activity.campaign.id}-${index}`} className={`text-[11px] px-1.5 py-0.5 rounded truncate ${appearance.badge}`}>
                                {activity.label}
                              </div>
                            );
                          })}
                          {dayActivities.length > 4 && (
                            <div className="text-[11px] text-gray-500">+{dayActivities.length - 4} more</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                {calendarSelectedDate
                  ? `${calendarActivityMode === 'weekly' ? 'Weekly activities around' : 'Activities on'} ${parseDateKey(calendarSelectedDate).toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}`
                  : 'Select a day to view activities'}
              </h3>
              {calendarSelectedDate ? (
                (() => {
                  const day = parseDateKey(calendarSelectedDate);
                  const dayActivities = getCalendarActivitiesForDate(day);
                  if (dayActivities.length === 0) {
                    return <p className="text-sm text-gray-600">No campaign activities scheduled for this day.</p>;
                  }
                  return (
                    <div className="space-y-3">
                      {dayActivities.map((activity, index) => {
                        const appearance = getCalendarStageAppearance(activity.stage);
                        return (
                          <div key={`detail-${activity.campaign.id}-${calendarSelectedDate}-${index}`} className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3">
                            <div>
                              <p className="font-medium text-gray-900">{activity.label}</p>
                              <p className="text-xs text-gray-500">
                                {activity.campaign.start_date ? new Date(activity.campaign.start_date).toLocaleDateString() : 'Not scheduled'}
                                {' - '}
                                {activity.campaign.end_date ? new Date(activity.campaign.end_date).toLocaleDateString() : 'Not scheduled'}
                              </p>
                              <span className={`mt-1 inline-flex px-2 py-0.5 rounded text-xs ${appearance.badge}`}>
                                {appearance.label}
                              </span>
                            </div>
                            <button
                              onClick={() => handleViewCampaign(activity.campaign.id)}
                              className="text-sm text-indigo-600 hover:text-indigo-800"
                            >
                              Open Campaign
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              ) : (
                <p className="text-sm text-gray-600">Use the month view above to pick a date.</p>
              )}
            </div>
          </div>
        )}

        {/* Team Tab */}
        {activeTab === 'team' && (
          <div className="space-y-8">
            {/* Team Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-600 text-sm font-medium">Team Members</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">0</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-600">
                    <Users className="h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
              
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-600 text-sm font-medium">Active Members</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">0</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600">
                    <CheckCircle className="h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
              
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-gray-200/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-600 text-sm font-medium">Pending Invites</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">0</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gradient-to-r from-yellow-500 to-orange-600">
                    <Calendar className="h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
            </div>

            {/* Team Members */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
              <div className="p-6 border-b border-gray-200/50">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-gray-900">Team Members</h2>
                  <button 
                    onClick={() => window.location.href = '/team-management'}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2"
                  >
                    <Users className="h-4 w-4" />
                    Manage Team
                  </button>
                </div>
              </div>
              
              <div className="p-6 text-sm text-gray-600">
                Team data is available in Team Management.
              </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <UserPlus className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold">Invite Team Member</h3>
                </div>
                <p className="text-indigo-100 mb-4">Add new team members to collaborate on campaigns</p>
                <button 
                  onClick={() => window.location.href = '/team-management'}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Invite Now
                </button>
              </div>
              
              <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-6 text-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <Settings className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold">Team Settings</h3>
                </div>
                <p className="text-green-100 mb-4">Manage roles, permissions, and team preferences</p>
                <button 
                  onClick={() => window.location.href = '/team-management'}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Manage Settings
                </button>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'integrations' && (
          <div className="space-y-8">
            {leadCaptureToast && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {leadCaptureToast}
              </div>
            )}
            {isCompanyAdmin && (
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    Connect Website Lead Form (Coming Soon)
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    This integration will allow the platform to capture leads generated from your campaigns
                    and attribute them to specific content, channels, and themes.
                  </p>
                </div>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                  Not Connected
                </span>
              </div>
              <div className="space-y-4 text-sm text-gray-700">
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1">What you’ll gain once connected</div>
                  <ul className="list-disc list-inside space-y-1 text-gray-700">
                    <li>Identify which platforms generate qualified leads</li>
                    <li>Track conversions from campaigns to website inquiries</li>
                    <li>Improve AI recommendations using real lead data</li>
                    <li>Measure ROI across channels</li>
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1">Data expected from your website form</div>
                  <ul className="list-disc list-inside space-y-1 text-gray-700">
                    <li>Name</li>
                    <li>Email</li>
                    <li>Company (optional)</li>
                    <li>Message / Inquiry</li>
                    <li>UTM parameters (auto-captured)</li>
                  </ul>
                </div>
                <div className="text-xs text-gray-600">
                  Next step (when enabled): You will be able to paste your form endpoint or install a lightweight
                  tracking snippet.
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Integration Status</div>
                  <div className="font-medium">Not Connected</div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Source</div>
                  <div className="font-medium">Website Form</div>
                </div>
              </div>
              <div className="mt-5">
                <button
                  onClick={() => setLeadCaptureModalOpen(true)}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                >
                  View Setup Details
                </button>
              </div>
            </div>
            )}
          </div>
        )}
      </div>
      {leadCaptureModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-gray-900">
                Website Lead Capture Integration (Coming Soon)
              </h3>
              <button
                onClick={() => setLeadCaptureModalOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="space-y-5 text-sm text-gray-700">
              <div>
                <div className="text-xs font-semibold text-gray-600 mb-1">
                  What this integration will do
                </div>
                <ul className="list-disc list-inside space-y-1">
                  <li>Track inbound leads from website forms</li>
                  <li>Connect leads to campaign source (UTM tracking)</li>
                  <li>Measure platform effectiveness</li>
                  <li>Improve lead conversion intelligence</li>
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-600 mb-1">
                  Information Company Admin should keep ready
                </div>
                <ul className="list-disc list-inside space-y-1">
                  <li>Website domain</li>
                  <li>Form provider (WordPress / Webflow / Custom)</li>
                  <li>Email destination</li>
                  <li>CRM (if any)</li>
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-600 mb-1">
                  Expected Data Once Connected
                </div>
                <ul className="list-disc list-inside space-y-1">
                  <li>Name</li>
                  <li>Email</li>
                  <li>Phone (optional)</li>
                  <li>Landing page URL</li>
                  <li>UTM source/campaign</li>
                </ul>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                onClick={() => {
                  setLeadCaptureToast('Feature will be enabled soon.');
                  setLeadCaptureModalOpen(false);
                }}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
              >
                Notify Me When Available
              </button>
              <button
                onClick={() => setLeadCaptureModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// Campaign Progress Component
const CampaignProgress: React.FC<{ campaignId: string; companyId?: string | null }> = ({
  campaignId,
  companyId,
}) => {
  const [progress, setProgress] = useState<CampaignProgress>({
    percentage: 0,
    contentCount: 0,
    scheduledCount: 0,
    publishedCount: 0
  });
  const [isLoadingProgress, setIsLoadingProgress] = useState(true);

  useEffect(() => {
    const loadProgress = async () => {
      try {
        if (!companyId) {
          console.warn('No company selected yet, skipping campaign progress load');
          setIsLoadingProgress(false);
          return;
        }
        const progressUrl = `/api/campaigns/${campaignId}/progress?companyId=${companyId}`;
        console.log('DASHBOARD_API_CALL', progressUrl);
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const response = await fetch(progressUrl, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        
        if (!response.ok) {
          console.warn(`Failed to load progress for campaign ${campaignId}:`, response.status);
          // Keep default progress values
          setIsLoadingProgress(false);
          return;
        }
        
        const progressData = await response.json();
        
        if (progressData.success && progressData.data && progressData.data.progress) {
          setProgress({
            percentage: progressData.data.progress.percentage || 0,
            contentCount: progressData.data.progress.contentCount || 0,
            scheduledCount: progressData.data.progress.scheduledCount || 0,
            publishedCount: progressData.data.progress.publishedCount || 0
          });
        } else {
          // If API returns unexpected format, keep default values
          console.warn('Unexpected progress data format:', progressData);
        }
      } catch (error) {
        console.error('Error loading campaign progress:', error);
        // Keep default progress values on error
      } finally {
        setIsLoadingProgress(false);
      }
    };

    loadProgress();
  }, [campaignId, companyId]);

  if (isLoadingProgress) {
    return (
      <div className="flex items-center">
        <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
          <div className="bg-gray-400 h-2 rounded-full animate-pulse" style={{ width: '20%' }}></div>
        </div>
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  // Ensure progress is defined and has a percentage property
  const safeProgress = progress || {
    percentage: 0,
    contentCount: 0,
    scheduledCount: 0,
    publishedCount: 0
  };
  
  const percentage = safeProgress.percentage ?? 0;
  
  const progressColor = percentage === 0 
    ? 'bg-gray-400' 
    : percentage < 30 
    ? 'bg-red-500' 
    : percentage < 70 
    ? 'bg-yellow-500' 
    : 'bg-green-500';

  return (
    <div className="flex items-center">
      <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
        <div 
          className={`h-2 rounded-full transition-all duration-300 ${progressColor}`}
          style={{ width: `${Math.max(percentage, 5)}%` }}
        ></div>
      </div>
      <span className="text-sm text-gray-900">{percentage}%</span>
    </div>
  );
};
