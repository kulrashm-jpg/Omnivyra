import { NextApiRequest, NextApiResponse } from 'next';
import { fromStructuredPlan } from '../../../backend/services/campaignBlueprintAdapter';
import { updateToEditedCommitted } from '../../../backend/db/campaignPlanStore';

/**
 * POST /api/campaigns/update-edited-committed
 * Updates committed plan to edited_committed (same row, status change).
 * Used when user edits a committed plan and saves changes.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, structuredPlan } = req.body;

    if (!campaignId || !structuredPlan?.weeks?.length) {
      return res.status(400).json({
        error: 'campaignId and structuredPlan.weeks are required',
      });
    }

    const blueprint = fromStructuredPlan({
      weeks: structuredPlan.weeks,
      campaign_id: campaignId,
    });

    await updateToEditedCommitted({ campaignId, blueprint });

    return res.status(200).json({
      success: true,
      message: 'Changes saved (edited committed plan)',
    });
  } catch (error) {
    console.error('Error in update-edited-committed:', error);
    return res.status(500).json({
      error: 'Failed to save edits',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
