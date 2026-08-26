/** Part 5/10 of creatorAssetRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { config } from '../../config';
import {
  buildCreatorBrandKitMetadata,
  normalizeBrandMark,
  resolveCreatorBrandKit,
  type CreatorBrandKit,
} from './creatorBrandKit';
import { resolveBrand } from './brand/brandRuntime';
import { brandRuntimeToCreatorBrandKit } from './brand/brandRuntimeAdapter';
import { captureImageProviderCost } from './billing/blackHoleCostCapture';
import { recordAssetCredits } from './aiUsageCollector';
import { resolveCostProfile } from './creator/costProfiles';
import { fitSlideArcToCount } from './creator/purposeStrategyRegistry';
import { resolveTemplateStyle } from '../../lib/creator-outcomes/creatorVisualStyleRegistry';
import { isBetaAiRenderMode, createBetaMockImage, BETA_MOCK_MODEL } from './creator/rendering/providers/betaMockRenderProvider';
import { creatorEvent } from './creatorObservation';
import { recordCreatorDuration } from './creatorRuntimeMetrics';
import { validateProviderImageTextSafety } from './creatorImageTextValidation';
import { runCreatorOcr, isLightweightSocialEmbeddedCopy } from './creatorOcrProvider';
import {
  autoCorrectVisualCopy,
  buildPreviewGovernanceWarnings,
  estimateTextAreaPercent,
  resolveAssetGovernanceProfile,
  resolvePlatformVisualProfile,
  scoreCreatorQuality,
  validateVisualGovernance,
} from './creatorAssetGovernance';
import { estimateTextBox, validateLayoutGeometry } from './creatorRenderGeometry';
import {
  assertRenderManifestExportable,
  createRenderManifest,
  synthesizeReadingOrderForOverlay,
  type GovernanceCompatibilityFlags,
} from './creatorRenderManifest';
import { detectSemanticThreadDuplication } from './creatorSemanticDuplication';
import { validateCreatorAccessibility } from './creatorAccessibilityValidation';
import { logPipelineEvent } from '../../lib/shared/observability';
import { persistCreatorValidationManifest } from './creatorRenderPersistence';
import { resolvePlatformGeometryProfile, platformTextBoxY } from './creatorPlatformGeometry';
import { getCreatorRendererRegistration } from './creatorRendererRegistry';
import { composeInfographicCopy } from './creator/infographicCopyComposer';
import {
  infographicChartsEnabled,
  infographicTablesEnabled,
  infographicBackgroundImagesEnabled,
  resolveStructuredCards,
  resolveBackgroundConfig,
  buildBackgroundLayerSvg,
  buildChartCardSvg,
  buildTableCardSvg,
  type InfographicCardBrand,
} from './creator/infographicDataCards';
// Canonical Template visual-language consumption (TEMPLATE-003). The renderer
// reads its visual constants from the resolved family style via the ONE
// canonical resolver. No template / unknown id → the canonical DEFAULT style,
// whose values equal the prior hardcoded constants → byte-identical output.
import {
  resolveTemplate,
  infographicStyleForBlueprint,
  infographicLayoutForBlueprint,
  infographicCompositionForBlueprint,
  semanticStructureForBlueprint,
  semanticSlotCountForBlueprint,
  DEFAULT_IMAGE_STYLE,
  DEFAULT_INFOGRAPHIC_STYLE,
  type InfographicStyleSchema,
  type InfographicEngineGeometry,
  type ImageStyleSchema,
  type CarouselStyleSchema,
  type PresetVariant,
  type CreatorTemplate,
} from '../../lib/creator-templates';
import { registerCuratedSystemTemplates } from '../../lib/creator-outcomes/curatedSystemTemplatesFull';
import { ensureRenderFonts } from './creatorRenderFonts';

// FONT PARITY (PHASE 14J): configure fontconfig to discover the vendored fonts
// BEFORE sharp loads. Every infographic render path — render-inline,
// generate-inline (orchestrator), and the worker — flows through this module,
// so initializing here (the single render chokepoint) gives them all the
// identical font contract render-inline previously had alone. Idempotent +
// never throws; a no-op where system fonts already exist (e.g. the worker).
ensureRenderFonts();
import { type ProviderImageResult, type ConditionDegradation, type ConditionDegradationCategory, IMAGE_BUCKET, DOCUMENT_BUCKET, AI_IMAGE_TIMEOUT_MS, AI_IMAGE_SIZE, bucketReadyByName, safeObject, getOverlayPreset } from './creatorAssetRendererContracts';
import { timeoutAfter, getFirstImageResult, bufferFromRemoteImage, resolveOpenAiImageKey } from './creatorAssetRendererSvg';
// THE feature gate for reference-conditioned generation — one definition,
// shared with the renderer that decides which endpoint it may call.
import { creatorImageReferenceModeEnabled } from './creator/creatorMultimodalReferences';

export async function generateProviderImage(input: {
  prompt: string;
  /** Optional img2img style-reference image URL (curated template showcase).
   *  Used only when CREATOR_IMAGE_REFERENCE_MODE='edit'; conditions generation
   *  via images.edit. Absent/flag-off → plain text-to-image (unchanged). */
  referenceImageUrl?: string | null;
  /**
   * Canonical CONDITION references, already resolved to bytes by
   * `resolveConditionReferenceBytes` — company-scoped, lifecycle-gated,
   * format- and size-checked, and capped at the endpoint's documented maximum.
   *
   * Supplied as BYTES rather than a URL on purpose: these are tenant-owned
   * private objects, and minting a fetchable address for them would trade a
   * tenancy guarantee for convenience. Present → `images.edit` runs with the
   * whole set; absent → behaviour is exactly as before.
   */
  referenceImages?: Array<{ bytes: Buffer; mimeType: string }> | null;
  /**
   * Telemetry-only context. Passed through to `creatorEvent` so a
   * dashboard can pivot provider failures by platform / attachment mode /
   * subtype / creator type. Does NOT affect the prompt or the API call.
   */
  eventContext?: {
    creatorType?: string | null;
    attachmentMode?: string | null;
    subtype?:     string | null;
    platform?:    string | null;
  };
  /**
   * Phase 4.1 Task 1 — deterministic org/exec attribution for provider-cost
   * capture. Telemetry only; never affects the prompt or API call. When
   * organizationId is absent the capture is skipped (no fake attribution).
   */
  attribution?: {
    organizationId?: string | null;
    campaignId?:     string | null;
    userId?:         string | null;
  };
}): Promise<ProviderImageResult> {
  // BETA-020 RULE 4 — Beta AI render mode: deterministic fixture image, zero OpenAI cost. Off by
  // default (BETA_AI_MODE unset) so production is byte-identical; enabled only in the Beta env.
  if (isBetaAiRenderMode()) {
    return { image: { buffer: await createBetaMockImage(input.prompt), model: BETA_MOCK_MODEL } };
  }
  const apiKey = await resolveOpenAiImageKey();
  if (!apiKey) {
    return { image: null, fallbackReason: 'OpenAI API key unavailable' };
  }

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey });
  // Env-selectable model, gpt-image-1 as the known-good fallback. Set
  // OPENAI_IMAGE_MODEL=gpt-image-2 to prefer the newer model (falls back on error).
  const modelCandidates = Array.from(new Set(
    [process.env.OPENAI_IMAGE_MODEL, 'gpt-image-1'].filter((m): m is string => Boolean(m && m.trim())),
  ));
  const failures: string[] = [];

  // ── img2img style reference (flag-gated) ──────────────────────────────────
  // When a curated-template reference image is supplied AND CREATOR_IMAGE_
  // REFERENCE_MODE='edit', condition generation on it via images.edit so the
  // output resembles the picked template. ANY failure (flag off, no ref, fetch
  // 404, edit unsupported, provider error) falls through to the plain
  // text-to-image loop below — it can never break existing generation.
  // THE GATE, applied once and to BOTH sources.
  //
  // The caller already declines to fetch bytes when the gate is off; this is
  // the second, independent check. A caller that hands bytes in directly — a
  // future entry point, a test, a mistake — still cannot reach the endpoint.
  //
  // Canonical references retain their precedence over the showcase URL when the
  // gate IS on: a user's own reference is a stronger signal than a template's
  // style sample. What changed is that they no longer bypass the gate.
  const referenceModeEnabled = creatorImageReferenceModeEnabled();
  const referenceUrl = input.referenceImageUrl;
  const canonicalRefs = referenceModeEnabled ? (input.referenceImages ?? []) : [];

  /*
   * Set ONLY when a canonical CONDITION attempt was made and could not be
   * applied. It rides out on whichever result is finally produced, so the
   * finished asset can say so instead of being indistinguishable from an
   * ordinary generation. Never set when no reference was attempted; never set
   * on a successful edit, because that path returns before it can be.
   *
   * The copy is fixed here rather than derived from the provider's error: a
   * provider message is an internal diagnostic and must not reach a person.
   */
  let conditionDegradation: ConditionDegradation | null = null;
  /*
   * Set on the degraded paths only. The success path returns directly and
   * carries its own value, so this stays null there. Null — never 0 — when no
   * canonical attempt happened, so an absent attempt cannot be mistaken for an
   * instantaneous one.
   */
  let conditionLatencyMs: number | null = null;
  const degradedBy = (category: ConditionDegradationCategory): ConditionDegradation => ({
    status: 'not_applied',
    category,
    userMessage:
      'Your reference image could not be applied, so this result was generated without it. Regenerate to try again.',
  });

  if (canonicalRefs.length > 0) {
    const editModel = modelCandidates[0];
    const editStartedAt = Date.now();
    try {
      const { toFile } = await import('openai');
      // Extension must match the actual bytes/type or the provider rejects the
      // upload — the same constraint the showcase path documents below.
      const files = await Promise.all(canonicalRefs.map(async (r, i) => {
        const ext = r.mimeType.includes('png') ? 'png'
          : (r.mimeType.includes('jpeg') || r.mimeType.includes('jpg')) ? 'jpg' : 'webp';
        return toFile(r.bytes, `reference-${i}.${ext}`, { type: r.mimeType });
      }));
      const editResp = await Promise.race([
        client.images.edit(
          {
            model: editModel,
            // The SDK accepts an array for gpt-image-1 (up to 16); the caller
            // has already capped and rejected beyond that.
            image: files.length === 1 ? files[0] : files,
            prompt: input.prompt,
            n: 1,
            size: AI_IMAGE_SIZE,
            quality: (process.env.CREATOR_IMAGE_REFERENCE_QUALITY || 'low'),
          } as Parameters<typeof client.images.edit>[0],
          { timeout: AI_IMAGE_TIMEOUT_MS },
        ),
        timeoutAfter<Awaited<ReturnType<typeof client.images.edit>>>(AI_IMAGE_TIMEOUT_MS, `Image edit ${editModel}`),
      ]);
      recordCreatorDuration('provider_image', Date.now() - editStartedAt, {
        model: `${editModel}:edit`,
        platform: input.eventContext?.platform ?? null,
        creatorType: input.eventContext?.creatorType ?? null,
        attachmentMode: input.eventContext?.attachmentMode ?? null,
      });
      const first = getFirstImageResult(editResp);
      if (first?.b64_json || first?.url) {
        recordAssetCredits(resolveCostProfile('image').expected_credits_per_asset);
        console.log('[creator-asset-renderer][canonical-reference-edit-ok]', {
          model: editModel, references: files.length, ms: Date.now() - editStartedAt,
        });
        /*
         * The ONLY place `conditionApplied` is set. The showcase branch below
         * produces the same `…:edit` model string, so the model alone can never
         * tell the two apart — emitting from here is what makes the success
         * event mean "canonical CONDITION" and nothing else.
         *
         * Latency is measured to HERE, not to the end of the render: it is the
         * provider edit call, so overlay compositing and upload stay out of it.
         */
        const conditionLatencyMs = Date.now() - editStartedAt;
        if (first.b64_json) {
          return {
            image: { buffer: Buffer.from(first.b64_json, 'base64'), model: `${editModel}:edit` },
            conditionApplied: true,
            conditionLatencyMs,
          };
        }
        return {
          image: { buffer: await bufferFromRemoteImage(first.url as string), model: `${editModel}:edit` },
          conditionApplied: true,
          conditionLatencyMs,
        };
      }
      // The call completed and returned nothing usable. This used to fall out
      // of the try with no log and no marker at all — the one path more silent
      // than the legacy showcase branch it replaced, which does record it.
      conditionDegradation = degradedBy('edit_no_image');
      conditionLatencyMs = Date.now() - editStartedAt;
      console.warn('[creator-asset-renderer][canonical-reference-edit-no-image]', { model: editModel });
    } catch (err) {
      // Falls through to the existing paths below — the fallback itself is the
      // supported behaviour and is deliberately unchanged. What changes is that
      // "conditioning was attempted and did not happen" now survives the request
      // as durable metadata rather than only as a log line.
      conditionDegradation = degradedBy('edit_failed');
      conditionLatencyMs = Date.now() - editStartedAt;
      console.warn('[creator-asset-renderer][canonical-reference-edit-failed]',
        (err as Error)?.message?.slice(0, 200));
    }
  }
  if (referenceModeEnabled && typeof referenceUrl === 'string' && referenceUrl.trim()) {
    const editModel = modelCandidates[0];
    const editStartedAt = Date.now();
    try {
      const { toFile } = await import('openai');
      // HARDEN-005: reference image URL is user/generated content — SSRF-safe download.
      const { safeFetch, readCapped } = await import('../../lib/security/safeFetch');
      const refResp = await safeFetch(referenceUrl.trim(), { method: 'GET' });
      if (!refResp.ok) throw new Error(`reference fetch ${refResp.status}`);
      const refBuf = await readCapped(refResp);
      // Filename extension MUST match the actual bytes/type or the provider can
      // reject it (simulation confirmed matched webp/png work; mismatched fail).
      const refType = refResp.headers.get('content-type') || 'image/webp';
      const refExt = refType.includes('png') ? 'png' : (refType.includes('jpeg') || refType.includes('jpg')) ? 'jpg' : 'webp';
      const refFile = await toFile(refBuf, `reference.${refExt}`, { type: refType });
      const editResp = await Promise.race([
        client.images.edit(
          {
            model: editModel,
            image: refFile,
            prompt: input.prompt,
            n: 1,
            size: AI_IMAGE_SIZE,
            quality: (process.env.CREATOR_IMAGE_REFERENCE_QUALITY || 'low'),
          } as Parameters<typeof client.images.edit>[0],
          { timeout: AI_IMAGE_TIMEOUT_MS },
        ),
        timeoutAfter<Awaited<ReturnType<typeof client.images.edit>>>(AI_IMAGE_TIMEOUT_MS, `Image edit ${editModel}`),
      ]);
      recordCreatorDuration('provider_image', Date.now() - editStartedAt, {
        model: `${editModel}:edit`,
        platform: input.eventContext?.platform ?? null,
        creatorType: input.eventContext?.creatorType ?? null,
        attachmentMode: input.eventContext?.attachmentMode ?? null,
      });
      const firstEdit = getFirstImageResult(editResp);
      if (firstEdit?.b64_json || firstEdit?.url) {
        if (input.attribution?.organizationId) {
          await captureImageProviderCost({
            organizationId: input.attribution.organizationId,
            campaignId: input.attribution.campaignId ?? null,
            userId: input.attribution.userId ?? null,
            processType: 'creator_content',
            provider: 'openai',
            model: editModel,
            imageCount: 1,
            size: AI_IMAGE_SIZE,
            activity: 'creator_image_generation',
            referenceType: 'creator_asset',
            referenceId: input.attribution.campaignId ?? null,
            parentActivityId: input.attribution.campaignId ?? null,
          });
        }
        recordAssetCredits(resolveCostProfile('image').expected_credits_per_asset);
        console.log('[creator-asset-renderer][provider-image-edit-ok]', { model: editModel, ms: Date.now() - editStartedAt });
        // Showcase success. `conditionApplied` is deliberately NOT set here —
        // this branch is not canonical CONDITION. It still forwards any earlier
        // canonical degradation (and its latency), which is Phase 76 behaviour.
        if (firstEdit.b64_json) return { image: { buffer: Buffer.from(firstEdit.b64_json, 'base64'), model: `${editModel}:edit` }, conditionDegradation, conditionLatencyMs };
        return { image: { buffer: await bufferFromRemoteImage(firstEdit.url as string), model: `${editModel}:edit` }, conditionDegradation, conditionLatencyMs };
      }
      failures.push(`${editModel}:edit: no image returned`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${editModel}:edit: ${message}`);
      console.warn('[creator-asset-renderer][provider-image-edit-failed]', { model: editModel, message });
      // fall through to the plain generation loop below
    }
  }

  for (const model of modelCandidates) {
    const providerStartedAt = Date.now();
    try {
      const request = model === 'dall-e-3'
        ? {
            model,
            prompt: input.prompt,
            n: 1,
            size: AI_IMAGE_SIZE,
            quality: 'standard',
            response_format: 'b64_json',
          }
        : {
            model,
            prompt: input.prompt,
            n: 1,
            size: AI_IMAGE_SIZE,
            quality: 'low',
            output_format: 'png',
            background: 'auto',
            moderation: 'auto',
          };

      const response = await Promise.race([
        client.images.generate(
          request as Parameters<typeof client.images.generate>[0],
          { timeout: AI_IMAGE_TIMEOUT_MS },
        ),
        timeoutAfter<Awaited<ReturnType<typeof client.images.generate>>>(AI_IMAGE_TIMEOUT_MS, `Image provider ${model}`),
      ]);
      recordCreatorDuration('provider_image', Date.now() - providerStartedAt, {
        model,
        platform: input.eventContext?.platform ?? null,
        creatorType: input.eventContext?.creatorType ?? null,
        attachmentMode: input.eventContext?.attachmentMode ?? null,
      });
      const first = getFirstImageResult(response);
      if (first?.b64_json || first?.url) {
        // Phase 4.1 Task 1: best-effort image provider-cost capture
        // (telemetry only, never throws, no billing, no behavior change).
        if (input.attribution?.organizationId) {
          await captureImageProviderCost({
            organizationId: input.attribution.organizationId,
            campaignId:     input.attribution.campaignId ?? null,
            userId:         input.attribution.userId ?? null,
            processType:    'creator_content',
            provider:       'openai',
            model,
            imageCount:     1,
            size:           AI_IMAGE_SIZE,
            activity:       'creator_image_generation',
            // Activity-consumption correlation (Phase 1): tie creator media cost
            // to the campaign activity so it aggregates with that activity's tokens.
            referenceType:  'creator_asset',
            referenceId:    input.attribution.campaignId ?? null,
            parentActivityId: input.attribution.campaignId ?? null,
          });
        }
        // Phase 10E — fold this rendered image's credits into the active
        // creator-content settlement scope (no-op outside one). Per-image actual
        // cost from the existing cost profile; the engine settles text + assets
        // together via the entry-consumption lifecycle (no new primitive).
        recordAssetCredits(resolveCostProfile('image').expected_credits_per_asset);
        if (first.b64_json) {
          return { image: { buffer: Buffer.from(first.b64_json, 'base64'), model }, conditionDegradation, conditionLatencyMs };
        }
        return { image: { buffer: await bufferFromRemoteImage(first.url as string), model }, conditionDegradation, conditionLatencyMs };
      }
      failures.push(`${model}: no image returned`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordCreatorDuration('provider_image_failed', Date.now() - providerStartedAt, {
        model,
        platform: input.eventContext?.platform ?? null,
        creatorType: input.eventContext?.creatorType ?? null,
      });
      failures.push(`${model}: ${message}`);
      console.warn('[creator-asset-renderer][provider-image-failed]', {
        model,
        message,
      });
      creatorEvent('provider', 'error', {
        category: 'provider_image_failed',
        message,
        model,
        creatorType: input.eventContext?.creatorType ?? null,
        attachmentMode: input.eventContext?.attachmentMode ?? null,
        subtype:     input.eventContext?.subtype     ?? null,
        platform:    input.eventContext?.platform    ?? null,
      });
    }
  }

  return {
    image: null,
    conditionDegradation,
    conditionLatencyMs,
    fallbackReason: failures.join(' | ') || 'Provider image generation failed',
  };
}

export async function uploadRenderedPng(input: {
  fileBuffer: Buffer;
  campaignId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  fileNamePrefix: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  return uploadRenderedFile({ ...input, extension: 'png', contentType: 'image/png' });
}

export async function uploadRenderedFile(input: {
  fileBuffer: Buffer;
  campaignId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  fileNamePrefix: string;
  extension: string;
  contentType: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const isPdf = input.contentType === 'application/pdf';
  const bucketName = isPdf ? DOCUMENT_BUCKET : IMAGE_BUCKET;
  await ensureRenderBucket(bucketName, isPdf ? ['application/pdf'] : ['image/png', 'image/jpeg']);
  const userPrefix = String(input.userId || 'system');
  const companyPrefix = String(input.companyId || 'company-unknown');
  const campaignPrefix = String(input.campaignId || 'standalone');
  const digest = createHash('sha1').update(input.fileBuffer).digest('hex').slice(0, 12);
  const extension = input.extension.replace(/^\./, '') || 'bin';
  const objectPath = `creator/${companyPrefix}/${campaignPrefix}/${userPrefix}/${input.fileNamePrefix}-${digest}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(objectPath, input.fileBuffer, {
      contentType: input.contentType,
      upsert: true,
      cacheControl: '3600',
    });

  if (uploadError) {
    throw new Error(`Failed to upload rendered asset: ${uploadError.message}`);
  }

  if (isPdf) {
    const { data: signed, error: signedError } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(objectPath, 60 * 60 * 24 * 7);
    if (signedError || !signed?.signedUrl) {
      throw new Error(`Failed to create signed rendered asset URL: ${signedError?.message || 'missing signed URL'}`);
    }
    return signed.signedUrl;
  }

  const { data } = supabase.storage.from(bucketName).getPublicUrl(objectPath);
  return data.publicUrl;
}

async function ensureRenderBucket(bucketName: string, allowedMimeTypes: string[]): Promise<void> {
  if (!bucketReadyByName[bucketName]) {
    bucketReadyByName[bucketName] = (async () => {
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      if (listError) {
        throw new Error(`Failed to inspect storage buckets: ${listError.message}`);
      }
      const exists = Array.isArray(buckets) && buckets.some((bucket) => bucket.name === bucketName);
      if (exists) {
        const { error: updateError } = await supabase.storage.updateBucket(bucketName, {
          public: bucketName !== DOCUMENT_BUCKET,
          fileSizeLimit: bucketName === DOCUMENT_BUCKET ? 20 * 1024 * 1024 : 10 * 1024 * 1024,
          allowedMimeTypes,
        });
        if (updateError && !/not found|permission/i.test(updateError.message)) {
          throw new Error(`Failed to update storage bucket: ${updateError.message}`);
        }
        return;
      }

      const { error: createError } = await supabase.storage.createBucket(bucketName, {
        public: bucketName !== DOCUMENT_BUCKET,
        fileSizeLimit: bucketName === DOCUMENT_BUCKET ? 20 * 1024 * 1024 : 10 * 1024 * 1024,
        allowedMimeTypes,
      });
      if (createError && !/already exists/i.test(createError.message)) {
        throw new Error(`Failed to create storage bucket: ${createError.message}`);
      }
    })().catch((error) => {
      bucketReadyByName[bucketName] = null;
      throw error;
    });
  }

  return bucketReadyByName[bucketName] as Promise<void>;
}

/**
 * Attachment render policy: dictates whether the renderer composites the
 * deterministic overlay or leaves the provider image standing on its own.
 * Writer-originated flows resolve this from attachment_mode only.
 *
 *   composition    — provider image is the finished creative; renderer
 *                    skips the overlay composite. Brand mark may still
 *                    be composited.
 *   text_embedded  — provider image is a textless background; renderer
 *                    composites the deterministic overlay on top.
 *
 * `banner` and `infographic` are always
 * `text_embedded` by definition (their renderer never had a composition
 * variant); only `image` can flip.
 */
export type AttachmentRenderPolicy = 'supporting_visual' | 'embedded_copy';

/** Per-subtype visual direction hint, threaded into the provider prompt. */
export type ImageSubtypeHint = {
  subtypeId: string;
  promptLine: string;
  /** Default overlay density when subtype is set. Read by `getOverlayPreset`. */
  densityHint: 'minimal' | 'balanced' | 'dense';
};

export const IMAGE_SUBTYPE_HINTS: Readonly<Record<string, ImageSubtypeHint>> = {
  'promotional-image': {
    subtypeId:   'promotional-image',
    promptLine:  'Subtype: promotional — emphasize a clear single-offer focus, conversion-ready energy, polished commercial framing, and a focal subject that signals "act now" without using literal text.',
    densityHint: 'balanced',
  },
  'quote-image': {
    subtypeId:   'quote-image',
    promptLine:  'Subtype: quote — strip the scene to one calm focal subject with significant negative space and editorial mood, designed to elevate a single line of overlay typography (the line itself is rendered as overlay, NOT inside the generated image).',
    densityHint: 'minimal',
  },
  'educational-image': {
    subtypeId:   'educational-image',
    promptLine:  'Subtype: educational — depict one clear concept through composition: ordered visual elements, a calm hierarchy, and a recognizable subject the audience can immediately decode (no literal diagrams, no labels).',
    densityHint: 'balanced',
  },
};

export function resolveImageSubtype(metadata: Record<string, unknown>, assetPayload: Record<string, unknown>): ImageSubtypeHint | null {
  const candidates = [
    metadata.subtype,
    metadata.image_subtype,
    safeObject(metadata.creator_card).subtype,
    safeObject(safeObject(assetPayload.platform_payload).answers).subtype,
    assetPayload.subtype,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const key = candidate.trim().toLowerCase();
    if (IMAGE_SUBTYPE_HINTS[key]) return IMAGE_SUBTYPE_HINTS[key];
  }
  return null;
}

export function resolveAttachmentRenderMode(input: {
  fileNamePrefix: string;
  assetPayload:   Record<string, unknown>;
  metadata:       Record<string, unknown>;
}): AttachmentRenderPolicy {
  if (input.fileNamePrefix !== 'image') return 'embedded_copy';
  const candidates = [
    input.metadata.attachment_mode === 'supporting_visual' ? 'supporting_visual' : null,
    input.metadata.attachment_mode === 'embedded_copy' ? 'embedded_copy' : null,
  ];
  for (const candidate of candidates) {
    if (candidate === 'supporting_visual' || candidate === 'embedded_copy') return candidate;
  }
  return 'embedded_copy';
}

/**
 * BETA-015 RULE 1/2/10 — the ONE canonical render-policy resolver.
 *
 * `attachment_mode` is the authoritative runtime truth: when the writer supplied an explicit
 * mode it wins over EVERY legacy asset-type assumption. So even if an asset arrives with
 * `enforcedAssetType === 'banner'`, a `supporting_visual` mode forces the clean-photograph
 * policy (renderer then skips overlay/typography/decorative SVG). The enforced-asset-type
 * branch is a COMPATIBILITY fallback used only when no explicit mode is present. No banner
 * assumption may override an explicit attachment_mode again.
 */
export function resolveCanonicalRenderPolicy(input: {
  attachmentMode?: string | null;
  enforcedAssetType?: 'supporting_image' | 'banner';
  fileNamePrefix: string;
  assetPayload:   Record<string, unknown>;
  metadata:       Record<string, unknown>;
}): AttachmentRenderPolicy {
  if (input.attachmentMode === 'supporting_visual') return 'supporting_visual';
  if (input.attachmentMode === 'embedded_copy') return 'embedded_copy';
  // Compatibility fallback (no explicit writer mode) — legacy asset-type mapping.
  if (input.enforcedAssetType === 'supporting_image') return 'supporting_visual';
  if (input.enforcedAssetType === 'banner') return 'embedded_copy';
  return resolveAttachmentRenderMode({
    fileNamePrefix: input.fileNamePrefix,
    assetPayload: input.assetPayload,
    metadata: input.metadata,
  });
}

