import React from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, GripVertical } from 'lucide-react';
import PlatformIcon from '../ui/PlatformIcon';
import { getPlatformLabel } from '../../utils/platformIcons';
import type { useDashboardState } from '../hooks/useDashboardState';
import type { CalendarActivity, CalendarExecutionStage } from '../DashboardPage.types';
import type { ActivityEvent } from './PostPreviewModal';
import {
  resolveDisplayContentType,
  resolveDisplayContentTypeLabel,
} from '../../lib/calendar/assetTypeDisplay';

type DashboardState = ReturnType<typeof useDashboardState>;
type CalendarDayItem = CalendarActivity | ActivityEvent;
function isActivityEvent(item: CalendarDayItem): item is ActivityEvent {
  return (item as ActivityEvent).type === 'activity';
}

export default function DashboardCalendarTab({ d }: { d: DashboardState }) {
  const {
    campaigns, calendarActivityMode, setCalendarActivityMode,
    calendarCampaignFilter, setCalendarCampaignFilter,
    calendarStatusFilter, setCalendarStatusFilter,
    calendarCurrentDate, setCalendarCurrentDate,
    calendarSelectedDate, setCalendarSelectedDate,
    calendarView, setCalendarView,
    calendarWeekFilter, setCalendarWeekFilter,
    calendarActivityEvents, calendarActivityEventsLoading,
    calendarStageFilter, setCalendarStageFilter,
    calendarStageEvents, setCalendarStageEvents,
    calendarStageEventsLoading,
    calendarFilteredCampaigns, calendarMessageCounts,
    dayDetailPanelDate, setDayDetailPanelDate,
    draggedActivity, setDraggedActivity, dropTargetDate, setDropTargetDate,
    chatPanel, setChatPanel, activityMessageCounts,
    postPreview, setPostPreview,
    fetchStageEvents, getCalendarStageAppearance, getCampaignTotalWeeks,
    getDaysInMonth, getWeekDays, getWeekLabel,
    getPlatformColorForCalendar, getCalendarActivitiesForDate, getPlatformBorderColor,
    getCalendarDayItems, getEventStage, handleActivityEventClick, handleUploadCreatorAsset, handleRescheduleDrop,
    RepurposeDots, formatDateKey, parseDateKey,
    getMsgTotal, getMsgUnread, selectedCalendarCampaign,
    campaignIds, handleViewCampaign,
  } = d;

  return (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Execution Calendar</h2>
                  <p className="text-sm text-gray-600">Switch between daily and weekly campaign activity views.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                  <span className="text-sm font-semibold text-gray-800 min-w-[120px] sm:min-w-[170px] text-center">
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
                    onClick={() => window.location.href = '/dashboard?tab=calendar'}
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
                  <div key={day} className="px-1 py-1 text-center">{day}</div>
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
                                  <p className="text-xs text-gray-500 capitalize">{ev.platform} · {resolveDisplayContentTypeLabel(ev)} · {ev.date}</p>
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
                <div className="overflow-x-auto">
                <div className="grid grid-cols-7 gap-1 min-w-[420px]">
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
                      <div
                        key={dateKey}
                        role="button"
                        tabIndex={0}
                        onClick={() => { setCalendarSelectedDate(dateKey); setDayDetailPanelDate(dateKey); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setCalendarSelectedDate(dateKey); setDayDetailPanelDate(dateKey); } }}
                        onDragOver={(e) => { e.preventDefault(); setDropTargetDate(dateKey); }}
                        onDragLeave={() => setDropTargetDate((d) => (d === dateKey ? null : d))}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDropTargetDate(null);
                          if (draggedActivity?.scheduled_post_id) handleRescheduleDrop(dateKey);
                        }}
                        className={`h-28 text-left p-2 rounded-lg border transition-colors relative cursor-pointer ${
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
                            className="absolute left-0 top-0 bottom-0 w-2 bg-indigo-500 hover:bg-indigo-600 cursor-pointer rounded-l-lg flex flex-col items-center justify-center gap-0.5"
                            aria-label="Team Chat"
                          >
                            {dayUnread > 0 && (
                              <span className="text-[9px] font-bold text-white leading-none">{dayUnread > 9 ? '9+' : dayUnread}</span>
                            )}
                          </div>
                        )}
                        <div className={hasDayChat && dayCampaignId ? 'pl-4' : ''}>
                          <div className="text-xs font-semibold text-gray-800">{day.getDate()}</div>
                          <div className="mt-1 space-y-1">
                          {dayItems.slice(0, 3).map((item, index) => {
                            if (isActivityEvent(item)) {
                              const isDraggable = !!item.scheduled_post_id;
                              const isOverdue = item.is_overdue && item.status !== 'published';
                              const colorClass = isOverdue ? 'bg-red-100 text-red-800' : getPlatformColorForCalendar(item.platform);
                              const borderColor = isOverdue ? 'border-red-500' : getPlatformBorderColor(item.platform);
                              return (
                                <div
                                  key={`${dateKey}-activity-${item.scheduled_post_id ?? index}`}
                                  draggable={isDraggable}
                                  onDragStart={(e) => { if (isDraggable) { e.stopPropagation(); e.dataTransfer.setData('application/json', JSON.stringify(item)); setDraggedActivity(item); } }}
                                  onDragEnd={() => setDraggedActivity(null)}
                                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleActivityEventClick(item); }}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleActivityEventClick(item); } }}
                                  className={`w-full text-[11px] px-1.5 py-1 rounded flex items-center gap-0.5 cursor-pointer hover:opacity-90 active:scale-95 border-l-4 ${borderColor} ${colorClass}`}
                                  title={`${getPlatformLabel(item.platform)} · ${resolveDisplayContentTypeLabel(item)} · ${item.title}${isOverdue ? ' (overdue)' : ''}`}
                                >
                                  {isOverdue && <span className="text-red-500 font-bold shrink-0">!</span>}
                                  {!isOverdue && isDraggable && <GripVertical className="w-3 h-3 shrink-0 opacity-40" />}
                                  <PlatformIcon platform={item.platform} size={11} />
                                  <span className="font-semibold shrink-0">{getPlatformLabel(item.platform)}</span>
                                  <span className="opacity-50 shrink-0 hidden sm:inline">{resolveDisplayContentTypeLabel(item)}</span>
                                  <span className="truncate flex-1 min-w-0">{item.title}</span>
                                </div>
                              );
                            }
                            const appearance = getCalendarStageAppearance((item as CalendarActivity).stage);
                            return (
                              <div
                                key={`${dateKey}-${(item as CalendarActivity).campaign.id}-${index}`}
                                onClick={(e) => { e.stopPropagation(); setDayDetailPanelDate(dateKey); }}
                                className={`w-full text-[11px] px-1.5 py-1 rounded truncate cursor-pointer hover:opacity-80 ${appearance.badge}`}
                                title={(item as CalendarActivity).label}
                              >
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
                      </div>
                    );
                  })}
                </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                <div className="grid grid-cols-7 gap-1 min-w-[420px]">
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
                            className="absolute left-0 top-0 bottom-0 w-2 bg-indigo-500 hover:bg-indigo-600 cursor-pointer rounded-l-lg flex flex-col items-center justify-center"
                            aria-label="Open team chat"
                          >
                            {getMsgUnread(calendarMessageCounts[dateKey]) > 0 && (
                              <span className="text-[9px] font-bold text-white leading-none">
                                {getMsgUnread(calendarMessageCounts[dateKey]) > 9 ? '9+' : getMsgUnread(calendarMessageCounts[dateKey])}
                              </span>
                            )}
                          </div>
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
                                  {<RepurposeDots index={activity.repurpose_index} total={activity.repurpose_total} contentType={resolveDisplayContentType(activity)} />}
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
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200">
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
                                  <p className="font-medium text-gray-900 truncate capitalize">{resolveDisplayContentTypeLabel(activity)}</p>
                                  <p className="text-sm text-gray-700 truncate">{activity.title}</p>
                                  <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                                    {<RepurposeDots index={activity.repurpose_index} total={activity.repurpose_total} contentType={resolveDisplayContentType(activity)} />}
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
                              {activity.canonical_group === 'pending' ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleUploadCreatorAsset(activity, e); }}
                                  className="ml-2 shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 text-xs font-semibold"
                                  title="Upload the creator asset to schedule this post"
                                >
                                  ⬆ Upload media
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleActivityEventClick(activity); }}
                                  className="ml-2 shrink-0 text-sm text-indigo-600 hover:text-indigo-800"
                                >
                                  Open
                                </button>
                              )}
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
  );
}
