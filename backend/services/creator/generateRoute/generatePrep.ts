/** Part 1/2 of generate.ts — verbatim split (barrel preserved; importers unchanged). */
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
  copyPolicyForIntent,
  SUPPORTING_VISUAL_COPY_POLICY,
  type AssetCompositionIntent,
  type AttachmentMode,
} from '../../../../lib/content/writerCreatorAttachmentContracts';
import { containsDirectThreadDuplication, transformThreadForVisual } from '../../../../lib/content/writerCreatorThreadTransform';
import { detectSemanticThreadDuplication } from '../../../../backend/services/creatorSemanticDuplication';
// PHASE 14N: runCreatorOrchestration is DEFERRED (dynamic-imported in the
// handler) so ensureRenderFonts() configures fontconfig BEFORE the orchestrator
// pulls in creatorAssetRenderer → sharp. Mirrors render-inline (which renders
// text correctly). A static import here would load sharp at module-eval, before
// the handler-time font init — the cause of the generate-inline tofu render.
import { ensureRenderFonts } from '../../../../backend/services/creatorRenderFonts';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../../backend/services/billing/phase2EnforcementGate';
import { logPipelineEvent } from '../../../../lib/shared/observability';
import { creatorRuntimeMode } from '../../../../lib/creator-templates/creatorRuntimeFlag';
import { shadowFromRequest } from '../../../../lib/creator-templates/creatorRuntimeV2';
import { getTemplateById } from '../../../../lib/creator-templates/index';
import { mergeBlueprintIntoCreatorCard } from '../../../../lib/creator-outcomes/blueprintRuntimeBridge';


export type GenerateCreatorBody = {
  company_id?: string;
  topic?: string;
  creator_type?: string;
  content_type?: string;
  target_platforms?: string[];
  audience?: string;
  objective?: string;
  summary?: string;
  creator_card?: Record<string, unknown>;
  /** CREATOR-106: the chosen Marketing Sample (blueprint) id, sent at top level by the
   *  editor (?blueprint=…). Threaded onto the creator_card so style/colour/layout +
   *  the infographic variant align with the selected sample. */
  blueprint_id?: string;
  /** Final Corrective Pass — P1-1. When provided, the generation path
   *  fetches the campaign's persisted variant_strategy and applies it
   *  via the campaignVariantApplier helper. Absence = unchanged behavior. */
  campaign_id?: string;
  /**
   * The Creator draft whose attached assets this generation should use.
   *
   * `composition_asset_references` identifies its owner by a TYPE plus an ID
   * because no canonical composition table exists yet, so the server has no way
   * to find a draft's attachments without being told which draft it is — the
   * gap that left the CONDITION resolver unreachable.
   *
   * A LOOKUP KEY ONLY. It never influences authorization: the company is taken
   * from the authenticated context and passed to the company-scoped resolver,
   * so a token minted under another tenant resolves to nothing rather than to
   * that tenant's references.
   */
  composition_id?: string;
};

const CREATOR_GENERATION_API_TIMEOUT_MS = 120_000;

export function withCreatorTimeout<T>(
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

export function resolveRequestedContentType(input: { creatorType?: string; contentType?: string }): string {
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

export function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizeCreatorCardForAttachment(input: {
  creatorCard: Record<string, unknown>;
  creatorType: string;
  contentType: string;
}): { creatorCard: Record<string, unknown>; compositionIntent: AssetCompositionIntent | null; errors: string[] } {
  const rawIntent = safeObject(input.creatorCard.asset_composition_intent);
  const hasWriterIntent = typeof input.creatorCard.attachment_mode === 'string' || Object.keys(rawIntent).length > 0;
  if (!hasWriterIntent) return { creatorCard: input.creatorCard, compositionIntent: null, errors: [] };

  const rawAssetType = normalizeWriterCreatorAssetType(
    rawIntent.assetType ?? input.creatorCard.writer_asset_type ?? input.creatorType ?? input.contentType,
  );
  // Template-wins precedence. When the user explicitly selected a text-bearing
  // image template, the page sends an AUTHORITATIVE overlay (`__template_authoritative`)
  // carrying that template's real copy. Such an asset is a `banner` (on-image
  // text), NOT a clean `supporting_image`. Without this, a `supporting_image`
  // writer session pins `supporting_visual` at the hard taxonomy gate
  // (writerCreatorAttachmentContracts:380), which BLANKS the deterministic
  // overlay — so the image model bakes garbled text + a fake logo instead of the
  // crisp composited headline/sub/CTA + brand mark. Coercing to `banner` lets the
  // renderer composite the deterministic overlay and stays governance-consistent
  // (banner permits on-image text; supporting_image's zero-text profile would
  // hard-reject it at schedule time).
  const rawOverlayForType = safeObject(input.creatorCard.overlay_text);
  const templateAuthoritativeText =
    rawOverlayForType.__template_authoritative === true &&
    Object.entries(rawOverlayForType).some(
      ([key, value]) => key !== '__template_authoritative' && typeof value === 'string' && value.trim().length > 0,
    );
  // BETA-013 — an EXPLICIT POST + IMAGE selection (supporting_visual) is authoritative: it must
  // stay a clean supporting_image and NOT be coerced into a text-bearing banner, even when a
  // template supplies authoritative overlay copy. Without this guard, choosing POST + IMAGE while
  // a text template is attached silently produced a banner → embedded_copy → the overlay renderer
  // baked headline/CTA/decoration onto what the user asked to be a clean photograph. The
  // template-wins→banner coercion still applies when the user did NOT explicitly pick POST + IMAGE.
  const explicitSupportingVisual =
    (rawIntent.attachmentMode ?? input.creatorCard.attachment_mode) === 'supporting_visual';
  // Inverse of BETA-013: when the user EXPLICITLY picked "text inside image"
  // (embedded_copy), a raw supporting_image blanks the overlay (zero-text profile),
  // so honor the explicit request by coercing to a text-bearing banner — the same
  // path as template-authoritative copy. Explicit POST + IMAGE (supporting_visual)
  // still wins and stays a clean photograph.
  const explicitEmbeddedCopy =
    (rawIntent.attachmentMode ?? input.creatorCard.attachment_mode) === 'embedded_copy';
  const assetType =
    rawAssetType === 'supporting_image' && !explicitSupportingVisual && (templateAuthoritativeText || explicitEmbeddedCopy)
      ? 'banner'
      : rawAssetType;
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
  // "Text inside image" (embedded_copy) with a CTA IS the intent to embed that CTA — the
  // workspace / curated brief form collects the CTA but does not assert copy-policy flags, so
  // the CTA would otherwise be rejected ("embedded_copy CTA requires explicit copy policy
  // allowCTA"). Treat a present CTA as allowCTA for embedded_copy. Supporting_visual is unaffected
  // (its CTA is stripped above and its policy is contract-fixed).
  const ctaPresent = String(
    input.creatorCard.cta ?? input.creatorCard.CTA ?? rawOverlayTextForSignals.cta ?? '',
  ).trim().length > 0;
  // A CTA present for text-inside-image (embedded_copy) IS the intent to embed it — allow it even
  // when the workspace/curated brief flow sent no copy-policy flags. Applies to BOTH branches:
  // the explicit-policy branch AND the default branch (which previously fell back to
  // copyPolicyForIntent with allowCTA:false, re-triggering the rejection).
  const derivedAllowCTA = rawCopyPolicy.allowCTA === true || (attachmentMode === 'embedded_copy' && ctaPresent);
  const compositionIntent = buildAssetCompositionIntent({
    assetType,
    attachmentMode,
    sourceTextTransform,
    copyPolicy: isSupportingVisualMode
      ? SUPPORTING_VISUAL_COPY_POLICY
      : rawCopyPolicy.sourceTextTransform
        ? {
            allowHeadline: rawCopyPolicy.allowHeadline === true,
            allowKeyInsight: rawCopyPolicy.allowKeyInsight === true,
            allowCTA: derivedAllowCTA,
            sourceTextTransform,
          }
        : attachmentMode === 'embedded_copy'
          ? copyPolicyForIntent({ attachmentMode, sourceTextTransform, allowCTA: derivedAllowCTA })
          : undefined,
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

export function buildBetaCreatorFallback(input: {
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
export async function generateThemeTreatment(input: {
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
export async function resolveGovernanceForLane(input: {
  companyId: string;
  contentType: string;
  creatorCard: Record<string, unknown>;
  lane: 'image' | 'carousel' | 'infographic';
  actorUserId?: string | null;
}): Promise<any> {
  try {
    const { getCanonicalProfile: getProfile } = await import('@/backend/services/context/canonicalProfileAdapter');
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
