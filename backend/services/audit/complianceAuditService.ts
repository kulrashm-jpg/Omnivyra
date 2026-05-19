/**
 * Compliance-grade audit wrapper.
 *
 * Thin layer over the EXISTING append-only `audit_events` store
 * (auditEventService.recordAuditEvent) that adds the compliance primitives
 * that were missing: correlation IDs, actor lineage, and entity lineage —
 * all carried in the existing `metadata` jsonb (no schema change, no new
 * table, no migration dependency).
 *
 * Append-only + tamper-resistance: enforced at the DB layer by the existing
 * ledger/immutability trigger convention (see
 * supabase/migrations/20260663_ledger_immutability_and_governance.sql and the
 * NOT-APPLIED design artifact 20260690_*). This service never updates/deletes.
 */
import { recordAuditEvent, type AuditActorType } from '../auditEventService';

export interface ComplianceActor {
  userId?: string | null;
  type: AuditActorType;
  /** Human/ system label for lineage (e.g. 'ops-tooling', 'self-heal-worker'). */
  label: string;
}

export interface ComplianceAuditInput {
  companyId: string;
  actor: ComplianceActor;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  /** Groups all events of one logical operation across services. */
  correlationId?: string;
  /** Ordered ancestry of entities this action touched. */
  entityLineage?: string[];
  severity?: 'info' | 'warning' | 'critical';
  outcome?: 'success' | 'failure';
  detail?: Record<string, unknown>;
  ipHash?: string | null;
  userAgent?: string | null;
}

export function newCorrelationId(prefix = 'cmp'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Record a compliance audit event. Soft-fails (recordAuditEvent already
 * swallows write errors) so auditing never blocks the audited operation —
 * but failures are visible in logs.
 */
export async function recordComplianceAudit(
  input: ComplianceAuditInput,
): Promise<{ correlationId: string }> {
  const correlationId = input.correlationId ?? newCorrelationId();
  await recordAuditEvent({
    companyId: input.companyId,
    actorUserId: input.actor.userId ?? null,
    actorType: input.actor.type,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    severity: input.severity ?? (input.outcome === 'failure' ? 'warning' : 'info'),
    metadata: {
      correlationId,
      actorLabel: input.actor.label,
      actorType: input.actor.type,
      outcome: input.outcome ?? 'success',
      entityLineage: input.entityLineage ?? [],
      ...(input.detail ?? {}),
    },
    ipHash: input.ipHash ?? null,
    userAgent: input.userAgent ?? null,
  });
  return { correlationId };
}
