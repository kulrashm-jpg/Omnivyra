/**
 * BOLT Campaign Plan Generation — Progress Modal
 * Shows stage, progress bar, and animation during BOLT execution.
 */

import React, { useState, useEffect } from 'react';

const STAGE_LABELS: Record<string, string> = {
  'source-recommendation': 'Getting ready to prepare week plan',
  'ai/plan': 'Creating week plan',
  'commit-plan': 'Saving blueprint',
  'generate-weekly-structure': 'Creating daily plans',
  'schedule-structured-plan': 'Scheduling content',
  'schedule-creating-content': 'Creating content',
  'schedule-repurposing-content': 'Repurposing content',
  'schedule-writing-posts': 'Scheduling content',
};

/** Also handle sub-stage names like generate-weekly-structure-week-1 */
function getStageLabel(stage: string | undefined, status?: string): string {
  if (!stage) return status === 'completed' ? 'Complete' : 'Initializing…';
  if (STAGE_LABELS[stage]) return STAGE_LABELS[stage];
  if (stage.startsWith('generate-weekly-structure-week-')) {
    const weekNum = stage.replace(/\D/g, '') || '';
    return weekNum ? `Creating daily plans (Week ${weekNum})` : 'Creating daily plans';
  }
  if (stage.startsWith('generate-weekly-structure-weeks-')) return 'Creating daily plans';
  return stage.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${min}m ${s}s` : `${min}m`;
}

export type BOLTProgress = {
  stage?: string;
  status?: string;
  progress_percentage?: number;
  error_message?: string;
  weeks_generated?: number;
  daily_slots_created?: number;
  scheduled_posts_created?: number;
};

export type BOLTProgressModalProps = {
  open: boolean;
  progress: BOLTProgress | null;
};

export default function BOLTProgressModal({ open, progress }: BOLTProgressModalProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!open) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    const tick = () => setElapsedMs(Date.now() - start);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  const pct = Math.min(100, Math.max(0, progress?.progress_percentage ?? 0));
  const stageLabel = getStageLabel(progress?.stage, progress?.status);
  const isFailed = progress?.status === 'failed';
  const errorMsg = progress?.error_message;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bolt-progress-title"
      aria-live="polite"
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-amber-200 bg-white shadow-xl">
        <div className="px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
              <svg
                className={`h-5 w-5 text-amber-600 ${isFailed ? '' : 'animate-spin'}`}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden
              >
                {isFailed ? (
                  <path
                    fill="currentColor"
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                  />
                ) : (
                  <>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </>
                )}
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h2 id="bolt-progress-title" className="text-lg font-semibold text-gray-900">
                {isFailed ? 'Generation failed' : progress?.status === 'completed' ? 'Complete' : 'Generating campaign plan'}
              </h2>
            </div>
          </div>

          {/* Status box: shows current stage message, updates live as each stage completes */}
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Status
          </div>
          <div
            className={`mb-4 rounded-lg border-2 px-4 py-3 ${
              progress?.status === 'completed'
                ? 'border-green-200 bg-green-50'
                : isFailed
                  ? 'border-red-200 bg-red-50'
                  : 'border-amber-200 bg-amber-50'
            }`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <p
              className={`text-base font-semibold ${
                progress?.status === 'completed'
                  ? 'text-green-900'
                  : isFailed
                    ? 'text-red-800'
                    : 'text-amber-900'
              }`}
            >
              {stageLabel}
            </p>
            {!isFailed && progress?.status !== 'completed' && (
              <p className="text-xs text-amber-700 mt-1">
                Updates as each stage completes
              </p>
            )}
          </div>

          {!isFailed && (
            <div className="space-y-2">
              <div className="h-2.5 bg-amber-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>{pct}%</span>
                <span>{formatElapsed(elapsedMs)} elapsed</span>
              </div>
            </div>
          )}

          {progress?.weeks_generated != null && progress.weeks_generated > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              {progress.weeks_generated} week{progress.weeks_generated !== 1 ? 's' : ''} generated
              {progress.daily_slots_created != null && progress.daily_slots_created > 0 && (
                <> · {progress.daily_slots_created} daily slots</>
              )}
            </p>
          )}

          {errorMsg && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-sm text-red-800">{errorMsg}</p>
            </div>
          )}

          {!isFailed && (
            <p className="mt-3 text-xs text-gray-500">
              Typically 1–3 min. Progress updates every few seconds.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
