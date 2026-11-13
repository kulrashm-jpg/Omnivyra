/**
 * CompanyProfileRefineProgress — step-by-step progress for "Refine with AI" on the
 * company profile.
 *
 * Reuses the shared StepTracker (components/progress/StepTracker.tsx, modelled on the
 * BOLT progress UI) instead of a bespoke spinner. The step labels and timings are the
 * existing REFINE_STEPS / REFINE_STEP_DELAYS from useCompanyProfileState, so this adds
 * no new copy or timing source. The refine API does not stream progress, so the
 * tracker runs in timed mode: the last step stays "in progress" until the request
 * finishes and the parent unmounts this component.
 */
import React, { useState } from 'react';
import StepTracker, { type StepDef } from '../progress/StepTracker';

/** Fallback ETA (seconds) for the final step, which has no following delay to diff against. */
export const FINAL_STEP_ETA_SECONDS = 15;

/**
 * Turn REFINE_STEPS + REFINE_STEP_DELAYS (ms offsets from start) into StepTracker stages.
 * Each stage's ETA is the gap until the next step starts; the last step uses
 * FINAL_STEP_ETA_SECONDS. A missing or non-increasing offset falls back to the final
 * ETA so the tracker never stalls on a zero-length step.
 */
export function buildRefineStages(steps: readonly string[], delaysMs: readonly number[]): StepDef[] {
  return steps.map((label, i) => {
    const start = delaysMs[i];
    const next = delaysMs[i + 1];
    const gap =
      typeof start === 'number' && typeof next === 'number' && next > start
        ? Math.round((next - start) / 1000)
        : FINAL_STEP_ETA_SECONDS;
    return {
      key: `refine-step-${i + 1}`,
      label: label.replace(/…$|\.\.\.$/, ''),
      etaSeconds: gap,
    };
  });
}

export type CompanyProfileRefineProgressProps = {
  steps: readonly string[];
  delaysMs: readonly number[];
};

export default function CompanyProfileRefineProgress({ steps, delaysMs }: CompanyProfileRefineProgressProps) {
  // Mounted only while a refine is running, so mount time is the start time.
  const [startedAt] = useState(() => Date.now());
  const stages = buildRefineStages(steps, delaysMs);
  return (
    <div className="space-y-2">
      <StepTracker
        stages={stages}
        startedAt={startedAt}
        status="running"
        accent="indigo"
        title="Refining your company profile with AI"
        variant="card"
      />
      <p className="text-xs text-slate-600">
        Usually under a minute. Your website stays locked and will not be overwritten.
      </p>
    </div>
  );
}
