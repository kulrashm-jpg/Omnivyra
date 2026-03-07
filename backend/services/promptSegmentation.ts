/**
 * Phase 8 — Prompt Segmentation
 *
 * Named blocks for large prompts. Each block has its own fingerprint
 * and can be cached independently.
 */

import { getOrBuildPromptBlock } from './promptContextCache';

export const PROMPT_BLOCK_NAMES = {
  company_profile_context: 'company_profile_context',
  strategic_theme_context: 'strategic_theme_context',
  weekly_plan_context: 'weekly_plan_context',
  signal_context: 'signal_context',
  distribution_insight_context: 'distribution_insight_context',
  execution_config_context: 'execution_config_context',
  forced_context: 'forced_context',
} as const;

export type PromptBlockName = (typeof PROMPT_BLOCK_NAMES)[keyof typeof PROMPT_BLOCK_NAMES];

/**
 * Get or build a prompt block with cache lookup.
 * Returns the content (from cache or fresh) and metadata.
 */
export function getSegmentWithCache(
  blockName: PromptBlockName,
  content: string
): { content: string; fingerprint: string; cacheHit: boolean } {
  return getOrBuildPromptBlock(blockName, content);
}
