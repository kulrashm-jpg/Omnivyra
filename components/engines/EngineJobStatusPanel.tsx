/**
 * Unified job status panel for all engines (Trend, Market Pulse, Active Leads).
 * Shows progress_stage during RUNNING, elapsed time, and terminal state with confidence/error.
 */

import React, { useEffect, useState } from 'react';

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

const PROGRESS_STEPS = [
  { key: 'INITIALIZING', label: 'Preparing', percent: 15 },
  { key: 'SCANNING', label: 'Scanning', percent: 45 },
  { key: 'ANALYZING', label: 'Analyzing', percent: 60 },
  { key: 'QUALIFYING', label: 'Qualifying', percent: 72 },
  { key: 'CONSOLIDATING', label: 'Building', percent: 88 },
  { key: 'FINALIZING', label: 'Finalizing', percent: 96 },
  { key: 'FINISHED', label: 'Done', percent: 100 },
];

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
  /** Hint shown when running (e.g. "Typically 1-5 min for Market Pulse") */
  durationHint?: string;
};

export default function EngineJobStatusPanel({
  status,
  progressStage,
  confidenceIndex,
  error,
  createdAt,
  durationHint = 'Typically 1-5 min depending on regions',
}: EngineJobStatusPanelProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const normalizedStatus = String(status || '').toUpperCase();
  const isActive = normalizedStatus === 'PENDING' || normalizedStatus === 'RUNNING';

  useEffect(() => {
    if (!isActive || !createdAt) return;
    const start = typeof createdAt === 'string' ? new Date(createdAt).getTime() : Number(createdAt);
    if (isNaN(start)) return;
    const tick = () => setElapsedMs(Date.now() - start);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isActive, createdAt]);

  if (!normalizedStatus) return null;

  const elapsedEl = elapsedMs > 0 ? (
    <span className="ml-2 font-medium">({formatElapsed(elapsedMs)})</span>
  ) : null;
  const pendingLooksStalled = normalizedStatus === 'PENDING' && elapsedMs > 60_000;
  const hintEl = isActive && durationHint ? (
    <div className="mt-1.5 text-xs opacity-90">
      {pendingLooksStalled
        ? 'Still waiting for the scan worker. If this is local development, start the full worker stack or refresh to trigger the local fallback.'
        : durationHint}
    </div>
  ) : null;
  const normalizedStage = String(progressStage || (normalizedStatus === 'PENDING' ? 'INITIALIZING' : '')).toUpperCase();
  const currentStepIndex = Math.max(0, PROGRESS_STEPS.findIndex((step) => step.key === normalizedStage));
  const activePercent = normalizedStatus === 'COMPLETED' || normalizedStatus === 'COMPLETED_WITH_WARNINGS'
    ? 100
    : normalizedStatus === 'FAILED'
      ? Math.max(8, PROGRESS_STEPS[currentStepIndex]?.percent ?? 20)
      : PROGRESS_STEPS[currentStepIndex]?.percent ?? 25;
  const progressTracker = isActive ? (
    <div className="mt-3">
      <div
        className="h-2 overflow-hidden rounded-full bg-white/70 ring-1 ring-inset ring-current/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={activePercent}
      >
        <div
          className="h-full rounded-full bg-current transition-all duration-500"
          style={{ width: `${activePercent}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] font-medium sm:grid-cols-6">
        {PROGRESS_STEPS.slice(0, 6).map((step, index) => {
          const reached = index <= currentStepIndex;
          return (
            <div
              key={step.key}
              className={`flex min-w-0 items-center gap-1 ${reached ? 'opacity-100' : 'opacity-45'}`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${reached ? 'bg-current' : 'bg-current/40'}`} />
              <span className="truncate">{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  if (normalizedStatus === 'PENDING') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm text-amber-800">
        <span>{pendingLooksStalled ? 'Waiting for scan worker...' : 'Initializing scan...'}</span>{elapsedEl}
        {hintEl}
        {progressTracker}
      </div>
    );
  }

  if (normalizedStatus === 'RUNNING') {
    const label = progressStage ? PROGRESS_LABELS[normalizedStage] ?? progressStage : 'Processing...';
    return (
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-800">
        <span>{label}</span>{elapsedEl}
        {hintEl}
        {progressTracker}
      </div>
    );
  }

  if (normalizedStatus === 'COMPLETED') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50/50 px-4 py-3 text-sm text-green-800">
        <span>Completed</span>
        {typeof confidenceIndex === 'number' && (
          <span className="ml-2 font-medium">Confidence: {confidenceIndex}%</span>
        )}
      </div>
    );
  }

  if (normalizedStatus === 'COMPLETED_WITH_WARNINGS') {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Completed with partial warnings
      </div>
    );
  }

  if (normalizedStatus === 'FAILED') {
    const isCancelled = (error ?? '').includes('Cancelled by user');
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {isCancelled ? 'Cancelled' : 'Failed'}
        {error && !isCancelled && <div className="mt-1">{error}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      {normalizedStatus}
    </div>
  );
}
