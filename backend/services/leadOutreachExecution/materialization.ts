/**
 * WS-3 Milestone-2 — dry-run materialisation.
 *
 * Persists translated OutreachTasks using the Milestone-1 storage layer, and
 * does nothing else. "Dry-run" here means exactly what the architecture says:
 * the whole chain from plan to durable task is exercised, while remaining
 * STRUCTURALLY INCAPABLE of contacting anyone — there is no transport import,
 * no queue, no governance evaluation and no dispatch anywhere in this module or
 * its dependencies.
 *
 * IDEMPOTENCY. Re-materialising the same plan is a normal, expected operation:
 * plans are regenerated on every WS-2 generation, so this will be called
 * repeatedly with substantially the same input. Duplicate detection is enforced
 * by the database's `(company_id, lead_id, plan_task_id)` unique constraint —
 * not by a read-then-write check, which would race. A duplicate is reported as
 * such and is NOT an error.
 *
 * WHAT THIS MODULE DOES NOT DO: approve, route, schedule, enqueue, dispatch,
 * retry, deliver, record outcomes, or emit feedback.
 */

import type { AutomationSummary } from '../automationExecution/types';
import { insertOutreachTask } from './storage';
import { translateAutomationPlan, type TranslationContext, type TranslationResult } from './translation';
import type { OutreachTask } from './types';
import { recordFailure, recordStageOutcome } from './telemetry';

/** Per-task result of a materialisation pass. */
export interface MaterializedTaskResult {
  planTaskId: string;
  status: 'created' | 'duplicate' | 'skipped' | 'failed';
  /** Present only when newly created. */
  task?: OutreachTask;
  reason?: string;
}

export interface MaterializationResult {
  companyId: string;
  leadId: string;
  /** True when nothing was written because the caller asked for a preview. */
  previewOnly: boolean;
  materializedAt: string;
  translationVersion: string;
  created: number;
  duplicates: number;
  skipped: number;
  failed: number;
  results: MaterializedTaskResult[];
}

export interface MaterializationOptions {
  /**
   * Translate and report WITHOUT writing anything. The strictest form of dry
   * run — useful for reviewing what a plan would materialise before any row
   * exists. Default false: M2's job is to produce durable tasks.
   */
  previewOnly?: boolean;
}

/**
 * Translate an automation plan and persist the resulting tasks.
 *
 * Never throws: every storage failure is reported per task, so one bad task
 * cannot prevent the rest of a plan from materialising. Returns a full account
 * of what happened to every plan task, including the ones deliberately skipped.
 */
export async function materializeAutomationPlan(
  summary: AutomationSummary,
  context: TranslationContext,
  options: MaterializationOptions = {},
): Promise<MaterializationResult> {
  const translation: TranslationResult = translateAutomationPlan(summary, context);
  const previewOnly = options.previewOnly === true;

  const results: MaterializedTaskResult[] = [];

  for (const outcome of translation.outcomes) {
    if (!outcome.task) {
      results.push({
        planTaskId: outcome.planTaskId,
        status: 'skipped',
        reason: outcome.skippedReason ?? 'not translatable',
      });
      continue;
    }

    if (previewOnly) {
      results.push({ planTaskId: outcome.planTaskId, status: 'skipped', reason: 'preview only — nothing written' });
      continue;
    }

    const written = await insertOutreachTask(outcome.task);
    if (written.ok && written.data) {
      results.push({ planTaskId: outcome.planTaskId, status: 'created', task: written.data });
    } else if (written.duplicate) {
      // Expected whenever a regenerated plan revisits a task that already
      // exists. The existing row keeps its original provenance and audit
      // history untouched — that is the point of the identity anchor.
      results.push({ planTaskId: outcome.planTaskId, status: 'duplicate', reason: 'already materialised' });
    } else {
      results.push({ planTaskId: outcome.planTaskId, status: 'failed', reason: written.error ?? 'unknown storage failure' });
    }
  }

  // WS-3 M6 (observability only). A duplicate is its OWN outcome, not a
  // failure — a regenerated plan revisiting an existing task is the normal
  // path, and counting it as failure would make steady state look broken.
  for (const r of results) {
    recordStageOutcome('materialization', r.status === 'created' ? 'ok' : r.status === 'duplicate' ? 'duplicate' : r.status === 'skipped' ? 'skipped' : 'failed');
    if (r.status === 'failed') recordFailure('materialization', r.reason);
  }

  const count = (s: MaterializedTaskResult['status']): number => results.filter((r) => r.status === s).length;

  return {
    companyId: translation.companyId,
    leadId: translation.leadId,
    previewOnly,
    materializedAt: translation.materializedAt,
    translationVersion: translation.translationVersion,
    created: count('created'),
    duplicates: count('duplicate'),
    skipped: count('skipped'),
    failed: count('failed'),
    results,
  };
}
