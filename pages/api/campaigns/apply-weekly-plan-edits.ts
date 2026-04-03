
/**
 * POST /api/campaigns/apply-weekly-plan-edits
 *
 * Applies AI-assisted schedule edits to a weekly plan.
 * Parses natural language instruction, applies edits, persists.
 *
 * Body: { campaignId, weekNumber, instruction }
 * Or:   { campaignId, weekNumber, editInstructions } (pre-parsed)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';
import { parseWeeklyPlanCommands } from '../../../backend/services/weeklyPlanCommandParser';
import { applyWeeklyPlanEdits } from '../../../backend/services/weeklyPlanEditEngine';
import { getEnrichedDistributionInsights } from '../../../backend/services/contentDistributionIntelligence';
import { fromStructuredPlan } from '../../../backend/services/campaignBlueprintAdapter';
import {
  getLatestDraftPlan,
  saveDraftBlueprint,
  updateToEditedCommitted,
} from '../../../backend/db/campaignPlanStore';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weekNumber, instruction, editInstructions } = req.body;

    if (!campaignId || !weekNumber) {
      return res.status(400).json({
        error: 'campaignId and weekNumber are required',
      });
    }

    const weekNum = Math.floor(Number(weekNumber));
    if (!Number.isFinite(weekNum) || weekNum < 1) {
      return res.status(400).json({
        error: 'weekNumber must be a positive integer',
      });
    }

    let ops = Array.isArray(editInstructions) ? editInstructions : [];
    if (ops.length === 0 && typeof instruction === 'string' && instruction.trim()) {
      ops = parseWeeklyPlanCommands(instruction);
    }

    if (ops.length === 0) {
      return res.status(400).json({
        error: 'Could not parse any edit operations from instruction',
        suggestion: 'Try: "Move A3 to Friday morning", "Swap A2 and B1", "Delay A1 by 1 day", "Delete B2", "Add Instagram post under topic B"',
      });
    }

    const draft = await getLatestDraftPlan(campaignId);
    const blueprint = await getUnifiedCampaignBlueprint(campaignId);

    if (!blueprint?.weeks?.length && !draft?.weeks?.length) {
      return res.status(404).json({
        error: 'No plan found for this campaign',
      });
    }

    const weeks = (draft?.weeks ?? blueprint!.weeks) as Record<string, unknown>[];
    const week = weeks.find(
      (w: any) =>
        Number(w?.week ?? w?.week_number ?? 0) === weekNum
    );

    if (!week || typeof week !== 'object') {
      return res.status(404).json({
        error: `Week ${weekNum} not found in plan`,
      });
    }

    const execItems = Array.isArray((week as any).execution_items)
      ? (week as any).execution_items
      : [];
    if (execItems.length === 0) {
      return res.status(400).json({
        error: 'Week has no execution_items to edit',
      });
    }

    const result = applyWeeklyPlanEdits(week as Record<string, unknown>, ops);

    const campaignRow = await supabase
      .from('campaigns')
      .select('start_date')
      .eq('id', campaignId)
      .maybeSingle()
      .then((r) => r.data);
    const versionRow = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r) => r.data);

    const companyId = versionRow?.company_id ? String(versionRow.company_id) : null;
    const campaignStartDate =
      (campaignRow as { start_date?: string } | null)?.start_date ?? null;

    (week as any).distribution_insights = await getEnrichedDistributionInsights(
      week as Record<string, unknown>,
      {
        companyId: companyId ?? undefined,
        campaignStartDate: campaignStartDate ?? undefined,
        weekNumber: weekNum,
      }
    );

    if (!result.success && result.errors.length > 0) {
      return res.status(400).json({
        error: 'Edit operations failed',
        details: result.errors,
      });
    }

    const fullBlueprint = fromStructuredPlan({
      weeks,
      campaign_id: campaignId,
    });

    if (draft?.weeks?.length) {
      await saveDraftBlueprint({ campaignId, blueprint: fullBlueprint });
    } else {
      const { data: committed } = await supabase
        .from('twelve_week_plan')
        .select('id')
        .eq('campaign_id', campaignId)
        .in('status', ['committed', 'edited_committed'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (committed?.id) {
        await updateToEditedCommitted({ campaignId, blueprint: fullBlueprint });
      } else {
        await saveDraftBlueprint({ campaignId, blueprint: fullBlueprint });
      }
    }

    return res.status(200).json({
      success: true,
      applied: result.applied,
      errors: result.errors,
      message: `Applied ${result.applied} edit(s) to Week ${weekNum}. Refresh the board to see changes.`,
    });
  } catch (error) {
    console.error('Error in apply-weekly-plan-edits:', error);
    return res.status(500).json({
      error: 'Failed to apply plan edits',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
