import { seamDenial } from '../../../backend/db/seamDenial';
import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { tenantChildTable, tenantContextFor, TenantSeamError } from '../../../backend/db/tenantTable';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID required' });
    }

    // ROUTE-AUTH-001: authenticate and bind the campaign to the caller's tenant.
    const access = await requireCampaignAccess(req, res, campaignId as string);
    if (!access) return;

    // Get weekly refinements from existing table structure.
    // S2 tenant seam: read through tenantChildTable (child of campaigns), with the tenant built from the
    // company requireCampaignAccess authorized and the campaign id it checked.
    const tenant = tenantContextFor({ userId: access.userId }, access.companyId);
    const refinementsTable = await tenantChildTable('weekly_content_refinements', tenant, access.campaignId);
    const { data: weeklyRefinements, error: refinementsError } = await refinementsTable
      .select('*')
      .order('week_number');

    // The per-week daily plan count used to be an embed (daily_content_plans(count)); the seam refuses embeds,
    // so this campaign's daily plans are read once through their own seam (child of the same campaign) and
    // counted per refinement over the FK daily_content_plans.source_refinement_id -> weekly_content_refinements.id.
    // A failed read is treated like the failed embed was: the whole read falls back below.
    let error = refinementsError;
    const dailyPlansCountByRefinement = new Map<string, number>();
    if (!error && (weeklyRefinements ?? []).length > 0) {
      const dailyPlansTable = await tenantChildTable('daily_content_plans', tenant, access.campaignId);
      const { data: dailyRows, error: dailyError } = await dailyPlansTable
        .select('source_refinement_id')
        .not('source_refinement_id', 'is', null);
      if (dailyError) {
        error = dailyError;
      } else {
        for (const row of (dailyRows ?? []) as Array<{ source_refinement_id: string | null }>) {
          const key = String(row.source_refinement_id);
          dailyPlansCountByRefinement.set(key, (dailyPlansCountByRefinement.get(key) ?? 0) + 1);
        }
      }
    }

    if (error) {
      console.log('No weekly refinements found:', error?.message);
      
      // Fallback to campaigns.weekly_themes if weekly refinements table doesn't exist
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('weekly_themes, ai_generated_summary')
        .eq('id', access.campaignId)
        .single();

      const weeklyThemes = campaign?.weekly_themes || [];
      
      const formattedPlans = weeklyThemes.map((theme: any, index: number) => ({
        id: `week-${index + 1}`,
        week: index + 1,
        theme: theme?.theme || `Week ${index + 1} Theme`,
        contentFocus: theme?.contentFocus || '',
        targetAudience: theme?.targetAudience || '',
        keyMessaging: theme?.keyMessaging || '',
        contentTypes: theme?.contentTypes || [],
        platformStrategy: theme?.platformStrategy || '',
        callToAction: theme?.callToAction || '',
        successMetrics: theme?.successMetrics || {},
        createdAt: theme?.createdAt || new Date().toISOString(),
        status: theme?.status || 'pending',
        dailyPlansCount: theme?.dailyStructure?.length || 0
      }));

      return res.status(200).json({ 
        success: true, 
        plans: formattedPlans,
        count: formattedPlans.length 
      });
    }

    // Format plans from weekly refinements
    const formattedPlans = weeklyRefinements.map((refinement: any) => ({
      id: refinement.id,
      week: refinement.week_number,
      theme: refinement.theme,
      contentFocus: refinement.focus_area,
      targetAudience: refinement.target_audience,
      keyMessaging: refinement.key_messaging,
      contentTypes: refinement.finalized_content || [],
      platformStrategy: refinement.platform_strategy,
      callToAction: refinement.call_to_action,
      successMetrics: refinement.success_metrics,
      createdAt: refinement.created_at,
      status: refinement.refinement_status,
      dailyPlansCount: dailyPlansCountByRefinement.get(refinement.id) || 0,
      aiGenerated: refinement.ai_enhancement_applied,
      finalized: refinement.finalized,
      dailyPopulated: refinement.daily_plan_populated
    }));

    return res.status(200).json({ 
      success: true, 
      plans: formattedPlans,
      count: formattedPlans.length 
    });

  } catch (error) {
    if (error instanceof TenantSeamError) return seamDenial(res, error, 404, { error: 'Campaign not found' });
    console.error('Error in 12week-plans API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/12week-plans' });
