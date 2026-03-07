/**
 * Weekly Activity Board — Phase 3 board grouping cards by scheduled_day.
 * 7 columns: Mon, Tue, Wed, Thu, Fri, Sat, Sun.
 * Includes "Improve Plan" button and Phase 4 "Apply edit" for AI-assisted schedule edits.
 */

import React, { useState } from 'react';
import { Sparkles, Wand2 } from 'lucide-react';
import WeeklyActivityCard from './WeeklyActivityCard';
import type { WeeklyActivity } from '@/lib/planning/weeklyActivityAdapter';

const DAY_COLUMNS = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 7, label: 'Sun' },
] as const;

export interface DistributionInsight {
  type: string;
  severity: 'info' | 'warning';
  message: string;
  recommendation?: string;
}

export interface WeeklyActivityBoardProps {
  activities: WeeklyActivity[];
  weekNumber?: number;
  weekTheme?: string;
  campaignId?: string;
  /** Phase 5: Distribution insights from contentDistributionIntelligence. Show banner if length > 0. */
  distributionInsights?: DistributionInsight[];
  onOpenWorkspace?: (activity: WeeklyActivity) => void;
  onEditSchedule?: (activity: WeeklyActivity) => void;
  onMoveCard?: (activity: WeeklyActivity) => void;
  onRegenerate?: (activity: WeeklyActivity) => void;
  onImprovePlan?: () => void;
  /** Phase 4: Apply schedule edit from natural language. Calls API then invokes onEditApplied. */
  onEditApplied?: () => void;
}

export default function WeeklyActivityBoard({
  activities,
  weekNumber,
  weekTheme,
  campaignId,
  distributionInsights = [],
  onOpenWorkspace,
  onEditSchedule,
  onMoveCard,
  onRegenerate,
  onImprovePlan,
  onEditApplied,
}: WeeklyActivityBoardProps) {
  const hasInsights = Array.isArray(distributionInsights) && distributionInsights.length > 0;
  const [editInstruction, setEditInstruction] = useState('');
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const handleApplyEdit = async () => {
    if (!campaignId || weekNumber == null || !editInstruction.trim() || !onEditApplied) return;
    setApplyLoading(true);
    setApplyError(null);
    try {
      const res = await fetch('/api/campaigns/apply-weekly-plan-edits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          campaignId,
          weekNumber,
          instruction: editInstruction.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setApplyError(data?.error ?? data?.details ?? 'Failed to apply edit');
        return;
      }
      setEditInstruction('');
      onEditApplied();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setApplyLoading(false);
    }
  };

  const byDay = React.useMemo(() => {
    const map: Record<number, WeeklyActivity[]> = {};
    for (const col of DAY_COLUMNS) {
      map[col.day] = [];
    }
    for (const a of activities) {
      const day = a.scheduled_day;
      if (day >= 1 && day <= 7) {
        if (!map[day]) map[day] = [];
        map[day].push(a);
      }
    }
    return map;
  }, [activities]);

  return (
    <div className="space-y-4">
      {/* Header with Improve Plan + Apply edit */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-semibold text-gray-900">
          {weekNumber != null ? `Week ${weekNumber}` : 'Weekly Board'}
          {weekTheme ? `: ${weekTheme}` : ''}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {campaignId != null && weekNumber != null && onEditApplied && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={editInstruction}
                onChange={(e) => setEditInstruction(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApplyEdit()}
                placeholder="e.g. Move A3 to Friday morning"
                className="text-sm border border-gray-300 rounded px-2 py-1 w-48 focus:ring-1 focus:ring-purple-400 focus:border-purple-400"
                disabled={applyLoading}
              />
              <button
                type="button"
                onClick={handleApplyEdit}
                disabled={applyLoading || !editInstruction.trim()}
                className="inline-flex items-center gap-1 px-2 py-1 text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded disabled:opacity-50"
              >
                <Wand2 size={14} aria-hidden />
                Apply
              </button>
            </div>
          )}
          {onImprovePlan && (
            <button
              type="button"
              onClick={onImprovePlan}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
            >
              <Sparkles size={16} aria-hidden />
              Improve Plan
            </button>
          )}
        </div>
      </div>
      {applyError && (
        <p className="text-sm text-rose-600">{applyError}</p>
      )}

      {/* Phase 5: Plan improvements banner */}
      {hasInsights && onImprovePlan && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-amber-800">Plan improvements available</p>
            <p className="text-sm text-amber-700 mt-0.5">
              {distributionInsights[0]?.message}
              {distributionInsights.length > 1 ? ` (+${distributionInsights.length - 1} more)` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onImprovePlan}
            className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
          >
            <Sparkles size={16} aria-hidden />
            Improve Plan
          </button>
        </div>
      )}

      {/* 7-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {DAY_COLUMNS.map(({ day, label }) => (
          <div
            key={day}
            className="min-h-[120px] rounded-lg border border-gray-200 bg-gray-50/50 p-2"
          >
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              {label}
            </div>
            <div className="space-y-2">
              {(byDay[day] ?? []).map((activity) => (
                <WeeklyActivityCard
                  key={activity.content_code + (activity.week_number ?? '')}
                  activity={activity}
                  onOpenWorkspace={onOpenWorkspace}
                  onEditSchedule={onEditSchedule}
                  onMoveCard={onMoveCard}
                  onRegenerate={onRegenerate}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
