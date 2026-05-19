/**
 * executionPruningAuthority — Phase-2 Step-34.
 *
 * Turns the Step-33 LOGICAL enqueue partition into a PHYSICAL one: given
 * the scheduler's in-flight daily-plan rows + the ExecutionEnqueueSummary,
 * it splits the rows so ONLY canonical-ready executions continue through
 * downstream enqueue/publish/CMS loops; deferred & blocked rows exit the
 * live loop (recorded, not silently dropped).
 *
 * SAFETY (STRICT RULES 4/5/6/7/8):
 *  - CONSERVATIVE: a row is pruned ONLY when it maps confidently to an
 *    explicit `defer`/`reject` execution. Unmapped/ambiguous rows STAY
 *    enqueueable (never over-drop a row we are unsure about).
 *  - Only active under AUTHORITATIVE + usable summary; otherwise returns
 *    the rows untouched (`usable:false`) ⇒ Step-33/legacy governs.
 *  - Never throws. If pruning would empty a non-all-blocked run, it keeps
 *    the original rows (no accidental whole-run wipe).
 */

import type { ExecutionEnqueueSummary } from './executionEnqueueAuthority';

const LOG = (tag: string, payload: Record<string, unknown>) => {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a diagnostic */
  }
};

export interface ExecutionPruningSummary {
  scheduler_mode: ExecutionEnqueueSummary['scheduler_mode'];
  orchestration_version: string;
  usable: boolean;
  pruned_enqueueable_ids: string[];
  pruned_deferred_ids: string[];
  pruned_blocked_ids: string[];
  deferred_requeue_candidates: string[];
  blocked_reasons: Record<string, string[]>;
  unmapped_kept: number;
}

export interface PruningResult<R> {
  enqueueableRows: R[];
  deferredRows: R[];
  blockedRows: R[];
  summary: ExecutionPruningSummary;
}

/** Resolve the canonical execution id a scheduler row corresponds to. */
function rowExecutionId(row: unknown): string {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  const direct = String(r.execution_id ?? '').trim();
  if (direct) return direct;
  const c = r.content;
  if (typeof c === 'string') {
    try {
      const p = JSON.parse(c) as Record<string, unknown>;
      const eid = String(p?.execution_id ?? '').trim();
      if (eid) return eid;
    } catch {
      /* ignore */
    }
  } else if (c && typeof c === 'object') {
    const eid = String((c as Record<string, unknown>).execution_id ?? '').trim();
    if (eid) return eid;
  }
  return String(r.id ?? '').trim();
}

/**
 * Physically partition rows. Fail-soft: any problem ⇒ all rows treated as
 * enqueueable with `usable:false` (caller keeps Step-33/legacy behavior).
 */
export function pruneExecutions<R>(
  campaignId: string,
  rows: R[],
  summary: ExecutionEnqueueSummary | null | undefined,
): PruningResult<R> {
  const passthrough = (usable: boolean, reason: string): PruningResult<R> => {
    if (!usable) {
      LOG('PRUNING_FALLBACK', { campaign_id: campaignId, reason, fallback_active: true });
    }
    return {
      enqueueableRows: rows,
      deferredRows: [],
      blockedRows: [],
      summary: {
        scheduler_mode: summary?.scheduler_mode ?? 'LEGACY',
        orchestration_version: summary?.orchestration_version ?? 'unknown',
        usable: false,
        pruned_enqueueable_ids: [],
        pruned_deferred_ids: [],
        pruned_blocked_ids: [],
        deferred_requeue_candidates: [],
        blocked_reasons: {},
        unmapped_kept: 0,
      },
    };
  };

  try {
    if (!summary || !summary.usable) return passthrough(false, 'summary_not_usable');
    if (summary.scheduler_mode !== 'AUTHORITATIVE') return passthrough(false, 'not_authoritative');

    const deferSet = new Set(summary.deferred_ids);
    const blockSet = new Set(summary.blocked_ids);
    const blockedReasonById: Record<string, string[]> = {};
    for (const d of summary.decisions) {
      if (d.enqueue_decision === 'reject') {
        blockedReasonById[d.execution_id] = d.blocked_reason ?? ['CANONICAL_BLOCKED'];
      }
    }

    const enqueueableRows: R[] = [];
    const deferredRows: R[] = [];
    const blockedRows: R[] = [];
    const prunedEnq: string[] = [];
    const prunedDef: string[] = [];
    const prunedBlk: string[] = [];
    let unmappedKept = 0;

    for (const row of rows) {
      const eid = rowExecutionId(row);
      if (eid && blockSet.has(eid)) {
        blockedRows.push(row);
        prunedBlk.push(eid);
        LOG('EXECUTION_PRUNED', { campaign_id: campaignId, execution_id: eid, pruning_decision: 'blocked', canonical_scheduler_state: 'BLOCKED', scheduler_mode: 'AUTHORITATIVE' });
        LOG('EXECUTION_BLOCKED_RECORD', { campaign_id: campaignId, execution_id: eid, blocked_reason: blockedReasonById[eid] ?? ['CANONICAL_BLOCKED'], scheduler_mode: 'AUTHORITATIVE' });
      } else if (eid && deferSet.has(eid)) {
        deferredRows.push(row);
        prunedDef.push(eid);
        LOG('EXECUTION_PRUNED', { campaign_id: campaignId, execution_id: eid, pruning_decision: 'deferred', canonical_scheduler_state: 'WAITING', replay_eligible: true, scheduler_mode: 'AUTHORITATIVE' });
        LOG('EXECUTION_DEFERRED_RECORD', { campaign_id: campaignId, execution_id: eid, replay_eligible: true, scheduler_mode: 'AUTHORITATIVE' });
      } else {
        // enqueueable OR unmapped/ambiguous → KEEP (conservative).
        enqueueableRows.push(row);
        if (eid) prunedEnq.push(eid);
        else unmappedKept += 1;
      }
    }

    // Never wipe a non-all-blocked run on a mapping miss.
    if (enqueueableRows.length === 0 && !summary.all_blocked) {
      return passthrough(false, 'pruned_empty_guard');
    }

    const pruningSummary: ExecutionPruningSummary = {
      scheduler_mode: 'AUTHORITATIVE',
      orchestration_version: summary.orchestration_version,
      usable: true,
      pruned_enqueueable_ids: prunedEnq,
      pruned_deferred_ids: prunedDef,
      pruned_blocked_ids: prunedBlk,
      deferred_requeue_candidates: prunedDef,
      blocked_reasons: blockedReasonById,
      unmapped_kept: unmappedKept,
    };
    LOG('PRUNING_SUMMARY', {
      campaign_id: campaignId,
      scheduler_mode: 'AUTHORITATIVE',
      orchestration_version: summary.orchestration_version,
      enqueueable: enqueueableRows.length,
      deferred: deferredRows.length,
      blocked: blockedRows.length,
      unmapped_kept: unmappedKept,
      usable: true,
    });
    return { enqueueableRows, deferredRows, blockedRows, summary: pruningSummary };
  } catch (e) {
    return passthrough(false, `exception:${(e as Error)?.message ?? 'unknown'}`);
  }
}

/**
 * SHADOW diff extension — physical pruning vs the legacy "all rows
 * traverse downstream" behaviour. Observability only.
 */
export function diffPruningVsLegacy(
  campaignId: string,
  totalRows: number,
  result: PruningResult<unknown>,
): void {
  LOG('ENQUEUE_DIFF', {
    campaign_id: campaignId,
    scheduler_mode: result.summary.scheduler_mode,
    total_rows: totalRows,
    physical_pruning_applied: result.summary.usable,
    downstream_traversal_mismatch:
      result.summary.usable && (result.deferredRows.length + result.blockedRows.length > 0),
    deferred_isolation_mismatch: result.summary.usable && result.deferredRows.length > 0,
    blocked_isolation_mismatch: result.summary.usable && result.blockedRows.length > 0,
  });
}
