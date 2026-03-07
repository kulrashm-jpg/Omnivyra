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
