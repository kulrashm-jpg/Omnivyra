/**
 * WS-1c-3b (PMO-ADR-09) — FAMILY #9 "day_content" TASK PROFILE.
 *
 * Converges `contentGenerationService.generateContentForDay` (the 10-field
 * STRUCTURED day-content object) onto the ONE runtime. The DIFFERENCE from legacy
 * (accepted, quality-gated): company grounding now comes from the ONE canonical
 * context read (`resolveContentContext` → `norm.contextBlock`/identity/business
 * context) instead of embedding the full `JSON.stringify(companyProfile)`. The
 * per-request PLANNING inputs (campaign / week / day / trend / forced context /
 * platform style) are unchanged — they are not company context and continue to
 * flow verbatim from `req.taskProfileInput`.
 *
 * SHAPE + POLICY are faithful to legacy: same 10-field schema, same gateway
 * operation `generateContentForDay`, same temperature 0, same json_object mode.
 * Downstream refinement (overlap detection + language/editorial refinement) is NOT
 * this profile's concern — it stays in the family and runs identically on both the
 * legacy and delegated outputs (see contentGenerationService.finalizeDayContent).
 *
 * SELF-CONTAINED — imports NO runtime from contentGenerationService (that module
 * imports this one), so there is no cycle: the schema is defined here and consumed
 * there.
 */

import { z } from 'zod';
import { parseModelOutputOr } from '../../../ai/safety';
import { config } from '@/config';
import type { NormalizedContentContext } from '../../../context/canonicalContentContextResolver';
import type { TaskProfile, TaskProfileContext } from './types';

/** The canonical day-content output schema (single source of truth). */
export const dayContentSchema = z.object({
  headline: z.string(),
  caption: z.string(),
  hook: z.string(),
  callToAction: z.string(),
  hashtags: z.array(z.string()),
  script: z.string().optional(),
  blogDraft: z.string().optional(),
  tone: z.string(),
  trendUsed: z.string().optional(),
  reasoning: z.string(),
});

export type DayContent = z.infer<typeof dayContentSchema>;

/** Platform → tone descriptor. Verbatim from the legacy `platformTone`. */
export function dayContentPlatformTone(platform: string): string {
  const lower = String(platform || '').toLowerCase();
  if (lower.includes('linkedin')) return 'professional';
  if (lower.includes('instagram')) return 'emotional';
  if (lower.includes('x') || lower.includes('twitter')) return 'concise';
  if (lower.includes('youtube')) return 'scripted';
  if (lower.includes('blog')) return 'structured';
  if (lower.includes('tiktok')) return 'playful';
  return 'clear';
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Compose the company-grounding block from the ONE canonical context — REPLACES
 * the legacy `JSON.stringify(companyProfile, null, 2)` dump. Uses the same context
 * block every canonical generation prompt uses (buildContextBlock) plus brand /
 * business-context primitives, so the model is grounded in the same identity the
 * rest of the runtime is.
 */
function buildCompanyGroundingBlock(norm: NormalizedContentContext): string {
  const lines: string[] = [];
  if (norm.brand) lines.push(`Company: ${norm.brand}`);
  if (norm.businessContext) lines.push(`Business context: ${norm.businessContext}`);
  if (norm.audience) lines.push(`Target audience: ${norm.audience}`);
  if (norm.tone) lines.push(`Brand voice: ${norm.tone}`);
  const block = str(norm.contextBlock);
  if (block) lines.push(block);
  return lines.join('\n');
}

export const dayContentProfile: TaskProfile<DayContent> = {
  key: 'day_content',
  // The platforms family #9 serves (informational; runtime selects on `key`).
  contentTypes: ['linkedin', 'instagram', 'x', 'youtube', 'blog', 'tiktok'],

  policy(): ReturnType<TaskProfile['policy']> {
    return {
      // Faithful to legacy generateContentForDay.
      model: config.OPENAI_RESPONSES_MODEL || 'gpt-4o-mini',
      temperature: 0,
      operation: 'generateContentForDay',
      responseFormat: { type: 'json_object' },
    };
  },

  buildMessages(ctx: TaskProfileContext) {
    const input = ctx.input;
    const platform = str(input.platform) || str(ctx.req.platform) || 'linkedin';
    const tone = dayContentPlatformTone(platform);
    const forcedContext = str(input.forcedContext);
    const trend = str(input.trend);
    const grounding = buildCompanyGroundingBlock(ctx.norm);

    const system = 'You are a content generation engine. Return JSON only. No prose.';
    const user = `
Generate platform-specific content based on the inputs below.
Rules:
- Respect brand_voice and target_audience.
- Align with content theme and campaign objective.
- Use trend only if relevant.
- Follow platform style.
- Return JSON with fields: headline, caption, hook, callToAction, hashtags, script?, blogDraft?, tone, trendUsed?, reasoning.

Company Context:
${grounding}
${forcedContext ? `\n${forcedContext}\n` : ''}

Campaign:
${JSON.stringify(input.campaign ?? null, null, 2)}

Week Plan:
${JSON.stringify(input.weekPlan ?? null, null, 2)}

Day Plan:
${JSON.stringify(input.dayPlan ?? null, null, 2)}

Platform:
${platform}

Trend:
${trend || 'none'}

Platform Style:
${tone}
`;
    return { system, user };
  },

  parse(raw: string, ctx: TaskProfileContext): DayContent {
    const trimmed = str(raw) || '{}';
    const parsed = dayContentSchema.parse(
      parseModelOutputOr<Record<string, unknown>>(trimmed, {}, { surface: 'dayContentProfile' }),
    );
    // Preserve the legacy tone fallback so the profile output matches the family's
    // contract even before downstream refinement runs.
    const platform = str(ctx.input.platform) || str(ctx.req.platform) || 'linkedin';
    return { ...parsed, tone: parsed.tone || dayContentPlatformTone(platform) };
  },
};
