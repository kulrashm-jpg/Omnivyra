/**
 * Phase 12 — Bounded resilience-assist advisory planning.
 *
 * Operator-triggered, deterministic, advisory-only plan generation.
 * Output rows describe steps the operator can take using existing
 * Phase 3-11 APIs — this service NEVER auto-executes recovery, replay,
 * stabilization, or rollback. It is a planning surface, not a runner.
 *
 * Hard guarantees:
 *   • `status = 'advisory'` on insert; transitions only to `acknowledged`,
 *     `superseded`, or `expired` — never to `executed`.
 *   • Bounded batch size (1..10000).
 *   • Every plan carries a `derivation_explanation` and typed
 *     `evidence_refs` to upstream rows.
 *   • Operator-driven generation.
 *   • Tenant-first.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  RESILIENCE_ADVISORY_DEFAULT_BATCH_SIZE,
  RESILIENCE_ADVISORY_MAX_BATCH_SIZE,
  type AdvisoryEvidenceRef,
  type AdvisoryStep,
  type ResilienceAdvisoryPlan,
  type ResilienceAdvisoryPlanKind,
  type ResilienceAdvisoryStatus,
} from '../types/resilienceAdvisory';
import { publishRealtime } from './realtimePublisherService';
import { publishResiliencePlanGenerated } from '../events/listeningEvents';

function deterministicSteps(kind: ResilienceAdvisoryPlanKind): AdvisoryStep[] {
  switch (kind) {
    case 'recovery':
      return [
        { step_index: 0, step_kind: 'capture_snapshot', detail: 'capture an SRE health snapshot before recovery', external_api_hint: 'POST /api/active-leads/deployment-telemetry' },
        { step_index: 1, step_kind: 'stage_dr', detail: 'stage the relevant DR plan execution', external_api_hint: 'POST /api/active-leads/disaster-recovery' },
        { step_index: 2, step_kind: 'approve_dr', detail: 'have a second operator approve the staged execution', external_api_hint: 'POST /api/active-leads/disaster-recovery' },
        { step_index: 3, step_kind: 'execute_dr', detail: 'execute the approved plan; collect step results', external_api_hint: 'POST /api/active-leads/disaster-recovery' },
        { step_index: 4, step_kind: 'capture_snapshot_after', detail: 'capture a follow-up SRE snapshot to verify recovery' },
      ];
    case 'replay':
      return [
        { step_index: 0, step_kind: 'request_replay', detail: 'create a replay operation via the replay endpoint', external_api_hint: 'POST /api/active-leads/replay' },
        { step_index: 1, step_kind: 'preview_and_approve', detail: 'preview and approve' },
        { step_index: 2, step_kind: 'partition_and_enqueue', detail: 'partition + enqueue the approved replay', bounded_batch_size: 100, external_api_hint: 'POST /api/active-leads/replay-coordination' },
        { step_index: 3, step_kind: 'observe_partitions', detail: 'monitor partition progression via the replay UI' },
      ];
    case 'stabilization':
      return [
        { step_index: 0, step_kind: 'create_window', detail: 'create a stabilization window covering the at-risk scope', external_api_hint: 'POST /api/active-leads/platform-stabilization' },
        { step_index: 1, step_kind: 'activate_window', detail: 'activate the window when the high-risk operation begins' },
        { step_index: 2, step_kind: 'monitor_safeguards', detail: 'observe safety rail state during the window' },
        { step_index: 3, step_kind: 'close_window', detail: 'close the window once the operation completes' },
      ];
    case 'rollback_preparation':
      return [
        { step_index: 0, step_kind: 'identify_rollout', detail: 'identify the affected rollout plan' },
        { step_index: 1, step_kind: 'capture_evidence', detail: 'generate a support snapshot bundle for the affected scope', external_api_hint: 'POST /api/active-leads/support-snapshots' },
        { step_index: 2, step_kind: 'preflight_rollback', detail: 'review the rollback plan & confirm bounded batch sizes' },
        { step_index: 3, step_kind: 'rollback_plan', detail: 'invoke rollback via the production-rollout endpoint when ready', external_api_hint: 'POST /api/active-leads/production-rollout' },
      ];
    case 'partition_recovery':
      return [
        { step_index: 0, step_kind: 'identify_failed_partitions', detail: 'list failed semantic / replay partitions' },
        { step_index: 1, step_kind: 'recover_partitions', detail: 'recover via operator action', external_api_hint: 'POST /api/active-leads/operator-tools (action=recover_partitions)' },
        { step_index: 2, step_kind: 'verify_health', detail: 'capture a follow-up SRE snapshot' },
      ];
  }
}

async function gatherEvidence(
  organizationId: string,
  kind: ResilienceAdvisoryPlanKind,
): Promise<AdvisoryEvidenceRef[]> {
  switch (kind) {
    case 'recovery': {
      const { data } = await ownedDbTable('sre_health_snapshots')
        .select('id, snapshot_kind, health_state')
        .eq('organization_id', organizationId)
        .neq('health_state', 'healthy')
        .order('created_at', { ascending: false })
        .limit(5);
      return ((data as Array<{ id: string; snapshot_kind: string; health_state: string }>) ?? []).map((r) => ({
        source_kind: 'sre_health_snapshots',
        source_id: r.id,
        detail: `${r.snapshot_kind} → ${r.health_state}`,
      }));
    }
    case 'replay': {
      const { data } = await ownedDbTable('replay_partitions')
        .select('id, partition_index, status, failure_reason')
        .eq('organization_id', organizationId)
        .eq('status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(5);
      return ((data as Array<{ id: string; partition_index: number; failure_reason: string | null }>) ?? []).map((r) => ({
        source_kind: 'replay_partitions',
        source_id: r.id,
        detail: `#${r.partition_index} failed: ${r.failure_reason ?? 'unspecified'}`,
      }));
    }
    case 'stabilization': {
      const { data } = await ownedDbTable('operational_safety_rails')
        .select('id, rail_kind, state, observed_value, threshold_value')
        .eq('organization_id', organizationId)
        .neq('state', 'green')
        .limit(10);
      return ((data as Array<{ id: string; rail_kind: string; state: string }>) ?? []).map((r) => ({
        source_kind: 'operational_safety_rails',
        source_id: r.id,
        detail: `${r.rail_kind} → ${r.state}`,
      }));
    }
    case 'rollback_preparation': {
      const { data } = await ownedDbTable('production_rollout_plans')
        .select('id, plan_name, status')
        .eq('organization_id', organizationId)
        .in('status', ['executing', 'failed'])
        .order('updated_at', { ascending: false })
        .limit(5);
      return ((data as Array<{ id: string; plan_name: string; status: string }>) ?? []).map((r) => ({
        source_kind: 'production_rollout_plans',
        source_id: r.id,
        detail: `${r.plan_name} → ${r.status}`,
      }));
    }
    case 'partition_recovery': {
      const { data } = await ownedDbTable('execution_partitions')
        .select('id, partition_key, status')
        .eq('organization_id', organizationId)
        .in('status', ['expired', 'quarantined'])
        .limit(10);
      return ((data as Array<{ id: string; partition_key: string; status: string }>) ?? []).map((r) => ({
        source_kind: 'execution_partitions',
        source_id: r.id,
        detail: `${r.partition_key} → ${r.status}`,
      }));
    }
  }
}

export type GenerateAdvisoryInput = {
  organizationId: string;
  planKind: ResilienceAdvisoryPlanKind;
  triggerSummary: string;
  boundedBatchSize?: number;
  generatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function generateAdvisoryPlan(input: GenerateAdvisoryInput): Promise<ResilienceAdvisoryPlan> {
  const steps = deterministicSteps(input.planKind);
  const evidence = await gatherEvidence(input.organizationId, input.planKind);
  const batch = Math.max(1, Math.min(RESILIENCE_ADVISORY_MAX_BATCH_SIZE, input.boundedBatchSize ?? RESILIENCE_ADVISORY_DEFAULT_BATCH_SIZE));
  const explanation =
    `plan_kind=${input.planKind}; steps=${steps.length}; evidence=${evidence.length}; advisory=true; ` +
    `no autonomous execution will occur.`;

  const ins = await ownedDbTable('resilience_advisory_plans')
    .insert({
      organization_id: input.organizationId,
      plan_kind: input.planKind,
      trigger_summary: input.triggerSummary,
      recommended_steps: steps,
      bounded_batch_size: batch,
      evidence_refs: evidence,
      derivation_explanation: explanation,
      status: 'advisory' as ResilienceAdvisoryStatus,
      generated_by: input.generatedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`resilience_advisory_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as ResilienceAdvisoryPlan;

  try {
    await publishResiliencePlanGenerated({
      organizationId: input.organizationId,
      planId: row.id,
      planKind: row.plan_kind,
      recommendedSteps: steps.length,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'resilience_advisory',
      eventName: 'resilience.plan_generated',
      payload: { plan_id: row.id, plan_kind: row.plan_kind, recommended_steps: steps.length },
    });
  } catch { /* best effort */ }

  return row;
}

export async function transitionAdvisoryStatus(args: {
  organizationId: string;
  planId: string;
  newStatus: 'acknowledged' | 'superseded' | 'expired';
  actorUserId: string | null;
}): Promise<ResilienceAdvisoryPlan> {
  const patch: Record<string, unknown> = { status: args.newStatus };
  if (args.newStatus === 'acknowledged') {
    patch.acknowledged_by = args.actorUserId;
    patch.acknowledged_at = new Date().toISOString();
  }
  const upd = await ownedDbTable('resilience_advisory_plans')
    .update(patch)
    .eq('organization_id', args.organizationId)
    .eq('id', args.planId)
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`resilience_advisory_transition_failed:${upd.error?.message ?? 'unknown'}`);
  return upd.data as ResilienceAdvisoryPlan;
}

export async function listAdvisoryPlans(
  organizationId: string,
  options?: { planKind?: ResilienceAdvisoryPlanKind; status?: ResilienceAdvisoryStatus; limit?: number },
): Promise<ResilienceAdvisoryPlan[]> {
  let q = ownedDbTable('resilience_advisory_plans')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 200)));
  if (options?.planKind) q = q.eq('plan_kind', options.planKind);
  if (options?.status) q = q.eq('status', options.status);
  const { data } = await q;
  return (data as ResilienceAdvisoryPlan[]) ?? [];
}
