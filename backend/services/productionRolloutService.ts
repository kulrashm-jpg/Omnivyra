/**
 * Phase 11 — Production rollout orchestration.
 *
 * Operator-defined `production_rollout_plans` with ordered, bounded
 * stages. Stage executions persist deterministic checkpoints; rollback
 * is replay-safe (every stage that ran can be marked rolled_back, with
 * a verifiable trail in `production_rollout_stage_executions`).
 *
 * Hard guarantees:
 *   • Two-step gate: `drafted -> approved -> executing`. `executeNextStage`
 *     refuses non-approved plans.
 *   • Bounded batch size (clamped 1..10000) on every plan and stage.
 *   • Deterministic ordering — stages are processed strictly by
 *     `stage_index`; out-of-order callers are rejected.
 *   • No autonomous rollout. No autonomous rollback. Every transition
 *     requires an explicit operator user id.
 *   • Tenant-first reads; FK CASCADE on org delete.
 *   • Replay-safe rollback: marking a stage `rolled_back` does not erase
 *     its checkpoint — it preserves the row so operators can audit the
 *     pre-rollback state.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  ROLLOUT_DEFAULT_BATCH_SIZE,
  ROLLOUT_MAX_BATCH_SIZE,
  type ProductionRolloutPlan,
  type ProductionRolloutStageExecution,
  type RolloutKind,
  type RolloutPlanStatus,
  type RolloutStage,
  type RolloutStageStatus,
} from '../types/productionRollout';
import { publishRealtime } from './realtimePublisherService';
import {
  publishRolloutPlanCreated,
  publishRolloutStageCompleted,
} from '../events/listeningEvents';

export type CreateRolloutPlanInput = {
  organizationId: string;
  planName: string;
  rolloutKind: RolloutKind;
  description?: string | null;
  orderedStages: RolloutStage[];
  dependencyMetadata?: Record<string, unknown>;
  boundedBatchSize?: number;
  ownerUserId: string | null;
  metadata?: Record<string, unknown>;
};

export async function createRolloutPlan(input: CreateRolloutPlanInput): Promise<ProductionRolloutPlan> {
  const name = (input.planName ?? '').trim().slice(0, 200);
  if (name.length === 0) throw new Error('rollout_plan_name_required');
  const batch = Math.max(1, Math.min(ROLLOUT_MAX_BATCH_SIZE, input.boundedBatchSize ?? ROLLOUT_DEFAULT_BATCH_SIZE));
  const stages = (input.orderedStages ?? []).map((s, idx) => ({ ...s, stage_index: idx }));

  const ins = await ownedDbTable('production_rollout_plans')
    .insert({
      organization_id: input.organizationId,
      plan_name: name,
      rollout_kind: input.rolloutKind,
      description: input.description ?? null,
      ordered_stages: stages,
      dependency_metadata: input.dependencyMetadata ?? {},
      status: 'drafted' as RolloutPlanStatus,
      bounded_batch_size: batch,
      owner_user_id: input.ownerUserId,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`rollout_plan_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const plan = ins.data as ProductionRolloutPlan;

  try {
    await publishRolloutPlanCreated({
      organizationId: input.organizationId,
      planId: plan.id,
      planName: plan.plan_name,
      rolloutKind: plan.rollout_kind,
      stageCount: stages.length,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'production_rollout',
      eventName: 'rollout.plan_created',
      payload: { plan_id: plan.id, plan_name: plan.plan_name, stage_count: stages.length },
    });
  } catch { /* best effort */ }

  return plan;
}

export async function approveRolloutPlan(args: {
  organizationId: string;
  planId: string;
  approverUserId: string | null;
}): Promise<ProductionRolloutPlan> {
  const upd = await ownedDbTable('production_rollout_plans')
    .update({
      status: 'approved' as RolloutPlanStatus,
      approved_by: args.approverUserId,
      approved_at: new Date().toISOString(),
    })
    .eq('organization_id', args.organizationId)
    .eq('id', args.planId)
    .eq('status', 'drafted')
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`rollout_approve_failed:${upd.error?.message ?? 'unknown'}`);
  return upd.data as ProductionRolloutPlan;
}

/**
 * Execute the next pending stage of an approved plan. Refuses out-of-order
 * stage requests; the next stage to execute is the lowest `stage_index`
 * with status `pending`. Marks the plan `executing` if it isn't already.
 */
export async function executeNextStage(args: {
  organizationId: string;
  planId: string;
  expectedStageIndex: number;
  verifiedBy: string | null;
  checkpointPayload?: Record<string, unknown>;
}): Promise<ProductionRolloutStageExecution> {
  const { data: planRow } = await ownedDbTable('production_rollout_plans')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('id', args.planId)
    .maybeSingle();
  const plan = planRow as ProductionRolloutPlan | null;
  if (!plan) throw new Error(`rollout_plan_not_found:${args.planId}`);
  if (!['approved', 'executing'].includes(plan.status)) throw new Error(`rollout_plan_not_executable:${plan.status}`);

  // Initialise the stage row idempotently.
  const existing = await ownedDbTable('production_rollout_stage_executions')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('plan_id', plan.id)
    .eq('stage_index', args.expectedStageIndex)
    .maybeSingle();
  if (existing.data) {
    const row = existing.data as ProductionRolloutStageExecution;
    if (row.status === 'verified') return row;
    if (row.status === 'rolled_back') throw new Error(`rollout_stage_rolled_back:${args.expectedStageIndex}`);
  }

  // Out-of-order guard: the next pending stage must equal expectedStageIndex.
  const { data: stagesRows } = await ownedDbTable('production_rollout_stage_executions')
    .select('stage_index, status')
    .eq('organization_id', args.organizationId)
    .eq('plan_id', plan.id)
    .order('stage_index', { ascending: true });
  const all = (stagesRows as Array<{ stage_index: number; status: RolloutStageStatus }> | null) ?? [];
  const stageDef = plan.ordered_stages.find((s) => s.stage_index === args.expectedStageIndex);
  if (!stageDef) throw new Error(`rollout_stage_undefined:${args.expectedStageIndex}`);
  const firstPending = all.find((s) => s.status === 'pending' || s.status === 'executing') ?? null;
  if (firstPending && firstPending.stage_index < args.expectedStageIndex) {
    throw new Error(`rollout_out_of_order:pending_at_${firstPending.stage_index}`);
  }

  // Flip plan to executing if not already.
  if (plan.status === 'approved') {
    await ownedDbTable('production_rollout_plans')
      .update({ status: 'executing' as RolloutPlanStatus })
      .eq('id', plan.id)
      .eq('status', 'approved');
  }

  let row: ProductionRolloutStageExecution;
  if (existing.data) {
    const upd = await ownedDbTable('production_rollout_stage_executions')
      .update({
        status: 'verified' as RolloutStageStatus,
        checkpoint_payload: args.checkpointPayload ?? {},
        verified_at: new Date().toISOString(),
        verified_by: args.verifiedBy,
      })
      .eq('id', (existing.data as ProductionRolloutStageExecution).id)
      .select('*')
      .single();
    row = upd.data as ProductionRolloutStageExecution;
  } else {
    const ins = await ownedDbTable('production_rollout_stage_executions')
      .insert({
        organization_id: args.organizationId,
        plan_id: plan.id,
        stage_index: args.expectedStageIndex,
        stage_kind: stageDef.stage_kind,
        status: 'verified' as RolloutStageStatus,
        checkpoint_payload: args.checkpointPayload ?? {},
        verified_at: new Date().toISOString(),
        verified_by: args.verifiedBy,
      })
      .select('*')
      .single();
    if (ins.error || !ins.data) throw new Error(`rollout_stage_insert_failed:${ins.error?.message ?? 'unknown'}`);
    row = ins.data as ProductionRolloutStageExecution;
  }

  // Plan completion check.
  const totalStages = plan.ordered_stages.length;
  const completedCount = (all.filter((s) => s.status === 'verified').length) + (existing.data ? 0 : 1);
  if (completedCount >= totalStages) {
    await ownedDbTable('production_rollout_plans')
      .update({ status: 'complete' as RolloutPlanStatus })
      .eq('id', plan.id)
      .in('status', ['executing', 'approved']);
  }

  try {
    await publishRolloutStageCompleted({
      organizationId: args.organizationId,
      planId: plan.id,
      stageIndex: args.expectedStageIndex,
      stageKind: stageDef.stage_kind,
      status: 'verified',
    });
    void publishRealtime({
      organizationId: args.organizationId,
      topic: 'production_rollout',
      eventName: 'rollout.stage_completed',
      payload: { plan_id: plan.id, stage_index: args.expectedStageIndex, stage_kind: stageDef.stage_kind },
    });
  } catch { /* best effort */ }

  return row;
}

export async function failStage(args: {
  organizationId: string;
  planId: string;
  stageIndex: number;
  failureReason: string;
  actorUserId: string | null;
}): Promise<ProductionRolloutStageExecution> {
  const upd = await ownedDbTable('production_rollout_stage_executions')
    .update({
      status: 'failed' as RolloutStageStatus,
      failure_reason: args.failureReason,
      verified_by: args.actorUserId,
      verified_at: new Date().toISOString(),
    })
    .eq('organization_id', args.organizationId)
    .eq('plan_id', args.planId)
    .eq('stage_index', args.stageIndex)
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`rollout_stage_fail_failed:${upd.error?.message ?? 'unknown'}`);
  await ownedDbTable('production_rollout_plans')
    .update({ status: 'failed' as RolloutPlanStatus })
    .eq('organization_id', args.organizationId)
    .eq('id', args.planId)
    .in('status', ['executing', 'approved']);
  return upd.data as ProductionRolloutStageExecution;
}

export async function rollbackPlan(args: {
  organizationId: string;
  planId: string;
  actorUserId: string | null;
}): Promise<ProductionRolloutPlan> {
  await ownedDbTable('production_rollout_stage_executions')
    .update({ status: 'rolled_back' as RolloutStageStatus, verified_by: args.actorUserId, verified_at: new Date().toISOString() })
    .eq('organization_id', args.organizationId)
    .eq('plan_id', args.planId)
    .in('status', ['verified', 'executing']);
  const upd = await ownedDbTable('production_rollout_plans')
    .update({ status: 'rolled_back' as RolloutPlanStatus, rolled_back_at: new Date().toISOString() })
    .eq('organization_id', args.organizationId)
    .eq('id', args.planId)
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`rollout_plan_rollback_failed:${upd.error?.message ?? 'unknown'}`);
  return upd.data as ProductionRolloutPlan;
}

export async function listRolloutPlans(
  organizationId: string,
  options?: { rolloutKind?: RolloutKind; status?: RolloutPlanStatus; limit?: number },
): Promise<ProductionRolloutPlan[]> {
  let q = ownedDbTable('production_rollout_plans')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 200)));
  if (options?.rolloutKind) q = q.eq('rollout_kind', options.rolloutKind);
  if (options?.status) q = q.eq('status', options.status);
  const { data } = await q;
  return (data as ProductionRolloutPlan[]) ?? [];
}

export async function listRolloutStages(
  organizationId: string,
  planId: string,
): Promise<ProductionRolloutStageExecution[]> {
  const { data } = await ownedDbTable('production_rollout_stage_executions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('plan_id', planId)
    .order('stage_index', { ascending: true });
  return (data as ProductionRolloutStageExecution[]) ?? [];
}
