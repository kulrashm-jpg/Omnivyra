/** Part 6/10 of creatorAssetRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
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
import { sharp, type RenderedMediaBundle, type CreatorReviewPreviewInput, type RenderOptions, safeObject, resolveImageRenderStyle, resolveImageComposition, resolveImageStyleId, renderBackgroundPng, compactText, buildAccessibleAltText, normalizeOverlayText, resolveRenderSize } from './creatorAssetRendererContracts';
import { buildStatCardSvg, buildQuoteCardSvg, buildSplitCardSvg, buildTwoColumnCardSvg, buildListCardSvg } from './creatorAssetRendererText';
import { buildStyleCardSvg, buildOverlaySvg, loadBrandMark, normalizeBackgroundBuffer } from './creatorAssetRendererOverlay';
import { buildAiImagePrompt } from './creatorAssetRendererSvg';
import { generateProviderImage, uploadRenderedPng, type AttachmentRenderPolicy, resolveImageSubtype, resolveCanonicalRenderPolicy } from './creatorAssetRendererMedia';

export async function composeSingleVisualAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
  fileNamePrefix: string,
  rendererId: string,
  enforcedAssetType?: 'supporting_image' | 'banner',
): Promise<RenderedMediaBundle> {
  const descriptor = safeObject(assetPayload.visual_descriptor);
  const captionBlueprint = safeObject(assetPayload.caption_blueprint);
  const metadata = safeObject(safeObject(assetPayload.media_bundle).metadata);
  const title = compactText(descriptor.headline ?? captionBlueprint.hook ?? metadata.topic, 'Creator Asset');
  const body = compactText(descriptor.visual_description ?? captionBlueprint.body ?? metadata.summary, 'Generated creative asset');
  const eyebrow = compactText(metadata.content_type ?? assetPayload.asset_kind, 'creator');
  const platform = compactText(metadata.platform || metadata.primary_platform || safeObject(assetPayload.platform_payload).platform, 'social');
  // Phase 4D-A — image + banner (both route through this composer) adopt the
  // BrandRuntime via the 1C adapter when a published brand_identity row exists;
  // otherwise the exact legacy resolver path runs (defaults-only byte-identical).
  // Same source guard as Phase 4A/4B. Accent already flows canonically through
  // overlayStrategy.ctaFill (no palette[1] assumption in this path).
  const brandRuntime = options.companyId
    ? await resolveBrand(options.companyId).catch(() => null)
    : null;
  const brandKit = brandRuntime && brandRuntime.meta.source === 'brand_identity'
    ? brandRuntimeToCreatorBrandKit(brandRuntime, { assetPayload, metadata, platform, assetType: fileNamePrefix })
    : resolveCreatorBrandKit({
        assetPayload,
        metadata,
        companyId: options.companyId,
        tenantId: options.companyId,
        platform,
        assetType: fileNamePrefix,
      });
  const brandColors = brandKit.normalizedPalette;
  // BETA-015 RULE 1/2 — derive the ONE canonical render policy from attachment_mode FIRST.
  // supporting_visual (POST + IMAGE) is a clean photograph: it suppresses overlay text here and
  // skips the decorative SVG composite below (skipOverlayComposite). embedded_copy flows the
  // operator's typed hook/headline/insight through to the deterministic overlay composer.
  // attachment_mode wins over any enforced asset type — no banner payload can override it.
  const attachmentRenderPolicy: AttachmentRenderPolicy = resolveCanonicalRenderPolicy({
    attachmentMode: typeof metadata.attachment_mode === 'string' ? metadata.attachment_mode : null,
    enforcedAssetType,
    fileNamePrefix,
    assetPayload,
    metadata,
  });
  const overlay = attachmentRenderPolicy === 'supporting_visual'
    ? { hook: '', headline: '', keyInsight: '', cta: '', supportingText: '' }
    : normalizeOverlayText({ assetPayload, metadata, title, body });
  // Diagnostic (text-inside "no text" investigation): reveals whether the policy
  // resolved to embedded_copy AND whether the overlay actually carries copy.
  console.log('[creator-asset-renderer][attachment-policy]', {
    fileNamePrefix,
    metadata_attachment_mode: typeof metadata.attachment_mode === 'string' ? metadata.attachment_mode : null,
    enforcedAssetType: enforcedAssetType ?? null,
    resolvedPolicy: attachmentRenderPolicy,
    overlayLens: {
      hook: (overlay.hook ?? '').length,
      headline: (overlay.headline ?? '').length,
      keyInsight: (overlay.keyInsight ?? '').length,
      cta: (overlay.cta ?? '').length,
      supporting: (overlay.supportingText ?? '').length,
    },
  });
  const writerGoverned = Boolean(metadata.writer_asset_type || metadata.creator_content_asset_type || metadata.attachment_mode);
  const governanceAssetType = enforcedAssetType ?? (writerGoverned
    ? String(metadata.writer_asset_type || metadata.creator_content_asset_type || metadata.content_type || fileNamePrefix || 'supporting_image')
    : (fileNamePrefix === 'banner' ? 'banner' : 'banner'));
  const rawTextBlocks = [overlay.hook, overlay.headline, overlay.keyInsight, overlay.cta, overlay.supportingText].filter(Boolean);
  const rawGovernance = validateVisualGovernance({
    assetType: governanceAssetType,
    platform,
    textBlocks: rawTextBlocks,
    hasCTA: Boolean(overlay.cta),
    paragraphCount: rawTextBlocks.filter((block) => block.length > 110 || /[.!?]\s+[A-Z0-9]/.test(block)).length,
    overlapRisk: rawTextBlocks.join(' ').length > 460,
    tinyTextRisk: rawTextBlocks.length > 5,
  });
  if (writerGoverned && metadata.attachment_mode === 'supporting_visual' && !rawGovernance.ok) {
    throw new Error(`supporting_visual_governance_rejected:${rawGovernance.errors.join(',')}`);
  }
  const corrected = autoCorrectVisualCopy({
    assetType: governanceAssetType,
    textBlocks: rawTextBlocks,
    allowCTA: metadata.attachment_mode !== 'supporting_visual',
  });
  // Image overlays must be paragraph-safe: the render manifest rejects ANY block
  // that is multi-sentence OR >110 chars (paragraph_overlay_forbidden). Collapse
  // each governed block to a single sentence and cap under the threshold so a
  // long AI-written line renders as a clean hero line instead of failing
  // generation closed. (Applied here at the image render only — generic
  // autoCorrectVisualCopy must not char-cap other profiles like brand_card.)
  const paragraphSafeBlock = (block: string): string => {
    let s = String(block ?? '').replace(/\s+/g, ' ').trim();
    if (!s) return s;
    if (/[.!?]\s+\S/.test(s)) s = s.match(/[^.!?]+[.!?]?/)?.[0]?.trim() ?? s;
    if (s.length > 108) s = s.slice(0, 108).replace(/\s+\S*$/, '').trim();
    return s;
  };
  const safeBlocks = corrected.textBlocks.map(paragraphSafeBlock);
  const governedOverlay = {
    hook: safeBlocks[0] ?? '',
    headline: safeBlocks[1] ?? '',
    keyInsight: safeBlocks[2] ?? '',
    cta: safeBlocks[3] ?? '',
    supportingText: safeBlocks[4] ?? '',
  };
  const creatorQuality = scoreCreatorQuality({
    assetType: governanceAssetType,
    platform,
    textBlocks: corrected.textBlocks,
    hasCTA: Boolean(governedOverlay.cta),
    duplicateText: false,
    overlapRisk: corrected.textBlocks.join(' ').length > 360,
    tinyTextRisk: corrected.textBlocks.length > 4,
  });
  // Density counts only the fields the chosen composition ACTUALLY paints. Specialized image
  // compositions (stat/quote/split/two-column/list/style) render a SUBSET — headline + one support
  // field + CTA — not all five overlay fields, so counting the unrendered hook/keyInsight falsely
  // tripped text_density_exceeds_profile for legitimate before/after + promo copy. The generic
  // stacked overlay (no composition) still counts every field — unchanged.
  const govComposition = resolveImageComposition(metadata);
  const govStyleId = govComposition ? null : resolveImageStyleId(metadata);
  const governanceTextBlocks = (
    govComposition === 'quote'
      ? [governedOverlay.headline, governedOverlay.keyInsight || governedOverlay.supportingText, governedOverlay.cta]
      : (govComposition || govStyleId)
        ? [governedOverlay.headline, governedOverlay.supportingText, governedOverlay.cta]
        : safeBlocks
  ).filter(Boolean);
  const visualGovernance = validateVisualGovernance({
    assetType: governanceAssetType,
    platform,
    textBlocks: governanceTextBlocks,
    hasCTA: Boolean(governedOverlay.cta),
    textAreaPercent: estimateTextAreaPercent({ textBlocks: governanceTextBlocks }),
    paragraphCount: governanceTextBlocks.filter((block) => block.length > 110 || /[.!?]\s+[A-Z0-9]/.test(block)).length,
    overlapRisk: governanceTextBlocks.join(' ').length > 360,
    tinyTextRisk: governanceTextBlocks.length > 4,
  });
  const previewGovernanceWarnings = buildPreviewGovernanceWarnings({
    validation: visualGovernance,
    quality: creatorQuality,
  });
  // `attachmentRenderPolicy` is resolved once, canonically, above (BETA-015) — it is the
  // single source of truth for overlay suppression, the AI prompt policy, and
  // skipOverlayComposite. No second, asset-type-keyed derivation exists.
  // ── Phase 7 runtime wiring — semantic vs render-policy attachment mode.
  // `attachmentRenderPolicy` above is the RENDERER-INTERNAL composition
  // policy (drives overlay-vs-no-overlay, prompt text-bans, etc.) and
  // can differ from what the writer semantically requested because the
  // supporting_image entry hardcodes 'supporting_visual'. For OCR
  // gating + lightweight-lane classification we need the WRITER'S
  // semantic intent (from `metadata.attachment_mode`, set by the API
  // normalize layer's `resolveAttachmentModeFromIntent`). When the
  // writer payload has no explicit mode, fall back to the renderer's
  // internal policy to preserve legacy behavior.
  const semanticAttachmentMode: 'embedded_copy' | 'supporting_visual' =
    metadata.attachment_mode === 'embedded_copy'
      ? 'embedded_copy'
      : metadata.attachment_mode === 'supporting_visual'
        ? 'supporting_visual'
        : attachmentRenderPolicy;
  const subtypeHint = resolveImageSubtype(metadata, assetPayload);
  const providerPrompt = buildAiImagePrompt({
    title,
    body,
    eyebrow,
    metadata,
    assetPayload,
    attachmentMode: attachmentRenderPolicy,
    subtypeHint,
    companyId: options.companyId ?? null,
  });
  // img2img style reference (flag-gated): point at the curated template's showcase
  // image so the provider can condition on it. Null unless the flag is on and a
  // blueprint id is present → plain text-to-image (unchanged).
  const referenceImageUrl = (() => {
    if (process.env.CREATOR_IMAGE_REFERENCE_MODE !== 'edit') return null;
    const bpId = typeof metadata.blueprint_id === 'string' ? metadata.blueprint_id.trim() : '';
    if (!bpId) return null;
    const base = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://www.omnivyra.com').replace(/\/$/, '');
    return `${base}/creator-showcases/${bpId}/image.webp`;
  })();
  const providerResult = await generateProviderImage({
    prompt: providerPrompt,
    referenceImageUrl,
    eventContext: {
      creatorType: fileNamePrefix,
      attachmentMode: attachmentRenderPolicy,
      subtype:     subtypeHint?.subtypeId ?? null,
      platform,
    },
    attribution: {
      organizationId: options.companyId ?? null,
      campaignId:     options.campaignId ?? null,
      userId:         options.userId ?? null,
    },
  });
  const providerOcr = providerResult.image
    ? await runCreatorOcr({
        image: providerResult.image.buffer,
        assetType: enforcedAssetType ?? fileNamePrefix,
        platform,
        // Phase 7 wiring fix — OCR threshold resolution uses the
        // writer's semantic mode, not the renderer-internal policy.
        attachmentMode: semanticAttachmentMode,
        mimeType: 'image/png',
      })
    : null;
  const textValidation = validateProviderImageTextSafety({
    mode: metadata.attachment_mode === 'supporting_visual'
      ? 'supporting_visual'
      : metadata.attachment_mode === 'embedded_copy'
        ? 'embedded_copy'
        : 'legacy',
    providerReturnedImage: Boolean(providerResult.image),
    prompt: providerPrompt,
    overlayText: governedOverlay,
    ocrText: providerOcr?.text ?? (typeof metadata.provider_ocr_text === 'string' ? metadata.provider_ocr_text : null),
    regionCount: providerOcr?.regions.length ?? Number(metadata.provider_ocr_region_count ?? 0),
    maxRegionDensity: providerOcr
      ? providerOcr.regions.filter((region) => region.text.length > 48).length / Math.max(1, providerOcr.regions.length)
      : Number(metadata.provider_ocr_region_density ?? 0),
    confidence: providerOcr?.confidence,
    minConfidence: providerOcr?.thresholds.minConfidence,
    provider: providerOcr?.provider,
  });
  const providerImage = providerResult.image;
  const { width, height } = resolveRenderSize(platform, fileNamePrefix);
  const background = await normalizeBackgroundBuffer({
    providerBuffer: providerImage?.buffer ?? null,
    width,
    height,
    colors: brandColors,
    variantId: brandKit.layoutVariantId,
  });

  // ── Mode branch ───────────────────────────────────────────────────────
  // text_embedded: keep the existing deterministic SVG overlay composite.
  // composition:   skip the overlay composite entirely; brand mark may
  //                still be applied (handled below). overlay_quality is
  //                NOT emitted in this branch.
  const skipOverlayComposite = attachmentRenderPolicy === 'supporting_visual';
  // Strategy-aware rendering — resolve the RenderStrategy from the
  // purpose_strategy.id surfaced onto media_bundle.metadata by the
  // prompt composer in buildAiImagePrompt (which runs above on line
  // 1892). When no purpose strategy resolved (legacy callers + paths
  // that bypass the registry), `renderStrategy` is null and the
  // overlay path produces byte-identical output to the pre-phase
  // renderer (PHASE 10 regression-safety guarantee).
  const { resolveRenderStrategy } =
    require('./creator/renderStrategyRegistry') as typeof import('./creator/renderStrategyRegistry');
  const bundleMetaForStrategy = safeObject(safeObject(assetPayload.media_bundle).metadata);
  const purposeStrategyForRender = safeObject(bundleMetaForStrategy.purpose_strategy);
  const purposeStrategyIdForRender = typeof purposeStrategyForRender.id === 'string'
    ? String(purposeStrategyForRender.id)
    : null;
  const renderStrategyRaw = resolveRenderStrategy(purposeStrategyIdForRender);
  // ── Variant overlay (PHASE 4 — purpose-aware variant exploration) ──
  // When the asset metadata declares a `variant_family` or a fully
  // qualified `variant_id`, compose the variant overlay ON TOP of the
  // resolved RenderStrategyModifiers. Legacy assets with no variant
  // declared resolve `variant` = null and the renderer behaves
  // byte-identically to the pre-variant phase (PHASE 16 regression
  // safety).
  const variantFamilyForRender = (() => {
    const raw =
      bundleMetaForStrategy.variant_family
      ?? purposeStrategyForRender.variant_family
      ?? null;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  })();
  const variantIdFromMetadata = (() => {
    const raw = bundleMetaForStrategy.variant_id ?? purposeStrategyForRender.variant_id ?? null;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  })();
  const { resolveVariant: _resolveVariantForRender, resolveVariantByFamily: _resolveVariantByFamilyForRender } =
    require('./creator/variantRegistry') as typeof import('./creator/variantRegistry');
  const { resolveVariantStrategyProfile: _resolveVariantProfile, composeVariantOntoStrategyModifiers: _composeVariantOnto } =
    require('./creator/variantStrategyProfiles') as typeof import('./creator/variantStrategyProfiles');
  const variantForRender =
    _resolveVariantForRender(variantIdFromMetadata)
    ?? _resolveVariantByFamilyForRender(purposeStrategyIdForRender, variantFamilyForRender);
  const variantProfile = _resolveVariantProfile(variantForRender?.variant_id ?? null);
  const renderStrategy = renderStrategyRaw && variantProfile
    ? {
        ...renderStrategyRaw,
        modifiers: _composeVariantOnto(renderStrategyRaw.modifiers, variantProfile),
      }
    : renderStrategyRaw;
  // Additive per-template composition: when the image template opts into a dedicated
  // composition (renderingContract.imageComposition), dispatch to it; otherwise the default
  // stacked overlay, byte-identical. Only image templates carry a composition.
  const imageComposition = resolveImageComposition(metadata);
  const imageStyleId = imageComposition ? null : resolveImageStyleId(metadata);
  // Raw (pre-normalisation) overlay supportingText preserves newlines — the list
  // composition needs the individual checklist items, which the overlay normaliser collapses.
  const rawListItems = (() => {
    const direct = safeObject((assetPayload as Record<string, unknown>).overlay_text);
    const meta = safeObject((metadata as Record<string, unknown>).overlay_text);
    const src = Object.keys(direct).length > 0 ? direct : meta;
    return String((src as Record<string, unknown>).supportingText ?? '');
  })();
  const overlayRender = skipOverlayComposite
    ? null
    : imageComposition === 'stat'
      ? buildStatCardSvg({ width, height, overlay: governedOverlay, brandKit, fileNamePrefix })
      : imageComposition === 'quote'
      ? buildQuoteCardSvg({ width, height, overlay: governedOverlay, brandKit, fileNamePrefix })
      : imageComposition === 'split'
      ? buildSplitCardSvg({ width, height, overlay: governedOverlay, brandKit, fileNamePrefix })
      : imageComposition === 'two-column'
      ? buildTwoColumnCardSvg({ width, height, overlay: governedOverlay, brandKit, fileNamePrefix })
      : imageComposition === 'list'
      ? buildListCardSvg({ width, height, title: governedOverlay.headline, itemsRaw: rawListItems, brandKit, fileNamePrefix })
      : imageStyleId
      ? buildStyleCardSvg(imageStyleId, { width, height, overlay: governedOverlay, brandKit, fileNamePrefix })
      : buildOverlaySvg({
          width,
          height,
          overlay: governedOverlay,
          brandKit,
          platform,
          fileNamePrefix,
          subtypeHint,
          renderStrategy,
          // Image/banner overlay base resolved via the canonical resolveTemplate().
          imageStyle: resolveImageRenderStyle(metadata),
        });
  const brandPlacement = overlayRender?.brandPlacement
    ?? defaultBrandPlacement({ width, height, fileNamePrefix });
  const brandMark = await loadBrandMark({ brandKit, placement: brandPlacement });

  const composites: Array<{ input: Buffer; top: number; left: number }> = [];
  if (overlayRender) {
    composites.push({ input: Buffer.from(overlayRender.svg), top: 0, left: 0 });
  }
  if (brandMark) {
    composites.push({ input: brandMark, top: brandPlacement.top, left: brandPlacement.left });
  }

  const composed = sharp(background.buffer);
  const fileBuffer = await (composites.length ? composed.composite(composites) : composed).png().toBuffer();
  const effectiveFallbackReason = background.fallbackReason || (providerImage ? undefined : providerResult.fallbackReason);

  // Mode-aware metadata. Composition mode omits the overlay quality
  // block + flags entirely — those signals are nonsensical when no
  // overlay was composited.
  const modeAwareMetadata: Record<string, unknown> = {
    width,
    height,
    preview_kind: 'social_creative',
    provider_model: providerImage?.model,
    image_subtype: subtypeHint?.subtypeId ?? null,
    attachment_mode: metadata.attachment_mode ?? null,
    writer_asset_type: metadata.writer_asset_type ?? null,
    platform_visual_profile: resolvePlatformVisualProfile(platform),
    creator_quality_score: creatorQuality,
    visual_governance: visualGovernance,
    visual_governance_warnings: previewGovernanceWarnings,
    auto_corrections: corrected.corrections,
    provider_text_validation: textValidation,
    overlay_renderer: skipOverlayComposite ? 'none' : 'deterministic_svg_v1',
    fallback_reason: effectiveFallbackReason,
    preview_export_parity: {
      parity_version: 'creator-render-parity-v1',
      brandkit: true,
      typography: !skipOverlayComposite,
      overlay: !skipOverlayComposite,
      logo: Boolean(brandMark),
      footer_identity: !skipOverlayComposite,
      export_mode: 'single_image',
      verified_at: new Date().toISOString(),
    },
    ...buildCreatorBrandKitMetadata(brandKit, {
      platform,
      overlayConfiguration: overlayRender ? {
        ...brandKit.overlayStrategy,
        preset: overlayRender.quality.preset,
        overlay_text: governedOverlay,
      } : { mode: 'composition', ...brandKit.overlayStrategy },
      exportCapabilities: ['preview', 'download', 'save_as_asset'],
    }),
  };
  if (!skipOverlayComposite && overlayRender) {
    modeAwareMetadata.overlay_text = governedOverlay;
    modeAwareMetadata.overlay_quality = overlayRender.quality;
    modeAwareMetadata.low_quality_flags = overlayRender.quality.flags;
  }
  if (skipOverlayComposite) {
    // Composition mode replaces `overlay_quality` with a lightweight
    // deterministic `composition_quality` score so visual-review tooling
    // still has an aggregatable signal. Pure heuristic — no AI calls, no
    // network, no probes. Four dimensions:
    //   * composition_balance — aspect ratio + provider success → 0–25
    //   * branding_strength    — brand_mode + brand mark applied → 0–25
    //   * visual_focus         — subtype + density alignment    → 0–25
    //   * platform_fit         — canvas size vs platform conv.  → 0–25
    // The sum is the overall score; the breakdown is preserved so
    // dashboards can pivot on whichever dimension regresses.
    modeAwareMetadata.composition_quality = computeCompositionQuality({
      width,
      height,
      platform,
      fileNamePrefix,
      providerSucceeded: Boolean(providerImage),
      brandMarkApplied:  Boolean(brandMark),
      brandMode:         (safeObject(metadata.creator_card).brand_mode === 'brand-aware') ? 'brand-aware' : 'independent',
      subtype:           subtypeHint?.subtypeId ?? null,
    });
  }
  const geometry = validateLayoutGeometry({
    width,
    height,
    boxes: overlayRender ? [
      estimateTextBox({ id: 'headline', text: governedOverlay.headline, x: 92, y: 220, maxWidth: Math.round(width * 0.56), fontSize: fileNamePrefix === 'banner' ? 42 : 40, maxLines: 3, role: 'headline' }),
      estimateTextBox({ id: 'insight', text: governedOverlay.keyInsight, x: 96, y: 390, maxWidth: Math.round(width * 0.52), fontSize: 22, maxLines: 3, role: 'body' }),
    ] : [],
    foreground: '#ffffff',
    background: brandColors[0] || '#111827',
    minFontSize: fileNamePrefix === 'banner' ? 20 : 18,
  });
  const finalOcr = await runCreatorOcr({
    image: fileBuffer,
    assetType: enforcedAssetType ?? fileNamePrefix,
    platform,
    // Phase 7 wiring fix — see semanticAttachmentMode above.
    attachmentMode: semanticAttachmentMode,
    mimeType: 'image/png',
  });
  const mergedTextValidation = {
    ...textValidation,
    ok: textValidation.ok && finalOcr.ok,
    flags: Array.from(new Set([...textValidation.flags, ...finalOcr.flags])),
    confidence: finalOcr.confidence || textValidation.confidence,
    provider: finalOcr.provider,
  };
  // Phase 1/3 — lightweight social embedded_copy lane. Eligible
  // single-image overlays (supporting_image / banner / brand_card on
  // social platforms in embedded_copy mode) tolerate OCR-provider
  // unavailability and synthesize reading order from the governed
  // overlay structure. Manifest is still validated; only the
  // operational-tier OCR + missing-reading-order signals are repaired.
  // Phase 7 wiring fix — classification uses the writer's semantic
  // mode (the API normalize layer already resolved it via
  // resolveAttachmentModeFromIntent), NOT the renderer-internal
  // composition policy. Without this, supporting_image renders
  // hardcoded to 'supporting_visual' policy fail the lightweight check
  // even when the writer payload semantically requested embedded_copy.
  const lightweightSocial = isLightweightSocialEmbeddedCopy({
    assetType: enforcedAssetType ?? fileNamePrefix,
    platform,
    attachmentMode: semanticAttachmentMode,
  });
  // ocr_relaxed is enabled when the OCR provider is unavailable for
  // any reason AND the asset qualifies for the lightweight lane.
  // `provider_image_unavailable_for_ocr` (provider had no image to
  // analyze, from validateProviderImageTextSafety) is treated as an
  // operational unavailability signal too — it's already filtered by
  // assertRenderManifestExportable regardless of lane, but including
  // it here keeps the relaxation flag set so dashboards count this
  // lane consistently.
  const ocrProviderUnavailable = finalOcr.provider === 'unavailable'
    || finalOcr.flags.includes('ocr_provider_unconfigured')
    || finalOcr.flags.includes('ocr_provider_required_unavailable')
    || finalOcr.flags.includes('provider_image_unavailable_for_ocr')
    || (providerOcr?.provider === 'unavailable')
    || (mergedTextValidation.flags.includes('ocr_provider_required_unavailable'))
    || (mergedTextValidation.flags.includes('ocr_provider_unconfigured'));
  const ocrRelaxedForCompat = lightweightSocial && ocrProviderUnavailable;
  const readingOrderResolution = synthesizeReadingOrderForOverlay(governedOverlay as Record<string, unknown>);
  const naturalReadingOrder = ['hook', 'headline', 'keyInsight', 'supportingText'].filter((key) => Boolean(governedOverlay[key]));
  const effectiveReadingOrder = naturalReadingOrder.length > 0
    ? naturalReadingOrder
    : readingOrderResolution.readingOrder;
  const syntheticForCompat = lightweightSocial && naturalReadingOrder.length === 0;

  if (ocrRelaxedForCompat) {
    logPipelineEvent('embedded_copy_ocr_relaxed', 'info', {
      asset_type: String(enforcedAssetType ?? fileNamePrefix),
      platform: String(platform || 'unset'),
      attachment_mode: String(semanticAttachmentMode || 'unset'),
      render_policy: String(attachmentRenderPolicy || 'unset'),
      reason: 'lightweight_social_ocr_provider_unavailable',
    }, { dedupeKey: `ocr_relaxed.${platform}.${enforcedAssetType ?? fileNamePrefix}`, throttleMs: 10_000 });
  }
  if (syntheticForCompat) {
    logPipelineEvent('embedded_copy_synthetic_reading_order', 'info', {
      asset_type: String(enforcedAssetType ?? fileNamePrefix),
      platform: String(platform || 'unset'),
      attachment_mode: String(semanticAttachmentMode || 'unset'),
      render_policy: String(attachmentRenderPolicy || 'unset'),
      governance_mode: 'lightweight_social_embedded_copy',
      reason: 'no_overlay_keys_populated',
    }, { dedupeKey: `synthetic_order.${platform}.${enforcedAssetType ?? fileNamePrefix}`, throttleMs: 10_000 });
  }

  const accessibleAltText = buildAccessibleAltText(title, {
    supporting: typeof governedOverlay.supportingText === 'string' ? governedOverlay.supportingText : '',
    kind: 'promotional',
    platform,
  });
  const accessibilityValidation = validateCreatorAccessibility({
    altText: accessibleAltText,
    readingOrder: effectiveReadingOrder,
    minFontSize: fileNamePrefix === 'banner' ? 20 : 18,
    contrastRatio: geometry.contrastRatio,
  });
  const governanceCompatibility: GovernanceCompatibilityFlags | undefined = lightweightSocial
    ? {
        lightweight_social_embedded_copy: true,
        ocr_relaxed: ocrRelaxedForCompat,
        synthetic_reading_order: syntheticForCompat,
        degraded_mode_reason: ocrRelaxedForCompat
          ? 'ocr_provider_unavailable_lightweight_lane'
          : syntheticForCompat
            ? 'synthetic_reading_order_no_overlay_keys'
            : undefined,
      }
    : undefined;
  const manifest = createRenderManifest({
    rendererId,
    platformProfile: resolvePlatformVisualProfile(platform) as unknown as Record<string, unknown>,
    governanceProfile: resolveAssetGovernanceProfile(String(governanceAssetType)) as unknown as Record<string, unknown>,
    qualityScore: creatorQuality,
    validationResult: visualGovernance,
    ocrResult: mergedTextValidation,
    typographySafetyResult: geometry,
    transformIntent: typeof metadata.source_text_transform === 'string' ? metadata.source_text_transform : null,
    exportMetadata: { width, height, preview_kind: 'social_creative', provider_ocr: providerOcr },
    altText: accessibleAltText,
    readingOrder: effectiveReadingOrder,
    accessibilityValidation,
    governanceCompatibility,
  });
  if (writerGoverned) assertRenderManifestExportable(manifest);
  modeAwareMetadata.render_manifest = manifest;
  modeAwareMetadata.renderer_id = rendererId;
  modeAwareMetadata.validation_manifest = {
    governance: visualGovernance,
    ocr: mergedTextValidation,
    provider_ocr: providerOcr,
    final_ocr: finalOcr,
    geometry,
    accessibility: accessibilityValidation,
  };

  // ── Phase 1 + 2 — Production render QA. Combines OCR + CV-light
  // image statistics + the prior governance / aesthetic ranks into a
  // single QA verdict. The QA result rides on metadata so the
  // downstream renderer + dashboards can pivot regenerate-required
  // assets and surface the autonomous-operation decision.
  // Phase 11 — QA evaluation never throws; failures degrade to
  // production-safe defaults and the renderer continues.
  try {
    const composedMeta = safeObject(safeObject(modeAwareMetadata.media_bundle).metadata);
    const governanceForQa = {
      governanceScore: Number(composedMeta.governance_score ?? 100),
      governanceViolations: Array.isArray(composedMeta.governance_violations) ? composedMeta.governance_violations as any : [],
      governanceWarnings: Array.isArray(composedMeta.governance_warnings) ? composedMeta.governance_warnings as any : [],
      brandAlignmentConfidence: Number(composedMeta.governance_brand_alignment_confidence ?? 100),
      rejectGeneration: Boolean(composedMeta.governance_reject_generation),
      retryStrategy: String(composedMeta.governance_retry_strategy ?? 'none'),
      retryRationale: composedMeta.governance_retry_rationale as any,
    };
    const aestheticForQa = {
      totalScore: Number(composedMeta.aesthetic_score ?? 70),
      bucket: String(composedMeta.aesthetic_bucket ?? 'good') as 'premium' | 'good' | 'acceptable' | 'weak' | 'low',
      dimensionScores: composedMeta.aesthetic_dimensions as any || {},
      strengths: Array.isArray(composedMeta.aesthetic_strengths) ? composedMeta.aesthetic_strengths as any : [],
      weaknesses: Array.isArray(composedMeta.aesthetic_weaknesses) ? composedMeta.aesthetic_weaknesses as any : [],
      rankingReason: '',
    };
    const planForQa = {
      strategyProfile: composedMeta.creative_strategy as any,
      emotionalDirection: composedMeta.creative_emotional_direction as any,
      compositionStrategy: composedMeta.creative_composition_strategy as any,
      realismProfile: composedMeta.creative_realism_profile as any,
      visualNarrative: composedMeta.creative_visual_narrative as any,
      artDirectionStyle: '',
      framingStrategy: composedMeta.creative_framing_strategy as any,
      subjectPriority: composedMeta.creative_subject_priority as any,
      environmentStyle: '',
      humanPresenceMode: composedMeta.creative_human_presence_mode as any,
      visualDensity: composedMeta.creative_visual_density as any,
      premiumBias: Boolean(composedMeta.creative_premium_bias),
      rationale: [],
    };
    const { evaluateProductionRenderQA } =
      require('./creator/renderQualityAssurance') as typeof import('./creator/renderQualityAssurance');
    const { decideAutonomousOperation, computeOptimizationDirective } =
      require('./creator/autonomousCreativeOptimizer') as typeof import('./creator/autonomousCreativeOptimizer');
    const { recordTelemetryEvent } =
      require('./creator/creatorPerformanceTelemetry') as typeof import('./creator/creatorPerformanceTelemetry');
    const qaResult = await evaluateProductionRenderQA({
      imageBuffer: fileBuffer,
      ocr: finalOcr,
      governance: governanceForQa as any,
      rank: aestheticForQa as any,
      plan: planForQa as any,
      attachmentMode: semanticAttachmentMode,
    });
    const autonomousDecision = decideAutonomousOperation({
      qaScore: qaResult.qaScore,
      qaSeverity: qaResult.severity,
      governanceScore: governanceForQa.governanceScore,
      governanceRejected: governanceForQa.rejectGeneration,
      aestheticBucket: aestheticForQa.bucket,
    });
    modeAwareMetadata.render_qa = {
      qa_score: qaResult.qaScore,
      qa_severity: qaResult.severity,
      qa_violations: qaResult.qaViolations,
      qa_warnings: qaResult.qaWarnings,
      qa_regenerate_required: qaResult.regenerateRequired,
      qa_retry_strategy: qaResult.retryStrategy,
      qa_production_safe: qaResult.productionSafe,
      qa_component_scores: qaResult.audit.componentScores,
      qa_image_analysis: qaResult.imageAnalysis,
      autonomous_action: autonomousDecision.action,
      autonomous_reason: autonomousDecision.reason,
    };
    // Phase 4 — telemetry event for post-render QA outcome.
    if (options.companyId) {
      try {
        recordTelemetryEvent({
          type: qaResult.severity === 'fail' || qaResult.severity === 'reject' ? 'qa_failed' : 'qa_passed',
          companyId: options.companyId,
          campaignId: typeof metadata.campaign_id === 'string' ? metadata.campaign_id : null,
          strategy: composedMeta.creative_strategy as any,
          template: composedMeta.creative_direction as any,
          platform,
          emotionalDirection: composedMeta.creative_emotional_direction as any,
          realismProfile: composedMeta.creative_realism_profile as any,
          qaScore: qaResult.qaScore,
          governanceScore: governanceForQa.governanceScore,
          aestheticScore: aestheticForQa.totalScore,
          payload: {
            autonomous_action: autonomousDecision.action,
            qa_severity: qaResult.severity,
          },
        });
      } catch { /* telemetry never throws */ }
    }
    // Surface optimization directive on metadata for dashboard visibility.
    const optimizationForLog = computeOptimizationDirective({ companyId: options.companyId ?? null });
    modeAwareMetadata.render_optimization = {
      strategy_weights: optimizationForLog.strategyWeights,
      mutations: optimizationForLog.mutations,
      preferred_emotional: optimizationForLog.preferredEmotionalDirection,
      preferred_realism: optimizationForLog.preferredRealismProfile,
      rationale: optimizationForLog.rationale,
    };
  } catch (qaError) {
    // QA failure is non-fatal; record and continue. Phase 11 cost-bounded.
    modeAwareMetadata.render_qa = {
      qa_score: null,
      qa_severity: 'pass',
      qa_violations: [],
      qa_warnings: [],
      qa_regenerate_required: false,
      qa_retry_strategy: 'none',
      qa_production_safe: true,
      qa_error: qaError instanceof Error ? qaError.message : String(qaError),
    };
  }
  void persistCreatorValidationManifest({
    rendererId,
    assetType: String(governanceAssetType),
    platform,
    attachmentMode: typeof metadata.attachment_mode === 'string' ? metadata.attachment_mode : attachmentRenderPolicy,
    renderManifest: manifest as unknown as Record<string, unknown>,
    validationManifest: modeAwareMetadata.validation_manifest as Record<string, unknown>,
    auditId: typeof metadata.render_audit_id === 'string' ? metadata.render_audit_id : null,
  });

  const url = await uploadRenderedPng({
    fileBuffer,
    campaignId: options.campaignId,
    userId: options.userId,
    companyId: options.companyId,
    fileNamePrefix,
    metadata: modeAwareMetadata,
  });
  return {
    url,
    metadata: {
      ...modeAwareMetadata,
      generated_by: providerImage ? 'openaiImageProvider' : 'creatorAssetRenderer',
      provider_rendered: Boolean(providerImage),
      brand_mark_applied: Boolean(brandMark),
    },
  };
}

/**
 * Lightweight deterministic quality signal for composition-mode outputs.
 * Replaces `overlay_quality` for that branch — there's no overlay to
 * score, so we look at the inputs the renderer DID have control over.
 *
 * Score is 0–100 (sum of 4 dimensions, each 0–25). Each dimension's
 * value is preserved so dashboards can pivot on the specific failure:
 *
 *   composition_balance — provider success + safe aspect ratio
 *   branding_strength   — brand mark applied + brand_mode signal
 *   visual_focus        — subtype provides directional intent
 *   platform_fit        — canvas dimensions match the platform's
 *                          conventional pin/post aspect
 *
 * Flags array surfaces specific weaknesses ('provider_fell_back',
 * 'no_brand_mark', 'no_subtype_hint', 'platform_dimension_mismatch')
 * mirroring the overlay-quality flags structure.
 */
interface CompositionQualityReport {
  score: number;
  balance: number;
  branding: number;
  focus: number;
  platform_fit: number;
  flags: string[];
  preset: 'composition_v1';
}

export function computeCompositionQuality(input: {
  width: number;
  height: number;
  platform: string;
  fileNamePrefix: string;
  providerSucceeded: boolean;
  brandMarkApplied:  boolean;
  brandMode:         'brand-aware' | 'independent';
  subtype:           string | null;
}): CompositionQualityReport {
  const flags: string[] = [];

  // ── composition_balance ──────────────────────────────────────────────
  // Provider success is the dominant signal — a gradient fallback gets
  // partial credit but is flagged. Aspect ratio sanity check ensures we
  // never claim a 1:1 fallback on a 2:3-expected platform.
  let balance = input.providerSucceeded ? 18 : 8;
  if (!input.providerSucceeded) flags.push('provider_fell_back');
  const ratio = input.width / Math.max(1, input.height);
  if (ratio > 0.66 && ratio < 1.8) balance += 7; // safe range; not too skinny / too wide

  // ── branding_strength ────────────────────────────────────────────────
  let branding = 0;
  if (input.brandMode === 'brand-aware') branding += 12;
  if (input.brandMarkApplied) branding += 13;
  else flags.push('no_brand_mark');

  // ── visual_focus ─────────────────────────────────────────────────────
  // Subtype hint signals deliberate directional intent. Educational and
  // quote subtypes score equally — promotional gets a small bonus for
  // CTA-focused composition.
  let focus = input.subtype ? 17 : 8;
  if (!input.subtype) flags.push('no_subtype_hint');
  if (input.subtype === 'promotional-image') focus += 8;
  else if (input.subtype) focus += 6;

  // ── platform_fit ─────────────────────────────────────────────────────
  // Map canonical platform → expected aspect range. Score 25 when
  // canvas dimensions land in the expected band; degrade otherwise.
  const platformKey = String(input.platform || '').toLowerCase();
  const isHorizontal = platformKey === 'linkedin' || platformKey === 'x' || platformKey === 'twitter' || platformKey === 'reddit';
  const isVertical   = platformKey === 'instagram' || platformKey === 'facebook' || platformKey === 'threads' || platformKey === 'pinterest';
  let platform_fit = 12;
  if (isHorizontal && ratio > 1.3 && ratio < 2.2) platform_fit = 25;
  else if (isVertical && ratio < 1.0 && ratio > 0.5) platform_fit = 25;
  else if (!isHorizontal && !isVertical) platform_fit = 18; // unknown platform — neutral score
  else flags.push('platform_dimension_mismatch');

  // Floor each dimension at 0; cap the sum at 100.
  balance       = Math.max(0, Math.min(25, balance));
  branding      = Math.max(0, Math.min(25, branding));
  focus         = Math.max(0, Math.min(25, focus));
  platform_fit  = Math.max(0, Math.min(25, platform_fit));
  const score = Math.min(100, balance + branding + focus + platform_fit);

  return {
    score,
    balance,
    branding,
    focus,
    platform_fit,
    flags,
    preset: 'composition_v1',
  };
}

/**
 * Brand-placement defaults used when overlay rendering is skipped (the
 * composition branch). Mirrors the lower-right placement
 * `buildOverlaySvg` would have produced for the same platform/size; the
 * brand mark stays self-consistent across both modes.
 */
export function defaultBrandPlacement(input: {
  width: number;
  height: number;
  fileNamePrefix: string;
}): { top: number; left: number; maxWidth: number; maxHeight: number; size: number } {
  const size = Math.round(Math.min(input.width, input.height) * (input.fileNamePrefix === 'banner' ? 0.10 : 0.08));
  const margin = Math.round(size * 0.5);
  return {
    top:  input.height - size - margin,
    left: input.width  - size - margin,
    maxWidth: size,
    maxHeight: size,
    size,
  };
}

export async function renderCreatorAssetReviewPreview(input: CreatorReviewPreviewInput): Promise<{
  buffer: Buffer;
  metadata: Record<string, unknown>;
}> {
  const fileNamePrefix = input.assetType;
  const { width, height } = resolveRenderSize(input.platform, fileNamePrefix);
  const assetPayload: Record<string, unknown> = {
    asset_kind: 'image',
    color_palette: input.colors || [],
    overlay_text: input.overlayText,
    visual_descriptor: {
      headline: input.title,
      visual_description: input.body,
    },
    media_bundle: {
      metadata: {
        platform: input.platform,
        content_type: fileNamePrefix,
        topic: input.title,
        summary: input.body,
        overlay_text: input.overlayText,
        selected_brand_assets: input.brand || {},
        brand_context: {
          overrides: input.brand || {},
          profile: input.brand || {},
        },
      },
    },
  };
  const metadata = safeObject(safeObject(assetPayload.media_bundle).metadata);
  const brandKit = resolveCreatorBrandKit({
    assetPayload,
    metadata,
    platform: input.platform,
    assetType: fileNamePrefix,
  });
  const brandColors = brandKit.normalizedPalette;
  const overlay = normalizeOverlayText({ assetPayload, metadata, title: input.title, body: input.body });
  // Seed the background with a per-ASSET token (the title) so different assets
  // for the same company don't all render the identical gradient — layoutVariantId
  // alone is constant per brand. Stays on-brand (same palette), varies arrangement.
  // CREATOR-094: seed the layout variant from the Sample Definition's GenerationDNA
  // (composition/renderingStyle/shapeLanguage/etc.) so distinct DNA → distinct
  // arrangement. Identical DNA still yields identical output (unavoidable).
  const dnaSeed = input.designDna
    ? Object.values(input.designDna).map((v) => String(v ?? '')).filter(Boolean).join('|')
    : '';
  const background = await renderBackgroundPng({ width, height, colors: brandColors, variantId: `${brandKit.layoutVariantId}:${dnaSeed || String(input.title || '').slice(0, 48)}` });
  const overlayRender = buildOverlaySvg({
    width,
    height,
    overlay,
    brandKit,
    platform: input.platform,
    fileNamePrefix,
  });
  const buffer = await sharp(background)
    .composite([{ input: Buffer.from(overlayRender.svg), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return {
    buffer,
    metadata: {
      width,
      height,
      preview_kind: 'visual_review_sample',
      platform: input.platform,
      asset_type: input.assetType,
      overlay_text: overlay,
      overlay_quality: overlayRender.quality,
      overlay_renderer: 'deterministic_svg_v1',
      ...buildCreatorBrandKitMetadata(brandKit, {
        platform: input.platform,
        overlayConfiguration: {
          ...brandKit.overlayStrategy,
          preset: overlayRender.quality.preset,
          overlay_text: overlay,
        },
        exportCapabilities: ['preview'],
      }),
    },
  };
}

/**
 * CREATOR-106 — carousel-SHAPED review preview. A carousel sample must LOOK like a
 * multi-slide carousel, not the flat single image the image gallery shows. We render
 * three real slides from the SAME design DNA (cover → body → CTA), then compose them
 * as a peeking deck on a neutral canvas with page dots — unmistakably a carousel.
 */
