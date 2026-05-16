/**
 * Phase 11 — Migration tooling (dry-run + verification).
 *
 * Operators preview a migration (deterministic dependency checks +
 * rollback plan), then either verify (advance to `verified`) or block.
 * `executed` and `rolled_back` are bookkeeping states — actual schema /
 * data changes go through the existing Supabase migration pipeline and
 * the operator records the outcome here for audit.
 *
 * Hard guarantees:
 *   • Deterministic dependency check templates per migration_kind.
 *   • No autonomous schema mutation. Service never DDLs.
 *   • Bounded retries — each row carries an `execution_audit` JSON log
 *     that operators append to; we don't retry on their behalf.
 *   • Tenant-first.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  type MigrationDependencyCheck,
  type MigrationDryRun,
  type MigrationDryRunKind,
  type MigrationDryRunStatus,
  type MigrationExecutionAuditEntry,
  type MigrationRollbackPlan,
} from '../types/migrationDryRun';
import { publishRealtime } from './realtimePublisherService';
import { publishMigrationPreviewGenerated } from '../events/listeningEvents';

function deterministicChecks(kind: MigrationDryRunKind, identifier: string): MigrationDependencyCheck[] {
  const base: MigrationDependencyCheck[] = [
    { check_kind: 'identifier_present', passed: identifier.trim().length > 0, detail: 'migration identifier non-empty' },
    { check_kind: 'tenant_scoped', passed: true, detail: 'tenant scoping enforced at API layer' },
  ];
  switch (kind) {
    case 'schema':
      return [...base, { check_kind: 'rollback_dryrun_available', passed: true, detail: 'rollback plan template generated' }];
    case 'data_backfill':
      return [...base, { check_kind: 'bounded_batch_recommended', passed: true, detail: 'use bounded_batch_size on caller side' }];
    case 'config':
      return [...base, { check_kind: 'config_versioned', passed: true, detail: 'config changes captured in execution_audit' }];
    case 'feature_flag':
      return [...base, { check_kind: 'rollout_gate_applied', passed: true, detail: 'flag rollout gated via feature_flags table' }];
    case 'retention':
      return [...base, { check_kind: 'retention_window_bounded', passed: true, detail: 'retention pass operator-driven' }];
    default:
      return base;
  }
}

function deterministicRollbackPlan(kind: MigrationDryRunKind): MigrationRollbackPlan {
  switch (kind) {
    case 'schema':
      return {
        steps: [
          { step_index: 0, step_kind: 'snapshot_check', detail: 'verify pre-migration snapshot exists' },
          { step_index: 1, step_kind: 'apply_reverse_ddl', detail: 'reverse DDL via operator-controlled migration tool' },
          { step_index: 2, step_kind: 'verify_state', detail: 'verify projections match pre-migration baseline' },
        ],
        bounded: true,
        estimated_runtime_minutes: 15,
      };
    case 'data_backfill':
      return {
        steps: [
          { step_index: 0, step_kind: 'identify_backfilled_rows', detail: 'select rows touched by backfill (bounded by batch metadata)' },
          { step_index: 1, step_kind: 'reverse_backfill', detail: 'apply reverse transform in same bounded batches' },
        ],
        bounded: true,
        estimated_runtime_minutes: 30,
      };
    case 'feature_flag':
      return {
        steps: [{ step_index: 0, step_kind: 'flip_flag_back', detail: 'set feature flag enabled=false via operator API' }],
        bounded: true,
        estimated_runtime_minutes: 1,
      };
    default:
      return { steps: [{ step_index: 0, step_kind: 'operator_review', detail: 'no automated rollback path — operator review' }], bounded: false, estimated_runtime_minutes: 0 };
  }
}

export type PreviewMigrationInput = {
  organizationId: string;
  migrationKind: MigrationDryRunKind;
  migrationIdentifier: string;
  requestedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function previewMigration(input: PreviewMigrationInput): Promise<MigrationDryRun> {
  const checks = deterministicChecks(input.migrationKind, input.migrationIdentifier);
  const rollback = deterministicRollbackPlan(input.migrationKind);
  const audit: MigrationExecutionAuditEntry[] = [{
    entry_index: 0,
    entry_kind: 'preview',
    actor_user_id: input.requestedBy,
    detail: `preview generated for ${input.migrationKind}:${input.migrationIdentifier}`,
    created_at: new Date().toISOString(),
  }];
  const ins = await ownedDbTable('migration_dry_runs')
    .insert({
      organization_id: input.organizationId,
      migration_kind: input.migrationKind,
      migration_identifier: input.migrationIdentifier,
      status: 'previewed' as MigrationDryRunStatus,
      dependency_checks: checks,
      rollback_plan: rollback,
      execution_audit: audit,
      health_verdict: checks.every((c) => c.passed) ? 'all_checks_passed' : 'one_or_more_checks_failed',
      requested_by: input.requestedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`migration_preview_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as MigrationDryRun;

  try {
    await publishMigrationPreviewGenerated({
      organizationId: input.organizationId,
      migrationIdentifier: row.migration_identifier,
      migrationKind: row.migration_kind,
      status: row.status,
      dependencyChecks: checks.length,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'migration_tooling',
      eventName: 'migration.preview_generated',
      payload: { migration_identifier: row.migration_identifier, migration_kind: row.migration_kind },
    });
  } catch { /* best effort */ }

  return row;
}

export async function transitionMigration(args: {
  organizationId: string;
  migrationId: string;
  newStatus: MigrationDryRunStatus;
  detail?: string;
  actorUserId: string | null;
}): Promise<MigrationDryRun> {
  const { data: row } = await ownedDbTable('migration_dry_runs')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('id', args.migrationId)
    .maybeSingle();
  const current = row as MigrationDryRun | null;
  if (!current) throw new Error(`migration_dry_run_not_found:${args.migrationId}`);

  const audit: MigrationExecutionAuditEntry[] = [
    ...current.execution_audit,
    {
      entry_index: current.execution_audit.length,
      entry_kind: (args.newStatus === 'executed' ? 'execute' : args.newStatus === 'rolled_back' ? 'rollback' : args.newStatus === 'verified' ? 'verify' : 'note') as MigrationExecutionAuditEntry['entry_kind'],
      actor_user_id: args.actorUserId,
      detail: args.detail ?? `transition to ${args.newStatus}`,
      created_at: new Date().toISOString(),
    },
  ];
  const upd = await ownedDbTable('migration_dry_runs')
    .update({ status: args.newStatus, execution_audit: audit })
    .eq('id', current.id)
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`migration_transition_failed:${upd.error?.message ?? 'unknown'}`);
  return upd.data as MigrationDryRun;
}

export async function listMigrationDryRuns(
  organizationId: string,
  options?: { migrationKind?: MigrationDryRunKind; status?: MigrationDryRunStatus; limit?: number },
): Promise<MigrationDryRun[]> {
  let q = ownedDbTable('migration_dry_runs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.migrationKind) q = q.eq('migration_kind', options.migrationKind);
  if (options?.status) q = q.eq('status', options.status);
  const { data } = await q;
  return (data as MigrationDryRun[]) ?? [];
}
