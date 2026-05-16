/**
 * Phase 8 — Operator tooling.
 *
 * Bounded operational controls with full audit attribution. Every action
 * writes to `operator_actions`. No autonomous caller exists — operations
 * are performed via the API by authenticated operators with the right
 * intelligence_rbac capability.
 *
 * Phase 8 ships the audit-log writer + a thin set of orchestration
 * helpers (pause / resume / throttle / recover). The underlying state
 * mutations live in existing services (e.g. listeningSourceService for
 * pause / resume), so this service is mostly a typed audit funnel.
 */

import { ownedDbTable } from '../db/writeOwner';
import { updateListeningSourceStatus } from './listeningSourceService';
import { recoverExpiredLeases } from './executionPartitionService';
import { recordCost } from './costGovernanceService';
import type {
  OperatorAction,
  OperatorActionKind,
  OperatorTargetKind,
} from '../types/operatorAction';

export type OperatorActionInput = {
  organizationId: string;
  actionKind: OperatorActionKind;
  targetKind: OperatorTargetKind | string;
  targetRef?: string | null;
  payload?: Record<string, unknown>;
  rationale?: string | null;
  actorUserId: string | null;
};

export async function recordOperatorAction(input: OperatorActionInput): Promise<OperatorAction> {
  const { data, error } = await ownedDbTable('operator_actions')
    .insert({
      organization_id: input.organizationId,
      action_kind: input.actionKind,
      target_kind: input.targetKind,
      target_ref: input.targetRef ?? null,
      payload: input.payload ?? {},
      rationale: input.rationale ?? null,
      actor_user_id: input.actorUserId,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`operator_action_insert_failed:${error?.message ?? 'unknown'}`);
  return data as OperatorAction;
}

export async function listOperatorActions(
  organizationId: string,
  options?: { actionKind?: OperatorActionKind; limit?: number },
): Promise<OperatorAction[]> {
  let q = ownedDbTable('operator_actions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.actionKind) q = q.eq('action_kind', options.actionKind);
  const { data, error } = await q;
  if (error) throw new Error(`operator_action_list_failed:${error.message}`);
  return (data as OperatorAction[]) ?? [];
}

/**
 * Pause a listening source (transitions status to 'paused'). Wraps the
 * existing source-state machine — pause is only valid from 'active' or
 * 'approved' status; the source service raises on invalid transitions.
 */
export async function pauseListeningSource(args: {
  organizationId: string;
  listeningSourceId: string;
  actorUserId: string | null;
  rationale?: string | null;
}): Promise<{ action: OperatorAction; ok: boolean; detail: string }> {
  try {
    await updateListeningSourceStatus(args.organizationId, args.listeningSourceId, 'paused');
  } catch (err: any) {
    const action = await recordOperatorAction({
      organizationId: args.organizationId,
      actionKind: 'pause',
      targetKind: 'connector',
      targetRef: args.listeningSourceId,
      payload: { failed: true, reason: err?.message ?? 'unknown' },
      rationale: args.rationale,
      actorUserId: args.actorUserId,
    });
    return { action, ok: false, detail: err?.message ?? 'pause_failed' };
  }
  const action = await recordOperatorAction({
    organizationId: args.organizationId,
    actionKind: 'pause',
    targetKind: 'connector',
    targetRef: args.listeningSourceId,
    rationale: args.rationale,
    actorUserId: args.actorUserId,
  });
  return { action, ok: true, detail: 'paused' };
}

export async function resumeListeningSource(args: {
  organizationId: string;
  listeningSourceId: string;
  actorUserId: string | null;
  rationale?: string | null;
}): Promise<{ action: OperatorAction; ok: boolean; detail: string }> {
  try {
    await updateListeningSourceStatus(args.organizationId, args.listeningSourceId, 'active');
  } catch (err: any) {
    const action = await recordOperatorAction({
      organizationId: args.organizationId,
      actionKind: 'resume',
      targetKind: 'connector',
      targetRef: args.listeningSourceId,
      payload: { failed: true, reason: err?.message ?? 'unknown' },
      rationale: args.rationale,
      actorUserId: args.actorUserId,
    });
    return { action, ok: false, detail: err?.message ?? 'resume_failed' };
  }
  const action = await recordOperatorAction({
    organizationId: args.organizationId,
    actionKind: 'resume',
    targetKind: 'connector',
    targetRef: args.listeningSourceId,
    rationale: args.rationale,
    actorUserId: args.actorUserId,
  });
  return { action, ok: true, detail: 'resumed' };
}

export async function recoverOrgPartitions(args: {
  organizationId: string;
  actorUserId: string | null;
  rationale?: string | null;
}): Promise<{ action: OperatorAction; recovered: number }> {
  const result = await recoverExpiredLeases(args.organizationId);
  const action = await recordOperatorAction({
    organizationId: args.organizationId,
    actionKind: 'recover',
    targetKind: 'partition',
    targetRef: 'all_expired',
    payload: { recovered: result.recovered },
    rationale: args.rationale,
    actorUserId: args.actorUserId,
  });
  return { action, recovered: result.recovered };
}

export async function approveOverage(args: {
  organizationId: string;
  category: 'embedding' | 'execution' | 'connector' | 'realtime' | 'storage' | 'semantic_indexing';
  units: number;
  attributionRef?: string | null;
  actorUserId: string | null;
  rationale?: string | null;
}): Promise<{ action: OperatorAction }> {
  await recordCost({
    organizationId: args.organizationId,
    category: args.category,
    units: args.units,
    decision: 'overage_approved',
    reasons: ['operator_approved_overage'],
    attributionKind: 'operator_overage',
    attributionRef: args.attributionRef ?? null,
  });
  const action = await recordOperatorAction({
    organizationId: args.organizationId,
    actionKind: 'budget_overage_approved',
    targetKind: 'cost_budget',
    targetRef: args.category,
    payload: { units: args.units },
    rationale: args.rationale,
    actorUserId: args.actorUserId,
  });
  return { action };
}
