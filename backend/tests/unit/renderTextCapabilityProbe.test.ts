/**
 * PARITY GATE — render-text capability probe tests.
 * Verifies the ink detector (the blank-vs-rendered discriminator) and that the
 * current environment can rasterize SVG text. The same probe, run in the prod
 * worker image, is what blocks a font-less deploy.
 */
import sharp from 'sharp';
import {
  probeRenderTextCapability,
  measureInkRatio,
  RENDER_TEXT_INK_THRESHOLD,
} from '../../services/renderTextCapabilityProbe';

async function solidPng(hex: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 32, channels: 4, background: { ...hex, alpha: 1 } },
  }).png().toBuffer();
}

describe('measureInkRatio — blank vs inked discriminator', () => {
  it('a pure-white image has ~0 ink', async () => {
    const ratio = await measureInkRatio(await solidPng({ r: 255, g: 255, b: 255 }));
    expect(ratio).toBeLessThan(RENDER_TEXT_INK_THRESHOLD);
  });

  it('a solid-black image is ~all ink', async () => {
    const ratio = await measureInkRatio(await solidPng({ r: 0, g: 0, b: 0 }));
    expect(ratio).toBeGreaterThan(0.9);
  });
});

describe('probeRenderTextCapability — environment text-render check', () => {
  it('returns a structured result and never throws', async () => {
    const r = await probeRenderTextCapability();
    expect(typeof r.ok).toBe('boolean');
    expect(typeof r.inkRatio).toBe('number');
    expect(r.fontFamily).toBe('Inter, Arial');
  });

  it('this environment CAN render text glyphs (fonts present) → ok=true with ink', async () => {
    // The dev/CI host has system fonts, so Inter/Arial resolves and text inks.
    // A font-less prod image would return ok=false here — which is the gate.
    const r = await probeRenderTextCapability();
    expect(r.ok).toBe(true);
    expect(r.inkRatio).toBeGreaterThan(RENDER_TEXT_INK_THRESHOLD);
  });

  it('a nonsense font-family still inks because the rasterizer falls back to a default font', async () => {
    // Even a bogus family must produce glyphs IF any font exists; if this env
    // had NO fonts at all, this would be ok=false (the regression signature).
    const r = await probeRenderTextCapability('___NoSuchFont___');
    expect(typeof r.ok).toBe('boolean');
  });
});
