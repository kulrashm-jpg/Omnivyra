import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';
import { resolveOrganizationPlanLimits } from '../../../../backend/services/planResolutionService';

const requireSuperAdmin = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> => {
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

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
