/**
 * StepTracker — Shared progress UI for any flow that takes more than ~5s.
 *
 * Two driving modes (hybrid):
 *   1. Backend-driven   → pass `currentStageKey` (and optionally `progressPercentage`).
 *      Stage advances when the parent updates the prop (e.g. from a poll).
 *   2. Timed schedule   → omit `currentStageKey`. Each stage's `etaSeconds` is summed
 *      and the tracker auto-advances based on elapsed time. The final stage stays
 *      "in progress" until the parent flips `status` to 'completed'.
 *
 * Mix and match: start in timed mode, then take over with `currentStageKey` once
 * the backend starts emitting real progress.
 *
 * Modeled on the BOLT strategy-card progress UI (pages/command-center/bolt-*-strategy.tsx).
 */
import React, { useEffect, useMemo, useState } from 'react';

export type StepDef = {
  /** Unique stage key. Backend-driven mode matches this against `currentStageKey`
   *  (exact, or `currentStageKey.startsWith(key)` for sub-stages). */
  key: string;
  label: string;
  /** Tentative duration in seconds — required for timed-schedule mode, optional otherwise. */
  etaSeconds?: number;
};

export type StepTrackerStatus = 'running' | 'completed' | 'failed';

export type StepTrackerAccent = 'violet' | 'amber' | 'emerald' | 'sky' | 'rose' | 'indigo';

export type StepTrackerProps = {
  stages: StepDef[];
  /** Epoch ms when the operation started. Drives the elapsed timer. */
  startedAt: number;
  /** Backend-driven current stage key. If omitted, falls back to timed auto-advance. */
  currentStageKey?: string;
  /** Explicit 0–100 percent. If omitted, derived from current stage index. */
  progressPercentage?: number;
  /** Optional ETA refinement shown next to elapsed timer. */
  estimatedSecondsRemaining?: number;
  status?: StepTrackerStatus;
  errorMessage?: string;
  /** Optional sub-status line, e.g. "Week 2 of 4". */
  subLabel?: string;
  accent?: StepTrackerAccent;
  /** Header label, e.g. "Generating report". Defaults to "Working". */
  title?: string;
  /** Inline = compact (used inside cards). Card = standalone panel. */
  variant?: 'inline' | 'card';
  /** Optional extra Tailwind gradient class (e.g. for BOLT theming). Overrides accent gradient. */
  gradientClass?: string;
  className?: string;
};

const ACCENTS: Record<StepTrackerAccent, { gradient: string; spinner: string; bar: string; runningBg: string; doneBg: string }> = {
  violet:  { gradient: 'from-violet-600 to-purple-600',   spinner: 'text-violet-500',   bar: 'from-violet-600 to-purple-600',   runningBg: 'bg-violet-500',   doneBg: 'bg-violet-500'  },
  amber:   { gradient: 'from-amber-500 to-orange-500',    spinner: 'text-amber-600',    bar: 'from-amber-500 to-orange-500',    runningBg: 'bg-amber-500',    doneBg: 'bg-amber-500'   },
  emerald: { gradient: 'from-emerald-500 to-teal-500',    spinner: 'text-emerald-600',  bar: 'from-emerald-500 to-teal-500',    runningBg: 'bg-emerald-500',  doneBg: 'bg-emerald-500' },
  sky:     { gradient: 'from-sky-500 to-blue-600',        spinner: 'text-sky-600',      bar: 'from-sky-500 to-blue-600',        runningBg: 'bg-sky-500',      doneBg: 'bg-sky-500'     },
  rose:    { gradient: 'from-rose-500 to-pink-600',       spinner: 'text-rose-600',     bar: 'from-rose-500 to-pink-600',       runningBg: 'bg-rose-500',     doneBg: 'bg-rose-500'    },
  indigo:  { gradient: 'from-indigo-500 to-violet-600',   spinner: 'text-indigo-600',   bar: 'from-indigo-500 to-violet-600',   runningBg: 'bg-indigo-500',   doneBg: 'bg-indigo-500'  },
};

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${min}m ${s}s` : `${min}m`;
}

/** Find the stage index for a backend-emitted key. Supports `key.startsWith(stage.key)` for sub-stages. */
function resolveCurrentIndex(stages: StepDef[], key: string | undefined): number {
  if (!key) return -1;
  const exact = stages.findIndex((s) => s.key === key);
  if (exact !== -1) return exact;
  const prefix = stages.findIndex((s) => key.startsWith(`${s.key}-`) || key.startsWith(`${s.key}/`));
  return prefix;
}

/** Auto-advance index from elapsed time using stage ETAs. Stops at last stage (parent must finalize). */
function timedIndex(stages: StepDef[], elapsedMs: number): number {
  let acc = 0;
  for (let i = 0; i < stages.length; i++) {
    const eta = stages[i].etaSeconds ?? 0;
    if (eta <= 0) continue;
    acc += eta * 1000;
    if (elapsedMs < acc) return i;
  }
  return Math.max(0, stages.length - 1);
}

export default function StepTracker({
  stages,
  startedAt,
  currentStageKey,
  progressPercentage,
  estimatedSecondsRemaining,
  status = 'running',
  errorMessage,
  subLabel,
  accent = 'violet',
  title = 'Working',
  variant = 'card',
  gradientClass,
  className = '',
}: StepTrackerProps) {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startedAt);

  useEffect(() => {
    if (status !== 'running') return;
    setElapsedMs(Date.now() - startedAt);
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt, status]);

  const palette = ACCENTS[accent];
  const gradient = gradientClass || palette.gradient;
  const isFailed = status === 'failed';
  const isCompleted = status === 'completed';

  const currentIdx = useMemo(() => {
    if (isCompleted) return stages.length;
    if (currentStageKey) {
      const resolved = resolveCurrentIndex(stages, currentStageKey);
      if (resolved !== -1) return resolved;
    }
    const anyEta = stages.some((s) => (s.etaSeconds ?? 0) > 0);
    if (anyEta) return timedIndex(stages, elapsedMs);
    return 0;
  }, [stages, currentStageKey, elapsedMs, isCompleted]);

  const pct = useMemo(() => {
    if (typeof progressPercentage === 'number') return Math.min(100, Math.max(0, progressPercentage));
    if (isCompleted) return 100;
    if (stages.length === 0) return 0;
    // Roughly: each completed step is worth (100 / stages.length); the in-progress step adds half its share.
    const base = (currentIdx / stages.length) * 100;
    const inStep = currentIdx < stages.length ? 50 / stages.length : 0;
    return Math.min(99, Math.max(0, base + inStep));
  }, [progressPercentage, isCompleted, currentIdx, stages.length]);

  const wrapperClass =
    variant === 'card'
      ? `rounded-xl border border-gray-200 bg-white shadow-sm ${className}`
      : `bg-white ${className}`;

  const padding = variant === 'card' ? 'px-5 py-4' : 'px-4 pb-4 pt-3';

  return (
    <div className={wrapperClass} role="status" aria-live="polite">
      <div className={padding}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            {isFailed ? (
              <span className="w-4 h-4 text-red-500 font-bold leading-none">✕</span>
            ) : isCompleted ? (
              <span className={`w-4 h-4 ${palette.spinner} font-bold leading-none`}>✓</span>
            ) : (
              <svg className={`animate-spin w-4 h-4 flex-shrink-0 ${palette.spinner}`} fill="none" viewBox="0 0 24 24" aria-hidden>
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
            <span className="text-xs font-bold text-gray-800 truncate">
              {isFailed ? `${title} — failed` : isCompleted ? `${title} — done` : title}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-400 flex-shrink-0">
            {!isCompleted && !isFailed && typeof estimatedSecondsRemaining === 'number' && estimatedSecondsRemaining > 0 && (
              <span>~{formatElapsed(estimatedSecondsRemaining * 1000)} left</span>
            )}
            <span>{formatElapsed(elapsedMs)}</span>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-1.5 mb-3">
          {stages.map((step, i) => {
            const isDone = currentIdx > i || isCompleted;
            const isCurrent = currentIdx === i && !isCompleted;
            const dotClass =
              isFailed && isCurrent
                ? 'bg-red-500 text-white'
                : isDone
                ? `${palette.doneBg} text-white`
                : isCurrent
                ? `bg-gradient-to-br ${gradient} text-white animate-pulse`
                : 'bg-gray-100 text-gray-400';
            const labelClass = isDone
              ? 'text-gray-400 line-through'
              : isCurrent
              ? 'text-gray-800'
              : 'text-gray-300';
            return (
              <div key={step.key} className="flex items-center gap-2">
                <div className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${dotClass}`}>
                  {isDone ? '✓' : isCurrent && !isFailed ? '…' : i + 1}
                </div>
                <span className={`text-[11px] font-medium leading-snug ${labelClass}`}>
                  {step.label}
                  {isCurrent && step.etaSeconds && !currentStageKey ? (
                    <span className="text-gray-300 font-normal"> · ~{step.etaSeconds}s</span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>

        {/* Sub-status */}
        {subLabel && !isFailed && (
          <p className="text-[11px] text-gray-500 mb-2 leading-snug">{subLabel}</p>
        )}

        {/* Bar */}
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full bg-gradient-to-r ${gradient} rounded-full transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {isFailed && errorMessage && (
          <p className="text-[11px] text-red-600 mt-2 leading-snug">{errorMessage}</p>
        )}
      </div>
    </div>
  );
}
