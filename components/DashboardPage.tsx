import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import ContentRenderer, { CarouselContent, PLATFORM_HIGHLIGHT } from './ContentRenderer';
import { Plus, BarChart3, Calendar, Target, TrendingUp, Play, Edit3, CheckCircle, Eye, MoreHorizontal, Users, Settings, UserPlus, Heart, ExternalLink, Share, Loader2, Trash2, ExternalLink as ExternalLinkIcon, Link2, FileText, ChevronLeft, ChevronRight, MessageSquare, GripVertical } from 'lucide-react';
import PlatformIcon from './ui/PlatformIcon';
import { getPlatformLabel } from '../utils/platformIcons';
import { useCompanyContext } from './CompanyContext';
import Header from './Header';
import { supabase } from '../utils/supabaseClient';
import { getStageLabelWithDuration } from '../backend/types/CampaignStage';
import { navigateToCampaign, buildResumeUrl, loadCampaignResume } from '../lib/campaignResumeStore';
import FloatingChatPanel, { type CollaborationMessage } from './collaboration/FloatingChatPanel';
import DayDetailPanel, { type DayActivity } from './collaboration/DayDetailPanel';

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

/** Activity-level event from scheduled_posts (dashboard calendar) */
type ActivityEvent = {
  type: 'activity';
  date: string;
  platform: string;
  content?: string | null;
  title: string;
  repurpose_index: number;
  repurpose_total: number;
  campaign_id: string;
  content_type: string;
  execution_id?: string;
  scheduled_post_id?: string;
  status?: string;
  scheduled_for?: string | null;
  is_overdue?: boolean;
};

/** Union for calendar day cells: activity events or campaign-stage fallback */
type CalendarDayItem = CalendarActivity | ActivityEvent;

function isActivityEvent(item: CalendarDayItem): item is ActivityEvent {
  return (item as ActivityEvent).type === 'activity';
}

export default function DashboardPage() {
  const router = useRouter();
  const { selectedCompanyId, isAdmin, isLoading, hasPermission, userRole, user } = useCompanyContext();
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
  const [calendarActivityEvents, setCalendarActivityEvents] = useState<Record<string, ActivityEvent[]>>({});
  const [postPreview, setPostPreview] = useState<ActivityEvent | null>(null);
  const [calendarActivityEventsLoading, setCalendarActivityEventsLoading] = useState(false);
  const [calendarStageFilter, setCalendarStageFilter] = useState<CalendarExecutionStage | null>(null);
  const [calendarStageEvents, setCalendarStageEvents] = useState<ActivityEvent[]>([]);
  const [calendarStageEventsLoading, setCalendarStageEventsLoading] = useState(false);
  const [dayDetailPanelDate, setDayDetailPanelDate] = useState<string | null>(null);
  const [chatPanel, setChatPanel] = useState<{ mode: 'activity' | 'day'; activityId?: string; campaignId: string; date?: string } | null>(null);
  type MessageCount = { total: number; unread: number };
  const [activityMessageCounts, setActivityMessageCounts] = useState<Record<string, MessageCount>>({});
  const [calendarMessageCounts, setCalendarMessageCounts] = useState<Record<string, MessageCount>>({});
  const getMsgCount = (c: MessageCount | undefined) => (c ? c.total : 0);
  const getUnreadCount = (c: MessageCount | undefined) => (c ? c.unread : 0);
  const [dayChatMessages, setDayChatMessages] = useState<CollaborationMessage[]>([]);
  const [dayChatLoading, setDayChatLoading] = useState(false);
  const [dayDetailMessages, setDayDetailMessages] = useState<CollaborationMessage[]>([]);
  const [dayDetailMessagesLoading, setDayDetailMessagesLoading] = useState(false);
  const [activityChatMessages, setActivityChatMessages] = useState<CollaborationMessage[]>([]);
  const [activityChatLoading, setActivityChatLoading] = useState(false);
  const [chatRefresh, setChatRefresh] = useState(0);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [pendingDeleteCampaignId, setPendingDeleteCampaignId] = useState<string | null>(null);
  const [isDeletingCampaign, setIsDeletingCampaign] = useState(false);
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

  /** Normalize message count (APIs return { total, unread }) */
  const getMsgTotal = (c: { total: number; unread: number } | undefined) => c?.total ?? 0;
  const getMsgUnread = (c: { total: number; unread: number } | undefined) => c?.unread ?? 0;

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
  /** Maps a scheduled_post's status + overdue flag to one of the legend stages. */
  const getEventStage = (ev: ActivityEvent): CalendarExecutionStage => {
    if (ev.is_overdue) return 'overdue';
    const s = ev.status || 'scheduled';
    if (s === 'published') return 'content_shared';
    if (s === 'publishing') return 'content_shared';
    if (s === 'draft') return 'content_created';
    return 'content_scheduled'; // scheduled
  };

  /** Fetch all posts for a given stage (no date bounds) and populate the stage list panel. */
  const fetchStageEvents = (stage: CalendarExecutionStage) => {
    if (!selectedCompanyId) return;
    setCalendarStageFilter(stage);
    setCalendarStageEventsLoading(true);
    const campaignId = calendarCampaignFilter !== 'all' ? calendarCampaignFilter : undefined;
    fetchWithAuth(
      `/api/calendar/activity-events?start=2020-01-01&end=2099-12-31&companyId=${encodeURIComponent(selectedCompanyId)}&stageFilter=1${campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : ''}`
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((data: any[]) => {
        const all: ActivityEvent[] = (Array.isArray(data) ? data : []).map((ev: any) => ({
          type: 'activity' as const,
          date: ev.date || '',
          platform: ev.platform,
          title: ev.title,
          repurpose_index: ev.repurpose_index ?? 1,
          repurpose_total: ev.repurpose_total ?? 1,
          campaign_id: ev.campaign_id,
          content_type: ev.content_type || 'post',
          execution_id: ev.execution_id,
          scheduled_post_id: ev.scheduled_post_id,
          status: ev.status,
          scheduled_for: ev.scheduled_for,
          is_overdue: ev.is_overdue,
          content: ev.content || null,
        }));
        setCalendarStageEvents(all.filter((ev) => getEventStage(ev) === stage));
      })
      .catch(() => setCalendarStageEvents([]))
      .finally(() => setCalendarStageEventsLoading(false));
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
  const getPlatformColorForCalendar = (platform: string): string => {
    const p = (platform || '').toLowerCase();
    const map: Record<string, string> = {
      linkedin: 'bg-blue-100 text-blue-700 border-blue-200',
      facebook: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      instagram: 'bg-pink-100 text-pink-700 border-pink-200',
      youtube: 'bg-red-100 text-red-700 border-red-200',
      twitter: 'bg-gray-900 text-gray-100 border-gray-700',
      x: 'bg-gray-900 text-gray-100 border-gray-700',
    };
    return map[p] || 'bg-gray-100 text-gray-700 border-gray-200';
  };
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

  /** Feature 4: Platform color strip (left border 4px) */
  const getPlatformBorderColor = (platform: string): string => {
    const p = (platform || '').toLowerCase();
    if (p === 'linkedin') return 'border-l-blue-500';
    if (p === 'instagram') return 'border-l-pink-500';
    if (p === 'youtube') return 'border-l-red-500';
    if (p === 'twitter' || p === 'x') return 'border-l-gray-900';
    if (p === 'facebook') return 'border-l-indigo-500';
    return 'border-l-gray-400';
  };

  /** Repurpose progress dots — unique = ●, repurposed = ● ● ○ etc. */
  const RepurposeDots = ({ index, total, contentType }: { index: number; total: number; contentType?: string }) => {
    const safeTotal = total < 1 ? 1 : total;
    const safeIndex = index < 1 ? 1 : index;
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-indigo-600" aria-label={safeTotal === 1 ? 'Unique' : `Repurpose ${safeIndex} of ${safeTotal}`}>
        {Array.from({ length: safeTotal }, (_, i) => (
          <span key={i} className={i < safeIndex ? 'text-indigo-600' : 'text-gray-300'}>
            {i < safeIndex ? '●' : '○'}
          </span>
        ))}
        {contentType && <span className="text-gray-400 font-normal ml-0.5">{contentType}</span>}
      </span>
    );
  };

  const [draggedActivity, setDraggedActivity] = useState<ActivityEvent | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);

  const handleRescheduleDrop = useCallback(
    async (newDate: string) => {
      if (!draggedActivity?.scheduled_post_id || !selectedCompanyId) return;
      try {
        const res = await fetchWithAuth('/api/schedule/reschedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduled_post_id: draggedActivity.scheduled_post_id,
            new_date: newDate,
            companyId: selectedCompanyId,
          }),
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setCalendarActivityEvents((prev) => {
            const oldDate = draggedActivity.date;
            if (!oldDate) return prev;
            const next = { ...prev };
            const oldList = next[oldDate] || [];
            const newList = oldList.filter((a) => isActivityEvent(a) && a.scheduled_post_id !== draggedActivity.scheduled_post_id);
            if (newList.length === 0) delete next[oldDate];
            else next[oldDate] = newList;
            const targetList = next[newDate] || [];
            const updated = { ...draggedActivity, date: newDate };
            next[newDate] = [...targetList.filter((a) => !(isActivityEvent(a) && a.scheduled_post_id === draggedActivity.scheduled_post_id)), updated];
            return next;
          });
          notify('success', 'Post rescheduled');
        } else {
          notify('error', data?.error || 'Failed to reschedule');
        }
      } catch {
        notify('error', 'Failed to reschedule');
      } finally {
        setDraggedActivity(null);
        setDropTargetDate(null);
      }
    },
    [draggedActivity, selectedCompanyId, notify]
  );

  /** Items for a calendar day: activity events when available, else campaign-stage fallback */
  const getCalendarDayItems = (date: Date): CalendarDayItem[] => {
    const dateKey = formatDateKey(date);
    const events = calendarActivityEvents[dateKey];
    if (events && events.length > 0) {
      const filtered =
        calendarCampaignFilter === 'all'
          ? events
          : events.filter((e) => e.campaign_id === calendarCampaignFilter);
      return filtered;
    }
    return getCalendarActivitiesForDate(date);
  };

  const handleActivityEventClick = (evt: ActivityEvent, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setPostPreview(evt);
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

  useEffect(() => {
    if (activeTab !== 'calendar' || !selectedCompanyId) return;
    const year = calendarCurrentDate.getFullYear();
    const month = calendarCurrentDate.getMonth();
    const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    setCalendarActivityEventsLoading(true);
    const campaignId = calendarCampaignFilter !== 'all' ? calendarCampaignFilter : undefined;
    fetchWithAuth(
      `/api/calendar/activity-events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&companyId=${encodeURIComponent(selectedCompanyId)}${campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : ''}`
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        // Build flat list first (repurpose index computed campaign-wide below)
        const allItems: ActivityEvent[] = [];
        list.forEach((ev: any) => {
          const d = ev.date || '';
          if (!d) return;
          allItems.push({ type: 'activity', date: d, platform: ev.platform, title: ev.title, repurpose_index: 1, repurpose_total: 1, campaign_id: ev.campaign_id, content_type: ev.content_type || 'post', execution_id: ev.execution_id, scheduled_post_id: ev.scheduled_post_id, status: ev.status, scheduled_for: ev.scheduled_for, is_overdue: ev.is_overdue, content: ev.content || null });
        });
        // Recompute repurpose_index/total campaign-wide: group by title across ALL dates,
        // sort chronologically — total = how many times topic appears in campaign.
        const titleGroups = new Map<string, number[]>();
        allItems.forEach((item, i) => {
          const key = (item.title ?? '').trim();
          if (!key) return;
          const g = titleGroups.get(key) ?? [];
          // Same topic can only appear once per platform — skip duplicates
          const plat = (item.platform ?? '').toLowerCase().trim();
          if (plat && g.some((idx) => (allItems[idx].platform ?? '').toLowerCase().trim() === plat)) return;
          g.push(i);
          titleGroups.set(key, g);
        });
        for (const indices of titleGroups.values()) {
          // null/empty date sorts last so real scheduled posts always get lower indices
          const sorted = [...indices].sort((a, b) => {
            const dA = allItems[a].date || '9999-99-99';
            const dB = allItems[b].date || '9999-99-99';
            return dA.localeCompare(dB);
          });
          const total = sorted.length;
          sorted.forEach((idx, rank) => {
            allItems[idx] = { ...allItems[idx], repurpose_index: rank + 1, repurpose_total: total };
          });
        }
        // Re-bucket into byDate for calendar rendering
        const byDate: Record<string, ActivityEvent[]> = {};
        allItems.forEach((item) => {
          if (!byDate[item.date]) byDate[item.date] = [];
          byDate[item.date].push(item);
        });
        setCalendarActivityEvents(byDate);
      })
      .catch(() => setCalendarActivityEvents({}))
      .finally(() => setCalendarActivityEventsLoading(false));
  }, [activeTab, selectedCompanyId, calendarCurrentDate, calendarCampaignFilter]);

  // Calendar message counts for vertical markers
  useEffect(() => {
    if (activeTab !== 'calendar' || !campaignIds || !calendarCurrentDate) return;
    const year = calendarCurrentDate.getFullYear();
    const month = calendarCurrentDate.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const dates: string[] = [];
    for (let d = 1; d <= lastDay; d++) {
      dates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    const ids = campaignIds.split(',').filter(Boolean);
    const authId = calendarCampaignFilter !== 'all' ? calendarCampaignFilter : ids[0];
    if (!authId) return;
    const url = `/api/calendar/message-counts?campaignIds=${encodeURIComponent(campaignIds)}&dates=${encodeURIComponent(dates.join(','))}`;
    fetchWithAuth(url)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => setCalendarMessageCounts(typeof data === 'object' && data !== null ? data as Record<string, any> : {}))
      .catch(() => setCalendarMessageCounts({}));
  }, [activeTab, campaignIds, calendarCurrentDate, calendarCampaignFilter]);

  // Activity message counts for comment indicators
  useEffect(() => {
    if (activeTab !== 'calendar' || !calendarSelectedDate) return;
    const day = parseDateKey(calendarSelectedDate);
    const items = getCalendarDayItems(day);
    const acts = items.filter((i): i is ActivityEvent => isActivityEvent(i) && !!i.execution_id);
    if (acts.length === 0) {
      setActivityMessageCounts({});
      return;
    }
    const byCampaign: Record<string, string[]> = {};
    acts.forEach((a) => {
      const cid = a.campaign_id;
      if (!byCampaign[cid]) byCampaign[cid] = [];
      if (a.execution_id && !byCampaign[cid].includes(a.execution_id)) byCampaign[cid].push(a.execution_id);
    });
    const merged: Record<string, { total: number; unread: number }> = {};
    Promise.all(
      Object.entries(byCampaign).map(([cid, aids]) =>
        fetchWithAuth(`/api/activity/message-counts?campaignId=${encodeURIComponent(cid)}&activityIds=${encodeURIComponent(aids.join(','))}`)
          .then((r) => (r.ok ? r.json() : {}))
          .then((data) => {
            if (typeof data === 'object') Object.assign(merged, data);
          })
      )
    ).then(() => setActivityMessageCounts({ ...merged }));
  }, [activeTab, calendarSelectedDate, calendarActivityEvents, calendarCampaignFilter]);

  // Load messages when chat panel opens
  useEffect(() => {
    if (!chatPanel?.campaignId) return;
    if (chatPanel.mode === 'day' && chatPanel.date) {
      setDayChatLoading(true);
      setDayChatMessages([]);
      fetchWithAuth(`/api/calendar/messages?campaignId=${encodeURIComponent(chatPanel.campaignId)}&date=${encodeURIComponent(chatPanel.date)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setDayChatMessages(Array.isArray(data) ? data : []))
        .catch(() => setDayChatMessages([]))
        .finally(() => setDayChatLoading(false));
    } else if (chatPanel.mode === 'activity' && chatPanel.activityId) {
      setActivityChatLoading(true);
      setActivityChatMessages([]);
      fetchWithAuth(`/api/activity/messages?activityId=${encodeURIComponent(chatPanel.activityId)}&campaignId=${encodeURIComponent(chatPanel.campaignId)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setActivityChatMessages(Array.isArray(data) ? data : []))
        .catch(() => setActivityChatMessages([]))
        .finally(() => setActivityChatLoading(false));
    }
  }, [chatPanel?.mode, chatPanel?.campaignId, chatPanel?.date, chatPanel?.activityId, chatRefresh]);

  useEffect(() => {
    if (!dayDetailPanelDate) {
      setDayDetailMessages([]);
      return;
    }
    const cid = calendarCampaignFilter !== 'all' ? calendarCampaignFilter : (calendarFilteredCampaigns[0]?.id ?? '');
    if (!cid) return;
    setDayDetailMessagesLoading(true);
    fetchWithAuth(`/api/calendar/messages?campaignId=${encodeURIComponent(cid)}&date=${encodeURIComponent(dayDetailPanelDate)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setDayDetailMessages(Array.isArray(data) ? data : []))
      .catch(() => setDayDetailMessages([]))
      .finally(() => setDayDetailMessagesLoading(false));
  }, [dayDetailPanelDate, calendarCampaignFilter, calendarFilteredCampaigns]);

  const handleDayDetailSend = async (text: string) => {
    if (!dayDetailPanelDate) return;
    const cid = calendarCampaignFilter !== 'all' ? calendarCampaignFilter : (calendarFilteredCampaigns[0]?.id ?? '');
    if (!cid) return;
    const res = await fetchWithAuth('/api/calendar/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId: cid, date: dayDetailPanelDate, message_text: text }),
    });
    if (res.ok) {
      const msg = await res.json();
      setDayDetailMessages((prev) => [...prev, msg]);
      setCalendarMessageCounts((c) => ({
        ...c,
        [dayDetailPanelDate]: { total: getMsgTotal(c[dayDetailPanelDate]) + 1, unread: getMsgUnread(c[dayDetailPanelDate]) },
      }));
    }
  };

  const handleChatSend = async (text: string) => {
    if (!chatPanel?.campaignId) return;
    if (chatPanel.mode === 'day' && chatPanel.date) {
      const res = await fetchWithAuth('/api/calendar/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: chatPanel.campaignId, date: chatPanel.date, message_text: text }),
      });
      if (res.ok) {
        const msg = await res.json();
        setDayChatMessages((prev) => [...prev, msg]);
        setChatRefresh((c) => c + 1);
      }
    } else if (chatPanel.mode === 'activity' && chatPanel.activityId) {
      const res = await fetchWithAuth('/api/activity/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: chatPanel.activityId, campaignId: chatPanel.campaignId, message_text: text }),
      });
      if (res.ok) {
        const msg = await res.json();
        setActivityChatMessages((prev) => [...prev, msg]);
        setChatRefresh((c) => c + 1);
      }
    }
  };

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

  const confirmDeleteCampaign = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!pendingDeleteCampaignId) return;
    if (!selectedCompanyId) {
      notify('error', 'Please select a company before deleting campaigns.');
      setPendingDeleteCampaignId(null);
      return;
    }
    const campaignIdToDelete = pendingDeleteCampaignId;
    setIsDeletingCampaign(true);
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
      notify('error', `Error deleting campaign: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDeletingCampaign(false);
      setPendingDeleteCampaignId(null);
    }
  };

  const handleViewCampaign = (campaignId: string) => {
    navigateToCampaign(campaignId, selectedCompanyId);
  };

  const buildPlanningWorkspaceUrl = (campaignId: string) => {
    const saved = loadCampaignResume(campaignId);
    if (saved) return buildResumeUrl(saved, selectedCompanyId);
    const params = new URLSearchParams();
    if (selectedCompanyId) params.set('companyId', selectedCompanyId);
    const qs = params.toString();
    return `/campaign-details/${campaignId}${qs ? `?${qs}` : ''}`;
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
                onClick={() => window.location.href = '/campaign-planner?mode=direct'}
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
                      onClick={() => window.location.href = '/campaign-planner?mode=direct'}
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
                              <button type="button" onClick={(e) => { e.stopPropagation(); setPendingDeleteCampaignId(null); }} className="px-3 py-1.5 rounded border border-amber-300 bg-white hover:bg-amber-100">Cancel</button>
                              <button type="button" onClick={(e) => { e.stopPropagation(); confirmDeleteCampaign(e); }} disabled={isDeletingCampaign} className="px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed">{(isDeletingCampaign ? 'Deleting…' : 'Delete')}</button>
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
            <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-6 items-stretch">
              <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white flex flex-col h-full min-h-[200px]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <Users className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">Company Profile</h3>
                </div>
                <p className="text-indigo-100 mb-4 flex-1">
                  Start here to define your company intelligence profile
                </p>
                <button
                  onClick={() => window.location.href = '/company-profile'}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Open Profile
                </button>
              </div>
              <div className="bg-gradient-to-br from-slate-500 to-gray-700 rounded-2xl p-6 text-white flex flex-col h-full min-h-[200px]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <Settings className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">External APIs</h3>
                </div>
                <p className="text-gray-100 mb-4 flex-1">
                  Configure external sources for trend signals
                </p>
                <button
                  onClick={() =>
                    window.location.href =
                      userRole === 'SUPER_ADMIN' ? '/external-apis?mode=platform' : '/external-apis'
                  }
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Manage APIs
                </button>
              </div>
              <div className="bg-gradient-to-br from-slate-600 to-slate-800 rounded-2xl p-6 text-white flex flex-col h-full min-h-[200px]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <Settings className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">Social Platform Settings</h3>
                </div>
                <p className="text-slate-100 mb-4 flex-1">
                  Define publishing rules per platform
                </p>
                <button
                  onClick={() => window.location.href = '/social-platforms'}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Configure Platforms
                </button>
              </div>
              <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-6 text-white flex flex-col h-full min-h-[200px]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <TrendingUp className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">Recommendations</h3>
                </div>
                <p className="text-emerald-100 mb-4 flex-1 leading-relaxed">
                  Generate trend-based campaign recommendations
                </p>
                <button
                  onClick={() => window.location.href = '/recommendations'}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  View Recommendations
                </button>
              </div>
              <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-6 text-white flex flex-col h-full min-h-[200px]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <Calendar className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">Schedule Content</h3>
                </div>
                <p className="text-green-100 mb-4 flex-1">Plan and schedule your content calendar</p>
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
                onClick={() => window.location.href = '/campaign-planner?mode=direct'}
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
                    onClick={() => window.location.href = '/campaign-planner?mode=direct'}
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
                              <button type="button" onClick={(e) => { e.stopPropagation(); setPendingDeleteCampaignId(null); }} className="px-3 py-1.5 rounded border border-amber-300 bg-white hover:bg-amber-100">Cancel</button>
                              <button type="button" onClick={(e) => { e.stopPropagation(); confirmDeleteCampaign(e); }} disabled={isDeletingCampaign} className="px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed">{(isDeletingCampaign ? 'Deleting…' : 'Delete')}</button>
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

              {/* Legend — clickable to view all activities in that stage */}
              {(() => {
                const allMonthEvents = Object.values(calendarActivityEvents).flat();
                const stageCounts: Partial<Record<CalendarExecutionStage, number>> = {};
                allMonthEvents.forEach((ev) => {
                  const s = getEventStage(ev);
                  stageCounts[s] = (stageCounts[s] ?? 0) + 1;
                });
                const clickableStages: CalendarExecutionStage[] = ['content_created', 'content_scheduled', 'content_shared', 'overdue'];
                return (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {(['weekly_planning', 'daily_cards', 'content_created', 'content_scheduled', 'content_shared', 'overdue'] as CalendarExecutionStage[]).map((stage) => {
                      const appearance = getCalendarStageAppearance(stage);
                      const count = stageCounts[stage] ?? 0;
                      const isActive = calendarStageFilter === stage;
                      const isClickable = clickableStages.includes(stage);
                      if (!isClickable) {
                        return (
                          <span key={stage} className={`px-2 py-1 text-xs rounded-full ${appearance.badge}`}>
                            {appearance.label}
                          </span>
                        );
                      }
                      return (
                        <button
                          key={stage}
                          type="button"
                          onClick={() => {
                            if (calendarStageFilter === stage) {
                              setCalendarStageFilter(null);
                              setCalendarStageEvents([]);
                            } else {
                              fetchStageEvents(stage);
                            }
                          }}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-all ${appearance.badge} ${isActive ? 'ring-2 ring-offset-1 ring-gray-400' : 'opacity-80 hover:opacity-100'}`}
                        >
                          {appearance.label}
                          {count > 0 && (
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/30 text-[10px] font-bold">
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {calendarStageFilter && (
                      <button
                        type="button"
                        onClick={() => { setCalendarStageFilter(null); setCalendarStageEvents([]); }}
                        className="px-2 py-1 text-xs rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100"
                      >
                        ✕ Clear filter
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Stage list panel — shown when a legend tab is active */}
              {calendarStageFilter && (() => {
                const appearance = getCalendarStageAppearance(calendarStageFilter);
                return (
                  <div className="mb-4 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <div className={`px-4 py-2 flex items-center justify-between ${appearance.badge}`}>
                      <span className="font-semibold text-sm">{appearance.label} — All Activities</span>
                      {calendarStageEventsLoading && <span className="text-xs opacity-75">Loading…</span>}
                      {!calendarStageEventsLoading && <span className="text-xs opacity-75">{calendarStageEvents.length} item{calendarStageEvents.length !== 1 ? 's' : ''}</span>}
                    </div>
                    {calendarStageEventsLoading ? (
                      <div className="px-4 py-6 text-sm text-gray-500 text-center">Loading activities…</div>
                    ) : calendarStageEvents.length === 0 ? (
                      <div className="px-4 py-6 text-sm text-gray-500 text-center">No activities in this stage.</div>
                    ) : (
                      <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                        {calendarStageEvents.map((ev, i) => {
                          const colorClass = getPlatformColorForCalendar(ev.platform);
                          return (
                            <div
                              key={`stage-ev-${i}`}
                              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 cursor-pointer"
                              onClick={() => ev.execution_id && setChatPanel({ mode: 'activity', activityId: ev.execution_id, campaignId: ev.campaign_id, date: ev.date })}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className={`p-1.5 rounded-lg shrink-0 ${colorClass}`}>
                                  <PlatformIcon platform={ev.platform} size={16} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-gray-900 truncate">{ev.title}</p>
                                  <p className="text-xs text-gray-500 capitalize">{ev.platform} · {ev.content_type} · {ev.date}</p>
                                </div>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleActivityEventClick(ev); }}
                                className="ml-3 shrink-0 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                              >
                                Open
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {calendarView === 'month' ? (
                <div className="grid grid-cols-7 gap-2">
                  {getDaysInMonth(calendarCurrentDate).map((day, idx) => {
                    if (!day) return <div key={`empty-${idx}`} className="h-28 rounded-lg bg-gray-50 border border-gray-100" />;
                    const dateKey = formatDateKey(day);
                    const dayItems = getCalendarDayItems(day);
                    const isToday = dateKey === formatDateKey(new Date());
                    const isSelected = calendarSelectedDate === dateKey;
                    const dayCampaignId = calendarCampaignFilter !== 'all' ? calendarCampaignFilter : (calendarFilteredCampaigns[0]?.id ?? '');
                    const dayCount = calendarMessageCounts[dateKey];
                    const hasDayChat = getMsgTotal(dayCount) > 0;
                    const dayUnread = getMsgUnread(dayCount);
                    return (
                      <button
                        key={dateKey}
                        onClick={() => { setCalendarSelectedDate(dateKey); setDayDetailPanelDate(dateKey); }}
                        onDragOver={(e) => { e.preventDefault(); setDropTargetDate(dateKey); }}
                        onDragLeave={() => setDropTargetDate((d) => (d === dateKey ? null : d))}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDropTargetDate(null);
                          if (draggedActivity?.scheduled_post_id) handleRescheduleDrop(dateKey);
                        }}
                        className={`h-28 text-left p-2 rounded-lg border transition-colors relative ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                            : dropTargetDate === dateKey
                              ? 'border-indigo-400 bg-indigo-50/50 ring-2 ring-indigo-200'
                              : isToday
                                ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200'
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        {hasDayChat && dayCampaignId && (
                          <div
                            onClick={(e) => { e.stopPropagation(); setChatPanel({ mode: 'day', campaignId: dayCampaignId, date: dateKey }); }}
                            className="absolute left-1 top-2 bottom-2 w-3 flex items-center justify-center text-indigo-600 hover:text-indigo-800 cursor-pointer border-l-2 border-indigo-400 rounded"
                            title="Team Chat"
                          >
                            <span className="text-[10px] font-bold">{dayUnread > 0 ? dayUnread : '|'}</span>
                          </div>
                        )}
                        <div className={hasDayChat && dayCampaignId ? 'pl-4' : ''}>
                          <div className="text-xs font-semibold text-gray-800">{day.getDate()}</div>
                          <div className="mt-1 space-y-1">
                          {dayItems.slice(0, 3).map((item, index) => {
                            if (isActivityEvent(item)) {
                              const colorClass = getPlatformColorForCalendar(item.platform);
                              const borderColor = getPlatformBorderColor(item.platform);
                              const isDraggable = !!item.scheduled_post_id;
                              return (
                                <div
                                  key={`${dateKey}-activity-${item.scheduled_post_id ?? index}`}
                                  draggable={isDraggable}
                                  onDragStart={(e) => { if (isDraggable) { e.stopPropagation(); e.dataTransfer.setData('application/json', JSON.stringify(item)); setDraggedActivity(item); } }}
                                  onDragEnd={() => setDraggedActivity(null)}
                                  onClick={(e) => { e.stopPropagation(); handleActivityEventClick(item); }}
                                  className={`text-[11px] px-1.5 py-0.5 rounded truncate inline-flex items-center gap-0.5 cursor-pointer hover:opacity-90 border-l-4 ${borderColor} ${colorClass}`}
                                >
                                  {isDraggable && <GripVertical className="w-3 h-3 shrink-0 opacity-50" />}
                                  <PlatformIcon platform={item.platform} size={10} />
                                  <span>{getPlatformLabel(item.platform)} — {item.title}</span>
                                  {<RepurposeDots index={item.repurpose_index} total={item.repurpose_total} contentType={item.content_type} />}
                                </div>
                              );
                            }
                            const appearance = getCalendarStageAppearance((item as CalendarActivity).stage);
                            return (
                              <div key={`${dateKey}-${(item as CalendarActivity).campaign.id}-${index}`} className={`text-[11px] px-1.5 py-0.5 rounded truncate ${appearance.badge}`}>
                                {(item as CalendarActivity).label}
                              </div>
                            );
                          })}
                          {dayItems.length > 3 && (
                            <div
                              className="text-[11px] text-indigo-600 hover:underline cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); setDayDetailPanelDate(dateKey); }}
                            >
                              +{dayItems.length - 3} more
                            </div>
                          )}
                        </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-2">
                  {getWeekDays(calendarCurrentDate).map((day) => {
                    const dateKey = formatDateKey(day);
                    const dayActivities = getCalendarDayItems(day);
                    const isToday = dateKey === formatDateKey(new Date());
                    const isSelected = calendarSelectedDate === dateKey;
                    return (
                      <button
                        key={`week-${dateKey}`}
                        onClick={() => setCalendarSelectedDate(dateKey)}
                        onDragOver={(e) => { e.preventDefault(); setDropTargetDate(dateKey); }}
                        onDragLeave={() => setDropTargetDate((d) => (d === dateKey ? null : d))}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDropTargetDate(null);
                          if (draggedActivity?.scheduled_post_id) handleRescheduleDrop(dateKey);
                        }}
                        className={`h-36 text-left p-2 rounded-lg border transition-colors relative ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                            : dropTargetDate === dateKey
                              ? 'border-indigo-400 bg-indigo-50/50 ring-2 ring-indigo-200'
                              : isToday
                                ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200'
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        {getMsgTotal(calendarMessageCounts[dateKey]) > 0 && (
                          <div
                            onClick={(e) => { e.stopPropagation(); setChatPanel({ mode: 'day', campaignId: calendarCampaignFilter !== 'all' ? calendarCampaignFilter : (campaignIds.split(',')[0] || ''), date: dateKey }); }}
                            className="absolute left-1 top-1 bottom-1 w-0.5 bg-indigo-500 rounded hover:bg-indigo-600 cursor-pointer"
                            title="Team Chat"
                            aria-label="Open team chat"
                          />
                        )}
                        <div className="text-xs font-semibold text-gray-800">
                          {day.toLocaleDateString('en-US', { weekday: 'short' })} {day.getDate()}
                        </div>
                        <div className="mt-1 space-y-1">
                          {dayActivities.slice(0, 4).map((activity, index) => {
                            if (isActivityEvent(activity)) {
                              const colorClass = getPlatformColorForCalendar(activity.platform);
                              return (
                                <div key={`week-${dateKey}-act-${index}`} className={`text-[11px] px-1.5 py-0.5 rounded truncate inline-flex items-center gap-0.5 ${colorClass}`}>
                                  <PlatformIcon platform={activity.platform} size={10} />
                                  <span className="ml-0.5 truncate">{getPlatformLabel(activity.platform)} — {activity.title}</span>
                                  {<RepurposeDots index={activity.repurpose_index} total={activity.repurpose_total} contentType={activity.content_type} />}
                                </div>
                              );
                            }
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
                  const dayActivities = getCalendarDayItems(day);
                  if (dayActivities.length === 0) {
                    return <p className="text-sm text-gray-600">No campaign activities scheduled for this day.</p>;
                  }
                  return (
                    <div className="space-y-3">
                      {dayActivities.map((activity, index) => {
                        if (isActivityEvent(activity)) {
                          const colorClass = getPlatformColorForCalendar(activity.platform);
                          const msgCount = activity.execution_id ? activityMessageCounts[activity.execution_id] : undefined;
                          const msgTotal = getMsgTotal(msgCount);
                          const msgUnread = getMsgUnread(msgCount);
                          const dayCampaignId = calendarCampaignFilter !== 'all' ? calendarCampaignFilter : (calendarFilteredCampaigns[0]?.id ?? '');
                          return (
                            <div
                              key={`detail-act-${calendarSelectedDate}-${index}`}
                              className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3 cursor-pointer hover:bg-gray-50"
                              onClick={(e) => {
                                if (activity.execution_id && (e.target as HTMLElement).closest('button')) return;
                                if (activity.execution_id) setChatPanel({ mode: 'activity', activityId: activity.execution_id, campaignId: activity.campaign_id, date: activity.date });
                              }}
                            >
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className={`p-2 rounded-lg shrink-0 ${colorClass}`}>
                                  <PlatformIcon platform={activity.platform} size={20} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-gray-900 truncate capitalize">{activity.content_type}</p>
                                  <p className="text-sm text-gray-700 truncate">{activity.title}</p>
                                  <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                                    {<RepurposeDots index={activity.repurpose_index} total={activity.repurpose_total} contentType={activity.content_type} />}
                                    {activity.date && <span>{activity.date}</span>}
                                  </div>
                                </div>
                                {msgTotal > 0 && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setChatPanel({ mode: 'activity', activityId: activity.execution_id!, campaignId: activity.campaign_id, date: activity.date }); }}
                                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-medium"
                                    title="Activity Discussion"
                                  >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    {msgTotal}{msgUnread > 0 ? ` • ${msgUnread} new` : ''}
                                  </button>
                                )}
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleActivityEventClick(activity); }}
                                className="ml-2 shrink-0 text-sm text-indigo-600 hover:text-indigo-800"
                              >
                                Open
                              </button>
                            </div>
                          );
                        }
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
      {chatPanel && user?.userId && (
        <FloatingChatPanel
          title={chatPanel.mode === 'day' && chatPanel.date
            ? `Team Chat — ${parseDateKey(chatPanel.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
            : 'Activity Discussion'}
          messages={chatPanel.mode === 'day' ? dayChatMessages : activityChatMessages}
          loading={chatPanel.mode === 'day' ? dayChatLoading : activityChatLoading}
          currentUserId={user.userId}
          onSend={handleChatSend}
          onClose={() => setChatPanel(null)}
          inputPlaceholder="Write message..."
        />
      )}
      {dayDetailPanelDate && user?.userId && (() => {
        const dayActivities: DayActivity[] = getCalendarDayItems(parseDateKey(dayDetailPanelDate))
          .filter((i): i is ActivityEvent => isActivityEvent(i))
          .map((a) => ({
            execution_id: a.execution_id,
            scheduled_post_id: a.scheduled_post_id,
            platform: a.platform,
            title: a.title,
            content_type: a.content_type,
            repurpose_index: a.repurpose_index,
            repurpose_total: a.repurpose_total,
            date: a.date,
            time: undefined,
            campaign_id: a.campaign_id,
          }));
        return (
          <DayDetailPanel
            dateKey={dayDetailPanelDate}
            dateLabel={parseDateKey(dayDetailPanelDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            activities={dayActivities}
            messages={dayDetailMessages}
            loadingMessages={dayDetailMessagesLoading}
            currentUserId={user.userId}
            campaignId={calendarCampaignFilter !== 'all' ? calendarCampaignFilter : (calendarFilteredCampaigns[0]?.id ?? '')}
            onClose={() => setDayDetailPanelDate(null)}
            onSendMessage={handleDayDetailSend}
            onActivityClick={(act) => {
              if (act.execution_id) {
                router.push(`/activity-workspace?campaignId=${encodeURIComponent(act.campaign_id)}&executionId=${encodeURIComponent(act.execution_id)}`);
              }
            }}
        />
        );
      })()}

      {/* Post Preview Modal */}
      {postPreview && (
        <PostPreviewModal
          event={postPreview}
          onClose={() => setPostPreview(null)}
          onOpenWorkspace={(evt) => {
            setPostPreview(null);
            if (evt.execution_id) {
              router.push(`/activity-workspace?campaignId=${encodeURIComponent(evt.campaign_id)}&executionId=${encodeURIComponent(evt.execution_id)}`);
            } else {
              router.push(`/campaign-calendar/${encodeURIComponent(evt.campaign_id)}${evt.date ? `?date=${encodeURIComponent(evt.date)}` : ''}`);
            }
          }}
        />
      )}
    </div>
  );
}


// ─── Platform config ────────────────────────────────────────────────────────

const PLATFORM_CONFIG: Record<string, {
  headerBg: string;         // Tailwind classes for modal header bar
  avatarBg: string;         // Avatar background
  cardBg: string;           // Post card background
  highlightCls: string;     // #hashtag/@mention colour
  linkCls: string;          // Link colour
  engagements: string[];    // Engagement action labels
  charLimit?: number;       // Optional character limit hint
  fontCls: string;          // Body font treatment
}> = {
  linkedin: {
    headerBg: 'bg-[#0A66C2] text-white',
    avatarBg: 'bg-[#0A66C2]',
    cardBg: 'bg-white',
    highlightCls: 'text-[#0A66C2] font-medium',
    linkCls: 'text-[#0A66C2]',
    engagements: ['👍 Like', '💬 Comment', '↩ Repost', '✉ Send'],
    fontCls: 'font-sans',
  },
  x: {
    headerBg: 'bg-black text-white',
    avatarBg: 'bg-black',
    cardBg: 'bg-white',
    highlightCls: 'text-sky-500 font-medium',
    linkCls: 'text-sky-500',
    engagements: ['💬 Reply', '🔁 Repost', '❤ Like', '🔖 Bookmark'],
    charLimit: 280,
    fontCls: 'font-sans text-[15px]',
  },
  twitter: {
    headerBg: 'bg-black text-white',
    avatarBg: 'bg-black',
    cardBg: 'bg-white',
    highlightCls: 'text-sky-500 font-medium',
    linkCls: 'text-sky-500',
    engagements: ['💬 Reply', '🔁 Repost', '❤ Like', '🔖 Bookmark'],
    charLimit: 280,
    fontCls: 'font-sans text-[15px]',
  },
  instagram: {
    headerBg: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 text-white',
    avatarBg: 'bg-gradient-to-br from-purple-500 to-orange-400',
    cardBg: 'bg-white',
    highlightCls: 'text-blue-600 font-medium',
    linkCls: 'text-blue-600',
    engagements: ['❤ Like', '💬 Comment', '📤 Share', '🔖 Save'],
    fontCls: 'font-sans',
  },
  facebook: {
    headerBg: 'bg-[#1877F2] text-white',
    avatarBg: 'bg-[#1877F2]',
    cardBg: 'bg-white',
    highlightCls: 'text-[#1877F2] font-medium',
    linkCls: 'text-[#1877F2]',
    engagements: ['👍 Like', '💬 Comment', '↩ Share'],
    fontCls: 'font-sans',
  },
  youtube: {
    headerBg: 'bg-[#FF0000] text-white',
    avatarBg: 'bg-[#FF0000]',
    cardBg: 'bg-[#F9F9F9]',
    highlightCls: 'text-blue-600 font-medium',
    linkCls: 'text-blue-600',
    engagements: ['👍 Like', '👎 Dislike', '↩ Share', '💾 Save'],
    fontCls: 'font-sans text-[13px]',
  },
  tiktok: {
    headerBg: 'bg-black text-white',
    avatarBg: 'bg-black',
    cardBg: 'bg-black',
    highlightCls: 'text-[#FE2C55] font-medium',
    linkCls: 'text-[#FE2C55]',
    engagements: ['❤ Like', '💬 Comment', '↩ Share'],
    fontCls: 'font-sans text-white',
  },
  pinterest: {
    headerBg: 'bg-[#E60023] text-white',
    avatarBg: 'bg-[#E60023]',
    cardBg: 'bg-white',
    highlightCls: 'text-[#E60023] font-medium',
    linkCls: 'text-[#E60023]',
    engagements: ['❤ Save', '💬 Comment', '↩ Send'],
    fontCls: 'font-sans',
  },
};

const DEFAULT_PLATFORM_CONFIG: typeof PLATFORM_CONFIG[string] = {
  headerBg: 'bg-indigo-600 text-white',
  avatarBg: 'bg-indigo-600',
  cardBg: 'bg-gray-50',
  highlightCls: 'text-indigo-600 font-medium',
  linkCls: 'text-indigo-600',
  engagements: ['❤ Like', '💬 Comment', '↩ Share'],
  fontCls: 'font-sans',
};


// ─── Post Preview Modal ──────────────────────────────────────────────────────

function PostPreviewModal({
  event,
  onClose,
  onOpenWorkspace,
}: {
  event: ActivityEvent;
  onClose: () => void;
  onOpenWorkspace: (evt: ActivityEvent) => void;
}) {
  const platform = (event.platform || '').toLowerCase().trim();
  const contentType = (event.content_type || 'post').toLowerCase().replace(/[\s-]/g, '_');
  const cfg = PLATFORM_CONFIG[platform] ?? DEFAULT_PLATFORM_CONFIG;

  const content = event.content?.trim() || null;
  const platformLabel = platform === 'x' ? 'X (Twitter)' : platform.charAt(0).toUpperCase() + platform.slice(1);
  const scheduledDate = event.scheduled_for
    ? new Date(event.scheduled_for).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : event.date || '';

  const isInstagram = platform === 'instagram';
  const isTikTok = platform === 'tiktok';
  const isYouTube = platform === 'youtube';
  const isVisualMedia = ['reel', 'short', 'video', 'story', 'image'].includes(contentType);
  const isLinkedInArticle = platform === 'linkedin' && contentType === 'article';
  const cardBg = isLinkedInArticle ? 'bg-gray-50' : cfg.cardBg;
  const showCharCount = cfg.charLimit != null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header bar ── */}
        <div className={`flex items-center justify-between px-4 py-3 shrink-0 ${cfg.headerBg}`}>
          <div className="flex items-center gap-2">
            <PlatformIcon platform={platform} size={18} />
            <span className="font-semibold text-sm">{platformLabel} Preview</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/20 capitalize">
              {event.content_type?.replace(/_/g, ' ') || 'post'}
            </span>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-lg leading-none">✕</button>
        </div>

        {/* ── Post card (scrollable) ── */}
        <div className={`flex-1 overflow-y-auto ${cardBg}`}>
          <div className="p-4">

            {/* Profile row */}
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 ${cfg.avatarBg}`}>
                <PlatformIcon platform={platform} size={20} />
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${isTikTok ? 'text-white' : 'text-gray-900'}`}>Your Brand</p>
                <p className={`text-xs ${isTikTok ? 'text-gray-400' : 'text-gray-500'}`}>
                  {scheduledDate ? `Scheduled · ${scheduledDate}` : 'Scheduled post'}
                </p>
              </div>
            </div>

            {/* LinkedIn Article banner */}
            {isLinkedInArticle && (
              <div className="mb-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-lg px-3 py-2">
                <p className="text-[11px] text-blue-600 font-medium uppercase tracking-wide mb-0.5">Article</p>
                <p className="text-base font-bold text-gray-900 leading-snug">{event.title}</p>
              </div>
            )}

            {/* Title (non-article) */}
            {!isLinkedInArticle && (
              <p className={`text-sm font-semibold mb-2 ${isTikTok ? 'text-white' : 'text-gray-900'}`}>{event.title}</p>
            )}

            {/* ── Content body — routed through ContentRenderer ── */}
            <ContentRenderer
              content={content ?? ''}
              platform={platform}
              contentType={contentType}
              accentBg={cfg.avatarBg}
              showCharCount={showCharCount}
              emptyText="Content not yet generated — open in workspace to generate."
              className={cfg.fontCls}
            />

            {/* Visual media placeholder (Instagram / TikTok / Reels / Stories) */}
            {(isInstagram || isTikTok || isVisualMedia) && (
              <div className={`mt-3 w-full rounded-xl flex items-center justify-center ${
                isTikTok
                  ? 'aspect-[9/16] max-h-48 bg-gray-900 border border-gray-700'
                  : isInstagram && contentType === 'story'
                    ? 'aspect-[9/16] max-h-48 bg-gradient-to-br from-purple-100 to-orange-100'
                    : 'aspect-square max-h-40 bg-gradient-to-br from-purple-100 via-pink-100 to-orange-100'
              }`}>
                <div className="text-center opacity-50">
                  <PlatformIcon platform={platform} size={28} />
                  <p className={`text-xs mt-1 ${isTikTok ? 'text-gray-400' : 'text-gray-500'}`}>
                    {contentType === 'reel' || contentType === 'short' ? 'Video / Reel'
                      : contentType === 'story' ? 'Story'
                      : contentType === 'video' ? 'Video'
                      : 'Image / Media'}
                  </p>
                </div>
              </div>
            )}

            {/* YouTube thumbnail placeholder */}
            {isYouTube && (
              <div className="mt-3 w-full aspect-video bg-gray-800 rounded-xl flex items-center justify-center">
                <div className="text-center opacity-50">
                  <PlatformIcon platform="youtube" size={36} />
                  <p className="text-xs text-gray-400 mt-1">Video Thumbnail</p>
                </div>
              </div>
            )}

            {/* ── Engagement row ── */}
            <div className={`mt-4 pt-3 border-t flex items-center gap-4 text-xs ${
              isTikTok ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-400'
            }`}>
              {cfg.engagements.map((label, i) => (
                <span key={i} className="flex items-center gap-1 select-none">{label}</span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-white shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
            {event.repurpose_total > 1 && (
              <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                Repurpose {event.repurpose_index}/{event.repurpose_total}
              </span>
            )}
            {event.status && (
              <span className={`px-2 py-0.5 rounded-full capitalize ${
                event.status === 'published' ? 'bg-emerald-100 text-emerald-700'
                  : event.status === 'scheduled' ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {event.status}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100"
            >
              Close
            </button>
            <button
              onClick={() => onOpenWorkspace(event)}
              className="px-4 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in Workspace
            </button>
          </div>
        </div>
      </div>
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

