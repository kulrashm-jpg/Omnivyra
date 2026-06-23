/**
 * Phase 6H-B — Shared BOLT progress renderer.
 *
 * Single source of truth for the in-card execution progress UI, extracted
 * verbatim from BOLT Text (the authority) so BOLT Creator and Intelligent Mix
 * render IDENTICAL fidelity: stage checklist, ai/plan substage line, week
 * counter, content-job progress, and failure message.
 *
 * Pure UI. Consumes ONLY the existing /api/bolt/progress payload (BOLTProgress).
 * No new API fields, no backend changes. Parameterized by the per-surface
 * `pipeline` (stage list) and the completed-dot color (`dotClass`).
 */

import React, { useState, useEffect } from 'react';
import type { BOLTProgress } from '../BOLTProgressModal';
// PHASE BOLT-PROGRESS-PARITY — stage ordering/labels/resolution now come from
// the single canonical authority. ProgressStep gains `backendStages` so the
// resolver maps runtime stages to canonical steps. ai/plan substage rendering
// below is unchanged (still keyed off `step.stage === 'ai/plan'`).
import { resolveCanonicalStageIndex, type ProgressStep } from '../../lib/shared/bolt/progressModel';

export type { BOLTProgress };
export type { ProgressStep };

export type ContentJobProgress = {
  total: number; done: number; failed: number; active: number;
  posts_scheduled: number; estimated_seconds_remaining: number | null;
  is_complete: boolean;
};

// Map a runtime stage to its index within the canonical pipeline (single authority).
function resolveStageIndex(stage: string | undefined, pipeline: ProgressStep[]): number {
  return resolveCanonicalStageIndex(stage, pipeline);
}

const AI_PLAN_FALLBACK_TIPS = [
  'Still working — drafting your weekly arc…',
  'Building a narrative that flows across all weeks…',
  'Cross-checking against your audience and goals…',
  'Optimizing the mix for your connected platforms…',
];

const AI_PLAN_SUBSTAGE_TIPS: Record<string, string> = {
  context: 'Gathering campaign context — pulling your brief, audience, and goals…',
  drafting: 'Drafting weekly themes — generating the strategic arc across all weeks…',
  scoring: 'Scoring strategic alignment — making sure each week ladders to your goals…',
  refining: 'Refining language and tone — polishing copy to match your brand voice…',
};

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${min}m ${s}s` : `${min}m`;
}

function AiPlanSubStageLine({ substage, substageLabel, elapsedMs }: {
  substage?: string;
  substageLabel?: string;
  elapsedMs: number;
}) {
  const [tipIdx, setTipIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTipIdx((i) => (i + 1) % AI_PLAN_FALLBACK_TIPS.length), 6000);
    return () => clearInterval(id);
  }, []);

  const detail =
    (substage && AI_PLAN_SUBSTAGE_TIPS[substage]) ||
    substageLabel ||
    AI_PLAN_FALLBACK_TIPS[tipIdx];

  const slowHint =
    elapsedMs > 90_000 ? 'Plans this rich sometimes take 2+ minutes — still on track.' : null;

  return (
    <div className="ml-6 -mt-0.5 mb-1">
      <p className="text-[10.5px] leading-snug text-amber-700">
        <span className="inline-block w-1 h-1 rounded-full bg-amber-400 mr-1.5 align-middle animate-pulse" />
        {detail}
      </p>
      {slowHint && (
        <p className="mt-0.5 text-[10px] leading-snug text-gray-400">{slowHint}</p>
      )}
    </div>
  );
}

/** Inline BOLT progress tracker, shared by all three builders. */
export function ProgressCard({ progress, pipeline, startedAt, dotClass = 'bg-violet-500', contentJobs }: {
  progress: BOLTProgress;
  pipeline: ProgressStep[];
  startedAt: number;
  dotClass?: string;
  contentJobs?: ContentJobProgress | null;
}) {
  const [elapsedMs, setElapsedMs] = useState(Date.now() - startedAt);

  useEffect(() => {
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const isCompleted = progress.status === 'completed';
  const isFailed    = progress.status === 'failed';
  const currentIdx  = isCompleted ? pipeline.length : resolveStageIndex(progress.stage, pipeline);
  const pct         = isCompleted ? 100 : Math.min(100, Math.max(0, progress.progress_percentage ?? 0));

  return (
    <div className="px-4 pb-4 pt-3 bg-white border-t border-gray-100">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isFailed ? (
            <span className="w-4 h-4 flex-shrink-0 text-red-500">✕</span>
          ) : isCompleted ? (
            <span className="w-4 h-4 flex-shrink-0 text-green-500 font-bold text-[13px]">✓</span>
          ) : (
            <svg className="animate-spin w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
          <span className="text-xs font-bold text-gray-800">
            {isFailed ? 'BOLT failed' : isCompleted ? 'BOLT complete!' : '⚡ BOLT running'}
          </span>
        </div>
        <span className="text-[11px] text-gray-400">{formatElapsed(elapsedMs)}</span>
      </div>

      {/* Stage pipeline */}
      <div className="space-y-1.5 mb-3">
        {pipeline.map((step, i) => {
          const isDone    = currentIdx > i;
          const isCurrent = !isCompleted && currentIdx === i;
          const showAiPlanDetail = isCurrent && step.stage === 'ai/plan';
          // PHASE DAILY-PLAN-STAGE-VISIBILITY — reuse the SAME substage line for
          // the Building Activities step so it animates exactly like ai/plan.
          const showWeeklyDetail = isCurrent && step.stage === 'generate-weekly-structure';
          return (
            <React.Fragment key={step.stage}>
              <div className="flex items-center gap-2">
                <div className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold
                  ${isDone    ? `${dotClass} text-white`
                  : isCurrent ? 'border-2 border-amber-400 bg-amber-50'
                  : 'border border-gray-200 bg-gray-50'}`}>
                  {isDone ? '✓' : isCurrent
                    ? <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    : null}
                </div>
                <span className={`text-[11px] leading-tight
                  ${isDone    ? 'text-gray-400 line-through'
                  : isCurrent ? 'text-gray-900 font-semibold'
                  : 'text-gray-300'}`}>
                  {step.label}
                </span>
              </div>
              {showAiPlanDetail && (
                <AiPlanSubStageLine
                  substage={progress.ai_plan_substage}
                  substageLabel={progress.ai_plan_substage_label}
                  elapsedMs={elapsedMs}
                />
              )}
              {showWeeklyDetail && (
                <AiPlanSubStageLine
                  substage={progress.weekly_structure_substage}
                  substageLabel={progress.weekly_structure_substage_label}
                  elapsedMs={elapsedMs}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Content job progress (queue-based, shown when workers are active) */}
      {contentJobs && contentJobs.total > 0 && (
        <div className="mb-3 bg-gray-50 rounded-lg p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-gray-700">
              {contentJobs.is_complete
                ? `${contentJobs.done} of ${contentJobs.total} topics scheduled`
                : contentJobs.done === 0
                  ? `Scheduling ${contentJobs.total} topics…`
                  : `${contentJobs.done} of ${contentJobs.total} topics scheduled`}
            </span>
            {!contentJobs.is_complete && contentJobs.estimated_seconds_remaining != null && (
              <span className="text-[10px] text-gray-400">
                ~{contentJobs.estimated_seconds_remaining < 60
                  ? `${contentJobs.estimated_seconds_remaining}s`
                  : `${Math.ceil(contentJobs.estimated_seconds_remaining / 60)}m`} remaining
              </span>
            )}
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${contentJobs.is_complete ? 'bg-green-500' : 'bg-amber-400'}`}
              style={{ width: `${contentJobs.total > 0 ? Math.round((contentJobs.done / contentJobs.total) * 100) : 0}%` }}
            />
          </div>
          <div className="flex gap-3 mt-1.5">
            {contentJobs.posts_scheduled > 0 && (
              <span className="text-[10px] text-green-600 font-medium">{contentJobs.posts_scheduled} posts live</span>
            )}
            {contentJobs.active > 0 && (
              <span className="text-[10px] text-amber-600">{contentJobs.active} generating</span>
            )}
            {contentJobs.failed > 0 && (
              <span className="text-[10px] text-red-500">{contentJobs.failed} failed</span>
            )}
          </div>
        </div>
      )}

      {/* Progress bar */}
      {!isFailed && (
        <div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isCompleted ? 'bg-green-500' : 'bg-amber-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            {isCompleted && (!contentJobs || contentJobs.is_complete || contentJobs.total === 0) ? (
              <span className="text-[10px] text-green-600 font-medium">Heading to calendar…</span>
            ) : isCompleted && contentJobs && !contentJobs.is_complete ? (
              <span className="text-[10px] text-amber-600 font-medium">Workers scheduling remaining posts…</span>
            ) : (
              <span className="text-[10px] text-gray-400">{pct}%</span>
            )}
            {!isCompleted && progress.weeks_generated != null && progress.weeks_generated > 0 && (
              <span className="text-[10px] text-amber-600">
                {progress.weeks_generated}w generated
                {(progress.daily_slots_created ?? 0) > 0 ? ` · ${progress.daily_slots_created} slots` : ''}
              </span>
            )}
            {isCompleted && (progress.scheduled_posts_created ?? 0) > 0 && (!contentJobs || contentJobs.total === 0) && (
              <span className="text-[10px] text-green-600">
                {progress.scheduled_posts_created} posts scheduled
              </span>
            )}
          </div>
        </div>
      )}

      {/* Failure explainability (6H-D): WHERE + WHY, friendly only. */}
      {isFailed && (
        <div className="mt-1 space-y-0.5">
          {progress.failed_stage_label && (
            <p className="text-[11px] text-gray-600">
              <span className="font-semibold">Stage:</span> {progress.failed_stage_label}
            </p>
          )}
          {progress.error_message && (
            <p className="text-[11px] text-red-600">{progress.error_message}</p>
          )}
          {progress.error_code && (
            <p className="text-[10px] text-gray-400 font-mono">Code: {progress.error_code}</p>
          )}
        </div>
      )}
    </div>
  );
}
