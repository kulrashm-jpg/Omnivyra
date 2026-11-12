import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignTenantAccess } from '../../../backend/security/TenantGuard';
import { tenantTable, tenantChildTable, tenantContextFor, TenantSeamError } from '../../../backend/db/tenantTable';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, campaignSummary, weeklyPlans } = req.body;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    const access = await requireCampaignTenantAccess(req, res, campaignId);
    if (!access) return;

    // S2 tenant seam: the tenant is the company requireCampaignTenantAccess authorized (access.organizationId)
    // for this campaignId, never the body. weekly_content_refinements is a child of campaigns: its handle (which
    // proves the campaign is in that tenant) is made BEFORE any write below, so a refusal writes nothing.
    const tenant = tenantContextFor({ userId: access.userId }, access.organizationId);
    const refinementsTable = await tenantChildTable('weekly_content_refinements', tenant, String(campaignId));

    // Update campaign with summary information
    const { error: campaignError } = await tenantTable('campaigns', tenant)
      .update({
        objective: campaignSummary.objective,
        target_audience: campaignSummary.targetAudience,
        key_messages: campaignSummary.keyMessages,
        success_metrics: campaignSummary.successMetrics,
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId);

    if (campaignError) {
      console.error('Error updating campaign:', campaignError);
    }

    // Save/update weekly refinements
    const weeklyRefinementUpdates = weeklyPlans.map((week: any) => ({
      campaign_id: campaignId,
      week_number: week.weekNumber,
      theme: week.theme,
      focus_area: week.focusArea,
      marketing_channels: week.marketingChannels,
      existing_content: week.existingContent || '',
      content_notes: week.contentNotes || '',
      refinement_status: 'user_edited',
      updated_at: new Date().toISOString()
    }));

    console.warn('DEPRECATED: weekly_content_refinements write path triggered (save-comprehensive-plan)');
    // OPT-010 W2-2: ONE bulk upsert replaces the per-week loop. The second
    // loop that re-wrote existing_content/content_notes is folded in — the
    // rows above already carry those exact values (lines 44-45), so it was a
    // redundant second write of identical data. Per-week deprecation warns
    // for content-bearing weeks are preserved below (log parity).
    for (const week of weeklyPlans) {
      if (week.existingContent && week.existingContent.trim()) {
        console.warn('DEPRECATED: weekly_content_refinements write path triggered (save-comprehensive-plan update)');
      }
    }
    const { error: weekError } = await refinementsTable
      .upsert(
        weeklyRefinementUpdates.map((weekData: Record<string, unknown>) => ({
          ...weekData,
          created_at: weekData.updated_at
        })),
        {
          onConflict: 'campaign_id,week_number'
        }
      );

    if (weekError) {
      console.error('Error updating weekly refinements (bulk):', weekError);
    }

    return res.status(200).json({
      success: true,
      message: 'Campaign plan saved successfully',
      campaignSummary,
      weeklyPlans
    });

  } catch (error) {
    if (error instanceof TenantSeamError) {
      return res.status(404).json({ error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' });
    }
    console.error('Error saving comprehensive plan:', error);
    return res.status(500).json({ 
      error: 'Failed to save comprehensive plan',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/save-comprehensive-plan' });
