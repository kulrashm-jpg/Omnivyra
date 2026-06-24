/**
 * PARITY GATE — render-text capability probe.
 *
 * The single universal check behind local↔prod render parity: can THIS
 * environment actually rasterize SVG `<text>` (the way creatorAssetRenderer
 * emits infographic/brand_card bodies, `font-family:"Inter, Arial"`) into real
 * glyphs — or does it produce a blank/no-glyph image?
 *
 * This is exactly the divergence that shipped the blank-infographic regression:
 * localhost (Windows, has Arial) rendered text; the prod worker image (no fonts)
 * rendered blank. The probe renders a known text SVG via the SAME rasterizer
 * (sharp → librsvg → fontconfig) and measures ink. No fonts ⇒ no glyphs ⇒
 * ink ≈ 0 ⇒ the probe FAILS — so a font-less environment is caught before it
 * can serve a single blank asset.
 *
 * Pure + deterministic given the environment. No network, no DB.
 */

import sharp from 'sharp';

/** Ink coverage below this ⇒ the text did not render (no glyphs / blank). */
export const RENDER_TEXT_INK_THRESHOLD = 0.004;

/** A pixel is "ink" when it is meaningfully darker than the white background. */
const WHITE_CUTOFF = 200;

export interface RenderProbeResult {
  ok: boolean;
  /** Fraction of pixels that are non-background (ink). */
  inkRatio: number;
  fontFamily: string;
  reason?: string;
}

/** Known probe SVG: black text on white so ink is unambiguous. */
function probeSvg(fontFamily: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="64">` +
    `<rect width="256" height="64" fill="#ffffff"/>` +
    `<text x="12" y="44" font-size="34" font-weight="700" ` +
    `font-family="${fontFamily}" fill="#000000">Parity 123 ABC</text>` +
    `</svg>`
  );
}

/**
 * Measure the fraction of non-white pixels in a PNG. A correctly-rendered text
 * probe has meaningful ink; a blank (no-glyph) render is ~uniform white ⇒ ~0.
 */
export async function measureInkRatio(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const totalPixels = info.width * info.height;
  if (totalPixels === 0) return 0;
  let ink = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (data[i] < WHITE_CUTOFF || data[i + 1] < WHITE_CUTOFF || data[i + 2] < WHITE_CUTOFF) ink++;
  }
  return ink / totalPixels;
}

/**
 * Probe whether the current environment can rasterize SVG text glyphs. Returns
 * `ok:false` (never throws) when fonts are unavailable or the rasterizer errors.
 */
export async function probeRenderTextCapability(
  fontFamily = 'Inter, Arial',
): Promise<RenderProbeResult> {
  try {
    const png = await sharp(Buffer.from(probeSvg(fontFamily))).png().toBuffer();
    const inkRatio = await measureInkRatio(png);
    const ok = inkRatio >= RENDER_TEXT_INK_THRESHOLD;
    return {
      ok,
      inkRatio,
      fontFamily,
      reason: ok ? undefined : 'no_text_glyphs_rendered — fonts likely missing for this font-family',
    };
  } catch (error) {
    return {
      ok: false,
      inkRatio: 0,
      fontFamily,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Render the probe SVG and return the PNG bytes — for VISUAL validation
 * (readable glyphs vs tofu/.notdef boxes). The ink-ratio check can't tell those
 * apart (boxes have ink); inspecting the actual pixels can. Uses the same
 * sharp→librsvg→fontconfig path as the asset renderer, so it reflects the real
 * font resolution. Returns null (never throws) on failure.
 */
export async function renderProbeImage(fontFamily = 'Inter, Arial'): Promise<Buffer | null> {
  try {
    return await sharp(Buffer.from(probeSvg(fontFamily))).png().toBuffer();
  } catch {
    return null;
  }
}
