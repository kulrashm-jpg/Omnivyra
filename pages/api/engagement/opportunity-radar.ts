/**
 * GET /api/engagement/opportunity-radar
 * Returns cross-thread opportunity counts and/or opportunity_radar items.
 * Params: organization_id, window_hours (optional), source, campaignId, opportunity_type, format=items|stats
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  getOpportunityRadarStats,
  getOpportunityRadarItems,
  type OpportunityRadarItem,
} from '../../../backend/services/opportunityRadarService';
import { generateCampaignSuggestions } from '../../../backend/services/plannerOpportunityAdvisor';
import { supabase } from '../../../backend/db/supabaseClient';

const MAX_WINDOW_HOURS = 168; // 7 days
const DEFAULT_WINDOW_HOURS = 24;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as
      | string
      | undefined;
    const windowHoursRaw = parseInt(String(req.query.window_hours ?? DEFAULT_WINDOW_HOURS), 10);
    const windowHours = Number.isNaN(windowHoursRaw)
      ? DEFAULT_WINDOW_HOURS
      : Math.min(MAX_WINDOW_HOURS, Math.max(1, windowHoursRaw));
    const source = req.query.source as string | undefined;
    const campaignId = req.query.campaignId as string | undefined;
    const opportunityType = req.query.opportunity_type as string | undefined;
    const format = req.query.format as 'items' | 'stats' | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id or organizationId required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const wantsItems = format === 'items' || (format !== 'stats' && source === 'campaign_engagement');
    const wantsStats = format !== 'items';

    const [stats, items] = await Promise.all([
      wantsStats ? getOpportunityRadarStats(organizationId, windowHours) : null,
      wantsItems ? getOpportunityRadarItems(organizationId, { source, campaignId, opportunityType }) : null,
    ]);

    const response: {
      competitor_complaints?: number;
      recommendation_requests?: number;
      product_comparisons?: number;
      buying_intent?: number;
      window_hours?: number;
      items?: Array<OpportunityRadarItem & { suggested_action?: string }>;
    } = {};

    if (stats) {
      response.competitor_complaints = stats.competitor_complaints;
      response.recommendation_requests = stats.recommendation_requests;
      response.product_comparisons = stats.product_comparisons;
      response.buying_intent = stats.buying_intent;
      response.window_hours = stats.window_hours;
    }

    if (items && items.length > 0) {
      const opportunityIds = items.map((i) => i.id);
      const { data: proposalRows } = await supabase
        .from('campaign_proposals')
        .select('opportunity_id')
        .in('opportunity_id', opportunityIds)
        .eq('status', 'draft');

      const proposalOpportunityIds = new Set(
        (proposalRows ?? []).map((r: { opportunity_id: string }) => r.opportunity_id)
      );

      response.items = items.map((item) => {
        const suggestions = generateCampaignSuggestions(item);
        const campaign_proposal_available = proposalOpportunityIds.has(item.id);
        const suggested_action =
          campaign_proposal_available
            ? 'Campaign Recommended'
            : (suggestions[0]?.action ?? null);
        return {
          ...item,
          campaign_proposal_available,
          suggested_action,
        };
      });
    }

    return res.status(200).json(response);
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch opportunity radar';
    console.error('[engagement/opportunity-radar]', err);
    // Return empty response instead of 500 when possible — UI shows "No opportunity insights" instead of error
    return res.status(200).json({
      items: [],
      competitor_complaints: 0,
      recommendation_requests: 0,
      product_comparisons: 0,
      buying_intent: 0,
      window_hours: DEFAULT_WINDOW_HOURS,
    });
  }
}
