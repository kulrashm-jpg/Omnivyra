import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { buildOutboundCrmReport, syncToCrm, type OutboundCrmProvider } from '../../../backend/services/intelligence/outboundCrmSyncService';

const VALID: OutboundCrmProvider[] = ['hubspot', 'salesforce', 'zoho', 'webhook_only'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!roleGate) return;

  if (req.method === 'GET') {
    try { return res.status(200).json(await buildOutboundCrmReport(companyId)); }
    catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' }); }
  }
  if (req.method === 'POST') {
    const provider = req.body?.provider as string | undefined;
    if (!provider || !(VALID as string[]).includes(provider)) {
      return res.status(400).json({ error: `provider must be one of: ${VALID.join(', ')}` });
    }
    const leadId = typeof req.body?.lead_id === 'string' ? req.body.lead_id : null;
    const event = typeof req.body?.event === 'string' ? req.body.event : null;
    const payload = typeof req.body?.payload === 'object' && req.body.payload !== null ? req.body.payload : null;
    if (!leadId || !event || !payload) return res.status(400).json({ error: 'lead_id, event, and payload are required' });
    if (!['create', 'update', 'stage_change', 'closed_won'].includes(event)) {
      return res.status(400).json({ error: 'event must be one of: create, update, stage_change, closed_won' });
    }
    try {
      const result = await syncToCrm({
        companyId,
        provider: provider as OutboundCrmProvider,
        leadId,
        event: event as 'create' | 'update' | 'stage_change' | 'closed_won',
        payload: payload as Record<string, unknown>,
      });
      const code = result.status === 'synced' || result.status === 'deduped' ? 200
        : result.status === 'not_configured' ? 503 : 500;
      return res.status(code).json(result);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/outbound-crm-sync' });
