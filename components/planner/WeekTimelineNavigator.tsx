/**
 * Week Timeline Navigator — Horizontal scrollable week selector for long campaigns.
 * Each block shows Week number, Phase name, and progress (planned / expected activities).
 * Click loads that week; selected week highlighted.
 */

import React, { useRef, useEffect } from 'react';

interface WeekBlock {
  weekNumber: number;
  phaseLabel: string;
  plannedCount: number;
  expectedCount: number;
}

export interface WeekTimelineNavigatorProps {
  weeks: WeekBlock[];
  selectedWeekNumber: number;
  onWeekSelect: (weekNumber: number) => void;
  className?: string;
}

export default function WeekTimelineNavigator({
  weeks,
  selectedWeekNumber,
  onWeekSelect,
  className = '',
}: WeekTimelineNavigatorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selectedRef.current && scrollRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedWeekNumber]);

  if (weeks.length === 0) return null;

  return (
    <div className={`overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 ${className}`}>
      <div ref={scrollRef} className="flex gap-2 pb-2 min-w-0">
        {weeks.map((w) => {
          const isSelected = w.weekNumber === selectedWeekNumber;
          const progressStr =
            w.expectedCount > 0
              ? `${w.plannedCount} / ${w.expectedCount} activities planned`
              : `${w.plannedCount} activities planned`;

          return (
            <button
              key={w.weekNumber}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              onClick={() => onWeekSelect(w.weekNumber)}
              className={`shrink-0 flex flex-col items-center min-w-[100px] px-3 py-2 rounded-lg border text-left transition-colors ${
                isSelected
                  ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <span className="text-xs font-semibold text-gray-800">Week {w.weekNumber}</span>
              <span className="text-[10px] text-gray-600 mt-0.5 truncate max-w-full" title={w.phaseLabel}>
                {w.phaseLabel || `Week ${w.weekNumber}`}
              </span>
              <span className="text-[10px] text-gray-500 mt-1">{progressStr}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
