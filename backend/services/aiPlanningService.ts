/**
 * AI Planning Service
 * Single entry point for campaign plan AI generation.
 * Uses campaignPromptBuilder for prompts; does not construct prompts directly.
 */

import { generateCampaignPlan, type LlmPoolName } from './aiGateway';
import { buildCampaignPlanningPrompt } from './campaignPromptBuilder';
import type { PlanningGenerationInput } from '../types/campaignPlanning';

/**
 * Build planning prompt, call AI model, return rawOutput.
 * Single AI planning entry point for preview and persisted pipelines.
 * Prompts are built via buildCampaignPlanningPrompt.
 * Accepts only PlanningGenerationInput.
 */
export async function generateCampaignPlanAI(
  input: PlanningGenerationInput,
  options: {
    signal?: AbortSignal;
    pool?: LlmPoolName;
    stream?: boolean;
    onChunk?: (delta: string, accumulated: string) => void;
    /** Activity-consumption correlation: the campaign this plan belongs to. */
    campaignId?: string | null;
  } = {},
): Promise<{ rawOutput: string }> {
  Object.freeze(input);
  const messages = await buildCampaignPlanningPrompt(input);

  const completion = await generateCampaignPlan({
    companyId: input.companyId,
    campaignId: options.campaignId ?? null,
    referenceType: options.campaignId ? 'campaign_plan' : null,
    referenceId: options.campaignId ?? null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    messages,
    signal: options.signal,
    pool: options.pool,
    stream: options.stream,
    onChunk: options.onChunk,
  });
  const raw = completion.output?.trim() || '';
  return { rawOutput: raw };
}
