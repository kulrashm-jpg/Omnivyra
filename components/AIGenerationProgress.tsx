/**
 * Shows progress with real elapsed time and estimated time remaining for AI generation
 * when the backend does not stream progress (single long-running request).
 *
 * Optional `stages`: when passed (non-empty), the progress renders as the shared
 * step-by-step StepTracker (components/progress/StepTracker.tsx, modelled on BOLT) so the
 * user sees which step the AI is on. Without `stages` the rendering is unchanged.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import StepTracker, { type StepDef } from './progress/StepTracker';

/** A step for the step-by-step view: a bare label, or a label with its own ETA in seconds. */
export type AIGenerationStage = string | { label: string; etaSeconds?: number };

/**
 * Normalise `stages` into StepTracker stage definitions. Bare labels (or entries without
 * a positive ETA) share whatever is left of `expectedSeconds` evenly, with a 1s floor so
 * the timed tracker never stalls on a zero-length step.
 */
export function toStepDefs(stages: readonly AIGenerationStage[], expectedSeconds: number): StepDef[] {
  const explicit = stages.map((s) => (typeof s === 'string' ? undefined : s.etaSeconds));
  const explicitTotal = explicit.reduce<number>((sum, e) => sum + (e && e > 0 ? e : 0), 0);
  const unsetCount = explicit.filter((e) => !(e && e > 0)).length;
  const share = unsetCount > 0 ? Math.max(1, Math.round(Math.max(0, expectedSeconds - explicitTotal) / unsetCount)) : 0;
  return stages.map((s, i) => {
    const label = typeof s === 'string' ? s : s.label;
    const eta = explicit[i];
    return { key: `ai-stage-${i + 1}`, label, etaSeconds: eta && eta > 0 ? eta : share };
  });
}

/** Format seconds as M:SS (e.g. 1:23) */
function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type AIGenerationProgressProps = {
  /** Whether generation is in progress */
  isActive: boolean;
  /** Message shown while generating (e.g. "Generating strategic themes…") */
  message: string;
  /** Typical duration in seconds; used for progress bar and "about X s remaining" (default 45) */
  expectedSeconds?: number;
  /** Max duration hint in seconds (e.g. 180); shown as "May take up to N min" when past expected (optional) */
  maxSecondsHint?: number;
  /** Optional class for the container */
  className?: string;
  /** Optional rotating sub-messages shown below the main message (cycle every few seconds, highlighted) */
  rotatingMessages?: string[];
  /** Optional cancel callback; when set, a Cancel button is shown */
  onCancel?: () => void;
  /**
   * Optional named steps. When non-empty, renders the step-by-step StepTracker (titled with
   * `message`) instead of the single-line bar; steps advance on a timer derived from
   * `expectedSeconds` and the last step holds until `isActive` turns false.
   */
  stages?: readonly AIGenerationStage[];
};

function useElapsedAndETA(isActive: boolean, expectedSeconds: number) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      startRef.current = null;
      setElapsedSeconds(0);
      return;
    }
    startRef.current = Date.now();
    setElapsedSeconds(0);
    const id = setInterval(() => {
      if (startRef.current == null) return;
      setElapsedSeconds(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const estimatedRemaining = Math.max(0, expectedSeconds - elapsedSeconds);
  const progressPercent = !isActive
    ? 0
    : elapsedSeconds >= expectedSeconds
      ? 90
      : Math.min(90, (elapsedSeconds / expectedSeconds) * 90);

  return { elapsedSeconds, estimatedRemaining, progressPercent };
}

const ROTATE_INTERVAL_MS = 3200;

export default function AIGenerationProgress({
  isActive,
  message,
  expectedSeconds = 45,
  maxSecondsHint,
  className = '',
  rotatingMessages,
  onCancel,
  stages,
}: AIGenerationProgressProps) {
  const { elapsedSeconds, estimatedRemaining, progressPercent } = useElapsedAndETA(isActive, expectedSeconds);
  // Start time for the step view; re-captured each time generation becomes active.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const startedAt = useMemo(() => Date.now(), [isActive]);
  const [rotatingIndex, setRotatingIndex] = useState(0);
  const messages = rotatingMessages && rotatingMessages.length > 0 ? rotatingMessages : [];

  useEffect(() => {
    if (!isActive || messages.length <= 1) return;
    const id = setInterval(() => {
      setRotatingIndex((i) => (i + 1) % messages.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isActive, messages.length]);

  if (!isActive) return null;

  if (stages && stages.length > 0) {
    return (
      <div className={className}>
        <StepTracker
          stages={toStepDefs(stages, expectedSeconds)}
          startedAt={startedAt}
          status="running"
          accent="indigo"
          title={message}
          subLabel={messages[rotatingIndex]}
          variant="card"
        />
        {onCancel && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  const elapsedLabel = `${formatElapsed(elapsedSeconds)} elapsed`;
  const timeLabel =
    estimatedRemaining > 0
      ? `About ${estimatedRemaining} s remaining · ${elapsedLabel}`
      : maxSecondsHint != null && elapsedSeconds < maxSecondsHint
        ? `Still working… · ${elapsedLabel} (may take up to ${Math.ceil(maxSecondsHint / 60)} min)`
        : `Still working… · ${elapsedLabel}`;
  const currentRotating = messages[rotatingIndex];

  return (
    <div
      className={`rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-4 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-indigo-800 min-w-0">
          <svg
            className="animate-spin h-4 w-4 text-indigo-600 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>{message}</span>
        </div>
        <span className="text-xs font-medium text-indigo-600 tabular-nums shrink-0" aria-hidden>
          {formatElapsed(elapsedSeconds)}
        </span>
      </div>
      {currentRotating && (
        <p key={rotatingIndex} className="text-xs font-medium text-indigo-700 mb-2 pl-6 transition-opacity duration-300">
          {currentRotating}
        </p>
      )}
      <div className="h-2 bg-indigo-200/60 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <p className="text-xs text-indigo-700">{timeLabel}</p>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
