import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    // Blueprint (twelve_week_plan) is source of truth for committed plans — check first
    const blueprint = await getUnifiedCampaignBlueprint(campaignId as string);
    let source: any[] = [];
    if (blueprint?.weeks && blueprint.weeks.length > 0) {
      source = blueprint.weeks.map((w) => ({
        week_number: w.week_number,
        phase: w.phase_label,
        theme: w.phase_label,
        focus_area: w.primary_objective || w.phase_label,
        key_messaging: w.topics_to_cover?.join('; ') ?? null,
        content_types: w.content_type_mix ?? w.content_types ?? [],
        platform_strategy: null,
        refinement_status: 'ai_enhanced',
        completion_percentage: 0,
        platform_allocation: w.platform_allocation ?? {},
        platform_content_breakdown: w.platform_content_breakdown ?? {},
        topics_to_cover: w.topics_to_cover ?? [],
      }));
    }
    // Fallback to legacy tables when no committed blueprint
    if (source.length === 0) {
      const { data: plans, error: plansError } = await supabase
        .from('weekly_content_plans')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('week_number');
      if (!plansError && plans && plans.length > 0) {
        source = plans;
      } else {
        const { data: refinements, error: refError } = await supabase
          .from('weekly_content_refinements')
          .select('*')
          .eq('campaign_id', campaignId)
          .order('week_number');
        if (!refError && refinements && refinements.length > 0) {
          source = refinements;
        }
      }
    }

    // Format response (supports both weekly_content_plans and weekly_content_refinements schemas)
    const response = source.map(plan => ({
      weekNumber: plan.week_number,
      phase: plan.phase ?? null,
      theme: plan.theme ?? plan.focus_area ?? null,
      focusArea: plan.focus_area ?? plan.theme ?? null,
      keyMessaging: plan.key_messaging ?? null,
      contentTypes: plan.content_types ?? [],
      platformStrategy: plan.platform_strategy ?? null,
      callToAction: plan.call_to_action ?? null,
      targetMetrics: plan.target_metrics ?? null,
      contentGuidelines: plan.content_guidelines ?? null,
      hashtagSuggestions: plan.hashtag_suggestions ?? [],
      status: plan.status ?? plan.refinement_status ?? 'planned',
      completionPercentage: plan.completion_percentage ?? 0,
      platform_allocation: plan.platform_allocation ?? {},
      platform_content_breakdown: plan.platform_content_breakdown ?? {},
      topics_to_cover: plan.topics_to_cover ?? [],
    }));

    res.status(200).json(response);

  } catch (error) {
    console.error('Error in get-weekly-plans API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}



