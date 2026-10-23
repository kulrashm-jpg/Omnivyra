/**
 * Phase 7 — Retention policy + execution service.
 *
 * Phase 7 ships:
 *   • Per-(org, target) policy CRUD
 *   • Dry-run preview (counts rows that WOULD be deleted at the cutoff)
 *   • Explicit execute (requires `mode='execute'` + actor)
 *   • Append-only target protection — refuses hard_delete against the
 *     audit trails (lifecycle_history, moderation_decisions)
 *
 * Hard guarantees:
 *   • No autonomous purge loop. Every execution is an API call.
 *   • Default mode is `dry_run`. Callers must explicitly request `execute`.
 *   • Bounded delete batch (10_000 rows per execution) to keep contention low.
 *   • Recording of every execution (dry_run AND execute) to
 *     `retention_executions` for compliance.
 */

import { ownedDbTable } from '../db/writeOwner';
import type {
  RetentionArchivalMode,
  RetentionExecution,
  RetentionExecutionMode,
  RetentionPolicy,
  RetentionTarget,
} from '../types/retention';
import {
  APPEND_ONLY_TARGETS,
  RETENTION_PROTECTED_CHILDREN,
  RETENTION_TARGETS,
  RETENTION_TARGET_BINDINGS,
} from '../types/retention';
import { classifyLifecycleGuardError } from './lifecycleGuardErrors';

const MAX_DELETE_BATCH = 10_000;

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export type UpsertPolicyInput = {
  organizationId: string;
  targetKind: RetentionTarget;
  retainDays: number;
  archivalMode: RetentionArchivalMode;
  enabled: boolean;
  createdBy: string | null;
};

export async function upsertRetentionPolicy(input: UpsertPolicyInput): Promise<RetentionPolicy> {
  if (!RETENTION_TARGETS.includes(input.targetKind)) {
    throw new Error(`unknown_retention_target:${input.targetKind}`);
  }
  if (input.archivalMode === 'hard_delete' && APPEND_ONLY_TARGETS.has(input.targetKind)) {
    throw new Error(`hard_delete_forbidden_on_audit_target:${input.targetKind}`);
  }
  if (input.retainDays < 7 || input.retainDays > 3650) {
    throw new Error(`retain_days_out_of_bounds:${input.retainDays}`);
  }
  const payload = {
    organization_id: input.organizationId,
    target_kind: input.targetKind,
    retain_days: input.retainDays,
    archival_mode: input.archivalMode,
    enabled: input.enabled,
    created_by: input.createdBy,
  };
  const { data: existing } = await ownedDbTable('retention_policies')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('target_kind', input.targetKind)
    .maybeSingle();
  if (existing && (existing as { id?: string }).id) {
    const { data, error } = await ownedDbTable('retention_policies')
      .update(payload)
      .eq('id', (existing as { id: string }).id)
      .select('*')
      .single();
    if (error || !data) throw new Error(`retention_policy_update_failed:${error?.message ?? 'unknown'}`);
    return data as RetentionPolicy;
  }
  const { data, error } = await ownedDbTable('retention_policies')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) throw new Error(`retention_policy_insert_failed:${error?.message ?? 'unknown'}`);
  return data as RetentionPolicy;
}

export async function listRetentionPolicies(organizationId: string): Promise<RetentionPolicy[]> {
  const { data, error } = await ownedDbTable('retention_policies')
    .select('*')
    .eq('organization_id', organizationId)
    .order('target_kind', { ascending: true });
  if (error) throw new Error(`retention_policy_list_failed:${error.message}`);
  return (data as RetentionPolicy[]) ?? [];
}

// ---------------------------------------------------------------------------
// Executions
// ---------------------------------------------------------------------------

export type RetentionRunInput = {
  organizationId: string;
  policyId: string;
  mode: RetentionExecutionMode;
  initiatedBy: string | null;
};

/**
 * What happened to ONE candidate row. Reported truthfully: a row is only ever
 * `deleted` when the database confirmed it, and nothing is dropped silently.
 */
export type RetentionItemDisposition =
  /** Confirmed removed by the database. */
  | 'deleted'
  /** Dry-run only: in scope and not protected, so a real run would delete it. */
  | 'would_delete'
  /** Held back because an append-only guard protects a child row. */
  | 'excluded_protected'
  /** The database refused or errored for this specific row. */
  | 'failed'
  /** Already gone before this run reached it — not an error, and not a deletion. */
  | 'already_absent'
  /**
   * The statement succeeded but reported fewer rows than were submitted, so
   * which ids it covered is not recoverable. Deliberately not `deleted`: a
   * count is authority over HOW MANY, never over WHICH.
   */
  | 'indeterminate';

export type RetentionItemOutcome = {
  id: string;
  disposition: RetentionItemDisposition;
  /** Why, for every disposition that is not a plain success. */
  reason: string | null;
};

/**
 * The stored execution row plus the per-item detail that row cannot hold.
 *
 * `retention_executions` has no per-item column and PI-C1 Phase 1 is
 * explicitly code-only, so the outcomes travel with the return value and are
 * summarised into the stored `detail`. No schema change is made or implied.
 */
export type RetentionRunResult = RetentionExecution & {
  outcomes: RetentionItemOutcome[];
};

/**
 * Which of `ids` are protected by an append-only child, as a set.
 *
 * Returns `null` when protection could NOT be determined — a read failure
 * here must never be read as "nothing is protected", because that would hand
 * the whole batch to a delete the guard will refuse. The caller fails closed.
 */
async function findProtectedIds(
  target: RetentionTarget,
  organizationId: string,
  ids: string[],
): Promise<{ protected: Set<string> } | { probeFailed: string }> {
  const children = RETENTION_PROTECTED_CHILDREN[target] ?? [];
  const found = new Set<string>();
  for (const child of children) {
    const { data, error } = await ownedDbTable(child.table)
      .select(child.parent_column)
      // Tenant predicate first: a protection probe must never read another
      // tenant's rows, even though it only ever returns parent ids.
      .eq('organization_id', organizationId)
      .in(child.parent_column, ids);
    if (error) {
      return { probeFailed: `${child.table}:${error.message}` };
    }
    // Through `unknown`: the client types a narrowed select as its own row
    // shape, which does not overlap an index signature.
    for (const row of (data as unknown as Array<Record<string, unknown>> | null) ?? []) {
      const parentId = row?.[child.parent_column];
      if (typeof parentId === 'string') found.add(parentId);
    }
  }
  return { protected: found };
}

export async function runRetentionPolicy(input: RetentionRunInput): Promise<RetentionRunResult> {
  const { data: policyRow, error: policyErr } = await ownedDbTable('retention_policies')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('id', input.policyId)
    .maybeSingle();
  if (policyErr) throw new Error(`retention_run_policy_load_failed:${policyErr.message}`);
  const policy = policyRow as RetentionPolicy | null;
  if (!policy) throw new Error(`retention_policy_not_found:${input.policyId}`);

  const binding = RETENTION_TARGET_BINDINGS[policy.target_kind];
  if (!binding) throw new Error(`retention_no_binding:${policy.target_kind}`);

  if (input.mode === 'execute' && policy.archival_mode === 'hard_delete' && APPEND_ONLY_TARGETS.has(policy.target_kind)) {
    throw new Error(`hard_delete_forbidden_on_audit_target:${policy.target_kind}`);
  }

  const cutoff = new Date(Date.now() - policy.retain_days * 24 * 60 * 60 * 1000).toISOString();

  // F-2: a read this run depends on must not fail silently.
  //
  // Both reads below used to discard their `error`. A failure then produced
  // `rowsScanned = 0` or an empty candidate list, every branch that could have
  // recorded a problem was skipped, and the execution was stored as
  // `completed` with zero rows — indistinguishable from "there was nothing to
  // do". A run that could not SEE its scope must never read as a run that
  // found it empty, so the failure is captured here and short-circuits
  // everything, including any deletion.
  let readFailure: string | null = null;

  // Count scope first — both modes record `rows_scanned`.
  const { count: scannedCount, error: scanErr } = await ownedDbTable(binding.table)
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', input.organizationId)
    .lt(binding.time_column, cutoff);
  if (scanErr) readFailure = `scan_count_failed:${scanErr.message}`;
  const rowsScanned = scanErr ? 0 : Number((scannedCount as unknown as number | null) ?? 0);
  const rowsToTouch = Math.min(rowsScanned, MAX_DELETE_BATCH);

  let rowsAffected = 0;
  let status: RetentionExecution['status'] = 'completed';
  let detail: string | null = null;
  const outcomes: RetentionItemOutcome[] = [];

  // Candidate ids are needed by both modes now: a dry run that cannot say
  // which rows are blocked is a preview of something that will not happen.
  const needsCandidates =
    !readFailure && rowsToTouch > 0 && policy.archival_mode === 'hard_delete';
  let candidateIds: string[] = [];
  if (needsCandidates) {
    const { data: pks, error: pkErr } = await ownedDbTable(binding.table)
      .select('id')
      .eq('organization_id', input.organizationId)
      .lt(binding.time_column, cutoff)
      .order(binding.time_column, { ascending: true })
      .limit(MAX_DELETE_BATCH);
    // F-2: an unreadable candidate list is not an empty candidate list.
    if (pkErr) readFailure = `candidate_select_failed:${pkErr.message}`;
    else candidateIds = ((pks as Array<{ id: string }> | null) ?? []).map((r) => r.id);
  }

  // Pre-exclusion, for BOTH modes. Protected parents are reported, never
  // handed to a delete that the guard would refuse for the whole statement.
  let protectedIds = new Set<string>();
  let probeFailure: string | null = null;
  if (!readFailure && candidateIds.length > 0) {
    const probe = await findProtectedIds(policy.target_kind, input.organizationId, candidateIds);
    if ('probeFailed' in probe) {
      probeFailure = probe.probeFailed;
    } else {
      protectedIds = probe.protected;
    }
  }

  if (readFailure) {
    // Fail closed, and say which read failed. No candidate ids are known to
    // be reportable per item — claiming any would be inventing scope — so the
    // failure is carried by `status` and `detail` under the existing contract.
    status = 'failed';
    detail = readFailure;
  } else if (probeFailure) {
    // Fail closed: protection is unknown, so delete nothing and say why.
    // Guessing here is what turns a refusal into a voided batch.
    status = 'failed';
    detail = `protection_probe_failed:${probeFailure}`;
    for (const id of candidateIds) {
      outcomes.push({ id, disposition: 'failed', reason: 'protection_undetermined' });
    }
  } else if (input.mode === 'execute' && rowsToTouch > 0) {
    if (policy.archival_mode === 'hard_delete') {
      const eligible = candidateIds.filter((id) => !protectedIds.has(id));
      for (const id of candidateIds) {
        if (protectedIds.has(id)) {
          outcomes.push({
            id,
            disposition: 'excluded_protected',
            reason: 'append_only_child_present',
          });
        }
      }
      if (eligible.length > 0) {
        // One statement for the common case. Protected parents are already
        // out, so a refusal here means protection this map does not know
        // about — which the per-item pass then isolates to its own row
        // instead of voiding every eligible row with it.
        // F-1: the tenant predicate is load-bearing, not decoration. The ids
        // come from a tenant-scoped select, so this is defence in depth — but
        // it is the only thing that still holds if that selection is ever
        // widened, mis-filtered, or fed from somewhere else. `organizationId`
        // is the authoritative tenant of the retention operation itself; it is
        // never taken from a row, a fixture, or anything the batch carries.
        const { error: delErr, count: deletedCount } = await ownedDbTable(binding.table)
          .delete({ count: 'exact' })
          .eq('organization_id', input.organizationId)
          .in('id', eligible);
        const batchCount = Number((deletedCount as unknown as number | null) ?? -1);
        // F-1: a successful statement is not per-id confirmation. If the
        // database reports fewer rows than were submitted — which the tenant
        // predicate can cause, by design, for an id that does not belong to
        // this tenant — then attributing `deleted` to every id would be a
        // false confirmation. Only an exact match is confirmation for all;
        // anything else is re-attributed one id at a time below.
        if (!delErr && batchCount === eligible.length) {
          rowsAffected = batchCount;
          for (const id of eligible) {
            outcomes.push({ id, disposition: 'deleted', reason: null });
          }
        } else if (!delErr) {
          // Short count, no error. The statement SUCCEEDED, so the database's
          // count is authoritative for how many rows went — but not for which,
          // and recovering that would need a cross-tenant read this operation
          // must not perform.
          //
          // A per-item retry would be actively worse: the batch has already
          // removed some of these rows, so re-attempting them reports them as
          // absent and under-counts deletions that genuinely happened. So the
          // count is reported as-is and the ids are marked indeterminate —
          // never `deleted`, which is what keeps a zero-row delete from
          // reading as a confirmation.
          rowsAffected = Math.max(0, batchCount);
          const shortfall = `batch_count_short_${Math.max(0, batchCount)}_of_${eligible.length}`;
          for (const id of eligible) {
            outcomes.push({ id, disposition: 'indeterminate', reason: shortfall });
          }
          detail = `${shortfall};per_id_attribution_unavailable`;
        } else {
          const batchRefusal = classifyLifecycleGuardError(delErr);
          for (const id of eligible) {
            // F-1: same tenant predicate on the fallback. The per-item pass
            // exists to isolate a refusal, which must not come at the cost of
            // a weaker scope than the batch it replaces.
            const perItem = await ownedDbTable(binding.table)
              .delete({ count: 'exact' })
              .eq('organization_id', input.organizationId)
              .eq('id', id);
            if (!perItem.error) {
              const affected = Number((perItem.count as unknown as number | null) ?? 1);
              if (affected > 0) {
                rowsAffected += affected;
                outcomes.push({ id, disposition: 'deleted', reason: null });
              } else {
                outcomes.push({ id, disposition: 'already_absent', reason: 'no_row_matched' });
              }
              continue;
            }
            const refusal = classifyLifecycleGuardError(perItem.error);
            if (refusal) {
              outcomes.push({
                id,
                disposition: 'excluded_protected',
                reason: `append_only_guard_${refusal.sqlstate}`,
              });
            } else {
              outcomes.push({
                id,
                disposition: 'failed',
                reason: `${(perItem.error as { code?: string }).code ?? 'unknown'}:${perItem.error.message}`,
              });
            }
          }
          detail = batchRefusal
            ? `batch_refused_append_only_${batchRefusal.sqlstate};isolated_per_item`
            : `batch_failed:${delErr.message};isolated_per_item`;
        }
      }
    } else {
      // soft_delete: Phase 7 records this as a "preview-like" action since
      // we don't add a soft-delete column to the targeted tables in this
      // migration. The execution is logged for audit; no row mutation.
      detail = 'soft_delete_skipped_no_column';
      status = 'partial';
      rowsAffected = 0;
    }
    // No `status !== 'failed'` guard: a whole-run failure is now decided in
    // the probe-failure arm above, which this branch is the alternative to, so
    // the only states reachable here are `completed` and `partial`.
    if (rowsScanned > rowsToTouch) {
      status = 'partial';
      detail = (detail ? detail + ' / ' : '') + `batch_limit_${MAX_DELETE_BATCH}_remaining_${rowsScanned - rowsToTouch}`;
    }
  } else if (input.mode === 'dry_run' && candidateIds.length > 0) {
    // A preview that hides the blocked rows is a preview of a run that will
    // not happen, so dry_run reports the same split without mutating anything.
    for (const id of candidateIds) {
      outcomes.push(
        protectedIds.has(id)
          ? { id, disposition: 'excluded_protected', reason: 'append_only_child_present' }
          : { id, disposition: 'would_delete', reason: null },
      );
    }
  }

  // Truthful summary. Counted from the outcomes themselves, so the stored row
  // can never disagree with the per-item record.
  const tally = (d: RetentionItemDisposition): number =>
    outcomes.reduce((n, o) => (o.disposition === d ? n + 1 : n), 0);
  const excluded = tally('excluded_protected');
  const failed = tally('failed');
  const absent = tally('already_absent');
  const indeterminate = tally('indeterminate');
  if (outcomes.length > 0) {
    const parts = [`deleted=${tally('deleted')}`];
    if (tally('would_delete') > 0) parts.push(`would_delete=${tally('would_delete')}`);
    if (excluded > 0) parts.push(`excluded_protected=${excluded}`);
    if (failed > 0) parts.push(`failed=${failed}`);
    if (absent > 0) parts.push(`already_absent=${absent}`);
    if (indeterminate > 0) parts.push(`indeterminate=${indeterminate}`);
    detail = (detail ? detail + ' / ' : '') + parts.join(' ');
  }
  // A run that could not do everything it scoped is never `completed`. Note a
  // protected exclusion is not a failure: the evidence is meant to survive.
  // `already_absent` and `indeterminate` also demote the run, because in both
  // cases the scope it announced and the work it can prove do not match.
  if (status === 'completed' && (excluded > 0 || failed > 0 || absent > 0 || indeterminate > 0)) {
    status = failed > 0 && rowsAffected === 0 ? 'failed' : 'partial';
  }

  const { data, error } = await ownedDbTable('retention_executions')
    .insert({
      organization_id: input.organizationId,
      retention_policy_id: input.policyId,
      execution_mode: input.mode,
      rows_scanned: rowsScanned,
      rows_affected: rowsAffected,
      cutoff_at: cutoff,
      status,
      detail,
      initiated_by: input.initiatedBy,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`retention_execution_insert_failed:${error?.message ?? 'unknown'}`);
  return { ...(data as RetentionExecution), outcomes };
}

export async function listRetentionExecutions(
  organizationId: string,
  options?: { policyId?: string; limit?: number },
): Promise<RetentionExecution[]> {
  let q = ownedDbTable('retention_executions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 50)));
  if (options?.policyId) q = q.eq('retention_policy_id', options.policyId);
  const { data, error } = await q;
  if (error) throw new Error(`retention_executions_list_failed:${error.message}`);
  return (data as RetentionExecution[]) ?? [];
}
