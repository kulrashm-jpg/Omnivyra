import React from 'react';
import ContentRenderer, { CarouselContent, PLATFORM_HIGHLIGHT } from './ContentRenderer';
import { Plus, BarChart3, Calendar, Target, TrendingUp, Play, Edit3, CheckCircle, Eye, MoreHorizontal, Users, Settings, UserPlus, Heart, ExternalLink, Share, Loader2, Trash2, ExternalLink as ExternalLinkIcon, Link2, FileText, ChevronLeft, ChevronRight, MessageSquare, GripVertical, Send, Brain } from 'lucide-react';
import PlatformIcon from './ui/PlatformIcon';
import { getPlatformLabel } from '../utils/platformIcons';
import FloatingChatPanel from './collaboration/FloatingChatPanel';
import DayDetailPanel, { type DayActivity } from './collaboration/DayDetailPanel';
import ReportAutomationActivityFeed from './dashboard/ReportAutomationActivityFeed';
import IntelligenceWorkspace from './dashboard/IntelligenceWorkspace';
import PostPreviewModal, { type ActivityEvent } from './dashboard/PostPreviewModal';
import CampaignProgress from './dashboard/CampaignProgress';
import { DashboardTeamTab, DashboardIntegrationsTab, DashboardAnalyticsTab } from './dashboard/DashboardTeamTab';
import { useDashboardState } from './hooks/useDashboardState';
import type { CalendarActivity, CalendarExecutionStage } from './DashboardPage.types';
import DashboardCalendarTab from './dashboard/DashboardCalendarTab';
import DashboardCampaignsTab from './dashboard/DashboardCampaignsTab';
import DashboardOverviewSection from './dashboard/DashboardOverviewSection';

export default function DashboardPage() {
  const d = useDashboardState();
  const {
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
    getEventStage, fetchStageEvents, getCalendarStageAppearance, getCampaignTotalWeeks,
    getDaysInMonth, getWeekDays, getWeekLabel, calendarFilteredCampaigns,
    getPlatformColorForCalendar, getCalendarActivitiesForDate, getPlatformBorderColor,
    RepurposeDots, handleRescheduleDrop, getCalendarDayItems, handleActivityEventClick,
    handleRescheduleFromModal, handlePublishNow, handleChatSend, handleViewCampaign,
    handleExpandToWeekPlans, loadDashboardData, handleDeleteCampaign, confirmDeleteCampaign,
    getStageLabel, draggedActivity, setDraggedActivity, dropTargetDate, setDropTargetDate,
    selectedCalendarCampaign, openIntelligenceTab, buildPlanningWorkspaceUrl,
    isActivityEvent,
  } = d;

  if (showLoadingSpinner) {
    return <div className="p-6 text-gray-500">Loading company context...</div>;
  }
  if (showCompanySpinner) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <svg className="h-8 w-8 animate-spin text-[#0A66C2]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {showCompanyFactReviewPrompt && isCompanyAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-amber-200 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                  Company Admin Confirmation
                </div>
                <h2 className="mt-3 text-xl font-semibold text-slate-900">
                  Review your company facts
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Reports are using company-fit signals for competitor selection. Please confirm these facts so benchmarking stays aligned to the right peer group.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCompanyFactReviewPrompt(false)}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Close company facts reminder"
              >
                ×
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div>Team size: <span className="font-medium">{companyFactSnapshot?.team_size || 'Missing'}</span></div>
              <div className="mt-1">Founded year: <span className="font-medium">{companyFactSnapshot?.founded_year || 'Missing'}</span></div>
              <div className="mt-1">Revenue range: <span className="font-medium">{companyFactSnapshot?.revenue_range || 'Missing'}</span></div>
              <div className="mt-3 text-xs text-slate-500">
                {companyProfileReview?.next_confirmation_due_at
                  ? `Due since ${new Date(companyProfileReview.next_confirmation_due_at).toLocaleDateString()}.`
                  : 'No admin confirmation recorded yet.'}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCompanyFactReviewPrompt(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Remind me later
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCompanyFactReviewPrompt(false);
                  router.push('/company-profile');
                }}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
              >
                Review now
              </button>
            </div>
          </div>
        </div>
      )}
      {notice && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
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
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Content Manager</h1>
          <p className="text-gray-600 mt-1">Plan, create, and execute your content campaigns</p>
        </div>
      </div>
            
      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex flex-wrap gap-1 bg-white rounded-xl p-1 shadow-sm border border-gray-200">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'campaigns', label: 'Campaigns', icon: Target },
            { id: 'intelligence', label: 'Intelligence', icon: Brain },
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
                  className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors text-gray-600 hover:text-gray-900 hover:bg-gray-100"
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
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-8">
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {[
                {
                  label: 'Total Campaigns',
                  value: stats.totalCampaigns,
                  icon: Target,
                  color: 'bg-indigo-500',
                  onClick: () => setActiveTab('campaigns')
                },
                {
                  label: 'Active Campaigns',
                  value: stats.activeCampaigns,
                  icon: Play,
                  color: 'bg-emerald-500',
                  onClick: () => setActiveTab('campaigns')
                },
                {
                  label: 'Total Content',
                  value: stats.totalContent,
                  icon: Edit3,
                  color: 'bg-violet-500',
                  onClick: () => window.location.href = '/content-creation'
                },
                {
                  label: 'Published',
                  value: stats.publishedContent,
                  icon: CheckCircle,
                  color: 'bg-amber-500',
                  onClick: () => window.location.href = '/analytics'
                }
              ].map((stat, index) => {
                const Icon = stat.icon;
                return (
                  <button 
                    key={index} 
                    onClick={stat.onClick}
                    className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 hover:border-indigo-200 hover:shadow-md transition-all duration-150 text-left w-full cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-gray-600 text-sm font-medium">{stat.label}</p>
                        {isLoadingData ? (
                          <div className="mt-2">
                            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                          </div>
                        ) : (
                          <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">{stat.value}</p>
                        )}
                      </div>
                      <div className={`p-3 rounded-xl ${stat.color}`}>
                        <Icon className="h-6 w-6 text-white" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <ReportAutomationActivityFeed companyId={selectedCompanyId || null} />
            <DashboardOverviewSection d={d} />
          </div>
        )}
        {/* Campaigns Tab */}
        {activeTab === 'campaigns' && <DashboardCampaignsTab d={d} />}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && <DashboardAnalyticsTab />}

        {/* Calendar Tab */}
        {activeTab === 'calendar' && <DashboardCalendarTab d={d} />}

        {/* Team Tab */}
        {activeTab === 'team' && <DashboardTeamTab />}
        {activeTab === 'integrations' && <DashboardIntegrationsTab />}
      </div>
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
        const allDayItems = getCalendarDayItems(parseDateKey(dayDetailPanelDate));
        // Map ActivityEvents fully (so modal has all data); CalendarActivity items shown as planned
        const dayActivities: DayActivity[] = allDayItems.map((item, idx) => {
          if (isActivityEvent(item)) {
            return {
              execution_id: item.execution_id,
              scheduled_post_id: item.scheduled_post_id,
              platform: item.platform,
              title: item.title,
              content_type: item.content_type,
              repurpose_index: item.repurpose_index,
              repurpose_total: item.repurpose_total,
              date: item.date,
              scheduled_for: item.scheduled_for,
              status: item.status,
              is_overdue: item.is_overdue,
              content: item.content,
              campaign_id: item.campaign_id,
              time: item.scheduled_for
                ? new Date(item.scheduled_for).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                : undefined,
            } as DayActivity;
          }
          // CalendarActivity fallback — show as planned entry
          const ca = item as CalendarActivity;
          return {
            platform: '',
            title: ca.label || ca.campaign?.name || 'Planned',
            content_type: ca.stage || 'planned',
            campaign_id: ca.campaign?.id || '',
            date: dayDetailPanelDate,
          } as DayActivity;
        });
        const dayCampaignId = calendarCampaignFilter !== 'all' ? calendarCampaignFilter : (calendarFilteredCampaigns[0]?.id ?? '');
        const dayMsgCount = calendarMessageCounts[dayDetailPanelDate];
        // Build lookup map from scheduled_post_id → full ActivityEvent for modal
        const activityEventMap: Record<string, ActivityEvent> = {};
        allDayItems.filter(isActivityEvent).forEach((a) => {
          if (a.scheduled_post_id) activityEventMap[a.scheduled_post_id] = a;
          if (a.execution_id) activityEventMap[a.execution_id] = a;
        });
        return (
          <DayDetailPanel
            dateKey={dayDetailPanelDate}
            dateLabel={parseDateKey(dayDetailPanelDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            activities={dayActivities}
            messageCount={getMsgTotal(dayMsgCount)}
            unreadCount={getMsgUnread(dayMsgCount)}
            currentUserId={user.userId}
            campaignId={dayCampaignId}
            onClose={() => setDayDetailPanelDate(null)}
            onOpenChat={() => {
              setDayDetailPanelDate(null);
              setChatPanel({ mode: 'day', campaignId: dayCampaignId, date: dayDetailPanelDate });
            }}
            onActivityClick={(act) => {
              // Priority: open PostPreviewModal if we have a full ActivityEvent
              const fullEvt = (act.scheduled_post_id && activityEventMap[act.scheduled_post_id])
                || (act.execution_id && activityEventMap[act.execution_id])
                || null;
              if (fullEvt) {
                setDayDetailPanelDate(null);
                setPostPreview(fullEvt);
              } else if (act.execution_id) {
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
          onPublish={handlePublishNow}
          onReschedule={handleRescheduleFromModal}
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

// CampaignProgress is defined in ./dashboard/CampaignProgress
