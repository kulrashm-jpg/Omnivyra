import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';
import { refineUserFacingResponse } from '@/backend/utils/refineUserFacingResponse';

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
    const normalizeWeekForClient = (w: any) => {
      const raw = w && typeof w === 'object' ? w : {};
      const weekNum = Number((raw as any).week ?? (raw as any).week_number ?? (raw as any).weekNumber ?? 0) || 0;
      const phase = String((raw as any).phase_label ?? (raw as any).phaseLabel ?? (raw as any).theme ?? `Week ${weekNum}`) || `Week ${weekNum}`;
      const primaryObjective = String((raw as any).primary_objective ?? (raw as any).primaryObjective ?? '') || '';
      const platformAllocation =
        (raw as any).platform_allocation && typeof (raw as any).platform_allocation === 'object'
          ? (raw as any).platform_allocation
          : ((raw as any).platform_allocation ?? {});
      const contentTypeMix = Array.isArray((raw as any).content_type_mix)
        ? (raw as any).content_type_mix
        : (Array.isArray((raw as any).contentTypes) ? (raw as any).contentTypes : undefined);
      const ctaType = String((raw as any).cta_type ?? (raw as any).ctaType ?? 'None');
      const kpi = String((raw as any).weekly_kpi_focus ?? (raw as any).weeklyKpiFocus ?? 'Reach growth');
      // Preserve all enriched/additive fields by spreading `raw` first.
      return {
        ...raw,
        week: weekNum,
        phase_label: phase,
        theme: phase,
        primary_objective: primaryObjective,
        platform_allocation: platformAllocation,
        content_type_mix: Array.isArray(contentTypeMix) ? contentTypeMix : ['post'],
        cta_type: ctaType,
        weekly_kpi_focus: kpi,
        daily: Array.isArray((raw as any).daily) ? (raw as any).daily : [],
      };
    };

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
          weeks: (Array.isArray(weeks) ? weeks : []).map(normalizeWeekForClient),
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
        weeks: (Array.isArray(blueprint.weeks) ? blueprint.weeks : []).map(normalizeWeekForClient),
      };
    }

    const responseData = { savedPlan, committedPlan, draftPlan };
    const refinedResponse = await refineUserFacingResponse(responseData);
    return res.status(200).json(refinedResponse);
  } catch (error) {
    console.error('Error in retrieve-plan API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
