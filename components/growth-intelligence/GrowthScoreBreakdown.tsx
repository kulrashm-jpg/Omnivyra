/**
 * Displays score breakdown items (label + contribution value).
 * Uses normalizeBreakdown from lib/intelligence/growthIntelligenceTypes.
 */

import React from 'react';
import {
  type GrowthScoreBreakdown,
  normalizeBreakdown,
} from '@/lib/intelligence/growthIntelligenceTypes';

export interface GrowthScoreBreakdownProps {
  breakdown?: GrowthScoreBreakdown;
  className?: string;
}

export function GrowthScoreBreakdown({ breakdown, className = '' }: GrowthScoreBreakdownProps) {
  const items = normalizeBreakdown(breakdown);

  if (items.length === 0) return null;

  return (
    <div className={`p-4 rounded-xl shadow-sm border border-slate-100 ${className}`}>
      <h4 className="text-sm font-medium text-slate-700 mb-3">Score Breakdown</h4>
      <ul className="space-y-2" role="list">
        {items.map(({ label, value }) => (
          <li key={label} className="flex justify-between items-center text-sm">
            <span className="text-slate-600">{label}</span>
            <span className="font-medium text-slate-900">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
