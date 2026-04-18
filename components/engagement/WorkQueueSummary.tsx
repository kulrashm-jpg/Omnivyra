/**
 * WorkQueueSummary - displays work queue metrics above the workspace.
 */

import React from 'react';
import type { WorkQueue } from '@/hooks/useWorkQueue';

export interface WorkQueueSummaryProps {
  workQueue: WorkQueue;
  loading?: boolean;
  className?: string;
}

export const WorkQueueSummary = React.memo(function WorkQueueSummary({
  workQueue,
  loading = false,
  className = '',
}: WorkQueueSummaryProps) {
  const totalActionable = workQueue.total_actionable_threads ?? 0;
  const highPriority = (workQueue.platforms ?? []).reduce(
    (sum, p) => sum + (p.high_priority_threads ?? 0),
    0
  );
  const activePlatforms = (workQueue.platforms ?? []).filter(
    (platform) => (platform.actionable_threads ?? 0) > 0 || (platform.high_priority_threads ?? 0) > 0
  ).length;

  if (loading) {
    return (
      <div className={`shrink-0 border-b border-slate-200 bg-slate-50/80 px-4 py-4 animate-pulse ${className}`}>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="h-20 rounded-2xl bg-slate-200" />
          <div className="h-20 rounded-2xl bg-slate-200" />
          <div className="h-20 rounded-2xl bg-slate-200" />
        </div>
      </div>
    );
  }

  return (
    <div className={`shrink-0 border-b border-slate-200 bg-slate-50/80 px-4 py-4 ${className}`}>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Action Queue
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{totalActionable}</p>
          <p className="mt-1 text-sm text-slate-600">
            conversation{totalActionable === 1 ? '' : 's'} currently need a response
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">
            High Priority
          </p>
          <p className="mt-1 text-2xl font-bold text-amber-900">{highPriority}</p>
          <p className="mt-1 text-sm text-amber-800">
            thread{highPriority === 1 ? '' : 's'} need faster attention
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Active Platforms
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{activePlatforms}</p>
          <p className="mt-1 text-sm text-slate-600">
            platform{activePlatforms === 1 ? '' : 's'} with live queue activity
          </p>
        </div>
      </div>
    </div>
  );
});
