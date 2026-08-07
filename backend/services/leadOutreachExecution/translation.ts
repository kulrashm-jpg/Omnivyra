/**
 * WS-3 Milestone-2 — the AutomationTask → OutreachTask translation boundary.
 *
 * THE SINGLE TRANSLATION BOUNDARY defined by the frozen architecture. No
 * engine, no transport and no read layer translates; it happens here and
 * nowhere else, at materialisation time.
 *
 * PURE AND DETERMINISTIC. This module reads no clock, performs no I/O, and
 * mutates nothing — including its inputs. Identical input always yields
 * identical output, which is what lets a regenerated plan be re-translated
 * safely and repeatedly.
 *
 * WHY `materializedAt` IS INJECTED. Stamping it from `Date.now()` inside the
 * translator would destroy determinism: the same plan would translate to a
 * different task on every call, defeating the identity contract and the
 * duplicate detection built on it. It is therefore a parameter, defaulted by
 * the caller to the plan's own `generatedAt` — the same discipline WS-2 uses
 * for `now`, where time is evidence supplied by the caller rather than read by
 * the engine.
 *
 * WHAT THIS MODULE DOES NOT DO: approval routing, governance decisions,
 * scheduling, queue submission, transport selection, rate limiting, retries,
 * delivery, attempts, outcomes, or feedback emission. Structural translation
 * only.
 */

import type { AutomationSummary, AutomationTask } from '../automationExecution/types';
import type { NewOutreachTask } from './types';
import { EXECUTION_RUNTIME_VERSION, GOVERNANCE_VERSION, TRANSLATION_VERSION } from './runtimeVersion';
import { recordStageOutcome } from './telemetry';

/**
 * Everything the translator needs that is not in the plan itself.
 *
 * `plannerVersion` is the `ENGINE_VERSION` of the envelope the plan came from,
 * supplied by the caller — this module never imports WS-2's version constant,
 * because the correct value is the one that produced THIS plan, not whatever
 * the current build happens to declare.
 */
export interface TranslationContext {
  companyId: string;
  leadId: string;
  /** ENGINE_VERSION of the envelope this plan was generated from. */
  plannerVersion: string;
  /**
   * Instant of materialisation. Defaults to the plan's `generatedAt` so
   * translation stays deterministic; pass an explicit value only when the
   * caller has a better-evidenced instant.
   */
  materializedAt?: string;
}

/** A translated task plus why it was or was not translatable. */
export interface TranslationOutcome {
  planTaskId: string;
  task: NewOutreachTask | null;
  /** Null when translated; a reason string when skipped. */
  skippedReason: string | null;
}

export interface TranslationResult {
  companyId: string;
  leadId: string;
  translationVersion: string;
  materializedAt: string;
  outcomes: TranslationOutcome[];
  /** Translatable tasks, in deterministic plan order. */
  tasks: NewOutreachTask[];
}

const trimOrNull = (v: unknown, max = 2000): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
};

const finiteOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Translate ONE plan task.
 *
 * Returns null when the task cannot form a valid identity — the identity
 * `(companyId, leadId, planTaskId)` is the anchor for duplicate detection, so a
 * task without a usable `id` cannot be materialised safely and is skipped with
 * a reason rather than materialised under a fabricated key.
 */
export function translateAutomationTask(
  task: AutomationTask,
  context: TranslationContext,
  materializedAt: string,
  requiresApproval: boolean,
): TranslationOutcome {
  const planTaskId = trimOrNull(task?.id, 200);
  if (!planTaskId) {
    return { planTaskId: '', task: null, skippedReason: 'plan task has no usable id' };
  }
  if (!context.companyId?.trim() || !context.leadId?.trim()) {
    return { planTaskId, task: null, skippedReason: 'translation context is missing a tenant or lead' };
  }

  return {
    planTaskId,
    skippedReason: null,
    task: {
      companyId: context.companyId,
      leadId: context.leadId,
      planTaskId,

      // Structural copy of the plan's shape. The plan is disposable and
      // regenerated; a materialised task must stand alone afterwards.
      taskOrder: finiteOrNull(task.order),
      kind: trimOrNull(task.kind, 60),
      action: trimOrNull(task.action),
      channel: trimOrNull(task.channel as unknown, 60),
      dependsOnPlanTaskId: trimOrNull(task.dependsOn, 200),
      estimatedDelayHours: finiteOrNull(task.estimatedDelayHours),
      confidence: finiteOrNull(task.confidence),
      explanation: trimOrNull(task.explanation),

      /**
       * Stamped from the plan's own human-review assessment. This is a FIELD
       * COPY, not approval routing: no approval record is created, no approver
       * is notified, and no lifecycle transition is performed. Acting on this
       * flag is Milestone-3's job.
       */
      requiresApproval,

      // Immutable provenance, captured once. Descriptive, not
      // dispatch-controlling — governance is evaluated at dispatch against the
      // rules then in force.
      plannerVersion: context.plannerVersion,
      translationVersion: TRANSLATION_VERSION,
      governanceVersion: GOVERNANCE_VERSION,
      executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
      materializedAt,
    },
  };
}

/**
 * Translate a whole automation plan.
 *
 * Deterministic and side-effect free: the input summary is never mutated, and
 * the output depends only on the summary, the context, and the injected
 * instant. Tasks are emitted in plan order; duplicate plan ids within a single
 * summary are collapsed to their first occurrence, because the identity anchor
 * cannot represent two different tasks under one key.
 */
export function translateAutomationPlan(
  summary: AutomationSummary,
  context: TranslationContext,
): TranslationResult {
  const materializedAt =
    trimOrNull(context.materializedAt, 40) ?? trimOrNull(summary?.generatedAt, 40) ?? '';

  const requiresApproval = summary?.review?.reviewRequired === true;
  const planTasks = Array.isArray(summary?.tasks) ? summary.tasks : [];

  const outcomes: TranslationOutcome[] = [];
  const seen = new Set<string>();

  for (const task of planTasks) {
    const outcome = translateAutomationTask(task, context, materializedAt, requiresApproval);
    if (outcome.task && seen.has(outcome.planTaskId)) {
      outcomes.push({
        planTaskId: outcome.planTaskId,
        task: null,
        skippedReason: 'duplicate plan task id within the same plan',
      });
      continue;
    }
    if (outcome.task) seen.add(outcome.planTaskId);
    outcomes.push(outcome);
  }

  if (!materializedAt) {
    // Without an instant there is nothing valid to stamp, and a fabricated one
    // would silently corrupt the provenance record.
    return {
      companyId: context.companyId,
      leadId: context.leadId,
      translationVersion: TRANSLATION_VERSION,
      materializedAt: '',
      outcomes: outcomes.map((o) => ({ ...o, task: null, skippedReason: o.skippedReason ?? 'plan has no generatedAt to stamp as materializedAt' })),
      tasks: [],
    };
  }

  // WS-3 M6 (observability only): report what translation produced. Purely
  // additive — no branch below depends on it.
  for (const o of outcomes) recordStageOutcome('translation', o.task ? 'ok' : 'skipped');

  return {
    companyId: context.companyId,
    leadId: context.leadId,
    translationVersion: TRANSLATION_VERSION,
    materializedAt,
    outcomes,
    tasks: outcomes.map((o) => o.task).filter((t): t is NewOutreachTask => t !== null),
  };
}
