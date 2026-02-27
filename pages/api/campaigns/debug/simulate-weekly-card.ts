import { NextApiRequest, NextApiResponse } from 'next';
import { runCampaignAiPlan } from '../../../../backend/services/campaignAiOrchestrator';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'Debug route is only available in development.' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, recommendationContext, collectedPlanningContext, message } = req.body || {};
    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'campaignId is required' });
    }

    const result = await runCampaignAiPlan({
      campaignId,
      mode: 'generate_plan',
      message:
        typeof message === 'string' && message.trim()
          ? message.trim()
          : 'Debug simulation: generate a weekly card with full writing context.',
      recommendationContext:
        recommendationContext && typeof recommendationContext === 'object'
          ? recommendationContext
          : undefined,
      collectedPlanningContext:
        collectedPlanningContext && typeof collectedPlanningContext === 'object'
          ? collectedPlanningContext
          : undefined,
    });

    const simulatedWeek = (result.plan?.weeks || [])[0] ?? null;
    try {
      console.log('[weekly-debug][simulation-week]', JSON.stringify(simulatedWeek, null, 2));
    } catch {
      console.log('[weekly-debug][simulation-week]', simulatedWeek);
    }

    return res.status(200).json({
      mode: result.mode,
      snapshot_hash: result.snapshot_hash,
      simulatedWeek,
    });
  } catch (error: any) {
    console.error('Error in simulate-weekly-card debug route:', error);
    return res.status(500).json({
      error: error?.message || 'Debug simulation failed',
    });
  }
}
