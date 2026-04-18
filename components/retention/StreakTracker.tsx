import React from 'react';
import { Flame } from 'lucide-react';
import type { StreakData } from '../../hooks/useRetention';

/**
 * StreakTracker — compact streak display.
 *
 * Shows current streak with flame icon.
 * Highlights milestones. Shows longest streak as tooltip.
 * Designed to fit in header bars, sidebars, or card headers.
 */

interface StreakTrackerProps {
  streak: StreakData;
  size?: 'sm' | 'md';
  className?: string;
}

export default function StreakTracker({ streak, size = 'sm', className = '' }: StreakTrackerProps) {
  if (streak.current === 0 && streak.longest === 0) return null;

  const isHot = streak.current >= 3;
  const isBlazing = streak.current >= 7;

  if (size === 'sm') {
    return (
      <div
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
          isBlazing
            ? 'bg-orange-100 text-orange-700'
            : isHot
              ? 'bg-amber-100 text-amber-700'
              : 'bg-gray-100 text-gray-600'
        } ${className}`}
        title={`Current: ${streak.current} days | Best: ${streak.longest} days`}
      >
        <Flame className={`w-3 h-3 ${isBlazing ? 'text-orange-500' : isHot ? 'text-amber-500' : 'text-gray-400'}`} />
        {streak.current}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
      isBlazing
        ? 'border-orange-200 bg-orange-50'
        : isHot
          ? 'border-amber-200 bg-amber-50'
          : 'border-gray-200 bg-gray-50'
    } ${className}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
        isBlazing ? 'bg-orange-100' : isHot ? 'bg-amber-100' : 'bg-gray-100'
      }`}>
        <Flame className={`w-5 h-5 ${
          isBlazing ? 'text-orange-500' : isHot ? 'text-amber-500' : 'text-gray-400'
        }`} />
      </div>
      <div>
        <p className="text-sm font-bold text-gray-900">
          {streak.current}-day streak
        </p>
        <p className="text-xs text-gray-500">
          {streak.current === streak.longest
            ? 'Personal best!'
            : `Best: ${streak.longest} days`
          }
        </p>
      </div>
    </div>
  );
}
