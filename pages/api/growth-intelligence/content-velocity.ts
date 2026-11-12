/**
 * GET /api/growth-intelligence/content-velocity
 * Phase-1 Read-Only. Returns content velocity metrics.
 * Auth: RBAC COMPANY_ADMIN, VIEW_ONLY, CONTENT_*
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { tenantContextFor } from '../../../backend/db/tenantTable';
import {
  getContentVelocityMetrics,
  resolveCampaignIdsForCompany,
} from '../../../backend/services/growthIntelligence';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'companyId is required' });
  }

  const campaignId = (req.query.campaignId as string)?.trim?.() || undefined;

  try {
    const access = await enforceCompanyAccess({ req, res, companyId, campaignId: campaignId ?? null });
    if (!access) return;
    // S2 tenant seam: the campaign list is the tenant's own, under the context of THIS access check.
    const tenant = tenantContextFor(access, companyId);

    const campaignIds = campaignId ? [campaignId] : await resolveCampaignIdsForCompany(tenant);
    const data = await getContentVelocityMetrics(supabase, campaignIds);
    return res.status(200).json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch content velocity';
    return res.status(500).json({ success: false, error: message });
  }
}

export default withRBAC(handler, [
  Role.COMPANY_ADMIN,
  Role.VIEW_ONLY,
  Role.CONTENT_CREATOR,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.SUPER_ADMIN,
]);
