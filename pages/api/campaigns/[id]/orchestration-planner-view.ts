import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/campaigns/[id]/orchestration-planner-view
 * Phase-2 Step-14 — READ-ONLY canonical planner orchestration visibility.
 * Additive: no mutation, no legacy change. Planner UI MAY consume this.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import { getPlannerExecutionView } from '../../../../backend/services/orchestration';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { id } = req.query;
  const campaignId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const access = await requireCampaignAccess(req, res, campaignId);
  if (!access) return;
  try {
    const view = await getPlannerExecutionView(access.campaignId);
    if (!view) return res.status(200).json({ campaign_id: access.campaignId, available: false });
    return res.status(200).json(view);
  } catch (e) {
    return res.status(500).json({ error: (e as Error)?.message ?? 'Failed to build planner view' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/orchestration-planner-view' });
