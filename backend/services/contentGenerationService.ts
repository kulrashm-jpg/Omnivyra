import { parseModelOutputOr } from './ai/safety';
import { CompanyProfile } from './companyProfileService';
import { detectContentOverlap } from './contentOverlapService';
import { refineLanguageOutput } from './languageRefinementService';
import { runCompletionWithOperation } from './aiGateway';
import { refineGeneratedText } from './editorialTextRefinementService';
import { config } from '@/config';
import { generationRuntime } from './content/runtime/generationRuntime';
import type { MasterContentPayload } from './contentGeneration/types';
// WS-1c-3b (PMO-ADR-09) — single source of truth for the day-content shape lives in
// the canonical "day_content" task profile; this family consumes it (one-directional
// import — the profile never imports this module, so there is no cycle).
import {
  dayContentSchema as contentSchema,
  dayContentPlatformTone as platformTone,
  type DayContent,
} from './content/runtime/taskProfiles/dayContentProfile';

/**
 * WS-1c-3b (PMO-ADR-09) — per-family cutover flag for the canonical GenerationRuntime
 * "day_content" profile. Default OFF ⇒ the inline legacy body runs unchanged
 * (byte-identical). ON ⇒ company grounding is sourced from the ONE canonical context
 * read via the profile; on ANY runtime miss/throw the call falls through to the
 * legacy inline body below. Reversible; scoped to this family.
 */
function isContentgenDayRuntimeDelegationEnabled(): boolean {
  return /^(1|true|on|yes)$/.test(
    String(process.env.CONTENTGEN_DAY_RUNTIME_DELEGATION_ENABLED ?? '').trim().toLowerCase(),
  );
}

/**
 * Shared post-parse finalization for day content: campaign-memory overlap detection
 * (with fresh-angle regeneration) + language + editorial refinement. Called by BOTH
 * the legacy inline path and the runtime-delegated path so the two differ ONLY in how
 * the raw structured object is produced (bespoke profile-JSON prompt vs canonical
 * context) — downstream shaping is identical. Extraction is behavior-preserving: the
 * legacy flag-OFF path runs exactly these steps in exactly this order, as before.
 */
async function finalizeDayContent(
  parsedInput: DayContent,
  input: {
    companyProfile: CompanyProfile;
    platform: string;
    campaignMemory?: {
      pastThemes: string[];
      pastTopics: string[];
      pastHooks: string[];
      pastTrendsUsed: string[];
      pastPlatforms: string[];
      pastContentSummaries: string[];
    };
  },
  tone: string,
): Promise<DayContent> {
  let parsed = parsedInput;
  if (input.campaignMemory) {
    const overlap = await detectContentOverlap({
      companyId: input.companyProfile.company_id,
      newProposedContent: [parsed.headline, parsed.hook, parsed.caption].filter(Boolean) as string[],
      campaignMemory: input.campaignMemory,
    });
    if (overlap.similarityScore > 0.8) {
      console.log('CONTENT OVERLAP DETECTED', overlap);
      return regenerateContent({
        existingContent: parsed,
        instruction: 'Create a fresh angle not used in previous campaigns.',
        platform: input.platform,
        companyId: input.companyProfile.company_id,
      });
    }
  }
  const keysToRefine = ['headline', 'caption', 'hook', 'callToAction', 'reasoning', 'script', 'blogDraft'] as const;
  const toRefine = keysToRefine.filter((k) => parsed[k]?.trim());
  if (toRefine.length > 0) {
    const r = await refineLanguageOutput({
      content: toRefine.map((k) => parsed[k] as string),
      card_type: 'platform_variant',
      platform: input.platform,
    });
    const refined = Array.isArray(r.refined) ? r.refined : [r.refined];
    toRefine.forEach((k, i) => {
      parsed = { ...parsed, [k]: refined[i] || parsed[k] };
    });
  }
  parsed = {
    ...parsed,
    headline: refineGeneratedText(parsed.headline, { kind: 'headline' }),
    caption: refineGeneratedText(parsed.caption, { kind: 'body' }),
    hook: refineGeneratedText(parsed.hook, { kind: 'body' }),
    callToAction: refineGeneratedText(parsed.callToAction, { kind: 'body' }),
    reasoning: refineGeneratedText(parsed.reasoning, { kind: 'body' }),
    script: parsed.script ? refineGeneratedText(parsed.script, { kind: 'body' }) : parsed.script,
    blogDraft: parsed.blogDraft ? refineGeneratedText(parsed.blogDraft, { kind: 'body' }) : parsed.blogDraft,
  };
  return {
    ...parsed,
    tone: parsed.tone || tone,
  };
}

export async function generateContentForDay(input: {
  companyProfile: CompanyProfile;
  campaign: any;
  weekPlan: any;
  dayPlan: any;
  trend?: string | null;
  platform: string;
  /** Forced context block (when profile.forced_context_fields is set). Must be respected. */
  forcedContext?: string | null;
  campaignMemory?: {
    pastThemes: string[];
    pastTopics: string[];
    pastHooks: string[];
    pastTrendsUsed: string[];
    pastPlatforms: string[];
    pastContentSummaries: string[];
  };
}): Promise<DayContent> {
  const tone = platformTone(input.platform);

  // ── WS-1c-3b — CANONICAL RUNTIME DELEGATION (FLAG-GATED, default OFF, FALL-BACK-SAFE).
  // Route the CORE generation (context → prompt → gateway → parse) through the ONE
  // runtime's "day_content" profile, which grounds the model in the ONE canonical
  // context read instead of an embedded `JSON.stringify(companyProfile)`. The output
  // DIFFERS from legacy by design (quality-gated, PMO-ADR-09) — but the same
  // downstream shaping (finalizeDayContent) runs on it. On flag-OFF or ANY runtime
  // miss/throw, control falls through to the inline legacy body below (unchanged), so
  // enabling the flag can NEVER break generation. Persistence is unchanged: the
  // profile path is persistence-free and this function still returns the object for
  // the caller (generate-day API route) to persist — no double-persist.
  if (isContentgenDayRuntimeDelegationEnabled()) {
    try {
      const out = await generationRuntime.generate({
        companyId: input.companyProfile?.company_id ?? '',
        contentType: 'post',
        topic: '',
        platform: input.platform,
        taskProfile: 'day_content',
        taskProfileInput: {
          platform: input.platform,
          forcedContext: input.forcedContext ?? null,
          trend: input.trend ?? null,
          campaign: input.campaign,
          weekPlan: input.weekPlan,
          dayPlan: input.dayPlan,
        },
      });
      const master = out.master as (MasterContentPayload & Partial<DayContent>) | DayContent | undefined;
      // The day_content profile places the parsed structured object on `master`.
      if (master && typeof (master as DayContent).headline === 'string') {
        return await finalizeDayContent(master as DayContent, input, tone);
      }
      console.warn('[contentGenerationService] day_content runtime returned no usable object; falling back to inline path');
    } catch (err) {
      console.error('[contentGenerationService] day_content runtime delegation failed; falling back to inline path', err);
    }
  }

  const systemPrompt =
    'You are a content generation engine. Return JSON only. No prose.';
  const userPrompt = `
Generate platform-specific content based on the inputs below.
Rules:
- Respect brand_voice and target_audience.
- Align with content theme and campaign objective.
- Use trend only if relevant.
- Follow platform style.
- Return JSON with fields: headline, caption, hook, callToAction, hashtags, script?, blogDraft?, tone, trendUsed?, reasoning.

Company Profile:
${JSON.stringify(input.companyProfile, null, 2)}
${input.forcedContext ? `\n${input.forcedContext}\n` : ''}

Campaign:
${JSON.stringify(input.campaign, null, 2)}

Week Plan:
${JSON.stringify(input.weekPlan, null, 2)}

Day Plan:
${JSON.stringify(input.dayPlan, null, 2)}

Platform:
${input.platform}

Trend:
${input.trend ?? 'none'}

Platform Style:
${tone}
`;

  const result = await runCompletionWithOperation({
    companyId: input.companyProfile?.company_id ?? null,
    campaignId: null,
    model: config.OPENAI_RESPONSES_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'generateContentForDay',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = result.output?.trim() ?? '{}';
  const parsed = contentSchema.parse(parseModelOutputOr<any>(raw, {}, { surface: 'contentGenerationService' }));
  // Shared downstream shaping (overlap + refinement + tone fallback) — identical for
  // the legacy and runtime-delegated paths.
  return finalizeDayContent(parsed, input, tone);
}

export async function regenerateContent(input: {
  existingContent: any;
  instruction: string;
  platform: string;
  companyId?: string | null;
  campaignId?: string | null;
}): Promise<DayContent> {
  const systemPrompt =
    'You are a content regeneration engine. Return JSON only. No prose.';
  const userPrompt = `
Update the content below using the instruction. Return JSON with fields: headline, caption, hook, callToAction, hashtags, script?, blogDraft?, tone, trendUsed?, reasoning.
Instruction:
${input.instruction}

Platform:
${input.platform}

Existing Content:
${JSON.stringify(input.existingContent, null, 2)}
`;

  const result = await runCompletionWithOperation({
    companyId: input.companyId ?? null,
    campaignId: input.campaignId ?? null,
    model: config.OPENAI_RESPONSES_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'regenerateContent',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = result.output?.trim() ?? '{}';
  let parsed = contentSchema.parse(parseModelOutputOr<any>(raw, {}, { surface: 'contentGenerationService' }));
  const keysToRefine = ['headline', 'caption', 'hook', 'callToAction', 'reasoning', 'script', 'blogDraft'] as const;
  const toRefine = keysToRefine.filter((k) => parsed[k]?.trim());
  if (toRefine.length > 0) {
    const r = await refineLanguageOutput({
      content: toRefine.map((k) => parsed[k] as string),
      card_type: 'platform_variant',
      platform: input.platform,
    });
    const refined = Array.isArray(r.refined) ? r.refined : [r.refined];
    toRefine.forEach((k, i) => {
      parsed = { ...parsed, [k]: refined[i] || parsed[k] };
    });
  }
  parsed = {
    ...parsed,
    headline: refineGeneratedText(parsed.headline, { kind: 'headline' }),
    caption: refineGeneratedText(parsed.caption, { kind: 'body' }),
    hook: refineGeneratedText(parsed.hook, { kind: 'body' }),
    callToAction: refineGeneratedText(parsed.callToAction, { kind: 'body' }),
    reasoning: refineGeneratedText(parsed.reasoning, { kind: 'body' }),
    script: parsed.script ? refineGeneratedText(parsed.script, { kind: 'body' }) : parsed.script,
    blogDraft: parsed.blogDraft ? refineGeneratedText(parsed.blogDraft, { kind: 'body' }) : parsed.blogDraft,
  };
  return parsed;
}
