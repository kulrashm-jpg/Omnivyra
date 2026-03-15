/**
 * AI Planning Service
 * Single entry point for campaign plan AI generation.
 * Uses campaignPromptBuilder for prompts; does not construct prompts directly.
 */

import { generateCampaignPlan } from './aiGateway';
import { buildCampaignPlanningPrompt } from './campaignPromptBuilder';
import type { PlanningGenerationInput } from '../types/campaignPlanning';

/**
 * Build planning prompt, call AI model, return rawOutput.
 * Single AI planning entry point for preview and persisted pipelines.
 * Prompts are built via buildCampaignPlanningPrompt.
 * Accepts only PlanningGenerationInput.
 */
export async function generateCampaignPlanAI(input: PlanningGenerationInput): Promise<{ rawOutput: string }> {
  Object.freeze(input);
  const messages = await buildCampaignPlanningPrompt(input);

  const completion = await generateCampaignPlan({
    companyId: input.companyId,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    messages,
  });
  const raw = completion.output?.trim() || '';
  return { rawOutput: raw };
}
