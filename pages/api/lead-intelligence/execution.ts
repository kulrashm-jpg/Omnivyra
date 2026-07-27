import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { dispatchGuarded, previewDispatch } from '../../../backend/services/execution/executionBridge';
import { addSuppression, releaseSuppression, isSuppressed } from '../../../backend/services/execution/suppressionService';
import { setControl, killSwitch, isExecutionEnabled } from '../../../backend/services/execution/executionControlService';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import { hasExecutionCapability, type ExecutionCapability } from '../../../lib/execution/executionCapabilities';

/**
 * /api/lead-intelligence/execution — guarded execution control plane (W5.1).
 * Execution is DEFAULT OFF and DRY-RUN only — this endpoint never sends a live message.
 * Mutating execution actions are DEFAULT-DENY: they require the explicit execution
 * capability (bound to platform RBAC grants); without it they 403 (safe posture).
 */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function requireCap(user: any, cap: ExecutionCapability): boolean {
  return hasExecutionCapability(user?.capabilities as string[] | undefined, cap);
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
          if (!requireCap(user, 'campaign.execute')) return res.status(403).json({ error: 'missing_capability:campaign.execute' });
          const result = await dispatchGuarded({ companyId, campaignId: String(b.campaign_id), entityId: String(b.entity_id), channel: 'email', recipient: String(b.recipient), message: { subject: String(b.subject ?? ''), body: String(b.body ?? ''), messageId: str(b.message_id) }, actor, approved: b.approved === true, correlationId: str(b.correlation_id) });
          return res.status(200).json(result); // always dispatched:false in W5.1
        }

        case 'suppress': { await addSuppression({ companyId, channel: str(b.channel) ?? '*', target: String(b.target), reason: b.reason ?? 'manual', actor }); return res.status(201).json({ ok: true }); }
        case 'release': { await releaseSuppression(companyId, str(b.channel) ?? '*', String(b.target)); return res.status(200).json({ ok: true }); }
        case 'check_suppression': return res.status(200).json(await isSuppressed(companyId, str(b.channel) ?? 'email', String(b.target)));

        case 'set_control': {
          if (!requireCap(user, 'campaign.override')) return res.status(403).json({ error: 'missing_capability:campaign.override' });
          await setControl({ companyId, scope: b.scope, scopeId: str(b.scope_id) ?? null, enabled: b.enabled === true, emergencyStop: b.emergency_stop === true, reason: str(b.reason), actor });
          return res.status(200).json({ ok: true });
        }
        case 'kill_switch': {
          if (!requireCap(user, 'campaign.override')) return res.status(403).json({ error: 'missing_capability:campaign.override' });
          await killSwitch(companyId, b.scope ?? 'tenant', str(b.scope_id) ?? null, actor, str(b.reason) ?? 'manual_kill');
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
