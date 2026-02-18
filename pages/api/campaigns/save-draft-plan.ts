import { NextApiRequest, NextApiResponse } from 'next';
import { fromStructuredPlan } from '../../../backend/services/campaignBlueprintAdapter';
import { saveDraftBlueprint } from '../../../backend/db/campaignPlanStore';

/**
 * POST /api/campaigns/save-draft-plan
 * Saves structured plan as draft (same table as committed; status=draft).
 * Used by "Save for Later" when user has a structured plan.
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

    await saveDraftBlueprint({ campaignId, blueprint });

    return res.status(200).json({
      success: true,
      message: 'Draft plan saved',
    });
  } catch (error) {
    console.error('Error in save-draft-plan:', error);
    return res.status(500).json({
      error: 'Failed to save draft plan',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
