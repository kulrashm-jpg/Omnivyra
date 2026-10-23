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
 * ─── 005 — THE A3 PERSON ANCHOR IS POPULATED HERE ──────────────────────────
 * A3 / Contract 12 added `outreach_tasks.person_id` with a composite tenant-safe
 * foreign key to `unified_persons (id, company_id)`, and Contract 13 made it step
 * 2 of the frozen anchor order. Until 005 nothing ever wrote it: translation
 * derives a task from a WS-2 plan, which carries a lead and no canonical person,
 * so every row left the column NULL and every governance evaluation fell through
 * to step 3 and re-read `leads`. PI-INGEST-CONSOLIDATION-004 identified that as
 * the real gap — the anchor was designed, migrated, and adopted by two later PI
 * consumers, then left without a writer.
 *
 * So after a task is persisted, this module resolves the canonical person with
 * the EXISTING `resolveLeadPersonId` and stores it through the EXISTING
 * `setOutreachTaskPersonId`. No second lookup, no second writer, no new
 * identifier: `lead_id` keeps every job it had — intelligence-surface key,
 * idempotency component, immutable provenance, per-lead rate/quota grouping.
 *
 * ADDITIVE, NEVER A PREREQUISITE. Resolution runs AFTER the insert and can only
 * add a column value. A task that cannot be anchored is still materialised,
 * exactly as before, and step 3 remains in force for it. Making the person a
 * condition of creating the task would turn a gap on the intelligence surface
 * into a materialisation outage.
 *
 * NOT ATOMIC, AND DELIBERATELY NOT MADE SO. `ownedDbTable` is the only database
 * surface this runtime has and WS-3 owns no transaction helper, so the insert and
 * the anchor write are two independent round-trips. If the second fails the first
 * stands and the task is merely unanchored — the pre-005 state, which the anchor
 * order already handles. Rollback here would mean deleting a durable outreach row
 * to undo a missing nullable column, which is strictly worse than leaving it NULL.
 *
 * Resolved ONCE per plan, not once per task: every task in a plan shares one
 * `(companyId, leadId)`, so a per-task lookup would issue N identical `leads`
 * reads. Lazy, so a preview — or a plan whose every insert fails — reads nothing.
 *
 * WHAT THIS MODULE DOES NOT DO: approve, route, schedule, enqueue, dispatch,
 * retry, deliver, record outcomes, or emit feedback. It still evaluates no
 * governance rule: `personAnchor` resolves an identifier and nothing else, and
 * depends only on `ownedDbTable` and the domain types.
 */

import type { AutomationSummary } from '../automationExecution/types';
import { resolveLeadPersonId } from './personAnchor';
import { insertOutreachTask, setOutreachTaskPersonId } from './storage';
import { translateAutomationPlan, type TranslationContext, type TranslationResult } from './translation';
import type { OutreachTask } from './types';
import { recordFailure, recordStageOutcome } from './telemetry';

/**
 * What became of the A3 person anchor for a newly created task.
 *
 * `absent` and `unresolved_read_failure` are NEVER collapsed. Both leave the
 * column NULL, but they mean different things and the governance layer treats
 * them differently: a genuine absence degrades to target-only matching, while an
 * unreadable `leads` row makes anchor step 3 fail closed on the next evaluation.
 * Reporting one as the other here would hide an infrastructure fault behind a
 * legitimate data shape.
 */
export type MaterializedPersonAnchor =
  /** Resolved and stored — step 2 of the anchor order will serve this task. */
  | 'stored'
  /** The lead has no `unified_person_id`. Legitimate; step 3 stays in force. */
  | 'absent'
  /** The `leads` read FAILED. Not absence. Step 3 will fail closed if it persists. */
  | 'unresolved_read_failure'
  /** Resolved, but the anchor write was refused. Task stands, unanchored. */
  | 'anchor_write_failed';

/** Per-task result of a materialisation pass. */
export interface MaterializedTaskResult {
  planTaskId: string;
  status: 'created' | 'duplicate' | 'skipped' | 'failed';
  /** Present only when newly created. */
  task?: OutreachTask;
  reason?: string;
  /** 005. Present only on a newly created task — the only kind this anchors. */
  personAnchor?: MaterializedPersonAnchor;
  /**
   * Why the anchor write was refused, verbatim from the storage layer. Set only
   * with `anchor_write_failed`, so a cross-tenant refusal (the composite FK's
   * `23503`, which would mean a lead pointing at another tenant's person) is
   * visible rather than silently indistinguishable from a transport blip.
   */
  personAnchorError?: string;
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
  /**
   * 005. How many newly created tasks carry a stored person anchor. Always
   * `<= created`; the shortfall is accounted for per task by `personAnchor`.
   */
  personAnchored: number;
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

  /**
   * 005 — the per-plan person lookup, resolved at most once and only on demand.
   *
   * Memoising the PROMISE rather than the value means concurrent callers share
   * one in-flight read, and a plan that never creates a task never reads at all.
   */
  let personLookup: Promise<{ ok: boolean; personId: string | null }> | null = null;
  const lookupPerson = (): Promise<{ ok: boolean; personId: string | null }> => {
    personLookup ??= resolveLeadPersonId(translation.companyId, translation.leadId);
    return personLookup;
  };

  /**
   * Store the anchor for a task that was just created.
   *
   * Never throws and never reports the TASK as failed: by this point the row is
   * durable, and an anchor is an addition to it. The returned task carries the
   * stored `personId` so the caller's in-memory view matches the database
   * without a re-read.
   */
  const anchorPerson = async (
    task: OutreachTask,
  ): Promise<{ task: OutreachTask; anchor: MaterializedPersonAnchor; error?: string }> => {
    const resolved = await lookupPerson();
    // A read failure is NOT absence. Leave the column NULL and say which it was.
    if (!resolved.ok) return { task, anchor: 'unresolved_read_failure' };
    if (!resolved.personId) return { task, anchor: 'absent' };

    const stored = await setOutreachTaskPersonId(task.companyId, task.id, resolved.personId);
    if (!stored.ok) return { task, anchor: 'anchor_write_failed', error: stored.error };
    // `changed: false` means no such task for this tenant — impossible here, and
    // the storage layer's own contract says it is not an error. Reported, not thrown.
    if (!stored.changed) return { task, anchor: 'anchor_write_failed', error: 'the task was not found for this tenant' };

    return { task: { ...task, personId: resolved.personId }, anchor: 'stored' };
  };

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
      const anchored = await anchorPerson(written.data);
      results.push({
        planTaskId: outcome.planTaskId,
        status: 'created',
        task: anchored.task,
        personAnchor: anchored.anchor,
        ...(anchored.error ? { personAnchorError: anchored.error } : {}),
      });
    } else if (written.duplicate) {
      // Expected whenever a regenerated plan revisits a task that already
      // exists. The existing row keeps its original provenance and audit
      // history untouched — that is the point of the identity anchor.
      //
      // 005 does NOT anchor on this path. Re-anchoring an existing row would be
      // legal (`person_id` is deliberately outside the immutability trigger), but
      // it would make a re-materialisation write to a row this branch exists to
      // leave alone. An unanchored pre-005 task keeps resolving through step 3,
      // so nothing is broken by leaving it — and repairing such rows is a
      // separate, explicitly scoped decision, not a side effect of a duplicate.
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
    personAnchored: results.filter((r) => r.personAnchor === 'stored').length,
    results,
  };
}
