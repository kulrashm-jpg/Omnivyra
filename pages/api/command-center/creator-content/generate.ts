import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { measureCreatorDuration } from '../../../../backend/services/creatorRuntimeMetrics';
import { isGuidanceOnlyContentType } from '../../../../backend/services/creatorTemplateRegistryService';
import {
  buildAssetCompositionIntent,
  normalizeAttachmentMode,
  normalizeSourceTextTransform,
  normalizeWriterCreatorAssetType,
  validateAttachmentPayload,
  type AssetCompositionIntent,
} from '../../../../lib/content/writerCreatorAttachmentContracts';
import { containsDirectThreadDuplication, transformThreadForVisual } from '../../../../lib/content/writerCreatorThreadTransform';
import { detectSemanticThreadDuplication } from '../../../../backend/services/creatorSemanticDuplication';
import { enqueueDurableCreatorRenderJob } from '../../../../backend/services/creatorRenderDurableQueue';
import { createCreatorAuditId } from '../../../../backend/services/creatorRenderObservability';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../../backend/services/billing/phase2EnforcementGate';

type GenerateCreatorBody = {
  company_id?: string;
  topic?: string;
  creator_type?: string;
  content_type?: string;
  target_platforms?: string[];
  audience?: string;
  objective?: string;
  summary?: string;
  creator_card?: Record<string, unknown>;
};

const CREATOR_GENERATION_API_TIMEOUT_MS = 120_000;

function withCreatorTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = CREATOR_GENERATION_API_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(Object.assign(
        new Error(`${label} timed out. Please try again in a moment.`),
        { statusCode: 504 },
      ));
    }, timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
}

function resolveRequestedContentType(input: { creatorType?: string; contentType?: string }): string {
  const creatorType = String(input.creatorType || '').trim().toLowerCase();
  const explicitContentType = String(input.contentType || '').trim().toLowerCase();
  if (explicitContentType) return explicitContentType;

  switch (creatorType) {
    case 'banner':
      return 'banner';
    case 'infographic':
      return 'infographic';
    case 'pdf':
      return 'pdf';
    case 'slider':
      return 'slider';
    default:
      return creatorType;
  }
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeCreatorCardForAttachment(input: {
  creatorCard: Record<string, unknown>;
  creatorType: string;
  contentType: string;
}): { creatorCard: Record<string, unknown>; compositionIntent: AssetCompositionIntent | null; errors: string[] } {
  const rawIntent = safeObject(input.creatorCard.asset_composition_intent);
  const hasWriterIntent = typeof input.creatorCard.attachment_mode === 'string' || Object.keys(rawIntent).length > 0;
  if (!hasWriterIntent) return { creatorCard: input.creatorCard, compositionIntent: null, errors: [] };

  const assetType = normalizeWriterCreatorAssetType(
    rawIntent.assetType ?? input.creatorCard.writer_asset_type ?? input.creatorType ?? input.contentType,
  );
  const attachmentMode = normalizeAttachmentMode(rawIntent.attachmentMode ?? input.creatorCard.attachment_mode);
  const rawCopyPolicy = safeObject(input.creatorCard.copy_policy);
  const sourceTextTransform = normalizeSourceTextTransform(
    safeObject(rawIntent.copyPolicy).sourceTextTransform ?? rawCopyPolicy.sourceTextTransform ?? input.creatorCard.source_text_transform,
  );
  const compositionIntent = buildAssetCompositionIntent({
    assetType,
    attachmentMode,
    sourceTextTransform,
    copyPolicy: rawCopyPolicy.sourceTextTransform
      ? {
          allowHeadline: rawCopyPolicy.allowHeadline === true,
          allowKeyInsight: rawCopyPolicy.allowKeyInsight === true,
          allowCTA: rawCopyPolicy.allowCTA === true,
          sourceTextTransform,
        }
      : undefined,
  });
  const overlayText = safeObject(input.creatorCard.overlay_text);
  const sourceContent = safeObject(input.creatorCard.source_content);
  const validation = validateAttachmentPayload({
    attachmentMode,
    assetType,
    copyPolicy: compositionIntent.copyPolicy,
    overlayText,
    cta: input.creatorCard.cta ?? input.creatorCard.CTA ?? overlayText.cta,
    sourceText: String(sourceContent.snippet || ''),
    sourceType: sourceContent.source_type === 'thread' ? 'thread' : 'post',
  });
  const creatorCard: Record<string, unknown> = {
    ...input.creatorCard,
    writer_asset_type: assetType,
    attachment_mode: attachmentMode,
    asset_composition_intent: compositionIntent,
    copy_policy: compositionIntent.copyPolicy,
    source_text_transform: compositionIntent.copyPolicy?.sourceTextTransform ?? 'none',
    renderer_text_policy: attachmentMode === 'supporting_visual' ? 'background_only' : 'deterministic_typography',
  };
  if (sourceContent.source_type === 'thread') {
    const transformed = transformThreadForVisual({
      sourceText: String(sourceContent.snippet || ''),
      transform: sourceTextTransform,
    });
    creatorCard.thread_visual_transform = transformed;
    if (containsDirectThreadDuplication({
      rawSourceText: String(sourceContent.snippet || ''),
      visualItems: transformed.items,
    })) {
      validation.errors.push('raw thread segments cannot map directly to visual output');
    }
    const semanticDuplication = detectSemanticThreadDuplication({
      rawSourceText: String(sourceContent.snippet || ''),
      visualItems: transformed.items,
      transform: sourceTextTransform,
    });
    creatorCard.semantic_thread_duplication = semanticDuplication;
    if (!semanticDuplication.ok) {
      validation.errors.push('semantic thread duplication detected');
    }
  }
  if (attachmentMode === 'supporting_visual') {
    delete creatorCard.overlay_text;
    delete creatorCard.cta;
    delete creatorCard.CTA;
  }
  return { creatorCard, compositionIntent, errors: validation.errors };
}

function mergeRenderedMedia(output: any, rendered: { url?: string | null; files?: string[] | null; metadata?: Record<string, unknown> | null }) {
  const mediaBundle = safeObject(output?.asset_payload?.media_bundle);
  return {
    ...output,
    asset_payload: {
      ...safeObject(output?.asset_payload),
      media_bundle: {
        ...mediaBundle,
        ...(rendered.url ? { url: rendered.url } : {}),
        ...(Array.isArray(rendered.files) && rendered.files.length > 0 ? { files: rendered.files } : {}),
        metadata: {
          ...safeObject(mediaBundle.metadata),
          ...safeObject(rendered.metadata),
        },
      },
    },
  };
}

function humanize(value: string): string {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveBetaAssetType(contentType: string): string {
  const normalized = String(contentType || '').toLowerCase();
  if (['carousel', 'pdf', 'slider'].includes(normalized)) return 'carousel';
  if (['banner', 'infographic', 'brand_card'].includes(normalized)) return normalized;
  return 'image';
}

function buildBetaCreatorFallback(input: {
  topic: string;
  contentType: string;
  targetPlatforms: string[];
  audience?: string;
  objective?: string;
  summary?: string;
  creatorCard?: Record<string, unknown>;
  fallbackReason?: string;
}) {
  const assetType = resolveBetaAssetType(input.contentType);
  const platform = input.targetPlatforms[0] || 'linkedin';
  const audience = input.audience || String(input.creatorCard?.audience || '').trim() || 'the target audience';
  const objective = input.objective || String(input.creatorCard?.objective || '').trim() || 'clarity';
  const overlayText = safeObject(input.creatorCard?.overlay_text);
  const cta = String(overlayText.cta || input.creatorCard?.cta || input.creatorCard?.CTA || '').trim() || 'Learn more';
  const visualIntent = String(input.creatorCard?.visual_intent || input.creatorCard?.constraints || input.summary || '').trim();
  const hook = String(overlayText.hook || '').trim() || `${humanize(platform)} ${humanize(input.contentType)}: ${input.topic}`;
  const headline = String(overlayText.headline || '').trim() || hook;
  const body = `Frame the idea for ${audience} with ${objective} as the primary goal. ${visualIntent ? `Use this direction: ${visualIntent}` : 'Keep the message concrete, useful, and platform-native.'}`;
  const slides = assetType === 'carousel'
    ? [
        { slide_number: 1, role: 'hook', headline: hook, body_text: `Open with the most urgent audience problem behind ${input.topic}.` },
        { slide_number: 2, role: 'context', headline: 'Why it matters now', body_text: body },
        { slide_number: 3, role: 'insight', headline: 'The practical shift', body_text: 'Show the before-and-after behavior or decision the audience should understand.' },
        { slide_number: 4, role: 'proof', headline: 'Make it credible', body_text: 'Add a concrete signal, example, or operational detail that makes the point feel earned.' },
        { slide_number: 5, role: 'cta', headline: cta, body_text: 'Close with one specific next step.' },
      ]
    : [];

  return {
    intent_type: 'creator',
    asset_type: assetType,
    asset_instruction: {
      blueprint: {
        headline: hook,
        body,
        cta,
        slides,
      },
      structure: assetType === 'carousel' ? 'slide_series' : 'single_visual',
      visual_style: String(input.creatorCard?.tone || input.creatorCard?.brand_generation_mode || 'creator-led'),
      template_id: `beta-fallback-${assetType}`,
    },
    asset_payload: {
      asset_kind: assetType,
      visual_descriptor: {
        headline,
        visual_description: body,
      },
      overlay_text: overlayText,
      ...(slides.length ? { slides, slide_count: slides.length } : {}),
      media_bundle: {
        metadata: {
          generated_by: 'creator-beta-fallback',
          placeholder: true,
          overlay_text: overlayText,
          platform,
        },
      },
    },
    packaging: {
      caption: `${hook}\n\n${body}\n\n${cta}`,
      hashtags: ['#CreatorContent', `#${humanize(platform).replace(/\s+/g, '')}`, '#Authority'],
      cta,
      meta_description: `${input.topic} creator direction for ${audience}.`.slice(0, 160),
      keywords: [input.topic, input.contentType, platform].filter(Boolean),
      platform_variants: {},
    },
    generation_prompt: `creator-fallback:${assetType}:${input.topic}`,
    metadata: {
      beta_fallback: true,
      fallback_reason: input.fallbackReason ? input.fallbackReason.slice(0, 220) : 'unknown',
      content_type: input.contentType,
      target_platforms: input.targetPlatforms,
    },
  };
}

/**
 * Theme Treatment generator. Thin delegation to the shared service
 * {@link backend/services/creatorThemeTreatmentService.ts} so the BOLT
 * runtime and this standalone API path produce identical blueprints,
 * including the marketing package and creator guidance bundle.
 */
async function generateThemeTreatment(input: {
  companyId: string;
  userId: string | null;
  topic: string;
  contentType: string;
  targetPlatforms: string[];
  audience?: string;
  objective?: string;
  summary?: string;
  creatorCard: Record<string, unknown>;
}): Promise<any> {
  const { generateCreatorThemeTreatment } = await import('../../../../backend/services/creatorThemeTreatmentService');
  return generateCreatorThemeTreatment({
    companyId: input.companyId,
    userId: input.userId,
    topic: input.topic,
    contentType: input.contentType,
    targetPlatforms: input.targetPlatforms,
    audience: input.audience,
    objective: input.objective,
    summary: input.summary,
    creatorCard: input.creatorCard,
  });
}

/**
 * Returns true for text-only creator formats (post / thread) where the
 * canonical asset family is 'text' and the renderer doesn't apply. These
 * paths produce platform-ready text content directly via LLM — caption,
 * hashtags, CTA, and (for threads) a connected segment sequence.
 */
function isTextOnlyContentType(contentType: string): boolean {
  const normalized = String(contentType || '').trim().toLowerCase();
  return normalized === 'post' || normalized === 'thread';
}

async function generateTextContent(input: {
  companyId: string;
  userId: string | null;
  topic: string;
  contentType: string;
  targetPlatforms: string[];
  audience?: string;
  objective?: string;
  summary?: string;
  creatorCard: Record<string, unknown>;
}): Promise<any> {
  const [{ runCompletionWithOperation }, { config: appConfig }] = await Promise.all([
    import('../../../../backend/services/aiGateway'),
    import('@/config'),
  ]);

  const isThread = String(input.contentType).toLowerCase() === 'thread';
  const platform = (input.targetPlatforms[0] || 'linkedin').toLowerCase();
  const subtype = String(input.creatorCard.subtype || '').trim();
  const tone = String(input.creatorCard.tone || '').trim();
  const cta = String(input.creatorCard.cta || '').trim();
  const constraints = String(input.creatorCard.constraints || '').trim();

  const platformHints: Record<string, string> = {
    linkedin: 'LinkedIn: professional voice, 1-3 short paragraphs, 3-5 hashtags, end with one clear ask.',
    x: 'X / Twitter: under 280 chars, sharp hook, no formatting, 1-2 hashtags max.',
    facebook: 'Facebook: conversational, 1-2 paragraphs, 3-4 hashtags, encourage replies.',
    threads: 'Threads: concise, casual, optional hashtags, lead with the hook.',
    reddit: 'Reddit: no marketing language, lead with curiosity or insight, avoid emojis/hashtags.',
    instagram: 'Instagram: visual hook in opening line, line breaks for scanability, 5-10 hashtags.',
  };

  const systemPrompt = isThread
    ? `You are a senior social copywriter specialized in connected ${platform} threads. You produce native, scroll-stopping thread sequences with a strong hook, 3-7 progression posts, and a clear CTA close. Return JSON only.

Output JSON shape:
{
  "hook_segment": "first post in the thread — strongest scroll-stop line",
  "segments": ["post 2", "post 3", ...],
  "cta_segment": "final CTA close",
  "caption": "the FULL combined thread as one block, segments separated by double newlines",
  "hashtags": ["tag1", "tag2"],
  "meta_description": "60-160 char summary"
}`
    : `You are a senior social copywriter specialized in native ${platform} posts. You produce scroll-stopping, platform-native content with a strong hook, useful body, and one clear CTA. Return JSON only.

Output JSON shape:
{
  "hook": "scroll-stop opening line",
  "body": "main post body (markdown-light, line breaks ok)",
  "cta_line": "single CTA line",
  "caption": "the FULL post text — hook + body + cta as one block",
  "hashtags": ["tag1", "tag2"],
  "meta_description": "60-160 char summary"
}`;

  const userPrompt = `Generate a ${input.contentType} for ${platform}.

Topic: ${input.topic}
Audience: ${input.audience || 'general professional audience'}
Objective: ${input.objective || 'awareness'}
${subtype ? `Subtype: ${subtype}` : ''}
${tone ? `Tone: ${tone}` : ''}
${cta ? `Desired CTA: ${cta}` : ''}
${input.summary ? `Key message: ${input.summary}` : ''}
${constraints ? `Constraints: ${constraints}` : ''}

Platform guidance: ${platformHints[platform] || 'Match the conventions of the target platform.'}

Avoid generic marketing adjectives (premium, game-changing, unlock, elevate) unless the user supplied that language. Lead with specifics. Return JSON only.`;

  const result = await runCompletionWithOperation({
    companyId: input.companyId,
    model: appConfig.OPENAI_MODEL,
    operation: `creator_text_content_${input.contentType}`,
    temperature: 0.5,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const parsed = JSON.parse(String(result?.output || '{}')) as Record<string, unknown>;
  const caption = String(parsed.caption || '').trim()
    || (isThread
        ? [parsed.hook_segment, ...(Array.isArray(parsed.segments) ? parsed.segments : []), parsed.cta_segment].filter(Boolean).map(String).join('\n\n')
        : [parsed.hook, parsed.body, parsed.cta_line].filter(Boolean).map(String).join('\n\n'));
  const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String).filter(Boolean) : [];
  const metaDescription = String(parsed.meta_description || '').trim() || caption.slice(0, 160);
  const threadSegments = isThread && Array.isArray(parsed.segments)
    ? parsed.segments.map(String).filter(Boolean)
    : [];

  return {
    intent_type: 'creator',
    asset_type: 'image',
    asset_instruction: {
      blueprint: parsed,
      structure: { output_shape: isThread ? 'thread_sequence' : 'single_post' },
      visual_style: tone || 'native_platform_voice',
      template_id: `text-content-${input.contentType}`,
    },
    asset_payload: {
      asset_kind: 'text_content',
      content_type: input.contentType,
      hook: String(parsed.hook || parsed.hook_segment || '').trim(),
      body: String(parsed.body || '').trim(),
      cta_line: String(parsed.cta_line || parsed.cta_segment || cta || '').trim(),
      thread_segments: threadSegments,
      media_bundle: {
        metadata: {
          preview_kind: 'text_content',
          content_type: input.contentType,
          platform,
          generated_by: 'creator_text_content',
        },
      },
    },
    packaging: {
      caption,
      hashtags,
      cta: String(parsed.cta_line || parsed.cta_segment || cta || 'Learn more'),
      meta_description: metaDescription,
      keywords: [input.topic, input.contentType, platform].filter(Boolean),
      platform_variants: {},
    },
    generation_prompt: `creator-text-content:${input.contentType}:${input.topic}`,
    metadata: {
      content_type: input.contentType,
      target_platforms: input.targetPlatforms,
      preview_kind: 'text_content',
      text_only: true,
    },
  };
}

function shouldUseCreatorFallback(error: unknown): boolean {
  const anyError = error as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
  const code = String(anyError?.code || '').toUpperCase();
  const message = String(anyError?.message || (error instanceof Error ? error.message : '') || '').toLowerCase();
  const status = Number(anyError?.statusCode ?? anyError?.status ?? 0);

  if (code === 'PLAN_LIMIT_EXCEEDED' || code === 'COST_BLOCKED') return false;
  if (status === 401 || status === 403 || status === 402) return false;
  if (
    message.includes('pricingservice') ||
    message.includes('credit_rate_usd') ||
    message.includes('monthly llm token limit') ||
    message.includes('cost_blocked') ||
    message.includes('plan_limit_exceeded') ||
    message.includes('missing openai_api_key')
  ) {
    return false;
  }

  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await resolveUserContext(req);
  const body = (req.body || {}) as GenerateCreatorBody;
  const companyId = String(body.company_id || user?.defaultCompanyId || '').trim();
  const topic = String(body.topic || '').trim();
  const contentType = resolveRequestedContentType({
    creatorType: body.creator_type,
    contentType: body.content_type,
  });
  const targetPlatforms = Array.isArray(body.target_platforms)
    ? body.target_platforms.map((platform) => String(platform || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const creatorCardInput = safeObject(body.creator_card);
  const normalizedAttachment = normalizeCreatorCardForAttachment({
    creatorCard: creatorCardInput,
    creatorType: String(body.creator_type || ''),
    contentType,
  });
  if (normalizedAttachment.errors.length > 0) {
    return res.status(400).json({
      error: 'Invalid Writer attachment payload',
      details: normalizedAttachment.errors,
    });
  }
  const creatorCard = normalizedAttachment.creatorCard;

  if (!companyId) {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!topic) {
    return res.status(400).json({ error: 'topic required' });
  }
  if (!contentType) {
    return res.status(400).json({ error: 'content_type required' });
  }
  if (targetPlatforms.length === 0) {
    return res.status(400).json({ error: 'target_platforms required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // Phase 2 Task 4 (Batch D): single-charge per generate request. The three
  // content paths below are mutually exclusive → exactly ONE charge. Internal
  // fan-out (generateFromIntent + adaptForPlatform) and the durable render
  // queue do NOT self-charge (verified: 0 credit calls) → no nesting/double-
  // charge. OFF (default) = byte-identical passthrough.
  const creatorRefId = createHash('sha256')
    .update([companyId, contentType, topic, targetPlatforms.join(',')].join('|'))
    .digest('hex')
    .slice(0, 40);
  const chargeCreator = <T>(run: () => Promise<T>): Promise<T> =>
    wirePhase2Route<T>({
      surface:        'command-center.creator-content.generate',
      organizationId: companyId,
      action:         'creator_content',
      referenceType:  'creator_content',
      referenceId:    creatorRefId,
      run,
    });

  // Text-only formats (post / thread) take a separate path: they produce
  // platform-ready text content directly via LLM. The existing creator
  // engine throws for these (canonical_asset_family: 'text', ai_renderable:
  // false), so we short-circuit to a dedicated text generator that returns
  // a CanonicalCreatorOutput-shaped response.
  if (isTextOnlyContentType(contentType)) {
    try {
      const textOutput = await withCreatorTimeout(
        chargeCreator(() => generateTextContent({
          companyId,
          userId: user?.userId ?? null,
          topic,
          contentType,
          targetPlatforms,
          audience: String(body.audience || '').trim() || undefined,
          objective: String(body.objective || '').trim() || undefined,
          summary: String(body.summary || '').trim() || undefined,
          creatorCard,
        })),
        'Creator text content',
      );
      return res.status(200).json({
        success: true,
        primary_platform: targetPlatforms[0],
        intelligence_brief: null,
        output: textOutput,
      });
    } catch (error) {
      if (error instanceof PaymentRequiredError) {
        return res.status(402).json({ error: error.message, code: error.code });
      }
      const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
      return res.status(statusCode).json({
        error: error instanceof Error ? error.message : 'Failed to generate text content',
      });
    }
  }

  // Guidance-only formats (video / reel / short / podcast) take a separate
  // path: they produce a structured Theme Treatment (scenes, hook, audio
  // cues, CTA, platform notes) and skip the asset renderer entirely. The
  // response shape matches the renderable path so the frontend can switch
  // on `preview_kind === 'theme_treatment'` to render the scene breakdown.
  if (isGuidanceOnlyContentType(contentType)) {
    try {
      const treatment = await withCreatorTimeout(
        chargeCreator(() => generateThemeTreatment({
          companyId,
          userId: user?.userId ?? null,
          topic,
          contentType,
          targetPlatforms,
          audience: String(body.audience || '').trim() || undefined,
          objective: String(body.objective || '').trim() || undefined,
          summary: String(body.summary || '').trim() || undefined,
          creatorCard,
        })),
        'Creator theme treatment',
      );
      return res.status(200).json({
        success: true,
        primary_platform: targetPlatforms[0],
        intelligence_brief: null,
        output: treatment,
      });
    } catch (error) {
      if (error instanceof PaymentRequiredError) {
        return res.status(402).json({ error: error.message, code: error.code });
      }
      const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
      return res.status(statusCode).json({
        error: error instanceof Error ? error.message : 'Failed to generate theme treatment',
      });
    }
  }

  try {
    const intelligenceBrief = null;
    const [{ createCreatorExecutionEngine }, { renderAsset }] = await Promise.all([
      import('../../../../backend/services/executionEngines/creatorExecutionEngine'),
      import('../../../../backend/services/creatorAssetRenderer'),
    ]);
    const creatorEngine = createCreatorExecutionEngine();
    const primaryPlatform = targetPlatforms[0];
    const output = await withCreatorTimeout(chargeCreator(() => (async () => {
      const generated = await measureCreatorDuration('creator_generate_intent', {
        contentType,
        platform: primaryPlatform,
      }, () => creatorEngine.generateFromIntent({
        campaignId: `creator-content-${Date.now()}`,
        companyId,
        userId: user?.userId ?? null,
        topic,
        contentType,
        targetPlatforms,
        audience: String(body.audience || '').trim() || undefined,
        objective: String(body.objective || '').trim() || undefined,
        summary: String(body.summary || '').trim() || undefined,
        creatorCard,
        enrichedIntent: intelligenceBrief ? {
          analytics_intelligence: {
            content_type: intelligenceBrief.content_type,
            readiness: intelligenceBrief.readiness,
            prompt_block: intelligenceBrief.prompt_block,
            low_confidence_note: intelligenceBrief.low_confidence_note,
            primitives: intelligenceBrief.primitives,
            recommended_uses: intelligenceBrief.recommended_uses,
          },
        } : undefined,
      }));

      const adapted = await measureCreatorDuration('creator_adapt_platform', {
        contentType,
        platform: primaryPlatform,
      }, () => creatorEngine.adaptForPlatform(generated, primaryPlatform));
      const renderInput = safeObject(adapted.asset_payload);
      if (['carousel', 'pdf', 'slider', 'infographic'].includes(contentType)) {
        const auditId = createCreatorAuditId({ companyId, contentType, platform: primaryPlatform, renderInput });
        const renderJob = await enqueueDurableCreatorRenderJob({
          idempotencyKey: `creator-render:${companyId}:${contentType}:${primaryPlatform}:${JSON.stringify(renderInput).slice(0, 500)}`,
          renderer: contentType as 'carousel' | 'pdf' | 'slider' | 'infographic',
          auditId,
          timeoutMs: 180_000,
          maxAttempts: 3,
          payload: {
            assetPayload: renderInput,
            options: {
              campaignId: null,
              userId: user?.userId ?? null,
              companyId,
            },
          },
        });
        return mergeRenderedMedia(adapted, {
          metadata: {
            render_async: true,
            render_job: renderJob,
            render_audit_id: auditId,
          },
        });
      }
      const rendered = await measureCreatorDuration('creator_render_asset_api', {
        contentType,
        platform: primaryPlatform,
      }, () => renderAsset(renderInput, {
        campaignId: null,
        userId: user?.userId ?? null,
        companyId,
      }));
      return mergeRenderedMedia(adapted, rendered);
    })()), 'Creator generation').catch((error) => {
      if (error instanceof PaymentRequiredError) {
        throw error; // surface enforcement as 402, never fall back to free output
      }
      if (normalizedAttachment.compositionIntent) {
        throw error;
      }
      if (!shouldUseCreatorFallback(error)) {
        throw error;
      }
      console.warn('[creator-content][fallback-output-used]', {
        company_id: companyId,
        content_type: contentType,
        message: error instanceof Error ? error.message : String(error),
      });
      return buildBetaCreatorFallback({
        topic,
        contentType,
        targetPlatforms,
        audience: String(body.audience || '').trim() || undefined,
        objective: String(body.objective || '').trim() || undefined,
        summary: String(body.summary || '').trim() || undefined,
        creatorCard,
        fallbackReason: error instanceof Error ? error.message : String(error),
      });
    });

    return res.status(200).json({
      success: true,
      primary_platform: primaryPlatform,
      intelligence_brief: intelligenceBrief,
      output,
    });
  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      return res.status(402).json({ error: error.message, code: error.code });
    }
    const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;
    return res.status(statusCode).json({
      error: error instanceof Error ? error.message : 'Failed to generate creator content',
    });
  }
}
