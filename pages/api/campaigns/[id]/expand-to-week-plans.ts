import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../../../../backend/services/campaignBlueprintService';
import { blueprintWeeksToLegacyRefinements } from '../../../../backend/services/campaignBlueprintAdapter';
import { syncCampaignVersionStage } from '../../../../backend/db/campaignVersionStore';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';

/**
 * POST /api/campaigns/[id]/expand-to-week-plans
 * Converts 12-week blueprint into detailed weekly_content_refinements.
 * Call this after 12-week plan exists; creates/upserts one refinement per week.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }

  // SECURITY: enforce caller has access to this campaign's company before mutating.
  const access = await requireCampaignAccess(req, res, id);
  if (!access) return;

  const campaignId = id;

  try {
    const blueprint = await getUnifiedCampaignBlueprint(campaignId);
    if (!blueprint?.weeks?.length) {
      return res.status(404).json({
        error: '12-week plan not found',
        hint: 'Create or commit a 12-week plan first, then expand to detailed week plans.',
      });
    }

    // Get campaign_week_plan id for FK link (when stored in campaign_week_plan table)
    const { data: twelveWeekRow } = await supabase
      .from('campaign_week_plan')
      .select('id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const twelveWeekPlanId = twelveWeekRow?.id ?? null;

    const refinements = blueprintWeeksToLegacyRefinements(blueprint.weeks, campaignId, {
      suggestions: (w) => (w.topics_to_cover as string[])?.slice(0, 5) ?? [],
    });

    // OPT-010 W2-1: ONE prefetch + at most two batched writes replace the
    // per-week select-then-insert/update loop (2 round-trips × weeks).
    // inserted/updated counts derive from the prefetch — same values the
    // loop counted. created_at is set only on the insert batch, so existing
    // rows keep their original created_at exactly as the old UPDATE did.
    const weekNumbers = refinements.map((r) => r.week_number);
    const { data: existingRows } = await supabase
      .from('weekly_content_refinements')
      .select('id, week_number')
      .eq('campaign_id', campaignId)
      .in('week_number', weekNumbers);
    const existingWeeks = new Set(
      (existingRows ?? []).map((r: { week_number: number }) => r.week_number)
    );

    const nowIso = new Date().toISOString();
    const buildPayload = (row: (typeof refinements)[number]): Record<string, unknown> => {
      const payload: Record<string, unknown> = {
        campaign_id: row.campaign_id,
        week_number: row.week_number,
        theme: row.theme,
        focus_area: row.focus_area,
        ai_suggestions: row.ai_suggestions ?? [],
        refinement_status: row.refinement_status ?? 'ai_enhanced',
        updated_at: nowIso,
      };
      if (twelveWeekPlanId) payload.campaign_week_plan_id = twelveWeekPlanId;
      return payload;
    };

    const newRows = refinements.filter((r) => !existingWeeks.has(r.week_number));
    const updateRows = refinements.filter((r) => existingWeeks.has(r.week_number));

    let inserted = 0;
    let updated = 0;

    if (newRows.length > 0) {
      const { error } = await supabase
        .from('weekly_content_refinements')
        .insert(newRows.map((r) => ({ ...buildPayload(r), created_at: nowIso })));
      if (!error) inserted = newRows.length;
    }
    if (updateRows.length > 0) {
      // Upsert on (campaign_id, week_number) acts as a batched UPDATE for
      // rows the prefetch proved exist; created_at deliberately omitted.
      const { error } = await supabase
        .from('weekly_content_refinements')
        .upsert(updateRows.map(buildPayload), { onConflict: 'campaign_id,week_number' });
      if (!error) updated = updateRows.length;
    }

    // Sync campaign_versions stage - detailed week plans is between campaign_week_plan and daily_plan
    // We use campaign_week_plan still as stage; the "detailed" is just the data
    void syncCampaignVersionStage(campaignId, 'campaign_week_plan').catch(() => {});

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/expand-to-week-plans' });
