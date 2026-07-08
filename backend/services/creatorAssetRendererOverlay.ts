/** Part 3/10 of creatorAssetRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
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
import { sharp, type OverlayQualityReport, getCachedRenderBuffer, escapeXml, balanceTextLines, renderBackgroundPng, compactText, getOverlayPreset, evaluateOverlayQuality } from './creatorAssetRendererContracts';
import { STYLE_CARD_SPECS } from './creatorAssetRendererText';
import { bufferFromRemoteImage } from './creatorAssetRendererSvg';
import { type ImageSubtypeHint } from './creatorAssetRendererMedia';
import { defaultBrandPlacement } from './creatorAssetRendererImage';

export function buildStyleCardSvg(styleId: string, input: {
  width: number;
  height: number;
  overlay: Record<string, string>;
  brandKit: CreatorBrandKit;
  fileNamePrefix: string;
}): { svg: string; quality: OverlayQualityReport; brandPlacement: { top: number; left: number; maxWidth: number; maxHeight: number } } {
  const { width, height, overlay, brandKit } = input;
  const spec = STYLE_CARD_SPECS[styleId] ?? STYLE_CARD_SPECS.minimal;
  const sans = brandKit.typography?.fontFamily || 'Inter, Arial, sans-serif';
  const font = spec.serif ? "Georgia, 'Times New Roman', serif" : sans;
  const accent = Array.isArray(brandKit.palette) && brandKit.palette.length ? brandKit.palette[0] : '#0ea5e9';

  const marginX = Math.round(width * (spec.align === 'center' ? 0.12 : 0.11));
  const barGap = spec.deco === 'left-bar' ? Math.round(width * 0.045) : 0;
  const textLeft = marginX + barGap;
  const anchor = spec.align === 'center' ? 'middle' : 'start';
  const anchorX = spec.align === 'center' ? Math.round(width / 2) : textLeft;
  const contentW = spec.align === 'center' ? Math.round(width * 0.76) : width - textLeft - marginX;

  let headline = compactText(overlay.headline || '').trim();
  if (spec.upper) headline = headline.toUpperCase();
  const sub = compactText(overlay.supportingText || '').trim();
  const cta = compactText(overlay.cta || '').trim();

  const hSize = Math.round(width * spec.scale);
  const hLines = balanceTextLines(headline, Math.max(8, Math.floor(contentW / (hSize * (spec.serif ? 0.5 : 0.56)))), 4);
  const hLineH = Math.round(hSize * 1.14);
  const subSize = Math.round(width * 0.03);
  const subLines = sub ? balanceTextLines(sub, Math.max(16, Math.floor(contentW / (subSize * 0.55))), 2) : [];
  const subLineH = Math.round(subSize * 1.35);

  const decoAboveH = spec.deco === 'rule-above' ? Math.round(height * 0.05) : 0;
  const blockH = decoAboveH + hLines.length * hLineH + (subLines.length ? Math.round(height * 0.035) + subLines.length * subLineH : 0);
  const top = Math.round((height - blockH) / 2);
  let y = top + decoAboveH + Math.round(hSize * 0.82);
  const firstLineY = y;

  const deco: string[] = [];
  const ruleW = Math.round(width * 0.11);
  const ruleX = spec.align === 'center' ? Math.round(width / 2 - ruleW / 2) : textLeft;
  if (spec.deco === 'rule-above') deco.push(`<rect x="${ruleX}" y="${top + Math.round(decoAboveH * 0.3)}" width="${ruleW}" height="4" rx="2" fill="${accent}"/>`);
  if (spec.deco === 'left-bar') deco.push(`<rect x="${marginX}" y="${top}" width="8" height="${blockH}" rx="2" fill="${accent}"/>`);

  const hSvg = hLines.map((line, i) =>
    `<text x="${anchorX}" y="${firstLineY + i * hLineH}" text-anchor="${anchor}" filter="url(#styleShadow)" fill="#ffffff" font-family="${font}" font-size="${hSize}" font-weight="${spec.weight}" letter-spacing="${spec.tracking}">${escapeXml(line)}</text>`,
  ).join('');
  const lastLineY = firstLineY + (hLines.length - 1) * hLineH;

  if (spec.deco === 'underline') deco.push(`<rect x="${ruleX}" y="${lastLineY + Math.round(hSize * 0.22)}" width="${ruleW}" height="6" rx="3" fill="${accent}"/>`);
  if (spec.deco === 'block-under') deco.push(`<rect x="${ruleX}" y="${lastLineY + Math.round(hSize * 0.2)}" width="${Math.round(ruleW * 1.4)}" height="14" rx="2" fill="${accent}"/>`);

  let subY = lastLineY + Math.round(height * 0.035) + subSize;
  if (spec.deco === 'rule-below' && subLines.length) {
    deco.push(`<rect x="${ruleX}" y="${lastLineY + Math.round(hSize * 0.28)}" width="${ruleW}" height="3" rx="1.5" fill="${accent}"/>`);
    subY += Math.round(height * 0.01);
  }
  const subSvg = subLines.map((line, i) =>
    `<text x="${anchorX}" y="${subY + i * subLineH}" text-anchor="${anchor}" fill="rgba(255,255,255,0.9)" font-family="${sans}" font-size="${subSize}" font-weight="500">${escapeXml(line)}</text>`,
  ).join('');

  const ctaSvg = cta
    ? `<text x="${anchorX}" y="${Math.round(height * 0.93)}" text-anchor="${anchor}" fill="${accent}" font-family="${sans}" font-size="${Math.round(width * 0.028)}" font-weight="700" letter-spacing="0.5">${escapeXml(cta)} →</text>`
    : '';

  const svg =
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    '<defs>' +
    '<linearGradient id="styleScrim" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#0b1220" stop-opacity="0.62"/>' +
    '<stop offset="1" stop-color="#0b1220" stop-opacity="0.72"/>' +
    '</linearGradient>' +
    '<filter id="styleShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000000" flood-opacity="0.45"/></filter>' +
    '</defs>' +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#styleScrim)"/>` +
    deco.join('') + hSvg + subSvg + ctaSvg +
    '</svg>';

  const flags: string[] = [];
  if (!headline) flags.push('missing_headline');
  const quality: OverlayQualityReport = {
    score: headline ? 1 : 0,
    flags,
    text_units: headline.length + sub.length + cta.length,
    preset: `style_${styleId}`,
  };
  return { svg, quality, brandPlacement: defaultBrandPlacement({ width, height, fileNamePrefix: input.fileNamePrefix }) };
}

export function buildOverlaySvg(input: {
  width: number;
  height: number;
  overlay: Record<string, string>;
  brandKit: CreatorBrandKit;
  platform: string;
  fileNamePrefix: string;
  subtypeHint?: ImageSubtypeHint | null;
  /**
   * Strategy-aware rendering modifiers (resolved from
   * `renderStrategyRegistry.ts`). When null/omitted, the renderer
   * applies the existing preset path byte-identical to the
   * pre-phase renderer — legacy assets are unaffected.
   */
  renderStrategy?: import('./creator/renderStrategyRegistry').RenderStrategy | null;
  /**
   * Slide position for carousel/pdf/slider renders. When supplied,
   * the overlay surfaces a clean "N / M" page indicator instead of
   * the role label (operator feedback: drop the "HOOK" eyebrow).
   * Also drives the right-edge swipe chevron on every slide except
   * the last (no swipe affordance needed on the final frame).
   */
  slideIndex?: number;
  slideTotal?: number;
  /**
   * Deck-wide rendering context. When supplied, this slide:
   *   - uses the deck's shared adaptive font multiplier (consistency
   *     across all slides — no per-slide font drift)
   *   - uses the deck's continuous wave anchors (entry/exit Y) so the
   *     visual continuity line flows smoothly across the carousel
   *   - uses the layout mode (top / center / bottom) chosen for this
   *     index, giving the deck visual rhythm
   */
  deckContext?: {
    fontMultiplier: number;
    layoutModes: Array<'text_top' | 'text_center' | 'text_bottom'>;
    waveAnchors: Array<{ entryY: number; exitY: number }>;
  };
  /**
   * Canonical Template visual language (image/banner/carousel base overlay
   * preset). Resolved by the caller via resolveTemplate(); the overlay base
   * is built from it. Omitted → DEFAULT_IMAGE_STYLE → byte-identical.
   */
  imageStyle?: ImageStyleSchema;
  /**
   * Deck continuity-wave gate (carousel visual language
   * `decoration.wave.enabled`). Omitted/true → the wave renders exactly as
   * before (byte-identical); false → the deck suppresses the continuity wave.
   */
  waveEnabled?: boolean;
}): { svg: string; quality: OverlayQualityReport; brandPlacement: { top: number; left: number; maxWidth: number; maxHeight: number } } {
  // Resolve strategy modifiers. When no strategy supplied, all
  // multipliers are 1.0 + ctaMode='standard' so behaviour is byte
  // identical to the pre-phase renderer (legacy gate, PHASE 10).
  const { applyScale } = require('./creator/renderStrategyRegistry') as typeof import('./creator/renderStrategyRegistry');
  const strategyMods = input.renderStrategy?.modifiers ?? null;
  const presetRaw = getOverlayPreset(input.platform, input.fileNamePrefix, input.overlay, input.subtypeHint ?? null, input.imageStyle ?? DEFAULT_IMAGE_STYLE);
  // Apply strategy multipliers to the preset table BEFORE downstream
  // sizing math reads from it. Each multiplier is bounded inside
  // applyScale so a malformed strategy can't yield off-canvas sizes.
  const strategyAdjustedPreset = strategyMods
    ? {
        ...presetRaw,
        hookSize: applyScale(presetRaw.hookSize, strategyMods.hookScale),
        headlineSize: applyScale(presetRaw.headlineSize, strategyMods.headlineScale),
        insightSize: applyScale(presetRaw.insightSize, strategyMods.insightScale),
        supportSize: applyScale(presetRaw.supportSize, strategyMods.supportScale),
        maxHeadlineLines: Math.max(
          1,
          Math.min(4, presetRaw.maxHeadlineLines + strategyMods.maxHeadlineLinesDelta),
        ),
      }
    : presetRaw;
  // Operator feedback: "font sizes should be bigger... size of text
  // should vary [with quantity]". Apply an adaptive multiplier on top
  // of the strategy-tuned preset:
  //   - very short copy   (≤80 chars total)  → 1.32× — fonts breathe,
  //                                              title dominates the frame
  //   - short copy        (81–160)           → 1.18×
  //   - normal copy       (161–260)          → 1.05× — slight bump
  //                                              so the new default is
  //                                              always larger than the
  //                                              old preset
  //   - long copy         (261–380)          → 0.96×
  //   - very long copy    (>380)             → 0.86× — squeeze to fit
  //
  // Total chars = headline + keyInsight + supportingText. CTA copy is
  // sized independently and doesn't enter this calculation.
  const overlayTextLength =
    String(input.overlay.headline || '').length +
    String(input.overlay.keyInsight || '').length +
    String(input.overlay.supportingText || '').length;
  // Deck-wide font multiplier wins when supplied — operator feedback:
  // "[the renderer] should be aware of all the five slides so we can
  // bring the consistency into the text format". Without this, each
  // slide picked its own scale and a 60-char slide rendered with a
  // 1.32× headline while a 200-char slide rendered with 1.05× — same
  // deck, visibly different font sizes. The deck context's multiplier
  // is derived from the LONGEST slide so everything fits at one scale.
  const perSlideMultiplier =
    overlayTextLength <= 80 ? 1.32
    : overlayTextLength <= 160 ? 1.18
    : overlayTextLength <= 260 ? 1.05
    : overlayTextLength <= 380 ? 0.96
    : 0.86;
  const adaptiveMultiplier = input.deckContext?.fontMultiplier ?? perSlideMultiplier;
  const preset = {
    ...strategyAdjustedPreset,
    headlineSize: Math.round(strategyAdjustedPreset.headlineSize * adaptiveMultiplier),
    insightSize: Math.round(strategyAdjustedPreset.insightSize * adaptiveMultiplier),
    supportSize: Math.round(strategyAdjustedPreset.supportSize * adaptiveMultiplier),
    hookSize: Math.round(strategyAdjustedPreset.hookSize * adaptiveMultiplier),
  };
  const overlayStrategy = input.brandKit.overlayStrategy;
  const accent = input.brandKit.accentColor;
  const headlineLines = balanceTextLines(input.overlay.headline, preset.headlineChars, preset.maxHeadlineLines);
  // Auto-fit the body: shrink the insight font (which fits more chars per line)
  // until the FULL keyInsight fits within its line budget, so the body is never
  // cut short. Floored at 72% for legibility; only activates for slides that would
  // otherwise overflow — shorter slides keep the deck-consistent size.
  const insightText = compactText(input.overlay.keyInsight || '');
  let fittedInsightSize = preset.insightSize;
  {
    const insightFloor = Math.max(13, Math.round(preset.insightSize * 0.62));
    const charsAt = (size: number) => Math.max(8, Math.round(preset.insightChars * (preset.insightSize / Math.max(1, size))));
    const fitsAt = (size: number) => insightText.length === 0
      || Math.ceil(insightText.length / charsAt(size)) <= preset.maxInsightLines;
    while (fittedInsightSize > insightFloor && !fitsAt(fittedInsightSize)) fittedInsightSize -= 1;
  }
  const fittedInsightChars = Math.max(8, Math.round(preset.insightChars * (preset.insightSize / Math.max(1, fittedInsightSize))));
  const insightLines = balanceTextLines(input.overlay.keyInsight, fittedInsightChars, preset.maxInsightLines);
  const supportLines = preset.maxSupportLines > 0 ? balanceTextLines(input.overlay.supportingText, preset.supportChars, preset.maxSupportLines) : [];
  // Hook fallback: prefer operator-typed hook → platform → generic.
  // The previous backdrop panel made the platform fallback look like a
  // banner ("INSTAGRAM"); without the panel a missing hook is just
  // silent, which is the correct behaviour.
  // Operator feedback: the slide counter ("1 / 5") was anchored to
  // the headline. It now sits at the TOP-LEFT of the canvas (above
  // the logo area on the right), where viewers expect a page
  // indicator. The eyebrow position above the headline is empty —
  // nothing competes with the title for visual space.
  const isMultiSlide = typeof input.slideIndex === 'number' && typeof input.slideTotal === 'number' && (input.slideTotal as number) > 1;
  const slideCounter = isMultiSlide
    ? `${(input.slideIndex as number) + 1} / ${input.slideTotal}`
    : '';
  // `hook` is now ALWAYS empty for slide renders — the headline owns
  // the top of the text stack. Kept as an empty string so all the
  // downstream geometry math (hookLineGap = 0, hookY unused) is
  // structurally identical without touching the layout code path.
  const hook = '';
  // Text-stack layout — bottom-anchored. Text lives in the lower
  // portion of the image so it doesn't fight a portrait/subject in
  // the upper half. Sizes follow the existing preset so banner /
  // square / portrait aspect ratios keep their tuned hierarchy.
  // Margin is the LARGER of the preset margin and 6% of canvas width
  // so big-format renders keep generous breathing room and the
  // headline never sits flush against the left edge.
  // Strategy-aware margin — base margin times the strategy's
  // marginScale (1.0 when no strategy). Clamped to safe bounds inside
  // applyScale.
  const baseSafeMargin = Math.max(preset.margin, Math.round(input.width * 0.06));
  const safeMargin = strategyMods
    ? Math.round(applyScale(baseSafeMargin, strategyMods.marginScale, 0.7, 1.5))
    : baseSafeMargin;
  const textX = safeMargin;
  const textRightLimit = input.width - safeMargin;
  const textWidth = Math.max(160, textRightLimit - textX);
  // Logo geometry hoisted here (above the text-stack math) because
  // the new top-safety-margin needs logoMaxHeight to clamp the stack
  // below the logo line. brandPlacement / standardBrandMode are
  // recomputed later from these same values for backward-compat.
  const standardBrandMode = preset.brandMode === 'standard';
  // Brand mark enlarged 1.8× — operator feedback: logo/favicon too small on the asset.
  const logoBaseWidth = Math.round(input.width * (standardBrandMode ? 0.24 : 0.16) * 1.8);
  const logoBaseHeight = Math.round(input.height * (standardBrandMode ? 0.13 : 0.11) * 1.8);
  const logoMaxWidth = strategyMods
    ? Math.round(applyScale(logoBaseWidth, strategyMods.logoScaleMultiplier, 0.5, 1.6))
    : logoBaseWidth;
  const logoMaxHeight = strategyMods
    ? Math.round(applyScale(logoBaseHeight, strategyMods.logoScaleMultiplier, 0.5, 1.6))
    : logoBaseHeight;
  const headlineLineHeight = Math.round(preset.headlineSize * 1.14);
  const insightLineHeight = Math.round(fittedInsightSize * 1.34);
  const supportLineHeight = Math.round(preset.supportSize * 1.35);
  const hookLineGap = hook ? Math.round(preset.hookSize * 0.9) + 18 : 0;
  const insightGap = headlineLines.length > 0 && insightLines.length > 0 ? 22 : 0;
  const supportGap = (headlineLines.length + insightLines.length) > 0 && supportLines.length > 0 ? 14 : 0;
  const headlineBlockHeight = headlineLines.length * headlineLineHeight;
  const insightBlockHeight = insightLines.length * insightLineHeight;
  const supportBlockHeight = supportLines.length * supportLineHeight;
  const totalStackHeight = hookLineGap + headlineBlockHeight + insightGap + insightBlockHeight + supportGap + supportBlockHeight;
  const footerHeight = preset.footerMode === 'hidden' ? 0 : 40;
  const bottomPadding = Math.max(48, Math.round(input.height * 0.06));
  // Operator feedback: "text is hiding behind the button". The CTA
  // was placed AT supportEndY - ctaHeight - 14, which is INSIDE the
  // support text region. Now we reserve a bottom band for the CTA
  // (if present) and stack the text ABOVE it, with a clear 22px gap.
  // ctaSlotHeight is computed from preset.supportSize since the
  // actual CTA height is derived from the same dimension downstream.
  const ctaCopyForLayout = String(input.overlay.cta || '').trim();
  const ctaModeForLayout = strategyMods?.ctaMode ?? 'standard';
  const willRenderCta = ctaCopyForLayout.length > 0 && ctaModeForLayout !== 'absent';
  const ctaFontSizeForLayout = Math.round(preset.supportSize * 1.05);
  const ctaPadYForLayout = Math.round(ctaFontSizeForLayout * 0.5);
  const ctaSlotHeight = willRenderCta ? ctaFontSizeForLayout + ctaPadYForLayout * 2 + 22 : 0;
  // Operator feedback: "we should not be limited to showcasing
  // content or the text only at the bottom... different combination
  // that our function should be equipped to handle". The deck context
  // hands this slide a layout mode (text_top / text_center /
  // text_bottom) chosen for its position in the deck — short focal
  // slides (hook / cta) centered, middles alternating top / bottom.
  //
  // For all modes:
  //   - `stackBottomMax` is the floor (CTA band + footer + padding);
  //     the stack can never push past it.
  //   - `topSafetyMargin` is the ceiling — the stack stays below the
  //     top-of-canvas slide counter + logo line.
  //
  // The math below computes the target headline-TOP Y per mode, then
  // clamps it so the stack always fits between the safety bounds.
  const stackBottomMax = input.height - bottomPadding - footerHeight - ctaSlotHeight;
  const logoMaxHeightForSafety = Math.round(input.height * (preset.brandMode === 'standard' ? 0.13 : 0.11) * 1.8);
  const topSafetyMargin = safeMargin + 14 + logoMaxHeightForSafety + Math.round(input.height * 0.04);
  const totalStackPixelHeight = headlineBlockHeight + insightGap + insightBlockHeight + supportGap + supportBlockHeight;
  const layoutMode = (input.deckContext && typeof input.slideIndex === 'number'
    ? input.deckContext.layoutModes[input.slideIndex]
    : null) ?? 'text_center';
  const targetHeadlineTop = (() => {
    if (layoutMode === 'text_top') {
      // Text starts just below the top-of-canvas slide counter/logo
      // band. Gives a poster-style top-anchored composition; the
      // bottom half of the slide is breathing room or visual.
      return topSafetyMargin + Math.round(input.height * 0.02);
    }
    if (layoutMode === 'text_bottom') {
      // Bottom-anchored — like the legacy behaviour, but only when
      // the deck context EXPLICITLY routes a slide here.
      return stackBottomMax - totalStackPixelHeight;
    }
    // text_center (default): headline TOP at ~42% of canvas height
    // for short stacks; centered vertically between top safety and
    // bottom max when the stack is taller.
    const desiredTop = Math.round(input.height * 0.42);
    const naturalBottom = desiredTop + totalStackPixelHeight;
    return naturalBottom <= stackBottomMax ? desiredTop : stackBottomMax - totalStackPixelHeight;
  })();
  // Clamp the target into [topSafetyMargin, stackBottomMax -
  // totalStackPixelHeight] so we NEVER overlap the slide counter at
  // the top or the CTA pill at the bottom.
  const stackTop = Math.max(
    topSafetyMargin,
    Math.min(targetHeadlineTop, stackBottomMax - totalStackPixelHeight),
  );
  const headlineStart = stackTop + headlineLineHeight;
  const headlineEndY = headlineStart + headlineBlockHeight - headlineLineHeight;
  const insightStart = headlineEndY + insightGap + insightLineHeight;
  const insightEndY = insightStart + insightBlockHeight - insightLineHeight;
  const supportStart = insightEndY + supportGap + supportLineHeight;
  const supportEndY = supportStart + supportBlockHeight - supportLineHeight;
  // Eyebrow (hook) is always empty for slide renders post the
  // top-of-canvas slide-counter change; the variable is retained for
  // the SVG template's ternary check but never positioned.
  const hookY = stackTop - 1;
  const layoutBottom = supportEndY + footerHeight + ctaSlotHeight;
  // Footer text (brand name) suppressed — the top-right brand mark
  // already conveys ownership, and rendering "Omnivyra" both as a
  // logo and as a watermark reads as redundant.
  // standardBrandMode / logoBaseWidth / logoBaseHeight / logoMaxWidth /
  // logoMaxHeight are now hoisted above the text-stack math (search
  // upward in this function). They were originally declared here.
  // The brand mark sizing rationale is preserved at that hoisted
  // declaration site.
  const brandPlacement = {
    top: safeMargin + 14,
    left: input.width - safeMargin - logoMaxWidth - 20,
    maxWidth: logoMaxWidth,
    maxHeight: logoMaxHeight,
  };
  const quality = evaluateOverlayQuality({
    overlay: input.overlay,
    preset,
    headlineLines,
    insightLines,
    supportLines,
    layoutBottom,
    height: input.height,
    expectBody: input.fileNamePrefix === 'carousel',
  });

  // Bottom scrim — vertical gradient that fades from transparent at
  // ~50% height down to a soft dark at the bottom. Gives the text
  // enough contrast over any background photo WITHOUT a giant side
  // panel competing with the image content.
  // Strategy-aware scrim: textBlockTopRatio (when supplied by the
  // strategy) overrides the default; intensity multiplier adjusts
  // mid+bottom opacity. Quote / brand-focus → lighter scrim;
  // promotional / story → stronger scrim.
  //
  // Default raised from 0.46 → 0.40 so the text region covers ≥60%
  // of the canvas (operator feedback: "image and text should be in
  // right balance at least 50% coverage" — the prior default left
  // the top ~54% of the slide as empty gradient with text crammed
  // into a corner).
  const scrimTopRatio = strategyMods?.textBlockTopRatio ?? 0.40;
  const scrimTop = Math.round(input.height * Math.max(0.25, Math.min(0.7, scrimTopRatio)));
  const scrimHeight = input.height - scrimTop;
  const scrimIntensity = strategyMods?.scrimIntensityMultiplier ?? 1.0;
  const scrimBottomOpacity = Math.min(
    0.88,
    Math.max(0.45, (overlayStrategy.shadeStartOpacity + 0.2) * scrimIntensity),
  );
  const scrimMidOpacity = Math.max(
    0.14,
    Math.min(0.45, overlayStrategy.shadeMidOpacity * 0.7 * scrimIntensity),
  );
  // Template visual language: overlay text colors resolve from imageStyle
  // (colors are NOT platform-overridden, so they always carry the template
  // identity). Default style == the prior hardcoded white stack → byte-identical.
  const overlayColors = (input.imageStyle ?? DEFAULT_IMAGE_STYLE).colorScheme;
  const headingColor = overlayColors.title;
  const insightColor = overlayColors.body;
  const supportColor = overlayColors.support;

  // CTA emission. The strategy's ctaMode decides whether (and how)
  // the overlay renders a CTA pill. 'absent' suppresses entirely;
  // 'subtle' is text-only with low contrast; 'standard' is a soft
  // pill; 'strong' is a high-contrast pill with the accent color.
  // CTA copy comes from the existing overlayText.cta surface — no
  // new input field, no new caller contract.
  const ctaCopy = String(input.overlay.cta || '').trim();
  const ctaMode = strategyMods?.ctaMode ?? 'standard';
  const renderCta = ctaCopy.length > 0 && ctaMode !== 'absent';
  const ctaFontSize = Math.round(preset.supportSize * 1.05);
  const ctaPadX = Math.round(ctaFontSize * 0.9);
  const ctaPadY = Math.round(ctaFontSize * 0.5);
  const ctaApproxWidth = Math.min(textWidth, Math.round(ctaCopy.length * ctaFontSize * 0.62) + ctaPadX * 2);
  const ctaHeight = ctaFontSize + ctaPadY * 2;
  // CTA sits AT the bottom of the canvas (above the optional footer
  // height) — the support text is layed out above this band with a
  // 22px gap, so the pill never collides with body copy any more.
  const ctaY = input.height - bottomPadding - footerHeight - ctaHeight;
  const ctaSvg = (() => {
    if (!renderCta) return '';
    if (ctaMode === 'subtle') {
      return `<text x="${textX}" y="${ctaY + ctaFontSize}" filter="url(#textShadow)" fill="rgba(255,255,255,0.85)" font-size="${ctaFontSize}" font-family="${input.brandKit.typography.fontFamily}" font-weight="600" letter-spacing="0.4">${escapeXml(ctaCopy)} →</text>`;
    }
    const pillFill = ctaMode === 'strong' ? accent : 'rgba(255,255,255,0.92)';
    const pillTextColor = ctaMode === 'strong' ? '#0F172A' : '#0F172A';
    return `
      <rect x="${textX}" y="${ctaY}" width="${ctaApproxWidth}" height="${ctaHeight}" rx="${Math.round(ctaHeight / 2)}" fill="${pillFill}" opacity="${ctaMode === 'strong' ? 1.0 : 0.92}" />
      <text x="${textX + ctaPadX}" y="${ctaY + ctaPadY + ctaFontSize - 4}" fill="${pillTextColor}" font-size="${ctaFontSize}" font-family="${input.brandKit.typography.fontFamily}" font-weight="${ctaMode === 'strong' ? 800 : 700}" letter-spacing="0.3">${escapeXml(ctaCopy)}</text>
    `;
  })();

  // Visual continuity wave. When the deck context supplies wave
  // anchors, the curve's left-edge Y matches the PREVIOUS slide's
  // right-edge Y exactly — so as the viewer swipes through the
  // carousel the curve reads as ONE continuous flowing line, not
  // five independent stubs.
  //
  // When no deck context is supplied (single-frame image renders),
  // the wave falls back to a self-contained cubic Bézier that lives
  // inside one frame. Same opacity / color treatment as before.
  const w = input.width;
  const h = input.height;
  const deckWaveAnchor = (() => {
    if (!input.deckContext || typeof input.slideIndex !== 'number') return null;
    const anchor = input.deckContext.waveAnchors[input.slideIndex];
    if (!anchor) return null;
    return anchor;
  })();
  // Wave A — filled upper sweep. Anchors at deck entry/exit Y when
  // deckContext present; falls back to fixed 30%/18% sweep otherwise.
  const waveAEntryY = deckWaveAnchor ? deckWaveAnchor.entryY : Math.round(h * 0.30);
  const waveAExitY = deckWaveAnchor ? deckWaveAnchor.exitY : Math.round(h * 0.18);
  // Control points for a smooth cubic Bézier between entry/exit Y.
  // Midpoint Y oscillates slightly inside the canvas so the curve has
  // a natural sway instead of a straight diagonal.
  const waveAMidA = Math.round(((waveAEntryY * 2) + waveAExitY) / 3 - h * 0.06);
  const waveAMidB = Math.round((waveAEntryY + (waveAExitY * 2)) / 3 + h * 0.06);
  const waveA = `M 0 ${waveAEntryY} C ${Math.round(w * 0.28)} ${waveAMidA}, ${Math.round(w * 0.62)} ${waveAMidB}, ${w} ${waveAExitY} L ${w} 0 L 0 0 Z`;
  // Wave B — stroked mid-canvas flow line, also continuous when
  // deckContext present. Offset ~25%h below wave A so the two
  // shapes don't stack on top of each other.
  const waveBOffset = Math.round(h * 0.25);
  const waveBEntryY = waveAEntryY + waveBOffset;
  const waveBExitY = waveAExitY + waveBOffset;
  const waveBMidA = Math.round(((waveBEntryY * 2) + waveBExitY) / 3 - h * 0.04);
  const waveBMidB = Math.round((waveBEntryY + (waveBExitY * 2)) / 3 + h * 0.04);
  const waveB = `M 0 ${waveBEntryY} C ${Math.round(w * 0.30)} ${waveBMidA}, ${Math.round(w * 0.55)} ${waveBMidB}, ${w} ${waveBExitY}`;
  const waveStrokeWidth = Math.max(2, Math.round(h * 0.006));
  // Carousel visual language: continuity wave is on unless the resolved
  // carouselStyle disables it. Omitted (image renders / default) → on →
  // byte-identical.
  // The continuity wave is a CAROUSEL decoration (it flows across slides). On a
  // single image it's just stray "wave lines" over the photo — render it only as
  // part of a deck.
  const renderWave = input.waveEnabled !== false && Boolean(input.deckContext);

  const svg = `
    <svg width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bottomScrim" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(2,6,23,0)" />
          <stop offset="55%" stop-color="rgba(2,6,23,${scrimMidOpacity})" />
          <stop offset="100%" stop-color="rgba(2,6,23,${scrimBottomOpacity})" />
        </linearGradient>
        <linearGradient id="waveGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.24" />
          <stop offset="100%" stop-color="${accent}" stop-opacity="0.08" />
        </linearGradient>
        <filter id="textShadow" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.55)" flood-opacity="1" />
        </filter>
      </defs>
      <!-- Visual continuity wave (filled, upper sweep) -->
      ${renderWave ? `<path d="${waveA}" fill="url(#waveGradient)" />` : ''}
      <!-- Operator feedback: "the wave gets truncated halfway... it
           should be complete, and then it should continue the next
           slide." Two stroked layers ensure the curve reads as a
           clear, complete line edge-to-edge:
            • a soft accent stroke that traces the upper wave's
              full path from x=0 to x=W
            • a thicker accent stroke for the mid-canvas flow line
              with rounded caps so the curve appears to "exit"
              cleanly into the next slide rather than truncating
           Both stroke entry/exit Y values are derived from the deck
           context's wave anchors so slide N's right edge matches
           slide N+1's left edge — the swipe-through experience reads
           as one continuous flowing line. -->
      ${renderWave ? `<path d="M 0 ${waveAEntryY} C ${Math.round(w * 0.28)} ${waveAMidA}, ${Math.round(w * 0.62)} ${waveAMidB}, ${w} ${waveAExitY}" fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="${Math.max(2, Math.round(waveStrokeWidth * 0.7))}" stroke-linecap="round" />` : ''}
      ${renderWave ? `<path d="${waveB}" fill="none" stroke="${accent}" stroke-opacity="0.48" stroke-width="${Math.round(waveStrokeWidth * 1.4)}" stroke-linecap="round" />` : ''}
      <rect x="0" y="${scrimTop}" width="${input.width}" height="${scrimHeight}" fill="url(#bottomScrim)" />
      ${(() => {
        // Next-slide swipe indicator. Rendered on every slide except
        // the final one (operator feedback: "no mark to move to the
        // next slider"). Soft circular badge with a chevron at the
        // vertical midline / right edge — always visible against any
        // background thanks to the white fill + drop shadow.
        if (!isMultiSlide) return '';
        const isLast = (input.slideIndex as number) >= (input.slideTotal as number) - 1;
        if (isLast) return '';
        const arrowSize = Math.max(36, Math.round(input.height * 0.045));
        const arrowR = Math.round(arrowSize / 2);
        const arrowCx = input.width - safeMargin - arrowR;
        const arrowCy = Math.round(input.height * 0.5);
        const gAx = arrowCx - Math.round(arrowR * 0.28);
        const gBx = arrowCx + Math.round(arrowR * 0.32);
        const gAyTop = arrowCy - Math.round(arrowR * 0.42);
        const gAyBot = arrowCy + Math.round(arrowR * 0.42);
        return `
          <g opacity="0.92">
            <circle cx="${arrowCx}" cy="${arrowCy}" r="${arrowR}" fill="rgba(255,255,255,0.92)" filter="url(#textShadow)" />
            <polyline points="${gAx},${gAyTop} ${gBx},${arrowCy} ${gAx},${gAyBot}" fill="none" stroke="#0F172A" stroke-width="${Math.max(2, Math.round(arrowR * 0.18))}" stroke-linecap="round" stroke-linejoin="round" />
          </g>
        `;
      })()}
      ${slideCounter ? (() => {
        // Top-of-canvas slide counter. Sits at the top-left,
        // vertically centered against the same Y as the brand mark
        // top-right so the two read as a balanced pair across the
        // top edge. Smaller hookSize-derived font, accent color, with
        // text shadow so it stays legible against any background.
        const counterFontSize = Math.max(18, Math.round(preset.hookSize * 0.80));
        const counterY = brandPlacement.top + Math.round(brandPlacement.maxHeight / 2) + Math.round(counterFontSize / 3);
        const counterX = safeMargin;
        return `<text x="${counterX}" y="${counterY}" filter="url(#textShadow)" fill="rgba(255,255,255,0.94)" font-size="${counterFontSize}" font-family="${input.brandKit.typography.fontFamily}" font-weight="700" letter-spacing="2.4">${escapeXml(slideCounter)}</text>`;
      })() : ''}
      ${headlineLines.map((line, index) => `<text x="${textX}" y="${headlineStart + index * headlineLineHeight}" filter="url(#textShadow)" fill="${headingColor}" font-size="${preset.headlineSize}" font-family="${input.brandKit.typography.fontFamily}" font-weight="${input.brandKit.typography.headingWeight}">${escapeXml(line)}</text>`).join('')}
      ${insightLines.map((line, index) => `<text x="${textX}" y="${insightStart + index * insightLineHeight}" filter="url(#textShadow)" fill="${insightColor}" font-size="${fittedInsightSize}" font-family="${input.brandKit.typography.fontFamily}" font-weight="${input.brandKit.typography.bodyWeight}">${escapeXml(line)}</text>`).join('')}
      ${supportLines.map((line, index) => `<text x="${textX}" y="${supportStart + index * supportLineHeight}" filter="url(#textShadow)" fill="${supportColor}" font-size="${preset.supportSize}" font-family="${input.brandKit.typography.fontFamily}" font-weight="500">${escapeXml(line)}</text>`).join('')}
      ${ctaSvg}
      <!-- footer watermark suppressed (brand mark in top-right is canonical); textWidth=${textWidth} retained for layout-spec future use -->
    </svg>
  `.trim();
  return { svg, quality, brandPlacement };
}

export async function loadBrandMark(input: {
  brandKit: CreatorBrandKit;
  placement: { maxWidth: number; maxHeight: number };
}): Promise<Buffer | null> {
  const brandMark = normalizeBrandMark(input.brandKit);
  const cacheKey = `brandmark:${input.brandKit.tenantId || 'tenant'}:${input.brandKit.companyId || 'company'}:${input.brandKit.renderIdentityHash}:${brandMark.type}:${brandMark.source}:${input.placement.maxWidth}x${input.placement.maxHeight}`;
  // Brand mark policy: render the COMPANY LOGO only. When no real logo/favicon
  // URL resolved, do NOT fall back to an initials monogram (operator feedback:
  // the "OM"/"OAIM" initials badge reads as a placeholder, not company brand).
  // Returning null makes every caller skip the composite (all guard `if
  // (brandMark)`), so a logo-less company gets a clean slide instead of initials.
  if (brandMark.type === 'initials' || !/^https?:\/\//i.test(brandMark.source)) {
    return null;
  }
  try {
    return await getCachedRenderBuffer(cacheKey, async () => {
      const buffer = await bufferFromRemoteImage(brandMark.source);
      // Operator feedback: "we should logo embed transparent
      // background" + "logo is looking patchwork". The brightness +
      // saturation modulate was tinting the logo and the backing
      // tile read as a patchwork rectangle. We now preserve the
      // logo's alpha channel verbatim — just resize + a light
      // sharpen so edges stay crisp at small footprint. No tint, no
      // tone shift, no flattening; the PNG composite onto the
      // background keeps the logo's native transparency.
      return sharp(buffer, { failOn: 'none' })
        .resize({ width: input.placement.maxWidth, height: input.placement.maxHeight, fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .sharpen({ sigma: 0.5 })
        .png()
        .toBuffer();
    });
  } catch {
    // Remote logo failed to load — skip the mark rather than substituting
    // initials. A missing logo is preferable to a placeholder monogram.
    return null;
  }
}

async function renderInitialsBrandMark(input: {
  initials: string;
  brandKit: CreatorBrandKit;
  placement: { maxWidth: number; maxHeight: number };
}): Promise<Buffer> {
  const size = Math.max(44, Math.min(input.placement.maxWidth, input.placement.maxHeight));
  const radius = Math.round(size * 0.24);
  const fontSize = Math.round(size * 0.42);
  const fill = input.brandKit.accentColor;
  const textColor = input.brandKit.overlayStrategy.ctaTextColor;
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${radius}" fill="${fill}" />
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="${textColor}" font-family="${input.brandKit.typography.fontFamily}" font-size="${fontSize}" font-weight="900">${escapeXml(input.initials.slice(0, 3))}</text>
    </svg>
  `.trim();
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function normalizeBackgroundBuffer(input: {
  providerBuffer?: Buffer | null;
  width: number;
  height: number;
  colors: string[];
  variantId?: string;
}): Promise<{ buffer: Buffer; fallbackReason?: string }> {
  if (!input.providerBuffer) {
    return {
      buffer: await renderBackgroundPng({ width: input.width, height: input.height, colors: input.colors, variantId: input.variantId }),
      fallbackReason: 'provider_image_unavailable',
    };
  }
  try {
    const image = sharp(input.providerBuffer, { failOn: 'none' });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('provider image missing dimensions');
    }
    return {
      buffer: await image
        .resize(input.width, input.height, { fit: 'cover' })
        .png()
        .toBuffer(),
    };
  } catch (error) {
    return {
      buffer: await renderBackgroundPng({ width: input.width, height: input.height, colors: input.colors, variantId: input.variantId }),
      fallbackReason: `provider_image_invalid:${error instanceof Error ? error.message : String(error)}`.slice(0, 180),
    };
  }
}

/**
 * Build the provider image prompt via the layered composer + the
 * multimodal evolution stack (Phases 1-9 of brand-conditioned creative).
 *
 * Pipeline:
 *   1. Compose first attempt via creatorPromptComposer (premium
 *      auto-detected when brand grounding is strong).
 *   2. Score the prompt via creatorOutputQualityRanking.
 *   3. If below threshold, compute adaptive retry directives and
 *      re-compose ONCE with the mutations applied. Pick the higher-
 *      scoring of the two attempts.
 *   4. Assemble the multimodal payload via creatorMultimodalReferences
 *      against the current provider's capabilities. References
 *      survive as image inputs (capable providers) or as enriched
 *      textual descriptors (legacy providers).
 *   5. Update the brand visual memory so subsequent generations
 *      reuse the same template for visual continuity.
 *   6. Stash the full audit envelope on assetPayload.media_bundle.metadata.
 *   7. Return the final text prompt the existing provider call expects.
 *
 * No control-flow changes to the caller. The function still returns a
 * single string; the multimodal payload + scoring + retry all happen
 * inside the prompt-building boundary so the renderer's existing
 * provider call signature stays untouched.
 */
