import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../../../../backend/services/campaignBlueprintService';
import { blueprintWeeksToLegacyRefinements } from '../../../../backend/services/campaignBlueprintAdapter';
import { syncCampaignVersionStage } from '../../../../backend/db/campaignVersionStore';

/**
 * POST /api/campaigns/[id]/expand-to-week-plans
 * Converts 12-week blueprint into detailed weekly_content_refinements.
 * Call this after 12-week plan exists; creates/upserts one refinement per week.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }

  const campaignId = id;

  try {
    const blueprint = await getUnifiedCampaignBlueprint(campaignId);
    if (!blueprint?.weeks?.length) {
      return res.status(404).json({
        error: '12-week plan not found',
        hint: 'Create or commit a 12-week plan first, then expand to detailed week plans.',
      });
    }

    // Get twelve_week_plan id for FK link (when stored in twelve_week_plan table)
    const { data: twelveWeekRow } = await supabase
      .from('twelve_week_plan')
      .select('id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const twelveWeekPlanId = twelveWeekRow?.id ?? null;

    const refinements = blueprintWeeksToLegacyRefinements(blueprint.weeks, campaignId, {
      suggestions: (w) => (w.topics_to_cover as string[])?.slice(0, 5) ?? [],
    });

    let inserted = 0;
    let updated = 0;

    for (const row of refinements) {
      const { data: existing } = await supabase
        .from('weekly_content_refinements')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('week_number', row.week_number)
        .maybeSingle();

      const payload: Record<string, unknown> = {
        campaign_id: row.campaign_id,
        week_number: row.week_number,
        theme: row.theme,
        focus_area: row.focus_area,
        ai_suggestions: row.ai_suggestions ?? [],
        refinement_status: row.refinement_status ?? 'ai_enhanced',
        updated_at: new Date().toISOString(),
      };
      if (twelveWeekPlanId) payload.twelve_week_plan_id = twelveWeekPlanId;

      if (existing) {
        const { error } = await supabase
          .from('weekly_content_refinements')
          .update(payload)
          .eq('id', existing.id);
        if (!error) updated++;
      } else {
        const { error } = await supabase
          .from('weekly_content_refinements')
          .insert({
            ...payload,
            created_at: new Date().toISOString(),
          });
        if (!error) inserted++;
      }
    }

    // Sync campaign_versions stage - detailed week plans is between twelve_week_plan and daily_plan
    // We use twelve_week_plan still as stage; the "detailed" is just the data
    void syncCampaignVersionStage(campaignId, 'twelve_week_plan').catch(() => {});

    return res.status(200).json({
      success: true,
      message: `Expanded to ${refinements.length} detailed week plans`,
      inserted,
      updated,
      totalWeeks: refinements.length,
    });
  } catch (error) {
    console.error('expand-to-week-plans error:', error);
    return res.status(500).json({
      error: 'Failed to expand to week plans',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
