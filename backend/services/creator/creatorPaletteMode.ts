/**
 * Render-side palette mode (owner request 2026-10-25): in INDEPENDENT mode the
 * creative takes the chosen look's own colours ('look', the default) or a
 * fresh, seeded, harmonious palette ('experimental') — never the brand kit's.
 * Brand-aware requests (and every request that does not say 'independent')
 * resolve to 'brand' and keep today's behaviour exactly.
 *
 * Used by the image prompt (buildAiImagePrompt), the carousel/deck composer and
 * the infographic renderer. Pure apart from reading the registry.
 *
 * Contrast: the SVG families paint white copy over the background, so the
 * background colours are darkened (hue kept) until white text clears 4.5:1,
 * and an accent is only taken from the palette when white on it clears 3:1 —
 * otherwise the renderer's current accent stays (the WCAG fallback).
 */

import { getVisualStyle } from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';
import { paletteModeFor, type CreatorPaletteMode } from '../../../lib/creator-content/creatorPaletteMode';
import { contrastRatio, type CreatorBrandKit } from '../creatorBrandKit';
import { noveltyIndex, pickPaletteDirection, type PaletteDirection } from './creatorNoveltyPlan';

export type { CreatorPaletteMode } from '../../../lib/creator-content/creatorPaletteMode';

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The brand mode a render payload carries (top-level metadata first, then the carried creator_card). */
export function renderBrandMode(metadata: Record<string, unknown> | null | undefined): string | null {
  const meta = obj(metadata);
  const card = obj(meta.creator_card);
  return str(meta.brand_generation_mode) ?? str(meta.brand_mode)
    ?? str(card.brand_generation_mode) ?? str(card.brand_mode);
}

/** The registry look the user chose (guided_creative.visual_direction_id), or null. */
export function renderLookId(metadata: Record<string, unknown> | null | undefined): string | null {
  const meta = obj(metadata);
  const guided = obj(meta.guided_creative ?? obj(meta.creator_card).guided_creative);
  return getVisualStyle(str(guided.visual_direction_id))?.id ?? null;
}

/** This render's palette mode. Only an explicit 'independent' brand mode leaves 'brand'. */
export function resolveRenderPaletteMode(metadata: Record<string, unknown> | null | undefined): CreatorPaletteMode {
  const meta = obj(metadata);
  const choice = meta.palette_mode ?? obj(meta.creator_card).palette_mode;
  return paletteModeFor(renderBrandMode(meta), choice);
}

/** `novelty_avoid` from the payload (recent picks, see creatorNoveltyRecentPicks), sanitised. */
export function noveltyAvoidFromMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, string[]> | null {
  const raw = obj(obj(metadata).novelty_avoid);
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[a-z_]{1,32}$/.test(key) || !Array.isArray(value)) continue;
    const list = value.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200).slice(0, 10);
    if (list.length > 0) out[key] = list;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/* ── Colour maths ─────────────────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  const k = (n: number) => (n + hue / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
function normHex(hex: string): string | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb[0], rgb[1], rgb[2]) : null;
}

const DEEP = [11, 18, 32]; // #0b1220 — the renderers' own deep neutral

/** The colour mixed toward a deep neutral (hue kept) until white text on it clears `minRatio`. */
export function darkenForWhiteText(hex: string, minRatio = 4.5): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#0b1220';
  for (let step = 0; step <= 20; step += 1) {
    const t = step / 20;
    const candidate = rgbToHex(
      rgb[0] + (DEEP[0] - rgb[0]) * t,
      rgb[1] + (DEEP[1] - rgb[1]) * t,
      rgb[2] + (DEEP[2] - rgb[2]) * t,
    );
    if (contrastRatio(candidate, '#ffffff') >= minRatio) return candidate;
  }
  return '#0b1220';
}

/** A seeded, harmonious palette for a direction: three background tones + one accent (hex). */
export function experimentalPalette(seed: string, direction: PaletteDirection): string[] {
  const base = noveltyIndex(seed, 'palette-hue', 360);
  switch (direction) {
    case 'warm': {
      const h = 0 + (base % 45);
      return [hslToHex(h, 0.7, 0.28), hslToHex(h + 15, 0.75, 0.4), hslToHex(h + 30, 0.8, 0.5), hslToHex(h + 40, 0.9, 0.42)];
    }
    case 'cool': {
      const h = 185 + (base % 80);
      return [hslToHex(h, 0.6, 0.24), hslToHex(h + 20, 0.6, 0.36), hslToHex(h + 40, 0.65, 0.46), hslToHex(h - 20, 0.85, 0.42)];
    }
    case 'complementary':
      return [hslToHex(base, 0.6, 0.22), hslToHex(base, 0.62, 0.34), hslToHex(base + 20, 0.55, 0.3), hslToHex(base + 180, 0.85, 0.42)];
    case 'monochrome-accent':
      return [hslToHex(base, 0.35, 0.16), hslToHex(base, 0.4, 0.27), hslToHex(base, 0.45, 0.38), hslToHex(base + 150, 0.9, 0.42)];
    case 'duotone':
    default:
      return [hslToHex(base, 0.65, 0.24), hslToHex(base + 60, 0.65, 0.34), hslToHex(base, 0.6, 0.4), hslToHex(base + 60, 0.85, 0.42)];
  }
}

export interface IndependentPalette {
  mode: 'look' | 'experimental';
  /** Hex colours, dominant first. */
  palette: string[];
  lookId: string | null;
  /** Experimental only: the seeded direction (recorded as `novelty.picks.palette`). */
  direction: PaletteDirection | null;
}

/**
 * The palette an INDEPENDENT render uses, or null (brand mode, or 'look' with
 * no look chosen → the renderer's current behaviour).
 */
export function resolveIndependentPalette(input: {
  metadata: Record<string, unknown> | null | undefined;
  /** The render's novelty seed; a look-scoped constant when absent (still deterministic). */
  seed?: string | null;
}): IndependentPalette | null {
  const mode = resolveRenderPaletteMode(input.metadata);
  if (mode === 'brand') return null;
  const lookId = renderLookId(input.metadata);
  if (mode === 'look') {
    const palette = (getVisualStyle(lookId)?.palette ?? []).map(normHex).filter((c): c is string => Boolean(c));
    return palette.length >= 2 ? { mode, palette, lookId, direction: null } : null;
  }
  const seed = str(input.seed) ?? `palette:${lookId ?? 'none'}`;
  const direction = pickPaletteDirection(seed, noveltyAvoidFromMetadata(input.metadata)?.palette);
  return { mode, palette: experimentalPalette(seed, direction), lookId, direction };
}

/**
 * A COPY of the brand kit painted with an independent palette: background
 * tones darkened for white copy (≥ 4.5:1), and the accent from the palette only
 * when white on it clears 3:1 — else `fallbackAccent` (the renderer's current
 * accent). The logo / name / typography fields are untouched (the brand mark
 * itself is governed elsewhere). Never mutates the (cached) input kit.
 */
export function applyIndependentPaletteToBrandKit(
  kit: CreatorBrandKit,
  palette: readonly string[],
  fallbackAccent?: string | null,
): CreatorBrandKit {
  const colours = palette.map(normHex).filter((c): c is string => Boolean(c));
  if (colours.length === 0) return kit;
  // Darkest first, so the gradient anchor is the deepest tone of the palette.
  const byDepth = [...colours].sort((a, b) => contrastRatio(b, '#ffffff') - contrastRatio(a, '#ffffff'));
  const background = Array.from(new Set(byDepth.map((c) => darkenForWhiteText(c)))).slice(0, 3);
  while (background.length < 3) background.push(darkenForWhiteText(background[background.length - 1] ?? '#0b1220', 7));
  const accentCandidate = colours.find((c) => contrastRatio(c, '#ffffff') >= 3 && !background.includes(c)) ?? null;
  const accentColor = accentCandidate ?? fallbackAccent ?? kit.accentColor;
  const onDark = contrastRatio(accentColor, '#020617');
  const onLight = contrastRatio(accentColor, '#ffffff');
  const ctaTextColor = onLight >= onDark ? '#ffffff' : '#06121f';
  return {
    ...kit,
    palette: colours.slice(0, 5),
    normalizedPalette: background,
    accentColor,
    contrastProfile: {
      ...kit.contrastProfile,
      backgroundColor: background[0],
      accentContrastOnDark: Math.round(onDark * 100) / 100,
      accentContrastOnLight: Math.round(onLight * 100) / 100,
      ctaTextColor,
      corrections: accentCandidate ? kit.contrastProfile.corrections : [...kit.contrastProfile.corrections, 'independent_palette_accent_fallback'],
    },
    overlayStrategy: { ...kit.overlayStrategy, ctaFill: accentColor, ctaTextColor },
  };
}
