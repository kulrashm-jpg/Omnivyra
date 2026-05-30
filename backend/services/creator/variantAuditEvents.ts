/**
 * Variant Audit Events (Phase 7 — production hardening).
 *
 * Thin wrapper over the existing `recordAuditEvent` infrastructure.
 * Records the six variant-platform actions identified by the
 * production hardening prompt:
 *
 *   - experiment_created
 *   - experiment_completed
 *   - winner_selected
 *   - winner_overridden
 *   - operator_force_v1
 *   - operator_force_winner
 *
 * All events go to the existing `audit_events` table; no new schema,
 * no new storage. Soft-fails — audit write failures never block
 * the action that triggered them.
 *
 * Action names follow the existing dot-notation convention
 * (e.g. `experiment.created`, `winner.selected`) so they group with
 * other audit records in the dashboard.
 */

import { recordAuditEvent } from '../auditEventService';

const RESOURCE_TYPE_EXPERIMENT = 'variant_experiment';
const RESOURCE_TYPE_OPERATOR_CONTROL = 'variant_operator_control';

/**
 * Fire-and-forget audit write. Wraps every call in try/catch so a
 * caller path can never fail because the audit write failed.
 */
function safeAudit(input: Parameters<typeof recordAuditEvent>[0]): void {
  void (async () => {
    try {
      await recordAuditEvent(input);
    } catch {
      // recordAuditEvent already swallows DB failures with a
      // console.warn; this catch covers anything stranger.
    }
  })();
}

export function auditExperimentCreated(input: {
  companyId: string;
  experimentId: string;
  strategyId: string;
  mode: string;
  variantCount: number;
  actorUserId?: string | null;
}): void {
  safeAudit({
    companyId: input.companyId,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorUserId ? 'user' : 'system',
    action: 'experiment.created',
    resourceType: RESOURCE_TYPE_EXPERIMENT,
    resourceId: input.experimentId,
    severity: 'info',
    metadata: {
      strategy_id: input.strategyId,
      mode: input.mode,
      variant_count: input.variantCount,
    },
  });
}

export function auditExperimentCompleted(input: {
  companyId: string;
  experimentId: string;
  strategyId: string;
  actorUserId?: string | null;
}): void {
  safeAudit({
    companyId: input.companyId,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorUserId ? 'user' : 'system',
    action: 'experiment.completed',
    resourceType: RESOURCE_TYPE_EXPERIMENT,
    resourceId: input.experimentId,
    severity: 'info',
    metadata: { strategy_id: input.strategyId },
  });
}

export function auditWinnerSelected(input: {
  companyId: string;
  strategyId: string;
  variantId: string;
  delta: number | null;
  confidence: string;
  sampleSize: number;
  actorUserId?: string | null;
}): void {
  safeAudit({
    companyId: input.companyId,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorUserId ? 'user' : 'system',
    action: 'winner.selected',
    resourceType: RESOURCE_TYPE_EXPERIMENT,
    resourceId: input.strategyId,
    severity: 'info',
    metadata: {
      variant_id: input.variantId,
      delta: input.delta,
      confidence: input.confidence,
      sample_size: input.sampleSize,
    },
  });
}

export function auditWinnerOverridden(input: {
  companyId: string;
  strategyId: string;
  fromVariantId: string | null;
  toVariantId: string | null;
  actorUserId?: string | null;
  reason?: string | null;
}): void {
  safeAudit({
    companyId: input.companyId,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorUserId ? 'user' : 'system',
    action: 'winner.overridden',
    resourceType: RESOURCE_TYPE_EXPERIMENT,
    resourceId: input.strategyId,
    severity: 'warning',
    metadata: {
      from_variant_id: input.fromVariantId,
      to_variant_id: input.toVariantId,
      reason: input.reason ?? null,
    },
  });
}

export function auditOperatorForceV1(input: {
  companyId: string;
  enabled: boolean;
  actorUserId?: string | null;
}): void {
  safeAudit({
    companyId: input.companyId,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorUserId ? 'user' : 'system',
    action: 'operator_control.force_v1',
    resourceType: RESOURCE_TYPE_OPERATOR_CONTROL,
    resourceId: input.companyId,
    severity: 'info',
    metadata: { enabled: input.enabled },
  });
}

export function auditOperatorForceWinner(input: {
  companyId: string;
  enabled: boolean;
  actorUserId?: string | null;
}): void {
  safeAudit({
    companyId: input.companyId,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorUserId ? 'user' : 'system',
    action: 'operator_control.force_winner',
    resourceType: RESOURCE_TYPE_OPERATOR_CONTROL,
    resourceId: input.companyId,
    severity: 'info',
    metadata: { enabled: input.enabled },
  });
}
