/**
 * Unified job status panel for all engines (Trend, Market Pulse, Active Leads).
 * Shows progress_stage during RUNNING and terminal state with confidence/error.
 */

import React from 'react';

const PROGRESS_LABELS: Record<string, string> = {
  INITIALIZING: 'Preparing intelligence engine',
  SCANNING: 'Scanning sources',
  ANALYZING: 'Analyzing patterns',
  QUALIFYING: 'Evaluating signal strength',
  CONSOLIDATING: 'Building global intelligence',
  CLUSTERING: 'Detecting opportunity clusters',
  FINALIZING: 'Finalizing output',
  FINISHED: 'Finalizing output',
};

export type EngineJobStatusPanelProps = {
  status: string;
  progressStage?: string | null;
  confidenceIndex?: number | null;
  error?: string | null;
};

export default function EngineJobStatusPanel({
  status,
  progressStage,
  confidenceIndex,
  error,
}: EngineJobStatusPanelProps) {
  if (!status) return null;

  if (status === 'PENDING') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm text-amber-800">
        🟡 Initializing…
      </div>
    );
  }

  if (status === 'RUNNING') {
    const label = progressStage ? PROGRESS_LABELS[progressStage] ?? progressStage : 'Processing…';
    return (
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-800">
        {label}
      </div>
    );
  }

  if (status === 'COMPLETED') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50/50 px-4 py-3 text-sm text-green-800">
        <span>✅ Completed</span>
        {typeof confidenceIndex === 'number' && (
          <span className="ml-2 font-medium">Confidence: {confidenceIndex}%</span>
        )}
      </div>
    );
  }

  if (status === 'COMPLETED_WITH_WARNINGS') {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        ⚠ Completed with partial warnings
      </div>
    );
  }

  if (status === 'FAILED') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        ❌ Failed
        {error && <div className="mt-1">{error}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      {status}
    </div>
  );
}
