/**
 * Campaign Daily Plan — Single Week Execution View
 * Week selector → 7-day strip → selected day panel.
 * Supports drag-and-drop to move activities between days.
 * Uses GridActivity from campaign-daily-plan page.
 */

import React, { useMemo, useState, useCallback } from 'react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { getContentTypeLabel } from '@/components/weekly-board/contentTypeIcons';
import { RefreshCw, Sparkles, Save, GripVertical } from 'lucide-react';

export type GridActivity = {
  id: string;
  execution_id: string;
  week_number: number;
  day: string;
  title: string;
  platform: string;
  content_type: string;
  raw_item: Record<string, unknown>;
  planId?: string;
  execution_mode?: string;
  creator_instruction?: Record<string, unknown>;
  /** 'AI', 'blueprint', or null */
  generation_source?: string | null;
};

/** Add days to a date string (YYYY-MM-DD), return ISO date string */
function addDays(startDate: string | null, days: number): string {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  const base = new Date(startDate + 'T00:00:00');
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Format date as "EEE dd" (e.g., Fri 13) */
function formatDayDate(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNum = d.getDate();
    return `${dayName} ${dayNum}`;
  } catch {
    return iso.slice(5) ?? iso;
  }
}

/** Get weekday name from date (e.g., "Monday") */
function getWeekdayName(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  } catch {
    return 'Monday';
  }
}

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(5) ?? iso;
  }
}

/** Repurpose dots — unique = ●, repurposed = ● ● ○ etc. */
function RepurposeDots({ index, total }: { index: number; total: number }) {
  const t = total < 1 ? 1 : total;
  const idx = index < 1 ? 1 : index;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={t === 1 ? 'Unique' : `${idx} of ${t}`}>
      {Array.from({ length: t }, (_, i) => (
        <span key={i} className={i < idx ? 'text-indigo-500' : 'text-gray-300'} style={{ fontSize: 7 }}>
          {i < idx ? '●' : '○'}
        </span>
      ))}
    </span>
  );
}

/** Mini activity row for the 7-day strip card — draggable when planId is set */
function DayStripActivityPreview({
  activity,
  repurposeIndex,
  repurposeTotal,
  onClick,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  activity: GridActivity;
  repurposeIndex: number;
  repurposeTotal: number;
  onClick: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const canDrag = Boolean(activity.planId);
  return (
    <div
      draggable={canDrag}
      onDragStart={canDrag ? (e) => { e.stopPropagation(); onDragStart?.(e); } : undefined}
      onDragEnd={canDrag ? (e) => { e.stopPropagation(); onDragEnd?.(); } : undefined}
      title={canDrag ? `${activity.title ?? ''} — drag to move` : activity.title ?? ''}
      className={`rounded ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : ''}`}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="flex items-center gap-1 w-full text-left hover:bg-indigo-50 rounded px-1 py-0.5 group"
      >
        {canDrag && <GripVertical className="h-2.5 w-2.5 text-gray-300 shrink-0 group-hover:text-gray-500" />}
        <RepurposeDots index={repurposeIndex} total={repurposeTotal} />
        <PlatformIcon platform={activity.platform ?? ''} size={9} className="shrink-0" />
        <span className="truncate text-[9px] text-gray-700 group-hover:text-indigo-700 leading-tight">
          {activity.title ?? getContentTypeLabel(activity.content_type ?? 'post')}
        </span>
      </button>
    </div>
  );
}

/** Activity card for selected day panel — supports drag when planId is set */
function ActivityCard({
  activity,
  repurposeIndex,
  repurposeTotal,
  onClick,
  onDragStart,
  isDragging,
}: {
  activity: GridActivity;
  repurposeIndex: number;
  repurposeTotal: number;
  onClick: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  isDragging?: boolean;
}) {
  const scheduledTime = (activity.raw_item as any)?.scheduled_time ?? (activity.raw_item as any)?.time;
  const canDrag = Boolean(activity.planId);

  // Extract description from raw_item
  const description = (() => {
    const ri = activity.raw_item as any;
    return (
      ri?.description ||
      ri?.writer_content_brief?.writingIntent ||
      ri?.content?.description ||
      ''
    );
  })();

  return (
    <div
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      className={`flex flex-col gap-1 rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors w-full ${
        isDragging ? 'opacity-40 border-dashed border-indigo-400' : ''
      } ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-center gap-2">
        {canDrag && <GripVertical className="w-3 h-3 text-gray-300 shrink-0" />}
        <PlatformIcon platform={activity.platform} size={16} className="shrink-0" />
        <span className="text-xs font-medium text-gray-600">
          {getContentTypeLabel(activity.content_type ?? 'post')}
        </span>
        <RepurposeDots index={repurposeIndex} total={repurposeTotal} />
        {activity.generation_source && (
          <span className={`ml-auto text-[9px] font-semibold px-1 py-0.5 rounded ${
            activity.generation_source?.toUpperCase() === 'AI'
              ? 'bg-purple-100 text-purple-700'
              : 'bg-blue-100 text-blue-700'
          }`}>
            {activity.generation_source?.toUpperCase() === 'AI' ? 'AI' : 'Blueprint'}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onClick}
        className="text-sm font-medium text-gray-900 text-left hover:text-indigo-700 line-clamp-2"
        title={activity.title}
      >
        {activity.title}
      </button>
      {description ? (
        <p className="text-[11px] text-gray-500 line-clamp-2 leading-snug">{description}</p>
      ) : null}
      {scheduledTime && (
        <div className="text-[10px] text-gray-500">{String(scheduledTime)}</div>
      )}
    </div>
  );
}

export interface CampaignDailyPlanSingleWeekViewProps {
  weeksToShow: number[];
  activities: GridActivity[];
  weeklyPlans: Array<{ weekNumber?: number; week?: number; theme?: string }>;
  campaignStartDate: string | null;
  selectedWeekIndex: number;
  selectedDayIndex: number;
  onWeekSelect: (weekIndex: number) => void;
  onDaySelect: (dayIndex: number) => void;
  onActivityClick: (activity: GridActivity) => void;
  onRegenerateWeek: (weekNumber: number) => void;
  regeneratingWeek: number | null;
  /** When provided, shows "Generate from AI" when no activities (Source B fallback) */
  onGenerateFromAI?: (weekNumber: number) => void;
  generatingFromAI?: boolean;
  /** When provided, enables save-after-drag for activities with planId */
  onSaveDayChanges?: (weekNumber: number, moves: Array<{ planId: string; day: string }>) => Promise<void>;
}

export function CampaignDailyPlanSingleWeekView({
  weeksToShow,
  activities,
  weeklyPlans,
  campaignStartDate,
  selectedWeekIndex,
  selectedDayIndex,
  onWeekSelect,
  onDaySelect,
  onActivityClick,
  onRegenerateWeek,
  regeneratingWeek,
  onGenerateFromAI,
  generatingFromAI,
  onSaveDayChanges,
}: CampaignDailyPlanSingleWeekViewProps) {
  const weekNumber = weeksToShow[selectedWeekIndex] ?? 1;
  const weekPlan = weeklyPlans.find((p) => (p.weekNumber ?? p.week) === weekNumber);
  const theme = weekPlan?.theme ?? `Week ${weekNumber} Theme`;

  // Pending day overrides: activityId → newDay (before saving)
  const [pendingDayMap, setPendingDayMap] = useState<Record<string, string>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null); // day name being dragged over

  // Reset pending moves when week changes
  const prevWeekRef = React.useRef(weekNumber);
  if (prevWeekRef.current !== weekNumber) {
    prevWeekRef.current = weekNumber;
    if (Object.keys(pendingDayMap).length > 0) setPendingDayMap({});
    if (draggingId) setDraggingId(null);
  }

  const weekActivities = useMemo(
    () => activities.filter((a) => a.week_number === weekNumber),
    [activities, weekNumber]
  );

  // Apply pending day overrides to display
  const effectiveActivities = useMemo(
    () =>
      weekActivities.map((a) => {
        const override = pendingDayMap[a.id];
        return override ? { ...a, day: override } : a;
      }),
    [weekActivities, pendingDayMap]
  );

  // Campaign-wide repurpose map: group by title across ALL activities (all weeks).
  // Returns index/total for unique-platform entries, and isDuplicatePlatform=true for violations
  // (same topic + same platform appearing more than once — a scheduling error).
  const campaignRepurposeMap = useMemo(() => {
    const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayRank = (d: string | undefined) => {
      const i = DAYS_ORDER.indexOf(d ?? '');
      return i >= 0 ? i : 9999;
    };

    // Group by title, deduplicate by platform (same topic can only appear once per platform
    // across the whole campaign — the persistence layer enforces this at write time).
    const titleGroups = new Map<string, GridActivity[]>();

    activities.forEach((a) => {
      const key = (a.title ?? '').trim();
      if (!key) return;
      const g = titleGroups.get(key) ?? [];
      const plat = (a.platform ?? '').toLowerCase().trim();
      if (plat && g.some((x) => (x.platform ?? '').toLowerCase().trim() === plat)) return;
      g.push(a);
      titleGroups.set(key, g);
    });

    const result = new Map<string, { index: number; total: number }>();

    for (const group of titleGroups.values()) {
      const sorted = [...group].sort((a, b) => {
        const wA = a.week_number != null ? a.week_number : 9999;
        const wB = b.week_number != null ? b.week_number : 9999;
        if (wA !== wB) return wA - wB;
        const dDiff = dayRank(a.day) - dayRank(b.day);
        if (dDiff !== 0) return dDiff;
        return (a.platform ?? '').localeCompare(b.platform ?? '');
      });
      const total = sorted.length;
      sorted.forEach((a, rank) => {
        result.set(a.execution_id, { index: rank + 1, total });
      });
    }
    return result;
  }, [activities]);

  /** Day strip: 7 cells from campaign start, dayDate = addDays(startDate, weekIndex*7 + dayIndex) */
  const byDay = useMemo(() => {
    const baseOffset = selectedWeekIndex * 7;
    return Array.from({ length: 7 }, (_, dayIndex) => {
      const dateStr = addDays(campaignStartDate, baseOffset + dayIndex);
      const weekday = getWeekdayName(dateStr);
      const acts = effectiveActivities.filter(
        (a) => (a.day ?? '').toLowerCase() === weekday.toLowerCase()
      );
      return {
        day: weekday,
        dayIndex,
        dateStr,
        dayLabel: formatDayDate(dateStr),
        acts,
      };
    });
  }, [campaignStartDate, selectedWeekIndex, effectiveActivities]);

  const effectiveDayIndex = Math.max(0, Math.min(selectedDayIndex, 6));
  const selectedDay = byDay[effectiveDayIndex];
  const selectedDayActs = selectedDay?.acts ?? [];

  const isRegenerating = regeneratingWeek === weekNumber;
  const hasPendingMoves = Object.keys(pendingDayMap).length > 0;

  const handleDragStart = useCallback((e: React.DragEvent, activity: GridActivity) => {
    if (!activity.planId) return;
    e.dataTransfer.setData('application/json', JSON.stringify({ id: activity.id, planId: activity.planId }));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(activity.id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, day: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(day);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetDay: string) => {
    e.preventDefault();
    setDragOver(null);
    setDraggingId(null);
    let payload: { id: string; planId: string };
    try {
      payload = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
    } catch {
      return;
    }
    const { id, planId } = payload;
    if (!id || !planId) return;
    const activity = weekActivities.find((a) => a.id === id);
    if (!activity) return;
    const currentDay = pendingDayMap[id] ?? activity.day;
    if (currentDay.toLowerCase() === targetDay.toLowerCase()) return;
    setPendingDayMap((prev) => ({ ...prev, [id]: targetDay }));
  }, [weekActivities, pendingDayMap]);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOver(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!onSaveDayChanges || !hasPendingMoves) return;
    setIsSaving(true);
    try {
      const moves = weekActivities
        .filter((a) => pendingDayMap[a.id] && a.planId)
        .map((a) => ({ planId: a.planId!, day: pendingDayMap[a.id] }));
      await onSaveDayChanges(weekNumber, moves);
      setPendingDayMap({});
    } finally {
      setIsSaving(false);
    }
  }, [onSaveDayChanges, hasPendingMoves, weekActivities, pendingDayMap, weekNumber]);

  return (
    <div className="space-y-4">
      {/* Week selector buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {weeksToShow.map((wn) => {
          const isSelected = wn === weekNumber;
          const count = activities.filter((a) => a.week_number === wn).length;
          return (
            <button
              key={wn}
              type="button"
              onClick={() => onWeekSelect(wn)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                isSelected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Week {wn}{count > 0 ? ` • ${count}` : ''}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onRegenerateWeek(weekNumber)}
          disabled={isRegenerating}
          title="Rebuild day assignments from the campaign blueprint — use this when you've changed distribution settings or want to reset manual drags. Drag activities between days for individual adjustments instead."
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ml-2 transition-all active:scale-95 ${
            isRegenerating
              ? 'bg-indigo-200 text-indigo-800 cursor-wait'
              : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 cursor-pointer'
          } disabled:opacity-70 disabled:cursor-not-allowed`}
        >
          <RefreshCw className={`w-4 h-4 shrink-0 ${isRegenerating ? 'animate-spin' : ''}`} />
          {isRegenerating ? 'Regenerating…' : 'Regenerate'}
        </button>
        {onGenerateFromAI && (
          <button
            type="button"
            onClick={() => onGenerateFromAI(weekNumber)}
            disabled={generatingFromAI || isRegenerating}
            title="Ask AI to generate 7 fully-written daily activities for this week — each with topic, description, CTA, and writing brief. Saves directly to the database."
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all active:scale-95 ${
              generatingFromAI || isRegenerating
                ? 'bg-purple-200 text-purple-800 cursor-wait'
                : 'bg-purple-100 text-purple-700 hover:bg-purple-200 cursor-pointer'
            } disabled:opacity-70 disabled:cursor-not-allowed`}
          >
            <Sparkles className={`w-4 h-4 shrink-0 ${generatingFromAI ? 'animate-spin' : ''}`} />
            {generatingFromAI ? 'Generating…' : 'Generate from AI'}
          </button>
        )}
        {hasPendingMoves && onSaveDayChanges && (
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-all active:scale-95 disabled:opacity-70"
          >
            <Save className="w-4 h-4 shrink-0" />
            {isSaving ? 'Saving…' : 'Save day changes'}
          </button>
        )}
      </div>

      {/* 7-day strip */}
      <div>
        <div className="text-xs font-medium text-gray-600 mb-2">
          {weekActivities.some((a) => a.planId)
            ? 'Click a day to view details — drag activities directly between days to rearrange'
            : 'Click a day to view details'}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {byDay.map(({ day, dayIndex, dateStr, dayLabel, acts }) => {
            const isSelected = dayIndex === effectiveDayIndex;
            const isDragTarget = dragOver === day;
            const previewActs = acts.slice(0, 3);
            const extraCount = acts.length > 3 ? acts.length - 3 : 0;

            return (
              // Using div instead of button so draggable children can be nested properly
              <div
                key={`${dayIndex}-${dateStr}`}
                role="button"
                tabIndex={0}
                onClick={() => onDaySelect(dayIndex)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onDaySelect(dayIndex); }}
                onDragOver={(e) => handleDragOver(e, day)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, day)}
                className={`rounded-lg border p-2 min-h-[80px] text-left transition-colors cursor-pointer ${
                  isDragTarget
                    ? 'border-indigo-400 ring-2 ring-indigo-300 bg-indigo-100/60'
                    : isSelected
                    ? 'border-indigo-400 ring-2 ring-indigo-200 bg-indigo-50'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="text-[10px] font-medium text-gray-500 uppercase">
                  {dayLabel}
                  {acts.length > 0 ? ` [${acts.length}]` : ''}
                </div>
                <div className="mt-1 space-y-0.5">
                  {previewActs.map((a) => {
                    const rp = campaignRepurposeMap.get(a.execution_id) ?? { index: 1, total: 1 };
                    return (
                      <DayStripActivityPreview
                        key={a.execution_id}
                        activity={a}
                        repurposeIndex={rp.index}
                        repurposeTotal={rp.total}
                        onClick={() => onActivityClick(a)}
                        onDragStart={(e) => handleDragStart(e, a)}
                        onDragEnd={handleDragEnd}
                        isDragging={draggingId === a.id}
                      />
                    );
                  })}
                  {extraCount > 0 && (
                    <div className="text-[9px] text-indigo-600 font-medium px-1">
                      +{extraCount} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected day detail panel */}
      <div
        className={`rounded-xl border p-4 transition-colors ${
          dragOver === (selectedDay?.day ?? '')
            ? 'border-indigo-400 bg-indigo-50/60'
            : 'border-indigo-200 bg-indigo-50/30'
        }`}
        onDragOver={(e) => handleDragOver(e, selectedDay?.day ?? '')}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, selectedDay?.day ?? '')}
      >
        <div className="space-y-0.5 mb-3">
          <div className="text-sm font-semibold text-indigo-800">
            {selectedDay?.day ?? 'Monday'} •{' '}
            {formatDateShort(selectedDay?.dateStr ?? addDays(campaignStartDate, selectedWeekIndex * 7))}
          </div>
          <div className="text-xs font-medium text-indigo-600">
            Week {weekNumber} — {theme}
          </div>
        </div>
        {selectedDayActs.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            {dragOver === selectedDay?.day ? 'Drop here to move activity to this day' : 'No activities planned for this day.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedDayActs.map((a) => {
              const rp = campaignRepurposeMap.get(a.execution_id) ?? { index: 1, total: 1 };
              return (
                <ActivityCard
                  key={a.execution_id}
                  activity={a}
                  repurposeIndex={rp.index}
                  repurposeTotal={rp.total}
                  onClick={() => onActivityClick(a)}
                  onDragStart={(e) => handleDragStart(e, a)}
                  isDragging={draggingId === a.id}
                />
              );
            })}
          </div>
        )}
      </div>

      {hasPendingMoves && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
          {Object.keys(pendingDayMap).length} activity move(s) pending — click <strong>Save day changes</strong> to persist.
        </p>
      )}
    </div>
  );
}
