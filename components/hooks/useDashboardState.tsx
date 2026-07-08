import React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../CompanyContext';
import { getAuthToken } from '../../utils/getAuthToken';
import { apiFetch } from '../../lib/apiFetch';
import { isActivityOverdue } from '../../lib/shared/statusOverlay';
import { getStageLabelWithDuration } from '../../lib/shared/CampaignStage';
import { navigateToCampaign, buildResumeUrl, loadCampaignResume } from '../../lib/campaignResumeStore';
import type { CollaborationMessage } from '../collaboration/FloatingChatPanel';
import type { ActivityEvent } from '../dashboard/PostPreviewModal';
import type { IntelligenceWorkspaceView } from '../dashboard/IntelligenceWorkspace';
import {
  type Campaign,
  type CampaignProgressData,
  type DashboardStats,
  type CompanyProfileReview,
  type CompanyFactSnapshot,
  type CalendarActivity,
  type CalendarExecutionStage,
} from '../DashboardPage.types';

/** Union for calendar day cells */
type CalendarDayItem = CalendarActivity | ActivityEvent;
function isActivityEvent(item: CalendarDayItem): item is ActivityEvent {
  return (item as ActivityEvent).type === 'activity';
}

export function useDashboardState() {
  const router = useRouter();
  const { selectedCompanyId, isAdmin, isLoading, authChecked, isAuthenticated, companies, companiesResolved, hasPermission, userRole, user } = useCompanyContext();

  // ── Redirect to onboarding when authenticated but not yet assigned to a company ──
  // Phase: Tenant Onboarding Stabilization. Gate the redirect on
  // `companiesResolved` to prevent the race where `isLoading` flips back to
  // false on auth-flow page transitions before `refreshCompanies` has actually
  // queried the server. Without this gate, a tenant user navigating from
  // (e.g.) /onboarding/company → /dashboard could be ping-ponged back to
  // /onboarding/company because `companies=[]` is the initial state, not the
  // resolved state.
  const onboardingRedirectRef = useRef(false);
  useEffect(() => {
    if (isLoading || !authChecked || !isAuthenticated) return;
    if (!companiesResolved) return; // wait for the server-confirmed result
    if (companies.length > 0) return; // has company — nothing to do
    if (onboardingRedirectRef.current) return;
    onboardingRedirectRef.current = true;

    // Ask the server which onboarding step is next (phone, company setup, etc.)
    getAuthToken().then(async (token) => {
      if (!token) { router.replace('/login'); return; }
      try {
        const res = await apiFetch('/api/auth/post-login-route');
        if (res.ok) {
          const { route } = await res.json() as { route: string };
          router.replace(route ?? '/onboarding/company');
        } else {
          router.replace('/onboarding/company');
        }
      } catch {
        router.replace('/onboarding/company');
      }
    });
  }, [isLoading, authChecked, isAuthenticated, companiesResolved, companies.length, router]);
  const canCreateCampaign = hasPermission('CREATE_CAMPAIGN');
  const canScheduleContent = hasPermission('SCHEDULE_CONTENT');
  const [activeTab, setActiveTab] = useState(() => {
    // Allow deep-linking to a specific tab via ?tab=calendar etc.
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p === 'calendar' || p === 'campaigns' || p === 'team' || p === 'analytics') return p;
    }
    return 'overview';
  });
  const [intelligenceView, setIntelligenceView] = useState<IntelligenceWorkspaceView>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('intelTab');
      if (p === 'market-pulse') return p;
      if (p === 'intelligence') return 'market-pulse';
    }
    return 'market-pulse';
  });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalCampaigns: 0,
    activeCampaigns: 0,
    totalContent: 0,
    publishedContent: 0
  });
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaignProgress, setCampaignProgress] = useState<{[key: string]: CampaignProgressData}>({});

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
  const [activityChatMessages, setActivityChatMessages] = useState<CollaborationMessage[]>([]);
  const [activityChatLoading, setActivityChatLoading] = useState(false);
  const [chatRefresh, setChatRefresh] = useState(0);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [pendingDeleteCampaignId, setPendingDeleteCampaignId] = useState<string | null>(null);
  const [isDeletingCampaign, setIsDeletingCampaign] = useState(false);
  const [companyProfileReview, setCompanyProfileReview] = useState<CompanyProfileReview | null>(null);
  const [companyFactSnapshot, setCompanyFactSnapshot] = useState<CompanyFactSnapshot | null>(null);
  const [showCompanyFactReviewPrompt, setShowCompanyFactReviewPrompt] = useState(false);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });
  const isCompanyAdmin = (userRole || '').toString() === 'COMPANY_ADMIN';

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!selectedCompanyId || !isCompanyAdmin) {
      setCompanyProfileReview(null);
      setCompanyFactSnapshot(null);
      setShowCompanyFactReviewPrompt(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const response = await fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(selectedCompanyId)}&includeCompleteness=0`);
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        setCompanyProfileReview((data?.company_profile_review ?? null) as CompanyProfileReview | null);
        setCompanyFactSnapshot((data?.profile?.report_settings?.company_facts ?? null) as CompanyFactSnapshot | null);
        setShowCompanyFactReviewPrompt(Boolean(data?.company_profile_review?.pending_confirmation));
      } catch {
        // ignore reminder load failures on dashboard
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, isCompanyAdmin]);

  const CAMPAIGN_STAGES = [
    { id: 'all', label: 'All' },
    { id: 'planning', label: 'Planning' },
    { id: 'week_plan', label: 'Week Plan' },
    { id: 'daily_plan', label: 'Daily Plan' },
    { id: 'schedule', label: 'Schedule' },
  ] as const;
  const filteredCampaigns = stageFilter === 'all'
    ? campaigns
    : campaigns.filter((c) => {
        const stage = c.current_stage || c.status;
        if (stageFilter === 'week_plan') return stage === 'week_plan' || stage === 'campaign_week_plan';
        return stage === stageFilter;
      });

  const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
    // Delegate to canonical apiFetch wrapper. apiFetch only accepts string
    // URLs, so coerce Request objects to their .url. All call sites in this
    // file pass plain strings.
    const url = typeof input === 'string' ? input : input.url;
    return apiFetch(url, init);
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
  /** Overdue is a calendar-date fact: only past scheduled items should be red. */
  // PHASE STATUS-OVERLAY-PARITY — overdue rule lives in the single shared
  // authority so Dashboard, Calendar, and Workspace agree. Behavior identical.
  const isCalendarEventOverdue = (ev: ActivityEvent): boolean =>
    isActivityOverdue({
      status: ev.status,
      date: ev.date,
      scheduledFor: ev.scheduled_for,
      isOverdue: ev.is_overdue,
    });

  /** Maps a scheduled_post's status + overdue flag to one of the legend stages. */
  const getEventStage = (ev: ActivityEvent): CalendarExecutionStage => {
    if (isCalendarEventOverdue(ev)) return 'overdue';
    const canonicalGroup = String(ev.canonical_group || '').trim().toLowerCase();
    if (canonicalGroup === 'published') return 'content_shared';
    if (canonicalGroup === 'scheduled') return 'content_scheduled';
    if (canonicalGroup === 'ready' || canonicalGroup === 'draft' || canonicalGroup === 'pending') return 'content_created';

    const s = String(ev.status || 'scheduled').trim().toLowerCase();
    if (s === 'published' || s === 'publishing') return 'content_shared';
    if (s === 'draft' || s === 'pending') return 'content_created';
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
          media_urls: Array.isArray(ev.media_urls) ? ev.media_urls : [],
          media_types: Array.isArray(ev.media_types) ? ev.media_types : [],
          // ── Creator visibility (additive) — without these the tiles
          //    can't show status / AI-vs-creator and the drawer brief is dead.
          asset_type: ev.asset_type,
          pending: ev.pending,
          daily_plan_id: ev.daily_plan_id,
          cta: ev.cta,
          canonical_state: ev.canonical_state,
          canonical_badge: ev.canonical_badge,
          canonical_label: ev.canonical_label,
          canonical_group: ev.canonical_group,
          theme_treatment: ev.theme_treatment,
          creator_guidance: ev.creator_guidance,
          marketing_package: ev.marketing_package,
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
      linkedin:  'bg-blue-100 text-blue-700 border-blue-200',
      facebook:  'bg-indigo-100 text-indigo-700 border-indigo-200',
      instagram: 'bg-pink-100 text-pink-700 border-pink-200',
      youtube:   'bg-red-100 text-red-700 border-red-200',
      twitter:   'bg-gray-900 text-gray-100 border-gray-700',
      x:         'bg-gray-900 text-gray-100 border-gray-700',
      tiktok:    'bg-black text-white border-gray-800',
      pinterest: 'bg-rose-100 text-rose-700 border-rose-200',
    };
    return map[p] || 'bg-gray-100 text-gray-700 border-gray-200';
  };
  // A campaign that already has scheduled content on the calendar must NOT also
  // render a bare "campaign name" marker on its EMPTY days (e.g. a start date
  // whose first post lands on a later best-day) — that reads as a placeholder
  // "with nothing in it". Markers are kept only for campaigns with no scheduled
  // events yet, so the calendar still surfaces those.
  const scheduledCampaignIds = React.useMemo(() => {
    const ids = new Set<string>();
    Object.values(calendarActivityEvents).forEach((evs) => {
      (evs || []).forEach((e) => { if (e.campaign_id) ids.add(String(e.campaign_id)); });
    });
    return ids;
  }, [calendarActivityEvents]);

  const getCalendarActivitiesForDate = (date: Date): CalendarActivity[] => {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const activities: CalendarActivity[] = [];
    calendarFilteredCampaigns.forEach((campaign) => {
      // Scheduled campaigns surface via their real posts, not a bare marker.
      if (scheduledCampaignIds.has(String((campaign as { id?: unknown }).id ?? ''))) return;
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
    if (p === 'linkedin')            return 'border-l-blue-500';
    if (p === 'instagram')           return 'border-l-pink-500';
    if (p === 'youtube')             return 'border-l-red-500';
    if (p === 'twitter' || p === 'x') return 'border-l-gray-900';
    if (p === 'facebook')            return 'border-l-indigo-500';
    if (p === 'tiktok')              return 'border-l-black';
    if (p === 'pinterest')           return 'border-l-rose-500';
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
    setPostPreview({ ...evt, is_overdue: isCalendarEventOverdue(evt) });
  };

  /**
   * Creator unification: a WAITING_FOR_ASSET (video/reel/short) card's
   * "Upload media" action deep-links into the activity workspace — the
   * existing upload UI + endpoints there flip the row to SCHEDULED
   * (post-upload auto-schedule) and it returns to the calendar as scheduled.
   * No creator-specific scheduling view; the calendar stays the single
   * surface and just hands off to the upload step.
   */
  const handleUploadCreatorAsset = (evt: ActivityEvent, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!evt.campaign_id || !evt.execution_id) {
      // Fall back to the campaign calendar if we can't address the row.
      if (evt.campaign_id) router.push(`/campaign-calendar/${encodeURIComponent(evt.campaign_id)}`);
      return;
    }
    router.push(`/activity-workspace?campaignId=${encodeURIComponent(evt.campaign_id)}&executionId=${encodeURIComponent(evt.execution_id)}&mode=activity`);
  };

  const handleRescheduleFromModal = async (postId: string, newDate: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetchWithAuth('/api/schedule/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_post_id: postId, new_date: newDate, companyId: selectedCompanyId }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: data?.error || 'Reschedule failed' };
      // Update local calendar state
      setCalendarActivityEvents((prev) => {
        const next = { ...prev };
        // Remove from old date
        for (const [dk, evts] of Object.entries(next)) {
          const filtered = evts.filter((a) => a.scheduled_post_id !== postId);
          if (filtered.length !== evts.length) {
            if (filtered.length === 0) delete next[dk];
            else next[dk] = filtered;
          }
        }
        // Add to new date with updated date field
        const existing = next[newDate] || [];
        const updated = { ...(postPreview as ActivityEvent), date: newDate, scheduled_for: newDate + 'T09:00:00Z' };
        next[newDate] = [...existing.filter((a) => a.scheduled_post_id !== postId), updated];
        return next;
      });
      setPostPreview((p) => p ? { ...p, date: newDate, scheduled_for: newDate + 'T09:00:00Z' } : p);
      notify('success', 'Post rescheduled');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error' };
    }
  };

  const handlePublishNow = async (postId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetchWithAuth('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data?.error || 'Publish failed' };
      if (data.status === 'PUBLISHED') {
        // Refresh calendar events so the cell updates to published
        setCalendarActivityEvents({});
        setCalendarActivityEventsLoading(true);
        return { success: true };
      }
      return { success: false, error: data?.message || 'Publish failed' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error' };
    }
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
    if ((activeTab !== 'calendar' && activeTab !== 'overview') || !selectedCompanyId) return;
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
          allItems.push({ type: 'activity', date: d, platform: ev.platform, title: ev.title, repurpose_index: 1, repurpose_total: 1, campaign_id: ev.campaign_id, content_type: ev.content_type || 'post', execution_id: ev.execution_id, scheduled_post_id: ev.scheduled_post_id, status: ev.status, scheduled_for: ev.scheduled_for, is_overdue: ev.is_overdue, content: ev.content || null, media_urls: Array.isArray(ev.media_urls) ? ev.media_urls : [], media_types: Array.isArray(ev.media_types) ? ev.media_types : [], asset_type: ev.asset_type, pending: ev.pending, daily_plan_id: ev.daily_plan_id, cta: ev.cta, canonical_state: ev.canonical_state, canonical_badge: ev.canonical_badge, canonical_label: ev.canonical_label, canonical_group: ev.canonical_group, theme_treatment: ev.theme_treatment, creator_guidance: ev.creator_guidance, marketing_package: ev.marketing_package });
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
      
      // Fetch campaigns and content stats in parallel
      const campaignsUrl = `/api/campaigns?companyId=${selectedCompanyId}`;
      const contentStatsUrl = `/api/campaigns/content-stats?companyId=${selectedCompanyId}`;
      console.log('DASHBOARD_API_CALL', campaignsUrl);
      const [campaignsResponse, contentStatsResponse] = await Promise.all([
        fetchWithAuth(campaignsUrl),
        fetchWithAuth(contentStatsUrl).catch(() => null),
      ]);
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
          const raw = await campaignsResponse.text();
          const errorData = raw && raw.trim()[0] === '{' ? JSON.parse(raw) : null;
          if (errorData?.error) errorMessage = errorData.error;
          if (errorData?.details) errorDetails = errorData.details;
        } catch {
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

        let totalContent = 0;
        let publishedContent = 0;
        if (contentStatsResponse?.ok) {
          const contentStats = await contentStatsResponse.json().catch(() => ({}));
          totalContent = Number(contentStats.total ?? 0);
          publishedContent = Number(contentStats.published ?? 0);
        }

        console.log('Updating stats state...');
        setStats({
          totalCampaigns,
          activeCampaigns,
          totalContent,
          publishedContent,
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
      const token = await getAuthToken();
      if (!token) {
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
      week_plan: 'from-indigo-500 to-purple-600',
      campaign_week_plan: 'from-indigo-500 to-purple-600', // legacy
      daily_plan: 'from-amber-500 to-orange-600',
      schedule: 'from-green-500 to-emerald-600',
      active: 'from-green-500 to-emerald-600',
      completed: 'from-purple-500 to-violet-600',
    };
    return stageMap[stage] ?? 'from-gray-500 to-slate-600';
  };

  const getStageLabel = (stage: string, durationWeeks?: number | null) =>
    getStageLabelWithDuration(stage, durationWeeks);

  const openIntelligenceTab = useCallback((view: IntelligenceWorkspaceView = 'market-pulse') => {
    if (view === 'active-leads') {
      void router.push('/command-center/active-leads');
      return;
    }
    setIntelligenceView(view);
    const params = new URLSearchParams();
    if (selectedCompanyId) params.set('companyId', selectedCompanyId);
    params.set('intelTab', view);
    void router.push(`/dashboard/intelligence?${params.toString()}`);
  }, [router, selectedCompanyId]);

  // Status flags for early returns (component handles rendering)
  const showLoadingSpinner = isLoading;
  const showCompanySpinner = !isLoading && !selectedCompanyId;


  return {
    showLoadingSpinner, showCompanySpinner,
    router, selectedCompanyId, isAdmin, isLoading, authChecked, isAuthenticated, companies, hasPermission, userRole, user,
    canCreateCampaign, canScheduleContent, activeTab, setActiveTab, intelligenceView, setIntelligenceView,
    campaigns, stats, isLoadingData, error, setError, campaignProgress, stageFilter, setStageFilter,
    stageAvailability, CAMPAIGN_STAGES, filteredCampaigns, fetchWithAuth,
    calendarCurrentDate, setCalendarCurrentDate, calendarSelectedDate, setCalendarSelectedDate,
    calendarView, setCalendarView, calendarActivityMode, setCalendarActivityMode,
    calendarCampaignFilter, setCalendarCampaignFilter, calendarStatusFilter, setCalendarStatusFilter,
    calendarWeekFilter, setCalendarWeekFilter, calendarActivityEvents,
    postPreview, setPostPreview, calendarActivityEventsLoading,
    calendarStageFilter, setCalendarStageFilter, calendarStageEvents, setCalendarStageEvents,
    calendarStageEventsLoading, dayDetailPanelDate, setDayDetailPanelDate,
    chatPanel, setChatPanel, activityMessageCounts, calendarMessageCounts,
    getMsgTotal, getMsgUnread, dayChatMessages, dayChatLoading, activityChatMessages, activityChatLoading,
    notice, pendingDeleteCampaignId, setPendingDeleteCampaignId, isDeletingCampaign,
    companyProfileReview, companyFactSnapshot, showCompanyFactReviewPrompt, setShowCompanyFactReviewPrompt,
    isCompanyAdmin, campaignIds, expandingCampaignId, formatDateKey, parseDateKey,
    getEventStage, isCalendarEventOverdue, fetchStageEvents, getCalendarStageAppearance, getCampaignTotalWeeks,
    getDaysInMonth, getWeekDays, getWeekLabel, calendarFilteredCampaigns,
    getPlatformColorForCalendar, getCalendarActivitiesForDate, getPlatformBorderColor,
    RepurposeDots, handleRescheduleDrop, getCalendarDayItems, handleActivityEventClick,
    handleUploadCreatorAsset,
    handleRescheduleFromModal, handlePublishNow, handleChatSend, handleViewCampaign,
    handleExpandToWeekPlans, loadDashboardData, handleDeleteCampaign, confirmDeleteCampaign,
    getStageLabel, draggedActivity, setDraggedActivity, dropTargetDate, setDropTargetDate,
    selectedCalendarCampaign, openIntelligenceTab, buildPlanningWorkspaceUrl,
    isActivityEvent,
  };
}
