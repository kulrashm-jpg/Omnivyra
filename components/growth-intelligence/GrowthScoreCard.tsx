/**
 * Displays Growth Score, Label, and Score Color.
 * Pure UI. Uses lib/intelligence/growthIntelligenceTypes.
 */

import React from 'react';
import {
  type GrowthSummary,
  getGrowthScoreLabel,
  getGrowthScoreColor,
} from '@/lib/intelligence/growthIntelligenceTypes';

const COLOR_CLASSES: Record<string, { border: string; bg: string; text: string }> = {
  green: { border: 'border-green-500', bg: 'bg-green-50', text: 'text-green-700' },
  blue: { border: 'border-blue-500', bg: 'bg-blue-50', text: 'text-blue-700' },
  orange: { border: 'border-orange-500', bg: 'bg-orange-50', text: 'text-orange-700' },
  red: { border: 'border-red-500', bg: 'bg-red-50', text: 'text-red-700' },
};

export interface GrowthScoreCardProps {
  summary: GrowthSummary;
  className?: string;
}

export function GrowthScoreCard({ summary, className = '' }: GrowthScoreCardProps) {
  const label = getGrowthScoreLabel(summary.growthScore);
  const color = getGrowthScoreColor(summary.growthScore);
  const classes = COLOR_CLASSES[color] ?? COLOR_CLASSES.blue;

  return (
    <div
      className={`p-4 rounded-xl shadow-sm border-l-4 ${classes.border} ${classes.bg} ${className}`}
      role="status"
      aria-label={`Growth score: ${summary.growthScore}, ${label}`}
    >
      <div className={`text-2xl font-bold ${classes.text}`}>{summary.growthScore}</div>
      <div className="text-sm text-slate-600 mt-0.5">{label}</div>
    </div>
  );
}
