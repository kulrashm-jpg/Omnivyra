import { runCompletionWithOperation } from '../aiGateway';
import { validatePlatformVariants } from '../aiOutputValidationService';
import { getMediaIntentDescriptor } from '../mediaIntentDescriptorRules';
import { processContent } from '../unifiedContentProcessor';
import { PLATFORM_VARIANTS_SYSTEM, CONTENT_GENERATION_PROMPT_VERSION } from '../../prompts';
import type { ContentBlueprint } from '../contentBlueprintCache';
import { nonEmpty, asObject, sanitizeIdPart, toPositiveNumber } from './contentTypeHelpers';
import { isMediaDependentContentType, resolvePlatformTargets, resolveMediaStatus, buildExecutionReadiness, buildExecutionJobsFromItem } from './executionHelpers';
import { optimizeDiscoverabilityForPlatform, buildMediaSearchIntent, normalizeLegacyMediaSearchIntent } from './discoverabilityHelpers';
import { getProfile } from '../companyProfileService';
import { extractCompanyIdentity, buildCompanyContextBlockShort, buildIdentityLock, buildAntiGenericRules, type CompanyIdentity } from '../../../lib/content/companyContextBlock';
import { resolveBrandVoice } from '../brand/resolveBrandVoice';
import { registerBrandCacheInvalidator } from '../brand/brandCacheRegistry';
// Creator System-Prompt Governance Integration. Final Closure Pass —
// Phase 3 (rewriter consistency). Both the batch variant generator
// and the per-platform rewriter delegate to the SAME canonical
// preamble helper; no local re-implementation.
import {
  applyGovernancePreambleToSystemPrompt as applyGovernanceToSystemPrompt,
  type GovernancePromptContext,
} from '../creator/strategyGovernancePromptContext';

// ── Company context cache for variant generation ─────────────────────────────
const _variantContextCache = new Map<string, { block: string; identity: CompanyIdentity; at: number }>();

/** Phase 3C — this cache bakes the resolved brand voice (line 34) into the
 *  context block, so a brand publish must clear it in-process. Registered with
 *  the brand-cache registry; fired by invalidateBrandCaches. */
export function clearVariantContextCacheForCompany(companyId: string): void {
  _variantContextCache.delete(companyId);
}
registerBrandCacheInvalidator(clearVariantContextCacheForCompany);

/** @internal test-only seams for cache-coherence tests. */
export function __variantCacheHasForTest(companyId: string): boolean {
  return _variantContextCache.has(companyId);
}
export function __variantCacheSeedForTest(companyId: string): void {
  _variantContextCache.set(companyId, { block: '', identity: {}, at: Date.now() });
}

async function resolveCompanyContextBlock(companyId: string | null | undefined): Promise<{ block: string; identity: CompanyIdentity }> {
  if (!companyId) return { block: '', identity: {} };
  const cached = _variantContextCache.get(companyId);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return { block: cached.block, identity: cached.identity };
  try {
    const profile = await getProfile(companyId, { autoRefine: false });
    const identity = extractCompanyIdentity(profile);
    // Phase 2A — BrandRuntime is the authoritative brand-voice source; falls back
    // to the legacy company_profiles.brand_voice when no brand_identity row.
    identity.brandVoice = await resolveBrandVoice(companyId, identity.brandVoice);
    const block = buildCompanyContextBlockShort(identity);
    _variantContextCache.set(companyId, { block, identity, at: Date.now() });
    return { block, identity };
  } catch {
    return { block: '', identity: {} };
  }
}
import {
  blueprintToFullText,
  renderDeterministicVariant,
  canDeriveDeterministically,
  DETERMINISTIC_DERIVABLE,
  X_CHAR_LIMIT,
  buildVariantOnlyMasterFallback,
  isAiGeneratedMasterContent,
} from './variantRenderers';
import { generateContentBlueprint, isBlueprintQualitySufficient, generateMasterContentFromIntent } from './blueprintGenerator';
import type { MasterContentPayload, PlatformVariantPayload, DailyExecutionItemLike } from './types';

export type { DiscoverabilityMeta } from './variantRenderers';

/** Platform style hints for batch variant generation (structured). */
export const PLATFORM_STYLE_MAP: Record<string, string> = {
  linkedin: 'Professional tone, clear structure, slightly longer form with practical insight.',
  facebook: 'Conversational voice, engagement-focused flow, short paragraphs.',
  x: 'Concise and punchy style, high information density.',
  twitter: 'Concise and punchy style, high information density.',
  instagram: 'Emotionally resonant and visually descriptive tone, hashtag-friendly ending.',
  youtube: 'Output for YouTube in TWO parts separated by a blank line. FIRST LINE = a compelling, SEO-optimized video TITLE, keyword front-loaded, max 70 characters, no hashtags. Then a blank line, then the DESCRIPTION: a strong hook in the first 1-2 lines (shown above the fold), followed by the value/detail, a clear call-to-action, and finish with 3-5 relevant hashtags on the last line.',
};

/**
 * Generates platform variants in a single AI call. Returns map of "platform_contenttype" -> raw content.
 * Use when 2+ text-based targets to reduce token usage and latency.
 */
async function generatePlatformVariantsInOneCall(
  masterContentOrBlueprints: string | ContentBlueprint[],
  targets: Array<{ platform: string; content_type: string; max_length?: number; discoverabilityMeta?: import('./variantRenderers').DiscoverabilityMeta }>,
  context: {
    writer_content_brief?: Record<string, unknown>;
    intent?: Record<string, unknown>;
    company_id?: string | null;
    /** Creator System-Prompt Governance Integration. When present and
     *  the resolved industry is regulated, the system prompt is
     *  prepended with a non-negotiable compliance policy block. Null /
     *  industry='none' → strict no-op (byte-identical system prompt). */
    governance?: GovernancePromptContext | null;
  },
): Promise<Record<string, string> | Array<Record<string, string>>> {
  const isBatch = Array.isArray(masterContentOrBlueprints);
  const blueprints = isBatch ? (masterContentOrBlueprints as ContentBlueprint[]) : null;
  const masterContent = isBatch
    ? (blueprints as ContentBlueprint[]).map((bp) => blueprintToFullText(bp)).join('\n\n---\n\n')
    : (masterContentOrBlueprints as string);
  if (targets.length === 0) return isBatch ? [] : {};
  // Resolve company context for platform variant specificity
  const { block: companyBlock, identity: variantIdentity } = await resolveCompanyContextBlock(context.company_id);

  // Enhance system prompt with identity lock + anti-generic rules when company is known
  const hasVariantIdentity = !!(variantIdentity.companyName || variantIdentity.industry);
  const identityVariantSystemPrompt = hasVariantIdentity
    ? `${buildIdentityLock(variantIdentity, 'platform variant')}\n\n${PLATFORM_VARIANTS_SYSTEM}\n${buildAntiGenericRules(variantIdentity)}`
    : PLATFORM_VARIANTS_SYSTEM;
  const effectiveVariantSystemPrompt = applyGovernanceToSystemPrompt(
    identityVariantSystemPrompt,
    context.governance,
  );

  const platformConfig = targets.map((t) => ({
    key: `${t.platform}_${t.content_type}`,
    platform: t.platform,
    content_type: t.content_type,
    style: PLATFORM_STYLE_MAP[t.platform] ?? 'Neutral adaptation with clear readability.',
    max_chars: t.max_length ?? null,
    hashtags: t.discoverabilityMeta?.hashtags?.slice(0, 5) ?? [],
  }));
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  console.info('Prompt executed', { prompt: 'platform_variants', version: CONTENT_GENERATION_PROMPT_VERSION });
  const __corr = ((context as { correlation?: import('../../../lib/shared/observability/correlationRef').CorrelationRef })?.correlation) ?? null;
  const result = await runCompletionWithOperation({
    companyId: context.company_id ?? null,
    campaignId: (context as { campaign_id?: string | null })?.campaign_id ?? null,
    referenceType: __corr?.referenceType ?? null,
    referenceId: __corr?.referenceId ?? null,
    parentActivityId: __corr?.parentActivityId ?? null,
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'generatePlatformVariants',
    messages: [
      {
        role: 'system',
        content: effectiveVariantSystemPrompt,
      },
      {
        role: 'user',
        content: JSON.stringify(
          isBatch
            ? {
                batch_mode: true,
                content_pieces: (blueprints as ContentBlueprint[]).map((bp) => blueprintToFullText(bp)),
                platform_config: platformConfig,
                writer_brief: context.writer_content_brief ?? null,
                intent: context.intent ?? null,
                ...(companyBlock ? { company_context: companyBlock } : {}),
                output_format: 'Object with keys "0","1",... — each value is { "platform_contenttype": "content" } per platform_config keys.',
              }
            : {
                master_content: masterContent,
                platform_config: platformConfig,
                writer_brief: context.writer_content_brief ?? null,
                intent: context.intent ?? null,
                ...(companyBlock ? { company_context: companyBlock } : {}),
                output_format: Object.fromEntries(platformConfig.map((p) => [p.key, '<adapted content for this platform>'])),
              }
        ),
      },
    ],
  });
  const raw = typeof result?.output === 'string' ? result.output : '';
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(trimmed || '{}');
    if (isBatch) {
      const items: Record<string, string>[] = [];
      for (let i = 0; i < (blueprints?.length ?? 0); i++) {
        const key = String(i);
        items.push((parsed[key] && typeof parsed[key] === 'object') ? parsed[key] : {});
      }
      return items;
    }
    return (parsed as Record<string, string>) || {};
  } catch {
    return isBatch ? [] : {};
  }
}

/**
 * Renders platform variants from a content blueprint. Uses deterministic rules when possible:
 * LinkedIn → full text; X → truncate 280; Facebook → full; Instagram → append hashtags.
 * Uses AI only when deterministic transformation is insufficient (e.g. YouTube).
 */
export async function renderPlatformVariantsFromBlueprint(
  blueprint: ContentBlueprint,
  item: DailyExecutionItemLike
): Promise<PlatformVariantPayload[]> {
  const targets = resolvePlatformTargets(item);
  if (targets.length === 0) return [];

  const fullText = blueprintToFullText(blueprint);
  const masterPayload: MasterContentPayload = {
    id: `master-${sanitizeIdPart(item.execution_id || item.topic || 'item')}`,
    generated_at: new Date().toISOString(),
    content: fullText,
    generation_status: 'generated',
    generation_source: 'ai',
    content_type_mode: 'text',
  };

  const mediaTargets = targets.filter((t) => isMediaDependentContentType(t.content_type));
  const textTargets = targets.filter((t) => !isMediaDependentContentType(t.content_type));

  const built: PlatformVariantPayload[] = [];

  for (const target of mediaTargets) {
    const placeholder = await generatePlatformVariantFromMaster(masterPayload, target.platform, {
      content_type: target.content_type,
      max_length: target.max_length,
      generation_overrides: target.generation_overrides,
      writer_content_brief: asObject(item?.writer_content_brief) || undefined,
      intent: asObject(item?.intent) || undefined,
      discoverabilityMeta: undefined,
      existingMediaSearchIntent: undefined,
      governance: (item as any)?.governance ?? null,
    });
    built.push(placeholder);
  }

  const deterministicTargets = textTargets.filter((t) => canDeriveDeterministically(t.platform));
  const aiTargets = textTargets.filter((t) => !canDeriveDeterministically(t.platform));

  for (const target of deterministicTargets) {
    const discoverabilityMeta = await optimizeDiscoverabilityForPlatform(
      fullText,
      target.platform,
      target.content_type
    );
    const rawContent = renderDeterministicVariant(
      fullText,
      target.platform,
      target.platform === 'x' || target.platform === 'twitter' ? X_CHAR_LIMIT : target.max_length,
      discoverabilityMeta,
      blueprint.cta ? String(blueprint.cta).trim() : null
    );
    const rawBounded = target.max_length ? rawContent.slice(0, target.max_length) : rawContent;
    const processed = await processContent({
      content: rawBounded,
      platform: target.platform,
      content_type: target.content_type,
      card_type: 'platform_variant',
    });
    const bounded = target.max_length ? processed.content.slice(0, target.max_length) : processed.content;
    const mediaSearchIntent = buildMediaSearchIntent(
      target.platform,
      target.content_type,
      fullText,
      asObject(item?.intent) || null
    );
    built.push({
      platform: target.platform,
      content_type: target.content_type,
      generated_content: bounded,
      generation_status: 'generated',
      locked_variant: false,
      adapted_from_master: true,
      adaptation_style: 'platform_specific',
      requires_media: false,
      generation_overrides: target.generation_overrides,
      adaptation_trace: {
        platform: target.platform,
        style_strategy: 'deterministic',
        character_limit_used: target.platform === 'x' || target.platform === 'twitter' ? X_CHAR_LIMIT : target.max_length ?? null,
        target_length_used: null,
        actual_length_used: bounded.length,
        format_family: 'text',
        media_constraints_applied: false,
        adaptation_reason: `Deterministic: ${target.platform} from blueprint.`,
      },
      discoverability_meta: discoverabilityMeta,
      algorithmic_formatting_meta: processed.processing_trace.structural_formatting_applied
        ? { platform: target.platform, formatting_applied: true as const }
        : undefined,
      media_intent: getMediaIntentDescriptor(target.platform),
      media_search_intent: mediaSearchIntent,
    });
  }

  if (aiTargets.length > 0) {
    const discoverabilityMetas = await Promise.all(
      aiTargets.map((t) => optimizeDiscoverabilityForPlatform(fullText, t.platform, t.content_type))
    );
    const aiTargetsWithMeta = aiTargets.map((t, i) => ({ ...t, discoverabilityMeta: discoverabilityMetas[i] }));
    const batchRaw =
      aiTargets.length >= 2
        ? await generatePlatformVariantsInOneCall(fullText, aiTargetsWithMeta, {
            writer_content_brief: asObject(item?.writer_content_brief) || undefined,
            intent: asObject(item?.intent) || undefined,
            governance: (item as any)?.governance ?? null,
          })
        : null;

    for (let i = 0; i < aiTargets.length; i++) {
      const target = aiTargets[i]!;
      const discoverabilityMeta = discoverabilityMetas[i];
      const batchKey = `${target.platform}_${target.content_type}`;
      let rawContent: string | null =
        batchRaw && typeof batchRaw === 'object' && !Array.isArray(batchRaw)
          ? (batchRaw as Record<string, string>)[batchKey] ?? null
          : null;

      if (!rawContent && aiTargets.length === 1) {
        const single = await generatePlatformVariantFromMaster(masterPayload, target.platform, {
          content_type: target.content_type,
          max_length: target.max_length,
          generation_overrides: target.generation_overrides,
          writer_content_brief: asObject(item?.writer_content_brief) || undefined,
          intent: asObject(item?.intent) || undefined,
          discoverabilityMeta,
          governance: (item as any)?.governance ?? null,
        });
        built.push(single);
        continue;
      }

      if (!rawContent) {
        const fallback = await generatePlatformVariantFromMaster(masterPayload, target.platform, {
          content_type: target.content_type,
          max_length: target.max_length,
          writer_content_brief: asObject(item?.writer_content_brief) || undefined,
          intent: asObject(item?.intent) || undefined,
          discoverabilityMeta,
          governance: (item as any)?.governance ?? null,
        });
        built.push(fallback);
        continue;
      }

      const maxLength = toPositiveNumber(target.max_length);
      const rawBounded2 = maxLength ? rawContent.slice(0, maxLength) : rawContent;
      const processed2 = await processContent({
        content: rawBounded2,
        platform: target.platform,
        content_type: target.content_type,
        card_type: 'platform_variant',
      });
      const bounded = maxLength ? processed2.content.slice(0, maxLength) : processed2.content;
      const mediaSearchIntent = buildMediaSearchIntent(
        target.platform,
        target.content_type,
        fullText,
        asObject(item?.intent) || null
      );
      built.push({
        platform: target.platform,
        content_type: target.content_type,
        generated_content: bounded,
        generation_status: 'generated',
        locked_variant: false,
        adapted_from_master: true,
        adaptation_style: 'platform_specific',
        requires_media: false,
        generation_overrides: target.generation_overrides,
        adaptation_trace: {
          platform: target.platform,
          style_strategy: PLATFORM_STYLE_MAP[target.platform] ?? 'AI adaptation',
          character_limit_used: maxLength ?? null,
          target_length_used: maxLength ? Math.floor(maxLength * 0.9) : null,
          actual_length_used: bounded.length,
          format_family: 'text',
          media_constraints_applied: false,
          adaptation_reason: `AI-adapted for ${target.platform}.`,
        },
        discoverability_meta: discoverabilityMeta,
        algorithmic_formatting_meta: processed2.processing_trace.structural_formatting_applied
          ? { platform: target.platform, formatting_applied: true as const }
          : undefined,
        media_intent: getMediaIntentDescriptor(target.platform),
        media_search_intent: mediaSearchIntent,
      });
    }
  }

  const validatedVariants = validatePlatformVariants(built);
  return validatedVariants;
}

export async function generatePlatformVariantFromMaster(
  master: MasterContentPayload,
  platform: string,
  constraints: {
    content_type?: string;
    max_length?: number;
    generation_overrides?: Record<string, unknown>;
    writer_content_brief?: Record<string, unknown>;
    intent?: Record<string, unknown>;
    discoverabilityMeta?: import('./variantRenderers').DiscoverabilityMeta;
    existingMediaSearchIntent?: unknown;
    company_id?: string | null;
    /** Creator System-Prompt Governance Integration. Forwarded to
     *  the rewriter's system prompt as a non-negotiable preamble. */
    governance?: GovernancePromptContext | null;
  } = {}
): Promise<PlatformVariantPayload> {
  const normalizedPlatform = nonEmpty(platform).toLowerCase() || 'unknown';
  const contentType = nonEmpty(constraints.content_type).toLowerCase() || 'post';
  const platformStyles: Record<string, string> = {
    linkedin: 'Professional tone, clear structure, slightly longer form with practical insight.',
    facebook: 'Conversational voice, engagement-focused flow, short paragraphs.',
    x: 'Concise and punchy style, high information density.',
    twitter: 'Concise and punchy style, high information density.',
    instagram: 'Emotionally resonant and visually descriptive tone, hashtag-friendly ending.',
    youtube: 'Output for YouTube in TWO parts separated by a blank line. FIRST LINE = a compelling, SEO-optimized video TITLE, keyword front-loaded, max 70 characters, no hashtags. Then a blank line, then the DESCRIPTION: a strong hook in the first 1-2 lines, then the value/detail, a clear call-to-action, and finish with 3-5 relevant hashtags on the last line.',
  };
  const styleInstruction = platformStyles[normalizedPlatform] || 'Neutral adaptation with clear readability.';
  const maxLength = toPositiveNumber(constraints.max_length);
  const targetLength = maxLength ? Math.floor(maxLength * 0.9) : null;
  const formatFamily =
    nonEmpty((constraints.writer_content_brief as any)?.format_requirements?.format_family) ||
    (isMediaDependentContentType(contentType) ? 'media_blueprint' : 'text');
  const adaptationTrace = {
    platform: normalizedPlatform,
    style_strategy: styleInstruction,
    character_limit_used: maxLength ?? null,
    target_length_used: targetLength,
    actual_length_used: null,
    format_family: formatFamily,
    media_constraints_applied: isMediaDependentContentType(contentType),
    adaptation_reason: `Adapted from master content for ${normalizedPlatform}.`,
  };
  if (isMediaDependentContentType(contentType)) {
    return {
      platform: normalizedPlatform,
      content_type: contentType,
      generated_content: '[PLATFORM MEDIA BLUEPRINT]\nUses shared media asset.\nWaiting for media link.',
      generation_status: 'generated',
      locked_variant: false,
      adapted_from_master: true,
      adaptation_style: 'platform_specific',
      requires_media: true,
      generation_overrides: constraints.generation_overrides,
      adaptation_trace: adaptationTrace,
    };
  }

  const masterContent = nonEmpty(master?.content);
  if (!masterContent) {
    console.warn('[content-generation-pipeline][missing-master-content]', {
      platform: normalizedPlatform,
      content_type: contentType,
    });
    return {
      platform: normalizedPlatform,
      content_type: contentType,
      generated_content: '[PLATFORM ADAPTATION FAILED]\nBased on master content.',
      generation_status: 'failed',
      locked_variant: false,
      adapted_from_master: true,
      adaptation_style: 'platform_specific',
      requires_media: false,
      generation_overrides: constraints.generation_overrides,
      adaptation_trace: adaptationTrace,
    };
  }

  if (!platformStyles[normalizedPlatform]) {
    console.warn('[content-generation-pipeline][unsupported-platform-style-default]', {
      platform: normalizedPlatform,
      content_type: contentType,
    });
  }

  const brief = constraints.writer_content_brief ?? {};
  const intent = constraints.intent ?? {};
  const buildUserPrompt = (instruction: string) =>
    JSON.stringify({
      instruction,
      max_length: maxLength ?? null,
      target_length: targetLength ?? null,
      length_policy: maxLength
        ? `Target around 90% of limit. Keep output between ${targetLength} and ${maxLength} characters.`
        : 'No strict max length provided.',
      master_content: masterContent,
      writer_content_brief: brief,
      intent,
      discoverability_meta: constraints.discoverabilityMeta || null,
    });

  const requestVariant = async (instruction: string): Promise<string> => {
    const baseRewriterSystemPrompt = [
      'Rewrite the given MASTER CONTENT for the specified platform and content type.',
      'Keep meaning aligned to master content. Do not mention other platforms.',
      '',
      'FORMATTING RULES — apply based on the platform:',
            '- linkedin / facebook: Start with a single bold hook line (**Hook here**). Then short paragraphs of 1-2 sentences each, separated by a blank line. Emphasise key phrases with **bold**. End with a CTA line.',
            '- x / twitter: Each distinct thought on its own line. Separate groups of thoughts with a blank line. Max 280 characters total.',
            '- instagram: Short punchy paragraphs separated by blank lines. Hashtags on a separate line at the very end after a blank line.',
      '- youtube: Keyword-rich first sentence. Structured paragraphs separated by blank lines.',
      '- Default: Short readable paragraphs (2-3 sentences), each separated by a blank line.',
      '',
      'OUTPUT FORMAT: Plain text with blank lines between paragraphs. No markdown headers (no #). No bullet dashes (use • only if natural). Preserve line breaks.',
    ].join('\n');
    const aiResult = await runCompletionWithOperation({
      companyId: constraints.company_id ?? null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      operation: 'generateContentVariant',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: applyGovernanceToSystemPrompt(baseRewriterSystemPrompt, constraints.governance),
        },
        {
          role: 'user',
          content: buildUserPrompt(instruction),
        },
      ],
    });
    return nonEmpty(aiResult?.output);
  };

  try {
    const contentTypeFormatGuide: Record<string, string> = {
      article:     'Format as a structured article with compelling headline, clear sections, subheadings, and conclusion with CTA. Minimum 400 words.',
      newsletter:  'Format as an email newsletter: subject line, warm opening, 2-3 sections with subheadings, key takeaway, and clear CTA. Minimum 350 words.',
      short_story: 'Format as a narrative short story with hook, rising action, and resolution. Conversational and engaging tone. 300-500 words.',
      white_paper: 'Format as a formal white paper: executive summary, problem statement, evidence-backed sections, solution framework, and conclusion. 600-900 words.',
      thread:      'Format as a Twitter/X thread: 5-7 tweets numbered 1/ through 7/. Each tweet max 270 chars.',
      post:        'Format as a single social post. Punchy, direct, max 3 paragraphs.',
      story:       'Format as quick visual story text overlay — very short, max 2 lines per frame.',
      carousel:    'Keep format as slide text (each slide: bold headline + 1-2 support lines).',
      poll:        'Format as a POLL POST — a text-based engagement post (NOT a native poll). Start with a bold hook question. List 3-4 options using emoji numbers (1️⃣ 2️⃣ 3️⃣ 4️⃣). End with a CTA asking readers to comment their number and explain why. Keep under 150 words. The question must be debatable with no obvious right answer.',
    };
    const formatGuide = contentTypeFormatGuide[contentType] ?? '';
    const aiContent = await requestVariant(
      `Rewrite the following MASTER CONTENT for platform "${normalizedPlatform}" and content_type "${contentType}". Style: ${styleInstruction}. ${formatGuide ? `Format: ${formatGuide}` : ''} ${
        constraints.discoverabilityMeta?.hashtags?.length
          ? `Include discoverability hashtags naturally near the end. Preferred hashtags: ${constraints.discoverabilityMeta.hashtags.join(', ')}.`
          : ''
      }`
    );
    if (!aiContent) {
      console.warn('[content-generation-pipeline][empty-ai-platform-variant]', {
        platform: normalizedPlatform,
        content_type: contentType,
      });
      return {
        platform: normalizedPlatform,
        content_type: contentType,
        generated_content: '[PLATFORM ADAPTATION FAILED]\nBased on master content.',
        generation_status: 'failed',
        locked_variant: false,
        adapted_from_master: true,
        adaptation_style: 'platform_specific',
        requires_media: false,
        generation_overrides: constraints.generation_overrides,
        adaptation_trace: adaptationTrace,
      };
    }

    let rawBounded3 = maxLength ? aiContent.slice(0, maxLength) : aiContent;
    const processed3 = await processContent({
      content: rawBounded3,
      platform: normalizedPlatform,
      content_type: contentType,
      card_type: 'platform_variant',
    });
    let bounded = maxLength ? processed3.content.slice(0, maxLength) : processed3.content;
    if (maxLength && targetLength && bounded.length < targetLength) {
      const expanded = await requestVariant(
        `Rewrite for platform "${normalizedPlatform}" and content_type "${contentType}" with richer promotional detail (CTA, hook, value) while staying <= ${maxLength} chars and targeting ~${targetLength} chars. Style: ${styleInstruction}`
      );
      const expandedRaw = nonEmpty(maxLength ? expanded.slice(0, maxLength) : expanded);
      if (expandedRaw.length > bounded.length) {
        const processed3b = await processContent({
          content: expandedRaw,
          platform: normalizedPlatform,
          content_type: contentType,
          card_type: 'platform_variant',
        });
        const expandedBounded = maxLength ? processed3b.content.slice(0, maxLength) : processed3b.content;
        if (expandedBounded.length > bounded.length) bounded = expandedBounded;
      }
    }
    const traceWithLength = { ...adaptationTrace, actual_length_used: bounded.length };
    const mediaSearchIntent =
      normalizeLegacyMediaSearchIntent(constraints.existingMediaSearchIntent) ||
      buildMediaSearchIntent(normalizedPlatform, contentType, masterContent, constraints.intent || null);
    return {
      platform: normalizedPlatform,
      content_type: contentType,
      generated_content: bounded,
      generation_status: 'generated',
      locked_variant: false,
      adapted_from_master: true,
      adaptation_style: 'platform_specific',
      requires_media: false,
      generation_overrides: constraints.generation_overrides,
      adaptation_trace: traceWithLength,
      discoverability_meta: constraints.discoverabilityMeta,
      algorithmic_formatting_meta: processed3.processing_trace.structural_formatting_applied
        ? { platform: normalizedPlatform, formatting_applied: true as const }
        : undefined,
      media_intent: getMediaIntentDescriptor(normalizedPlatform),
      media_search_intent: mediaSearchIntent,
    };
  } catch (error) {
    console.warn('[content-generation-pipeline][ai-platform-adaptation-failed]', {
      platform: normalizedPlatform,
      content_type: contentType,
      error: String(error),
    });
    return {
      platform: normalizedPlatform,
      content_type: contentType,
      generated_content: '[PLATFORM ADAPTATION FAILED]\nBased on master content.',
      generation_status: 'failed',
      locked_variant: false,
      adapted_from_master: true,
      adaptation_style: 'platform_specific',
      requires_media: false,
      generation_overrides: constraints.generation_overrides,
      adaptation_trace: adaptationTrace,
    };
  }
}

async function buildPlatformVariantsRuntime(item: DailyExecutionItemLike): Promise<PlatformVariantPayload[]> {
  const targets = resolvePlatformTargets(item);
  if (targets.length === 0) {
    console.warn('[content-generation-pipeline][missing-platform-targets]', {
      execution_id: item.execution_id ?? null,
    });
    const existing = Array.isArray(item.platform_variants) ? item.platform_variants : [];
    return validatePlatformVariants(existing);
  }

  if (!item.master_content) {
    console.warn('[content-generation-pipeline][missing-master-content]', {
      execution_id: item.execution_id ?? null,
    });
  }
  const master = item.master_content ?? buildVariantOnlyMasterFallback(
    item.execution_id,
    item.content_type,
    item.topic,
    item.title,
    item.platform,
    isMediaDependentContentType(item.content_type),
    sanitizeIdPart,
  );
  const existing = Array.isArray(item.platform_variants) ? item.platform_variants : [];
  const existingByKey = new Map<string, PlatformVariantPayload>();
  for (const variant of existing) {
    const key = `${nonEmpty(variant?.platform).toLowerCase()}::${nonEmpty(variant?.content_type).toLowerCase()}`;
    if (key !== '::') existingByKey.set(key, variant);
  }

  const mediaTargets = targets.filter((t) => isMediaDependentContentType(t.content_type));
  const textTargets = targets.filter((t) => !isMediaDependentContentType(t.content_type));

  const built: PlatformVariantPayload[] = [];

  // Batch path: one AI call for all text-based platform variants (2+ targets)
  if (textTargets.length >= 1) {
    const discoverabilityMetas = await Promise.all(
      textTargets.map((t) =>
        optimizeDiscoverabilityForPlatform(nonEmpty(master?.content), t.platform, t.content_type)
      )
    );
    const textTargetsWithMeta = textTargets.map((t, i) => ({
      ...t,
      discoverabilityMeta: discoverabilityMetas[i],
    }));

    const batchRaw =
      textTargets.length >= 2
        ? await generatePlatformVariantsInOneCall(nonEmpty(master?.content) || '', textTargetsWithMeta, {
            writer_content_brief: asObject(item?.writer_content_brief) || undefined,
            intent: asObject(item?.intent) || undefined,
            company_id: (item as any)?.company_id ?? null,
            governance: (item as any)?.governance ?? null,
          })
        : null;

    for (let i = 0; i < textTargets.length; i++) {
      const target = textTargets[i]!;
      const discoverabilityMeta = discoverabilityMetas[i];
      const key = `${target.platform}::${target.content_type}`;
      const batchKey = `${target.platform}_${target.content_type}`;
      const existingVariant = existingByKey.get(key);

      if (existingVariant?.locked_variant) {
        built.push(existingVariant);
        continue;
      }

      let rawContent: string | null = null;
      if (batchRaw && (batchRaw as Record<string, string>)[batchKey]) {
        rawContent = nonEmpty((batchRaw as Record<string, string>)[batchKey]);
      }
      if (!rawContent && textTargets.length === 1) {
        try {
          const single = await generatePlatformVariantFromMaster(master, target.platform, {
            content_type: target.content_type,
            max_length: target.max_length,
            generation_overrides: target.generation_overrides,
            writer_content_brief: asObject(item?.writer_content_brief) || undefined,
            intent: asObject(item?.intent) || undefined,
            discoverabilityMeta,
            existingMediaSearchIntent: existingVariant?.media_search_intent,
            company_id: (item as any)?.company_id ?? null,
            governance: (item as any)?.governance ?? null,
          });
          built.push(single);
        } catch {
          const fallbackVariant =
            existingVariant ??
            existing.find(
              (v) =>
                nonEmpty(v?.platform).toLowerCase() === target.platform &&
                nonEmpty(v?.content_type).toLowerCase() === target.content_type
            );
          if (fallbackVariant) {
            built.push(fallbackVariant);
          } else {
            built.push({
              platform: target.platform,
              content_type: target.content_type,
              generated_content: '[PLATFORM ADAPTATION FAILED]\nBased on master content.',
              generation_status: 'failed',
              locked_variant: false,
              adapted_from_master: true,
              adaptation_style: 'platform_specific',
              requires_media: false,
              generation_overrides: target.generation_overrides,
              adaptation_trace: {
                platform: target.platform,
                style_strategy: PLATFORM_STYLE_MAP[target.platform] ?? 'Neutral',
                character_limit_used: target.max_length ?? null,
                target_length_used: null,
                actual_length_used: null,
                format_family: 'text',
                media_constraints_applied: false,
                adaptation_reason: `Adaptation failed for ${target.platform}.`,
              },
            });
          }
        }
        continue;
      }
      if (!rawContent) {
        let fallback: PlatformVariantPayload;
        try {
          fallback = await generatePlatformVariantFromMaster(master, target.platform, {
            content_type: target.content_type,
            max_length: target.max_length,
            generation_overrides: target.generation_overrides,
            writer_content_brief: asObject(item?.writer_content_brief) || undefined,
            intent: asObject(item?.intent) || undefined,
            discoverabilityMeta,
            existingMediaSearchIntent: existingVariant?.media_search_intent,
            governance: (item as any)?.governance ?? null,
          });
        } catch {
          fallback = existingVariant && nonEmpty(existingVariant.generated_content).length > 0
            ? existingVariant
            : {
                platform: target.platform,
                content_type: target.content_type,
                generated_content: '[PLATFORM ADAPTATION FAILED]\nBased on master content.',
                generation_status: 'failed' as const,
                locked_variant: false,
                adapted_from_master: true,
                adaptation_style: 'platform_specific',
                requires_media: false,
                generation_overrides: target.generation_overrides,
                adaptation_trace: {
                  platform: target.platform,
                  style_strategy: PLATFORM_STYLE_MAP[target.platform] ?? 'Neutral',
                  character_limit_used: target.max_length ?? null,
                  target_length_used: null,
                  actual_length_used: null,
                  format_family: 'text',
                  media_constraints_applied: false,
                  adaptation_reason: `Adaptation failed for ${target.platform}.`,
                },
              };
        }
        built.push(
          fallback.generation_status === 'failed' && existingVariant && nonEmpty(existingVariant.generated_content).length > 0
            ? existingVariant
            : fallback
        );
        continue;
      }

      const maxLength = toPositiveNumber(target.max_length);
      const rawBounded4 = maxLength ? rawContent.slice(0, maxLength) : rawContent;
      const processed4 = await processContent({
        content: rawBounded4,
        platform: target.platform,
        content_type: target.content_type,
        card_type: 'platform_variant',
      });
      const bounded = maxLength ? processed4.content.slice(0, maxLength) : processed4.content;

      const mediaSearchIntent =
        normalizeLegacyMediaSearchIntent(existingVariant?.media_search_intent) ||
        buildMediaSearchIntent(target.platform, target.content_type, nonEmpty(master?.content), asObject(item?.intent) || null);
      built.push({
        platform: target.platform,
        content_type: target.content_type,
        generated_content: bounded,
        generation_status: 'generated',
        locked_variant: false,
        adapted_from_master: true,
        adaptation_style: 'platform_specific',
        requires_media: false,
        generation_overrides: target.generation_overrides,
        adaptation_trace: {
          platform: target.platform,
          style_strategy: PLATFORM_STYLE_MAP[target.platform] ?? 'Neutral adaptation',
          character_limit_used: maxLength ?? null,
          target_length_used: maxLength ? Math.floor(maxLength * 0.9) : null,
          actual_length_used: bounded.length,
          format_family: 'text',
          media_constraints_applied: false,
          adaptation_reason: `Adapted from master for ${target.platform} (batch).`,
        },
        discoverability_meta: discoverabilityMeta,
        algorithmic_formatting_meta: processed4.processing_trace.structural_formatting_applied
          ? { platform: target.platform, formatting_applied: true as const }
          : undefined,
        media_intent: getMediaIntentDescriptor(target.platform),
        media_search_intent: mediaSearchIntent,
      });
    }
  }

  // Media-dependent targets: placeholder (no AI)
  for (const target of mediaTargets) {
    const key = `${target.platform}::${target.content_type}`;
    const existingVariant = existingByKey.get(key);
    if (existingVariant?.locked_variant) {
      built.push(existingVariant);
      continue;
    }
    const placeholder = await generatePlatformVariantFromMaster(master, target.platform, {
      content_type: target.content_type,
      max_length: target.max_length,
      generation_overrides: target.generation_overrides,
      writer_content_brief: asObject(item?.writer_content_brief) || undefined,
      intent: asObject(item?.intent) || undefined,
      discoverabilityMeta: undefined,
      existingMediaSearchIntent: existingVariant?.media_search_intent,
      governance: (item as any)?.governance ?? null,
    });
    built.push(placeholder);
  }

  // Preserve extra existing variants not represented by current targets.
  for (const variant of existing) {
    const key = `${nonEmpty(variant?.platform).toLowerCase()}::${nonEmpty(variant?.content_type).toLowerCase()}`;
    if (!built.some((v) => `${v.platform}::${v.content_type}` === key)) built.push(variant);
  }
  const validatedVariants = validatePlatformVariants(built);
  return validatedVariants;
}

export { buildPlatformVariantsRuntime as buildPlatformVariantsFromMaster };

export async function attachGenerationPipelineToDailyItems(weeks: any[]): Promise<any[]> {
  const arr = Array.isArray(weeks) ? weeks : [];
  for (const week of arr) {
    const dailyItems: DailyExecutionItemLike[] = Array.isArray((week as any)?.daily_execution_items)
      ? ((week as any).daily_execution_items as DailyExecutionItemLike[])
      : [];

    for (const item of dailyItems) {
      const execution_id = nonEmpty(item?.execution_id) || null;
      if (!asObject(item?.intent)) {
        console.warn('[content-generation-pipeline][missing-intent]', { execution_id });
      }
      if (!asObject(item?.writer_content_brief)) {
        console.warn('[content-generation-pipeline][missing-writer-content-brief]', { execution_id });
      }

      const existingMaster = asObject(item?.master_content);
      const existingMasterGenerated = nonEmpty(existingMaster?.generation_status).toLowerCase() === 'generated';
      const isMedia = isMediaDependentContentType(item?.content_type);

      if (isMedia) {
        if (!existingMasterGenerated) {
          item.master_content = await generateMasterContentFromIntent(item);
        }
      } else {
        const useBlueprintFlow = !existingMasterGenerated;
        if (useBlueprintFlow) {
          const blueprint = await generateContentBlueprint(item);
          if (!isBlueprintQualitySufficient(blueprint)) {
            item.master_content = await generateMasterContentFromIntent(item);
            item.platform_variants = await buildPlatformVariantsRuntime(item);
          } else {
            const fullText = blueprintToFullText(blueprint);
            const itemId = sanitizeIdPart(item.execution_id || item.title || item.topic || item.platform || 'daily-item');
            item.master_content = {
              id: `master-${itemId}`,
              generated_at: new Date().toISOString(),
              content: fullText,
              generation_status: 'generated',
              generation_source: 'ai',
              content_type_mode: 'text',
              decision_trace: {
                source_topic: nonEmpty(item.topic) || nonEmpty(item.title) || 'TBD',
                objective: nonEmpty(asObject(item.intent)?.objective) || 'TBD',
                pain_point: 'From blueprint',
                outcome_promise: 'From blueprint',
                writing_angle: 'From blueprint',
                tone_used: 'From blueprint',
                narrative_role: 'support',
                progression_step: null,
              },
            };
            item.platform_variants = await renderPlatformVariantsFromBlueprint(blueprint, item);
          }
        }
      }

      if (!existingMasterGenerated && !isMedia && !item.platform_variants) {
        console.warn('[content-generation-pipeline][master-without-variants]', { execution_id });
      }
      if (
        String(item?.master_content?.generation_status || '').toLowerCase() === 'generated' &&
        !asObject(item?.master_content?.decision_trace)
      ) {
        console.warn('[content-generation-pipeline][missing-master-decision-trace]', { execution_id });
      }

      const mediaStatus = resolveMediaStatus(item);
      if (mediaStatus) {
        item.media_status = mediaStatus;
      }
      if (item.master_content && isMedia) {
        item.master_content.content_type_mode = 'media_blueprint';
        item.master_content.required_media = true;
        item.master_content.media_status = mediaStatus ?? 'missing';
      }

      if (isMedia || existingMasterGenerated) {
        item.platform_variants = await buildPlatformVariantsRuntime(item);
      }
      item.execution_readiness = buildExecutionReadiness(item);
      item.execution_jobs = buildExecutionJobsFromItem(item);
      const variants = Array.isArray(item?.platform_variants) ? item.platform_variants : [];
      for (const variant of variants) {
        if (String(variant?.generation_status || '').toLowerCase() === 'generated' && !asObject(variant?.adaptation_trace)) {
          console.warn('[content-generation-pipeline][missing-variant-adaptation-trace]', {
            execution_id,
            platform: variant?.platform ?? null,
            content_type: variant?.content_type ?? null,
          });
        }
      }
    }
  }
  return arr;
}
