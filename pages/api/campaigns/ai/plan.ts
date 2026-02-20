import { NextApiRequest, NextApiResponse } from 'next';
import { runCampaignAiPlan, CampaignAiMode } from '../../../../backend/services/campaignAiOrchestrator';
import { saveAiCampaignPlan } from '../../../../backend/db/campaignPlanStore';
import { validateAndModerateUserMessage } from '../../../../backend/chatGovernance';

const MODES: CampaignAiMode[] = ['generate_plan', 'refine_day', 'platform_customize'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, mode, message, durationWeeks, targetDay, platforms, messages: conversationHistory, recommendationContext, optimizationContext, currentPlan, scopeWeeks, chatContext, vetScope, collectedPlanningContext } = req.body || {};

    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    if (!mode || !MODES.includes(mode)) {
      return res.status(400).json({ error: 'mode is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const policyResult = await validateAndModerateUserMessage(message, {
      chatContext: 'campaign_planning',
    });
    if (!policyResult.allowed) {
      const preview = String(message).slice(0, 80) + (message.length > 80 ? '...' : '');
      console.warn('[plan] Chat moderation rejected. Message:', JSON.stringify(preview), 'Reason:', policyResult.reason, 'Code:', policyResult.code);
      return res.status(400).json({
        error: 'Your message couldn\'t be processed. Please rephrase and try again.',
      });
    }

    const result = await runCampaignAiPlan({
      campaignId,
      mode,
      message,
      durationWeeks: typeof durationWeeks === 'number' ? durationWeeks : undefined,
      collectedPlanningContext: collectedPlanningContext && typeof collectedPlanningContext === 'object' ? collectedPlanningContext : undefined,
      targetDay: typeof targetDay === 'string' ? targetDay : undefined,
      platforms: Array.isArray(platforms) ? platforms : undefined,
      conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : undefined,
      recommendationContext: recommendationContext && typeof recommendationContext === 'object' ? recommendationContext : undefined,
        optimizationContext:
        optimizationContext && typeof optimizationContext === 'object' && Array.isArray(optimizationContext.headlines)
          ? { roiScore: Number(optimizationContext.roiScore) || 50, headlines: optimizationContext.headlines }
          : undefined,
      currentPlan: currentPlan && typeof currentPlan === 'object' ? currentPlan : undefined,
      scopeWeeks: Array.isArray(scopeWeeks) ? scopeWeeks : undefined,
      chatContext: typeof chatContext === 'string' ? chatContext : undefined,
      vetScope: vetScope && typeof vetScope === 'object' && Array.isArray(vetScope.selectedWeeks) ? vetScope : undefined,
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
      conversationalResponse: result.conversationalResponse,
    });
  } catch (error: any) {
    console.error('Error in campaign AI plan API:', error);
    const message = error?.message && typeof error.message === 'string'
      ? error.message
      : 'Failed to generate campaign plan';
    return res.status(500).json({ error: message });
  }
}
