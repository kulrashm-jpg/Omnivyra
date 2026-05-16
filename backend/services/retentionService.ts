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
  RETENTION_TARGETS,
  RETENTION_TARGET_BINDINGS,
} from '../types/retention';

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

export async function runRetentionPolicy(input: RetentionRunInput): Promise<RetentionExecution> {
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

  // Count scope first — both modes record `rows_scanned`.
  const { count: scannedCount } = await ownedDbTable(binding.table)
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', input.organizationId)
    .lt(binding.time_column, cutoff);
  const rowsScanned = Number((scannedCount as unknown as number | null) ?? 0);
  const rowsToTouch = Math.min(rowsScanned, MAX_DELETE_BATCH);

  let rowsAffected = 0;
  let status: RetentionExecution['status'] = 'completed';
  let detail: string | null = null;

  if (input.mode === 'execute' && rowsToTouch > 0) {
    if (policy.archival_mode === 'hard_delete') {
      // Select PKs first to enforce the batch ceiling, then delete by id.
      const { data: pks } = await ownedDbTable(binding.table)
        .select('id')
        .eq('organization_id', input.organizationId)
        .lt(binding.time_column, cutoff)
        .order(binding.time_column, { ascending: true })
        .limit(MAX_DELETE_BATCH);
      const ids = ((pks as Array<{ id: string }> | null) ?? []).map((r) => r.id);
      if (ids.length > 0) {
        const { error: delErr, count: deletedCount } = await ownedDbTable(binding.table)
          .delete({ count: 'exact' })
          .in('id', ids);
        if (delErr) {
          status = 'failed';
          detail = delErr.message;
        } else {
          rowsAffected = Number((deletedCount as unknown as number | null) ?? ids.length);
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
    if (rowsScanned > rowsToTouch && status !== 'failed') {
      status = 'partial';
      detail = (detail ? detail + ' / ' : '') + `batch_limit_${MAX_DELETE_BATCH}_remaining_${rowsScanned - rowsToTouch}`;
    }
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
  return data as RetentionExecution;
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
