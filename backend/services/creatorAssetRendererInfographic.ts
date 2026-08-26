/** Part 9/10 of creatorAssetRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
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
import { sharp, unsupportedFamilyConditionDegradation, type RenderedMediaBundle, type RenderOptions, getCachedRenderBuffer, safeObject, escapeXml, balanceTextLines, renderWrappedBodyText, blueprintIdForRender, curatedDesignTemplate, resolveInfographicRenderStyle, compactText, buildAccessibleAltText, resolveRenderSize, fitTextToBox } from './creatorAssetRendererContracts';
import { loadBrandMark } from './creatorAssetRendererOverlay';
import { bufferFromRemoteImage } from './creatorAssetRendererSvg';
import { uploadRenderedPng } from './creatorAssetRendererMedia';
import { stripPromptDirectives } from './creatorAssetRendererCarousel';
import { planInfographicContent, resolveInfographicSections, resolveInfographicLayout, validateInfographicDensity, resolveInfographicEngine, estimateDenseBodyHeight } from './creatorAssetRendererCompose';

export async function renderInfographicAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
): Promise<RenderedMediaBundle> {
  const metadata = safeObject(safeObject(assetPayload.media_bundle).metadata);
  const platform = compactText(metadata.platform || metadata.primary_platform, 'social');
  // `height` is content-driven below (≈10% white-space target), so it is mutable.
  const { width } = resolveRenderSize(platform, 'infographic');
  let height = resolveRenderSize(platform, 'infographic').height;
  // Phase 4A — first visual consumer adoption. When a tenant has a PUBLISHED
  // brand_identity row, the kit is sourced from the BrandRuntime via the 1C
  // adapter (typography + canonical accent + palette). Otherwise the exact
  // legacy resolver path runs → byte-identical output for a defaults-only
  // tenant. Only the SOURCE of the kit changes; geometry/asset context is
  // threaded through unchanged.
  const brandRuntime = options.companyId
    ? await resolveBrand(options.companyId).catch(() => null)
    : null;
  const brandKit = brandRuntime && brandRuntime.meta.source === 'brand_identity'
    ? brandRuntimeToCreatorBrandKit(brandRuntime, { assetPayload, metadata, platform, assetType: 'infographic' })
    : resolveCreatorBrandKit({
        assetPayload,
        metadata,
        companyId: options.companyId,
        tenantId: options.companyId,
        platform,
        assetType: 'infographic',
      });
  // CREATOR-106: the chosen Marketing Sample drives the infographic accent so the output
  // visibly aligns with the picked template (technology→indigo, healthcare→green, …).
  // `accent = brandKit.accentColor || …` downstream, so overriding it re-tints the
  // stat chips, accent stripes, chart bars, and icon wells to the sample's colour.
  const sampleAccent = typeof metadata.blueprint_color_primary === 'string' && /^#[0-9a-f]{6}$/i.test(metadata.blueprint_color_primary)
    ? metadata.blueprint_color_primary
    : null;
  if (sampleAccent) (brandKit as { accentColor?: string }).accentColor = sampleAccent;
  // CREATOR-114: when a sample is selected, the SAMPLE's semantic structure decides the
  // slot count (3 KPIs / 4 steps / 2 columns …) — the content planner produces exactly
  // that many. No blueprint → the generic section extractor runs unchanged (RULE 7).
  // CREATOR-127: a resolved curated TEMPLATE provides the slot count from its own
  // semantic structure; otherwise fall back to the blueprint's (RULE 7 generic path
  // when neither is present).
  const designTemplate = curatedDesignTemplate(metadata);
  const semanticSlotBlueprint = blueprintIdForRender(metadata);
  const semanticSlotCount = designTemplate
    ? (designTemplate.semanticStructure!.find((b) => b.blockId !== 'hero')?.count ?? null)
    : (semanticSlotBlueprint ? semanticSlotCountForBlueprint(semanticSlotBlueprint) : null);
  const rawSectionsPreFilter = semanticSlotCount != null
    ? planInfographicContent(resolveInfographicSections(assetPayload, metadata), semanticSlotCount, String(metadata.topic || 'Infographic'))
    : resolveInfographicSections(assetPayload, metadata);
  // Operator parity with carousel: strip leaked LLM design directives
  // (e.g., "Use a modern font for the headline with a clean...") from
  // every section's title + body BEFORE auto-correction. The carousel
  // path already filters these at the slide-text level; infographic
  // sections were missing it and the directives surfaced inside cards.
  const rawSections = rawSectionsPreFilter.map((section) => ({
    ...section,
    title: stripPromptDirectives(section.title) || section.title,
    body: stripPromptDirectives(section.body),
  }));
  // CREATOR-108: ONE canonical composition per blueprint is the single source of layout
  // + geometry. When a sample is selected the renderer reads layout/columns/density/hero
  // from this composition; only when blueprint_id == null does it fall back to the
  // generic layout resolver + engine inference (RULE 3/7 — generic path unchanged).
  const infographicComposition = (() => {
    if (designTemplate?.composition) return designTemplate.composition;
    const bp = blueprintIdForRender(metadata);
    return bp ? infographicCompositionForBlueprint(bp) : null;
  })();
  const layout = infographicComposition?.layout ?? resolveInfographicLayout(metadata);
  // autoCorrectVisualCopy ends in `.filter(Boolean)`, dropping empty blocks.
  // Correcting a FLAT [title, body, title, body, …] array therefore shifts
  // the title/body pairing the moment any body is empty — which is the
  // common case for a section without an explicit "Label: detail" form
  // (titles leak into the wrong card, bodies duplicate). Correct each field
  // INDEPENDENTLY so positions can never shift.
  const correctionLog: string[] = [];
  const correctCopyField = (value: string): string => {
    const v = String(value || '');
    if (!v.trim()) return '';
    const c = autoCorrectVisualCopy({ assetType: 'infographic', textBlocks: [v], allowCTA: false });
    correctionLog.push(...c.corrections);
    return c.textBlocks[0] ?? v;
  };
  const sectionsBase = rawSections.map((section) => ({
    ...section,
    title: correctCopyField(section.title) || section.title,
    body: correctCopyField(section.body),
  }));
  const corrected = { corrections: [...new Set(correctionLog)] };

  // Operator feedback: every card needs explanatory text, and the
  // whole infographic must read as one coherent message ending in
  // the desired CTA. Generate contextual section bodies in a single
  // LLM call so the deck flows together. Fails open — if the call
  // errors or returns malformed JSON, sections fall through with
  // their operator-typed bodies (or empty bodies, which the renderer
  // already templates).
  const composerCompanyContext = (() => {
    const brand = safeObject(metadata.brand_context);
    const ctx = {
      name: typeof brand.name === 'string' ? brand.name : (typeof metadata.company_name === 'string' ? metadata.company_name : undefined),
      industry: typeof brand.industry === 'string' ? brand.industry : undefined,
      audience: typeof brand.audience === 'string' ? brand.audience : (typeof metadata.audience === 'string' ? metadata.audience : undefined),
      tone: typeof brand.tone === 'string' ? brand.tone : undefined,
      tagline: typeof brand.tagline === 'string' ? brand.tagline : undefined,
    };
    const anyValue = Object.values(ctx).some((v) => typeof v === 'string' && v.length > 0);
    return anyValue ? ctx : undefined;
  })();
  const composerMode: 'company-context' | 'independent' = String(metadata.brand_mode || '').toLowerCase() === 'independent'
    ? 'independent'
    : (composerCompanyContext ? 'company-context' : 'independent');
  const desiredCta = String(metadata.cta || safeObject(metadata.overlay_text).cta || '').trim();
  const layoutForComposer = infographicComposition?.layout ?? resolveInfographicLayout(metadata);
  const composedCopy = await composeInfographicCopy({
    topic: String(metadata.topic || 'Infographic'),
    layout: layoutForComposer,
    sectionTitles: sectionsBase.map((s) => s.title),
    sectionBodies: sectionsBase.map((s) => s.body),
    cta: desiredCta,
    mode: composerMode,
    companyContext: composerCompanyContext,
    companyId: options.companyId ?? undefined,
    staticOnly: options.previewBufferOnly, // CREATOR-110: previews use static copy (no LLM)
  });
  // Rich-content merge. The composer now returns lead + bullets +
  // stat + example + take per section. The renderer (below) lays
  // those parts out into a dense card composition. Section's
  // historical `body` field is set to the LEAD so legacy code paths
  // (governance density, OCR, etc.) keep working unchanged; the
  // bullets / stat / example / take get attached as extension fields
  // on the same section object.
  const sections = sectionsBase.map((section, index) => {
    const copy = composedCopy.sections[index];
    return {
      ...section,
      body: copy?.lead || section.body,
      bullets: copy?.bullets ?? [],
      stat: copy?.stat ?? null,
      example: copy?.example ?? null,
      take: copy?.take ?? null,
      impact: copy?.impact ?? null,
      risk: copy?.risk ?? null,
    };
  });
  const composerNarrative = composedCopy.narrative;
  const resolvedCta = composedCopy.cta || desiredCta;
  const density = validateInfographicDensity(sections);
  // Parity with carousel density-scoring fix: validate against a
  // REPRESENTATIVE section (the median by word count) rather than the
  // cumulative deck text. Previously the sum of all sections was
  // compared against the per-card budget (`maxWordsPerSlide=72` for
  // infographic), causing false 'text_density_exceeds_profile' /
  // 'visual_cleanliness_low' warnings even when each card was fine.
  const perSectionTextBlocks: string[][] = sections.map((s) => [s.title, s.body].filter(Boolean));
  const sectionWordCounts = perSectionTextBlocks.map((blocks) =>
    blocks.reduce((sum, t) => sum + String(t || '').trim().split(/\s+/).filter(Boolean).length, 0),
  );
  const medianSectionIndex = (() => {
    if (sectionWordCounts.length === 0) return 0;
    const ranked = sectionWordCounts
      .map((count, idx) => ({ count, idx }))
      .sort((a, b) => a.count - b.count);
    return ranked[Math.floor(ranked.length / 2)].idx;
  })();
  const representativeSectionBlocks = perSectionTextBlocks[medianSectionIndex] ?? [];

  const visualGovernance = validateVisualGovernance({
    assetType: 'infographic',
    platform,
    textBlocks: representativeSectionBlocks,
    hasCTA: false,
    textAreaPercent: estimateTextAreaPercent({
      textBlocks: representativeSectionBlocks,
      width,
      height,
      typographyScale: 'standard',
    }),
    paragraphCount: sections.filter((section) => section.body.length > 110).length,
    overlapRisk: !density.ok,
    tinyTextRisk: sections.length > 6,
  });
  const quality = scoreCreatorQuality({
    assetType: 'infographic',
    platform,
    textBlocks: representativeSectionBlocks,
    hasCTA: false,
    duplicateText: false,
    overlapRisk: !density.ok,
    tinyTextRisk: sections.length > 6,
  });
  const previewGovernanceWarnings = buildPreviewGovernanceWarnings({
    validation: visualGovernance,
    quality,
  });
  // Header band height adapts to whether a subtitle line is present. A
  // subtitle needs room for up to 2 wrapped lines beneath the title;
  // with the legacy fixed 150px band the second subtitle line rendered at
  // y≈headerH-12 and got covered by the card panel (operator report:
  // "text is overlapping / hidden"). No subtitle → 150 (byte-identical).
  // The cards are pushed down by the same value via the engine below.
  // Canonical Template visual language — resolved through resolveTemplate().
  // Default (no template) == prior hardcoded constants → byte-identical.
  const infographicStyle = resolveInfographicRenderStyle(metadata);
  const headerSubtitle = composerNarrative || String(metadata.summary || '').trim();
  // CREATOR-107/108: the single canonical composition (computed above) drives the
  // geometry — columns + density + hero come from the SAMPLE, so two samples on the same
  // layout engine still differ. blueprint_id == null → composition null → generic (RULE 7).
  const headerBase = headerSubtitle ? infographicStyle.spacing.headerHeightWithSubtitle : infographicStyle.spacing.headerHeight;
  // CREATOR-116 (RULE 4): measure the headline so a long/wrapping title does not overlap
  // the subtitle or the first card — add a line of headroom per wrapped headline line.
  const headlineText = String(metadata.topic || 'Infographic');
  const headlineLines = Math.max(1, Math.min(3, Math.ceil(headlineText.length / 26)));
  const headerH = Math.round(headerBase * (infographicComposition?.heroScale ?? 1)) + (headlineLines - 1) * 76;

  // Adaptive font multiplier (hoisted here: the content-height estimate below needs it).
  const maxSectionChars = sections.reduce((max, section) =>
    Math.max(max, String(section.title || '').length + String(section.body || '').length), 0);
  const infographicFontMultiplier = (() => {
    const scale = infographicStyle.typography.fontMultiplierScale;
    for (const stop of scale) {
      if (maxSectionChars <= stop.maxSectionChars) return stop.multiplier;
    }
    return scale[scale.length - 1]?.multiplier ?? 1;
  })();

  const engineInput = {
    layout, width, sectionCount: sections.length, headerH,
    sideMargin: infographicStyle.spacing.sideMargin,
    bottomMargin: infographicStyle.spacing.bottomMargin,
    geometry: infographicStyle.geometry.engine,
    columnsOverride: infographicComposition?.columns,
    gapScale: infographicComposition?.densityScale,
  };
  // CONTENT-DRIVEN SIZING (~10% white-space target). Operator feedback: cards still had a
  // large empty lower band. Root cause: a fixed 2×2 grid stretched each card to ~600px on
  // the 1500px canvas while the composed content filled ~250px. Fix: (1) a prelim pass
  // (uncapped) learns the grid shape + card width and the full-fill card height (the
  // ceiling); (2) estimate the content each card holds; (3) size cards to content + ~10%
  // padding (clamped to [layout floor, full-fill ceiling]); (4) shrink the CANVAS to fit
  // the resulting grid. A sparse deck no longer sits in a tall half-empty box; a dense
  // deck still gets the full canvas.
  const prelim = resolveInfographicEngine({ ...engineInput, height });
  const bodyContentWidth = Math.max(80, prelim.cardWidth - 64);
  const estBodyH = sections.reduce((m, s) =>
    Math.max(m, estimateDenseBodyHeight(s as Record<string, unknown>, bodyContentWidth, infographicStyle, infographicFontMultiplier)), 0);
  const bodyInset = (infographicStyle.geometry.layouts as Record<string, { bodyHeightInset?: number }>)[layout]?.bodyHeightInset ?? 110;
  const targetCardH = Math.min(
    prelim.cardHeight,
    Math.max(prelim.minCardHeight, Math.round((estBodyH + bodyInset) / 0.90)),
  );
  const gridH = prelim.rows * targetCardH + prelim.rowGap * Math.max(0, prelim.rows - 1);
  const INFOGRAPHIC_MIN_HEIGHT = 900;
  height = Math.max(INFOGRAPHIC_MIN_HEIGHT, Math.min(height, headerH + gridH + infographicStyle.spacing.bottomMargin));
  const engine = resolveInfographicEngine({ ...engineInput, height, maxCardHeight: targetCardH });
  const geometry = validateLayoutGeometry({
    width,
    height,
    boxes: sections.map((section, index) => estimateTextBox({
      id: `section_${index + 1}`,
      text: `${section.title} ${section.body}`,
      x: engine.position(index).x + 82,
      y: engine.position(index).y + 42,
      maxWidth: engine.cardWidth - 112,
      fontSize: 18,
      maxLines: 5,
      role: layout,
    })),
    foreground: '#111827',
    background: '#f8fafc',
    minFontSize: 16,
  });
  const palette = brandKit.normalizedPalette;
  const bg = palette[0] || infographicStyle.color_scheme.backgroundBase;
  // Phase 4A — use the kit's canonical (WCAG-validated) accent instead of the
  // positional palette[1] assumption. Byte-identical for a defaults-only tenant
  // (chooseAccent(DEFAULT_PALETTE) === palette[1]); branded tenants get the
  // runtime's accent; custom-palette tenants get the contrast-correct accent.
  const accent = brandKit.accentColor || palette[1] || infographicStyle.color_scheme.accent;
  const panel = infographicStyle.color_scheme.panel;
  const text = infographicStyle.color_scheme.primaryText;
  // Brand typography activation (Phase A.1) — consume the brand font (same
  // source the image/overlay path uses) with the prior 'Inter, Arial' literal
  // as the safe fallback, so output is byte-identical when no brand font is set.
  // Colors/neutrals are intentionally NOT changed in this commit.
  // Sanitize double-quotes → single so a quoted brand font (e.g. "Times New
  // Roman") can't break the double-quoted SVG font-family attribute.
  const fontFamily = (typeof brandKit.typography?.fontFamily === 'string' && brandKit.typography.fontFamily.trim())
    ? brandKit.typography.fontFamily.trim().replace(/"/g, "'")
    : infographicStyle.typography.fontFamily;
  const renderBrandBody = (o: Parameters<typeof renderWrappedBodyText>[0]): string =>
    renderWrappedBodyText({ ...o, fontFamily });
  const cardWidth = engine.cardWidth;
  const cardHeight = engine.cardHeight;

  // Enterprise-grade infographic upgrades (operator feedback parity
  // with the carousel improvements):
  //
  //  1. Adaptive font sizing — title + section fonts scale with the
  //     content of the busiest section so we use available space
  //     instead of leaving cards half empty. Same multiplier table
  //     shape as carousel; thresholds tuned for infographic budgets
  //     (cards are smaller than a full slide).
  //
  //  2. Brand mark (logo) top-right — was completely absent before.
  //     Sourced from the same `loadBrandMark` helper that carousel /
  //     image renders use, with `ensureAlpha` so transparency is
  //     preserved (no white patchwork tile).
  //
  //  3. Visual continuity wave — single accent flow line that
  //     sweeps across the canvas. Infographics are a single PNG (not
  //     a deck), so there's no cross-frame continuity to maintain,
  //     but the wave still ties the design language to the carousel
  //     output for brand consistency across content types.
  //
  //  4. Leaky layout identifier (e.g. "DATA_FIRST") removed. The
  //     internal layout key was rendered top-right in caps; replaced
  //     with a clean section count ("5 SECTIONS") as a subtle
  //     metadata indicator instead.
  //
  //  5. Card hierarchy upgrade — accent stripe on the left edge of
  //     every card, removed icon circle's competing focus, increased
  //     internal padding for breathing room.

  // maxSectionChars + infographicFontMultiplier are computed earlier (hoisted above the
  // content-driven engine sizing, which needs the multiplier for its height estimate).
  const titleFontSize = Math.round(infographicStyle.typography.baseSizes.headerTitle * infographicFontMultiplier);
  const cardTitleFontSize = Math.round(infographicStyle.typography.baseSizes.cardTitle * infographicFontMultiplier);

  // Brand mark placement — top-right, sized at ~14% canvas width.
  const logoMaxWidth = Math.round(width * 0.14);
  const logoMaxHeight = Math.round(height * 0.07);
  const brandPlacement = {
    top: 56,
    left: width - 80 - logoMaxWidth,
    maxWidth: logoMaxWidth,
    maxHeight: logoMaxHeight,
  };
  const brandMark = await loadBrandMark({ brandKit, placement: brandPlacement });

  // ── Background image mode (Phase 4) — opt-in + flag-gated. Resolves to
  //    gradient unless image mode is requested WITH a usable URL AND the
  //    flag is on. The fetched image becomes the sharp BASE layer; the
  //    SVG (which carries a MANDATORY overlay scrim, header, panel, and
  //    cards) composites on top, so the image is never rendered raw and
  //    card/header text contrast is preserved. Any fetch/decode failure
  //    falls back to gradient → byte-identical with default.
  const backgroundConfig = resolveBackgroundConfig(metadata);
  let backgroundImageBuffer: Buffer | null = null;
  if (
    infographicBackgroundImagesEnabled()
    && backgroundConfig.mode === 'image'
    && backgroundConfig.imageUrl
  ) {
    try {
      const cacheKey = `infographic-bg:${backgroundConfig.imageUrl}:${width}x${height}`;
      backgroundImageBuffer = await getCachedRenderBuffer(cacheKey, async () => {
        const raw = await bufferFromRemoteImage(backgroundConfig.imageUrl as string);
        return sharp(raw, { failOn: 'none' })
          .resize(width, height, { fit: 'cover' })
          .png()
          .toBuffer();
      });
    } catch {
      backgroundImageBuffer = null; // fail-open to gradient
    }
  }
  const backgroundMode = backgroundImageBuffer ? 'image' : 'gradient';
  const backgroundLayerSvg = buildBackgroundLayerSvg({
    mode: backgroundMode,
    width,
    height,
    imageOpacity: backgroundConfig.imageOpacity,
  });

  // Visual continuity wave. Single accent stroke from left to right
  // with a gentle sway. Lives inside the inner safe area so it
  // doesn't crowd the title or section cards.
  const waveGeom = infographicStyle.geometry.wave;
  const waveTopY = headerH - waveGeom.topOffset;
  const waveEntryY = waveTopY;
  const waveExitY = waveTopY + Math.round(height * waveGeom.exitYRatio);
  const waveCpAY = waveTopY - Math.round(height * waveGeom.cpAYRatio);
  const waveCpBY = waveTopY + Math.round(height * waveGeom.cpBYRatio);
  const wavePath = `M ${waveGeom.startXInset} ${waveEntryY} C ${Math.round(width * waveGeom.cpAXRatio)} ${waveCpAY}, ${Math.round(width * waveGeom.cpBXRatio)} ${waveCpBY}, ${width - waveGeom.endXInset} ${waveExitY}`;
  const waveStrokeWidth = Math.max(2, Math.round(height * infographicStyle.decoration_style.wave.strokeWidthRatio));

  // Operator feedback: the previous renderer produced "text cards" —
  // four small boxes with title + body, no visual hierarchy, no
  // layout-specific treatment. That's NOT an infographic; an
  // infographic visualizes information with structure that matches
  // the layout pattern (numbered steps for process, big numerals
  // for stats, side-by-side for comparison, etc).
  //
  // Each layout below now produces a distinct visual treatment:
  //
  //   stats      → giant numeral / percentage callout + small caption
  //   process    → numbered step circle + arrow connector to next
  //   comparison → grouped 2-column with center divider + verdict row
  //   timeline   → milestone dot on a left rail + date-style label
  //   framework  → pillar card with header band + body
  //   hierarchy  → indented row with step-number badge
  //
  // All treatments share: card panel + accent color + title + body,
  // so the baseline contract is preserved when layout-specific
  // elements can't be derived.
  const accentSecondary = palette[2] || '#0ea5e9';
  const accentTertiary = palette[3] || '#a855f7';
  const bodyTextColor = infographicStyle.color_scheme.bodyText;
  const tinyLabelColor = infographicStyle.color_scheme.tinyLabelText;

  const renderCardBase = (x: number, y: number, accentFill: string, h: number = cardHeight): string => `
    <rect x="${x}" y="${y}" width="${cardWidth}" height="${h}" rx="${infographicStyle.card_style.cornerRadius}" fill="${panel}" opacity="${infographicStyle.card_style.fillOpacity}" />
    <rect x="${x}" y="${y}" width="${infographicStyle.card_style.accentStripeWidth}" height="${h}" rx="${infographicStyle.card_style.accentStripeRadius}" fill="${accentFill}" />
  `;

  /**
   * Universal infographic glyphs. Returns the inline SVG markup for a
   * symbolic icon centered at (cx, cy) at the supplied size in white,
   * intended to sit ON TOP of a colored accent disc (rendered by the
   * caller). Cycles through 6 concept icons by index so non-data
   * stat cards visually vary across a deck.
   */
  const renderConceptGlyph = (cx: number, cy: number, size: number, idx: number, accentForCenterDisc: string): string => {
    const variant = idx % 6;
    const s = size;
    const gg = infographicStyle.geometry.glyph;
    const gf = infographicStyle.icon_style.glyphFill;
    if (variant === 0) {
      // Lightbulb (insight / idea)
      const g = gg.lightbulb;
      return `
        <path d="M ${cx - s * g.r} ${cy - s * g.topDy} a ${s * g.r} ${s * g.r} 0 1 1 ${s} 0 c ${s * g.c1[0]} ${s * g.c1[1]} -${s * g.c1[2]} ${s * g.c1[3]} -${s * g.c1[4]} ${s * g.c1[5]} l -${s * g.lDx} 0 c -${s * g.c2[0]} -${s * g.c2[1]} -${s * g.c2[2]} -${s * g.c2[3]} -${s * g.c2[4]} -${s * g.c2[5]} z" fill="${gf}" />
        <rect x="${cx - s * g.b1[0]}" y="${cy + s * g.b1[1]}" width="${s * g.b1[2]}" height="${s * g.b1[3]}" rx="${s * g.b1[4]}" fill="${gf}" />
        <rect x="${cx - s * g.b2[0]}" y="${cy + s * g.b2[1]}" width="${s * g.b2[2]}" height="${s * g.b2[3]}" rx="${s * g.b2[4]}" fill="${gf}" />
      `;
    }
    if (variant === 1) {
      // Target / bullseye (goal / focus)
      const g = gg.target;
      return `
        <circle cx="${cx}" cy="${cy}" r="${s * g.r1}" fill="none" stroke="${gf}" stroke-width="${s * g.sw1}" />
        <circle cx="${cx}" cy="${cy}" r="${s * g.r2}" fill="none" stroke="${gf}" stroke-width="${s * g.sw2}" />
        <circle cx="${cx}" cy="${cy}" r="${s * g.r3}" fill="${gf}" />
      `;
    }
    if (variant === 2) {
      // Upward growth arrow (growth / trend)
      const g = gg.arrow;
      const tip = s * g.tip;
      return `
        <polyline points="${cx - tip},${cy + s * g.p1y} ${cx - s * g.p2x},${cy} ${cx},${cy + s * g.p3y} ${cx + tip},${cy - s * g.p4y}" fill="none" stroke="${gf}" stroke-width="${s * g.sw}" stroke-linecap="round" stroke-linejoin="round" />
        <polygon points="${cx + tip - s * g.headBackX},${cy - s * g.headY} ${cx + tip},${cy - s * g.headY} ${cx + tip},${cy - s * g.headTipY}" fill="${gf}" />
      `;
    }
    if (variant === 3) {
      // Checkmark (validation / done)
      const g = gg.check;
      return `
        <polyline points="${cx - s * g.p1x},${cy + s * g.p1y} ${cx - s * g.p2x},${cy + s * g.p2y} ${cx + s * g.p3x},${cy - s * g.p3y}" fill="none" stroke="${gf}" stroke-width="${s * g.sw}" stroke-linecap="round" stroke-linejoin="round" />
      `;
    }
    if (variant === 4) {
      // Lightning bolt (impact / energy)
      const b = gg.bolt;
      return `
        <polygon points="${cx + s * b[0]},${cy - s * b[1]} ${cx - s * b[2]},${cy + s * b[3]} ${cx - s * b[4]},${cy + s * b[5]} ${cx - s * b[6]},${cy + s * b[7]} ${cx + s * b[8]},${cy - s * b[9]} ${cx + s * b[10]},${cy - s * b[11]}" fill="${gf}" />
      `;
    }
    // variant 5 — Gear (process / system)
    const g = gg.gear;
    const teeth = g.teeth;
    const outerR = s * g.outerR;
    const innerR = s * g.innerR;
    const path: string[] = [];
    for (let i = 0; i < teeth; i += 1) {
      const a1 = (i / teeth) * 2 * Math.PI;
      const a2 = ((i + 0.5) / teeth) * 2 * Math.PI;
      path.push(`${cx + outerR * Math.cos(a1)},${cy + outerR * Math.sin(a1)}`);
      path.push(`${cx + outerR * Math.cos(a2)},${cy + outerR * Math.sin(a2)}`);
      path.push(`${cx + innerR * Math.cos(a2)},${cy + innerR * Math.sin(a2)}`);
      const a3 = ((i + 1) / teeth) * 2 * Math.PI;
      path.push(`${cx + innerR * Math.cos(a3)},${cy + innerR * Math.sin(a3)}`);
    }
    return `
      <polygon points="${path.join(' ')}" fill="${gf}" />
      <circle cx="${cx}" cy="${cy}" r="${s * g.discR}" fill="${accentForCenterDisc}" />
    `;
  };

  // Opt-in data cards (charts / tables). Operator/planner-supplied
  // structured specs in metadata.infographic_cards are resolved into a
  // slot→spec map and short-circuit the legacy layout dispatch ONLY when
  // the matching feature flag is on AND the spec is valid. Absent specs
  // or flags-off → the map is unused and every card renders exactly as
  // before (byte-identical default). A chart/table card occupies one
  // engine slot (cardWidth × cardHeight) — the engine is untouched.
  const structuredCards = resolveStructuredCards(metadata);
  const cardBrand: InfographicCardBrand = {
    palette,
    accent,
    fontFamily,
    text,
    bodyTextColor,
    panel,
    fontMultiplier: infographicFontMultiplier,
    // Canonical chart/card visual constants — data-card builders read these.
    chart: infographicStyle.chart_style,
    barCornerRadius: infographicStyle.chart_style.barCornerRadius,
    donutHoleRatio: infographicStyle.chart_style.donutHoleRatio,
    cardCornerRadius: infographicStyle.card_style.cornerRadius,
    cardStripeWidth: infographicStyle.card_style.accentStripeWidth,
    cardStripeRadius: infographicStyle.card_style.accentStripeRadius,
    cardFillOpacity: infographicStyle.card_style.fillOpacity,
  };

  // ── Title fitter — single-line truncation with ellipsis. The legacy
  //    layout titles (framework/process/comparison/timeline/hierarchy)
  //    rendered the raw title with no width bound, so long titles ran off
  //    the card edge / off-canvas. This clamps to the card's text width.
  const fitTitle = (title: string, widthPx: number, fontPx: number): string => {
    const s = String(title || '').replace(/\s+/g, ' ').trim();
    const max = Math.max(6, Math.floor(widthPx / (fontPx * 0.58)));
    return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
  };

  // ── Dense section body renderer (ROOT-CAUSE FIX).
  //    composeInfographicCopy produces lead + bullets + stat + impact +
  //    risk + example for EVERY section, but only the `stats` concept-card
  //    path rendered them — every other layout (incl. the DEFAULT
  //    `framework`) drew just the title + a single lead line, leaving
  //    size-to-fill cards 50–90% empty ("blank / partially rendered").
  //    This helper lays the dense copy into an arbitrary content rectangle
  //    so framework/process/comparison/timeline/hierarchy fill their cards
  //    with the content the composer already generated. Fully deterministic
  //    (no network/AI/random); every block is height-clamped so nothing
  //    overflows. When a field is absent the block has zero height — a
  //    sparse section degrades gracefully to lead-only (prior behavior).
  const renderDenseBody = (args: {
    x: number; y: number; width: number; height: number;
    lead: string;
    bullets: string[];
    stat: { value: string; label: string } | null;
    example: string | null;
    take: string | null;
    impact: string | null;
    risk: string | null;
    accentFill: string;
  }): { svg: string; usedH: number } => {
    const { x, y, width, height, accentFill } = args;
    if (width <= 40 || height <= 30) return { svg: '', usedH: 0 };
    const db = infographicStyle.geometry.denseBody;
    const dd = db.detail;
    const leadSize = Math.round(db.leadSize * infographicFontMultiplier);
    const bulletSize = Math.round(db.bulletSize * infographicFontMultiplier);
    const labelSize = Math.round(db.labelSize * infographicFontMultiplier);
    const valSize = Math.round(db.valueSize * infographicFontMultiplier);
    const cpl = (fontPx: number, w: number): number => Math.max(8, Math.floor(w / (fontPx * db.charWidthFactor)));
    // Word-wrap that appends an ellipsis ONLY when the source text was
    // truncated (a tail was dropped) — so long copy never ends abruptly
    // mid-word. Non-truncated text is returned unchanged.
    const clampLines = (textValue: string, fontPx: number, w: number, maxLines: number): string[] => {
      const lines = balanceTextLines(textValue, cpl(fontPx, w), maxLines);
      if (lines.length === 0) return lines;
      const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
      const original = String(textValue || '').replace(/\s+/g, ' ').trim();
      if (lines.length >= maxLines && joined.length < original.length) {
        const last = lines[lines.length - 1].replace(/[\s.,;:]+$/u, '');
        lines[lines.length - 1] = last.endsWith('…') ? last : `${last}…`;
      }
      return lines;
    };

    // Every block flows top-down from a LOCAL origin (0,0); the whole block
    // is then translated to (x, y) and vertically centered inside the card
    // (offsetY). This removes the mid-card gap the old bottom-anchored
    // footer produced AND makes sparse sections read as intentionally
    // centered instead of clustering at the top over dead space.
    const parts: string[] = [];
    let cursor = 0;
    const fits = (h: number): boolean => cursor + h <= height;

    // Stat callout chip.
    if (args.stat && String(args.stat.value || '').trim()) {
      const statVal = String(args.stat.value).trim().slice(0, 18);
      const statLabel = String(args.stat.label || '').trim();
      const chipH = Math.round(valSize * db.statChipHeightMul);
      if (fits(chipH)) {
        const valFont = Math.round(valSize * db.statValueFontMul);
        const labelX = dd.statValueX + statVal.length * Math.round(valFont * db.statValueCharWidthMul) + dd.statLabelInset;
        const labelMax = Math.max(0, Math.floor((width - labelX - dd.statLabelInset) / (labelSize * dd.labelCharFactor)));
        parts.push(`<rect x="0" y="${cursor}" width="${width}" height="${chipH}" rx="${dd.statChipRx}" fill="${accentFill}" opacity="${dd.statChipOpacity}" />`);
        parts.push(`<text x="${dd.statValueX}" y="${cursor + Math.round(chipH * dd.statValueYMul)}" font-size="${valFont}" font-family="${fontFamily}" font-weight="${dd.statValueWeight}" fill="${accentFill}">${escapeXml(statVal)}</text>`);
        if (statLabel && labelMax >= 4) {
          parts.push(`<text x="${labelX}" y="${cursor + Math.round(chipH * dd.statLabelYMul)}" font-size="${labelSize}" font-family="${fontFamily}" font-weight="${dd.statLabelWeight}" fill="${bodyTextColor}">${escapeXml(statLabel.slice(0, labelMax))}</text>`);
        }
        cursor += chipH + db.gapAfterStat;
      }
    }

    // Lead paragraph (≤3 lines).
    const lead = String(args.lead || '').trim();
    if (lead) {
      const lineH = Math.round(leadSize * db.leadLineHeightMul);
      const lines = clampLines(lead, leadSize, width, db.leadMaxLines);
      for (const ln of lines) {
        if (!fits(lineH)) break;
        parts.push(`<text x="0" y="${cursor + leadSize}" font-size="${leadSize}" font-family="${fontFamily}" font-weight="${dd.leadWeight}" fill="${bodyTextColor}">${escapeXml(ln)}</text>`);
        cursor += lineH;
      }
      cursor += db.gapAfterLead;
    }

    // Bullet list — the bulk of the information density.
    const bullets = (Array.isArray(args.bullets) ? args.bullets : [])
      .map((b) => String(b || '').trim())
      .filter((b) => b.length >= 4);
    const bulletLineH = Math.round(bulletSize * db.bulletLineHeightMul);
    // WIDE cards (the full-width single-column layouts: timeline / process / hierarchy)
    // would leave big right-side white-space with a single stack of short bullets. Flow
    // them into TWO columns so they fill the card width. Narrow grid cards (framework /
    // comparison ≈ 440px) stay single-column.
    const twoColBullets = width >= 640 && bullets.length >= 3;
    if (twoColBullets) {
      const colGap = 28;
      const colW = Math.floor((width - colGap) / 2);
      const colX = [0, colW + colGap];
      const half = Math.ceil(bullets.length / 2);
      const colCursor = [cursor, cursor];
      bullets.forEach((bullet, bi) => {
        const col = bi < half ? 0 : 1;
        const lines = clampLines(bullet, bulletSize, colW - (db.bulletTextIndent + 2), db.bulletMaxLines);
        if (lines.length === 0) return;
        if (colCursor[col] + lines.length * bulletLineH > height) return;
        const cy = colCursor[col];
        parts.push(`<circle cx="${colX[col] + db.bulletDotX}" cy="${cy + Math.round(bulletSize * db.bulletDotCyMul)}" r="${db.bulletDotRadius}" fill="${accentFill}" />`);
        lines.forEach((ln, i) => parts.push(`<text x="${colX[col] + db.bulletTextIndent}" y="${cy + bulletSize + i * bulletLineH}" font-size="${bulletSize}" font-family="${fontFamily}" font-weight="${dd.bulletWeight}" fill="${bodyTextColor}">${escapeXml(ln)}</text>`));
        colCursor[col] += lines.length * bulletLineH + dd.bulletInterGap;
      });
      cursor = Math.max(colCursor[0], colCursor[1]);
    } else {
      for (const bullet of bullets) {
        const lines = clampLines(bullet, bulletSize, width - (db.bulletTextIndent + 2), db.bulletMaxLines);
        if (lines.length === 0) continue;
        if (!fits(lines.length * bulletLineH)) break;
        parts.push(`<circle cx="${db.bulletDotX}" cy="${cursor + Math.round(bulletSize * db.bulletDotCyMul)}" r="${db.bulletDotRadius}" fill="${accentFill}" />`);
        lines.forEach((ln, i) => parts.push(`<text x="${db.bulletTextIndent}" y="${cursor + bulletSize + i * bulletLineH}" font-size="${bulletSize}" font-family="${fontFamily}" font-weight="${dd.bulletWeight}" fill="${bodyTextColor}">${escapeXml(ln)}</text>`));
        cursor += lines.length * bulletLineH + dd.bulletInterGap;
      }
    }

    // Impact / Risk mini-panels (flow directly after the bullets).
    const impact = String(args.impact || '').trim();
    const risk = String(args.risk || '').trim();
    if (impact || risk) {
      const gap = db.panelGap;
      const twoUp = Boolean(impact && risk && width > db.panelTwoUpMinWidth);
      const panelW = twoUp ? Math.floor((width - gap) / 2) : width;
      const innerW = panelW - db.panelInnerInset;
      const valLineH = Math.round(valSize * db.panelValueLineHeightMul);
      const iLines = impact ? clampLines(impact, valSize, innerW, db.panelMaxLines) : [];
      const rLines = risk ? clampLines(risk, valSize, innerW, db.panelMaxLines) : [];
      const maxLines = Math.max(iLines.length, rLines.length, 1);
      const panelH = db.panelHeightBase + maxLines * valLineH + db.panelHeightPad;
      if (fits(panelH + db.gapBeforePanels)) {
        cursor += db.gapBeforePanels;
        const top = cursor;
        const renderPanel = (px: number, lbl: string, lines: string[], color: string): string =>
          lines.length === 0 ? '' : (
            `<rect x="${px}" y="${top}" width="${panelW}" height="${panelH}" rx="${dd.panelRx}" fill="${color}" opacity="${dd.panelOpacity}" />` +
            `<rect x="${px}" y="${top}" width="${dd.panelStripeWidth}" height="${panelH}" rx="${dd.panelStripeRx}" fill="${color}" />` +
            `<text x="${px + dd.panelTextInset}" y="${top + db.panelLabelY}" font-size="${labelSize}" font-family="${fontFamily}" font-weight="${dd.panelLabelWeight}" fill="${color}" letter-spacing="${dd.panelLabelSpacing}">${lbl}</text>` +
            lines.map((ln, i) => `<text x="${px + dd.panelTextInset}" y="${top + db.panelValueStartY + i * valLineH}" font-size="${valSize}" font-family="${fontFamily}" font-weight="${dd.panelValueWeight}" fill="${text}">${escapeXml(ln)}</text>`).join('')
          );
        if (twoUp) {
          parts.push(renderPanel(0, '+ IMPACT', iLines, dd.impactColor));
          parts.push(renderPanel(panelW + gap, '! RISK', rLines, dd.riskColor));
        } else if (impact) {
          parts.push(renderPanel(0, '+ IMPACT', iLines, dd.impactColor));
        } else if (risk) {
          parts.push(renderPanel(0, '! RISK', rLines, dd.riskColor));
        }
        cursor += panelH;
      }
    }

    // Example / takeaway footer band.
    const example = String(args.example || '').trim();
    const take = String(args.take || '').trim();
    if (example || take) {
      const label = example ? 'EXAMPLE' : 'TAKEAWAY';
      const value = example || take;
      const valLineH = Math.round(valSize * db.footerValueLineHeightMul);
      const lines = clampLines(value, valSize, width - db.footerInnerInset, db.footerMaxLines);
      const bandH = db.footerHeightBase + lines.length * valLineH + db.footerHeightPad;
      if (fits(bandH + db.gapBeforeFooter)) {
        cursor += db.gapBeforeFooter;
        const top = cursor;
        parts.push(`<rect x="0" y="${top}" width="${width}" height="${bandH}" rx="${dd.footerRx}" fill="${accentFill}" opacity="${dd.footerOpacity}" />`);
        parts.push(`<text x="${dd.footerTextInset}" y="${top + db.footerLabelY}" font-size="${labelSize}" font-family="${fontFamily}" font-weight="${dd.footerLabelWeight}" fill="${accentFill}" letter-spacing="${dd.footerLabelSpacing}">${label}</text>`);
        lines.forEach((ln, i) => parts.push(`<text x="${dd.footerTextInset}" y="${top + db.footerValueStartY + i * valLineH}" font-size="${valSize}" font-family="${fontFamily}" font-weight="${example ? dd.footerExampleWeight : dd.footerTakeWeight}" fill="${example ? bodyTextColor : text}">${escapeXml(ln)}</text>`));
        cursor += bandH;
      }
    }

    if (parts.length === 0) return { svg: '', usedH: 0 };
    // Keep the block TOP-aligned under the layout's (fixed-position) title.
    // A tiny optical nudge only — never center, which would detach the body
    // from the title on tall, sparsely-filled cards. Underfill leaves
    // contiguous trailing space at the bottom, which reads as card padding.
    const usedH = cursor;
    const offsetY = Math.min(db.offsetYCap, Math.max(0, Math.round((height - usedH) / 2)));
    return { svg: `<g transform="translate(${x}, ${y + offsetY})">${parts.join('')}</g>`, usedH };
  };

  // Rich-field accessor — sections carry the composer's dense output
  // (attached at section-merge above); this reads them with safe defaults.
  const richFieldsOf = (s: Record<string, unknown>): {
    bullets: string[];
    stat: { value: string; label: string } | null;
    example: string | null;
    take: string | null;
    impact: string | null;
    risk: string | null;
  } => ({
    bullets: Array.isArray((s as { bullets?: unknown }).bullets) ? ((s as { bullets: unknown[] }).bullets).map(String) : [],
    stat: (s as { stat?: { value: string; label: string } | null }).stat ?? null,
    example: (s as { example?: string | null }).example ?? null,
    take: (s as { take?: string | null }).take ?? null,
    impact: (s as { impact?: string | null }).impact ?? null,
    risk: (s as { risk?: string | null }).risk ?? null,
  });

  // Binds a section's lead (`body`) + composer rich fields into a dense
  // body over the supplied content rectangle. Used by every non-stats
  // layout so they all fill their cards with the generated content.
  const denseBodyFor = (
    s: Record<string, unknown>,
    geom: { x: number; y: number; width: number; height: number },
    accentFill: string,
  ): string => renderDenseBody({
    ...geom,
    lead: String((s as { body?: unknown }).body || ''),
    ...richFieldsOf(s),
    accentFill,
  }).svg;

  // TWO-PASS measure: render a section's dense body at a generous height (so nothing is
  // dropped by fits()) and return the EXACT pixel height it occupies. Sizing cards from
  // this real height — instead of an estimate — removes the estimate/render divergence
  // that left ~10-15% voids on some cards.
  const measureDenseBodyFor = (s: Record<string, unknown>, width: number): number =>
    renderDenseBody({ x: 0, y: 0, width, height: 100000, lead: String((s as { body?: unknown }).body || ''), ...richFieldsOf(s), accentFill: '#000000' }).usedH;

  const L = infographicStyle.geometry.layouts;
  const GT = infographicStyle.geometry.text;

  // ── Per-card content-fit heights (true column masonry) — <10% white-space ─────
  // The engine returns ONE uniform card height (= the tallest card's content), so shorter
  // cards render half-empty. Instead we size EACH card to its own content + ~10% padding
  // and flow each COLUMN independently (cards sharing an x stack from a common top). This
  // handles single-column layouts (one column → per-card heights) and grids (each column
  // flows on its own, Pinterest-style) with the same logic, then shrinks the canvas to the
  // tallest column. `stats` is excluded — its cards are drawn by the numeric/donut path
  // (not the dense-body estimator) and already render dense, so it keeps the engine height.
  const perCardTop: number[] = [];
  const perCardHeight: number[] = [];
  {
    const useMasonry = layout !== 'stats';
    if (!useMasonry) {
      sections.forEach((_s, i) => { perCardTop[i] = engine.position(i).y; perCardHeight[i] = engine.cardHeight; });
    } else {
      // TWO-PASS: measure each section's ACTUAL rendered body height (nothing dropped at the
      // generous measure height), so the card is sized to exactly what renders — no estimate
      // divergence. Slightly conservative width (−96) so the measure never under-counts vs.
      // layouts that inset further (e.g. process's step badge).
      const bodyW = Math.max(80, cardWidth - 96);
      const est = sections.map((s) => measureDenseBodyFor(s as Record<string, unknown>, bodyW));
      const gap = engine.rowGap;
      const floorH = engine.minCardHeight;
      // Card = measured body + title band (+ a few px so the final element clears fits() at
      // equal heights). Cap generously — at least the tallest measured card — so the fullest
      // card is never clipped (which was leaving a void where the dropped element would go).
      const cardHeightFor = (i: number) => Math.max(floorH, Math.round(est[i] + bodyInset + 8));
      const startTop = headerH + 24;
      // Column index by row-major placement — derived from the engine's row count, NOT the
      // x position (hierarchy indents each card, so x varies within one logical column).
      const cols = Math.max(1, Math.ceil(sections.length / Math.max(1, engine.rows)));
      const colTops = new Map<number, number>(); // column index → running top
      sections.forEach((_s, i) => {
        const col = i % cols;
        const top = colTops.get(col) ?? startTop;
        const h = cardHeightFor(i);
        perCardTop[i] = top;
        perCardHeight[i] = h;
        colTops.set(col, top + h + gap);
      });
      const gridBottom = Math.max(startTop, ...Array.from(colTops.values()).map((v) => v - gap));
      // Grow the canvas to fit the measured content (cards are never clipped), up to a
      // platform-safe portrait ceiling; shrink it when the content is short.
      height = Math.max(900, Math.min(1900, gridBottom + infographicStyle.spacing.bottomMargin));
    }
  }

  // WS3 text-fit signal (sections). Each card is grown to fit its measured
  // content up to the portrait canvas ceiling (1900px); when the total exceeds
  // that ceiling the canvas is clamped and a card can extend past the bottom
  // edge — i.e. its content is clipped. Record every such section rather than
  // let the tail vanish silently. Header-title overflow is added further below.
  const infographicOverflowFields: string[] = [];
  sections.forEach((_section, index) => {
    const cardBottom = (perCardTop[index] ?? 0) + (perCardHeight[index] ?? 0);
    if (cardBottom > height + 4) infographicOverflowFields.push(`section_${index + 1}`);
  });

  const cards = sections.map((section, index) => {
    const { x } = engine.position(index);
    const y = perCardTop[index];
    const cardHeight = perCardHeight[index];
    const cycleAccent = [accent, accentSecondary, accentTertiary][index % 3];

    // ── Data-card short-circuit (Phases 2–3). Falls through to the
    //    legacy layout card when the flag is off, no spec exists, or the
    //    builder returns null (invalid/oversized data → graceful fallback).
    const structured = structuredCards.get(index);
    if (structured) {
      const geom = { x, y, width: cardWidth, height: cardHeight };
      if (structured.type === 'chart' && infographicChartsEnabled()) {
        const chartSvg = buildChartCardSvg(structured, geom, cardBrand);
        if (chartSvg) return chartSvg;
      }
      if (structured.type === 'table' && infographicTablesEnabled()) {
        const tableSvg = buildTableCardSvg(structured, geom, cardBrand);
        if (tableSvg) return tableSvg;
      }
    }

    if (layout === 'stats') {
      // Operator feedback: stop fabricating percentages. If the
      // section actually contains a number, visualize it. If not,
      // render a CONCEPT card with an icon + title + body instead of
      // a fake donut.
      const numericMatch = String(section.body || '').match(/(\d+(?:[\.,]\d+)?)\s*%/)
        ?? String(section.title || '').match(/(\d+(?:[\.,]\d+)?)\s*%/);
      const rawNumericMatch = String(section.body || '').match(/(\d+(?:[\.,]\d+)?)\s*(x|×|times|m|k|b|hrs?|days?|weeks?|mins?)/i);
      const hasRealNumber = Boolean(numericMatch || rawNumericMatch);
      const cardCx = x + cardWidth / 2;
      const subBody = String(section.body || '')
        .replace(/(\d+(?:[\.,]\d+)?)\s*%/, '')
        .replace(/(\d+(?:[\.,]\d+)?)\s*(x|×|times)/i, '')
        .trim();

      // No real number → DENSE concept card. Operator feedback:
      // "we need more information; the page should be busy". This
      // card now lays out FIVE distinct content blocks fed by the
      // composer's per-section output:
      //
      //   • Icon disc (top-left)            — visual anchor
      //   • Title (top, next to icon)       — section name
      //   • Lead paragraph (under title)    — 1–2 sentence framing
      //   • Bullet list (mid-card)          — 3–5 supporting points
      //   • Stat callout (right rail)       — when composer returned one
      //   • Example / Take footer band      — when present
      //
      // If the composer failed open, lead falls back to subBody and
      // the bullet / stat / example zones render as empty (zero
      // height) — card stays correct but less dense.
      if (!hasRealNumber) {
        type RichSection = typeof section & {
          bullets?: string[];
          stat?: { value: string; label: string } | null;
          example?: string | null;
          take?: string | null;
          impact?: string | null;
          risk?: string | null;
        };
        const rich = section as RichSection;
        const cleanTitle = String(section.title || '').trim();
        const lead = subBody || (rich.body ?? '');
        const bullets: string[] = Array.isArray(rich.bullets)
          ? rich.bullets.map((b) => String(b || '').trim()).filter((b) => b.length >= 4)
          : [];
        const stat: { value: string; label: string } | null = rich.stat ?? null;
        const example: string = String(rich.example || '').trim();
        const take: string = String(rich.take || '').trim();
        const impact: string = String(rich.impact || '').trim();
        const risk: string = String(rich.risk || '').trim();

        // CRITICAL FIX (operator feedback: "text is missing all
        // across"): librsvg (which sharp uses) does NOT render HTML
        // content inside <foreignObject> reliably — every previous
        // foreignObject text block came out empty in the PNG output.
        // We're now using native SVG <text> with manual word-wrapping
        // via balanceTextLines for EVERY text block on the card.

        const SC = infographicStyle.geometry.statsConcept;
        const cpl058 = (fontPx: number, w: number): number => Math.max(8, Math.floor(w / (fontPx * SC.charWidthFactor)));
        // Icon disc — smaller (8% min dim).
        const iconR = Math.min(Math.round(cardWidth * SC.iconDiscRatio), Math.round(cardHeight * SC.iconDiscRatio));
        const iconCx = x + SC.iconInset + iconR;
        const iconCy = y + SC.iconInset + iconR;

        // Stat rail on the right when present.
        const railW = stat ? Math.round(cardWidth * SC.railWidthRatio) : 0;
        const contentRight = stat ? x + cardWidth - railW - SC.contentRightPadWithRail : x + cardWidth - SC.contentRightPad;
        const contentLeftX = x + SC.contentLeftInset;
        const contentWidth = contentRight - contentLeftX;

        // Font sizing — all in pixel-space, no multipliers smaller
        // than 1.0 so text is always legible.
        const titleSize = Math.round(SC.titleSize * infographicFontMultiplier);
        const leadSize = Math.round(SC.leadSize * infographicFontMultiplier);
        const bulletSize = Math.round(SC.bulletSize * infographicFontMultiplier);
        const panelLabelSize = Math.round(SC.panels.labelSize * infographicFontMultiplier);
        const panelTextSize = Math.round(SC.panels.textSize * infographicFontMultiplier);
        const footerLabelSize = Math.round(SC.footer.labelSize * infographicFontMultiplier);
        const footerTextSize = Math.round(SC.footer.textSize * infographicFontMultiplier);

        const charsPerLine = cpl058;

        // Title — wraps up to 2 lines next to the icon.
        const titleX = iconCx + iconR + SC.titleIconGap;
        const titleZoneW = (stat ? cardWidth - (iconR * 2 + SC.titleZoneIconGap + SC.titleIconGap) - railW - SC.titleZoneTailInset : cardWidth - (iconR * 2 + SC.titleZoneIconGap + SC.titleIconGap) - SC.titleZoneTailInset);
        const titleLines = balanceTextLines(cleanTitle, charsPerLine(titleSize, titleZoneW), SC.titleMaxLines);
        const titleLineH = Math.round(titleSize * SC.titleLineHeightMul);
        const titleStartY = iconCy - iconR + titleSize;
        const titleBlockH = titleLines.length * titleLineH;
        const titleSvg = titleLines.map((line, i) => `<text x="${titleX}" y="${titleStartY + i * titleLineH}" font-size="${titleSize}" font-family="${fontFamily}" font-weight="${GT.titleWeight}" fill="${text}">${escapeXml(line)}</text>`).join('');

        // Footer-up layout: compute footer geometry first so we know
        // how much vertical space the lead + bullets have.
        const hasImpactRow = Boolean(impact || risk);
        const hasFooterBand = Boolean(example || take);
        const footerBandH = hasFooterBand ? SC.footerBandH : 0;
        const footerBandY = y + cardHeight - footerBandH - SC.footerBottomPad;
        const impactRowH = hasImpactRow ? SC.impactRowH : 0;
        const impactRowY = (hasFooterBand ? footerBandY : y + cardHeight - SC.footerBottomPad) - impactRowH - (hasImpactRow && hasFooterBand ? SC.impactFooterGap : 0);

        const headerBottom = Math.max(iconCy + iconR + SC.headerBottomPad, titleStartY + titleBlockH + SC.titleBlockPad);
        const leadY = headerBottom + SC.leadGap;
        const leadCharsPerLine = charsPerLine(leadSize, contentWidth);
        // Lead — up to 3 lines.
        const leadLines = balanceTextLines(lead, leadCharsPerLine, SC.leadMaxLines);
        const leadLineH = Math.round(leadSize * SC.leadLineHeightMul);
        const leadSvg = leadLines.map((line, i) => `<text x="${contentLeftX}" y="${leadY + i * leadLineH}" font-size="${leadSize}" font-family="${fontFamily}" font-weight="${GT.bodyWeight}" fill="${bodyTextColor}">${escapeXml(line)}</text>`).join('');
        const leadBlockH = leadLines.length * leadLineH;

        // Bullets — each up to 2 lines, indented under a dot.
        const bulletsStartY = leadY + leadBlockH + SC.bulletsStartGap;
        const bulletLineH = Math.round(bulletSize * SC.bulletLineHeightMul);
        const bulletCharsPerLine = charsPerLine(bulletSize, contentWidth - SC.bulletCharInset);
        const maxBullets = SC.maxBullets;
        let bulletYCursor = bulletsStartY;
        const bulletsSvgParts: string[] = [];
        for (const bullet of bullets.slice(0, maxBullets)) {
          const lines = balanceTextLines(bullet, bulletCharsPerLine, SC.bulletMaxLines);
          if (lines.length === 0) continue;
          // Stop if the next bullet would push into the footer zone.
          if (bulletYCursor + lines.length * bulletLineH > impactRowY - SC.bulletFooterPad) break;
          bulletsSvgParts.push(`<circle cx="${contentLeftX + SC.bulletDotInset}" cy="${bulletYCursor - Math.round(bulletSize * SC.bulletDotCyMul)}" r="${SC.bulletDotRadius}" fill="${cycleAccent}" />`);
          for (let li = 0; li < lines.length; li += 1) {
            bulletsSvgParts.push(`<text x="${contentLeftX + SC.bulletTextInset}" y="${bulletYCursor + li * bulletLineH}" font-size="${bulletSize}" font-family="${fontFamily}" font-weight="${GT.bodyWeight}" fill="${bodyTextColor}">${escapeXml(lines[li])}</text>`);
          }
          bulletYCursor += lines.length * bulletLineH + SC.bulletInterGap;
        }
        const bulletsSvg = bulletsSvgParts.join('');

        // Stat rail (right side, optional).
        let statRail = '';
        if (stat) {
          const SR = SC.statRail;
          const statBoxX = x + cardWidth - railW - SR.boxXPad;
          const statBoxY = y + SR.boxY;
          const statBoxH = cardHeight - impactRowH - footerBandH - SR.boxHInset;
          const statValueSize = Math.round(Math.min(railW * SR.valueSizeRatio, SR.valueSizeMax));
          const statLabelSize = Math.round(SR.labelSize * infographicFontMultiplier);
          const statLabelLines = balanceTextLines(stat.label, Math.max(10, Math.floor((railW - 16) / (statLabelSize * SR.labelCharFactor))), SR.labelMaxLines);
          const statLabelLineH = Math.round(statLabelSize * SR.labelLineHeightMul);
          const statLabelStartY = statBoxY + SR.labelStartY;
          statRail = `
            <rect x="${statBoxX}" y="${statBoxY}" width="${railW}" height="${statBoxH}" rx="${SR.rx}" fill="${cycleAccent}" opacity="${SR.opacity}" />
            <text x="${statBoxX + railW / 2}" y="${statBoxY + SR.valueY}" text-anchor="middle" font-size="${statValueSize}" font-family="${fontFamily}" font-weight="${GT.numeralWeight}" fill="${cycleAccent}">${escapeXml(stat.value)}</text>
            ${statLabelLines.map((line, i) => `<text x="${statBoxX + railW / 2}" y="${statLabelStartY + i * statLabelLineH}" text-anchor="middle" font-size="${statLabelSize}" font-family="${fontFamily}" font-weight="${GT.bodyWeight}" fill="${bodyTextColor}">${escapeXml(line)}</text>`).join('')}
          `;
        }

        // Impact + risk panels (auto-sized from line count).
        const PN = SC.panels;
        const impactPanelColor = PN.impactColor;
        const riskPanelColor = PN.riskColor;
        let impactRow = '';
        let renderedImpactRowH = impactRowH;
        if (hasImpactRow) {
          const panelGap = PN.gap;
          const panelW = impact && risk ? Math.floor((cardWidth - PN.outerInset - panelGap) / 2) : cardWidth - PN.outerInset;
          const panelInnerW = panelW - PN.innerInset;
          const panelValueLineH = Math.round(panelTextSize * PN.valueLineHeightMul);
          const wrapPanelValue = (v: string): string[] => {
            const cpl = Math.max(10, Math.floor(panelInnerW / (panelTextSize * PN.charFactor)));
            return balanceTextLines(v, cpl, PN.maxLines);
          };
          const impactLines = impact ? wrapPanelValue(impact) : [];
          const riskLines = risk ? wrapPanelValue(risk) : [];
          const maxLines = Math.max(impactLines.length, riskLines.length, 1);
          renderedImpactRowH = PN.heightBase + maxLines * panelValueLineH + PN.heightPad;
          const renderPanel = (px: number, label: string, lines: string[], color: string): string => {
            if (lines.length === 0) return '';
            const labelY = impactRowY + PN.labelYOffset;
            const valueStartY = impactRowY + PN.valueStartYOffset;
            return `
              <rect x="${px}" y="${impactRowY}" width="${panelW}" height="${renderedImpactRowH}" rx="${PN.rx}" fill="${color}" opacity="${PN.opacity}" />
              <rect x="${px}" y="${impactRowY}" width="${PN.stripeWidth}" height="${renderedImpactRowH}" rx="${PN.stripeRx}" fill="${color}" />
              <text x="${px + PN.textInset}" y="${labelY}" font-size="${panelLabelSize}" font-family="${fontFamily}" font-weight="${GT.labelWeight}" fill="${color}" letter-spacing="${PN.labelSpacing}">${escapeXml(label)}</text>
              ${lines.map((line, i) => `<text x="${px + PN.textInset}" y="${valueStartY + i * panelValueLineH}" font-size="${panelTextSize}" font-family="${fontFamily}" font-weight="${GT.panelValueWeight}" fill="${text}">${escapeXml(line)}</text>`).join('')}
            `;
          };
          const impactPanelX = x + PN.xInset;
          const riskPanelX = impact && risk ? impactPanelX + panelW + panelGap : impactPanelX;
          impactRow = [
            renderPanel(impactPanelX, '+ IMPACT', impactLines, impactPanelColor),
            renderPanel(riskPanelX, '! RISK', riskLines, riskPanelColor),
          ].join('');
        }

        // Footer band (example or take).
        const FB = SC.footer;
        let footerBlock = '';
        let renderedFooterBandH = footerBandH;
        if (hasFooterBand) {
          const label = example ? 'EXAMPLE' : 'TAKEAWAY';
          const value = example || take;
          const innerW = cardWidth - FB.innerInset;
          const valueCharsPerLine = Math.max(20, Math.floor(innerW / (footerTextSize * FB.charFactor)));
          const valueLines = balanceTextLines(value, valueCharsPerLine, FB.maxLines);
          const valueLineH = Math.round(footerTextSize * FB.lineHeightMul);
          renderedFooterBandH = FB.heightBase + valueLines.length * valueLineH + FB.heightPad;
          const valueStartY = footerBandY + FB.valueStartYOffset;
          const valueColor = example ? bodyTextColor : text;
          const valueWeight = example ? GT.bodyWeight : GT.takeWeight;
          footerBlock = `
            <rect x="${x + FB.xInset}" y="${footerBandY}" width="${cardWidth - PN.outerInset}" height="${renderedFooterBandH}" rx="${FB.rx}" fill="${cycleAccent}" opacity="${FB.opacity}" />
            <text x="${x + FB.textInset}" y="${footerBandY + FB.labelYOffset}" font-size="${footerLabelSize}" font-family="${fontFamily}" font-weight="${GT.labelWeight}" fill="${cycleAccent}" letter-spacing="${FB.labelSpacing}">${label}</text>
            ${valueLines.map((line, i) => `<text x="${x + FB.textInset}" y="${valueStartY + i * valueLineH}" font-size="${footerTextSize}" font-family="${fontFamily}" font-weight="${valueWeight}" fill="${valueColor}">${escapeXml(line)}</text>`).join('')}
          `;
        }

        return `
          ${renderCardBase(x, y, cycleAccent, cardHeight)}
          <circle cx="${iconCx}" cy="${iconCy}" r="${iconR}" fill="${cycleAccent}" />
          ${renderConceptGlyph(iconCx, iconCy, Math.round(iconR * SC.glyphSizeRatio), index, cycleAccent)}
          ${titleSvg}
          ${leadSvg}
          ${bulletsSvg}
          ${statRail}
          ${impactRow}
          ${footerBlock}
        `;
      }

      const percentValue = numericMatch ? Math.max(0, Math.min(100, parseFloat(numericMatch[1]))) : 50;
      const variant = index % 3;

      // Variant A: donut chart (percent visual)
      if (variant === 0) {
        const S = L.stats; const D = S.donut;
        const donutR = Math.min(Math.round(cardWidth * D.radiusRatio), Math.round(cardHeight * D.radiusRatio));
        const donutCx = cardCx;
        const donutCy = y + D.yOffset + donutR;
        const donutStroke = Math.max(D.strokeMin, Math.round(donutR * D.strokeRatio));
        const circumference = 2 * Math.PI * donutR;
        const filledArc = (percentValue / 100) * circumference;
        const displayStat = numericMatch ? `${numericMatch[1]}%` : `${Math.round(percentValue)}%`;
        return `
          ${renderCardBase(x, y, cycleAccent, cardHeight)}
          <circle cx="${donutCx}" cy="${donutCy}" r="${donutR}" fill="none" stroke="${cycleAccent}" stroke-opacity="${D.trackOpacity}" stroke-width="${donutStroke}" />
          <circle cx="${donutCx}" cy="${donutCy}" r="${donutR}" fill="none" stroke="${cycleAccent}" stroke-width="${donutStroke}" stroke-linecap="round" stroke-dasharray="${filledArc} ${circumference - filledArc}" transform="rotate(-90 ${donutCx} ${donutCy})" />
          <text x="${donutCx}" y="${donutCy + Math.round(donutR * D.statYRatio)}" text-anchor="middle" font-size="${Math.max(D.statFontMin, Math.round(donutR * D.statFontRatio))}" font-family="${fontFamily}" font-weight="${GT.numeralWeight}" fill="${text}">${escapeXml(displayStat)}</text>
          <text x="${cardCx}" y="${donutCy + donutR + D.titleGap}" text-anchor="middle" font-size="${Math.round(S.titleFont * infographicFontMultiplier)}" font-family="${fontFamily}" font-weight="${GT.titleWeight}" fill="${text}">${escapeXml(section.title)}</text>
          ${renderBrandBody({
            x: cardCx,
            y: donutCy + donutR + D.bodyGap,
            width: cardWidth - S.bodyWidthInset,
            height: y + cardHeight - S.bodyBottomPad - (donutCy + donutR + D.bodyGap),
            text: String(subBody),
            fontPx: Math.round(S.bodyFont * infographicFontMultiplier),
            color: bodyTextColor,
            weight: '500',
            lineHeightMul: S.bodyLineHeightMul,
            align: 'center',
          })}
        `;
      }

      // Variant B: big numeral with horizontal bar (multiplier visual,
      // e.g. "5x faster", "$2.4M", "73%"). The horizontal bar
      // visualizes the magnitude regardless of unit.
      if (variant === 1) {
        const numeralStr = rawNumericMatch
          ? `${rawNumericMatch[1]}${rawNumericMatch[2]}`.toUpperCase()
          : (numericMatch ? `${numericMatch[1]}%` : `${Math.round(percentValue)}%`);
        const S = L.stats; const B = S.bar;
        const barW = cardWidth - B.widthInset;
        const barH = B.height;
        const barX = x + B.xInset;
        const barY = y + Math.round(cardHeight * B.yRatio);
        const barFillRatio = numericMatch
          ? Math.min(1, percentValue / 100)
          : Math.min(1, B.fillBase + (index * B.fillIndexStep));
        return `
          ${renderCardBase(x, y, cycleAccent, cardHeight)}
          <text x="${cardCx}" y="${y + Math.round(cardHeight * B.numeralYRatio)}" text-anchor="middle" font-size="${Math.round(Math.min(cardHeight * B.numeralFontHRatio, cardWidth * B.numeralFontWRatio))}" font-family="${fontFamily}" font-weight="${GT.numeralWeight}" fill="${cycleAccent}">${escapeXml(numeralStr)}</text>
          <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="${cycleAccent}" opacity="${B.trackOpacity}" />
          <rect x="${barX}" y="${barY}" width="${Math.round(barW * barFillRatio)}" height="${barH}" rx="${barH / 2}" fill="${cycleAccent}" />
          <text x="${cardCx}" y="${barY + barH + B.titleGap}" text-anchor="middle" font-size="${Math.round(S.titleFont * infographicFontMultiplier)}" font-family="${fontFamily}" font-weight="${GT.titleWeight}" fill="${text}">${escapeXml(section.title)}</text>
          ${renderBrandBody({
            x: cardCx,
            y: barY + barH + B.bodyGap,
            width: cardWidth - S.bodyWidthInset,
            height: y + cardHeight - S.bodyBottomPad - (barY + barH + B.bodyGap),
            text: String(subBody),
            fontPx: Math.round(S.bodyFont * infographicFontMultiplier),
            color: bodyTextColor,
            weight: '500',
            lineHeightMul: S.bodyLineHeightMul,
            align: 'center',
          })}
        `;
      }

      // Variant C: pictogram — 10 dots filled proportionally (1 dot
      // per 10% of the value). Reads as "8 out of 10" visually.
      const S = L.stats; const DT = S.dot;
      const totalDots = DT.count;
      const filledDots = numericMatch
        ? Math.round(percentValue / 10)
        : Math.max(1, Math.min(totalDots, DT.filledBase + index));
      const dotR = Math.max(DT.radiusMin, Math.round(cardWidth * DT.radiusRatio));
      const dotGap = Math.round(dotR * DT.gapMul);
      const rowW = (totalDots - 1) * dotGap;
      const dotStartX = cardCx - rowW / 2;
      const dotY = y + Math.round(cardHeight * DT.yRatio);
      const dots = Array.from({ length: totalDots }, (_, i) => {
        const fillOpacity = i < filledDots ? '1' : String(DT.emptyOpacity);
        return `<circle cx="${dotStartX + i * dotGap}" cy="${dotY}" r="${dotR}" fill="${cycleAccent}" opacity="${fillOpacity}" />`;
      }).join('');
      const ratioLabel = `${filledDots}/10`;
      return `
        ${renderCardBase(x, y, cycleAccent, cardHeight)}
        <text x="${cardCx}" y="${y + Math.round(cardHeight * DT.ratioYRatio)}" text-anchor="middle" font-size="${Math.round(Math.min(cardHeight * DT.ratioFontHRatio, cardWidth * DT.ratioFontWRatio))}" font-family="${fontFamily}" font-weight="${GT.numeralWeight}" fill="${cycleAccent}">${escapeXml(ratioLabel)}</text>
        ${dots}
        <text x="${cardCx}" y="${dotY + dotR + DT.titleGap}" text-anchor="middle" font-size="${Math.round(S.titleFont * infographicFontMultiplier)}" font-family="${fontFamily}" font-weight="${GT.titleWeight}" fill="${text}">${escapeXml(section.title)}</text>
        ${renderBrandBody({
          x: cardCx,
          y: dotY + dotR + DT.bodyGap,
          width: cardWidth - S.bodyWidthInset,
          height: y + cardHeight - S.bodyBottomPad - (dotY + dotR + DT.bodyGap),
          text: String(subBody),
          fontPx: Math.round(S.bodyFont * infographicFontMultiplier),
          color: bodyTextColor,
          weight: '500',
          lineHeightMul: S.bodyLineHeightMul,
          align: 'center',
        })}
      `;
    }

    if (layout === 'process') {
      // Real flow-card composition. Card is a CHEVRON-shaped panel
      // (right-pointing arrow), not a rectangle, so the sequence reads
      // as a flow. The number badge sits in a tinted gradient panel
      // on the left, title + body fill the body of the chevron, and
      // a center-aligned arrow at the bottom links to the next step.
      const P = L.process;
      const stepNum = String(index + 1).padStart(2, '0');
      const badgeR = Math.round(Math.min(cardHeight, cardWidth) * P.badgeRadiusRatio);
      const badgePanelW = badgeR * P.badgePanelWMul;
      const badgeCx = x + badgePanelW / 2;
      const badgeCy = y + cardHeight / 2;
      const isLast = index === sections.length - 1;
      const connectorH = P.connectorHeight;
      const arrowY1 = y + cardHeight + P.connectorArrowGap;
      const arrowY2 = y + cardHeight + connectorH;
      const arrowMidX = x + cardWidth / 2;
      const titleFont = Math.round(cardTitleFontSize * P.titleFontMul);
      const connector = isLast ? '' : `
        <line x1="${arrowMidX}" y1="${arrowY1}" x2="${arrowMidX}" y2="${arrowY2 - P.connectorArrowGap}" stroke="${cycleAccent}" stroke-width="${P.connectorStrokeWidth}" stroke-linecap="round" stroke-opacity="${P.connectorOpacity}" />
        <polygon points="${arrowMidX - P.connectorArrowHalfW},${arrowY2 - P.connectorArrowGap} ${arrowMidX + P.connectorArrowHalfW},${arrowY2 - P.connectorArrowGap} ${arrowMidX},${arrowY2 + P.connectorTipExt}" fill="${cycleAccent}" />
      `;
      return `
        ${renderCardBase(x, y, cycleAccent, cardHeight)}
        <!-- Tinted badge panel on the left -->
        <rect x="${x + 6}" y="${y}" width="${badgePanelW}" height="${cardHeight}" rx="${P.bandRx}" fill="${cycleAccent}" opacity="${P.bandOpacity}" />
        <!-- Step badge -->
        <circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="${cycleAccent}" />
        <text x="${badgeCx}" y="${badgeCy + Math.round(badgeR * P.badgeNumYRatio)}" text-anchor="middle" font-size="${Math.round(badgeR * P.badgeNumFontRatio)}" font-family="${fontFamily}" font-weight="${GT.numeralWeight}" fill="${GT.whiteFg}">${stepNum}</text>
        <!-- Step label above the title -->
        <text x="${x + badgePanelW + P.labelX}" y="${y + P.labelY}" font-size="${Math.round(P.labelFont * infographicFontMultiplier)}" font-family="${fontFamily}" font-weight="${GT.labelWeight}" fill="${cycleAccent}" letter-spacing="${P.labelSpacing}">STEP ${stepNum}</text>
        <text x="${x + badgePanelW + P.titleX}" y="${y + P.titleY}" font-size="${titleFont}" font-family="${fontFamily}" font-weight="${GT.titleWeight}" fill="${text}">${escapeXml(fitTitle(section.title, cardWidth - badgePanelW - P.bodyWidthInset, titleFont))}</text>
        ${denseBodyFor(section, { x: x + badgePanelW + P.bodyX, y: y + P.bodyY, width: cardWidth - badgePanelW - P.bodyWidthInset, height: cardHeight - P.bodyHeightInset }, cycleAccent)}
        ${connector}
      `;
    }

    if (layout === 'comparison') {
      // 2-column grid; alternate cards get the secondary accent so
      // the "A vs B" contrast reads visually. Header band at top of
      // each card carries the title in caps; body fills below.
      const C = L.comparison;
      const isAlt = index % 2 === 1;
      const cardAccent = isAlt ? accentSecondary : accent;
      const cmpLabelFont = Math.round(C.labelFont * infographicFontMultiplier);
      return `
        ${renderCardBase(x, y, cardAccent, cardHeight)}
        <rect x="${x + 6}" y="${y}" width="${cardWidth - 6}" height="${C.bandHeight}" rx="${C.bandRx}" fill="${cardAccent}" opacity="${C.bandOpacity}" />
        <text x="${x + C.labelX}" y="${y + C.labelY}" font-size="${cmpLabelFont}" font-family="${fontFamily}" font-weight="${GT.labelWeight}" fill="${cardAccent}" letter-spacing="${C.labelSpacing}">${escapeXml(fitTitle(String(section.title).toUpperCase(), cardWidth - C.bodyWidthInset, cmpLabelFont))}</text>
        ${denseBodyFor(section, { x: x + C.bodyX, y: y + C.bodyY, width: cardWidth - C.bodyWidthInset, height: cardHeight - C.bodyHeightInset }, cardAccent)}
      `;
    }

    if (layout === 'timeline') {
      // Milestone dot on a left vertical rail + date-style indicator +
      // body. The rail itself is drawn once outside this map.
      const T = L.timeline;
      const dotCx = x - T.dotXOffset;
      const dotCy = y + T.dotYOffset;
      return `
        ${renderCardBase(x, y, cycleAccent, cardHeight)}
        <circle cx="${dotCx}" cy="${dotCy}" r="${T.dotRadius}" fill="${cycleAccent}" stroke="${GT.whiteFg}" stroke-width="${T.dotStrokeWidth}" />
        <text x="${x + T.labelX}" y="${y + T.labelY}" font-size="${Math.round(T.labelFont * infographicFontMultiplier)}" font-family="${fontFamily}" font-weight="${GT.labelWeight}" fill="${cycleAccent}" letter-spacing="${T.labelSpacing}">PHASE ${index + 1}</text>
        <text x="${x + T.titleX}" y="${y + T.titleY}" font-size="${cardTitleFontSize}" font-family="${fontFamily}" font-weight="${GT.titleWeight}" fill="${text}">${escapeXml(fitTitle(section.title, cardWidth - T.bodyWidthInset, cardTitleFontSize))}</text>
        ${denseBodyFor(section, { x: x + T.bodyX, y: y + T.bodyY, width: cardWidth - T.bodyWidthInset, height: cardHeight - T.bodyHeightInset }, cycleAccent)}
      `;
    }

    if (layout === 'hierarchy') {
      // Indented numbered card — visual flow steps down and slightly
      // right with each row.
      const H = L.hierarchy;
      const numBadge = String(index + 1).padStart(2, '0');
      return `
        ${renderCardBase(x, y, cycleAccent, cardHeight)}
        <text x="${x + H.numX}" y="${y + H.numY}" font-size="${Math.round(H.numFont * infographicFontMultiplier)}" font-family="${fontFamily}" font-weight="${GT.numeralWeight}" fill="${cycleAccent}">${numBadge}</text>
        <text x="${x + H.titleX}" y="${y + H.titleY}" font-size="${cardTitleFontSize}" font-family="${fontFamily}" font-weight="${GT.titleWeight}" fill="${text}">${escapeXml(fitTitle(section.title, cardWidth - H.bodyWidthInset, cardTitleFontSize))}</text>
        ${denseBodyFor(section, { x: x + H.bodyX, y: y + H.bodyY, width: cardWidth - H.bodyWidthInset, height: cardHeight - H.bodyHeightInset }, cycleAccent)}
      `;
    }

    // framework (default) — pillar card with a tinted accent header
    // band carrying the pillar label, body underneath in the panel.
    const F = L.framework;
    return `
      ${renderCardBase(x, y, cycleAccent, cardHeight)}
      <rect x="${x + 6}" y="${y}" width="${cardWidth - 6}" height="${F.bandHeight}" rx="${F.bandRx}" fill="${cycleAccent}" opacity="${F.bandOpacity}" />
      <text x="${x + F.labelX}" y="${y + F.labelY}" font-size="${Math.round(F.labelFont * infographicFontMultiplier)}" font-family="${fontFamily}" font-weight="${GT.labelWeight}" fill="${cycleAccent}" letter-spacing="${F.labelSpacing}">PILLAR ${index + 1}</text>
      <text x="${x + F.titleX}" y="${y + F.titleY}" font-size="${cardTitleFontSize}" font-family="${fontFamily}" font-weight="${GT.titleWeight}" fill="${text}">${escapeXml(fitTitle(section.title, cardWidth - F.bodyWidthInset, cardTitleFontSize))}</text>
      ${denseBodyFor(section, { x: x + F.bodyX, y: y + F.bodyY, width: cardWidth - F.bodyWidthInset, height: cardHeight - F.bodyHeightInset }, cycleAccent)}
    `;
  }).join('');

  // Timeline layout needs a vertical rail drawn ONCE behind the cards.
  const railLastIdx = Math.max(0, sections.length - 1);
  const timelineRail = layout === 'timeline'
    ? `<line x1="${engine.position(0).x - L.timeline.railXOffset}" y1="${(perCardTop[0] ?? engine.position(0).y) - L.timeline.railTopPad}" x2="${engine.position(0).x - L.timeline.railXOffset}" y2="${(perCardTop[railLastIdx] ?? engine.position(railLastIdx).y) + (perCardHeight[railLastIdx] ?? engine.cardHeight) + L.timeline.railBottomPad}" stroke="${accent}" stroke-width="${L.timeline.railStrokeWidth}" stroke-linecap="round" opacity="${L.timeline.railOpacity}" />`
    : '';
  // Tinted bottom-half accent fill — adds visual depth and ensures the
  // canvas doesn't read as a sea of empty white space when sections
  // don't fully fill the safe area. Subtle (~6% opacity) so it doesn't
  // compete with the cards.
  const ambientFill = `<rect x="${L.ambient.inset}" y="${height / 2}" width="${width - L.ambient.inset * 2}" height="${height / 2 - L.ambient.inset}" rx="${L.ambient.cornerRadius}" fill="${accent}" opacity="${L.ambient.opacity}" />`;
  const sectionLabel = layout.toUpperCase().replace(/_/g, ' ');
  // Operator feedback: drop the "4 STATS" / "5 PROCESS" internal
  // layout identifier from the header — real infographics never show
  // their template type as visible chrome. Section count is implicit
  // in the visual; no need to label it.
  //
  // The header subtitle now prefers the LLM-generated `narrative` line
  // (composes the whole-infographic message in ≤200 chars), falling
  // back to operator-supplied `metadata.summary` when the LLM call
  // failed open. Both end up as the same UX role: a tagline that
  // sits between the title and the cards.
  // headerH and headerSubtitle are computed above (before the engine) so
  // the card safe-area math and the SVG header band share one value.
  //
  // --- Header text geometry (title + optional subtitle), computed once
  // so the title block and the subtitle block agree on vertical layout. ---
  const HD = infographicStyle.geometry.header;
  // Strip a redundant leading asset-type prefix ("Infographic: …", "Carousel: …")
  // baked into the topic — it wastes header width and pushes the real title into
  // a mid-word truncation. The header already reads as an infographic.
  const headerTitleText = compactText(
    String(metadata.topic ?? '').replace(/^\s*(infographics?|carousels?|images?|banners?|posters?)\s*[:\-–]\s*/i, ''),
    'Infographic',
  );
  const headerLeftX = HD.leftX;
  const headerZoneW = brandPlacement.left - headerLeftX - HD.zoneRightPad;
  const headerTitleCharsPerLine = Math.max(10, Math.floor(headerZoneW / (titleFontSize * HD.titleCharFactor)));
  const headerTitleLines = balanceTextLines(headerTitleText, headerTitleCharsPerLine, HD.titleMaxLines);
  // WS3: the header title is width-constrained + capped at HD.titleMaxLines; if
  // the full title cannot fit even at the min font it is recorded as overflow.
  const headerTitleFit = fitTextToBox({ text: headerTitleText, baseFontSize: titleFontSize, baseCharsPerLine: headerTitleCharsPerLine, maxLines: HD.titleMaxLines });
  if (!headerTitleFit.fits) infographicOverflowFields.push('header_title');
  const headerTitleLineH = Math.round(titleFontSize * HD.titleLineHeightMul);
  const headerTitleBlockH = headerTitleLines.length * headerTitleLineH;
  // With a subtitle, anchor the title near the top so the subtitle has
  // room beneath it inside the band; without one, keep the legacy
  // vertically-centered placement (byte-identical for no-subtitle cards).
  const headerTitleStartY = headerSubtitle
    ? HD.titleTopY + titleFontSize
    : Math.round((headerH - headerTitleBlockH) / 2) + titleFontSize;
  const headerTitleSvg = headerTitleLines
    .map((line, i) => `<text x="${headerLeftX}" y="${headerTitleStartY + i * headerTitleLineH}" font-size="${titleFontSize}" font-family="${fontFamily}" font-weight="${HD.titleWeight}" fill="${HD.titleFill}" letter-spacing="${HD.titleLetterSpacing}">${escapeXml(line)}</text>`)
    .join('');
  // Subtitle — native SVG <text> (librsvg won't render foreignObject HTML
  // reliably), wrapped to ≤2 lines and CLAMPED so the last line's baseline
  // stays clear of the card-panel top (headerH - 12). This clamp is the
  // guard the old fixed-Y placement lacked, which let the 2nd line render
  // under the panel.
  let headerSubtitleSvg = '';
  if (headerSubtitle) {
    const subSize = Math.round(HD.subtitleSize * infographicFontMultiplier);
    const subCharsPerLine = Math.max(20, Math.floor(headerZoneW / (subSize * HD.subtitleCharFactor)));
    const subLines = balanceTextLines(headerSubtitle, subCharsPerLine, HD.subtitleMaxLines);
    const subLineH = Math.round(subSize * HD.subtitleLineHeightMul);
    const lastTitleBaseline = headerTitleStartY + (headerTitleLines.length - 1) * headerTitleLineH;
    let subStartY = lastTitleBaseline + subSize + HD.subtitleGap;
    const lastSubBaseline = subStartY + (subLines.length - 1) * subLineH;
    const maxLastBaseline = (headerH - HD.panelClampTop) - HD.panelClampPad;
    if (lastSubBaseline > maxLastBaseline) subStartY -= (lastSubBaseline - maxLastBaseline);
    headerSubtitleSvg = subLines
      .map((line, i) => `<text x="${headerLeftX}" y="${subStartY + i * subLineH}" font-size="${subSize}" font-family="${fontFamily}" font-weight="${HD.subtitleWeight}" fill="${HD.subtitleFill}">${escapeXml(line)}</text>`)
      .join('');
  }
  // True gradient header band — replaces the flat dark background +
  // flat white inner panel. The full canvas now reads as one designed
  // composition with vertical color flow (accent → background) like
  // every modern infographic template uses.
  // Gradient defs are generated from the canonical color_scheme.gradients
  // spec (single source of truth — offsets/opacities/colors live in the
  // style). PNG output is byte-identical: the gradients are semantically
  // identical, and the rasterizer ignores SVG whitespace.
  const gradColor = (c: 'backgroundBase' | 'accent'): string => (c === 'backgroundBase' ? bg : accent);
  const gradDir = (d: 'vertical' | 'horizontal' | 'diagonal'): string =>
    d === 'vertical' ? 'x1="0%" y1="0%" x2="0%" y2="100%"'
    : d === 'horizontal' ? 'x1="0%" y1="0%" x2="100%" y2="0%"'
    : 'x1="0%" y1="0%" x2="100%" y2="100%"';
  const buildGradientDef = (id: string, spec: InfographicStyleSchema['color_scheme']['gradients']['background']): string =>
    `<linearGradient id="${id}" ${gradDir(spec.direction)}>`
    + spec.stops.map((s) => `<stop offset="${s.offset}%" stop-color="${gradColor(s.color)}"${s.opacity === 1 ? '' : ` stop-opacity="${s.opacity}"`} />`).join('')
    + `</linearGradient>`;
  const grads = infographicStyle.color_scheme.gradients;
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${buildGradientDef('infographicWaveGradient', grads.wave)}
        ${buildGradientDef('infographicBgGradient', grads.background)}
        ${buildGradientDef('infographicHeaderGradient', grads.header)}
      </defs>
      <!-- Full-bleed background. Gradient mode → opaque brand gradient
           (byte-identical default). Image mode → a mandatory translucent
           scrim painted over the image that the renderer composites
           underneath; cards float on top so text stays readable. -->
      ${backgroundLayerSvg}
      <!-- Header band — gradient strip with the title in white at
           large-poster scale. Subtitle (intro line) under the title
           when metadata.summary is set. The title is LEFT-aligned
           and width-constrained to leave room for the brand logo on
           the right; long titles wrap to 2 lines instead of running
           through the logo. -->
      <rect x="0" y="0" width="${width}" height="${headerH}" fill="url(#infographicHeaderGradient)" />
      ${headerTitleSvg}
      ${headerSubtitleSvg}
      <!-- Inner safe panel — soft white with rounded corners, floats
           inside the gradient frame. Cards live on top of this. -->
      <rect x="${infographicStyle.decoration_style.innerPanel.inset}" y="${headerH - infographicStyle.decoration_style.innerPanel.topOffset}" width="${width - infographicStyle.decoration_style.innerPanel.inset * 2}" height="${height - headerH - infographicStyle.decoration_style.innerPanel.topOffset}" rx="${infographicStyle.decoration_style.innerPanel.cornerRadius}" fill="${infographicStyle.color_scheme.innerPanel}" opacity="${infographicStyle.decoration_style.innerPanel.opacity}" />
      <path d="${wavePath}" fill="none" stroke="url(#infographicWaveGradient)" stroke-width="${waveStrokeWidth}" stroke-linecap="round" />
      ${timelineRail}
      ${cards}
      ${resolvedCta ? `
        <!-- CTA footer band — anchors the whole infographic to a
             single next-step. Pill on a tinted accent strip at the
             very bottom of the canvas. -->
        <rect x="${infographicStyle.decoration_style.ctaFooter.inset}" y="${height - infographicStyle.decoration_style.ctaFooter.bandBottomOffset}" width="${width - infographicStyle.decoration_style.ctaFooter.inset * 2}" height="${infographicStyle.decoration_style.ctaFooter.bandHeight}" rx="${infographicStyle.decoration_style.ctaFooter.cornerRadius}" fill="${accent}" opacity="${infographicStyle.decoration_style.ctaFooter.opacity}" />
        <text x="${width / 2}" y="${height - infographicStyle.decoration_style.ctaFooter.textBottomOffset}" text-anchor="middle" font-size="${Math.round(infographicStyle.decoration_style.ctaFooter.fontSize * infographicFontMultiplier)}" font-family="${fontFamily}" font-weight="${GT.titleWeight}" fill="${text}">${escapeXml(resolvedCta)}</text>
      ` : ''}
    </svg>
  `;
  const composites: Array<{ input: Buffer; top: number; left: number }> = [];
  // Background-image mode: the image is the BASE layer and the rasterized
  // SVG (scrim + header + cards) composites on top of it, then the brand
  // mark on top of that. Gradient mode keeps the SVG as the base — exactly
  // as before — so default output is byte-identical.
  if (backgroundImageBuffer) {
    composites.push({ input: await sharp(Buffer.from(svg)).png().toBuffer(), top: 0, left: 0 });
  }
  // Brand mark composited on top so its alpha channel stays intact
  // (matches the carousel-renderer pattern at line 2887).
  if (brandMark) {
    composites.push({ input: brandMark, top: brandPlacement.top, left: brandPlacement.left });
  }
  const baseLayer = backgroundImageBuffer ?? Buffer.from(svg);
  const fileBuffer = composites.length > 0
    ? await sharp(baseLayer).composite(composites).png().toBuffer()
    : await sharp(baseLayer).png().toBuffer();
  const finalOcr = await runCreatorOcr({
    image: fileBuffer,
    assetType: 'infographic',
    platform,
    attachmentMode: 'embedded_copy',
    mimeType: 'image/png',
  });
  const providerTextValidation = {
    ok: finalOcr.ok,
    flags: finalOcr.flags,
    mode: 'embedded_copy' as const,
    confidence: finalOcr.confidence,
    provider: finalOcr.provider,
  };
  const infographicAltText = buildAccessibleAltText(metadata.topic, { kind: 'infographic', platform });
  const accessibilityValidation = validateCreatorAccessibility({
    altText: infographicAltText,
    readingOrder: sections.map((_, index) => `section_${index + 1}`),
    minFontSize: 16,
    contrastRatio: geometry.contrastRatio,
  });
  const manifest = createRenderManifest({
    rendererId: getCreatorRendererRegistration('infographic').rendererId,
    platformProfile: resolvePlatformVisualProfile(platform) as unknown as Record<string, unknown>,
    governanceProfile: resolveAssetGovernanceProfile('infographic') as unknown as Record<string, unknown>,
    qualityScore: quality,
    validationResult: visualGovernance,
    ocrResult: providerTextValidation,
    typographySafetyResult: geometry,
    transformIntent: typeof metadata.source_text_transform === 'string' ? metadata.source_text_transform : null,
    exportMetadata: { width, height, infographic_layout: layout },
    altText: infographicAltText,
    readingOrder: sections.map((_, index) => `section_${index + 1}`),
    accessibilityValidation,
  });
  if (metadata.writer_asset_type || metadata.attachment_mode) assertRenderManifestExportable(manifest);
  const infographicValidationManifest = { governance: visualGovernance, ocr: providerTextValidation, geometry, accessibility: accessibilityValidation, final_ocr: finalOcr };
  void persistCreatorValidationManifest({
    rendererId: getCreatorRendererRegistration('infographic').rendererId,
    assetType: 'infographic',
    platform,
    attachmentMode: typeof metadata.attachment_mode === 'string' ? metadata.attachment_mode : 'embedded_copy',
    renderManifest: manifest as unknown as Record<string, unknown>,
    validationManifest: infographicValidationManifest as unknown as Record<string, unknown>,
    auditId: typeof metadata.render_audit_id === 'string' ? metadata.render_audit_id : null,
  });
  const rendererMetadata = {
    width,
    height,
    preview_kind: 'infographic_composition',
    renderer_pipeline: 'dedicated_infographic_svg_v1',
    infographic_engine: engine.engineId,
    infographic_layout: layout,
    // WS3 CONSUMED CONTRACT — media_bundle.metadata.text_fit. ok=false ⇒ a
    // section card was clipped by the canvas ceiling or the header title could
    // not be shown completely. The scheduler reads `.ok` to block publishing.
    text_fit: { ok: infographicOverflowFields.length === 0, overflowFields: infographicOverflowFields },
    // CREATOR-113: the sample's declared semantic block structure (roles per block),
    // so every block's purpose is sample-driven and auditable (null = generic path).
    infographic_semantic_structure: curatedDesignTemplate(metadata)?.semanticStructure ?? ((bp) => (bp ? semanticStructureForBlueprint(bp) : null))(blueprintIdForRender(metadata)),
    infographic_sections: sections,
    infographic_density: density,
    // Surface ONLY the near-empty watchdog flag to the visual validator (which reads
    // overlay_quality). The other density flags remain in infographic_density as
    // before, so no previously-dormant check is newly activated.
    overlay_quality: {
      flags: density.contentTooThin ? ['infographic_content_too_thin'] : [],
      score: density.contentTooThin ? 40 : 90,
    },
    icon_zone_allocation: sections.map((section, index) => ({ icon: section.icon, section: index + 1, safeZone: engine.position(index).iconZone })),
    visual_hierarchy_score: quality.visualHierarchy,
    platform_visual_profile: resolvePlatformVisualProfile(platform),
    creator_quality_score: quality,
    visual_governance: visualGovernance,
    visual_governance_warnings: previewGovernanceWarnings,
    validation_manifest: infographicValidationManifest,
    render_manifest: manifest,
    renderer_id: getCreatorRendererRegistration('infographic').rendererId,
    auto_corrections: corrected.corrections,
    overlay_renderer: 'none',
    provider_text_validation: providerTextValidation,
    /*
     * An attached reference this family cannot apply is DISCLOSED, not dropped.
     *
     * This renderer composites SVG over a base layer and never calls an image
     * model, so a CONDITION reference — whose meaning is "give this to the
     * model" — has no stage to reach. Until now that produced silence: the
     * image was accepted, persisted and routed, and the finished infographic
     * looked exactly like one with nothing attached.
     *
     * The SAME three fields the image lane already emits, so the client renders
     * this through the disclosure it already has. Undefined when nothing was
     * attached, which is what keeps an ordinary infographic clean.
     */
    ...(() => {
      const degradation = unsupportedFamilyConditionDegradation(options.compositionReferences);
      return degradation ? {
        condition_reference_status: degradation.status,
        condition_reference_fallback_category: degradation.category,
        condition_reference_user_message: degradation.userMessage,
      } : {};
    })(),
    ...buildCreatorBrandKitMetadata(brandKit, {
      platform,
      overlayConfiguration: { mode: 'infographic_deterministic_sections' },
      exportCapabilities: ['preview', 'download', 'save_as_asset'],
    }),
  };
  // CREATOR-110: preview population takes the raw buffer from THIS renderer (no upload),
  // so the gallery preview is literally a production-renderer output.
  if (options.previewBufferOnly) {
    return { buffer: fileBuffer, metadata: { ...rendererMetadata, generated_by: 'infographicRenderer' } };
  }
  const url = await uploadRenderedPng({
    fileBuffer,
    campaignId: options.campaignId,
    userId: options.userId,
    companyId: options.companyId,
    fileNamePrefix: 'infographic',
    metadata: rendererMetadata,
  });
  return { url, metadata: { ...rendererMetadata, generated_by: 'infographicRenderer' } };
}

