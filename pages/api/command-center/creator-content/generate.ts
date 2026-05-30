import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { measureCreatorDuration } from '../../../../backend/services/creatorRuntimeMetrics';
import { isGuidanceOnlyContentType } from '../../../../backend/services/creatorTemplateRegistryService';
import {
  buildAssetCompositionIntent,
  normalizeAttachmentMode,
  normalizeSourceTextTransform,
  normalizeWriterCreatorAssetType,
  resolveAttachmentModeFromIntent,
  validateAttachmentPayload,
  SUPPORTING_VISUAL_COPY_POLICY,
  type AssetCompositionIntent,
  type AttachmentMode,
} from '../../../../lib/content/writerCreatorAttachmentContracts';
import { containsDirectThreadDuplication, transformThreadForVisual } from '../../../../lib/content/writerCreatorThreadTransform';
import { detectSemanticThreadDuplication } from '../../../../backend/services/creatorSemanticDuplication';
import { runCreatorOrchestration } from '../../../../backend/services/creator/creatorOrchestrator';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../../backend/services/billing/phase2EnforcementGate';
import { logPipelineEvent } from '../../../../lib/shared/observability';

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
  /** Final Corrective Pass — P1-1. When provided, the generation path
   *  fetches the campaign's persisted variant_strategy and applies it
   *  via the campaignVariantApplier helper. Absence = unchanged behavior. */
  campaign_id?: string;
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
  const requestedMode = normalizeAttachmentMode(rawIntent.attachmentMode ?? input.creatorCard.attachment_mode);
  // Phase 2 fix — resolve attachment_mode from payload signals BEFORE
  // validation. The validator is correct; the writer's mode default
  // was too aggressive (supporting_visual for any image-class asset),
  // which collided with paragraph source text, overlay-text fields,
  // CTA, typography hints, and typography-bearing asset types. The
  // resolver coerces supporting_visual → embedded_copy whenever any
  // embedded-copy signal is present.
  const rawOverlayTextForSignals = safeObject(input.creatorCard.overlay_text);
  const sourceContentForSignals = safeObject(input.creatorCard.source_content);
  const rawSourceTextTransform = normalizeSourceTextTransform(
    safeObject(rawIntent.copyPolicy).sourceTextTransform
      ?? safeObject(input.creatorCard.copy_policy).sourceTextTransform
      ?? input.creatorCard.source_text_transform,
    'none',
  );
  const modeResolution = resolveAttachmentModeFromIntent({
    assetType,
    requestedMode,
    sourceText: typeof sourceContentForSignals.snippet === 'string' ? sourceContentForSignals.snippet : null,
    overlayText: rawOverlayTextForSignals,
    cta: input.creatorCard.cta ?? input.creatorCard.CTA ?? rawOverlayTextForSignals.cta,
    sourceTextTransform: rawSourceTextTransform,
    freeFormIntent: [
      typeof input.creatorCard.visual_intent === 'string' ? input.creatorCard.visual_intent : null,
      typeof input.creatorCard.constraints === 'string' ? input.creatorCard.constraints : null,
      typeof input.creatorCard.tone === 'string' ? input.creatorCard.tone : null,
      typeof input.creatorCard.brand_generation_mode === 'string' ? input.creatorCard.brand_generation_mode : null,
    ],
  });
  const attachmentMode: AttachmentMode = modeResolution.mode;
  if (modeResolution.coerced) {
    logPipelineEvent('writer.attachment_mode_coerced', 'info', {
      asset_type: assetType,
      requested_mode: requestedMode,
      resolved_mode: attachmentMode,
      signals: modeResolution.signals.join(','),
      content_type: String(input.contentType ?? 'unset'),
      source_type: String(sourceContentForSignals.source_type ?? 'unset'),
    }, { dedupeKey: `coerce.${assetType}.${modeResolution.signals.join(':')}`, throttleMs: 10_000 });
  }
  const rawCopyPolicy = safeObject(input.creatorCard.copy_policy);
  // supporting_visual is a contract-fixed mode per copyPolicyForIntent
  // (writerCreatorAttachmentContracts.ts:199): copyPolicy MUST be
  // SUPPORTING_VISUAL_COPY_POLICY (all-false flags + sourceTextTransform='none'),
  // regardless of what the UI sent. Coercing here matches the same intent the
  // recent overlay/CTA scrub captured — the UI brief form collects fields
  // intended for the source post, not for the visual asset. Without this
  // coercion, raw copy_policy.allowCTA / allowHeadline / allowKeyInsight or a
  // duplication-transform value leaks through and trips validator rules
  // #4 (thread duplication transforms), #5 (allowCTA), #6 (allow embedded copy).
  const isSupportingVisualMode = attachmentMode === 'supporting_visual';
  const sourceTextTransform = isSupportingVisualMode
    ? SUPPORTING_VISUAL_COPY_POLICY.sourceTextTransform
    : normalizeSourceTextTransform(
        safeObject(rawIntent.copyPolicy).sourceTextTransform ?? rawCopyPolicy.sourceTextTransform ?? input.creatorCard.source_text_transform,
      );
  const compositionIntent = buildAssetCompositionIntent({
    assetType,
    attachmentMode,
    sourceTextTransform,
    copyPolicy: isSupportingVisualMode
      ? SUPPORTING_VISUAL_COPY_POLICY
      : (rawCopyPolicy.sourceTextTransform
          ? {
              allowHeadline: rawCopyPolicy.allowHeadline === true,
              allowKeyInsight: rawCopyPolicy.allowKeyInsight === true,
              allowCTA: rawCopyPolicy.allowCTA === true,
              sourceTextTransform,
            }
          : undefined),
  });
  const rawOverlayText = safeObject(input.creatorCard.overlay_text);
  const sourceContent = safeObject(input.creatorCard.source_content);
  // supporting_visual is a CTA/overlay-free mode by contract — any CTA the
  // brief form collected is for the source post, not for embedding on the
  // visual. Strip it BEFORE validation so the user isn't blocked just for
  // filling in the CTA field; we'd be deleting it after validation anyway.
  const isSupportingVisual = attachmentMode === 'supporting_visual';
  const overlayText = isSupportingVisual ? {} : rawOverlayText;
  const ctaForValidation = isSupportingVisual
    ? undefined
    : (input.creatorCard.cta ?? input.creatorCard.CTA ?? rawOverlayText.cta);
  const validation = validateAttachmentPayload({
    attachmentMode,
    assetType,
    copyPolicy: compositionIntent.copyPolicy,
    overlayText,
    cta: ctaForValidation,
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

// Phase 3 cleanup — local `mergeRenderedMedia` was reachable only from
// the pre-orchestrator render path. The orchestrator owns merging now;
// this helper has been removed. `safeObject` remains because the
// attachment-validation path uses it.

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
  // Creator Governance Parity For Text Content — Phase 4. Theme
  // treatments now receive the same governance context the visual
  // composer + text orchestrator do. Best-effort: resolution failure
  // leaves `governance=null` and the prior treatment output is
  // unchanged.
  const governance = await resolveGovernanceForLane({
    companyId: input.companyId,
    contentType: input.contentType,
    creatorCard: input.creatorCard,
    lane: 'image', // theme treatments share the image lane policy
    actorUserId: input.userId,
  });
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
    governance,
  });
}

/**
 * Creator Governance Parity For Text Content — shared resolver.
 *
 * Reads the company's persisted profile and builds the governance
 * prompt context for the given lane + selected strategy slug. Used
 * by text + theme-treatment paths so they consume the SAME helper
 * the visual renderer uses (no second governance system).
 *
 * Best-effort — returns null on any failure so callers fall through
 * to the prior no-governance behavior.
 */
async function resolveGovernanceForLane(input: {
  companyId: string;
  contentType: string;
  creatorCard: Record<string, unknown>;
  lane: 'image' | 'carousel' | 'infographic';
  actorUserId?: string | null;
}): Promise<any> {
  try {
    const { getProfile } = await import('../../../../backend/services/companyProfileService');
    const { buildGovernancePromptContext } = await import('../../../../backend/services/creator/strategyGovernancePromptContext');
    const { maybeAuditRestrictedStrategySelection } = await import('../../../../backend/services/creator/governanceItemEnricher');
    const profile = await getProfile(input.companyId, { autoRefine: false });
    if (!profile) return null;
    const selectedRaw = String(
      input.creatorCard?.purpose_key
        || input.creatorCard?.infographic_layout
        || input.creatorCard?.subtype
        || ''
    ).trim() || null;
    const context = buildGovernancePromptContext({
      companyContext: {
        industry: profile.industry ?? null,
        industry_list: profile.industry_list ?? null,
        category: profile.category ?? null,
        category_list: profile.category_list ?? null,
      },
      contentType: input.lane,
      selectedStrategy: selectedRaw,
    });
    // Closure Pass — Phase 5. Fire the canonical audit event when the
    // Direct API / theme-treatment / text path selects a restricted
    // strategy. Picker-mediated selections already fire via the
    // /api/creator-intelligence/restricted-strategy-audit endpoint.
    maybeAuditRestrictedStrategySelection({
      context,
      companyId: input.companyId,
      contentType: input.contentType,
      actorUserId: input.actorUserId ?? null,
    });
    return context;
  } catch {
    return null;
  }
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
  const isThread = String(input.contentType).toLowerCase() === 'thread';
  const isPostOrThread = isThread || String(input.contentType).toLowerCase() === 'post';
  const platform = (input.targetPlatforms[0] || 'linkedin').toLowerCase();

  // Phase 1 unification — post/thread text generation routes through
  // the shared textGenerationOrchestrator (which delegates to the
  // canonical contentGenerationPipeline). Output is reshaped into the
  // Direct API's existing CanonicalCreatorOutput-shaped response so
  // clients (writer pages, command center route, etc.) see no shape
  // change.
  if (isPostOrThread) {
    const { runTextGeneration } = await import('../../../../backend/services/content/textGenerationOrchestrator');
    const subtype = String(input.creatorCard.subtype || '').trim();
    const tone = String(input.creatorCard.tone || '').trim();
    const cta = String(input.creatorCard.cta || '').trim();
    const constraints = String(input.creatorCard.constraints || '').trim();
    const extraInstruction = [
      subtype ? `Subtype: ${subtype}` : '',
      constraints ? `Constraints: ${constraints}` : '',
      input.summary ? `Key message: ${input.summary}` : '',
    ].filter(Boolean).join('\n\n');
    // Creator Governance Parity For Text Content — Phase 2+3. Post +
    // thread paths now receive the same governance context the
    // visual composer does. Best-effort resolution — failure leaves
    // `governance=null` and prior behavior is preserved.
    const governance = await resolveGovernanceForLane({
      companyId: input.companyId,
      contentType: input.contentType,
      creatorCard: input.creatorCard,
      lane: 'image', // post / thread share the image lane policy
      actorUserId: input.userId,
    });
    const orchestrated = await runTextGeneration({
      origin: 'direct-api',
      companyId: input.companyId,
      topic: input.topic,
      contentType: isThread ? 'thread' : 'post',
      targetPlatforms: [platform],
      audience: input.audience,
      objective: input.objective,
      tone: tone || undefined,
      cta: cta || undefined,
      extraInstruction: extraInstruction || undefined,
      creatorCard: input.creatorCard,
      governance,
    });
    const variant = orchestrated.platformVariant;
    const caption = String(variant.generated_content || orchestrated.masterContent.content || '').trim();
    const hashtags = Array.isArray((variant as any).discoverability_meta?.hashtags)
      ? ((variant as any).discoverability_meta.hashtags as unknown[]).map(String).filter(Boolean)
      : [];
    const trace = orchestrated.masterContent?.decision_trace ?? {};
    const segments = isThread && caption ? caption.split(/\n{2,}/).map((s: string) => s.trim()).filter(Boolean) : [];
    return {
      intent_type: 'creator',
      asset_type: 'image',
      asset_instruction: {
        blueprint: orchestrated.masterContent,
        structure: { output_shape: isThread ? 'thread_sequence' : 'single_post' },
        visual_style: tone || 'native_platform_voice',
        template_id: `text-content-${input.contentType}`,
      },
      asset_payload: {
        asset_kind: 'text_content',
        content_type: input.contentType,
        hook: String((trace as any).hook || '').trim(),
        body: caption,
        cta_line: cta,
        thread_segments: segments,
        media_bundle: {
          metadata: {
            preview_kind: 'text_content',
            content_type: input.contentType,
            platform,
            generated_by: 'creator_text_content',
            // Creator Governance Parity For Text Content — Phase 5.
            // Mirror the text orchestrator's governance metadata onto
            // media_bundle.metadata so downstream surfaces read it off
            // creator_attachment_metadata exactly as they do for
            // visual assets. industry='none' / warnings=0 when no
            // governance applied (back-compat).
            governance: orchestrated.governance,
          },
        },
      },
      packaging: {
        caption,
        hashtags,
        cta: cta || 'Learn more',
        meta_description: caption.slice(0, 160),
        keywords: [input.topic, input.contentType, platform].filter(Boolean),
        platform_variants: {},
      },
      generation_prompt: `creator-text-content:${input.contentType}:${input.topic}`,
      metadata: {
        content_type: input.contentType,
        target_platforms: input.targetPlatforms,
        preview_kind: 'text_content',
        text_only: true,
        // Creator Governance Parity For Text Content — Phase 5.
        // Top-level metadata mirror so callers that don't dig into
        // media_bundle still see the governance summary.
        governance: orchestrated.governance,
      },
    };
  }

  // Phase 2 legacy cleanup — the bespoke `runCompletionWithOperation`
  // fallback for non-post/thread content types has been removed. The
  // only callers reaching `generateTextContent` come from the
  // `isTextOnlyContentType` gate above (`post` / `thread`), so any
  // other content-type arriving here is a contract violation. Throw
  // explicitly instead of silently producing a bespoke output that
  // bypassed the canonical pipeline.
  throw new Error(`creator text content: unsupported content type "${input.contentType}" — only post/thread accepted`);
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
    // Phase A-partial — actionable hints surfaced for the residual validator
    // rule that the normalization layer cannot resolve. Today the only such
    // rule is #3 (paragraphLike): the source snippet is too long for a
    // supporting_visual overlay. UI work that proactively warns / offers
    // condense / mode-switch is deferred to its own phase; this hint at
    // least gives the user a clear next step instead of an opaque rejection.
    const hints: string[] = [];
    if (normalizedAttachment.errors.includes('supporting_visual rejects paragraph overlays')) {
      hints.push(
        'The source snippet is too long to render as a supporting visual overlay. ' +
        'Options: (a) shorten the snippet to under ~160 characters with no long paragraph breaks, ' +
        'or (b) switch the attachment mode to "embedded_copy" which is designed for paragraph-length content.',
      );
    }
    // Phase C — writer rejection telemetry. Each rule the validator fired is
    // emitted at warn level so dashboards can show rejection rate by rule
    // (which UX gap is hitting users most). No content/URL/secrets in tags.
    for (const ruleMessage of normalizedAttachment.errors) {
      logPipelineEvent('writer.attachment_rejected', 'warn', {
        rule: ruleMessage,
        attachment_mode: String(creatorCardInput.attachment_mode ?? 'unset'),
        creator_type: String(body.creator_type ?? 'unset'),
        content_type: String(contentType ?? 'unset'),
        source_type: String(safeObject(creatorCardInput.source_content).source_type ?? 'unset'),
      }, { dedupeKey: `writer.${ruleMessage}`, throttleMs: 10_000 });
    }
    return res.status(400).json({
      error: 'Invalid Writer attachment payload',
      details: normalizedAttachment.errors,
      ...(hints.length > 0 ? { hints } : {}),
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
    const primaryPlatform = targetPlatforms[0];

    // Campaign Multi-Variant Execution Completion — Phase 2. When the
    // request carries a campaign_id, resolve the FULL variant plan
    // (not just the first decision). `single_variant`/`best_variant`
    // yield 1 decision; `top_3_variants`/`experiment` yield N. Absent
    // or failed resolution leaves `variantPlan=null` and behavior is
    // unchanged (single-asset path).
    let variantPlan: import('../../../../backend/services/creator/campaignVariantApplier').CampaignVariantPlan | null = null;
    const campaignIdForVariant = typeof body.campaign_id === 'string' && body.campaign_id.trim().length > 0
      ? body.campaign_id.trim()
      : null;
    if (campaignIdForVariant) {
      try {
        const { supabase } = await import('../../../../backend/db/supabaseClient');
        const { data: campaignRow } = await supabase
          .from('campaign_versions')
          .select('campaign_snapshot')
          .eq('campaign_id', campaignIdForVariant)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (campaignRow) {
          const { resolveCampaignVariantPlan } = await import('../../../../backend/services/creator/campaignVariantApplier');
          variantPlan = resolveCampaignVariantPlan({
            campaign: campaignRow,
            companyId,
            campaignId: campaignIdForVariant,
            platform: primaryPlatform,
            creatorId: user?.userId ?? null,
          });
        }
      } catch (error) {
        console.warn('[creator-content][campaign-variant-resolve-failed]', {
          campaign_id: campaignIdForVariant,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Single-asset fast path keeps prior shape; multi-asset path
    // surfaces `generated_assets[]` additively (Phase 6 back-compat).
    const isFanOut = variantPlan !== null && variantPlan.decisions.length > 1;
    const singleAppliedVariant = variantPlan && variantPlan.decisions[0]
      ? {
          strategy_id: variantPlan.strategy_id,
          variant_id: variantPlan.decisions[0].variant_id,
          variant_family: variantPlan.decisions[0].variant_family,
        }
      : null;
    // Phase 2/3/4/5 unification — Direct flow now delegates the
    // generate→adapt→render→persist→FSM chain to the shared
    // creatorOrchestrator. Billing wrapper (chargeCreator) + writer
    // attachment validation + timeout + fallback semantics remain owned
    // by this route. The orchestrator additionally persists a
    // creator_assets row (Phase 5) so the Direct flow becomes
    // standalone usable; response gains `persisted_asset_id` (additive).
    const writerSource = (() => {
      const src = safeObject(creatorCard.source_content);
      const sourceType = src.source_type === 'thread' ? 'thread' as const : src.source_type === 'post' ? 'post' as const : null;
      const sourceId = typeof src.source_id === 'string' ? src.source_id : null;
      return sourceType ? { sourceType, sourceId } : undefined;
    })();
    let persistedAssetIdForResponse: string | null = null;
    let generatedAssetsForResponse: Array<{
      rank: number;
      variant_id: string;
      variant_family: string;
      strategy_id: string;
      experiment_id: string | null;
      persisted_asset_id: string | null;
      ok: boolean;
      error?: string;
    }> | null = null;
    // Direct API Adaptation Parity. Capture the per-asset canonical
    // outputs (single OR fan-out) so the post-generation secondary-
    // platform adaptation loop can iterate over them. Each entry's
    // `output` already carries variant_id / variant_family /
    // strategy_id on media_bundle.metadata (set by the orchestrator's
    // `mergeAppliedVariantIntoOutput`), so attribution survives
    // unchanged through adaptation.
    const successfulOutputs: Array<{
      variantKey: string;
      output: import('../../../../backend/services/executionEngines/types').CanonicalCreatorOutput;
    }> = [];
    const baseOrchestratorInput = {
      campaignId: campaignIdForVariant ?? `creator-content-${Date.now()}`,
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
          content_type: (intelligenceBrief as any).content_type,
          readiness: (intelligenceBrief as any).readiness,
          prompt_block: (intelligenceBrief as any).prompt_block,
          low_confidence_note: (intelligenceBrief as any).low_confidence_note,
          primitives: (intelligenceBrief as any).primitives,
          recommended_uses: (intelligenceBrief as any).recommended_uses,
        },
      } : null,
      origin: 'direct' as const,
      source: writerSource,
      // Match legacy Direct-flow semantics: readiness gating is opt-in
      // for this surface (response was always returned regardless).
      skipReadinessValidation: true,
    };
    const output = await withCreatorTimeout(chargeCreator(() => (async () => {
      // Campaign Multi-Variant Execution Completion — Phase 2.
      // top_3_variants / experiment fan out via the shared runner.
      if (isFanOut && variantPlan) {
        const { runCampaignVariantFanOut } = await import('../../../../backend/services/creator/campaignVariantFanOut');
        const fanOutResult = await measureCreatorDuration('creator_orchestrate', {
          contentType,
          platform: primaryPlatform,
        }, () => runCampaignVariantFanOut({
          plan: variantPlan!,
          orchestratorInput: baseOrchestratorInput,
        }));
        generatedAssetsForResponse = fanOutResult.generated_assets.map((a) => ({
          rank: a.rank,
          variant_id: a.variant_id,
          variant_family: a.variant_family,
          strategy_id: a.strategy_id,
          experiment_id: a.experiment_id,
          persisted_asset_id: a.result?.persistedAssetId ?? null,
          ok: a.ok,
          ...(a.error ? { error: a.error } : {}),
        }));
        for (const a of fanOutResult.generated_assets) {
          if (a.ok && a.result) {
            successfulOutputs.push({ variantKey: a.variant_id, output: a.result.output });
          }
        }
        // Back-compat — return the first successful asset's canonical
        // output as the legacy single-asset payload.
        const first = fanOutResult.generated_asset;
        if (!first || !first.result) {
          throw new Error(`fan-out produced no successful assets (${fanOutResult.generated_assets.length} attempted)`);
        }
        persistedAssetIdForResponse = first.result.persistedAssetId;
        return first.result.output;
      }
      const orchestrated = await measureCreatorDuration('creator_orchestrate', {
        contentType,
        platform: primaryPlatform,
      }, () => runCreatorOrchestration({
        ...baseOrchestratorInput,
        appliedVariant: singleAppliedVariant,
      }));
      persistedAssetIdForResponse = orchestrated.persistedAssetId;
      successfulOutputs.push({
        variantKey: singleAppliedVariant?.variant_id ?? 'primary',
        output: orchestrated.output,
      });
      return orchestrated.output;
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

    // Direct API Adaptation Parity. After generation completes, run
    // secondary-platform adaptation per asset using the SAME
    // `engine.adaptForPlatform` contract the queue worker already uses
    // (creatorContentProcessor.ts). Best-effort + sequential — a
    // single adaptation failure does NOT fail the request:
    //
    //   - reuses the existing engine + adaptation contract (no new
    //     adaptation architecture)
    //   - primary platform is already adapted+rendered by the
    //     orchestrator → marked OK without re-invoking the engine
    //   - secondary platforms run sequentially with try/catch; failures
    //     captured as { ok: false, error }
    //   - attribution survives: each `output` retains its
    //     media_bundle.metadata.applied_variant envelope from the
    //     orchestrator's pre-render merge
    //   - billing unchanged: adaptation is not separately billed in
    //     the queue worker, and is not separately billed here either
    //   - governance unchanged: adaptation does not touch the
    //     enterprise-governance hooks; those fired inside the
    //     orchestrator
    //
    // Runs OUTSIDE the withCreatorTimeout/chargeCreator block — the
    // generation budget (120s) is preserved for the actual generation
    // step. Adaptation extends the response time but never fails it.
    let perAssetAdaptations: Record<string, Record<string, {
      ok: boolean;
      asset_payload?: Record<string, unknown>;
      packaging?: Record<string, unknown>;
      asset_type?: string;
      error?: string;
    }>> = {};
    if (successfulOutputs.length > 0 && targetPlatforms.length > 0) {
      const { createCreatorExecutionEngine } = await import('../../../../backend/services/executionEngines/creatorExecutionEngine');
      const { runDirectApiSecondaryAdaptation } = await import('../../../../backend/services/creator/directApiAdaptationRunner');
      const engine = createCreatorExecutionEngine();
      perAssetAdaptations = await runDirectApiSecondaryAdaptation({
        engine,
        successfulOutputs,
        primaryPlatform,
        secondaryPlatforms: targetPlatforms.slice(1),
        onFailure: ({ variantKey, platform, message }) => {
          console.warn('[creator-content][secondary-adapt-failed]', {
            variant_id: variantKey,
            platform,
            message,
          });
        },
      });
    }

    return res.status(200).json({
      success: true,
      primary_platform: primaryPlatform,
      intelligence_brief: intelligenceBrief,
      output,
      persisted_asset_id: persistedAssetIdForResponse,
      // Direct API Adaptation Parity. Per-asset secondary-platform
      // adaptation status. Single-asset callers see one entry keyed
      // by variant_id (or 'primary' when no variant was applied).
      ...(Object.keys(perAssetAdaptations).length > 0 ? {
        per_asset_adaptations: perAssetAdaptations,
      } : {}),
      // Campaign Multi-Variant Execution Completion — Phase 6.
      // Multi-asset response payload (additive — single-asset callers
      // ignore this field).
      ...(generatedAssetsForResponse ? {
        generated_assets: generatedAssetsForResponse,
        variant_mode: variantPlan?.mode ?? null,
        variant_strategy_id: variantPlan?.strategy_id ?? null,
        experiment_id: variantPlan?.experiment_id ?? null,
      } : {}),
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
