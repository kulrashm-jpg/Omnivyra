
/**
 * Shared API: Generate 7 AI daily plans via execution engine.
 * Single endpoint for Source B (AI expansion). Used by:
 * - campaign-daily-plan (Generate from AI button)
 * - campaign-details (fallback when generate-weekly-structure fails)
 * - ComprehensivePlanningInterface (Generate All Days)
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { generateFromAI, WEEK_EXECUTION_LOCKED } from '../../../backend/services/executionPlannerService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weekNumber } = req.body as { campaignId?: string; weekNumber?: number };

    if (!campaignId || !Number.isFinite(weekNumber) || weekNumber < 1) {
      return res.status(400).json({
        error: 'campaignId and weekNumber (>= 1) are required',
      });
    }

    const access = await requireCampaignAccess(req, res, campaignId);
    if (!access) return;

    const { rowsInserted } = await generateFromAI(campaignId, weekNumber);

    return res.status(200).json({
      success: true,
      message: `Generated and saved ${rowsInserted} daily plan(s) for week ${weekNumber}`,
      rowsInserted,
    });
  } catch (error) {
    const err = error as { code?: string; message?: string };
    if (err?.code === WEEK_EXECUTION_LOCKED) {
      return res.status(423).json({ error: WEEK_EXECUTION_LOCKED, message: err?.message ?? 'Week is executing; regeneration blocked.' });
    }
    console.error('Error in generate-ai-daily-plans API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
