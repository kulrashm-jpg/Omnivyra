import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { resolveOrganizationPlanLimits } from '../../../../backend/services/planResolutionService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';

// 2026-11-11: platform VIEW capability; requireCapability answers 401/403 itself.
// The legacy super-admin cookie arm is gone.
async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: '/api/super-admin/plans/get-organization-plan read',
  });
  return guard.ok === true;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireSuperAdmin(req, res))) return;

  const organizationId = req.query.organization_id as string | undefined;
  if (!organizationId) {
    return res.status(400).json({ error: 'organization_id is required' });
  }

  try {
    const resolved = await resolveOrganizationPlanLimits(organizationId);
    return res.status(200).json({
      plan_key: resolved.plan_key,
      limits: resolved.limits,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/plans/get-organization-plan' });
