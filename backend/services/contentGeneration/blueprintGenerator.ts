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

  const contextPayload = {
    topic: theme,
    objective: nonEmpty(intent?.objective) || nonEmpty(brief?.whatShouldReaderLearn) || 'TBD objective',
    target_audience: audience,
    pain_point: nonEmpty(intent?.pain_point) || nonEmpty(brief?.whatProblemAreWeAddressing) || 'Audience challenge',
    outcome_promise: nonEmpty(intent?.outcome_promise) || nonEmpty(brief?.expectedOutcome) || 'Clear improvement',
    tone: nonEmpty(brief?.narrativeStyle) || nonEmpty(brief?.toneGuidance) || 'Neutral, practical',
    cta_type: nonEmpty(intent?.cta_type) || 'Soft CTA',
    key_points: Array.isArray(brief?.key_points)
      ? (brief.key_points as unknown[]).map((v) => nonEmpty(v)).filter(Boolean)
      : [],
  };

  const { content: systemPrompt, template_name, template_version, template_hash } = getContentBlueprintPromptWithFingerprint();
  console.info('Prompt executed', { prompt: 'content_blueprint', version: CONTENT_GENERATION_PROMPT_VERSION });
  const result = await runCompletionWithOperation({
    companyId: (item as any)?.company_id ?? null,
    campaignId: null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'generateContentBlueprint',
    messages: [
      { role: 'system', content: systemPrompt },
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
      : [contextPayload.objective],
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

export async function generateMasterContentFromIntent(item: DailyExecutionItemLike): Promise<MasterContentPayload> {
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

  if (isMediaDependentContentType(item?.content_type)) {
    const ctCategory = getContentTypeCategory(nonEmpty(item?.content_type));
    const productionSystemPrompt = getContentTypeSystemPrompt(ctCategory);
    const productionContext = {
      topic,
      objective,
      core_message: coreMessage,
      target_audience: nonEmpty(intent?.target_audience) || nonEmpty((asObject(item?.writer_content_brief) as any)?.whoAreWeWritingFor) || 'Campaign audience',
      tone: nonEmpty((asObject(item?.writer_content_brief) as any)?.narrativeStyle) || nonEmpty(intent?.tone) || 'Professional and engaging',
      cta: nonEmpty(intent?.cta_type) || 'Follow for more',
      creator_instruction: nonEmpty((item as any)?.creatorInstruction) || nonEmpty((item as any)?.creator_instruction) || '',
    };
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
  const contextPayload = {
    content_type: nonEmpty(item?.content_type).toLowerCase() || 'post',
    topic,
    objective,
    target_audience:
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

  const contentTypeSystemPrompt = getContentTypeSystemPrompt(ctCategory);
  const contentTypeMaxWords = getContentTypeMaxWords(ctCategory, nonEmpty(item?.content_type));

  try {
    console.info('Prompt executed', { prompt: 'content_generation', version: CONTENT_GENERATION_PROMPT_VERSION, content_type: contextPayload.content_type });
    // Add a uniqueness seed so the AI generates distinct content for similar topics
    const uniqueSeed = `IMPORTANT: This is post #${contextPayload.global_progression_index ?? 'unknown'} in the campaign. ` +
      `Write UNIQUE content specifically about "${contextPayload.topic}" — do NOT produce generic content about the broader theme. ` +
      `Focus on the specific angle implied by this exact title. Each post in this campaign must be completely different.`;

    const aiResult = await runCompletionWithOperation({
      companyId: (item as any)?.company_id ?? null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      operation: 'generateMasterContent',
      temperature: 0.85,
      messages: [
        {
          role: 'system',
          content: contentTypeSystemPrompt,
        },
        {
          role: 'user',
          content: JSON.stringify({ ...contextPayload, max_words: contentTypeMaxWords, diversity_instruction: uniqueSeed }),
        },
      ],
    });
    let aiContent = nonEmpty(aiResult?.output);
    if (!aiContent) {
      console.warn('[content-generation-pipeline][empty-ai-master-content]', {
        execution_id: item.execution_id ?? null,
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
