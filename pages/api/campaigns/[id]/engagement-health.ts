import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/campaigns/[id]/engagement-health
 * Returns EngagementHealthReport for a campaign.
 * Used by Engagement Inbox, Audience Insights, Content Performance dashboards.
 * Kept separate from Campaign Health (design/plan evaluation).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ownerCompanyOfRow } from '../../../../backend/db/tenantTable';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }
  const campaignId = id;

  try {
    // S2 derive-then-authorize (e9 ruling, as campaigns/[id]/source-recommendation): ownerCompanyOfRow answers ONLY
    // which company owns the campaign (campaigns.company_id, NOT NULL since 20270217000025), no longer "any
    // campaign_versions row" (an unordered .limit(1) read). SOURCE-OF-TRUTH MOVE: versions -> campaigns; C36: 0
    // mismatches in prod. The ?companyId= fallback for a campaign with no owner is unchanged, and the access check
    // still binds the campaign to whichever company it authorizes (checkCampaignOwnership).
    const ownerCompanyId = await ownerCompanyOfRow('campaigns', campaignId, 'campaign engagement health: owner of the campaign');
    const queryCompanyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
    const companyId = ownerCompanyId ?? queryCompanyId;
    if (!companyId) {
      return res.status(400).json({ error: 'Campaign must be linked to a company' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: ownerCompanyId ?? queryCompanyId,
      campaignId,
      requireCampaignId: false,
    });
    if (!access) return;

    const report: Record<string, unknown> = {
      campaign_id: campaignId,
      company_id: companyId,
      engagement_status: 'unknown',
      total_posts: 0,
      engagement_rate: 0,
      reply_pending_count: 0,
      last_updated_at: new Date().toISOString(),
    };

    return res.status(200).json(report);
  } catch (err) {
    console.error('[campaigns/engagement-health]', err);
    return res.status(500).json({
      error: 'Failed to fetch engagement health',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/engagement-health' });
