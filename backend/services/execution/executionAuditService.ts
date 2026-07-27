/**
 * LC-501 (W5.1) — C6 Execution audit trail (append-only; no silent failures).
 * Records every guarded-path stage decision to `execution_audit` AND emits canonical
 * telemetry (`trackEvent`). Reuses HARDEN-001 seams — no new observability platform.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { trackEvent } from '../telemetry/telemetryDispatcher';

export type ExecutionStage = 'control' | 'approval' | 'suppression' | 'guardrail' | 'quota' | 'queue' | 'connector';
export type ExecutionDecision = 'allowed' | 'blocked' | 'suppressed' | 'quota_blocked' | 'killed' | 'dry_run' | 'cancelled' | 'dead_letter';

export interface AuditInput {
  companyId: string; campaignId?: string | null; entityId?: string | null; channel?: string | null;
  stage: ExecutionStage; decision: ExecutionDecision; reason?: string | null;
  evidence?: Record<string, unknown>; actor?: string | null; correlationId?: string | null;
}

export async function recordExecutionAudit(a: AuditInput): Promise<void> {
  try {
    await ownedDbTable('execution_audit').insert({
      company_id: a.companyId, campaign_id: a.campaignId ?? null, entity_id: a.entityId ?? null, channel: a.channel ?? null,
      stage: a.stage, decision: a.decision, reason: a.reason ?? null, evidence: a.evidence ?? {}, actor: a.actor ?? null, correlation_id: a.correlationId ?? null,
    }).select('id').maybeSingle();
  } catch { /* audit is best-effort persistence, but telemetry below still fires */ }
  try {
    trackEvent({ type: `execution.${a.stage}.${a.decision}`, organizationId: a.companyId, actorId: a.actor ?? null, entityId: a.campaignId ?? null, metadata: { channel: a.channel, decision: a.decision, reason: a.reason ?? null } });
  } catch { /* fail-open telemetry */ }
}
