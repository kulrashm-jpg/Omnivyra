/**
 * Strategic Themes prompt builder.
 * Used when LLM generates strategic themes from topic/signals.
 */

import type { CampaignContext } from '../services/contextCompressionService';
import { compilePrompt, buildCampaignContextBlock } from './promptCompiler';

export const STRATEGIC_THEMES_PROMPT_VERSION = 1;

export function buildStrategicThemesPrompt(context: CampaignContext): string {
  return compilePrompt({
    system: 'You are an expert marketing strategist generating strategic content themes.',
    context: buildCampaignContextBlock(context),
    task: 'Generate concise strategic theme titles (6-12 words each) that support the campaign topic. Output theme titles only, one per line.',
  });
}
