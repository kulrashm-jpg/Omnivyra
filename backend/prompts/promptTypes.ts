/**
 * Shared prompt types for the Omnivyra AI Pipeline.
 * Prompts use only CampaignContext (compressed); never raw analytics or strategy objects.
 */

import type { CampaignContext } from '../services/contextCompressionService';

export type { CampaignContext };

/** Builds a prompt string from context. Uses only CampaignContext fields. */
export type PromptBuilder<T = CampaignContext> = (context: T) => string;

/** Extended context for daily distribution (CampaignContext + week-specific operational data). */
export type DailyDistributionPromptContext = CampaignContext & {
  weekly_topics: string[];
  week_number: number;
  theme: string;
  content_types_available: string[];
  target_region: string;
  campaign_mode: string;
  campaign_name?: string;
  campaign_start_date?: string | null;
  minimum_slots: number;
  exact_slots?: number;
  eligible_platforms?: string[];
  distribution_instruction: string;
  content_type_ratios?: Record<string, { min: number; max: number }>;
};

/** Extended context for content generation (CampaignContext + item-specific data). */
export type ContentGenerationPromptContext = CampaignContext & {
  topic?: string;
  objective?: string;
  tone?: string;
  platform?: string;
  content_type?: string;
};

/** Metadata for versioning, configuration, and logging. */
export type PromptMetadata = {
  name: string;
  version: number;
  temperature?: number;
  max_tokens?: number;
};

/** Registry entry: builder + metadata. */
export type PromptRegistryEntry<T> = {
  build: PromptBuilder<T>;
  metadata: PromptMetadata;
};

/** Registry mapping prompt names to entries with builders and metadata. */
export type PromptRegistry = {
  strategic_themes: PromptRegistryEntry<CampaignContext>;
  weekly_plan: PromptRegistryEntry<CampaignContext>;
  daily_distribution: PromptRegistryEntry<DailyDistributionPromptContext>;
  content_generation: PromptRegistryEntry<ContentGenerationPromptContext>;
};
