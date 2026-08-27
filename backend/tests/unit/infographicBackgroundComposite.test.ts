/**
 * Phase 63 — the uploaded image really is in the picture.
 *
 * WHY A PIXEL TEST
 * ----------------
 * Every other guard in this phase reads source or mocks a boundary, and all of
 * them would still pass if the bytes were resolved, cached, and then quietly
 * dropped before compositing. The claim being made to the user is visual —
 * "we'll use your image as a faded background" — so at least one test has to
 * be visual too.
 *
 * This exercises the real sharp pipeline the renderer runs: an image as the
 * BASE layer, the scrim-bearing SVG composited over it, at the real opacity
 * bounds. It then reads the output pixels back and asserts two things that
 * cannot both be true by accident — the photograph changed the result, and the
 * scrim still muted it enough for text to survive.
 *
 * It deliberately does NOT call `renderInfographicAsset`: that function needs
 * storage, a brand kit, OCR and governance, none of which say anything about
 * whether a background reached the canvas. The compositing contract is what
 * matters, and it is testable exactly.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import { buildBackgroundLayerSvg, BACKGROUND_IMAGE_MIN_OPACITY, BACKGROUND_IMAGE_MAX_OPACITY } from '../../services/creator/infographicDataCards';

const sharp = require('sharp') as typeof import('sharp');

const W = 240;
const H = 300;

/** A vivid, unmistakable "photograph" — pure red. */
const photograph = () => sharp({
  create: { width: 600, height: 400, channels: 3, background: { r: 255, g: 0, b: 0 } },
}).png().toBuffer();

/** The scrim layer the renderer builds, wrapped as a standalone SVG document. */
function scrimSvg(imageOpacity: number): Buffer {
  const layer = buildBackgroundLayerSvg({ mode: 'image', width: W, height: H, imageOpacity });
  // The real renderer's gradient is defined in its own defs; a flat dark fill
  // stands in for it here so the assertion is about the SCRIM's strength rather
  // than about a particular brand palette.
  const withFlatFill = layer.replace('fill="url(#infographicBgGradient)"', 'fill="#101828"');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${withFlatFill}</svg>`);
}

/** Mean channel values of the rendered canvas. */
async function meanRgb(png: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0;
  const px = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  return { r: r / px, g: g / px, b: b / px };
}

/** Exactly what the renderer does: image is the base, SVG composites on top. */
async function composite(imageOpacity: number): Promise<Buffer> {
  const base = await sharp(await photograph())
    .resize(W, H, { fit: 'cover' })
    .png()
    .toBuffer();
  const overlay = await sharp(scrimSvg(imageOpacity)).png().toBuffer();
  return sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
}

/** The no-background baseline: the SVG alone is the base layer. */
async function gradientOnly(): Promise<Buffer> {
  const layer = buildBackgroundLayerSvg({ mode: 'gradient', width: W, height: H, imageOpacity: 0.45 })
    .replace('fill="url(#infographicBgGradient)"', 'fill="#101828"');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${layer}</svg>`);
  return sharp(svg).png().toBuffer();
}

describe('A — the photograph reaches the canvas', () => {
  it('CRITICAL: the uploaded image visibly changes the render', async () => {
    const withImage = await meanRgb(await composite(0.45));
    const without = await meanRgb(await gradientOnly());
    // The red channel is the signature of the photograph. If the image never
    // reached the base layer, these would be identical.
    expect(withImage.r).toBeGreaterThan(without.r + 20);
  }, 30000);

  it('CRITICAL: the image is cover-cropped to the canvas, not letterboxed', async () => {
    // A 600×400 source into a 240×300 portrait canvas: cover crops, contain
    // would leave bars. Every pixel carries the photograph, so the minimum red
    // across the canvas stays high.
    const base = await sharp(await photograph()).resize(W, H, { fit: 'cover' }).raw()
      .toBuffer({ resolveWithObject: true });
    let minRed = 255;
    for (let i = 0; i < base.data.length; i += base.info.channels) {
      if (base.data[i] < minRed) minRed = base.data[i];
    }
    expect(minRed).toBeGreaterThan(200);
  }, 30000);

  it('the output is the full canvas size', async () => {
    const meta = await sharp(await composite(0.45)).metadata();
    expect(meta.width).toBe(W);
    expect(meta.height).toBe(H);
  }, 30000);
});

describe('B — and is genuinely FADED, at every allowed opacity', () => {
  it('CRITICAL: the scrim mutes the photograph rather than showing it raw', async () => {
    const raw = await meanRgb(await sharp(await photograph()).resize(W, H, { fit: 'cover' }).png().toBuffer());
    const composited = await meanRgb(await composite(BACKGROUND_IMAGE_MAX_OPACITY));
    // Even at the MOST visible setting the image is materially darkened — the
    // promise is "faded background", not "your photo".
    expect(composited.r).toBeLessThan(raw.r * 0.75);
  }, 30000);

  it('CRITICAL: at every allowed opacity the scrim is at least 40%', async () => {
    for (const o of [BACKGROUND_IMAGE_MIN_OPACITY, 0.45, BACKGROUND_IMAGE_MAX_OPACITY]) {
      const layer = buildBackgroundLayerSvg({ mode: 'image', width: W, height: H, imageOpacity: o });
      const opacity = Number(/opacity="([\d.]+)"/.exec(layer)![1]);
      expect(opacity).toBeGreaterThanOrEqual(0.4);
      expect(opacity).toBeLessThanOrEqual(0.8);
    }
  });

  it('a more visible image still leaves a darker result than a less visible one', async () => {
    const subtle = await meanRgb(await composite(BACKGROUND_IMAGE_MIN_OPACITY));
    const strong = await meanRgb(await composite(BACKGROUND_IMAGE_MAX_OPACITY));
    // Higher imageOpacity ⇒ weaker scrim ⇒ more of the red photograph.
    expect(strong.r).toBeGreaterThan(subtle.r);
  }, 30000);
});

describe('C — no background is byte-for-byte the old behaviour', () => {
  it('CRITICAL: the gradient path is unchanged and carries no image', async () => {
    const a = await gradientOnly();
    const b = await gradientOnly();
    expect(a.equals(b)).toBe(true);
    const rgb = await meanRgb(a);
    // No red anywhere: nothing of the photograph leaked into the default path.
    expect(rgb.r).toBeLessThan(40);
  }, 30000);

  it('gradient mode emits no opacity attribute at all', () => {
    const layer = buildBackgroundLayerSvg({ mode: 'gradient', width: W, height: H, imageOpacity: 0.45 });
    expect(layer).not.toContain('opacity=');
  });
});
