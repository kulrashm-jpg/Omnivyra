/**
 * Skeleton Plan View
 * Right panel in the Skeleton tab.
 * Week tabs → click a week → day accordion cards → non-clickable activity rows.
 * AI Chat (left panel) adds/removes activities and this view reflects the changes.
 */

import { useState, useMemo } from 'react';
import { Calendar, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { usePlannerSession, type CalendarPlanActivity } from './plannerSessionStore';
import PlatformIcon from '../ui/PlatformIcon';

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const WEEK_COLORS = [
  { tab: 'bg-indigo-600 text-white', tabIdle: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100', dayHeader: 'bg-indigo-50/60 hover:bg-indigo-100/60', dayExpanded: 'bg-indigo-50/30', badge: 'bg-indigo-100 text-indigo-600' },
  { tab: 'bg-violet-600 text-white', tabIdle: 'bg-violet-50 text-violet-700 hover:bg-violet-100', dayHeader: 'bg-violet-50/60 hover:bg-violet-100/60', dayExpanded: 'bg-violet-50/30', badge: 'bg-violet-100 text-violet-600' },
  { tab: 'bg-sky-600 text-white',    tabIdle: 'bg-sky-50 text-sky-700 hover:bg-sky-100',          dayHeader: 'bg-sky-50/60 hover:bg-sky-100/60',    dayExpanded: 'bg-sky-50/30',    badge: 'bg-sky-100 text-sky-600' },
  { tab: 'bg-emerald-600 text-white',tabIdle: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100', dayHeader: 'bg-emerald-50/60 hover:bg-emerald-100/60', dayExpanded: 'bg-emerald-50/30', badge: 'bg-emerald-100 text-emerald-600' },
  { tab: 'bg-amber-600 text-white',  tabIdle: 'bg-amber-50 text-amber-700 hover:bg-amber-100',    dayHeader: 'bg-amber-50/60 hover:bg-amber-100/60',  dayExpanded: 'bg-amber-50/30',  badge: 'bg-amber-100 text-amber-600' },
  { tab: 'bg-rose-600 text-white',   tabIdle: 'bg-rose-50 text-rose-700 hover:bg-rose-100',       dayHeader: 'bg-rose-50/60 hover:bg-rose-100/60',   dayExpanded: 'bg-rose-50/30',   badge: 'bg-rose-100 text-rose-600' },
];

function flattenActivities(plan: { activities?: CalendarPlanActivity[]; days?: Array<{ week_number: number; day: string; activities?: CalendarPlanActivity[] }> } | null | undefined): CalendarPlanActivity[] {
  if (!plan) return [];
  if (Array.isArray(plan.activities) && plan.activities.length > 0) return plan.activities;
  if (Array.isArray(plan.days) && plan.days.length > 0) {
    return plan.days.flatMap((d) =>
      (d.activities ?? []).map((a) => ({
        ...a,
        day: a.day ?? d.day,
        week_number: a.week_number ?? d.week_number,
      }))
    );
  }
  return [];
}

export function SkeletonPlanView() {
  const { state } = usePlannerSession();
  const plan = state.calendar_plan ?? state.execution_plan?.calendar_plan;

  const allActivities = useMemo(() => flattenActivities(plan), [plan]);

  const weeks = useMemo(() => {
    const seen = new Set<number>();
    for (const a of allActivities) {
      if (a.week_number != null) seen.add(a.week_number);
    }
    return Array.from(seen).sort((a, b) => a - b);
  }, [allActivities]);

  const [activeWeek, setActiveWeek] = useState<number | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const currentWeek = activeWeek ?? weeks[0] ?? null;
  const weekIdx = currentWeek != null ? weeks.indexOf(currentWeek) : 0;
  const color = WEEK_COLORS[Math.max(0, weekIdx) % WEEK_COLORS.length];

  function switchWeek(w: number) {
    setActiveWeek(w);
    setExpandedDays(new Set());
  }

  function toggleDay(day: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  if (!plan || weeks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-4">
        <Layers className="h-12 w-12 text-gray-200" />
        <div>
          <p className="text-sm font-medium text-gray-500 mb-1">No skeleton yet</p>
          <p className="text-xs text-gray-400 leading-relaxed">
            Use <strong>Schedule</strong> to set platforms &amp; frequency, or<br />
            describe it in <strong>AI Chat</strong> — your plan will appear here.
          </p>
        </div>
      </div>
    );
  }

  const weekActivities = allActivities.filter((a) => a.week_number === currentWeek);

  // Group by day
  const byDay = new Map<string, CalendarPlanActivity[]>();
  for (const a of weekActivities) {
    const day = a.day ?? 'Monday';
    byDay.set(day, [...(byDay.get(day) ?? []), a]);
  }
  const sortedDays = Array.from(byDay.keys()).sort(
    (a, b) => (DAY_ORDER.indexOf(a) === -1 ? 99 : DAY_ORDER.indexOf(a)) - (DAY_ORDER.indexOf(b) === -1 ? 99 : DAY_ORDER.indexOf(b))
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Week tab row */}
      <div className="flex-shrink-0 flex gap-1.5 px-3 py-2.5 overflow-x-auto border-b border-gray-100 bg-gray-50">
        {weeks.map((week, i) => {
          const c = WEEK_COLORS[i % WEEK_COLORS.length];
          const isActive = week === currentWeek;
          const count = allActivities.filter((a) => a.week_number === week).length;
          return (
            <button
              key={week}
              type="button"
              onClick={() => switchWeek(week)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${isActive ? c.tab : c.tabIdle}`}
            >
              <span>Wk {week}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/25' : c.badge}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Week summary row */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-gray-100 bg-white flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Week {currentWeek}</span>
        <span className="text-[10px] text-gray-400">
          {weekActivities.length} activit{weekActivities.length !== 1 ? 'ies' : 'y'} · {sortedDays.length} day{sortedDays.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Day accordion */}
      <div className="flex-1 overflow-y-auto">
        {sortedDays.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-xs text-gray-400">
            No activities for Week {currentWeek}.
          </div>
        ) : (
          sortedDays.map((day) => {
            const dayActs = byDay.get(day) ?? [];
            const isExpanded = expandedDays.has(day);

            return (
              <div key={day} className="border-b border-gray-100 last:border-0">
                {/* Day card header — clickable to expand/collapse */}
                <button
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                    isExpanded ? color.dayExpanded : color.dayHeader
                  }`}
                >
                  <Calendar className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  <span className="flex-1 text-left text-sm font-semibold text-gray-800">{day}</span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full mr-1 ${color.badge}`}>
                    {dayActs.length} piece{dayActs.length !== 1 ? 's' : ''}
                  </span>
                  {isExpanded
                    ? <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                </button>

                {/* Activities — non-clickable */}
                {isExpanded && (
                  <div className="divide-y divide-gray-50 border-t border-gray-100">
                    {dayActs.map((act, i) => (
                      <div key={i} className="flex items-center gap-3 px-5 py-2.5 bg-white">
                        <PlatformIcon platform={act.platform ?? 'linkedin'} size={14} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">
                            {act.title ?? act.theme ?? 'Untitled'}
                          </p>
                          <p className="text-[10px] text-gray-400 capitalize mt-0.5">
                            {act.content_type ?? 'post'}
                            {act.objective ? ` · ${act.objective}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
