import { runCompletionWithOperation } from '../aiGateway';
import { refineLanguageOutput } from '../languageRefinementService';
import { getCachedBlueprint, setCachedBlueprint, type ContentBlueprint } from '../contentBlueprintCache';
import {
  getContentBlueprintPromptWithFingerprint,
  CONTENT_GENERATION_PROMPT_VERSION,
} from '../../prompts';
import { validateContentBlueprint } from '../aiOutputValidationService';
import { nonEmpty, asObject, sanitizeIdPart, getContentTypeSystemPrompt, getContentTypeCategory, getContentTypeMaxWords } from './contentTypeHelpers';
import { isMediaDependentContentType } from './executionHelpers';
import type { MasterContentPayload, DailyExecutionItemLike } from './types';
import { getProfile } from '../companyProfileService';
import { resolveBrandVoice } from '../brand/resolveBrandVoice';
import { registerBrandCacheInvalidator } from '../brand/brandCacheRegistry';
import {
  extractCompanyIdentity,
  buildCompanyContextBlockShort,
  buildIdentityLock,
  buildAntiGenericRules,
  type CompanyIdentity,
} from '../../../lib/content/companyContextBlock';
// Creator System-Prompt Governance Integration. Final Closure Pass —
// Phase 3 (rewriter consistency). All system-prompt construction
// sites in this module call the SAME canonical preamble helper from
// strategyGovernancePromptContext.ts; no local re-implementation.
import { applyGovernancePreambleToSystemPromptFromItem } from '../creator/strategyGovernancePromptContext';

/**
 * Thin wrapper preserving the original call-site signature
 * (basePrompt, item). Delegates to the canonical shared helper so
 * the preamble format is single-source.
 */
function applyGovernanceToSystemPrompt(
  basePrompt: string,
  item: DailyExecutionItemLike,
): string {
  return applyGovernancePreambleToSystemPromptFromItem(basePrompt, item as any);
}

// ── Company identity cache (5-min TTL, matches aiModelRouter pattern) ────────
const _identityCache = new Map<string, { identity: CompanyIdentity; at: number }>();
const IDENTITY_CACHE_TTL = 5 * 60 * 1000;

/** Phase 3C — this cache bakes the resolved brand voice (line 52), so a brand
 *  publish must clear it in-process or stale voice is served for ≤5 min.
 *  Registered with the brand-cache registry; fired by invalidateBrandCaches. */
export function clearIdentityCacheForCompany(companyId: string): void {
  _identityCache.delete(companyId);
}
registerBrandCacheInvalidator(clearIdentityCacheForCompany);

/** @internal test-only seams for cache-coherence tests. */
export function __identityCacheHasForTest(companyId: string): boolean {
  return _identityCache.has(companyId);
}
export function __identityCacheSeedForTest(companyId: string): void {
  _identityCache.set(companyId, { identity: {}, at: Date.now() });
}

async function resolveCompanyIdentity(companyId: string | null | undefined): Promise<CompanyIdentity> {
  if (!companyId) return {};
  const cached = _identityCache.get(companyId);
  if (cached && Date.now() - cached.at < IDENTITY_CACHE_TTL) return cached.identity;
  try {
    const profile = await getProfile(companyId, { autoRefine: false });
    const identity = extractCompanyIdentity(profile);
    // Phase 2A — BrandRuntime is the authoritative brand-voice source; falls back
    // to the legacy company_profiles.brand_voice when no brand_identity row.
    identity.brandVoice = await resolveBrandVoice(companyId, identity.brandVoice);
    _identityCache.set(companyId, { identity, at: Date.now() });
    return identity;
  } catch {
    return {};
  }
}

/**
 * Generates structured content blueprint (hook, key_points, cta) instead of full master content.
 * Lighter AI call; used for two-stage pipeline.
 */
export async function generateContentBlueprint(item: DailyExecutionItemLike): Promise<ContentBlueprint> {
  const companyId = nonEmpty((item as any)?.company_id) || 'default';
  const theme = nonEmpty(item.topic) || nonEmpty(item.title) || 'TBD';
  const contentType = nonEmpty(item.content_type).toLowerCase() || 'post';
  const intent = asObject(item.intent);
  const brief = asObject(item.writer_content_brief);
  const audience =
    nonEmpty(intent?.target_audience) ||
    nonEmpty(brief?.whoAreWeWritingFor) ||
    'General audience';

  const cached = getCachedBlueprint(companyId, theme, contentType, audience);
  if (cached) return cached;

  // Resolve company identity for context enforcement
  const identity = await resolveCompanyIdentity(companyId === 'default' ? null : companyId);

  const contextPayload: Record<string, unknown> = {
    topic: theme,
    objective: nonEmpty(intent?.objective) || nonEmpty(brief?.whatShouldReaderLearn) || 'TBD objective',
    target_audience: identity.idealCustomerProfile || identity.targetAudience || audience,
    pain_point: nonEmpty(intent?.pain_point) || nonEmpty(brief?.whatProblemAreWeAddressing) || identity.painPoints?.[0] || 'Audience challenge',
    outcome_promise: nonEmpty(intent?.outcome_promise) || nonEmpty(brief?.expectedOutcome) || 'Clear improvement',
    tone: nonEmpty(brief?.narrativeStyle) || nonEmpty(brief?.toneGuidance) || 'Neutral, practical',
    cta_type: nonEmpty(intent?.cta_type) || 'Soft CTA',
    key_points: Array.isArray(brief?.key_points)
      ? (brief.key_points as unknown[]).map((v) => nonEmpty(v)).filter(Boolean)
      : [],
  };

  // Inject company identity into context payload
  const shortContext = buildCompanyContextBlockShort(identity);
  if (shortContext) {
    contextPayload.company_context = shortContext;
  }

  const { content: systemPrompt, template_name, template_version, template_hash } = getContentBlueprintPromptWithFingerprint();
  const baseSystemPrompt = identity.companyName
    ? `${buildIdentityLock(identity, 'content blueprint')}\n\n${systemPrompt}\n${buildAntiGenericRules(identity)}`
    : systemPrompt;
  const effectiveSystemPrompt = applyGovernanceToSystemPrompt(baseSystemPrompt, item);
  console.info('Prompt executed', { prompt: 'content_blueprint', version: CONTENT_GENERATION_PROMPT_VERSION });
  const __corr = ((item as { correlation?: import('../../../lib/shared/observability/correlationRef').CorrelationRef })?.correlation) ?? null;
  const result = await runCompletionWithOperation({
    companyId: (item as any)?.company_id ?? null,
    campaignId: (item as { campaign_id?: string | null })?.campaign_id ?? null,
    referenceType: __corr?.referenceType ?? null,
    referenceId: __corr?.referenceId ?? null,
    parentActivityId: __corr?.parentActivityId ?? null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'generateContentBlueprint',
    messages: [
      { role: 'system', content: effectiveSystemPrompt },
      { role: 'user', content: JSON.stringify(contextPayload) },
    ],
    prompt_template_name: template_name,
    prompt_template_version: template_version,
    prompt_template_hash: template_hash,
  });

  const raw = typeof result?.output === 'string' ? result.output : '';
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed: Partial<ContentBlueprint> = {};
  try {
    parsed = JSON.parse(trimmed || '{}');
  } catch {
    parsed = {};
  }

  const blueprint: ContentBlueprint = {
    hook: nonEmpty(parsed.hook) || `Topic: ${theme}`,
    key_points: Array.isArray(parsed.key_points)
      ? parsed.key_points.map((v) => String(v ?? '')).filter(Boolean)
      : [String(contextPayload.objective ?? 'Key point')],
    cta: nonEmpty(parsed.cta) || '— Learn more when you\'re ready.',
  };

  // Blueprint → refined → master content assembly. No unrefined blueprint language propagates downstream.
  if (blueprint.hook) {
    const r = await refineLanguageOutput({
      content: blueprint.hook,
      card_type: 'master_content',
    });
    blueprint.hook = (r.refined as string) || blueprint.hook;
  }
  if (Array.isArray(blueprint.key_points) && blueprint.key_points.length > 0) {
    const r = await refineLanguageOutput({
      content: blueprint.key_points,
      card_type: 'master_content',
    });
    if (Array.isArray(r.refined)) {
      blueprint.key_points = r.refined;
    }
  }
  if (blueprint.cta) {
    const r = await refineLanguageOutput({
      content: blueprint.cta,
      card_type: 'master_content',
    });
    blueprint.cta = (r.refined as string) || blueprint.cta;
  }

  const validatedBlueprint = validateContentBlueprint(blueprint) ?? blueprint;
  setCachedBlueprint(companyId, theme, contentType, audience, validatedBlueprint);
  return validatedBlueprint;
}

/** Content quality guard: blueprint must have at least 2 key points and hook ≥ 6 words. */
export function isBlueprintQualitySufficient(bp: ContentBlueprint): boolean {
  const keyPointsOk = Array.isArray(bp.key_points) && bp.key_points.length >= 2;
  const hookWords = String(bp.hook ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const hookOk = hookWords >= 6;
  return keyPointsOk && hookOk;
}

/**
 * Strict token-tracked variant of generateMasterContentFromIntent.
 *
 * Differences from the legacy function:
 *   - Requires explicit `provider` + `model` — NO env fallback.
 *   - On LLM failure OR empty response: THROWS (no deterministic fallback).
 *     This lets the credit wrapper RELEASE the full HOLD instead of silently
 *     charging for a failed call.
 *   - Returns `{ master, usage, provider, model }` so callers can wire into
 *     executeWithCredits' llmPricing hook.
 *
 * Use this from executeWithCredits. Other callers that want the forgiving
 * "never throw, always return something" contract keep using the legacy
 * generateMasterContentFromIntent.
 */
export async function generateMasterContentStrict(
  item: DailyExecutionItemLike,
  args: { provider: string; model: string },
): Promise<{
  master:   MasterContentPayload;
  usage:    { inputTokens: number; outputTokens: number; totalTokens: number };
  provider: string;
  model:    string;
}> {
  if (!args?.provider || !args?.model) {
    throw new Error('[generateMasterContentStrict] provider and model are required — no env fallback allowed');
  }
  const { provider, model } = args;

  const itemId  = sanitizeIdPart(item.execution_id || item.title || item.topic || item.platform || 'daily-item');
  const nowIso  = new Date().toISOString();
  const intent  = asObject(item.intent);
  const brief   = asObject(item.writer_content_brief);
  const topic   = nonEmpty(item.topic) || nonEmpty(item.title) || nonEmpty(intent?.topic) || 'TBD topic';
  const objective =
    nonEmpty(intent?.objective) ||
    nonEmpty(brief?.whatShouldReaderLearn) ||
    nonEmpty(brief?.topicGoal) ||
    'TBD objective';
  const coreMessage =
    nonEmpty(intent?.outcome_promise) ||
    nonEmpty(intent?.pain_point) ||
    nonEmpty(brief?.whatProblemAreWeAddressing) ||
    'TBD core message';

  const decisionTrace: NonNullable<MasterContentPayload['decision_trace']> = {
    source_topic: topic,
    objective,
    pain_point:
      nonEmpty(intent?.pain_point) ||
      nonEmpty(brief?.whatProblemAreWeAddressing) ||
      'Audience challenge relevant to topic',
    outcome_promise:
      nonEmpty(intent?.outcome_promise) ||
      nonEmpty(brief?.expectedOutcome) ||
      'Clear measurable improvement for the audience',
    writing_angle:
      nonEmpty(brief?.messagingAngle) ||
      nonEmpty(brief?.topicGoal) ||
      nonEmpty(intent?.strategic_role) ||
      'Educational narrative aligned to weekly intent',
    tone_used:
      nonEmpty(brief?.narrativeStyle) ||
      nonEmpty(brief?.toneGuidance) ||
      'Neutral, clear, practical',
    narrative_role: nonEmpty((item as any)?.narrative_role) || 'support',
    progression_step: Number.isFinite(Number((item as any)?.progression_step))
      ? Number((item as any)?.progression_step)
      : null,
  };

  const identity     = await resolveCompanyIdentity((item as any)?.company_id);
  const shortContext = buildCompanyContextBlockShort(identity);
  const ctCategory   = getContentTypeCategory(nonEmpty(item?.content_type));

  // Build prompt + context — media-dependent and text flows share extraction.
  const isMediaFlow = isMediaDependentContentType(item?.content_type);

  let systemPrompt: string;
  let userContent:  string;
  let temperature:  number;
  let contentTypeMode: MasterContentPayload['content_type_mode'];
  let requiredMedia = false;

  if (isMediaFlow) {
    const productionSystemPromptBase = getContentTypeSystemPrompt(ctCategory);
    const antiGeneric = identity.companyName ? buildAntiGenericRules(identity) : '';
    systemPrompt = applyGovernanceToSystemPrompt(productionSystemPromptBase + antiGeneric, item);
    const productionContext: Record<string, unknown> = {
      topic,
      objective,
      core_message: coreMessage,
      target_audience: identity.idealCustomerProfile || identity.targetAudience || nonEmpty(intent?.target_audience) || nonEmpty((asObject(item?.writer_content_brief) as any)?.whoAreWeWritingFor) || 'Campaign audience',
      tone: nonEmpty((asObject(item?.writer_content_brief) as any)?.narrativeStyle) || nonEmpty(intent?.tone) || 'Professional and engaging',
      cta: nonEmpty(intent?.cta_type) || 'Follow for more',
      creator_instruction: nonEmpty((item as any)?.creatorInstruction) || nonEmpty((item as any)?.creator_instruction) || '',
    };
    if (shortContext) productionContext.company_context = shortContext;
    userContent    = JSON.stringify(productionContext);
    temperature    = 0.3;
    contentTypeMode = 'media_blueprint';
    requiredMedia   = true;
  } else {
    const contextPayload: Record<string, unknown> = {
      content_type: nonEmpty(item?.content_type).toLowerCase() || 'post',
      topic,
      objective,
      target_audience:
        identity.idealCustomerProfile || identity.targetAudience ||
        nonEmpty(intent?.target_audience) ||
        nonEmpty(brief?.whoAreWeWritingFor) ||
        'General audience aligned to campaign context',
      writing_angle:
        nonEmpty(brief?.messagingAngle) ||
        nonEmpty(brief?.topicGoal) ||
        nonEmpty(intent?.strategic_role) ||
        'Educational narrative aligned to weekly intent',
      pain_point:
        nonEmpty(intent?.pain_point) ||
        nonEmpty(brief?.whatProblemAreWeAddressing) ||
        'Audience challenge relevant to topic',
      outcome_promise:
        nonEmpty(intent?.outcome_promise) ||
        nonEmpty(brief?.expectedOutcome) ||
        'Clear measurable improvement for the audience',
      tone:
        nonEmpty(brief?.narrativeStyle) ||
        nonEmpty(brief?.toneGuidance) ||
        'Neutral, clear, practical',
      core_message: coreMessage,
      key_points: Array.isArray(brief?.key_points)
        ? (brief.key_points as unknown[]).map((v) => nonEmpty(v)).filter(Boolean)
        : [],
      cta_type: nonEmpty(intent?.cta_type) || 'Soft CTA',
      progression_step: Number.isFinite(Number(item?.progression_step)) ? Number(item.progression_step) : null,
      global_progression_index: Number.isFinite(Number(item?.global_progression_index))
        ? Number(item.global_progression_index)
        : null,
      ...(typeof (item as any)?.extra_instruction === 'string' && (item as any).extra_instruction.trim()
        ? { additional_guidance: (item as any).extra_instruction.trim() }
        : {}),
    };
    if (shortContext) contextPayload.company_context = shortContext;

    const contentTypeSystemPromptBase = getContentTypeSystemPrompt(ctCategory);
    const textAntiGeneric = identity.companyName ? buildAntiGenericRules(identity) : '';
    const baseSystemPrompt = identity.companyName
      ? `${buildIdentityLock(identity, contextPayload.content_type as string)}\n\n${contentTypeSystemPromptBase}${textAntiGeneric}`
      : contentTypeSystemPromptBase + textAntiGeneric;
    systemPrompt = applyGovernanceToSystemPrompt(baseSystemPrompt, item);
    const contentTypeMaxWords = getContentTypeMaxWords(ctCategory, nonEmpty(item?.content_type));
    userContent    = JSON.stringify({ ...contextPayload, max_words: contentTypeMaxWords });
    temperature    = 0.7;
    contentTypeMode = 'text';
  }

  // Single LLM call — explicit provider + model, no env fallback.
  // aiGateway owns usage_events telemetry for this call; executeWithCredits
  // owns credit_transactions. Both writers are unaware of the other.
  const aiResult = await runCompletionWithOperation({
    companyId:   (item as any)?.company_id ?? null,
    model,
    operation:   'generateMasterContent',
    temperature,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent   },
    ],
  });

  const aiContent = nonEmpty(aiResult?.output);
  if (!aiContent) {
    throw new Error('[generateMasterContentStrict] LLM returned empty content — hold will be released');
  }

  // Extract token usage from gateway metadata — required, no synthetic estimate,
  // no zero tolerance (a zero means the provider didn't meter us, which breaks
  // billing integrity even if the response text looked fine).
  const tokenUsage   = aiResult?.metadata?.token_usage;
  const inputTokens  = Number(tokenUsage?.prompt_tokens     ?? NaN);
  const outputTokens = Number(tokenUsage?.completion_tokens ?? NaN);
  if (!Number.isFinite(inputTokens)  || inputTokens  <= 0) {
    throw new Error(`[generateMasterContentStrict] invalid inputTokens=${tokenUsage?.prompt_tokens} — provider must return a positive prompt_tokens count`);
  }
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) {
    throw new Error(`[generateMasterContentStrict] invalid outputTokens=${tokenUsage?.completion_tokens} — provider must return a positive completion_tokens count`);
  }
  const totalTokens = Number(tokenUsage?.total_tokens ?? (inputTokens + outputTokens));

  // Post-process: language refinement (text flow only).
  let finalContent = aiContent;
  if (!isMediaFlow) {
    const refinedMaster = await refineLanguageOutput({ content: aiContent, card_type: 'master_content' });
    finalContent = (refinedMaster.refined as string) || aiContent;
  }

  const master: MasterContentPayload = {
    id: `master-${itemId}`,
    generated_at:      nowIso,
    content:           finalContent,
    generation_status: 'generated',
    generation_source: 'ai',
    content_type_mode: contentTypeMode,
    ...(requiredMedia ? { required_media: true as const, media_status: 'missing' as const } : {}),
    decision_trace:    decisionTrace,
  };

  return {
    master,
    usage: { inputTokens, outputTokens, totalTokens },
    provider,
    model,
  };
}

async function generateMasterContentRuntime(item: DailyExecutionItemLike): Promise<MasterContentPayload> {
  const itemId = sanitizeIdPart(item.execution_id || item.title || item.topic || item.platform || 'daily-item');
  const nowIso = new Date().toISOString();

  const intent = asObject(item.intent);
  const brief = asObject(item.writer_content_brief);
  const topic = nonEmpty(item.topic) || nonEmpty(item.title) || nonEmpty(intent?.topic) || 'TBD topic';
  const objective =
    nonEmpty(intent?.objective) ||
    nonEmpty(brief?.whatShouldReaderLearn) ||
    nonEmpty(brief?.topicGoal) ||
    'TBD objective';
  const coreMessage =
    nonEmpty(intent?.outcome_promise) ||
    nonEmpty(intent?.pain_point) ||
    nonEmpty(brief?.whatProblemAreWeAddressing) ||
    'TBD core message';
  const decisionTrace: NonNullable<MasterContentPayload['decision_trace']> = {
    source_topic: topic,
    objective,
    pain_point:
      nonEmpty(intent?.pain_point) ||
      nonEmpty(brief?.whatProblemAreWeAddressing) ||
      'Audience challenge relevant to topic',
    outcome_promise:
      nonEmpty(intent?.outcome_promise) ||
      nonEmpty(brief?.expectedOutcome) ||
      'Clear measurable improvement for the audience',
    writing_angle:
      nonEmpty(brief?.messagingAngle) ||
      nonEmpty(brief?.topicGoal) ||
      nonEmpty(intent?.strategic_role) ||
      'Educational narrative aligned to weekly intent',
    tone_used:
      nonEmpty(brief?.narrativeStyle) ||
      nonEmpty(brief?.toneGuidance) ||
      'Neutral, clear, practical',
    narrative_role: nonEmpty((item as any)?.narrative_role) || 'support',
    progression_step: Number.isFinite(Number((item as any)?.progression_step))
      ? Number((item as any)?.progression_step)
      : null,
  };

  // Resolve company identity for context enforcement
  const identity = await resolveCompanyIdentity((item as any)?.company_id);
  const shortContext = buildCompanyContextBlockShort(identity);

  if (isMediaDependentContentType(item?.content_type)) {
    const ctCategory = getContentTypeCategory(nonEmpty(item?.content_type));
    const productionSystemPromptBase = getContentTypeSystemPrompt(ctCategory);
    // Append anti-generic enforcement so company context is binding, not metadata
    const antiGeneric = identity.companyName ? buildAntiGenericRules(identity) : '';
    const productionSystemPrompt = applyGovernanceToSystemPrompt(productionSystemPromptBase + antiGeneric, item);
    const productionContext: Record<string, unknown> = {
      topic,
      objective,
      core_message: coreMessage,
      target_audience: identity.idealCustomerProfile || identity.targetAudience || nonEmpty(intent?.target_audience) || nonEmpty((asObject(item?.writer_content_brief) as any)?.whoAreWeWritingFor) || 'Campaign audience',
      tone: nonEmpty((asObject(item?.writer_content_brief) as any)?.narrativeStyle) || nonEmpty(intent?.tone) || 'Professional and engaging',
      cta: nonEmpty(intent?.cta_type) || 'Follow for more',
      creator_instruction: nonEmpty((item as any)?.creatorInstruction) || nonEmpty((item as any)?.creator_instruction) || '',
    };
    if (shortContext) productionContext.company_context = shortContext;
    try {
      const productionResult = await runCompletionWithOperation({
        companyId: (item as any)?.company_id ?? null,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        operation: 'generateMasterContent',
        temperature: 0.3,
        messages: [
          { role: 'system', content: productionSystemPrompt },
          { role: 'user', content: JSON.stringify(productionContext) },
        ],
      });
      const productionContent = nonEmpty(productionResult?.output) || `[MEDIA BLUEPRINT]\nTopic: ${topic}\nObjective: ${objective}\nCore message: ${coreMessage}`;
      return {
        id: `master-${itemId}`,
        generated_at: nowIso,
        content: productionContent,
        generation_status: 'generated',
        generation_source: 'ai',
        content_type_mode: 'media_blueprint',
        required_media: true,
        media_status: 'missing',
        decision_trace: decisionTrace,
      };
    } catch {
      return {
        id: `master-${itemId}`,
        generated_at: nowIso,
        content: `[MEDIA BLUEPRINT]\nTopic: ${topic}\nObjective: ${objective}\nCore message: ${coreMessage}`,
        generation_status: 'generated',
        generation_source: 'ai',
        content_type_mode: 'media_blueprint',
        required_media: true,
        media_status: 'missing',
        decision_trace: decisionTrace,
      };
    }
  }

  const ctCategory = getContentTypeCategory(nonEmpty(item?.content_type));
  const contextPayload: Record<string, unknown> = {
    content_type: nonEmpty(item?.content_type).toLowerCase() || 'post',
    topic,
    objective,
    target_audience:
      identity.idealCustomerProfile || identity.targetAudience ||
      nonEmpty(intent?.target_audience) ||
      nonEmpty(brief?.whoAreWeWritingFor) ||
      'General audience aligned to campaign context',
    writing_angle:
      nonEmpty(brief?.messagingAngle) ||
      nonEmpty(brief?.topicGoal) ||
      nonEmpty(intent?.strategic_role) ||
      'Educational narrative aligned to weekly intent',
    pain_point:
      nonEmpty(intent?.pain_point) ||
      nonEmpty(brief?.whatProblemAreWeAddressing) ||
      'Audience challenge relevant to topic',
    outcome_promise:
      nonEmpty(intent?.outcome_promise) ||
      nonEmpty(brief?.expectedOutcome) ||
      'Clear measurable improvement for the audience',
    tone:
      nonEmpty(brief?.narrativeStyle) ||
      nonEmpty(brief?.toneGuidance) ||
      'Neutral, clear, practical',
    core_message: coreMessage,
    key_points: Array.isArray(brief?.key_points)
      ? (brief.key_points as unknown[]).map((v) => nonEmpty(v)).filter(Boolean)
      : [],
    cta_type: nonEmpty(intent?.cta_type) || 'Soft CTA',
    progression_step: Number.isFinite(Number(item?.progression_step)) ? Number(item.progression_step) : null,
    global_progression_index: Number.isFinite(Number(item?.global_progression_index))
      ? Number(item.global_progression_index)
      : null,
    ...(typeof (item as any)?.extra_instruction === 'string' && (item as any).extra_instruction.trim()
      ? { additional_guidance: (item as any).extra_instruction.trim() }
      : {}),
  };

  // Inject company context for content specificity
  if (shortContext) {
    contextPayload.company_context = shortContext;
  }

  const contentTypeSystemPromptBase = getContentTypeSystemPrompt(ctCategory);
  // Append anti-generic enforcement so company context is binding, not metadata
  const textAntiGeneric = identity.companyName ? buildAntiGenericRules(identity) : '';
    const contentTypeSystemPromptIdentity = identity.companyName
      ? `${buildIdentityLock(identity, contextPayload.content_type as string)}\n\n${contentTypeSystemPromptBase}${textAntiGeneric}`
      : contentTypeSystemPromptBase + textAntiGeneric;
    const contentTypeSystemPrompt = applyGovernanceToSystemPrompt(contentTypeSystemPromptIdentity, item);
  const contentTypeMaxWords = getContentTypeMaxWords(ctCategory, nonEmpty(item?.content_type));

  try {
    console.info('Prompt executed', { prompt: 'content_generation', version: CONTENT_GENERATION_PROMPT_VERSION, content_type: contextPayload.content_type });
    const callAi = async (systemPromptForCall: string) => runCompletionWithOperation({
      companyId: (item as any)?.company_id ?? null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      operation: 'generateMasterContent',
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPromptForCall },
        { role: 'user', content: JSON.stringify({ ...contextPayload, max_words: contentTypeMaxWords }) },
      ],
    });

    let aiResult = await callAi(contentTypeSystemPrompt);
    let aiContent = nonEmpty(aiResult?.output);

    // Retry with a simplified system prompt if first attempt returned empty.
    // gpt-4o-mini sometimes balks at long compound instructions (identity lock
    // + anti-generic rules + detailed format guide). A leaner prompt usually works.
    if (!aiContent) {
      console.warn('[content-generation-pipeline][empty-ai-master-content][retry-with-simpler-prompt]', {
        execution_id: item.execution_id ?? null,
        content_type: contextPayload.content_type,
        topic,
      });
      const simpleSystemPrompt = applyGovernanceToSystemPrompt(getContentTypeSystemPrompt(ctCategory), item);
      aiResult = await callAi(simpleSystemPrompt);
      aiContent = nonEmpty(aiResult?.output);
    }

    if (!aiContent) {
      console.error('[content-generation-pipeline][empty-ai-master-content][both-attempts-failed]', {
        execution_id: item.execution_id ?? null,
        content_type: contextPayload.content_type,
        topic,
        systemPromptLength: contentTypeSystemPrompt.length,
      });
      return {
        id: `master-${itemId}`,
        generated_at: nowIso,
        content: `[MASTER GENERATION FAILED — deterministic fallback]\nTopic: ${topic}`,
        generation_status: 'failed',
        generation_source: 'ai',
        content_type_mode: 'text',
        decision_trace: decisionTrace,
      };
    }
    const refinedMaster = await refineLanguageOutput({
      content: aiContent,
      card_type: 'master_content',
    });
    aiContent = (refinedMaster.refined as string) || aiContent;
    return {
      id: `master-${itemId}`,
      generated_at: nowIso,
      content: aiContent,
      generation_status: 'generated',
      generation_source: 'ai',
      content_type_mode: 'text',
      decision_trace: decisionTrace,
    };
  } catch (error) {
    console.warn('[content-generation-pipeline][ai-master-generation-failed]', {
      execution_id: item.execution_id ?? null,
      error: String(error),
    });
    return {
      id: `master-${itemId}`,
      generated_at: nowIso,
      content: `[MASTER GENERATION FAILED — deterministic fallback]\nTopic: ${topic}`,
      generation_status: 'failed',
      generation_source: 'ai',
      content_type_mode: 'text',
      decision_trace: decisionTrace,
    };
  }
}

export { generateMasterContentRuntime as generateMasterContentFromIntent };
