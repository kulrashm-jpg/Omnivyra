import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/governance/rebuild-projection
 * Stage 32 — Rebuild governance projection for a campaign. SUPER_ADMIN only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { rebuildGovernanceProjection } from '../../../backend/services/GovernanceProjectionService';
import { requireActivePlatformSuperAdmin } from '../../../backend/security/requireActivePlatformSuperAdmin';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = (req.body?.campaignId ?? req.query.campaignId) as string;
  if (!campaignId || typeof campaignId !== 'string') {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  // Closure-015C (P1): the campaign's own company is rebuilt, whatever companyId the request named. withRBAC([SUPER_ADMIN]) also admits an INVITED
  // company-scoped SUPER_ADMIN membership; only an active platform super admin may act.
  if (!(await requireActivePlatformSuperAdmin(req, res, 'governance.rebuild_projection'))) return;
  await rebuildGovernanceProjection(campaignId.trim());
  return res.status(200).json({ ok: true, campaignId: campaignId.trim() });
}

export default __createApiRoute(withRBAC(handler, [Role.SUPER_ADMIN]), { route: '/api/governance/rebuild-projection' });
