import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';

/**
 * GET /api/campaigns/retrieve-plan?campaignId=...
 * Returns saved plan (from content_plans / ai_threads) and committed plan (from blueprint).
 * Used to offer "Load saved plan" and "Load committed plan" with edit option.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId } = req.query;

    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'campaignId is required' });
    }

    let savedPlan: { content: string; savedAt: string } | null = null;
    let committedPlan: { weeks: any[] } | null = null;
    let draftPlan: { weeks: any[]; savedAt: string } | null = null;

    // 1. Saved plan: content_plans (draft/ai_generated_plan) or ai_threads
    let contentRow: { description?: string; created_at?: string } | null = null;
    try {
      const { data } = await supabase
        .from('content_plans')
        .select('description, created_at')
        .eq('campaign_id', campaignId)
        .eq('content_type', 'ai_generated_plan')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      contentRow = data;
    } catch {
      // content_plans schema may differ
    }

    if (contentRow?.description) {
      savedPlan = {
        content: contentRow.description,
        savedAt: contentRow.created_at || new Date().toISOString(),
      };
    }

    if (!savedPlan) {
      const { data: threadRow } = await supabase
        .from('ai_threads')
        .select('messages, created_at')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const messages = threadRow?.messages as any[] | undefined;
      const firstContent = Array.isArray(messages) && messages.length > 0
        ? messages.find((m: any) => m?.content)
        : null;
      if (firstContent?.content) {
        savedPlan = {
          content: firstContent.content,
          savedAt: threadRow?.created_at || new Date().toISOString(),
        };
      }
    }

    // 2. Draft plan: twelve_week_plan with status=draft (same table as committed)
    try {
      const { data: draftRow } = await supabase
        .from('twelve_week_plan')
        .select('weeks, blueprint, updated_at')
        .eq('campaign_id', campaignId)
        .eq('status', 'draft')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (draftRow?.weeks?.length || draftRow?.blueprint?.weeks?.length) {
        const weeks = (draftRow.blueprint as any)?.weeks ?? draftRow.weeks;
        draftPlan = {
          weeks: weeks.map((w: any) => ({
            week: w.week ?? w.week_number,
            phase_label: w.phase_label,
            theme: w.phase_label ?? w.theme,
            primary_objective: w.primary_objective,
            platform_allocation: w.platform_allocation || {},
            content_type_mix: w.content_type_mix || ['post'],
            cta_type: w.cta_type || 'None',
            weekly_kpi_focus: w.weekly_kpi_focus || 'Reach growth',
            topics_to_cover: w.topics_to_cover,
            platform_content_breakdown: w.platform_content_breakdown,
            platform_topics: w.platform_topics,
            daily: [],
          })),
          savedAt: draftRow.updated_at || new Date().toISOString(),
        };
      }
    } catch {
      // status column may not exist yet
    }

    // 3. Committed plan: blueprint
    const blueprint = await getUnifiedCampaignBlueprint(campaignId);
    if (blueprint?.weeks?.length) {
      committedPlan = {
        weeks: blueprint.weeks.map((w: any) => ({
          week: w.week_number,
          phase_label: w.phase_label,
          theme: w.phase_label,
          primary_objective: w.primary_objective,
          platform_allocation: w.platform_allocation || {},
          content_type_mix: w.content_type_mix || ['post'],
          cta_type: w.cta_type || 'None',
          weekly_kpi_focus: w.weekly_kpi_focus || 'Reach growth',
          topics_to_cover: w.topics_to_cover,
          platform_content_breakdown: w.platform_content_breakdown,
          platform_topics: w.platform_topics,
          daily: [],
        })),
      };
    }

    return res.status(200).json({
      savedPlan,
      committedPlan,
      draftPlan,
    });
  } catch (error) {
    console.error('Error in retrieve-plan API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
