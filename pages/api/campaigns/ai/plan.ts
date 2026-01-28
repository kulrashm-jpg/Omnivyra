import { NextApiRequest, NextApiResponse } from 'next';
import { runCampaignAiPlan, CampaignAiMode } from '../../../../backend/services/campaignAiOrchestrator';
import { saveAiCampaignPlan } from '../../../../backend/db/campaignPlanStore';

const MODES: CampaignAiMode[] = ['generate_plan', 'refine_day', 'platform_customize'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, mode, message, durationWeeks, targetDay, platforms } = req.body || {};

    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    if (!mode || !MODES.includes(mode)) {
      return res.status(400).json({ error: 'mode is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const result = await runCampaignAiPlan({
      campaignId,
      mode,
      message,
      durationWeeks: typeof durationWeeks === 'number' ? durationWeeks : undefined,
      targetDay: typeof targetDay === 'string' ? targetDay : undefined,
      platforms: Array.isArray(platforms) ? platforms : undefined,
    });

    if (typeof saveAiCampaignPlan === 'function') {
      await saveAiCampaignPlan({
        campaignId,
        snapshot_hash: result.snapshot_hash,
        mode: result.mode,
        response: result.raw_plan_text,
        omnivyre_decision: result.omnivyre_decision,
      });
    }

    return res.status(200).json({
      mode: result.mode,
      snapshot_hash: result.snapshot_hash,
      omnivyre_decision: result.omnivyre_decision,
      plan: result.plan,
      day: result.day,
      platform_content: result.platform_content,
    });
  } catch (error: any) {
    console.error('Error in campaign AI plan API:', error);
    return res.status(500).json({ error: 'Failed to generate campaign plan' });
  }
}
