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
const sharp = require('sharp') as typeof import('sharp');
// Loaded only in the server renderer for deterministic downloadable PDF assets.
const PDFDocument = require('pdfkit');

type RenderedMediaBundle = {
  url?: string;
  files?: string[];
  metadata?: Record<string, unknown>;
  /** CREATOR-110: the raw PNG buffer, returned in previewBufferOnly mode so the Sample
   *  Gallery preview is produced by the SAME production renderer (no storage upload). */
  buffer?: Buffer;
};

type CreatorReviewPreviewInput = {
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

type ProviderImageResult =
  | { image: { buffer: Buffer; model: string }; fallbackReason?: never }
  | { image: null; fallbackReason: string };

type RenderOptions = {
  campaignId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  /** CREATOR-110: skip the Storage upload + return the raw PNG buffer instead. Used by
   *  the Sample Gallery preview population so the preview is a REAL output of this
   *  production renderer — one renderer for preview + customer generation. */
  previewBufferOnly?: boolean;
};

type OverlayQualityReport = {
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

const IMAGE_BUCKET = 'media-images';
const DOCUMENT_BUCKET = 'media-documents';
const FALLBACK_BASE = 'https://dummyimage.com';
const AI_IMAGE_TIMEOUT_MS = 75_000;
const AI_IMAGE_SIZE = '1024x1024';
const bucketReadyByName: Record<string, Promise<void> | null> = {};
const renderBufferCache = new Map<string, { value: Promise<Buffer>; expiresAt: number }>();
const RENDER_BUFFER_CACHE_TTL_MS = 10 * 60 * 1000;
const RENDER_BUFFER_CACHE_MAX = 120;

function getCachedRenderBuffer(key: string, factory: () => Promise<Buffer>): Promise<Buffer> {
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

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function escapeXml(value: string): string {
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

function balanceTextLines(value: string, maxChars: number, maxLines: number): string[] {
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
    const clipped = line.slice(0, Math.max(0, maxChars - 1)).trimEnd();
    return clipped ? `${clipped}...` : line;
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
function renderWrappedBodyText(opts: {
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
    .map((line, i) => `<text x="${opts.x}" y="${startY + i * lineH}"${anchor} font-size="${opts.fontPx}" font-family="${opts.fontFamily ?? 'Inter, Arial'}" font-weight="${weight}" fill="${opts.color}">${escapeXml(line)}</text>`)
    .join('');
}

function createFallbackUrl(label: string, width: number, height: number): string {
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
function blueprintIdForRender(metadata: Record<string, unknown>): string | null {
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
function curatedDesignTemplate(metadata: Record<string, unknown>): CreatorTemplate | null {
  const tid = templateIdForRender(metadata);
  if (!tid) return null;
  registerCuratedSystemTemplates();
  const t = resolveTemplate(tid, { family: 'infographic' }).template;
  return t && t.composition && Array.isArray(t.semanticStructure) && t.semanticStructure.length > 0 ? t : null;
}

function resolveInfographicRenderStyle(metadata: Record<string, unknown>): InfographicStyleSchema {
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
function resolveImageRenderStyle(metadata: Record<string, unknown>): ImageStyleSchema {
  return resolveTemplate(templateIdForRender(metadata), { family: 'image' }).imageStyle as ImageStyleSchema;
}
/**
 * Per-template IMAGE composition (additive). Returns the template's opt-in
 * `renderingContract.imageComposition` (e.g. 'stat') when a system image template is in
 * flight, else null → the default stacked overlay path (byte-identical). Only image-family
 * templates can carry it, so carousel/infographic renders always resolve null.
 */
function resolveImageComposition(metadata: Record<string, unknown>): string | null {
  const tid = templateIdForRender(metadata);
  if (!tid) return null;
  return resolveTemplate(tid, { family: 'image' }).template?.renderingContract?.imageComposition ?? null;
}
function resolveCarouselRenderStyle(metadata: Record<string, unknown>): CarouselStyleSchema {
  return resolveTemplate(templateIdForRender(metadata), { family: 'carousel' }).carouselStyle as CarouselStyleSchema;
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
function carouselOverlayBaseStyle(cs: CarouselStyleSchema): ImageStyleSchema {
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
      ${input.eyebrow ? `<text x="110" y="148" fill="#bfdbfe" font-size="28" font-family="Arial, Helvetica, sans-serif" font-weight="700" letter-spacing="2">${escapeXml(input.eyebrow.toUpperCase())}</text>` : ''}
      ${titleLines.map((line, index) => `<text x="110" y="${titleY + (index * 78)}" fill="#ffffff" font-size="64" font-family="Arial, Helvetica, sans-serif" font-weight="800">${escapeXml(line)}</text>`).join('')}
      ${bodyLines.map((line, index) => `<text x="110" y="${bodyY + (index * 48)}" fill="#e2e8f0" font-size="34" font-family="Arial, Helvetica, sans-serif" font-weight="500">${escapeXml(line)}</text>`).join('')}
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

async function renderBackgroundPng(input: {
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
function classifyPdfStorageFailure(rawMessage: string): 'storage_mime_blocked' | 'storage_permission' | 'storage_unavailable' | 'unknown_storage_error' {
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

const USER_MESSAGE_FOR_PDF_FALLBACK: Readonly<Record<'storage_mime_blocked' | 'storage_permission' | 'storage_unavailable' | 'unknown_storage_error', string>> = {
  storage_mime_blocked:  'Preview available. Downloadable PDF unavailable — your storage configuration does not allow PDF uploads. Contact your admin or use the page previews.',
  storage_permission:    'Preview available. Downloadable PDF unavailable — storage permissions blocked the upload. Contact your admin.',
  storage_unavailable:   'Preview available. Downloadable PDF temporarily unavailable — try again in a moment.',
  unknown_storage_error: 'Preview available. Downloadable PDF unavailable — an unexpected storage error occurred.',
};

function compactText(value: unknown, fallback = ''): string {
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
function buildAccessibleAltText(primary: unknown, opts?: { supporting?: unknown; kind?: string; platform?: unknown }): string {
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

function normalizeOverlayText(input: {
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

function resolveRenderSize(
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

function getOverlayPreset(
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

function evaluateOverlayQuality(input: {
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

  const statSize = Math.round(width * 0.135);
  const statLines = balanceTextLines(stat, Math.max(6, Math.floor(width / (statSize * 0.62))), 2);
  const ctxSize = Math.round(width * 0.033);
  const ctxLines = context ? balanceTextLines(context, Math.max(18, Math.floor(width / (ctxSize * 0.56))), 3) : [];

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
    '<stop offset="0" stop-color="#0b1220" stop-opacity="0.72"/>' +
    '<stop offset="0.5" stop-color="#0b1220" stop-opacity="0.5"/>' +
    '<stop offset="1" stop-color="#0b1220" stop-opacity="0.78"/>' +
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

  const quoteSize = Math.round(width * 0.062);
  const quoteLines = balanceTextLines(quote, Math.max(14, Math.floor(width / (quoteSize * 0.52))), 5);
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
    '<stop offset="0" stop-color="#0b1220" stop-opacity="0.74"/>' +
    '<stop offset="0.5" stop-color="#0b1220" stop-opacity="0.55"/>' +
    '<stop offset="1" stop-color="#0b1220" stop-opacity="0.8"/>' +
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

  const panel = (yBase: number, accent: string, label: string | null, body: string): string => {
    const labelSize = Math.round(width * 0.026);
    const bodySize = Math.round(width * 0.05);
    const bodyLines = balanceTextLines(body, Math.max(14, Math.floor(width / (bodySize * 0.54))), 4);
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
    '<stop offset="0" stop-color="#0b1220" stop-opacity="0.68"/>' +
    '<stop offset="1" stop-color="#0b1220" stop-opacity="0.68"/>' +
    '</linearGradient>' +
    '<filter id="splitShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#000000" flood-opacity="0.45"/></filter>' +
    '</defs>' +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#splitScrim)"/>` +
    `<rect x="0" y="0" width="${width}" height="${half}" fill="${negColor}" opacity="0.14"/>` +
    `<rect x="0" y="${half}" width="${width}" height="${height - half}" fill="${posColor}" opacity="0.14"/>` +
    `<rect x="0" y="0" width="10" height="${half}" fill="${negColor}"/>` +
    `<rect x="0" y="${half}" width="10" height="${height - half}" fill="${posColor}"/>` +
    `<rect x="0" y="${half - 2}" width="${width}" height="4" fill="#ffffff" opacity="0.5"/>` +
    panel(0, negColor, top.label, top.body) +
    panel(half, posColor, bot.label, bot.body) +
    '</svg>';

  const flags: string[] = [];
  if (!top.body) flags.push('missing_headline');
  if (!bot.body) flags.push('missing_support');
  const quality: OverlayQualityReport = {
    score: top.body && bot.body ? 1 : top.body || bot.body ? 0.5 : 0,
    flags,
    text_units: top.body.length + bot.body.length,
    preset: 'split_card',
  };
  return { svg, quality, brandPlacement: defaultBrandPlacement({ width, height, fileNamePrefix: input.fileNamePrefix }) };
}

function buildOverlaySvg(input: {
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

async function loadBrandMark(input: {
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

async function normalizeBackgroundBuffer(input: {
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
function buildAiImagePrompt(input: {
  title: string;
  body: string;
  eyebrow: string;
  metadata: Record<string, unknown>;
  assetPayload: Record<string, unknown>;
  attachmentMode?: string | null;
  subtypeHint?: ImageSubtypeHint | null;
  /** Used for brand visual memory lookup/update (Phase 9). */
  companyId?: string | null;
}): string {
  const brandContext = safeObject(input.metadata.brand_context);
  const selectedAssets = safeObject(input.metadata.selected_brand_assets);
  const productContextRaw = safeObject(input.metadata.product_context);
  const brandKit = safeObject(input.metadata.brand_kit ?? selectedAssets);
  const palette = Array.isArray(input.assetPayload.color_palette)
    ? input.assetPayload.color_palette.map((v) => String(v)).filter(Boolean).slice(0, 5)
    : Array.isArray(brandKit.palette)
      ? (brandKit.palette as unknown[]).map((v) => String(v)).filter(Boolean).slice(0, 5)
      : [];

  // Lazy require so the creative-intelligence modules are only loaded
  // when the renderer actually needs them.
  const { composeCreatorImagePrompt } =
    require('./creator/creatorPromptComposer') as typeof import('./creator/creatorPromptComposer');
  const { assembleMultimodalPayload } =
    require('./creator/creatorMultimodalReferences') as typeof import('./creator/creatorMultimodalReferences');
  const { scoreCreatorPromptQuality, computeRetryDirective } =
    require('./creator/creatorOutputQualityRanking') as typeof import('./creator/creatorOutputQualityRanking');
  const { getBrandVisualPreference, updateBrandVisualPreference } =
    require('./creator/creatorVisualBrandMemory') as typeof import('./creator/creatorVisualBrandMemory');
  const { planCreativeDirection } =
    require('./creator/creativeDirectorEngine') as typeof import('./creator/creativeDirectorEngine');
  const { orchestrateCreativeVariants } =
    require('./creator/creativeVariantOrchestrator') as typeof import('./creator/creativeVariantOrchestrator');
  const { rankCreativeAesthetic, pickWinningVariant } =
    require('./creator/creativeAestheticRanking') as typeof import('./creator/creativeAestheticRanking');
  const { planOrFetchCampaignDNA, projectAssetPlanFromDNA } =
    require('./creator/campaignCoherenceEngine') as typeof import('./creator/campaignCoherenceEngine');
  const { resolvePlatformAdaptation } =
    require('./creator/platformVisualAdaptation') as typeof import('./creator/platformVisualAdaptation');
  const { evaluateBrandGovernance } =
    require('./creator/brandGovernanceEngine') as typeof import('./creator/brandGovernanceEngine');
  const { computeOptimizationDirective, decideAutonomousOperation } =
    require('./creator/autonomousCreativeOptimizer') as typeof import('./creator/autonomousCreativeOptimizer');
  const { recordTelemetryEvent } =
    require('./creator/creatorPerformanceTelemetry') as typeof import('./creator/creatorPerformanceTelemetry');

  const composerInput = {
    title: input.title,
    body: input.body,
    eyebrow: input.eyebrow,
    attachmentMode: input.attachmentMode,
    subtypeHint: input.subtypeHint ? { promptLine: input.subtypeHint.promptLine } : null,
    brandKit: {
      companyName: typeof brandKit.companyName === 'string' ? brandKit.companyName : (typeof brandContext.companyName === 'string' ? brandContext.companyName : undefined),
      logoUrl: typeof brandKit.logoUrl === 'string' ? brandKit.logoUrl : (typeof brandContext.logoUrl === 'string' ? brandContext.logoUrl : undefined),
      faviconUrl: typeof brandKit.faviconUrl === 'string' ? brandKit.faviconUrl : (typeof brandContext.faviconUrl === 'string' ? brandContext.faviconUrl : undefined),
      palette,
      accentColor: typeof brandKit.accentColor === 'string' ? brandKit.accentColor : (typeof brandContext.accentColor === 'string' ? brandContext.accentColor : undefined),
      typography: typeof brandKit.typography === 'object' && brandKit.typography !== null ? brandKit.typography as { fontFamily?: string } : undefined,
      tone: typeof brandContext.tone === 'string' ? brandContext.tone : (typeof input.metadata.tone === 'string' ? input.metadata.tone : undefined),
      industry: typeof brandKit.industry === 'string' ? brandKit.industry : (typeof brandContext.industry === 'string' ? brandContext.industry : undefined),
      domain: typeof brandKit.domain === 'string' ? brandKit.domain : (typeof brandContext.domain === 'string' ? brandContext.domain : undefined),
    },
    productContext: {
      productName: typeof productContextRaw.productName === 'string' ? productContextRaw.productName : (typeof brandContext.productName === 'string' ? brandContext.productName : undefined),
      productCategory: typeof productContextRaw.productCategory === 'string' ? productContextRaw.productCategory : undefined,
      screenshotUrls: Array.isArray(productContextRaw.screenshotUrls) ? (productContextRaw.screenshotUrls as unknown[]).map(String) : undefined,
      dashboardDescription: typeof productContextRaw.dashboardDescription === 'string' ? productContextRaw.dashboardDescription : undefined,
      uiKeywords: Array.isArray(productContextRaw.uiKeywords) ? (productContextRaw.uiKeywords as unknown[]).map(String) : undefined,
    },
    audience: compactText(input.metadata.audience),
    platform: compactText(input.metadata.platform || input.metadata.primary_platform),
    objective: compactText(input.metadata.objective || input.metadata.summary),
    tagline: compactText(brandContext.tagline || selectedAssets.tagline),
    brandMode: typeof input.metadata.brand_generation_mode === 'string'
      ? input.metadata.brand_generation_mode
      : (typeof input.metadata.brand_mode === 'string' ? input.metadata.brand_mode : 'brand-aware'),
    contentType: typeof input.metadata.content_type === 'string' ? input.metadata.content_type : input.eyebrow,
    // Purpose-driven generation strategy. Resolved by the composer
    // against the PurposeStrategyRegistry — see purposeStrategyRegistry.ts.
    // The key flows from the form submission's creator_card:
    //   - image / banner: creator_card.subtype (e.g. 'promotional-image')
    //   - carousel / slider: creator_card.subtype (e.g. 'story-carousel')
    //   - infographic: creator_card.infographic_layout (e.g. 'stats')
    // We also accept top-level metadata.subtype / .purpose_key for
    // back-compat with any caller that flattens differently.
    purposeKey: (() => {
      const creatorCard = safeObject(input.metadata.creator_card);
      const direct = String(
        input.metadata.purpose_key
          || creatorCard.purpose_key
          || creatorCard.infographic_layout
          || creatorCard.subtype
          || input.metadata.subtype
          || ''
      ).trim();
      return direct || null;
    })(),
    // Creator Governance → Prompt Composer Integration — Phase 2.
    // Build the governance prompt context from the resolved industry
    // (sourced from brandKit.industry — the same field the prompt
    // composer already uses to annotate industry context). The
    // governance layer is a strict no-op for non-regulated industries.
    governance: (() => {
      const { buildGovernancePromptContext } =
        require('./creator/strategyGovernancePromptContext') as typeof import('./creator/strategyGovernancePromptContext');
      const industry = typeof brandKit.industry === 'string'
        ? brandKit.industry
        : (typeof brandContext.industry === 'string' ? brandContext.industry : null);
      const category = typeof input.metadata.category === 'string'
        ? input.metadata.category
        : null;
      // Resolve the content-type lane for the policy lookup. Banner /
      // brand_card collapse to image; slider / pdf collapse to carousel.
      const ctRaw = String(input.metadata.content_type ?? input.eyebrow ?? '')
        .trim()
        .toLowerCase();
      const lane: 'image' | 'carousel' | 'infographic' =
        ctRaw === 'banner' || ctRaw === 'brand_card' ? 'image'
          : ctRaw === 'slider' || ctRaw === 'pdf' ? 'carousel'
            : ctRaw === 'carousel' ? 'carousel'
              : ctRaw === 'infographic' ? 'infographic'
                : 'image';
      const selectedRaw = String(
        input.metadata.purpose_key
          || safeObject(input.metadata.creator_card).purpose_key
          || safeObject(input.metadata.creator_card).infographic_layout
          || safeObject(input.metadata.creator_card).subtype
          || input.metadata.subtype
          || ''
      ).trim() || null;
      return buildGovernancePromptContext({
        companyContext: industry || category ? { industry, category } : null,
        contentType: lane,
        selectedStrategy: selectedRaw,
      });
    })(),
  };

  // Pull the brand's preferred template + strategy if one is cached.
  const brandPreference = getBrandVisualPreference(input.companyId);
  const productContextExpected = Boolean(
    composerInput.productContext.productName
      || composerInput.productContext.dashboardDescription
      || (composerInput.productContext.screenshotUrls?.length ?? 0) > 0
  );

  // ── Enterprise creative-intelligence pipeline ──────────────────────
  // Phase 1 (campaign coherence) — plan-or-fetch the campaign visual
  // DNA. Subsequent assets for the same campaign id reuse the DNA so
  // cross-asset coherence is preserved.
  const campaignIdForDna =
    (typeof input.metadata.campaign_id === 'string' && input.metadata.campaign_id.trim()) ? input.metadata.campaign_id.trim()
    : (typeof input.metadata.campaignId === 'string' && input.metadata.campaignId.trim()) ? input.metadata.campaignId.trim()
    : null;
  const dnaResult = planOrFetchCampaignDNA({
    campaignId: campaignIdForDna,
    campaignIntent: composerInput.objective ?? null,
    audience: composerInput.audience ?? null,
    platform: composerInput.platform ?? null,
    contentType: composerInput.contentType ?? null,
    brandKit: composerInput.brandKit,
    productContext: composerInput.productContext,
  });
  const campaignDNA = dnaResult?.dna ?? null;

  // Phase 1 — plan creative direction. When campaign DNA exists,
  // project the per-asset plan FROM the DNA so emotional / realism /
  // composition / human presence are inherited. Otherwise plan from
  // brand-memory continuity (no campaign DNA case).
  const plan = campaignDNA
    ? projectAssetPlanFromDNA({
        dna: campaignDNA,
        campaignIntent: composerInput.objective ?? null,
        audience: composerInput.audience ?? null,
        platform: composerInput.platform ?? null,
        contentType: composerInput.contentType ?? null,
        brandKit: composerInput.brandKit,
        productContext: composerInput.productContext,
      })
    : planCreativeDirection({
        campaignIntent: composerInput.objective ?? null,
        audience: composerInput.audience ?? null,
        platform: composerInput.platform ?? null,
        contentType: composerInput.contentType ?? null,
        brandKit: composerInput.brandKit,
        productContext: composerInput.productContext,
        brandMemory: brandPreference?.preferredStrategy
          ? { preferredStrategy: brandPreference.preferredStrategy as any }
          : null,
      });

  // Phase 3 — platform-native adaptation resolved from the asset's
  // platform. Adaptation lines are appended to the composer input's
  // extra context (the composer itself emits the platform intent line;
  // adaptation extends it).
  const platformAdaptation = resolvePlatformAdaptation(composerInput.platform);

  // Phase 3 (autonomous optimizer) — derive optimizer directives from
  // the org's strategic memory + human feedback. The directives nudge
  // the composer toward strategies + emotional directions that have
  // performed well historically for this org. All directives are
  // bounded (Phase 11) — never auto-disable, only nudge weights.
  const optimization = computeOptimizationDirective({
    companyId: input.companyId,
    currentStrategy: null,
  });
  if (optimization.mutations.forceBrandAware) composerInput.brandMode = 'brand-aware';
  // Realism + suppression intensification is already baked into the
  // composer's premium variant templates; the optimizer signals this
  // by setting `promoteToPremium` which the variant orchestrator
  // honors via the existing premium-bias path.

  // Phase 2 + 6 — orchestrate 1-3 meaningfully different variants
  // based on grounding signals + cost governance. Grounding here is
  // the same threshold the composer uses (≥3 signals counted from
  // brand kit + product context).
  const brandSignalCount = [
    composerInput.brandKit?.companyName,
    composerInput.brandKit?.industry,
    composerInput.brandKit?.tone,
    Array.isArray(composerInput.brandKit?.palette) && (composerInput.brandKit!.palette!.length ?? 0) > 0 ? '1' : null,
    composerInput.brandKit?.accentColor,
    composerInput.brandKit?.logoUrl,
  ].filter(Boolean).length;
  const productSignalCount = [
    composerInput.productContext?.productName,
    composerInput.productContext?.productCategory,
    composerInput.productContext?.dashboardDescription,
    Array.isArray(composerInput.productContext?.screenshotUrls) && (composerInput.productContext!.screenshotUrls!.length ?? 0) > 0 ? '1' : null,
    Array.isArray(composerInput.productContext?.uiKeywords) && (composerInput.productContext!.uiKeywords!.length ?? 0) > 0 ? '1' : null,
  ].filter(Boolean).length;
  const orchestration = orchestrateCreativeVariants({
    plan,
    hasBrandGrounding: brandSignalCount >= 3,
    hasProductGrounding: productSignalCount >= 3,
    brandPreference: brandPreference?.preferredTemplate ?? null,
    // Phase 6 — DNA-constrained exploration. When the campaign has an
    // established DNA, variants are restricted to its approved templates.
    // Phase 9 — cost governance: max 3 variants always; renders driven
    // by stale DNA (assetCount > 24) hard-cap to one variant to avoid
    // exploration cost on mature campaigns.
    config: campaignDNA
      ? {
          campaignApprovedTemplates: campaignDNA.approvedTemplates,
          hardCapToOne: campaignDNA.assetCount > 24,
        }
      : undefined,
  });

  // Phase 3 — compose + score each variant.
  type Candidate = {
    spec: typeof orchestration.variants[number];
    composed: ReturnType<typeof composeCreatorImagePrompt>;
    rank: ReturnType<typeof rankCreativeAesthetic>;
    qualityScore: ReturnType<typeof scoreCreatorPromptQuality>;
  };
  const candidates: Candidate[] = orchestration.variants.map((spec) => {
    const variantInput = { ...composerInput, ...spec.inputMutations };
    const variantComposed = composeCreatorImagePrompt(variantInput, spec.composeOptions);
    const variantRank = rankCreativeAesthetic({
      composed: variantComposed,
      plan,
      productContextExpected,
    });
    const variantQuality = scoreCreatorPromptQuality({
      composed: variantComposed,
      productContextExpected,
    });
    return { spec, composed: variantComposed, rank: variantRank, qualityScore: variantQuality };
  });

  // Phase 7 — winner selection. Highest aesthetic total wins.
  const { winner, runners } = pickWinningVariant(
    candidates.map((c) => ({ variant: c, rank: c.rank })),
  );
  let composed = winner.variant.composed;
  let score = winner.variant.qualityScore;
  let retryApplied = false;
  let retryReason: string | null = null;

  // Phase 2 + 7 — enterprise brand governance + governance-aware retry.
  // The governance engine validates the winning variant against the
  // brand kit + campaign DNA. When violations exist, the renderer
  // applies the suggested retry strategy ONCE before falling back to
  // the original winner. Phase 9 cost governance caps the loop at a
  // single governance-driven re-compose attempt — no recursion.
  const governance = evaluateBrandGovernance({
    composed: winner.variant.composed,
    plan,
    rank: winner.variant.rank,
    brandKit: composerInput.brandKit,
    dna: campaignDNA,
  });
  let governanceRetryApplied = false;
  let governancePostRetry = governance;
  if ((governance.governanceViolations.length > 0 || governance.rejectGeneration)
      && governance.retryStrategy !== 'none') {
    // Construct a governance-driven mutation from the retry strategy.
    const govMutations: Partial<typeof composerInput> = {};
    const govOptions: { premium?: boolean; brandPreference?: any } = {};
    switch (governance.retryStrategy) {
      case 'tighten_brand_signals':
      case 'tighten_palette':
        govMutations.brandMode = 'brand-aware';
        break;
      case 'tighten_realism':
      case 'reduce_stock_bias':
        govOptions.premium = true;
        break;
      case 'increase_product_grounding':
        // No mutation possible from the renderer (product context is
        // upstream input); flag-only for the audit envelope.
        break;
      case 'switch_emotional_tone':
      case 'enforce_composition_family':
      case 'suppress_human_presence':
        // These mutations require re-projecting from DNA. When DNA
        // is present, the projected plan already inherited the DNA's
        // emotional tone / composition / human presence — re-running
        // through the composer with the current plan suffices.
        break;
      default:
        break;
    }
    const govRetryInput = { ...composerInput, ...govMutations };
    const govRetryComposed = composeCreatorImagePrompt(govRetryInput, {
      ...govOptions,
      brandPreference: brandPreference?.preferredTemplate ?? null,
    });
    const govRetryRank = rankCreativeAesthetic({
      composed: govRetryComposed,
      plan,
      productContextExpected,
    });
    const govRetryScore = scoreCreatorPromptQuality({
      composed: govRetryComposed,
      productContextExpected,
    });
    const govRetryEval = evaluateBrandGovernance({
      composed: govRetryComposed,
      plan,
      rank: govRetryRank,
      brandKit: composerInput.brandKit,
      dna: campaignDNA,
    });
    // Accept the retry when it improves governance OR aesthetic score.
    const govImproved = govRetryEval.governanceScore > governance.governanceScore
      || govRetryRank.totalScore > winner.variant.rank.totalScore;
    if (govImproved) {
      composed = govRetryComposed;
      score = govRetryScore;
      governanceRetryApplied = true;
      governancePostRetry = govRetryEval;
    }
  }

  // Single-variant safety net — when only 1 variant was orchestrated
  // (weak grounding / hard cap), preserve the prior adaptive-retry
  // behavior so the prompt still gets a second pass when score is low.
  if (orchestration.count === 1) {
    const retry = computeRetryDirective({ score, composed });
    if (retry.shouldRetry) {
      const retryInput = { ...composerInput, ...retry.inputMutations };
      const retryComposed = composeCreatorImagePrompt(retryInput, {
        ...retry.optionOverrides,
        brandPreference: brandPreference?.preferredTemplate ?? null,
      });
      const retryScore = scoreCreatorPromptQuality({ composed: retryComposed, productContextExpected });
      if (retryScore.score > score.score) {
        composed = retryComposed;
        score = retryScore;
        retryApplied = true;
        retryReason = retry.reason;
      }
    }
  }

  // Phase 1-2 — multimodal payload assembly. Provider id is hardcoded
  // here as the OpenAI standard because that's what generateProviderImage
  // calls; capability registry will handle future swaps without
  // touching this code.
  const multimodal = assembleMultimodalPayload({
    composed,
    providerId: 'openai-gpt-image-1',
  });

  // Phase 8 — record this attempt in brand visual memory so future
  // assets for the same company drift toward the same lane. Records
  // the FULL creative intelligence envelope (strategy + emotional
  // direction + composition + realism + subject priority + narrative).
  updateBrandVisualPreference({
    companyId: input.companyId,
    template: composed.creativeDirection,
    premium: composed.premium,
    score: score.score,
    surface: input.eyebrow || (typeof input.metadata.content_type === 'string' ? input.metadata.content_type : 'image'),
    strategy: plan.strategyProfile,
    emotionalDirection: plan.emotionalDirection,
    compositionStrategy: plan.compositionStrategy,
    realismProfile: plan.realismProfile,
    subjectPriority: plan.subjectPriority,
    visualNarrative: plan.visualNarrative,
  });

  // Resolve the render strategy ONCE here so both the metadata
  // explainability envelope AND the downstream buildOverlaySvg call
  // see the same strategy. Resolution is null-safe when no purpose
  // strategy attached (legacy callers).
  const { resolveRenderStrategy: _resolveRenderStrategyForBundle } =
    require('./creator/renderStrategyRegistry') as typeof import('./creator/renderStrategyRegistry');
  const renderStrategy = _resolveRenderStrategyForBundle(composed.purposeStrategy?.id ?? null);
  // Resolve the active variant (PHASE 4 — purpose-aware variant
  // exploration). The variant lookup checks (in order): explicit
  // `variant_id` on the asset metadata, then `variant_family` paired
  // with the strategy id. Returns null for legacy assets that did
  // not specify a variant — the renderer + analytics layer fall back
  // to strategy-only behavior in that case.
  const { resolveVariant: _resolveVariantForBundle, resolveVariantByFamily: _resolveVariantByFamilyForBundle } =
    require('./creator/variantRegistry') as typeof import('./creator/variantRegistry');
  const { resolveVariantStrategyProfile: _resolveVariantProfileForBundle } =
    require('./creator/variantStrategyProfiles') as typeof import('./creator/variantStrategyProfiles');
  const inputMeta = safeObject(safeObject(input.assetPayload.media_bundle).metadata);
  const inputVariantId = typeof inputMeta.variant_id === 'string' && inputMeta.variant_id.length > 0
    ? inputMeta.variant_id
    : null;
  const inputVariantFamily = typeof inputMeta.variant_family === 'string' && inputMeta.variant_family.length > 0
    ? inputMeta.variant_family
    : null;
  const variantForBundle =
    _resolveVariantForBundle(inputVariantId)
    ?? _resolveVariantByFamilyForBundle(composed.purposeStrategy?.id ?? null, inputVariantFamily);
  const variantProfileForBundle = _resolveVariantProfileForBundle(variantForBundle?.variant_id ?? null);

  // Stash the FULL creative-intelligence audit envelope on
  // assetPayload.media_bundle.metadata. This preserves variant
  // traceability + explainability + ranking metadata so dashboards
  // can pivot variant performance and audit the winner choice.
  const bundle = safeObject(input.assetPayload.media_bundle);
  const bundleMeta = safeObject(bundle.metadata);
  (bundle as Record<string, unknown>).metadata = {
    ...bundleMeta,
    // Winning variant + composer signals
    creative_direction: composed.creativeDirection,
    creative_direction_premium: composed.premium,
    brand_grounded: composed.brandGrounded,
    product_grounded: composed.productGrounded,
    // Creator Governance → Prompt Composer Integration — Phase 5.
    // Explainability metadata exposing which governance signals the
    // composer applied. Always present; carries industry='none' for
    // non-regulated companies. Downstream surfaces (post-execution
    // UI, audit trail) read this off creator_attachment_metadata to
    // render the compliance summary.
    governance: composed.governance,
    // Purpose-driven strategy envelope (PHASE 6 explainability).
    // Surfaced in preview as "Generated As" + rationale; null when
    // no purpose strategy resolved (legacy / direct-call paths).
    purpose_strategy: composed.purposeStrategy,
    generated_as_label: composed.purposeStrategy?.generatedAsLabel ?? null,
    purpose_why_chosen: composed.purposeStrategy?.whyChosen ?? null,
    purpose_density_bias: composed.purposeStrategy?.densityBias ?? null,
    purpose_branding_intensity: composed.purposeStrategy?.brandingIntensity ?? null,
    purpose_typography_weight: composed.purposeStrategy?.typographyWeight ?? null,
    purpose_cta_intensity: composed.purposeStrategy?.ctaIntensity ?? null,
    purpose_slide_arc: composed.purposeStrategy?.slideArcRoles ?? null,
    purpose_information_architecture: composed.purposeStrategy?.informationArchitecturePattern ?? null,
    // Strategy-aware rendering envelope (PHASE 9 explainability).
    // When a render strategy was applied to buildOverlaySvg, surface
    // the typography/branding/density/cta/visual-emphasis profile
    // strings so the preview can render an "Applied Render Strategy"
    // strip alongside the existing "Generated As" panel. Null when no
    // render strategy resolved.
    applied_render_strategy: renderStrategy
      ? {
          id: renderStrategy.id,
          typography_profile: renderStrategy.explainability.typographyProfile,
          branding_profile: renderStrategy.explainability.brandingProfile,
          density_profile: renderStrategy.explainability.densityProfile,
          cta_profile: renderStrategy.explainability.ctaProfile,
          visual_emphasis_profile: renderStrategy.explainability.visualEmphasisProfile,
          modifiers_applied: {
            headline_scale: renderStrategy.modifiers.headlineScale,
            hook_scale: renderStrategy.modifiers.hookScale,
            insight_scale: renderStrategy.modifiers.insightScale,
            support_scale: renderStrategy.modifiers.supportScale,
            max_headline_lines_delta: renderStrategy.modifiers.maxHeadlineLinesDelta,
            margin_scale: renderStrategy.modifiers.marginScale,
            text_block_top_ratio: renderStrategy.modifiers.textBlockTopRatio,
            scrim_intensity_multiplier: renderStrategy.modifiers.scrimIntensityMultiplier,
            logo_scale_multiplier: renderStrategy.modifiers.logoScaleMultiplier,
            logo_opacity: renderStrategy.modifiers.logoOpacity,
            cta_mode: renderStrategy.modifiers.ctaMode,
            focal_emphasis: renderStrategy.modifiers.focalEmphasis,
          },
        }
      : null,
    // Strategy analytics attribution envelope (PHASE 2 — Purpose
    // Strategy Analytics). Resolved from `purpose_strategy.id` so the
    // canonical analytics dimensions travel on every strategy-aware
    // asset. Null for legacy / non-strategy assets — analytics surfaces
    // MUST fall back gracefully (PHASE 12).
    strategy_analytics: (() => {
      const { buildStrategyAnalyticsAttribution: _attr } =
        require('./creator/strategyAnalyticsRecorder') as typeof import('./creator/strategyAnalyticsRecorder');
      const attribution = _attr({
        purpose_strategy: composed.purposeStrategy,
        applied_render_strategy: renderStrategy
          ? { id: renderStrategy.id }
          : null,
        applied_variant: variantForBundle ? {
          variant_id: variantForBundle.variant_id,
          variant_family: variantForBundle.variant_family,
        } : null,
      });
      // Carry the variant fields on the analytics envelope so the
      // recorder + leaderboards key off them downstream (PHASE 6).
      if (attribution && variantForBundle) {
        (attribution as Record<string, unknown>).variant_id = variantForBundle.variant_id;
        (attribution as Record<string, unknown>).variant_family = variantForBundle.variant_family;
      }
      return attribution;
    })(),
    // Applied Variant envelope (PHASE 12 — preview explainability).
    // Surfaces the variant identity + reasoning string so the preview
    // panel can render the "Applied Variant" strip alongside the
    // existing "Applied Render Strategy" strip. Null for legacy /
    // baseline assets with no variant.
    applied_variant: variantForBundle
      ? {
          variant_id: variantForBundle.variant_id,
          variant_family: variantForBundle.variant_family,
          display_name: variantForBundle.display_name,
          description: variantForBundle.description,
          exploration_dimensions: variantForBundle.exploration_dimensions,
          reasoning: variantProfileForBundle?.reasoning ?? null,
        }
      : null,
    // Strategic plan
    creative_strategy: plan.strategyProfile,
    creative_emotional_direction: plan.emotionalDirection,
    creative_composition_strategy: plan.compositionStrategy,
    creative_realism_profile: plan.realismProfile,
    creative_visual_narrative: plan.visualNarrative,
    creative_framing_strategy: plan.framingStrategy,
    creative_subject_priority: plan.subjectPriority,
    creative_human_presence_mode: plan.humanPresenceMode,
    creative_visual_density: plan.visualDensity,
    creative_premium_bias: plan.premiumBias,
    creative_plan_rationale: plan.rationale,
    // Variant exploration audit
    variant_count: orchestration.count,
    variant_rationale: orchestration.rationale,
    variants: candidates.map((c) => ({
      id: c.spec.id,
      label: c.spec.label,
      template: c.spec.audit.template,
      exploration_vector: c.spec.audit.explorationVector,
      rank_total: c.rank.totalScore,
      rank_bucket: c.rank.bucket,
      rank_reason: c.rank.rankingReason,
      strengths: c.rank.strengths,
      weaknesses: c.rank.weaknesses,
    })),
    winner_variant_id: winner.variant.spec.id,
    runner_up_count: runners.length,
    // Aesthetic ranking of the winner
    aesthetic_score: winner.rank.totalScore,
    aesthetic_bucket: winner.rank.bucket,
    aesthetic_dimensions: winner.rank.dimensionScores,
    aesthetic_strengths: winner.rank.strengths,
    aesthetic_weaknesses: winner.rank.weaknesses,
    // Prior-phase quality envelope (preserved for backward-compat with
    // dashboards that already track these fields).
    prompt_quality_score: score.score,
    prompt_quality_bucket: score.bucket,
    prompt_quality_flags: score.flags,
    prompt_quality_categories: score.categoryScores,
    prompt_retry_applied: retryApplied,
    prompt_retry_reason: retryReason,
    multimodal_references_present: multimodal.audit.referencesPresent,
    multimodal_references_accepted: multimodal.audit.referencesAccepted,
    multimodal_references_degraded_to_text: multimodal.audit.referencesDegradedToText,
    brand_visual_preference_used: Boolean(brandPreference),
    // Phase 1 + 8 — campaign coherence envelope.
    campaign_dna_established: dnaResult?.established ?? null,
    campaign_dna_reused: dnaResult ? !dnaResult.established : null,
    campaign_dna_strategy_family: campaignDNA?.strategyFamily ?? null,
    campaign_dna_emotional_tone: campaignDNA?.visualDNA.emotionalTone ?? null,
    campaign_dna_realism_profile: campaignDNA?.visualDNA.realismProfile ?? null,
    campaign_dna_composition_family: campaignDNA?.visualDNA.compositionFamily ?? null,
    campaign_dna_visual_density: campaignDNA?.visualDNA.visualDensity ?? null,
    campaign_dna_human_presence_policy: campaignDNA?.visualDNA.humanPresencePolicy ?? null,
    campaign_dna_product_presence_policy: campaignDNA?.visualDNA.productPresencePolicy ?? null,
    campaign_dna_palette_discipline: campaignDNA?.visualDNA.paletteDiscipline ?? [],
    campaign_dna_approved_templates: campaignDNA?.approvedTemplates ?? [],
    campaign_dna_asset_count: campaignDNA?.assetCount ?? null,
    campaign_dna_rationale: campaignDNA?.rationale ?? [],
    // Phase 3 — platform adaptation envelope.
    platform_adaptation: {
      platform: platformAdaptation.platform,
      density: platformAdaptation.densityAdjustment,
      whitespace: platformAdaptation.whitespaceDiscipline,
      energy: platformAdaptation.visualEnergy,
      human_nudge: platformAdaptation.humanPresenceNudge,
      cta_emphasis: platformAdaptation.ctaEmphasis,
    },
    // Phase 2 + 7 — governance envelope.
    governance_score: governancePostRetry.governanceScore,
    governance_violations: governancePostRetry.governanceViolations.map((v) => ({
      category: v.category, severity: v.severity, description: v.description,
    })),
    governance_warnings: governancePostRetry.governanceWarnings.map((v) => ({
      category: v.category, severity: v.severity, description: v.description,
    })),
    governance_brand_alignment_confidence: governancePostRetry.brandAlignmentConfidence,
    governance_reject_generation: governancePostRetry.rejectGeneration,
    governance_retry_strategy: governancePostRetry.retryStrategy,
    governance_retry_applied: governanceRetryApplied,
    governance_retry_rationale: governance.retryRationale,
    governance_pre_retry_score: governance.governanceScore,
    // Phase 3 + 5 + 7 — autonomous optimizer envelope.
    optimization_directive_strategy_weights: optimization.strategyWeights,
    optimization_directive_mutations: optimization.mutations,
    optimization_preferred_emotional: optimization.preferredEmotionalDirection,
    optimization_preferred_realism: optimization.preferredRealismProfile,
    optimization_rationale: optimization.rationale,
  };
  (input.assetPayload as Record<string, unknown>).media_bundle = bundle;

  // Phase 4 — telemetry event for this prompt-building attempt. The
  // renderer's actual provider call + QA evaluation happens AFTER
  // this function returns (the renderer scope tracks render outcome
  // for the QA telemetry). This first event records the "render
  // requested" signal so the strategic memory has continuous coverage
  // even when downstream stages fail.
  if (input.companyId) {
    try {
      const decision = decideAutonomousOperation({
        qaScore: 70, // placeholder — QA runs post-render in the renderer scope below
        qaSeverity: 'pass',
        governanceScore: governancePostRetry.governanceScore,
        governanceRejected: governancePostRetry.rejectGeneration,
        aestheticBucket: winner.variant.rank.bucket,
      });
      recordTelemetryEvent({
        type: 'variant_selected',
        companyId: input.companyId,
        campaignId: campaignIdForDna,
        strategy: plan.strategyProfile,
        template: composed.creativeDirection,
        platform: composerInput.platform ?? null,
        emotionalDirection: plan.emotionalDirection,
        realismProfile: plan.realismProfile,
        aestheticScore: winner.variant.rank.totalScore,
        governanceScore: governancePostRetry.governanceScore,
        payload: {
          autonomous_decision: decision.action,
          autonomous_reason: decision.reason,
          variant_count: orchestration.count,
        },
      });
    } catch { /* telemetry never throws */ }
  }

  return multimodal.textPrompt;
}

function timeoutAfter<T>(ms: number, label: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
}

function getFirstImageResult(response: unknown): { b64_json?: string | null; url?: string | null } | null {
  const data = response && typeof response === 'object' && 'data' in response
    ? (response as { data?: unknown }).data
    : null;
  if (!Array.isArray(data)) return null;
  const first = data[0];
  return first && typeof first === 'object'
    ? first as { b64_json?: string | null; url?: string | null }
    : null;
}

async function bufferFromRemoteImage(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Image download failed with ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function resolveOpenAiImageKey(): Promise<string | null> {
  try {
    return config.OPENAI_API_KEY || null;
  } catch (error) {
    console.warn('[creator-asset-renderer][image-key-unavailable]', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function generateProviderImage(input: {
  prompt: string;
  /** Optional img2img style-reference image URL (curated template showcase).
   *  Used only when CREATOR_IMAGE_REFERENCE_MODE='edit'; conditions generation
   *  via images.edit. Absent/flag-off → plain text-to-image (unchanged). */
  referenceImageUrl?: string | null;
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
  const referenceUrl = input.referenceImageUrl;
  if (process.env.CREATOR_IMAGE_REFERENCE_MODE === 'edit' && typeof referenceUrl === 'string' && referenceUrl.trim()) {
    const editModel = modelCandidates[0];
    const editStartedAt = Date.now();
    try {
      const { toFile } = await import('openai');
      const refResp = await fetch(referenceUrl.trim());
      if (!refResp.ok) throw new Error(`reference fetch ${refResp.status}`);
      const refBuf = Buffer.from(await refResp.arrayBuffer());
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
        if (firstEdit.b64_json) return { image: { buffer: Buffer.from(firstEdit.b64_json, 'base64'), model: `${editModel}:edit` } };
        return { image: { buffer: await bufferFromRemoteImage(firstEdit.url as string), model: `${editModel}:edit` } };
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
          return { image: { buffer: Buffer.from(first.b64_json, 'base64'), model } };
        }
        return { image: { buffer: await bufferFromRemoteImage(first.url as string), model } };
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
    fallbackReason: failures.join(' | ') || 'Provider image generation failed',
  };
}

async function uploadRenderedPng(input: {
  fileBuffer: Buffer;
  campaignId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  fileNamePrefix: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  return uploadRenderedFile({ ...input, extension: 'png', contentType: 'image/png' });
}

async function uploadRenderedFile(input: {
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
type AttachmentRenderPolicy = 'supporting_visual' | 'embedded_copy';

/** Per-subtype visual direction hint, threaded into the provider prompt. */
type ImageSubtypeHint = {
  subtypeId: string;
  promptLine: string;
  /** Default overlay density when subtype is set. Read by `getOverlayPreset`. */
  densityHint: 'minimal' | 'balanced' | 'dense';
};

const IMAGE_SUBTYPE_HINTS: Readonly<Record<string, ImageSubtypeHint>> = {
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

function resolveImageSubtype(metadata: Record<string, unknown>, assetPayload: Record<string, unknown>): ImageSubtypeHint | null {
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

function resolveAttachmentRenderMode(input: {
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

async function composeSingleVisualAsset(
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
  const governedOverlay = {
    hook: corrected.textBlocks[0] ?? '',
    headline: corrected.textBlocks[1] ?? '',
    keyInsight: corrected.textBlocks[2] ?? '',
    cta: corrected.textBlocks[3] ?? '',
    supportingText: corrected.textBlocks[4] ?? '',
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
  const visualGovernance = validateVisualGovernance({
    assetType: governanceAssetType,
    platform,
    textBlocks: corrected.textBlocks,
    hasCTA: Boolean(governedOverlay.cta),
    textAreaPercent: estimateTextAreaPercent({ textBlocks: corrected.textBlocks }),
    paragraphCount: corrected.textBlocks.filter((block) => block.length > 110 || /[.!?]\s+[A-Z0-9]/.test(block)).length,
    overlapRisk: corrected.textBlocks.join(' ').length > 360,
    tinyTextRisk: corrected.textBlocks.length > 4,
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
  const overlayRender = skipOverlayComposite
    ? null
    : imageComposition === 'stat'
      ? buildStatCardSvg({ width, height, overlay: governedOverlay, brandKit, fileNamePrefix })
      : imageComposition === 'quote'
      ? buildQuoteCardSvg({ width, height, overlay: governedOverlay, brandKit, fileNamePrefix })
      : imageComposition === 'split'
      ? buildSplitCardSvg({ width, height, overlay: governedOverlay, brandKit, fileNamePrefix })
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

function computeCompositionQuality(input: {
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
function defaultBrandPlacement(input: {
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
export async function renderCreatorCarouselReviewPreview(input: CreatorReviewPreviewInput): Promise<{
  buffer: Buffer;
  metadata: Record<string, unknown>;
}> {
  const head = input.overlayText ?? {};
  // Three distinct slides so the deck reads as a real carousel, not a duplicated image.
  const slideOverlays = [
    { headline: head.headline ?? input.title, subheadline: head.subheadline, cta: undefined },
    { headline: head.subheadline ?? input.body, subheadline: undefined, cta: undefined },
    { headline: head.cta ?? 'Learn more', subheadline: head.headline ?? input.title, cta: head.cta ?? 'Learn more' },
  ];
  const slides: Buffer[] = [];
  for (const ov of slideOverlays) {
    // Square canvas (instagram) so the slide isn't side-cropped into the deck card.
    const { buffer } = await renderCreatorAssetReviewPreview({ ...input, platform: 'instagram', assetType: 'image', overlayText: ov });
    slides.push(buffer);
  }

  const S = 1080;
  const card = 700;          // slide size before frame
  const framed: Buffer[] = [];
  for (const s of slides) {
    framed.push(await sharp(s).resize(card, card, { fit: 'cover' })
      .extend({ top: 12, bottom: 12, left: 12, right: 12, background: '#ffffff' })
      .png().toBuffer());
  }
  const fc = card + 24;       // framed card size
  // Deck: back + mid peek up-and-right behind the fully-visible front slide.
  const positions = [
    { left: S - fc - 70, top: 95 },                 // back
    { left: Math.round((S - fc) / 2), top: 135 },   // mid
    { left: 70, top: 175 },                          // front (slide 1)
  ];
  const dotY = S - 70;
  const dots = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">`
    + `<circle cx="${S / 2 - 30}" cy="${dotY}" r="8" fill="#2563eb"/>`
    + `<circle cx="${S / 2}" cy="${dotY}" r="8" fill="#cbd5e1"/>`
    + `<circle cx="${S / 2 + 30}" cy="${dotY}" r="8" fill="#cbd5e1"/></svg>`;
  const buffer = await sharp({ create: { width: S, height: S, channels: 4, background: { r: 226, g: 232, b: 240, alpha: 1 } } })
    .composite([
      { input: framed[2], top: positions[0].top, left: positions[0].left },
      { input: framed[1], top: positions[1].top, left: positions[1].left },
      { input: framed[0], top: positions[2].top, left: positions[2].left },
      { input: Buffer.from(dots), top: 0, left: 0 },
    ])
    .png().toBuffer();

  return { buffer, metadata: { width: S, height: S, preview_kind: 'visual_review_carousel', platform: input.platform, asset_type: 'carousel', slides: slideOverlays.length } };
}

/**
 * Strip prompt-style formatting instructions that leaked out of the
 * LLM into visible slide copy. Operator feedback flagged lines like
 * "Use a modern font for the headline, with a clean layout" appearing
 * verbatim under the body text. These are design DIRECTIVES the LLM
 * was meant to ACT on, not echo. We remove leading directive phrases
 * and drop any sentence that's still primarily a directive after that.
 *
 * Conservative: only matches well-known directive openers / fragments
 * so legitimate body copy (e.g., "Use AI to transform your strategy")
 * is preserved. The directive opener "Use a/an [adj] font/layout/..."
 * is structurally distinct from product copy.
 */
function stripPromptDirectives(raw: string | null | undefined): string {
  const input = String(raw ?? '').trim();
  if (!input) return '';
  // Design-directive nouns. If a sentence starts with "Use a/an" or
  // "With a/an" AND mentions any of these anywhere, it's a leaked
  // prompt-style directive, not body copy. Comma-separated adjective
  // chains like "Use a clean, modern illustration style with a..."
  // are now caught because we no longer require the noun to be the
  // immediate next word after the article.
  const DIRECTIVE_NOUNS = /\b(font|layout|design|color|colour|palette|typography|hierarchy|style|illustration|composition|template|aesthetic|graphic|imagery|visual|tone|mood|background|foreground|spacing|alignment|kerning|leading|copy|filler|clutter|whitespace)\b/;
  const directiveSentence = (sentence: string): boolean => {
    const s = sentence.trim().toLowerCase();
    if (!s) return true;
    // "Use a/an ... [directive noun anywhere]" — catches "Use a clean,
    // modern illustration style with a clean palette" etc. Anchored
    // on the article ("a"/"an") so legitimate body copy like
    // "Use AI to..." / "Use this framework..." stays.
    if (/^use\s+(a|an)\s+/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    // "With a/an [directive noun anywhere]" — same shape, fragment.
    if (/^with\s+(a|an)\s+/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    // Bare "use a/an [adj] [adj]..." trailing fragment (the LLM
    // sometimes echoes a directive without a closing period).
    if (/^use\s+(a|an)\s+(\w+,?\s+){1,5}/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    // "Ensure [the headline / the layout / etc.] ..." — directive.
    if (/^ensure\s+(the\s+)?/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    // "Make sure / make it ... [design term]" — directive.
    if (/^make\s+(sure|it|the\s+\w+)\s+/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    // "Avoid [design term]" — negative directive.
    if (/^avoid\s+/.test(s) && /(text|font|copy|filler|clutter|noise|over|whitespace)/.test(s)) return true;
    // "Render / create / produce / show [a/the] ... [design term]" —
    // catch-all imperative directive forms.
    if (/^(render|create|produce|show|display|present|generate|build|illustrate)\s+(a|an|the)\s+/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    return false;
  };
  // Split into sentences but keep delimiters so we can rejoin cleanly.
  // Trailing/leading whitespace is normalized at the end.
  const sentences = input.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !directiveSentence(s));
  const result = kept.join(' ').replace(/\s+/g, ' ').trim();
  // If filtering wiped everything (every sentence was a directive),
  // return empty rather than a stub — downstream falls back to the
  // strategy's intent text.
  return result;
}

function normalizeStructuredItems(
  items: Array<Record<string, unknown>>,
  fallbackLabel: string,
  fileNamePrefix: string,
  metadata: Record<string, unknown>,
): Array<{ headline: string; body: string; designNote?: string; role?: string }> {
  // Purpose-driven slide-arc orchestration. When the metadata carries
  // a resolved purposeStrategy with a slideArc (carousel) OR an
  // informationArchitecture.sectionBlueprint (infographic-ish), use
  // it as the canonical role sequence. The LLM-supplied items map
  // onto these roles in order; when fewer items than roles, missing
  // slides are scaffolded from the strategy's intent. When more
  // items than roles, extras keep their LLM-supplied roles.
  const bundleMeta = safeObject(safeObject(metadata.media_bundle).metadata);
  const purposeStrategy = (() => {
    const direct = (metadata as Record<string, unknown>).purpose_strategy;
    if (direct && typeof direct === 'object') return direct as Record<string, unknown>;
    const fromBundle = bundleMeta.purpose_strategy;
    if (fromBundle && typeof fromBundle === 'object') return fromBundle as Record<string, unknown>;
    return null;
  })();
  const slideArcRoles = Array.isArray((purposeStrategy as Record<string, unknown> | null)?.slideArcRoles)
    ? ((purposeStrategy as Record<string, unknown>).slideArcRoles as unknown[]).map(String).filter(Boolean)
    : null;

  const clean = items.map((item, index) => ({
    role: compactText(item.role || item.section_type || item.type || `Slide ${index + 1}`),
    headline: compactText(stripPromptDirectives(String(item.headline || item.title || item.heading || `Slide ${index + 1}`))),
    body: compactText(stripPromptDirectives(String(item.body_text || item.body || item.text || item.summary || fallbackLabel))),
    designNote: compactText(item.design_note || item.visual_description || item.visual || ''),
  })).filter((item) => item.headline || item.body);

  if (clean.length > 0) {
    // Carousel slide-limit removal — render EXACTLY the slides supplied by the
    // generation pipeline (template-driven dynamic counts: 3/5/7/8/9/10/…).
    // The former artificial cap (8 for carousel/slider, 7 for pdf) truncated
    // larger decks; it is intentionally removed with NO replacement limit.
    // Ordering is preserved (index order). The downstream render loop, deck
    // context, per-slide upload, OCR, and PDF paging are all driven by
    // `renderItems.length`, so every supplied slide is rendered, previewed,
    // and exported.
    const sliced = clean;
    // Purpose-strategy role overlay — when the strategy supplies a
    // role sequence (Educational: hook → concept → explanation →
    // example → summary, Story: hook → problem → journey → ..., etc.),
    // assign roles in order so structured slide generation matches
    // the strategy's narrative architecture.
    // Count-aware role arc — size the strategy arc (or a generic hook→…→cta arc) to
    // the ACTUAL number of slides so every slide gets a distinct strategic role. Prevents
    // generic `slide_N` filler on long decks (which read as duplicates) and dropped roles
    // on short decks. See fitSlideArcToCount.
    const baseArc = slideArcRoles && slideArcRoles.length > 0 ? slideArcRoles : ['hook', 'insight', 'proof', 'content', 'cta'];
    const fittedRoles = fitSlideArcToCount(baseArc, sliced.length);
    return sliced.map((item, index) => ({
      role: fittedRoles[index] || item.role || `slide_${index + 1}`,
      headline: item.headline,
      body: item.body,
      designNote: item.designNote,
    }));
  }

  // Empty-LLM fallback. When a purpose strategy is present, scaffold
  // slides directly from its arc so the fallback path still produces
  // strategy-aligned content rather than the generic hook/insight/
  // proof/cta sequence.
  const topic = compactText(metadata.topic || fallbackLabel, fallbackLabel);
  const summary = compactText(metadata.summary || fallbackLabel, fallbackLabel);
  const objective = compactText(metadata.objective || 'Make the core idea easy to act on');
  if (slideArcRoles && slideArcRoles.length > 0) {
    return slideArcRoles.map((role, index) => ({
      role,
      headline: index === 0 ? topic : role.replace(/_/g, ' '),
      body: index === 0 ? summary : index === slideArcRoles.length - 1 ? objective : 'Detail for this slide will be expanded.',
      designNote: `${role} slide`,
    }));
  }
  return [
    { role: 'hook', headline: topic, body: summary, designNote: 'Strong opening hierarchy' },
    { role: 'insight', headline: 'Core insight', body: objective, designNote: 'Clarify the important shift' },
    { role: 'proof', headline: 'Why it matters', body: summary, designNote: 'Add credibility and context' },
    { role: 'cta', headline: compactText(metadata.cta || 'Next step'), body: 'Close with one clear action.', designNote: 'CTA ending' },
  ];
}

/**
 * Deck-wide rendering context. Computed ONCE per carousel/pdf/slider
 * so every slide in the deck:
 *
 *  1. Uses the same adaptive font multiplier (based on the longest
 *     slide's text length — guarantees consistent type sizes across
 *     the deck, not a different font on every slide).
 *
 *  2. Picks a layout from a deterministic rotation (text_top /
 *     text_center / text_bottom) so the deck has visual rhythm
 *     instead of identical bottom-anchored slides.
 *
 *  3. Continues the wave-form visual continuity line: slide N's
 *     left-edge wave-Y matches slide N-1's right-edge wave-Y, so
 *     across the swipe-through experience the curve reads as one
 *     uninterrupted flowing line, not five truncated stubs.
 */
type DeckLayoutMode = 'text_top' | 'text_center' | 'text_bottom';
type DeckSlideWaveAnchor = { entryY: number; exitY: number };
type DeckRenderContext = {
  /** The single adaptive font multiplier every slide will use. */
  fontMultiplier: number;
  /** Layout mode for each slide index. */
  layoutModes: DeckLayoutMode[];
  /** Wave entry / exit Y for each slide, in pixels. Slide i's exitY
   *  equals slide i+1's entryY so the curve is continuous. */
  waveAnchors: DeckSlideWaveAnchor[];
};

function buildDeckRenderContext(input: {
  // Loose shape — accepts the Record<string,string>[] coming out of
  // normalizeStructuredItems. We only read .headline / .body /
  // .designNote / .role so anything else on the record is ignored.
  renderItems: ReadonlyArray<Record<string, string>>;
  width: number;
  height: number;
}): DeckRenderContext {
  const { renderItems, height } = input;
  // 1. Deck-wide font multiplier — derived from the slide with the
  // MOST text, so the smallest-fitting font wins. This forces every
  // slide in the deck to render at the same type scale (consistency)
  // rather than each picking its own per-slide scale.
  // Operator feedback: "we have a lot of white space, and we should
  // have a guideline that looks into the white space... look at the
  // busiest slide available... and based on that, decide what should
  // be the font size for the title as well as the text."
  //
  // The multiplier is now derived from the BUSIEST slide's title +
  // subheading length (designNote excluded — that field is no longer
  // rendered). Bumped across the board so even the busiest slide
  // fills the canvas instead of leaving the 40%+ empty top band the
  // previous defaults produced.
  const maxOverlayChars = renderItems.reduce((max, item) => {
    const chars = String(item.headline || '').length
      + String(item.body || '').length;
    return Math.max(max, chars);
  }, 0);
  const fontMultiplier =
    maxOverlayChars <= 60 ? 1.70  // very short hook — title dominates
    : maxOverlayChars <= 110 ? 1.55
    : maxOverlayChars <= 170 ? 1.40
    : maxOverlayChars <= 230 ? 1.25
    : maxOverlayChars <= 300 ? 1.10
    : maxOverlayChars <= 380 ? 0.98
    : 0.88;

  // 2. Layout rotation. The roles supplied by normalizeStructuredItems
  // are stable (hook / insight / proof / cta / etc.) so we can derive
  // a deterministic but varied sequence:
  //   - hook slide      → text_center (entry, focal headline)
  //   - cta slide (last)→ text_center (exit, focal call)
  //   - middles         → alternate text_top / text_bottom
  // This is the variety operator feedback asked for: text doesn't
  // always live at the bottom of every slide.
  const layoutModes: DeckLayoutMode[] = renderItems.map((item, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === renderItems.length - 1;
    const role = String(item.role || '').toLowerCase();
    if (isFirst || role === 'hook' || role === 'title') return 'text_center';
    if (isLast || role === 'cta' || role === 'next_steps' || role === 'summary' || role === 'outcome' || role === 'conclusion') return 'text_center';
    // Alternate the middle slides — text_top on odd middles,
    // text_bottom on even middles — so the visual rhythm shifts as
    // the viewer swipes through.
    return idx % 2 === 0 ? 'text_top' : 'text_bottom';
  });

  // 3. Continuous wave anchors. Pick a smooth sweep across the deck:
  //    entry/exit Y values oscillate gently between 0.25 and 0.55
  //    of canvas height, deterministically per index. Slide N's
  //    exitY equals slide N+1's entryY by construction.
  const waveAnchors: DeckSlideWaveAnchor[] = [];
  // Anchor sequence: each slide-boundary gets a Y ratio. With N
  // slides, there are N+1 boundary points (slide_0_left, ..., slide_N-1_right).
  // We oscillate through a small set so adjacent boundaries share a
  // Y position (continuity) without the curve repeating identically.
  const boundaryRatios: number[] = [];
  const baseSweep = [0.30, 0.42, 0.28, 0.48, 0.32, 0.40, 0.26, 0.46];
  for (let i = 0; i <= renderItems.length; i += 1) {
    boundaryRatios.push(baseSweep[i % baseSweep.length]);
  }
  for (let i = 0; i < renderItems.length; i += 1) {
    waveAnchors.push({
      entryY: Math.round(height * boundaryRatios[i]),
      exitY: Math.round(height * boundaryRatios[i + 1]),
    });
  }

  return { fontMultiplier, layoutModes, waveAnchors };
}

async function renderStructuredSlidePng(input: {
  item: Record<string, string>;
  index: number;
  total: number;
  metadata: Record<string, unknown>;
  assetPayload: Record<string, unknown>;
  fileNamePrefix: string;
  width: number;
  height: number;
  brandKit: CreatorBrandKit;
  /** Deck-wide context. Provided when called from
   *  composeStructuredDeckAsset; absent for single-slide callers. */
  deckContext?: DeckRenderContext;
  /** Canonical carousel visual language (deck path). Drives the slide overlay
   *  base preset + continuity-wave gating. Default style → byte-identical. */
  carouselStyle?: CarouselStyleSchema;
}): Promise<{ buffer: Buffer; quality: OverlayQualityReport }> {
  const platform = compactText(input.metadata.platform || input.metadata.primary_platform, 'linkedin');
  // Operator feedback: drop the third "supporting / explanation"
  // tier entirely. The slide content is TITLE (headline) +
  // SUBHEADING (insight) only. The third tier carried the LLM's
  // design directive notes ("use a modern font for the headline
  // with a clean...") which were never meant for the reader. With
  // that field empty, the renderer skips the support block and the
  // title + subheading get bigger fonts and more vertical real estate.
  const overlay = {
    hook: `${input.item.role || 'slide'} ${input.index + 1}/${input.total}`,
    headline: input.item.headline,
    keyInsight: input.item.body,
    cta: input.index === input.total - 1 ? compactText(input.metadata.cta || 'Take the next step') : 'Keep reading',
    supportingText: '',
  };
  const background = await renderBackgroundPng({
    width: input.width,
    height: input.height,
    colors: input.brandKit.normalizedPalette,
    // Per-slide index keeps slides within a carousel distinct; mixing the
    // slide body keeps DIFFERENT carousels distinct from each other too.
    variantId: `${input.brandKit.layoutVariantId}:${input.index}:${String(input.item?.body || '').slice(0, 48)}`,
    // Carousel visual language — slide frame radius (0 → square, byte-identical).
    frameRadius: input.carouselStyle?.frame.cornerRadius ?? 0,
  });
  // Strategy-aware carousel/infographic slide rendering — read the
  // resolved purpose_strategy.id from metadata and look up the
  // matching render strategy. Slides for carousels and infographics
  // share the same buildOverlaySvg entry point as image rendering, so
  // the same strategy modifiers apply per slide.
  const { resolveRenderStrategy: resolveRenderStrategySlide } =
    require('./creator/renderStrategyRegistry') as typeof import('./creator/renderStrategyRegistry');
  const slideBundleMeta = safeObject(safeObject(input.metadata.media_bundle).metadata);
  const slidePurposeStrategyId =
    (typeof slideBundleMeta.purpose_strategy === 'object' && slideBundleMeta.purpose_strategy !== null
      ? String((slideBundleMeta.purpose_strategy as Record<string, unknown>).id || '')
      : '') ||
    (typeof input.metadata.purpose_strategy === 'object' && input.metadata.purpose_strategy !== null
      ? String((input.metadata.purpose_strategy as Record<string, unknown>).id || '')
      : '');
  const slideRenderStrategyRaw = resolveRenderStrategySlide(slidePurposeStrategyId || null);
  // ── Variant overlay (PHASE 4) — carousel/infographic slide path ──
  // Mirrors the image-flow composition above. Reads `variant_family`
  // / `variant_id` from the slide metadata bundle and overlays the
  // variant profile on top of the slide's RenderStrategyModifiers.
  const slideVariantFamily = (() => {
    const meta = slideBundleMeta as Record<string, unknown>;
    const fromMeta = meta.variant_family;
    if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta;
    const purposeStrategyMeta = meta.purpose_strategy && typeof meta.purpose_strategy === 'object'
      ? (meta.purpose_strategy as Record<string, unknown>)
      : null;
    const fromPurpose = purposeStrategyMeta?.variant_family;
    return typeof fromPurpose === 'string' && fromPurpose.length > 0 ? fromPurpose : null;
  })();
  const slideVariantIdMeta = (() => {
    const meta = slideBundleMeta as Record<string, unknown>;
    const fromMeta = meta.variant_id;
    return typeof fromMeta === 'string' && fromMeta.length > 0 ? fromMeta : null;
  })();
  const { resolveVariant: _slideResolveVariant, resolveVariantByFamily: _slideResolveVariantByFamily } =
    require('./creator/variantRegistry') as typeof import('./creator/variantRegistry');
  const { resolveVariantStrategyProfile: _slideResolveProfile, composeVariantOntoStrategyModifiers: _slideCompose } =
    require('./creator/variantStrategyProfiles') as typeof import('./creator/variantStrategyProfiles');
  const slideVariant =
    _slideResolveVariant(slideVariantIdMeta)
    ?? _slideResolveVariantByFamily(slidePurposeStrategyId || null, slideVariantFamily);
  const slideVariantProfile = _slideResolveProfile(slideVariant?.variant_id ?? null);
  const slideRenderStrategy = slideRenderStrategyRaw && slideVariantProfile
    ? {
        ...slideRenderStrategyRaw,
        modifiers: _slideCompose(slideRenderStrategyRaw.modifiers, slideVariantProfile),
      }
    : slideRenderStrategyRaw;
  const overlayRender = buildOverlaySvg({
    width: input.width,
    height: input.height,
    overlay,
    brandKit: input.brandKit,
    platform,
    fileNamePrefix: input.fileNamePrefix === 'pdf' ? 'infographic' : 'carousel',
    renderStrategy: slideRenderStrategy,
    slideIndex: input.index,
    slideTotal: input.total,
    deckContext: input.deckContext,
    // Activate the carousel visual language: overlay base preset from the
    // resolved carouselStyle, and the continuity wave gated by its decoration.
    imageStyle: input.carouselStyle ? carouselOverlayBaseStyle(input.carouselStyle) : undefined,
    waveEnabled: input.carouselStyle ? input.carouselStyle.decoration.wave.enabled : undefined,
  });
  const brandMark = await loadBrandMark({
    brandKit: input.brandKit,
    placement: overlayRender.brandPlacement,
  });
  const composites: Array<{ input: Buffer; top: number; left: number }> = [
    { input: Buffer.from(overlayRender.svg), top: 0, left: 0 },
  ];
  // Operator feedback: middle slides (2..N-1) were showing an empty
  // patchwork rectangle because the brand mark was suppressed for
  // those frames but the SVG overlay still painted a backing tile.
  // The backing tile has been removed entirely (logos now keep their
  // own transparent edge), and the logo is composited on EVERY slide
  // in the deck for brand continuity — not just the first/last.
  if (brandMark) {
    composites.push({ input: brandMark, top: overlayRender.brandPlacement.top, left: overlayRender.brandPlacement.left });
  }
  const buffer = await sharp(background)
    .composite(composites)
    .png()
    .toBuffer();
  return { buffer, quality: overlayRender.quality };
}

async function createPdfBuffer(input: {
  title: string;
  items: Array<Record<string, string>>;
  brandKit: CreatorBrandKit;
  cta: string;
}): Promise<Buffer> {
  const brandMark = await loadBrandMark({
    brandKit: input.brandKit,
    placement: { maxWidth: 96, maxHeight: 48 },
  }).catch(() => null);
  return new Promise((resolve, reject) => {
    const primary = input.brandKit.normalizedPalette[0] || '#111827';
    const accent = input.brandKit.accentColor;
    const pdfFont = input.brandKit.typography.pdfFont || 'Helvetica';
    const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: input.title } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8fafc');
    if (brandMark) {
      doc.image(brandMark, 462, 48, { fit: [96, 48] });
    }
    doc.fillColor(primary).font(`${pdfFont}-Bold`).fontSize(32).text(input.title, 54, 86, { width: 500 });
    if (input.brandKit.companyName) {
      doc.fillColor(accent).font(`${pdfFont}-Bold`).fontSize(12).text(input.brandKit.companyName.toUpperCase(), 54, 54, { characterSpacing: 1.2 });
    }
    if (input.brandKit.domain || input.brandKit.tone) {
      doc.fillColor('#475569').font(pdfFont).fontSize(14).text(input.brandKit.domain || input.brandKit.tone, 54, 178, { width: 460 });
    }
    doc.roundedRect(54, 248, 504, 110, 14).fill('#ffffff').stroke('#e2e8f0');
    doc.fillColor('#0f172a').font(`${pdfFont}-Bold`).fontSize(18).text(input.items[0]?.headline || 'Overview', 78, 276, { width: 456 });
    doc.fillColor('#475569').font(pdfFont).fontSize(12).text(input.items[0]?.body || '', 78, 308, { width: 456, lineGap: 4 });

    input.items.forEach((item, index) => {
      doc.addPage({ size: 'LETTER', margin: 54 });
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff');
      if (brandMark) doc.image(brandMark, 478, 46, { fit: [80, 38] });
      doc.fillColor(accent).font(`${pdfFont}-Bold`).fontSize(11).text(`${item.role || 'SECTION'} ${index + 1}`.toUpperCase(), 54, 54, { characterSpacing: 1.1 });
      doc.fillColor(primary).font(`${pdfFont}-Bold`).fontSize(25).text(item.headline, 54, 86, { width: 500, lineGap: 4 });
      doc.moveTo(54, 154).lineTo(558, 154).lineWidth(2).strokeColor(accent).stroke();
      doc.fillColor('#334155').font(pdfFont).fontSize(13).text(item.body, 54, 184, { width: 500, lineGap: 6 });
      if (item.designNote) {
        doc.roundedRect(54, 492, 504, 86, 12).fill('#f1f5f9').stroke('#e2e8f0');
        doc.fillColor('#475569').font(`${pdfFont}-Bold`).fontSize(11).text('Creative note', 76, 516);
        doc.fillColor('#64748b').font(pdfFont).fontSize(11).text(item.designNote, 76, 536, { width: 456 });
      }
      doc.fillColor('#94a3b8').font(pdfFont).fontSize(9).text(input.brandKit.companyName || 'Creator asset', 54, 724);
    });

    doc.addPage({ size: 'LETTER', margin: 54 });
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(primary);
    if (brandMark) doc.image(brandMark, 54, 118, { fit: [106, 54] });
    doc.fillColor('#ffffff').font(`${pdfFont}-Bold`).fontSize(30).text(input.cta || 'Take the next step', 54, 220, { width: 500 });
    doc.fillColor('#cbd5e1').font(pdfFont).fontSize(14).text(input.brandKit.domain || input.brandKit.companyName || input.title, 54, 290, { width: 500, lineGap: 5 });
    doc.end();
  });
}

async function composeStructuredDeckAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
  items: Array<Record<string, unknown>>,
  fallbackLabel: string,
  fileNamePrefix: 'carousel' | 'pdf' | 'slider',
  rendererId: string,
): Promise<RenderedMediaBundle> {
  const metadata = safeObject(safeObject(assetPayload.media_bundle).metadata);
  const platform = compactText(metadata.platform || metadata.primary_platform, 'linkedin');
  // Phase 4D-B — final visual consumer. The deck composer (carousel / slider /
  // deck-PDF — NOT the separate report system in backend/services/export) adopts
  // the BrandRuntime via the 1C adapter when a published brand_identity row
  // exists; otherwise the exact legacy resolver path (defaults byte-identical).
  // Same source guard as 4A/4B/4D-A. Accent already flows canonically through
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
  const renderItems = normalizeStructuredItems(items, fallbackLabel, fileNamePrefix, metadata);
  // Canonical Template visual language (carousel/slider/pdf). Default style ==
  // prior canvas constants → byte-identical.
  const carouselStyle = resolveCarouselRenderStyle(metadata);
  const deckCanvas = fileNamePrefix === 'slider' ? carouselStyle.canvas.slider
    : fileNamePrefix === 'pdf' ? carouselStyle.canvas.pdf
    : carouselStyle.canvas.carousel;
  const width = deckCanvas.width;
  const height = deckCanvas.height;
  const files: string[] = [];
  const qualityReports: OverlayQualityReport[] = [];
  const slideOcrResults: Array<Awaited<ReturnType<typeof runCreatorOcr>>> = [];
  // Operator feedback: "[the renderer] should be aware of all the
  // five slides so that we can bring the consistency into the text
  // format". Compute deck-wide context ONCE so every slide picks the
  // same font scale and the wave waypoints flow continuously across
  // the deck (slide N's right-edge wave-Y === slide N+1's left-edge
  // wave-Y, so the curve reads as one continuous flowing line).
  const deckContext = buildDeckRenderContext({
    renderItems,
    width,
    height,
  });
  for (let index = 0; index < renderItems.length; index += 1) {
    const rendered = await renderStructuredSlidePng({
      item: renderItems[index],
      index,
      total: renderItems.length,
      metadata,
      assetPayload,
      fileNamePrefix,
      width,
      height,
      brandKit,
      deckContext,
      carouselStyle,
    });
    qualityReports.push(rendered.quality);
    const url = await uploadRenderedPng({
      fileBuffer: rendered.buffer,
      campaignId: options.campaignId,
      userId: options.userId,
      companyId: options.companyId,
      fileNamePrefix: `${fileNamePrefix}-${index + 1}`,
      metadata: {
        width,
        height,
        preview_kind: fileNamePrefix === 'slider' ? 'slide_deck_page' : fileNamePrefix === 'pdf' ? 'pdf_page_preview' : 'carousel_slide',
        slide_number: index + 1,
        role: renderItems[index].role,
        platform,
        overlay_quality: rendered.quality,
        ...buildCreatorBrandKitMetadata(brandKit, {
          platform,
          overlayConfiguration: {
            ...brandKit.overlayStrategy,
            slide_number: index + 1,
            role: renderItems[index].role,
          },
          exportCapabilities: ['preview', 'download', 'save_as_asset'],
        }),
      },
    });
    const slideOcr = await runCreatorOcr({
      image: rendered.buffer,
      assetType: fileNamePrefix,
      platform,
      attachmentMode: 'embedded_copy',
      mimeType: 'image/png',
    });
    slideOcrResults.push(slideOcr);
    files.push(url);
  }

  // Part 3 — PDF preview + downloadable graceful degradation.
  //
  // Storage layer policies (Supabase bucket MIME allow-list, IAM, transient
  // network failures) can reject the `application/pdf` upload AFTER the
  // page previews have already been uploaded successfully. The renderer
  // must keep:
  //   - `files`        — the per-page PNG previews,
  //   - `preview_kind` — `'pdf_document'`,
  //   - `overlay_*`    — the overlay quality report,
  // intact so the Writer's attached-asset chip still works and the user
  // can SEE every page even when the downloadable PDF link is unavailable.
  //
  // We classify the failure into one of:
  //   - 'storage_mime_blocked' — the storage allow-list rejected `application/pdf`,
  //   - 'storage_permission'   — auth / IAM rejected the write,
  //   - 'storage_unavailable'  — transient (timeout, 5xx, network),
  //   - 'unknown_storage_error' — anything else.
  // The classification + a user-safe message land in the metadata block
  // so the UI can render a precise "preview available, download
  // unavailable" status instead of silently dropping the document URL.
  let documentUrl: string | undefined;
  let documentFallbackReason: string | undefined;
  let documentFallbackCategory: 'storage_mime_blocked' | 'storage_permission' | 'storage_unavailable' | 'unknown_storage_error' | undefined;
  let documentUserMessage: string | undefined;
  if (fileNamePrefix === 'pdf') {
    const pdfBuffer = await createPdfBuffer({
      title: compactText(metadata.topic || renderItems[0]?.headline || fallbackLabel, fallbackLabel),
      items: renderItems,
      brandKit,
      cta: compactText(metadata.cta || renderItems[renderItems.length - 1]?.headline || 'Take the next step'),
    });
    try {
      documentUrl = await uploadRenderedFile({
        fileBuffer: pdfBuffer,
        campaignId: options.campaignId,
        userId: options.userId,
        companyId: options.companyId,
        fileNamePrefix: 'pdf-document',
        extension: 'pdf',
        contentType: 'application/pdf',
      });
    } catch (error) {
      documentFallbackReason = error instanceof Error ? error.message : String(error);
      documentFallbackCategory = classifyPdfStorageFailure(documentFallbackReason);
      documentUserMessage = USER_MESSAGE_FOR_PDF_FALLBACK[documentFallbackCategory];
      // Loud structured log so an operator-side dashboard can pivot on
      // category. Page previews are unaffected.
      console.warn('[creator-asset-renderer][pdf-upload-failed]', {
        message:  documentFallbackReason,
        category: documentFallbackCategory,
        previewPagesAvailable: files.length,
      });
      creatorEvent('pdf_upload', 'fallback', {
        assetType:   'pdf',
        creatorType: 'pdf',
        platform,
        category: documentFallbackCategory,
        message:  documentFallbackReason,
        previewPagesAvailable: files.length,
      });
    }
  }

  // Compute PDF-availability flags. When the document upload failed,
  // exportCapabilities drops 'download' / 'pdf_document' so the UI can
  // render the correct affordances (preview-only, no download button).
  const pdfDownloadAvailable = fileNamePrefix === 'pdf' && Boolean(documentUrl);
  const pdfDownloadAttempted = fileNamePrefix === 'pdf';
  const exportCapabilities = fileNamePrefix === 'pdf'
    ? (pdfDownloadAvailable
        ? ['preview', 'download', 'save_as_asset', 'pdf_document']
        : ['preview', 'save_as_asset', 'pdf_preview_only'])
    : ['preview', 'download', 'save_as_asset'];

  const avgQuality = {
    score: Math.round(qualityReports.reduce((sum, report) => sum + report.score, 0) / Math.max(1, qualityReports.length)),
    flags: Array.from(new Set(qualityReports.flatMap((report) => report.flags))).slice(0, 8),
    text_units: Math.round(qualityReports.reduce((sum, report) => sum + report.text_units, 0) / Math.max(1, qualityReports.length)),
    preset: fileNamePrefix,
  };
  const textBlocks = renderItems.flatMap((item) => [item.headline, item.body]).filter(Boolean);
  // Operator feedback fix: density scoring was producing
  // 'text_density_exceeds_profile' / 'platform_density_mismatch' /
  // 'visual_cleanliness_low' / 'visual_hierarchy_weak' warnings even
  // when each individual slide was within budget. Root cause: the
  // scorer was comparing the SUM of every slide's words against the
  // per-slide cap (`maxWordsPerSlide=34` for carousel). For a 5-slide
  // deck where each slide has ~12 words, the deck total was ~60 which
  // exceeded the per-slide budget by ~1.8×, lighting up every density
  // warning.
  //
  // Fix: evaluate density against a representative single slide
  // (the median, by word count) so the score reflects per-slide
  // composition — which is what `maxWordsPerSlide` was always meant
  // to gate. The full deck text still flows through
  // `estimateTextAreaPercent` for cumulative pixel-coverage signals.
  const perSlideTextBlocks: string[][] = renderItems.map((item) => [item.headline, item.body].filter(Boolean));
  const wordCountOf = (s: string): number => String(s || '').trim().split(/\s+/).filter(Boolean).length;
  const slideWordCounts = perSlideTextBlocks.map((blocks) => blocks.reduce((sum, t) => sum + wordCountOf(t), 0));
  const medianIndex = (() => {
    if (slideWordCounts.length === 0) return 0;
    const ranked = slideWordCounts
      .map((count, idx) => ({ count, idx }))
      .sort((a, b) => a.count - b.count);
    return ranked[Math.floor(ranked.length / 2)].idx;
  })();
  const representativeBlocks = perSlideTextBlocks[medianIndex] ?? [];

  const visualGovernance = validateVisualGovernance({
    assetType: fileNamePrefix,
    platform,
    textBlocks: representativeBlocks,
    hasCTA: renderItems.some((item) => /cta|next step|learn more|book/i.test(`${item.role} ${item.headline} ${item.body}`)),
    textAreaPercent: estimateTextAreaPercent({ textBlocks: representativeBlocks, width, height }),
    paragraphCount: renderItems.filter((item) => item.body.length > 130).length,
    overlapRisk: avgQuality.flags.includes('severe_layout_overflow_risk'),
    tinyTextRisk: avgQuality.flags.includes('headline_likely_unreadable_mobile'),
  });
  const quality = scoreCreatorQuality({
    assetType: fileNamePrefix,
    platform,
    textBlocks: representativeBlocks,
    hasCTA: renderItems.some((item) => /cta|next step|learn more|book/i.test(`${item.role} ${item.headline} ${item.body}`)),
    overlapRisk: avgQuality.flags.includes('severe_layout_overflow_risk'),
    tinyTextRisk: avgQuality.flags.includes('headline_likely_unreadable_mobile'),
  });
  const platformGeometry = resolvePlatformGeometryProfile(platform);
  const geometry = validateLayoutGeometry({
    width,
    height,
    boxes: renderItems.slice(0, 3).map((item, index) => estimateTextBox({
      id: `slide_${index + 1}`,
      text: `${item.headline} ${item.body}`,
      x: platformGeometry.margin,
      y: platformTextBoxY({ platform, index, baseY: 150 }),
      maxWidth: width - platformGeometry.margin * 2,
      fontSize: Math.round((fileNamePrefix === 'slider' ? 28 : 24) * platformGeometry.bodyScale),
      maxLines: 4,
      role: item.role,
    })),
    foreground: '#ffffff',
    background: brandKit.normalizedPalette[0] || '#111827',
    minFontSize: fileNamePrefix === 'pdf' ? 11 : 18,
  });
  const providerTextValidation = {
    ok: slideOcrResults.every((result) => result.ok),
    flags: Array.from(new Set(slideOcrResults.flatMap((result) => result.flags))),
    mode: 'embedded_copy' as const,
    confidence: slideOcrResults.length
      ? Math.min(...slideOcrResults.map((result) => result.confidence))
      : undefined,
    provider: slideOcrResults.find((result) => result.provider !== 'unavailable')?.provider ?? 'unavailable',
  };
  const accessibilityValidation = validateCreatorAccessibility({
    altText: compactText(metadata.topic || renderItems[0]?.headline || fallbackLabel, fallbackLabel),
    readingOrder: renderItems.map((item, index) => `slide_${index + 1}:${item.role}`),
    minFontSize: fileNamePrefix === 'pdf' ? 16 : 18,
    contrastRatio: geometry.contrastRatio,
  });
  const manifest = createRenderManifest({
    rendererId,
    platformProfile: resolvePlatformVisualProfile(platform) as unknown as Record<string, unknown>,
    governanceProfile: resolveAssetGovernanceProfile(fileNamePrefix) as unknown as Record<string, unknown>,
    qualityScore: quality,
    validationResult: visualGovernance,
    ocrResult: providerTextValidation,
    typographySafetyResult: geometry,
    transformIntent: typeof metadata.source_text_transform === 'string' ? metadata.source_text_transform : null,
    exportMetadata: { width, height, item_count: files.length, document_url: documentUrl },
    altText: compactText(metadata.topic || renderItems[0]?.headline || fallbackLabel, fallbackLabel),
    readingOrder: renderItems.map((item, index) => `slide_${index + 1}:${item.role}`),
    accessibilityValidation,
  });
  if (metadata.writer_asset_type || metadata.attachment_mode) assertRenderManifestExportable(manifest);
  const deckValidationManifest = { governance: visualGovernance, ocr: providerTextValidation, geometry, accessibility: accessibilityValidation, final_ocr_results: slideOcrResults };
  void persistCreatorValidationManifest({
    rendererId,
    assetType: fileNamePrefix,
    platform,
    attachmentMode: typeof metadata.attachment_mode === 'string' ? metadata.attachment_mode : 'embedded_copy',
    renderManifest: manifest as unknown as Record<string, unknown>,
    validationManifest: deckValidationManifest as unknown as Record<string, unknown>,
    auditId: typeof metadata.render_audit_id === 'string' ? metadata.render_audit_id : null,
  });

  return {
    url: files[0],
    files,
    metadata: {
      width,
      height,
      generated_by: 'creatorAssetRenderer',
      preview_kind: fileNamePrefix === 'slider' ? 'slide_deck' : fileNamePrefix === 'pdf' ? 'pdf_document' : 'carousel_deck',
      item_count: files.length,
      document_url: documentUrl,
      document_fallback_reason: documentFallbackReason,
      // Part 3 — structured PDF availability block. Clients render:
      //   - pdf_document_status: 'available' | 'preview_only'
      //   - pdf_document_fallback_category: machine-readable bucket
      //   - pdf_document_user_message: ready-to-display copy
      //   - pdf_preview_pages_available: page count regardless of doc status
      pdf_document_status: pdfDownloadAttempted
        ? (pdfDownloadAvailable ? 'available' : 'preview_only')
        : undefined,
      pdf_document_fallback_category: documentFallbackCategory,
      pdf_document_user_message: documentUserMessage,
      pdf_preview_pages_available: pdfDownloadAttempted ? files.length : undefined,
      preview_export_parity: {
        parity_version: 'creator-render-parity-v1',
        brandkit: true,
        typography: true,
        overlay: true,
        logo: true,
        footer_identity: true,
        export_mode: fileNamePrefix === 'pdf' ? (pdfDownloadAvailable ? 'pdf_document' : 'preview_only') : fileNamePrefix,
        verified_at: new Date().toISOString(),
      },
      overlay_renderer: 'deterministic_svg_v1',
      overlay_quality: avgQuality,
      // Per-slide overlay quality reports — additive, so post-render visual
      // validation can validate every slide independently (one failing slide
      // fails the carousel).
      overlay_quality_reports: qualityReports,
      platform_visual_profile: resolvePlatformVisualProfile(platform),
      creator_quality_score: quality,
      visual_governance: visualGovernance,
      visual_governance_warnings: buildPreviewGovernanceWarnings({ validation: visualGovernance, quality }),
      validation_manifest: deckValidationManifest,
      accessibility_manifest: accessibilityValidation,
      final_ocr_results: slideOcrResults,
      render_manifest: manifest,
      renderer_id: rendererId,
      ...buildCreatorBrandKitMetadata(brandKit, {
        platform,
        overlayConfiguration: {
          ...brandKit.overlayStrategy,
          item_count: files.length,
          asset_type: fileNamePrefix,
        },
        exportCapabilities,
      }),
    },
  };
}

async function renderCarouselAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
  items: Array<Record<string, unknown>>,
): Promise<RenderedMediaBundle> {
  return composeStructuredDeckAsset(assetPayload, options, items, 'Creator carousel asset', 'carousel', getCreatorRendererRegistration('carousel').rendererId);
}

async function renderPdfAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
  items: Array<Record<string, unknown>>,
): Promise<RenderedMediaBundle> {
  return composeStructuredDeckAsset(assetPayload, options, items, 'Creator PDF asset', 'pdf', getCreatorRendererRegistration('pdf').rendererId);
}

async function renderSliderAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
  items: Array<Record<string, unknown>>,
): Promise<RenderedMediaBundle> {
  return composeStructuredDeckAsset(assetPayload, options, items, 'Creator slider asset', 'slider', getCreatorRendererRegistration('slider').rendererId);
}

type InfographicSection = {
  title: string;
  body: string;
  icon: string;
};

/**
 * CREATOR-114 — canonical content planner. The SAMPLE's semantic structure decides WHICH
 * and HOW MANY slots exist (3 KPIs for stats, 4 steps for process, 2 sides for
 * comparison…). The brief fills the slots in order; missing slots degrade to a neutral
 * placeholder (never a different block type). The renderer renders EXACTLY these slots —
 * it never invents extra generic sections. The LLM (composeInfographicCopy) enriches the
 * slot text downstream; it does not change the count or the structure.
 */
function planInfographicContent(briefSections: InfographicSection[], slotCount: number, topic: string): InfographicSection[] {
  const out: InfographicSection[] = [];
  for (let i = 0; i < slotCount; i++) {
    const src = briefSections[i];
    out.push({
      title: (src?.title || '').trim() || `${topic} — point ${i + 1}`,
      body: src?.body || '',
      icon: ['01', '02', '03', '04', '05', '06', '07', '08'][i] ?? String(i + 1).padStart(2, '0'),
    });
  }
  return out;
}

function resolveInfographicSections(assetPayload: Record<string, unknown>, metadata: Record<string, unknown>): InfographicSection[] {
  const overlay = normalizeOverlayText({
    assetPayload,
    metadata,
    title: String(metadata.topic || 'Infographic'),
    body: String(metadata.summary || ''),
  });
  const rawTransform = safeObject(metadata.thread_visual_transform);
  const transformItems = Array.isArray(rawTransform.items)
    ? rawTransform.items.map((item) => compactText(item, '')).filter(Boolean)
    : [];
  const rawSource = transformItems.length > 0
    ? transformItems
    : [overlay.hook, overlay.headline, overlay.keyInsight, overlay.supportingText].filter(Boolean);
  // Dedupe near-identical items so a sparse overlay (e.g. hook===headline===
  // topic) doesn't yield two identical cards. Key on the normalized prefix.
  const seen = new Set<string>();
  const source = rawSource.filter((item) => {
    const key = compactText(item, '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const clipped = source.slice(0, 6).map((item, index) => {
    // Only split title/body on an explicit "Label: detail" form. Without a
    // colon, the item is the TITLE and the body is left empty so the copy
    // composer's lead fills it — never duplicate the title verbatim as body
    // (the previous behavior rendered the same sentence twice per card).
    const hasColon = item.includes(':');
    return {
      title: compactText(hasColon ? item.split(':')[0] : item, `Section ${index + 1}`).slice(0, 52),
      body: hasColon ? compactText(item.split(':').slice(1).join(':'), '').slice(0, 120) : '',
      icon: ['01', '02', '03', '04', '05', '06'][index] ?? String(index + 1).padStart(2, '0'),
    };
  });
  // A sparse overlay (hook≈headline≈topic) collapses to 1-2 cards, leaving most of
  // the canvas empty. Pad to a MINIMUM of 4 sections with standard explainer aspects
  // so the layout is a full grid; the copy composer fills each with topic-adaptive
  // content (bullets/impact/example), so these are real cards, not blank padding.
  const MIN_SECTIONS = 4;
  const DEFAULT_ASPECTS = ['The core idea', 'Why it matters', 'How to apply it', 'What to watch for'];
  const base = clipped.length > 0 ? clipped : [{ title: 'The core idea', body: '', icon: '01' }];
  const usedTitles = new Set(base.map((s) => s.title.toLowerCase().trim()));
  for (let i = 0; base.length < MIN_SECTIONS && i < DEFAULT_ASPECTS.length; i++) {
    const title = DEFAULT_ASPECTS[i];
    if (usedTitles.has(title.toLowerCase())) continue;
    usedTitles.add(title.toLowerCase());
    base.push({ title, body: '', icon: ['01', '02', '03', '04', '05', '06'][base.length] ?? String(base.length + 1).padStart(2, '0') });
  }
  return base;
}

const INFOGRAPHIC_LAYOUTS = ['stats', 'comparison', 'process', 'framework', 'hierarchy', 'timeline'] as const;

/**
 * Pick a layout that VARIES per infographic so a campaign's infographics don't all look
 * like the same 2×2 grid (operator feedback: "different format and style each time").
 * First honour the content — a comparison/process/timeline/stats/hierarchy topic gets the
 * matching engine (each uses genuinely different visual elements: graphs & donuts, a
 * milestone rail, numbered steps, two-column, indented tiers). When the topic doesn't
 * imply one, rotate deterministically by a hash of the topic, so different topics land on
 * different layouts while the SAME topic always re-renders identically.
 */
// With the two-pass content-fit (masonry + 2-column bullets) pass, every engine now renders
// dense, so generic topics rotate across the FULL set for maximum format variety.
const GENERIC_INFOGRAPHIC_ROTATION = ['stats', 'framework', 'process', 'timeline', 'hierarchy', 'comparison'] as const;

export function pickVariedInfographicLayout(topic: string): string {
  const t = String(topic || '').toLowerCase();
  // Content-appropriate engines first — a topic that clearly implies a structure gets it, so
  // the specialised layout is filled by matching content.
  if (/\bvs\b|versus|compare|comparison|pros?\s*(and|&|vs)?\s*cons|before\s*(and|&)?\s*after/.test(t)) return 'comparison';
  if (/\bstep\b|step[-\s]?by[-\s]?step|how\s*to|workflow|stages?\b|playbook|checklist/.test(t)) return 'process';
  if (/timeline|roadmap|history|evolution|journey|over\s*time|milestones?\b/.test(t)) return 'timeline';
  if (/hierarchy|tiers?\b|pyramid|maturity\s*(model|levels?)/.test(t)) return 'hierarchy';
  if (/\d+\s*%|\bkpi\b|by the numbers|statistics?\b|benchmark/.test(t)) return 'stats';
  // Generic topics rotate deterministically across ALL engines (hash of topic) for variety.
  let h = 0;
  for (let i = 0; i < t.length; i += 1) h = (Math.imul(h, 31) + t.charCodeAt(i)) >>> 0;
  return GENERIC_INFOGRAPHIC_ROTATION[h % GENERIC_INFOGRAPHIC_ROTATION.length];
}

function resolveInfographicLayout(metadata: Record<string, unknown>): string {
  // CREATOR-127: a resolved curated TEMPLATE drives the layout directly (no blueprint).
  const dt = curatedDesignTemplate(metadata);
  if (dt?.renderingContract.infographicLayout) return dt.renderingContract.infographicLayout;
  // CREATOR-106 (RULE 4): once a Marketing Sample is chosen, the SAMPLE determines the
  // layout structure — different samples produce genuinely different layout engines,
  // never the same generic grid. No fallback generator runs while a blueprint is set.
  const bp = blueprintIdForRender(metadata);
  if (bp) return infographicLayoutForBlueprint(bp);
  // RULE 7: blueprint_id == null. Honour an explicit per-asset layout when the generator
  // set one; otherwise pick a VARIED, content-aware layout (was hardcoded 'framework',
  // which made every generic infographic identical).
  const requested = String(metadata.infographic_layout || safeObject(metadata.creator_card).infographic_layout || '').trim().toLowerCase();
  if ((INFOGRAPHIC_LAYOUTS as readonly string[]).includes(requested)) return requested;
  return pickVariedInfographicLayout(String(metadata.topic || safeObject(metadata.creator_card).topic || ''));
}

function validateInfographicDensity(
  sections: Array<InfographicSection & { bullets?: unknown; impact?: unknown; example?: unknown; take?: unknown }>,
): { ok: boolean; flags: string[]; contentTooThin: boolean } {
  const flags: string[] = [];
  // Density (too MUCH) stays a per-card overflow signal → title + body only, as before.
  const bodyChars = sections.reduce((sum, section) => sum + section.title.length + section.body.length, 0);
  if (sections.length > 6) flags.push('too_many_sections');
  if (bodyChars > 760) flags.push('text_density_exceeds_infographic_bounds');
  if (sections.some((section) => section.body.length > 140)) flags.push('section_body_too_long');
  // WATCHDOG (inverse of density): a near-EMPTY infographic renders as a title over
  // mostly-blank canvas. Measure the FULL content the renderer actually draws — body/
  // lead + bullets + impact + example + take — so a rich "busy" card is never
  // mis-flagged as thin, while a genuinely sparse card is caught.
  const strLen = (v: unknown): number => (typeof v === 'string' ? v.length : 0);
  const richChars = sections.reduce<number>((sum, section) => {
    const bulletsLen = Array.isArray(section.bullets)
      ? (section.bullets as unknown[]).reduce<number>((n, b) => n + strLen(b), 0)
      : 0;
    return sum + section.title.length + section.body.length + bulletsLen + strLen(section.impact) + strLen(section.example) + strLen(section.take);
  }, 0);
  const contentTooThin = richChars < 260;
  if (contentTooThin) flags.push('infographic_content_too_thin');
  return { ok: flags.length === 0, flags, contentTooThin };
}

/**
 * Operator feedback fix: cards were rendering at ~220px tall in the
 * top quarter of a 1200px canvas — leaving ~70% of the canvas empty
 * white space. Every layout below now SIZES TO FILL the safe area
 * between the header band (top ~140px) and the bottom margin
 * (~80px), giving each card real visual presence instead of looking
 * like dropped text boxes.
 *
 * Formula: `availableH = height - headerH - bottomH`. Cards are then
 * `floor((availableH - gap*(rows-1)) / rows)` tall. With 4 stat cards
 * laid out as 2×2 on a 1200×1200 canvas → each card ~460px tall.
 * Same math applies to every layout.
 */
function resolveInfographicEngine(input: {
  layout: string;
  width: number;
  height: number;
  sectionCount: number;
  headerH?: number;
  /** Resolved from the template style's spacing; default to prior literals. */
  sideMargin?: number;
  bottomMargin?: number;
  /** Per-layout engine geometry (gaps / minimums / offsets). Default == prior literals. */
  geometry?: InfographicEngineGeometry;
  /** CREATOR-107: sample-composition geometry. When a blueprint is selected the grid
   *  columns + spacing come from the SAMPLE, so same-engine samples still differ.
   *  Both undefined (blueprint_id == null) → prior generic geometry, byte-identical. */
  columnsOverride?: number;
  gapScale?: number;
  /** CREATOR-116: role-derived max card height. Cards are capped at this and the grid is
   *  centered in the available area, so a concise role (a KPI) renders compact instead of
   *  stretching to legacy paragraph height. undefined → fill the canvas (prior behavior). */
  maxCardHeight?: number;
}): {
  engineId: string;
  cardWidth: number;
  cardHeight: number;
  /** Grid rows + the vertical gap between them + the layout's card-height floor —
   *  exposed so the caller can derive a content-fit canvas height (≈10% white space). */
  rows: number;
  rowGap: number;
  minCardHeight: number;
  position: (index: number) => { x: number; y: number; iconZone: 'left' | 'top' | 'center' };
} {
  const count = Math.max(1, input.sectionCount);
  const headerH = input.headerH ?? 150;
  const bottomMargin = input.bottomMargin ?? 90;
  const sideMargin = input.sideMargin ?? 80;
  const geom = input.geometry ?? DEFAULT_INFOGRAPHIC_STYLE.geometry.engine;
  const gs = typeof input.gapScale === 'number' && input.gapScale > 0 ? input.gapScale : 1; // CREATOR-107
  const availableH = input.height - headerH - bottomMargin;
  const availableW = input.width - sideMargin * 2;
  // CREATOR-116: cap the filled card height at the role's preferred max and vertically
  // center the grid (extra space becomes balanced margin, not stretched cards).
  const capCenter = (rawCardH: number, rows: number, gap: number): { cardH: number; vOff: number } => {
    const cardH = input.maxCardHeight && input.maxCardHeight > 0 ? Math.min(rawCardH, input.maxCardHeight) : rawCardH;
    const vOff = Math.max(0, Math.floor((availableH - (rows * cardH + gap * Math.max(0, rows - 1))) / 2));
    return { cardH, vOff };
  };

  if (input.layout === 'timeline') {
    const g = geom.timeline;
    const rows = count;
    const gap = g.gap * gs;
    const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gap * (rows - 1)) / rows)), rows, gap);
    return {
      engineId: 'infographic-timeline-engine-v2',
      cardWidth: availableW - g.railOffset,
      cardHeight: cardH,
      rows, rowGap: gap, minCardHeight: g.minCardHeight,
      position: (index) => ({ x: sideMargin + g.railOffset, y: headerH + vOff + index * (cardH + gap), iconZone: 'left' }),
    };
  }
  if (input.layout === 'process') {
    const g = geom.process;
    const rows = count;
    const gap = g.gap * gs; // bigger gap so the arrow connectors have room to breathe
    const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gap * (rows - 1)) / rows)), rows, gap);
    return {
      engineId: 'infographic-process-engine-v2',
      cardWidth: availableW,
      cardHeight: cardH,
      rows, rowGap: gap, minCardHeight: g.minCardHeight,
      position: (index) => ({ x: sideMargin, y: headerH + vOff + index * (cardH + gap), iconZone: 'left' }),
    };
  }
  if (input.layout === 'comparison') {
    const g = geom.comparison;
    const rows = Math.max(1, Math.ceil(count / 2));
    const gap = g.gap * gs;
    const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gap * (rows - 1)) / rows)), rows, gap);
    const colW = Math.floor((availableW - g.columnGap) / 2);
    return {
      engineId: 'infographic-comparison-engine-v2',
      cardWidth: colW,
      cardHeight: cardH,
      rows, rowGap: gap, minCardHeight: g.minCardHeight,
      position: (index) => ({
        x: sideMargin + (index % 2) * (colW + g.columnGap),
        y: headerH + vOff + Math.floor(index / 2) * (cardH + gap),
        iconZone: 'top',
      }),
    };
  }
  if (input.layout === 'stats') {
    const g = geom.stats;
    // 1-2 sections → single row; 3 → 3-col row; 4 → 2×2; 5-6 → 3×2.
    // CREATOR-107: the sample's composition column count overrides the generic grid.
    const cols = input.columnsOverride && count > 1
      ? Math.max(1, Math.min(input.columnsOverride, count))
      : (count <= 2 ? count : count === 3 ? 3 : count === 4 ? 2 : 3);
    const rows = Math.max(1, Math.ceil(count / cols));
    const gapX = g.gapX * gs;
    const gapY = g.gapY * gs;
    const colW = Math.floor((availableW - gapX * (cols - 1)) / cols);
    const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gapY * (rows - 1)) / rows)), rows, gapY);
    return {
      engineId: 'infographic-stats-engine-v2',
      cardWidth: colW,
      cardHeight: cardH,
      rows, rowGap: gapY, minCardHeight: g.minCardHeight,
      position: (index) => ({
        x: sideMargin + (index % cols) * (colW + gapX),
        y: headerH + vOff + Math.floor(index / cols) * (cardH + gapY),
        iconZone: 'center',
      }),
    };
  }
  if (input.layout === 'hierarchy') {
    const g = geom.hierarchy;
    const rows = count;
    const gap = g.gap * gs;
    const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gap * (rows - 1)) / rows)), rows, gap);
    return {
      engineId: 'infographic-hierarchy-engine-v2',
      cardWidth: availableW - g.widthInset,
      cardHeight: cardH,
      rows, rowGap: gap, minCardHeight: g.minCardHeight,
      // Subtle right-indent per step communicates downward flow.
      position: (index) => ({
        x: sideMargin + Math.min(index, g.maxIndentSteps) * g.indentStep,
        y: headerH + vOff + index * (cardH + gap),
        iconZone: 'left',
      }),
    };
  }
  // framework (default) — pillar grid filling the canvas.
  const g = geom.framework;
  // CREATOR-107: the sample's composition column count overrides the generic 2-col grid.
  const cols = count === 1 ? 1 : (input.columnsOverride ? Math.max(1, Math.min(input.columnsOverride, count)) : 2);
  const rows = Math.max(1, Math.ceil(count / cols));
  const gapX = g.gapX * gs;
  const gapY = g.gapY * gs;
  const colW = Math.floor((availableW - gapX * (cols - 1)) / cols);
  const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gapY * (rows - 1)) / rows)), rows, gapY);
  return {
    engineId: 'infographic-framework-engine-v2',
    cardWidth: colW,
    cardHeight: cardH,
    rows, rowGap: gapY, minCardHeight: g.minCardHeight,
    position: (index) => ({
      x: sideMargin + (index % cols) * (colW + gapX),
      y: headerH + vOff + Math.floor(index / cols) * (cardH + gapY),
      iconZone: 'left',
    }),
  };
}

/**
 * Deterministically estimate the pixel height `renderDenseBody` will consume for a
 * section's composed content (lead + bullets + impact/risk + example/take), at the
 * given content width. Mirrors the block-by-block flow in renderDenseBody so the
 * caller can size cards + canvas to the content (≈10% white-space target) instead of
 * stretching a fixed grid. Approximate line-wrap (ceil(len/cpl)); the padding margin
 * absorbs the small error, biased toward slight over-estimate (breathing room, not
 * truncation).
 */
export function estimateDenseBodyHeight(
  s: Record<string, unknown>,
  contentWidth: number,
  style: InfographicStyleSchema,
  fontMul: number,
): number {
  const db = style.geometry.denseBody;
  const r = Math.round;
  const leadSize = r(db.leadSize * fontMul);
  const bulletSize = r(db.bulletSize * fontMul);
  const valSize = r(db.valueSize * fontMul);
  const cpl = (fontPx: number, w: number): number => Math.max(8, Math.floor(w / (fontPx * db.charWidthFactor)));
  const wrap = (text: unknown, fontPx: number, w: number, maxLines: number): number => {
    const t = String(text ?? '').trim();
    if (!t) return 0;
    return Math.min(maxLines, Math.max(1, Math.ceil(t.length / cpl(fontPx, w))));
  };
  let h = 0;
  const stat = s.stat as { value?: unknown } | null | undefined;
  if (stat && String(stat.value ?? '').trim()) h += r(valSize * db.statChipHeightMul) + db.gapAfterStat;
  const lead = String((s as { body?: unknown }).body ?? '').trim();
  if (lead) h += wrap(lead, leadSize, contentWidth, db.leadMaxLines) * r(leadSize * db.leadLineHeightMul) + db.gapAfterLead;
  const bullets = (Array.isArray(s.bullets) ? s.bullets : []).map((b) => String(b ?? '').trim()).filter((b) => b.length >= 4);
  const bulletLineH = r(bulletSize * db.bulletLineHeightMul);
  // Mirror renderDenseBody's 2-column bullets for WIDE cards, else the estimate over-counts
  // bullet height and the card gets a vertical void back.
  const twoCol = contentWidth >= 640 && bullets.length >= 3;
  if (twoCol) {
    const colW = Math.floor((contentWidth - 28) / 2);
    const each = bullets.map((b) => wrap(b, bulletSize, colW - (db.bulletTextIndent + 2), db.bulletMaxLines) * bulletLineH + db.detail.bulletInterGap);
    const half = Math.ceil(each.length / 2);
    const leftH = each.slice(0, half).reduce((a, b) => a + b, 0);
    const rightH = each.slice(half).reduce((a, b) => a + b, 0);
    h += Math.max(leftH, rightH);
  } else {
    for (const b of bullets) {
      h += wrap(b, bulletSize, contentWidth - (db.bulletTextIndent + 2), db.bulletMaxLines) * bulletLineH + db.detail.bulletInterGap;
    }
  }
  const impact = String(s.impact ?? '').trim();
  const risk = String(s.risk ?? '').trim();
  if (impact || risk) {
    const twoUp = Boolean(impact && risk && contentWidth > db.panelTwoUpMinWidth);
    const panelW = twoUp ? Math.floor((contentWidth - db.panelGap) / 2) : contentWidth;
    const innerW = panelW - db.panelInnerInset;
    const valLineH = r(valSize * db.panelValueLineHeightMul);
    const maxLines = Math.max(impact ? wrap(impact, valSize, innerW, db.panelMaxLines) : 0, risk ? wrap(risk, valSize, innerW, db.panelMaxLines) : 0, 1);
    h += db.gapBeforePanels + db.panelHeightBase + maxLines * valLineH + db.panelHeightPad;
  }
  const example = String(s.example ?? '').trim();
  const take = String(s.take ?? '').trim();
  if (example || take) {
    const valLineH = r(valSize * db.footerValueLineHeightMul);
    const lines = wrap(example || take, valSize, contentWidth - db.footerInnerInset, db.footerMaxLines);
    h += db.gapBeforeFooter + db.footerHeightBase + lines * valLineH + db.footerHeightPad;
  }
  return h;
}

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
  const headerTitleText = compactText(metadata.topic, 'Infographic');
  const headerLeftX = HD.leftX;
  const headerZoneW = brandPlacement.left - headerLeftX - HD.zoneRightPad;
  const headerTitleCharsPerLine = Math.max(10, Math.floor(headerZoneW / (titleFontSize * HD.titleCharFactor)));
  const headerTitleLines = balanceTextLines(headerTitleText, headerTitleCharsPerLine, HD.titleMaxLines);
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
