import React from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, Circle } from 'lucide-react';
import { useSetupProgress } from '../hooks/useSetupProgress';

/**
 * SetupProgress — lightweight, non-blocking progress indicator.
 *
 * Shows a compact progress bar with the next recommended action.
 * Never blocks the user. Dismissible. Collapses when complete.
 *
 * Usage: <SetupProgress /> (place in command center or dashboard)
 */
export default function SetupProgress() {
  const { items, overallPercent, nextItem, loading, level1Complete } = useSetupProgress();

  // Don't show if loading or 100% complete
  if (loading || overallPercent === 100) return null;

  const completedCount = items.filter((i) => i.completed).length;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      {/* Header row: label + percentage */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {level1Complete ? 'Improve your results' : 'Quick setup'}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {level1Complete
              ? 'Optional — add more details for better AI output'
              : 'Complete these steps to get the most from Omnivyra'
            }
          </p>
        </div>
        <span className="text-sm font-bold text-gray-700">
          {completedCount}/{items.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-700"
          style={{ width: `${overallPercent}%` }}
        />
      </div>

      {/* Checklist — compact */}
      <div className="space-y-1.5">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="flex items-center gap-2 group"
          >
            {item.completed ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
            ) : (
              <Circle className="w-4 h-4 text-gray-300 shrink-0" />
            )}
            <span className={`text-sm flex-1 transition-colors ${
              item.completed
                ? 'text-gray-400 line-through'
                : 'text-gray-700 group-hover:text-blue-600'
            }`}>
              {item.label}
            </span>
            {!item.completed && (
              <ChevronRight className="w-3.5 h-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            )}
          </Link>
        ))}
      </div>

      {/* Next action CTA */}
      {nextItem && (
        <Link
          href={nextItem.href}
          className="mt-3 block w-full text-center px-4 py-2 text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
        >
          {nextItem.label}
        </Link>
      )}
    </div>
  );
}
