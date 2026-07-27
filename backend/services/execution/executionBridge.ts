/**
 * LC-501 (W5.1) — C2 Campaign Execution Bridge (the ONE guarded dispatch path).
 *
 * Every outbound action passes the same ordered gate; failure at ANY stage prevents
 * dispatch and is audited. It reuses the certified services (control, suppression,
 * quota, audit) and the dry-run email connector — it introduces NO new dispatcher,
 * queue, or approval engine. It NEVER performs a live send in W5.1.
 *
 *   control(kill-switch/default-off) → approval → suppression → guardrail → quota
 *      → queue(reuse BullMQ in M5) → connector(DRY-RUN)
 */

import { isExecutionEnabled } from './executionControlService';
import { isSuppressed } from './suppressionService';
import { checkQuota } from './executionQuotaService';
import { recordExecutionAudit, type ExecutionStage, type ExecutionDecision } from './executionAuditService';
import { dispatchEmail, validateEmailTarget, previewEmail, type EmailMessage } from './emailExecutionConnector';

export interface DispatchRequest {
  companyId: string; campaignId: string; entityId: string; channel: 'email';
  recipient: string; message: EmailMessage; actor: string | null; approved: boolean;
  correlationId?: string | null;
}
export interface StageDecision { stage: ExecutionStage; decision: ExecutionDecision; reason?: string }
export interface DispatchResult {
  dispatched: false; outcome: 'dry_run' | 'blocked' | 'suppressed' | 'quota_blocked' | 'killed';
  blockedAt?: ExecutionStage; reason?: string; idempotencyKey?: string; audit: StageDecision[];
}

/** Only 'email' is eligible in W5.1. Any other channel is hard-refused. */
function channelEligible(channel: string): boolean { return channel === 'email'; }

function guardrail(req: DispatchRequest): { ok: boolean; reason?: string } {
  if (!channelEligible(req.channel)) return { ok: false, reason: 'connector_not_certified' };
  const t = validateEmailTarget(req.recipient);
  if (!t.ok) return t;
  if (!req.message?.subject?.trim() || !req.message?.body?.trim()) return { ok: false, reason: 'empty_message' };
  return { ok: true };
}

/** Run the guarded path. Returns the terminal outcome; NEVER sends in W5.1. */
export async function dispatchGuarded(req: DispatchRequest): Promise<DispatchResult> {
  const audit: StageDecision[] = [];
  const rec = async (stage: ExecutionStage, decision: ExecutionDecision, reason?: string, evidence?: Record<string, unknown>) => {
    audit.push({ stage, decision, reason });
    await recordExecutionAudit({ companyId: req.companyId, campaignId: req.campaignId, entityId: req.entityId, channel: req.channel, stage, decision, reason, evidence, actor: req.actor, correlationId: req.correlationId ?? null });
  };
  const blocked = (blockedAt: ExecutionStage, reason: string, outcome: DispatchResult['outcome']): DispatchResult => ({ dispatched: false, outcome, blockedAt, reason, audit });

  // 1 — control / kill-switch (default OFF)
  const control = await isExecutionEnabled(req.companyId, req.campaignId, req.channel);
  if (!control.enabled) {
    const killed = control.reason.includes('emergency_stop');
    await rec('control', killed ? 'killed' : 'blocked', control.reason);
    return blocked('control', control.reason, killed ? 'killed' : 'blocked');
  }
  await rec('control', 'allowed');

  // 2 — approval (no bypass)
  if (!req.approved) { await rec('approval', 'blocked', 'not_approved'); return blocked('approval', 'not_approved', 'blocked'); }
  await rec('approval', 'allowed');

  // 3 — suppression (the ONE platform; fail-closed)
  const supp = await isSuppressed(req.companyId, req.channel, req.recipient);
  if (supp.suppressed) { await rec('suppression', 'suppressed', supp.reason ?? 'suppressed', { scope: supp.scope }); return blocked('suppression', supp.reason ?? 'suppressed', 'suppressed'); }
  await rec('suppression', 'allowed');

  // 4 — guardrail
  const g = guardrail(req);
  if (!g.ok) { await rec('guardrail', 'blocked', g.reason); return blocked('guardrail', g.reason ?? 'guardrail', 'blocked'); }
  await rec('guardrail', 'allowed');

  // 5 — quota (distributed)
  const q = await checkQuota(req.companyId, req.campaignId, req.channel);
  if (!q.allowed) { await rec('quota', 'quota_blocked', q.reason, q.evidence); return blocked('quota', q.reason ?? 'quota', 'quota_blocked'); }
  await rec('quota', 'allowed', undefined, q.evidence);

  // 6 — queue (reuse BullMQ for async in M5; W5.1 records the stage + runs the connector inline)
  await rec('queue', 'allowed', 'inline_dry_run_w5_1');

  // 7 — connector (DRY-RUN — no live send)
  const result = await dispatchEmail({ campaignId: req.campaignId, entityId: req.entityId, recipient: req.recipient, message: req.message });
  await rec('connector', 'dry_run', 'no_live_send_w5_1', { idempotencyKey: result.idempotencyKey });
  return { dispatched: false, outcome: 'dry_run', idempotencyKey: result.idempotencyKey, audit };
}

/** Preview a message without touching the guarded path (rule/message authoring). */
export function previewDispatch(message: EmailMessage, recipient: string) {
  return previewEmail(message, recipient);
}
