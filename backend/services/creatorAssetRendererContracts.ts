/** Part 1/10 of creatorAssetRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
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
import { STYLE_CARD_SPECS } from './creatorAssetRendererText';
import { buildOverlaySvg } from './creatorAssetRendererOverlay';
import { type ImageSubtypeHint } from './creatorAssetRendererMedia';

export const sharp = require('sharp') as typeof import('sharp');
// Loaded only in the server renderer for deterministic downloadable PDF assets.
export const PDFDocument = require('pdfkit');

export type RenderedMediaBundle = {
  url?: string;
  files?: string[];
  metadata?: Record<string, unknown>;
  /** CREATOR-110: the raw PNG buffer, returned in previewBufferOnly mode so the Sample
   *  Gallery preview is produced by the SAME production renderer (no storage upload). */
  buffer?: Buffer;
};

export type CreatorReviewPreviewInput = {
  assetType: 'image' | 'banner' | 'infographic';
  platform: string;
  overlayText: Record<string, string>;
  title: string;
  body: string;
  colors?: string[];
  brand?: {
    companyName?: string;
    tagline?: string;
    logoUrl?: string;
    faviconUrl?: string;
  };
  // CREATOR-094: existing GenerationDNA fields, consumed to make each sample's
  // preview visually distinct (deterministic layout seed; no randomness).
  designDna?: {
    composition?: string; hierarchy?: string; typography?: string; spacing?: string;
    photography?: string; illustration?: string; renderingStyle?: string;
    shapeLanguage?: string; camera?: string; lighting?: string;
  };
};

export type ProviderImageResult =
  | { image: { buffer: Buffer; model: string }; fallbackReason?: never }
  | { image: null; fallbackReason: string };

export type RenderOptions = {
  campaignId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  /** CREATOR-110: skip the Storage upload + return the raw PNG buffer instead. Used by
   *  the Sample Gallery preview population so the preview is a REAL output of this
   *  production renderer — one renderer for preview + customer generation. */
  previewBufferOnly?: boolean;
};

export type OverlayQualityReport = {
  score: number;
  flags: string[];
  text_units: number;
  preset: string;
};

type OverlayLayoutPreset = {
  name: string;
  panelWidthRatio: number;
  panelOpacity: number;
  margin: number;
  hookSize: number;
  headlineSize: number;
  insightSize: number;
  supportSize: number;
  ctaSize: number;
  maxHeadlineLines: number;
  maxInsightLines: number;
  maxSupportLines: number;
  headlineChars: number;
  insightChars: number;
  supportChars: number;
  ctaProminence: 'subtle' | 'standard' | 'strong';
  footerMode: 'hidden' | 'subtle' | 'standard';
  brandMode: 'compact' | 'subtle' | 'standard';
};

export const IMAGE_BUCKET = 'media-images';
export const DOCUMENT_BUCKET = 'media-documents';
const FALLBACK_BASE = 'https://dummyimage.com';
export const AI_IMAGE_TIMEOUT_MS = 75_000;
export const AI_IMAGE_SIZE = '1024x1024';
export const bucketReadyByName: Record<string, Promise<void> | null> = {};
const renderBufferCache = new Map<string, { value: Promise<Buffer>; expiresAt: number }>();
const RENDER_BUFFER_CACHE_TTL_MS = 10 * 60 * 1000;
const RENDER_BUFFER_CACHE_MAX = 120;

export function getCachedRenderBuffer(key: string, factory: () => Promise<Buffer>): Promise<Buffer> {
  const now = Date.now();
  const cached = renderBufferCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) renderBufferCache.delete(key);
  if (renderBufferCache.size >= RENDER_BUFFER_CACHE_MAX) {
    const oldestKey = renderBufferCache.keys().next().value;
    if (oldestKey) renderBufferCache.delete(oldestKey);
  }
  const value = factory().catch((error) => {
    renderBufferCache.delete(key);
    throw error;
  });
  renderBufferCache.set(key, { value, expiresAt: now + RENDER_BUFFER_CACHE_TTL_MS });
  return value;
}

export function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (lines.length >= maxLines - 1) {
      // On the last allowed line, keep the remaining words ON this line so
      // balanceTextLines clips with an ellipsis — never silently drop the tail
      // (which made overflowing slides look abruptly "short of text").
      const rest = words.slice(i).join(' ');
      current = current ? `${current} ${rest}` : rest;
      break;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

export function balanceTextLines(value: string, maxChars: number, maxLines: number): string[] {
  const clean = compactText(value);
  if (!clean) return [];
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return [clean.slice(0, maxChars)];
  const lines = wrapText(clean, maxChars, maxLines);
  if (lines.length <= 1) return lines;

  const last = lines[lines.length - 1];
  const previous = lines[lines.length - 2];
  if (last.length < Math.max(10, previous.length * 0.42)) {
    const previousWords = previous.split(/\s+/);
    const moved = previousWords.pop();
    if (moved) {
      lines[lines.length - 2] = previousWords.join(' ');
      lines[lines.length - 1] = `${moved} ${last}`.trim();
    }
  }

  return lines.map((line, index) => {
    if (index < maxLines - 1 || line.length <= maxChars) return line;
    // Last-resort clip to fit — end on a COMPLETE word, never mid-word, and no
    // trailing ellipsis (which reads as "cut off"). Generation is now budgeted to
    // fit the composition, so this should rarely trigger.
    const cut = line.slice(0, maxChars).trimEnd();
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > maxChars * 0.5 ? cut.slice(0, lastSpace).trimEnd() : cut) || line;
  });
}

/**
 * Infographic P0 — render body text as NATIVE SVG <text> (word-wrapped), not
 * <foreignObject>. librsvg/resvg (via sharp) does not render foreignObject HTML
 * reliably, so per-section bodies came out blank in the PNG. This helper mirrors
 * the proven concept-card / header pattern: wrap with balanceTextLines, escape
 * with escapeXml, emit one <text> per line. Height-derived line cap prevents
 * overflow (native text does not auto-clip like a foreignObject <div>).
 *
 * Geometry/typography are caller-supplied so each engine preserves its exact
 * zone, font size, weight, and color. `align:'center'` emits text-anchor=middle
 * (caller passes the center x); default is left-aligned at x.
 */
export function renderWrappedBodyText(opts: {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontPx: number;
  color: string;
  weight?: string;
  lineHeightMul?: number;
  align?: 'left' | 'center';
  maxLines?: number;
  fontFamily?: string;
}): string {
  const text = compactText(opts.text || '');
  if (!text) return '';
  const weight = opts.weight ?? '500';
  const lineH = Math.round(opts.fontPx * (opts.lineHeightMul ?? 1.45));
  const zoneMaxLines = Math.max(1, Math.floor(opts.height / lineH));
  const maxLines = Math.max(1, Math.min(opts.maxLines ?? zoneMaxLines, zoneMaxLines));
  const charsPerLine = Math.max(8, Math.floor(opts.width / (opts.fontPx * 0.58)));
  const lines = balanceTextLines(text, charsPerLine, maxLines);
  if (lines.length === 0) return '';
  const anchor = opts.align === 'center' ? ' text-anchor="middle"' : '';
  const startY = opts.y + opts.fontPx;
  return lines
    .map((line, i) => `<text x="${opts.x}" y="${startY + i * lineH}"${anchor} font-size="${opts.fontPx}" font-family="${opts.fontFamily ?? 'Inter, Arial, sans-serif'}" font-weight="${weight}" fill="${opts.color}">${escapeXml(line)}</text>`)
    .join('');
}

export function createFallbackUrl(label: string, width: number, height: number): string {
  const text = encodeURIComponent(label.trim() || 'Creator Asset');
  return `${FALLBACK_BASE}/${width}x${height}/111827/ffffff.png?text=${text}`;
}

// ── Canonical Template visual-language seam (TEMPLATE-003) ────────────
// The renderer reads its deterministic visual constants from the resolved
// family style. Everything flows through the ONE canonical resolveTemplate()
// — no second resolver. When no template_id is present (or it is unknown) the
// resolver returns the canonical DEFAULT style, whose values are byte-for-byte
// the prior hardcoded constants, so existing campaigns render identically.

/** template_id carried on render metadata (top-level or projected onto creator_card). */
function templateIdForRender(metadata: Record<string, unknown>): string | null {
  const card = safeObject(metadata.creator_card);
  const raw = metadata.template_id ?? metadata.infographic_template_id ?? card.template_id;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}
/** blueprint_id (the chosen Marketing Sample) carried on render metadata. */
export function blueprintIdForRender(metadata: Record<string, unknown>): string | null {
  const card = safeObject(metadata.creator_card);
  const raw = metadata.blueprint_id ?? card.blueprint_id;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}
/**
 * CREATOR-127 — a REGISTERED curated SYSTEM template carrying its own design
 * intelligence (composition + semantic structure, materialized from the blueprint).
 * When a `template_id` resolves to one, the renderer reads layout / composition /
 * semantic / style straight from the TEMPLATE — no blueprint lookup. Returns null
 * otherwise, so the caller falls back to the existing blueprint path unchanged.
 * Registration is lazy + idempotent and only triggers when a `template_id` is present,
 * so current blueprint-only traffic is completely unaffected (no curated id in flight).
 */
export function curatedDesignTemplate(metadata: Record<string, unknown>): CreatorTemplate | null {
  const tid = templateIdForRender(metadata);
  if (!tid) return null;
  registerCuratedSystemTemplates();
  const t = resolveTemplate(tid, { family: 'infographic' }).template;
  return t && t.composition && Array.isArray(t.semanticStructure) && t.semanticStructure.length > 0 ? t : null;
}

export function resolveInfographicRenderStyle(metadata: Record<string, unknown>): InfographicStyleSchema {
  // A system template_id (e.g. sys-infographic-statistics) wins — explicit choice.
  const tid = templateIdForRender(metadata);
  if (tid) return resolveTemplate(tid, { family: 'infographic' }).infographicStyle as InfographicStyleSchema;
  // CREATOR-106: otherwise align the infographic with the chosen Marketing Sample's
  // style — `technology` → technical, `finance` → financial, `editorial` → editorial,
  // etc. — so picking a sample visibly changes the infographic, not just the default.
  const bp = blueprintIdForRender(metadata);
  if (bp) return infographicStyleForBlueprint(bp);
  return resolveTemplate(null, { family: 'infographic' }).infographicStyle as InfographicStyleSchema;
}
export function resolveImageRenderStyle(metadata: Record<string, unknown>): ImageStyleSchema {
  return resolveTemplate(templateIdForRender(metadata), { family: 'image' }).imageStyle as ImageStyleSchema;
}
/**
 * Blueprint id → image composition. Both the goal-named BLUEPRINT templates
 * (sys-image-before-after) and their CURATED style variants (sys-curated-before-after-image)
 * derive from the same blueprint, so map the composition by blueprint id — the curated variant
 * doesn't carry the renderingContract.imageComposition the blueprint template def sets.
 */
const BLUEPRINT_IMAGE_COMPOSITION: Readonly<Record<string, string>> = {
  'before-after': 'split',
  'myth-fact': 'split',
  comparison: 'two-column',
  checklist: 'list',
  statistic: 'stat',
  quote: 'quote',
  testimonial: 'quote',
};

/**
 * Per-template IMAGE composition (additive). Resolves the composition from (1) the template's
 * explicit renderingContract.imageComposition, then (2) the blueprint id — via the curated
 * template id (sys-curated-<blueprint>-image) or metadata.blueprint_id — so curated style
 * variants get the same composition as their blueprint. Null → the default stacked overlay.
 */
export function resolveImageComposition(metadata: Record<string, unknown>): string | null {
  const tid = templateIdForRender(metadata);
  if (tid) {
    const explicit = resolveTemplate(tid, { family: 'image' }).template?.renderingContract?.imageComposition;
    if (explicit) return explicit;
    const curated = /^sys-curated-(.+)-image$/.exec(tid);
    if (curated && BLUEPRINT_IMAGE_COMPOSITION[curated[1]]) return BLUEPRINT_IMAGE_COMPOSITION[curated[1]];
  }
  const bp = blueprintIdForRender(metadata);
  if (bp && BLUEPRINT_IMAGE_COMPOSITION[bp]) return BLUEPRINT_IMAGE_COMPOSITION[bp];
  return null;
}
/**
 * Aesthetic style id for an image template (Corporate / Luxury / Bold / …). Only the style
 * aliases and the minimal base map to a dedicated style card; all other image templates
 * return null → the default overlay, unchanged.
 */
export function resolveImageStyleId(metadata: Record<string, unknown>): string | null {
  const tid = templateIdForRender(metadata);
  if (!tid) return null;
  const res = resolveTemplateStyle(tid);
  return STYLE_CARD_SPECS[res.styleId] && (res.isAlias || res.styleId === 'minimal') ? res.styleId : null;
}
export function resolveCarouselRenderStyle(metadata: Record<string, unknown>): CarouselStyleSchema {
  return resolveTemplate(templateIdForRender(metadata), { family: 'carousel' }).carouselStyle as CarouselStyleSchema;
}
/**
 * Per-template carousel slide arc (fidelity). Each carousel template carries its OWN
 * narrative in preview.sample.slides (e.g. Before/After → before, pain, shift, after,
 * how_to_start; Mistakes → intro, mistake_1…, fix_it). Slugify those into distinct role
 * keys so the deck renders the TEMPLATE's arc — not the shared 3 purpose arcs, which flattened
 * all 20 templates into 3 behaviours. Returns null for non-carousel templates or those without
 * a sample arc, so the purpose arc / generic fallback is used unchanged.
 */
export function resolveCarouselTemplateArc(metadata: Record<string, unknown>): string[] | null {
  const tid = templateIdForRender(metadata);
  if (!tid) return null;
  const t = resolveTemplate(tid, { family: 'carousel' }).template;
  if (!t || t.assetFamily !== 'carousel') return null;
  const slides = (t.preview as { sample?: { slides?: unknown } } | undefined)?.sample?.slides;
  if (!Array.isArray(slides) || slides.length === 0) return null;
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const s of slides) {
    let key = String(s || '')
      .toLowerCase()
      .replace(/^(the|a|an)\s+/, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || `slide_${roles.length + 1}`;
    if (seen.has(key)) key = `${key}_${roles.length + 1}`;
    seen.add(key);
    roles.push(key);
  }
  return roles.length > 0 ? roles : null;
}
/**
 * Project the carousel visual language onto the overlay base preset the slide
 * composer consumes (`getOverlayPreset`'s `style`). The deck shares the image
 * overlay system, so we keep the image platform-preset matrix / CTA / footer /
 * background from the canonical default and override only the carousel-owned
 * base fields (typography, panel, safe margin, brand mode). For the DEFAULT
 * carousel style these equal DEFAULT_IMAGE_STYLE's, so the deck stays
 * byte-identical; a non-default variant's `panel.opacity` surfaces because the
 * default platform presets (e.g. linkedin) don't override it.
 */
export function carouselOverlayBaseStyle(cs: CarouselStyleSchema): ImageStyleSchema {
  return {
    ...DEFAULT_IMAGE_STYLE,
    safe_margins: cs.safe_margins,
    typography: cs.typography,
    panel: cs.panel,
    // Deck slides read `branding.defaultMode` (fileNamePrefix !== 'image').
    branding: { imageMode: DEFAULT_IMAGE_STYLE.branding.imageMode, defaultMode: cs.branding.mode },
  };
}

function buildSvg(input: {
  width: number;
  height: number;
  eyebrow?: string;
  title: string;
  body: string;
}): string {
  const titleLines = wrapText(input.title, 24, 3);
  const bodyLines = wrapText(input.body, 38, 6);
  const titleY = input.eyebrow ? 214 : 180;
  const bodyY = titleY + titleLines.length * 78 + 30;
  const accentY = Math.min(input.height - 190, bodyY + bodyLines.length * 48 + 70);

  return `
    <svg width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="creator-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#111827" />
          <stop offset="48%" stop-color="#2347A8" />
          <stop offset="100%" stop-color="#0E9F9B" />
        </linearGradient>
      </defs>
      <rect width="${input.width}" height="${input.height}" rx="36" fill="url(#creator-bg)" />
      <circle cx="${input.width - 138}" cy="116" r="88" fill="rgba(255,255,255,0.13)" />
      <circle cx="120" cy="${input.height - 110}" r="58" fill="rgba(255,255,255,0.09)" />
      <path d="M80 ${input.height - 250} C250 ${input.height - 390}, 360 ${input.height - 150}, 520 ${input.height - 280} S850 ${input.height - 170}, ${input.width - 82} ${input.height - 330}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="8" stroke-linecap="round"/>
      <rect x="72" y="72" width="${input.width - 144}" height="${input.height - 144}" rx="28" fill="rgba(15,23,42,0.22)" stroke="rgba(255,255,255,0.16)" />
      ${input.eyebrow ? `<text x="110" y="148" fill="#bfdbfe" font-size="28" font-family="Inter, Arial, sans-serif" font-weight="700" letter-spacing="2">${escapeXml(input.eyebrow.toUpperCase())}</text>` : ''}
      ${titleLines.map((line, index) => `<text x="110" y="${titleY + (index * 78)}" fill="#ffffff" font-size="64" font-family="Inter, Arial, sans-serif" font-weight="800">${escapeXml(line)}</text>`).join('')}
      ${bodyLines.map((line, index) => `<text x="110" y="${bodyY + (index * 48)}" fill="#e2e8f0" font-size="34" font-family="Inter, Arial, sans-serif" font-weight="500">${escapeXml(line)}</text>`).join('')}
      <rect x="110" y="${accentY}" width="230" height="12" rx="6" fill="#f8fafc" opacity="0.9" />
      <rect x="360" y="${accentY}" width="92" height="12" rx="6" fill="#67e8f9" opacity="0.85" />
    </svg>
  `.trim();
}

async function renderPng(input: {
  title: string;
  body: string;
  eyebrow?: string;
  width?: number;
  height?: number;
}): Promise<Buffer> {
  const width = input.width ?? 1200;
  const height = input.height ?? 1200;
  const svg = buildSvg({
    width,
    height,
    eyebrow: input.eyebrow,
    title: input.title || 'Creator Asset',
    body: input.body || 'Generated by Omnivyra Creator',
  });

  return sharp(Buffer.from(svg))
    .png()
    .toBuffer();
}

export async function renderBackgroundPng(input: {
  width?: number;
  height?: number;
  colors?: string[];
  variantId?: string;
  /** Carousel visual language frame radius. 0 (default) → square full-bleed
   *  background (byte-identical); >0 rounds the slide corners. */
  frameRadius?: number;
}): Promise<Buffer> {
  const width = input.width ?? 1200;
  const height = input.height ?? 1200;
  const frameRadius = Math.max(0, Math.round(input.frameRadius ?? 0));
  const frameRx = frameRadius > 0 ? ` rx="${frameRadius}"` : '';
  const colors = input.colors?.filter((color) => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 3) || [];
  const variant = parseInt(createHash('sha1').update(input.variantId || 'creator-default').digest('hex').slice(0, 4), 16);
  // Background DYNAMISM: stay on-brand (same palette) but vary the gradient
  // arrangement + direction per asset so consecutive generations don't all
  // read as the identical blue template. Operator feedback: "the background
  // image should keep changing to showcase the platform's flexibility."
  const base = [colors[0] || '#111827', colors[1] || '#2563eb', colors[2] || '#14b8a6'];
  const rot = variant % 3;
  const primary = base[rot % 3];
  const secondary = base[(rot + 1) % 3];
  const accent = base[(rot + 2) % 3];
  // Rotate the gradient direction through a small set of angles.
  const DIRS = [
    { x1: '0%', y1: '0%', x2: '100%', y2: '100%' }, // diagonal ↘
    { x1: '0%', y1: '0%', x2: '0%', y2: '100%' },   // vertical ↓
    { x1: '100%', y1: '0%', x2: '0%', y2: '100%' }, // diagonal ↙
    { x1: '0%', y1: '0%', x2: '100%', y2: '0%' },   // horizontal →
  ];
  const dir = DIRS[variant % DIRS.length];
  const midStop = 46 + (variant % 22); // 46–67%
  const topCircleX = width - 130 - (variant % 90);
  const topCircleY = 110 + (variant % 70);
  const bottomCircleX = 110 + (variant % 80);
  const bottomCircleY = height - 150 - (variant % 90);
  const curveLift = 260 + (variant % 90);
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="${dir.x1}" y1="${dir.y1}" x2="${dir.x2}" y2="${dir.y2}">
          <stop offset="0%" stop-color="${primary}" />
          <stop offset="${midStop}%" stop-color="${secondary}" />
          <stop offset="100%" stop-color="${accent}" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}"${frameRx} fill="url(#bg)" />
      <circle cx="${topCircleX}" cy="${topCircleY}" r="${120 + (variant % 38)}" fill="rgba(255,255,255,0.13)" />
      <circle cx="${bottomCircleX}" cy="${bottomCircleY}" r="${92 + (variant % 30)}" fill="rgba(255,255,255,0.1)" />
      <path d="M80 ${height - 300} C260 ${height - curveLift}, 410 ${height - 210}, 590 ${height - 360} S900 ${height - 230}, ${width - 82} ${height - 390}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="12" stroke-linecap="round"/>
    </svg>
  `.trim();
  const cacheKey = `background:${width}x${height}:${colors.join(',')}:${input.variantId || 'creator-default'}:r${frameRadius}`;
  return getCachedRenderBuffer(cacheKey, () => sharp(Buffer.from(svg)).png().toBuffer());
}

/**
 * Classify a PDF storage-upload error into one of four buckets so the
 * Writer-side UI can show a precise message instead of a raw error.
 *
 * Detection is by substring on the message text emitted by Supabase
 * Storage / the storage adapter. The buckets are stable; the messages
 * are user-facing copy in {@link USER_MESSAGE_FOR_PDF_FALLBACK}.
 */
export function classifyPdfStorageFailure(rawMessage: string): 'storage_mime_blocked' | 'storage_permission' | 'storage_unavailable' | 'unknown_storage_error' {
  const msg = rawMessage.toLowerCase();
  if (msg.includes('mime type') || msg.includes('allowed_mime_types') || msg.includes('not allowed') && msg.includes('mime')) {
    return 'storage_mime_blocked';
  }
  if (msg.includes('permission') || msg.includes('forbidden') || msg.includes('unauthorized') || msg.includes('rls') || msg.includes('not allowed')) {
    return 'storage_permission';
  }
  if (msg.includes('timeout') || msg.includes('network') || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('econnrefused') || /^5\d\d /.test(msg) || msg.includes('unavailable')) {
    return 'storage_unavailable';
  }
  return 'unknown_storage_error';
}

export const USER_MESSAGE_FOR_PDF_FALLBACK: Readonly<Record<'storage_mime_blocked' | 'storage_permission' | 'storage_unavailable' | 'unknown_storage_error', string>> = {
  storage_mime_blocked:  'Preview available. Downloadable PDF unavailable — your storage configuration does not allow PDF uploads. Contact your admin or use the page previews.',
  storage_permission:    'Preview available. Downloadable PDF unavailable — storage permissions blocked the upload. Contact your admin.',
  storage_unavailable:   'Preview available. Downloadable PDF temporarily unavailable — try again in a moment.',
  unknown_storage_error: 'Preview available. Downloadable PDF unavailable — an unexpected storage error occurred.',
};

export function compactText(value: unknown, fallback = ''): string {
  return String(value ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a descriptive, screen-reader alt text that always satisfies the
 * accessibility gate's 12-char minimum (`validateCreatorAccessibility`). Alt
 * text is metadata only (aria-label / manifest) — never rendered into pixels —
 * so enriching a short subject (e.g. a 5-char topic like "Image") is safe and
 * accessibility-correct. Prevents `render_manifest_rejected:alt_text_missing_or_too_short`
 * on writer-governed renders with short topics/headlines.
 */
export function buildAccessibleAltText(primary: unknown, opts?: { supporting?: unknown; kind?: string; platform?: unknown }): string {
  const subject = compactText(primary) || 'Branded creative';
  const supporting = compactText(opts?.supporting);
  let alt = supporting && supporting !== subject ? `${subject} — ${supporting}` : subject;
  if (alt.length < 12) {
    const kind = compactText(opts?.kind).replace(/_/g, ' ') || 'promotional';
    const platform = compactText(opts?.platform);
    alt = compactText(`${subject} — ${kind} visual${platform ? ` for ${platform}` : ''}`);
  }
  if (alt.length < 12) alt = compactText(`${alt} social media visual`);
  return alt;
}

export function normalizeOverlayText(input: {
  assetPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  title: string;
  body: string;
}): Record<string, string> {
  const direct = safeObject(input.assetPayload.overlay_text);
  const metadataOverlay = safeObject(input.metadata.overlay_text);
  const overlay = Object.keys(direct).length > 0 ? direct : metadataOverlay;
  // Template "Text Inside Image" — when the overlay is template-authoritative,
  // the user's template fields are the ONLY source of on-image text. Suppress
  // the topic/title/"Learn more" fallbacks so we never inject text the template
  // didn't declare, and empty optional fields collapse gracefully (the SVG
  // composer skips blank blocks). Strictly opt-in via the marker the creator
  // page sets on overlay_text — every existing flow (no marker) is unchanged.
  const authoritative = direct.__template_authoritative === true || metadataOverlay.__template_authoritative === true;
  const cta = authoritative
    ? compactText(overlay.cta || '').replace(/\b(click here|submit|read now)\b/gi, 'Learn more').slice(0, 42)
    : compactText(overlay.cta || input.metadata.cta || 'Learn more').replace(/\b(click here|submit|read now)\b/gi, 'Learn more').slice(0, 42);
  return {
    hook: compactText(authoritative ? overlay.hook : (overlay.hook || input.metadata.topic || input.title)).slice(0, 76),
    // Text-inside must NEVER render blank. When the template/answer fields carry
    // no headline (e.g. the workspace brief flow supplies a free-text brief, not a
    // per-field headline, and the curated template has no default field values),
    // fall back to the generated master title even under template-authoritative
    // mode. `input.title` is real generated copy (descriptor.headline / caption
    // hook), NOT the template placeholder the authoritative flag guards against —
    // so this restores on-image text without re-introducing garbled examples.
    headline: compactText(overlay.headline || input.title).slice(0, 84),
    keyInsight: compactText(overlay.keyInsight || overlay.key_insight || '').slice(0, 190),
    cta,
    supportingText: compactText(overlay.supportingText || overlay.supporting_text || '').slice(0, 96),
  };
}

function parseBrandColors(input: {
  assetPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): string[] {
  return resolveCreatorBrandKit({
    assetPayload: input.assetPayload,
    metadata: input.metadata,
    platform: compactText(input.metadata.platform || input.metadata.primary_platform),
    assetType: compactText(input.metadata.content_type),
  }).normalizedPalette;
}

function resolveBrandAssets(metadata: Record<string, unknown>): {
  logoUrl?: string;
  faviconUrl?: string;
  tagline?: string;
  companyName?: string;
} {
  const brandKit = resolveCreatorBrandKit({ metadata });
  const brandContext = safeObject(metadata.brand_context);
  const selected = safeObject(metadata.selected_brand_assets);
  const overrides = safeObject(brandContext.overrides);
  const profile = safeObject(brandContext.profile);
  return {
    logoUrl: brandKit.logoUrl,
    faviconUrl: brandKit.faviconUrl,
    tagline: compactText(selected.tagline || overrides.tagline || profile.tagline),
    companyName: brandKit.companyName,
  };
}

export function resolveRenderSize(
  platform: string,
  fileNamePrefix: string,
  imageStyle: ImageStyleSchema = DEFAULT_IMAGE_STYLE,
): { width: number; height: number } {
  // Canvas is now sourced from the canonical style schemas (single source of
  // truth) instead of inline literals. banner + per-platform image-feed sizes
  // live in imageStyle.canvas; the infographic canvas in infographicStyle.
  const key = String(platform || '').toLowerCase();
  if (fileNamePrefix === 'banner') return { ...imageStyle.canvas.banner };
  if (fileNamePrefix === 'infographic') return { ...DEFAULT_INFOGRAPHIC_STYLE.canvas };
  return { ...(imageStyle.canvas.byPlatform[key] ?? imageStyle.canvas.default) };
}

export function getOverlayPreset(
  platform: string,
  fileNamePrefix: string,
  overlay: Record<string, string>,
  subtypeHint?: ImageSubtypeHint | null,
  // Canonical Template visual language for the image/carousel overlay base.
  // Default == prior literals → byte-identical for callers that don't pass one.
  style: ImageStyleSchema = DEFAULT_IMAGE_STYLE,
): OverlayLayoutPreset {
  const key = String(platform || '').toLowerCase();
  const textUnits = [overlay.hook, overlay.headline, overlay.keyInsight, overlay.supportingText, overlay.cta]
    .join(' ')
    .length;
  const subtypeDensity = subtypeHint?.densityHint;
  // Subtype's density hint takes precedence over textUnits-derived density.
  // quote-image → always minimal; promotional/educational → balanced unless
  // the actual text content forces dense. Density-derived presets are still
  // overridden by per-platform branches below, but the base now reflects
  // subtype intent.
  const dense = subtypeDensity === 'dense'
    ? true
    : subtypeDensity === 'minimal'
      ? false
      : textUnits > 255;
  const minimal = subtypeDensity === 'minimal';
  const t = style.typography;
  const base: OverlayLayoutPreset = {
    name: dense ? 'balanced-dense' : 'balanced',
    panelWidthRatio: dense ? style.panel.widthRatio.dense : style.panel.widthRatio.normal,
    panelOpacity: style.panel.opacity,
    margin: style.safe_margins.base,
    hookSize: t.hookSize,
    headlineSize: dense ? t.headlineSize.dense : t.headlineSize.normal,
    insightSize: dense ? t.insightSize.dense : t.insightSize.normal,
    supportSize: t.supportSize,
    ctaSize: t.ctaSize,
    maxHeadlineLines: dense ? t.maxHeadlineLines.dense : t.maxHeadlineLines.normal,
    maxInsightLines: dense ? t.maxInsightLines.dense : t.maxInsightLines.normal,
    maxSupportLines: t.maxSupportLines,
    headlineChars: dense ? t.headlineChars.dense : t.headlineChars.normal,
    insightChars: dense ? t.insightChars.dense : t.insightChars.normal,
    supportChars: t.supportChars,
    ctaProminence: style.cta.prominence,
    footerMode: style.footer.mode,
    brandMode: fileNamePrefix === 'image' ? style.branding.imageMode : style.branding.defaultMode,
  };

  // Per-platform overrides are now externalized into the canonical
  // `style.platformPresets` table (single source of truth). Resolve the
  // matched platform's overrides on top of `base`; a matched platform
  // returns immediately (subtype overrides apply ONLY to default/unknown
  // platforms, preserving the prior control flow). 'twitter' shares 'x'.
  const pkey = key === 'twitter' ? 'x' : key;
  const wide = fileNamePrefix === 'image';
  const override = style.platformPresets[pkey];
  if (override) {
    const pick = <T,>(v: PresetVariant<T> | undefined, current: T): T => {
      if (v === undefined) return current;
      if (v && typeof v === 'object') {
        if ('dense' in v) return dense ? (v as { dense: T }).dense : (v as { normal: T }).normal;
        if ('wide' in v) return wide ? (v as { wide: T }).wide : (v as { narrow: T }).narrow;
      }
      return v as T;
    };
    // PRECEDENCE (TEMPLATE-015): runtime safety > platform geometry > template
    // visual language > default. Platform GEOMETRY (sizes, margins, panel width,
    // fit limits) stays platform-owned via `pick`. TEMPLATE VISUAL LANGUAGE
    // (panel opacity, CTA prominence, footer mode, brand mode) takes precedence
    // over the platform preset ONLY when the template asserts a non-default
    // identity; for the default style the platform value applies, preserving
    // byte-identical legacy output. `base.*` already holds the template value.
    const defaultBrandMode = fileNamePrefix === 'image' ? DEFAULT_IMAGE_STYLE.branding.imageMode : DEFAULT_IMAGE_STYLE.branding.defaultMode;
    const tplWins = <T,>(templateVal: T, defaultVal: T, platformVal: T): T => (templateVal !== defaultVal ? templateVal : platformVal);
    return {
      ...base,
      name: override.name,
      panelWidthRatio: pick(override.panelWidthRatio, base.panelWidthRatio),
      panelOpacity: tplWins(base.panelOpacity, DEFAULT_IMAGE_STYLE.panel.opacity, override.panelOpacity ?? base.panelOpacity),
      margin: override.margin ?? base.margin,
      hookSize: override.hookSize ?? base.hookSize,
      headlineSize: pick(override.headlineSize, base.headlineSize),
      insightSize: pick(override.insightSize, base.insightSize),
      supportSize: override.supportSize ?? base.supportSize,
      ctaSize: override.ctaSize ?? base.ctaSize,
      maxHeadlineLines: pick(override.maxHeadlineLines, base.maxHeadlineLines),
      maxInsightLines: pick(override.maxInsightLines, base.maxInsightLines),
      maxSupportLines: pick(override.maxSupportLines, base.maxSupportLines),
      headlineChars: pick(override.headlineChars, base.headlineChars),
      insightChars: pick(override.insightChars, base.insightChars),
      supportChars: override.supportChars ?? base.supportChars,
      ctaProminence: tplWins(base.ctaProminence, DEFAULT_IMAGE_STYLE.cta.prominence, pick(override.ctaProminence, base.ctaProminence)),
      footerMode: tplWins(base.footerMode, DEFAULT_IMAGE_STYLE.footer.mode, pick(override.footerMode, base.footerMode)),
      brandMode: tplWins(base.brandMode, defaultBrandMode, pick(override.brandMode, base.brandMode)),
    };
  }
  // No platform match (default/unknown). Layer subtype overrides on top:
  // these are deliberate visual differentiations the audit requested
  // ("subtype currently does not meaningfully affect rendering"). Quote
  // subtypes get a tighter panel + larger headline; promotional subtypes
  // get stronger CTA prominence; educational subtypes allow extra
  // insight lines.
  if (subtypeHint) {
    if (subtypeHint.subtypeId === 'quote-image' && minimal) {
      return {
        ...base,
        name: `${base.name}-quote`,
        panelWidthRatio: Math.min(base.panelWidthRatio, 0.6),
        headlineSize: Math.round(base.headlineSize * 1.12),
        maxHeadlineLines: 3,
        maxInsightLines: 0,
        maxSupportLines: 0,
        ctaProminence: 'subtle',
      };
    }
    if (subtypeHint.subtypeId === 'promotional-image') {
      return {
        ...base,
        name: `${base.name}-promotional`,
        ctaProminence: 'strong',
      };
    }
    if (subtypeHint.subtypeId === 'educational-image') {
      return {
        ...base,
        name: `${base.name}-educational`,
        maxInsightLines: Math.max(base.maxInsightLines, 3),
      };
    }
  }
  return base;
}

export function evaluateOverlayQuality(input: {
  overlay: Record<string, string>;
  preset: OverlayLayoutPreset;
  headlineLines: string[];
  insightLines: string[];
  supportLines: string[];
  layoutBottom: number;
  height: number;
  /** Carousel slides must carry a body; a blank body is a hard defect ("not worth
   *  presenting"). Single promo images may legitimately be headline-only. */
  expectBody?: boolean;
}): OverlayQualityReport {
  const textUnits = [input.overlay.hook, input.overlay.headline, input.overlay.keyInsight, input.overlay.supportingText, input.overlay.cta]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
  const flags: string[] = [];
  if (textUnits > 310) flags.push('overlay_text_dense');
  if (input.headlineLines.length >= input.preset.maxHeadlineLines && input.overlay.headline.length > input.preset.headlineChars * input.preset.maxHeadlineLines) {
    flags.push('headline_truncated_or_tight');
  }
  if (input.insightLines.length >= input.preset.maxInsightLines && input.overlay.keyInsight.length > input.preset.insightChars * input.preset.maxInsightLines) {
    flags.push('insight_truncated_or_tight');
  }
  if (!input.overlay.cta) flags.push('missing_cta');
  if (!input.overlay.headline) flags.push('missing_headline');
  // WATCHDOG: a carousel slide whose body rendered to zero lines is blank — the
  // defect where a slide ships with only a title and empty space. Hard failure.
  if (input.expectBody && input.insightLines.length === 0) flags.push('missing_insight');
  if (input.layoutBottom > input.height - 58) flags.push('severe_layout_overflow_risk');
  if (input.headlineLines.some((line) => line.length < 9) && input.headlineLines.length > 1) flags.push('awkward_headline_wrap');
  if (input.preset.headlineSize < 38) flags.push('headline_likely_unreadable_mobile');
  if (input.preset.name.includes('x') && textUnits > 210) flags.push('creative_likely_cluttered_for_x');
  if (/^(creator asset|generated creative asset|learn more)$/i.test(input.overlay.headline) || /^(learn more|read more)$/i.test(input.overlay.cta)) {
    flags.push('looks_too_generic');
  }
  if (textUnits > 280 || (input.headlineLines.length + input.insightLines.length + input.supportLines.length) > 6) {
    flags.push('too_much_overlay');
  }
  if (input.preset.panelOpacity > 0.5 || input.preset.panelWidthRatio > 0.8) flags.push('insufficient_focal_separation');
  if (input.headlineLines.length >= 3 && input.preset.headlineSize > 48) flags.push('headline_dominates_visual');
  const severe = flags.filter((flag) => flag.startsWith('severe_')).length;
  const score = Math.max(35, 100 - (flags.length * 10) - (severe * 12) - Math.max(0, textUnits - 230) / 8);
  return {
    score: Math.round(score),
    flags,
    text_units: textUnits,
    preset: input.preset.name,
  };
}

/**
 * Stat-card image composition (additive, opt-in via renderingContract.imageComposition='stat').
 * Renders a big centered figure (overlay.headline) over a legibility scrim, a one-line context
 * (overlay.supportingText), an accent rule, and an optional CTA — structurally distinct from the
 * default stacked headline/sub/cta overlay, so a "Statistic" template actually reads as a stat
 * card. Returns the same { svg, brandPlacement } shape buildOverlaySvg's consumers use.
 */
