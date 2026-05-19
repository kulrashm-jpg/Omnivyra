/**
 * executionEnqueueAuthority — Phase-2 Step-33.
 *
 * Promotes Step-32 from RUN-LEVEL to PER-EXECUTION authority: each
 * execution is routed independently to enqueue / defer / reject from its
 * canonical PublishingExecutionProjection. The whole run is rejected ONLY
 * when EVERY execution is blocked/unusable — so a single bad row no longer
 * poisons valid executions.
 *
 * SAFETY (STRICT RULES 4/5/6/7/8):
 *  - AUTHORITATIVE cutover only; SHADOW/LEGACY/rollback/empty/exception ⇒
 *    `usable:false` ⇒ caller keeps legacy whole-run semantics byte-identical.
 *  - Never throws, never blocks scheduler runtime.
 *  - Deferred/blocked executions are RECORDED with lineage (no silent
 *    drops) and remain requeue-eligible.
 */

import { getExecutionItems } from '../canonicalExecutionAdapter';
import { resolveAuthoritativePublishing } from './authoritativePublishingResolver';
import type { SchedulerStatus } from './publishingEligibilityProjection';

const LOG = (tag: string, payload: Record<string, unknown>) => {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a diagnostic */
  }
};

export type EnqueueDecision = 'enqueue' | 'defer' | 'reject';

export interface ExecutionEnqueueDecision {
  execution_id: string;
  canonical_scheduler_state: SchedulerStatus | 'UNKNOWN';
  enqueue_decision: EnqueueDecision;
  blocked_reason: string[] | null;
}

export interface ExecutionEnqueueSummary {
  scheduler_mode: 'AUTHORITATIVE' | 'SHADOW' | 'LEGACY';
  orchestration_version: string;
  /** true ⇒ caller may apply per-execution routing; false ⇒ legacy run. */
  usable: boolean;
  /** true ⇒ EVERY execution blocked/unusable ⇒ whole-run reject parity. */
  all_blocked: boolean;
  enqueued_count: number;
  deferred_count: number;
  blocked_count: number;
  enqueueable_ids: string[];
  deferred_ids: string[];
  blocked_ids: string[];
  decisions: ExecutionEnqueueDecision[];
}

function routeStatus(status: SchedulerStatus | 'UNKNOWN'): EnqueueDecision {
  switch (status) {
    case 'PUBLISH_READY':
    case 'AI_READY':
    case 'SCHEDULABLE':
      return 'enqueue';
    case 'WAITING_UPLOAD':
    case 'WAITING_APPROVAL':
    case 'WAITING_GENERATION':
      return 'defer';
    case 'BLOCKED':
      return 'reject';
    default:
      return 'defer'; // unknown ⇒ conservative defer (never silent enqueue)
  }
}

const EMPTY: ExecutionEnqueueSummary = {
  scheduler_mode: 'LEGACY',
  orchestration_version: 'unknown',
  usable: false,
  all_blocked: false,
  enqueued_count: 0,
  deferred_count: 0,
  blocked_count: 0,
  enqueueable_ids: [],
  deferred_ids: [],
  blocked_ids: [],
  decisions: [],
};

/**
 * Resolve per-execution enqueue routing for a campaign. Fail-soft: any
 * failure ⇒ EMPTY (usable:false ⇒ legacy whole-run governs).
 */
export async function resolveExecutionEnqueue(
  campaignId: string,
): Promise<ExecutionEnqueueSummary> {
  if (!campaignId) return EMPTY;
  try {
    const items = await getExecutionItems(campaignId).catch(() => []);
    if (items.length === 0) {
      LOG('ENQUEUE_FALLBACK', { campaign_id: campaignId, reason: 'no_executions', fallback_active: true });
      return EMPTY;
    }

    const decisions: ExecutionEnqueueDecision[] = [];
    const enqueueable_ids: string[] = [];
    const deferred_ids: string[] = [];
    const blocked_ids: string[] = [];
    let mode: ExecutionEnqueueSummary['scheduler_mode'] = 'SHADOW';
    let version = 'unknown';

    for (const it of items) {
      const r = await resolveAuthoritativePublishing(campaignId, it.execution_id, it.platform);
      mode =
        r.mode === 'AUTHORITATIVE' ? 'AUTHORITATIVE' : r.mode === 'LEGACY' ? 'LEGACY' : 'SHADOW';
      const status = (r.projection?.scheduler_status ?? 'UNKNOWN') as SchedulerStatus | 'UNKNOWN';
      if (r.projection) version = r.projection.orchestration_version;
      const decision = routeStatus(status);
      const blockedReason =
        decision === 'reject' ? r.projection?.blocking_reasons ?? ['CANONICAL_BLOCKED'] : null;
      decisions.push({
        execution_id: it.execution_id,
        canonical_scheduler_state: status,
        enqueue_decision: decision,
        blocked_reason: blockedReason,
      });
      if (decision === 'enqueue') {
        enqueueable_ids.push(it.execution_id);
        LOG('EXECUTION_ENQUEUE', { campaign_id: campaignId, execution_id: it.execution_id, canonical_scheduler_state: status, enqueue_decision: 'enqueue', scheduler_mode: mode });
      } else if (decision === 'defer') {
        deferred_ids.push(it.execution_id);
        LOG('EXECUTION_DEFERRED', { campaign_id: campaignId, execution_id: it.execution_id, canonical_scheduler_state: status, enqueue_decision: 'defer', scheduler_mode: mode });
      } else {
        blocked_ids.push(it.execution_id);
        LOG('EXECUTION_BLOCKED', { campaign_id: campaignId, execution_id: it.execution_id, canonical_scheduler_state: status, enqueue_decision: 'reject', blocked_reason: blockedReason, scheduler_mode: mode });
      }
    }

    const usable = mode === 'AUTHORITATIVE' && decisions.length > 0;
    const all_blocked =
      decisions.length > 0 && enqueueable_ids.length === 0 && deferred_ids.length === 0;

    const summary: ExecutionEnqueueSummary = {
      scheduler_mode: mode,
      orchestration_version: version,
      usable,
      all_blocked,
      enqueued_count: enqueueable_ids.length,
      deferred_count: deferred_ids.length,
      blocked_count: blocked_ids.length,
      enqueueable_ids,
      deferred_ids,
      blocked_ids,
      decisions,
    };
    LOG('ENQUEUE_SUMMARY', {
      campaign_id: campaignId,
      scheduler_mode: mode,
      orchestration_version: version,
      enqueued_count: summary.enqueued_count,
      deferred_count: summary.deferred_count,
      blocked_count: summary.blocked_count,
      all_blocked,
      usable,
      fallback_active: !usable,
    });
    return summary;
  } catch (e) {
    LOG('ENQUEUE_FALLBACK', {
      campaign_id: campaignId,
      reason: `exception:${(e as Error)?.message ?? 'unknown'}`,
      fallback_active: true,
    });
    return EMPTY;
  }
}

/**
 * SHADOW diff: per-row enqueue routing vs the legacy whole-run verdict.
 * Observability only — emitted as [ENQUEUE_DIFF]/[SCHEDULER_DECISION_DIFF].
 */
export function diffEnqueueVsLegacy(
  campaignId: string,
  summary: ExecutionEnqueueSummary,
  legacyEligible: boolean,
): void {
  // Legacy: eligible ⇒ "enqueue all"; ineligible ⇒ "reject all".
  const legacyEnqueuesAll = legacyEligible;
  const canonicalRejectsAll = summary.all_blocked;
  const perRowMismatch =
    (legacyEnqueuesAll && summary.blocked_count > 0) ||
    (!legacyEnqueuesAll && summary.enqueued_count > 0);
  LOG('ENQUEUE_DIFF', {
    campaign_id: campaignId,
    scheduler_mode: summary.scheduler_mode,
    legacy_eligible: legacyEligible,
    canonical_enqueued: summary.enqueued_count,
    canonical_deferred: summary.deferred_count,
    canonical_blocked: summary.blocked_count,
    per_row_enqueue_mismatch: perRowMismatch,
    defer_mismatch: legacyEnqueuesAll && summary.deferred_count > 0,
    blocked_mismatch: legacyEnqueuesAll && summary.blocked_count > 0,
    enqueue_summary_mismatch: legacyEnqueuesAll === canonicalRejectsAll,
  });
}
