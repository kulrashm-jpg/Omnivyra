/**
 * LC-501 (W5.1) — C6 Execution audit trail (append-only; no silent failures).
 * Records every guarded-path stage decision to `execution_audit` AND emits canonical
 * telemetry (`trackEvent`). Reuses HARDEN-001 seams — no new observability platform.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { trackEvent } from '../telemetry/telemetryDispatcher';
import { recordDb } from '../../observability/metrics';

export type ExecutionStage = 'control' | 'approval' | 'suppression' | 'guardrail' | 'quota' | 'queue' | 'connector';
export type ExecutionDecision = 'allowed' | 'blocked' | 'suppressed' | 'quota_blocked' | 'killed' | 'dry_run' | 'cancelled' | 'dead_letter';

export interface AuditInput {
  companyId: string; campaignId?: string | null; entityId?: string | null; channel?: string | null;
  stage: ExecutionStage; decision: ExecutionDecision; reason?: string | null;
  evidence?: Record<string, unknown>; actor?: string | null; correlationId?: string | null;
}

/** ES-105 — persist one audit row, with a single retry; a persist FAILURE is never silent. */
async function persistAudit(a: AuditInput): Promise<{ ok: boolean; error?: string }> {
  const row = {
    company_id: a.companyId, campaign_id: a.campaignId ?? null, entity_id: a.entityId ?? null, channel: a.channel ?? null,
    stage: a.stage, decision: a.decision, reason: a.reason ?? null, evidence: a.evidence ?? {}, actor: a.actor ?? null, correlation_id: a.correlationId ?? null,
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { error } = await ownedDbTable('execution_audit').insert(row).select('id').maybeSingle();
      if (!error) return { ok: true };
      if (attempt === 2) return { ok: false, error: (error as any)?.message ?? 'insert_error' };
    } catch (e) {
      if (attempt === 2) return { ok: false, error: e instanceof Error ? e.message : 'insert_exception' };
    }
  }
  return { ok: false, error: 'unreachable' };
}

export async function recordExecutionAudit(a: AuditInput): Promise<void> {
  const result = await persistAudit(a);
  if (!result.ok) {
    // ES-105 — audit loss is OBSERVABLE: DB error metric (HARDEN-001) + an alertable telemetry event,
    // correlation id preserved. Never silently swallowed.
    try { recordDb({ table: 'execution_audit', op: 'insert', durationMs: 0, error: true }); } catch { /* metric best-effort */ }
    try {
      trackEvent({ type: 'execution.audit.write_failed', organizationId: a.companyId, actorId: a.actor ?? null, entityId: a.campaignId ?? null,
        metadata: { stage: a.stage, decision: a.decision, reason: a.reason ?? null, correlation_id: a.correlationId ?? null, error: result.error ?? null } });
    } catch { /* fail-open telemetry */ }
  }
  try {
    trackEvent({ type: `execution.${a.stage}.${a.decision}`, organizationId: a.companyId, actorId: a.actor ?? null, entityId: a.campaignId ?? null, metadata: { channel: a.channel, decision: a.decision, reason: a.reason ?? null, correlation_id: a.correlationId ?? null } });
  } catch { /* fail-open telemetry */ }
}
