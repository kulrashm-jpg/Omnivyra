/**
 * WorkQueueSummary — displays work queue metrics above the workspace.
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

  if (loading) {
    return (
      <div className={`shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3 animate-pulse ${className}`}>
        <div className="h-12 rounded bg-slate-200 w-full max-w-md" />
      </div>
    );
  }

  return (
    <div className={`shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-slate-700">
          <strong>{totalActionable}</strong> conversation{totalActionable === 1 ? '' : 's'} needing response
        </span>
        <span className="text-slate-500">|</span>
        <span className="text-slate-700">
          <strong>{highPriority}</strong> high priority discussion{highPriority === 1 ? '' : 's'}
        </span>
        <span className="text-slate-500">|</span>
        <span className="text-slate-700">
          Potential leads detected — <em>coming soon</em>
        </span>
      </div>
    </div>
  );
});
