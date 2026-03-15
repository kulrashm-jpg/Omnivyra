/**
 * Single Week Execution View
 * Single-week focus: week selector → 7-day strip → selected day panel.
 * Used when viewMode is 'week' or 'day'. No stacked week sections.
 */

import React, { useState, useEffect, useMemo } from 'react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { getContentTypeLabel } from '@/components/weekly-board/contentTypeIcons';
import { ActivityCardWithControls } from './ActivityCardWithControls';
import type { CalendarPlanActivity } from './plannerSessionStore';

const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function getDateForWeekDay(startDate: string | undefined, weekNum: number, dayName: string): string {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const d = new Date();
    d.setDate(d.getDate() + (weekNum - 1) * 7 + DAYS_ORDER.indexOf(dayName));
    return d.toISOString().slice(0, 10);
  }
  const base = new Date(startDate + 'T00:00:00');
  const dayOffset = DAYS_ORDER.indexOf(dayName);
  if (dayOffset < 0) return startDate;
  const target = new Date(base);
  target.setDate(base.getDate() + (weekNum - 1) * 7 + dayOffset);
  return target.toISOString().slice(0, 10);
}

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(5) ?? iso;
  }
}

function getDayOfMonth(iso: string): number {
  try {
    return new Date(iso + 'T00:00:00').getDate();
  } catch {
    return 0;
  }
}

interface WeekData {
  week?: number;
  theme?: string;
  phase_label?: string;
}

export interface SingleWeekExecutionViewProps {
  weeks: unknown[];
  activities: CalendarPlanActivity[];
  strategicThemes: { week: number; title: string }[];
  startDate: string;
  campaignId?: string | null;
  companyId?: string | null;
  /** Controlled: selected week number (1-based) */
  selectedWeekNumber: number;
  /** Controlled: selected day name */
  selectedDayName: string;
  onWeekSelect: (weekNumber: number) => void;
  onDaySelect: (dayName: string) => void;
  onActivityClick: (activity: CalendarPlanActivity) => void;
}

/** Mini activity preview for day strip: PlatformIcon + ContentType only */
function DayStripActivityPreview({
  activity,
  onClick,
}: {
  activity: CalendarPlanActivity;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex items-center gap-1 text-[10px] text-left hover:bg-indigo-50 rounded px-1 py-0.5 truncate w-full"
      title={`${getContentTypeLabel(activity.content_type ?? 'post')}: ${activity.title ?? ''}`}
    >
      <PlatformIcon platform={activity.platform ?? ''} size={10} className="shrink-0" />
      <span className="truncate">{getContentTypeLabel(activity.content_type ?? 'post')}</span>
    </button>
  );
}

export function SingleWeekExecutionView({
  weeks,
  activities,
  strategicThemes,
  startDate,
  campaignId,
  companyId,
  selectedWeekNumber,
  selectedDayName,
  onWeekSelect,
  onDaySelect,
  onActivityClick,
}: SingleWeekExecutionViewProps) {
  const weekNumbers = useMemo(() => {
    const nums = weeks.slice(0, 16).map((w, i) => (w as WeekData)?.week ?? i + 1);
    return Array.from(new Set(nums)).filter((n): n is number => Number.isFinite(n)).sort((a, b) => a - b);
  }, [weeks]);

  const focusWeekNum = weekNumbers.includes(selectedWeekNumber) ? selectedWeekNumber : weekNumbers[0] ?? 1;
  const focusWeek = weeks.find((w) => ((w as WeekData)?.week ?? 0) === focusWeekNum) ?? weeks[0];
  const theme = strategicThemes.find((t) => t.week === focusWeekNum)?.title ?? (focusWeek as WeekData)?.phase_label ?? (focusWeek as WeekData)?.theme ?? `Week ${focusWeekNum}`;

  const weekActivities = activities.filter((a) => a.week_number === focusWeekNum);
  const byDay = DAYS_ORDER.map((d) => ({
    day: d,
    dateStr: getDateForWeekDay(startDate, focusWeekNum, d),
    acts: weekActivities.filter((a) => (a.day ?? 'Monday') === d),
  }));

  const selectedDayActs = weekActivities.filter((a) => (a.day ?? 'Monday') === selectedDayName);
  const effectiveDayName = DAYS_ORDER.includes(selectedDayName) ? selectedDayName : DAYS_ORDER[0]!;

  return (
    <div className="space-y-4">
      {/* FEATURE 1: Week selector buttons */}
      <div className="flex flex-wrap gap-1.5">
        {weekNumbers.map((wn) => {
          const isSelected = wn === focusWeekNum;
          return (
            <button
              key={wn}
              type="button"
              onClick={() => onWeekSelect(wn)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                isSelected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Week {wn}
            </button>
          );
        })}
      </div>

      {/* FEATURE 2: 7-day strip for selected week */}
      <div>
        <div className="text-xs font-medium text-gray-600 mb-2">Select a day</div>
        <div className="grid grid-cols-7 gap-2">
          {byDay.map(({ day, dateStr, acts }) => {
            const isSelected = day === effectiveDayName;
            const previewActs = acts.slice(0, 2);
            const extraCount = acts.length > 2 ? acts.length - 2 : 0;

            return (
              <button
                key={day}
                type="button"
                onClick={() => onDaySelect(day)}
                className={`rounded-lg border p-2 min-h-[80px] text-left transition-colors ${
                  isSelected ? 'border-indigo-400 ring-2 ring-indigo-200 bg-indigo-50' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="text-[10px] font-medium text-gray-500 uppercase">
                  {day.slice(0, 2)} {getDayOfMonth(dateStr)}{acts.length > 0 ? ` [${acts.length}]` : ''}
                </div>
                {/* FEATURE 5: Mini activity previews (first 2 + "+N more") */}
                <div className="mt-1 space-y-0.5">
                  {previewActs.map((a) => (
                    <DayStripActivityPreview
                      key={a.execution_id}
                      activity={a}
                      onClick={() => onActivityClick(a)}
                    />
                  ))}
                  {extraCount > 0 && (
                    <div className="text-[9px] text-indigo-600 font-medium px-1">+{extraCount} more</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* FEATURE 3: Selected day detail view (inline) */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4">
        <div className="space-y-0.5 mb-3">
          <div className="text-sm font-semibold text-indigo-800">
            {effectiveDayName} • {formatDateShort(getDateForWeekDay(startDate, focusWeekNum, effectiveDayName))}
          </div>
          <div className="text-xs font-medium text-indigo-600">
            Week {focusWeekNum} — {theme}
          </div>
        </div>
        {selectedDayActs.length === 0 ? (
          <p className="text-sm text-gray-600">No activities planned for this day.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedDayActs.map((a) => {
              const siblings = selectedDayActs.filter((x) => x !== a && (x.title ?? '') === (a.title ?? ''));
              const sharedGroup = siblings.length > 0 ? [a, ...siblings] : [a];
              const repurposeIndex = sharedGroup.findIndex((x) => x.execution_id === a.execution_id) + 1;
              const repurposeTotal = sharedGroup.length;
              const showRepurpose = repurposeTotal > 1;
              return (
                <ActivityCardWithControls
                  key={a.execution_id}
                  activity={a}
                  variant="full"
                  companyId={companyId}
                  showRepurpose={showRepurpose}
                  repurposeIndex={repurposeIndex}
                  repurposeTotal={repurposeTotal}
                  onCardClick={onActivityClick}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
