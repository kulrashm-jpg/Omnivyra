/**
 * GET /api/growth-intelligence/community
 * Phase-1 Read-Only. Returns community engagement metrics.
 * Auth: RBAC COMPANY_ADMIN, VIEW_ONLY, CONTENT_*
 * Query: companyId (required for RBAC), organizationId (optional, defaults to companyId).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { getCommunityEngagementMetrics } from '../../../backend/services/growthIntelligence';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'companyId is required' });
  }

  const organizationId =
    (req.query.organizationId as string)?.trim?.() || companyId;

  try {
    const companyContext = await requireCompanyContext({ req, res, companyId });
    if (!companyContext) return;

    // B4.3 — `organizationId` is an independently supplied query parameter, so
    // authorizing `companyId` and then reading with `organizationId` let
    // ?companyId=A&organizationId=B return company B's community_ai_actions
    // metrics to a company A caller. Verify the value actually read from.
    // Skipped when it equals the already-authorized companyId (the default), so
    // the common single-value call costs no extra check.
    if (organizationId !== companyId) {
      const tenantAccess = await requireTenantAccess(req, res, organizationId);
      if (!tenantAccess) return; // guard already responded (403 NOT_A_MEMBER)
    }

    const data = await getCommunityEngagementMetrics(supabase, organizationId);
    return res.status(200).json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch community engagement';
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
