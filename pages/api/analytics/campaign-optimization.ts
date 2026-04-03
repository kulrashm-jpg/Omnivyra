/**
 * GET /api/analytics/campaign-optimization
 * Stage 35 — AI Strategic Optimization Intelligence. Advisory only. RBAC: COMPANY_ADMIN+
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

type OptimizationInsight = {
  campaignId: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  category: 'PERFORMANCE' | 'GOVERNANCE' | 'EXECUTION' | 'CONTENT_STRATEGY';
  headline: string;
  explanation: string;
  recommendedAction: string;
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

  const composition = await runInApiReadContext('campaignOptimizationApi', async () =>
    composeDecisionIntelligence({
      companyId: campaignRow.company_id,
      reportTier: 'deep',
      entityType: 'campaign',
      entityId: campaignId,
      status: ['open'],
    })
  );

  const optimization = composeCampaignOptimizationView(campaignId, composition);
  const insights: OptimizationInsight[] = optimization.insights.map((insight) => ({ ...insight, campaignId }));

  return res.status(200).json({ insights });
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]);
