import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { dispatchGuarded, previewDispatch } from '../../../backend/services/execution/executionBridge';
import { addSuppression, releaseSuppression, isSuppressed } from '../../../backend/services/execution/suppressionService';
import { setControl, killSwitch, isExecutionEnabled } from '../../../backend/services/execution/executionControlService';
import { recordApproval, revokeApproval } from '../../../backend/services/execution/executionApprovalService';
import { recordExecutionAudit } from '../../../backend/services/execution/executionAuditService';
import { trackEvent } from '../../../backend/services/telemetry/telemetryDispatcher';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import { hasExecutionCapability, resolveExecutionCapabilities, type ExecutionCapability } from '../../../lib/execution/executionCapabilities';

/**
 * /api/lead-intelligence/execution — guarded execution control plane (W5.1 + ES-001).
 * Execution is DEFAULT OFF and DRY-RUN only — this endpoint never sends a live message.
 * Mutating actions are DEFAULT-DENY: capabilities are derived server-side (centralized,
 * ES-104) from the platform user context — never taken from the client. Approval is
 * server-owned (ES-101): the client cannot assert it. Denials emit telemetry (ES-104).
 */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function requireCap(user: any, cap: ExecutionCapability): boolean {
  return hasExecutionCapability(resolveExecutionCapabilities(user), cap);
}

/** ES-104 — surface every authorization denial as alertable telemetry (no silent 403s). */
function denyCap(companyId: string, actor: string, cap: ExecutionCapability, action: string): void {
  try { trackEvent({ type: 'execution.authorization.denied', organizationId: companyId, actorId: actor, metadata: { capability: cap, action } }); } catch { /* fail-open telemetry */ }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String((req.method === 'GET' ? req.query.company_id : req.body?.company_id) || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const actor = user.userId;

  try {
    if (req.method === 'GET') {
      const campaignId = str(req.query.campaign_id);
      const q = ownedDbTable('execution_audit').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500);
      const { data } = await (campaignId ? q.eq('campaign_id', campaignId) : q);
      return res.status(200).json({ audit: Array.isArray(data) ? data : [], executionEnabled: await isExecutionEnabled(companyId, campaignId ?? null, 'email') });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      switch (str(b.action)) {
        case 'preview': return res.status(200).json(previewDispatch({ subject: String(b.subject ?? ''), body: String(b.body ?? '') }, String(b.recipient ?? '')));

        case 'dispatch_dry_run': {
          if (!requireCap(user, 'campaign.execute')) { denyCap(companyId, actor, 'campaign.execute', 'dispatch_dry_run'); return res.status(403).json({ error: 'missing_capability:campaign.execute' }); }
          // ES-101: approval is NOT accepted from the client — the bridge reads authoritative server state.
          const result = await dispatchGuarded({ companyId, campaignId: String(b.campaign_id), entityId: String(b.entity_id), channel: 'email', recipient: String(b.recipient), message: { subject: String(b.subject ?? ''), body: String(b.body ?? ''), messageId: str(b.message_id) }, actor, correlationId: str(b.correlation_id) });
          return res.status(200).json(result); // always dispatched:false in W5.1
        }

        // ES-101 — approve / revoke are the ONLY way approval enters server state; require the approver capability.
        case 'approve': {
          if (!requireCap(user, 'campaign.approve')) { denyCap(companyId, actor, 'campaign.approve', 'approve'); return res.status(403).json({ error: 'missing_capability:campaign.approve' }); }
          const version = str(b.message_id) ?? 'default';
          const { id } = await recordApproval({ companyId, campaignId: String(b.campaign_id), version, approverId: actor, reason: str(b.reason), correlationId: str(b.correlation_id) });
          await recordExecutionAudit({ companyId, campaignId: String(b.campaign_id), stage: 'approval', decision: 'allowed', reason: 'approval_recorded', actor, evidence: { version, approvalId: id }, correlationId: str(b.correlation_id) });
          return res.status(201).json({ ok: true, approvalId: id });
        }
        case 'revoke_approval': {
          if (!requireCap(user, 'campaign.approve')) { denyCap(companyId, actor, 'campaign.approve', 'revoke_approval'); return res.status(403).json({ error: 'missing_capability:campaign.approve' }); }
          const version = str(b.message_id) ?? 'default';
          await revokeApproval({ companyId, campaignId: String(b.campaign_id), version, actorId: actor, reason: str(b.reason) });
          await recordExecutionAudit({ companyId, campaignId: String(b.campaign_id), stage: 'approval', decision: 'cancelled', reason: 'approval_revoked', actor, evidence: { version }, correlationId: str(b.correlation_id) });
          return res.status(200).json({ ok: true });
        }

        case 'suppress': { await addSuppression({ companyId, channel: str(b.channel) ?? '*', target: String(b.target), reason: b.reason ?? 'manual', actor }); return res.status(201).json({ ok: true }); }
        // ES-103 — un-suppress (release) is consent-sensitive: capability-gated, tenant-scoped, audited. Fail-closed.
        case 'release': {
          if (!requireCap(user, 'campaign.override')) { denyCap(companyId, actor, 'campaign.override', 'release'); return res.status(403).json({ error: 'missing_capability:campaign.override' }); }
          await releaseSuppression(companyId, str(b.channel) ?? '*', String(b.target));
          await recordExecutionAudit({ companyId, channel: str(b.channel) ?? '*', stage: 'suppression', decision: 'cancelled', reason: 'suppression_released', actor, evidence: { target: String(b.target) }, correlationId: str(b.correlation_id) });
          return res.status(200).json({ ok: true });
        }
        case 'check_suppression': return res.status(200).json(await isSuppressed(companyId, str(b.channel) ?? 'email', String(b.target)));

        case 'set_control': {
          if (!requireCap(user, 'campaign.override')) { denyCap(companyId, actor, 'campaign.override', 'set_control'); return res.status(403).json({ error: 'missing_capability:campaign.override' }); }
          await setControl({ companyId, scope: b.scope, scopeId: str(b.scope_id) ?? null, enabled: b.enabled === true, emergencyStop: b.emergency_stop === true, reason: str(b.reason), actor });
          await recordExecutionAudit({ companyId, campaignId: str(b.scope_id) ?? null, stage: 'control', decision: b.enabled === true ? 'allowed' : 'blocked', reason: `set_control:${b.scope}`, actor, evidence: { scope: b.scope, enabled: b.enabled === true, emergency_stop: b.emergency_stop === true }, correlationId: str(b.correlation_id) });
          return res.status(200).json({ ok: true });
        }
        case 'kill_switch': {
          if (!requireCap(user, 'campaign.override')) { denyCap(companyId, actor, 'campaign.override', 'kill_switch'); return res.status(403).json({ error: 'missing_capability:campaign.override' }); }
          await killSwitch(companyId, b.scope ?? 'tenant', str(b.scope_id) ?? null, actor, str(b.reason) ?? 'manual_kill');
          await recordExecutionAudit({ companyId, campaignId: str(b.scope_id) ?? null, stage: 'control', decision: 'killed', reason: `kill_switch:${b.scope ?? 'tenant'}`, actor, evidence: { scope: b.scope ?? 'tenant' }, correlationId: str(b.correlation_id) });
          return res.status(200).json({ ok: true });
        }
        default: return res.status(400).json({ error: 'unknown_action' });
      }
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'execution_operation_failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/lead-intelligence/execution' });
