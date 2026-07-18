/** Part 2/10 of creatorAssetRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
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
import { estimateTextBox, validateLayoutGeometry, charsPerLineForWidth } from './creatorRenderGeometry';
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
import { type OverlayQualityReport, escapeXml, balanceTextLines, compactText, fitTextToBox, mergeTextFit, graphemeLength, graphemeSlice } from './creatorAssetRendererContracts';
import { defaultBrandPlacement } from './creatorAssetRendererImage';

export function buildStatCardSvg(input: {
  width: number;
  height: number;
  overlay: Record<string, string>;
  brandKit: CreatorBrandKit;
  fileNamePrefix: string;
}): { svg: string; quality: OverlayQualityReport; brandPlacement: { top: number; left: number; maxWidth: number; maxHeight: number } } {
  const { width, height, overlay, brandKit } = input;
  const font = brandKit.typography?.fontFamily || 'Inter, Arial, sans-serif';
  const accent = Array.isArray(brandKit.palette) && brandKit.palette.length ? brandKit.palette[0] : '#0ea5e9';
  const cx = Math.round(width / 2);

  const stat = compactText(overlay.headline || '').trim();
  const context = compactText(overlay.supportingText || overlay.keyInsight || '').trim();
  const cta = compactText(overlay.cta || '').trim();

  // WS3 fit-to-content: shrink the stat figure / context to fit their line
  // budgets (recompute chars/line as the font drops). Short copy → base size.
  const statBaseSize = Math.round(width * 0.135);
  const statFit = fitTextToBox({ text: stat, baseFontSize: statBaseSize, baseCharsPerLine: Math.max(6, charsPerLineForWidth(width, statBaseSize, 0.62)), maxLines: 2 });
  const statSize = statFit.fontSize;
  const statLines = balanceTextLines(stat, statFit.charsPerLine, 2);
  const ctxBaseSize = Math.round(width * 0.033);
  const ctxFit = context
    ? fitTextToBox({ text: context, baseFontSize: ctxBaseSize, baseCharsPerLine: Math.max(18, charsPerLineForWidth(width, ctxBaseSize, 0.56)), maxLines: 3 })
    : { fontSize: ctxBaseSize, charsPerLine: 1, fits: true, lines: 0 };
  const ctxSize = ctxFit.fontSize;
  const ctxLines = context ? balanceTextLines(context, ctxFit.charsPerLine, 3) : [];

  const statLineH = Math.round(statSize * 1.04);
  const ctxLineH = Math.round(ctxSize * 1.4);
  const gap = ctxLines.length ? Math.round(height * 0.03) : 0;
  const blockH = statLines.length * statLineH + gap + ctxLines.length * ctxLineH;
  const firstBaseline = Math.round((height - blockH) / 2 + statSize * 0.78);

  const ruleW = Math.round(width * 0.12);
  const ruleY = Math.round((height - blockH) / 2 - height * 0.022);
  const ruleSvg = `<rect x="${cx - Math.round(ruleW / 2)}" y="${ruleY}" width="${ruleW}" height="6" rx="3" fill="${accent}"/>`;

  const statSvg = statLines.map((line, i) =>
    `<text x="${cx}" y="${firstBaseline + i * statLineH}" text-anchor="middle" filter="url(#statShadow)" fill="#ffffff" font-family="${font}" font-size="${statSize}" font-weight="900" letter-spacing="-1">${escapeXml(line)}</text>`,
  ).join('');

  const ctxTop = firstBaseline + (statLines.length - 1) * statLineH + gap + ctxSize;
  const ctxSvg = ctxLines.map((line, i) =>
    `<text x="${cx}" y="${ctxTop + i * ctxLineH}" text-anchor="middle" fill="rgba(255,255,255,0.92)" font-family="${font}" font-size="${ctxSize}" font-weight="500">${escapeXml(line)}</text>`,
  ).join('');

  const ctaSize = Math.round(width * 0.028);
  const ctaSvg = cta
    ? `<text x="${cx}" y="${Math.round(height * 0.93)}" text-anchor="middle" fill="${accent}" font-family="${font}" font-size="${ctaSize}" font-weight="700" letter-spacing="0.5">${escapeXml(cta)} →</text>`
    : '';

  const svg =
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    '<defs>' +
    '<linearGradient id="statScrim" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#0b1220" stop-opacity="0.64"/>' +
    '<stop offset="0.5" stop-color="#0b1220" stop-opacity="0.3"/>' +
    '<stop offset="1" stop-color="#0b1220" stop-opacity="0.7"/>' +
    '</linearGradient>' +
    '<filter id="statShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000000" flood-opacity="0.45"/></filter>' +
    '</defs>' +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#statScrim)"/>` +
    ruleSvg + statSvg + ctxSvg + ctaSvg +
    '</svg>';

  const flags: string[] = [];
  if (!stat) flags.push('missing_headline');
  const quality: OverlayQualityReport = {
    score: stat ? 1 : 0,
    flags,
    text_units: stat.length + context.length + cta.length,
    preset: 'stat_card',
    text_fit: mergeTextFit([
      { field: 'headline', fits: stat ? statFit.fits : true },
      { field: 'supportingText', fits: context ? ctxFit.fits : true },
    ]),
  };
  return { svg, quality, brandPlacement: defaultBrandPlacement({ width, height, fileNamePrefix: input.fileNamePrefix }) };
}

/**
 * Quote-card image composition (opt-in via renderingContract.imageComposition='quote').
 * A large decorative quotation mark, the quote (overlay.headline) centered, and the
 * attribution (overlay.keyInsight) in the brand accent — an editorial quote layout distinct
 * from the stacked overlay, so Quote / Testimonial templates read as quote cards.
 */
export function buildQuoteCardSvg(input: {
  width: number;
  height: number;
  overlay: Record<string, string>;
  brandKit: CreatorBrandKit;
  fileNamePrefix: string;
}): { svg: string; quality: OverlayQualityReport; brandPlacement: { top: number; left: number; maxWidth: number; maxHeight: number } } {
  const { width, height, overlay, brandKit } = input;
  const font = brandKit.typography?.fontFamily || 'Inter, Arial, sans-serif';
  const accent = Array.isArray(brandKit.palette) && brandKit.palette.length ? brandKit.palette[0] : '#0ea5e9';
  const cx = Math.round(width / 2);

  // Strip any wrapping quotes — we render our own decorative mark.
  const quote = compactText(overlay.headline || '').trim().replace(/^["“”'']+|["“”'']+$/g, '').trim();
  const author = compactText(overlay.keyInsight || overlay.supportingText || '').trim();

  const quoteBaseSize = Math.round(width * 0.062);
  const quoteFit = fitTextToBox({ text: quote, baseFontSize: quoteBaseSize, baseCharsPerLine: Math.max(14, charsPerLineForWidth(width, quoteBaseSize, 0.52)), maxLines: 5 });
  const quoteSize = quoteFit.fontSize;
  const quoteLines = balanceTextLines(quote, quoteFit.charsPerLine, 5);
  const authorSize = Math.round(width * 0.03);
  const lineH = Math.round(quoteSize * 1.32);
  const authorGap = author ? Math.round(height * 0.055) : 0;
  const blockH = quoteLines.length * lineH + authorGap + (author ? authorSize : 0);
  const markSize = Math.round(width * 0.16);
  const startY = Math.round((height - blockH) / 2);
  const quoteTop = startY + quoteSize;

  const markSvg = `<text x="${cx}" y="${startY - Math.round(markSize * 0.12)}" text-anchor="middle" fill="${accent}" font-family="Georgia, 'Times New Roman', serif" font-size="${markSize}" font-weight="700" opacity="0.9">&#8220;</text>`;
  const quoteSvg = quoteLines.map((line, i) =>
    `<text x="${cx}" y="${quoteTop + i * lineH}" text-anchor="middle" filter="url(#quoteShadow)" fill="#ffffff" font-family="${font}" font-size="${quoteSize}" font-weight="600">${escapeXml(line)}</text>`,
  ).join('');
  const authorY = quoteTop + (quoteLines.length - 1) * lineH + authorGap + authorSize;
  const authorSvg = author
    ? `<text x="${cx}" y="${authorY}" text-anchor="middle" fill="${accent}" font-family="${font}" font-size="${authorSize}" font-weight="700" letter-spacing="0.4">${escapeXml(/^[—–-]/.test(author) ? author : `— ${author}`)}</text>`
    : '';

  const svg =
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    '<defs>' +
    '<linearGradient id="quoteScrim" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#0b1220" stop-opacity="0.66"/>' +
    '<stop offset="0.5" stop-color="#0b1220" stop-opacity="0.36"/>' +
    '<stop offset="1" stop-color="#0b1220" stop-opacity="0.72"/>' +
    '</linearGradient>' +
    '<filter id="quoteShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#000000" flood-opacity="0.4"/></filter>' +
    '</defs>' +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#quoteScrim)"/>` +
    markSvg + quoteSvg + authorSvg +
    '</svg>';

  const flags: string[] = [];
  if (!quote) flags.push('missing_headline');
  const quality: OverlayQualityReport = {
    score: quote ? 1 : 0,
    flags,
    text_units: quote.length + author.length,
    preset: 'quote_card',
    text_fit: mergeTextFit([{ field: 'headline', fits: quote ? quoteFit.fits : true }]),
  };
  return { svg, quality, brandPlacement: defaultBrandPlacement({ width, height, fileNamePrefix: input.fileNamePrefix }) };
}

/**
 * Split / contrast image composition (opt-in via renderingContract.imageComposition='split').
 * Two stacked panels — top = overlay.headline (Before / Myth), bottom = overlay.supportingText
 * (After / Fact) — with a red→green tint, a center divider, edge accent bars, and a derived
 * label (the leading "Word:" of each side, e.g. "MYTH" / "FACT"). Gives before/after and
 * myth-vs-fact templates the two-sided layout their intent needs, using the existing
 * headline + subheadline fields (no new fields).
 */
export function buildSplitCardSvg(input: {
  width: number;
  height: number;
  overlay: Record<string, string>;
  brandKit: CreatorBrandKit;
  fileNamePrefix: string;
}): { svg: string; quality: OverlayQualityReport; brandPlacement: { top: number; left: number; maxWidth: number; maxHeight: number } } {
  const { width, height, overlay, brandKit } = input;
  const font = brandKit.typography?.fontFamily || 'Inter, Arial, sans-serif';
  const cx = Math.round(width / 2);
  const half = Math.round(height / 2);
  const negColor = '#ef4444';
  const posColor = '#22c55e';

  const parse = (t: string): { label: string | null; body: string } => {
    const s = compactText(t || '').trim();
    const m = s.match(/^([A-Za-z][A-Za-z ]{1,14}):\s*(.+)$/);
    return m ? { label: m[1].trim().toUpperCase(), body: m[2].trim() } : { label: null, body: s };
  };
  const top = parse(overlay.headline || '');
  const bot = parse(overlay.supportingText || overlay.keyInsight || '');

  // WS3 fit-to-content per panel body — recompute chars/line as the font shrinks.
  const splitBodyBase = Math.round(width * 0.05);
  const splitFit = (body: string) => fitTextToBox({ text: body, baseFontSize: splitBodyBase, baseCharsPerLine: Math.max(14, charsPerLineForWidth(width, splitBodyBase, 0.54)), maxLines: 4 });
  const topFit = splitFit(top.body);
  const botFit = splitFit(bot.body);

  const panel = (yBase: number, accent: string, label: string | null, body: string, fit: ReturnType<typeof splitFit>): string => {
    const labelSize = Math.round(width * 0.026);
    const bodySize = fit.fontSize;
    const bodyLines = balanceTextLines(body, fit.charsPerLine, 4);
    const lineH = Math.round(bodySize * 1.22);
    const labelGap = label ? labelSize + Math.round(height * 0.02) : 0;
    const blockH = labelGap + bodyLines.length * lineH;
    let y = yBase + Math.round((half - blockH) / 2) + Math.round(bodySize * 0.7);
    let svg = '';
    if (label) {
      svg += `<text x="${cx}" y="${y}" text-anchor="middle" fill="${accent}" font-family="${font}" font-size="${labelSize}" font-weight="800" letter-spacing="3">${escapeXml(label)}</text>`;
      y += labelGap;
    }
    svg += bodyLines.map((line, i) =>
      `<text x="${cx}" y="${y + i * lineH}" text-anchor="middle" filter="url(#splitShadow)" fill="#ffffff" font-family="${font}" font-size="${bodySize}" font-weight="600">${escapeXml(line)}</text>`,
    ).join('');
    return svg;
  };

  const svg =
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    '<defs>' +
    '<linearGradient id="splitScrim" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#0b1220" stop-opacity="0.6"/>' +
    '<stop offset="1" stop-color="#0b1220" stop-opacity="0.6"/>' +
    '</linearGradient>' +
    '<filter id="splitShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#000000" flood-opacity="0.45"/></filter>' +
    '</defs>' +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#splitScrim)"/>` +
    `<rect x="0" y="0" width="${width}" height="${half}" fill="${negColor}" opacity="0.14"/>` +
    `<rect x="0" y="${half}" width="${width}" height="${height - half}" fill="${posColor}" opacity="0.14"/>` +
    `<rect x="0" y="0" width="10" height="${half}" fill="${negColor}"/>` +
    `<rect x="0" y="${half}" width="10" height="${height - half}" fill="${posColor}"/>` +
    `<rect x="0" y="${half - 2}" width="${width}" height="4" fill="#ffffff" opacity="0.5"/>` +
    panel(0, negColor, top.label, top.body, topFit) +
    panel(half, posColor, bot.label, bot.body, botFit) +
    '</svg>';

  const flags: string[] = [];
  if (!top.body) flags.push('missing_headline');
  if (!bot.body) flags.push('missing_support');
  const quality: OverlayQualityReport = {
    score: top.body && bot.body ? 1 : top.body || bot.body ? 0.5 : 0,
    flags,
    text_units: top.body.length + bot.body.length,
    preset: 'split_card',
    text_fit: mergeTextFit([
      { field: 'headline', fits: top.body ? topFit.fits : true },
      { field: 'supportingText', fits: bot.body ? botFit.fits : true },
    ]),
  };
  return { svg, quality, brandPlacement: defaultBrandPlacement({ width, height, fileNamePrefix: input.fileNamePrefix }) };
}

/**
 * Two-column image composition (opt-in via renderingContract.imageComposition='two-column').
 * Side-by-side option columns — left = overlay.headline (Option A), right = overlay.supportingText
 * (Option B) — with a vertical divider and a center "VS" badge, each with a derived "Word:" label.
 * Gives Comparison templates the side-by-side contrast their intent needs, using the existing
 * twoColForm (headline + subheadline) fields — no new fields.
 */
export function buildTwoColumnCardSvg(input: {
  width: number;
  height: number;
  overlay: Record<string, string>;
  brandKit: CreatorBrandKit;
  fileNamePrefix: string;
}): { svg: string; quality: OverlayQualityReport; brandPlacement: { top: number; left: number; maxWidth: number; maxHeight: number } } {
  const { width, height, overlay, brandKit } = input;
  const font = brandKit.typography?.fontFamily || 'Inter, Arial, sans-serif';
  const accent = Array.isArray(brandKit.palette) && brandKit.palette.length ? brandKit.palette[0] : '#7c3aed';
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);

  const parse = (t: string): { label: string | null; body: string } => {
    const s = compactText(t || '').trim();
    const m = s.match(/^([A-Za-z][A-Za-z ]{1,14}):\s*(.+)$/);
    return m ? { label: m[1].trim().toUpperCase(), body: m[2].trim() } : { label: null, body: s };
  };
  const left = parse(overlay.headline || '');
  const right = parse(overlay.supportingText || overlay.keyInsight || '');

  const colTextW = Math.round(width * 0.4);
  // WS3 fit-to-content per column body.
  const colBodyBase = Math.round(width * 0.042);
  const colFit = (body: string) => fitTextToBox({ text: body, baseFontSize: colBodyBase, baseCharsPerLine: Math.max(8, charsPerLineForWidth(colTextW, colBodyBase, 0.56)), maxLines: 6 });
  const leftFit = colFit(left.body);
  const rightFit = colFit(right.body);
  const col = (centerX: number, label: string | null, body: string, fit: ReturnType<typeof colFit>): string => {
    const labelSize = Math.round(width * 0.024);
    const bodySize = fit.fontSize;
    const bodyLines = balanceTextLines(body, fit.charsPerLine, 6);
    const lineH = Math.round(bodySize * 1.24);
    const labelGap = label ? labelSize + Math.round(height * 0.02) : 0;
    const blockH = labelGap + bodyLines.length * lineH;
    let y = cy - Math.round(blockH / 2) + Math.round(bodySize * 0.7);
    let svg = '';
    if (label) {
      svg += `<text x="${centerX}" y="${y}" text-anchor="middle" fill="${accent}" font-family="${font}" font-size="${labelSize}" font-weight="800" letter-spacing="2.5">${escapeXml(label)}</text>`;
      y += labelGap;
    }
    svg += bodyLines.map((line, i) =>
      `<text x="${centerX}" y="${y + i * lineH}" text-anchor="middle" filter="url(#twoColShadow)" fill="#ffffff" font-family="${font}" font-size="${bodySize}" font-weight="600">${escapeXml(line)}</text>`,
    ).join('');
    return svg;
  };

  const badgeR = Math.round(width * 0.058);
  const svg =
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    '<defs>' +
    '<linearGradient id="twoColScrim" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#0b1220" stop-opacity="0.62"/>' +
    '<stop offset="1" stop-color="#0b1220" stop-opacity="0.64"/>' +
    '</linearGradient>' +
    '<filter id="twoColShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#000000" flood-opacity="0.45"/></filter>' +
    '</defs>' +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#twoColScrim)"/>` +
    `<rect x="${cx - 2}" y="${Math.round(height * 0.14)}" width="4" height="${Math.round(height * 0.72)}" fill="#ffffff" opacity="0.32"/>` +
    col(Math.round(width * 0.25), left.label, left.body, leftFit) +
    col(Math.round(width * 0.75), right.label, right.body, rightFit) +
    `<circle cx="${cx}" cy="${cy}" r="${badgeR}" fill="${accent}"/>` +
    `<text x="${cx}" y="${cy + Math.round(width * 0.022)}" text-anchor="middle" fill="#ffffff" font-family="${font}" font-size="${Math.round(width * 0.036)}" font-weight="800" letter-spacing="1">VS</text>` +
    '</svg>';

  const flags: string[] = [];
  if (!left.body) flags.push('missing_headline');
  if (!right.body) flags.push('missing_support');
  const quality: OverlayQualityReport = {
    score: left.body && right.body ? 1 : left.body || right.body ? 0.5 : 0,
    flags,
    text_units: left.body.length + right.body.length,
    preset: 'two_column_card',
    text_fit: mergeTextFit([
      { field: 'headline', fits: left.body ? leftFit.fits : true },
      { field: 'supportingText', fits: right.body ? rightFit.fits : true },
    ]),
  };
  return { svg, quality, brandPlacement: defaultBrandPlacement({ width, height, fileNamePrefix: input.fileNamePrefix }) };
}

/**
 * List / checklist image composition (opt-in via renderingContract.imageComposition='list').
 * A title (overlay.headline) over a checklist of items — each a green check badge + one line.
 * Items come from the RAW overlay supportingText (newline-separated), read before the overlay
 * normaliser collapses whitespace, so the checklist keeps its distinct rows. Gives Checklist
 * templates the itemised layout their intent needs.
 */
export function buildListCardSvg(input: {
  width: number;
  height: number;
  title: string;
  itemsRaw: string;
  brandKit: CreatorBrandKit;
  fileNamePrefix: string;
}): { svg: string; quality: OverlayQualityReport; brandPlacement: { top: number; left: number; maxWidth: number; maxHeight: number } } {
  const { width, height, brandKit } = input;
  const font = brandKit.typography?.fontFamily || 'Inter, Arial, sans-serif';
  const accent = Array.isArray(brandKit.palette) && brandKit.palette.length ? brandKit.palette[0] : '#22c55e';

  // Grapheme-safe single-line clip for checklist items (emoji never severed).
  const fit = (s: string, chars: number): string => (graphemeLength(s) <= chars ? s : `${graphemeSlice(s, 0, Math.max(0, chars - 1)).trimEnd()}…`);
  const title = compactText(input.title || '').trim();
  const items = String(input.itemsRaw || '')
    .split(/\r?\n/)
    .map((s) => compactText(s).replace(/^[-*•✓\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 6);

  const marginX = Math.round(width * 0.1);
  const titleBaseSize = Math.round(width * 0.058);
  const titleFit = title
    ? fitTextToBox({ text: title, baseFontSize: titleBaseSize, baseCharsPerLine: Math.max(10, charsPerLineForWidth(width - marginX * 2, titleBaseSize, 0.55)), maxLines: 2 })
    : { fontSize: titleBaseSize, charsPerLine: 1, fits: true, lines: 0 };
  const titleSize = titleFit.fontSize;
  const itemSize = Math.round(width * 0.042);
  const rowH = Math.round(height * 0.104);
  const checkR = Math.round(itemSize * 0.62);
  const titleLines = title ? balanceTextLines(title, titleFit.charsPerLine, 2) : [];
  const titleBlockH = titleLines.length * Math.round(titleSize * 1.15);
  const listH = items.length * rowH;
  const totalH = titleBlockH + Math.round(height * 0.05) + listH;
  const titleY = Math.round((height - totalH) / 2) + titleSize;
  const listTop = titleY + (titleLines.length - 1) * Math.round(titleSize * 1.15) + Math.round(height * 0.09);

  const titleSvg = titleLines.map((line, i) =>
    `<text x="${marginX}" y="${titleY + i * Math.round(titleSize * 1.15)}" fill="#ffffff" filter="url(#listShadow)" font-family="${font}" font-size="${titleSize}" font-weight="800">${escapeXml(line)}</text>`,
  ).join('');

  const textX = marginX + checkR * 2 + Math.round(width * 0.025);
  const itemChars = Math.max(10, Math.floor((width - textX - marginX) / (itemSize * 0.54)));
  const itemsSvg = items.map((it, i) => {
    const rowY = listTop + i * rowH;
    const badgeCy = rowY - Math.round(itemSize * 0.32);
    return (
      `<circle cx="${marginX + checkR}" cy="${badgeCy}" r="${checkR}" fill="${accent}"/>` +
      `<text x="${marginX + checkR}" y="${badgeCy + Math.round(checkR * 0.55)}" text-anchor="middle" fill="#ffffff" font-family="${font}" font-size="${Math.round(checkR * 1.4)}" font-weight="900">&#10003;</text>` +
      `<text x="${textX}" y="${rowY}" fill="#ffffff" filter="url(#listShadow)" font-family="${font}" font-size="${itemSize}" font-weight="500">${escapeXml(fit(it, itemChars))}</text>`
    );
  }).join('');

  const svg =
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    '<defs>' +
    '<linearGradient id="listScrim" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#0b1220" stop-opacity="0.64"/>' +
    '<stop offset="1" stop-color="#0b1220" stop-opacity="0.66"/>' +
    '</linearGradient>' +
    '<filter id="listShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#000000" flood-opacity="0.45"/></filter>' +
    '</defs>' +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#listScrim)"/>` +
    `<rect x="${marginX}" y="${titleY - Math.round(titleSize * 1.15)}" width="${Math.round(width * 0.12)}" height="6" rx="3" fill="${accent}"/>` +
    titleSvg + itemsSvg +
    '</svg>';

  const flags: string[] = [];
  if (!title) flags.push('missing_headline');
  if (items.length === 0) flags.push('missing_items');
  // A checklist item longer than the single-line budget is clipped with an
  // ellipsis (grapheme-safe) — record it as an overflow rather than pretend it fit.
  const itemsOverflow = items.some((it) => graphemeLength(it) > itemChars);
  const quality: OverlayQualityReport = {
    score: title && items.length ? 1 : title || items.length ? 0.5 : 0,
    flags,
    text_units: title.length + items.join(' ').length,
    preset: 'list_card',
    text_fit: mergeTextFit([
      { field: 'headline', fits: title ? titleFit.fits : true },
      { field: 'items', fits: !itemsOverflow },
    ]),
  };
  return { svg, quality, brandPlacement: defaultBrandPlacement({ width, height, fileNamePrefix: input.fileNamePrefix }) };
}

/**
 * Aesthetic-style image composition (Corporate / Luxury / Bold / Editorial / Modern Tech /
 * Creative / Minimal). These templates are style ALIASES of one base — they used to render
 * near-identically because colours are brand-owned and platform presets flattened the base
 * typography. This gives each aesthetic a distinct LAYOUT (alignment, serif vs sans, type
 * scale/weight, and a decoration treatment) WITHIN the brand's colours, so the style choice
 * actually shows. Text is overlay.headline (+ optional supportingText, cta).
 */
type StyleCardSpec = {
  align: 'center' | 'left';
  serif: boolean;
  scale: number;
  weight: number;
  upper: boolean;
  tracking: number;
  deco: 'rule-above' | 'rule-below' | 'left-bar' | 'underline' | 'block-under' | 'none';
};
export const STYLE_CARD_SPECS: Readonly<Record<string, StyleCardSpec>> = {
  luxury:       { align: 'center', serif: true,  scale: 0.070, weight: 600, upper: false, tracking: 1.5, deco: 'rule-above' },
  premium:      { align: 'center', serif: true,  scale: 0.070, weight: 600, upper: false, tracking: 1.5, deco: 'rule-above' },
  elegant:      { align: 'center', serif: true,  scale: 0.070, weight: 600, upper: false, tracking: 1.2, deco: 'rule-above' },
  editorial:    { align: 'left',   serif: true,  scale: 0.074, weight: 700, upper: false, tracking: 0,   deco: 'rule-below' },
  corporate:    { align: 'left',   serif: false, scale: 0.068, weight: 700, upper: false, tracking: 0,   deco: 'left-bar' },
  technology:   { align: 'left',   serif: false, scale: 0.072, weight: 800, upper: false, tracking: 0,   deco: 'left-bar' },
  illustration: { align: 'center', serif: false, scale: 0.082, weight: 800, upper: false, tracking: 0,   deco: 'underline' },
  bold:         { align: 'center', serif: false, scale: 0.098, weight: 900, upper: true,  tracking: 1,   deco: 'block-under' },
  vibrant:      { align: 'center', serif: false, scale: 0.094, weight: 900, upper: true,  tracking: 1,   deco: 'block-under' },
  minimal:      { align: 'center', serif: false, scale: 0.060, weight: 700, upper: false, tracking: 0.5, deco: 'none' },
};

