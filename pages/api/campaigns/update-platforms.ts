import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { updateActivity } from '../../../backend/services/executionPlannerService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { tenantChildTable, tenantContextFor, ownerOfChildRow, TenantSeamError } from '../../../backend/db/tenantTable';
import { seamDenial } from '../../../backend/db/seamDenial';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { dayPlanId, platforms, contentType } = req.body;

    if (!dayPlanId) {
      return res.status(400).json({ error: 'Day plan ID required' });
    }

    // ROUTE-AUTH-001: authenticate BEFORE the day-plan lookup, then authorize
    // against the campaign that owns the day plan (loaded server-side).
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    // S2 derive-then-authorize (ownerOfChildRow, R10): the day-plan row yields ONLY its campaign id (null for a
    // missing, unreadable or campaign-less row: the 404 below; an unreadable row used to answer 500). That campaign
    // is authorized right below by requireCampaignAccess, before anything else.
    const dayPlanOwner = await ownerOfChildRow('daily_content_plans', String(dayPlanId), 'update platforms: campaign of the day plan');
    if (!dayPlanOwner) {
      return res.status(404).json({ error: 'Day plan not found' });
    }
    const access = await requireCampaignAccess(req, res, dayPlanOwner.parentId);
    if (!access) return;

    // S2 tenant seam: the plan rows are read through the campaign child handle, built from the company
    // requireCampaignAccess authorized for access.userId and the campaign it checked.
    const dailyPlansTable = await tenantChildTable('daily_content_plans', tenantContextFor({ userId: access.userId }, access.companyId), access.campaignId);

    // Platform mapping for smart suggestions
    const platformMapping: { [key: string]: string[] } = {
      'Educational Post': ['LinkedIn', 'Twitter'],
      'Case Study': ['LinkedIn'],
      'Question-based Content': ['Twitter', 'Facebook'],
      'Tips & Tutorial': ['LinkedIn', 'YouTube'],
      'Industry News': ['LinkedIn', 'Twitter'],
      'Behind the Scenes': ['Instagram', 'LinkedIn'],
      'Reflection': ['LinkedIn'],
      'Random': ['LinkedIn', 'Twitter', 'Facebook', 'Instagram', 'YouTube', 'TikTok', 'Pinterest'],
    };

    await updateActivity(
      dayPlanId,
      {
        platforms: platforms,
        posting_strategy: `Custom platforms: ${platforms.join(', ')}`,
      },
      'board'
    );

    const { data: updatedPlan } = await dailyPlansTable
      .select('*')
      .eq('id', dayPlanId)
      .maybeSingle();

    // Return suggested platforms based on content type
    const suggestedPlatforms = platformMapping[contentType] || [];
    const allPlatforms = ['LinkedIn', 'Twitter', 'Facebook', 'Instagram', 'YouTube', 'TikTok', 'Pinterest'];

    return res.status(200).json({
      success: true,
      updatedPlan,
      suggestedPlatforms,
      allPlatforms,
      contentType
    });

  } catch (error) {
    if (error instanceof TenantSeamError) return seamDenial(res, error, 404, { error: 'Day plan not found' });
    console.error('Error in update platforms API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/update-platforms' });
