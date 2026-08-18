/**
 * CAMPAIGN-IMPL-003A — planner metrics routed through the HARDEN-001
 * observability registry (backend/observability), replacing standalone
 * console.log so planner integrity is queryable via getObservabilitySnapshot().
 *
 * Every planner entry point calls emitPlannerMetrics() with its reconciliation +
 * regeneration stats, so all paths contribute to ONE metric namespace:
 *
 *   planner.request.count     (counter, labels: mode)      — items requested
 *   planner.item.generated    (counter, labels: mode)      — items generated
 *   planner.item.dropped      (counter, labels: mode,reason)
 *   planner.item.regenerated  (counter, labels: mode)      — regenerate-before-drop successes
 *   planner.success_pct       (histogram, labels: mode)    — generated / requested
 *   planner.integrity_pct     (histogram, labels: mode)    — invariant health
 *
 * Fail-safe: every emit is wrapped so a metrics failure can never break
 * generation (the codebase convention even though the seam is itself fail-safe).
 */
import { recordRawCounter, recordRawHistogram } from '../../observability';
import { computePlannerMetrics, canTransition, type ContentLifecycleState } from '../../../lib/shared/campaign/campaignLifecycle';
import type { DropReasonCode } from '../../../lib/shared/campaign/plannerDiagnostics';
import type { PlannerReconciliation } from '../../../lib/shared/campaign/plannerDiagnostics';

export type PlannerMode = 'writer' | 'creator' | 'mix' | 'ai_decide' | 'partial_regen' | 'weekly' | 'unknown';

/**
 * Route a reconciliation + regeneration summary into the observability registry.
 * `mode` is a low-cardinality label (the campaign lane), NOT a per-campaign id —
 * per-campaign ids would burn the 5000-series budget.
 */
export function emitPlannerMetrics(
  reconciliation: PlannerReconciliation,
  regeneration: { regenerated: number; attempts: number[] } = { regenerated: 0, attempts: [] },
  ctx: { mode?: PlannerMode } = {},
): void {
  const mode = ctx.mode ?? 'unknown';
  const metrics = computePlannerMetrics(reconciliation, regeneration);
  try {
    recordRawCounter('planner.request.count', metrics.requested, { mode });
    recordRawCounter('planner.item.generated', metrics.generated, { mode });
    recordRawCounter('planner.item.regenerated', metrics.regenerated, { mode });
    for (const { reason, count } of metrics.drop_reasons) {
      recordRawCounter('planner.item.dropped', count, { mode, reason });
    }
    recordRawHistogram('planner.success_pct', metrics.generation_success_pct, { mode });
    recordRawHistogram('planner.integrity_pct', metrics.planner_integrity_pct, { mode });
  } catch { /* fail-safe — metrics must never break generation */ }
}

/**
 * Emit a single structured drop as a counter. For entry points that drop items
 * outside a full reconciliation (e.g. plan-request trims, orchestrator aborts) so
 * every dropped item still lands in planner.item.dropped{reason}.
 */
export function emitPlannerDrop(reason: DropReasonCode, count = 1, mode: PlannerMode = 'unknown'): void {
  try {
    recordRawCounter('planner.item.dropped', Math.max(0, Math.round(count)), { mode, reason });
  } catch { /* fail-safe */ }
}

/** Emit a regeneration-before-drop success (an item saved from being dropped). */
export function emitPlannerRegeneration(count = 1, mode: PlannerMode = 'unknown'): void {
  try {
    recordRawCounter('planner.item.regenerated', Math.max(0, Math.round(count)), { mode });
  } catch { /* fail-safe */ }
}

/**
 * Drive the lifecycle state machine through actual execution: emit a counted,
 * FSM-validated transition at a real stage boundary (generation → scheduled,
 * allocated → dropped, …). `legal` records whether the transition is permitted
 * by LIFECYCLE_TRANSITIONS so an illegal move (a planner bug) is visible in
 * metrics rather than silent. This is what makes the lifecycle executed, not
 * merely defined. Fail-safe.
 */
export function emitLifecycleTransition(
  from: ContentLifecycleState,
  to: ContentLifecycleState,
  count = 1,
  mode: PlannerMode = 'unknown',
): void {
  const n = Math.max(0, Math.round(count));
  if (n === 0) return;
  try {
    const legal = canTransition(from, to) ? 'true' : 'false';
    recordRawCounter('planner.lifecycle.transition', n, { mode, from, to, legal });
  } catch { /* fail-safe */ }
}
