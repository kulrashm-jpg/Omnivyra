import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantScope, enforceActionRole } from './utils';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { getAiActivityQueue } from '../../../backend/services/aiActivityQueueService';

/**
 * GET /api/community-ai/activity-queue
 * Read-only. Returns pending actions with runtime priority, sorted by priority_score DESC, created_at DESC.
 * Query: tenant_id, organization_id (required for scope).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.VIEW_ACTIONS],
  });
  if (!roleGate) return;

  try {
    const queueResult = await getAiActivityQueue({
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      status: 'pending',
    });
    return res.status(200).json({
      success: true,
      queue: queueResult.queue,
    });
  } catch (error: any) {
    console.error('[activity-queue]', error?.message);
    return res.status(500).json({ error: 'Failed to load activity queue' });
  }
}
