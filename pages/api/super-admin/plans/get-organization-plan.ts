import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { resolveOrganizationPlanLimits } from '../../../../backend/services/planResolutionService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireAdminScope(req, res, 'plans:list');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/plans/get-organization-plan', 'plans:list');
  }

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

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
