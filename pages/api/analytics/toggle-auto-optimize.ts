/**
 * POST /api/analytics/toggle-auto-optimize
 * Stage 37 — Toggle auto-optimization for a campaign. RBAC: COMPANY_ADMIN+
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { campaignId, enabled } = req.body || {};
  if (!campaignId || typeof campaignId !== 'string') {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  const companyId = (req.body?.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    campaignId,
    requireCampaignId: true,
  });
  if (!access) return;

  const { error } = await supabase
    .from('campaigns')
    .update({
      auto_optimize_enabled: Boolean(enabled),
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId);

  if (error) {
    return res.status(500).json({
      error: 'Failed to update auto_optimize_enabled',
      details: error.message,
    });
  }

  return res.status(200).json({
    campaignId,
    auto_optimize_enabled: Boolean(enabled),
  });
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]);
