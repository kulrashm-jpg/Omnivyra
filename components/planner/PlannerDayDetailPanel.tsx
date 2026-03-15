/**
 * Planner Day Detail Panel
 * Slide-over when user clicks a day cell in the Daily Execution Planner.
 * Sections: Activities, Messages (empty - no API in planner context).
 * Uses planner state only; no new API calls.
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { getContentTypeLabel } from '@/components/weekly-board/contentTypeIcons';
import type { CalendarPlanActivity } from './plannerSessionStore';

function formatTime(val: string | undefined): string {
  if (!val || typeof val !== 'string') return '';
  const s = val.trim();
  if (!s) return '';
  if (s.includes('T')) {
    try {
      const d = new Date(s);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return s.slice(0, 5);
    }
  }
  return s.slice(0, 5) || '';
}

/** Repurpose progress dots — unique = ●, repurposed = ● ● ○ etc. */
function RepurposeDots({ index, total, contentType }: { index: number; total: number; contentType?: string }) {
  const safeTotal = total < 1 ? 1 : total;
  const safeIndex = index < 1 ? 1 : index;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-indigo-600" aria-label={safeTotal === 1 ? 'Unique' : `Repurpose ${safeIndex} of ${safeTotal}`}>
      {Array.from({ length: safeTotal }, (_, i) => (
        <span key={i} className={i < safeIndex ? 'text-indigo-600' : 'text-gray-300'}>
          {i < safeIndex ? '●' : '○'}
        </span>
      ))}
      {contentType && <span className="text-gray-400 ml-0.5">{contentType}</span>}
    </span>
  );
}

export interface PlannerDayDetailPanelProps {
  dayLabel: string;
  dateLabel: string;
  activities: CalendarPlanActivity[];
  onClose: () => void;
  onActivityClick?: (activity: CalendarPlanActivity) => void;
}

export function PlannerDayDetailPanel({
  dayLabel,
  dateLabel,
  activities,
  onClose,
  onActivityClick,
}: PlannerDayDetailPanelProps) {
  const getRepurposeInfo = (a: CalendarPlanActivity) => {
    // Group all activities sharing the same title (same content repurposed to multiple platforms).
    // The group is taken in `activities` array order — that IS the visual top-to-bottom order.
    const title = (a.title ?? '').trim();
    if (!title) return { index: 1, total: 1 };
    const group = activities.filter((x) => (x.title ?? '').trim() === title);
    const total = group.length;
    const idx = group.findIndex((x) => x.execution_id === a.execution_id);
    return { index: idx >= 0 ? idx + 1 : 1, total };
  };

  return (
    <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl border-l border-gray-200 flex flex-col z-[9998]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{dayLabel}</h2>
          <p className="text-xs text-gray-600">{dateLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-200 text-gray-600 hover:text-gray-900"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Activities</h3>
          {activities.length === 0 ? (
            <p className="text-sm text-gray-500">No activities planned for this day.</p>
          ) : (
            <div className="space-y-2">
              {activities.map((a) => {
                const { index, total } = getRepurposeInfo(a);
                const timeStr = formatTime((a as any).scheduled_time);

                return (
                  <div
                    key={a.execution_id ?? a.title}
                    className={`flex items-start gap-2 p-2 rounded-lg border border-gray-200 hover:bg-gray-50 ${
                      onActivityClick ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => onActivityClick?.(a)}
                    role={onActivityClick ? 'button' : undefined}
                  >
                    <PlatformIcon platform={a.platform ?? ''} size={18} className="shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {getContentTypeLabel(a.content_type ?? 'post')}
                      </p>
                      <p className="text-xs text-gray-600 break-words">{a.title ?? '—'}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <RepurposeDots index={index} total={total} contentType={a.content_type ?? undefined} />
                        {timeStr && (
                          <span className="text-xs text-gray-500">{timeStr}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Messages</h3>
          <p className="text-sm text-gray-500">
            Messages are available in the campaign calendar view.
          </p>
        </section>
      </div>
    </div>
  );
}
