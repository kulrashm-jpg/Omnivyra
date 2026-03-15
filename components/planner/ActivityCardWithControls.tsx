/**
 * Activity Card with Hover Controls
 * Shows Edit, Regenerate, Move, Delete on hover.
 * Icons only: ✏ Edit, 🔄 Regenerate, ↔ Move, 🗑 Delete
 */

import React, { useState, useEffect } from 'react';
import { Pencil, RotateCw, Move, Trash2 } from 'lucide-react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { getContentTypeLabel } from '@/components/weekly-board/contentTypeIcons';
import {
  usePlannerSession,
  type CalendarPlanActivity,
  type CalendarPlan,
  type CalendarPlanDay,
} from './plannerSessionStore';
import { InlineActivityEditor } from './InlineActivityEditor';

const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Format scheduled time for display (e.g. "09:00" → "9:00 AM") */
function formatScheduledTime(raw: string | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) {
    const h = parseInt(m[1]!, 10);
    const mm = m[2]!;
    if (h >= 0 && h <= 23) return `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${mm} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  return s.length <= 8 ? s : s.slice(0, 5);
}

/** Repurpose progress dots: ● filled, ○ empty */
function RepurposeProgressDots({ index, total }: { index: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px]" aria-label={`Repurpose ${index} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < index ? 'text-indigo-600' : 'text-gray-300'}>{i < index ? '●' : '○'}</span>
      ))}
    </span>
  );
}

function rebuildDaysFromActivities(activities: CalendarPlanActivity[]): CalendarPlanDay[] {
  const byKey = new Map<string, CalendarPlanActivity[]>();
  for (const a of activities) {
    if (a.week_number == null) continue;
    const dayVal = a.day ?? 'Monday';
    const key = `${a.week_number}|${dayVal}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(a);
  }
  const days: CalendarPlanDay[] = [];
  for (const [key, arr] of byKey) {
    const [wn, day] = key.split('|');
    days.push({ week_number: Number(wn), day: day ?? 'Monday', activities: arr });
  }
  return days.sort(
    (a, b) =>
      a.week_number - b.week_number ||
      DAYS_ORDER.indexOf(a.day) - DAYS_ORDER.indexOf(b.day)
  );
}

export interface ActivityCardWithControlsProps {
  activity: CalendarPlanActivity;
  /** Compact vs full display */
  variant?: 'compact' | 'full';
  companyId?: string | null;
  showRepurpose?: boolean;
  repurposeIndex?: number;
  repurposeTotal?: number;
  className?: string;
  /** Override click: when set, card click uses this instead of setSelectedActivity */
  onCardClick?: (activity: CalendarPlanActivity) => void;
}

export function ActivityCardWithControls({
  activity,
  variant = 'full',
  companyId,
  showRepurpose = false,
  repurposeIndex = 1,
  repurposeTotal = 1,
  className = '',
  onCardClick,
}: ActivityCardWithControlsProps) {
  const { state, setCalendarPlan, setSelectedActivity } = usePlannerSession();
  const calendarPlan = state.execution_plan?.calendar_plan ?? state.calendar_plan;
  const activities = calendarPlan?.activities ?? [];

  const [editing, setEditing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [moveTargetWeek, setMoveTargetWeek] = useState(activity.week_number ?? 1);
  const [moveTargetDay, setMoveTargetDay] = useState(activity.day ?? 'Monday');

  useEffect(() => {
    if (showMovePicker) {
      setMoveTargetWeek(activity.week_number ?? 1);
      setMoveTargetDay(activity.day ?? 'Monday');
    }
  }, [showMovePicker, activity.week_number, activity.day]);

  const updateActivityInPlan = (updates: Partial<CalendarPlanActivity>) => {
    if (!activity.execution_id || !calendarPlan) return;
    const nextActivities = (activities as CalendarPlanActivity[]).map((a) =>
      a.execution_id === activity.execution_id ? { ...a, ...updates } : a
    );
    const nextDays = rebuildDaysFromActivities(nextActivities);
    setCalendarPlan({ ...calendarPlan, activities: nextActivities, days: nextDays });
  };

  const handleRegenerate = async () => {
    if (!companyId || !activity.execution_id) return;
    setRegenerating(true);
    try {
      const res = await fetch('/api/campaigns/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          preview_mode: true,
          mode: 'planner_command',
          message: `Regenerate the content/topic for this activity. execution_id: ${activity.execution_id}, theme: ${activity.theme ?? activity.title ?? ''}, platform: ${activity.platform ?? ''}, content_type: ${activity.content_type ?? 'post'}. Return an updated calendar_plan with the new title/theme for this activity only.`,
          companyId,
          calendar_plan: calendarPlan,
          idea_spine: state.campaign_design?.idea_spine,
          strategy_context: state.execution_plan?.strategy_context,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.plan?.calendar_plan?.activities) {
        const updated = (data.plan.calendar_plan.activities as CalendarPlanActivity[]).find(
          (a: CalendarPlanActivity) => a.execution_id === activity.execution_id
        );
        if (updated) {
          updateActivityInPlan({ title: updated.title, theme: updated.theme });
        }
      }
    } catch {
      // ignore
    } finally {
      setRegenerating(false);
    }
  };

  const handleDelete = () => {
    if (!activity.execution_id || !calendarPlan) return;
    const nextActivities = (activities as CalendarPlanActivity[]).filter(
      (a) => a.execution_id !== activity.execution_id
    );
    const nextDays = rebuildDaysFromActivities(nextActivities);
    setCalendarPlan({ ...calendarPlan, activities: nextActivities, days: nextDays });
  };

  const handleMoveToDay = (targetWeek: number, targetDay: string) => {
    updateActivityInPlan({ week_number: targetWeek, day: targetDay });
    setShowMovePicker(false);
  };

  const weeks = Array.from(
    new Set([
      ...(calendarPlan?.weeks?.map((w: { week?: number }) => (w as { week?: number })?.week) ?? []),
      ...activities.map((a) => a.week_number).filter((n): n is number => n != null),
    ])
  ).filter((n): n is number => Number.isFinite(n)).sort((a, b) => a - b);
  const uniqueWeeks = weeks.length > 0 ? weeks : [1, 2, 3, 4, 5, 6];

  const handleSaveEdit = (updates: { title?: string; angle?: string; cta?: string }) => {
    updateActivityInPlan({
      title: updates.title,
      theme: updates.title,
      ...(updates.angle !== undefined && { angle: updates.angle }),
      ...(updates.cta !== undefined && { objective: updates.cta, cta: updates.cta }),
    } as Partial<CalendarPlanActivity & { angle?: string; cta?: string }>);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={`rounded-lg border border-indigo-200 bg-indigo-50/30 p-3 ${className}`}>
        <InlineActivityEditor
          activity={activity}
          onSave={handleSaveEdit}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  const scheduledTimeStr = formatScheduledTime((activity as { scheduled_time?: string }).scheduled_time);

  const cardContent = (
    <div className="flex items-start gap-1">
      <PlatformIcon platform={activity.platform ?? ''} size={variant === 'compact' ? 12 : 14} className="shrink-0 mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-indigo-700 block">{getContentTypeLabel(activity.content_type ?? 'post')}</span>
        <span className="block text-gray-700 truncate" title={activity.title ?? ''}>
          {activity.title?.slice(0, variant === 'compact' ? 18 : 24) ?? '—'}
        </span>
        {showRepurpose && (
          <span className="flex items-center gap-1 mt-0.5">
            <RepurposeProgressDots index={repurposeIndex} total={repurposeTotal} />
            <span className="text-[10px] text-indigo-600">({repurposeIndex}/{repurposeTotal})</span>
          </span>
        )}
        {scheduledTimeStr && (
          <span className="text-[10px] text-gray-500 block mt-0.5">{scheduledTimeStr}</span>
        )}
      </span>
    </div>
  );

  const actionButtons = (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className="p-1.5 rounded hover:bg-indigo-100 text-gray-600 hover:text-indigo-700"
        title="Edit"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleRegenerate();
        }}
        disabled={regenerating || !companyId}
        className="p-1.5 rounded hover:bg-indigo-100 text-gray-600 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Regenerate"
      >
        {regenerating ? (
          <RotateCw className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCw className="h-3.5 w-3.5" />
        )}
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowMovePicker((v) => !v);
            if (!showMovePicker) {
              setMoveTargetWeek(activity.week_number ?? 1);
              setMoveTargetDay(activity.day ?? 'Monday');
            }
          }}
          className={`p-1.5 rounded hover:bg-indigo-100 text-gray-600 hover:text-indigo-700 ${showMovePicker ? 'bg-indigo-100' : ''}`}
          title="Move"
        >
          <Move className="h-3.5 w-3.5" />
        </button>
        {showMovePicker && (
          <div
            className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-gray-200 bg-white shadow-lg p-2 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] font-medium text-gray-600">Move to</div>
            <select
              value={moveTargetWeek}
              onChange={(e) => setMoveTargetWeek(Number(e.target.value))}
              className="w-full text-xs px-2 py-1 border border-gray-300 rounded"
            >
              {uniqueWeeks.map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
            <select
              value={moveTargetDay}
              onChange={(e) => setMoveTargetDay(e.target.value)}
              className="w-full text-xs px-2 py-1 border border-gray-300 rounded"
            >
              {DAYS_ORDER.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => handleMoveToDay(moveTargetWeek, moveTargetDay)}
                className="flex-1 px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Move
              </button>
              <button
                type="button"
                onClick={() => setShowMovePicker(false)}
                className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleDelete();
        }}
        className="p-1.5 rounded hover:bg-red-100 text-gray-600 hover:text-red-600"
        title="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const baseClasses =
    variant === 'compact'
      ? 'w-full px-2 py-1 text-[10px] rounded bg-white border border-gray-200 text-left hover:border-indigo-300 hover:bg-indigo-50/50 truncate flex items-center gap-1 group'
      : 'w-full px-2 py-1.5 text-xs rounded-lg bg-indigo-50 border border-indigo-100 text-left hover:border-indigo-300 hover:bg-indigo-100 transition-colors flex items-start gap-1 group';

  if (onCardClick) {
    return (
      <div className={`${baseClasses} flex items-center justify-between gap-1 ${className}`}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCardClick(activity);
          }}
          className="min-w-0 flex-1 text-left"
        >
          {cardContent}
        </button>
        {actionButtons}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setSelectedActivity(activity);
      }}
      className={`${baseClasses} ${className}`}
      title={`${getContentTypeLabel(activity.content_type ?? 'post')}: ${activity.title ?? ''}${showRepurpose ? ` (${repurposeIndex}/${repurposeTotal})` : ''}`}
    >
      <span className="min-w-0 flex-1">{cardContent}</span>
      {actionButtons}
    </button>
  );
}
