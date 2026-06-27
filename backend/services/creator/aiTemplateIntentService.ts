/**
 * AI Template Intent Service — turns a natural-language prompt into a validated
 * Template INTENT (never a CreatorTemplate). Grounds the request in company +
 * brand context, asks the LLM to emit ONLY the constrained intent JSON, then
 * normalises/validates it. If the LLM is unavailable or returns anything
 * unusable, it falls back to the deterministic keyword deriver — so the feature
 * works without live AI and never produces an invalid intent.
 */

import type { TemplateAssetFamily } from '../../../lib/creator-templates';
import {
  type TemplateIntent,
  validateTemplateIntent,
  deriveIntentFromPrompt,
  ASSET_FAMILIES,
  VISUAL_STYLES,
  DENSITIES,
  TYPOGRAPHY_PREFS,
  EMPHASES,
  DECORATIONS,
  IMAGE_TREATMENTS,
  AI_CAPABILITIES,
} from '../../../lib/creator-templates/aiTemplateIntent';

export interface GenerateIntentResult {
  intent: TemplateIntent;
  source: 'ai' | 'fallback';
}

function buildSystemPrompt(): string {
  return [
    'You design social-media CREATOR TEMPLATES. You output ONLY a Template Intent as JSON — design preferences, never rendering instructions, never a template object.',
    'Respond with a single JSON object using EXACTLY these keys and only values from the allowed vocabulary:',
    `- assetFamily: one of ${ASSET_FAMILIES.join(' | ')}`,
    `- visualStyle: one of ${VISUAL_STYLES.join(' | ')}`,
    `- density: one of ${DENSITIES.join(' | ')}`,
    `- typographyPreference: one of ${TYPOGRAPHY_PREFS.join(' | ')}`,
    `- emphasis: one of ${EMPHASES.join(' | ')}`,
    `- decorationPreference: one of ${DECORATIONS.join(' | ')}`,
    `- imageTreatment: one of ${IMAGE_TREATMENTS.join(' | ')} (image family only)`,
    '- name: short template name (string)',
    '- description: one sentence (string)',
    '- category: short category label (string)',
    '- recommendedFields: string[] (e.g. headline, subheadline, cta, title, body, metric, description)',
    '- useCases: string[]',
    '- aspectPreferences: string[] (e.g. "1:1", "4:5", "16:9")',
    `- aiCapabilities: subset of ${AI_CAPABILITIES.join(' | ')}`,
    '- accent: optional hex color like "#2563eb"',
    'Do NOT include rendering contracts, writer asset types, attachment modes, layouts, or any rendering primitive.',
  ].join('\n');
}

function buildUserPrompt(prompt: string, example: TemplateIntent, context: { company?: unknown; brand?: unknown }): string {
  return [
    `User request: ${prompt}`,
    context.company ? `Company context: ${JSON.stringify(context.company).slice(0, 1200)}` : '',
    context.brand ? `Brand voice: ${JSON.stringify(context.brand).slice(0, 800)}` : '',
    'A deterministic starting point (improve on it, keep the same shape and vocabulary):',
    JSON.stringify(example),
    'Return ONLY the JSON intent.',
  ].filter(Boolean).join('\n\n');
}

/**
 * Generate a validated Template Intent. Always returns a usable intent (AI when
 * available + valid, otherwise the deterministic fallback).
 */
export async function generateTemplateIntent(input: { prompt: string; companyId: string; family?: TemplateAssetFamily | null }): Promise<GenerateIntentResult> {
  const prompt = (input.prompt || '').trim();
  const fallbackIntent = deriveIntentFromPrompt(prompt, input.family ?? null);
  if (!prompt) return { intent: fallbackIntent, source: 'fallback' };

  // Ground in company + brand context (best-effort; never blocks).
  let company: unknown;
  let brand: unknown;
  try {
    const { resolveCreatorCopyContext } = await import('./creatorCopyContextResolver');
    const ctx = await resolveCreatorCopyContext(input.companyId);
    company = ctx.company;
    brand = ctx.brandVoice;
  } catch { /* best-effort */ }

  try {
    const { config } = await import('@/config');
    const { runCompletionWithOperation } = await import('../aiGateway');
    const resp = await runCompletionWithOperation({
      operation: 'creator_template_intent',
      companyId: input.companyId,
      model: (config as Record<string, unknown>).OPENAI_MODEL as string || 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      max_tokens: 700,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(prompt, fallbackIntent, { company, brand }) },
      ],
    });
    const raw = JSON.parse(resp.output) as unknown;
    // Honor an explicit family hint over whatever the model picked.
    if (input.family && raw && typeof raw === 'object') (raw as Record<string, unknown>).assetFamily = input.family;
    const validated = validateTemplateIntent(raw);
    if (validated.ok) return { intent: validated.intent, source: 'ai' };
  } catch (error) {
    console.warn('[ai-template-intent][fallback]', { message: error instanceof Error ? error.message : String(error) });
  }
  return { intent: fallbackIntent, source: 'fallback' };
}
