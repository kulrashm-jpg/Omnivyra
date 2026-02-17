/**
 * GET /api/governance/campaign-analytics
 * Stage 22 — Campaign-level governance analytics. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getCampaignGovernanceAnalytics } from '../../../backend/services/GovernanceAnalyticsService';
import { getCampaignRoiIntelligence } from '../../../backend/services/CampaignRoiIntelligenceService';
import { generateCampaignOptimizationInsights } from '../../../backend/services/CampaignOptimizationIntelligenceService';
import { generateOptimizationProposal } from '../../../backend/services/CampaignOptimizationProposalService';
import { evaluateAutoOptimizationEligibility } from '../../../backend/services/CampaignAutoOptimizationGuard';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = (req.query.campaignId as string)?.trim?.();
  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  const analytics = await getCampaignGovernanceAnalytics(campaignId);
  if (!analytics) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const [roiIntelligence, optimizationInsights, optimizationProposal, autoOptimizationEligibility, campaignRow] =
    await Promise.all([
      getCampaignRoiIntelligence(campaignId, analytics),
      generateCampaignOptimizationInsights(campaignId),
      generateOptimizationProposal(campaignId),
      evaluateAutoOptimizationEligibility(campaignId),
      supabase
        .from('campaigns')
        .select('auto_optimize_enabled')
        .eq('id', campaignId)
        .maybeSingle()
        .then((r) => (r.error ? null : r.data)),
    ]);

  const autoOptimizeEnabled = Boolean((campaignRow as { auto_optimize_enabled?: boolean } | null)?.auto_optimize_enabled);

  return res.status(200).json({
    ...analytics,
    roiIntelligence,
    optimizationInsights,
    optimizationProposal,
    autoOptimizationEligibility,
    autoOptimizeEnabled,
  });
}
