import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/analytics/campaign-roi
 * Stage 34 — Campaign ROI Intelligence. Read-only. RBAC: COMPANY_ADMIN+
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  composeCampaignOptimizationView,
  composeDecisionIntelligence,
} from '../../../backend/services/decisionComposerService';
import { runInApiReadContext } from '../../../backend/services/intelligenceExecutionContext';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';

type CampaignRoiIntelligence = {
  campaignId: string;
  roiScore: number;
  performanceScore: number;
  governanceStabilityScore: number;
  executionReliabilityScore: number;
  optimizationSignal: 'STABLE' | 'AT_RISK' | 'HIGH_POTENTIAL';
  recommendation?: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = (req.query.campaignId as string)?.trim?.();
  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  const { data: campaignRow, error: campaignError } = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();

  if (campaignError || !campaignRow?.company_id) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  // B4.3 — bind authorization to the company actually READ FROM.
  //
  // withRBAC resolves its subject from req.query.companyId / req.body.companyId,
  // but this route selects its subject with req.query.campaignId and then reads
  // the intelligence of whatever company owns that campaign. A caller could pass
  // ?companyId=<own company>&campaignId=<another company's campaign> to satisfy
  // RBAC and receive that company’s decision intelligence.
  const tenantAccess = await requireTenantAccess(req, res, String(campaignRow.company_id));
  if (!tenantAccess) return; // guard already responded (403 NOT_A_MEMBER)

  const composition = await runInApiReadContext('campaignRoiApi', async () =>
    composeDecisionIntelligence({
      companyId: campaignRow.company_id,
      reportTier: 'deep',
      entityType: 'campaign',
      entityId: campaignId,
      status: ['open'],
    })
  );

  const optimization = composeCampaignOptimizationView(campaignId, composition);
  const intelligence: CampaignRoiIntelligence = {
    campaignId,
    roiScore: optimization.roi.roiScore,
    performanceScore: optimization.roi.performanceScore,
    governanceStabilityScore: optimization.roi.governanceStabilityScore,
    executionReliabilityScore: optimization.roi.executionReliabilityScore,
    optimizationSignal: optimization.roi.optimizationSignal,
    recommendation: optimization.roi.recommendation,
  };
  return res.status(200).json(intelligence);
}

export default __createApiRoute(withRBAC(handler, [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]), { route: '/api/analytics/campaign-roi' });
