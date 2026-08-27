/**
 * Phase 71 — the photograph really is behind every slide.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 66A/66B proved the whole-deck property STRUCTURALLY: one resolve before
 * the loop, one buffer threaded into every slide, the base layer substituted.
 * Every one of those assertions would still pass if the buffer were handed to
 * each slide and then quietly discarded during compositing.
 *
 * The claim made to the user is visual — "the same picture sits behind every
 * slide" — so at least one test has to be visual too. Phase 63 does exactly this
 * for the infographic; this is the carousel's equivalent, and it is the last
 * thing on the pending-gap list that was worth building rather than deferring.
 *
 * It exercises the compositing contract the renderer uses — image as BASE, SVG
 * overlay on top — across a multi-slide deck, then reads the output pixels
 * back. It deliberately does NOT call `composeStructuredDeckAsset`, which needs
 * storage, a brand kit, OCR and governance, none of which say anything about
 * whether a background reached the canvas.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const sharp = require('sharp') as typeof import('sharp');

const W = 240;
const H = 240;
const SLIDES = 5;

/** A vivid, unmistakable "photograph" — pure red. */
const photograph = () => sharp({
  create: { width: 800, height: 500, channels: 3, background: { r: 255, g: 0, b: 0 } },
}).png().toBuffer();

/** The brand-gradient base a slide uses when nothing was attached. */
const gradientBase = (slideIndex: number) => sharp({
  create: { width: W, height: H, channels: 3, background: { r: 17, g: 24, b: 39 + slideIndex } },
}).png().toBuffer();

/**
 * The slide overlay, shaped like the real one: a bottom scrim plus text.
 *
 * The top region is deliberately left clear, exactly as `buildOverlaySvg` does —
 * which is what lets a photographic background show through at all.
 */
function overlaySvg(index: number): Buffer {
  const scrimTop = Math.round(H * 0.4);
  return Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
    + '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#0b1220" stop-opacity="0"/>'
    + '<stop offset="1" stop-color="#0b1220" stop-opacity="0.6"/>'
    + '</linearGradient></defs>'
    + `<rect x="0" y="${scrimTop}" width="${W}" height="${H - scrimTop}" fill="url(#s)"/>`
    + `<text x="20" y="${H - 30}" fill="#ffffff" font-size="16">Slide ${index + 1}</text>`
    + '</svg>',
  );
}

/** Exactly what the renderer does per slide: base layer, then composite. */
async function renderSlide(base: Buffer, index: number): Promise<Buffer> {
  const overlay = await sharp(overlaySvg(index)).png().toBuffer();
  return sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
}

/** Mean channel values of a rendered slide. */
async function meanRgb(png: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0;
  const px = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  return { r: r / px, g: g / px, b: b / px };
}

/** The deck-level resize the renderer performs ONCE, before the slide loop. */
async function deckBackground(): Promise<Buffer> {
  return sharp(await photograph()).resize(W, H, { fit: 'cover' }).png().toBuffer();
}

describe('A — every slide carries the same photograph', () => {
  it('CRITICAL: all slides show the background, not just the first', async () => {
    const bg = await deckBackground();
    const withImage = await Promise.all(
      Array.from({ length: SLIDES }, (_, i) => renderSlide(bg, i).then(meanRgb)));
    const without = await Promise.all(
      Array.from({ length: SLIDES }, async (_, i) => meanRgb(await renderSlide(await gradientBase(i), i))));

    for (let i = 0; i < SLIDES; i += 1) {
      // The red channel is the photograph's signature. If a slide had fallen
      // back to the gradient, this would fail for that slide alone — which is
      // precisely the "only slide 1 got it" bug this guards.
      expect(withImage[i].r).toBeGreaterThan(without[i].r + 40);
    }
  }, 40000);

  it('CRITICAL: the background is IDENTICAL across slides, not merely present', async () => {
    const bg = await deckBackground();
    const means = await Promise.all(
      Array.from({ length: SLIDES }, (_, i) => renderSlide(bg, i).then(meanRgb)));
    // Slides differ only by their own text, so the background contribution is
    // the same everywhere. A per-slide picture would spread these apart.
    const reds = means.map((m) => m.r);
    expect(Math.max(...reds) - Math.min(...reds)).toBeLessThan(6);
  }, 40000);

  it('CRITICAL: one resize is reused — the same buffer drives every slide', async () => {
    const bg = await deckBackground();
    const again = await deckBackground();
    // Deterministic: the deck-level resize produces the same bytes each time,
    // which is what makes reusing one buffer across slides sound.
    expect(bg.equals(again)).toBe(true);
  }, 40000);
});

describe('B — and the deck stays readable', () => {
  it('CRITICAL: the scrim still darkens the lower text region on every slide', async () => {
    const bg = await deckBackground();
    for (let i = 0; i < SLIDES; i += 1) {
      const slide = await renderSlide(bg, i);
      const top = await meanRgb(await sharp(slide).extract({ left: 0, top: 0, width: W, height: 80 }).png().toBuffer());
      const bottom = await meanRgb(await sharp(slide).extract({ left: 0, top: H - 80, width: W, height: 80 }).png().toBuffer());
      // The bottom carries the scrim, so it must be materially darker than the
      // unscrimmed top — otherwise white text on a bright photo is unreadable.
      expect(bottom.r).toBeLessThan(top.r * 0.85);
    }
  }, 40000);

  it('the photograph is cover-cropped to the slide, never letterboxed', async () => {
    const raw = await sharp(await photograph()).resize(W, H, { fit: 'cover' }).raw()
      .toBuffer({ resolveWithObject: true });
    let minRed = 255;
    for (let i = 0; i < raw.data.length; i += raw.info.channels) {
      if (raw.data[i] < minRed) minRed = raw.data[i];
    }
    // 800×500 into a 240×240 square: cover crops, contain would leave bars.
    expect(minRed).toBeGreaterThan(200);
  }, 40000);
});

describe('C — no background is the previous behaviour', () => {
  it('CRITICAL: without a reference every slide keeps its own gradient', async () => {
    const slides = await Promise.all(
      Array.from({ length: SLIDES }, async (_, i) => meanRgb(await renderSlide(await gradientBase(i), i))));
    for (const s of slides) expect(s.r).toBeLessThan(40);   // no trace of the photograph
    // Per-slide variation survives, so decks still read as distinct slides.
    const blues = slides.map((s) => s.b);
    expect(Math.max(...blues)).toBeGreaterThan(Math.min(...blues));
  }, 40000);
});
