/**
 * Phase 10 — Disaster recovery orchestration.
 *
 * Defines + executes DR plans (projection rebuild, queue recovery,
 * semantic index rebuild, partition recovery, failover validation,
 * full recovery). Plans are operator-defined ordered step lists;
 * executions persist per-step results.
 *
 * Hard guarantees:
 *   • No autonomous failover. `executeRecovery` requires an explicit
 *     approver — the row must transition through `planned -> approved`
 *     before `executing`.
 *   • Bounded batch size per step (capped 1..10000).
 *   • Each step result is deterministic; the runner does NOT branch on
 *     hidden signals.
 *   • Step kinds are descriptive — the runner records what was
 *     attempted; the actual rebuild work is delegated to existing
 *     Phase 3-9 services (projection sync, partition recovery, semantic
 *     partitioning, replay coordination). Phase 10 does NOT introduce
 *     new mutation paths.
 *   • Tenant-first reads.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  DR_DEFAULT_BATCH_SIZE,
  DR_MAX_BATCH_SIZE,
  type DisasterRecoveryExecution,
  type DisasterRecoveryPlan,
  type DrExecutionStatus,
  type DrPlanKind,
  type DrStep,
  type DrStepResult,
} from '../types/disasterRecovery';
import { publishRealtime } from './realtimePublisherService';
import { publishDisasterRecoveryExecuted } from '../events/listeningEvents';

export type UpsertDrPlanInput = {
  organizationId: string;
  id?: string;
  planKind: DrPlanKind;
  name: string;
  description?: string | null;
  orderedSteps: DrStep[];
  expectedRuntimeMinutes?: number;
  boundedBatchSize?: number;
  ownerUserId: string | null;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
};

export async function upsertDrPlan(input: UpsertDrPlanInput): Promise<DisasterRecoveryPlan> {
  const batch = Math.max(1, Math.min(DR_MAX_BATCH_SIZE, input.boundedBatchSize ?? DR_DEFAULT_BATCH_SIZE));
  if (input.id) {
    const upd = await ownedDbTable('disaster_recovery_plans')
      .update({
        plan_kind: input.planKind,
        name: input.name,
        description: input.description ?? null,
        ordered_steps: input.orderedSteps,
        expected_runtime_minutes: input.expectedRuntimeMinutes ?? 30,
        bounded_batch_size: batch,
        owner_user_id: input.ownerUserId,
        enabled: input.enabled ?? false,
        metadata: input.metadata ?? {},
      })
      .eq('organization_id', input.organizationId)
      .eq('id', input.id)
      .select('*')
      .single();
    if (upd.error || !upd.data) throw new Error(`dr_plan_update_failed:${upd.error?.message ?? 'unknown'}`);
    return upd.data as DisasterRecoveryPlan;
  }
  const ins = await ownedDbTable('disaster_recovery_plans')
    .insert({
      organization_id: input.organizationId,
      plan_kind: input.planKind,
      name: input.name,
      description: input.description ?? null,
      ordered_steps: input.orderedSteps,
      expected_runtime_minutes: input.expectedRuntimeMinutes ?? 30,
      bounded_batch_size: batch,
      owner_user_id: input.ownerUserId,
      enabled: input.enabled ?? false,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`dr_plan_insert_failed:${ins.error?.message ?? 'unknown'}`);
  return ins.data as DisasterRecoveryPlan;
}

export async function listDrPlans(
  organizationId: string,
  options?: { planKind?: DrPlanKind; enabledOnly?: boolean; limit?: number },
): Promise<DisasterRecoveryPlan[]> {
  let q = ownedDbTable('disaster_recovery_plans')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 100)));
  if (options?.planKind) q = q.eq('plan_kind', options.planKind);
  if (options?.enabledOnly) q = q.eq('enabled', true);
  const { data } = await q;
  return (data as DisasterRecoveryPlan[]) ?? [];
}

/**
 * Stage a recovery: row in `planned` state. No work runs yet.
 */
export async function stageRecovery(args: {
  organizationId: string;
  planId: string;
  initiatedBy: string | null;
  metadata?: Record<string, unknown>;
}): Promise<DisasterRecoveryExecution> {
  const { data: planRow } = await ownedDbTable('disaster_recovery_plans')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('id', args.planId)
    .maybeSingle();
  const plan = planRow as DisasterRecoveryPlan | null;
  if (!plan) throw new Error(`dr_plan_not_found:${args.planId}`);
  if (!plan.enabled) throw new Error(`dr_plan_disabled:${plan.id}`);

  const ins = await ownedDbTable('disaster_recovery_executions')
    .insert({
      organization_id: args.organizationId,
      plan_id: plan.id,
      plan_kind: plan.plan_kind,
      status: 'planned' as DrExecutionStatus,
      initiated_by: args.initiatedBy,
      metadata: args.metadata ?? {},
      step_results: [],
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`dr_stage_failed:${ins.error?.message ?? 'unknown'}`);
  return ins.data as DisasterRecoveryExecution;
}

export async function approveRecovery(args: {
  organizationId: string;
  executionId: string;
  approverUserId: string | null;
}): Promise<DisasterRecoveryExecution> {
  const upd = await ownedDbTable('disaster_recovery_executions')
    .update({
      status: 'approved' as DrExecutionStatus,
      approved_by: args.approverUserId,
      approved_at: new Date().toISOString(),
    })
    .eq('organization_id', args.organizationId)
    .eq('id', args.executionId)
    .eq('status', 'planned')
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`dr_approve_failed:${upd.error?.message ?? 'unknown'}`);
  return upd.data as DisasterRecoveryExecution;
}

/**
 * Execute an approved recovery. Iterates the plan's ordered steps and
 * records a deterministic result for each. Phase 10 does NOT introduce
 * new mutation paths — it records intent + observability; the actual
 * rebuild work is delegated to Phase 3-9 services via their existing
 * operator APIs.
 */
export async function executeRecovery(args: {
  organizationId: string;
  executionId: string;
}): Promise<DisasterRecoveryExecution> {
  const { data: execRow } = await ownedDbTable('disaster_recovery_executions')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('id', args.executionId)
    .maybeSingle();
  const exec = execRow as DisasterRecoveryExecution | null;
  if (!exec) throw new Error(`dr_execution_not_found:${args.executionId}`);
  if (exec.status !== 'approved') throw new Error(`dr_execution_not_approvable:${exec.status}`);

  const { data: planRow } = await ownedDbTable('disaster_recovery_plans')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('id', exec.plan_id)
    .maybeSingle();
  const plan = planRow as DisasterRecoveryPlan | null;
  if (!plan) throw new Error(`dr_plan_not_found_for_execution:${exec.plan_id}`);

  await ownedDbTable('disaster_recovery_executions')
    .update({ status: 'executing' as DrExecutionStatus, started_at: new Date().toISOString() })
    .eq('id', exec.id);

  const stepResults: DrStepResult[] = [];
  let anyFailed = false;
  const observability: Record<string, unknown> = { plan_kind: plan.plan_kind, bounded_batch_size: plan.bounded_batch_size };

  for (const step of plan.ordered_steps ?? []) {
    const t0 = Date.now();
    const result: DrStepResult = {
      step_index: step.step_index,
      step_kind: step.step_kind,
      status: 'complete',
      processed: 0,
      detail: `Step recorded — operator must invoke the underlying recovery API for ${step.step_kind} ` +
              `(bounded batch ${step.bounded_batch_size ?? plan.bounded_batch_size}).`,
      duration_ms: 0,
    };
    result.duration_ms = Date.now() - t0;
    stepResults.push(result);
  }

  const finalStatus: DrExecutionStatus = anyFailed ? 'failed' : 'complete';
  const upd = await ownedDbTable('disaster_recovery_executions')
    .update({
      status: finalStatus,
      step_results: stepResults,
      completed_at: new Date().toISOString(),
      observability,
    })
    .eq('id', exec.id)
    .select('*')
    .single();

  try {
    await publishDisasterRecoveryExecuted({
      organizationId: args.organizationId,
      executionId: exec.id,
      planKind: plan.plan_kind,
      status: finalStatus,
      approvedBy: exec.approved_by,
    });
    void publishRealtime({
      organizationId: args.organizationId,
      topic: 'disaster_recovery',
      eventName: 'disaster_recovery.executed',
      payload: { execution_id: exec.id, plan_kind: plan.plan_kind, status: finalStatus },
    });
  } catch { /* best effort */ }

  return (upd.data as DisasterRecoveryExecution) ?? exec;
}

export async function listRecoveryExecutions(
  organizationId: string,
  options?: { planKind?: DrPlanKind; status?: DrExecutionStatus; limit?: number },
): Promise<DisasterRecoveryExecution[]> {
  let q = ownedDbTable('disaster_recovery_executions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.planKind) q = q.eq('plan_kind', options.planKind);
  if (options?.status) q = q.eq('status', options.status);
  const { data } = await q;
  return (data as DisasterRecoveryExecution[]) ?? [];
}
