import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantScope } from './utils';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  return res.status(200).json({
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    network_opportunities: [],
    influencer_candidates: [],
    event_opportunities: [],
  });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

