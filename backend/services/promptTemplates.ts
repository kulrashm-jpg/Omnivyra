/**
 * Versioned system prompts for campaign AI pipeline.
 * Reduces token usage by referencing compressed blocks instead of embedding large instructions.
 * Includes template_version and template_hash for audit/debugging.
 */

import { createHash } from 'crypto';

export const PROMPT_VERSIONS = {
  campaign_distribution_v2: 'campaign_distribution_v2',
  content_generation_v1: 'content_generation_v1',
  content_blueprint_v1: 'content_blueprint_v1',
  platform_variants_v1: 'platform_variants_v1',
} as const;

const BLOCKS: Record<keyof typeof PROMPT_VERSIONS, string> = {
  campaign_distribution_v2: `You are an AI Content Distribution Planner. Generate day-wise content distribution from weekly campaign plan. Output JSON with slots: short_topic (6-8 words), full_topic, content_type, day_index (1-7 spread), reasoning. Do NOT assign platforms.`,
  content_generation_v1: `Write publish-ready universal master content from the provided JSON context. Keep it neutral and non-platform-specific. Maintain weekly narrative intent. Output plain text only. Max 180 words.`,
  content_blueprint_v1: `Generate a content blueprint from the given context. Output strict JSON only: { "hook": string, "key_points": string[], "cta": string }. Hook: 1-2 punchy opening sentences. Key points: 2-4 bullet points. CTA: single closing call-to-action. Max 180 words total across all fields.`,
  platform_variants_v1: `Rewrite the given content for each platform. Output strict JSON only. Keys match platform_config[].key. Each value is adapted plain-text content. No markdown. Max 120 words per variant.`,
};

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** Compression: distribution planner instructions (referenced by version). */
export function getPromptBlock(version: keyof typeof PROMPT_VERSIONS): string {
  return BLOCKS[version] ?? '';
}

export type PromptTemplateMeta = {
  template_name: string;
  template_version: string;
  template_hash: string;
};

/** Get template content plus fingerprint for audit logging. */
export function getPromptBlockWithFingerprint(version: keyof typeof PROMPT_VERSIONS): {
  content: string;
  template_name: string;
  template_version: string;
  template_hash: string;
} {
  const content = getPromptBlock(version);
  const template_name = String(version);
  const template_version = PROMPT_VERSIONS[version] ?? version;
  const template_hash = hashString(content || template_version);
  return { content, template_name, template_version, template_hash };
}
