/** useDashboardState — composition: core state hook + effects/handlers + the original return. */
import React from 'react';
import { useState, useEffect, useCallback, useRef, startTransition } from 'react';
import { createIdempotentOperation } from '../../lib/idempotency';
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

/**
 * Repurpose progress dots — unique = ●, repurposed = ● ● ○ etc.
 * HARDEN-002: module scope for a stable component identity. It used to be
 * re-created inside the hook on every render, which made React treat every
 * <RepurposeDots> as a NEW component type each render and remount it (state
 * teardown + DOM rebuild) instead of updating in place.
 */
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

import { useDashboardStateCore } from './useDashboardStateCore';

export function useDashboardState() {
  const core = useDashboardStateCore();
  const {
    CAMPAIGN_STAGES, activeTab, activityChatLoading, activityChatMessages, activityMessageCounts, authChecked,
    calendarActivityEvents, calendarActivityEventsLoading, calendarActivityMode, calendarCampaignFilter, calendarCurrentDate,
    calendarFilteredCampaigns, calendarMessageCounts, calendarSelectedDate, calendarStageEvents, calendarStageEventsLoading,
    calendarStageFilter, calendarStageFullHistory, calendarStatusFilter, calendarView, calendarWeekFilter, campaignIds,
    campaignProgress, campaigns, canCreateCampaign, canScheduleContent, chatPanel, chatRefresh, companies, companiesResolved,
    companyFactSnapshot, companyProfileReview, dashboardCacheVersion, dayChatLoading, dayChatMessages, dayDetailPanelDate, error,
    expandingCampaignId, fetchStageEvents, fetchWithAuth, filteredCampaigns, formatDateKey, getCalendarActivitiesForDate,
    getCalendarStageAppearance, getCampaignExecutionStage, getCampaignStatusCategory, getCampaignTotalWeeks, getDaysInMonth,
    getEventStage, getMsgCount, getMsgTotal, getMsgUnread, getPlatformBorderColor, getPlatformColorForCalendar, getUnreadCount,
    getWeekDays, getWeekLabel, hasPermission, intelligenceView, isAdmin, isAuthenticated, isCalendarEventOverdue, isCompanyAdmin,
    isDeletingCampaign, isLoading, isLoadingData, notice, notify, onboardingRedirectRef, parseCalendarDate, parseDateKey,
    pendingDeleteCampaignId, postPreview, router, scheduledCampaignIds, selectedCompanyId, setActiveTab, setActivityChatLoading,
    setActivityChatMessages, setActivityMessageCounts, setCalendarActivityEvents, setCalendarActivityEventsLoading,
    setCalendarActivityMode, setCalendarCampaignFilter, setCalendarCurrentDate, setCalendarMessageCounts,
    setCalendarSelectedDate, setCalendarStageEvents, setCalendarStageEventsLoading, setCalendarStageFilter,
    setCalendarStageFullHistory, setCalendarStatusFilter, setCalendarView, setCalendarWeekFilter, setCampaignProgress,
    setCampaigns, setChatPanel, setChatRefresh, setCompanyFactSnapshot, setCompanyProfileReview, setDayChatLoading,
    setDayChatMessages, setDayDetailPanelDate, setError, setExpandingCampaignId, setIntelligenceView, setIsDeletingCampaign,
    setIsLoadingData, setNotice, setPendingDeleteCampaignId, setPostPreview, setShowCompanyFactReviewPrompt,
    setStageAvailability, setStageFilter, setStats, showCompanyFactReviewPrompt, stageAvailability, stageFilter, stats, user,
    userRole,
  } = core;

  // Moved from the Core half: this mount-loader calls loadDashboardData, which is declared below.
  useEffect(() => {
    console.log('Dashboard component mounted, starting to load data...');
    loadDashboardData();
  }, [selectedCompanyId]);
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
          dashboardCacheVersion.current += 1; // bust private HTTP cache
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
      dashboardCacheVersion.current += 1; // bust private HTTP cache
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
      // OR-07 Action 1: keyed on the post being published. A retry of
      // "publish this post" reuses the key; a different post gets its own.
      const publishOp = createIdempotentOperation(`social-publish-${postId}`);
      const res = await fetchWithAuth('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...publishOp.headers },
        body: JSON.stringify({ post_id: postId }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data?.error || 'Publish failed' };
      if (data.status === 'PUBLISHED') {
        dashboardCacheVersion.current += 1; // bust private HTTP cache
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

  const selectedCalendarCampaign = React.useMemo(
    () => campaigns.find((campaign) => campaign.id === calendarCampaignFilter) || null,
    [campaigns, calendarCampaignFilter]
  );

  useEffect(() => {
    if (!campaignIds) {
      setStageAvailability({});
      return;
    }
    fetchWithAuth(
      `/api/campaigns/stage-availability-batch?campaignIds=${encodeURIComponent(campaignIds)}&_v=${dashboardCacheVersion.current}`
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
      `/api/calendar/activity-events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&companyId=${encodeURIComponent(selectedCompanyId)}${campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : ''}&_v=${dashboardCacheVersion.current}`
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
          // W5-7 (audit B-55): singleton titles (the common case) already
          // carry repurpose_index/total = 1/1 from construction — skip the
          // sort + object-rewrite entirely for them. Multi-entry groups are
          // processed exactly as before.
          if (indices.length === 1) continue;
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
        // W5-7: commit the (large) calendar state as a non-urgent transition
        // so month-flip interactions paint before the grid re-render.
        startTransition(() => setCalendarActivityEvents(byDate));
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
        dashboardCacheVersion.current += 1; // bust private HTTP cache
        const ids = campaignIds.split(',').filter(Boolean);
        const r = await fetchWithAuth(`/api/campaigns/stage-availability-batch?campaignIds=${ids.join(',')}&_v=${dashboardCacheVersion.current}`);
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
      const contentStatsUrl = `/api/campaigns/content-stats?companyId=${selectedCompanyId}&_v=${dashboardCacheVersion.current}`;
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
        dashboardCacheVersion.current += 1; // bust private HTTP cache
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
    calendarStageEventsLoading, calendarStageFullHistory, dayDetailPanelDate, setDayDetailPanelDate,
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
