/**
 * Content Generation prompt builder.
 * System prompts for blueprint, master content, and platform variants.
 */

import { createHash } from 'crypto';
import type { ContentGenerationPromptContext } from './promptTypes';
import { compilePrompt } from './promptCompiler';

export const CONTENT_GENERATION_PROMPT_VERSION = 1;

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

export function getContentBlueprintPromptWithFingerprint(): {
  content: string;
  template_name: string;
  template_version: string;
  template_hash: string;
} {
  const content = CONTENT_BLUEPRINT_SYSTEM;
  return {
    content,
    template_name: 'content_blueprint_v1',
    template_version: String(CONTENT_GENERATION_PROMPT_VERSION),
    template_hash: hashString(content),
  };
}

export const CONTENT_BLUEPRINT_SYSTEM = `Generate a content blueprint from the given context. Output strict JSON only: { "hook": string, "key_points": string[], "cta": string }. Hook: 1-2 punchy opening sentences. Key points: 2-4 bullet points. CTA: single closing call-to-action. Max 180 words total across all fields.`;

export const CONTENT_MASTER_SYSTEM = `Write publish-ready universal master content from the provided JSON context. Keep it neutral and non-platform-specific. Maintain weekly narrative intent. Output plain text only. Max 180 words.`;

export const PLATFORM_VARIANTS_SYSTEM = `Rewrite the given content for each platform. Output strict JSON only. Keys match platform_config[].key. Each value is adapted plain-text content. No markdown. Max 120 words per variant. Keys must match platform_config[].key exactly.`;

function buildContentGenerationContextBlock(context: ContentGenerationPromptContext): string {
  const parts = [
    `Campaign topic: ${context.topic}`,
    `Tone: ${context.tone}`,
    `Key themes: ${context.themes.length ? context.themes.join(', ') : '(derive from topic)'}`,
    `Top platforms: ${context.top_platforms.length ? context.top_platforms.join(', ') : 'linkedin, x'}`,
    `Top content types: ${context.top_content_types.length ? context.top_content_types.join(', ') : 'post, video'}`,
  ];
  if (context.objective) parts.push(`Objective: ${context.objective}`);
  if (context.platform) parts.push(`Target platform: ${context.platform}`);
  if (context.content_type) parts.push(`Content type: ${context.content_type}`);
  return parts.join('\n');
}

export function buildContentGenerationPrompt(context: ContentGenerationPromptContext): string {
  return compilePrompt({
    system: 'You are an expert content writer for marketing campaigns.',
    context: buildContentGenerationContextBlock(context),
    task: 'Generate content aligned with the campaign context above.',
  });
}
