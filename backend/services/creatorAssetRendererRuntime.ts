/** Part 10/10 of creatorAssetRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
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
import { sharp, type RenderedMediaBundle, type RenderOptions, safeObject, escapeXml, createFallbackUrl, classifyPdfStorageFailure, USER_MESSAGE_FOR_PDF_FALLBACK, compactText, buildAccessibleAltText, normalizeOverlayText, resolveRenderSize, getOverlayPreset } from './creatorAssetRendererContracts';
import { buildOverlaySvg } from './creatorAssetRendererOverlay';
import { buildAiImagePrompt } from './creatorAssetRendererSvg';
import { uploadRenderedPng, IMAGE_SUBTYPE_HINTS, resolveImageSubtype, resolveAttachmentRenderMode } from './creatorAssetRendererMedia';
import { composeSingleVisualAsset, computeCompositionQuality } from './creatorAssetRendererImage';
import { renderCarouselAsset, renderPdfAsset, renderSliderAsset } from './creatorAssetRendererCompose';
import { renderInfographicAsset } from './creatorAssetRendererInfographic';

async function renderBrandCardAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
): Promise<RenderedMediaBundle> {
  const metadata = safeObject(safeObject(assetPayload.media_bundle).metadata);
  const platform = compactText(metadata.platform || metadata.primary_platform, 'linkedin');
  const { width, height } = resolveRenderSize(platform, 'image');
  // Phase 4B — brand card adopts the BrandRuntime via the 1C adapter when a
  // published brand_identity row exists; otherwise the exact legacy resolver
  // path (defaults-only byte-identical). Same source guard as Phase 4A.
  const brandRuntime = options.companyId
    ? await resolveBrand(options.companyId).catch(() => null)
    : null;
  const isBrandedRuntime = !!(brandRuntime && brandRuntime.meta.source === 'brand_identity');
  const brandKit = isBrandedRuntime
    ? brandRuntimeToCreatorBrandKit(brandRuntime, { assetPayload, metadata, platform, assetType: 'brand_card' })
    : resolveCreatorBrandKit({
        assetPayload,
        metadata,
        companyId: options.companyId,
        tenantId: options.companyId,
        platform,
        assetType: 'brand_card',
      });
  const overlay = normalizeOverlayText({
    assetPayload,
    metadata,
    title: compactText(metadata.topic, 'Brand card'),
    body: compactText(metadata.summary, ''),
  });
  const corrected = autoCorrectVisualCopy({
    assetType: 'brand_card',
    textBlocks: [overlay.keyInsight || overlay.headline || overlay.hook],
    allowCTA: false,
  });
  const quote = corrected.textBlocks[0] || 'A clear point of view, rendered with restraint.';
  const quality = scoreCreatorQuality({
    assetType: 'brand_card',
    platform,
    textBlocks: [quote],
    hasCTA: false,
    duplicateText: false,
    overlapRisk: quote.length > 180,
    tinyTextRisk: false,
  });
  const visualGovernance = validateVisualGovernance({
    assetType: 'brand_card',
    platform,
    textBlocks: [quote],
    hasCTA: false,
    textAreaPercent: estimateTextAreaPercent({ textBlocks: [quote], width, height, typographyScale: 'large' }),
    paragraphCount: quote.length > 120 ? 1 : 0,
    overlapRisk: quote.length > 180,
    tinyTextRisk: false,
  });
  const previewGovernanceWarnings = buildPreviewGovernanceWarnings({
    validation: visualGovernance,
    quality,
  });
  const geometry = validateLayoutGeometry({
    width,
    height,
    boxes: [
      estimateTextBox({
        id: 'quote',
        text: quote,
        x: Math.round(width * 0.14),
        y: Math.round(height * 0.32),
        maxWidth: Math.round(width * 0.68),
        fontSize: Math.round(width * 0.038),
        maxLines: 4,
        role: 'quote',
      }),
    ],
    foreground: '#111827',
    background: '#ffffff',
    minFontSize: 18,
  });
  let providerTextValidation = { ok: true, flags: [] as string[], mode: 'embedded_copy' as const, confidence: undefined as number | undefined, provider: undefined as string | undefined };
  const quoteAltText = buildAccessibleAltText(quote, { kind: 'quote', platform });
  const accessibilityValidation = validateCreatorAccessibility({
    altText: quoteAltText,
    readingOrder: ['quote', 'brand'],
    minFontSize: 18,
    contrastRatio: geometry.contrastRatio,
  });
  const manifest = createRenderManifest({
    rendererId: getCreatorRendererRegistration('brand_card').rendererId,
    platformProfile: resolvePlatformVisualProfile(platform) as unknown as Record<string, unknown>,
    governanceProfile: resolveAssetGovernanceProfile('brand_card') as unknown as Record<string, unknown>,
    qualityScore: quality,
    validationResult: visualGovernance,
    ocrResult: providerTextValidation,
    typographySafetyResult: geometry,
    transformIntent: typeof metadata.source_text_transform === 'string' ? metadata.source_text_transform : null,
    exportMetadata: { width, height, preview_kind: 'brand_card_composition' },
    altText: quoteAltText,
    readingOrder: ['quote', 'brand'],
    accessibilityValidation,
  });
  const palette = brandKit.normalizedPalette;
  const bg = palette[0] || '#111827';
  // Phase 4B — canonical (WCAG) accent instead of positional palette[1].
  // Byte-identical for a defaults-only tenant (accentColor === palette[1]).
  const accent = brandKit.accentColor || palette[1] || '#38bdf8';
  // Phase 4B — adopt the brand font for a branded tenant; preserve the EXACT
  // per-spot default literals otherwise (the <text> spots used 'Inter, Arial'
  // and the body CSS used 'Inter,Arial,sans-serif'). Weights are bespoke
  // card-design constants and are intentionally preserved (no weight-driven
  // regression; no geometry change).
  const brandFont = isBrandedRuntime && typeof brandKit.typography?.fontFamily === 'string' && brandKit.typography.fontFamily.trim()
    ? brandKit.typography.fontFamily.trim().replace(/"/g, "'")
    : null;
  const fontAttr = brandFont ?? 'Inter, Arial';
  const fontCss = brandFont ?? 'Inter,Arial,sans-serif';
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="${bg}"/>
      <rect x="${Math.round(width * 0.07)}" y="${Math.round(height * 0.12)}" width="${Math.round(width * 0.86)}" height="${Math.round(height * 0.76)}" rx="8" fill="#ffffff" opacity="0.96"/>
      <rect x="${Math.round(width * 0.07)}" y="${Math.round(height * 0.12)}" width="10" height="${Math.round(height * 0.76)}" fill="${accent}"/>
      <text x="${Math.round(width * 0.14)}" y="${Math.round(height * 0.28)}" font-size="${Math.round(width * 0.045)}" font-family="${fontAttr}" font-weight="900" fill="#0f172a">“</text>
      <foreignObject x="${Math.round(width * 0.14)}" y="${Math.round(height * 0.32)}" width="${Math.round(width * 0.68)}" height="${Math.round(height * 0.34)}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:${fontCss};font-size:${Math.round(width * 0.038)}px;line-height:1.12;font-weight:850;color:#111827;">${escapeXml(quote)}</div>
      </foreignObject>
      <text x="${Math.round(width * 0.14)}" y="${Math.round(height * 0.77)}" font-size="${Math.round(width * 0.022)}" font-family="${fontAttr}" font-weight="800" fill="${accent}">${escapeXml(compactText(metadata.company_name || metadata.companyName || 'Brand perspective', 'Brand perspective'))}</text>
    </svg>
  `;
  const fileBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const finalOcr = await runCreatorOcr({
    image: fileBuffer,
    assetType: 'brand_card',
    platform,
    attachmentMode: 'embedded_copy',
    mimeType: 'image/png',
  });
  providerTextValidation = {
    ok: finalOcr.ok,
    flags: finalOcr.flags,
    mode: 'embedded_copy',
    confidence: finalOcr.confidence,
    provider: finalOcr.provider,
  };
  manifest.ocrResult = providerTextValidation;
  if (metadata.writer_asset_type || metadata.attachment_mode) assertRenderManifestExportable(manifest);
  const brandCardValidationManifest = { governance: visualGovernance, ocr: providerTextValidation, geometry, accessibility: accessibilityValidation, final_ocr: finalOcr };
  void persistCreatorValidationManifest({
    rendererId: getCreatorRendererRegistration('brand_card').rendererId,
    assetType: 'brand_card',
    platform,
    attachmentMode: typeof metadata.attachment_mode === 'string' ? metadata.attachment_mode : 'embedded_copy',
    renderManifest: manifest as unknown as Record<string, unknown>,
    validationManifest: brandCardValidationManifest as unknown as Record<string, unknown>,
    auditId: typeof metadata.render_audit_id === 'string' ? metadata.render_audit_id : null,
  });
  const rendererMetadata = {
    width,
    height,
    preview_kind: 'brand_card_composition',
    renderer_pipeline: 'dedicated_brand_card_svg_v1',
    brand_card_quote: quote,
    brand_emphasis: 'balanced',
    logo_zone: 'lower_right_optional',
    platform_visual_profile: resolvePlatformVisualProfile(platform),
    creator_quality_score: quality,
    visual_governance: visualGovernance,
    visual_governance_warnings: previewGovernanceWarnings,
    validation_manifest: brandCardValidationManifest,
    accessibility_manifest: accessibilityValidation,
    final_ocr: finalOcr,
    render_manifest: manifest,
    renderer_id: getCreatorRendererRegistration('brand_card').rendererId,
    auto_corrections: corrected.corrections,
    overlay_renderer: 'deterministic_svg_brand_card_v1',
  };
  const url = await uploadRenderedPng({
    fileBuffer,
    campaignId: options.campaignId,
    userId: options.userId,
    companyId: options.companyId,
    fileNamePrefix: 'brand_card',
    metadata: rendererMetadata,
  });
  return { url, metadata: { ...rendererMetadata, generated_by: 'brandCardRenderer' } };
}

type WriterRendererKind =
  | 'supporting_image'
  | 'banner'
  | 'infographic'
  | 'carousel'
  | 'pdf'
  | 'slider'
  | 'brand_card'
  | 'legacy_image'
  | 'legacy_video';

function resolveWriterRendererKind(input: { assetKind: string; metadata: Record<string, unknown> }): WriterRendererKind {
  const writerAssetType = String(input.metadata.writer_asset_type || '').trim().toLowerCase();
  const contentType = String(input.metadata.creator_content_asset_type || input.metadata.content_type || '').trim().toLowerCase();
  if (writerAssetType === 'supporting_image' || contentType === 'supporting_image') return 'supporting_image';
  if (writerAssetType === 'banner' || contentType === 'banner') return 'banner';
  if (writerAssetType === 'infographic' || contentType === 'infographic') return 'infographic';
  if (writerAssetType === 'brand_card' || contentType === 'brand_card') return 'brand_card';
  if (writerAssetType === 'pdf' || contentType === 'pdf') return 'pdf';
  if (writerAssetType === 'slider' || contentType === 'slider') return 'slider';
  if (writerAssetType === 'carousel' || contentType === 'carousel') return 'carousel';
  if (input.assetKind === 'image') return 'legacy_image';
  return 'legacy_video';
}

export const SupportingImageRenderer = {
  render: (assetPayload: Record<string, unknown>, options: RenderOptions): Promise<RenderedMediaBundle> =>
    composeSingleVisualAsset(assetPayload, options, 'image', getCreatorRendererRegistration('supporting_image').rendererId, 'supporting_image'),
};

export const BannerRenderer = {
  render: (assetPayload: Record<string, unknown>, options: RenderOptions): Promise<RenderedMediaBundle> =>
    composeSingleVisualAsset(assetPayload, options, 'banner', getCreatorRendererRegistration('banner').rendererId, 'banner'),
};

// Platform-aware text image — SAME composer + text-capable (banner) governance
// and embedded overlay as BannerRenderer, but the 'image' fileNamePrefix makes
// resolveRenderSize use the platform-native canvas (square/portrait/landscape)
// instead of the fixed banner 16:9. No duplicate path: it is the existing
// composeSingleVisualAsset with a platform-sized canvas. Branding, safe
// margins, typography, and logo placement flow through unchanged.
export const TextImageRenderer = {
  render: (assetPayload: Record<string, unknown>, options: RenderOptions): Promise<RenderedMediaBundle> =>
    composeSingleVisualAsset(assetPayload, options, 'image', getCreatorRendererRegistration('banner').rendererId, 'banner'),
};

export const BrandCardRenderer = {
  render: (assetPayload: Record<string, unknown>, options: RenderOptions): Promise<RenderedMediaBundle> =>
    renderBrandCardAsset(assetPayload, options),
};

export const InfographicRenderer = {
  render: (assetPayload: Record<string, unknown>, options: RenderOptions): Promise<RenderedMediaBundle> =>
    renderInfographicAsset(assetPayload, options),
};

export const CarouselRenderer = {
  render: (
    assetPayload: Record<string, unknown>,
    options: RenderOptions,
    items: Record<string, unknown>[],
  ): Promise<RenderedMediaBundle> =>
    renderCarouselAsset(assetPayload, options, items),
};

export const PdfRenderer = {
  render: (
    assetPayload: Record<string, unknown>,
    options: RenderOptions,
    items: Record<string, unknown>[],
  ): Promise<RenderedMediaBundle> =>
    renderPdfAsset(assetPayload, options, items),
};

export const SliderRenderer = {
  render: (
    assetPayload: Record<string, unknown>,
    options: RenderOptions,
    items: Record<string, unknown>[],
  ): Promise<RenderedMediaBundle> =>
    renderSliderAsset(assetPayload, options, items),
};

async function renderAssetDispatch(
  assetPayload: Record<string, unknown>,
  options: RenderOptions = {}
): Promise<RenderedMediaBundle> {
  const renderStartedAt = Date.now();
  const assetKind = String(assetPayload.asset_kind || '').trim();
  const metadata = safeObject(safeObject(assetPayload.media_bundle).metadata);
  const rendererKind = resolveWriterRendererKind({ assetKind, metadata });

  try {
    if (assetKind === 'image') {
      // Platform-aware "Text Inside Image" — a template-authoritative text
      // overlay renders through the text-capable governance lane but at the
      // PLATFORM-NATIVE canvas (square / portrait / landscape via
      // imageStyle.canvas.byPlatform) instead of the fixed banner 16:9.
      // Template owns the visual language (typography/presets/branding via the
      // overlay style); the platform owns only the output dimensions. Existing
      // banner generation (no authoritative marker) is untouched below.
      const overlayAuthoritative = safeObject(assetPayload.overlay_text).__template_authoritative === true
        || safeObject(metadata.overlay_text).__template_authoritative === true;
      if (rendererKind === 'banner' && overlayAuthoritative) return await TextImageRenderer.render(assetPayload, options);
      if (rendererKind === 'supporting_image') return await SupportingImageRenderer.render(assetPayload, options);
      if (rendererKind === 'banner') return await BannerRenderer.render(assetPayload, options);
      if (rendererKind === 'infographic') return await InfographicRenderer.render(assetPayload, options);
      if (rendererKind === 'brand_card') return await BrandCardRenderer.render(assetPayload, options);
      return await composeSingleVisualAsset(assetPayload, options, 'image', 'legacy-image-renderer');
    }

    if (assetKind === 'carousel') {
      const slides = Array.isArray(assetPayload.slides)
        ? assetPayload.slides.filter((slide) => slide && typeof slide === 'object' && !Array.isArray(slide)).map((slide) => slide as Record<string, unknown>)
        : [];
      const threadSequence = Array.isArray(assetPayload.thread_sequence)
        ? assetPayload.thread_sequence.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => item as Record<string, unknown>)
        : [];
      const items = slides.length > 0 ? slides : threadSequence;
      if (items.length > 0) {
        if (rendererKind === 'pdf') return await PdfRenderer.render(assetPayload, options, items);
        if (rendererKind === 'slider') return await SliderRenderer.render(assetPayload, options, items);
        return await CarouselRenderer.render(assetPayload, options, items);
      }
    }

    if (assetKind === 'video') {
      return {
        url: createFallbackUrl('Creator Video', 1280, 720),
        metadata: {
          width: 1280,
          height: 720,
          generated_by: 'creatorAssetRenderer',
          placeholder: true,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const writerGoverned = Boolean(metadata.writer_asset_type || metadata.attachment_mode || metadata.asset_composition_intent);
    if (writerGoverned) {
      creatorEvent('overlay', 'error', {
        category: 'governed_render_failed_closed',
        assetType: assetKind,
        creatorType: assetKind,
        message,
        platform: typeof metadata.platform === 'string' ? metadata.platform : null,
        attachmentMode: typeof metadata.attachment_mode === 'string' ? metadata.attachment_mode : null,
      });
      throw new Error(`governed_render_failed_closed:${message}`);
    }
    console.warn('[creator-asset-renderer][render-fallback-used]', {
      message,
      assetKind,
      contentType: metadata.content_type,
    });
    creatorEvent('overlay', 'error', {
      category:    'render_fallback_used',
      assetType:   assetKind,
      creatorType: assetKind,
      message,
      contentType: metadata.content_type as string | undefined,
      platform:    typeof metadata.platform === 'string' ? metadata.platform : null,
      attachmentMode: typeof metadata.attachment_mode === 'string' ? metadata.attachment_mode : null,
      subtype:     typeof safeObject(metadata.creator_card).subtype === 'string' ? safeObject(metadata.creator_card).subtype as string : null,
    });
    return {
      url: createFallbackUrl('Creator Asset', 1200, 1200),
      metadata: {
        width: 1200,
        height: 1200,
        generated_by: 'creatorAssetRenderer',
        placeholder: true,
        fallback_reason: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    recordCreatorDuration('render_asset', Date.now() - renderStartedAt, {
      assetKind,
      contentType: typeof metadata.content_type === 'string' ? metadata.content_type : null,
      platform: typeof metadata.platform === 'string' ? metadata.platform : null,
    });
  }

  return {
    url: createFallbackUrl('Creator Asset', 1200, 1200),
    metadata: {
      width: 1200,
      height: 1200,
      generated_by: 'creatorAssetRenderer',
      placeholder: true,
    },
  };
}

/**
 * Public render entry — composes the asset, then applies the canonical
 * deterministic POST-RENDER visual validation. On a repairable failure it
 * deterministically shortens copy and RE-RENDERS once, re-validates, and keeps
 * the better result. The final `visual_validation` verdict is attached to the
 * returned metadata. Universal: image renders here inline (orchestrator) and
 * carousel/infographic render here in the durable worker, so every asset is
 * validated. Placeholder/fallback assets carry no quality signals → they pass
 * (we never fail assets we cannot deterministically assess).
 */
export async function renderAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions = {},
): Promise<RenderedMediaBundle> {
  const { validateCreatorVisual, applyVisualRepair } =
    require('./creator/creatorVisualValidation') as typeof import('./creator/creatorVisualValidation');
  const contentType = String(
    safeObject(safeObject(assetPayload.media_bundle).metadata).content_type || assetPayload.asset_kind || '',
  );

  let bundle = await renderAssetDispatch(assetPayload, options);
  let verdict = validateCreatorVisual(safeObject(bundle.metadata), contentType);

  if (!verdict.passed && verdict.repairHint && !safeObject(bundle.metadata).placeholder) {
    const repairedPayload = applyVisualRepair(assetPayload, verdict.repairHint);
    const retryBundle = await renderAssetDispatch(repairedPayload, options);
    const retryVerdict = validateCreatorVisual(safeObject(retryBundle.metadata), contentType);
    // Keep the retry when it passes or strictly reduces the failure count.
    if (retryVerdict.passed || retryVerdict.failures.length < verdict.failures.length) {
      bundle = retryBundle;
      verdict = retryVerdict;
    }
  }

  return {
    ...bundle,
    metadata: { ...safeObject(bundle.metadata), visual_validation: verdict },
  };
}

// ── Test-only internal exports ───────────────────────────────────────────────
// Pure helpers exposed for unit tests. NOT a public API; do not call these
// from production code paths — use the higher-level `renderAsset` entry
// point instead. Keeping the surface explicit so the module's actual public
// API stays compact.
export const __test = {
  resolveAttachmentRenderMode,
  resolveWriterRendererKind,
  resolveImageSubtype,
  buildAiImagePrompt,
  IMAGE_SUBTYPE_HINTS,
  classifyPdfStorageFailure,
  USER_MESSAGE_FOR_PDF_FALLBACK,
  computeCompositionQuality,
  // TEMPLATE-005 — pure platform preset + canvas resolvers, exposed so the
  // migration can be proven byte-identical exhaustively (every platform ×
  // density × file-kind × subtype) without a live image provider.
  getOverlayPreset,
  resolveRenderSize,
  // TEMPLATE-015 — overlay SVG builder + brand-kit resolver, exposed so image
  // style-variant activation (overlay text colors + platform-precedence) can be
  // validated deterministically without a live image provider.
  buildOverlaySvg,
  resolveCreatorBrandKit,
};

