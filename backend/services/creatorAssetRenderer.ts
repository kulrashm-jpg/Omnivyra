import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { config } from '../../config';
import {
  buildCreatorBrandKitMetadata,
  normalizeBrandMark,
  resolveCreatorBrandKit,
  type CreatorBrandKit,
} from './creatorBrandKit';
import { creatorEvent } from './creatorObservation';

const sharp = require('sharp') as typeof import('sharp');
// Loaded only in the server renderer for deterministic downloadable PDF assets.
const PDFDocument = require('pdfkit');

type RenderedMediaBundle = {
  url?: string;
  files?: string[];
  metadata?: Record<string, unknown>;
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
};

type ProviderImageResult =
  | { image: { buffer: Buffer; model: string }; fallbackReason?: never }
  | { image: null; fallbackReason: string };

type RenderOptions = {
  campaignId?: string | null;
  userId?: string | null;
  companyId?: string | null;
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
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
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

function createFallbackUrl(label: string, width: number, height: number): string {
  const text = encodeURIComponent(label.trim() || 'Creator Asset');
  return `${FALLBACK_BASE}/${width}x${height}/111827/ffffff.png?text=${text}`;
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
}): Promise<Buffer> {
  const width = input.width ?? 1200;
  const height = input.height ?? 1200;
  const colors = input.colors?.filter((color) => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 3) || [];
  const primary = colors[0] || '#111827';
  const secondary = colors[1] || '#2563eb';
  const accent = colors[2] || '#14b8a6';
  const variant = parseInt(createHash('sha1').update(input.variantId || 'creator-default').digest('hex').slice(0, 4), 16);
  const topCircleX = width - 130 - (variant % 90);
  const topCircleY = 110 + (variant % 70);
  const bottomCircleX = 110 + (variant % 80);
  const bottomCircleY = height - 150 - (variant % 90);
  const curveLift = 260 + (variant % 90);
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${primary}" />
          <stop offset="58%" stop-color="${secondary}" />
          <stop offset="100%" stop-color="${accent}" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)" />
      <circle cx="${topCircleX}" cy="${topCircleY}" r="${120 + (variant % 38)}" fill="rgba(255,255,255,0.13)" />
      <circle cx="${bottomCircleX}" cy="${bottomCircleY}" r="${92 + (variant % 30)}" fill="rgba(255,255,255,0.1)" />
      <path d="M80 ${height - 300} C260 ${height - curveLift}, 410 ${height - 210}, 590 ${height - 360} S900 ${height - 230}, ${width - 82} ${height - 390}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="12" stroke-linecap="round"/>
    </svg>
  `.trim();
  return sharp(Buffer.from(svg)).png().toBuffer();
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

function normalizeOverlayText(input: {
  assetPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  title: string;
  body: string;
}): Record<string, string> {
  const direct = safeObject(input.assetPayload.overlay_text);
  const metadataOverlay = safeObject(input.metadata.overlay_text);
  const overlay = Object.keys(direct).length > 0 ? direct : metadataOverlay;
  const cta = compactText(overlay.cta || input.metadata.cta || 'Learn more')
    .replace(/\b(click here|submit|read now)\b/gi, 'Learn more')
    .slice(0, 42);
  return {
    hook: compactText(overlay.hook || input.metadata.topic || input.title).slice(0, 76),
    headline: compactText(overlay.headline || input.title).slice(0, 84),
    keyInsight: compactText(overlay.keyInsight || overlay.key_insight || input.body).slice(0, 132),
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

function resolveRenderSize(platform: string, fileNamePrefix: string): { width: number; height: number } {
  const key = String(platform || '').toLowerCase();
  if (fileNamePrefix === 'banner') return { width: 1600, height: 900 };
  if (fileNamePrefix === 'infographic') return { width: 1200, height: 1500 };
  if (key === 'linkedin' || key === 'x' || key === 'twitter' || key === 'reddit') return { width: 1200, height: 675 };
  if (key === 'instagram' || key === 'facebook' || key === 'threads') return { width: 1080, height: 1350 };
  // Pinterest — 2:3 vertical pin canvas. Now a first-class destination
  // because asset-aware activation lets image/carousel posts publish
  // there (Part 1). Previously fell through to the 1:1 default.
  if (key === 'pinterest') return { width: 1000, height: 1500 };
  return { width: 1200, height: 1200 };
}

function getOverlayPreset(
  platform: string,
  fileNamePrefix: string,
  overlay: Record<string, string>,
  subtypeHint?: ImageSubtypeHint | null,
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
  const base: OverlayLayoutPreset = {
    name: dense ? 'balanced-dense' : 'balanced',
    panelWidthRatio: dense ? 0.74 : 0.7,
    panelOpacity: 0.42,
    margin: 86,
    hookSize: 24,
    headlineSize: dense ? 50 : 58,
    insightSize: dense ? 28 : 31,
    supportSize: 24,
    ctaSize: 27,
    maxHeadlineLines: dense ? 3 : 2,
    maxInsightLines: dense ? 3 : 2,
    maxSupportLines: 1,
    headlineChars: dense ? 25 : 22,
    insightChars: dense ? 44 : 40,
    supportChars: 48,
    ctaProminence: 'standard',
    footerMode: 'subtle',
    brandMode: fileNamePrefix === 'image' ? 'compact' : 'standard',
  };

  if (key === 'linkedin') {
    const wideImage = fileNamePrefix === 'image';
    return {
      ...base,
      name: 'linkedin-editorial',
      margin: 54,
      panelWidthRatio: wideImage ? 0.62 : 0.66,
      hookSize: 20,
      headlineSize: dense ? 36 : 42,
      insightSize: wideImage ? 21 : 23,
      supportSize: 19,
      ctaSize: 21,
      headlineChars: dense ? 31 : 28,
      insightChars: wideImage ? 52 : 48,
      maxInsightLines: wideImage ? 1 : 2,
      maxSupportLines: wideImage ? 0 : 1,
      ctaProminence: 'standard',
      footerMode: wideImage ? 'hidden' : 'subtle',
    };
  }
  if (key === 'instagram') {
    return { ...base, name: 'instagram-visual', panelWidthRatio: 0.78, margin: 76, headlineSize: dense ? 48 : 56, insightSize: dense ? 26 : 29, ctaProminence: 'strong', footerMode: 'subtle' };
  }
  if (key === 'facebook') {
    return { ...base, name: 'facebook-community', panelWidthRatio: 0.74, headlineSize: dense ? 50 : 57, ctaProminence: 'strong', footerMode: 'standard' };
  }
  if (key === 'x' || key === 'twitter') {
    return { ...base, name: 'x-compact', margin: 48, panelWidthRatio: 0.56, hookSize: 18, headlineSize: dense ? 34 : 40, insightSize: 20, ctaSize: 19, headlineChars: dense ? 31 : 28, insightChars: 56, maxInsightLines: 1, maxSupportLines: 0, ctaProminence: 'subtle', footerMode: 'hidden', brandMode: 'compact' };
  }
  if (key === 'threads') {
    return { ...base, name: 'threads-clean', panelWidthRatio: 0.64, headlineSize: dense ? 44 : 52, insightSize: 25, insightChars: 52, maxInsightLines: 1, maxSupportLines: 0, ctaProminence: 'subtle', footerMode: 'hidden', brandMode: 'compact' };
  }
  if (key === 'reddit') {
    return { ...base, name: 'reddit-low-brand', margin: 52, panelWidthRatio: 0.6, hookSize: 18, headlineSize: dense ? 34 : 40, insightSize: 20, ctaSize: 19, headlineChars: dense ? 32 : 29, insightChars: 56, maxInsightLines: 1, maxSupportLines: 0, ctaProminence: 'subtle', footerMode: 'hidden', brandMode: 'subtle', panelOpacity: 0.32 };
  }
  // Pinterest — vertical 2:3 canvas; the image is the hero, overlay
  // panel stays tight and lower-half so the visual reads cleanly in
  // pin grids. Now a first-class destination per Phase 2.C asset-
  // aware activation; previously fell through to `base`.
  if (key === 'pinterest') {
    return {
      ...base,
      name: 'pinterest-pin',
      margin: 72,
      panelWidthRatio: 0.72,
      panelOpacity: 0.46,
      hookSize: 20,
      headlineSize: dense ? 44 : 52,
      insightSize: dense ? 24 : 26,
      supportSize: 22,
      ctaSize: 24,
      headlineChars: dense ? 26 : 22,
      insightChars: dense ? 46 : 42,
      maxHeadlineLines: dense ? 3 : 2,
      maxInsightLines: 2,
      maxSupportLines: 0,
      ctaProminence: 'standard',
      footerMode: 'subtle',
      brandMode: 'compact',
    };
  }
  // Per-platform preset finalised above. Layer subtype overrides on top:
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
  ctaWidth: number;
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
  if (input.layoutBottom > input.height - 58) flags.push('severe_layout_overflow_risk');
  if (input.headlineLines.some((line) => line.length < 9) && input.headlineLines.length > 1) flags.push('awkward_headline_wrap');
  if (input.preset.headlineSize < 38) flags.push('headline_likely_unreadable_mobile');
  if (input.ctaWidth < 190 && input.preset.ctaProminence !== 'subtle') flags.push('cta_visually_weak');
  if (input.preset.name.includes('x') && textUnits > 210) flags.push('creative_likely_cluttered_for_x');
  if (input.preset.name.includes('reddit') && input.preset.ctaProminence !== 'subtle') flags.push('reddit_creative_too_ad_like');
  if (/^(creator asset|generated creative asset|learn more)$/i.test(input.overlay.headline) || /^(learn more|read more)$/i.test(input.overlay.cta)) {
    flags.push('looks_too_generic');
  }
  if (textUnits > 280 || (input.headlineLines.length + input.insightLines.length + input.supportLines.length) > 6) {
    flags.push('too_much_overlay');
  }
  if (input.preset.panelOpacity > 0.5 || input.preset.panelWidthRatio > 0.8) flags.push('insufficient_focal_separation');
  if (input.headlineLines.length >= 3 && input.preset.headlineSize > 48) flags.push('headline_dominates_visual');
  if (input.preset.ctaProminence === 'subtle' && input.overlay.cta.length > 30) flags.push('cta_visually_disconnected');
  const severe = flags.filter((flag) => flag.startsWith('severe_')).length;
  const score = Math.max(35, 100 - (flags.length * 10) - (severe * 12) - Math.max(0, textUnits - 230) / 8);
  return {
    score: Math.round(score),
    flags,
    text_units: textUnits,
    preset: input.preset.name,
  };
}

function buildOverlaySvg(input: {
  width: number;
  height: number;
  overlay: Record<string, string>;
  brandKit: CreatorBrandKit;
  platform: string;
  fileNamePrefix: string;
  subtypeHint?: ImageSubtypeHint | null;
}): { svg: string; quality: OverlayQualityReport; brandPlacement: { top: number; left: number; maxWidth: number; maxHeight: number } } {
  const preset = getOverlayPreset(input.platform, input.fileNamePrefix, input.overlay, input.subtypeHint ?? null);
  const overlayStrategy = input.brandKit.overlayStrategy;
  const accent = input.brandKit.accentColor;
  const panelOpacity = Math.max(preset.panelOpacity, overlayStrategy.panelOpacity);
  const panelWidth = Math.round(input.width * preset.panelWidthRatio);
  const panelX = preset.margin;
  const panelY = preset.margin;
  const headlineLines = balanceTextLines(input.overlay.headline, preset.headlineChars, preset.maxHeadlineLines);
  const insightLines = balanceTextLines(input.overlay.keyInsight, preset.insightChars, preset.maxInsightLines);
  const supportLines = preset.maxSupportLines > 0 ? balanceTextLines(input.overlay.supportingText, preset.supportChars, preset.maxSupportLines) : [];
  const hook = input.overlay.hook || input.platform || 'Social creative';
  const stress = headlineLines.length + insightLines.length + supportLines.length;
  const headlineStart = panelY + (stress > 6 ? 136 : 154);
  const headlineLineHeight = Math.round(preset.headlineSize * 1.14);
  const insightLineHeight = Math.round(preset.insightSize * 1.34);
  const supportLineHeight = Math.round(preset.supportSize * 1.35);
  const insightStart = headlineStart + (headlineLines.length * headlineLineHeight) + (stress > 6 ? 24 : 34);
  const supportStart = insightStart + (insightLines.length * insightLineHeight) + (supportLines.length > 0 ? (stress > 6 ? 16 : 24) : 0);
  const ctaWidth = Math.max(176, Math.min(preset.ctaProminence === 'strong' ? 430 : 360, input.overlay.cta.length * 15 + 64));
  const ctaHeight = preset.ctaProminence === 'subtle' ? 56 : 66;
  const ctaY = Math.min(input.height - 146, supportStart + (supportLines.length * supportLineHeight) + (stress > 6 ? 28 : 40));
  const layoutBottom = ctaY + ctaHeight + (preset.footerMode === 'hidden' ? 0 : 76);
  const footer = preset.footerMode === 'hidden' ? '' : input.brandKit.companyName || '';
  const brandPlacement = {
    top: preset.margin + 14,
    left: input.width - preset.margin - (preset.brandMode === 'standard' ? 210 : 86),
    maxWidth: preset.brandMode === 'standard' ? 190 : 74,
    maxHeight: preset.brandMode === 'standard' ? 74 : 74,
  };
  const quality = evaluateOverlayQuality({
    overlay: input.overlay,
    preset,
    headlineLines,
    insightLines,
    supportLines,
    layoutBottom,
    height: input.height,
    ctaWidth,
  });

  const svg = `
    <svg width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="rgba(2,6,23,${overlayStrategy.shadeStartOpacity})" />
          <stop offset="68%" stop-color="rgba(2,6,23,${overlayStrategy.shadeMidOpacity})" />
          <stop offset="100%" stop-color="rgba(2,6,23,0)" />
        </linearGradient>
      </defs>
      <rect width="${input.width}" height="${input.height}" fill="url(#shade)" />
      <rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${input.height - (panelY * 2)}" rx="32" fill="rgba(15,23,42,${panelOpacity})" stroke="rgba(255,255,255,0.14)" />
      <text x="${panelX + 42}" y="${panelY + 66}" fill="${accent}" font-size="${preset.hookSize}" font-family="${input.brandKit.typography.fontFamily}" font-weight="800" letter-spacing="1.1">${escapeXml(hook.toUpperCase())}</text>
      ${headlineLines.map((line, index) => `<text x="${panelX + 42}" y="${headlineStart + index * headlineLineHeight}" fill="${overlayStrategy.headingColor}" font-size="${preset.headlineSize}" font-family="${input.brandKit.typography.fontFamily}" font-weight="${input.brandKit.typography.headingWeight}">${escapeXml(line)}</text>`).join('')}
      ${insightLines.map((line, index) => `<text x="${panelX + 44}" y="${insightStart + index * insightLineHeight}" fill="${overlayStrategy.textColor}" font-size="${preset.insightSize}" font-family="${input.brandKit.typography.fontFamily}" font-weight="${input.brandKit.typography.bodyWeight}">${escapeXml(line)}</text>`).join('')}
      ${supportLines.map((line, index) => `<text x="${panelX + 44}" y="${supportStart + index * supportLineHeight}" fill="${overlayStrategy.mutedTextColor}" font-size="${preset.supportSize}" font-family="${input.brandKit.typography.fontFamily}" font-weight="500">${escapeXml(line)}</text>`).join('')}
      <rect x="${panelX + 42}" y="${ctaY}" width="${ctaWidth}" height="${ctaHeight}" rx="${Math.round(ctaHeight / 2)}" fill="${accent}" opacity="${preset.ctaProminence === 'subtle' ? '0.9' : '1'}" />
      <text x="${panelX + 74}" y="${ctaY + Math.round(ctaHeight * 0.64)}" fill="${overlayStrategy.ctaTextColor}" font-size="${preset.ctaSize}" font-family="${input.brandKit.typography.fontFamily}" font-weight="900">${escapeXml(input.overlay.cta || 'Learn more')}</text>
      ${footer ? `<text x="${panelX + 42}" y="${input.height - 82}" fill="${overlayStrategy.footerColor}" opacity="${preset.footerMode === 'subtle' ? '0.72' : '0.9'}" font-size="22" font-family="${input.brandKit.typography.fontFamily}" font-weight="700">${escapeXml(footer.slice(0, 62))}</text>` : ''}
    </svg>
  `.trim();
  return { svg, quality, brandPlacement };
}

async function loadBrandMark(input: {
  brandKit: CreatorBrandKit;
  placement: { maxWidth: number; maxHeight: number };
}): Promise<Buffer | null> {
  const brandMark = normalizeBrandMark(input.brandKit);
  if (brandMark.type === 'initials' || !/^https?:\/\//i.test(brandMark.source)) {
    return renderInitialsBrandMark({
      initials: brandMark.fallbackInitials,
      brandKit: input.brandKit,
      placement: input.placement,
    });
  }
  try {
    const buffer = await bufferFromRemoteImage(brandMark.source);
    return await sharp(buffer)
      .resize({ width: input.placement.maxWidth, height: input.placement.maxHeight, fit: 'inside', withoutEnlargement: true })
      .modulate({ brightness: 1.04, saturation: 0.92 })
      .png()
      .toBuffer();
  } catch {
    return renderInitialsBrandMark({
      initials: brandMark.fallbackInitials,
      brandKit: input.brandKit,
      placement: input.placement,
    });
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

function buildAiImagePrompt(input: {
  title: string;
  body: string;
  eyebrow: string;
  metadata: Record<string, unknown>;
  assetPayload: Record<string, unknown>;
  /** Defaults to 'text_embedded' for backward compatibility. */
  imageMode?: ImageRenderMode;
  /** Subtype hint resolved from `creator_card.subtype` etc. */
  subtypeHint?: ImageSubtypeHint | null;
}): string {
  const brandContext = safeObject(input.metadata.brand_context);
  const selectedAssets = safeObject(input.metadata.selected_brand_assets);
  const colorPalette = Array.isArray(input.assetPayload.color_palette)
    ? input.assetPayload.color_palette.map((value) => String(value)).filter(Boolean).slice(0, 5).join(', ')
    : '';
  const audience = compactText(input.metadata.audience);
  const platform = compactText(input.metadata.platform || input.metadata.primary_platform);
  const objective = compactText(input.metadata.objective || input.metadata.summary);
  const brandTone = compactText(brandContext.tone || input.metadata.tone);
  const tagline = compactText(brandContext.tagline || selectedAssets.tagline);
  const mode: ImageRenderMode = input.imageMode ?? 'text_embedded';

  // Mode-shared header — both branches still ban literal typography in
  // the generated image. text_embedded relies on the deterministic SVG
  // overlay; composition deliberately keeps provider text out because
  // models routinely render it malformed.
  const header = [
    mode === 'composition'
      ? 'Create a production-ready editorial marketing visual that stands on its own as a complete social creative — not an ad poster, text layout, slide, or wireframe.'
      : 'Create a production-ready editorial marketing visual scene, not an ad poster, text layout, slide, or wireframe.',
    `Content type: ${input.eyebrow || 'image'}.`,
    `Theme to depict visually, without writing it in the image: ${input.title}.`,
    input.body ? `Visual direction to depict through objects, people, color, lighting, and composition only: ${input.body}.` : '',
    objective ? `Objective: ${objective}.` : '',
    audience ? `Audience: ${audience}.` : '',
    platform ? `Platform intent: ${platform}.` : '',
    brandTone ? `Brand personality: ${brandTone}.` : '',
    tagline ? `Optional tagline influence: ${tagline}.` : '',
    colorPalette ? `Use this color direction where natural: ${colorPalette}.` : '',
    input.subtypeHint?.promptLine ?? '',
  ];

  const modeBlock = mode === 'composition'
    ? [
        // Composition: full-frame finished visual, no reserved overlay space.
        'Treat the entire frame as the final creative — no reserved negative space, no anticipated text overlay.',
        'Compose with a clear focal subject, strong color discipline, and intentional foreground/background balance. The image must read on its own without any accompanying text.',
        'Prefer clean real-world marketing photography, tasteful product/context scenes, or premium editorial abstraction with one clear focal idea.',
        'Keep the visual standalone: it pairs with a separate caption written outside the image, so the image itself should not try to deliver the message in words.',
      ]
    : [
        // text_embedded: leave room for the SVG overlay we composite later.
        'Make it polished, specific, modern, and usable as a commercial social creative background with clear negative space for a later text overlay.',
        'Keep the focal subject to the right or background depth, leaving the left and lower-left visually calm for typography.',
        'Prefer clean real-world marketing photography, tasteful product/context scenes, or premium editorial abstraction with one clear focal idea.',
        'Represent CTA direction through composition and focal hierarchy, not through rendered text.',
      ];

  // Shared guardrails — apply in both modes. Provider typography is
  // banned in BOTH branches: composition relies on the visual itself,
  // text_embedded relies on our deterministic overlay.
  const footer = [
    'Strictly avoid all visible text: no words, letters, numbers, captions, signage, fake logos, UI text, CTA buttons, or tagline text.',
    'If a screen, dashboard, paper, or object appears, keep any markings abstract and unreadable.',
    'Use brand details as visual influence only: palette, mood, composition, industry cues, and audience relevance.',
    'Avoid chaotic collages, busy dashboards, decorative clutter, fake interface screenshots, malformed hands, and plain gradient quote cards.',
  ];

  return [...header, ...modeBlock, ...footer].filter(Boolean).join('\n');
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
  /**
   * Telemetry-only context. Passed through to `creatorEvent` so a
   * dashboard can pivot provider failures by platform / imageMode /
   * subtype / creator type. Does NOT affect the prompt or the API call.
   */
  eventContext?: {
    creatorType?: string | null;
    imageMode?:   string | null;
    subtype?:     string | null;
    platform?:    string | null;
  };
}): Promise<ProviderImageResult> {
  const apiKey = await resolveOpenAiImageKey();
  if (!apiKey) {
    return { image: null, fallbackReason: 'OpenAI API key unavailable' };
  }

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey });
  const modelCandidates = ['gpt-image-1'];
  const failures: string[] = [];

  for (const model of modelCandidates) {
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
      const first = getFirstImageResult(response);
      if (first?.b64_json) {
        return { image: { buffer: Buffer.from(first.b64_json, 'base64'), model } };
      }
      if (first?.url) {
        return { image: { buffer: await bufferFromRemoteImage(first.url), model } };
      }
      failures.push(`${model}: no image returned`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
        imageMode:   input.eventContext?.imageMode   ?? null,
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
 * Image-mode contract: dictates whether the renderer composites the
 * deterministic overlay or leaves the provider image standing on its own.
 * Mirrors {@link ImageMode} in `lib/content/writerCreatorAssetLaunch.ts`.
 *
 *   composition    — provider image is the finished creative; renderer
 *                    skips the overlay composite. Brand mark may still
 *                    be composited.
 *   text_embedded  — provider image is a textless background; renderer
 *                    composites the deterministic overlay on top.
 *
 * Resolves from the payload / metadata / asset-kind in
 * {@link resolveImageMode}. `banner` and `infographic` are always
 * `text_embedded` by definition (their renderer never had a composition
 * variant); only `image` can flip.
 */
type ImageRenderMode = 'composition' | 'text_embedded';

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

function resolveImageMode(input: {
  fileNamePrefix: string;
  assetPayload:   Record<string, unknown>;
  metadata:       Record<string, unknown>;
}): ImageRenderMode {
  if (input.fileNamePrefix !== 'image') return 'text_embedded';
  const candidates = [
    input.assetPayload.image_mode,
    input.metadata.image_mode,
    safeObject(input.metadata.creator_card).image_mode,
  ];
  for (const candidate of candidates) {
    if (candidate === 'composition' || candidate === 'text_embedded') return candidate;
  }
  // Renderer-level default when no mode is supplied: text_embedded.
  // This preserves legacy callers (which never sent image_mode) and
  // their established visual identity. The Writer launcher always
  // stamps `image_mode: 'composition'` so Writer flows still get the
  // audit-driven default at the launcher layer.
  return 'text_embedded';
}

async function renderImageLikeAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
  fileNamePrefix: string
): Promise<RenderedMediaBundle> {
  const descriptor = safeObject(assetPayload.visual_descriptor);
  const captionBlueprint = safeObject(assetPayload.caption_blueprint);
  const metadata = safeObject(safeObject(assetPayload.media_bundle).metadata);
  const title = compactText(descriptor.headline ?? captionBlueprint.hook ?? metadata.topic, 'Creator Asset');
  const body = compactText(descriptor.visual_description ?? captionBlueprint.body ?? metadata.summary, 'Generated creative asset');
  const eyebrow = compactText(metadata.content_type ?? assetPayload.asset_kind, 'creator');
  const platform = compactText(metadata.platform || metadata.primary_platform || safeObject(assetPayload.platform_payload).platform, 'social');
  const brandKit = resolveCreatorBrandKit({
    assetPayload,
    metadata,
    companyId: options.companyId,
    tenantId: options.companyId,
    platform,
    assetType: fileNamePrefix,
  });
  const brandColors = brandKit.normalizedPalette;
  const overlay = normalizeOverlayText({ assetPayload, metadata, title, body });
  const imageMode = resolveImageMode({ fileNamePrefix, assetPayload, metadata });
  const subtypeHint = resolveImageSubtype(metadata, assetPayload);
  const providerResult = await generateProviderImage({
    prompt: buildAiImagePrompt({
      title,
      body,
      eyebrow,
      metadata,
      assetPayload,
      imageMode,
      subtypeHint,
    }),
    eventContext: {
      creatorType: fileNamePrefix,
      imageMode,
      subtype:     subtypeHint?.subtypeId ?? null,
      platform,
    },
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
  const skipOverlayComposite = imageMode === 'composition';
  const overlayRender = skipOverlayComposite
    ? null
    : buildOverlaySvg({
        width,
        height,
        overlay,
        brandKit,
        platform,
        fileNamePrefix,
        subtypeHint,
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
    image_mode: imageMode,
    image_subtype: subtypeHint?.subtypeId ?? null,
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
        overlay_text: overlay,
      } : { mode: 'composition', ...brandKit.overlayStrategy },
      exportCapabilities: ['preview', 'download', 'save_as_asset'],
    }),
  };
  if (!skipOverlayComposite && overlayRender) {
    modeAwareMetadata.overlay_text = overlay;
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
  const background = await renderBackgroundPng({ width, height, colors: brandColors, variantId: brandKit.layoutVariantId });
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

function normalizeStructuredItems(
  items: Array<Record<string, unknown>>,
  fallbackLabel: string,
  fileNamePrefix: string,
  metadata: Record<string, unknown>,
): Array<Record<string, string>> {
  const clean = items.map((item, index) => ({
    role: compactText(item.role || item.section_type || item.type || `Slide ${index + 1}`),
    headline: compactText(item.headline || item.title || item.heading || `Slide ${index + 1}`),
    body: compactText(item.body_text || item.body || item.text || item.summary || fallbackLabel),
    designNote: compactText(item.design_note || item.visual_description || item.visual || ''),
  })).filter((item) => item.headline || item.body);

  if (clean.length > 0) {
    const lastIndex = clean.length - 1;
    return clean.slice(0, fileNamePrefix === 'pdf' ? 7 : 8).map((item, index) => ({
      role: index === 0 ? 'hook' : index === lastIndex ? 'cta' : item.role || (index === 1 ? 'insight' : index === 2 ? 'proof' : 'content'),
      headline: item.headline,
      body: item.body,
      designNote: item.designNote,
    }));
  }

  const topic = compactText(metadata.topic || fallbackLabel, fallbackLabel);
  const summary = compactText(metadata.summary || fallbackLabel, fallbackLabel);
  const objective = compactText(metadata.objective || 'Make the core idea easy to act on');
  return [
    { role: 'hook', headline: topic, body: summary, designNote: 'Strong opening hierarchy' },
    { role: 'insight', headline: 'Core insight', body: objective, designNote: 'Clarify the important shift' },
    { role: 'proof', headline: 'Why it matters', body: summary, designNote: 'Add credibility and context' },
    { role: 'cta', headline: compactText(metadata.cta || 'Next step'), body: 'Close with one clear action.', designNote: 'CTA ending' },
  ];
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
}): Promise<{ buffer: Buffer; quality: OverlayQualityReport }> {
  const platform = compactText(input.metadata.platform || input.metadata.primary_platform, 'linkedin');
  const overlay = {
    hook: `${input.item.role || 'slide'} ${input.index + 1}/${input.total}`,
    headline: input.item.headline,
    keyInsight: input.item.body,
    cta: input.index === input.total - 1 ? compactText(input.metadata.cta || 'Take the next step') : 'Keep reading',
    supportingText: input.item.designNote,
  };
  const background = await renderBackgroundPng({
    width: input.width,
    height: input.height,
    colors: input.brandKit.normalizedPalette,
    variantId: `${input.brandKit.layoutVariantId}-${input.index}`,
  });
  const overlayRender = buildOverlaySvg({
    width: input.width,
    height: input.height,
    overlay,
    brandKit: input.brandKit,
    platform,
    fileNamePrefix: input.fileNamePrefix === 'pdf' ? 'infographic' : 'carousel',
  });
  const brandMark = await loadBrandMark({
    brandKit: input.brandKit,
    placement: overlayRender.brandPlacement,
  });
  const composites: Array<{ input: Buffer; top: number; left: number }> = [
    { input: Buffer.from(overlayRender.svg), top: 0, left: 0 },
  ];
  if (brandMark && (input.index === 0 || input.index === input.total - 1 || input.fileNamePrefix !== 'carousel')) {
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

async function renderCarouselLikeAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
  items: Array<Record<string, unknown>>,
  fallbackLabel: string,
  fileNamePrefix: string
): Promise<RenderedMediaBundle> {
  const metadata = safeObject(safeObject(assetPayload.media_bundle).metadata);
  const platform = compactText(metadata.platform || metadata.primary_platform, 'linkedin');
  const brandKit = resolveCreatorBrandKit({
    assetPayload,
    metadata,
    companyId: options.companyId,
    tenantId: options.companyId,
    platform,
    assetType: fileNamePrefix,
  });
  const renderItems = normalizeStructuredItems(items, fallbackLabel, fileNamePrefix, metadata);
  const width = fileNamePrefix === 'slider' ? 1600 : 1200;
  const height = fileNamePrefix === 'slider' ? 900 : fileNamePrefix === 'pdf' ? 1500 : 1200;
  const files: string[] = [];
  const qualityReports: OverlayQualityReport[] = [];
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
      overlay_quality: {
        score: Math.round(qualityReports.reduce((sum, report) => sum + report.score, 0) / Math.max(1, qualityReports.length)),
        flags: Array.from(new Set(qualityReports.flatMap((report) => report.flags))).slice(0, 8),
        preset: fileNamePrefix,
      },
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

export async function renderAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions = {}
): Promise<RenderedMediaBundle> {
  const assetKind = String(assetPayload.asset_kind || '').trim();
  const metadata = safeObject(safeObject(assetPayload.media_bundle).metadata);
  const imageContentType = String(metadata.content_type || '').trim().toLowerCase();
  const imageFileNamePrefix = ['banner', 'infographic', 'image'].includes(imageContentType)
    ? imageContentType
    : 'image';

  try {
    if (assetKind === 'image') {
      return await renderImageLikeAsset(assetPayload, options, imageFileNamePrefix);
    }

    if (assetKind === 'carousel') {
      const carouselContentType = String(metadata.content_type || '').trim().toLowerCase();
      const carouselFileNamePrefix = ['pdf', 'slider', 'carousel'].includes(carouselContentType)
        ? carouselContentType
        : 'carousel';
      const slides = Array.isArray(assetPayload.slides)
        ? assetPayload.slides.filter((slide) => slide && typeof slide === 'object' && !Array.isArray(slide)).map((slide) => slide as Record<string, unknown>)
        : [];
      const threadSequence = Array.isArray(assetPayload.thread_sequence)
        ? assetPayload.thread_sequence.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => item as Record<string, unknown>)
        : [];
      const items = slides.length > 0 ? slides : threadSequence;
      if (items.length > 0) {
        return await renderCarouselLikeAsset(assetPayload, options, items, 'Creator structured asset', carouselFileNamePrefix);
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
      imageMode:   typeof metadata.image_mode === 'string' ? metadata.image_mode : null,
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

// ── Test-only internal exports ───────────────────────────────────────────────
// Pure helpers exposed for unit tests. NOT a public API; do not call these
// from production code paths — use the higher-level `renderAsset` entry
// point instead. Keeping the surface explicit so the module's actual public
// API stays compact.
export const __test = {
  resolveImageMode,
  resolveImageSubtype,
  buildAiImagePrompt,
  IMAGE_SUBTYPE_HINTS,
  classifyPdfStorageFailure,
  USER_MESSAGE_FOR_PDF_FALLBACK,
  computeCompositionQuality,
};
