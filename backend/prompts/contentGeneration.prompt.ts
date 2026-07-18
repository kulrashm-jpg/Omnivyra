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

// WAVE3 (item 10): the unused `CONTENT_MASTER_SYSTEM` const was removed here.
// grep confirmed zero consumers — it was only re-exported by backend/prompts/index.ts
// (that barrel line was also removed) and never imported anywhere. The distinct
// CONTENT_MASTER_SYSTEM in contentGenerationPromptsV3.ts is unaffected.

export const PLATFORM_VARIANTS_SYSTEM = `Rewrite the given content for each platform. Output strict JSON only. Keys match platform_config[].key exactly. Each value is adapted plain-text content. No markdown.

LENGTH & COMPLETENESS (critical — the output is published as-is and MUST NOT be cut off):
- Each variant MUST fit within that platform_config entry's "max_chars" budget when provided. Count characters; never exceed it.
- Write a COMPLETE, self-contained piece that ends on a full sentence with proper punctuation. Never stop mid-sentence, never trail off, never end with "..." or an ellipsis.
- If the message will not fit, TIGHTEN and rephrase so the whole thought fits — do NOT cut it off. Fewer complete sentences beat one longer truncated sentence.
- When no max_chars is given, keep it concise (about 120 words) but always a complete, well-formed piece.`;

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
