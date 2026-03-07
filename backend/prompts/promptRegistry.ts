/**
 * Centralized prompt registry for Omnivyra AI pipeline.
 * Maps prompt names to entries with builders and metadata. Use only CampaignContext (compressed).
 */

import { generatePromptFingerprint } from '../utils/promptFingerprint';
import type { PromptMetadata, PromptRegistry } from './promptTypes';
import { buildStrategicThemesPrompt, STRATEGIC_THEMES_PROMPT_VERSION } from './strategicThemes.prompt';
import { buildWeeklyPlanPrompt, WEEKLY_PLAN_PROMPT_VERSION } from './weeklyPlan.prompt';
import { buildDailyDistributionPrompt, DAILY_DISTRIBUTION_PROMPT_VERSION } from './dailyDistribution.prompt';
import { buildContentGenerationPrompt, CONTENT_GENERATION_PROMPT_VERSION } from './contentGeneration.prompt';

function createPromptEntry<T>(
  build: (ctx: T) => string,
  metadata: PromptMetadata
): { build: (ctx: T) => string; metadata: PromptMetadata } {
  const wrappedBuild = (ctx: T) => {
    const prompt = build(ctx);
    const fingerprint = generatePromptFingerprint(prompt);
    if (process.env.DEBUG_PROMPTS === 'true') {
      console.debug('[PROMPT DEBUG]', {
        prompt: metadata.name,
        version: metadata.version,
        fingerprint,
        content: prompt,
      });
    }
    return prompt;
  };
  return { build: wrappedBuild, metadata };
}

export const PROMPT_REGISTRY: PromptRegistry = {
  strategic_themes: createPromptEntry(buildStrategicThemesPrompt, {
    name: 'strategic_themes',
    version: STRATEGIC_THEMES_PROMPT_VERSION,
    temperature: 0.4,
    max_tokens: 1024,
  }),
  weekly_plan: createPromptEntry(buildWeeklyPlanPrompt, {
    name: 'weekly_plan',
    version: WEEKLY_PLAN_PROMPT_VERSION,
    temperature: 0.3,
    max_tokens: 4096,
  }),
  daily_distribution: createPromptEntry(buildDailyDistributionPrompt, {
    name: 'daily_distribution',
    version: DAILY_DISTRIBUTION_PROMPT_VERSION,
    temperature: 0.2,
    max_tokens: 2048,
  }),
  content_generation: createPromptEntry(buildContentGenerationPrompt, {
    name: 'content_generation',
    version: CONTENT_GENERATION_PROMPT_VERSION,
    temperature: 0.6,
    max_tokens: 1024,
  }),
};
