'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

type ProgressStage = {
  label: string;
  description: string;
};

type Props = {
  open: boolean;
  title: string;
  subtitle: string;
  estimatedSeconds?: number;
  stages: ProgressStage[];
  theme?: 'purple' | 'amber';
};

const THEME_STYLES = {
  purple: {
    panel: 'border-purple-200 bg-white',
    badge: 'bg-purple-50 text-purple-700 border-purple-200',
    progress: 'from-purple-600 via-fuchsia-500 to-indigo-500',
    currentDot: 'bg-purple-600',
    currentText: 'text-purple-700',
  },
  amber: {
    panel: 'border-amber-200 bg-white',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    progress: 'from-amber-500 via-orange-500 to-rose-500',
    currentDot: 'bg-amber-600',
    currentText: 'text-amber-700',
  },
} as const;

export default function GenerationProgressTracker({
  open,
  title,
  subtitle,
  estimatedSeconds = 24,
  stages,
  theme = 'purple',
}: Props) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const styles = THEME_STYLES[theme];

  useEffect(() => {
    if (!open) {
      setElapsedMs(0);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);

    return () => window.clearInterval(timer);
  }, [open]);

  const currentStageIndex = useMemo(() => {
    if (!open || stages.length === 0) return 0;
    const perStageMs = Math.max(2500, Math.round((estimatedSeconds * 1000) / Math.max(stages.length, 1)));
    const rawIndex = Math.floor(elapsedMs / perStageMs);
    return Math.min(stages.length - 1, rawIndex);
  }, [elapsedMs, estimatedSeconds, open, stages.length]);

  const progressPercent = useMemo(() => {
    if (!open || stages.length === 0) return 0;
    const totalMs = Math.max(estimatedSeconds * 1000, 1000);
    if (elapsedMs >= totalMs) {
      return 94;
    }
    const perStageMs = Math.max(2500, Math.round((estimatedSeconds * 1000) / Math.max(stages.length, 1)));
    const stageProgress = Math.min(1, (elapsedMs % perStageMs) / perStageMs);
    const completedStages = currentStageIndex / stages.length;
    const inFlightStages = stageProgress / stages.length;
    return Math.min(94, Math.max(8, Math.round((completedStages + inFlightStages) * 100)));
  }, [currentStageIndex, elapsedMs, estimatedSeconds, open, stages.length]);

  const remainingSeconds = Math.max(0, Math.ceil(estimatedSeconds - elapsedMs / 1000));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className={`w-full max-w-2xl rounded-3xl border shadow-2xl ${styles.panel}`}>
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${styles.badge}`}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                In progress
              </div>
              <h2 className="mt-3 text-xl font-bold text-slate-900">{title}</h2>
              <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-2xl font-bold text-slate-900">{progressPercent}%</p>
              <p className="text-xs text-slate-500">
                {remainingSeconds > 0 ? `About ${remainingSeconds}s left` : 'Finalizing now'}
              </p>
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${styles.progress} transition-[width] duration-300 ease-out`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="px-6 py-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Progress Tracker
          </p>
          <div className="space-y-3">
            {stages.map((stage, index) => {
              const isDone = index < currentStageIndex;
              const isCurrent = index === currentStageIndex;
              const isNext = index > currentStageIndex;

              return (
                <div
                  key={`${stage.label}-${index}`}
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition-all ${
                    isCurrent
                      ? 'border-slate-300 bg-slate-50'
                      : isDone
                      ? 'border-emerald-200 bg-emerald-50/70'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {isDone ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : isCurrent ? (
                      <div className={`flex h-5 w-5 items-center justify-center rounded-full ${styles.currentDot}`}>
                        <Loader2 className="h-3 w-3 animate-spin text-white" />
                      </div>
                    ) : (
                      <div className="h-5 w-5 rounded-full border border-slate-300 bg-white" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-semibold ${isCurrent ? styles.currentText : 'text-slate-800'}`}>
                        {stage.label}
                      </p>
                      <span className="text-[11px] text-slate-400">
                        {isDone ? 'Done' : isCurrent ? 'Working now' : 'Up next'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{stage.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
