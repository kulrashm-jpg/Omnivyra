/**
 * Phase 11 — Tenant onboarding runtime.
 *
 * Stage-by-stage onboarding progression with deterministic readiness
 * scoring. Each stage row is 1:1 with (org, stage_kind) — the runtime
 * is a flat checklist, not a tree. Progression requires explicit
 * operator acknowledgement.
 *
 * Hard guarantees:
 *   • Readiness score is in [0, 1] (CHECK constraint).
 *   • No auto-progression. Every transition requires an actor.
 *   • Stage evidence persisted verbatim for replay/audit.
 *   • Tenant-first reads.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  type TenantOnboardingRuntimeStage,
  type TenantOnboardingRuntimeStageKind,
  type TenantOnboardingRuntimeStatus,
} from '../types/tenantOnboardingRuntime';
import { publishRealtime } from './realtimePublisherService';
import { publishOnboardingStageCompleted } from '../events/listeningEvents';

export async function getOrInitStage(
  organizationId: string,
  stageKind: TenantOnboardingRuntimeStageKind,
): Promise<TenantOnboardingRuntimeStage> {
  const { data } = await ownedDbTable('tenant_onboarding_runtime_stages')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('stage_kind', stageKind)
    .maybeSingle();
  if (data) return data as TenantOnboardingRuntimeStage;
  const ins = await ownedDbTable('tenant_onboarding_runtime_stages')
    .insert({
      organization_id: organizationId,
      stage_kind: stageKind,
      status: 'pending' as TenantOnboardingRuntimeStatus,
      readiness_score: 0,
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) {
    if ((ins.error as { code?: string }).code === '23505') {
      const reread = await ownedDbTable('tenant_onboarding_runtime_stages')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('stage_kind', stageKind)
        .single();
      return reread.data as TenantOnboardingRuntimeStage;
    }
    throw new Error(`tenant_onboarding_init_failed:${ins.error?.message ?? 'unknown'}`);
  }
  return ins.data as TenantOnboardingRuntimeStage;
}

export type UpdateStageInput = {
  organizationId: string;
  stageKind: TenantOnboardingRuntimeStageKind;
  status?: TenantOnboardingRuntimeStatus;
  readinessScore?: number;
  evidence?: Record<string, unknown>;
  progressionExplanation?: string | null;
  acknowledgedBy?: string | null;
  metadata?: Record<string, unknown>;
};

export async function updateStage(input: UpdateStageInput): Promise<TenantOnboardingRuntimeStage> {
  const current = await getOrInitStage(input.organizationId, input.stageKind);
  const patch: Record<string, unknown> = {};
  if (input.status) patch.status = input.status;
  if (typeof input.readinessScore === 'number') patch.readiness_score = Math.max(0, Math.min(1, input.readinessScore));
  if (input.evidence) patch.evidence = input.evidence;
  if (typeof input.progressionExplanation !== 'undefined') patch.progression_explanation = input.progressionExplanation;
  if (typeof input.acknowledgedBy !== 'undefined' && input.status === 'complete') {
    patch.acknowledged_by = input.acknowledgedBy;
    patch.acknowledged_at = new Date().toISOString();
  }
  if (input.metadata) patch.metadata = input.metadata;

  const upd = await ownedDbTable('tenant_onboarding_runtime_stages')
    .update(patch)
    .eq('id', current.id)
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`tenant_onboarding_update_failed:${upd.error?.message ?? 'unknown'}`);
  const row = upd.data as TenantOnboardingRuntimeStage;

  if (input.status === 'complete' && current.status !== 'complete') {
    try {
      await publishOnboardingStageCompleted({
        organizationId: input.organizationId,
        stageKind: row.stage_kind,
        status: row.status,
        readinessScore: row.readiness_score,
        acknowledgedBy: row.acknowledged_by,
      });
      void publishRealtime({
        organizationId: input.organizationId,
        topic: 'tenant_onboarding_runtime',
        eventName: 'onboarding.stage_completed',
        payload: { stage_kind: row.stage_kind, readiness_score: row.readiness_score },
      });
    } catch { /* best effort */ }
  }

  return row;
}

export async function listStages(organizationId: string): Promise<TenantOnboardingRuntimeStage[]> {
  const { data } = await ownedDbTable('tenant_onboarding_runtime_stages')
    .select('*')
    .eq('organization_id', organizationId)
    .order('stage_kind', { ascending: true });
  return (data as TenantOnboardingRuntimeStage[]) ?? [];
}

/**
 * Compute aggregate readiness as average of stage readiness scores.
 * Deterministic. Caller decides what threshold to act on.
 */
export async function computeAggregateReadiness(organizationId: string): Promise<{ score: number; stages_complete: number; stages_total: number }> {
  const stages = await listStages(organizationId);
  if (stages.length === 0) return { score: 0, stages_complete: 0, stages_total: 0 };
  const score = stages.reduce((acc, s) => acc + (s.readiness_score ?? 0), 0) / stages.length;
  const complete = stages.filter((s) => s.status === 'complete').length;
  return { score: Number(score.toFixed(4)), stages_complete: complete, stages_total: stages.length };
}
