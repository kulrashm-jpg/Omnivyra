/**
 * Unified job status panel for all engines (Trend, Market Pulse, Active Leads).
 * Shows progress_stage during RUNNING, elapsed time, and terminal state with confidence/error.
 */

import React, { useState, useEffect } from 'react';

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

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${min}m ${s}s` : `${min}m`;
}

export type EngineJobStatusPanelProps = {
  status: string;
  progressStage?: string | null;
  confidenceIndex?: number | null;
  error?: string | null;
  /** Job start time (ISO string or timestamp) for elapsed time display */
  createdAt?: string | number | null;
  /** Hint shown when running (e.g. "Typically 1–5 min for Market Pulse") */
  durationHint?: string;
};

export default function EngineJobStatusPanel({
  status,
  progressStage,
  confidenceIndex,
  error,
  createdAt,
  durationHint = 'Typically 1–5 min depending on regions',
}: EngineJobStatusPanelProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const isActive = status === 'PENDING' || status === 'RUNNING';

  useEffect(() => {
    if (!isActive || !createdAt) return;
    const start = typeof createdAt === 'string' ? new Date(createdAt).getTime() : Number(createdAt);
    if (isNaN(start)) return;
    const tick = () => setElapsedMs(Date.now() - start);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isActive, createdAt]);

  if (!status) return null;

  const elapsedEl = elapsedMs > 0 ? (
    <span className="font-medium ml-2">({formatElapsed(elapsedMs)})</span>
  ) : null;
  const hintEl = isActive && durationHint ? (
    <div className="mt-1.5 text-xs opacity-90">{durationHint}</div>
  ) : null;

  if (status === 'PENDING') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm text-amber-800">
        🟡 Initializing…{elapsedEl}
        {hintEl}
      </div>
    );
  }

  if (status === 'RUNNING') {
    const label = progressStage ? PROGRESS_LABELS[progressStage] ?? progressStage : 'Processing…';
    return (
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-800">
        <span>{label}</span>{elapsedEl}
        {hintEl}
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
    const isCancelled = (error ?? '').includes('Cancelled by user');
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {isCancelled ? '⏹ Cancelled' : '❌ Failed'}
        {error && !isCancelled && <div className="mt-1">{error}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      {status}
    </div>
  );
}
