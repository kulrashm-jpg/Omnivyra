/**
 * Carousel visual-language schema — the CAROUSEL family implementation of the
 * canonical Creator Template domain (see ./types.ts). Mirrors the role of
 * ./infographicStyle.ts and ./imageStyle.ts.
 *
 * A style describes ONLY deterministic visual language (per-slide canvas, base
 * overlay typography, safe margins, panel, background, frame radius, and the
 * deck continuity decoration). It NEVER carries content.
 *
 * `DEFAULT_CAROUSEL_STYLE` is a faithful DATA mirror of the fixed constants the
 * renderer uses in `creatorAssetRenderer.ts → composeStructuredDeckAsset`
 * (slide canvas per output kind) and the shared overlay base. The dynamic,
 * deck-wide font-scale + wave continuity (`buildDeckRenderContext`) and
 * per-platform overlay overrides remain renderer-resolved — a documented
 * migration gap, not encoded here.
 *
 * Pure data + types — client/server safe, no I/O.
 */

import type { ImageOverlayTypography, ImagePanelStyle } from './imageStyle';

export type CarouselStyleSchema = {
  /** Per-output-kind slide canvas (carousel / slider / deck-PDF). */
  canvas: {
    carousel: { width: number; height: number };
    slider: { width: number; height: number };
    pdf: { width: number; height: number };
  };
  /** Base safe margin shared with the overlay system. */
  safe_margins: { base: number };
  /** Per-slide overlay typography base (shares the image overlay scale). */
  typography: ImageOverlayTypography;
  /** Per-slide scrim panel. */
  panel: ImagePanelStyle;
  /** Slide frame corner radius (rounds the deck slide background rect).
   *  Default 0 == the renderer's square full-bleed slide background
   *  (byte-identical); a non-default variant rounds the slide corners. */
  frame: { cornerRadius: number };
  /** Deck continuity decoration — the single flowing wave across slides. */
  decoration: { wave: { enabled: boolean } };
  /** Brand mark mode for deck slides. */
  branding: { mode: 'compact' | 'standard' };
};

/** Faithful encoding of the renderer's deck constants + shared overlay base. */
export const DEFAULT_CAROUSEL_STYLE: CarouselStyleSchema = {
  canvas: {
    carousel: { width: 1200, height: 1200 },
    slider: { width: 1600, height: 900 },
    pdf: { width: 1200, height: 1500 },
  },
  safe_margins: { base: 86 },
  typography: {
    fontFamily: 'Inter, Arial',
    hookSize: 24,
    headlineSize: { normal: 58, dense: 50 },
    insightSize: { normal: 31, dense: 28 },
    supportSize: 24,
    ctaSize: 27,
    maxHeadlineLines: { normal: 2, dense: 3 },
    maxInsightLines: { normal: 2, dense: 3 },
    maxSupportLines: 1,
    headlineChars: { normal: 22, dense: 25 },
    insightChars: { normal: 40, dense: 44 },
    supportChars: 48,
  },
  panel: { widthRatio: { normal: 0.7, dense: 0.74 }, opacity: 0.42 },
  // The deck slide background is a square full-bleed rect → radius 0 is the
  // faithful default (byte-identical). (The image fallback uses 36; the deck
  // does not — see creatorAssetRenderer.renderBackgroundPng.)
  frame: { cornerRadius: 0 },
  decoration: { wave: { enabled: true } },
  branding: { mode: 'standard' },
};
